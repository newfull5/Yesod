// yesod runner — polls the server's agent-job queue and executes each job
// with a local headless agent CLI (claude -p by default). The agent talks to
// the tracker through the yesod MCP server configured on this machine; the
// runner only moves job status and streams the CLI output into the job log.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"os"
	"os/exec"
	"strings"
	"time"
)

func runRunner(args []string) {
	fl := flag.NewFlagSet("runner", flag.ExitOnError)
	server := fl.String("server", envOr("YESOD_SERVER", "http://localhost:9999"), "yesod server base URL")
	interval := fl.Duration("interval", 3*time.Second, "queue poll interval")
	timeout := fl.Duration("timeout", 30*time.Minute, "max time per job")
	fl.Parse(args)

	// The prompt is piped to the agent's stdin, so any CLI that reads a task
	// from stdin works (codex exec, etc.) — override via YESOD_AGENT_CMD.
	agentCmd := envOr("YESOD_AGENT_CMD", `claude -p --allowedTools "mcp__yesod__*"`)

	jar, _ := cookiejar.New(nil)
	rc := &runnerClient{
		http:     &http.Client{Jar: jar, Timeout: 60 * time.Second},
		base:     strings.TrimRight(*server, "/"),
		password: os.Getenv("YESOD_PASSWORD"),
	}
	if err := rc.login(); err != nil {
		log.Fatalf("runner: login: %v", err)
	}
	log.Printf("runner: polling %s every %s (agent: %s)", rc.base, *interval, agentCmd)
	for {
		if err := rc.runOnce(agentCmd, *timeout); err != nil {
			log.Printf("runner: %v", err)
		}
		time.Sleep(*interval)
	}
}

type runnerClient struct {
	http     *http.Client
	base     string
	password string
}

func (c *runnerClient) login() error {
	if c.password == "" {
		return nil // auth disabled on the server
	}
	body, _ := json.Marshal(map[string]string{"password": c.password})
	resp, err := c.http.Post(c.base+"/api/login", "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("login: HTTP %d", resp.StatusCode)
	}
	return nil
}

// do sends a JSON request, retrying once through login() on a 401 (server
// restart clears sessions). out may be nil.
func (c *runnerClient) do(method, path string, in, out any) error {
	for attempt := 0; ; attempt++ {
		var rd io.Reader
		if in != nil {
			b, _ := json.Marshal(in)
			rd = bytes.NewReader(b)
		}
		req, err := http.NewRequest(method, c.base+path, rd)
		if err != nil {
			return err
		}
		if in != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := c.http.Do(req)
		if err != nil {
			return err
		}
		if resp.StatusCode == http.StatusUnauthorized && attempt == 0 {
			resp.Body.Close()
			if err := c.login(); err != nil {
				return err
			}
			continue
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 300 {
			b, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("%s %s: HTTP %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(b)))
		}
		if out != nil {
			return json.NewDecoder(resp.Body).Decode(out)
		}
		return nil
	}
}

type runnerJob struct {
	ID       int64  `json:"id"`
	IssueKey string `json:"issue_key"`
	Status   string `json:"status"`
}

func (c *runnerClient) patchJob(id int64, fields map[string]any) error {
	return c.do("PATCH", fmt.Sprintf("/api/agent/jobs/%d", id), fields, nil)
}

func (c *runnerClient) runOnce(agentCmd string, timeout time.Duration) error {
	var jobs []runnerJob
	if err := c.do("GET", "/api/agent/jobs?status=queued", nil, &jobs); err != nil {
		return err
	}
	if len(jobs) == 0 {
		return nil
	}
	job := jobs[0]
	// Atomic claim; a concurrent runner getting there first is not an error.
	if err := c.patchJob(job.ID, map[string]any{"status": "running"}); err != nil {
		if strings.Contains(err.Error(), "HTTP 409") {
			return nil
		}
		return err
	}
	log.Printf("runner: job %d (%s) claimed", job.ID, job.IssueKey)

	prompt, err := c.buildPrompt(job.IssueKey)
	if err != nil {
		c.patchJob(job.ID, map[string]any{"status": "failed", "result": "runner: " + err.Error()})
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", "-c", agentCmd)
	cmd.Stdin = strings.NewReader(prompt)
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	lastLine := ""
	scanDone := make(chan struct{})
	go func() {
		defer close(scanDone)
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		for sc.Scan() {
			line := sc.Text()
			if strings.TrimSpace(line) != "" {
				lastLine = line
			}
			// ponytail: one PATCH per output line; claude -p prints little.
			// Batch if an agent CLI ever floods this.
			if err := c.patchJob(job.ID, map[string]any{"log_append": line + "\n"}); err != nil {
				log.Printf("runner: log append: %v", err)
			}
		}
	}()

	runErr := cmd.Run()
	pw.Close()
	<-scanDone

	if runErr != nil {
		msg := runErr.Error()
		if ctx.Err() == context.DeadlineExceeded {
			msg = fmt.Sprintf("timed out after %s", timeout)
		}
		c.patchJob(job.ID, map[string]any{"status": "failed", "result": truncate("agent: "+msg, 200)})
		return fmt.Errorf("job %d (%s): %s", job.ID, job.IssueKey, msg)
	}
	if err := c.patchJob(job.ID, map[string]any{"status": "done", "result": truncate(lastLine, 200)}); err != nil {
		return err
	}
	log.Printf("runner: job %d (%s) done", job.ID, job.IssueKey)
	return nil
}

func (c *runnerClient) buildPrompt(key string) (string, error) {
	var detail struct {
		Title       string  `json:"title"`
		Description *string `json:"description"`
		Comments    []struct {
			Author *struct {
				Name string `json:"name"`
			} `json:"author"`
			Body string `json:"body"`
		} `json:"comments"`
	}
	if err := c.do("GET", "/api/issues/"+key, nil, &detail); err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "You are an issue agent for the Yesod tracker. Work on issue %s using the yesod MCP tools.\n\n", key)
	fmt.Fprintf(&b, "Title: %s\n", detail.Title)
	if detail.Description != nil && *detail.Description != "" {
		fmt.Fprintf(&b, "Description:\n%s\n", *detail.Description)
	}
	for _, cm := range detail.Comments {
		name := "unknown"
		if cm.Author != nil {
			name = cm.Author.Name
		}
		fmt.Fprintf(&b, "\nComment by %s:\n%s\n", name, cm.Body)
	}
	b.WriteString("\nAnalyze the issue and do what it asks (investigate, answer questions, propose a fix plan). " +
		"When finished, post your findings as a single concise markdown comment on " + key +
		" via the add_comment tool. Do not change the issue status.")
	return b.String(), nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}

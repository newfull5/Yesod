package api

import (
	"database/sql"
	"net/http"
	"strconv"
)

// Agent jobs are a plain SQLite work queue: the web UI enqueues a job for an
// issue, an external runner (a machine with a logged-in coding agent CLI)
// polls for queued jobs, claims one, works the issue via the MCP server and
// reports back. ponytail: polling, no push; fine at single-user scale.

type agentJob struct {
	ID          int64   `json:"id"`
	IssueID     int64   `json:"issue_id"`
	IssueKey    string  `json:"issue_key"`
	Status      string  `json:"status"`
	Result      *string `json:"result"`
	RequestedBy *string `json:"requested_by"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

const agentJobSelect = `SELECT j.id, j.issue_id, i.key, j.status, j.result, j.requested_by, j.created_at, j.updated_at
	FROM agent_jobs j JOIN issues i ON i.id = j.issue_id `

func scanAgentJob(row interface{ Scan(...any) error }) (agentJob, error) {
	var j agentJob
	var result, requestedBy sql.NullString
	err := row.Scan(&j.ID, &j.IssueID, &j.IssueKey, &j.Status, &result, &requestedBy, &j.CreatedAt, &j.UpdatedAt)
	j.Result = nullStr(result)
	j.RequestedBy = nullStr(requestedBy)
	return j, err
}

// latestAgentJob returns the most recent job for an issue, or nil.
func (s *server) latestAgentJob(issueID int64) (*agentJob, error) {
	j, err := scanAgentJob(s.db.QueryRow(agentJobSelect+`WHERE j.issue_id = ? ORDER BY j.id DESC LIMIT 1`, issueID))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

// POST /api/issues/{key}/agent — enqueue a job for the issue.
func (s *server) startAgent(w http.ResponseWriter, r *http.Request) {
	issueID, _, _, ok := s.issueByKey(w, r.PathValue("key"))
	if !ok {
		return
	}
	var req struct {
		RequestedBy *string `json:"requested_by"`
	}
	if r.ContentLength > 0 && !decode(w, r, &req) {
		return
	}
	var one int
	err := s.db.QueryRow(`SELECT 1 FROM agent_jobs WHERE issue_id = ? AND status IN ('queued','running')`, issueID).Scan(&one)
	if err == nil {
		writeErr(w, http.StatusConflict, "an agent job is already queued or running for this issue")
		return
	}
	if err != sql.ErrNoRows {
		dbErr(w, err)
		return
	}
	res, err := s.db.Exec(`INSERT INTO agent_jobs (issue_id, requested_by) VALUES (?, ?)`, issueID, req.RequestedBy)
	if err != nil {
		dbErr(w, err)
		return
	}
	id, _ := res.LastInsertId()
	j, err := scanAgentJob(s.db.QueryRow(agentJobSelect+`WHERE j.id = ?`, id))
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, j)
}

// GET /api/agent/jobs?status=queued — runner poll (and general listing).
func (s *server) listAgentJobs(w http.ResponseWriter, r *http.Request) {
	q := agentJobSelect
	args := []any{}
	if st := r.URL.Query().Get("status"); st != "" {
		q += `WHERE j.status = ? `
		args = append(args, st)
	}
	q += `ORDER BY j.id`
	rows, err := s.db.Query(q, args...)
	if err != nil {
		dbErr(w, err)
		return
	}
	defer rows.Close()
	out := make([]agentJob, 0)
	for rows.Next() {
		j, err := scanAgentJob(rows)
		if err != nil {
			dbErr(w, err)
			return
		}
		out = append(out, j)
	}
	if err := rows.Err(); err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

var validJobStatus = map[string]bool{"queued": true, "running": true, "done": true, "failed": true}

// PATCH /api/agent/jobs/{id} — runner claims (status=running) or finishes
// (status=done/failed, optional result) a job.
func (s *server) patchAgentJob(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid job id")
		return
	}
	var req struct {
		Status string  `json:"status"`
		Result *string `json:"result"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !validJobStatus[req.Status] {
		writeErr(w, http.StatusBadRequest, "status must be one of queued, running, done, failed")
		return
	}
	var res sql.Result
	if req.Status == "running" {
		// Atomic claim: only one runner can move queued -> running.
		res, err = s.db.Exec(`UPDATE agent_jobs SET status = 'running', updated_at = datetime('now')
			WHERE id = ? AND status = 'queued'`, id)
	} else {
		res, err = s.db.Exec(`UPDATE agent_jobs SET status = ?, result = COALESCE(?, result), updated_at = datetime('now')
			WHERE id = ?`, req.Status, req.Result, id)
	}
	if err != nil {
		dbErr(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		if ok, err := s.exists("agent_jobs", id); err != nil {
			dbErr(w, err)
			return
		} else if !ok {
			writeErr(w, http.StatusNotFound, "job not found")
			return
		}
		writeErr(w, http.StatusConflict, "job is not queued (already claimed?)")
		return
	}
	j, err := scanAgentJob(s.db.QueryRow(agentJobSelect+`WHERE j.id = ?`, id))
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, j)
}

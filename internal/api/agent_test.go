package api

import (
	"net/http"
	"testing"
)

func TestAgentJobLifecycle(t *testing.T) {
	h := setup(t)
	wantStatus(t, do(t, h, "POST", "/api/issues", map[string]any{"title": "agent me", "project_id": 1}), http.StatusCreated)

	// enqueue
	rec := do(t, h, "POST", "/api/issues/YS-1/agent", map[string]any{"requested_by": "Saechan"})
	wantStatus(t, rec, http.StatusCreated)
	job := parse[agentJob](t, rec)
	if job.Status != "queued" || job.IssueKey != "YS-1" || job.RequestedBy == nil || *job.RequestedBy != "Saechan" {
		t.Fatalf("unexpected job: %+v", job)
	}

	// only one active job per issue
	wantStatus(t, do(t, h, "POST", "/api/issues/YS-1/agent", nil), http.StatusConflict)

	// runner poll sees it
	jobs := parse[[]agentJob](t, do(t, h, "GET", "/api/agent/jobs?status=queued", nil))
	if len(jobs) != 1 || jobs[0].ID != job.ID {
		t.Fatalf("poll = %+v, want the queued job", jobs)
	}

	// claim is atomic: first wins, second gets 409
	wantStatus(t, do(t, h, "PATCH", "/api/agent/jobs/1", map[string]any{"status": "running"}), http.StatusOK)
	wantStatus(t, do(t, h, "PATCH", "/api/agent/jobs/1", map[string]any{"status": "running"}), http.StatusConflict)

	// append progress log without touching status
	rec = do(t, h, "PATCH", "/api/agent/jobs/1", map[string]any{"log_append": "reading issue\n"})
	wantStatus(t, rec, http.StatusOK)
	rec = do(t, h, "PATCH", "/api/agent/jobs/1", map[string]any{"log_append": "writing comment\n"})
	job = parse[agentJob](t, rec)
	if job.Log == nil || *job.Log != "reading issue\nwriting comment\n" {
		t.Fatalf("log = %v, want appended lines", job.Log)
	}

	// empty patch is a 400
	wantStatus(t, do(t, h, "PATCH", "/api/agent/jobs/1", map[string]any{}), http.StatusBadRequest)

	// finish with a result
	rec = do(t, h, "PATCH", "/api/agent/jobs/1", map[string]any{"status": "done", "result": "commented"})
	wantStatus(t, rec, http.StatusOK)
	job = parse[agentJob](t, rec)
	if job.Status != "done" || job.Result == nil || *job.Result != "commented" {
		t.Fatalf("unexpected finished job: %+v", job)
	}

	// issue detail carries the latest job; a new job can now be queued
	detail := parse[struct {
		AgentJob *agentJob `json:"agent_job"`
	}](t, do(t, h, "GET", "/api/issues/YS-1", nil))
	if detail.AgentJob == nil || detail.AgentJob.Status != "done" {
		t.Fatalf("detail.agent_job = %+v, want done job", detail.AgentJob)
	}
	wantStatus(t, do(t, h, "POST", "/api/issues/YS-1/agent", nil), http.StatusCreated)

	// unknown job / bad status
	wantStatus(t, do(t, h, "PATCH", "/api/agent/jobs/99", map[string]any{"status": "done"}), http.StatusNotFound)
	wantStatus(t, do(t, h, "PATCH", "/api/agent/jobs/1", map[string]any{"status": "nope"}), http.StatusBadRequest)
}

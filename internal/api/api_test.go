package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"

	"github.com/newfull5/yesod/internal/db"
)

// Seed data (see internal/db): project 1 "YS", statuses 1=To Do 2=In Progress
// 3=Done, issue types 1-4, person 1.

func setup(t *testing.T) http.Handler {
	t.Helper()
	t.Setenv("YESOD_PASSWORD", "") // force auth off unless a test opts in
	d, err := db.Open(filepath.Join(t.TempDir(), "yesod.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	mux := http.NewServeMux()
	RegisterRoutes(mux, d)
	return mux
}

func do(t *testing.T, h http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		rd = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, rd)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func parse[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("unmarshal %q: %v", rec.Body.String(), err)
	}
	return v
}

func wantStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status = %d, want %d; body: %s", rec.Code, want, rec.Body.String())
	}
}

type issueResp struct {
	ID     int64  `json:"id"`
	Key    string `json:"key"`
	Title  string `json:"title"`
	Status struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	} `json:"status"`
	Type *struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	} `json:"type"`
	Assignee *struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	} `json:"assignee"`
	Description *string `json:"description"`
	DueDate     *string `json:"due_date"`
	BoardOrder  float64 `json:"board_order"`
	ParentID    *int64  `json:"parent_id"`
	Parent      *struct {
		Key   string `json:"key"`
		Title string `json:"title"`
	} `json:"parent"`
	Sprints []struct {
		ID    int64  `json:"id"`
		Name  string `json:"name"`
		State string `json:"state"`
	} `json:"sprints"`
	Subtasks []struct {
		Key   string `json:"key"`
		Title string `json:"title"`
	} `json:"subtasks"`
	Links    map[string][]struct{ Key, Title string } `json:"links"`
	Comments []struct {
		Body string `json:"body"`
	} `json:"comments"`
}

func createPerson(t *testing.T, h http.Handler, name string) int64 {
	t.Helper()
	rec := do(t, h, "POST", "/api/people", map[string]any{"name": name})
	wantStatus(t, rec, http.StatusCreated)
	return int64(parse[map[string]any](t, rec)["id"].(float64))
}

func createIssue(t *testing.T, h http.Handler, body map[string]any) issueResp {
	t.Helper()
	if _, ok := body["project_id"]; !ok {
		body["project_id"] = 1
	}
	rec := do(t, h, "POST", "/api/issues", body)
	wantStatus(t, rec, http.StatusCreated)
	return parse[issueResp](t, rec)
}

func TestIssueCRUDAndKeySequence(t *testing.T) {
	h := setup(t)

	first := createIssue(t, h, map[string]any{"title": "First issue", "type_id": 2})
	if first.Key != "YS-1" {
		t.Fatalf("first key = %q, want YS-1", first.Key)
	}
	if first.Status.Name != "To Do" {
		t.Errorf("default status = %q, want To Do", first.Status.Name)
	}
	if first.Type == nil || first.Type.Name != "Bug" {
		t.Errorf("type = %+v, want Bug", first.Type)
	}

	second := createIssue(t, h, map[string]any{"title": "Second issue"})
	if second.Key != "YS-2" {
		t.Fatalf("second key = %q, want YS-2", second.Key)
	}
	if second.BoardOrder <= first.BoardOrder {
		t.Errorf("second board_order %v not below first %v", second.BoardOrder, first.BoardOrder)
	}

	// Key numbers are never reused after delete.
	wantStatus(t, do(t, h, "DELETE", "/api/issues/YS-2", nil), http.StatusNoContent)
	wantStatus(t, do(t, h, "GET", "/api/issues/YS-2", nil), http.StatusNotFound)
	third := createIssue(t, h, map[string]any{"title": "Third issue"})
	if third.Key != "YS-3" {
		t.Fatalf("key after delete = %q, want YS-3", third.Key)
	}

	// Invalid creates.
	wantStatus(t, do(t, h, "POST", "/api/issues", map[string]any{"title": "  ", "project_id": 1}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "POST", "/api/issues", map[string]any{"title": "x", "project_id": 999}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "POST", "/api/issues", map[string]any{"title": "x", "project_id": 1, "status_id": 999}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "POST", "/api/issues", map[string]any{"title": "x", "project_id": 1, "type_id": 999}), http.StatusBadRequest)

	// Detail with parent, subtask, link, comment.
	sub := createIssue(t, h, map[string]any{"title": "Subtask", "parent_id": first.ID})
	if sub.Parent == nil || sub.Parent.Key != "YS-1" {
		t.Fatalf("subtask parent = %+v, want YS-1", sub.Parent)
	}
	wantStatus(t, do(t, h, "POST", "/api/issues/YS-1/links", map[string]any{"linked_key": "YS-3", "link_type": "blocks"}), http.StatusCreated)
	wantStatus(t, do(t, h, "POST", "/api/issues/YS-1/links", map[string]any{"linked_key": "YS-3", "link_type": "blocks"}), http.StatusConflict)
	wantStatus(t, do(t, h, "POST", "/api/issues/YS-1/links", map[string]any{"linked_key": "YS-1", "link_type": "blocks"}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "POST", "/api/issues/YS-1/links", map[string]any{"linked_key": "YS-3", "link_type": "nope"}), http.StatusBadRequest)
	author := createPerson(t, h, "Commenter")
	wantStatus(t, do(t, h, "POST", "/api/issues/YS-1/comments", map[string]any{"body": "hello", "author_id": author}), http.StatusCreated)

	rec := do(t, h, "GET", "/api/issues/YS-1", nil)
	wantStatus(t, rec, http.StatusOK)
	detail := parse[issueResp](t, rec)
	if len(detail.Subtasks) != 1 || detail.Subtasks[0].Key != sub.Key {
		t.Errorf("subtasks = %+v, want [%s]", detail.Subtasks, sub.Key)
	}
	if got := detail.Links["blocks"]; len(got) != 1 || got[0].Key != "YS-3" {
		t.Errorf(`links["blocks"] = %+v, want [YS-3]`, got)
	}
	if len(detail.Comments) != 1 || detail.Comments[0].Body != "hello" {
		t.Errorf("comments = %+v, want [hello]", detail.Comments)
	}

	// The link is visible from the far side too, under its inverse type.
	rec = do(t, h, "GET", "/api/issues/YS-3", nil)
	wantStatus(t, rec, http.StatusOK)
	far := parse[issueResp](t, rec)
	if got := far.Links["is blocked by"]; len(got) != 1 || got[0].Key != "YS-1" {
		t.Errorf(`YS-3 links["is blocked by"] = %+v, want [YS-1]`, got)
	}

	// Link delete.
	wantStatus(t, do(t, h, "DELETE", "/api/issues/YS-1/links", map[string]any{"linked_key": "YS-3", "link_type": "blocks"}), http.StatusNoContent)
	wantStatus(t, do(t, h, "DELETE", "/api/issues/YS-1/links", map[string]any{"linked_key": "YS-3", "link_type": "blocks"}), http.StatusNotFound)

	// Deleting a parent orphans the subtask instead of failing.
	wantStatus(t, do(t, h, "DELETE", "/api/issues/YS-1", nil), http.StatusNoContent)
	rec = do(t, h, "GET", "/api/issues/"+sub.Key, nil)
	wantStatus(t, rec, http.StatusOK)
	if got := parse[issueResp](t, rec); got.ParentID != nil {
		t.Errorf("orphaned subtask parent_id = %v, want null", *got.ParentID)
	}
}

type boardResp struct {
	Columns []struct {
		ID     int64  `json:"id"`
		Name   string `json:"name"`
		Issues []struct {
			Key string `json:"key"`
		} `json:"issues"`
	} `json:"columns"`
}

func columnKeys(t *testing.T, h http.Handler, statusID int64) []string {
	t.Helper()
	rec := do(t, h, "GET", "/api/board?project_id=1", nil)
	wantStatus(t, rec, http.StatusOK)
	board := parse[boardResp](t, rec)
	for _, col := range board.Columns {
		if col.ID == statusID {
			keys := make([]string, len(col.Issues))
			for i, is := range col.Issues {
				keys[i] = is.Key
			}
			return keys
		}
	}
	t.Fatalf("status %d not on board", statusID)
	return nil
}

func TestPositionEndpoint(t *testing.T) {
	h := setup(t)
	for _, title := range []string{"a", "b", "c"} {
		createIssue(t, h, map[string]any{"title": title}) // YS-1..YS-3 in To Do (1)
	}

	// Move YS-3 to In Progress (2), no after_key -> top of (empty) column.
	rec := do(t, h, "PATCH", "/api/issues/YS-3/position", map[string]any{"status_id": 2})
	wantStatus(t, rec, http.StatusOK)
	moved := parse[map[string]any](t, rec)
	if moved["status_id"].(float64) != 2 {
		t.Fatalf("moved status = %v, want 2", moved["status_id"])
	}

	// Move YS-1 after YS-3 within In Progress.
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-1/position", map[string]any{"status_id": 2, "after_key": "YS-3"}), http.StatusOK)
	if got := columnKeys(t, h, 2); len(got) != 2 || got[0] != "YS-3" || got[1] != "YS-1" {
		t.Fatalf("in-progress order = %v, want [YS-3 YS-1]", got)
	}

	// Insert YS-2 between them (after YS-3) -> midpoint.
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-2/position", map[string]any{"status_id": 2, "after_key": "YS-3"}), http.StatusOK)
	if got := columnKeys(t, h, 2); len(got) != 3 || got[0] != "YS-3" || got[1] != "YS-2" || got[2] != "YS-1" {
		t.Fatalf("in-progress order = %v, want [YS-3 YS-2 YS-1]", got)
	}
	if got := columnKeys(t, h, 1); len(got) != 0 {
		t.Fatalf("to-do column = %v, want empty", got)
	}

	// Move to top: YS-1 with no after_key goes first.
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-1/position", map[string]any{"status_id": 2}), http.StatusOK)
	if got := columnKeys(t, h, 2); got[0] != "YS-1" {
		t.Fatalf("after top move order = %v, want YS-1 first", got)
	}

	// Invalid input.
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-1/position", map[string]any{"status_id": 999}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-1/position", map[string]any{"status_id": 2, "after_key": "YS-99"}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-1/position", map[string]any{"status_id": 1, "after_key": "YS-2"}), http.StatusBadRequest) // YS-2 not in status 1
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-99/position", map[string]any{"status_id": 1}), http.StatusNotFound)
}

func TestPartialPatch(t *testing.T) {
	h := setup(t)
	assignee := createPerson(t, h, "Assignee")
	createIssue(t, h, map[string]any{"title": "Patch me", "assignee_id": assignee, "description": "keep me"})

	// Create a sprint for sprint_ids replace.
	rec := do(t, h, "POST", "/api/sprints", map[string]any{"project_id": 1, "name": "Sprint 1"})
	wantStatus(t, rec, http.StatusCreated)
	sprintID := int64(parse[map[string]any](t, rec)["id"].(float64))

	// Patch only the title: other fields must survive.
	rec = do(t, h, "PATCH", "/api/issues/YS-1", map[string]any{"title": "Renamed"})
	wantStatus(t, rec, http.StatusOK)
	got := parse[issueResp](t, rec)
	if got.Title != "Renamed" {
		t.Errorf("title = %q, want Renamed", got.Title)
	}
	if got.Assignee == nil || got.Assignee.ID != assignee {
		t.Errorf("assignee lost on partial patch: %+v", got.Assignee)
	}
	if got.Description == nil || *got.Description != "keep me" {
		t.Errorf("description lost on partial patch: %v", got.Description)
	}

	// Null clears nullable fields.
	rec = do(t, h, "PATCH", "/api/issues/YS-1", map[string]any{"assignee_id": nil, "description": nil})
	wantStatus(t, rec, http.StatusOK)
	got = parse[issueResp](t, rec)
	if got.Assignee != nil || got.Description != nil {
		t.Errorf("null patch did not clear: assignee=%+v description=%v", got.Assignee, got.Description)
	}

	// sprint_ids replaces the whole set.
	rec = do(t, h, "PATCH", "/api/issues/YS-1", map[string]any{"sprint_ids": []int64{sprintID}})
	wantStatus(t, rec, http.StatusOK)
	got = parse[issueResp](t, rec)
	if len(got.Sprints) != 1 || got.Sprints[0].ID != sprintID {
		t.Fatalf("sprints = %+v, want [%d]", got.Sprints, sprintID)
	}
	rec = do(t, h, "PATCH", "/api/issues/YS-1", map[string]any{"sprint_ids": []int64{}})
	wantStatus(t, rec, http.StatusOK)
	if got = parse[issueResp](t, rec); len(got.Sprints) != 0 {
		t.Fatalf("sprints after replace with [] = %+v, want empty", got.Sprints)
	}

	// status_id change moves the card to the bottom of the new column.
	rec = do(t, h, "PATCH", "/api/issues/YS-1", map[string]any{"status_id": 3})
	wantStatus(t, rec, http.StatusOK)
	if got = parse[issueResp](t, rec); got.Status.ID != 3 {
		t.Errorf("status = %d, want 3", got.Status.ID)
	}

	// Validation errors.
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-1", map[string]any{"title": ""}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-1", map[string]any{"status_id": 999}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-1", map[string]any{"assignee_id": 999}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-1", map[string]any{"due_date": "not-a-date"}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-1", map[string]any{}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-99", map[string]any{"title": "x"}), http.StatusNotFound)
}

func TestFilters(t *testing.T) {
	h := setup(t)
	alice := createPerson(t, h, "Alice")
	bob := createPerson(t, h, "Bob")
	rec := do(t, h, "POST", "/api/sprints", map[string]any{"project_id": 1, "name": "Sprint 1"})
	wantStatus(t, rec, http.StatusCreated)
	sprintID := int64(parse[map[string]any](t, rec)["id"].(float64))

	createIssue(t, h, map[string]any{"title": "Fix login bug", "type_id": 2, "assignee_id": alice, "sprint_ids": []int64{sprintID}})
	createIssue(t, h, map[string]any{"title": "Write docs", "type_id": 3, "assignee_id": bob})
	createIssue(t, h, map[string]any{"title": "Login page polish", "type_id": 1, "status_id": 2})

	cases := []struct {
		query string
		want  []string
	}{
		{"?q=login", []string{"YS-1", "YS-3"}},
		{"?assignee=" + itoa(alice), []string{"YS-1"}},
		{"?type=3", []string{"YS-2"}},
		{"?status=2", []string{"YS-3"}},
		{"?sprint=" + itoa(sprintID), []string{"YS-1"}},
		{"?project_id=1&q=docs", []string{"YS-2"}},
		{"", []string{"YS-1", "YS-2", "YS-3"}},
	}
	for _, tc := range cases {
		rec := do(t, h, "GET", "/api/issues"+tc.query, nil)
		wantStatus(t, rec, http.StatusOK)
		issues := parse[[]issueResp](t, rec)
		keys := make([]string, len(issues))
		for i, is := range issues {
			keys[i] = is.Key
		}
		if len(keys) != len(tc.want) {
			t.Errorf("filter %q -> %v, want %v", tc.query, keys, tc.want)
			continue
		}
		for i := range keys {
			if keys[i] != tc.want[i] {
				t.Errorf("filter %q -> %v, want %v", tc.query, keys, tc.want)
				break
			}
		}
	}
	wantStatus(t, do(t, h, "GET", "/api/issues?status=abc", nil), http.StatusBadRequest)
}

func itoa(v int64) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestComments(t *testing.T) {
	h := setup(t)
	author := createPerson(t, h, "Commenter")
	createIssue(t, h, map[string]any{"title": "Discuss"})

	rec := do(t, h, "POST", "/api/issues/YS-1/comments", map[string]any{"body": "first", "author_id": author})
	wantStatus(t, rec, http.StatusCreated)
	c := parse[map[string]any](t, rec)
	if a, _ := c["author"].(map[string]any); a == nil || a["name"] != "Commenter" {
		t.Errorf("comment author = %v, want Commenter", c["author"])
	}
	wantStatus(t, do(t, h, "POST", "/api/issues/YS-1/comments", map[string]any{"body": "anonymous"}), http.StatusCreated)

	wantStatus(t, do(t, h, "POST", "/api/issues/YS-1/comments", map[string]any{"body": " "}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "POST", "/api/issues/YS-1/comments", map[string]any{"body": "x", "author_id": 999}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "POST", "/api/issues/YS-99/comments", map[string]any{"body": "x"}), http.StatusNotFound)

	rec = do(t, h, "GET", "/api/issues/YS-1/comments", nil)
	wantStatus(t, rec, http.StatusOK)
	list := parse[[]map[string]any](t, rec)
	if len(list) != 2 {
		t.Fatalf("comments = %d, want 2", len(list))
	}
	if list[0]["body"] != "first" || list[0]["created_at"] == "" {
		t.Errorf("first comment = %v", list[0])
	}
	if list[1]["author"] != nil {
		t.Errorf("anonymous comment author = %v, want null", list[1]["author"])
	}

	id := int64(list[0]["id"].(float64))

	rec = do(t, h, "PATCH", fmt.Sprintf("/api/issues/YS-1/comments/%d", id), map[string]any{"body": "edited"})
	wantStatus(t, rec, http.StatusOK)
	c = parse[map[string]any](t, rec)
	if c["body"] != "edited" {
		t.Errorf("edited comment body = %v, want edited", c["body"])
	}

	wantStatus(t, do(t, h, "PATCH", fmt.Sprintf("/api/issues/YS-1/comments/%d", id), map[string]any{"body": " "}), http.StatusBadRequest)
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-1/comments/999", map[string]any{"body": "x"}), http.StatusNotFound)
	wantStatus(t, do(t, h, "PATCH", "/api/issues/YS-99/comments/1", map[string]any{"body": "x"}), http.StatusNotFound)

	wantStatus(t, do(t, h, "DELETE", "/api/issues/YS-1/comments/999", nil), http.StatusNotFound)
	wantStatus(t, do(t, h, "DELETE", fmt.Sprintf("/api/issues/YS-1/comments/%d", id), nil), http.StatusNoContent)

	rec = do(t, h, "GET", "/api/issues/YS-1/comments", nil)
	list = parse[[]map[string]any](t, rec)
	if len(list) != 1 {
		t.Fatalf("comments after delete = %d, want 1", len(list))
	}
}

// Regression test for the board_order race: concurrent position/status
// changes into the same column must never compute the same board_order
// (see internal/api/issues.go positionIssue/patchIssue).
func TestConcurrentMovesNeverDuplicateBoardOrder(t *testing.T) {
	h := setup(t)
	const n = 8
	for i := 0; i < n; i++ {
		createIssue(t, h, map[string]any{"title": fmt.Sprintf("issue %d", i)}) // YS-1..YS-n in To Do (1)
	}

	var wg sync.WaitGroup
	for i := 1; i <= n; i++ {
		wg.Add(1)
		key := fmt.Sprintf("YS-%d", i)
		go func(key string) {
			defer wg.Done()
			// Split across the two write paths that both place a card at the
			// bottom of a column: PATCH .../position and PATCH status_id.
			var rec *httptest.ResponseRecorder
			if key == "YS-1" || key == "YS-3" {
				rec = do(t, h, "PATCH", "/api/issues/"+key, map[string]any{"status_id": 2})
			} else {
				rec = do(t, h, "PATCH", "/api/issues/"+key+"/position", map[string]any{"status_id": 2})
			}
			if rec.Code != http.StatusOK {
				t.Errorf("move %s: status = %d, body: %s", key, rec.Code, rec.Body.String())
			}
		}(key)
	}
	wg.Wait()

	rec := do(t, h, "GET", "/api/board?project_id=1", nil)
	wantStatus(t, rec, http.StatusOK)
	var board struct {
		Columns []struct {
			ID     int64 `json:"id"`
			Issues []struct {
				Key        string  `json:"key"`
				BoardOrder float64 `json:"board_order"`
			} `json:"issues"`
		} `json:"columns"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &board); err != nil {
		t.Fatalf("unmarshal board: %v", err)
	}
	for _, col := range board.Columns {
		if col.ID != 2 {
			continue
		}
		if len(col.Issues) != n {
			t.Fatalf("column has %d issues, want %d: %+v", len(col.Issues), n, col.Issues)
		}
		seen := map[float64]string{}
		for _, is := range col.Issues {
			if other, dup := seen[is.BoardOrder]; dup {
				t.Fatalf("duplicate board_order %v: %s and %s", is.BoardOrder, other, is.Key)
			}
			seen[is.BoardOrder] = is.Key
		}
	}
}

func TestAuthDisabled(t *testing.T) {
	h := setup(t)
	wantStatus(t, do(t, h, "GET", "/api/projects", nil), http.StatusOK)
}

func TestAuthEnabled(t *testing.T) {
	t.Setenv("YESOD_PASSWORD", "hunter2")
	d, err := db.Open(filepath.Join(t.TempDir(), "yesod.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	h := http.NewServeMux()
	RegisterRoutes(h, d)

	wantStatus(t, do(t, h, "GET", "/api/projects", nil), http.StatusUnauthorized)
	wantStatus(t, do(t, h, "POST", "/api/login", map[string]any{"password": "wrong"}), http.StatusUnauthorized)

	rec := do(t, h, "POST", "/api/login", map[string]any{"password": "hunter2"})
	wantStatus(t, rec, http.StatusOK)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "yesod_session" || !cookies[0].HttpOnly {
		t.Fatalf("cookies = %+v, want one HttpOnly yesod_session", cookies)
	}

	req := httptest.NewRequest("GET", "/api/projects", nil)
	req.AddCookie(cookies[0])
	authed := httptest.NewRecorder()
	h.ServeHTTP(authed, req)
	wantStatus(t, authed, http.StatusOK)

	req = httptest.NewRequest("GET", "/api/projects", nil)
	req.AddCookie(&http.Cookie{Name: "yesod_session", Value: "forged"})
	forged := httptest.NewRecorder()
	h.ServeHTTP(forged, req)
	wantStatus(t, forged, http.StatusUnauthorized)
}

func TestClearDoneColumn(t *testing.T) {
	h := setup(t)

	done := createIssue(t, h, map[string]any{"title": "shipped", "status_id": 3})
	kept := createIssue(t, h, map[string]any{"title": "still todo", "status_id": 1})

	// Only done-category columns can be cleared.
	wantStatus(t, do(t, h, "POST", "/api/statuses/1/clear", nil), http.StatusBadRequest)
	wantStatus(t, do(t, h, "POST", "/api/statuses/999/clear", nil), http.StatusNotFound)

	rec := do(t, h, "POST", "/api/statuses/3/clear", nil)
	wantStatus(t, rec, http.StatusOK)
	if n := parse[map[string]int64](t, rec)["archived"]; n != 1 {
		t.Fatalf("archived = %d, want 1", n)
	}

	// Board no longer shows the archived issue; the todo one is untouched.
	board := parse[struct {
		Columns []struct {
			ID     int64 `json:"id"`
			Issues []struct {
				Key string `json:"key"`
			} `json:"issues"`
		} `json:"columns"`
	}](t, do(t, h, "GET", "/api/board?project_id=1", nil))
	for _, col := range board.Columns {
		for _, is := range col.Issues {
			if is.Key == done.Key {
				t.Errorf("archived issue %s still on board", done.Key)
			}
		}
	}

	// The issue itself survives with its history, flagged archived.
	detail := parse[map[string]any](t, do(t, h, "GET", "/api/issues/"+done.Key, nil))
	if detail["archived_at"] == nil {
		t.Errorf("archived_at not set on %s", done.Key)
	}
	if kd := parse[map[string]any](t, do(t, h, "GET", "/api/issues/"+kept.Key, nil)); kd["archived_at"] != nil {
		t.Errorf("todo issue %s unexpectedly archived", kept.Key)
	}

	// Restore via PATCH archived:false puts it back on the board.
	wantStatus(t, do(t, h, "PATCH", "/api/issues/"+done.Key, map[string]any{"archived": false}), http.StatusOK)
	detail = parse[map[string]any](t, do(t, h, "GET", "/api/issues/"+done.Key, nil))
	if detail["archived_at"] != nil {
		t.Errorf("archived_at still set after restore")
	}
}

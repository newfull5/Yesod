package api

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
)

// --- projects ---

type project struct {
	ID           int64  `json:"id"`
	KeyPrefix    string `json:"key_prefix"`
	Name         string `json:"name"`
	NextIssueNum int64  `json:"next_issue_num"`
}

func (s *server) listProjects(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT id, key_prefix, name, next_issue_num FROM projects ORDER BY id`)
	if err != nil {
		dbErr(w, err)
		return
	}
	defer rows.Close()
	out := make([]project, 0)
	for rows.Next() {
		var p project
		if err := rows.Scan(&p.ID, &p.KeyPrefix, &p.Name, &p.NextIssueNum); err != nil {
			dbErr(w, err)
			return
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) createProject(w http.ResponseWriter, r *http.Request) {
	var req struct {
		KeyPrefix string `json:"key_prefix"`
		Name      string `json:"name"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.KeyPrefix = strings.ToUpper(strings.TrimSpace(req.KeyPrefix))
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.KeyPrefix == "" || strings.ContainsAny(req.KeyPrefix, "- \t") {
		writeErr(w, http.StatusBadRequest, "key_prefix must be non-empty without spaces or dashes")
		return
	}
	res, err := s.db.Exec(`INSERT INTO projects (key_prefix, name) VALUES (?, ?)`, req.KeyPrefix, req.Name)
	if err != nil {
		dbErr(w, err) // UNIQUE key_prefix -> 409
		return
	}
	id, err := res.LastInsertId()
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, project{ID: id, KeyPrefix: req.KeyPrefix, Name: req.Name, NextIssueNum: 1})
}

// projectIDParam parses a required ?project_id= and verifies the project exists.
func (s *server) projectIDParam(w http.ResponseWriter, r *http.Request) (int64, bool) {
	raw := r.URL.Query().Get("project_id")
	if raw == "" {
		writeErr(w, http.StatusBadRequest, "project_id query parameter is required")
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid project_id")
		return 0, false
	}
	if exists, err := s.exists("projects", id); err != nil {
		dbErr(w, err)
		return 0, false
	} else if !exists {
		writeErr(w, http.StatusNotFound, "project not found")
		return 0, false
	}
	return id, true
}

// --- board ---

type boardColumn struct {
	ID         int64       `json:"id"`
	Name       string      `json:"name"`
	Category   string      `json:"category"`
	BoardOrder int64       `json:"board_order"`
	Issues     []issueCard `json:"issues"`
}

func (s *server) board(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.projectIDParam(w, r)
	if !ok {
		return
	}
	rows, err := s.db.Query(`SELECT id, name, category, board_order FROM statuses WHERE project_id = ? ORDER BY board_order, id`, projectID)
	if err != nil {
		dbErr(w, err)
		return
	}
	defer rows.Close()
	columns := make([]boardColumn, 0)
	index := map[int64]int{}
	for rows.Next() {
		var c boardColumn
		if err := rows.Scan(&c.ID, &c.Name, &c.Category, &c.BoardOrder); err != nil {
			dbErr(w, err)
			return
		}
		c.Issues = make([]issueCard, 0)
		index[c.ID] = len(columns)
		columns = append(columns, c)
	}
	if err := rows.Err(); err != nil {
		dbErr(w, err)
		return
	}
	cards, err := s.queryCards("WHERE i.project_id = ? AND i.archived_at IS NULL", "ORDER BY i.board_order, i.id", projectID)
	if err != nil {
		dbErr(w, err)
		return
	}
	for _, card := range cards {
		if i, found := index[card.Status.ID]; found {
			columns[i].Issues = append(columns[i].Issues, card)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"columns": columns})
}

// --- sprints ---

type sprint struct {
	ID        int64   `json:"id"`
	ProjectID int64   `json:"project_id"`
	Name      string  `json:"name"`
	StartDate *string `json:"start_date"`
	EndDate   *string `json:"end_date"`
	State     string  `json:"state"`
}

var validSprintStates = map[string]bool{"future": true, "active": true, "closed": true}

func (s *server) sprintByID(id int64) (*sprint, error) {
	var sp sprint
	var start, end sql.NullString
	err := s.db.QueryRow(`SELECT id, project_id, name, start_date, end_date, state FROM sprints WHERE id = ?`, id).
		Scan(&sp.ID, &sp.ProjectID, &sp.Name, &start, &end, &sp.State)
	if err != nil {
		return nil, err
	}
	sp.StartDate = nullStr(start)
	sp.EndDate = nullStr(end)
	return &sp, nil
}

func (s *server) listSprints(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.projectIDParam(w, r)
	if !ok {
		return
	}
	rows, err := s.db.Query(`SELECT id, project_id, name, start_date, end_date, state FROM sprints WHERE project_id = ? ORDER BY id`, projectID)
	if err != nil {
		dbErr(w, err)
		return
	}
	defer rows.Close()
	out := make([]sprint, 0)
	for rows.Next() {
		var sp sprint
		var start, end sql.NullString
		if err := rows.Scan(&sp.ID, &sp.ProjectID, &sp.Name, &start, &end, &sp.State); err != nil {
			dbErr(w, err)
			return
		}
		sp.StartDate = nullStr(start)
		sp.EndDate = nullStr(end)
		out = append(out, sp)
	}
	if err := rows.Err(); err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) createSprint(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectID int64   `json:"project_id"`
		Name      string  `json:"name"`
		StartDate *string `json:"start_date"`
		EndDate   *string `json:"end_date"`
		State     *string `json:"state"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if exists, err := s.exists("projects", req.ProjectID); err != nil {
		dbErr(w, err)
		return
	} else if !exists {
		writeErr(w, http.StatusBadRequest, "unknown project_id")
		return
	}
	state := "future"
	if req.State != nil {
		if !validSprintStates[*req.State] {
			writeErr(w, http.StatusBadRequest, `state must be one of "future", "active", "closed"`)
			return
		}
		state = *req.State
	}
	for _, dt := range []struct {
		v     *string
		field string
	}{{req.StartDate, "start_date"}, {req.EndDate, "end_date"}} {
		if dt.v != nil && !validDate(*dt.v) {
			writeErr(w, http.StatusBadRequest, dt.field+" must be YYYY-MM-DD")
			return
		}
	}
	res, err := s.db.Exec(`INSERT INTO sprints (project_id, name, start_date, end_date, state) VALUES (?, ?, ?, ?, ?)`,
		req.ProjectID, req.Name, req.StartDate, req.EndDate, state)
	if err != nil {
		dbErr(w, err)
		return
	}
	id, err := res.LastInsertId()
	if err != nil {
		dbErr(w, err)
		return
	}
	sp, err := s.sprintByID(id)
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, sp)
}

func (s *server) patchSprint(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid sprint id")
		return
	}
	if exists, err := s.exists("sprints", id); err != nil {
		dbErr(w, err)
		return
	} else if !exists {
		writeErr(w, http.StatusNotFound, "sprint not found")
		return
	}
	var body map[string]any
	if !decode(w, r, &body) {
		return
	}
	sets := make([]string, 0, 4)
	args := make([]any, 0, 4)
	if v, present := body["name"]; present {
		name, isStr := v.(string)
		name = strings.TrimSpace(name)
		if !isStr || name == "" {
			writeErr(w, http.StatusBadRequest, "name must be a non-empty string")
			return
		}
		sets = append(sets, "name = ?")
		args = append(args, name)
	}
	if v, present := body["state"]; present {
		state, isStr := v.(string)
		if !isStr || !validSprintStates[state] {
			writeErr(w, http.StatusBadRequest, `state must be one of "future", "active", "closed"`)
			return
		}
		sets = append(sets, "state = ?")
		args = append(args, state)
	}
	for _, f := range []string{"start_date", "end_date"} {
		v, present := body[f]
		if !present {
			continue
		}
		if v == nil {
			sets = append(sets, f+" = NULL")
			continue
		}
		str, isStr := v.(string)
		if !isStr || !validDate(str) {
			writeErr(w, http.StatusBadRequest, f+" must be YYYY-MM-DD or null")
			return
		}
		sets = append(sets, f+" = ?")
		args = append(args, str)
	}
	if len(sets) == 0 {
		writeErr(w, http.StatusBadRequest, "no updatable fields in request body")
		return
	}
	args = append(args, id)
	if _, err := s.db.Exec("UPDATE sprints SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		dbErr(w, err)
		return
	}
	sp, err := s.sprintByID(id)
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sp)
}

// --- people ---

func (s *server) listPeople(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT id, name, avatar_color FROM people ORDER BY id`)
	if err != nil {
		dbErr(w, err)
		return
	}
	defer rows.Close()
	out := make([]personRef, 0)
	for rows.Next() {
		var p personRef
		var color sql.NullString
		if err := rows.Scan(&p.ID, &p.Name, &color); err != nil {
			dbErr(w, err)
			return
		}
		p.AvatarColor = nullStr(color)
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) createPerson(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name        string  `json:"name"`
		AvatarColor *string `json:"avatar_color"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	res, err := s.db.Exec(`INSERT INTO people (name, avatar_color) VALUES (?, ?)`, req.Name, req.AvatarColor)
	if err != nil {
		dbErr(w, err)
		return
	}
	id, err := res.LastInsertId()
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, personRef{ID: id, Name: req.Name, AvatarColor: req.AvatarColor})
}

// --- teams ---

func (s *server) listTeams(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT id, name FROM teams ORDER BY id`)
	if err != nil {
		dbErr(w, err)
		return
	}
	defer rows.Close()
	out := make([]ref, 0)
	for rows.Next() {
		var t ref
		if err := rows.Scan(&t.ID, &t.Name); err != nil {
			dbErr(w, err)
			return
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) createTeam(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	res, err := s.db.Exec(`INSERT INTO teams (name) VALUES (?)`, req.Name)
	if err != nil {
		dbErr(w, err)
		return
	}
	id, err := res.LastInsertId()
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, ref{ID: id, Name: req.Name})
}

// --- statuses ---

type status struct {
	ID         int64  `json:"id"`
	ProjectID  int64  `json:"project_id"`
	Name       string `json:"name"`
	Category   string `json:"category"`
	BoardOrder int64  `json:"board_order"`
}

var validCategories = map[string]bool{"todo": true, "in_progress": true, "done": true}

func (s *server) listStatuses(w http.ResponseWriter, r *http.Request) {
	projectID, ok := s.projectIDParam(w, r)
	if !ok {
		return
	}
	rows, err := s.db.Query(`SELECT id, project_id, name, category, board_order FROM statuses WHERE project_id = ? ORDER BY board_order, id`, projectID)
	if err != nil {
		dbErr(w, err)
		return
	}
	defer rows.Close()
	out := make([]status, 0)
	for rows.Next() {
		var st status
		if err := rows.Scan(&st.ID, &st.ProjectID, &st.Name, &st.Category, &st.BoardOrder); err != nil {
			dbErr(w, err)
			return
		}
		out = append(out, st)
	}
	if err := rows.Err(); err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *server) createStatus(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectID  int64  `json:"project_id"`
		Name       string `json:"name"`
		Category   string `json:"category"`
		BoardOrder *int64 `json:"board_order"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeErr(w, http.StatusBadRequest, "name is required")
		return
	}
	if !validCategories[req.Category] {
		writeErr(w, http.StatusBadRequest, `category must be one of "todo", "in_progress", "done"`)
		return
	}
	if exists, err := s.exists("projects", req.ProjectID); err != nil {
		dbErr(w, err)
		return
	} else if !exists {
		writeErr(w, http.StatusBadRequest, "unknown project_id")
		return
	}
	order := int64(0)
	if req.BoardOrder != nil {
		order = *req.BoardOrder
	} else if err := s.db.QueryRow(`SELECT COALESCE(MAX(board_order), 0) + 1 FROM statuses WHERE project_id = ?`, req.ProjectID).Scan(&order); err != nil {
		dbErr(w, err)
		return
	}
	res, err := s.db.Exec(`INSERT INTO statuses (project_id, name, category, board_order) VALUES (?, ?, ?, ?)`,
		req.ProjectID, req.Name, req.Category, order)
	if err != nil {
		dbErr(w, err)
		return
	}
	id, err := res.LastInsertId()
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, status{ID: id, ProjectID: req.ProjectID, Name: req.Name, Category: req.Category, BoardOrder: order})
}

// clearStatus archives every issue in a done-category column: the cards leave
// the board but stay in the database (visible in the backlog's Archive section).
func (s *server) clearStatus(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid status id")
		return
	}
	var category string
	switch err := s.db.QueryRow(`SELECT category FROM statuses WHERE id = ?`, id).Scan(&category); {
	case err == sql.ErrNoRows:
		writeErr(w, http.StatusNotFound, "unknown status id")
		return
	case err != nil:
		dbErr(w, err)
		return
	}
	if category != "done" {
		writeErr(w, http.StatusBadRequest, "only done columns can be cleared")
		return
	}
	res, err := s.db.Exec(`UPDATE issues SET archived_at = datetime('now'), updated_at = datetime('now')
		WHERE status_id = ? AND archived_at IS NULL`, id)
	if err != nil {
		dbErr(w, err)
		return
	}
	n, _ := res.RowsAffected()
	writeJSON(w, http.StatusOK, map[string]int64{"archived": n})
}

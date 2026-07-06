package api

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"

	"github.com/newfull5/yesod/internal/db"
)

// --- JSON shapes ---

type ref struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type typeRef struct {
	ID   int64   `json:"id"`
	Name string  `json:"name"`
	Icon *string `json:"icon"`
}

type statusRef struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"`
}

type personRef struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	AvatarColor *string `json:"avatar_color"`
}

// issueCard is the list/board item shape.
type issueCard struct {
	ID         int64      `json:"id"`
	Key        string     `json:"key"`
	ProjectID  int64      `json:"project_id"`
	Title      string     `json:"title"`
	Type       *typeRef   `json:"type"`
	Status     statusRef  `json:"status"`
	Assignee   *personRef `json:"assignee"`
	ParentID   *int64     `json:"parent_id"`
	StartDate  *string    `json:"start_date"`
	DueDate    *string    `json:"due_date"`
	BoardOrder float64    `json:"board_order"`
	SprintIDs  []int64    `json:"sprint_ids"`
	ArchivedAt *string    `json:"archived_at"`
	CreatedAt  string     `json:"created_at"`
	UpdatedAt  string     `json:"updated_at"`
}

type parentRef struct {
	Key   string `json:"key"`
	Title string `json:"title"`
}

type subtask struct {
	Key    string    `json:"key"`
	Title  string    `json:"title"`
	Status statusRef `json:"status"`
}

type linkTarget struct {
	Key   string `json:"key"`
	Title string `json:"title"`
}

type sprintRef struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	State string `json:"state"`
}

type comment struct {
	ID        int64  `json:"id"`
	Author    *ref   `json:"author"`
	Body      string `json:"body"`
	CreatedAt string `json:"created_at"`
}

type issueDetail struct {
	issueCard
	Description *string                 `json:"description"`
	Reporter    *personRef              `json:"reporter"`
	Team        *ref                    `json:"team"`
	Parent      *parentRef              `json:"parent"`
	Sprints     []sprintRef             `json:"sprints"`
	Subtasks    []subtask               `json:"subtasks"`
	Links       map[string][]linkTarget `json:"links"`
	Comments    []comment               `json:"comments"`
}

var validLinkTypes = map[string]bool{"blocks": true, "is blocked by": true, "relates to": true}

// --- queries ---

const cardSelect = `SELECT i.id, i.key, i.project_id, i.title,
	i.type_id, t.name, t.icon,
	i.status_id, st.name, st.category,
	i.assignee_id, a.name, a.avatar_color,
	i.parent_id, i.start_date, i.due_date, i.board_order,
	(SELECT group_concat(sprint_id) FROM issue_sprints WHERE issue_id = i.id) AS sprint_ids,
	i.archived_at, i.created_at, i.updated_at
	FROM issues i
	JOIN statuses st ON st.id = i.status_id
	LEFT JOIN issue_types t ON t.id = i.type_id
	LEFT JOIN people a ON a.id = i.assignee_id `

// parseIDList parses a group_concat(id) column ("3,7,9") into []int64.
func parseIDList(s sql.NullString) []int64 {
	out := make([]int64, 0)
	if !s.Valid || s.String == "" {
		return out
	}
	for _, part := range strings.Split(s.String, ",") {
		if id, err := strconv.ParseInt(part, 10, 64); err == nil {
			out = append(out, id)
		}
	}
	return out
}

func (s *server) queryCards(where, order string, args ...any) ([]issueCard, error) {
	rows, err := s.db.Query(cardSelect+where+" "+order, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := make([]issueCard, 0)
	for rows.Next() {
		var c issueCard
		var typeID, assigneeID, parentID sql.NullInt64
		var typeName, typeIcon, aName, aColor, startDate, dueDate, sprintIDs, archivedAt sql.NullString
		var bo sql.NullFloat64
		if err := rows.Scan(&c.ID, &c.Key, &c.ProjectID, &c.Title,
			&typeID, &typeName, &typeIcon,
			&c.Status.ID, &c.Status.Name, &c.Status.Category,
			&assigneeID, &aName, &aColor,
			&parentID, &startDate, &dueDate, &bo, &sprintIDs, &archivedAt, &c.CreatedAt, &c.UpdatedAt); err != nil {
			return nil, err
		}
		if typeID.Valid {
			c.Type = &typeRef{typeID.Int64, typeName.String, nullStr(typeIcon)}
		}
		if assigneeID.Valid {
			c.Assignee = &personRef{assigneeID.Int64, aName.String, nullStr(aColor)}
		}
		c.ParentID = nullInt(parentID)
		c.StartDate = nullStr(startDate)
		c.DueDate = nullStr(dueDate)
		c.BoardOrder = bo.Float64
		c.SprintIDs = parseIDList(sprintIDs)
		c.ArchivedAt = nullStr(archivedAt)
		cards = append(cards, c)
	}
	return cards, rows.Err()
}

func (s *server) getIssueDetail(key string) (*issueDetail, error) {
	var d issueDetail
	var typeID, assigneeID, reporterID, teamID, parentID sql.NullInt64
	var typeName, typeIcon, aName, aColor, rName, rColor, teamName sql.NullString
	var pKey, pTitle, desc, startDate, dueDate, archivedAt sql.NullString
	var bo sql.NullFloat64
	err := s.db.QueryRow(`SELECT i.id, i.key, i.project_id, i.title, i.description,
		i.type_id, t.name, t.icon,
		i.status_id, st.name, st.category,
		i.assignee_id, a.name, a.avatar_color,
		i.reporter_id, rp.name, rp.avatar_color,
		i.team_id, tm.name,
		i.parent_id, p.key, p.title,
		i.start_date, i.due_date, i.board_order, i.archived_at, i.created_at, i.updated_at
		FROM issues i
		JOIN statuses st ON st.id = i.status_id
		LEFT JOIN issue_types t ON t.id = i.type_id
		LEFT JOIN people a ON a.id = i.assignee_id
		LEFT JOIN people rp ON rp.id = i.reporter_id
		LEFT JOIN teams tm ON tm.id = i.team_id
		LEFT JOIN issues p ON p.id = i.parent_id
		WHERE i.key = ?`, key).Scan(
		&d.ID, &d.Key, &d.ProjectID, &d.Title, &desc,
		&typeID, &typeName, &typeIcon,
		&d.Status.ID, &d.Status.Name, &d.Status.Category,
		&assigneeID, &aName, &aColor,
		&reporterID, &rName, &rColor,
		&teamID, &teamName,
		&parentID, &pKey, &pTitle,
		&startDate, &dueDate, &bo, &archivedAt, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	d.Description = nullStr(desc)
	if typeID.Valid {
		d.Type = &typeRef{typeID.Int64, typeName.String, nullStr(typeIcon)}
	}
	if assigneeID.Valid {
		d.Assignee = &personRef{assigneeID.Int64, aName.String, nullStr(aColor)}
	}
	if reporterID.Valid {
		d.Reporter = &personRef{reporterID.Int64, rName.String, nullStr(rColor)}
	}
	if teamID.Valid {
		d.Team = &ref{teamID.Int64, teamName.String}
	}
	d.ParentID = nullInt(parentID)
	if parentID.Valid {
		d.Parent = &parentRef{pKey.String, pTitle.String}
	}
	d.StartDate = nullStr(startDate)
	d.DueDate = nullStr(dueDate)
	d.BoardOrder = bo.Float64
	d.ArchivedAt = nullStr(archivedAt)

	d.Sprints = make([]sprintRef, 0)
	rows, err := s.db.Query(`SELECT sp.id, sp.name, sp.state FROM sprints sp
		JOIN issue_sprints isp ON isp.sprint_id = sp.id WHERE isp.issue_id = ? ORDER BY sp.id`, d.ID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var sr sprintRef
		if err := rows.Scan(&sr.ID, &sr.Name, &sr.State); err != nil {
			rows.Close()
			return nil, err
		}
		d.Sprints = append(d.Sprints, sr)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	d.SprintIDs = make([]int64, len(d.Sprints))
	for i, sr := range d.Sprints {
		d.SprintIDs[i] = sr.ID
	}

	d.Subtasks = make([]subtask, 0)
	rows, err = s.db.Query(`SELECT c.key, c.title, st.id, st.name, st.category
		FROM issues c JOIN statuses st ON st.id = c.status_id WHERE c.parent_id = ? ORDER BY c.id`, d.ID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var st subtask
		if err := rows.Scan(&st.Key, &st.Title, &st.Status.ID, &st.Status.Name, &st.Status.Category); err != nil {
			rows.Close()
			return nil, err
		}
		d.Subtasks = append(d.Subtasks, st)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	d.Links = map[string][]linkTarget{}
	// Union in the reverse side too, mapping each link_type to its inverse
	// ("blocks" <-> "is blocked by"; "relates to" is its own inverse) so a
	// link written from one issue is also visible from the other side.
	rows, err = s.db.Query(`
		SELECT link_type, key, title FROM (
			SELECT l.link_type AS link_type, li.key AS key, li.title AS title, li.id AS ord
			FROM issue_links l JOIN issues li ON li.id = l.linked_issue_id WHERE l.issue_id = ?
			UNION ALL
			SELECT CASE l.link_type WHEN 'blocks' THEN 'is blocked by' WHEN 'is blocked by' THEN 'blocks' ELSE l.link_type END,
				li.key, li.title, li.id
			FROM issue_links l JOIN issues li ON li.id = l.issue_id WHERE l.linked_issue_id = ?
		) ORDER BY ord`, d.ID, d.ID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var lt string
		var target linkTarget
		if err := rows.Scan(&lt, &target.Key, &target.Title); err != nil {
			rows.Close()
			return nil, err
		}
		d.Links[lt] = append(d.Links[lt], target)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	d.Comments, err = s.commentsFor(d.ID)
	return &d, err
}

func (s *server) commentsFor(issueID int64) ([]comment, error) {
	out := make([]comment, 0)
	rows, err := s.db.Query(`SELECT c.id, c.author_id, p.name, c.body, c.created_at
		FROM comments c LEFT JOIN people p ON p.id = c.author_id WHERE c.issue_id = ? ORDER BY c.id`, issueID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c comment
		var authorID sql.NullInt64
		var authorName sql.NullString
		if err := rows.Scan(&c.ID, &authorID, &authorName, &c.Body, &c.CreatedAt); err != nil {
			return nil, err
		}
		if authorID.Valid {
			c.Author = &ref{authorID.Int64, authorName.String}
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// issueByKey resolves a path {key} to (id, project_id, status_id); writes 404 and
// returns false when the issue does not exist.
func (s *server) issueByKey(w http.ResponseWriter, key string) (id, projectID, statusID int64, ok bool) {
	err := s.db.QueryRow(`SELECT id, project_id, status_id FROM issues WHERE key = ?`, key).Scan(&id, &projectID, &statusID)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "issue not found")
		return 0, 0, 0, false
	}
	if err != nil {
		dbErr(w, err)
		return 0, 0, 0, false
	}
	return id, projectID, statusID, true
}

// --- handlers ---

func (s *server) listIssues(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where := make([]string, 0, 6)
	args := make([]any, 0, 6)
	for _, f := range []struct{ param, expr string }{
		{"project_id", "i.project_id = ?"},
		{"status", "i.status_id = ?"},
		{"assignee", "i.assignee_id = ?"},
		{"type", "i.type_id = ?"},
		{"sprint", "i.id IN (SELECT issue_id FROM issue_sprints WHERE sprint_id = ?)"},
	} {
		if v := q.Get(f.param); v != "" {
			id, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				writeErr(w, http.StatusBadRequest, "invalid "+f.param)
				return
			}
			where = append(where, f.expr)
			args = append(args, id)
		}
	}
	if v := q.Get("q"); v != "" {
		where = append(where, "instr(lower(i.title), lower(?)) > 0")
		args = append(args, v)
	}
	clause := ""
	if len(where) > 0 {
		clause = "WHERE " + strings.Join(where, " AND ")
	}
	cards, err := s.queryCards(clause, "ORDER BY i.id", args...)
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, cards)
}

func (s *server) createIssue(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProjectID   int64   `json:"project_id"`
		Title       string  `json:"title"`
		Description *string `json:"description"`
		TypeID      *int64  `json:"type_id"`
		StatusID    *int64  `json:"status_id"`
		AssigneeID  *int64  `json:"assignee_id"`
		ReporterID  *int64  `json:"reporter_id"`
		ParentID    *int64  `json:"parent_id"`
		TeamID      *int64  `json:"team_id"`
		StartDate   *string `json:"start_date"`
		DueDate     *string `json:"due_date"`
		SprintIDs   []int64 `json:"sprint_ids"`
	}
	if !decode(w, r, &req) {
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		writeErr(w, http.StatusBadRequest, "title is required")
		return
	}
	if ok, err := s.exists("projects", req.ProjectID); err != nil {
		dbErr(w, err)
		return
	} else if !ok {
		writeErr(w, http.StatusBadRequest, "unknown project_id")
		return
	}

	statusID := int64(0)
	if req.StatusID != nil {
		if ok, err := s.existsInProject("statuses", *req.StatusID, req.ProjectID); err != nil {
			dbErr(w, err)
			return
		} else if !ok {
			writeErr(w, http.StatusBadRequest, "unknown status_id for this project")
			return
		}
		statusID = *req.StatusID
	} else {
		err := s.db.QueryRow(`SELECT id FROM statuses WHERE project_id = ? ORDER BY board_order LIMIT 1`, req.ProjectID).Scan(&statusID)
		if err == sql.ErrNoRows {
			writeErr(w, http.StatusBadRequest, "project has no statuses")
			return
		}
		if err != nil {
			dbErr(w, err)
			return
		}
	}
	for _, c := range []struct {
		id    *int64
		table string
		field string
	}{
		{req.TypeID, "issue_types", "type_id"},
		{req.AssigneeID, "people", "assignee_id"},
		{req.ReporterID, "people", "reporter_id"},
		{req.TeamID, "teams", "team_id"},
	} {
		if c.id == nil {
			continue
		}
		if ok, err := s.exists(c.table, *c.id); err != nil {
			dbErr(w, err)
			return
		} else if !ok {
			writeErr(w, http.StatusBadRequest, "unknown "+c.field)
			return
		}
	}
	if req.ParentID != nil {
		var pProject int64
		err := s.db.QueryRow(`SELECT project_id FROM issues WHERE id = ?`, *req.ParentID).Scan(&pProject)
		if err == sql.ErrNoRows || (err == nil && pProject != req.ProjectID) {
			writeErr(w, http.StatusBadRequest, "unknown parent_id for this project")
			return
		}
		if err != nil && err != sql.ErrNoRows {
			dbErr(w, err)
			return
		}
	}
	for _, dt := range []struct {
		v     *string
		field string
	}{{req.StartDate, "start_date"}, {req.DueDate, "due_date"}} {
		if dt.v != nil && !validDate(*dt.v) {
			writeErr(w, http.StatusBadRequest, dt.field+" must be YYYY-MM-DD")
			return
		}
	}
	for _, sid := range req.SprintIDs {
		if ok, err := s.existsInProject("sprints", sid, req.ProjectID); err != nil {
			dbErr(w, err)
			return
		} else if !ok {
			writeErr(w, http.StatusBadRequest, "unknown sprint id in sprint_ids")
			return
		}
	}

	tx, err := s.db.Begin()
	if err != nil {
		dbErr(w, err)
		return
	}
	defer tx.Rollback()
	key, err := db.AllocateIssueKey(tx, req.ProjectID)
	if err != nil {
		dbErr(w, err)
		return
	}
	order, err := db.BottomBoardOrder(tx, statusID)
	if err != nil {
		dbErr(w, err)
		return
	}
	res, err := tx.Exec(`INSERT INTO issues (project_id, key, title, description, type_id, status_id,
		reporter_id, assignee_id, parent_id, team_id, start_date, due_date, board_order)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		req.ProjectID, key, req.Title, req.Description, req.TypeID, statusID,
		req.ReporterID, req.AssigneeID, req.ParentID, req.TeamID, req.StartDate, req.DueDate, order)
	if err != nil {
		dbErr(w, err)
		return
	}
	issueID, err := res.LastInsertId()
	if err != nil {
		dbErr(w, err)
		return
	}
	for _, sid := range req.SprintIDs {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO issue_sprints (issue_id, sprint_id) VALUES (?, ?)`, issueID, sid); err != nil {
			dbErr(w, err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		dbErr(w, err)
		return
	}

	detail, err := s.getIssueDetail(key)
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, detail)
}

func (s *server) getIssue(w http.ResponseWriter, r *http.Request) {
	detail, err := s.getIssueDetail(r.PathValue("key"))
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusNotFound, "issue not found")
		return
	}
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *server) patchIssue(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	issueID, projectID, curStatus, ok := s.issueByKey(w, key)
	if !ok {
		return
	}
	var body map[string]any
	if !decode(w, r, &body) {
		return
	}

	sets := make([]string, 0, 8)
	args := make([]any, 0, 8)
	var statusChange *int64

	if v, present := body["title"]; present {
		t, isStr := v.(string)
		t = strings.TrimSpace(t)
		if !isStr || t == "" {
			writeErr(w, http.StatusBadRequest, "title must be a non-empty string")
			return
		}
		sets = append(sets, "title = ?")
		args = append(args, t)
	}
	if v, present := body["description"]; present {
		if v == nil {
			sets = append(sets, "description = NULL")
		} else if str, isStr := v.(string); isStr {
			sets = append(sets, "description = ?")
			args = append(args, str)
		} else {
			writeErr(w, http.StatusBadRequest, "description must be a string or null")
			return
		}
	}
	for _, f := range []string{"start_date", "due_date"} {
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
	for _, f := range []struct{ field, table string }{
		{"type_id", "issue_types"},
		{"assignee_id", "people"},
		{"reporter_id", "people"},
		{"team_id", "teams"},
	} {
		v, present := body[f.field]
		if !present {
			continue
		}
		if v == nil {
			sets = append(sets, f.field+" = NULL")
			continue
		}
		id, isID := asID(v)
		if !isID {
			writeErr(w, http.StatusBadRequest, f.field+" must be an integer or null")
			return
		}
		if ok, err := s.exists(f.table, id); err != nil {
			dbErr(w, err)
			return
		} else if !ok {
			writeErr(w, http.StatusBadRequest, "unknown "+f.field)
			return
		}
		sets = append(sets, f.field+" = ?")
		args = append(args, id)
	}
	if v, present := body["status_id"]; present {
		id, isID := asID(v)
		if !isID {
			writeErr(w, http.StatusBadRequest, "status_id must be an integer")
			return
		}
		if ok, err := s.existsInProject("statuses", id, projectID); err != nil {
			dbErr(w, err)
			return
		} else if !ok {
			writeErr(w, http.StatusBadRequest, "unknown status_id for this project")
			return
		}
		if id != curStatus {
			statusChange = &id
		}
	}
	if v, present := body["archived"]; present {
		b, isBool := v.(bool)
		if !isBool {
			writeErr(w, http.StatusBadRequest, "archived must be a boolean")
			return
		}
		if b {
			sets = append(sets, "archived_at = datetime('now')")
		} else {
			sets = append(sets, "archived_at = NULL")
		}
	}
	if v, present := body["parent_id"]; present {
		if v == nil {
			sets = append(sets, "parent_id = NULL")
		} else {
			id, isID := asID(v)
			if !isID {
				writeErr(w, http.StatusBadRequest, "parent_id must be an integer or null")
				return
			}
			if id == issueID {
				writeErr(w, http.StatusBadRequest, "an issue cannot be its own parent")
				return
			}
			// ponytail: no deep-cycle check; single user, shallow hierarchies
			var pProject int64
			err := s.db.QueryRow(`SELECT project_id FROM issues WHERE id = ?`, id).Scan(&pProject)
			if err == sql.ErrNoRows || (err == nil && pProject != projectID) {
				writeErr(w, http.StatusBadRequest, "unknown parent_id for this project")
				return
			}
			if err != nil {
				dbErr(w, err)
				return
			}
			sets = append(sets, "parent_id = ?")
			args = append(args, id)
		}
	}
	var sprintIDs []int64
	haveSprints := false
	if v, present := body["sprint_ids"]; present {
		haveSprints = true
		if v != nil {
			arr, isArr := v.([]any)
			if !isArr {
				writeErr(w, http.StatusBadRequest, "sprint_ids must be an array of integers or null")
				return
			}
			for _, el := range arr {
				id, isID := asID(el)
				if !isID {
					writeErr(w, http.StatusBadRequest, "sprint_ids must contain integers")
					return
				}
				if ok, err := s.existsInProject("sprints", id, projectID); err != nil {
					dbErr(w, err)
					return
				} else if !ok {
					writeErr(w, http.StatusBadRequest, "unknown sprint id in sprint_ids")
					return
				}
				sprintIDs = append(sprintIDs, id)
			}
		}
	}

	if len(sets) == 0 && statusChange == nil && !haveSprints {
		writeErr(w, http.StatusBadRequest, "no updatable fields in request body")
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		dbErr(w, err)
		return
	}
	defer tx.Rollback()
	// board_order is computed from inside the transaction (which, thanks to
	// _txlock=immediate, already holds the write lock) so a concurrent status
	// change can never read the same stale MAX(board_order).
	if statusChange != nil {
		order, err := db.BottomBoardOrder(tx, *statusChange)
		if err != nil {
			dbErr(w, err)
			return
		}
		sets = append(sets, "status_id = ?", "board_order = ?")
		args = append(args, *statusChange, order)
	}
	if len(sets) > 0 {
		sets = append(sets, "updated_at = datetime('now')")
		args = append(args, issueID)
		if _, err := tx.Exec("UPDATE issues SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
			dbErr(w, err)
			return
		}
	}
	if haveSprints {
		if _, err := tx.Exec(`DELETE FROM issue_sprints WHERE issue_id = ?`, issueID); err != nil {
			dbErr(w, err)
			return
		}
		for _, sid := range sprintIDs {
			if _, err := tx.Exec(`INSERT OR IGNORE INTO issue_sprints (issue_id, sprint_id) VALUES (?, ?)`, issueID, sid); err != nil {
				dbErr(w, err)
				return
			}
		}
		if len(sets) == 0 {
			if _, err := tx.Exec(`UPDATE issues SET updated_at = datetime('now') WHERE id = ?`, issueID); err != nil {
				dbErr(w, err)
				return
			}
		}
	}
	if err := tx.Commit(); err != nil {
		dbErr(w, err)
		return
	}

	detail, err := s.getIssueDetail(key)
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (s *server) deleteIssue(w http.ResponseWriter, r *http.Request) {
	issueID, _, _, ok := s.issueByKey(w, r.PathValue("key"))
	if !ok {
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		dbErr(w, err)
		return
	}
	defer tx.Rollback()
	// Orphan subtasks instead of cascading the delete.
	if _, err := tx.Exec(`UPDATE issues SET parent_id = NULL WHERE parent_id = ?`, issueID); err != nil {
		dbErr(w, err)
		return
	}
	if _, err := tx.Exec(`DELETE FROM issues WHERE id = ?`, issueID); err != nil {
		dbErr(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		dbErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) positionIssue(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	issueID, projectID, _, ok := s.issueByKey(w, key)
	if !ok {
		return
	}
	var req struct {
		StatusID int64   `json:"status_id"`
		AfterKey *string `json:"after_key"`
	}
	if !decode(w, r, &req) {
		return
	}
	if exists, err := s.existsInProject("statuses", req.StatusID, projectID); err != nil {
		dbErr(w, err)
		return
	} else if !exists {
		writeErr(w, http.StatusBadRequest, "unknown status_id for this project")
		return
	}

	// The whole read-compute-write sequence runs inside one transaction so
	// concurrent drops (web + MCP) can't both read the same MAX/MIN(board_order)
	// snapshot and write duplicate positions; _txlock=immediate makes db.Begin
	// grab SQLite's write lock up front, serializing these transactions.
	tx, err := s.db.Begin()
	if err != nil {
		dbErr(w, err)
		return
	}
	defer tx.Rollback()

	var newOrder float64
	if req.AfterKey != nil {
		var afterID, afterStatus, afterProject int64
		var afterOrder float64
		err := tx.QueryRow(`SELECT id, status_id, project_id, COALESCE(board_order, 0) FROM issues WHERE key = ?`,
			*req.AfterKey).Scan(&afterID, &afterStatus, &afterProject, &afterOrder)
		if err == sql.ErrNoRows {
			writeErr(w, http.StatusBadRequest, "unknown after_key")
			return
		}
		if err != nil {
			dbErr(w, err)
			return
		}
		if afterID == issueID {
			writeErr(w, http.StatusBadRequest, "after_key cannot be the issue itself")
			return
		}
		if afterProject != projectID || afterStatus != req.StatusID {
			writeErr(w, http.StatusBadRequest, "after_key is not in the target status column")
			return
		}
		var next sql.NullFloat64
		if err := tx.QueryRow(`SELECT MIN(board_order) FROM issues WHERE status_id = ? AND board_order > ? AND id != ?`,
			req.StatusID, afterOrder, issueID).Scan(&next); err != nil {
			dbErr(w, err)
			return
		}
		if next.Valid {
			// ponytail: float midpoint; if precision ever runs out, add a column reindex endpoint
			newOrder = (afterOrder + next.Float64) / 2
		} else {
			newOrder = afterOrder + 1024
		}
	} else {
		var min sql.NullFloat64
		if err := tx.QueryRow(`SELECT MIN(board_order) FROM issues WHERE status_id = ? AND id != ?`,
			req.StatusID, issueID).Scan(&min); err != nil {
			dbErr(w, err)
			return
		}
		if min.Valid {
			newOrder = min.Float64 - 1024
		} else {
			newOrder = 1024
		}
	}

	if _, err := tx.Exec(`UPDATE issues SET status_id = ?, board_order = ?, updated_at = datetime('now') WHERE id = ?`,
		req.StatusID, newOrder, issueID); err != nil {
		dbErr(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"key": key, "status_id": req.StatusID, "board_order": newOrder})
}

// --- links ---

type linkReq struct {
	LinkedKey string `json:"linked_key"`
	LinkType  string `json:"link_type"`
}

func (s *server) resolveLink(w http.ResponseWriter, r *http.Request) (issueID, linkedID int64, req linkReq, ok bool) {
	issueID, _, _, found := s.issueByKey(w, r.PathValue("key"))
	if !found {
		return 0, 0, req, false
	}
	if !decode(w, r, &req) {
		return 0, 0, req, false
	}
	if !validLinkTypes[req.LinkType] {
		writeErr(w, http.StatusBadRequest, `link_type must be one of "blocks", "is blocked by", "relates to"`)
		return 0, 0, req, false
	}
	err := s.db.QueryRow(`SELECT id FROM issues WHERE key = ?`, req.LinkedKey).Scan(&linkedID)
	if err == sql.ErrNoRows {
		writeErr(w, http.StatusBadRequest, "unknown linked_key")
		return 0, 0, req, false
	}
	if err != nil {
		dbErr(w, err)
		return 0, 0, req, false
	}
	if linkedID == issueID {
		writeErr(w, http.StatusBadRequest, "an issue cannot link to itself")
		return 0, 0, req, false
	}
	return issueID, linkedID, req, true
}

func (s *server) addLink(w http.ResponseWriter, r *http.Request) {
	issueID, linkedID, req, ok := s.resolveLink(w, r)
	if !ok {
		return
	}
	if _, err := s.db.Exec(`INSERT INTO issue_links (issue_id, linked_issue_id, link_type) VALUES (?, ?, ?)`,
		issueID, linkedID, req.LinkType); err != nil {
		dbErr(w, err) // UNIQUE -> 409
		return
	}
	writeJSON(w, http.StatusCreated, req)
}

func (s *server) deleteLink(w http.ResponseWriter, r *http.Request) {
	issueID, linkedID, req, ok := s.resolveLink(w, r)
	if !ok {
		return
	}
	res, err := s.db.Exec(`DELETE FROM issue_links WHERE issue_id = ? AND linked_issue_id = ? AND link_type = ?`,
		issueID, linkedID, req.LinkType)
	if err != nil {
		dbErr(w, err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "link not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- comments ---

func (s *server) listComments(w http.ResponseWriter, r *http.Request) {
	issueID, _, _, ok := s.issueByKey(w, r.PathValue("key"))
	if !ok {
		return
	}
	comments, err := s.commentsFor(issueID)
	if err != nil {
		dbErr(w, err)
		return
	}
	writeJSON(w, http.StatusOK, comments)
}

func (s *server) addComment(w http.ResponseWriter, r *http.Request) {
	issueID, _, _, ok := s.issueByKey(w, r.PathValue("key"))
	if !ok {
		return
	}
	var req struct {
		Body     string `json:"body"`
		AuthorID *int64 `json:"author_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Body) == "" {
		writeErr(w, http.StatusBadRequest, "body is required")
		return
	}
	if req.AuthorID != nil {
		if exists, err := s.exists("people", *req.AuthorID); err != nil {
			dbErr(w, err)
			return
		} else if !exists {
			writeErr(w, http.StatusBadRequest, "unknown author_id")
			return
		}
	}
	res, err := s.db.Exec(`INSERT INTO comments (issue_id, author_id, body) VALUES (?, ?, ?)`, issueID, req.AuthorID, req.Body)
	if err != nil {
		dbErr(w, err)
		return
	}
	commentID, err := res.LastInsertId()
	if err != nil {
		dbErr(w, err)
		return
	}
	var c comment
	var authorID sql.NullInt64
	var authorName sql.NullString
	if err := s.db.QueryRow(`SELECT c.id, c.author_id, p.name, c.body, c.created_at
		FROM comments c LEFT JOIN people p ON p.id = c.author_id WHERE c.id = ?`, commentID).Scan(
		&c.ID, &authorID, &authorName, &c.Body, &c.CreatedAt); err != nil {
		dbErr(w, err)
		return
	}
	if authorID.Valid {
		c.Author = &ref{authorID.Int64, authorName.String}
	}
	writeJSON(w, http.StatusCreated, c)
}

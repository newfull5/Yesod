// Package api holds the REST handlers mounted under /api.
package api

import (
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type server struct {
	db       *sql.DB
	password string // empty = auth disabled
	me       string // YESOD_ME: name of the person "assign to me" targets; empty = unconfigured

	mu       sync.Mutex
	sessions map[string]struct{} // ponytail: in-memory, cleared on restart; fine for one user
}

// RegisterRoutes mounts all /api handlers on mux. When YESOD_PASSWORD is set,
// every /api route except POST /api/login requires a session cookie.
func RegisterRoutes(mux *http.ServeMux, d *sql.DB) {
	s := &server{db: d, password: os.Getenv("YESOD_PASSWORD"), me: os.Getenv("YESOD_ME"), sessions: map[string]struct{}{}}

	api := http.NewServeMux()
	api.HandleFunc("POST /api/login", s.login)

	api.HandleFunc("GET /api/meta", s.meta)
	api.HandleFunc("GET /api/projects", s.listProjects)
	api.HandleFunc("POST /api/projects", s.createProject)
	api.HandleFunc("DELETE /api/projects/{id}", s.deleteProject)
	api.HandleFunc("GET /api/board", s.board)

	api.HandleFunc("GET /api/issues", s.listIssues)
	api.HandleFunc("POST /api/issues", s.createIssue)
	api.HandleFunc("GET /api/issues/{key}", s.getIssue)
	api.HandleFunc("PATCH /api/issues/{key}", s.patchIssue)
	api.HandleFunc("DELETE /api/issues/{key}", s.deleteIssue)
	api.HandleFunc("PATCH /api/issues/{key}/position", s.positionIssue)
	api.HandleFunc("POST /api/issues/{key}/links", s.addLink)
	api.HandleFunc("DELETE /api/issues/{key}/links", s.deleteLink)
	api.HandleFunc("GET /api/issues/{key}/comments", s.listComments)
	api.HandleFunc("POST /api/issues/{key}/comments", s.addComment)

	api.HandleFunc("GET /api/sprints", s.listSprints)
	api.HandleFunc("POST /api/sprints", s.createSprint)
	api.HandleFunc("PATCH /api/sprints/{id}", s.patchSprint)

	api.HandleFunc("GET /api/people", s.listPeople)
	api.HandleFunc("POST /api/people", s.createPerson)
	api.HandleFunc("GET /api/teams", s.listTeams)
	api.HandleFunc("POST /api/teams", s.createTeam)
	api.HandleFunc("GET /api/statuses", s.listStatuses)
	api.HandleFunc("POST /api/statuses", s.createStatus)
	api.HandleFunc("POST /api/statuses/{id}/clear", s.clearStatus)
	api.HandleFunc("DELETE /api/statuses/{id}", s.deleteStatus)

	api.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeErr(w, http.StatusNotFound, "not found")
	})

	mux.Handle("/api/", s.auth(api))
}

// --- auth ---

func (s *server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.password == "" || r.URL.Path == "/api/login" {
			next.ServeHTTP(w, r)
			return
		}
		if c, err := r.Cookie("yesod_session"); err == nil {
			s.mu.Lock()
			_, ok := s.sessions[c.Value]
			s.mu.Unlock()
			if ok {
				next.ServeHTTP(w, r)
				return
			}
		}
		writeErr(w, http.StatusUnauthorized, "unauthorized")
	})
}

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}
	if !decode(w, r, &req) {
		return
	}
	if s.password == "" { // auth disabled: login is a no-op success
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}
	if subtle.ConstantTimeCompare([]byte(req.Password), []byte(s.password)) != 1 {
		time.Sleep(500 * time.Millisecond) // throttle brute-force guessing
		writeErr(w, http.StatusUnauthorized, "invalid password")
		return
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		writeErr(w, http.StatusInternalServerError, "token generation failed")
		return
	}
	token := hex.EncodeToString(buf)
	s.mu.Lock()
	s.sessions[token] = struct{}{}
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name:     "yesod_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https",
		SameSite: http.SameSiteLaxMode,
	})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// meta reports server-side configuration the web UI needs but can't discover
// itself, currently just the YESOD_ME person (nil if unset or unmatched).
func (s *server) meta(w http.ResponseWriter, r *http.Request) {
	out := struct {
		Me *personRef `json:"me"`
	}{}
	if s.me != "" {
		var p personRef
		var color sql.NullString
		err := s.db.QueryRow(`SELECT id, name, avatar_color FROM people WHERE name = ?`, s.me).Scan(&p.ID, &p.Name, &color)
		if err != nil && err != sql.ErrNoRows {
			dbErr(w, err)
			return
		}
		if err == nil {
			p.AvatarColor = nullStr(color)
			out.Me = &p
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// --- shared helpers ---

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("api: encode response: %v", err)
	}
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// decode parses the JSON request body into v; on failure it writes a 400 and
// returns false.
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return false
	}
	return true
}

// dbErr maps a database error to an HTTP response.
func dbErr(w http.ResponseWriter, err error) {
	if strings.Contains(err.Error(), "UNIQUE") {
		writeErr(w, http.StatusConflict, "already exists")
		return
	}
	log.Printf("api: database error: %v", err)
	writeErr(w, http.StatusInternalServerError, "database error")
}

// exists reports whether a row with the given id exists in table.
// Table names are compile-time constants, never user input.
func (s *server) exists(table string, id int64) (bool, error) {
	var one int
	err := s.db.QueryRow("SELECT 1 FROM "+table+" WHERE id = ?", id).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

// existsInProject is exists() for project-scoped tables (statuses, sprints).
func (s *server) existsInProject(table string, id, projectID int64) (bool, error) {
	var one int
	err := s.db.QueryRow("SELECT 1 FROM "+table+" WHERE id = ? AND project_id = ?", id, projectID).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

// asID converts a decoded JSON value to an integer id.
func asID(v any) (int64, bool) {
	f, ok := v.(float64)
	if !ok || f != math.Trunc(f) {
		return 0, false
	}
	return int64(f), true
}

func validDate(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

func nullStr(ns sql.NullString) *string {
	if ns.Valid {
		return &ns.String
	}
	return nil
}

func nullInt(ni sql.NullInt64) *int64 {
	if ni.Valid {
		return &ni.Int64
	}
	return nil
}

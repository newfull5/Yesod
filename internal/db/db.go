// Package db owns the SQLite connection, schema, and seed data.
package db

import (
	"database/sql"
	_ "embed"
	"fmt"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

// Open opens (or creates) the SQLite database at path with WAL mode,
// busy_timeout=5000 and foreign keys enforced, applies the schema on
// first run (tracked via PRAGMA user_version) and seeds default data.
func Open(path string) (*sql.DB, error) {
	// _txlock=immediate: every db.Begin() acquires SQLite's write lock at BEGIN
	// time (instead of lazily on the first write), so concurrent read-compute-write
	// sequences (e.g. board_order placement) fully serialize instead of both
	// reading the same stale snapshot before writing.
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate", path)
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if err := migrate(d); err != nil {
		d.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return d, nil
}

func migrate(d *sql.DB) error {
	var version int
	if err := d.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	if version >= 3 {
		return nil
	}
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if version < 1 {
		// Fresh database: schema.sql is already at the latest version.
		if _, err := tx.Exec(schema); err != nil {
			return err
		}
		if err := seed(tx); err != nil {
			return err
		}
	} else {
		if version < 2 {
			// v1 -> v2: issues.archived_at ("clear done" keeps history off the board).
			if _, err := tx.Exec(`ALTER TABLE issues ADD COLUMN archived_at TEXT`); err != nil {
				return err
			}
		}
		// v2 -> v3: agent_jobs work queue for issue agents.
		if _, err := tx.Exec(`CREATE TABLE agent_jobs (
			id           INTEGER PRIMARY KEY,
			issue_id     INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
			status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
			result       TEXT,
			requested_by TEXT,
			created_at   TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
		)`); err != nil {
			return err
		}
	}
	if _, err := tx.Exec("PRAGMA user_version = 3"); err != nil {
		return err
	}
	return tx.Commit()
}

func seed(tx *sql.Tx) error {
	res, err := tx.Exec(`INSERT INTO projects (key_prefix, name) VALUES ('YS', 'Yesod')`)
	if err != nil {
		return err
	}
	pid, err := res.LastInsertId()
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO statuses (project_id, name, category, board_order) VALUES
		(?, 'To Do', 'todo', 1),
		(?, 'In Progress', 'in_progress', 2),
		(?, 'Done', 'done', 3)`, pid, pid, pid); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO issue_types (name, icon) VALUES
		('Story', 'story'), ('Bug', 'bug'), ('Task', 'task'), ('Epic', 'epic')`)
	return err
}

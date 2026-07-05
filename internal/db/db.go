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
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", path)
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
	if version >= 1 {
		return nil
	}
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(schema); err != nil {
		return err
	}
	if err := seed(tx); err != nil {
		return err
	}
	if _, err := tx.Exec("PRAGMA user_version = 1"); err != nil {
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
	if _, err := tx.Exec(`INSERT INTO issue_types (name, icon) VALUES
		('Story', 'story'), ('Bug', 'bug'), ('Task', 'task'), ('Epic', 'epic')`); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO people (name, avatar_color) VALUES ('Saechan', '#7c3aed')`)
	return err
}

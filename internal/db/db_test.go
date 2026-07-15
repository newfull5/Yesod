package db

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestOpenAppliesSchemaAndSeedsOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "yesod.db")

	for i := 0; i < 2; i++ { // second open must not re-seed
		d, err := Open(path)
		if err != nil {
			t.Fatalf("open #%d: %v", i+1, err)
		}
		// people is seeded empty: no hardcoded person name (YESOD_ME picks one at runtime).
		counts := map[string]int{"projects": 1, "statuses": 3, "issue_types": 4, "people": 0}
		for table, want := range counts {
			var got int
			if err := d.QueryRow("SELECT count(*) FROM " + table).Scan(&got); err != nil {
				t.Fatalf("count %s: %v", table, err)
			}
			if got != want {
				t.Errorf("open #%d: %s rows = %d, want %d", i+1, table, got, want)
			}
		}
		var prefix string
		if err := d.QueryRow("SELECT key_prefix FROM projects").Scan(&prefix); err != nil || prefix != "YS" {
			t.Errorf("project key_prefix = %q, err %v, want YS", prefix, err)
		}
		d.Close()
	}
}

func TestMigrateV1AddsArchivedAt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "yesod.db")

	// Fake a v1 database: issues table without archived_at, user_version = 1.
	raw, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatalf("open raw: %v", err)
	}
	if _, err := raw.Exec(`CREATE TABLE issues (id INTEGER PRIMARY KEY, title TEXT); PRAGMA user_version = 1`); err != nil {
		t.Fatalf("create v1 db: %v", err)
	}
	raw.Close()

	d, err := Open(path)
	if err != nil {
		t.Fatalf("open (migrate v1->v4): %v", err)
	}
	defer d.Close()
	var version int
	if err := d.QueryRow("PRAGMA user_version").Scan(&version); err != nil || version != 4 {
		t.Errorf("user_version = %d, err %v, want 4", version, err)
	}
	if _, err := d.Exec(`UPDATE issues SET archived_at = datetime('now')`); err != nil {
		t.Errorf("archived_at column missing after migration: %v", err)
	}
	if _, err := d.Exec(`INSERT INTO issues (id, title) VALUES (1, 'x')`); err != nil {
		t.Fatalf("insert issue: %v", err)
	}
	if _, err := d.Exec(`INSERT INTO agent_jobs (issue_id) VALUES (1)`); err != nil {
		t.Errorf("agent_jobs table missing after migration: %v", err)
	}
}

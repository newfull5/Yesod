package db

import (
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

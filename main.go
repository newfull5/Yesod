// Yesod — ultra-light self-hosted issue tracker. Server entrypoint.
package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/newfull5/yesod/internal/api"
	"github.com/newfull5/yesod/internal/db"
)

//go:embed all:web/dist
var webDist embed.FS

func main() {
	if len(os.Args) > 1 && os.Args[1] == "runner" {
		runRunner(os.Args[2:])
		return
	}
	addr := envOr("YESOD_ADDR", ":9999")
	dbPath := envOr("YESOD_DB", "./data/yesod.db")

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		log.Fatalf("create data dir: %v", err)
	}
	database, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()

	mux := http.NewServeMux()
	api.RegisterRoutes(mux, database)

	dist, err := fs.Sub(webDist, "web/dist")
	if err != nil {
		log.Fatalf("embedded UI: %v", err)
	}
	mux.Handle("/", spaHandler(dist))

	log.Printf("yesod listening on %s (db: %s)", addr, dbPath)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// spaHandler serves the embedded frontend build; unknown paths fall back
// to index.html so client-side routing works.
func spaHandler(dist fs.FS) http.Handler {
	files := http.FileServerFS(dist)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := fs.Stat(dist, "index.html"); err != nil {
			http.Error(w, "UI not built — run make build", http.StatusServiceUnavailable)
			return
		}
		if p := strings.TrimPrefix(r.URL.Path, "/"); p != "" {
			if _, err := fs.Stat(dist, p); err != nil {
				// Missing assets must 404, not fall back to index.html —
				// browsers heuristically cache the HTML response under the
				// asset URL and keep showing a broken image after a rebuild.
				if strings.Contains(path.Base(p), ".") {
					http.NotFound(w, r)
					return
				}
				r.URL.Path = "/" // SPA fallback
			}
		}
		files.ServeHTTP(w, r)
	})
}

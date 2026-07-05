// Yesod — ultra-light self-hosted issue tracker. Server entrypoint.
package main

import (
	"embed"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/newfull5/yesod/internal/api"
	"github.com/newfull5/yesod/internal/db"
)

//go:embed all:web/dist
var webDist embed.FS

func main() {
	addr := envOr("YESOD_ADDR", ":8080")
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
	log.Fatal(http.ListenAndServe(addr, hostCheck(mux, os.Getenv("YESOD_HOST"))))
}

// hostCheck rejects requests whose Host header is not a loopback/private
// address or the YESOD_HOST allowlist entry. Mitigates DNS-rebinding attacks
// against the default no-auth LAN mode, where any Host would otherwise be
// answered (a malicious page could rebind attacker.com to 127.0.0.1/192.168.x.x
// and issue same-origin requests against the full /api surface).
func hostCheck(next http.Handler, allowHost string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hostAllowed(r.Host, allowHost) {
			http.Error(w, "invalid host header", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func hostAllowed(hostHeader, allowHost string) bool {
	host := hostHeader
	if h, _, err := net.SplitHostPort(hostHeader); err == nil {
		host = h
	}
	if host == "localhost" || (allowHost != "" && host == allowHost) {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && (ip.IsLoopback() || ip.IsPrivate())
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
				r.URL.Path = "/" // SPA fallback
			}
		}
		files.ServeHTTP(w, r)
	})
}

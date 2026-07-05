# Yesod

Ultra-light self-hosted issue tracker: one Go binary, one SQLite file,
a React kanban board embedded in the binary, and an MCP server for
Claude Code. Single-user, home-server scale (idle memory target ≤ 100MB).

Full spec: [PLAN.md](PLAN.md) (Korean).

## Layout

- `main.go` — HTTP server, serves the embedded UI and `/api`
- `internal/db` — SQLite schema + connection (modernc.org/sqlite, CGO-free)
- `internal/api` — REST handlers
- `web/` — Vite + React frontend (built into `web/dist`, embedded via `embed.FS`)
- `mcp/` — Node stdio MCP server wrapping the REST API

## Develop

```sh
make dev    # Go API on :8080 + Vite dev server on :5173 (proxies /api)
make test   # go test ./...
```

## Build & run

```sh
make build  # builds web/dist, embeds it, outputs ./yesod
./yesod     # YESOD_ADDR (default :8080), YESOD_DB (default ./data/yesod.db)
```

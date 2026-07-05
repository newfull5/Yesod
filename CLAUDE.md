# Yesod — Project Rules

## Language

- Everything that lands in the repo is written in **English**: code, comments, commit messages, PR titles/descriptions, README and docs, API error messages, log messages.
- Exception: `PLAN.md` (original planning doc) stays in Korean.
- UI copy is English by default (single-user tool; localize only if ever requested).
- Conversation with the user stays in Korean.

## Project

- See `PLAN.md` for the full spec. Stack: Go stdlib + SQLite (`modernc.org/sqlite`, CGO-free), React + Vite + dnd-kit frontend embedded via `embed.FS`, Node MCP server in `/mcp`.
- Single binary, single container, idle memory target ≤ 100MB. Keep it lean — no new dependencies for what a few lines can do.
- Issue keys: `YS-{n}`, numbers never reused.

## Workflow

- Commit at each milestone completion (see PLAN.md §8).
- Commit messages: conventional style (`feat:`, `fix:`, `chore:`), English.
- Verify before claiming done: run the server, exercise the actual flow.

# Yesod MCP Server

A stdio MCP server that wraps the Yesod REST API, so Claude Code (or any MCP client) can manage your board: raise issues while you work, move cards, run sprints.

## Setup

Requires Node 18+ and a running Yesod server (see the [main README](../README.md)).

```bash
git clone https://github.com/newfull5/Yesod.git
cd Yesod/mcp && npm install
```

Register it with Claude Code (`--scope user` makes it available in every project):

```bash
claude mcp add yesod --scope user \
  -e YESOD_URL=http://localhost:9999 \
  -e YESOD_ME=YourName \
  -- node /absolute/path/to/Yesod/mcp/index.js
```

Restart Claude Code and the tools show up as `mcp__yesod__*`. For other MCP clients (e.g. Claude Desktop), the equivalent JSON config is:

```json
{
  "mcpServers": {
    "yesod": {
      "command": "node",
      "args": ["/absolute/path/to/Yesod/mcp/index.js"],
      "env": { "YESOD_URL": "http://localhost:9999", "YESOD_ME": "YourName" }
    }
  }
}
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `YESOD_URL` | `http://localhost:9999` | Base URL of your Yesod server. Reverse-proxy subpaths work too, e.g. `http://myhost/yesod`. |
| `YESOD_PASSWORD` | _(unset)_ | If the server has a password, the MCP server logs in with it automatically. |
| `YESOD_ME` | _(unset)_ | Your person name in Yesod — used by `assign_to_me` and as the default comment author. Must match an existing person (`create_person`). |

## Tools

| Area | Tools |
|---|---|
| Projects | `list_projects`, `create_project`, `delete_project` |
| Issues | `list_issues`, `get_issue`, `create_issue`, `update_issue`, `delete_issue`, `assign_to_me`, `add_comment` |
| Links | `link_issues`, `unlink_issues` |
| Board columns | `list_statuses`, `add_column`, `delete_column` |
| People / Teams | `list_people`, `create_person`, `list_teams`, `create_team` |
| Sprints | `list_sprints`, `create_sprint`, `update_sprint` |

Deletes are permanent. `delete_project` takes everything in the project with it and demands the project's key prefix as confirmation; to hide an issue without destroying it, use `update_issue` with `archived: true` instead.

## Smoke test

Drives the server end to end over stdio against a running Yesod instance (creates throwaway data — point it at a scratch DB, not your real board):

```bash
YESOD_URL=http://localhost:9999 node smoke.js
```

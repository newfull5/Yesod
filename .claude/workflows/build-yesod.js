export const meta = {
  name: 'build-yesod',
  description: 'Build Yesod issue tracker end-to-end: scaffold, REST API, kanban UI, MCP server, Docker, review & verify',
  phases: [
    { title: 'Scaffold', detail: 'Go module, schema, Vite app, MCP skeleton' },
    { title: 'Backend', detail: 'REST API + tests' },
    { title: 'UI & MCP', detail: 'kanban frontend ∥ MCP server' },
    { title: 'Integrate', detail: 'build all, e2e, Docker' },
    { title: 'Review', detail: '3-dimension parallel review' },
    { title: 'Verify findings', detail: 'adversarial refutation' },
    { title: 'Fix', detail: 'apply confirmed findings' },
    { title: 'Final verify', detail: 'clean rebuild + e2e' },
  ],
}

const ROOT = '/Users/saechan/Yesod'
const PREAMBLE = `You are building "Yesod", a lightweight self-hosted issue tracker. Working directory: ${ROOT}.
MANDATORY first step: read ${ROOT}/PLAN.md (full spec, Korean) and ${ROOT}/CLAUDE.md (project rules).
HARD RULES:
- ALL repo content in ENGLISH: code, comments, commit msgs, docs, UI copy, error/log messages. Zero Korean in any repo file.
- Lean code (ponytail): no speculative abstractions, stdlib first, fewest files. But NEVER skip: input validation at API boundary, error handling, correctness.
- Do NOT run git commit. Do NOT leave any background process running when you finish (kill servers you started).
- Go is at /opt/homebrew/bin/go (ensure PATH). Node v22 available.`

const REPORT = {
  type: 'object', additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' }, description: 'empty if ok' },
    notes: { type: 'string' },
  },
  required: ['ok', 'failures', 'notes'],
}

const FINDINGS = {
  type: 'object', additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          file: { type: 'string' }, line: { type: 'integer' },
          title: { type: 'string' }, detail: { type: 'string' },
          severity: { enum: ['critical', 'major', 'minor'] },
        },
        required: ['file', 'title', 'detail', 'severity'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object', additionalProperties: false,
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

// ---------- Phase 1: Scaffold ----------
phase('Scaffold')
log('Scaffolding Go module, schema, Vite app, MCP skeleton')
await agent(`${PREAMBLE}

TASK: Scaffold the entire repo per PLAN.md section 7 (저장소 구조). Deliverables:
1. Go module: run "go mod init github.com/newfull5/yesod". Add modernc.org/sqlite dependency.
2. internal/db/: schema.sql implementing PLAN.md section 3 EXACTLY (projects, issue_types, statuses, people, teams, sprints, issues, issue_sprints, issue_links, comments — all columns incl. CHECK constraints, FKs, board_order REAL on issues). Plus db.go: Open() that opens SQLite (WAL mode, busy_timeout=5000, foreign_keys=ON), applies schema via PRAGMA user_version, and seeds on first run: project (key_prefix "YS", name "Yesod"), statuses "To Do"(todo)/"In Progress"(in_progress)/"Done"(done) for that project, issue types Story/Bug/Task/Epic, one person "Saechan".
3. main.go: net/http server (Go 1.22+ pattern routing), addr from YESOD_ADDR env (default ":8080"), DB path from YESOD_DB (default "./data/yesod.db", create dir). Serve embedded frontend: //go:embed all:web/dist with SPA fallback to index.html; if index.html missing serve 503 "UI not built — run make build". Mount /api routes placeholder (internal/api package with a stub RegisterRoutes(mux, db)).
4. web/: hand-author a MINIMAL non-interactive Vite + React + TypeScript scaffold (do NOT use interactive npm create): package.json, vite.config.ts (dev proxy /api -> http://localhost:8080), tsconfig, index.html, src/main.tsx, src/App.tsx placeholder. Install deps: react, react-dom, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, react-markdown; dev deps: typescript, vite, @vitejs/plugin-react, @types/react, @types/react-dom. Verify "npm run build" succeeds; put a .gitkeep in web/dist and gitignore built files (pattern: "web/dist/*" + "!web/dist/.gitkeep").
5. mcp/: package.json (type: module) with @modelcontextprotocol/sdk installed, index.js stub that starts an empty stdio MCP server (will be filled later). Verify "node --check mcp/index.js".
6. .gitignore (node_modules, data/, *.db*, web/dist/* with !web/dist/.gitkeep), Makefile (targets: build = web build + go build -o yesod; dev; test = go test ./...), short English README.md.
VERIFY before finishing: "go build ./..." succeeds, "npm run build" in web/ succeeds, "node --check mcp/index.js" passes.
Return a one-paragraph summary of what was created.`, { label: 'scaffold' })

// ---------- Phase 2: Backend ----------
phase('Backend')
log('Implementing REST API + tests')
const CONTRACT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    endpoints: { type: 'string', description: 'Markdown: every endpoint with exact request/response JSON field names and example bodies' },
    notes: { type: 'string' },
  },
  required: ['endpoints', 'notes'],
}
const backend = await agent(`${PREAMBLE}

TASK: Implement the full REST API per PLAN.md section 4 in internal/api (+ query helpers in internal/db). The scaffold (module, schema.sql, db.go, main.go, stub RegisterRoutes) already exists — extend it, don't rewrite the scaffold.
Requirements:
- Go 1.22+ net/http pattern routing ("GET /api/issues/{key}"). JSON everywhere; errors as {"error":"..."} with proper status codes. Validate input at the boundary (unknown status_id/type_id/etc -> 400/404, empty title -> 400).
- Endpoints: GET/POST /api/projects; GET /api/board?project_id= (issues grouped by status, ordered by board_order); GET/POST /api/issues with filters (project_id, status, assignee, sprint, type, q substring on title); GET/PATCH/DELETE /api/issues/{key} (PATCH = partial update, only provided fields, incl. description/assignee_id/reporter_id/type_id/status_id/team_id/parent_id/start_date/due_date/sprint_ids array replace); PATCH /api/issues/{key}/position body {status_id, after_key optional} -> set status + board_order midpoint between neighbors (REAL); POST + DELETE /api/issues/{key}/links; GET/POST /api/issues/{key}/comments; GET/POST/PATCH /api/sprints?project_id= (PATCH for state transitions future/active/closed); GET/POST /api/people, /api/teams, GET/POST /api/statuses?project_id=.
- Issue creation: allocate key "YS-{n}" from projects.next_issue_num inside a transaction; place at bottom of its status column (max board_order + 1024).
- Issue GET detail returns: all issue fields + type/status/assignee/reporter/team expanded (id+name), sprints array, subtasks (issues with parent_id = this, key+title+status), links (grouped, each with linked issue key+title), comments (author name, created_at), parent (key+title) if set.
- Optional auth: when YESOD_PASSWORD env is set, POST /api/login {password} sets an HttpOnly session cookie (random token, in-memory store); middleware rejects other /api calls with 401 without it. When env unset, no auth at all.
- Tests (net/http/httptest + temp sqlite file): issue CRUD + key sequence YS-1,YS-2; position endpoint (move between columns, ordering after moves); partial PATCH semantics; filters; comments; auth on/off. Run "go vet ./..." and "go test ./..." until fully green.
Return: endpoints = complete markdown API contract (exact JSON field names + example request/response per endpoint) for the frontend/MCP teams; notes = anything they must know.`, { label: 'backend-api', schema: CONTRACT_SCHEMA, effort: 'high' })

// ---------- Phase 3: Frontend ∥ MCP ----------
phase('UI & MCP')
log('Building kanban frontend and MCP server in parallel')
const API_CONTRACT = `API CONTRACT (implemented and tested, source of truth):\n${backend.endpoints}\nNOTES: ${backend.notes}`
const [uiResult, mcpResult] = await parallel([
  () => agent(`${PREAMBLE}

TASK: Implement the full frontend in web/src per PLAN.md section 5. Only touch web/. The Vite+React+TS scaffold with @dnd-kit and react-markdown installed already exists.
${API_CONTRACT}
Requirements:
- Board view (default): status columns from GET /api/board; cards show key, title, type icon, assignee avatar (initials + color), due date (red when overdue/imminent). Drag cards across/within columns with @dnd-kit; on drop optimistically update then PATCH /api/issues/{key}/position, rollback on error. "+ Create issue" button and per-column quick-add. Top bar: project selector, filters (sprint, assignee, type, text search) — client-side filtering.
- Issue detail modal (click card), Jira-like 2-column layout per PLAN.md 5.2: left = breadcrumb (parent key / issue key), inline-editable title, markdown description (react-markdown, NO raw HTML rendering; click to edit in textarea), subtasks list + inline add, linked issues grouped by link type + add/remove, activity (comments list + input). Right = status dropdown, reporter, assignee + "Assign to me" button (me = person named "Saechan"), sprints multi-select, parent picker (search issues), start date & due date (<input type="date">), team dropdown, created/updated read-only.
- Backlog view at #backlog (hash toggle, NO router library): sprint sections + backlog section as lists; drag rows between sections to assign/unassign sprint (PATCH issue sprint_ids). Board/Backlog nav links in header.
- English UI copy only. Clean minimal CSS (single stylesheet or CSS modules, no UI framework). Dark-friendly is nice but optional.
- MUST pass: "npm run build" (tsc + vite) with zero errors. Also verify the dev flow compiles: no unused/broken imports.
Return one paragraph: what was built + any deviations from spec.`, { label: 'frontend', effort: 'high' }),
  () => agent(`${PREAMBLE}

TASK: Implement the MCP server in mcp/index.js per PLAN.md section 6. Only touch mcp/. The package with @modelcontextprotocol/sdk installed already exists.
${API_CONTRACT}
Requirements:
- stdio MCP server, tools: list_issues (all filters), get_issue, create_issue, update_issue (any PATCH field incl. status change by status name), assign_to_me, add_comment, list_sprints. Rich English descriptions on every tool + param so the model never guesses.
- Env: YESOD_URL (default http://localhost:8080), YESOD_PASSWORD (optional -> login once, keep cookie), YESOD_ME (person name for assign_to_me, default "Saechan").
- update_issue: accept human-friendly status/type/assignee NAMES and resolve them to ids via the API before PATCHing.
- Tool results: compact readable text (not raw JSON dumps) — e.g. "YS-3 Fix login bug [In Progress] @Saechan due 2026-07-10".
- SMOKE TEST: build the Go server ("go build -o /tmp/yesod-smoke ." with PATH incl. /opt/homebrew/bin), run it on YESOD_ADDR=:8398 with a temp YESOD_DB, then drive mcp/index.js over stdio with a small script: initialize, tools/list, create_issue, list_issues, update_issue (status change), add_comment, get_issue — assert sane outputs. KILL the server after. Include that script as mcp/smoke.js (reusable, plain node, no test framework).
Return one paragraph: tools implemented + smoke result.`, { label: 'mcp-server', effort: 'high' }),
])
log(`UI: ${String(uiResult).slice(0, 120)}...`)
log(`MCP: ${String(mcpResult).slice(0, 120)}...`)

// ---------- Phase 4: Integrate (fix loop) ----------
const INTEGRATE_PROMPT = `${PREAMBLE}

TASK: Integration-verify the whole product end to end, and set up Docker.
Steps:
1. cd web && npm run build (real build into web/dist). Then "go vet ./..." and "go test ./..." and "go build -o yesod ." at repo root.
2. Run ./yesod with YESOD_ADDR=:8399 and a temp YESOD_DB. Verify with curl: GET / returns the built index.html (SPA served from embed); full API flow: create issue -> appears in /api/board -> PATCH position to another status -> GET detail shows new status -> add comment -> create second issue -> link them -> GET detail shows link + comment; sprint create + assign via PATCH sprint_ids; filters (?q=, ?assignee=). Verify auth mode: restart with YESOD_PASSWORD=test -> unauthenticated /api/issues -> 401; POST /api/login -> cookie -> 200.
3. node mcp/smoke.js against the running server (adjust env), confirm it passes.
4. Write Dockerfile (3-stage: node:22-alpine web build -> golang:1.26-alpine build with embed -> final minimal image, CGO not needed) and docker-compose.yml (one service, ./data:/data volume, YESOD_DB=/data/yesod.db, port 8080). If "docker info" shows a running daemon: docker compose build && up -d, curl the container, record "docker stats --no-stream" memory, then compose down. If the daemon is unavailable, note it in failures ONLY as "docker-unverified: <reason>" (not a hard failure).
5. KILL every process you started.
Report ok=true only if every non-docker step passed. failures: precise, reproducible items (command + expected vs actual). notes: idle memory figure if measured.`
phase('Integrate')
log('Building everything and running e2e checks')
let report = await agent(INTEGRATE_PROMPT, { label: 'integrate', schema: REPORT, effort: 'high' })
let hardFailures = report.failures.filter(f => !f.startsWith('docker-unverified'))
let round = 0
while (!report.ok && hardFailures.length > 0 && round < 3) {
  round++
  log(`Integration round ${round} failed: ${hardFailures.length} issue(s) — fixing`)
  await agent(`${PREAMBLE}

TASK: Fix these concrete integration failures found while testing the product end to end. Reproduce each first, fix the ROOT CAUSE (grep all callers), then re-run the failing check locally to confirm. Do not refactor beyond the fix.
FAILURES:
${hardFailures.map((f, i) => `${i + 1}. ${f}`).join('\n')}`, { label: `fix-integration-${round}`, phase: 'Integrate', effort: 'high' })
  report = await agent(INTEGRATE_PROMPT, { label: `integrate-retry-${round}`, phase: 'Integrate', schema: REPORT, effort: 'high' })
  hardFailures = report.failures.filter(f => !f.startsWith('docker-unverified'))
}
if (!report.ok && hardFailures.length > 0) {
  return { status: 'integration-failed', failures: report.failures, notes: report.notes }
}
log(`Integration green. ${report.notes}`)

// ---------- Phase 5: Review ----------
phase('Review')
log('Running 3-dimension parallel review')
const DIMENSIONS = [
  { key: 'correctness', prompt: 'Hunt CORRECTNESS bugs only: SQLite concurrency (WAL/busy_timeout actually set? transactions where needed?), issue-key allocation races, board_order midpoint edge cases (drop at top/bottom/empty column, float precision exhaustion), PATCH partial-update semantics (null vs absent), FK violations on delete (issue with comments/links/subtasks), date handling, dnd-kit optimistic update + rollback correctness, stale board state after failed PATCH. Report only defects with a concrete failure scenario (inputs/state -> wrong outcome).' },
  { key: 'security', prompt: 'Hunt SECURITY issues only: SQL injection (every query parameterized?), XSS (react-markdown config renders raw HTML? anywhere else dangerouslySetInnerHTML?), auth bypass when YESOD_PASSWORD set (all /api routes behind middleware? login timing-safe compare? cookie flags), path traversal in static/SPA file serving, MCP server injection into shell or URL building. Single-user homeserver context — do NOT report missing enterprise auth features; report real exploitable defects only.' },
  { key: 'lean-and-rules', prompt: 'Hunt (a) over-engineering: speculative abstractions, dead code, unnecessary deps, reinvented stdlib — things to DELETE; (b) CLAUDE.md rule violations: ANY Korean text in repo files (grep for Hangul in all tracked files except PLAN.md), non-English identifiers/comments/UI copy; (c) PLAN.md spec gaps: fields or endpoints from sections 3-6 that are missing or diverge. Report each as a finding.' },
]
const reviews = await parallel(DIMENSIONS.map(d => () =>
  agent(`You are reviewing the finished "Yesod" repo at ${ROOT} (Go + SQLite backend, React kanban frontend in web/, MCP server in mcp/). Read PLAN.md and CLAUDE.md first, then the code.
${d.prompt}
Max 10 findings, most severe first. No style nits.`, { label: `review:${d.key}`, schema: FINDINGS, effort: 'high' })
))
const all = reviews.filter(Boolean).flatMap(r => r.findings)
const seen = new Set()
const deduped = all.filter(f => {
  const k = f.file + '|' + f.title.toLowerCase().slice(0, 50)
  if (seen.has(k)) return false
  seen.add(k)
  return true
})
log(`${all.length} findings, ${deduped.length} after dedup`)

// ---------- Phase 6: Adversarial verify ----------
phase('Verify findings')
const verified = await parallel(deduped.map(f => () =>
  parallel(['correctness', 'exploitability/reproducibility', 'does-the-fix-matter-in-a-single-user-homeserver-context'].map(lens => () =>
    agent(`Repo: ${ROOT}. A reviewer claims this defect:
FILE: ${f.file}${f.line ? ' line ' + f.line : ''}
CLAIM: ${f.title}
DETAIL: ${f.detail}
Your job: try to REFUTE it through the "${lens}" lens by reading the actual code (and running it if needed). Default refuted=true if you cannot concretely confirm the defect and its impact.`, { label: `verify:${f.title.slice(0, 30)}`, phase: 'Verify findings', schema: VERDICT })
  )).then(votes => ({ ...f, real: votes.filter(Boolean).filter(v => !v.refuted).length >= 2 }))
))
const confirmed = verified.filter(Boolean).filter(f => f.real)
log(`${confirmed.length}/${deduped.length} findings confirmed`)

// ---------- Phase 7: Fix ----------
phase('Fix')
if (confirmed.length > 0) {
  await agent(`${PREAMBLE}

TASK: Fix ALL of these confirmed review findings. For each: reproduce/confirm, fix root cause, keep the diff minimal. After all fixes: "go vet ./..." + "go test ./..." green, "npm run build" in web/ green, "node --check mcp/index.js" passes. Add a regression test when a finding is a correctness bug in Go code.
FINDINGS:
${confirmed.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}${f.line ? ':' + f.line : ''} — ${f.title}\n   ${f.detail}`).join('\n')}`, { label: 'fix-findings', effort: 'high' })
} else {
  log('No confirmed findings — skipping fix phase')
}

// ---------- Phase 8: Final verify ----------
phase('Final verify')
const final = await agent(INTEGRATE_PROMPT, { label: 'final-verify', schema: REPORT, effort: 'high' })
return {
  status: final.ok || final.failures.every(f => f.startsWith('docker-unverified')) ? 'success' : 'final-verify-failed',
  integration: report.notes,
  findings_total: deduped.length,
  findings_confirmed: confirmed.map(f => `[${f.severity}] ${f.file} — ${f.title}`),
  final_report: final,
}
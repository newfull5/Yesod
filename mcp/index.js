#!/usr/bin/env node
// Yesod MCP server — stdio wrapper around the Yesod REST API (PLAN.md section 6).
// Env: YESOD_URL (default http://localhost:9999), YESOD_PASSWORD (optional, logs in
// automatically), YESOD_ME (optional; person name used by assign_to_me / add_comment's
// default author — no hardcoded default, matches the web UI's /api/meta).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const BASE = (process.env.YESOD_URL || 'http://localhost:9999').replace(/\/+$/, '')
const PASSWORD = process.env.YESOD_PASSWORD || ''
const ME = process.env.YESOD_ME || ''

// ---- HTTP -------------------------------------------------------------

let cookie = ''

async function request(method, path, body) {
  const headers = { 'content-type': 'application/json' }
  if (cookie) headers.cookie = cookie
  return fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// Calls the Yesod API; on 401 logs in once with YESOD_PASSWORD and retries
// (sessions are in-memory server-side, so a server restart invalidates cookies).
async function api(method, path, body) {
  let res = await request(method, path, body)
  if (res.status === 401 && PASSWORD) {
    const login = await request('POST', '/login', { password: PASSWORD })
    if (!login.ok) throw new Error(`login failed (HTTP ${login.status}) — check YESOD_PASSWORD`)
    const setCookie = login.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    res = await request(method, path, body)
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ? `${data.error} (HTTP ${res.status})` : `HTTP ${res.status}`)
  return data
}

// ---- Name -> id resolution ---------------------------------------------

// ponytail: seed issue types are fixed and the API has no GET /issue_types
// endpoint; add one (and fetch here) if types ever become editable.
const TYPE_IDS = { story: 1, bug: 2, task: 3, epic: 4 }

function resolveType(name) {
  const id = TYPE_IDS[name.trim().toLowerCase()]
  if (!id) throw new Error(`unknown issue type "${name}" (known types: Story, Bug, Task, Epic)`)
  return id
}

async function resolvePerson(name) {
  const people = await api('GET', '/people')
  const p = people.find(x => x.name.toLowerCase() === name.trim().toLowerCase())
  if (!p) throw new Error(`unknown person "${name}" (known people: ${people.map(x => x.name).join(', ') || 'none'})`)
  return p.id
}

async function resolveStatus(name, projectId) {
  const statuses = await api('GET', `/statuses?project_id=${projectId}`)
  const s = statuses.find(x => x.name.toLowerCase() === name.trim().toLowerCase())
  if (!s) throw new Error(`unknown status "${name}" for project ${projectId} (known statuses: ${statuses.map(x => x.name).join(', ')})`)
  return s.id
}

async function resolveTeam(name) {
  const teams = await api('GET', '/teams')
  const t = teams.find(x => x.name.toLowerCase() === name.trim().toLowerCase())
  if (!t) throw new Error(`unknown team "${name}" (known teams: ${teams.map(x => x.name).join(', ') || 'none'})`)
  return t.id
}

async function resolveParent(key) {
  const parent = await api('GET', `/issues/${encodeURIComponent(key.trim())}`)
  return parent.id
}

// ---- Formatting ---------------------------------------------------------

// One-line card: "YS-3 Fix login bug [In Progress] (Bug) @Saechan due 2026-07-10"
function card(i) {
  let line = `${i.key} ${i.title} [${i.status.name}]`
  if (i.type) line += ` (${i.type.name})`
  if (i.assignee) line += ` @${i.assignee.name}`
  if (i.due_date) line += ` due ${i.due_date}`
  if (i.archived_at) line += ' [archived]'
  return line
}

function detail(i) {
  const lines = [card(i)]
  const meta = []
  if (i.reporter) meta.push(`reporter ${i.reporter.name}`)
  if (i.team) meta.push(`team ${i.team.name}`)
  if (i.start_date) meta.push(`start ${i.start_date}`)
  if (i.parent) meta.push(`parent ${i.parent.key} "${i.parent.title}"`)
  if (i.sprints.length) meta.push(`sprints ${i.sprints.map(s => `${s.name} (${s.state})`).join(', ')}`)
  if (meta.length) lines.push(meta.join(' | '))
  lines.push(`created ${i.created_at} | updated ${i.updated_at}`)
  if (i.description) lines.push('', 'Description:', i.description)
  if (i.subtasks.length) {
    lines.push('', 'Subtasks:')
    for (const s of i.subtasks) lines.push(`- ${s.key} ${s.title} [${s.status.name}]`)
  }
  const linkTypes = Object.keys(i.links)
  if (linkTypes.length) {
    lines.push('', 'Links:')
    for (const lt of linkTypes) for (const l of i.links[lt]) lines.push(`- ${lt} ${l.key} "${l.title}"`)
  }
  if (i.comments.length) {
    lines.push('', 'Comments:')
    for (const c of i.comments) lines.push(`- [${c.created_at}] ${c.author ? c.author.name : 'anonymous'}: ${c.body}`)
  }
  return lines.join('\n')
}

const text = s => ({ content: [{ type: 'text', text: s }] })

// ---- Shared schema fragments --------------------------------------------

const keyParam = z.string().describe('Issue key, e.g. "YS-3" (project prefix, dash, number).')
const dateParam = desc => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').describe(desc)
const projectParam = z.number().int().optional()
  .describe('Project id (integer). Defaults to 1, the seed project. Use list_projects to see all projects.')

// ---- Server & tools ------------------------------------------------------

const server = new McpServer({ name: 'yesod', version: '0.3.0' })

server.registerTool('list_projects', {
  description: 'List all projects: id, key prefix and name. Issue keys are "<prefix>-<n>", e.g. project with prefix YS owns YS-1, YS-2, …',
  inputSchema: {},
}, async () => {
  const projects = await api('GET', '/projects')
  return text(projects.map(p => `#${p.id} ${p.key_prefix} — ${p.name}`).join('\n'))
})

server.registerTool('create_project', {
  description: 'Create a new project with its own board (To Do / In Progress / Done) and issue key prefix. Returns the new project id.',
  inputSchema: {
    name: z.string().min(1).describe('Project name, e.g. "Blog".'),
    key_prefix: z.string().min(1).describe('Issue key prefix, uppercase, no spaces/dashes, e.g. "BL" — issues become BL-1, BL-2, …'),
  },
}, async ({ name, key_prefix }) => {
  const p = await api('POST', '/projects', { name, key_prefix })
  return text(`Created project #${p.id} ${p.key_prefix} — ${p.name}`)
})

server.registerTool('list_issues', {
  description: 'List issues in the Yesod issue tracker, optionally filtered. All filters combine with AND. Returns one compact line per issue: key, title, [status], (type), @assignee, due date. Use get_issue for full details of a single issue.',
  inputSchema: {
    project_id: projectParam,
    status: z.string().optional().describe('Filter by status (column) NAME, case-insensitive, e.g. "To Do", "In Progress", "Done". Resolved against the project\'s statuses.'),
    assignee: z.string().optional().describe('Filter by assignee person NAME, case-insensitive, e.g. "Saechan".'),
    type: z.string().optional().describe('Filter by issue type name: Story, Bug, Task or Epic (case-insensitive).'),
    sprint_id: z.number().int().optional().describe('Filter by sprint id (integer). Use list_sprints to find sprint ids.'),
    q: z.string().optional().describe('Case-insensitive substring match on the issue title (literal text, no wildcards).'),
  },
}, async ({ project_id = 1, status, assignee, type, sprint_id, q }) => {
  const params = new URLSearchParams({ project_id: String(project_id) })
  if (status !== undefined) params.set('status', String(await resolveStatus(status, project_id)))
  if (assignee !== undefined) params.set('assignee', String(await resolvePerson(assignee)))
  if (type !== undefined) params.set('type', String(resolveType(type)))
  if (sprint_id !== undefined) params.set('sprint', String(sprint_id))
  if (q !== undefined) params.set('q', q)
  const issues = await api('GET', `/issues?${params}`)
  return text(issues.length ? issues.map(card).join('\n') : 'No issues match.')
})

server.registerTool('get_issue', {
  description: 'Get full details of one issue by key: title, status, type, assignee, reporter, team, dates, parent, sprints, description, subtasks, links and comments.',
  inputSchema: { key: keyParam },
}, async ({ key }) => text(detail(await api('GET', `/issues/${encodeURIComponent(key.trim())}`))))

server.registerTool('create_issue', {
  description: 'Create a new issue. Only "title" is required (project defaults to 1). Status defaults to the project\'s first board column; the new card is placed at the bottom of that column. Returns the created issue including its new key (e.g. "YS-7").',
  inputSchema: {
    project_id: projectParam,
    title: z.string().min(1).describe('Issue title (required, non-empty).'),
    description: z.string().optional().describe('Issue description, markdown allowed.'),
    type: z.string().optional().describe('Issue type name: Story, Bug, Task or Epic (case-insensitive).'),
    status: z.string().optional().describe('Status (board column) NAME, e.g. "In Progress". Defaults to the project\'s first column.'),
    assignee: z.string().optional().describe('Assignee person NAME, e.g. "Saechan".'),
    reporter: z.string().optional().describe('Reporter person NAME.'),
    team: z.string().optional().describe('Team NAME, e.g. "Platform".'),
    parent_key: z.string().optional().describe('Key of the parent issue (same project), e.g. "YS-5". Makes this issue a subtask of it.'),
    start_date: dateParam('Start date as YYYY-MM-DD.').optional(),
    due_date: dateParam('Due date as YYYY-MM-DD.').optional(),
    sprint_ids: z.array(z.number().int()).optional().describe('Sprint ids (integers) to add the issue to. Use list_sprints to find ids.'),
  },
}, async (a) => {
  const body = { project_id: a.project_id ?? 1, title: a.title }
  if (a.description !== undefined) body.description = a.description
  if (a.type !== undefined) body.type_id = resolveType(a.type)
  if (a.status !== undefined) body.status_id = await resolveStatus(a.status, body.project_id)
  if (a.assignee !== undefined) body.assignee_id = await resolvePerson(a.assignee)
  if (a.reporter !== undefined) body.reporter_id = await resolvePerson(a.reporter)
  if (a.team !== undefined) body.team_id = await resolveTeam(a.team)
  if (a.parent_key !== undefined) body.parent_id = await resolveParent(a.parent_key)
  if (a.start_date !== undefined) body.start_date = a.start_date
  if (a.due_date !== undefined) body.due_date = a.due_date
  if (a.sprint_ids !== undefined) body.sprint_ids = a.sprint_ids
  const issue = await api('POST', '/issues', body)
  return text(`Created ${card(issue)}`)
})

server.registerTool('update_issue', {
  description: 'Update fields of an existing issue by key. Only the fields you pass are changed; pass null for a nullable field (description, assignee, reporter, team, parent_key, dates) to clear it. Use this to move an issue between board columns by passing a status name, e.g. status "Done". sprint_ids REPLACES the whole sprint set ([] clears all).',
  inputSchema: {
    key: keyParam,
    title: z.string().min(1).optional().describe('New title (non-empty).'),
    description: z.string().nullable().optional().describe('New description (markdown), or null to clear it.'),
    type: z.string().optional().describe('New issue type name: Story, Bug, Task or Epic (case-insensitive).'),
    status: z.string().optional().describe('New status (board column) NAME, e.g. "In Progress" or "Done" — moves the card to the bottom of that column.'),
    assignee: z.string().nullable().optional().describe('New assignee person NAME, or null to unassign.'),
    reporter: z.string().nullable().optional().describe('New reporter person NAME, or null to clear.'),
    team: z.string().nullable().optional().describe('New team NAME, or null to clear.'),
    parent_key: z.string().nullable().optional().describe('Key of the new parent issue (same project), or null to detach from its parent.'),
    start_date: dateParam('New start date as YYYY-MM-DD.').nullable().optional().describe('New start date as YYYY-MM-DD, or null to clear.'),
    due_date: dateParam('New due date as YYYY-MM-DD.').nullable().optional().describe('New due date as YYYY-MM-DD, or null to clear.'),
    sprint_ids: z.array(z.number().int()).optional().describe('Full new set of sprint ids — REPLACES existing sprints; [] removes the issue from all sprints.'),
    archived: z.boolean().optional().describe('true archives the issue (leaves the board, kept in Backlog → Archive); false restores it.'),
  },
}, async (a) => {
  const key = a.key.trim()
  const patch = {}
  if (a.archived !== undefined) patch.archived = a.archived
  if (a.title !== undefined) patch.title = a.title
  if (a.description !== undefined) patch.description = a.description
  if (a.type !== undefined) patch.type_id = resolveType(a.type)
  if (a.assignee !== undefined) patch.assignee_id = a.assignee === null ? null : await resolvePerson(a.assignee)
  if (a.reporter !== undefined) patch.reporter_id = a.reporter === null ? null : await resolvePerson(a.reporter)
  if (a.team !== undefined) patch.team_id = a.team === null ? null : await resolveTeam(a.team)
  if (a.parent_key !== undefined) patch.parent_id = a.parent_key === null ? null : await resolveParent(a.parent_key)
  if (a.start_date !== undefined) patch.start_date = a.start_date
  if (a.due_date !== undefined) patch.due_date = a.due_date
  if (a.sprint_ids !== undefined) patch.sprint_ids = a.sprint_ids
  if (a.status !== undefined) {
    const issue = await api('GET', `/issues/${encodeURIComponent(key)}`)
    patch.status_id = await resolveStatus(a.status, issue.project_id)
  }
  if (Object.keys(patch).length === 0) throw new Error('nothing to update — pass at least one field besides key')
  const issue = await api('PATCH', `/issues/${encodeURIComponent(key)}`, patch)
  return text(`Updated ${card(issue)}`)
})

server.registerTool('assign_to_me', {
  description: `Assign an issue to me (the person named by the YESOD_ME env var${ME ? `, currently "${ME}"` : ' — not currently set'}). Shortcut for update_issue with my name as assignee.`,
  inputSchema: { key: keyParam },
}, async ({ key }) => {
  if (!ME) throw new Error('YESOD_ME is not set — configure it to use assign_to_me')
  const issue = await api('PATCH', `/issues/${encodeURIComponent(key.trim())}`, { assignee_id: await resolvePerson(ME) })
  return text(`Assigned ${card(issue)}`)
})

server.registerTool('add_comment', {
  description: `Add a comment to an issue. Authored by the person named by YESOD_ME${ME ? ` ("${ME}")` : ''} when that person exists, otherwise anonymous; pass author to override.`,
  inputSchema: {
    key: keyParam,
    body: z.string().min(1).describe('Comment text (required, non-empty).'),
    author: z.string().optional().describe('Author person NAME. Defaults to the YESOD_ME person if set and known; otherwise falls back to anonymous.'),
  },
}, async ({ key, body, author }) => {
  const payload = { body }
  if (author !== undefined) payload.author_id = await resolvePerson(author)
  else if (ME) payload.author_id = await resolvePerson(ME).catch(() => undefined)
  if (payload.author_id === undefined) delete payload.author_id
  const c = await api('POST', `/issues/${encodeURIComponent(key.trim())}/comments`, payload)
  return text(`Comment added to ${key.trim()} by ${c.author ? c.author.name : 'anonymous'} at ${c.created_at}: ${c.body}`)
})

server.registerTool('link_issues', {
  description: 'Link two issues. link_type is directional from the first issue: "YS-1 blocks YS-2" means YS-2 cannot proceed until YS-1 is done.',
  inputSchema: {
    key: keyParam,
    link_type: z.enum(['blocks', 'is blocked by', 'relates to']).describe('Relationship from key to linked_key.'),
    linked_key: z.string().describe('Key of the issue to link to, e.g. "YS-5".'),
  },
}, async ({ key, link_type, linked_key }) => {
  await api('POST', `/issues/${encodeURIComponent(key.trim())}/links`, { link_type, linked_key: linked_key.trim() })
  return text(`Linked: ${key.trim()} ${link_type} ${linked_key.trim()}`)
})

server.registerTool('unlink_issues', {
  description: 'Remove an existing link between two issues. Must match the original direction and link_type (see get_issue\'s Links section).',
  inputSchema: {
    key: keyParam,
    link_type: z.enum(['blocks', 'is blocked by', 'relates to']).describe('Relationship of the existing link.'),
    linked_key: z.string().describe('Key of the linked issue.'),
  },
}, async ({ key, link_type, linked_key }) => {
  await api('DELETE', `/issues/${encodeURIComponent(key.trim())}/links`, { link_type, linked_key: linked_key.trim() })
  return text(`Unlinked: ${key.trim()} ${link_type} ${linked_key.trim()}`)
})

server.registerTool('list_statuses', {
  description: 'List the board columns (statuses) of a project: name and category (todo/in_progress/done). These are the valid values for the "status" params.',
  inputSchema: { project_id: projectParam },
}, async ({ project_id = 1 }) => {
  const statuses = await api('GET', `/statuses?project_id=${project_id}`)
  return text(statuses.map(s => `${s.name} (${s.category})`).join('\n'))
})

server.registerTool('add_column', {
  description: 'Add a new board column (status) to a project. It appears after the existing columns.',
  inputSchema: {
    project_id: projectParam,
    name: z.string().min(1).describe('Column name, e.g. "In Review".'),
    category: z.enum(['todo', 'in_progress', 'done']).describe('Column category (controls color and done-column behavior).'),
  },
}, async ({ project_id = 1, name, category }) => {
  const s = await api('POST', '/statuses', { project_id, name, category })
  return text(`Added column "${s.name}" (${s.category}) to project ${project_id}`)
})

server.registerTool('delete_column', {
  description: 'Delete a board column. The last column of a project cannot be deleted, and issues are never lost: everything in the column (archived history included) moves to the move_to column, which is required when the column is not empty.',
  inputSchema: {
    project_id: projectParam,
    name: z.string().min(1).describe('Column NAME to delete, e.g. "In Review".'),
    move_to: z.string().optional().describe('Column NAME to move the issues to. Required if the column has any issues.'),
  },
}, async ({ project_id = 1, name, move_to }) => {
  const id = await resolveStatus(name, project_id)
  const qs = move_to !== undefined ? `?move_to=${await resolveStatus(move_to, project_id)}` : ''
  const res = await api('DELETE', `/statuses/${id}${qs}`)
  const moved = res?.moved ?? 0
  return text(`Deleted column "${name}"${moved ? ` — moved ${moved} issue(s) to ${move_to}` : ''}`)
})

server.registerTool('archive_column', {
  description: 'Archive every issue in a done-category column (same as the board\'s "Clear" button): the cards leave the board but stay in the database, visible in Backlog → Archive. Only done columns can be cleared. Returns the number of issues archived.',
  inputSchema: {
    project_id: projectParam,
    status: z.string().min(1).describe('Column (status) NAME to clear, case-insensitive, e.g. "Done". Must be a done-category column.'),
  },
}, async ({ project_id = 1, status }) => {
  const id = await resolveStatus(status, project_id)
  const res = await api('POST', `/statuses/${id}/clear`)
  return text(`Archived ${res.archived} issue(s) from "${status}" in project ${project_id}`)
})

server.registerTool('list_people', {
  description: 'List all people (usable as assignee/reporter/comment author names).',
  inputSchema: {},
}, async () => {
  const people = await api('GET', '/people')
  return text(people.length ? people.map(p => p.name).join('\n') : 'No people yet.')
})

server.registerTool('create_person', {
  description: 'Add a person so they can be assigned to issues.',
  inputSchema: { name: z.string().min(1).describe('Person name, e.g. "Saechan".') },
}, async ({ name }) => {
  const p = await api('POST', '/people', { name })
  return text(`Added person ${p.name}`)
})

server.registerTool('list_teams', {
  description: 'List all teams (usable as the team name on issues).',
  inputSchema: {},
}, async () => {
  const teams = await api('GET', '/teams')
  return text(teams.length ? teams.map(t => t.name).join('\n') : 'No teams yet.')
})

server.registerTool('create_team', {
  description: 'Add a team so issues can be tagged with it.',
  inputSchema: { name: z.string().min(1).describe('Team name, e.g. "Platform".') },
}, async ({ name }) => {
  const t = await api('POST', '/teams', { name })
  return text(`Added team ${t.name}`)
})

server.registerTool('list_sprints', {
  description: 'List sprints of a project with their id, dates and state (future/active/closed). Use the returned ids as sprint_ids in create_issue/update_issue or sprint_id in list_issues.',
  inputSchema: { project_id: projectParam },
}, async ({ project_id = 1 }) => {
  const sprints = await api('GET', `/sprints?project_id=${project_id}`)
  return text(sprints.length
    ? sprints.map(s => `#${s.id} ${s.name} [${s.state}]${s.start_date ? ` ${s.start_date}` : ''}${s.end_date ? ` → ${s.end_date}` : ''}`).join('\n')
    : 'No sprints in this project.')
})

server.registerTool('create_sprint', {
  description: 'Create a sprint in a project. State defaults to "future"; set it to "active" to start it immediately.',
  inputSchema: {
    project_id: projectParam,
    name: z.string().min(1).describe('Sprint name, e.g. "Sprint 3".'),
    start_date: dateParam('Start date as YYYY-MM-DD.').optional(),
    end_date: dateParam('End date as YYYY-MM-DD.').optional(),
    state: z.enum(['future', 'active', 'closed']).optional().describe('Sprint state. Defaults to "future".'),
  },
}, async ({ project_id = 1, name, start_date, end_date, state }) => {
  const body = { project_id, name }
  if (start_date !== undefined) body.start_date = start_date
  if (end_date !== undefined) body.end_date = end_date
  if (state !== undefined) body.state = state
  const s = await api('POST', '/sprints', body)
  return text(`Created sprint #${s.id} ${s.name} [${s.state}]`)
})

server.registerTool('update_sprint', {
  description: 'Update a sprint by id: rename, change dates (null clears a date), or change state (future/active/closed).',
  inputSchema: {
    sprint_id: z.number().int().describe('Sprint id (integer). Use list_sprints to find it.'),
    name: z.string().min(1).optional().describe('New sprint name.'),
    start_date: dateParam('New start date as YYYY-MM-DD.').nullable().optional().describe('New start date, or null to clear.'),
    end_date: dateParam('New end date as YYYY-MM-DD.').nullable().optional().describe('New end date, or null to clear.'),
    state: z.enum(['future', 'active', 'closed']).optional().describe('New sprint state.'),
  },
}, async ({ sprint_id, ...a }) => {
  const patch = {}
  for (const f of ['name', 'start_date', 'end_date', 'state']) if (a[f] !== undefined) patch[f] = a[f]
  if (Object.keys(patch).length === 0) throw new Error('nothing to update — pass at least one field besides sprint_id')
  const s = await api('PATCH', `/sprints/${sprint_id}`, patch)
  return text(`Updated sprint #${s.id} ${s.name} [${s.state}]${s.start_date ? ` ${s.start_date}` : ''}${s.end_date ? ` → ${s.end_date}` : ''}`)
})

server.registerTool('delete_issue', {
  description: 'PERMANENTLY delete an issue by key — irreversible, comments and links included; subtasks are detached, not deleted. To merely hide an issue from the board, use update_issue with archived: true instead.',
  inputSchema: { key: keyParam },
}, async ({ key }) => {
  await api('DELETE', `/issues/${encodeURIComponent(key.trim())}`)
  return text(`Deleted ${key.trim()} permanently`)
})

server.registerTool('delete_project', {
  description: 'PERMANENTLY delete a project and EVERYTHING in it — all issues, sprints and board columns. Irreversible. As confirmation, confirm_prefix must match the project\'s issue key prefix (see list_projects).',
  inputSchema: {
    project_id: z.number().int().describe('Project id (integer) to delete. Use list_projects to find it.'),
    confirm_prefix: z.string().describe('The project\'s key prefix, e.g. "YS" — must match, as a deliberate confirmation of which project dies.'),
  },
}, async ({ project_id, confirm_prefix }) => {
  const projects = await api('GET', '/projects')
  const p = projects.find(x => x.id === project_id)
  if (!p) throw new Error(`no project with id ${project_id} (known: ${projects.map(x => `#${x.id} ${x.key_prefix}`).join(', ')})`)
  if (p.key_prefix !== confirm_prefix.trim().toUpperCase()) {
    throw new Error(`confirm_prefix "${confirm_prefix}" does not match project #${p.id}'s prefix "${p.key_prefix}" — refusing to delete`)
  }
  await api('DELETE', `/projects/${p.id}`)
  return text(`Deleted project #${p.id} ${p.key_prefix} — ${p.name}, with all its issues, sprints and columns`)
})

await server.connect(new StdioServerTransport())

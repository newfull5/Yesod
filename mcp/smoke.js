#!/usr/bin/env node
// Smoke test for the Yesod MCP server. Requires a running Yesod API.
// Usage: YESOD_URL=http://localhost:8398 node smoke.js
// Drives index.js over stdio using the official MCP SDK client (spawn,
// handshake, tools/list, tools/call). Exits 0 on success, 1 on any failure.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import assert from 'node:assert'

const BASE = (process.env.YESOD_URL || 'http://localhost:9999').replace(/\/+$/, '')

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL('./index.js', import.meta.url).pathname],
  env: process.env,
})
const client = new Client({ name: 'yesod-smoke', version: '0.0.0' })

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args })
  assert(!res.isError, `tool ${name} errored: ${res.content?.[0]?.text}`)
  return res.content[0].text
}

try {
  // create_issue/list_issues need a real assignee; the seed no longer bakes
  // one in (people start empty), so make one via the REST API directly.
  const personRes = await fetch(`${BASE}/api/people`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke Tester' }),
  })
  assert(personRes.ok, `create person failed: HTTP ${personRes.status}`)

  await client.connect(transport)

  const { tools } = await client.listTools()
  const names = tools.map((t) => t.name).sort()
  for (const want of ['add_comment', 'assign_to_me', 'create_issue', 'get_issue', 'list_issues', 'list_sprints', 'update_issue',
    'list_projects', 'create_project', 'list_statuses', 'add_column', 'delete_column', 'link_issues', 'unlink_issues',
    'list_people', 'create_person', 'list_teams', 'create_team', 'create_sprint', 'update_sprint',
    'delete_issue', 'delete_project', 'archive_column']) {
    assert(names.includes(want), `missing tool ${want}; got ${names}`)
  }
  assert(tools.every((t) => t.description.length > 20), 'every tool has a rich description')

  const created = await call('create_issue', {
    title: 'Smoke test issue',
    type: 'Bug',
    assignee: 'Smoke Tester',
    due_date: '2026-07-31',
  })
  const key = created.match(/[A-Z]+-\d+/)?.[0]
  assert(key, `created output has an issue key: ${created}`)
  assert(created.includes('(Bug)') && created.includes('@Smoke Tester') && created.includes('due 2026-07-31'), `create output: ${created}`)

  const listed = await call('list_issues', { assignee: 'Smoke Tester', q: 'smoke test' })
  assert(listed.includes(key), `list_issues finds ${key}: ${listed}`)

  const updated = await call('update_issue', { key, status: 'In Progress' })
  assert(updated.includes('[In Progress]'), `status changed: ${updated}`)

  const commented = await call('add_comment', { key, body: 'smoke comment' })
  assert(commented.includes('smoke comment'), `comment output: ${commented}`)

  const got = await call('get_issue', { key })
  assert(got.includes('[In Progress]') && got.includes('smoke comment'), `detail output: ${got}`)

  const sprints = await call('list_sprints', {})
  assert(typeof sprints === 'string' && sprints.length > 0, 'list_sprints returns text')

  // v0.2.0 tools — issue key number makes names/prefixes unique per run.
  const run = key.match(/\d+/)[0]

  const projects = await call('list_projects', {})
  assert(projects.includes('#1'), `list_projects: ${projects}`)
  const proj = await call('create_project', { name: `Smoke ${run}`, key_prefix: `SM${run}` })
  const pid = Number(proj.match(/#(\d+)/)?.[1])
  assert(pid > 1, `create_project: ${proj}`)
  const cols = await call('list_statuses', { project_id: pid })
  assert(cols.includes('To Do (todo)') && cols.includes('Done (done)'), `default columns seeded: ${cols}`)
  const added = await call('add_column', { project_id: pid, name: 'In Review', category: 'in_progress' })
  assert(added.includes('In Review'), `add_column: ${added}`)
  const delCol = await call('delete_column', { project_id: pid, name: 'In Review', move_to: 'To Do' })
  assert(delCol.includes('Deleted column'), `delete_column: ${delCol}`)

  const other = await call('create_issue', { title: 'Smoke link target' })
  const otherKey = other.match(/[A-Z]+-\d+/)?.[0]
  const linked = await call('link_issues', { key, link_type: 'blocks', linked_key: otherKey })
  assert(linked.includes('blocks'), `link_issues: ${linked}`)
  assert((await call('get_issue', { key })).includes(otherKey), `link visible in get_issue`)
  await call('unlink_issues', { key, link_type: 'blocks', linked_key: otherKey })

  const sp = await call('create_sprint', { name: `Smoke sprint ${run}`, state: 'active' })
  const spId = Number(sp.match(/#(\d+)/)?.[1])
  const spUpd = await call('update_sprint', { sprint_id: spId, state: 'closed' })
  assert(spUpd.includes('[closed]'), `update_sprint: ${spUpd}`)

  const archived = await call('update_issue', { key: otherKey, archived: true })
  assert(archived.includes('[archived]'), `archive marker: ${archived}`)

  assert((await call('list_people', {})).includes('Smoke Tester'), 'list_people includes Smoke Tester')
  await call('create_team', { name: `Smoke team ${run}` })
  assert((await call('list_teams', {})).includes(`Smoke team ${run}`), 'list_teams includes new team')

  // archive_column — bulk-archive the smoke project's Done column.
  const doneIssue = await call('create_issue', { project_id: pid, title: 'Smoke archive target', status: 'Done' })
  assert(doneIssue.includes('[Done]'), `issue in Done: ${doneIssue}`)
  const cleared = await call('archive_column', { project_id: pid, status: 'Done' })
  assert(cleared.includes('Archived 1 issue'), `archive_column: ${cleared}`)
  const notDone = await client.callTool({ name: 'archive_column', arguments: { project_id: pid, status: 'To Do' } })
  assert(notDone.isError, 'archive_column refuses a non-done column')

  // v0.3.0 tools — hard deletes; doubles as cleanup of the smoke project.
  const gone = await call('delete_issue', { key: otherKey })
  assert(gone.includes('Deleted'), `delete_issue: ${gone}`)
  const stillThere = await client.callTool({ name: 'get_issue', arguments: { key: otherKey } })
  assert(stillThere.isError, 'deleted issue is really gone')
  const badPrefix = await client.callTool({ name: 'delete_project', arguments: { project_id: pid, confirm_prefix: 'NOPE' } })
  assert(badPrefix.isError, 'delete_project refuses a wrong confirm_prefix')
  const delProj = await call('delete_project', { project_id: pid, confirm_prefix: `SM${run}` })
  assert(delProj.includes('Deleted project'), `delete_project: ${delProj}`)
  assert(!(await call('list_projects', {})).includes(`SM${run}`), 'smoke project really gone')

  console.log(`SMOKE OK (${key})`)
  process.exitCode = 0
} catch (err) {
  console.error('SMOKE FAILED:', err.message)
  process.exitCode = 1
} finally {
  await client.close()
}

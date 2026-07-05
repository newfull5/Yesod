#!/usr/bin/env node
// Smoke test for the Yesod MCP server. Requires a running Yesod API.
// Usage: YESOD_URL=http://localhost:8398 node smoke.js
// Drives index.js over stdio using the official MCP SDK client (spawn,
// handshake, tools/list, tools/call). Exits 0 on success, 1 on any failure.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import assert from 'node:assert'

const BASE = (process.env.YESOD_URL || 'http://localhost:8080').replace(/\/+$/, '')

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
  for (const want of ['add_comment', 'assign_to_me', 'create_issue', 'get_issue', 'list_issues', 'list_sprints', 'update_issue']) {
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

  console.log(`SMOKE OK (${key})`)
  process.exitCode = 0
} catch (err) {
  console.error('SMOKE FAILED:', err.message)
  process.exitCode = 1
} finally {
  await client.close()
}

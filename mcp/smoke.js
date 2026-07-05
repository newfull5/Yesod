#!/usr/bin/env node
// Smoke test for the Yesod MCP server. Requires a running Yesod API.
// Usage: YESOD_URL=http://localhost:8398 node smoke.js
// Drives index.js over stdio with raw JSON-RPC (newline-delimited) and asserts
// each tool produces sane output. Exits 0 on success, 1 on any failure.
import { spawn } from 'node:child_process'
import assert from 'node:assert'

const child = spawn(process.execPath, [new URL('./index.js', import.meta.url).pathname], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'inherit'],
})

let buf = ''
const pending = new Map()
child.stdout.on('data', chunk => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim()
    buf = buf.slice(nl + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.id !== undefined && pending.has(msg.id)) {
      const settle = pending.get(msg.id)
      pending.delete(msg.id)
      settle(msg)
    }
  }
})

let nextId = 1
function rpc(method, params) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`timeout waiting for ${method}`))
    }, 10000)
    pending.set(id, msg => {
      clearTimeout(timer)
      msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result)
    })
  })
}
const notify = (method, params) =>
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
const call = async (name, args) => {
  const res = await rpc('tools/call', { name, arguments: args })
  assert(!res.isError, `tool ${name} errored: ${res.content?.[0]?.text}`)
  return res.content[0].text
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'yesod-smoke', version: '0.0.0' },
  })
  assert.equal(init.serverInfo.name, 'yesod', 'server name')
  notify('notifications/initialized')

  const { tools } = await rpc('tools/list', {})
  const names = tools.map(t => t.name).sort()
  for (const want of ['add_comment', 'assign_to_me', 'create_issue', 'get_issue', 'list_issues', 'list_sprints', 'update_issue']) {
    assert(names.includes(want), `missing tool ${want}; got ${names}`)
  }
  assert(tools.every(t => t.description.length > 20), 'every tool has a rich description')

  const created = await call('create_issue', {
    title: 'Smoke test issue',
    type: 'Bug',
    assignee: 'Saechan',
    due_date: '2026-07-31',
  })
  const key = created.match(/[A-Z]+-\d+/)?.[0]
  assert(key, `created output has an issue key: ${created}`)
  assert(created.includes('(Bug)') && created.includes('@Saechan') && created.includes('due 2026-07-31'), `create output: ${created}`)

  const listed = await call('list_issues', { assignee: 'Saechan', q: 'smoke test' })
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
  child.kill()
}

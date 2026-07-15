// Types mirror the REST API contract (see server internal/api).

export type Person = { id: number; name: string; avatar_color: string | null }
export type Team = { id: number; name: string }
export type Project = { id: number; key_prefix: string; name: string; next_issue_num: number }
export type TypeRef = { id: number; name: string; icon: string }
export type StatusRef = { id: number; name: string; category: string }
export type Status = { id: number; project_id: number; name: string; category: string; board_order: number }
export type Sprint = {
  id: number
  project_id: number
  name: string
  start_date: string | null
  end_date: string | null
  state: 'future' | 'active' | 'closed'
}

export type Card = {
  id: number
  key: string
  project_id: number
  title: string
  type: TypeRef | null
  status: StatusRef
  assignee: Person | null
  parent_id: number | null
  start_date: string | null
  due_date: string | null
  board_order: number
  sprint_ids: number[]
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type Column = { id: number; name: string; category: string; board_order: number; issues: Card[] }

export type Comment = {
  id: number
  author: { id: number; name: string } | null
  body: string
  created_at: string
}

export type AgentJob = {
  id: number
  issue_id: number
  issue_key: string
  status: 'queued' | 'running' | 'done' | 'failed'
  result: string | null
  log: string | null
  requested_by: string | null
  created_at: string
  updated_at: string
}

export type Detail = Card & {
  description: string | null
  reporter: Person | null
  team: Team | null
  parent: { key: string; title: string } | null
  sprints: { id: number; name: string; state: string }[]
  subtasks: { key: string; title: string; status: StatusRef }[]
  links: Record<string, { key: string; title: string }[]>
  comments: Comment[]
  agent_job: AgentJob | null
}

// ponytail: no /api/issue_types endpoint; seed types are fixed on the server.
export const ISSUE_TYPES: TypeRef[] = [
  { id: 1, name: 'Story', icon: 'story' },
  { id: 2, name: 'Bug', icon: 'bug' },
  { id: 3, name: 'Task', icon: 'task' },
  { id: 4, name: 'Epic', icon: 'epic' },
]

export const LINK_TYPES = ['blocks', 'is blocked by', 'relates to'] as const

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  // Relative URL: resolves to /api at the root and /<subpath>/api behind a
  // path-prefixed reverse proxy (routing is hash-based, so the document
  // path is stable).
  const res = await fetch('api' + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401 && path !== '/login') onUnauthorized?.()
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const data = (await res.json()) as { error?: string }
      if (data.error) msg = data.error
    } catch {
      // non-JSON error body; keep status text
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

import { useCallback, useEffect, useState } from 'react'
import { api, setUnauthorizedHandler, ISSUE_TYPES } from './api'
import type { Detail, Person, Project, Sprint, Status, Team } from './api'
import Board from './Board'
import Backlog from './Backlog'
import IssueModal from './IssueModal'

export type Filters = { sprint: number | null; assignee: number | null; type: number | null; q: string }

const NO_FILTERS: Filters = { sprint: null, assignee: null, type: null, q: '' }

export default function App() {
  const [needLogin, setNeedLogin] = useState(false)
  const [fatal, setFatal] = useState('')
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [sprints, setSprints] = useState<Sprint[]>([])
  const [statuses, setStatuses] = useState<Status[]>([])
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [view, setView] = useState<'board' | 'backlog'>(location.hash === '#backlog' ? 'backlog' : 'board')
  const [modalKey, setModalKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [version, setVersion] = useState(0)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    setUnauthorizedHandler(() => setNeedLogin(true))
    const onHash = () => setView(location.hash === '#backlog' ? 'backlog' : 'board')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (needLogin) return
    api<Project[]>('/projects')
      .then((ps) => {
        setProjects(ps)
        setProjectId((pid) => (pid != null && ps.some((p) => p.id === pid) ? pid : (ps[0]?.id ?? null)))
        setFatal('')
      })
      .catch((e: Error) => setFatal(e.message))
    api<Person[]>('/people').then(setPeople).catch(() => {})
    api<Team[]>('/teams').then(setTeams).catch(() => {})
  }, [needLogin, version])

  useEffect(() => {
    if (needLogin || projectId == null) return
    api<Sprint[]>(`/sprints?project_id=${projectId}`).then(setSprints).catch(() => {})
    api<Status[]>(`/statuses?project_id=${projectId}`).then(setStatuses).catch(() => {})
  }, [needLogin, projectId, version])

  const me = people.find((p) => p.name === 'Saechan') ?? null

  if (needLogin) {
    return (
      <Login
        onDone={() => {
          setNeedLogin(false)
          bump()
        }}
      />
    )
  }
  if (fatal) return <div className="center-msg">Failed to load: {fatal}</div>
  if (projects === null) return <div className="center-msg">Loading…</div>

  return (
    <>
      <header className="topbar">
        <span className="brand" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img src="/favicon.png" alt="Yesod" style={{ width: '20px', height: '20px', borderRadius: '4px' }} />
          Yesod
        </span>
        <select
          value={projectId ?? ''}
          onChange={(e) => {
            setProjectId(Number(e.target.value))
            setFilters(NO_FILTERS)
          }}
          title="Project"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.key_prefix} — {p.name}
            </option>
          ))}
        </select>
        <nav>
          <a href="#" className={view === 'board' ? 'active' : ''}>
            Board
          </a>
          <a href="#backlog" className={view === 'backlog' ? 'active' : ''}>
            Backlog
          </a>
        </nav>
        {view === 'board' && (
          <div className="filters">
            <select
              value={filters.sprint ?? ''}
              onChange={(e) => setFilters({ ...filters, sprint: e.target.value ? Number(e.target.value) : null })}
              title="Sprint"
            >
              <option value="">All sprints</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={filters.assignee ?? ''}
              onChange={(e) => setFilters({ ...filters, assignee: e.target.value ? Number(e.target.value) : null })}
              title="Assignee"
            >
              <option value="">All assignees</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              value={filters.type ?? ''}
              onChange={(e) => setFilters({ ...filters, type: e.target.value ? Number(e.target.value) : null })}
              title="Type"
            >
              <option value="">All types</option>
              {ISSUE_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              type="search"
              placeholder="Search issues"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </div>
        )}
        <button className="btn primary" onClick={() => setCreating(true)} disabled={projectId == null}>
          + Create issue
        </button>
      </header>

      <main>
        {projectId != null && view === 'board' && (
          <Board projectId={projectId} filters={filters} version={version} onOpen={setModalKey} />
        )}
        {projectId != null && view === 'backlog' && (
          <Backlog projectId={projectId} sprints={sprints} version={version} onOpen={setModalKey} />
        )}
      </main>

      {creating && projectId != null && (
        <CreateIssue
          projectId={projectId}
          statuses={statuses}
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false)
            bump()
            setModalKey(key)
          }}
        />
      )}

      {modalKey && projectId != null && (
        <IssueModal
          key={modalKey}
          issueKey={modalKey}
          projectId={projectId}
          people={people}
          teams={teams}
          statuses={statuses}
          sprints={sprints}
          me={me}
          onClose={() => setModalKey(null)}
          onChanged={bump}
        />
      )}
    </>
  )
}

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  return (
    <div className="login-wrap">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault()
          api('/login', 'POST', { password })
            .then(onDone)
            .catch((er: Error) => setErr(er.message))
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '20px' }}>
          <img src="/favicon.png" alt="Yesod" style={{ width: '48px', height: '48px', borderRadius: '8px' }} />
          <h1 style={{ margin: 0, fontSize: '32px' }}>Yesod</h1>
        </div>
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        <button className="btn primary" type="submit">
          Log in
        </button>
        {err && <p className="error">{err}</p>}
      </form>
    </div>
  )
}

function CreateIssue({
  projectId,
  statuses,
  onClose,
  onCreated,
}: {
  projectId: number
  statuses: Status[]
  onClose: () => void
  onCreated: (key: string) => void
}) {
  const [title, setTitle] = useState('')
  const [typeId, setTypeId] = useState(3) // Task
  const [statusId, setStatusId] = useState<number | ''>('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim() || busy) return
          setBusy(true)
          api<Detail>('/issues', 'POST', {
            project_id: projectId,
            title: title.trim(),
            type_id: typeId,
            ...(statusId !== '' ? { status_id: statusId } : {}),
          })
            .then((d) => onCreated(d.key))
            .catch((er: Error) => {
              setErr(er.message)
              setBusy(false)
            })
        }}
      >
        <h2>Create issue</h2>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <div className="dialog-row">
          <select value={typeId} onChange={(e) => setTypeId(Number(e.target.value))} title="Type">
            {ISSUE_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={statusId}
            onChange={(e) => setStatusId(e.target.value ? Number(e.target.value) : '')}
            title="Status"
          >
            <option value="">Default status</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {err && <p className="error">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!title.trim() || busy}>
            Create
          </button>
        </div>
      </form>
    </div>
  )
}

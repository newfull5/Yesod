import { useCallback, useEffect, useState } from 'react'
import { api, setUnauthorizedHandler, ISSUE_TYPES } from './api'
import type { Detail, Person, Project, Sprint, Status, Team } from './api'
import Board from './Board'
import Backlog, { NewSprint } from './Backlog'
import IssueModal from './IssueModal'
import { Dropdown, TypeIcon } from './ui'

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
  const [me, setMe] = useState<Person | null>(null)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [view, setView] = useState<'board' | 'backlog'>(location.hash === '#backlog' ? 'backlog' : 'board')
  const [modalKey, setModalKey] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ statusId?: number } | null>(null)
  const [newProject, setNewProject] = useState(false)
  const [creatingSprint, setCreatingSprint] = useState(false)
  const [deletingProject, setDeletingProject] = useState<Project | null>(null)
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
    // "Me" is whichever person the server's YESOD_ME env var names (null if unset/unmatched).
    api<{ me: Person | null }>('/meta').then((m) => setMe(m.me)).catch(() => {})
  }, [needLogin, version])

  useEffect(() => {
    if (needLogin || projectId == null) return
    api<Sprint[]>(`/sprints?project_id=${projectId}`).then(setSprints).catch(() => {})
    api<Status[]>(`/statuses?project_id=${projectId}`).then(setStatuses).catch(() => {})
  }, [needLogin, projectId, version])

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

  const project = projects.find((p) => p.id === projectId)

  return (
    <>
      <header className="topbar">
        <span className="brand">
          <img src="logo.png" alt="Yesod" className="brand-logo" />
          Yesod
        </span>

        <Dropdown
          className="project-picker"
          value={String(projectId ?? '')}
          options={[
            ...projects.map((p) => ({
              value: String(p.id),
              label: `${p.key_prefix} — ${p.name}`,
              trailing: {
                title: `Delete ${p.name}`,
                icon: (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5 5.3 14h5.4l.8-9.5M6.8 7v4.5M9.2 7v4.5" />
                  </svg>
                ),
                onClick: () => setDeletingProject(p),
              },
            })),
            { value: 'new', label: '+ New project' },
          ]}
          onChange={(v) => {
            if (v === 'new') return setNewProject(true)
            setProjectId(Number(v))
            setFilters(NO_FILTERS)
          }}
          renderValue={() => (
            <>
              <span className="project-dot" />
              {project ? `${project.key_prefix} — ${project.name}` : 'Select project'}
            </>
          )}
        />

        <nav>
          <a href="#" className={view === 'board' ? 'active' : ''}>
            Board
          </a>
          <a href="#backlog" className={view === 'backlog' ? 'active' : ''}>
            Backlog
          </a>
        </nav>

        <span className="spacer" />

        <ThemeToggle />

        <button className="btn primary" onClick={() => setCreating({})} disabled={projectId == null}>
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
            <path d="M8 2v12M2 8h12" />
          </svg>
          Create issue
        </button>
      </header>

      {view === 'board' && (
        <div className="filter-row">
          <Dropdown
            value={filters.sprint != null ? String(filters.sprint) : ''}
            placeholder="All sprints"
            options={[{ value: '', label: 'All sprints' }, ...sprints.map((s) => ({ value: String(s.id), label: s.name }))]}
            onChange={(v) => setFilters({ ...filters, sprint: v ? Number(v) : null })}
          />
          <button className="btn" onClick={() => setCreatingSprint(true)} disabled={projectId == null}>
            + New sprint
          </button>
          <Dropdown
            value={filters.assignee != null ? String(filters.assignee) : ''}
            placeholder="All assignees"
            options={[{ value: '', label: 'All assignees' }, ...people.map((p) => ({ value: String(p.id), label: p.name }))]}
            onChange={(v) => setFilters({ ...filters, assignee: v ? Number(v) : null })}
          />
          <Dropdown
            value={filters.type != null ? String(filters.type) : ''}
            placeholder="All types"
            options={[{ value: '', label: 'All types' }, ...ISSUE_TYPES.map((t) => ({ value: String(t.id), label: t.name }))]}
            onChange={(v) => setFilters({ ...filters, type: v ? Number(v) : null })}
          />
          <div className="search-box">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            <input
              type="search"
              placeholder="Search issues"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            />
          </div>
        </div>
      )}

      <main>
        {projectId != null && view === 'board' && (
          <Board
            projectId={projectId}
            filters={filters}
            version={version}
            onOpen={setModalKey}
            onCreate={(statusId) => setCreating({ statusId })}
          />
        )}
        {projectId != null && view === 'backlog' && (
          <Backlog projectId={projectId} sprints={sprints} version={version} onOpen={setModalKey} onChanged={bump} />
        )}
      </main>

      {deletingProject && (
        <DeleteProject
          project={deletingProject}
          onClose={() => setDeletingProject(null)}
          onDeleted={() => {
            const remaining = projects.filter((p) => p.id !== deletingProject.id)
            setDeletingProject(null)
            setProjects(remaining)
            if (projectId === deletingProject.id) {
              setProjectId(remaining[0]?.id ?? null)
              setFilters(NO_FILTERS)
            }
          }}
        />
      )}

      {creatingSprint && projectId != null && (
        <NewSprint
          projectId={projectId}
          onClose={() => setCreatingSprint(false)}
          onCreated={() => {
            setCreatingSprint(false)
            bump()
          }}
        />
      )}

      {newProject && (
        <NewProject
          onClose={() => setNewProject(false)}
          onCreated={(p) => {
            setNewProject(false)
            setProjects((ps) => [...(ps ?? []), p])
            setProjectId(p.id)
            setFilters(NO_FILTERS)
          }}
        />
      )}

      {creating && projectId != null && (
        <CreateIssue
          projectId={projectId}
          statuses={statuses}
          people={people}
          initialStatusId={creating.statusId}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null)
            bump()
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

// index.html stamps data-theme before first paint; this just flips and persists it.
function ThemeToggle() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button
      className="btn subtle"
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next
        localStorage.setItem('theme', next)
        setTheme(next)
      }}
    >
      {theme === 'dark' ? (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="8" cy="8" r="3.5" />
          <path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3 3l1.3 1.3M11.7 11.7 13 13M13 3l-1.3 1.3M4.3 11.7 3 13" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.5 9.5A6 6 0 1 1 6.5 2.5a5 5 0 0 0 7 7Z" />
        </svg>
      )}
    </button>
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
          <img src="logo.png" alt="Yesod" style={{ width: '48px', height: '48px', borderRadius: '8px' }} />
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

function NewProject({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => void }) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim() || !key.trim() || busy) return
          setBusy(true)
          api<Project>('/projects', 'POST', { name: name.trim(), key_prefix: key.trim() })
            .then(onCreated)
            .catch((er: Error) => {
              setErr(er.message)
              setBusy(false)
            })
        }}
      >
        <div className="dialog-head">
          <h2>New project</h2>
        </div>
        <div className="dialog-body">
          <div className="field">
            <div className="field-label">Name</div>
            <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <div className="field-label">Key</div>
            <input
              placeholder="e.g. YS"
              value={key}
              maxLength={10}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
            />
            <p className="field-hint">Issue keys become {key.trim() || 'KEY'}-1, {key.trim() || 'KEY'}-2, …</p>
          </div>
        </div>
        {err && <p className="error dialog-error">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!name.trim() || !key.trim() || busy}>
            Create
          </button>
        </div>
      </form>
    </div>
  )
}

// Deleting a project wipes all of its issues, sprints and columns, so it
// requires typing the project key — an armed button is not enough here.
function DeleteProject({ project, onClose, onDeleted }: { project: Project; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const match = typed.trim().toUpperCase() === project.key_prefix
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog dialog-narrow"
        onSubmit={(e) => {
          e.preventDefault()
          if (!match || busy) return
          setBusy(true)
          api<void>(`/projects/${project.id}`, 'DELETE')
            .then(onDeleted)
            .catch((er: Error) => {
              setErr(er.message)
              setBusy(false)
            })
        }}
      >
        <div className="dialog-head">
          <h2>Delete project</h2>
        </div>
        <div className="dialog-body">
          <p className="dialog-text">
            This permanently deletes <strong>{project.name}</strong> — every issue, sprint and column in it. This
            cannot be undone.
          </p>
          <div className="field">
            <div className="field-label">Type {project.key_prefix} to confirm</div>
            <input placeholder={project.key_prefix} value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </div>
        </div>
        {err && <p className="error dialog-error">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn danger" disabled={!match || busy}>
            Delete project
          </button>
        </div>
      </form>
    </div>
  )
}

function CreateIssue({
  projectId,
  statuses,
  people,
  initialStatusId,
  onClose,
  onCreated,
}: {
  projectId: number
  statuses: Status[]
  people: Person[]
  initialStatusId?: number
  onClose: () => void
  onCreated: (key: string) => void
}) {
  const [title, setTitle] = useState('')
  const [typeId, setTypeId] = useState(3) // Task
  const [statusId, setStatusId] = useState<number | ''>(initialStatusId ?? '')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState<number | ''>('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const type = ISSUE_TYPES.find((t) => t.id === typeId)

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
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(assigneeId !== '' ? { assignee_id: assigneeId } : {}),
          })
            .then((d) => onCreated(d.key))
            .catch((er: Error) => {
              setErr(er.message)
              setBusy(false)
            })
        }}
      >
        <div className="dialog-head">
          <h2>Create issue</h2>
        </div>
        <div className="dialog-body">
          <div className="field">
            <div className="field-label">Issue type</div>
            <Dropdown
              value={String(typeId)}
              options={ISSUE_TYPES.map((t) => ({
                value: String(t.id),
                label: t.name,
                render: (
                  <>
                    <TypeIcon t={t} />
                    {t.name}
                  </>
                ),
              }))}
              onChange={(v) => setTypeId(Number(v))}
              renderValue={() => (
                <>
                  {type && <TypeIcon t={type} />}
                  {type?.name}
                </>
              )}
            />
          </div>
          <div className="field">
            <div className="field-label">Title</div>
            <input placeholder="What needs to be done?" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="dialog-row">
            <div className="field">
              <div className="field-label">Status</div>
              <Dropdown
                value={statusId === '' ? '' : String(statusId)}
                placeholder="Default status"
                options={[{ value: '', label: 'Default status' }, ...statuses.map((s) => ({ value: String(s.id), label: s.name }))]}
                onChange={(v) => setStatusId(v ? Number(v) : '')}
              />
            </div>
            <div className="field">
              <div className="field-label">Assignee</div>
              <Dropdown
                value={assigneeId === '' ? '' : String(assigneeId)}
                placeholder="Unassigned"
                options={[{ value: '', label: 'Unassigned' }, ...people.map((p) => ({ value: String(p.id), label: p.name }))]}
                onChange={(v) => setAssigneeId(v ? Number(v) : '')}
              />
            </div>
          </div>
          <div className="field">
            <div className="field-label">Description</div>
            <textarea
              placeholder="Add a description…"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        {err && <p className="error dialog-error">{err}</p>}
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

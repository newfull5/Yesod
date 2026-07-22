import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { api } from './api'
import type { Card, Detail, Sprint } from './api'
import { Avatar, DueBadge, TypeIcon } from './ui'

type Props = {
  projectId: number
  sprints: Sprint[]
  version: number
  onOpen: (key: string) => void
  onChanged: () => void
}

export default function Backlog({ projectId, sprints, version, onOpen, onChanged }: Props) {
  const [issues, setIssues] = useState<Card[] | null>(null)
  const [error, setError] = useState('')
  const [creatingSprint, setCreatingSprint] = useState(false)
  const justDragged = useRef(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    let dead = false
    api<Card[]>(`/issues?project_id=${projectId}`)
      .then((all) => {
        if (dead) return
        setIssues(all)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      dead = true
    }
  }, [projectId, version])

  async function onDragEnd(e: DragEndEvent) {
    setTimeout(() => {
      justDragged.current = false
    }, 0)
    const { active, over } = e
    if (!over || !issues) return
    const data = active.data.current as { issueId: number; key: string; from: number | null }
    const to = over.id === 'backlog' ? null : Number(String(over.id).slice(1))
    if (data.from === to) return
    const prev = issues
    try {
      // Re-fetch the issue's current sprint membership right before building
      // the replacement set: our local copy can be stale (e.g. an MCP client
      // changed it since load), and sprint_ids PATCHes replace the whole set —
      // sending a stale one would silently revert the other client's change.
      const fresh = await api<Detail>(`/issues/${data.key}`)
      let next = fresh.sprints.map((s) => s.id).filter((id) => id !== data.from)
      if (to != null && !next.includes(to)) next = [...next, to]
      setIssues(issues.map((i) => (i.id === data.issueId ? { ...i, sprint_ids: next } : i))) // optimistic
      await api(`/issues/${data.key}`, 'PATCH', { sprint_ids: next })
      setError('')
    } catch (err) {
      setIssues(prev)
      setError(err instanceof Error ? err.message : 'Move failed')
    }
  }

  const open = (key: string) => {
    if (justDragged.current) return
    onOpen(key)
  }

  // Only one sprint is active at a time: starting one closes any other active sprint.
  async function startSprint(s: Sprint) {
    try {
      for (const other of sprints.filter((o) => o.state === 'active' && o.id !== s.id)) {
        await api(`/sprints/${other.id}`, 'PATCH', { state: 'closed' })
      }
      await api(`/sprints/${s.id}`, 'PATCH', { state: 'active' })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Start sprint failed')
    }
  }

  // Completing a sprint moves its unfinished issues back to the backlog and
  // closes it; done issues stay in the sprint as its history.
  async function completeSprint(s: Sprint) {
    const members = issues?.filter((i) => i.sprint_ids.includes(s.id)) ?? []
    const unfinished = members.filter((i) => i.status.category !== 'done')
    const done = members.length - unfinished.length
    const msg = `Complete ${s.name}? ${unfinished.length} unfinished issue(s) move back to the backlog; ${done} done issue(s) stay as its history.`
    if (!window.confirm(msg)) return
    try {
      // ponytail: N sequential PATCHes from the loaded list; a bulk endpoint if sprints ever hold hundreds of issues
      for (const i of unfinished) {
        await api(`/issues/${i.key}`, 'PATCH', { sprint_ids: i.sprint_ids.filter((id) => id !== s.id) })
      }
      await api(`/sprints/${s.id}`, 'PATCH', { state: 'closed' })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Complete sprint failed')
    }
  }

  if (!issues) return <div className="center-msg">{error || 'Loading backlog…'}</div>

  const active = issues.filter((i) => !i.archived_at)
  const archived = issues.filter((i) => i.archived_at)
  const inSprint = (sprintId: number) => active.filter((i) => i.sprint_ids.includes(sprintId))
  const unassigned = active.filter((i) => i.sprint_ids.length === 0)

  return (
    <div className="backlog">
      <div className="backlog-toolbar">
        <button className="btn" onClick={() => setCreatingSprint(true)}>
          + New sprint
        </button>
      </div>
      {error && (
        <div className="banner error" onClick={() => setError('')}>
          {error} (click to dismiss)
        </div>
      )}
      <DndContext sensors={sensors} onDragStart={() => (justDragged.current = true)} onDragEnd={onDragEnd}>
        {sprints
          .filter((s) => s.state !== 'closed')
          .map((s) => (
            <Section
              key={s.id}
              droppableId={`s${s.id}`}
              title={s.name}
              active={s.state === 'active'}
              subtitle={[s.state, s.start_date && s.end_date ? `${s.start_date} → ${s.end_date}` : null]
                .filter(Boolean)
                .join(' · ')}
              rows={inSprint(s.id)}
              from={s.id}
              onOpen={open}
              action={
                s.state === 'active' ? (
                  <button className="btn subtle head-action" onClick={() => completeSprint(s)}>
                    Complete sprint
                  </button>
                ) : (
                  <button className="btn subtle head-action" onClick={() => startSprint(s)}>
                    Start sprint
                  </button>
                )
              }
            />
          ))}
        <Section droppableId="backlog" title="Backlog" subtitle="" rows={unassigned} from={null} onOpen={open} />
      </DndContext>
      {sprints.some((s) => s.state === 'closed') && (
        <HistorySection sprints={sprints.filter((s) => s.state === 'closed')} issues={issues} onOpen={open} />
      )}
      {archived.length > 0 && <ArchiveSection rows={archived} onOpen={open} />}
      {creatingSprint && (
        <NewSprint
          projectId={projectId}
          onClose={() => setCreatingSprint(false)}
          onCreated={() => {
            setCreatingSprint(false)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

export function NewSprint({ projectId, onClose, onCreated }: { projectId: number; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim() || busy) return
          setBusy(true)
          const body: Record<string, unknown> = { project_id: projectId, name: name.trim() }
          if (start) body.start_date = start
          if (end) body.end_date = end
          api<Sprint>('/sprints', 'POST', body)
            .then(onCreated)
            .catch((er: Error) => {
              setErr(er.message)
              setBusy(false)
            })
        }}
      >
        <div className="dialog-head">
          <h2>New sprint</h2>
        </div>
        <div className="dialog-body">
          <div className="field">
            <div className="field-label">Name</div>
            <input placeholder="e.g. Sprint 3" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <div className="field-label">Start date</div>
            <input lang="en" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <div className="field-label">End date</div>
            <input lang="en" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        {err && <p className="error dialog-error">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!name.trim() || busy}>
            Create
          </button>
        </div>
      </form>
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={'chevron' + (open ? ' open' : '')}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3l5 5-5 5" />
    </svg>
  )
}

// Completed sprints and the done issues that stayed in them. Read-only record.
function HistorySection({ sprints, issues, onOpen }: { sprints: Sprint[]; issues: Card[]; onOpen: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="backlog-section archive">
      <button className="section-head archive-toggle" onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <strong>Sprint history</strong>
        <span className="muted">completed sprints</span>
        <span className="count">{sprints.length}</span>
      </button>
      {open &&
        sprints.map((s) => {
          const rows = issues.filter((i) => i.sprint_ids.includes(s.id))
          return (
            <div key={s.id} className="history-sprint">
              <div className="section-head">
                <strong>{s.name}</strong>
                {s.start_date && s.end_date && <span className="muted">{`${s.start_date} → ${s.end_date}`}</span>}
                <span className="count">{rows.length}</span>
              </div>
              {rows.length === 0 && <div className="muted empty-hint">No issues recorded</div>}
              {rows.map((c) => (
                <div key={c.key} className="backlog-row archived" onClick={() => onOpen(c.key)}>
                  <TypeIcon t={c.type} />
                  <span className="key">{c.key}</span>
                  <span className="row-title">{c.title}</span>
                  <span className="muted">{c.status.name}</span>
                  {c.assignee && <Avatar p={c.assignee} size={20} />}
                </div>
              ))}
            </div>
          )
        })}
    </section>
  )
}

// Work history: issues archived via the board's "Clear" button. Read-only
// list (no drag) — open an issue and Restore to bring it back.
function ArchiveSection({ rows, onOpen }: { rows: Card[]; onOpen: (key: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="backlog-section archive">
      <button className="section-head archive-toggle" onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <strong>Archive</strong>
        <span className="muted">cleared from the board</span>
        <span className="count">{rows.length}</span>
      </button>
      {open &&
        rows.map((c) => (
          <div key={c.key} className="backlog-row archived" onClick={() => onOpen(c.key)}>
            <TypeIcon t={c.type} />
            <span className="key">{c.key}</span>
            <span className="row-title">{c.title}</span>
            <span className="muted archived-date">archived {c.archived_at?.slice(0, 10)}</span>
            {c.assignee && <Avatar p={c.assignee} size={20} />}
          </div>
        ))}
    </section>
  )
}

function Section({
  droppableId,
  title,
  subtitle,
  rows,
  from,
  onOpen,
  active,
  action,
}: {
  droppableId: string
  title: string
  subtitle: string
  rows: Card[]
  from: number | null
  onOpen: (key: string) => void
  active?: boolean
  action?: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId })
  return (
    <section
      className={'backlog-section' + (active ? ' sprint-active' : '') + (isOver ? ' drop-target' : '')}
      ref={setNodeRef}
    >
      <div className="section-head">
        <strong>{title}</strong>
        {subtitle && <span className="muted">{subtitle}</span>}
        <span className="count">{rows.length}</span>
        {action}
      </div>
      {rows.length === 0 && <div className="muted empty-hint">Drop issues here</div>}
      {rows.map((c) => (
        <Row key={c.key} card={c} from={from} onOpen={onOpen} />
      ))}
    </section>
  )
}

function Row({ card, from, onOpen }: { card: Card; from: number | null; onOpen: (key: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${from ?? 'b'}:${card.key}`,
    data: { issueId: card.id, key: card.key, from },
  })
  return (
    <div
      ref={setNodeRef}
      className="backlog-row"
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        opacity: isDragging ? 0.5 : 1,
      }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.key)}
    >
      <TypeIcon t={card.type} />
      <span className="key">{card.key}</span>
      <span className="row-title">{card.title}</span>
      <DueBadge due={card.due_date} />
      {card.assignee && <Avatar p={card.assignee} size={20} />}
    </div>
  )
}

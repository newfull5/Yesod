import { useEffect, useRef, useState } from 'react'
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
}

export default function Backlog({ projectId, sprints, version, onOpen }: Props) {
  const [issues, setIssues] = useState<Card[] | null>(null)
  const [error, setError] = useState('')
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

  if (!issues) return <div className="center-msg">{error || 'Loading backlog…'}</div>

  const inSprint = (sprintId: number) => issues.filter((i) => i.sprint_ids.includes(sprintId))
  const unassigned = issues.filter((i) => i.sprint_ids.length === 0)

  return (
    <div className="backlog">
      {error && (
        <div className="banner error" onClick={() => setError('')}>
          {error} (click to dismiss)
        </div>
      )}
      <DndContext sensors={sensors} onDragStart={() => (justDragged.current = true)} onDragEnd={onDragEnd}>
        {sprints.map((s) => (
          <Section
            key={s.id}
            droppableId={`s${s.id}`}
            title={s.name}
            subtitle={[s.state, s.start_date && s.end_date ? `${s.start_date} → ${s.end_date}` : null]
              .filter(Boolean)
              .join(' · ')}
            rows={inSprint(s.id)}
            from={s.id}
            onOpen={open}
          />
        ))}
        <Section droppableId="backlog" title="Backlog" subtitle="" rows={unassigned} from={null} onOpen={open} />
      </DndContext>
    </div>
  )
}

function Section({
  droppableId,
  title,
  subtitle,
  rows,
  from,
  onOpen,
}: {
  droppableId: string
  title: string
  subtitle: string
  rows: Card[]
  from: number | null
  onOpen: (key: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId })
  return (
    <section className={'backlog-section' + (isOver ? ' drop-target' : '')} ref={setNodeRef}>
      <div className="section-head">
        <strong>{title}</strong>
        {subtitle && <span className="muted">{subtitle}</span>}
        <span className="count">{rows.length}</span>
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

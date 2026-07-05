import { useEffect, useRef, useState } from 'react'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { api } from './api'
import type { Card, Sprint } from './api'
import { Avatar, DueBadge, TypeIcon } from './ui'

type Props = {
  projectId: number
  sprints: Sprint[]
  version: number
  onOpen: (key: string) => void
}

// issue id -> sprint ids it belongs to
type Membership = Record<number, number[]>

export default function Backlog({ projectId, sprints, version, onOpen }: Props) {
  const [issues, setIssues] = useState<Card[] | null>(null)
  const [memb, setMemb] = useState<Membership>({})
  const [error, setError] = useState('')
  const justDragged = useRef(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  useEffect(() => {
    let dead = false
    ;(async () => {
      // Card shape carries no sprint info; fetch each sprint's issue list for membership.
      const [all, ...perSprint] = await Promise.all([
        api<Card[]>(`/issues?project_id=${projectId}`),
        ...sprints.map((s) => api<Card[]>(`/issues?project_id=${projectId}&sprint=${s.id}`)),
      ])
      if (dead) return
      const m: Membership = {}
      sprints.forEach((s, i) => {
        for (const c of perSprint[i]) (m[c.id] ??= []).push(s.id)
      })
      setIssues(all)
      setMemb(m)
      setError('')
    })().catch((e: Error) => setError(e.message))
    return () => {
      dead = true
    }
  }, [projectId, sprints, version])

  function onDragEnd(e: DragEndEvent) {
    setTimeout(() => {
      justDragged.current = false
    }, 0)
    const { active, over } = e
    if (!over) return
    const data = active.data.current as { issueId: number; key: string; from: number | null }
    const to = over.id === 'backlog' ? null : Number(String(over.id).slice(1))
    if (data.from === to) return
    const cur = memb[data.issueId] ?? []
    let next = cur.filter((id) => id !== data.from)
    if (to != null && !next.includes(to)) next = [...next, to]
    const prev = memb
    setMemb({ ...memb, [data.issueId]: next }) // optimistic
    api(`/issues/${data.key}`, 'PATCH', { sprint_ids: next })
      .then(() => setError(''))
      .catch((er: Error) => {
        setMemb(prev)
        setError(er.message)
      })
  }

  const open = (key: string) => {
    if (justDragged.current) return
    onOpen(key)
  }

  if (!issues) return <div className="center-msg">{error || 'Loading backlog…'}</div>

  const inSprint = (sprintId: number) => issues.filter((i) => memb[i.id]?.includes(sprintId))
  const unassigned = issues.filter((i) => !memb[i.id]?.length)

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

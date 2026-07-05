import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api } from './api'
import type { Card, Column, Detail } from './api'
import type { Filters } from './App'
import { Avatar, DueBadge, TypeIcon, typeColor } from './ui'

type Props = {
  projectId: number
  filters: Filters
  version: number
  onOpen: (key: string) => void
}

function findCol(cols: Column[], id: string): Column | undefined {
  if (id.startsWith('col-')) return cols.find((c) => `col-${c.id}` === id)
  return cols.find((c) => c.issues.some((i) => i.key === id))
}

export default function Board({ projectId, filters, version, onOpen }: Props) {
  const [columns, setColumns] = useState<Column[] | null>(null)
  const [activeCard, setActiveCard] = useState<Card | null>(null)
  const [error, setError] = useState('')
  const snapshot = useRef<Column[] | null>(null)
  const justDragged = useRef(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const load = useCallback(
    () =>
      api<{ columns: Column[] }>(`/board?project_id=${projectId}`).then((b) => {
        // A drag started after this fetch went out; applying a stale board
        // now would clobber the in-progress optimistic drag state (see
        // onDragOver/onDragEnd). Drop the result — the drag's own end/cancel
        // handler already leaves columns consistent.
        if (snapshot.current == null) setColumns(b.columns)
      }),
    [projectId],
  )

  useEffect(() => {
    load().catch((e: Error) => setError(e.message))
  }, [load, version])

  const matches = (c: Card) =>
    (filters.assignee == null || c.assignee?.id === filters.assignee) &&
    (filters.type == null || c.type?.id === filters.type) &&
    (filters.sprint == null || c.sprint_ids.includes(filters.sprint)) &&
    (!filters.q || c.title.toLowerCase().includes(filters.q.toLowerCase()))

  function onDragStart(e: DragStartEvent) {
    if (!columns) return
    justDragged.current = true
    snapshot.current = columns
    setActiveCard(columns.flatMap((c) => c.issues).find((i) => i.key === String(e.active.id)) ?? null)
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    setColumns((cols) => {
      if (!cols) return cols
      const from = findCol(cols, activeId)
      const to = findCol(cols, overId)
      if (!from || !to || from.id === to.id) return cols
      const card = from.issues.find((i) => i.key === activeId)
      if (!card) return cols
      return cols.map((c) => {
        if (c.id === from.id) return { ...c, issues: c.issues.filter((i) => i.key !== activeId) }
        if (c.id === to.id) {
          const idx = c.issues.findIndex((i) => i.key === overId)
          const issues = [...c.issues]
          issues.splice(idx >= 0 ? idx : issues.length, 0, card)
          return { ...c, issues }
        }
        return c
      })
    })
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveCard(null)
    // Let the trailing click event see the flag, then clear it.
    setTimeout(() => {
      justDragged.current = false
    }, 0)
    const snap = snapshot.current
    snapshot.current = null
    const rollback = () => {
      if (snap) setColumns(snap)
    }
    if (!columns || !e.over) return rollback()
    const activeId = String(e.active.id)
    const overId = String(e.over.id)
    const col = findCol(columns, overId) ?? findCol(columns, activeId)
    if (!col) return rollback()
    const fromIdx = col.issues.findIndex((i) => i.key === activeId)
    if (fromIdx < 0) return rollback()
    const overIdx = col.issues.findIndex((i) => i.key === overId)
    let issues = col.issues
    if (overIdx >= 0 && fromIdx !== overIdx) {
      issues = arrayMove(issues, fromIdx, overIdx)
      setColumns((cols) => (cols ? cols.map((c) => (c.id === col.id ? { ...c, issues } : c)) : cols))
    }
    const visible = issues.filter(matches)
    const idx = visible.findIndex((i) => i.key === activeId)
    const afterKey = idx > 0 ? visible[idx - 1].key : null
    try {
      await api(`/issues/${activeId}/position`, 'PATCH', { status_id: col.id, after_key: afterKey })
      setError('')
      void load().catch(() => {}) // re-sync with server ordering
    } catch (err) {
      rollback()
      setError(err instanceof Error ? err.message : 'Move failed')
    }
  }

  function onDragCancel() {
    setActiveCard(null)
    if (snapshot.current) setColumns(snapshot.current)
    snapshot.current = null
    justDragged.current = false
  }

  const open = (key: string) => {
    if (justDragged.current) return
    onOpen(key)
  }

  const quickAdd = (statusId: number) => async (title: string) => {
    const d = await api<Detail>('/issues', 'POST', { project_id: projectId, title, status_id: statusId })
    setColumns((cols) => (cols ? cols.map((c) => (c.id === statusId ? { ...c, issues: [...c.issues, d] } : c)) : cols))
  }

  if (!columns) return <div className="center-msg">{error || 'Loading board…'}</div>

  return (
    <div className="board-wrap">
      {error && (
        <div className="banner error" onClick={() => setError('')}>
          {error} (click to dismiss)
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="board">
          {columns.map((col) => (
            <BoardColumn
              key={col.id}
              col={col}
              cards={col.issues.filter(matches)}
              onOpen={open}
              onQuickAdd={quickAdd(col.id)}
            />
          ))}
        </div>
        <DragOverlay>
          {activeCard && (
            <div className="card overlay" style={{ borderLeftColor: typeColor(activeCard.type) }}>
              <CardBody card={activeCard} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function BoardColumn({
  col,
  cards,
  onOpen,
  onQuickAdd,
}: {
  col: Column
  cards: Card[]
  onOpen: (key: string) => void
  onQuickAdd: (title: string) => Promise<void>
}) {
  const { setNodeRef } = useDroppable({ id: `col-${col.id}` })
  return (
    <section className="column">
      <div className="col-head">
        {col.name} <span className="count">{cards.length}</span>
      </div>
      <SortableContext items={cards.map((c) => c.key)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="col-cards">
          {cards.map((c) => (
            <SortableCard key={c.key} card={c} onOpen={onOpen} />
          ))}
        </div>
      </SortableContext>
      <QuickAdd onAdd={onQuickAdd} />
    </section>
  )
}

function SortableCard({ card, onOpen }: { card: Card; onOpen: (key: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.key })
  return (
    <div
      ref={setNodeRef}
      className="card"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        borderLeftColor: typeColor(card.type),
      }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.key)}
    >
      <CardBody card={card} />
    </div>
  )
}

function CardBody({ card }: { card: Card }) {
  return (
    <>
      <div className="card-title">{card.title}</div>
      <div className="card-foot">
        <TypeIcon t={card.type} />
        <span className="key">{card.key}</span>
        <DueBadge due={card.due_date} />
        <span className="spacer" />
        {card.assignee && <Avatar p={card.assignee} size={22} />}
      </div>
    </>
  )
}

function QuickAdd({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!open) {
    return (
      <button className="quickadd-btn" onClick={() => setOpen(true)}>
        + Create
      </button>
    )
  }
  return (
    <form
      className="quickadd"
      onSubmit={(e) => {
        e.preventDefault()
        const t = title.trim()
        if (!t || busy) return
        setBusy(true)
        onAdd(t)
          .then(() => {
            setTitle('')
            setErr('')
          })
          .catch((er: Error) => setErr(er.message))
          .finally(() => setBusy(false))
      }}
    >
      <input
        placeholder="What needs to be done?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        autoFocus
      />
      <div className="quickadd-actions">
        <button type="submit" className="btn primary" disabled={!title.trim() || busy}>
          Add
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {err && <p className="error">{err}</p>}
    </form>
  )
}

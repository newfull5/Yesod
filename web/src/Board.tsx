import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
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
import type { Card, Column } from './api'
import type { Filters } from './App'
import { Avatar, DueBadge, TypeIcon, typeColor } from './ui'

type Props = {
  projectId: number
  filters: Filters
  version: number
  onOpen: (key: string) => void
  onCreate: (statusId: number) => void
}

function findCol(cols: Column[], id: string): Column | undefined {
  if (id.startsWith('col-')) return cols.find((c) => `col-${c.id}` === id)
  return cols.find((c) => c.issues.some((i) => i.key === id))
}

export default function Board({ projectId, filters, version, onOpen, onCreate }: Props) {
  const [columns, setColumns] = useState<Column[] | null>(null)
  const [activeCard, setActiveCard] = useState<Card | null>(null)
  const [addAt, setAddAt] = useState<number | null>(null) // insert after this column index
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

  const clearColumn = (statusId: number) => async () => {
    try {
      await api(`/statuses/${statusId}/clear`, 'POST')
      setError('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Clear failed')
    }
  }

  // Insert after column index `at`: taking the next column's board_order
  // makes the server shift later columns right; no next column = append.
  const addColumn = (at: number) => async (name: string, category: string) => {
    const next = columns?.[at + 1]
    await api('/statuses', 'POST', {
      project_id: projectId,
      name,
      category,
      ...(next ? { board_order: next.board_order } : {}),
    })
    await load()
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
          {columns.map((col, i) => (
            <Fragment key={col.id}>
              <BoardColumn
                col={col}
                cards={col.issues.filter(matches)}
                onOpen={open}
                onCreate={() => onCreate(col.id)}
                onClear={col.category === 'done' ? clearColumn(col.id) : undefined}
              />
              <button className="col-gap" title="Add column here" onClick={() => setAddAt(i)}>
                <span className="col-gap-plus">+</span>
              </button>
            </Fragment>
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
      {addAt != null && <AddColumnDialog onClose={() => setAddAt(null)} onAdd={addColumn(addAt)} />}
    </div>
  )
}

const COL_DOT: Record<string, string> = { todo: '#B0AAC7', in_progress: '#6741B7', done: '#2FAE73' }

function BoardColumn({
  col,
  cards,
  onOpen,
  onCreate,
  onClear,
}: {
  col: Column
  cards: Card[]
  onOpen: (key: string) => void
  onCreate: () => void
  onClear?: () => Promise<void>
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${col.id}` })
  return (
    <section className={'column' + (isOver ? ' drop-target' : '')}>
      <div className="col-head">
        <span className="col-dot" style={{ background: COL_DOT[col.category] || '#B0AAC7' }} />
        {col.name}
        <span className="count">{cards.length}</span>
        {onClear && cards.length > 0 && <ClearButton count={cards.length} onClear={onClear} />}
      </div>
      <SortableContext items={cards.map((c) => c.key)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="col-cards">
          {cards.map((c) => (
            <SortableCard key={c.key} card={c} onOpen={onOpen} />
          ))}
        </div>
      </SortableContext>
      <button className="quickadd-btn" onClick={onCreate}>
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M8 2v12M2 8h12" />
        </svg>
        Create
      </button>
    </section>
  )
}

// Two-step confirm: first click arms the button, second click archives.
// Arming disarms on mouse-leave so a stray click can't clear the column.
function ClearButton({ count, onClear }: { count: number; onClear: () => Promise<void> }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <button
      className={'col-clear' + (armed ? ' armed' : '')}
      disabled={busy}
      onMouseLeave={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true)
        setBusy(true)
        onClear().finally(() => {
          setBusy(false)
          setArmed(false)
        })
      }}
      title="Archive all issues in this column (kept in Backlog → Archive)"
    >
      {armed ? `Archive ${count}?` : 'Clear'}
    </button>
  )
}

const CATEGORIES = [
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'done', label: 'Done' },
] as const

function AddColumnDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (name: string, category: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>('in_progress')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog dialog-narrow"
        onSubmit={(e) => {
          e.preventDefault()
          const n = name.trim()
          if (!n || busy) return
          setBusy(true)
          onAdd(n, category)
            .then(onClose)
            .catch((er: Error) => setErr(er.message))
            .finally(() => setBusy(false))
        }}
      >
        <div className="dialog-head">
          <h2>Add column</h2>
        </div>
        <div className="dialog-body">
          <div className="field">
            <div className="field-label">Name</div>
            <input
              placeholder="Column name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && onClose()}
              autoFocus
            />
          </div>
          <div className="field">
            <div className="field-label">Category</div>
            <div className="add-column-cats">
              {CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={'cat-pick' + (category === c.id ? ' active' : '')}
                  onClick={() => setCategory(c.id)}
                >
                  <span className="col-dot" style={{ background: COL_DOT[c.id] }} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {err && <p className="error dialog-error">{err}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!name.trim() || busy}>
            Add
          </button>
        </div>
      </form>
    </div>
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


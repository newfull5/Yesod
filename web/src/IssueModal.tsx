import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api, LINK_TYPES } from './api'
import type { Card, Detail, Person, Sprint, Status, Team } from './api'
import {
  Avatar,
  IconCalendar,
  IconClock,
  IconParent,
  IconPerson,
  IconSprint,
  IconStatus,
  IconTeam,
  TypeIcon,
} from './ui'

type Props = {
  issueKey: string
  projectId: number
  people: Person[]
  teams: Team[]
  statuses: Status[]
  sprints: Sprint[]
  me: Person | null
  onClose: () => void
  onChanged: () => void
}

export default function IssueModal({
  issueKey,
  projectId,
  people,
  teams,
  statuses,
  sprints,
  me,
  onClose,
  onChanged,
}: Props) {
  const [k, setK] = useState(issueKey)
  const [issue, setIssue] = useState<Detail | null>(null)
  const [err, setErr] = useState('')

  const load = useCallback(
    () =>
      api<Detail>(`/issues/${k}`)
        .then((d) => {
          setIssue(d)
          setErr('')
        })
        .catch((e: Error) => setErr(e.message)),
    [k],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function patch(fields: Record<string, unknown>) {
    try {
      const d = await api<Detail>(`/issues/${k}`, 'PATCH', fields)
      setIssue(d)
      setErr('')
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function remove() {
    if (!confirm(`Delete ${k}? This cannot be undone.`)) return
    try {
      await api<void>(`/issues/${k}`, 'DELETE')
      onChanged()
      onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        {!issue ? (
          <div className="center-msg">{err || 'Loading…'}</div>
        ) : (
          <>
            <div className="modal-head">
              <span className="breadcrumb">
                {issue.parent && (
                  <>
                    <button className="linklike" onClick={() => setK(issue.parent!.key)}>
                      {issue.parent.key}
                    </button>
                    <span className="crumb-sep">/</span>
                  </>
                )}
                <TypeIcon t={issue.type} />
                <span className="key">{issue.key}</span>
              </span>
              <span className="spacer" />
              <button className="btn subtle" onClick={remove} title="Delete issue">
                Delete
              </button>
              <button className="btn subtle" onClick={onClose} title="Close">
                ✕
              </button>
            </div>
            {err && <div className="banner error">{err}</div>}
            <div className="modal-body">
              <div className="modal-main">
                <TitleEditor title={issue.title} onSave={(t) => patch({ title: t })} />
                <DescriptionEditor description={issue.description} onSave={(d) => patch({ description: d })} />
                <Subtasks
                  issue={issue}
                  projectId={projectId}
                  onOpen={setK}
                  onChanged={() => (void load(), onChanged())}
                />
                <Links issue={issue} k={k} onOpen={setK} onChanged={() => void load()} />
                <Activity issue={issue} k={k} me={me} onChanged={() => void load()} />
              </div>
              <aside className="modal-side">
                <Field label="Status" icon={IconStatus}>
                  <select value={issue.status.id} onChange={(e) => patch({ status_id: Number(e.target.value) })}>
                    {statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Assignee" icon={IconPerson}>
                  <PersonSelect
                    people={people}
                    value={issue.assignee}
                    onChange={(id) => patch({ assignee_id: id })}
                  />
                  {me && issue.assignee?.id !== me.id && (
                    <button className="linklike" onClick={() => patch({ assignee_id: me.id })}>
                      Assign to me
                    </button>
                  )}
                </Field>
                <Field label="Reporter" icon={IconPerson}>
                  <PersonSelect
                    people={people}
                    value={issue.reporter}
                    onChange={(id) => patch({ reporter_id: id })}
                  />
                </Field>
                <Field label="Sprints" icon={IconSprint}>
                  {sprints.length === 0 && <span className="muted">No sprints</span>}
                  {sprints.map((s) => (
                    <label key={s.id} className="check">
                      <input
                        type="checkbox"
                        checked={issue.sprints.some((x) => x.id === s.id)}
                        onChange={(e) => {
                          const cur = issue.sprints.map((x) => x.id)
                          const next = e.target.checked ? [...cur, s.id] : cur.filter((id) => id !== s.id)
                          patch({ sprint_ids: next })
                        }}
                      />
                      {s.name} <em className="muted">{s.state}</em>
                    </label>
                  ))}
                </Field>
                <Field label="Parent" icon={IconParent}>
                  <ParentPicker issue={issue} projectId={projectId} onPick={(id) => patch({ parent_id: id })} />
                </Field>
                <Field label="Start date" icon={IconCalendar}>
                  <input
                    type="date"
                    value={issue.start_date ?? ''}
                    onChange={(e) => patch({ start_date: e.target.value || null })}
                  />
                </Field>
                <Field label="Due date" icon={IconCalendar}>
                  <input
                    type="date"
                    value={issue.due_date ?? ''}
                    onChange={(e) => patch({ due_date: e.target.value || null })}
                  />
                </Field>
                <Field label="Team" icon={IconTeam}>
                  <select
                    value={issue.team?.id ?? ''}
                    onChange={(e) => patch({ team_id: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">None</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Created" icon={IconClock}>
                  <span className="muted">{issue.created_at} UTC</span>
                </Field>
                <Field label="Updated" icon={IconClock}>
                  <span className="muted">{issue.updated_at} UTC</span>
                </Field>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string
  icon?: React.ComponentType
  children: React.ReactNode
}) {
  return (
    <div className="field">
      <div className="field-label">
        {Icon && <Icon />}
        {label}
      </div>
      <div className="field-value">{children}</div>
    </div>
  )
}

function PersonSelect({
  people,
  value,
  onChange,
}: {
  people: Person[]
  value: Person | null
  onChange: (id: number | null) => void
}) {
  return (
    <div className="person-select">
      {value && <Avatar p={value} size={20} />}
      <select value={value?.id ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Unassigned</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function TitleEditor({ title, onSave }: { title: string; onSave: (t: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(title)
  if (!editing) {
    return (
      <h2
        className="issue-title"
        onClick={() => {
          setText(title)
          setEditing(true)
        }}
        title="Click to edit"
      >
        {title}
      </h2>
    )
  }
  const save = () => {
    setEditing(false)
    const t = text.trim()
    if (t && t !== title) onSave(t)
  }
  return (
    <input
      className="issue-title-input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') setEditing(false)
      }}
      autoFocus
    />
  )
}

function DescriptionEditor({
  description,
  onSave,
}: {
  description: string | null
  onSave: (d: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(description ?? '')
  return (
    <section>
      <h3>Description</h3>
      {!editing ? (
        <div
          className={'description' + (description ? '' : ' placeholder')}
          onClick={() => {
            setText(description ?? '')
            setEditing(true)
          }}
          title="Click to edit"
        >
          {description ? <ReactMarkdown>{description}</ReactMarkdown> : 'Add a description…'}
        </div>
      ) : (
        <div className="desc-edit">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} autoFocus />
          <div className="dialog-actions">
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => {
                setEditing(false)
                onSave(text.trim() || null)
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function Subtasks({
  issue,
  projectId,
  onOpen,
  onChanged,
}: {
  issue: Detail
  projectId: number
  onOpen: (key: string) => void
  onChanged: () => void
}) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <section>
      <h3>Subtasks</h3>
      {issue.subtasks.map((st) => (
        <div className="row" key={st.key}>
          <button className="linklike" onClick={() => onOpen(st.key)}>
            {st.key}
          </button>
          <span className="row-title">{st.title}</span>
          <span className="chip">{st.status.name}</span>
        </div>
      ))}
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault()
          const t = title.trim()
          if (!t || busy) return
          setBusy(true)
          api<Detail>('/issues', 'POST', { project_id: projectId, title: t, parent_id: issue.id })
            .then(() => {
              setTitle('')
              setErr('')
              onChanged()
            })
            .catch((er: Error) => setErr(er.message))
            .finally(() => setBusy(false))
        }}
      >
        <input placeholder="Add a subtask" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button type="submit" className="btn" disabled={!title.trim() || busy}>
          Add
        </button>
      </form>
      {err && <p className="error">{err}</p>}
    </section>
  )
}

function Links({
  issue,
  k,
  onOpen,
  onChanged,
}: {
  issue: Detail
  k: string
  onOpen: (key: string) => void
  onChanged: () => void
}) {
  const [linkType, setLinkType] = useState<string>(LINK_TYPES[0])
  const [linkedKey, setLinkedKey] = useState('')
  const [err, setErr] = useState('')
  return (
    <section>
      <h3>Linked issues</h3>
      {Object.entries(issue.links).map(([type, items]) => (
        <div key={type}>
          <div className="link-type">{type}</div>
          {items.map((it) => (
            <div className="row" key={it.key}>
              <button className="linklike" onClick={() => onOpen(it.key)}>
                {it.key}
              </button>
              <span className="row-title">{it.title}</span>
              <button
                className="btn subtle"
                title="Remove link"
                onClick={() =>
                  api<void>(`/issues/${k}/links`, 'DELETE', { linked_key: it.key, link_type: type })
                    .then(() => {
                      setErr('')
                      onChanged()
                    })
                    .catch((er: Error) => setErr(er.message))
                }
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ))}
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault()
          const key = linkedKey.trim().toUpperCase()
          if (!key) return
          api(`/issues/${k}/links`, 'POST', { linked_key: key, link_type: linkType })
            .then(() => {
              setLinkedKey('')
              setErr('')
              onChanged()
            })
            .catch((er: Error) => setErr(er.message))
        }}
      >
        <select value={linkType} onChange={(e) => setLinkType(e.target.value)}>
          {LINK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input placeholder="Issue key (e.g. YS-3)" value={linkedKey} onChange={(e) => setLinkedKey(e.target.value)} />
        <button type="submit" className="btn" disabled={!linkedKey.trim()}>
          Link
        </button>
      </form>
      {err && <p className="error">{err}</p>}
    </section>
  )
}

function Activity({
  issue,
  k,
  me,
  onChanged,
}: {
  issue: Detail
  k: string
  me: Person | null
  onChanged: () => void
}) {
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <section>
      <h3>Activity</h3>
      {issue.comments.map((c) => (
        <div className="comment" key={c.id}>
          <div className="comment-head">
            <strong>{c.author?.name ?? 'Anonymous'}</strong>
            <span className="muted">{c.created_at} UTC</span>
          </div>
          <div className="comment-body">{c.body}</div>
        </div>
      ))}
      <form
        className="comment-add"
        onSubmit={(e) => {
          e.preventDefault()
          const b = body.trim()
          if (!b || busy) return
          setBusy(true)
          api(`/issues/${k}/comments`, 'POST', { body: b, ...(me ? { author_id: me.id } : {}) })
            .then(() => {
              setBody('')
              setErr('')
              onChanged()
            })
            .catch((er: Error) => setErr(er.message))
            .finally(() => setBusy(false))
        }}
      >
        <textarea placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} rows={2} />
        <button type="submit" className="btn primary" disabled={!body.trim() || busy}>
          Comment
        </button>
      </form>
      {err && <p className="error">{err}</p>}
    </section>
  )
}

function ParentPicker({
  issue,
  projectId,
  onPick,
}: {
  issue: Detail
  projectId: number
  onPick: (id: number | null) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Card[]>([])
  useEffect(() => {
    const query = q.trim()
    if (!query) {
      setResults([])
      return
    }
    let dead = false
    const t = setTimeout(() => {
      api<Card[]>(`/issues?project_id=${projectId}&q=${encodeURIComponent(query)}`)
        .then((r) => {
          if (!dead) setResults(r.filter((c) => c.id !== issue.id).slice(0, 8))
        })
        .catch(() => {})
    }, 200)
    return () => {
      dead = true
      clearTimeout(t)
    }
  }, [q, projectId, issue.id])
  return (
    <div className="parent-picker">
      {issue.parent ? (
        <div className="row">
          <span className="key">{issue.parent.key}</span>
          <span className="row-title">{issue.parent.title}</span>
          <button className="btn subtle" title="Clear parent" onClick={() => onPick(null)}>
            ✕
          </button>
        </div>
      ) : (
        <span className="muted">None</span>
      )}
      <input placeholder="Search issues…" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <div className="picker-results">
          {results.map((c) => (
            <button
              key={c.id}
              className="picker-item"
              onClick={() => {
                onPick(c.id)
                setQ('')
              }}
            >
              <span className="key">{c.key}</span> {c.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

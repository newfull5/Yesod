import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api, LINK_TYPES } from './api'
import { NewSprint } from './Backlog'
import type { Card, Comment as CommentType, Detail, Person, Sprint, Status, Team } from './api'
import {
  Avatar,
  Dropdown,
  IconCalendar,
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
  const [creatingSprint, setCreatingSprint] = useState(false)

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
                <span className="modal-key">{issue.key}</span>
                {issue.archived_at && <span className="archived-chip">Archived</span>}
              </span>
              <span className="spacer" />
              {issue.archived_at && (
                <button className="btn subtle" onClick={() => patch({ archived: false })} title="Put back on the board">
                  Restore
                </button>
              )}
              <DeleteButton issueKey={issue.key} onDelete={remove} />
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
                  <Dropdown
                    value={String(issue.status.id)}
                    options={statuses.map((s) => ({ value: String(s.id), label: s.name }))}
                    onChange={(v) => patch({ status_id: Number(v) })}
                  />
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
                  {sprints.length === 0 && (
                    <span className="muted">
                      No sprints —{' '}
                      <button type="button" className="link-btn" onClick={() => setCreatingSprint(true)}>
                        create one
                      </button>
                    </span>
                  )}
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
                <div className="field-row">
                  <Field label="Start date" icon={IconCalendar}>
                    <input
                      type="date"
                      lang="en"
                      value={issue.start_date ?? ''}
                      onChange={(e) => patch({ start_date: e.target.value || null })}
                    />
                  </Field>
                  <Field label="Due date" icon={IconCalendar}>
                    <input
                      type="date"
                      lang="en"
                      value={issue.due_date ?? ''}
                      onChange={(e) => patch({ due_date: e.target.value || null })}
                    />
                  </Field>
                </div>
                <Field label="Team" icon={IconTeam}>
                  <Dropdown
                    value={issue.team ? String(issue.team.id) : ''}
                    placeholder="None"
                    options={[{ value: '', label: 'None' }, ...teams.map((t) => ({ value: String(t.id), label: t.name }))]}
                    onChange={(v) => patch({ team_id: v ? Number(v) : null })}
                  />
                </Field>
                <div className="modal-meta">
                  <div className="meta-row">
                    <span className="muted">Created</span>
                    <span>{issue.created_at} UTC</span>
                  </div>
                  <div className="meta-row">
                    <span className="muted">Updated</span>
                    <span>{issue.updated_at} UTC</span>
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
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
      <Dropdown
        className="person-select-dropdown"
        value={value ? String(value.id) : ''}
        placeholder="Unassigned"
        options={[{ value: '', label: 'Unassigned' }, ...people.map((p) => ({ value: String(p.id), label: p.name }))]}
        onChange={(v) => onChange(v ? Number(v) : null)}
      />
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
      {issue.subtasks.length === 0 && <div className="empty-box">No subtasks yet</div>}
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
      {Object.keys(issue.links).length === 0 && <div className="empty-box">No linked issues</div>}
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
        <Dropdown
          className="link-type-dropdown"
          value={linkType}
          options={LINK_TYPES.map((t) => ({ value: t, label: t }))}
          onChange={setLinkType}
        />
        <input placeholder="Issue key (e.g. YS-3)" value={linkedKey} onChange={(e) => setLinkedKey(e.target.value)} />
        <button type="submit" className="btn" disabled={!linkedKey.trim()}>
          Link
        </button>
      </form>
      {err && <p className="error">{err}</p>}
    </section>
  )
}

function Comment({ c, k, onChanged }: { c: CommentType; k: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(c.body)
  const [busy, setBusy] = useState(false)

  if (editing) {
    return (
      <div className="comment">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} autoFocus />
        <div className="comment-edit-actions">
          <button
            type="button"
            className="btn primary"
            disabled={!body.trim() || busy}
            onClick={() => {
              const b = body.trim()
              if (!b || busy) return
              setBusy(true)
              api(`/issues/${k}/comments/${c.id}`, 'PATCH', { body: b })
                .then(() => {
                  setEditing(false)
                  onChanged()
                })
                .finally(() => setBusy(false))
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setBody(c.body)
              setEditing(false)
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="comment">
      <div className="comment-head">
        <strong>{c.author?.name ?? 'Anonymous'}</strong>
        <span className="muted">{c.created_at} UTC</span>
        <span className="comment-actions">
          <button type="button" className="comment-action" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            type="button"
            className="comment-action"
            onClick={() => api(`/issues/${k}/comments/${c.id}`, 'DELETE').then(onChanged)}
          >
            Delete
          </button>
        </span>
      </div>
      <div className="comment-body">
        <ReactMarkdown>{c.body}</ReactMarkdown>
      </div>
    </div>
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
        <Comment key={c.id} c={c} k={k} onChanged={onChanged} />
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

// Two-step confirm (same pattern as the board's Clear button): first click
// arms the button, second click deletes; arming disarms on mouse-leave.
function DeleteButton({ issueKey, onDelete }: { issueKey: string; onDelete: () => Promise<void> }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <button
      className={'btn danger-ghost' + (armed ? ' armed' : '')}
      disabled={busy}
      onMouseLeave={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true)
        setBusy(true)
        onDelete().finally(() => {
          setBusy(false)
          setArmed(false)
        })
      }}
      title="Delete issue (cannot be undone)"
    >
      {armed ? `Delete ${issueKey}?` : 'Delete'}
    </button>
  )
}

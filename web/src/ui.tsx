// Small shared presentational bits.
import { useEffect, useRef, useState } from 'react'

// Minimal hand-drawn glyphs (16x16, stroke=currentColor) — no icon library needed for four shapes.
const TYPE_GLYPH: Record<string, React.ReactNode> = {
  story: (
    <path d="M3 12.5 8 5l5 7.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
  ),
  bug: (
    <>
      <circle cx="8" cy="9" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 5V3M5.2 6.5 3.5 4.8M10.8 6.5l1.7-1.7M4 9H2M14 9h-2M5 12l-1.5 1.5M11 12l1.5 1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </>
  ),
  task: (
    <path d="M4 8.5 6.8 11 12 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  ),
  epic: <path d="M9 2 3.5 9h3.8L6.5 14 12.5 6.5H8.7z" fill="currentColor" />,
}

export const TYPE_COLOR: Record<string, string> = {
  story: '#2FAE73',
  bug: '#E5493A',
  task: '#4C8DE0',
  epic: '#8B4FE0',
}

export function typeColor(t: { icon: string } | null): string {
  return (t && TYPE_COLOR[t.icon]) || '#9B95B3'
}

export function TypeIcon({ t }: { t: { name: string; icon: string } | null }) {
  if (!t) return null
  const color = typeColor(t)
  const glyph = TYPE_GLYPH[t.icon]
  return (
    <span className="typeicon" title={t.name} style={{ background: color }}>
      {glyph ? (
        <svg width="10" height="10" viewBox="0 0 16 16">
          {glyph}
        </svg>
      ) : (
        t.name[0]?.toUpperCase()
      )}
    </span>
  )
}

// Field-label icons for the issue modal side panel — same hand-drawn style, 14x14.
function fieldIcon(paths: React.ReactNode) {
  return function Icon() {
    return (
      <svg className="field-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {paths}
      </svg>
    )
  }
}

export const IconStatus = fieldIcon(<path d="M3 8.5 6.5 12 13 4" />)
export const IconPerson = fieldIcon(<><circle cx="8" cy="5.5" r="2.5" /><path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /></>)
export const IconSprint = fieldIcon(<><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M2.5 6.5h11M6 2.5v11" /></>)
export const IconParent = fieldIcon(<path d="M4 13V6a2 2 0 0 1 2-2h6M8 8 12 4l0 8" />)
export const IconCalendar = fieldIcon(<><rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></>)
export const IconTeam = fieldIcon(<><circle cx="5.5" cy="6" r="2" /><circle cx="11" cy="7" r="1.6" /><path d="M2 13c0-2.2 1.6-3.5 3.5-3.5S9 10.8 9 13M9.3 9.8c1.6.1 2.7 1.2 2.7 3.2" /></>)
export const IconClock = fieldIcon(<><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.5" /></>)

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ flex: '0 0 auto' }}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

export function Avatar({ p, size = 24 }: { p: { name: string; avatar_color?: string | null }; size?: number }) {
  const initials = p.name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <span
      className="avatar"
      title={p.name}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: p.avatar_color || '#9B95B3' }}
    >
      {initials}
    </span>
  )
}

export function dueUrgent(due: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(due + 'T00:00:00')
  return (d.getTime() - today.getTime()) / 86400000 <= 2 // overdue or within 2 days
}

export function DueBadge({ due }: { due: string | null }) {
  if (!due) return null
  return (
    <span className={'due' + (dueUrgent(due) ? ' hot' : '')} title={'Due ' + due}>
      {due}
    </span>
  )
}

// ---- Dropdown: single reusable popover replacing every native <select>. ----

export type DropdownOption = { value: string; label: React.ReactNode; render?: React.ReactNode }

export function Dropdown({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  className = '',
  renderValue,
}: {
  value: string
  options: DropdownOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  renderValue?: (opt: DropdownOption | undefined) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find((o) => o.value === value)

  return (
    <div className={'dropdown ' + className} ref={ref}>
      <button type="button" className="dropdown-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="dropdown-value">
          {renderValue ? renderValue(current) : current ? current.label : <span className="placeholder">{placeholder}</span>}
        </span>
        <ChevronDown />
      </button>
      {open && (
        <div className="dropdown-panel">
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              className="dropdown-option"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span className="dropdown-check">{o.value === value ? '✓' : ''}</span>
              {o.render ?? o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

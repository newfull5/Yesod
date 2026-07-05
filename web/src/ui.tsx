// Small shared presentational bits.

const TYPE_STYLE: Record<string, { bg: string; glyph: string }> = {
  story: { bg: '#36b37e', glyph: 'S' },
  bug: { bg: '#e5493a', glyph: 'B' },
  task: { bg: '#4bade8', glyph: 'T' },
  epic: { bg: '#904ee2', glyph: 'E' },
}

export function TypeIcon({ t }: { t: { name: string; icon: string } | null }) {
  if (!t) return null
  const s = TYPE_STYLE[t.icon] ?? { bg: '#64748b', glyph: t.name[0]?.toUpperCase() ?? '?' }
  return (
    <span className="typeicon" title={t.name} style={{ background: s.bg }}>
      {s.glyph}
    </span>
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
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: p.avatar_color || '#64748b' }}
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

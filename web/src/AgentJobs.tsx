import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { AgentJob } from './api'

export default function AgentJobs({ onOpen }: { onOpen: (key: string) => void }) {
  const [jobs, setJobs] = useState<AgentJob[] | null>(null)
  const [err, setErr] = useState('')
  const load = useCallback(
    () =>
      api<AgentJob[]>('/agent/jobs')
        .then((j) => {
          setJobs(j)
          setErr('')
        })
        .catch((e: Error) => setErr(e.message)),
    [],
  )
  useEffect(() => {
    void load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  if (err) return <div className="center-msg">{err}</div>
  if (!jobs) return <div className="center-msg">Loading…</div>
  if (jobs.length === 0) return <div className="center-msg">No agent jobs yet — start one from an issue.</div>
  return (
    <div className="agent-jobs">
      <table>
        <thead>
          <tr>
            <th>Issue</th>
            <th>Status</th>
            <th>Requested by</th>
            <th>Result</th>
            <th>Created</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {[...jobs].reverse().map((j) => (
            <tr key={j.id}>
              <td>
                <button className="linklike" onClick={() => onOpen(j.issue_key)}>
                  {j.issue_key}
                </button>
              </td>
              <td>
                <span className={`agent-chip ${j.status}`}>{j.status}</span>
              </td>
              <td>{j.requested_by ?? '—'}</td>
              <td>{j.result ?? '—'}</td>
              <td>{j.created_at}</td>
              <td>
                {(j.status === 'queued' || j.status === 'running') && (
                  <button
                    className="btn subtle"
                    onClick={() => api(`/agent/jobs/${j.id}`, 'PATCH', { status: 'failed', result: 'canceled' }).then(load)}
                  >
                    Cancel
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

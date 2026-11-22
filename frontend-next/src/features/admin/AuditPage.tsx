// Audit log (every change to every incident, who and when) and the SLA breach register.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, Search } from 'lucide-react'
import { api, useQuery } from '../../api'
import { dateTime, EVENT_LABEL, eventLabel, timeAgo } from '../../lib/format'
import { Button, Empty, Field, Input, Segmented, Select, Skeleton } from '../../ui/Controls'
import { PriorityBadge } from '../../ui/Badges'
import { AdminGate } from './AdminGate'

export default function AuditPage() {
  const [tab, setTab] = useState<'audit' | 'sla'>('audit')
  const [f, setF] = useState({ incident: '', action: '', actor: '', date_from: '', date_to: '' })
  const [applied, setApplied] = useState(f)
  const key = `admin:audit:${JSON.stringify(applied)}`
  const audit = useQuery(tab === 'audit' ? key : null, () => api.admin.audit({ ...applied, limit: 500 }))
  const sla = useQuery(tab === 'sla' ? 'admin:violations' : null, () => api.admin.violations(300))
  const exportCsv = () => {
    const rows = (audit.data || []).map(a => [a.timestamp, a.incident_number, a.action, a.actor_name, a.actor_role || '', a.previous_state || '', a.new_state || '', a.description])
    const csv = [['time', 'incident', 'action', 'actor', 'role', 'from', 'to', 'description'], ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'bits-reports-audit.csv'; a.click()
  }
  return (
    <AdminGate error={audit.error || sla.error}>
      <main className="page page-wide">
        <header className="page-head"><div><h1>Audit and SLA log</h1><p>A permanent record of what happened to every incident.</p></div>
          {tab === 'audit' && <Button icon={<Download size={15} />} onClick={exportCsv} disabled={!audit.data?.length}>Export CSV</Button>}</header>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'audit', label: 'Audit log' }, { value: 'sla', label: 'SLA breaches' }]} />
        {tab === 'audit' ? <>
          <form className="filters-form surface pad" onSubmit={e => { e.preventDefault(); setApplied(f) }}>
            <Field label="Incident"><Input value={f.incident} onChange={e => setF({ ...f, incident: e.target.value })} placeholder="INC-00042" /></Field>
            <Field label="What happened"><Select value={f.action} onChange={e => setF({ ...f, action: e.target.value })}><option value="">Anything</option>
              {Object.entries(EVENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="By"><Input value={f.actor} onChange={e => setF({ ...f, actor: e.target.value })} placeholder="Name" /></Field>
            <Field label="From"><Input type="date" value={f.date_from} onChange={e => setF({ ...f, date_from: e.target.value })} /></Field>
            <Field label="To"><Input type="date" value={f.date_to} onChange={e => setF({ ...f, date_to: e.target.value })} /></Field>
            <Button type="submit" variant="primary" icon={<Search size={15} />}>Search</Button>
          </form>
          {!audit.data ? <Skeleton h={400} r={20} /> : !audit.data.length ? <Empty title="No matching entries">Try a wider date range.</Empty> : (
            <div className="table-wrap surface">
              <table className="itable">
                <thead><tr><th>When</th><th>Incident</th><th>What</th><th>By</th><th>Details</th></tr></thead>
                <tbody>{audit.data.map(a => (
                  <tr key={a.id}>
                    <td className="small" title={dateTime(a.timestamp)}>{dateTime(a.timestamp)}</td>
                    <td><Link className="link tabular" to={`/incidents/${a.incident_id}`}>{a.incident_number}</Link></td>
                    <td><span className="badge">{eventLabel(a.action)}</span></td>
                    <td>{a.actor_name}<small className="muted"> {a.actor_role}</small></td>
                    <td className="small">{a.description}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </> : !sla.data ? <Skeleton h={400} r={20} /> : !sla.data.length ? <Empty title="No SLA breaches">Every deadline has been met.</Empty> : (
          <div className="table-wrap surface">
            <table className="itable">
              <thead><tr><th>Detected</th><th>Incident</th><th>Priority</th><th>Missed</th><th>Due</th><th>Assignee</th></tr></thead>
              <tbody>{sla.data.map(v => (
                <tr key={v.id}>
                  <td className="small" title={dateTime(v.detected_at)}>{timeAgo(v.detected_at)}</td>
                  <td><Link className="link" to={`/incidents/${v.incident_id}`}><b className="tabular">{v.incident_number}</b> {v.title}</Link><small className="muted"> {v.service_name}</small></td>
                  <td><PriorityBadge p={v.priority} /></td>
                  <td><span className="badge danger">{v.kind === 'response' ? 'Response' : 'Resolution'}</span></td>
                  <td className="small">{dateTime(v.due_at)}</td>
                  <td>{v.assigned_name || <span className="muted">Nobody</span>}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </main>
    </AdminGate>
  )
}

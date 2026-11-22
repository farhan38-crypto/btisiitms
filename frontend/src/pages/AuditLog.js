import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import api, { errMsg } from '../api';
import { Badge, Loading, Empty, fmtShort, roleLabel } from '../components/common';

const ACTIONS = ['INCIDENT_CREATED', 'INCIDENT_CLASSIFIED', 'PRIORITY_CALCULATED', 'SLA_APPLIED', 'ASSIGNED', 'STATUS_CHANGED',
  'INFO_REQUESTED', 'RESOLVED', 'REOPENED', 'CLOSED', 'PRIORITY_CHANGED', 'INCIDENT_UPDATED', 'NOTE_ADDED', 'SLA_AT_RISK',
  'SLA_BREACHED', 'ESCALATED', 'CORRELATION_DETECTED'];

export default function AuditLog() {
  const [tab, setTab] = useState('audit');
  return (
    <>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'tab active' : 'tab'} onClick={() => setTab('audit')}>Audit log</button>
        <button role="tab" aria-selected={tab === 'sla'} className={tab === 'sla' ? 'tab active' : 'tab'} onClick={() => setTab('sla')}>SLA violations</button>
      </div>
      {tab === 'audit' ? <Audit /> : <Violations />}
    </>
  );
}

function Audit() {
  const [f, setF] = useState({ incident: '', action: '', actor: '', date_from: '', date_to: '' });
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
      api.get('/admin/audit', { params: { ...params, limit: 300 } })
        .then(r => { if (!cancelled) setRows(r.data); })
        .catch(e => !cancelled && toast.error(errMsg(e) || 'Could not load audit log'));
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [f]);

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  return (
    <div className="panel">
      <span className="eyebrow">COMPLETE HISTORY</span>
      <h3>Audit log</h3>
      <div className="filter-grid" style={{ marginBottom: 16 }}>
        <label>Incident<div className="search"><Search size={16} /><input value={f.incident} onChange={e => set('incident', e.target.value)} placeholder="INC-00012" /></div></label>
        <label>Action
          <select value={f.action} onChange={e => set('action', e.target.value)}>
            <option value="">All actions</option>
            {ACTIONS.map(a => <option key={a} value={a}>{a.replaceAll('_', ' ').toLowerCase()}</option>)}
          </select>
        </label>
        <label>User<input value={f.actor} onChange={e => set('actor', e.target.value)} placeholder="Name" /></label>
        <label>From<input type="date" value={f.date_from} onChange={e => set('date_from', e.target.value)} /></label>
        <label>To<input type="date" value={f.date_to} onChange={e => set('date_to', e.target.value)} /></label>
      </div>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty /> : (
        <div className="table-wrap plain">
          <table>
            <thead><tr><th>Time</th><th>Incident</th><th>User</th><th>Action</th><th>State</th><th>Description</th></tr></thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtShort(a.timestamp)}</td>
                  <td>{a.incident_id ? <Link to={`/incidents/${a.incident_id}`}><b>{a.incident_number}</b></Link> : a.incident_number}</td>
                  <td>{a.actor_name || 'System'}<small>{roleLabel(a.actor_role)}</small></td>
                  <td><span className="badge">{a.action.replaceAll('_', ' ')}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{a.previous_state || a.new_state ? `${a.previous_state || '—'} → ${a.new_state || '—'}` : ''}</td>
                  <td>{a.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Violations() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.get('/admin/sla-violations').then(r => setRows(r.data)).catch(e => toast.error(errMsg(e) || 'Could not load SLA violations'));
  }, []);
  return (
    <div className="panel">
      <span className="eyebrow">SLA MONITORING</span>
      <h3>Recorded SLA violations</h3>
      <p className="muted small-text">Each missed response or resolution deadline is recorded once, when the monitor detects it.</p>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty text="No SLA violations recorded." /> : (
        <div className="table-wrap plain">
          <table>
            <thead><tr><th>Detected</th><th>Incident</th><th>Priority</th><th>Deadline missed</th><th>Was due</th><th>Service</th><th>Technician</th></tr></thead>
            <tbody>
              {rows.map(v => (
                <tr key={v.id}>
                  <td>{fmtShort(v.detected_at)}</td>
                  <td><Link to={`/incidents/${v.incident_id}`}><b>{v.incident_number}</b></Link><small>{v.title}</small></td>
                  <td><Badge v={v.priority} /></td>
                  <td>{v.kind === 'response' ? 'Response' : 'Resolution'}</td>
                  <td>{fmtShort(v.due_at)}</td>
                  <td>{v.service_name}</td>
                  <td>{v.assigned_name || 'Unassigned'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

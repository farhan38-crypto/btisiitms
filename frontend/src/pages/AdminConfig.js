import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Save, Siren, Link2, ShieldCheck, MapPinned } from 'lucide-react';
import api, { errMsg } from '../api';
import { Loading, Empty, Modal, minutesLabel, PRIORITIES } from '../components/common';

const TABS = [
  ['strategy', 'Strategies & automation'],
  ['services', 'IT services'],
  ['categories', 'Categories'],
  ['sla', 'SLA policies']
];

export default function AdminConfig() {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem('bits-config-tab') || 'strategy'; } catch { return 'strategy'; }
  });
  const choose = t => { setTab(t); try { localStorage.setItem('bits-config-tab', t); } catch {} };
  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'tab active' : 'tab'} onClick={() => choose(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'strategy' && <StrategySettings />}
      {tab === 'services' && <Services />}
      {tab === 'categories' && <Categories />}
      {tab === 'sla' && <SlaPolicies />}
    </>
  );
}

// ───────────── strategies & automation ─────────────
function StrategySettings() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/admin/settings').then(r => { setData(r.data); setForm(r.data.settings); })
      .catch(e => toast.error(errMsg(e) || 'Could not load settings'));
  }, []);

  if (!data || !form) return <Loading />;
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const togglePriority = p => set('escalation_priorities', form.escalation_priorities.includes(p)
    ? form.escalation_priorities.filter(x => x !== p) : [...form.escalation_priorities, p].sort());

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/admin/settings', form);
      setData(r.data); setForm(r.data.settings);
      toast.success('Settings saved — new incidents use them immediately');
    } catch (e) {
      toast.error(errMsg(e) || 'Could not save settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="grid two">
        <div className="panel">
          <span className="eyebrow">STRATEGY PATTERN</span>
          <h3>Technician assignment strategy</h3>
          <p className="muted small-text">Used by “Auto-dispatch”, auto-assignment on creation and escalation.</p>
          <div className="choice-list">
            {data.assignment_strategies.map(s => (
              <label key={s.key} className={`choice ${form.assignment_strategy === s.key ? 'selected' : ''}`}>
                <input type="radio" name="assignment" checked={form.assignment_strategy === s.key} onChange={() => set('assignment_strategy', s.key)} />
                <span><b>{s.name}</b><small>{s.description}</small></span>
              </label>
            ))}
          </div>
        </div>
        <div className="panel">
          <span className="eyebrow">STRATEGY PATTERN</span>
          <h3>Priority calculation</h3>
          <div className="choice-list">
            {data.priority_strategies.map(s => (
              <label key={s.key} className={`choice ${form.priority_strategy === s.key ? 'selected' : ''}`}>
                <input type="radio" name="priority" checked={form.priority_strategy === s.key} onChange={() => set('priority_strategy', s.key)} />
                <span><b>{s.name}</b><small>{s.description}</small></span>
              </label>
            ))}
          </div>
          <label className="check-label" style={{ marginTop: 18 }}>
            <input type="checkbox" checked={!!form.auto_assign_on_create} onChange={e => set('auto_assign_on_create', e.target.checked)} />
            Automatically assign a technician as soon as an incident is reported
          </label>
        </div>
      </div>

      <div className="grid two">
        <div className="panel">
          <div className="panel-title-row"><Siren size={18} /><h3>Automatic escalation</h3></div>
          <label className="check-label">
            <input type="checkbox" checked={!!form.escalation_enabled} onChange={e => set('escalation_enabled', e.target.checked)} />
            Escalate incidents that are not acknowledged in time
          </label>
          <div className="chip-row" style={{ margin: '12px 0' }}>
            <span className="field-label">Applies to</span>
            {PRIORITIES.map(p => (
              <label key={p} className="check-label inline">
                <input type="checkbox" checked={form.escalation_priorities.includes(p)} disabled={!form.escalation_enabled} onChange={() => togglePriority(p)} /> {p}
              </label>
            ))}
          </div>
          <ol className="ladder">
            <li><b>Level 1 · Team Lead</b><small>at 50% of the response time → technicians skilled in the category</small></li>
            <li><b>Level 2 · System Administrator</b><small>when the response SLA is missed → administrators; unassigned incidents are auto-dispatched</small></li>
            <li><b>Level 3 · IT Manager</b><small>at 200% of the response time → administrators, marked urgent</small></li>
          </ol>
        </div>
        <div className="panel">
          <div className="panel-title-row"><Link2 size={18} /><h3>Incident correlation</h3></div>
          <p className="muted small-text">Alert administrators when one service receives several reports in a short time — usually one underlying outage.</p>
          <div className="form-grid">
            <label>Reports needed
              <input type="number" min="2" max="20" value={form.correlation_threshold} onChange={e => set('correlation_threshold', +e.target.value)} />
            </label>
            <label>Within (minutes)
              <input type="number" min="10" max="1440" value={form.correlation_window_minutes} onChange={e => set('correlation_window_minutes', +e.target.value)} />
            </label>
          </div>
        </div>
      </div>
      <div className="grid two">
        <div className="panel">
          <div className="panel-title-row"><ShieldCheck size={18} /><h3>Sign-in security</h3></div>
          <label className="check-label">
            <input type="checkbox" checked={!!form.require_admin_2fa} onChange={e => set('require_admin_2fa', e.target.checked)} />
            Require administrators to use an authenticator app
          </label>
          <p className="muted small-text" style={{ marginTop: 8 }}>
            Admins without one are locked out of the admin pages until they set it up under Account &amp; security.
            Turn on your own first. Students and technicians can choose for themselves.
          </p>
        </div>
        <div className="panel">
          <div className="panel-title-row"><MapPinned size={18} /><h3>Site visits</h3></div>
          <label className="check-label">
            <input type="checkbox" checked={form.require_handover_code !== false} onChange={e => set('require_handover_code', e.target.checked)} />
            Hostel repairs need the student's 4-digit handover code to be resolved
          </label>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label>GPS check-in radius (metres)
              <input type="number" min="30" max="1000" value={form.arrival_radius_m ?? 150} onChange={e => set('arrival_radius_m', +e.target.value)} />
            </label>
          </div>
          <p className="muted small-text">A technician counts as "arrived" within this distance of the reported spot (plus the GPS accuracy).</p>
        </div>
      </div>
      <div className="sticky-save">
        <button className="primary" disabled={busy} onClick={save}><Save size={16} /> {busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </>
  );
}

// ───────────── IT services ─────────────
const CRIT = { 1: 'Low', 2: 'Important', 3: 'Business critical' };

function Services() {
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/admin/services').then(r => setRows(r.data)).catch(e => toast.error(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);

  const save = async form => {
    try {
      if (form.id) await api.put(`/admin/services/${form.id}`, form);
      else await api.post('/admin/services', form);
      toast.success('Service saved');
      setEditing(null);
      load();
    } catch (e) { toast.error(errMsg(e) || 'Could not save service'); }
  };
  const remove = async s => {
    if (!window.confirm(`Delete the service “${s.name}”?`)) return;
    try { await api.delete(`/admin/services/${s.id}`); toast.success('Service deleted'); load(); }
    catch (e) { toast.error(errMsg(e) || 'Could not delete service'); }
  };

  if (!rows) return <Loading />;
  return (
    <div className="panel">
      <div className="panel-head">
        <div><span className="eyebrow">CATALOG</span><h3>IT services</h3>
          <p className="muted small-text">Criticality feeds the priority calculation for every incident on the service.</p></div>
        <button className="primary small" onClick={() => setEditing({ name: '', description: '', criticality: 2 })}><Plus size={14} /> Add service</button>
      </div>
      <div className="table-wrap plain">
        <table>
          <thead><tr><th>Service</th><th>Criticality</th><th>Incidents</th><th /></tr></thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id}>
                <td><b>{s.name}</b><small>{s.description && s.description !== s.name ? s.description : ''}</small></td>
                <td><span className={`badge crit-${s.criticality}`}>{s.criticality} · {CRIT[s.criticality]}</span></td>
                <td>{s.incident_count}</td>
                <td className="row-actions">
                  <button className="icon-btn small" title="Edit" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil size={15} /></button>
                  <button className="icon-btn small" title={s.incident_count ? 'In use — cannot delete' : 'Delete'} aria-label={`Delete ${s.name}`}
                    disabled={s.incident_count > 0} onClick={() => remove(s)}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <Modal title={editing.id ? `Edit ${editing.name}` : 'Add IT service'} onClose={() => setEditing(null)}>
          <ServiceForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

function ServiceForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({ id: initial.id, name: initial.name, description: initial.description || '', criticality: initial.criticality || 2 });
  return (
    <form className="modal-form" onSubmit={e => { e.preventDefault(); onSave({ ...f, name: f.name.trim() }); }}>
      <label>Name<input required minLength={2} maxLength={80} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <label>Description<input maxLength={500} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
      <label>Business criticality
        <select value={f.criticality} onChange={e => setF({ ...f, criticality: +e.target.value })}>
          {[1, 2, 3].map(n => <option key={n} value={n}>{n} — {CRIT[n]}</option>)}
        </select>
      </label>
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary">Save</button>
      </div>
    </form>
  );
}

// ───────────── categories ─────────────
function Categories() {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState('');
  const load = useCallback(() => api.get('/admin/categories').then(r => setRows(r.data)).catch(e => toast.error(errMsg(e))), []);
  useEffect(() => { load(); }, [load]);

  const add = async e => {
    e.preventDefault();
    try { await api.post('/admin/categories', { name: name.trim() }); setName(''); toast.success('Category added'); load(); }
    catch (err) { toast.error(errMsg(err) || 'Could not add category'); }
  };
  const remove = async c => {
    if (!window.confirm(`Delete the category “${c.name}”?`)) return;
    try { await api.delete(`/admin/categories/${c.id}`); toast.success('Category deleted'); load(); }
    catch (err) { toast.error(errMsg(err) || 'Could not delete category'); }
  };

  if (!rows) return <Loading />;
  return (
    <div className="panel">
      <span className="eyebrow">CLASSIFICATION</span>
      <h3>Incident categories</h3>
      <p className="muted small-text">New categories appear in the report form and filters immediately. Categories in use cannot be deleted.</p>
      <form className="inline-form" onSubmit={add}>
        <input required minLength={2} maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="New category, e.g. Projector" aria-label="New category name" />
        <button className="primary small" type="submit"><Plus size={14} /> Add</button>
      </form>
      <div className="category-grid">
        {rows.map(c => (
          <div className="category-chip" key={c.id}>
            <span><b>{c.name}</b><small>{c.incident_count} incident{c.incident_count === 1 ? '' : 's'}</small></span>
            <button className="icon-btn small" aria-label={`Delete ${c.name}`} title={c.incident_count ? 'In use' : 'Delete'}
              disabled={c.incident_count > 0} onClick={() => remove(c)}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────── SLA policies ─────────────
function SlaPolicies() {
  const [rows, setRows] = useState(null);
  const [services, setServices] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/admin/sla').then(r => setRows(r.data)).catch(e => toast.error(errMsg(e))), []);
  useEffect(() => { load(); api.get('/catalog/services').then(r => setServices(r.data)).catch(() => {}); }, [load]);

  const save = async f => {
    const body = { name: f.name.trim(), priority: f.priority, response_minutes: +f.response_minutes,
      resolution_minutes: +f.resolution_minutes, service_id: f.service_id || null };
    try {
      if (f.id) await api.put(`/admin/sla/${f.id}`, body); else await api.post('/admin/sla', body);
      toast.success('SLA policy saved'); setEditing(null); load();
    } catch (e) { toast.error(errMsg(e) || 'Could not save policy'); }
  };
  const remove = async p => {
    if (!window.confirm(`Delete “${p.name}”?`)) return;
    try { await api.delete(`/admin/sla/${p.id}`); toast.success('Policy deleted'); load(); }
    catch (e) { toast.error(errMsg(e) || 'Could not delete policy'); }
  };

  if (!rows) return <Loading />;
  const sorted = [...rows].sort((a, b) => a.priority.localeCompare(b.priority) || (a.service_id ? 1 : -1));
  return (
    <div className="panel">
      <div className="panel-head">
        <div><span className="eyebrow">SERVICE LEVEL AGREEMENTS</span><h3>SLA policies</h3>
          <p className="muted small-text">A service-specific policy overrides the default for that priority. Changes apply to new incidents and priority changes.</p></div>
        <button className="primary small" onClick={() => setEditing({ name: '', priority: 'P2', response_minutes: 30, resolution_minutes: 240, service_id: '' })}>
          <Plus size={14} /> Add service-specific policy
        </button>
      </div>
      {sorted.length ? (
        <div className="table-wrap plain">
          <table>
            <thead><tr><th>Priority</th><th>Policy</th><th>Applies to</th><th>Respond within</th><th>Resolve within</th><th /></tr></thead>
            <tbody>
              {sorted.map(p => (
                <tr key={p.id}>
                  <td><span className={`badge ${p.priority.toLowerCase()}`}>{p.priority}</span></td>
                  <td><b>{p.name}</b></td>
                  <td>{p.service_name}</td>
                  <td>{minutesLabel(p.response_minutes)}</td>
                  <td>{minutesLabel(p.resolution_minutes)}</td>
                  <td className="row-actions">
                    <button className="icon-btn small" aria-label={`Edit ${p.name}`} onClick={() => setEditing({ ...p, service_id: p.service_id || '' })}><Pencil size={15} /></button>
                    <button className="icon-btn small" aria-label={`Delete ${p.name}`} disabled={!p.service_id}
                      title={p.service_id ? 'Delete' : 'Default policies are required'} onClick={() => remove(p)}><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty />}
      {editing && (
        <Modal title={editing.id ? `Edit ${editing.name}` : 'Add SLA policy'} onClose={() => setEditing(null)}>
          <form className="modal-form" onSubmit={e => { e.preventDefault(); save(editing); }}>
            <label>Name<input required minLength={2} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
            <label>Priority
              <select value={editing.priority} disabled={editing.id && !editing.service_id} onChange={e => setEditing({ ...editing, priority: e.target.value })}>
                {PRIORITIES.map(p => <option key={p}>{p}</option>)}
              </select>
            </label>
            <label>Service
              <select value={editing.service_id} disabled={editing.id && !editing.service_id} onChange={e => setEditing({ ...editing, service_id: e.target.value })}>
                {editing.id && !editing.service_id && <option value="">All services (default)</option>}
                {!(editing.id && !editing.service_id) && <option value="" disabled>Choose a service…</option>}
                {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Respond within (minutes)
              <input type="number" min="1" required value={editing.response_minutes} onChange={e => setEditing({ ...editing, response_minutes: e.target.value })} />
            </label>
            <label>Resolve within (minutes)
              <input type="number" min={editing.response_minutes || 1} required value={editing.resolution_minutes} onChange={e => setEditing({ ...editing, resolution_minutes: e.target.value })} />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="primary" disabled={!(editing.id && !editing.service_id) && !editing.service_id}>Save policy</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

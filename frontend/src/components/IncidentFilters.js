import React, { useEffect, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import api from '../api';
import { PRIORITIES, STATUSES, SLA_STATUSES, statusLabel } from './common';

export const EMPTY_FILTERS = {
  q: '', status: '', priority: '', category: '', service_id: '', assigned_to: '', sla_status: '',
  date_from: '', date_to: '', escalated: false
};

// Search & filter bar: incident ID/text, status, priority, category, service,
// technician, SLA status, date range and escalation.
export default function IncidentFilters({ value, onChange, role }) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const isAdmin = role === 'admin';
  const isStaff = role === 'admin' || role === 'technician';

  useEffect(() => {
    api.get('/catalog/services').then(r => setServices(r.data)).catch(() => {});
    api.get('/catalog/categories').then(r => setCategories(r.data)).catch(() => {});
    if (isAdmin) api.get('/catalog/technicians').then(r => setTechnicians(r.data)).catch(() => {});
  }, [isAdmin]);

  const set = (k, v) => onChange({ ...value, [k]: v });
  const active = Object.entries(value).filter(([k, v]) => k !== 'q' && v).length;

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <div className="search">
          <Search size={18} color="#94a3b8" />
          <input
            placeholder="Search incident ID, title, reporter, Bhavan or Block…"
            value={value.q}
            onChange={e => set('q', e.target.value)}
            aria-label="Search incidents"
          />
        </div>
        <button type="button" className={open || active ? 'primary small' : 'secondary small'} onClick={() => setOpen(o => !o)}>
          <SlidersHorizontal size={14} /> Filters{active ? ` (${active})` : ''}
        </button>
        {active > 0 && (
          <button type="button" className="secondary small" onClick={() => onChange({ ...EMPTY_FILTERS, q: value.q })}>
            <X size={14} /> Clear
          </button>
        )}
      </div>
      {open && (
        <div className="filter-grid">
          <label>Status
            <select value={value.status} onChange={e => set('status', e.target.value)}>
              <option value="">Any status</option>
              {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
          <label>Priority
            <select value={value.priority} onChange={e => set('priority', e.target.value)}>
              <option value="">Any priority</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>Category
            <select value={value.category} onChange={e => set('category', e.target.value)}>
              <option value="">Any category</option>
              {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </label>
          <label>Service
            <select value={value.service_id} onChange={e => set('service_id', e.target.value)}>
              <option value="">Any service</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {isAdmin && (
            <label>Technician
              <select value={value.assigned_to} onChange={e => set('assigned_to', e.target.value)}>
                <option value="">Anyone</option>
                <option value="unassigned">Unassigned</option>
                {technicians.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
          <label>SLA status
            <select value={value.sla_status} onChange={e => set('sla_status', e.target.value)}>
              <option value="">Any SLA status</option>
              {SLA_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
          <label>Created from
            <input type="date" value={value.date_from} onChange={e => set('date_from', e.target.value)} />
          </label>
          <label>Created to
            <input type="date" value={value.date_to} min={value.date_from || undefined} onChange={e => set('date_to', e.target.value)} />
          </label>
          {isStaff && (
            <label className="check-label">
              <input type="checkbox" checked={!!value.escalated} onChange={e => set('escalated', e.target.checked)} />
              Escalated only
            </label>
          )}
        </div>
      )}
    </div>
  );
}

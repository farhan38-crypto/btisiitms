// Filters as chips: "+ Filter" → pick a field → pick a value. Each chip reads like a
// sentence ("Priority is P1") and has its own ×. Values live in the URL, so a filtered
// view can be shared or bookmarked.
import { useState } from 'react'
import { ChevronRight, ListFilter, X } from 'lucide-react'
import { PRIORITIES, type IncidentFilters, type User } from '../../api'
import { PRIORITY_LABEL, SLA_LABEL } from '../../lib/format'
import { Popover } from '../../ui/Overlay'
import { PriorityMark } from '../../ui/Badges'
import { useCategories, useServices, useTechnicians } from './data'

export type FilterKey = 'priority' | 'category' | 'service' | 'assignee' | 'sla' | 'since'
export type FilterState = Partial<Record<FilterKey, string>>
export const FILTER_KEYS: FilterKey[] = ['priority', 'category', 'service', 'assignee', 'sla', 'since']
const SINCE: Record<string, { label: string; days: number }> = { '1': { label: 'Today', days: 0 }, '7': { label: 'Last 7 days', days: 6 }, '30': { label: 'Last 30 days', days: 29 } }

export function toServer(f: FilterState): IncidentFilters {
  const out: IncidentFilters = {}
  if (f.priority) out.priority = f.priority as IncidentFilters['priority']
  if (f.category) out.category = f.category
  if (f.service) out.service_id = f.service
  if (f.assignee) out.assigned_to = f.assignee
  if (f.sla) out.sla_status = f.sla as IncidentFilters['sla_status']
  if (f.since && SINCE[f.since]) { const d = new Date(); d.setDate(d.getDate() - SINCE[f.since]!.days); out.date_from = d.toISOString().slice(0, 10) }
  return out
}

export function FilterBar({ value, onChange, user }: { value: FilterState; onChange: (f: FilterState) => void; user: User }) {
  const staff = user.role !== 'customer'
  const { data: cats } = useCategories()
  const { data: svcs } = useServices()
  const { data: techs } = useTechnicians(staff && user.role === 'admin')
  const [field, setField] = useState<FilterKey | null>(null)
  const fields: { key: FilterKey; label: string; options: { value: string; label: string; icon?: React.ReactNode }[] }[] = [
    { key: 'priority', label: 'Priority', options: PRIORITIES.map(p => ({ value: p, label: `${p} · ${PRIORITY_LABEL[p]}`, icon: <PriorityMark p={p} /> })) },
    { key: 'category', label: 'Category', options: (cats || []).map(c => ({ value: c.name, label: c.name })) },
    { key: 'service', label: 'Service', options: (svcs || []).map(s => ({ value: s.id, label: s.name })) },
    ...(user.role === 'admin' ? [{ key: 'assignee' as const, label: 'Assignee', options: [{ value: 'unassigned', label: 'Nobody (unassigned)' }, ...(techs || []).map(t => ({ value: t.id, label: t.name }))] }] : []),
    ...(staff ? [{ key: 'sla' as const, label: 'SLA', options: (['BREACHED', 'AT_RISK', 'ON_TRACK', 'MET'] as const).map(s => ({ value: s, label: SLA_LABEL[s] })) }] : []),
    { key: 'since', label: 'Reported', options: Object.entries(SINCE).map(([v, s]) => ({ value: v, label: s.label })) },
  ]
  const labelOf = (k: FilterKey, v: string) => fields.find(f => f.key === k)?.options.find(o => o.value === v)?.label || v
  const active = FILTER_KEYS.filter(k => value[k])
  const current = fields.find(f => f.key === field)
  return (
    <div className="filters">
      {active.map(k => (
        <span key={k} className="fchip">
          <span>{fields.find(f => f.key === k)?.label || k} <em>is</em> <b>{labelOf(k, value[k]!)}</b></span>
          <button type="button" onClick={() => onChange({ ...value, [k]: undefined })} aria-label={`Remove ${k} filter`}><X size={13} /></button>
        </span>
      ))}
      <Popover title="Filter" width={280} align="start" onOpenChange={o => { if (!o) setField(null) }} trigger={({ toggle, ref, props }) => (
        <button ref={ref} {...props} type="button" className="btn sm btn-quiet" onClick={toggle}><ListFilter size={15} />{active.length ? 'Add' : 'Filter'}</button>
      )}>
        {close => (
          <div className="fmenu">
            {!current ? fields.map(f => (
              <button key={f.key} type="button" className="menu-item" onClick={() => setField(f.key)}>{f.label}<ChevronRight size={14} className="push" /></button>
            )) : <>
              <button type="button" className="fmenu-back" onClick={() => setField(null)}>← {current.label}</button>
              <div className="fmenu-list">
                {current.options.length === 0 && <p className="muted small">Loading…</p>}
                {current.options.map(o => (
                  <button key={o.value} type="button" className="menu-item" data-on={value[current.key] === o.value || undefined}
                    onClick={() => { onChange({ ...value, [current.key]: o.value }); setField(null); close() }}>{o.icon}{o.label}</button>
                ))}
              </div>
            </>}
          </div>
        )}
      </Popover>
      {active.length > 1 && <button type="button" className="link small" onClick={() => onChange({})}>Clear all</button>}
    </div>
  )
}

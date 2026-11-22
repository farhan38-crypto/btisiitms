// Configuration: how incidents are prioritised and routed (Strategy pattern, chosen live),
// automation switches, SLA targets per priority and service, the IT service catalogue and
// categories. Every change saves straight away.
import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Clock, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, ApiError, useQuery, invalidate, PRIORITIES, type Priority, type Service, type Settings, type SettingsBundle, type SlaPolicy } from '../../api'
import { minutes, PRIORITY_LABEL } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { Button, Field, Input, Section, Segmented, Select, Skeleton, Switch, TextArea } from '../../ui/Controls'
import { PriorityBadge } from '../../ui/Badges'
import { Dialog, useConfirm } from '../../ui/Overlay'
import { AdminGate } from './AdminGate'

type Tab = 'automation' | 'sla' | 'services' | 'categories'

export default function ConfigPage() {
  const [tab, setTab] = useState<Tab>('automation')
  const { data, error, set } = useQuery<SettingsBundle>('admin:settings', () => api.admin.settings())
  return (
    <AdminGate error={error}>
      <main className="page page-settings">
        <header className="page-head"><div><h1>Configuration</h1><p>Changes apply to new incidents straight away.</p></div></header>
        <Segmented value={tab} onChange={setTab} label="Section" options={[{ value: 'automation', label: 'Routing and automation' }, { value: 'sla', label: 'SLA targets' }, { value: 'services', label: 'Services' }, { value: 'categories', label: 'Categories' }]} />
        {tab === 'automation' && (data ? <Automation b={data} onSaved={set} /> : <Skeleton h={400} r={24} />)}
        {tab === 'sla' && <SlaTargets />}
        {tab === 'services' && <Services />}
        {tab === 'categories' && <Categories />}
      </main>
    </AdminGate>
  )
}

function Automation({ b, onSaved }: { b: SettingsBundle; onSaved: (b: SettingsBundle) => void }) {
  const { user } = useAuth()
  const s = b.settings
  const save = async (p: Partial<Settings>, ok = 'Saved') => {
    try { onSaved(await api.admin.saveSettings(p)); toast.success(ok); invalidate('overview') } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not save') }
  }
  return (
    <div className="stack">
      <Section title="Priority" hint="How impact, urgency and the service’s importance become P1–P4." className="surface pad">
        <div className="options">{b.priority_strategies.map(x => (
          <button key={x.key} type="button" className="option" data-on={s.priority_strategy === x.key || undefined} onClick={() => save({ priority_strategy: x.key }, `Priority: ${x.name}`)}>
            <span className="radio">{s.priority_strategy === x.key && <Check size={12} strokeWidth={3} />}</span><span><b>{x.name}</b><small>{x.description}</small></span></button>))}</div>
      </Section>
      <Section title="Who gets the incident" hint="Used by Assign → “Use the assignment strategy”, and for every new incident when auto-assign is on." className="surface pad">
        <div className="options">{b.assignment_strategies.map(x => (
          <button key={x.key} type="button" className="option" data-on={s.assignment_strategy === x.key || undefined} onClick={() => save({ assignment_strategy: x.key }, `Assignment: ${x.name}`)}>
            <span className="radio">{s.assignment_strategy === x.key && <Check size={12} strokeWidth={3} />}</span><span><b>{x.name}</b><small>{x.description}</small></span></button>))}</div>
        <Switch checked={s.auto_assign_on_create} onChange={v => save({ auto_assign_on_create: v })} label="Assign new incidents automatically" hint="Otherwise they wait in Unassigned until someone takes them." />
      </Section>
      <Section title="Escalation" className="surface pad">
        <Switch checked={s.escalation_enabled} onChange={v => save({ escalation_enabled: v })} label="Escalate unacknowledged incidents" hint="Notify the next level when nobody responds in time." />
        <Field label="Escalate these priorities"><div className="chips">{PRIORITIES.map(p => (
          <button key={p} type="button" className="pick" data-on={s.escalation_priorities.includes(p) || undefined} disabled={!s.escalation_enabled}
            onClick={() => save({ escalation_priorities: s.escalation_priorities.includes(p) ? s.escalation_priorities.filter(x => x !== p) : [...s.escalation_priorities, p].sort() as Priority[] })}>{p} · {PRIORITY_LABEL[p]}</button>))}</div></Field>
      </Section>
      <Section title="Outage detection" hint="When several reports hit one service or one building quickly, admins are alerted to a possible major incident." className="surface pad">
        <div className="grid-2">
          <Field label="Reports needed"><Select value={s.correlation_threshold} onChange={e => save({ correlation_threshold: +e.target.value })}>{[2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>{n} reports</option>)}</Select></Field>
          <Field label="Within"><Select value={s.correlation_window_minutes} onChange={e => save({ correlation_window_minutes: +e.target.value })}>{[15, 30, 60, 120, 240, 480].map(n => <option key={n} value={n}>{minutes(n)}</option>)}</Select></Field>
        </div>
      </Section>
      <Section title="Field visits and security" className="surface pad">
        <Switch checked={s.require_handover_code} onChange={v => save({ require_handover_code: v })} label="Hostel jobs need the student’s handover code" hint="Like a delivery OTP: proves the technician actually came." />
        <Field label="Check-in distance" hint="How close (plus GPS accuracy) a technician must be to count as arrived."><Select value={s.arrival_radius_m} onChange={e => save({ arrival_radius_m: +e.target.value })}>{[30, 50, 100, 150, 200, 300, 500].map(n => <option key={n} value={n}>{n} m</option>)}</Select></Field>
        <Switch checked={s.require_admin_2fa} disabled={!user?.two_factor_enabled && !s.require_admin_2fa} onChange={v => save({ require_admin_2fa: v })} label="Administrators must use an authenticator app"
          hint={user?.two_factor_enabled ? 'Admin pages lock for admins without it.' : 'Turn on your own authenticator first (Account and security).'} />
      </Section>
    </div>
  )
}

type SlaForm = Omit<SlaPolicy, 'id' | 'service_name'>
function SlaTargets() {
  const { data: list, reload } = useQuery('admin:sla', () => api.admin.sla())
  const { data: svcs } = useQuery('admin:services', () => api.admin.services())
  const confirm = useConfirm()
  const [edit, setEdit] = useState<{ id?: string; f: SlaForm } | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!edit) return; setBusy(true)
    try { if (edit.id) await api.admin.editSla(edit.id, edit.f); else await api.admin.addSla(edit.f); toast.success('SLA saved'); setEdit(null); void reload() }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  const defaults = (list || []).filter(p => !p.service_id).sort((a, b) => a.priority.localeCompare(b.priority))
  const special = (list || []).filter(p => p.service_id)
  const row = (p: SlaPolicy) => (
    <li key={p.id} className="sla-row">
      <PriorityBadge p={p.priority} long />
      <span className="sla-name"><b>{p.name}</b><small>{p.service_name}</small></span>
      <span className="sla-t"><Clock size={13} />respond in <b>{minutes(p.response_minutes)}</b></span>
      <span className="sla-t">resolve in <b>{minutes(p.resolution_minutes)}</b></span>
      <span className="row-actions">
        <button type="button" className="icon-btn ghost" aria-label="Edit" onClick={() => setEdit({ id: p.id, f: { name: p.name, priority: p.priority, response_minutes: p.response_minutes, resolution_minutes: p.resolution_minutes, service_id: p.service_id } })}><Pencil size={15} /></button>
        {p.service_id && <button type="button" className="icon-btn ghost" aria-label="Delete" onClick={async () => { if (await confirm({ title: `Delete “${p.name}”?`, body: 'Incidents on this service fall back to the default target.', confirm: 'Delete', danger: true })) { try { await api.admin.deleteSla(p.id); void reload() } catch (e) { toast.error((e as Error).message) } } }}><Trash2 size={15} /></button>}
      </span>
    </li>
  )
  return (
    <div className="stack">
      <Section title="Default targets" hint="Apply to every service unless a service has its own." className="surface pad">{!list ? <Skeleton h={200} /> : <ul className="sla-list">{defaults.map(row)}</ul>}</Section>
      <Section title="Service-specific targets" className="surface pad" action={<Button icon={<Plus size={15} />} onClick={() => setEdit({ f: { name: '', priority: 'P2', response_minutes: 15, resolution_minutes: 120, service_id: svcs?.[0]?.id || null } })}>Add</Button>}>
        {special.length ? <ul className="sla-list">{special.map(row)}</ul> : <p className="muted small">None yet. Add one when a service needs faster (or slower) targets than the defaults.</p>}
      </Section>
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit SLA target' : 'Add an SLA target'} size="sm"
        footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
        {edit && <div className="form">
          <Field label="Name"><Input value={edit.f.name} onChange={e => setEdit({ ...edit, f: { ...edit.f, name: e.target.value } })} placeholder="Payment gateway P1" /></Field>
          {(!edit.id || edit.f.service_id) && <div className="grid-2">
            <Field label="Priority"><Select value={edit.f.priority} onChange={e => setEdit({ ...edit, f: { ...edit.f, priority: e.target.value as Priority } })}>{PRIORITIES.map(p => <option key={p}>{p}</option>)}</Select></Field>
            <Field label="Service"><Select value={edit.f.service_id || ''} onChange={e => setEdit({ ...edit, f: { ...edit.f, service_id: e.target.value || null } })}>{(svcs || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          </div>}
          <div className="grid-2">
            <Field label="Respond within (minutes)"><Input type="number" min={1} value={edit.f.response_minutes} onChange={e => setEdit({ ...edit, f: { ...edit.f, response_minutes: +e.target.value } })} /></Field>
            <Field label="Resolve within (minutes)" hint={minutes(edit.f.resolution_minutes)}><Input type="number" min={1} value={edit.f.resolution_minutes} onChange={e => setEdit({ ...edit, f: { ...edit.f, resolution_minutes: +e.target.value } })} /></Field>
          </div>
        </div>}
      </Dialog>
    </div>
  )
}

function Services() {
  const { data: list, reload } = useQuery('admin:services', () => api.admin.services())
  const confirm = useConfirm()
  const [edit, setEdit] = useState<{ id?: string; name: string; description: string; criticality: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!edit) return; setBusy(true)
    try { const body = { name: edit.name.trim(), description: edit.description, criticality: edit.criticality }; if (edit.id) await api.admin.editService(edit.id, body); else await api.admin.addService(body); setEdit(null); void reload(); invalidate('catalog:services'); toast.success('Saved') }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  const crit = ['', 'Low', 'Important', 'Business critical']
  return (
    <Section title="IT services" hint="What people report problems with. Criticality raises the priority of its incidents." className="surface pad"
      action={<Button icon={<Plus size={15} />} onClick={() => setEdit({ name: '', description: '', criticality: 1 })}>Add service</Button>}>
      {!list ? <Skeleton h={300} /> : <ul className="crud">{list.map((s: Service) => (
        <li key={s.id}><span><b>{s.name}</b><small>{crit[s.criticality]} · {s.incident_count ?? 0} incidents</small></span>
          <span className="row-actions"><button type="button" className="icon-btn ghost" aria-label={`Edit ${s.name}`} onClick={() => setEdit({ id: s.id, name: s.name, description: s.description, criticality: s.criticality })}><Pencil size={15} /></button>
            <button type="button" className="icon-btn ghost" aria-label={`Delete ${s.name}`} disabled={!!s.incident_count} title={s.incident_count ? 'In use by incidents' : 'Delete'}
              onClick={async () => { if (await confirm({ title: `Delete ${s.name}?`, confirm: 'Delete', danger: true })) { try { await api.admin.deleteService(s.id); void reload(); invalidate('catalog:services') } catch (e) { toast.error((e as Error).message) } } }}><Trash2 size={15} /></button></span></li>))}</ul>}
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit service' : 'Add a service'} size="sm"
        footer={<><button className="btn" onClick={() => setEdit(null)}>Cancel</button><Button variant="primary" busy={busy} disabled={(edit?.name.trim().length || 0) < 2} onClick={save}>Save</Button></>}>
        {edit && <div className="form">
          <Field label="Name"><Input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Description" optional><TextArea rows={2} value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} /></Field>
          <Field label="Criticality"><Segmented value={String(edit.criticality)} onChange={v => setEdit({ ...edit, criticality: +v })} options={[{ value: '1', label: 'Low' }, { value: '2', label: 'Important' }, { value: '3', label: 'Critical' }]} /></Field>
        </div>}
      </Dialog>
    </Section>
  )
}

function Categories() {
  const { data: list, reload } = useQuery('admin:categories', () => api.admin.categories())
  const [name, setName] = useState('')
  const confirm = useConfirm()
  const add = async () => { try { await api.admin.addCategory(name.trim()); setName(''); void reload(); invalidate('catalog:categories') } catch (e) { toast.error((e as Error).message) } }
  return (
    <Section title="Categories" hint="Used for routing (technician skills) and reports." className="surface pad">
      <form className="inline" onSubmit={e => { e.preventDefault(); if (name.trim().length >= 2) void add() }}>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="New category" aria-label="New category" /><Button type="submit" icon={<Plus size={15} />} disabled={name.trim().length < 2}>Add</Button></form>
      {!list ? <Skeleton h={200} /> : <ul className="crud">{list.map(c => (
        <li key={c.id}><span><b>{c.name}</b><small>{c.incident_count ?? 0} incidents</small></span>
          <button type="button" className="icon-btn ghost" aria-label={`Delete ${c.name}`} disabled={!!c.incident_count} title={c.incident_count ? 'In use by incidents' : 'Delete'}
            onClick={async () => { if (await confirm({ title: `Delete ${c.name}?`, confirm: 'Delete', danger: true })) { try { await api.admin.deleteCategory(c.id); void reload(); invalidate('catalog:categories') } catch (e) { toast.error((e as Error).message) } } }}><Trash2 size={15} /></button></li>))}</ul>}
    </Section>
  )
}

// Users and roles: everyone with an account. Admins add technicians and admins, edit skills
// and workload limits, switch accounts off, and reset a lost authenticator.
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { MoreHorizontal, Plus, Search, ShieldOff, UserCheck, UserX } from 'lucide-react'
import { api, ApiError, useQuery, invalidate, type NewUser, type User } from '../../api'
import { useAuth } from '../../lib/auth'
import { ROLE_LABEL } from '../../lib/format'
import { Avatar, Button, Empty, Field, Input, Segmented, Select, Skeleton } from '../../ui/Controls'
import { Dialog, Popover, useConfirm } from '../../ui/Overlay'
import { useCategories } from '../incidents/data'
import { AdminGate } from './AdminGate'

type Tab = 'all' | 'technician' | 'admin' | 'customer'

export default function UsersPage() {
  const { user: me } = useAuth()
  const { data, error, reload } = useQuery('admin:users', () => api.admin.users())
  const [tab, setTab] = useState<Tab>('all'); const [q, setQ] = useState('')
  const [edit, setEdit] = useState<User | 'new' | null>(null)
  const confirm = useConfirm()
  const list = useMemo(() => (data || []).filter(u => (tab === 'all' || u.role === tab) && (!q || `${u.name} ${u.email} ${u.student_id || ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name)), [data, tab, q])
  const count = (r: Tab) => (data || []).filter(u => r === 'all' || u.role === r).length
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.success(ok); void reload(); invalidate('catalog:technicians') } catch (e) { toast.error(e instanceof ApiError ? e.message : 'That didn’t work') } }

  return (
    <AdminGate error={error}>
      <main className="page page-wide">
        <header className="page-head"><div><h1>Users and roles</h1><p>Students sign up themselves with their BITS email; add technicians and admins here.</p></div>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit('new')}>Add staff</Button></header>
        <div className="toolbar">
          <Segmented value={tab} onChange={setTab} label="Role" options={[{ value: 'all', label: 'Everyone', count: count('all') }, { value: 'technician', label: 'Technicians', count: count('technician') }, { value: 'admin', label: 'Admins', count: count('admin') }, { value: 'customer', label: 'Students', count: count('customer') }]} />
          <label className="search-field"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, email, ID" aria-label="Search users" /></label>
        </div>
        {!data ? <Skeleton h={300} r={20} /> : !list.length ? <Empty title="No users match">Try another role or search.</Empty> : (
          <div className="table-wrap surface">
            <table className="itable users">
              <thead><tr><th>Name</th><th>Role</th><th>Skills and limit</th><th>Two-step</th><th>Status</th><th /></tr></thead>
              <tbody>{list.map(u => (
                <tr key={u.id} data-off={!u.is_active || undefined}>
                  <td><span className="who"><Avatar name={u.name} src={u.picture} size={30} /><span><b>{u.name}{u.id === me?.id && <em className="badge">You</em>}</b><small>{u.email}{u.student_id ? ` · ${u.student_id}` : ''}</small></span></span></td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>{u.role === 'technician' ? <><span className="skill-chips">{u.skills.map(s => <em key={s}>{s}</em>)}</span><small className="muted"> up to {u.max_concurrent} open</small></> : <span className="muted">—</span>}</td>
                  <td>{u.two_factor_enabled ? <span className="badge ok">On</span> : <span className="muted small">Off</span>}</td>
                  <td>{u.is_active ? <span className="badge ok">Active</span> : <span className="badge">Switched off</span>}</td>
                  <td className="cell-end">
                    <Popover title={u.name} width={240} trigger={({ toggle, ref, props }) => <button ref={ref} {...props} type="button" className="icon-btn ghost" onClick={toggle} aria-label={`Actions for ${u.name}`}><MoreHorizontal size={16} /></button>}>
                      {close => <div className="menu" onClick={() => close()}>
                        {u.role !== 'customer' && <button type="button" className="menu-item" onClick={() => setEdit(u)}>Edit details</button>}
                        {u.id !== me?.id && (u.is_active
                          ? <button type="button" className="menu-item danger" onClick={async () => { if (await confirm({ title: `Switch off ${u.name}?`, body: 'They can’t sign in until you switch the account back on. Their reports stay.', confirm: 'Switch off', danger: true })) void act(() => api.admin.setActive(u.id, false), `${u.name} switched off`) }}><UserX size={15} />Switch off account</button>
                          : <button type="button" className="menu-item" onClick={() => act(() => api.admin.setActive(u.id, true), `${u.name} switched on`)}><UserCheck size={15} />Switch account on</button>)}
                        {u.two_factor_enabled && u.id !== me?.id && <button type="button" className="menu-item" onClick={async () => { if (await confirm({ title: `Reset ${u.name}’s authenticator?`, body: 'Use this when they lost their phone and backup codes. They’ll sign in with just their password and should set it up again.', confirm: 'Reset', danger: true })) void act(() => api.admin.resetTwoFactor(u.id), 'Authenticator reset') }}><ShieldOff size={15} />Reset authenticator</button>}
                      </div>}
                    </Popover>
                  </td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
        <UserDialog user={edit} onClose={() => setEdit(null)} onSaved={() => { void reload(); invalidate('catalog:technicians') }} />
      </main>
    </AdminGate>
  )
}

function UserDialog({ user, onClose, onSaved }: { user: User | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const isNew = user === 'new'
  const u = user && user !== 'new' ? user : null
  const { data: cats } = useCategories()
  const [f, setF] = useState<NewUser>({ name: '', email: '', password: '', role: 'technician', skills: [], max_concurrent: 5, phone: '' })
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null)
  const [lastId, setLastId] = useState<string | null>(null)
  const key = u?.id || (isNew ? 'new' : null)
  if (key !== lastId) { setLastId(key); setErr(null); setF(u ? { name: u.name, email: u.email, password: '', role: u.role as 'technician', skills: u.skills, max_concurrent: u.max_concurrent, phone: u.phone || '' } : { name: '', email: '', password: '', role: 'technician', skills: [], max_concurrent: 5, phone: '' }) }
  const tech = f.role === 'technician'
  const toggleSkill = (s: string) => setF(x => ({ ...x, skills: x.skills?.includes(s) ? x.skills.filter(y => y !== s) : [...(x.skills || []), s] }))
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      if (isNew) await api.admin.createUser({ ...f, phone: f.phone || undefined, skills: tech ? f.skills : [] })
      else await api.admin.updateUser(u!.id, { name: f.name, phone: f.phone || undefined, ...(tech ? { skills: f.skills, max_concurrent: f.max_concurrent } : {}) })
      toast.success(isNew ? `${f.name} added` : 'Saved'); onSaved(); onClose()
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  return (
    <Dialog open={!!user} onClose={onClose} title={isNew ? 'Add a technician or admin' : `Edit ${u?.name}`} size="md"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><Button variant="primary" busy={busy} disabled={!f.name.trim() || (isNew && (!f.email.trim() || f.password.length < 8))} onClick={save}>{isNew ? 'Add' : 'Save'}</Button></>}>
      <div className="form">
        {isNew && <Field label="Role"><Segmented value={f.role} onChange={r => setF(x => ({ ...x, role: r }))} options={[{ value: 'technician', label: 'Technician' }, { value: 'admin', label: 'Administrator' }]} /></Field>}
        <div className="grid-2">
          <Field label="Name"><Input value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} /></Field>
          <Field label="Phone" optional><Input type="tel" value={f.phone} onChange={e => setF(x => ({ ...x, phone: e.target.value }))} /></Field>
        </div>
        {isNew && <div className="grid-2">
          <Field label="Email"><Input type="email" value={f.email} onChange={e => setF(x => ({ ...x, email: e.target.value }))} /></Field>
          <Field label="First password" hint="At least 8 characters. They can change it later."><Input type="password" autoComplete="new-password" value={f.password} onChange={e => setF(x => ({ ...x, password: e.target.value }))} /></Field>
        </div>}
        {tech && <>
          <Field label="Skills" hint="Incidents in these categories are routed to them first.">
            <div className="chips">{(cats || []).map(c => <button key={c.id} type="button" className="pick" data-on={f.skills?.includes(c.name) || undefined} onClick={() => toggleSkill(c.name)}>{c.name}</button>)}</div></Field>
          <Field label="Most open incidents at once" hint="P1 incidents can go over this limit."><Select value={f.max_concurrent} onChange={e => setF(x => ({ ...x, max_concurrent: +e.target.value }))}>
            {[1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>
        </>}
        {err && <p className="form-error" role="alert">{err}</p>}
      </div>
    </Dialog>
  )
}

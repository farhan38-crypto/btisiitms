// QR stickers: register equipment and rooms, print stickers. Scanning one opens the report
// form with the equipment and location filled in (/incidents/new?asset=CODE).
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Printer, QrCode, Search, Trash2 } from 'lucide-react'
import { api, ApiError, useQuery, type Asset, type AssetInput, type LocationType } from '../../api'
import { isHostel } from '../../lib/format'
import { Button, Empty, Field, Input, Select, Skeleton, TextArea } from '../../ui/Controls'
import { Dialog, useConfirm } from '../../ui/Overlay'
import { useBuildingList, useCategories, useServices } from '../incidents/data'
import { AdminGate } from './AdminGate'

const BASE_KEY = 'bits-qr-base'
/** QR codes need the auth header, so they're fetched once per code and address and kept. */
const qrCache = new Map<string, Promise<string>>()
function QrImage({ code, base, size = 120 }: { code: string; base: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let on = true
    const k = `${code}|${base}`
    if (!qrCache.has(k)) qrCache.set(k, api.assets.qrUrl(code, base).catch(e => { qrCache.delete(k); throw e }))
    qrCache.get(k)!.then(u => { if (on) setUrl(u) }).catch(() => {})
    return () => { on = false }
  }, [code, base])
  return url ? <img src={url} width={size} height={size} alt={`QR code for ${code}`} className="qr-img" /> : <span className="skel" style={{ width: size, height: size }} />
}

export default function AssetsPage() {
  const { data, error, reload } = useQuery('admin:assets', () => api.assets.list())
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Asset | 'new' | null>(null)
  const [base, setBase] = useState(() => localStorage.getItem(BASE_KEY) || location.origin)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [print, setPrint] = useState(false)
  useEffect(() => { try { localStorage.setItem(BASE_KEY, base) } catch { /* ignore */ } }, [base])
  const list = useMemo(() => (data || []).filter(a => !q || `${a.code} ${a.name} ${a.kind} ${a.location.formatted}`.toLowerCase().includes(q.toLowerCase())), [data, q])
  const toPrint = list.filter(a => picked.size === 0 || picked.has(a.code))
  useEffect(() => { if (!print) return; const t = window.setTimeout(() => { window.print(); setPrint(false) }, 900); return () => window.clearTimeout(t) }, [print])

  return (
    <AdminGate error={error}>
      <main className="page page-wide">
        <header className="page-head"><div><h1>QR stickers</h1><p>Stick one on a PC, projector, router or room door. Scanning it opens a report with everything filled in.</p></div>
          <span className="row-actions"><Button icon={<Printer size={15} />} disabled={!list.length} onClick={() => setPrint(true)}>Print {picked.size ? picked.size : 'all'}</Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEdit('new')}>Add equipment</Button></span></header>
        <div className="toolbar">
          <label className="search-field"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search code, name, place" aria-label="Search" /></label>
          <label className="base-field">Stickers open<Input value={base} onChange={e => setBase(e.target.value)} aria-label="Address stickers open" /></label>
        </div>
        {!data ? <Skeleton h={300} r={20} /> : !list.length ? <Empty icon={<QrCode size={22} />} title="No equipment yet" action={<Button variant="primary" onClick={() => setEdit('new')}>Add the first one</Button>} /> : (
          <div className="assets">
            {list.map(a => (
              <div key={a.id} className="asset surface" data-on={picked.has(a.code) || undefined}>
                <label className="asset-pick"><input type="checkbox" checked={picked.has(a.code)} onChange={() => setPicked(s => { const n = new Set(s); if (n.has(a.code)) n.delete(a.code); else n.add(a.code); return n })} aria-label={`Select ${a.name} for printing`} /></label>
                <QrImage code={a.code} base={base} size={96} />
                <div className="asset-main"><em className="tabular">{a.code}</em><b>{a.name}</b><small>{a.kind} · {a.location.formatted}</small>{a.category && <small>{a.category}{a.service_name ? ` · ${a.service_name}` : ''}</small>}</div>
                <span className="row-actions">
                  <button type="button" className="icon-btn ghost" aria-label={`Edit ${a.name}`} onClick={() => setEdit(a)}><Pencil size={15} /></button>
                  <button type="button" className="icon-btn ghost" aria-label={`Delete ${a.name}`} onClick={async () => { if (await confirm({ title: `Delete ${a.name}?`, body: 'Its sticker will stop working.', confirm: 'Delete', danger: true })) { try { await api.assets.remove(a.code); void reload() } catch (e) { toast.error((e as Error).message) } } }}><Trash2 size={15} /></button>
                </span>
              </div>
            ))}
          </div>
        )}
        {print && <div className="print-sheet" aria-hidden>{toPrint.map(a => (
          <div key={a.code} className="sticker"><QrImage code={a.code} base={base} size={150} /><div><b>Something not working?</b><span>Scan to report it</span><strong>{a.name}</strong><small>{a.code} · {a.location.formatted}</small></div></div>))}</div>}
        <AssetDialog asset={edit} onClose={() => setEdit(null)} onSaved={() => void reload()} />
      </main>
    </AdminGate>
  )
}

function AssetDialog({ asset, onClose, onSaved }: { asset: Asset | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const a = asset && asset !== 'new' ? asset : null
  const { data: bl } = useBuildingList(); const { data: cats } = useCategories(); const { data: svcs } = useServices()
  const blank: AssetInput = { name: '', kind: 'Computer', location_type: 'academics', academic_block: '', hostel_name: '', room_number: '', category: '', service_name: '', notes: '' }
  const [f, setF] = useState<AssetInput>(blank)
  const [last, setLast] = useState<string | null>(null)
  const key = a?.code || (asset === 'new' ? 'new' : null)
  if (key !== last) { setLast(key); setF(a ? { name: a.name, kind: a.kind, location_type: a.location.type, academic_block: a.location.academic_block || '', hostel_name: a.location.hostel_name || '', room_number: a.location.room_number || '', category: a.category || '', service_name: a.service_name || '', notes: a.notes || '' } : blank) }
  const [busy, setBusy] = useState(false)
  const names = bl?.buildings.map(b => b.name) || []
  const save = async () => {
    setBusy(true)
    const body = { ...f, category: f.category || null, service_name: f.service_name || null, notes: f.notes || null, room_number: f.room_number || null,
      academic_block: f.location_type === 'academics' ? f.academic_block || null : null, hostel_name: f.location_type === 'hostel' ? f.hostel_name || null : null }
    try { if (a) await api.assets.update(a.code, body); else await api.assets.create(body); toast.success('Saved'); onSaved(); onClose() }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not save') } finally { setBusy(false) }
  }
  return (
    <Dialog open={!!asset} onClose={onClose} title={a ? `Edit ${a.code}` : 'Add equipment'} size="md"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><Button variant="primary" busy={busy} disabled={f.name.trim().length < 2} onClick={save}>Save</Button></>}>
      <div className="form">
        <div className="grid-2">
          <Field label="Name"><Input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Lab PC 14" /></Field>
          <Field label="Kind"><Select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{['Computer', 'Projector', 'Printer', 'Network', 'Room', 'Equipment'].map(k => <option key={k}>{k}</option>)}</Select></Field>
        </div>
        <div className="grid-3">
          <Field label="Where"><Select value={f.location_type} onChange={e => setF({ ...f, location_type: e.target.value as LocationType })}><option value="academics">Academic area</option><option value="hostel">Hostel</option><option value="online">Online</option></Select></Field>
          {f.location_type !== 'online' && <Field label={f.location_type === 'hostel' ? 'Hostel' : 'Building'}><Select value={(f.location_type === 'hostel' ? f.hostel_name : f.academic_block) || ''}
            onChange={e => setF({ ...f, ...(f.location_type === 'hostel' ? { hostel_name: e.target.value } : { academic_block: e.target.value }) })}><option value="">Choose…</option>
            {names.filter(n => (f.location_type === 'hostel') === isHostel(n)).map(n => <option key={n}>{n}</option>)}</Select></Field>}
          {f.location_type !== 'online' && <Field label="Room" optional><Input value={f.room_number || ''} onChange={e => setF({ ...f, room_number: e.target.value })} /></Field>}
        </div>
        <div className="grid-2">
          <Field label="Usual category" optional><Select value={f.category || ''} onChange={e => setF({ ...f, category: e.target.value })}><option value="">—</option>{(cats || []).map(c => <option key={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Usual service" optional><Select value={f.service_name || ''} onChange={e => setF({ ...f, service_name: e.target.value })}><option value="">—</option>{(svcs || []).map(s => <option key={s.id}>{s.name}</option>)}</Select></Field>
        </div>
        <Field label="Notes" optional><TextArea rows={2} value={f.notes || ''} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Dialog>
  )
}

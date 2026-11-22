// Report a problem. Describe it in your own words first; the backend's assistant fills in
// the rest (title, category, service, priority, even the room) and you confirm. Then where,
// then how bad, then a review. Safety checks run while you type: a medical or fire emergency
// shows who to call right away instead of becoming a ticket.
//
// Steps: 1 Describe → 2 Where → 3 Details → 4 Review. Photos and a voice note can be added at
// step 1; they upload right after the report is created.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { AlertOctagon, ArrowLeft, ArrowRight, Building2, Camera, Check, Copy, Globe2, Home, Info, LocateFixed, Mic, Phone, QrCode, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { api, ApiError, invalidate, type Asset, type GeneratedIncident, type IncidentCreate, type IncidentRef, type LocationType, type ScopeAssessment } from '../../api'
import { useAuth, isStaff } from '../../lib/auth'
import { isHostel, PRIORITY_LABEL } from '../../lib/format'
import { Button, Field, Input, Select, TextArea } from '../../ui/Controls'
import { useBuildingList, useCategories, useServices } from '../incidents/data'
import { fileToBase64, shrinkPhoto, canRecord } from '../incident/media'
import { VoiceButton } from '../incident/Attachments'
import { OFFLINE_SERVICE, PRESETS } from './presets'

type Step = 0 | 1 | 2 | 3
const STEPS = ['Describe', 'Where', 'Details', 'Review']
interface Draft {
  description: string; title: string; category: string; service: string
  impact: number; urgency: number; affected: number
  where: LocationType | ''; building: string; room: string; availability: string; phone: string
  gps: { lat: number; lng: number; acc: number } | null
}
const EMPTY: Draft = { description: '', title: '', category: '', service: '', impact: 1, urgency: 2, affected: 1, where: '', building: '', room: '', availability: '', phone: '', gps: null }
const DRAFT_KEY = 'bits-report-draft'
interface Pending { id: string; kind: 'photo' | 'voice'; blob: Blob; type: string; url: string; seconds?: number; transcript?: string }

export default function ReportPage() {
  const { user } = useAuth()
  const staff = isStaff(user)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { data: cats } = useCategories()
  const { data: svcs } = useServices()
  const { data: bl } = useBuildingList()
  const [step, setStep] = useState<Step>(0)
  const [d, setD] = useState<Draft>(() => { try { return { ...EMPTY, ...JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}'), phone: user?.phone || '' } } catch { return { ...EMPTY, phone: user?.phone || '' } } })
  const set = (p: Partial<Draft>) => setD(x => ({ ...x, ...p }))
  const [ai, setAi] = useState<GeneratedIncident | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [scope, setScope] = useState<ScopeAssessment | null>(null)
  const [scopeOk, setScopeOk] = useState(false)
  const [dupes, setDupes] = useState<IncidentRef[] | null>(null)
  const [dupeAck, setDupeAck] = useState(false)
  const [asset, setAsset] = useState<Asset | null>(null)
  const [files, setFiles] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, gps: null })) } catch { /* ignore */ } }, [d])

  // One tap on a common problem fills in its kind, service and place, and starts the sentence.
  const [preset, setPreset] = useState<string | null>(null)
  const applyPreset = (key: string | null) => {
    const p = PRESETS.find(x => x.key === key); if (!p) return
    setPreset(p.key); setAi(null)
    set({ category: p.category, service: p.service || '', where: p.where || '', description: d.description.trim() ? d.description : p.prompt })
  }
  // ?type=wifi (one-tap shortcut) or ?asset=A-0003 (QR sticker)
  useEffect(() => {
    applyPreset(params.get('type'))
    const code = params.get('asset')
    if (code) api.assets.get(code).then(a => {
      setAsset(a)
      set({ where: a.location.type, building: a.location.hostel_name || a.location.academic_block || '', room: a.location.room_number || '',
        category: a.category || '', service: a.service_name || '', title: `Problem with ${a.name}` })
    }).catch(e => toast.error(e instanceof ApiError ? e.message : 'Unknown QR code'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Quick safety check while typing (rules only, instant).
  useEffect(() => {
    const text = d.description.trim()
    if (text.length < 12) { setScope(null); return }
    const t = window.setTimeout(() => { api.intelligence.scope(d.title, text, false).then(s => setScope(s.in_scope ? null : s)).catch(() => {}) }, 450)
    return () => window.clearTimeout(t)
  }, [d.description, d.title])

  const buildings = bl?.buildings.map(b => b.name) || []
  const serviceId = (name: string) => svcs?.find(s => s.name === name)?.id || ''
  const catNames = (cats || []).map(c => c.name)
  const offline = Object.keys(OFFLINE_SERVICE)
  const allowedCats = d.where === 'hostel' ? catNames.filter(c => offline.includes(c)) : catNames
  // Hostel jobs and on-site repairs use their matching support service.
  useEffect(() => {
    if (OFFLINE_SERVICE[d.category] && d.where !== 'online' && d.service !== OFFLINE_SERVICE[d.category]) set({ service: OFFLINE_SERVICE[d.category]! })
    if (d.where === 'hostel' && d.category && !offline.includes(d.category)) set({ category: '' })
  }, [d.category, d.where]) // eslint-disable-line react-hooks/exhaustive-deps

  const fillWithAi = async () => {
    setAiBusy(true)
    try {
      const g = await api.intelligence.generate(d.description.trim())
      setAi(g)
      if (g.scope && !g.scope.in_scope) setScope(g.scope)
      const loc = g.location || {}
      setD(x => {
        const category = x.category || (catNames.includes(g.category) ? g.category : '')
        // IT problems in a hostel are handled remotely ("Online, from Valmiki Bhavan"); only room
        // repairs (carpenter, electrician, technician) are hostel visits (backend rule).
        let where: Draft['where'] = x.where || loc.type || ''
        if (where === 'hostel' && category && !OFFLINE_SERVICE[category]) where = 'online'
        return {
          ...x, title: x.title || g.title, category, service: x.service || g.service || '',
          impact: g.impact, urgency: g.urgency, affected: Math.max(1, g.affected_users || 1),
          where, building: x.building || loc.hostel_name || loc.academic_block || '', room: x.room || loc.room_number || '',
        }
      })
    } catch { /* the form still works by hand */ }
    finally { setAiBusy(false) }
  }

  const next = async () => {
    setErr(null)
    if (step === 0) { if (!ai && d.description.trim().length >= 10) await fillWithAi(); setStep(1) }
    else if (step === 1) setStep(2)
    else if (step === 2) {
      setStep(3)
      if (staff) api.intelligence.duplicates(d.title, d.description, serviceId(d.service)).then(setDupes).catch(() => setDupes(null))
    }
  }
  const valid = [
    d.description.trim().length >= 10 && (!scope || scopeOk),
    !!d.where && (d.where === 'online' || !!d.building),
    d.title.trim().length >= 4 && !!d.category && !!serviceId(d.service),
    true,
  ][step]

  const submit = async (opts: { dupe?: boolean; inScope?: boolean } = {}) => {
    setBusy(true); setErr(null)
    const body: IncidentCreate = {
      title: d.title.trim(), description: d.description.trim(), category: d.category, service_id: serviceId(d.service),
      impact: d.impact, urgency: d.urgency, affected_users: d.affected, business_criticality: 1,
      location_type: d.where as LocationType,
      hostel_name: d.where === 'hostel' ? d.building : d.where === 'online' && isHostel(d.building) ? d.building : null,
      academic_block: d.where === 'academics' ? d.building : d.where === 'online' && d.building && !isHostel(d.building) ? d.building : null,
      room_number: d.room.trim() || null, phone: d.phone.trim() || null,
      visit_availability: d.where !== 'online' ? d.availability.trim() || null : null,
      latitude: d.gps?.lat ?? null, longitude: d.gps?.lng ?? null, accuracy_m: d.gps?.acc ?? null,
      asset_code: asset?.code || null,
      acknowledge_duplicate: opts.dupe || dupeAck, confirm_in_scope: opts.inScope || scopeOk,
    }
    try {
      const inc = await api.incidents.create(body)
      for (const f of files) {
        try { await api.attachments.add(inc.id, f.kind === 'photo' ? { kind: 'photo', content_type: f.type, data_base64: await fileToBase64(f.blob), stage: 'evidence' }
          : { kind: 'voice', content_type: f.type, data_base64: await fileToBase64(f.blob), duration_s: Math.min(180, f.seconds || 1), transcript: f.transcript || undefined }) }
        catch { toast.error('One attachment could not be uploaded; add it from the report.') }
      }
      sessionStorage.removeItem(DRAFT_KEY)
      invalidate('incidents', 'my-reports', 'overview')
      toast.success(`Reported as ${inc.number} (${inc.priority})`, { description: staff ? undefined : 'You can follow it live here.' })
      navigate(`/incidents/${inc.id}`, { replace: true })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DuplicateIncidentError') {
        const num = e.message.match(/INC-\d+/)?.[0]
        setDupes(prev => prev?.length ? prev : [{ id: '', number: num || 'an open report', title: 'A very similar report is already open', status: 'NEW', priority: 'P3' }])
      } else if (e instanceof ApiError && e.code === 'OutOfScopeError') {
        setScope(e.extra.scope as ScopeAssessment); setStep(0)
      } else setErr(e instanceof ApiError ? e.message : 'Could not send the report')
    } finally { setBusy(false) }
  }

  const addPhotos = async (list: FileList | null) => {
    for (const f of [...(list || [])].slice(0, 6 - files.length)) {
      try { const { blob, type } = await shrinkPhoto(f); setFiles(x => [...x, { id: crypto.randomUUID(), kind: 'photo', blob, type, url: URL.createObjectURL(blob) }]) }
      catch (e) { toast.error((e as Error).message) }
    }
    if (fileRef.current) fileRef.current.value = ''
  }
  const locateMe = () => {
    if (!navigator.geolocation) { toast.error('This browser can’t share a location.'); return }
    toast.message('Finding you…')
    navigator.geolocation.getCurrentPosition(p => { set({ gps: { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy } }); toast.success(`Location added (±${Math.round(p.coords.accuracy)} m)`) },
      () => toast.error('Location not available. The building’s pin will be used.'), { enableHighAccuracy: true, timeout: 10_000 })
  }

  const priority = useMemo(() => {   // a preview; the backend's priority strategy decides
    const s = d.impact * d.urgency
    return s >= 9 ? 'P1' : s >= 6 ? 'P2' : s >= 3 ? 'P3' : 'P4'
  }, [d.impact, d.urgency]) as 'P1'

  return (
    <main className="page page-report">
      <header className="page-head">
        <div><Link to={staff ? '/incidents' : '/'} className="back"><ArrowLeft size={16} />Cancel</Link><h1>Report a problem</h1></div>
        <ol className="stepper" aria-label="Steps">
          {STEPS.map((s, k) => <li key={s} data-done={k < step || undefined} data-on={k === step || undefined}>
            <button type="button" disabled={k > step} onClick={() => setStep(k as Step)}><span>{k < step ? <Check size={12} strokeWidth={3} /> : k + 1}</span>{s}</button></li>)}
        </ol>
      </header>

      {asset && <div className="banner glass"><QrCode size={16} /><span>Reporting about <b>{asset.name}</b> ({asset.code}) in {asset.location.formatted}.{asset.open_reports ? ` ${asset.open_reports} open report${asset.open_reports > 1 ? 's' : ''} already.` : ''}</span></div>}

      <div className="report-grid">
        <div className="report-main surface pad">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: .22, ease: [0.22, 1, 0.36, 1] }}>
              {step === 0 && <>
                <h2 className="step-title">What’s wrong?</h2>
                <p className="step-sub">Say it the way you’d tell a friend: what happened, where, and since when. We’ll fill in the form from it.</p>
                <div className="preset-row" role="group" aria-label="Common problems">{PRESETS.map(p => (
                  <button key={p.key} type="button" className="preset" data-on={preset === p.key || undefined} onClick={() => applyPreset(p.key)} title={p.hint}><p.icon size={15} />{p.label}</button>))}</div>
                <TextArea autoFocus rows={6} className="describe" value={d.description} onChange={e => { set({ description: e.target.value }); setAi(null) }}
                  placeholder="The Wi-Fi in Valmiki Bhavan 2nd floor keeps disconnecting since this morning; my laptop and phone both drop every few minutes." />
                <div className="describe-tools">
                  <Button className="sm" icon={<Camera size={15} />} onClick={() => fileRef.current?.click()} disabled={files.length >= 6}>Add photo</Button>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple hidden onChange={e => addPhotos(e.target.files)} />
                  {canRecord() && !files.some(f => f.kind === 'voice') && <VoiceButton onRecorded={r => {
                    setFiles(x => [...x, { id: crypto.randomUUID(), kind: 'voice', blob: r.blob, type: r.type, url: URL.createObjectURL(r.blob), seconds: r.seconds, transcript: r.transcript }])
                    if (r.transcript && !d.description.trim()) set({ description: r.transcript })
                  }} />}
                  <span className="count tabular">{d.description.trim().length < 10 ? `${10 - d.description.trim().length} more characters` : <><Check size={13} />Enough to go on</>}</span>
                </div>
                {files.length > 0 && <div className="pending">{files.map(f => (
                  <span key={f.id} className="pending-item">{f.kind === 'photo' ? <img src={f.url} alt="" /> : <span className="pending-voice"><Mic size={16} />{Math.round(f.seconds || 0)} s</span>}
                    <button type="button" onClick={() => setFiles(x => x.filter(y => y.id !== f.id))} aria-label="Remove"><Trash2 size={13} /></button></span>))}</div>}
                <AnimatePresence>{scope && <ScopeAlert scope={scope} ok={scopeOk} onOk={() => setScopeOk(true)} />}</AnimatePresence>
              </>}

              {step === 1 && <>
                <h2 className="step-title">Where is it?</h2>
                <p className="step-sub">{ai?.location?.type ? 'We guessed from your description. Change it if it’s wrong.' : 'So the right person can find it.'}</p>
                <div className="tiles" role="radiogroup" aria-label="Kind of place">
                  {([['hostel', 'Room repair in my hostel', 'Carpenter, electrician, technician', Home], ['academics', 'Academic area', 'Classrooms, labs, library', Building2], ['online', 'Online / no visit', 'Wi-Fi, accounts, portals, email', Globe2]] as const).map(([v, l, h, Icon]) => (
                    <button key={v} type="button" role="radio" aria-checked={d.where === v} className="tile" data-on={d.where === v || undefined} onClick={() => set({ where: v, building: v === d.where ? d.building : '' })}>
                      <Icon size={20} /><b>{l}</b><small>{h}</small></button>))}
                </div>
                {d.where && d.where !== 'online' && <div className="grid-2">
                  <Field label={d.where === 'hostel' ? 'Hostel' : 'Building'}><Select value={d.building} onChange={e => set({ building: e.target.value })}>
                    <option value="">Choose…</option>{buildings.filter(n => (d.where === 'hostel') === isHostel(n)).map(n => <option key={n}>{n}</option>)}</Select></Field>
                  <Field label={d.where === 'hostel' ? 'Room' : 'Room or lab'} optional={d.where !== 'hostel'}><Input value={d.room} onChange={e => set({ room: e.target.value })} placeholder={d.where === 'hostel' ? '214' : 'Lab 2'} /></Field>
                </div>}
                {d.where === 'online' && <div className="grid-2">
                  <Field label="Where you are" optional hint="Helps spot outages in one building."><Select value={d.building} onChange={e => set({ building: e.target.value })}>
                    <option value="">Anywhere / not sure</option>{buildings.map(n => <option key={n}>{n}</option>)}</Select></Field>
                  {d.building && <Field label="Room" optional><Input value={d.room} onChange={e => set({ room: e.target.value })} /></Field>}</div>}
                {d.where === 'hostel' && d.category && !OFFLINE_SERVICE[d.category] && <p className="muted small">Hostel visits are for room repairs. For {d.category.toLowerCase()} problems choose “Online / no visit” and pick your hostel as where you are.</p>}
                {d.where && d.where !== 'online' && <>
                  <Field label="When can someone come?" optional hint="E.g. after 5 pm on weekdays"><Input value={d.availability} onChange={e => set({ availability: e.target.value })} /></Field>
                  <div className="gps">
                    <Button className="sm" icon={<LocateFixed size={15} />} onClick={locateMe}>{d.gps ? 'Update my exact spot' : 'Share my exact spot'}</Button>
                    <small>{d.gps ? `Added, ±${Math.round(d.gps.acc)} m.` : 'Optional. Without it, the building’s pin is used.'}</small>
                    {d.gps && <button type="button" className="link small" onClick={() => set({ gps: null })}>Remove</button>}
                  </div>
                </>}
                <Field label="Phone" optional hint="Only staff handling this report can see it."><Input type="tel" value={d.phone} onChange={e => set({ phone: e.target.value })} placeholder="+91 98765 43210" /></Field>
              </>}

              {step === 2 && <>
                <h2 className="step-title">The details</h2>
                <p className="step-sub">{ai ? <><Sparkles size={14} /> Filled in from your description ({Math.round(ai.confidence * 100)}% sure). Check and change anything.</> : 'Almost done.'}</p>
                <Field label="Short title"><Input value={d.title} onChange={e => set({ title: e.target.value })} maxLength={160} placeholder="Wi-Fi drops every few minutes on 2nd floor" /></Field>
                <Field label="What kind of problem?">
                  <div className="chips">{allowedCats.map(c => <button key={c} type="button" className="pick" data-on={d.category === c || undefined} onClick={() => set({ category: c })}>{c}</button>)}</div>
                </Field>
                <Field label="Which service?" hint={OFFLINE_SERVICE[d.category] && d.where !== 'online' ? 'Set by the kind of repair.' : undefined}>
                  <Select value={d.service} disabled={!!OFFLINE_SERVICE[d.category] && d.where !== 'online'} onChange={e => set({ service: e.target.value })}>
                    <option value="">Choose…</option>{(svcs || []).map(s => <option key={s.id}>{s.name}</option>)}</Select></Field>
                <Field label="Who is affected?"><div className="tiles tiles-3" role="radiogroup">
                  {([[1, 'Just me'], [2, 'My wing, class or lab'], [3, 'Many people or a whole building']] as const).map(([v, l]) =>
                    <button key={v} type="button" role="radio" aria-checked={d.impact === v} className="tile sm" data-on={d.impact === v || undefined} onClick={() => set({ impact: v, affected: v === 1 ? 1 : Math.max(d.affected, v === 2 ? 10 : 50) })}><b>{l}</b></button>)}
                </div></Field>
                <Field label="How urgent?"><div className="tiles tiles-3" role="radiogroup">
                  {([[1, 'It can wait', 'This week is fine'], [2, 'Today', 'It’s getting in the way'], [3, 'Right now', 'Exam, class or safety at stake']] as const).map(([v, l, h]) =>
                    <button key={v} type="button" role="radio" aria-checked={d.urgency === v} className="tile sm" data-on={d.urgency === v || undefined} onClick={() => set({ urgency: v })}><b>{l}</b><small>{h}</small></button>)}
                </div></Field>
                {d.impact > 1 && <Field label="About how many people?"><Input type="number" min={1} value={d.affected} onChange={e => set({ affected: Math.max(1, +e.target.value || 1) })} /></Field>}
              </>}

              {step === 3 && <>
                <h2 className="step-title">Check and send</h2>
                <dl className="review">
                  <dt>Title</dt><dd>{d.title}<button className="link small" onClick={() => setStep(2)}>Edit</button></dd>
                  <dt>Description</dt><dd className="prose">{d.description}<button className="link small" onClick={() => setStep(0)}>Edit</button></dd>
                  <dt>Where</dt><dd>{d.where === 'online' ? `Online${d.building ? `, from ${d.building}` : ''}` : `${d.building}${d.room ? `, room ${d.room}` : ''}`}{d.gps && ' · exact spot shared'}<button className="link small" onClick={() => setStep(1)}>Edit</button></dd>
                  <dt>Kind</dt><dd>{d.category} · {d.service}</dd>
                  <dt>Priority</dt><dd>About {priority} ({PRIORITY_LABEL[priority]}). The final priority is calculated when you send it.</dd>
                  {files.length > 0 && <><dt>Attached</dt><dd>{files.filter(f => f.kind === 'photo').length} photo(s){files.some(f => f.kind === 'voice') ? ', 1 voice note' : ''}</dd></>}
                </dl>
                <AnimatePresence>{dupes && dupes.length > 0 && !dupeAck && (
                  <motion.div className="alert" data-tone="warn" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Copy size={18} /><div><b>This might already be reported</b>
                      <ul>{dupes.slice(0, 3).map(x => <li key={x.number}>{x.id ? <Link to={`/incidents/${x.id}`} target="_blank">{x.number}: {x.title}</Link> : <>{x.number}: {x.title}</>}</li>)}</ul>
                      <p>If it’s the same problem, you don’t need to send another report.</p>
                      <Button className="sm" onClick={() => { setDupeAck(true); void submit({ dupe: true }) }} busy={busy}>Mine is different, send it</Button></div>
                  </motion.div>)}</AnimatePresence>
                {err && <p className="form-error" role="alert"><X size={15} />{err}</p>}
              </>}
            </motion.div>
          </AnimatePresence>

          <footer className="step-nav">
            {step > 0 ? <Button icon={<ArrowLeft size={16} />} onClick={() => setStep((step - 1) as Step)}>Back</Button> : <span />}
            {step < 3
              ? <Button variant="primary" busy={aiBusy} disabled={!valid} onClick={next}>{step === 0 && !ai ? <><Wand2 size={16} />Fill in the rest</> : <>Continue<ArrowRight size={16} /></>}</Button>
              : <Button variant="primary" busy={busy} disabled={!!dupes?.length && !dupeAck} onClick={() => submit()}>Send report<ArrowRight size={16} /></Button>}
          </footer>
        </div>

        <aside className="report-side">
          <div className="card">
            <h3>Your report</h3>
            <ul className="report-sum">
              <Line on={d.description.trim().length >= 10} label="Description">{d.description.trim() ? d.description.trim().slice(0, 90) + (d.description.length > 90 ? '…' : '') : 'Not yet'}</Line>
              <Line on={!!d.where && (d.where === 'online' || !!d.building)} label="Where">{d.where ? (d.where === 'online' ? 'Online' : d.building || 'Choose a building') : 'Not yet'}</Line>
              <Line on={!!d.category} label="Kind">{d.category || 'Not yet'}</Line>
              <Line on={step >= 2} label="Priority">{step >= 2 ? `About ${priority}` : 'Worked out from your answers'}</Line>
            </ul>
            {ai && ai.clarifying_questions.length > 0 && step <= 2 && <div className="ai-q"><Info size={14} /><div><b>Worth mentioning</b>
              <ul>{ai.clarifying_questions.slice(0, 3).map(q => <li key={q}>{q}</li>)}</ul></div></div>}
          </div>
          <p className="muted small">Emergency? Don’t wait for a report: call campus security or 112.</p>
        </aside>
      </div>
    </main>
  )
}

function Line({ on, label, children }: { on: boolean; label: string; children: ReactNode }) {
  return <li data-on={on || undefined}><span className="sum-dot">{on && <Check size={11} strokeWidth={3} />}</span><span><small>{label}</small>{children}</span></li>
}

function ScopeAlert({ scope, ok, onOk }: { scope: ScopeAssessment; ok: boolean; onOk: () => void }) {
  return (
    <motion.div className="alert" data-tone={scope.emergency ? 'danger' : 'info'} role="alert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}>
      <AlertOctagon size={20} />
      <div>
        <b>{scope.title}</b>
        <p>{scope.message}</p>
        {scope.contacts.length > 0 && <div className="contacts">{scope.contacts.map(c => (
          <a key={c.number} href={`tel:${c.number.replace(/\s/g, '')}`} className="contact"><Phone size={14} /><span><b>{c.number}</b><small>{c.label}{c.note ? ` · ${c.note}` : ''}</small></span></a>))}</div>}
        {!ok ? <button type="button" className="link small" onClick={onOk}>It’s an IT or room-repair problem, continue</button> : <p className="small"><Check size={13} /> OK, continuing with the report.</p>}
      </div>
    </motion.div>
  )
}

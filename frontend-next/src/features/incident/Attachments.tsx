// Photos (before / after / evidence) and voice notes on an incident. Staff mark "before" and
// "after" photos; reporters add evidence. Click a photo to see it large.
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'motion/react'
import { Camera, Mic, Square, X, ImageOff } from 'lucide-react'
import { api, ApiError, invalidate, useQuery, type Attachment, type Incident, type User } from '../../api'
import { timeAgo } from '../../lib/format'
import { Button, Segmented, Spinner } from '../../ui/Controls'
import { canRecord, createRecorder, fileToBase64, shrinkPhoto, useAttachmentUrl } from './media'

type Stage = 'before' | 'after' | 'evidence'
const STAGE_LABEL: Record<Stage, string> = { before: 'Before', after: 'After', evidence: 'Photo' }

export function Attachments({ incident, user, compact }: { incident: Incident; user: User; compact?: boolean }) {
  const { data: list, reload } = useQuery(`attachments:${incident.id}`, () => api.attachments.list(incident.id))
  const reporter = user.role === 'customer'
  const [stage, setStage] = useState<Stage>(reporter ? 'evidence' : incident.status === 'IN_PROGRESS' || incident.resolution ? 'after' : 'before')
  const [uploading, setUploading] = useState(0)
  const [big, setBig] = useState<Attachment | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const closed = incident.status === 'CLOSED'
  const photos = (list || []).filter(a => a.kind === 'photo')
  const voices = (list || []).filter(a => a.kind === 'voice')

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    for (const f of [...files].slice(0, 6)) {
      setUploading(n => n + 1)
      try {
        const { blob, type } = await shrinkPhoto(f)
        await api.attachments.add(incident.id, { kind: 'photo', content_type: type, data_base64: await fileToBase64(blob), stage })
      } catch (e) { toast.error(e instanceof ApiError ? e.message : (e as Error).message || 'Upload failed') }
      finally { setUploading(n => n - 1) }
    }
    void reload(); invalidate(`incident:${incident.id}`)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <section className="attach">
      <header className="section-head">
        <h2>Photos and voice notes</h2>
        {!closed && <div className="attach-add">
          {!reporter && <Segmented size="sm" value={stage} onChange={setStage} label="Photo type" options={[{ value: 'before', label: 'Before' }, { value: 'after', label: 'After' }, { value: 'evidence', label: 'Other' }]} />}
          <Button className="sm" icon={uploading ? <Spinner size={14} /> : <Camera size={15} />} onClick={() => fileRef.current?.click()}>{uploading ? 'Uploading…' : 'Add photo'}</Button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple hidden onChange={e => upload(e.target.files)} />
          {canRecord() && <VoiceButton incident={incident} onDone={() => { void reload(); invalidate(`incident:${incident.id}`) }} />}
        </div>}
      </header>
      {!list ? <div className="thumbs">{[0, 1].map(k => <span key={k} className="thumb skel" />)}</div>
        : !list.length ? <p className="muted small">{closed ? 'No photos or voice notes.' : reporter ? 'A photo of the problem helps the technician bring the right part.' : 'Add a before photo when you arrive and an after photo when it’s fixed.'}</p>
        : <>
          {photos.length > 0 && <div className={`thumbs ${compact ? 'thumbs-sm' : ''}`}>{photos.map(p => <Thumb key={p.id} a={p} onOpen={() => setBig(p)} />)}</div>}
          {voices.length > 0 && <ul className="voices">{voices.map(v => <Voice key={v.id} a={v} />)}</ul>}
        </>}
      <AnimatePresence>{big && <Lightbox a={big} all={photos} onClose={() => setBig(null)} onMove={setBig} />}</AnimatePresence>
    </section>
  )
}

function Thumb({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  const url = useAttachmentUrl(a.id)
  return (
    <button type="button" className="thumb" onClick={onOpen} title={`${STAGE_LABEL[a.stage || 'evidence']} photo by ${a.uploaded_by_name}, ${timeAgo(a.created_at)}`}>
      {url ? <img src={url} alt={`${STAGE_LABEL[a.stage || 'evidence']} photo`} loading="lazy" /> : <span className="skel" />}
      <em data-stage={a.stage}>{STAGE_LABEL[a.stage || 'evidence']}</em>
    </button>
  )
}
function Lightbox({ a, all, onClose, onMove }: { a: Attachment; all: Attachment[]; onClose: () => void; onMove: (a: Attachment) => void }) {
  const url = useAttachmentUrl(a.id)
  const k = all.findIndex(x => x.id === a.id)
  return (
    <motion.div className="lightbox" role="dialog" aria-label="Photo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowRight' && all[k + 1]) onMove(all[k + 1]!); if (e.key === 'ArrowLeft' && all[k - 1]) onMove(all[k - 1]!) }} tabIndex={-1} ref={el => el?.focus()}>
      <motion.figure initial={{ scale: .94 }} animate={{ scale: 1 }} onClick={e => e.stopPropagation()}>
        {url ? <img src={url} alt="" /> : <span className="lightbox-wait"><ImageOff /></span>}
        <figcaption>{STAGE_LABEL[a.stage || 'evidence']} photo · {a.uploaded_by_name} · {timeAgo(a.created_at)}{all.length > 1 && ` · ${k + 1} of ${all.length}`}</figcaption>
      </motion.figure>
      <button type="button" className="icon-btn lightbox-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
    </motion.div>
  )
}
function Voice({ a }: { a: Attachment }) {
  const url = useAttachmentUrl(a.id)
  return (
    <li className="voice">
      <Mic size={15} />
      <div><b>{a.uploaded_by_name}</b><small>{timeAgo(a.created_at)}{a.duration_s ? ` · ${Math.round(a.duration_s)} s` : ''}</small>
        {url ? <audio controls preload="none" src={url} /> : <span className="skel" style={{ height: 32 }} />}
        {a.transcript && <p className="voice-text">“{a.transcript}”</p>}</div>
    </li>
  )
}

/** Hold-free recording: tap to start, tap to stop and send. Live captions where supported. */
export function VoiceButton({ incident, onDone, onRecorded }: { incident?: Incident; onDone?: () => void; onRecorded?: (r: { blob: Blob; type: string; seconds: number; transcript: string }) => void }) {
  const [rec, setRec] = useState<ReturnType<typeof createRecorder> | null>(null)
  const [secs, setSecs] = useState(0)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const start = async () => {
    const r = createRecorder(setCaption)
    try { await r.start() } catch { toast.error('Allow microphone access to record a voice note.'); return }
    setRec(r); setSecs(0); setCaption('')
    timer.current = window.setInterval(() => setSecs(s => { if (s >= 179) { void stop(r); } return s + 1 }), 1000)
  }
  const stop = async (r = rec) => {
    if (!r) return
    window.clearInterval(timer.current); setRec(null)
    const out = await r.stop()
    if (onRecorded) { onRecorded(out); return }
    if (!incident) return
    setBusy(true)
    try {
      await api.attachments.add(incident.id, { kind: 'voice', content_type: out.type, data_base64: await fileToBase64(out.blob), duration_s: Math.min(180, out.seconds), transcript: out.transcript || undefined })
      toast.success('Voice note added'); onDone?.()
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not upload the voice note') }
    finally { setBusy(false) }
  }
  if (rec) return (
    <span className="rec-live">
      <Button className="sm rec-btn" variant="danger" icon={<Square size={13} />} onClick={() => stop()}>Stop · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</Button>
      {caption && <small className="rec-caption">{caption}</small>}
    </span>
  )
  return <Button className="sm" busy={busy} icon={<Mic size={15} />} onClick={start}>Voice note</Button>
}

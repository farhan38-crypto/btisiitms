// Photos and voice notes on an incident: before/after comparison, a lightbox, and upload.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, ImagePlus, X, Loader2, MoveHorizontal, UploadCloud } from 'lucide-react';
import api, { errMsg } from '../api';
import { fmtShort } from './common';
import { VoiceRecorder, VoiceNotePlayer, useAttachmentUrl } from './voice';
import { AnimatePresence, motion, DURATION, EASE_OUT, overlayFade, popIn, itemDelay } from '../motion';
import { useLiveIncidentEvents } from '../live';
import { useDropZone, fileKind, audioFileToAttachment } from '../interactions';
import { GlowingEffect, HaloDropzone } from './effects';

// Phone photos are 3-12 MB; resize to ≤1600 px JPEG in the browser before uploading.
export async function compressImage(file, maxDim = 1600, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not an image this browser can read.'));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { content_type: 'image/jpeg', data_base64: dataUrl.split(',', 2)[1], previewUrl: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function PhotoButton({ stage = 'evidence', label = 'Add photo', onPicked, disabled, className = 'secondary' }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      onPicked?.({ kind: 'photo', stage, ...(await compressImage(file)) });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className={className} disabled={disabled || busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 size={15} className="spin" /> : <Camera size={15} />} {label}
      </button>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
    </>
  );
}

function Photo({ a, onOpen }) {
  const url = useAttachmentUrl(a.id, a.previewUrl);
  return (
    <motion.button type="button" className="photo-thumb" layoutId={`photo-${a.id}`} onClick={() => url && onOpen(a, url)}
      aria-label={`Open ${a.stage || 'evidence'} photo`}>
      {url ? <img src={url} alt={`${a.stage || 'evidence'} photo`} /> : <span className="photo-skeleton" />}
      <span className={`photo-stage ${a.stage}`}>{a.stage || 'photo'}</span>
    </motion.button>
  );
}

export function BeforeAfter({ before, after }) {
  const b = useAttachmentUrl(before.id, before.previewUrl);
  const a = useAttachmentUrl(after.id, after.previewUrl);
  const [pos, setPos] = useState(50);
  if (!a || !b) return <div className="before-after loading-box"><Loader2 className="spin" size={18} /></div>;
  return (
    <div className="before-after">
      <img src={a} alt="After the fix" />
      <div className="ba-before" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={b} alt="Before the fix" />
      </div>
      <span className="ba-handle" style={{ left: `${pos}%` }} aria-hidden="true"><MoveHorizontal size={16} /></span>
      <span className="ba-label left">Before</span>
      <span className="ba-label right">After</span>
      <input type="range" min="0" max="100" value={pos} onChange={e => setPos(+e.target.value)}
        aria-label="Drag to compare before and after" />
    </div>
  );
}

export function Lightbox({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="lightbox" variants={overlayFade} initial="initial" animate="animate" exit="exit" onClick={onClose}>
          <motion.img layoutId={`photo-${open.a.id}`} src={open.url} alt={`${open.a.stage} photo`}
            transition={{ duration: DURATION.slow, ease: EASE_OUT }} onClick={e => e.stopPropagation()} />
          <motion.div className="lightbox-caption" variants={popIn} initial="initial" animate="animate" exit="exit">
            <b>{open.a.stage === 'after' ? 'After the fix' : open.a.stage === 'before' ? 'Before' : 'Photo'}</b>
            {open.a.caption && <span> · {open.a.caption}</span>}
            <small> · {open.a.uploaded_by_name} · {fmtShort(open.a.created_at)}</small>
          </motion.div>
          <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// The panel on an incident page.
export function AttachmentsPanel({ incidentId, role, closed }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);
  const isStaff = role === 'technician' || role === 'admin';

  const load = useCallback(() => {
    api.get(`/incidents/${incidentId}/attachments`).then(r => setItems(r.data)).catch(() => setItems([]));
  }, [incidentId]);
  useEffect(load, [load]);
  useLiveIncidentEvents(ev => { if (ev.incident_id === incidentId && ev.type === 'ATTACHMENT_ADDED') load(); });

  const upload = async ({ previewUrl, ...body }) => {
    setBusy(true);
    try {
      const r = await api.post(`/incidents/${incidentId}/attachments`, body);
      setItems(list => [...(list || []), { ...r.data, previewUrl }]);
      toast.success(body.kind === 'voice' ? 'Voice note attached' : 'Photo attached');
    } catch (e) {
      toast.error(errMsg(e) || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  // Drop photos / recordings onto the panel to attach them.
  const addFiles = async files => {
    for (const file of files) {
      const kind = fileKind(file);
      try {
        if (kind === 'photo') await upload({ kind: 'photo', stage: isStaff && items?.some(a => a.stage === 'before') ? 'after' : 'before', ...(await compressImage(file)) });
        else if (kind === 'voice') { const { name, ...note } = await audioFileToAttachment(file); await upload(note); }
        else toast.error(`${file.name}: drop a photo or an audio recording`);
      } catch (e) { toast.error(e.message || `Could not read ${file.name}`); }
    }
  };
  const drop = useDropZone(addFiles, { disabled: closed });

  const photos = (items || []).filter(a => a.kind === 'photo');
  const voices = (items || []).filter(a => a.kind === 'voice');
  const before = [...photos].reverse().find(a => a.stage === 'before');
  const after = [...photos].reverse().find(a => a.stage === 'after');

  return (
    <div className="panel attachments-panel drop-target" {...drop.bind}>
      <GlowingEffect />
      <AnimatePresence>
        {drop.isOver && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: DURATION.fast }}>
            <div><UploadCloud size={36} /><div>Drop to attach{isStaff ? ' (2nd photo becomes the "after" photo)' : ''}</div></div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="panel-head" style={{ marginBottom: 12 }}>
        <div><span className="eyebrow">EVIDENCE</span><h3>Photos & voice notes</h3></div>
        {!closed && (
          <div className="chip-row">
            <PhotoButton stage="before" label={isStaff ? 'Before photo' : 'Add photo'} onPicked={upload} disabled={busy} className="secondary small" />
            {isStaff && <PhotoButton stage="after" label="After photo" onPicked={upload} disabled={busy} className="secondary small" />}
          </div>
        )}
      </div>

      {before && after && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DURATION.base, ease: EASE_OUT }}>
          <span className="field-label">Before / after — drag to compare</span>
          <BeforeAfter before={before} after={after} />
        </motion.div>
      )}

      {items === null ? <p className="muted small-text">Loading…</p> : (
        <>
          {photos.length > 0 && (
            <div className="photo-grid">
              {photos.map((a, i) => (
                <motion.div key={a.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: DURATION.base, ease: EASE_OUT, delay: itemDelay(i) }}>
                  <Photo a={a} onOpen={(att, url) => setOpen({ a: att, url })} />
                </motion.div>
              ))}
            </div>
          )}
          {voices.map((v, i) => (
            <motion.div key={v.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATION.base, ease: EASE_OUT, delay: itemDelay(i) }}>
              <VoiceNotePlayer note={v} />
            </motion.div>
          ))}
          {!photos.length && !voices.length && (
            <p className="muted small-text"><ImagePlus size={14} style={{ verticalAlign: -2 }} /> No photos or voice notes yet.
              {isStaff ? ' Add a before photo when you arrive and an after photo when it is fixed.' : ' A photo or a short recording often saves the technician a trip.'}</p>
          )}
        </>
      )}
      {!closed && (
        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <VoiceRecorder onReady={upload} compact />
          <HaloDropzone compact onFiles={addFiles} label="Drop photos or recordings here, or click to choose"
            hint={isStaff ? 'The first photo is "before"; the next one becomes the "after" photo' : 'A photo or a short recording often saves the technician a trip'} />
        </div>
      )}
      <Lightbox open={open} onClose={() => setOpen(null)} />
    </div>
  );
}

// QR stickers (admin): register equipment and rooms, then print stickers. Scanning a sticker
// with any phone camera opens the report form with the equipment and location filled in.
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { QrCode, Plus, Printer, Trash2, Loader2 } from 'lucide-react';
import api, { errMsg } from '../api';
import { Loading, Empty, Modal } from '../components/common';
import { ACADEMIC_BLOCKS, HOSTELS, OFFLINE_CATEGORIES, OFFLINE_SERVICE_BY_CATEGORY } from '../components/campus';
import { motion, AnimatePresence, DURATION, EASE_OUT, itemDelay } from '../motion';

const KINDS = ['Computer', 'Projector', 'Printer', 'Network', 'Fan', 'Light', 'Furniture', 'Room', 'Other'];
const EMPTY = { name: '', kind: 'Computer', location_type: 'academics', academic_block: ACADEMIC_BLOCKS[0], hostel_name: HOSTELS[0], room_number: '', category: '', notes: '' };

function QrImage({ code }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let url;
    let alive = true;
    api.get(`/assets/${code}/qr.svg`, { params: { base: window.location.origin }, responseType: 'blob' })
      .then(r => { if (alive) { url = URL.createObjectURL(r.data); setSrc(url); } })
      .catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [code]);
  return src ? <img className="qr-img" src={src} alt={`QR code for ${code}`} /> : <span className="qr-img placeholder"><Loader2 className="spin" size={18} /></span>;
}

export default function Assets() {
  const [items, setItems] = useState(null);
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [printing, setPrinting] = useState(false);

  const load = () => api.get('/assets').then(r => setItems(r.data)).catch(e => toast.error(errMsg(e) || 'Could not load equipment'));
  useEffect(() => {
    load();
    api.get('/catalog/categories').then(r => setCats(r.data.map(c => c.name))).catch(() => {});
  }, []);

  const save = async e => {
    e.preventDefault();
    setBusy(true);
    const body = { ...form, category: form.category || null, service_name: OFFLINE_SERVICE_BY_CATEGORY[form.category] || null };
    try {
      const r = await api.post('/assets', body);
      toast.success(`${r.data.code} registered — print its sticker`);
      setForm(null);
      setSelected(new Set([r.data.code]));
      load();
    } catch (err) {
      toast.error(errMsg(err) || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async a => {
    if (!window.confirm(`Delete ${a.code} (${a.name})? Its printed sticker will stop working.`)) return;
    try { await api.delete(`/assets/${a.code}`); toast.success(`${a.code} deleted`); load(); } catch (e) { toast.error(errMsg(e) || 'Could not delete'); }
  };

  const toggle = code => setSelected(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  const toPrint = useMemo(() => (items || []).filter(a => selected.has(a.code)), [items, selected]);

  const print = () => {
    setPrinting(true);
    setTimeout(() => { window.print(); setPrinting(false); }, 600);    // let the QR images load first
  };

  if (!items) return <Loading />;
  const catChoices = form?.location_type === 'hostel' ? OFFLINE_CATEGORIES : cats;

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div><span className="eyebrow">QR STICKERS</span><h3>Equipment & rooms</h3>
            <p className="muted small-text">Stick a QR code on a lab PC, projector, router or room door. Anyone who scans it lands on a report form that already knows what and where the problem is.
              Stickers point to <b>{window.location.origin}</b> — print them from the address students will use (e.g. your ngrok link).</p></div>
          <div className="chip-row">
            <button type="button" className="secondary" disabled={!toPrint.length} onClick={print}><Printer size={16} /> Print {toPrint.length || ''} sticker{toPrint.length === 1 ? '' : 's'}</button>
            <button type="button" className="primary" onClick={() => setForm({ ...EMPTY })}><Plus size={16} /> Register equipment</button>
          </div>
        </div>
        <div className="table-wrap plain">
          <table>
            <thead><tr><th><input type="checkbox" aria-label="Select all" checked={items.length > 0 && selected.size === items.length}
              onChange={e => setSelected(e.target.checked ? new Set(items.map(a => a.code)) : new Set())} /></th>
              <th>Code</th><th>Equipment</th><th>Location</th><th>Reports as</th><th /></tr></thead>
            <tbody>
              <AnimatePresence initial={false}>
                {items.map((a, n) => (
                  <motion.tr key={a.code} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: DURATION.base, ease: EASE_OUT, delay: itemDelay(n) }}>
                    <td><input type="checkbox" checked={selected.has(a.code)} onChange={() => toggle(a.code)} aria-label={`Select ${a.code}`} /></td>
                    <td><b className="mono">{a.code}</b></td>
                    <td><b>{a.name}</b><small>{a.kind}</small></td>
                    <td>{a.location?.formatted}</td>
                    <td>{a.category || <span className="muted">— chosen by the student</span>}</td>
                    <td><button type="button" className="icon-btn small" onClick={() => remove(a)} aria-label={`Delete ${a.code}`}><Trash2 size={15} /></button></td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
          {!items.length && <Empty text="No equipment registered yet." />}
        </div>
      </div>

      {toPrint.length > 0 && (
        <div className={`panel sticker-preview${printing ? ' printing' : ''}`}>
          <span className="eyebrow">PREVIEW</span>
          <div className="sticker-sheet">
            {toPrint.map(a => (
              <div className="sticker" key={a.code}>
                <QrImage code={a.code} />
                <div>
                  <b>Something wrong with this?</b>
                  <span>Scan to report it to BITS IT support</span>
                  <strong>{a.name}</strong>
                  <small>{a.location?.formatted} · <span className="mono">{a.code}</span></small>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {form && (
        <Modal title="Register equipment" onClose={() => setForm(null)} wide>
          <form className="modal-form two-col" onSubmit={save}>
            <label className="wide">Name<input required minLength={2} maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Lab PC 14 or Wi-Fi AP, 2nd floor" /></label>
            <label>Type<select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
            <label>Location type
              <select value={form.location_type} onChange={e => setForm({ ...form, location_type: e.target.value, category: '' })}>
                <option value="academics">Academic block / facility</option><option value="hostel">Hostel</option>
              </select>
            </label>
            {form.location_type === 'hostel'
              ? <label>Hostel<select value={form.hostel_name} onChange={e => setForm({ ...form, hostel_name: e.target.value })}>{HOSTELS.map(h => <option key={h}>{h}</option>)}</select></label>
              : <label>Block<select value={form.academic_block} onChange={e => setForm({ ...form, academic_block: e.target.value })}>{ACADEMIC_BLOCKS.map(b => <option key={b}>{b}</option>)}</select></label>}
            <label>Room / spot<input value={form.room_number} maxLength={40} onChange={e => setForm({ ...form, room_number: e.target.value })} placeholder="e.g. D-201 or 2nd floor corridor" /></label>
            <label className="wide">Report as (optional)
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                <option value="">Let the student choose</option>
                {catChoices.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <div className="modal-actions wide">
              <button type="button" className="secondary" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="primary" disabled={busy}><QrCode size={16} /> Register & make sticker</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

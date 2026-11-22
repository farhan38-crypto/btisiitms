import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Building2, Home, Wrench, Sparkles, Pencil, History, Link2, Lightbulb, Clock, AlertTriangle, CheckCircle,
  MessageSquare, Star, Siren, QrCode, KeyRound
} from 'lucide-react';
import api, { errMsg } from '../api';
import { Badge, Loading, Modal, fmt, fmtShort, minutesLabel, timeLeft, statusLabel, roleLabel } from '../components/common';
import { ACADEMIC_BLOCKS, HOSTELS } from '../components/campus';
import FieldVisitPanel, { useFieldInfo } from '../components/FieldVisit';
import { AttachmentsPanel } from '../components/attachments';
import { useLiveIncidentEvents } from '../live';
import { motion, AnimatePresence, DURATION, EASE_OUT, itemDelay } from '../motion';
import { celebrate } from '../interactions';
import { GlowingEffect } from '../components/effects';

// Friendly button text for each lifecycle move.
function actionLabel(from, to, role) {
  if (to === 'IN_PROGRESS') {
    if (from === 'RESOLVED') return 'Reopen — still not fixed';
    if (from === 'PENDING_INFO') return role === 'customer' ? 'Info provided — resume work' : 'Resume work';
    return 'Start investigation';
  }
  return {
    CLASSIFIED: 'Classify', ACKNOWLEDGED: 'Acknowledge', PENDING_INFO: 'Request more info',
    RESOLVED: 'Resolve', VERIFIED: 'Confirm the fix', CLOSED: 'Close with feedback'
  }[to] || `Move to ${statusLabel(to)}`;
}

const AUDIT_ICON = {
  INCIDENT_CREATED: '🆕', INCIDENT_CLASSIFIED: '🏷️', PRIORITY_CALCULATED: '⚖️', SLA_APPLIED: '⏱️', ASSIGNED: '👷',
  STATUS_CHANGED: '🔄', INFO_REQUESTED: '❓', RESOLVED: '✅', REOPENED: '↩️', CLOSED: '🔒', NOTE_ADDED: '📝',
  INCIDENT_UPDATED: '✏️', PRIORITY_CHANGED: '⚖️', SLA_AT_RISK: '⚠️', SLA_BREACHED: '⛔', ESCALATED: '🚨',
  CORRELATION_DETECTED: '🔗', LOCATION_CAPTURED: '📍', TECHNICIAN_EN_ROUTE: '🚶', TECHNICIAN_ARRIVED: '📌',
  HANDOVER_VERIFIED: '🔑', ATTACHMENT_ADDED: '📎'
};

export default function IncidentDetail({ user }) {
  const { id } = useParams();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [modal, setModal] = useState(null); // 'resolve' | 'close' | 'edit'
  const [resolveForm, setResolveForm] = useState({ summary: '', root_cause: '' });
  const [closeForm, setCloseForm] = useState({ rating: 5, comment: '' });
  const [busy, setBusy] = useState(false);
  const [handoverCode, setHandoverCode] = useState('');
  const [fieldKey, setFieldKey] = useState(0);
  const [field] = useFieldInfo(id, fieldKey);
  const liveTimer = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const load = useCallback(() => {
    api.get('/incidents/' + id)
      .then(x => { setD(x.data); setError(''); setFieldKey(k => k + 1); })
      .catch(e => setError(errMsg(e) || 'Could not load this incident.'));
  }, [id]);

  useEffect(load, [load]);

  // Someone else changed this incident (technician set off, a note, a photo…): refresh in place.
  useLiveIncidentEvents(ev => {
    if (!d || (ev.incident_id !== d.incident.id && ev.number !== d.incident.number) || ev.actor_id === user.id) return;
    clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(load, 300);
  });
  useEffect(() => () => clearTimeout(liveTimer.current), []);

  // Dropped on "Resolved" in the board view: open the resolve dialog straight away.
  useEffect(() => {
    if (searchParams.get('resolve') === '1' && d?.allowed_transitions?.includes('RESOLVED')) {
      setModal('resolve');
      setSearchParams({}, { replace: true });
    }
  }, [d, searchParams, setSearchParams]);

  if (error) return <div className="panel empty">{error}</div>;
  if (!d) return <Loading />;

  const i = d.incident;
  const role = user.role;
  const isTech = role === 'technician';
  const isAdmin = role === 'admin';
  const isStaff = isTech || isAdmin;
  const assignable = ['CLASSIFIED', 'ASSIGNED'].includes(i.status);
  const canSelfAssign = isTech && !i.assigned_to && assignable;
  const sla = i.sla || {};

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast.success(success);
      setModal(null);
      load();
    } catch (e) {
      toast.error(errMsg(e) || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const transition = (target, extra = {}) =>
    run(async () => {
      await api.post(`/incidents/${id}/transition`, { target_status: target, ...extra });
      if (['RESOLVED', 'VERIFIED', 'CLOSED'].includes(target)) celebrate();
    }, `${i.number} → ${statusLabel(target)}`);

  const onAction = target => {
    if (target === 'RESOLVED') return setModal('resolve');
    if (target === 'CLOSED') return setModal('close');
    return transition(target);
  };

  const assignTech = tid => run(() => api.post(`/incidents/${id}/assign`, { technician_id: tid }), 'Technician assigned');
  const autoAssign = () => run(() => api.post(`/incidents/${id}/auto-assign`), 'Technician dispatched automatically');
  const addNote = () => note.trim() && run(async () => {
    await api.post(`/incidents/${id}/notes`, { text: note.trim(), kind: isStaff ? 'investigation' : 'reporter_update' });
    setNote('');
  }, 'Note added');

  const closed = i.status === 'CLOSED';
  const needsCode = Boolean(field?.handover?.required && !field.handover.verified_at && isStaff);

  return (
    <>
      <div className="panel">
        <GlowingEffect />
        <div className="detail-head">
          <div style={{ minWidth: 0 }}>
            <div className="chip-row">
              <span className="eyebrow">{i.number}</span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={i.status} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: DURATION.base, ease: EASE_OUT }} style={{ display: 'inline-flex' }}>
                  <Badge v={i.status} />
                </motion.span>
              </AnimatePresence>
              <Badge v={i.priority} />
              <span className="location-pill">
                {i.location?.type === 'hostel' ? <Home size={14} color="#ea580c" /> : <Building2 size={14} color="#6366f1" />}
                {i.location?.formatted || 'Campus Main'}
              </span>
              {i.asset && (
                <span className="location-pill" title="Reported by scanning a QR sticker"><QrCode size={13} /> {i.asset.name} · {i.asset.code}</span>
              )}
              {i.escalation?.level > 0 && (
                <span className="badge breached" title="Automatic escalation"><Siren size={12} /> Escalated · {i.escalation.label}</span>
              )}
            </div>
            <h2 style={{ marginTop: 8 }}>{i.title}</h2>
            <p className="muted" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{i.description}</p>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <span className="eyebrow">SLA STATUS</span>
            <div style={{ marginTop: 4 }}><Badge v={sla.status || 'ON_TRACK'} /></div>
            {!['MET'].includes(sla.status) && !sla.resolved_at && sla.resolution_due_at && (
              <small className="muted">{timeLeft(sla.resolution_due_at)}</small>
            )}
          </div>
        </div>

        {i.status === 'PENDING_INFO' && role === 'customer' && (
          <div className="callout warn">
            <MessageSquare size={18} />
            <div><b>The technician needs more information.</b> Add the details as a note below, then click
              “Info provided — resume work”.</div>
          </div>
        )}

        <div className="actions">
          {canSelfAssign && (
            <button className="primary" disabled={busy} onClick={() => assignTech(user.id)}>
              <Wrench size={16} /> Claim this incident
            </button>
          )}
          {isAdmin && !i.assigned_to && assignable && (
            <button className="secondary" disabled={busy} onClick={autoAssign}>
              <Sparkles size={16} /> Auto-dispatch technician
            </button>
          )}
          {(d.allowed_transitions || []).map(t => (
            <button key={t} disabled={busy} className={['RESOLVED', 'ACKNOWLEDGED', 'VERIFIED'].includes(t) ? 'primary' : 'secondary'} onClick={() => onAction(t)}>
              {actionLabel(i.status, t, role)}
            </button>
          ))}
          {isStaff && !closed && (
            <button className="secondary" disabled={busy} onClick={() => setModal('edit')}><Pencil size={15} /> Edit details</button>
          )}
        </div>
      </div>

      <FieldVisitPanel incident={i} user={user} info={field} onChanged={load} />

      <div className="grid two">
        <div className="panel">
          <h4 className="panel-title">Reporter & contact</h4>
          <div className="kv"><span>Reporter</span><b>{i.reporter_name} {i.reporter_email && <small>({i.reporter_email})</small>}</b></div>
          {i.student_id && <div className="kv"><span>BITS ID</span><b>{i.student_id}</b></div>}
          {i.phone && <div className="kv"><span>Phone</span><b>{i.phone}</b></div>}
          <div className="kv"><span>Location</span><b>{i.location?.formatted || 'Campus Main'}</b></div>
          {i.visit_availability && <div className="kv"><span>Can visit</span><b>{i.visit_availability}</b></div>}
          <div className="kv"><span>Reported</span><b>{fmt(i.created_at)}</b></div>
          <div className="kv"><span>Last update</span><b>{fmt(i.updated_at)}</b></div>
        </div>
        <div className="panel">
          <h4 className="panel-title">Classification & assignment</h4>
          <div className="kv"><span>Category</span><b>{i.category}</b></div>
          <div className="kv"><span>Affected service</span><b>{i.service_name}</b></div>
          <div className="kv"><span>Assigned technician</span><b>{i.assigned_name || 'Unassigned'}</b></div>
          <div className="kv"><span>Priority</span><b>{i.priority} <small className="muted">(score {i.score}, {i.strategy} strategy)</small></b></div>
          <div className="kv"><span>Impact / Urgency</span><b>{i.impact} / {i.urgency}</b></div>
          <div className="kv"><span>Business criticality</span><b>{i.business_criticality ?? 1}{i.service_criticality ? ` (service: ${i.service_criticality})` : ''}</b></div>
          <div className="kv"><span>Affected people</span><b>{i.affected_users}</b></div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head" style={{ marginBottom: 12 }}>
          <div><span className="eyebrow">SERVICE LEVEL AGREEMENT</span><h3>{sla.policy_name || 'SLA'}</h3></div>
          <Badge v={sla.status || 'ON_TRACK'} />
        </div>
        <div className="sla-grid">
          <SlaBox icon={<Clock size={16} />} label="Response target" target={minutesLabel(sla.response_minutes)}
            due={sla.response_due_at} doneAt={sla.responded_at} doneLabel="Acknowledged" breached={sla.response_breached} />
          <SlaBox icon={<CheckCircle size={16} />} label="Resolution target" target={minutesLabel(sla.resolution_minutes)}
            due={sla.resolution_due_at} doneAt={sla.resolved_at} doneLabel="Resolved" breached={sla.resolution_breached} />
        </div>
        {i.escalation?.history?.length > 0 && (
          <div className="escalation-trail">
            <span className="eyebrow">ESCALATION</span>
            {i.escalation.history.map(h => (
              <span key={h.level} className="badge at-risk">L{h.level} {h.label} · {fmtShort(h.at)}</span>
            ))}
          </div>
        )}
      </div>

      <AttachmentsPanel incidentId={i.id} role={role} closed={closed} />

      {(i.resolution || i.closure) && (
        <div className="grid two">
          {i.resolution && (
            <div className="panel resolution-card">
              <span className="eyebrow">RESOLUTION</span>
              <p style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}><b>{i.resolution.summary}</b></p>
              {i.resolution.root_cause && <div className="kv"><span>Root cause</span><b>{i.resolution.root_cause}</b></div>}
              <div className="kv"><span>Resolved at</span><b>{fmt(i.resolution.resolved_at)}</b></div>
            </div>
          )}
          {i.closure && (
            <div className="panel">
              <span className="eyebrow">CLOSURE & FEEDBACK</span>
              <div className="stars" aria-label={`${i.closure.feedback_rating} out of 5`}>
                {[1, 2, 3, 4, 5].map(n => <Star key={n} size={18} fill={n <= i.closure.feedback_rating ? 'currentColor' : 'none'} />)}
              </div>
              {i.closure.feedback_comment && <p style={{ whiteSpace: 'pre-wrap' }}>“{i.closure.feedback_comment}”</p>}
              <div className="kv"><span>Closed at</span><b>{fmt(i.closure.closed_at)}</b></div>
            </div>
          )}
        </div>
      )}

      {isStaff && (d.suggested_resolutions?.length > 0) && (
        <div className="panel">
          <div className="panel-title-row"><Lightbulb size={18} /><h3>Suggested resolutions</h3></div>
          <p className="muted small-text">Fixes that worked for similar incidents in the past.</p>
          {d.suggested_resolutions.map(s => (
            <div className="row" key={s.id}>
              <span>
                <b>{s.summary}</b>
                <small><Link to={`/incidents/${s.id}`}>{s.number}</Link> · {s.title}{s.root_cause ? ` · root cause: ${s.root_cause}` : ''} · match {Math.round(s.score * 100)}%</small>
              </span>
              {(d.allowed_transitions || []).includes('RESOLVED') && (
                <button className="secondary small" onClick={() => { setResolveForm({ summary: s.summary || '', root_cause: s.root_cause || '' }); setModal('resolve'); }}>
                  Use this fix
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {(i.possible_duplicates?.length > 0 || d.related?.length > 0) && isStaff && (
        <div className="panel">
          <div className="panel-title-row"><Link2 size={18} /><h3>Duplicates & related incidents</h3></div>
          {(i.possible_duplicates || []).map(x => (
            <div className="row" key={'d' + x.id}>
              <span><Link to={`/incidents/${x.id}`}><b>{x.number}</b></Link><small>{x.title}</small></span>
              <span className="chip-row"><span className="badge at-risk">possible duplicate · {Math.round(x.score * 100)}%</span><Badge v={x.status} /></span>
            </div>
          ))}
          {(d.related || []).filter(r => !(i.possible_duplicates || []).some(x => x.id === r.id)).map(r => (
            <div className="row" key={'r' + r.id}>
              <span><Link to={`/incidents/${r.id}`}><b>{r.number}</b></Link><small>{r.title} · {r.service_name}</small></span>
              <span className="chip-row"><span className="badge">{r.reason}</span><Badge v={r.status} /></span>
            </div>
          ))}
        </div>
      )}

      {isStaff && d.recommendations?.length > 0 && assignable && (
        <div className="panel">
          <div className="panel-head"><div><span className="eyebrow">SMART RECOMMENDATION</span><h3>Technician match</h3></div></div>
          <div className="grid two">
            {d.recommendations.map(r => (
              <div key={r.technician_id} className="row boxed">
                <span>
                  <b>{r.name}</b>
                  <small>{r.skills.join(' · ') || 'General IT'}</small>
                  <small>Workload {r.open_count}/{r.max_concurrent} · match {Math.round(r.score * 100)}%</small>
                </span>
                {isAdmin && r.technician_id !== i.assigned_to && (
                  <button className="secondary small" disabled={busy} onClick={() => assignTech(r.technician_id)}>Assign</button>
                )}
                {isTech && user.id === r.technician_id && canSelfAssign && (
                  <button className="primary small" disabled={busy} onClick={() => assignTech(user.id)}>Pick up</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid two">
        <div className="panel">
          <h3>Investigation notes & updates</h3>
          {(i.notes || []).length === 0 && <p className="muted small-text">No notes yet.</p>}
          {(i.notes || []).map(n => (
            <motion.div className="note" key={n.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATION.base, ease: EASE_OUT }}>
              <b>{n.author_name}</b>
              <p>{n.text}</p>
              <small>{fmt(n.created_at)}</small>
            </motion.div>
          ))}
          {!closed && (
            <div className="note-input">
              <textarea rows="3" value={note} onChange={e => setNote(e.target.value)}
                placeholder={isStaff ? 'Add an investigation note…' : 'Add more information for the technician…'} />
              <button className="primary" disabled={busy || !note.trim()} onClick={addNote}>Add note</button>
            </div>
          )}
        </div>
        <div className="panel">
          <div className="panel-title-row"><History size={18} /><h3>Incident history</h3></div>
          <ol className="timeline">
            {(d.audit || []).map((a, n) => (
              <motion.li key={a.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: DURATION.base, ease: EASE_OUT, delay: itemDelay(n) }}>
                <span className="timeline-icon" aria-hidden="true">{AUDIT_ICON[a.action] || '•'}</span>
                <div>
                  <b>{a.description}</b>
                  <small>
                    {fmtShort(a.timestamp)} · {a.actor_name || 'System'}{a.actor_role ? ` (${roleLabel(a.actor_role).toLowerCase()})` : ''}
                    {a.previous_state && a.new_state && a.previous_state !== a.new_state ? ` · ${a.previous_state} → ${a.new_state}` : ''}
                  </small>
                </div>
              </motion.li>
            ))}
          </ol>
        </div>
      </div>

      {modal === 'resolve' && (
        <Modal title={`Resolve ${i.number}`} onClose={() => setModal(null)}>
          <form className="modal-form" onSubmit={e => { e.preventDefault(); transition('RESOLVED', { resolution_summary: resolveForm.summary.trim(), root_cause: resolveForm.root_cause.trim(), handover_code: handoverCode.trim() || undefined }); }}>
            <label>Resolution summary
              <textarea rows="3" required value={resolveForm.summary} onChange={e => setResolveForm({ ...resolveForm, summary: e.target.value })}
                placeholder="What fixed the issue?" />
            </label>
            <label>Root cause
              <input value={resolveForm.root_cause} onChange={e => setResolveForm({ ...resolveForm, root_cause: e.target.value })}
                placeholder="e.g. Blown fuse in Krishna Bhavan B-wing" />
            </label>
            {needsCode && (
              <label>
                <span className="label-row"><KeyRound size={14} /> Student's handover code {isAdmin && <span className="optional">(optional for admins)</span>}</span>
                <input className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={4} pattern="[0-9]{4}"
                  required={!isAdmin} value={handoverCode} onChange={e => setHandoverCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="• • • •" aria-describedby="code-help" />
                <small id="code-help" className="muted">Ask the student for the 4 digits on their report. {field.handover.attempts_left} tries left.</small>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="primary" disabled={busy || !resolveForm.summary.trim()}>Confirm resolution</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'close' && (
        <Modal title={`Close ${i.number}`} onClose={() => setModal(null)}>
          <form className="modal-form" onSubmit={e => { e.preventDefault(); transition('CLOSED', { feedback_rating: closeForm.rating, feedback_comment: closeForm.comment.trim() || undefined }); }}>
            <span className="field-label">How satisfied are you with the support?</span>
            <div className="stars big" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map(n => (
                <button type="button" key={n} role="radio" aria-checked={closeForm.rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  onClick={() => setCloseForm({ ...closeForm, rating: n })}>
                  <Star size={26} fill={n <= closeForm.rating ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
            <label>Comments (optional)
              <textarea rows="3" maxLength={1000} value={closeForm.comment} onChange={e => setCloseForm({ ...closeForm, comment: e.target.value })}
                placeholder="Anything we could do better?" />
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="primary" disabled={busy}>Close incident</button>
            </div>
          </form>
        </Modal>
      )}

      {modal === 'edit' && (
        <EditIncident incident={i} busy={busy} onClose={() => setModal(null)}
          onSave={changes => run(() => api.patch(`/incidents/${id}`, changes), 'Incident updated')} />
      )}
    </>
  );
}

function SlaBox({ icon, label, target, due, doneAt, doneLabel, breached }) {
  const state = doneAt ? (breached ? 'late' : 'ok') : breached ? 'late' : 'pending';
  return (
    <div className={`sla-box ${state}`}>
      <div className="sla-box-head">{icon}<span>{label}</span><b>{target}</b></div>
      <div className="kv"><span>Due</span><b>{fmtShort(due)}</b></div>
      <div className="kv">
        <span>{doneLabel}</span>
        <b>{doneAt ? fmtShort(doneAt) : <span className="muted">not yet · {timeLeft(due)}</span>}</b>
      </div>
      {breached && <div className="sla-flag"><AlertTriangle size={14} /> Deadline missed — recorded as an SLA violation</div>}
    </div>
  );
}

function EditIncident({ incident, onSave, onClose, busy }) {
  const loc = incident.location || {};
  const [f, setF] = useState({
    title: incident.title, description: incident.description, impact: incident.impact, urgency: incident.urgency,
    business_criticality: incident.business_criticality || 1, affected_users: incident.affected_users || 1,
    location_type: loc.type || 'academics', academic_block: loc.academic_block || ACADEMIC_BLOCKS[0],
    hostel_name: loc.hostel_name || HOSTELS[0], room_number: loc.room_number || ''
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const submit = e => {
    e.preventDefault();
    const changes = {};
    for (const [k, v] of Object.entries(f)) {
      const original = k in incident ? incident[k] : { location_type: loc.type, academic_block: loc.academic_block, hostel_name: loc.hostel_name, room_number: loc.room_number }[k];
      if (v !== original && !(v === '' && original == null)) changes[k] = v;
    }
    if (!Object.keys(changes).length) return onClose();
    onSave(changes);
  };
  const level = (k, labels) => (
    <select value={f[k]} onChange={e => set(k, +e.target.value)}>
      {[1, 2, 3].map(n => <option key={n} value={n}>{n} — {labels[n - 1]}</option>)}
    </select>
  );
  return (
    <Modal title={`Edit ${incident.number}`} onClose={onClose} wide>
      <form className="modal-form two-col" onSubmit={submit}>
        <label className="wide">Title<input required minLength={4} maxLength={160} value={f.title} onChange={e => set('title', e.target.value)} /></label>
        <label className="wide">Description<textarea required minLength={10} rows="4" value={f.description} onChange={e => set('description', e.target.value)} /></label>
        <label>Impact{level('impact', ['Low', 'Medium', 'High'])}</label>
        <label>Urgency{level('urgency', ['Low', 'Medium', 'Critical'])}</label>
        <label>Business criticality{level('business_criticality', ['Low', 'Important', 'Business critical'])}</label>
        <label>Affected people<input type="number" min="1" value={f.affected_users} onChange={e => set('affected_users', Math.max(1, +e.target.value || 1))} /></label>
        <label>Location type
          <select value={f.location_type} onChange={e => set('location_type', e.target.value)}>
            <option value="online">Online</option><option value="academics">Academic block</option><option value="hostel">Hostel</option>
          </select>
        </label>
        {f.location_type === 'hostel' && (
          <label>Hostel<select value={f.hostel_name} onChange={e => set('hostel_name', e.target.value)}>{HOSTELS.map(h => <option key={h}>{h}</option>)}</select></label>
        )}
        {f.location_type === 'academics' && (
          <label>Block<select value={f.academic_block} onChange={e => set('academic_block', e.target.value)}>{ACADEMIC_BLOCKS.map(b => <option key={b}>{b}</option>)}</select></label>
        )}
        <label>Room / lab<input value={f.room_number} onChange={e => set('room_number', e.target.value)} /></label>
        <p className="muted small-text wide">Changing impact, urgency, criticality or affected people recalculates the priority and SLA automatically.</p>
        <div className="modal-actions wide">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={busy}>Save changes</button>
        </div>
      </form>
    </Modal>
  );
}

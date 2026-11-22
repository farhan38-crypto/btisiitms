// The on-site part of an incident: live progress tracker, where to go, "on my way",
// GPS check-in, and the student's handover code.
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Footprints, MapPinCheck, MapPinOff, KeyRound, ShieldCheck, Loader2, Info } from 'lucide-react';
import api, { errMsg } from '../api';
import { fmtShort } from './common';
import { MiniMap, NavigateButtons, getPosition } from './location';
import { motion, AnimatePresence, DURATION, EASE_OUT, EASE_IN_OUT } from '../motion';
import { Check } from 'lucide-react';
import { GlowingEffect } from './effects';

const STEPS = [
  { key: 'reported', label: 'Reported' },
  { key: 'assigned', label: 'Technician assigned' },
  { key: 'en_route', label: 'On the way' },
  { key: 'arrived', label: 'Arrived' },
  { key: 'resolved', label: 'Fixed' },
  { key: 'closed', label: 'Closed' }
];

function currentStep(i, visit) {
  if (i.status === 'CLOSED') return 5;
  if (['RESOLVED', 'VERIFIED'].includes(i.status)) return 4;
  if (visit?.status === 'ARRIVED') return 3;
  if (visit?.status === 'EN_ROUTE') return 2;
  if (i.assigned_to) return 1;
  return 0;
}

function stepTime(key, i, visit) {
  return {
    reported: i.created_at, en_route: visit?.en_route_at, arrived: visit?.arrived_at,
    resolved: i.resolution?.resolved_at, closed: i.closure?.closed_at
  }[key];
}

export function Tracker({ incident, visit, onSite }) {
  const steps = onSite ? STEPS : STEPS.filter(s => !['en_route', 'arrived'].includes(s.key));
  const raw = currentStep(incident, visit);
  // Online issues skip "on the way" and "arrived": 0,1 stay; 4,5 shift down by two.
  const at = onSite ? raw : (raw >= 4 ? raw - 2 : Math.min(raw, 1));
  const pct = steps.length > 1 ? (at / (steps.length - 1)) * 100 : 0;
  return (
    <div className="tracker" role="list" aria-label="Progress">
      <div className="tracker-rail" aria-hidden="true">
        <motion.i initial={false} animate={{ scaleX: pct / 100 }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
      </div>
      {/* A glowing runner travels along the rail to the current step. */}
      <motion.span className="tracker-runner" aria-hidden="true" initial={false}
        animate={{ left: `calc(7% + ${pct * 0.86}%)` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
      {steps.map((s, n) => {
        const state = n < at ? 'done' : n === at ? 'current' : 'todo';
        const t = stepTime(s.key, incident, visit);
        return (
          <div className={`tracker-step ${state}`} key={s.key} role="listitem" aria-current={state === 'current' ? 'step' : undefined}>
            <motion.span className="tracker-dot" initial={false}
              animate={{ scale: state === 'current' ? 1.15 : 1 }} transition={{ duration: DURATION.base, ease: EASE_OUT }}>
              <AnimatePresence>
                {state === 'done' && (
                  <motion.span key="tick" className="tracker-tick" initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 520, damping: 18 }}><Check size={11} strokeWidth={3.5} /></motion.span>
                )}
              </AnimatePresence>
            </motion.span>
            <b>{s.label}</b>
            {t && n <= at && <small>{fmtShort(t)}</small>}
          </div>
        );
      })}
    </div>
  );
}

export function useFieldInfo(incidentId, refreshKey) {
  const [info, setInfo] = useState(null);
  const load = useCallback(() => {
    api.get(`/incidents/${incidentId}/field`).then(r => setInfo(r.data)).catch(() => setInfo(null));
  }, [incidentId]);
  useEffect(load, [load, refreshKey]);
  return [info, load];
}

export function HandoverCodeCard({ handover }) {
  if (!handover?.code) return null;
  const done = Boolean(handover.verified_at);
  return (
    <motion.div className={`handover-card${done ? ' done' : ''}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}>
      <div className="handover-head">{done ? <ShieldCheck size={18} /> : <KeyRound size={18} />}
        <b>{done ? 'Job confirmed with your code' : 'Your handover code'}</b></div>
      <div className="handover-digits" aria-label={`Handover code ${handover.code.split('').join(' ')}`}>
        {handover.code.split('').map((d, n) => (
          <motion.span key={n} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT, delay: 0.05 * n }}>{d}</motion.span>
        ))}
      </div>
      <small>{done ? `Confirmed ${fmtShort(handover.verified_at)}.`
        : 'Tell this code to the technician only once the job is done and you are happy with it. It proves they actually came.'}</small>
    </motion.div>
  );
}

export default function FieldVisitPanel({ incident, user, info, onChanged }) {
  const [busy, setBusy] = useState(null);         // 'trip' | 'arrive' | 'arrive-nogps'
  const [gpsFailed, setGpsFailed] = useState(false);
  const i = incident;
  const isStaff = user.role === 'technician' || user.role === 'admin';
  const mine = user.role === 'admin' || i.assigned_to === user.id;
  const visit = info?.visit || i.field_visit;
  const open = ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PENDING_INFO'].includes(i.status);
  const canAct = isStaff && mine && open && info?.on_site;

  const post = async (kind, url, body) => {
    setBusy(kind);
    try {
      await api.post(url, body);
      onChanged?.();
      return true;
    } catch (e) {
      toast.error(errMsg(e) || 'Could not update the visit');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const startTrip = async () => {
    if (await post('trip', `/incidents/${i.id}/field/en-route`)) toast.success('The student has been told you are on the way');
  };
  const arrive = async () => {
    setBusy('arrive');
    let pos;
    try {
      pos = await getPosition();
    } catch (e) {
      setBusy(null);
      setGpsFailed(true);
      toast.error(e.message);
      return;
    }
    setBusy(null);
    if (await post('arrive', `/incidents/${i.id}/field/arrive`, pos)) toast.success('Checked in — arrival verified by GPS');
  };
  const arriveWithoutGps = async () => {
    if (await post('arrive-nogps', `/incidents/${i.id}/field/arrive`, {})) toast.success('Checked in (no location)');
  };

  if (!info) return null;
  const geo = info.geo;
  return (
    <div className="panel field-panel">
      <GlowingEffect />
      <div className="panel-head" style={{ marginBottom: 14 }}>
        <div><span className="eyebrow">LIVE TRACKER</span><h3>{info.on_site ? 'Site visit' : 'Progress'}</h3></div>
        {visit?.status === 'ARRIVED' && (
          <span className={`badge ${visit.verified ? 'met' : 'at-risk'}`}>
            {visit.verified ? <><MapPinCheck size={12} /> GPS-verified arrival{visit.distance_m != null ? ` · ${Math.round(visit.distance_m)} m` : ''}</>
              : <><MapPinOff size={12} /> Arrival not GPS-verified</>}
          </span>
        )}
      </div>
      <Tracker incident={i} visit={visit} onSite={info.on_site} />

      {info.on_site && geo && (
        <div className="field-grid">
          <div>
            <MiniMap lat={geo.lat} lng={geo.lng} accuracy={geo.source === 'gps' ? geo.accuracy_m : null}
              label={i.location?.formatted} variant={geo.source === 'gps' ? 'primary' : 'muted'} height={200} />
            <small className="muted map-note">
              {geo.source === 'gps'
                ? <>Exact spot shared by the reporter{geo.accuracy_m != null ? ` (±${geo.accuracy_m} m)` : ''}.</>
                : <>Building pin for {info.building}; go to {i.location?.formatted}.</>}
            </small>
          </div>
          <div className="field-actions">
            <b className="field-dest">{i.location?.formatted}</b>
            {i.visit_availability && <small className="muted">Student is available: {i.visit_availability}</small>}
            {isStaff && <NavigateButtons navigation={info.navigation} />}
            <AnimatePresence initial={false} mode="popLayout">
              {canAct && visit?.status !== 'EN_ROUTE' && visit?.status !== 'ARRIVED' && (
                <motion.button key="trip" type="button" className="secondary" disabled={!!busy} onClick={startTrip}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {busy === 'trip' ? <Loader2 size={15} className="spin" /> : <Footprints size={16} />} I'm on my way
                </motion.button>
              )}
              {canAct && visit?.status !== 'ARRIVED' && (
                <motion.button key="arrive" type="button" className={visit?.status === 'EN_ROUTE' ? 'primary' : 'secondary'}
                  disabled={!!busy} onClick={arrive} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {busy === 'arrive' ? <Loader2 size={15} className="spin" /> : <MapPinCheck size={16} />} I've arrived — check in
                </motion.button>
              )}
              {canAct && visit?.status !== 'ARRIVED' && gpsFailed && (
                <motion.button key="nogps" type="button" className="secondary small" disabled={!!busy} onClick={arriveWithoutGps}
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <MapPinOff size={14} /> Check in without location
                </motion.button>
              )}
            </AnimatePresence>
            {isStaff && info.handover?.required && !info.handover.verified_at && i.status !== 'CLOSED' && (
              <p className="callout-mini"><Info size={14} /> Hostel job: ask the student for their 4-digit handover code — you need it to resolve.
                {info.handover.locked && ' The code is locked after too many wrong tries; an admin must resolve.'}</p>
            )}
            {visit?.en_route_at && visit.status === 'EN_ROUTE' && (
              <small className="muted">{visit.technician_name} set off {fmtShort(visit.en_route_at)}.</small>
            )}
          </div>
        </div>
      )}
      {user.id === i.reporter_id && <HandoverCodeCard handover={info.handover} />}
    </div>
  );
}

// On-site work: where it is (map + directions), the technician's trip ("on my way", GPS
// check-in) and the handover code, which works like a delivery OTP: only the reporter sees
// it, and the technician needs it to close a hostel job.
import { lazy, Suspense, useState } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, ExternalLink, KeyRound, LocateFixed, Lock, MapPin, Navigation } from 'lucide-react'
import { api, ApiError, useQuery, type FieldInfo, type Incident, type User } from '../../api'
import { clock, timeAgo } from '../../lib/format'
import { Button } from '../../ui/Controls'
import { pVar } from '../../ui/Badges'
import { refreshIncident } from './Actions'

const MiniMap = lazy(() => import('../../components/map/MiniMap'))
export const useField = (id: string, enabled = true) => useQuery<FieldInfo>(enabled ? `field:${id}` : null, () => api.field.info(id), { staleMs: 10_000 })

function locate(): Promise<GeolocationPosition> {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no-geo'))
    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 })
  })
}

export function FieldCard({ incident, user, field }: { incident: Incident; user: User; field: FieldInfo | undefined }) {
  const [busy, setBusy] = useState<string | null>(null)
  if (!field) return <div className="card field-card"><span className="skel" style={{ height: 160 }} /></div>
  const v = field.visit
  const reporter = user.id === incident.reporter_id
  const mine = user.role === 'admin' || incident.assigned_to === user.id
  const workable = ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PENDING_INFO'].includes(incident.status)
  const canVisit = field.on_site && workable && mine && user.role !== 'customer'

  const onMyWay = async () => {
    setBusy('route')
    try { await api.field.enRoute(incident.id); toast.success('The reporter has been told you’re on the way'); refreshIncident(incident.id) }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'That didn’t work') } finally { setBusy(null) }
  }
  const arrive = async (withoutLocation = false) => {
    setBusy('arrive')
    try {
      let geo = {}
      if (!withoutLocation) {
        try { const p = await locate(); geo = { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy_m: p.coords.accuracy } }
        catch { toast.message('No location fix: checking in without GPS.') }
      }
      await api.field.arrive(incident.id, geo)
      toast.success('Checked in'); refreshIncident(incident.id)
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Check-in failed'
      toast.error(msg, msg.includes('away') ? { action: { label: 'Check in anyway', onClick: () => arrive(true) }, duration: 10_000 } : undefined)
    } finally { setBusy(null) }
  }

  return (
    <div className="card field-card">
      <header className="card-head"><h3><MapPin size={15} />{field.on_site ? 'On site' : 'Online help'}</h3>
        {field.navigation && !reporter && <a className="btn sm" href={field.navigation.google} target="_blank" rel="noreferrer"><Navigation size={14} />Directions</a>}</header>
      {field.geo && (
        <Suspense fallback={<div className="minimap" style={{ height: 160 }} />}>
          <MiniMap lat={field.geo.lat} lng={field.geo.lng} accuracy={field.precise ? field.geo.accuracy_m : null} colour={pVar(incident.priority)} label={incident.location.formatted} height={160} />
        </Suspense>
      )}
      <p className="field-where"><b>{incident.location.formatted}</b>
        <small>{field.geo ? (field.precise ? 'Exact spot shared from the reporter’s phone' : field.geo.source === 'building' ? 'Pin at the middle of the building' : 'Approximate location') : 'No location: this is an online issue'}</small>
        {incident.visit_availability && <small>Available: {incident.visit_availability}</small>}</p>
      {field.navigation && !reporter && <a className="link small" href={field.navigation.osm} target="_blank" rel="noreferrer">Open in OpenStreetMap <ExternalLink size={12} /></a>}

      {field.on_site && (
        <div className="visit">
          {!v ? <p className="muted small">No visit logged yet.</p>
            : v.arrived_at ? <p className="visit-line" data-ok><CheckCircle2 size={15} /><span><b>{v.technician_name} arrived at {clock(v.arrived_at)}</b>
                <small>{v.verified ? `GPS-verified, ${Math.round(v.distance_m || 0)} m from the spot` : 'Checked in without a location fix'}</small></span></p>
            : <p className="visit-line"><Navigation size={15} /><span><b>{v.technician_name} is on the way</b><small>Since {timeAgo(v.en_route_at)}</small></span></p>}
          {canVisit && <div className="row-actions">
            {!v && <Button variant="primary" className="sm" busy={busy === 'route'} icon={<Navigation size={14} />} onClick={onMyWay}>On my way</Button>}
            {!v?.arrived_at && <Button className="sm" busy={busy === 'arrive'} icon={<LocateFixed size={14} />} onClick={() => arrive()}>I’ve arrived</Button>}
          </div>}
        </div>
      )}

      {field.handover && (reporter ? (
        field.handover.verified_at
          ? <p className="visit-line" data-ok><CheckCircle2 size={15} /><span><b>Handover confirmed</b><small>You were there when it was fixed.</small></span></p>
          : field.handover.code && (
            <div className="otp" aria-label={`Handover code ${field.handover.code.split('').join(' ')}`}>
              <small><KeyRound size={13} />Handover code</small>
              <div className="otp-digits">{field.handover.code.split('').map((d, k) => <span key={k}>{d}</span>)}</div>
              <p>Give this to the technician only when the job is done. It proves they came.</p>
            </div>)
      ) : (
        <p className="visit-line" data-ok={field.handover.verified_at ? '' : undefined}>
          {field.handover.verified_at ? <CheckCircle2 size={15} /> : field.handover.locked ? <Lock size={15} /> : <KeyRound size={15} />}
          <span><b>{field.handover.verified_at ? 'Handover code confirmed' : field.handover.locked ? 'Handover code locked' : field.handover.required ? 'Handover code needed to resolve' : 'Handover code optional'}</b>
            <small>{field.handover.verified_at ? 'The student was present.' : field.handover.locked ? 'Too many wrong tries; an administrator can resolve it.' : `Ask the student for the code on their report (${field.handover.attempts_left} tries).`}</small></span>
        </p>
      ))}
    </div>
  )
}

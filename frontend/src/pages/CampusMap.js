// Campus map for staff: every open report as a pin, building hotspots, and building-wide
// outage alerts. Admins can drag building pins to correct them.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Popup, Marker, Tooltip } from 'react-leaflet';
import { toast } from 'sonner';
import { Siren, MapPinned, Move, RefreshCw } from 'lucide-react';
import api, { errMsg } from '../api';
import { Badge, Loading, fmtShort, statusLabel } from '../components/common';
import { CAMPUS_CENTRE, TILE_URL, TILE_ATTRIBUTION, pinIcon } from '../components/location';
import { useLiveIncidentEvents } from '../live';
import { motion, AnimatePresence, DURATION, EASE_OUT, itemDelay } from '../motion';

const PRIORITY_COLOR = { P1: '#dc2626', P2: '#ea580c', P3: '#2563eb', P4: '#64748b' };

export default function CampusMap({ user }) {
  const [data, setData] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [days, setDays] = useState(30);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [editPins, setEditPins] = useState(false);
  const [error, setError] = useState('');
  const timer = useRef(null);
  const isAdmin = user.role === 'admin';

  const load = useCallback(() => {
    Promise.all([
      api.get('/campus/map', { params: { days, include_closed: includeClosed } }),
      api.get('/campus/buildings')
    ]).then(([m, b]) => { setData(m.data); setBuildings(b.data.buildings); setError(''); })
      .catch(e => setError(errMsg(e) || 'Could not load the campus map.'));
  }, [days, includeClosed]);
  useEffect(load, [load]);

  // New reports and status changes move pins live (debounced: a burst of events = one reload).
  useLiveIncidentEvents(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(load, 600);
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const pinByName = useMemo(() => Object.fromEntries(buildings.map(b => [b.name, b])), [buildings]);

  const movePin = async (name, latlng) => {
    try {
      const r = await api.put(`/campus/buildings/${encodeURIComponent(name)}`, { latitude: latlng.lat, longitude: latlng.lng });
      setBuildings(r.data.buildings);
      toast.success(`${name} pin saved`);
    } catch (e) {
      toast.error(errMsg(e) || 'Could not save the pin');
    }
  };

  if (error) return <div className="panel empty">{error}</div>;
  if (!data) return <Loading />;

  return (
    <>
      <AnimatePresence initial={false}>
        {data.outages.map((o, n) => (
          <motion.section key={o.building} className="panel outage-alert" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: DURATION.base, ease: EASE_OUT, delay: itemDelay(n) }}>
            <Siren size={20} />
            <div>
              <b>Possible outage in {o.building}: {o.count} reports in {o.window_minutes} min</b>
              <small>{o.suggestion}</small>
              <span className="chip-row">{o.incidents.slice(0, 8).map(i => <Link key={i.id} className="badge" to={`/incidents/${i.id}`}>{i.number}</Link>)}</span>
            </div>
          </motion.section>
        ))}
      </AnimatePresence>

      <div className="panel map-panel">
        <div className="panel-head">
          <div><span className="eyebrow">CAMPUS MAP</span><h3>Where the problems are</h3>
            <p className="muted small-text">{data.points.length} located report{data.points.length === 1 ? '' : 's'} · last {data.days} days · a building with {data.threshold}+ reports is a hotspot.</p></div>
          <div className="chip-row map-controls">
            <select value={days} onChange={e => setDays(+e.target.value)} aria-label="Time window">
              {[1, 7, 30, 90].map(d => <option key={d} value={d}>Last {d} day{d > 1 ? 's' : ''}</option>)}
            </select>
            <label className="check-inline"><input type="checkbox" checked={includeClosed} onChange={e => setIncludeClosed(e.target.checked)} /> Include closed</label>
            {isAdmin && (
              <button type="button" className={editPins ? 'primary small' : 'secondary small'} onClick={() => setEditPins(v => !v)}>
                <Move size={14} /> {editPins ? 'Done moving pins' : 'Correct building pins'}
              </button>
            )}
            <button type="button" className="icon-btn" onClick={load} aria-label="Refresh"><RefreshCw size={16} /></button>
          </div>
        </div>
        {editPins && <p className="callout-mini"><MapPinned size={14} /> Drag a building pin to where the building really is. Reports that use the building pin will point there.</p>}
        <div className="campus-map">
          <MapContainer center={CAMPUS_CENTRE} zoom={17} scrollWheelZoom style={{ height: '100%' }}>
            <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={19} />
            {data.hotspots.filter(h => pinByName[h.building]).map(h => (
              <CircleMarker key={`h-${h.building}`} center={[pinByName[h.building].lat, pinByName[h.building].lng]}
                radius={14 + Math.min(26, h.count * 4)}
                pathOptions={{ color: h.is_hotspot ? '#dc2626' : '#94a3b8', weight: 1, fillOpacity: h.is_hotspot ? 0.18 : 0.08 }}>
                <Tooltip direction="top">{h.building}: {h.count} report{h.count === 1 ? '' : 's'}{h.is_hotspot ? ' — hotspot' : ''}</Tooltip>
              </CircleMarker>
            ))}
            {data.points.map(p => (
              <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={p.source === 'gps' ? 7 : 6}
                pathOptions={{ color: '#fff', weight: 2, fillColor: PRIORITY_COLOR[p.priority] || '#64748b', fillOpacity: 0.95 }}>
                <Popup>
                  <div className="map-popup">
                    <Link to={`/incidents/${p.id}`}><b>{p.number}</b></Link> <Badge v={p.priority} />
                    <p>{p.title}</p>
                    <small>{p.location} · {statusLabel(p.status)}{p.assigned_name ? ` · ${p.assigned_name}` : ''}</small>
                    <small>{p.source === 'gps' ? `Exact spot (±${p.accuracy_m ?? '?'} m)` : 'Building pin'} · {fmtShort(p.created_at)}</small>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
            {editPins && buildings.map(b => (
              <Marker key={`b-${b.name}`} position={[b.lat, b.lng]} draggable icon={pinIcon(b.corrected ? 'primary' : 'muted')}
                eventHandlers={{ dragend: e => movePin(b.name, e.target.getLatLng()) }}>
                <Tooltip direction="top" permanent={false}>{b.name}{b.corrected ? ' (corrected)' : ' (approximate)'}</Tooltip>
              </Marker>
            ))}
          </MapContainer>
        </div>
        <div className="map-legend">
          {Object.entries(PRIORITY_COLOR).map(([p, c]) => <span key={p}><i style={{ background: c }} />{p}</span>)}
          <span><i className="ring" />Hotspot</span>
        </div>
      </div>

      <div className="panel">
        <span className="eyebrow">BY BUILDING</span>
        <h3>Busiest buildings</h3>
        {data.hotspots.length === 0 ? <p className="muted small-text">No located reports in this period.</p> : (
          <div className="bar-list">
            {data.hotspots.map((h, n) => (
              <motion.div className="bar-row" key={h.building} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.base, ease: EASE_OUT, delay: itemDelay(n) }}>
                <span className="bar-label">{h.building}</span>
                <span className="bar-track"><motion.i style={{ width: `${(h.count / data.hotspots[0].count) * 100}%`, transformOrigin: 'left' }}
                  initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: itemDelay(n) }}
                  className={h.is_hotspot ? 'hot' : ''} /></span>
                <b>{h.count}</b>
                <small>{h.open} open{h.breached ? ` · ${h.breached} SLA breached` : ''}{h.worst_priority ? ` · worst ${h.worst_priority}` : ''}</small>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

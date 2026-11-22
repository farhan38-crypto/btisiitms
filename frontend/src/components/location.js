// Location features: capture the reporter's exact spot, show it on a small map,
// and give technicians one-tap directions.
import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toast } from 'sonner';
import { Crosshair, MapPin, Navigation, X, Loader2 } from 'lucide-react';
import { AnimatePresence, motion, DURATION, EASE_OUT } from '../motion';

export const CAMPUS_CENTRE = [17.5465, 78.5725];
export const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const pinIcon = (variant = 'primary', label = '') => L.divIcon({
  className: 'map-pin-wrap',
  html: `<span class="map-pin pin-${variant}">${label}</span>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11]
});

const GEO_ERRORS = {
  1: 'Location permission was denied. Allow it in the browser\'s address bar, or skip this — the building is enough.',
  2: 'Your position could not be found (try near a window, or skip this).',
  3: 'Getting your location took too long. Try again or skip this.'
};

export function getPosition({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This browser cannot share its location.')); return; }
    if (!window.isSecureContext) {
      reject(new Error('Location only works on https:// or localhost. Open the app through the ngrok link on your phone.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) }),
      e => reject(new Error(GEO_ERRORS[e.code] || 'Could not get your location.')),
      { enableHighAccuracy: true, timeout, maximumAge: 10000 }
    );
  });
}

function Recentre({ lat, lng }) {
  const map = useMap();
  useEffect(() => { map.setView([lat, lng], map.getZoom(), { animate: true }); }, [map, lat, lng]);
  return null;
}

export function MiniMap({ lat, lng, accuracy, label, variant = 'primary', height = 180, zoom = 17, extra }) {
  const at = [lat, lng];
  return (
    <div className="mini-map" style={{ height }}>
      <MapContainer center={at} zoom={zoom} scrollWheelZoom={false} attributionControl zoomControl={false} style={{ height: '100%' }}>
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
        {accuracy ? <Circle center={at} radius={accuracy} pathOptions={{ weight: 1, opacity: 0.6, fillOpacity: 0.12 }} /> : null}
        <Marker position={at} icon={pinIcon(variant)} title={label} />
        {extra}
        <Recentre lat={lat} lng={lng} />
      </MapContainer>
    </div>
  );
}

// Report form: "Use my exact location" + preview map. value = {latitude, longitude, accuracy_m} | null
export function LocationCapture({ value, onChange, buildingLabel }) {
  const [busy, setBusy] = useState(false);
  const capture = async () => {
    setBusy(true);
    try {
      const p = await getPosition();
      onChange(p);
      if (p.accuracy_m > 60) toast.message(`Location found, but only accurate to ±${p.accuracy_m} m (normal indoors). The building and room still guide the technician.`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="location-capture">
      <div className="location-capture-row">
        <button type="button" className={value ? 'secondary small' : 'secondary'} onClick={capture} disabled={busy}>
          {busy ? <Loader2 size={15} className="spin" /> : <Crosshair size={15} />}
          {value ? 'Update my location' : 'Share my exact location'}
        </button>
        <small className="muted">
          {value
            ? <>Pinned with ±{value.accuracy_m} m accuracy. The technician gets walking directions to this spot.</>
            : <>Optional. Without it, the technician is guided to {buildingLabel || 'the building'}.</>}
        </small>
        {value && (
          <button type="button" className="icon-btn small" onClick={() => onChange(null)} aria-label="Remove my location"><X size={15} /></button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {value && (
          <motion.div key="map" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}>
            <MiniMap lat={value.latitude} lng={value.longitude} accuracy={value.accuracy_m} label="Reported here" height={170} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function NavigateButtons({ navigation, className = '' }) {
  if (!navigation) return null;
  return (
    <div className={`nav-buttons ${className}`}>
      <a className="primary" href={navigation.google} target="_blank" rel="noreferrer">
        <Navigation size={16} /> Navigate with Google Maps
      </a>
      {navigation.osm && (
        <a className="secondary small" href={navigation.osm} target="_blank" rel="noreferrer"><MapPin size={14} /> OpenStreetMap</a>
      )}
    </div>
  );
}

// A small, still map with one pin: where an incident is. Dark by default (components/map/tone).
// MapLibre + OpenFreeMap tiles, no key. Falls back to coordinates if tiles can't load.
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState } from 'react'
import { useMapDark } from './tone'

export default function MiniMap({ lat, lng, accuracy, colour = 'var(--a)', label, height = 180, zoom = 17 }: {
  lat: number; lng: number; accuracy?: number | null; colour?: string; label?: string; height?: number; zoom?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const dark = useMapDark()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!box.current) return
    let map: maplibregl.Map | null = null
    const t = window.setTimeout(() => {
      if (!box.current) return
      try {
        map = new maplibregl.Map({ container: box.current, style: `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`,
          center: [lng, lat], zoom, pitch: 40, interactive: false, attributionControl: { compact: true } })
      } catch { setFailed(true); return }
      map.on('error', () => {})
      map.on('style.load', () => {
        if (dark) for (const l of map!.getStyle().layers) if (l.type === 'background') map!.setPaintProperty(l.id, 'background-color', '#000000')
      })
      const el = document.createElement('div')
      el.className = 'mini-pin'
      el.style.setProperty('--k', colour)
      el.innerHTML = '<i></i><b></b>'
      new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
    }, 0)
    return () => { window.clearTimeout(t); map?.remove() }
  }, [lat, lng, dark, colour, zoom])
  return (
    <div className="minimap" style={{ height }} aria-label={label ? `Map of ${label}` : 'Map'} role="img">
      {failed ? <div className="map-loading">{lat.toFixed(5)}, {lng.toFixed(5)}</div> : <div ref={box} className="minimap-canvas" />}
      {accuracy != null && <span className="minimap-acc">±{Math.round(accuracy)} m</span>}
    </div>
  )
}

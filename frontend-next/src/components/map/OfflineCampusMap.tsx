// Campus view drawn by the app itself, used when no Google Maps key is set (or Google fails to
// load). Buildings are placed from the same pins the backend uses, on a tilted dark plane.
import { useMemo, useRef, type CSSProperties } from 'react'
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react'
import type { Building, Hotspot, MapPoint } from '../../api'
import { Pin, HotspotRing } from './Pin'
import { spread } from './geometry'
import { pointAt, useHovered } from '../../lib/store'

interface Props { points: MapPoint[]; hotspots: Hotspot[]; buildings: Building[]; colourOf: (p: MapPoint) => string
  hotColour: (h: Hotspot) => string; selected: string | null; onSelect: (id: string | null) => void }

export function OfflineCampusMap({ points, hotspots, buildings, colourOf, hotColour, selected, onSelect }: Props) {
  const hovered = useHovered()
  const reduce = useReducedMotion()
  const box = useRef<HTMLDivElement>(null)
  const mx = useMotionValue(0), my = useMotionValue(0)
  const rx = useSpring(useTransform(my, [-1, 1], [40, 30]), { stiffness: 120, damping: 20 })
  const rz = useSpring(useTransform(mx, [-1, 1], [-14, -6]), { stiffness: 120, damping: 20 })

  const proj = useMemo(() => {
    const lats = buildings.map(b => b.lat), lngs = buildings.map(b => b.lng)
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
    const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)
    const w = (maxLng - minLng) * k || 1e-6, h = (maxLat - minLat) || 1e-6
    const s = Math.min(84 / w, 76 / h)
    const ox = (100 - w * s) / 2, oy = (100 - h * s) / 2
    return (lat: number, lng: number) => ({ x: ox + (lng - minLng) * k * s, y: oy + (maxLat - lat) * s })
  }, [buildings])

  const pts = useMemo(() => spread(points, 14), [points])
  const byName = Object.fromEntries(buildings.map(b => [b.name, b]))

  return (
    <div ref={box} className="offline-map"
      onPointerMove={e => { if (reduce) return; const r = box.current!.getBoundingClientRect(); mx.set(((e.clientX - r.left) / r.width) * 2 - 1); my.set(((e.clientY - r.top) / r.height) * 2 - 1) }}
      onClick={e => { if (e.target === e.currentTarget) onSelect(null) }}>
      <motion.div className="offline-plane" style={{ rotateX: reduce ? 34 : rx, rotateZ: reduce ? -10 : rz }}>
        <div className="offline-grid" />
        {buildings.map(b => {
          const { x, y } = proj(b.lat, b.lng)
          const hostel = /Bhavan/.test(b.name)
          return (
            <div key={b.name} className="bldg" data-hostel={hostel || undefined} style={{ left: `${x}%`, top: `${y}%` }}>
              <span className="bldg-block" /><span className="bldg-name">{b.name.replace(/ \(.+\)/, '')}</span>
            </div>
          )
        })}
        {hotspots.filter(h => h.is_hotspot && byName[h.building]).map(h => {
          const { x, y } = proj(byName[h.building].lat, byName[h.building].lng)
          return <div key={h.building} className="anchor" style={{ left: `${x}%`, top: `${y}%` }}><HotspotRing colour={hotColour(h)} count={h.count} /></div>
        })}
        {pts.map(p => {
          const { x, y } = proj(p.plat, p.plng)
          const c = colourOf(p)
          return (
            <button key={p.id} className="anchor pin-btn" style={{ left: `${x}%`, top: `${y}%`, '--k': c } as CSSProperties}
              aria-label={`${p.number}: ${p.title}`}
              onPointerEnter={() => pointAt(p.id, c)} onPointerLeave={() => pointAt(null, null)}
              onFocus={() => pointAt(p.id, c)} onBlur={() => pointAt(null, null)}
              onClick={() => onSelect(p.id)}>
              <Pin colour={c} active={hovered === p.id || selected === p.id} urgent={p.priority === 'P1'} />
            </button>
          )
        })}
      </motion.div>
    </div>
  )
}

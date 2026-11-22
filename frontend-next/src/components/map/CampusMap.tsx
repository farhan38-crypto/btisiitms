// The campus map panel: Google Maps when a key is configured, otherwise the real campus from
// satellite photos / a street map (MapLibre); the drawn campus view only if map tiles can't load. Pins glow in their priority colour; busy buildings get a ring; the selected
// report opens a card with "Open report" and "Navigate".
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Radio } from 'lucide-react'
import { api, useQuery, setCached } from '../../api'
import { useAuth } from '../../lib/auth'
import { priorityHex } from '../../lib/themes'
import type { Building, CampusMapData, Hotspot, MapPoint } from '../../api'
import { useMapDark } from './tone'
import { GoogleCampusMap } from './GoogleCampusMap'
import { OfflineCampusMap } from './OfflineCampusMap'

import { PinCard } from './PinCard'
import { pointAt } from '../../lib/store'

const RealCampusMap = lazy(() => import('./RealCampusMap').then(m => ({ default: m.RealCampusMap })))
const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined
const MAP_ID = import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined

export const useBuildings = () => useQuery('buildings', () => api.campus.buildings(), { staleMs: 300_000 })
export function useCampusData() {
  const { data, reload } = useQuery<CampusMapData>('campus-map', () => api.campus.map(30))
  const { data: buildings } = useBuildings()
  // Admin moved a building onto its real roof.
  const moveBuilding = useCallback(async (name: string, lat: number, lng: number) => {
    setCached('buildings', await api.campus.setPin(name, lat, lng))
  }, [])
  return { data: data ?? null, buildings: buildings ?? null, reload, moveBuilding }
}

export function CampusMap({ data, buildings, focus, className, style, onMoveBuilding, embedded }: {
  data: CampusMapData | null; buildings: { centre: { lat: number; lng: number }; buildings: Building[] } | null
  focus?: string | null; className?: string; style?: CSSProperties
  onMoveBuilding?: (name: string, lat: number, lng: number) => Promise<void>; embedded?: boolean }) {
  const { theme, user } = useAuth()
  const dark = useMapDark()
  const [tilesFailed, setTilesFailed] = useState(false)
  const onTilesFail = useCallback(() => setTilesFailed(true), [])
  const [selected, setSelected] = useState<string | null>(focus || null)
  const [googleFailed, setGoogleFailed] = useState(false)
  useEffect(() => { if (focus) setSelected(focus) }, [focus])
  const colourOf = useCallback((p: MapPoint) => priorityHex(p.priority, theme), [theme])
  const hotColour = useCallback((h: Hotspot) => priorityHex(h.worst_priority, theme), [theme])
  const onFail = useCallback(() => setGoogleFailed(true), [])
  // Legend chips double as filters: click one to hide or show that priority's pins.
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const toggle = (p: string) => setHidden(h => { const n = new Set(h); if (n.has(p)) n.delete(p); else n.add(p); return n })
  const points = useMemo(() => (data?.points || []).filter(p => !hidden.has(p.priority)), [data, hidden])
  const sel = data?.points.find(p => p.id === selected) || null
  const useGoogle = !!KEY && !googleFailed

  return (
    <div className={`campus-map ${className || ''}`} style={style}>
      {!data || !buildings ? <div className="map-loading"><span />Loading the campus…</div>
        : useGoogle
          ? <GoogleCampusMap apiKey={KEY!} mapId={MAP_ID} dark={dark} points={points} hotspots={data.hotspots}
              buildings={buildings.buildings} centre={buildings.centre} colourOf={colourOf} hotColour={hotColour}
              selected={selected} onSelect={setSelected} onFail={onFail} />
          : !tilesFailed
            ? <Suspense fallback={<div className="map-loading"><span />Loading the campus…</div>}><RealCampusMap dark={dark} points={points} hotspots={data.hotspots} buildings={buildings.buildings}
                centre={buildings.centre} colourOf={colourOf} hotColour={hotColour} selected={selected} onSelect={setSelected}
                onFail={onTilesFail} canEdit={user?.role === 'admin' && !!onMoveBuilding} onMoveBuilding={onMoveBuilding} cooperative={embedded} /></Suspense>
          : <OfflineCampusMap points={points} hotspots={data.hotspots} buildings={buildings.buildings}
              colourOf={colourOf} hotColour={hotColour} selected={selected} onSelect={setSelected} />}

      {data && data.outages.length > 0 && !embedded && (
        <div className="map-overlay map-outages">
          {data.outages.slice(0, 2).map(o => (
            <motion.button type="button" key={o.building} className="outage glass glass-solid" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
              whileTap={{ scale: .98 }} title={`Fly to ${o.building} and open its most urgent report`}
              onClick={() => { const first = [...o.incidents].sort((a, b) => a.priority.localeCompare(b.priority))[0]; if (first) { setHidden(new Set()); setSelected(first.id) } }}
              onPointerEnter={() => pointAt(null, theme.status.P1)} onPointerLeave={() => pointAt(null, null)}>
              <Radio size={16} className="outage-icon" />
              <div><b>Possible outage in {o.building}</b><span>{o.count} reports in {o.window_minutes} min. Check the building first.</span></div>
            </motion.button>
          ))}
        </div>
      )}

      <div className="map-overlay map-legend">
        {[['P1', 'Urgent'], ['P2', 'High'], ['P3', 'Normal'], ['P4', 'Low']].map(([p, l]) => (
          <button type="button" key={p} className="legend-item" data-off={hidden.has(p) || undefined} aria-pressed={!hidden.has(p)}
            title={hidden.has(p) ? `Show ${l.toLowerCase()} reports` : `Hide ${l.toLowerCase()} reports`}
            style={{ '--k': priorityHex(p, theme) } as CSSProperties} onClick={() => toggle(p)}><i />{l}</button>
        ))}
        {!useGoogle && tilesFailed && <span className="legend-note">Map photos couldn't load (offline?), showing the drawn campus view</span>}
      </div>

      <AnimatePresence>
        {sel && <PinCard key={sel.id} p={sel} colour={colourOf(sel)} onClose={() => setSelected(null)} />}
      </AnimatePresence>
    </div>
  )
}

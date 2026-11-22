// Real Google map, locked to the campus, in a dark (AMOLED) style, with our own glowing pins.
// Needs VITE_GOOGLE_MAPS_KEY. VITE_GOOGLE_MAP_ID can point to your own cloud map style.
import { APIProvider, AdvancedMarker, Map, useMap, useApiLoadingStatus, APILoadingStatus } from '@vis.gl/react-google-maps'
import { useEffect, useMemo } from 'react'
import type { Building, Hotspot, MapPoint } from '../../api'
import { Pin, HotspotRing } from './Pin'
import { campusBounds, spread } from './geometry'
import { pointAt, useHovered } from '../../lib/store'

interface Props { apiKey: string; mapId?: string; dark: boolean; points: MapPoint[]; hotspots: Hotspot[]; buildings: Building[]
  centre: { lat: number; lng: number }; colourOf: (p: MapPoint) => string; hotColour: (h: Hotspot) => string
  selected: string | null; onSelect: (id: string | null) => void; onFail: () => void }

export function GoogleCampusMap(props: Props) {
  return <APIProvider apiKey={props.apiKey} libraries={['marker']}><Inner {...props} /></APIProvider>
}

function Inner({ mapId, dark, points, hotspots, buildings, centre, colourOf, hotColour, selected, onSelect, onFail }: Props) {
  const hovered = useHovered()
  const status = useApiLoadingStatus()
  useEffect(() => { if (status === APILoadingStatus.FAILED || status === APILoadingStatus.AUTH_FAILURE) onFail() }, [status, onFail])
  const bounds = useMemo(() => campusBounds(buildings), [buildings])
  const pts = useMemo(() => spread(points), [points])
  const byName = Object.fromEntries(buildings.map(b => [b.name, b]))

  return (
    <div className="gmap" data-dark={dark || undefined} data-styled={mapId ? true : undefined}>
      <Map mapId={mapId || 'DEMO_MAP_ID'} colorScheme={dark ? 'DARK' : 'LIGHT'} renderingType="VECTOR"
        defaultCenter={centre} defaultZoom={17} minZoom={16} maxZoom={20} defaultTilt={45} defaultHeading={-18}
        restriction={{ latLngBounds: bounds, strictBounds: false }} disableDefaultUI gestureHandling="greedy"
        clickableIcons={false} onClick={() => onSelect(null)} style={{ width: '100%', height: '100%' }}>
        <FlyTo selected={selected} points={points} />
        {hotspots.filter(h => h.is_hotspot && byName[h.building]).map(h => (
          <AdvancedMarker key={'h' + h.building} position={byName[h.building]} zIndex={1}>
            <HotspotRing colour={hotColour(h)} count={h.count} />
          </AdvancedMarker>
        ))}
        {pts.map(p => {
          const c = colourOf(p)
          return (
            <AdvancedMarker key={p.id} position={{ lat: p.plat, lng: p.plng }} zIndex={selected === p.id ? 30 : 10}
              title={`${p.number}: ${p.title}`} onClick={() => onSelect(p.id)}
              onMouseEnter={() => pointAt(p.id, c)} onMouseLeave={() => pointAt(null, null)}>
              <Pin colour={c} active={hovered === p.id || selected === p.id} urgent={p.priority === 'P1'} />
            </AdvancedMarker>
          )
        })}
      </Map>
    </div>
  )
}

// Glide the camera to the selected report.
function FlyTo({ selected, points }: { selected: string | null; points: MapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    const p = points.find(x => x.id === selected)
    if (map && p) { map.panTo({ lat: p.lat, lng: p.lng }); if ((map.getZoom() || 0) < 18) map.setZoom(18) }
  }, [map, selected, points])
  return null
}

// The real campus, no API key needed: satellite photos (Esri World Imagery) or a street map
// (OpenFreeMap), darkened to match the app, tilted, and locked to the campus. Uses MapLibre GL.
// Pins are the same React elements as everywhere else, placed with MapLibre markers.
// Admins can switch on "Move buildings" and drag a building's label onto its real roof.
import maplibregl, { type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Layers, Move, Satellite, Map as MapIcon, Check, Moon, Sun } from 'lucide-react'
import { setMapDark } from './tone'
import type { Building, Hotspot, MapPoint } from '../../api'
import { Pin, HotspotRing } from './Pin'
import { campusBounds, spread } from './geometry'
import { pointAt, useHovered } from '../../lib/store'

export type BaseLayer = 'satellite' | 'streets'
const LAYER_KEY = 'bits_next_map_layer_v2'   // v2: the dark street map became the default

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const ESRI_ROADS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'
const ESRI_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics'
// Street map: OpenFreeMap (OpenStreetMap data, no key, no sign-up). CARTO's tiles now need a key.
const STREETS = (dark: boolean) => `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`

// Satellite: the real photo, colour pulled down and highlights capped ("the actual thing, just
// darker"), with Esri's road overlay faint on top.
function satelliteStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    sources: {
      satellite: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: ESRI_ATTR },
      roads: { type: 'raster', tiles: [ESRI_ROADS], tileSize: 256, maxzoom: 19 },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': dark ? '#000000' : '#E9E7E2' } },
      { id: 'satellite', type: 'raster', source: 'satellite',
        paint: dark
          ? { 'raster-brightness-max': 0.5, 'raster-brightness-min': 0, 'raster-saturation': -0.45, 'raster-contrast': 0.18, 'raster-fade-duration': 250 }
          : { 'raster-brightness-max': 0.95, 'raster-saturation': -0.15, 'raster-fade-duration': 250 } },
      { id: 'roads', type: 'raster', source: 'roads', minzoom: 15,
        paint: { 'raster-opacity': dark ? 0.4 : 0.55, 'raster-saturation': -1, 'raster-brightness-max': dark ? 0.75 : 1, 'raster-fade-duration': 250 } },
    ],
  }
}
const styleFor = (dark: boolean, layer: BaseLayer) => (layer === 'satellite' ? satelliteStyle(dark) : STREETS(dark))
// Street style tweak, applied every time a style loads: true black under the map on AMOLED themes.
function blackBackground(map: maplibregl.Map, dark: boolean) {
  if (!dark) return
  for (const l of map.getStyle().layers) if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#000000')
}

interface Props {
  dark: boolean; points: MapPoint[]; hotspots: Hotspot[]; buildings: Building[]; centre: { lat: number; lng: number }
  colourOf: (p: MapPoint) => string; hotColour: (h: Hotspot) => string
  selected: string | null; onSelect: (id: string | null) => void; onFail: () => void
  canEdit?: boolean; onMoveBuilding?: (name: string, lat: number, lng: number) => Promise<void>
  cooperative?: boolean
}

export function RealCampusMap({ dark, points, hotspots, buildings, centre, colourOf, hotColour, selected, onSelect, onFail, canEdit, onMoveBuilding, cooperative }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<maplibregl.Map | null>(null)
  const [layer, setLayer] = useState<BaseLayer>(() => (localStorage.getItem(LAYER_KEY) as BaseLayer) || 'streets')
  const [editing, setEditing] = useState(false)
  const [zoom, setZoom] = useState(16.6)
  const hovered = useHovered()
  const bounds = useMemo(() => campusBounds(buildings, 0.006), [buildings])
  const pts = useMemo(() => spread(points), [points])
  const byName = useMemo(() => Object.fromEntries(buildings.map(b => [b.name, b])), [buildings])
  const failRef = useRef(onFail); failRef.current = onFail
  const darkRef = useRef(dark); darkRef.current = dark

  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect
  // Create the map once. Deferred by a tick so React's development double-mount doesn't
  // start (and then abort) a second map's tile downloads.
  useEffect(() => {
    if (!box.current) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    let m: maplibregl.Map | null = null
    let failTimer = 0
    const start = window.setTimeout(() => {
      if (!box.current) return
      m = new maplibregl.Map({
        container: box.current, style: styleFor(dark, layer), center: [centre.lng, centre.lat],
        zoom: 16.6, pitch: 52, bearing: -18, minZoom: 15, maxZoom: 19.6, maxPitch: 70,
        maxBounds: [[bounds.west, bounds.south], [bounds.east, bounds.north]],
        attributionControl: { compact: true }, fadeDuration: reduce ? 0 : 250,
        // Embedded maps let the page scroll: zoom with Ctrl/⌘ + scroll, or two fingers on a phone.
        cooperativeGestures: !!cooperative,
      })
      const map = m
      if (import.meta.env.DEV) (window as unknown as { __campusMap: maplibregl.Map }).__campusMap = map
      // If no tile ever arrives (offline, blocked), fall back to the drawn campus view.
      let gotTile = false, errors = 0
      map.on('sourcedata', e => { if (e.tile) gotTile = true })
      map.on('error', e => { errors++; if (import.meta.env.DEV) console.warn('[campus map]', e.error?.message || e) })
      failTimer = window.setTimeout(() => { if (!gotTile && errors > 0) failRef.current() }, 9000)
      map.on('style.load', () => blackBackground(map, darkRef.current))
      map.on('zoom', () => setZoom(map.getZoom()))
      map.on('click', () => onSelectRef.current(null))
      map.once('load', () => {
        if (!reduce) map.easeTo({ pitch: 56, bearing: -24, zoom: 16.9, duration: 2400, easing: t => 1 - Math.pow(1 - t, 3) })
      })
      setMap(map)   // pins can go on straight away; tiles stream in underneath
    }, 0)
    return () => { clearTimeout(start); clearTimeout(failTimer); m?.remove(); setMap(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // Theme or base layer changed: restyle in place (markers stay).
  const applied = useRef(`${dark}|${layer}`)
  useEffect(() => {
    try { localStorage.setItem(LAYER_KEY, layer) } catch { /* private mode */ }
    const key = `${dark}|${layer}`
    if (!map || applied.current === key) return
    applied.current = key
    map.setStyle(styleFor(dark, layer), { diff: false })
  }, [map, dark, layer])

  // Glide to the selected report.
  useEffect(() => {
    const p = pts.find(x => x.id === selected)
    if (map && p) map.flyTo({ center: [p.plng, p.plat], zoom: Math.max(map.getZoom(), 18.2), pitch: 58, speed: 0.9, curve: 1.3,
      padding: { bottom: 160, top: 0, left: 0, right: 0 }, essential: true })
  }, [map, selected, pts])

  const showLabels = zoom >= 16.2 || editing

  return (
    <div className="mlmap" data-dark={dark || undefined} data-layer={layer}>
      <div ref={box} className="mlmap-canvas" />
      <div className="mlmap-vignette" aria-hidden />
      {map && <>
        {hotspots.filter(h => h.is_hotspot && byName[h.building]).map(h => (
          <Marker key={'h' + h.building} map={map} lng={byName[h.building].lng} lat={byName[h.building].lat} z={1} passive>
            <HotspotRing colour={hotColour(h)} count={h.count} />
          </Marker>
        ))}
        {showLabels && buildings.map(b => (
          <Marker key={'b' + b.name} map={map} lng={b.lng} lat={b.lat} z={editing ? 40 : 2} draggable={editing}
            onDragEnd={(lat, lng) => onMoveBuilding?.(b.name, lat, lng)}>
            {editing
              ? <span className="bld-label" data-edit data-fixed={b.corrected || undefined}><Move size={11} />{shortName(b.name)}</span>
              : <button type="button" className="bld-label" title={`Zoom to ${b.name}`}
                  onClick={e => { e.stopPropagation(); map.flyTo({ center: [b.lng, b.lat], zoom: Math.max(map.getZoom(), 18.4), pitch: 58, speed: .9, essential: true }) }}>
                  {shortName(b.name)}</button>}
          </Marker>
        ))}
        {!editing && pts.map(p => {
          const c = colourOf(p)
          return (
            <Marker key={p.id} map={map} lng={p.plng} lat={p.plat} z={selected === p.id ? 30 : p.priority === 'P1' ? 12 : 10}>
              <button type="button" className="pin-btn" aria-label={`${p.number}: ${p.title}`} title={`${p.number}: ${p.title}`}
                onClick={e => { e.stopPropagation(); onSelect(p.id) }}
                onPointerEnter={() => pointAt(p.id, c)} onPointerLeave={() => pointAt(null, null)}
                onFocus={() => pointAt(p.id, c)} onBlur={() => pointAt(null, null)}>
                <Pin colour={c} active={hovered === p.id || selected === p.id} urgent={p.priority === 'P1'} />
              </button>
            </Marker>
          )
        })}
      </>}

      <div className="map-overlay mlmap-tools">
        <div className="seg glass glass-solid" role="group" aria-label="Base map">
          <button type="button" data-on={layer === 'streets' || undefined} onClick={() => setLayer('streets')} title="Street map">
            <MapIcon size={15} /><span>Map</span></button>
          <button type="button" data-on={layer === 'satellite' || undefined} onClick={() => setLayer('satellite')} title="Satellite photo">
            <Satellite size={15} /><span>Satellite</span></button>
        </div>
        <button type="button" className="tool glass glass-solid" onClick={() => setMapDark(!dark)} title={dark ? 'Light map' : 'Dark map'} aria-label={dark ? 'Switch to a light map' : 'Switch to a dark map'}>
          {dark ? <Sun size={15} /> : <Moon size={15} />}</button>
        {canEdit && (
          <button type="button" className={`tool glass glass-solid${editing ? ' on' : ''}`} onClick={() => { setEditing(v => !v); onSelect(null) }}
            title={editing ? 'Done moving buildings' : 'Drag building names onto their real roofs'}>
            {editing ? <Check size={15} /> : <Layers size={15} />}<span>{editing ? 'Done' : 'Move buildings'}</span>
          </button>
        )}
      </div>
      {editing && <div className="map-overlay mlmap-hint glass glass-solid">Drag each building name onto its roof. Each move is saved for everyone; new reports use the new spot.</div>}
    </div>
  )
}

const shortName = (n: string) => n.replace(/\s*\(.*\)$/, '')

// A React element pinned to a spot on the map.
function Marker({ map, lng, lat, z, passive, draggable, onDragEnd, children }: {
  map: maplibregl.Map; lng: number; lat: number; z: number; passive?: boolean; draggable?: boolean
  onDragEnd?: (lat: number, lng: number) => void; children: ReactNode }) {
  const [el] = useState(() => document.createElement('div'))
  const marker = useRef<maplibregl.Marker | null>(null)
  const dragEnd = useRef(onDragEnd); dragEnd.current = onDragEnd
  useEffect(() => {
    const m = new maplibregl.Marker({ element: el, anchor: 'center', draggable: !!draggable, pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
      .setLngLat([lng, lat]).addTo(map)
    m.on('dragend', () => { const p = m.getLngLat(); dragEnd.current?.(p.lat, p.lng) })
    marker.current = m
    return () => { m.remove(); marker.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, el, draggable])
  useEffect(() => { marker.current?.setLngLat([lng, lat]) }, [lng, lat])
  useEffect(() => {
    el.style.zIndex = String(z)
    el.style.pointerEvents = passive ? 'none' : 'auto'
  }, [el, z, passive])
  return createPortal(children, el)
}

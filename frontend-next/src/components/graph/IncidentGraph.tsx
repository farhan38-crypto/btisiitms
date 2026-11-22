// "How reports connect": a 3D force graph. Every report is a glowing node joined to its
// building and its service, so clusters (one building, one failing service) show up as clumps.
// Pointing at a node highlights the same report on the map (shared hover store), and clicking
// opens it. Open reports send small particles along their links.
import ForceGraph3D, { type ForceGraphMethods, type NodeObject, type LinkObject } from 'react-force-graph-3d'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReducedMotion } from 'motion/react'
import * as THREE from 'three'
import type { CampusMapData } from '../../api'
import type { Theme } from '../../lib/themes'
import { priorityHex } from '../../lib/themes'
import { pointAt, useHovered } from '../../lib/store'

type Kind = 'incident' | 'building' | 'service'
interface GNode { id: string; kind: Kind; label: string; colour: string; val: number; sub?: string }
interface GLink { source: string; target: string; colour: string; open: boolean }

const haloCache = new Map<string, THREE.Texture>()
function halo(colour: string) {
  if (haloCache.has(colour)) return haloCache.get(colour)!
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, colour); grd.addColorStop(0.25, colour + 'AA'); grd.addColorStop(1, colour + '00')
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64)
  const t = new THREE.CanvasTexture(c); haloCache.set(colour, t); return t
}

export default function IncidentGraph({ data, theme, height }: { data: CampusMapData; theme: Theme; height: number }) {
  const fg = useRef<ForceGraphMethods<NodeObject<GNode>, LinkObject<GNode, GLink>> | undefined>(undefined)
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const hovered = useHovered()
  const reduce = useReducedMotion()
  const navigate = useNavigate()
  const fitted = useRef(false)

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)))
    if (wrap.current) ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])

  const graph = useMemo(() => {
    const nodes: GNode[] = [], links: GLink[] = [], seen = new Set<string>()
    const add = (n: GNode) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n) } }
    for (const p of data.points) {
      const c = priorityHex(p.priority, theme)
      add({ id: p.id, kind: 'incident', label: `${p.number}: ${p.title}`, sub: p.location, colour: c, val: p.priority === 'P1' ? 5 : p.priority === 'P2' ? 3.5 : 2.4 })
      const open = !['RESOLVED', 'VERIFIED', 'CLOSED'].includes(p.status)
      if (p.building) { add({ id: 'b:' + p.building, kind: 'building', label: p.building, colour: theme.b, val: 7 }); links.push({ source: p.id, target: 'b:' + p.building, colour: theme.b, open }) }
      if (p.service_name) { add({ id: 's:' + p.service_name, kind: 'service', label: p.service_name, colour: theme.c || theme.a, val: 5 }); links.push({ source: p.id, target: 's:' + p.service_name, colour: theme.c || theme.a, open }) }
    }
    return { nodes, links }
  }, [data, theme])

  useEffect(() => {
    const g = fg.current
    if (!g) return
    const controls = g.controls() as { autoRotate?: boolean; autoRotateSpeed?: number; enableDamping?: boolean }
    controls.autoRotate = !reduce; controls.autoRotateSpeed = 0.7; controls.enableDamping = true
  }, [reduce, graph])

  const light = theme.scheme === 'light'
  return (
    <div ref={wrap} className="graph-wrap" style={{ height }}>
      {width > 0 && <ForceGraph3D
        ref={fg} width={width} height={height} graphData={graph} controlType="orbit"
        backgroundColor="rgba(0,0,0,0)" showNavInfo={false} nodeRelSize={2.6}
        nodeVal={(n: GNode) => n.val * (hovered === n.id ? 2.2 : 1)}
        nodeColor={(n: GNode) => (hovered && hovered !== n.id && n.kind === 'incident' ? n.colour + '55' : n.colour)}
        nodeOpacity={0.95} nodeResolution={20}
        nodeLabel={(n: GNode) => `<div class="g-tip"><b>${n.label}</b>${n.sub ? `<span>${n.sub}</span>` : ''}<em>${n.kind === 'incident' ? 'Report' : n.kind === 'building' ? 'Building' : 'Service'}</em></div>`}
        nodeThreeObjectExtend
        nodeThreeObject={(n: GNode) => {
          const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo(n.colour), transparent: true, depthWrite: false, blending: light ? THREE.NormalBlending : THREE.AdditiveBlending, opacity: light ? .35 : .9 }))
          const k = n.kind === 'incident' ? 16 : 22; s.scale.set(k, k, 1); return s
        }}
        linkColor={(l: GLink) => l.colour} linkOpacity={light ? 0.35 : 0.22} linkWidth={0.6}
        linkDirectionalParticles={(l: GLink) => (l.open && !reduce ? 2 : 0)} linkDirectionalParticleWidth={1.6}
        linkDirectionalParticleSpeed={0.006} linkDirectionalParticleColor={(l: GLink) => l.colour}
        cooldownTicks={120} warmupTicks={30}
        onEngineStop={() => { if (!fitted.current) { fitted.current = true; fg.current?.zoomToFit(800, 40) } }}
        onNodeHover={(n: GNode | null) => { pointAt(n?.kind === 'incident' ? n.id : null, n ? n.colour : null); if (wrap.current) wrap.current.style.cursor = n ? 'pointer' : 'grab' }}
        onNodeClick={(n: GNode) => navigate(n.kind === 'incident' ? `/incidents/${n.id}` : `/incidents?view=open&q=${encodeURIComponent(n.label)}`, { viewTransition: true })}
      />}
    </div>
  )
}

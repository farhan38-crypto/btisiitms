import type { Building, MapPoint } from '../../api'

// Several reports in one building would sit on top of each other, so they're fanned out in a
// small sunflower spiral around the building's pin.
export function spread(points: MapPoint[], metres = 9): (MapPoint & { plat: number; plng: number })[] {
  const seen: Record<string, number> = {}
  return points.map(p => {
    const key = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
    const i = seen[key] = (seen[key] ?? -1) + 1
    if (i === 0) return { ...p, plat: p.lat, plng: p.lng }
    const r = metres * Math.sqrt(i), a = i * 2.39996
    return { ...p, plat: p.lat + (r * Math.sin(a)) / 111320, plng: p.lng + (r * Math.cos(a)) / (111320 * Math.cos(p.lat * Math.PI / 180)) }
  })
}

export function campusBounds(buildings: Building[], pad = 0.0035) {
  const lats = buildings.map(b => b.lat), lngs = buildings.map(b => b.lng)
  return { north: Math.max(...lats) + pad, south: Math.min(...lats) - pad, east: Math.max(...lngs) + pad, west: Math.min(...lngs) - pad }
}

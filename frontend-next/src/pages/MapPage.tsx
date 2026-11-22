import { useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import type { CSSProperties } from 'react'
import { CampusMap, useCampusData } from '../components/map/CampusMap'
import { useAuth } from '../lib/auth'
import { priorityHex } from '../lib/themes'
import { pointAt, useHovered } from '../lib/store'

const RANK: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 }

export default function MapPage() {
  const [params, setParams] = useSearchParams()
  const focus = params.get('focus')
  const { data, buildings, moveBuilding } = useCampusData()
  const { theme } = useAuth()
  const hovered = useHovered()
  const list = (data?.points || []).slice().sort((a, b) => RANK[a.priority] - RANK[b.priority])
  return (
    <main className="map-page">
      <CampusMap data={data} buildings={buildings} focus={focus} className="map-full" onMoveBuilding={moveBuilding} />
      <motion.aside className="map-list glass glass-solid" initial={{ opacity: 0, x: 30, filter: 'blur(8px)' }} animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
        transition={{ delay: .2, type: 'spring', stiffness: 200, damping: 26 }}>
        <h2>On the map <span className="label tabular">{list.length}</span></h2>
        <ul>
          {list.map(p => {
            const c = priorityHex(p.priority, theme)
            return (
              <li key={p.id}>
                <button style={{ '--k': c } as CSSProperties} data-on={hovered === p.id || focus === p.id || undefined}
                  onPointerEnter={() => pointAt(p.id, c)} onPointerLeave={() => pointAt(null, null)}
                  onClick={() => setParams({ focus: p.id })}>
                  <i /><span><b>{p.title}</b><small>{p.number}, {p.building || p.location}</small></span>
                </button>
              </li>
            )
          })}
        </ul>
      </motion.aside>
    </main>
  )
}

import { motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { Navigation, ArrowUpRight, X } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { MapPoint } from '../../api'
import { directionsUrl } from '../../lib/geo'
import { timeAgo, statusLabel } from '../../lib/format'

// The glass card for the selected pin: what it is, where, and the two things a technician wants:
// open the report, or start walking there in Google Maps.
export function PinCard({ p, colour, onClose }: { p: MapPoint; colour: string; onClose: () => void }) {
  return (
    <motion.div className="pin-card glass glass-solid" key={p.id} style={{ '--k': colour } as CSSProperties}
      initial={{ opacity: 0, y: 18, scale: .96, filter: 'blur(8px)' }} animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: 12, scale: .97, filter: 'blur(6px)' }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
      <button className="pin-card-x" onClick={onClose} aria-label="Close"><X size={15} /></button>
      <div className="pin-card-top">
        <span className="chip" style={{ '--k': colour } as CSSProperties}><span className="dot" />{p.priority}</span>
        <span className="label tabular">{p.number}</span>
        <span className="label">{timeAgo(p.created_at)}</span>
      </div>
      <h3 className="pin-card-title">{p.title}</h3>
      <p className="pin-card-meta">{p.location || p.building}<br />{statusLabel(p.status)}{p.assigned_name ? `, with ${p.assigned_name}` : ', not assigned yet'}</p>
      <div className="pin-card-actions">
        <Link to={`/incidents/${p.id}`} viewTransition className="btn btn-primary"><ArrowUpRight size={16} />Open report</Link>
        <a className="btn" href={directionsUrl(p.lat, p.lng)} target="_blank" rel="noreferrer"><Navigation size={15} />Navigate</a>
      </div>
    </motion.div>
  )
}

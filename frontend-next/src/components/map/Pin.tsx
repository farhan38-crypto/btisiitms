// A glowing incident pin. The same element is used on the Google map (inside an
// AdvancedMarker) and on the offline campus view, so both look identical.
import type { CSSProperties } from 'react'

export function Pin({ colour, active, urgent, label, count }: { colour: string; active?: boolean; urgent?: boolean; label?: string; count?: number }) {
  return (
    <span className="pin" data-active={active || undefined} data-urgent={urgent || undefined} style={{ '--k': colour } as CSSProperties}>
      <i className="pin-ring" /><i className="pin-ring r2" />
      <span className="pin-core">{count && count > 1 ? count : ''}</span>
      {label && <span className="pin-label">{label}</span>}
    </span>
  )
}

export function HotspotRing({ colour, count }: { colour: string; count: number }) {
  const size = 70 + Math.min(count, 8) * 14
  return <span className="hotspot" style={{ '--k': colour, width: size, height: size } as CSSProperties} aria-hidden />
}

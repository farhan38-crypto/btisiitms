// Charts for the Material layout: one series per chart, thin marks, quiet axes, a dark
// tooltip pill on hover, and today highlighted. Colours come from the theme.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(600)
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e!.contentRect.width)))
    ro.observe(el); return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}
const niceMax = (v: number) => { if (v <= 5) return 5; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p }

export interface BarDatum { key: string; label: string; long: string; value: number }

/** Vertical bars, rounded at the data end, the last one (today) and the hovered one in the accent. */
export function BarChart({ data, unit, height = 220 }: { data: BarDatum[]; unit: [string, string]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const m = { t: 34, r: 4, b: 26, l: 30 }
  const iw = Math.max(10, w - m.l - m.r), ih = height - m.t - m.b
  const max = niceMax(Math.max(1, ...data.map(d => d.value)))
  const step = iw / Math.max(1, data.length)
  const bw = Math.max(3, Math.min(22, step * 0.46))
  const x = (i: number) => m.l + step * i + step / 2
  const y = (v: number) => m.t + ih - (v / max) * ih
  const ticks = [0, max / 2, max]
  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 58)))
  const last = data.length - 1
  const h = hover ?? null
  return (
    <div ref={ref} className="mbar" onPointerLeave={() => setHover(null)}>
      <svg width={w} height={height} role="img" aria-label={`${unit[1]} per day`}>
        <defs><linearGradient id="m-grad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style={{ stopColor: 'var(--b)' }} /><stop offset="1" style={{ stopColor: 'var(--a)' }} /></linearGradient></defs>
        {ticks.map(t => <g key={t}><line className="mgrid" x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} /><text className="maxis" x={m.l - 8} y={y(t) + 4} textAnchor="end">{t}</text></g>)}
        {data.map((d, i) => {
          const top = y(d.value), on = i === h || (h === null && i === last)
          return (
            <g key={d.key} onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} role="graphics-symbol" aria-label={`${d.long}: ${d.value} ${d.value === 1 ? unit[0] : unit[1]}`}>
              <rect x={x(i) - step / 2} y={m.t} width={step} height={ih} fill="transparent" />
              {d.value > 0 && <path className={on ? 'mbar-on' : 'mbar-off'} style={{ '--i': i } as CSSProperties} d={`M${x(i) - bw / 2},${m.t + ih} V${top + Math.min(4, bw / 2)} q0,-${Math.min(4, bw / 2)} ${Math.min(4, bw / 2)},-${Math.min(4, bw / 2)} H${x(i) + bw / 2 - Math.min(4, bw / 2)} q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, bw / 2)} V${m.t + ih} Z`} />}
              {(i % every === 0 && x(last) - x(i) >= 48) || i === last
                ? <text className="maxis" x={x(i)} y={height - 6} textAnchor="middle">{i === last ? 'Today' : d.label}</text> : null}
            </g>
          )
        })}
        <line className="mbase" x1={m.l} x2={m.l + iw} y1={m.t + ih} y2={m.t + ih} />
      </svg>
      {data.length > 0 && (() => {
        const i = h ?? last, d = data[i]!
        const left = Math.min(Math.max(x(i), 70), w - 70)
        return <div className="mtip" style={{ left, top: Math.max(0, y(d.value) - 44) }}><b className="tabular">{d.value}</b> {d.value === 1 ? unit[0] : unit[1]}<small>{i === last ? 'Today' : d.long}</small></div>
      })()}
    </div>
  )
}

/** A half-ring gauge: how much of the whole went well. */
export function Gauge({ value, label, size = 220 }: { value: number; label: string; size?: number }) {
  const r = size / 2 - 14, cx = size / 2, cy = size / 2
  const v = Math.max(0, Math.min(100, value))
  const arc = (from: number, to: number) => {
    const a0 = Math.PI * (1 - from / 100), a1 = Math.PI * (1 - to / 100)
    return `M${cx + r * Math.cos(a0)},${cy - r * Math.sin(a0)} A${r},${r} 0 0 1 ${cx + r * Math.cos(a1)},${cy - r * Math.sin(a1)}`
  }
  return (
    <svg className="mgauge" width={size} height={size / 2 + 12} viewBox={`0 0 ${size} ${size / 2 + 12}`} role="img" aria-label={`${label}: ${v}%`}>
      <path d={arc(0, 100)} className="mgauge-track" />
      {v > 0 && <path d={arc(0, v)} className="mgauge-fill" pathLength={100} />}
      <text x={cx} y={cy - 18} textAnchor="middle" className="mgauge-num">{Math.round(v)}%</text>
      <text x={cx} y={cy + 4} textAnchor="middle" className="mgauge-label">{label}</text>
    </svg>
  )
}

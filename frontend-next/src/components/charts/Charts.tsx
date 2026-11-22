// The overview's chart panel: four ways to look at the same reports.
//   Trend        reports created vs resolved per day (the standard service-desk chart)
//   Peak hours   weekday × hour heatmap of when reports come in
//   Buildings    open reports per building, split by priority
//   Connections  the 3D network of reports, buildings and services
// Range (7/14/30 days) and "Table" sit in one row above the chart and apply to every view.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LayoutGroup, motion, AnimatePresence } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, Grid3x3, Building2, Orbit, Table2, BarChart3 } from 'lucide-react'
import { api as API, useQuery } from '../../api'
import type { Theme } from '../../lib/themes'
import type { CampusMapData } from '../../api'
import { seriesColours, priorityColours, PRIORITY_NAME } from './palette'

const IncidentGraph = lazy(() => import('../graph/IncidentGraph'))

export interface Trends {
  days: number
  daily: { date: string; created: number; resolved: number; open: number }[]
  heatmap: number[][]
  buildings: { building: string; P1: number; P2: number; P3: number; P4: number; total: number }[]
}
type Kind = 'trend' | 'heat' | 'buildings' | 'network'
const KINDS: { key: Kind; label: string; icon: typeof TrendingUp; hint: string }[] = [
  { key: 'trend', label: 'Trend', icon: TrendingUp, hint: 'Reports created and resolved each day. When created stays above resolved, the backlog is growing.' },
  { key: 'heat', label: 'Peak hours', icon: Grid3x3, hint: 'When reports come in, by weekday and hour (campus time). Darker squares mean quieter hours.' },
  { key: 'buildings', label: 'Buildings', icon: Building2, hint: 'Open reports in each building, split by priority. Click a bar to see that building’s reports.' },
  { key: 'network', label: 'Connections', icon: Orbit, hint: 'Each glowing dot is a report, joined to its building and service. Clumps mean one place or one service is failing. Drag to turn it; click a dot to open it.' },
]
const KEY = 'bits_next_chart'
const RANGES = [7, 14, 30]

export function ChartPanel({ theme, mapData, compact }: { theme: Theme; mapData: CampusMapData | null; compact?: boolean }) {
  const [kind, setKind] = useState<Kind>(() => (localStorage.getItem(KEY) as Kind) || 'trend')
  const [days, setDays] = useState(14)
  const [table, setTable] = useState(false)
  const { data } = useQuery<Trends>(`trends:${days}`, () => API.reports.trends(days))
  useEffect(() => { try { localStorage.setItem(KEY, kind) } catch { /* private mode */ } }, [kind])
  const k = KINDS.find(x => x.key === kind)!
  const timeBased = kind === 'trend' || kind === 'heat'

  return (
    <div className={`charts${compact ? ' charts-compact' : ''}`}>
      <div className="chart-bar">
        <LayoutGroup id="chart-kind">
          <div className="seg glass chart-kinds" role="tablist" aria-label="Chart">
            {KINDS.map(({ key, label, icon: Icon }) => (
              <button key={key} role="tab" aria-selected={kind === key} data-on={kind === key || undefined} onClick={() => setKind(key)}>
                {kind === key && <motion.span layoutId="chart-pill" className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <span className="seg-in"><Icon size={15} />{label}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
        <div className="chart-opts">
          {timeBased && (
            <div className="seg glass" role="group" aria-label="Days shown">
              {RANGES.map(r => <button key={r} data-on={days === r || undefined} aria-pressed={days === r} onClick={() => setDays(r)}><span>{compact ? `${r}d` : `${r} days`}</span></button>)}
            </div>
          )}
          {kind !== 'network' && (
            <button className={`btn chart-table${table ? ' on' : ''}`} aria-pressed={table} onClick={() => setTable(v => !v)}
              title={table ? 'Show the chart' : 'Show the numbers as a table'}>
              {table ? <BarChart3 size={15} /> : <Table2 size={15} />}{table ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </div>
      {!compact && <p className="chart-hint">{k.hint}</p>}
      <AnimatePresence mode="wait">
        <motion.div key={kind + (table ? '-t' : '')} className="chart-stage" initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }} transition={{ duration: .3, ease: [0.22, 1, 0.36, 1] }}>
          {kind === 'network'
            ? (mapData ? <Suspense fallback={<div className="graph-wait" />}><IncidentGraph data={mapData} theme={theme} height={compact ? 168 : 420} /></Suspense> : <div className="graph-wait" />)
            : !data ? <div className="graph-wait" />
            : table ? <ChartTable kind={kind} data={data} />
            : kind === 'trend' ? <TrendChart data={data} theme={theme} h={compact ? 330 : 300} />
            : kind === 'heat' ? <HeatChart data={data} theme={theme} />
            : <BuildingChart data={data} theme={theme} limit={compact ? 4 : 9} />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ── helpers ──
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}
const niceMax = (v: number) => { if (v <= 4) return 4; const step = Math.pow(10, Math.floor(Math.log10(v))); const n = Math.ceil(v / step); return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * step }
const dayLabel = (iso: string, long = false) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' })
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function Tip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  const left = Math.min(Math.max(x + 14, 0), w - 190)
  return <div className="chart-tip glass glass-solid" style={{ left, top: Math.max(y - 10, 0) }}>{children}</div>
}
const TipRow = ({ colour, value, name, line = true }: { colour?: string; value: ReactNode; name: string; line?: boolean }) => (
  <div className="tip-row">{colour && <i className={line ? 'k-line' : 'k-box'} style={{ background: colour }} />}<b className="tabular">{value}</b><span>{name}</span></div>
)
const Legend = ({ items, line }: { items: [string, string][]; line?: boolean }) => (
  <div className="chart-legend">{items.map(([name, c]) => <span key={name}><i className={line ? 'k-line' : 'k-box'} style={{ background: c }} />{name}</span>)}</div>
)

// ── Trend: created vs resolved per day ──
function TrendChart({ data, theme, h = 300 }: { data: Trends; theme: Theme; h?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const [c0, c1] = seriesColours(theme)
  const H = h, m = { t: 16, r: 72, b: 30, l: 34 }
  const rows = data.daily
  const max = niceMax(Math.max(1, ...rows.map(r => Math.max(r.created, r.resolved))))
  const iw = Math.max(w - m.l - m.r, 10), ih = H - m.t - m.b
  const x = (i: number) => m.l + (rows.length < 2 ? 0 : (i / (rows.length - 1)) * iw)
  const y = (v: number) => m.t + ih - (v / max) * ih
  const path = (key: 'created' | 'resolved') => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r[key]).toFixed(1)}`).join('')
  const area = `${path('created')}L${x(rows.length - 1)},${y(0)}L${x(0)},${y(0)}Z`
  const ticks = [0, max / 2, max]
  const every = Math.ceil(rows.length / Math.max(2, Math.floor(iw / 70)))
  const last = rows.length - 1
  const move = (e: React.PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left - m.l) / iw) * last)
    setHover(Math.max(0, Math.min(last, i)))
  }
  const lab = (v: number, other: number) => (Math.abs(y(v) - y(other)) < 14 ? (v >= other ? -7 : 7) : 0)
  return (
    <div ref={ref} className="chart-box">
      <Legend line items={[['Created', c0], ['Resolved', c1]]} />
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label={`Reports created and resolved per day over the last ${rows.length} days`}
          onPointerMove={move} onPointerLeave={() => setHover(null)}>
          {ticks.map(t => <g key={t}><line className="grid" x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} /><text className="axis" x={m.l - 8} y={y(t) + 4} textAnchor="end">{t}</text></g>)}
          {rows.map((r, i) => (i % every === 0 && x(last) - x(i) >= 52) || i === last ? <text key={r.date} className="axis" x={x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}>{i === last ? 'Today' : dayLabel(r.date)}</text> : null)}
          <path d={area} fill={c0} opacity={0.1} />
          <motion.path d={path('resolved')} fill="none" stroke={c1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .9, ease: [0.22, 1, 0.36, 1] }} />
          <motion.path d={path('created')} fill="none" stroke={c0} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: .9, ease: [0.22, 1, 0.36, 1] }} />
          {/* end labels: value + name at the last point */}
          {(['created', 'resolved'] as const).map((k, j) => {
            const v = rows[last][k], o = rows[last][k === 'created' ? 'resolved' : 'created']
            return <g key={k}>
              <circle cx={x(last)} cy={y(v)} r={4} fill={j ? c1 : c0} stroke="var(--chart-surface)" strokeWidth={2} />
              <text className="end-label" x={x(last) + 10} y={y(v) + 4 + lab(v, o)}><tspan className="tabular">{v}</tspan> {k}</text>
            </g>
          })}
          {hover !== null && <g>
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} />
            {(['created', 'resolved'] as const).map((k, j) => <circle key={k} cx={x(hover)} cy={y(rows[hover][k])} r={4.5} fill={j ? c1 : c0} stroke="var(--chart-surface)" strokeWidth={2} />)}
          </g>}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <Tip x={x(hover)} y={m.t} w={w}>
          <div className="tip-head">{dayLabel(rows[hover].date, true)}</div>
          <TipRow colour={c0} value={rows[hover].created} name="created" />
          <TipRow colour={c1} value={rows[hover].resolved} name="resolved" />
          <TipRow value={rows[hover].open} name="still open that evening" />
        </Tip>
      )}
    </div>
  )
}

// ── Peak hours: weekday × hour heatmap (one hue, quiet → busy) ──
function HeatChart({ data, theme }: { data: Trends; theme: Theme }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<[number, number] | null>(null)
  const [c0] = seriesColours(theme)
  const max = Math.max(1, ...data.heatmap.flat())
  const left = 40, top = 6, gap = 3
  const cell = Math.max(10, Math.min(30, Math.floor((w - left - 4) / 24) - gap))
  const H = top + 7 * (cell + gap) + 26
  // five steps of the same hue, mixed into the panel colour; zero stays an empty outline
  const fill = (v: number) => v === 0 ? 'transparent' : `color-mix(in oklab, ${c0} ${[22, 42, 62, 82, 100][Math.min(4, Math.floor((v / max) * 4.999))]}%, var(--chart-surface))`
  const busiest = useMemo(() => {
    let best = [0, 0, 0]
    data.heatmap.forEach((row, d) => row.forEach((v, h) => { if (v > best[0]) best = [v, d, h] }))
    return best
  }, [data])
  const hr = (h: number) => `${String(h).padStart(2, '0')}:00`
  return (
    <div ref={ref} className="chart-box">
      <div className="chart-legend">
        <span>Fewer</span>{[22, 42, 62, 82, 100].map(p => <i key={p} className="k-box" style={{ background: `color-mix(in oklab, ${c0} ${p}%, var(--chart-surface))` }} />)}<span>More</span>
        {busiest[0] > 0 && <span className="legend-note">Busiest: {WEEK[busiest[1]]} {hr(busiest[2])}, {busiest[0]} {busiest[0] === 1 ? 'report' : 'reports'}</span>}
      </div>
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Reports by weekday and hour" onPointerLeave={() => setHover(null)}>
          {WEEK.map((d, di) => <text key={d} className="axis" x={left - 8} y={top + di * (cell + gap) + cell / 2 + 4} textAnchor="end">{d}</text>)}
          {[0, 6, 12, 18, 23].map(h => <text key={h} className="axis" x={left + h * (cell + gap) + cell / 2} y={H - 6} textAnchor="middle">{hr(h)}</text>)}
          {data.heatmap.map((row, di) => row.map((v, h) => (
            <motion.rect key={`${di}-${h}`} x={left + h * (cell + gap)} y={top + di * (cell + gap)} width={cell} height={cell} rx={4}
              fill={fill(v)} stroke={v === 0 ? 'var(--chart-grid)' : 'none'} className="heat-cell" data-on={hover && hover[0] === di && hover[1] === h || undefined}
              initial={{ opacity: 0, scale: .6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: (di * 24 + h) * 0.0025, duration: .3 }}
              onPointerEnter={() => setHover([di, h])} />
          )))}
        </svg>
      )}
      {hover && w > 0 && (
        <Tip x={left + hover[1] * (cell + gap) + cell} y={top + hover[0] * (cell + gap)} w={w}>
          <div className="tip-head">{WEEK[hover[0]]}, {hr(hover[1])}–{hr((hover[1] + 1) % 24)}</div>
          <TipRow colour={c0} line={false} value={data.heatmap[hover[0]][hover[1]]} name={data.heatmap[hover[0]][hover[1]] === 1 ? 'report' : 'reports'} />
        </Tip>
      )}
    </div>
  )
}

// ── Buildings: open reports per building, stacked by priority ──
function BuildingChart({ data, theme, limit = 9 }: { data: Trends; theme: Theme; limit?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const navigate = useNavigate()
  const [hover, setHover] = useState<{ b: number; p: string; x: number; y: number } | null>(null)
  const pc = priorityColours(theme)
  const rows = data.buildings.slice(0, limit)
  const labelW = Math.min(150, Math.max(90, w * 0.22)), bar = 20, rowH = 34, gap = 2
  const max = Math.max(1, ...rows.map(r => r.total))
  const scale = (w - labelW - 44) / max
  const H = rows.length * rowH + 6
  const P = ['P1', 'P2', 'P3', 'P4'] as const
  if (!rows.length) return <div className="empty-chart">No open reports right now.</div>
  return (
    <div ref={ref} className="chart-box">
      <Legend items={P.map(p => [PRIORITY_NAME[p], pc[p]] as [string, string])} />
      {w > 0 && (
        <svg width={w} height={H} role="img" aria-label="Open reports per building, by priority">
          {rows.map((r, bi) => {
            let at = labelW
            const segs = P.filter(p => r[p] > 0)
            const y = bi * rowH + (rowH - bar) / 2
            const go = () => navigate(`/incidents?view=open&q=${encodeURIComponent(r.building)}`, { viewTransition: true })
            return (
              <g key={r.building} className="bar-row" role="link" tabIndex={0} aria-label={`${r.building}: ${r.total} open. Show its reports`}
                onClick={go} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } }}>
                <rect x={0} y={bi * rowH} width={w} height={rowH} fill="transparent" />
                <text className="axis bar-name" x={labelW - 10} y={y + bar / 2 + 4} textAnchor="end">{r.building.replace(/\s*\(.*\)$/, '')}</text>
                {segs.map((p, si) => {
                  const len = r[p] * scale - (si < segs.length - 1 ? gap : 0)
                  const x0 = at; at += r[p] * scale
                  const lastSeg = si === segs.length - 1
                  // square at the baseline, 4px rounded only at the data end
                  const d = lastSeg
                    ? `M${x0},${y}H${x0 + len - 4}Q${x0 + len},${y} ${x0 + len},${y + 4}V${y + bar - 4}Q${x0 + len},${y + bar} ${x0 + len - 4},${y + bar}H${x0}Z`
                    : `M${x0},${y}H${x0 + len}V${y + bar}H${x0}Z`
                  return <motion.path key={p} d={d} fill={pc[p]} className="bar-seg" data-on={hover?.b === bi && hover.p === p || undefined}
                    initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: bi * 0.04 + si * 0.03, duration: .4 }}
                    onPointerEnter={() => setHover({ b: bi, p, x: x0 + len, y })} onPointerLeave={() => setHover(null)} />
                })}
                <text className="end-label tabular" x={labelW + r.total * scale + 8} y={y + bar / 2 + 4}>{r.total}</text>
              </g>
            )
          })}
        </svg>
      )}
      {hover && w > 0 && (
        <Tip x={hover.x} y={hover.y} w={w}>
          <div className="tip-head">{rows[hover.b].building}</div>
          {P.filter(p => rows[hover.b][p] > 0).map(p => <TipRow key={p} line={false} colour={pc[p]} value={rows[hover.b][p]} name={PRIORITY_NAME[p].toLowerCase()} />)}
          <div className="tip-foot">Click to see these reports</div>
        </Tip>
      )}
    </div>
  )
}

// ── The same numbers as a table (for screen readers, printing, or just reading) ──
function ChartTable({ kind, data }: { kind: Kind; data: Trends }) {
  if (kind === 'trend') return (
    <div className="chart-table-wrap"><table className="data-table"><thead><tr><th>Day</th><th>Created</th><th>Resolved</th><th>Still open that evening</th></tr></thead>
      <tbody>{data.daily.slice().reverse().map(r => <tr key={r.date}><td>{dayLabel(r.date, true)}</td><td className="tabular">{r.created}</td><td className="tabular">{r.resolved}</td><td className="tabular">{r.open}</td></tr>)}</tbody></table></div>
  )
  if (kind === 'heat') return (
    <div className="chart-table-wrap"><table className="data-table heat-table"><thead><tr><th>Hour</th>{WEEK.map(d => <th key={d}>{d}</th>)}</tr></thead>
      <tbody>{Array.from({ length: 24 }, (_, h) => <tr key={h}><td className="tabular">{String(h).padStart(2, '0')}:00</td>{WEEK.map((_, d) => <td key={d} className="tabular">{data.heatmap[d][h] || ''}</td>)}</tr>)}</tbody></table></div>
  )
  return (
    <div className="chart-table-wrap"><table className="data-table"><thead><tr><th>Building</th><th>Urgent</th><th>High</th><th>Normal</th><th>Low</th><th>Total open</th></tr></thead>
      <tbody>{data.buildings.map(r => <tr key={r.building}><td>{r.building}</td><td className="tabular">{r.P1}</td><td className="tabular">{r.P2}</td><td className="tabular">{r.P3}</td><td className="tabular">{r.P4}</td><td className="tabular"><b>{r.total}</b></td></tr>)}</tbody></table></div>
  )
}


// Incidents. Staff work in a list beside a detail pane, like an inbox: click (or j/k) to read,
// Enter opens the full page. Board and table layouts sit one click away. Views and filters
// live in the URL. Reporters see their own reports as tracker cards.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Columns3, Inbox, LayoutList, Plus, Rows3, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth, isStaff } from '../../lib/auth'
import { useLayout } from '../../lib/layout'
import { useIsPhone } from '../../lib/media'
import { plural } from '../../lib/format'
import { Empty, Kbd, Segmented, Select, Skeleton } from '../../ui/Controls'
import { IncidentView } from '../incident/IncidentView'
import { useIncidentList, viewsFor, sortIncidents, type SortKey, type ViewKey } from './data'
import { FilterBar, FILTER_KEYS, toServer, type FilterState } from './Filters'
import { Board, IncidentRow, Table, sortTable, type Col } from './Rows'
import { ReportCard } from '../home/StudentHome'

type Layout = 'list' | 'board' | 'table'
const LAYOUT_KEY = 'bits-incident-layout'

export default function IncidentsPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const phone = useIsPhone()
  const staff = isStaff(user)
  const views = useMemo(() => (user ? viewsFor(user) : []), [user])
  const viewKey = (params.get('view') as ViewKey) || 'open'
  const view = views.find(v => v.key === viewKey) || views[0]!
  const filters: FilterState = Object.fromEntries(FILTER_KEYS.map(k => [k, params.get(k) || undefined]))
  const q = params.get('q') || ''
  const sel = params.get('sel')
  const screenLayout = useLayout()
  const [layout, setLayoutState] = useState<Layout>(() => (params.get('layout') as Layout) || (localStorage.getItem(LAYOUT_KEY) as Layout) || 'list')
  const setLayout = (l: Layout) => { setLayoutState(l); try { localStorage.setItem(LAYOUT_KEY, l) } catch { /* ignore */ } }
  const [sort, setSort] = useState<SortKey>('smart')
  const [tsort, setTsort] = useState<{ col: Col; dir: 1 | -1 }>({ col: 'created', dir: -1 })
  const [qText, setQText] = useState(q)
  useEffect(() => setQText(q), [q])

  const update = useCallback((patch: Record<string, string | undefined | null>, replace = true) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    setParams(next, { replace })
  }, [params, setParams])
  // Search the server a moment after typing stops.
  useEffect(() => { const t = window.setTimeout(() => { if (qText !== q) update({ q: qText || null, sel: null }) }, 300); return () => window.clearTimeout(t) }, [qText]) // eslint-disable-line react-hooks/exhaustive-deps

  const server = { ...(view.server || {}), ...toServer(filters), ...(q ? { q } : {}) }
  const { data, loading, error } = useIncidentList(server)
  const list = useMemo(() => {
    const kept = (data || []).filter(i => !view.keep || view.keep(i))
    return layout === 'table' ? sortTable(kept, tsort.col, tsort.dir) : sortIncidents(kept, sort)
  }, [data, view, sort, layout, tsort])
  const counts = useMemo(() => Object.fromEntries(views.map(v => [v.key, v.server ? undefined : (data || []).filter(i => !v.keep || v.keep(i)).length])), [views, data])

  const peek = staff && !phone && layout !== 'table' && window.innerWidth >= 1100
  const select = (id: string) => (peek ? update({ sel: id }) : navigate(`/incidents/${id}`))
  // Keyboard: j/k or ↑/↓ to move, Enter to open, Esc to close the pane.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!staff || layout === 'board') return
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable], [role=dialog]') || e.metaKey || e.ctrlKey || e.altKey) return
      const idx = list.findIndex(i => i.id === sel)
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); const n = list[Math.min(list.length - 1, idx + 1)]; if (n) update({ sel: n.id }) }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); const n = list[Math.max(0, idx - 1)]; if (n) update({ sel: n.id }) }
      else if (e.key === 'Enter' && sel) { e.preventDefault(); navigate(`/incidents/${sel}`) }
      else if (e.key === 'Escape' && sel) update({ sel: null })
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [staff, layout, list, sel, update, navigate])
  useEffect(() => { listRef.current?.querySelector('[data-sel]')?.scrollIntoView({ block: 'nearest' }) }, [sel])
  // The detail pane is never empty: with nothing chosen (or the choice filtered away), show the first incident.
  useEffect(() => {
    if (screenLayout === 'classic' || !peek || layout !== 'list' || !list.length) return
    if (!sel || !list.some(i => i.id === sel)) update({ sel: list[0]!.id })
  }, [screenLayout, peek, layout, list, sel]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null
  const title = staff ? 'Incidents' : 'My reports'
  const filtered = Object.values(filters).some(Boolean) || !!q

  return (
    <main className={`page page-wide incidents ${peek && layout === 'list' ? 'has-peek' : ''}`}>
      <header className="page-head">
        <div style={{ viewTransitionName: 'focus-card' }}>
          <h1>{title}</h1>
          <p>{loading ? 'Loading…' : `${plural(list.length, staff ? 'incident' : 'report')}${filtered ? ' match' : ''} in “${view.label}”.`}
            {staff && !phone && layout === 'list' && <span className="hint"> <Kbd>j</Kbd><Kbd>k</Kbd> to move, <Kbd>↵</Kbd> to open</span>}</p>
        </div>
        {!staff && <Link to="/incidents/new" viewTransition className="btn btn-primary"><Plus size={16} />Report a problem</Link>}
      </header>

      <div className="views-bar">
        <Segmented value={view.key} onChange={k => update({ view: k, sel: null })} label="Views" className="views"
          options={views.map(v => ({ value: v.key, label: v.label, count: counts[v.key] }))} />
      </div>

      <div className="toolbar">
        <label className="search-field"><Search size={16} />
          <input value={qText} onChange={e => setQText(e.target.value)} placeholder={staff ? 'Search number, title, place, reporter, student ID' : 'Search your reports'} aria-label="Search" />
          {qText && <button type="button" onClick={() => { setQText(''); update({ q: null }) }} aria-label="Clear search"><X size={14} /></button>}
        </label>
        <FilterBar value={filters} onChange={f => update({ ...Object.fromEntries(FILTER_KEYS.map(k => [k, f[k] || null])), sel: null })} user={user} />
        <span className="toolbar-end">
          {layout !== 'table' && <Select value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Sort" className="sm">
            <option value="smart">Needs attention first</option><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="priority">Priority</option><option value="due">SLA due soonest</option>
          </Select>}
          {staff && !phone && <Segmented size="sm" value={layout} onChange={setLayout} label="Layout" options={[
            { value: 'list', label: <span className="sr">List</span>, icon: <LayoutList size={15} /> },
            { value: 'board', label: <span className="sr">Board</span>, icon: <Columns3 size={15} /> },
            { value: 'table', label: <span className="sr">Table</span>, icon: <Rows3 size={15} /> }]} />}
        </span>
      </div>

      {error && !data ? <Empty title="Couldn’t load incidents">{(error as Error).message}</Empty>
        : loading ? <div className="ilist">{[0, 1, 2, 3, 4].map(k => <Skeleton key={k} h={62} r={14} />)}</div>
        : !list.length ? (
          <Empty icon={<Inbox size={22} />} title={filtered ? 'Nothing matches these filters' : staff ? `No incidents in “${view.label}”` : 'No reports here'}
            action={filtered ? <button className="btn" onClick={() => setParams({ view: view.key })}>Clear filters</button>
              : !staff ? <Link to="/incidents/new" className="btn btn-primary"><Plus size={16} />Report a problem</Link> : undefined}>
            {filtered ? 'Try removing a filter or searching for something else.' : staff ? 'Quiet campus. Check another view, or enjoy it.' : 'When you report a problem it appears here, and you can follow it live.'}
          </Empty>
        )
        : !staff ? <div className="cards">{list.map(i => <ReportCard key={i.id} i={i} />)}</div>
        : layout === 'board' ? <Board list={list} selected={sel} onSelect={id => navigate(`/incidents/${id}`)} />
        : layout === 'table' ? <Table list={list} sort={tsort} onSort={c => setTsort(s => ({ col: c, dir: s.col === c ? (s.dir === 1 ? -1 : 1) : c === 'created' ? -1 : 1 }))} selected={sel} onSelect={id => navigate(`/incidents/${id}`)} />
        : (
          <div className="split">
            <div className="ilist surface" ref={listRef} role="list">
              {list.map(i => <IncidentRow key={i.id} i={i} selected={sel === i.id} onSelect={peek ? e => { e.preventDefault(); select(i.id) } : undefined} />)}
            </div>
            {peek && (
              <section className="peek surface" aria-label="Incident details">
                <AnimatePresence mode="wait" initial={false}>
                  {sel ? (
                    <motion.div key={sel} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: .22, ease: [0.22, 1, 0.36, 1] }}>
                      <button type="button" className="icon-btn ghost peek-x" onClick={() => update({ sel: null })} aria-label="Close"><X size={16} /></button>
                      <IncidentView id={sel} variant="peek" />
                    </motion.div>
                  ) : (
                    <motion.div key="none" className="peek-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <Empty icon={<LayoutList size={22} />} title="Pick an incident to read it here">
                        Click a row, or press <Kbd>j</Kbd> to start at the top. <Kbd>↵</Kbd> opens the full page.
                      </Empty>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            )}
          </div>
        )}
    </main>
  )
}

// How an incident looks in lists: a dense row (list and peek layout), a board card, a table.
import { forwardRef, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, Navigation, MapPin } from 'lucide-react'
import { OPEN_STATUSES, type Incident } from '../../api'
import { STATUS_SHORT, timeAgo } from '../../lib/format'
import { pointAt } from '../../lib/store'
import { Avatar } from '../../ui/Controls'
import { PriorityBadge, PriorityMark, SlaBadge, StatusBadge, StatusIcon, pVar } from '../../ui/Badges'

const place = (i: Incident) => i.location.hostel_name || i.location.academic_block || (i.location.type === 'online' ? 'Online' : i.location.formatted)

export const IncidentRow = forwardRef<HTMLAnchorElement, { i: Incident; selected?: boolean; onSelect?: (e: React.MouseEvent) => void; showAssignee?: boolean }>(
  function IncidentRow({ i, selected, onSelect, showAssignee = true }, ref) {
    const open = OPEN_STATUSES.includes(i.status)
    return (
      <Link ref={ref} to={`/incidents/${i.id}`} viewTransition={!onSelect} className="irow" data-sel={selected || undefined} data-closed={!open || undefined}
        aria-current={selected || undefined} onClick={onSelect} style={{ ['--k' as string]: pVar(i.priority) } as CSSProperties}
        onPointerEnter={() => pointAt(i.id, null)} onPointerLeave={() => pointAt(null, null)}>
        <span className="irow-p"><PriorityMark p={i.priority} /></span>
        <span className="irow-main">
          <span className="irow-line"><em className="tabular">{i.number}</em><b>{i.title}</b></span>
          <span className="irow-sub">
            <StatusIcon s={i.status} size={12} /><span>{STATUS_SHORT[i.status]}</span>
            <span className="sep" /><span>{place(i)}</span>
            {i.field_visit?.status === 'EN_ROUTE' && !i.field_visit.arrived_at && open && <span className="irow-flag"><Navigation size={11} />on the way</span>}
            {i.field_visit?.arrived_at && open && <span className="irow-flag"><MapPin size={11} />on site</span>}
          </span>
        </span>
        <span className="irow-end">
          {open ? <SlaBadge sla={i.sla} compact /> : <small className="muted">{timeAgo(i.resolution?.resolved_at || i.updated_at)}</small>}
          <span className="irow-who">
            {showAssignee && (i.assigned_name ? <span title={i.assigned_name}><Avatar name={i.assigned_name} size={20} /></span> : <span className="avatar-empty" title="Unassigned" />)}
            <small className="tabular">{timeAgo(i.created_at).replace(' ago', '')}</small>
          </span>
        </span>
      </Link>
    )
  })

// ───── board ─────
const COLUMNS = [
  { key: 'new', label: 'Unassigned', statuses: ['NEW', 'CLASSIFIED'] },
  { key: 'assigned', label: 'Assigned', statuses: ['ASSIGNED', 'ACKNOWLEDGED'] },
  { key: 'work', label: 'In progress', statuses: ['IN_PROGRESS', 'PENDING_INFO'] },
  { key: 'resolved', label: 'Resolved', statuses: ['RESOLVED', 'VERIFIED'] },
  { key: 'closed', label: 'Closed', statuses: ['CLOSED'] },
] as const
export function Board({ list, selected, onSelect }: { list: Incident[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="board">
      {COLUMNS.map(c => {
        const items = list.filter(i => (c.statuses as readonly string[]).includes(i.status))
        return (
          <section key={c.key} className="board-col">
            <header><StatusIcon s={c.statuses[0] === 'NEW' ? 'CLASSIFIED' : c.statuses[0]} /><h3>{c.label}</h3><span className="tabular">{items.length}</span></header>
            <div className="board-cards">
              {items.slice(0, 60).map(i => (
                <button type="button" key={i.id} className="bcard" data-sel={selected === i.id || undefined} onClick={() => onSelect(i.id)} style={{ ['--k' as string]: pVar(i.priority) }}>
                  <span className="bcard-top"><em className="tabular">{i.number}</em><PriorityBadge p={i.priority} /></span>
                  <b>{i.title}</b>
                  <span className="bcard-foot"><span>{place(i)}</span>{OPEN_STATUSES.includes(i.status) && <SlaBadge sla={i.sla} compact />}
                    {i.assigned_name && <Avatar name={i.assigned_name} size={20} />}</span>
                </button>
              ))}
              {items.length > 60 && <p className="muted small">+{items.length - 60} more: use filters to narrow down.</p>}
              {!items.length && <p className="board-empty">Nothing here</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// ───── table ─────
export type Col = 'number' | 'title' | 'priority' | 'status' | 'place' | 'assignee' | 'sla' | 'created'
export function Table({ list, sort, onSort, selected, onSelect }: { list: Incident[]; sort: { col: Col; dir: 1 | -1 }; onSort: (c: Col) => void; selected: string | null; onSelect: (id: string) => void }) {
  const head = (c: Col, label: string) => (
    <th aria-sort={sort.col === c ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => onSort(c)}>{label}{sort.col === c && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button>
    </th>
  )
  return (
    <div className="table-wrap">
      <table className="itable">
        <thead><tr>{head('number', 'ID')}{head('title', 'Title')}{head('priority', 'Priority')}{head('status', 'Status')}{head('place', 'Where')}{head('assignee', 'Assignee')}{head('sla', 'SLA')}{head('created', 'Reported')}</tr></thead>
        <tbody>
          {list.map(i => (
            <tr key={i.id} data-sel={selected === i.id || undefined} onClick={() => onSelect(i.id)} style={{ ['--k' as string]: pVar(i.priority) }}>
              <td className="tabular muted">{i.number}</td>
              <td><Link to={`/incidents/${i.id}`} onClick={e => e.stopPropagation()} className="itable-title">{i.title}</Link></td>
              <td><PriorityBadge p={i.priority} /></td>
              <td><StatusBadge s={i.status} /></td>
              <td>{place(i)}</td>
              <td>{i.assigned_name || <span className="muted">—</span>}</td>
              <td>{OPEN_STATUSES.includes(i.status) ? <SlaBadge sla={i.sla} compact /> : <span className="muted small">{i.sla?.status === 'MET' ? 'Met' : i.sla?.status === 'BREACHED' ? 'Late' : '—'}</span>}</td>
              <td className="muted small">{timeAgo(i.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export function sortTable(list: Incident[], col: Col, dir: 1 | -1) {
  const v = (i: Incident): string | number => col === 'number' ? i.number : col === 'title' ? i.title.toLowerCase() : col === 'priority' ? i.priority
    : col === 'status' ? OPEN_STATUSES.indexOf(i.status) === -1 ? 99 : OPEN_STATUSES.indexOf(i.status) : col === 'place' ? place(i) : col === 'assignee' ? i.assigned_name || '~'
    : col === 'sla' ? (i.sla?.resolution_due_at ? new Date(i.sla.resolution_due_at).getTime() : Infinity) : new Date(i.created_at).getTime()
  return [...list].sort((a, b) => (v(a) < v(b) ? -1 : v(a) > v(b) ? 1 : 0) * dir)
}
export { STATUS_SHORT }

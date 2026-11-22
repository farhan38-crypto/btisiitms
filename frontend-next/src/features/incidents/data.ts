// Shared data for incident screens: lists, one incident, and the catalogue (services,
// categories, technicians, buildings). Cache keys start with "incidents" / "incident:<id>"
// so live events refresh them (api/live.ts).
import { api, useQuery, OPEN_STATUSES, DONE_STATUSES, type Incident, type IncidentFilters, type User } from '../../api'
import { buildQuery } from '../../api/client'

export function useIncidentList(filters: IncidentFilters) {
  const key = `incidents${buildQuery({ limit: 500, ...filters } as Record<string, unknown>)}`
  return useQuery(key, () => api.incidents.list({ limit: 500, ...filters }), { staleMs: 20_000 })
}
export const useIncident = (id: string | null | undefined) =>
  useQuery(id ? `incident:${id}` : null, () => api.incidents.get(id!), { staleMs: 5_000 })

export const useServices = () => useQuery('catalog:services', () => api.catalog.services(), { staleMs: 300_000 })
export const useCategories = () => useQuery('catalog:categories', () => api.catalog.categories(), { staleMs: 300_000 })
export const useTechnicians = (enabled = true) => useQuery(enabled ? 'catalog:technicians' : null, () => api.catalog.technicians(), { staleMs: 120_000 })
export const useBuildingList = () => useQuery('buildings', () => api.campus.buildings(), { staleMs: 300_000 })

// ───── views: named slices of the list (the tabs on the Incidents page) ─────
export type ViewKey = 'open' | 'mine' | 'urgent' | 'unassigned' | 'sla' | 'escalated' | 'today' | 'done' | 'all'
export interface View { key: ViewKey; label: string; staffOnly?: boolean; techOnly?: boolean; server?: IncidentFilters; keep?: (i: Incident) => boolean }

const isOpen = (i: Incident) => OPEN_STATUSES.includes(i.status)
const today = () => new Date().toDateString()
export function viewsFor(user: User): View[] {
  const staff = user.role !== 'customer'
  const views: View[] = [
    { key: 'open', label: staff ? 'Open' : 'In progress', keep: isOpen },
    { key: 'mine', label: 'Assigned to me', staffOnly: true, server: user.role === 'technician' ? { scope: 'assigned' } : { assigned_to: user.id }, keep: isOpen },
    { key: 'urgent', label: 'Urgent', staffOnly: true, keep: i => isOpen(i) && (i.priority === 'P1' || i.priority === 'P2') },
    { key: 'unassigned', label: 'Unassigned', staffOnly: true, server: user.role === 'technician' ? { scope: 'unassigned' } : { assigned_to: 'unassigned' }, keep: isOpen },
    { key: 'sla', label: 'SLA risk', staffOnly: true, keep: i => isOpen(i) && (i.sla?.status === 'AT_RISK' || i.sla?.status === 'BREACHED') },
    { key: 'escalated', label: 'Escalated', staffOnly: true, server: { escalated: true }, keep: isOpen },
    { key: 'today', label: 'Resolved today', staffOnly: true, keep: i => !!i.resolution?.resolved_at && new Date(i.resolution.resolved_at).toDateString() === today() },
    { key: 'done', label: staff ? 'Done' : 'Fixed', keep: i => DONE_STATUSES.includes(i.status) },
    { key: 'all', label: 'All' },
  ]
  return views.filter(v => staff || !v.staffOnly)
}

const P_RANK = { P1: 0, P2: 1, P3: 2, P4: 3 } as const
const SLA_RANK = { BREACHED: 0, AT_RISK: 1, ON_TRACK: 2, MET: 3 } as const
export type SortKey = 'smart' | 'newest' | 'oldest' | 'priority' | 'due'
/** "Smart": what needs a person first: breached and at-risk, then priority, then oldest. */
export function sortIncidents(list: Incident[], by: SortKey): Incident[] {
  const s = [...list]
  const created = (i: Incident) => new Date(i.created_at).getTime()
  const due = (i: Incident) => i.sla?.resolution_due_at ? new Date(i.sla.resolution_due_at).getTime() : Infinity
  if (by === 'newest') return s.sort((a, b) => created(b) - created(a))
  if (by === 'oldest') return s.sort((a, b) => created(a) - created(b))
  if (by === 'priority') return s.sort((a, b) => P_RANK[a.priority] - P_RANK[b.priority] || created(b) - created(a))
  if (by === 'due') return s.sort((a, b) => due(a) - due(b))
  return s.sort((a, b) => {
    const ao = isOpen(a) ? 0 : 1, bo = isOpen(b) ? 0 : 1
    if (ao !== bo) return ao - bo
    if (!ao) {
      const sa = SLA_RANK[a.sla?.status || 'ON_TRACK'], sb = SLA_RANK[b.sla?.status || 'ON_TRACK']
      if (sa !== sb && (sa < 2 || sb < 2)) return sa - sb
      return P_RANK[a.priority] - P_RANK[b.priority] || due(a) - due(b)
    }
    return created(b) - created(a)
  })
}

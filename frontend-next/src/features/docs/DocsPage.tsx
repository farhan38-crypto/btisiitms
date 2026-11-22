// How it works: the lifecycle as a diagram, roles, and the backend's own documentation
// sections (GET /docs).
import { BookOpen, Command, Keyboard } from 'lucide-react'
import { api, useQuery } from '../../api'
import { modKey } from '../../lib/media'
import { Kbd, Section, Skeleton } from '../../ui/Controls'
import { StatusIcon } from '../../ui/Badges'
import type { Status } from '../../api'

const FLOW: { s: Status; label: string; who: string }[] = [
  { s: 'NEW', label: 'Reported', who: 'Anyone' }, { s: 'CLASSIFIED', label: 'Classified', who: 'Automatic' },
  { s: 'ASSIGNED', label: 'Assigned', who: 'Admin or strategy' }, { s: 'ACKNOWLEDGED', label: 'Acknowledged', who: 'Technician' },
  { s: 'IN_PROGRESS', label: 'In progress', who: 'Technician' }, { s: 'RESOLVED', label: 'Resolved', who: 'Technician' },
  { s: 'VERIFIED', label: 'Verified', who: 'Reporter' }, { s: 'CLOSED', label: 'Closed', who: 'Reporter or admin' },
]

export default function DocsPage() {
  const { data } = useQuery('docs', () => api.docs.get(), { staleMs: 600_000 })
  return (
    <main className="page page-narrow docs">
      <header className="page-head"><div><h1>How it works</h1><p>From a report to a fix, and who does what.</p></div></header>
      <Section title="An incident’s life" className="surface pad">
        <ol className="flow">{FLOW.map(f => <li key={f.s}><StatusIcon s={f.s} size={18} /><b>{f.label}</b><small>{f.who}</small></li>)}</ol>
        <p className="muted small">At any point while it’s being worked on, a technician can ask the reporter for more information (Needs info). A reporter who finds it still broken can reopen it from Resolved.</p>
      </Section>
      <Section title="Shortcuts" className="surface pad">
        <ul className="keys">
          <li><span><Kbd>{modKey}</Kbd><Kbd>K</Kbd> or <Kbd>/</Kbd></span>Search incidents, pages and actions<Command size={15} /></li>
          <li><span><Kbd>j</Kbd><Kbd>k</Kbd></span>Move through the incident list</li>
          <li><span><Kbd>↵</Kbd></span>Open the selected incident</li>
          <li><span><Kbd>Esc</Kbd></span>Close a panel or dialog<Keyboard size={15} /></li>
        </ul>
      </Section>
      {!data ? <Skeleton h={200} r={24} /> : data.sections.map(s => (
        <Section key={s.title} title={<><BookOpen size={18} />{s.title}</>} className="surface pad"><p className="prose">{s.body}</p></Section>
      ))}
    </main>
  )
}

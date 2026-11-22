// Admin pages refuse to open until the admin has two-step sign-in, when that's required
// (backend: 403 with error code 2fa_required). Show the way forward instead of an error.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { ApiError } from '../../api'
import { Empty } from '../../ui/Controls'

export function AdminGate({ error, children }: { error: unknown; children: ReactNode }) {
  if (error instanceof ApiError && error.status === 403) return (
    <main className="page page-narrow"><div className="surface pad">
      <Empty icon={<ShieldAlert size={22} />} title="Turn on two-step sign-in first" action={<Link to="/account#security" className="btn btn-primary">Set it up</Link>}>{error.message}</Empty>
    </div></main>
  )
  return <>{children}</>
}

import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useAuth, isStaff } from '../../lib/auth'
import { IncidentView } from './IncidentView'

export default function IncidentPage() {
  const { id = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const back = () => (history.length > 2 ? navigate(-1) : navigate('/incidents'))
  return (
    <main className="page page-incident">
      <Link to="/incidents" viewTransition className="back" onClick={e => { e.preventDefault(); back() }}>
        <ArrowLeft size={16} />{isStaff(user) ? 'Incidents' : 'My reports'}
      </Link>
      <IncidentView id={id} />
    </main>
  )
}

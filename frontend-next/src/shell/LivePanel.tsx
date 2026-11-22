// "Live" in the top bar: whether the update stream is connected, and what just happened.
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { restartLive, useLiveState, useRecentLive } from '../api'
import { eventLabel, timeAgo } from '../lib/format'
import { pVar } from '../ui/Badges'
import { Popover } from '../ui/Overlay'

export function LivePanel() {
  const state = useLiveState()
  const recent = useRecentLive()
  const on = state === 'on'
  return (
    <Popover title="Live updates" width={360} trigger={({ toggle, ref, props }) => (
      <button ref={ref} {...props} type="button" className="live" data-on={on || undefined} onClick={toggle}
        title={on ? 'Live: pages update by themselves' : state === 'connecting' ? 'Connecting…' : 'Live updates are off'}>
        <i />{on ? 'Live' : state === 'connecting' ? 'Connecting' : 'Offline'}
        {recent.length > 0 && <span className="live-count tabular">{Math.min(recent.length, 9)}</span>}
      </button>
    )}>
      {close => (
        <div className="live-panel">
          <header>
            <div><b>{on ? 'Connected' : 'Not connected'}</b><small>{on ? 'Changes appear as they happen.' : 'Reconnecting automatically…'}</small></div>
            <button type="button" className="btn sm" onClick={restartLive}><RefreshCw size={14} />Reconnect</button>
          </header>
          {recent.length === 0 ? <p className="live-note">Nothing has happened since you opened the app.</p> : (
            <ul>
              {recent.map((e, i) => (
                <li key={i}>
                  <Link to={`/incidents/${e.incident_id}`} onClick={close} style={{ ['--k' as string]: pVar(e.priority) }}>
                    <i />
                    <span><b>{eventLabel(e.type)} · {e.number}</b><small>{e.description}</small></span>
                    <time>{timeAgo(e.timestamp)}</time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Popover>
  )
}

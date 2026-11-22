import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ticket, Clock, AlertTriangle, Shield, Siren, CheckCircle, Timer, Flame, Link2, Map as MapIcon } from 'lucide-react';
import api, { errMsg } from '../api';
import { Badge, Loading, minutesLabel, fmtShort } from '../components/common';
import { useLiveIncidentEvents } from '../live';
import { AnimatedNumber, GrowBar, motion, DURATION, EASE_OUT, itemDelay } from '../motion';
import { GlowingEffect } from '../components/effects';

export default function Dashboard({ user }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [outages, setOutages] = useState([]);
  const liveTimer = useRef(null);
  const loadRef = useRef(null);

  useEffect(() => {
    const load = () => {
      api.get('/reports/overview').then(x => setD(x.data))
        .catch(e => setError(errMsg(e) || 'Could not load dashboard data.'));
      api.get('/campus/map', { params: { days: 1 } }).then(x => setOutages(x.data.outages)).catch(() => {});
    };
    loadRef.current = load;
    load();
    const t = setInterval(load, 30000); // fallback if live updates are unavailable
    return () => { clearInterval(t); clearTimeout(liveTimer.current); };
  }, []);

  // Live: any incident change refreshes the numbers (debounced so a burst is one request).
  useLiveIncidentEvents(() => {
    clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => loadRef.current?.(), 800);
  });

  if (error) return <div className="panel empty">{error}</div>;
  if (!d) return <Loading />;
  const t = d.totals;
  const maxPriority = Math.max(1, ...d.by_priority.map(x => x.value));
  const maxService = Math.max(1, ...d.by_service.map(x => x.total));
  const maxCategory = Math.max(1, ...d.by_category.map(x => x.value));

  return (
    <>
      <div className="grid metrics">
        <Metric icon={<Ticket />} tone="indigo" label="Total incidents" value={t.total} />
        <Metric icon={<Clock />} tone="sky" label="Open" value={t.open} />
        <Metric icon={<Flame />} tone="rose" label="Critical (P1) open" value={t.p1_open} sub={`${t.critical} P1 in total`} />
        <Metric icon={<CheckCircle />} tone="teal" label="Resolved" value={t.resolved} sub={`${t.resolved_today} today`} />
      </div>
      <div className="grid metrics">
        <Metric icon={<AlertTriangle />} tone="orange" label="SLA breached (open)" value={t.breached} sub={`${t.at_risk} at risk`} />
        <Metric icon={<Shield />} tone="violet" label="SLA compliance" value={d.sla.compliance_rate + '%'} sub={`${d.sla.met} met · ${d.sla.breached} breached`} />
        <Metric icon={<Siren />} tone="magenta" label="Escalated & open" value={t.escalated_open} sub={`${t.sla_violations} violations recorded`} />
        <Metric icon={<Timer />} tone="sun" label="Avg. resolution time" value={minutesLabel(t.avg_resolution_minutes)} />
      </div>

      {outages.map((o, n) => (
        <motion.section key={o.building} className="panel outage-alert" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.base, ease: EASE_OUT, delay: itemDelay(n) }}>
          <Siren size={20} />
          <div>
            <b>Possible outage in {o.building}: {o.count} reports in {o.window_minutes} min</b>
            <small>{o.suggestion}</small>
            <span className="chip-row">
              {o.incidents.slice(0, 6).map(i => <Link key={i.id} className="badge" to={`/incidents/${i.id}`}>{i.number}</Link>)}
              <Link className="badge" to="/campus-map"><MapIcon size={11} /> See on map</Link>
            </span>
          </div>
        </motion.section>
      ))}

      {d.correlations?.length > 0 && (
        <section className="panel callout-panel">
          <div className="panel-title-row"><Link2 size={18} /><h3>Possible major incidents</h3></div>
          {d.correlations.map(c => (
            <div className="row" key={c.service_id}>
              <span><b>{c.service_name}: {c.count} open reports</b><small>{c.suggestion}</small></span>
              <span className="chip-row">{c.incidents.slice(0, 5).map(i => <Link key={i.id} className="badge" to={`/incidents/${i.id}`}>{i.number}</Link>)}</span>
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div><span className="eyebrow">INCIDENT OVERVIEW</span><h3>Severity breakdown</h3></div>
          <Link className="primary small" to="/incidents">Open queue</Link>
        </div>
        <div className="severity-breakdown">
          {d.by_priority.map(x => (
            <div className={`severity-item severity-${x.name.toLowerCase()}`} key={x.name}>
              <div className="severity-item-head"><span>{x.name}</span><b>{x.value}</b></div>
              <div className="severity-track"><GrowBar pct={(x.value / maxPriority) * 100} /></div>
              <small>{x.value === 1 ? 'incident' : 'incidents'}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <span className="eyebrow">SERVICE ANALYSIS</span>
          <h3>Incidents by service</h3>
          <div className="bar-list">
            {d.by_service.map((s, n) => (
              <div className="bar-row" key={s.name}>
                <span className="bar-label">{s.name}</span>
                <span className="bar-track"><GrowBar pct={(s.total / maxService) * 100} delay={itemDelay(n)} /></span>
                <b>{s.total}</b>
                <small>{s.open} open{s.breached ? ` · ${s.breached} breached` : ''}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <span className="eyebrow">CLASSIFICATION</span>
          <h3>Incidents by category</h3>
          <div className="bar-list">
            {d.by_category.map((c, n) => (
              <div className="bar-row" key={c.name}>
                <span className="bar-label">{c.name}</span>
                <span className="bar-track"><GrowBar pct={(c.value / maxCategory) * 100} delay={itemDelay(n)} /></span>
                <b>{c.value}</b>
                <small />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <span className="eyebrow">TECHNICIAN WORKLOAD</span>
          <h3>Active incidents per technician</h3>
          <div className="table-wrap plain">
            <table>
              <thead><tr><th>Technician</th><th>Open / capacity</th><th>Resolved</th></tr></thead>
              <tbody>
                {d.technician_workload.filter(w => w.is_active).map(w => (
                  <tr key={w.id} className={w.id === user.id ? 'highlight' : ''}>
                    <td><b>{w.name}{w.id === user.id ? ' (you)' : ''}</b><small>{w.skills.join(' · ') || 'General'}</small></td>
                    <td>
                      <span className="capacity"><i style={{ width: `${Math.min(100, (w.open / w.max_concurrent) * 100)}%` }} className={w.open >= w.max_concurrent ? 'full' : ''} /></span>
                      {w.open} / {w.max_concurrent}
                    </td>
                    <td>{w.resolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <span className="eyebrow">SLA MONITORING</span>
          <h3>Recent SLA violations</h3>
          {d.recent_violations.length === 0 ? <p className="muted small-text">No SLA violations recorded.</p> : d.recent_violations.map(v => (
            <div className="row" key={v.id}>
              <span><Link to={`/incidents/${v.incident_id}`}><b>{v.incident_number}</b></Link>
                <small>{v.kind === 'response' ? 'Response' : 'Resolution'} deadline missed · {v.service_name} · {fmtShort(v.detected_at)}</small></span>
              <Badge v={v.priority} />
            </div>
          ))}
          <p className="muted small-text" style={{ marginTop: 14 }}>
            Strategies in use: <b>{d.strategies.assignment}</b> assignment · <b>{d.strategies.priority}</b> priority
            {user.role === 'admin' && <> · <Link to="/admin/settings">change</Link></>}
          </p>
        </div>
      </section>
    </>
  );
}

function Metric({ icon, label, value, sub, tone = 'indigo' }) {
  return (
    <div className={`metric tone-${tone}`}>
      <GlowingEffect spread={36} borderWidth={2} />
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong><AnimatedNumber value={value} /></strong>
      {sub && <small className="muted">{sub}</small>}
    </div>
  );
}

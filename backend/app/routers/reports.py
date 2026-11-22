from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query

from app.core.container import container
from app.core.security import require_roles
from app.domain.enums import Role, OPEN_STATUSES
from app.domain.sla import parse_dt
from app.models.schemas import clean_doc

router = APIRouter(prefix='/reports', tags=['reports'])
DONE = ('RESOLVED', 'VERIFIED', 'CLOSED')


@router.get('/overview')
async def overview(user=Depends(require_roles(Role.ADMIN.value, Role.TECHNICIAN.value))):
    c = container
    inc = await c.incidents.find({}, limit=20000)
    tech = await c.users.find({'role': Role.TECHNICIAN.value}, limit=500)
    st = Counter(x.get('status', 'NEW') for x in inc)
    pr = Counter(x.get('priority', 'P4') for x in inc)
    sla = Counter((x.get('sla') or {}).get('status', 'ON_TRACK') for x in inc)
    total_sla = sla['MET'] + sla['BREACHED']
    today = datetime.now(timezone.utc).date()

    durations = []
    resolved_today = 0
    for x in inc:
        r_dt = parse_dt((x.get('resolution') or {}).get('resolved_at'))
        if r_dt:
            resolved_today += r_dt.date() == today
            c_dt = parse_dt(x.get('created_at'))
            if c_dt:
                durations.append((r_dt - c_dt).total_seconds() / 60)

    by_service = defaultdict(lambda: {'total': 0, 'open': 0, 'breached': 0})
    for x in inc:
        row = by_service[x.get('service_name') or 'Unknown']
        row['total'] += 1
        row['open'] += x.get('status') in OPEN_STATUSES
        row['breached'] += (x.get('sla') or {}).get('status') == 'BREACHED'

    resolved_by = Counter((x.get('resolution') or {}).get('resolved_by') for x in inc if x.get('resolution'))
    settings = await c.settings.get_settings()
    return {
        'totals': {
            'total': len(inc),
            'open': sum(st[x] for x in OPEN_STATUSES),
            'resolved': sum(st[x] for x in DONE),
            'resolved_today': resolved_today,
            'critical': pr['P1'],
            'p1_open': sum(1 for x in inc if x.get('priority') == 'P1' and x.get('status') in OPEN_STATUSES),
            'breached': sla['BREACHED'],
            'at_risk': sla['AT_RISK'],
            'escalated_open': sum(1 for x in inc if (x.get('escalation') or {}).get('level') and x.get('status') in OPEN_STATUSES),
            'sla_violations': await c.sla_violations.count(),
            'avg_resolution_minutes': round(sum(durations) / len(durations)) if durations else None,
        },
        'by_status': [{'name': k, 'value': v} for k, v in st.items()],
        'by_priority': [{'name': k, 'value': pr[k]} for k in ['P1', 'P2', 'P3', 'P4']],
        'by_category': [{'name': k, 'value': v} for k, v in Counter(x.get('category') for x in inc).most_common()],
        'by_service': sorted(({'name': k, **v} for k, v in by_service.items()), key=lambda r: -r['total']),
        'sla': {
            'met': sla['MET'], 'breached': sla['BREACHED'], 'at_risk': sla['AT_RISK'], 'on_track': sla['ON_TRACK'],
            'compliance_rate': round(sla['MET'] / total_sla * 100) if total_sla else 100,
        },
        'technician_workload': [
            {
                'id': str(t['_id']), 'name': t['name'], 'skills': t.get('skills', []),
                'max_concurrent': t.get('max_concurrent', 5), 'is_active': t.get('is_active', True),
                'open': sum(1 for x in inc if str(x.get('assigned_to', '')) == str(t['_id']) and x.get('status') in OPEN_STATUSES),
                'resolved': resolved_by.get(str(t['_id']), 0),
            }
            for t in tech
        ],
        'recent_violations': [clean_doc(v) for v in await c.sla_violations.find({}, sort=[('detected_at', -1)], limit=8)],
        'correlations': await c.intel.correlation_clusters(int(settings['correlation_window_minutes']),
                                                           int(settings['correlation_threshold'])),
        'strategies': {'assignment': settings['assignment_strategy'], 'priority': settings['priority_strategy']},
    }


CAMPUS_TZ = ZoneInfo('Asia/Kolkata')   # charts count days and hours in campus time
PRIORITIES = ('P1', 'P2', 'P3', 'P4')


@router.get('/trends')
async def trends(days: int = Query(14, ge=7, le=90),
                 user=Depends(require_roles(Role.ADMIN.value, Role.TECHNICIAN.value))):
    """Data for the overview charts.
    daily:     reports created and resolved on each of the last `days` days, plus the open backlog that evening
    heatmap:   reports created by weekday (0 = Monday) and hour, over the same days
    buildings: open reports per building, split by priority, busiest first
    """
    inc = await container.incidents.find({}, limit=20000, projection={
        'created_at': 1, 'resolution': 1, 'status': 1, 'priority': 1, 'location': 1})
    today = datetime.now(CAMPUS_TZ).date()
    first = today - timedelta(days=days - 1)
    span = [first + timedelta(days=i) for i in range(days)]
    created, resolved = Counter(), Counter()
    heat = [[0] * 24 for _ in range(7)]
    spans = []   # (created day, resolved day or None) for the backlog line
    for x in inc:
        c_dt = parse_dt(x.get('created_at'))
        r_dt = parse_dt((x.get('resolution') or {}).get('resolved_at'))
        c_local = c_dt.astimezone(CAMPUS_TZ) if c_dt else None
        r_day = r_dt.astimezone(CAMPUS_TZ).date() if r_dt else None
        if c_local:
            spans.append((c_local.date(), r_day))
            if c_local.date() >= first:
                created[c_local.date()] += 1
                heat[c_local.weekday()][c_local.hour] += 1
        if r_day and r_day >= first:
            resolved[r_day] += 1
    daily = [{'date': d.isoformat(), 'created': created[d], 'resolved': resolved[d],
              'open': sum(1 for c, r in spans if c <= d and (r is None or r > d))} for d in span]

    by_b = defaultdict(lambda: dict.fromkeys(PRIORITIES, 0))
    for x in inc:
        if x.get('status') not in OPEN_STATUSES:
            continue
        loc = x.get('location') or {}
        b = loc.get('hostel_name') or loc.get('academic_block') or 'Other / online'
        p = x.get('priority') if x.get('priority') in PRIORITIES else 'P4'
        by_b[b][p] += 1
    buildings = sorted(({'building': b, **v, 'total': sum(v.values())} for b, v in by_b.items()),
                       key=lambda r: (-r['total'], -r['P1'], r['building']))
    return {'days': days, 'timezone': 'Asia/Kolkata', 'daily': daily, 'heatmap': heat, 'buildings': buildings}

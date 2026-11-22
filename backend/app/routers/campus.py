"""Campus map: building pins (admins can correct them) and a live map of reports."""
from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, Query

from app.core.container import container
from app.core.security import get_current_user, require_roles
from app.domain.enums import Role, OPEN_STATUSES
from app.domain.exceptions import ResourceNotFoundError
from app.domain.geo import CampusMap
from app.domain.sla import utcnow
from app.models.schemas import BuildingPinInput

router = APIRouter(prefix='/campus', tags=['campus map'])
STAFF = (Role.ADMIN.value, Role.TECHNICIAN.value)
SEVERITY = {'P1': 4, 'P2': 3, 'P3': 2, 'P4': 1}


@router.get('/buildings')
async def buildings(_=Depends(get_current_user)):
    m = await container.incident_service.campus_map()
    return {'centre': CampusMap.CENTRE.to_doc(), 'buildings': m.buildings()}


@router.put('/buildings/{name}')
async def set_building_pin(name: str, data: BuildingPinInput, user=Depends(require_roles(Role.ADMIN.value))):
    if name not in CampusMap.DEFAULT_PINS:
        raise ResourceNotFoundError(f'Unknown building: {name}')
    await container.building_pins.set_pin(name, data.latitude, data.longitude, user['id'])
    return await buildings(user)


@router.get('/map')
async def incident_map(days: int = Query(30, ge=1, le=365), include_closed: bool = False,
                       _=Depends(require_roles(*STAFF))):
    """Every located incident from the last `days` days, plus per-building hotspots."""
    since = (utcnow() - timedelta(days=days)).isoformat()
    query = {'geo': {'$ne': None}, 'created_at': {'$gte': since}}
    if not include_closed:
        query['status'] = {'$in': OPEN_STATUSES}
    docs = await container.incidents.find(query, sort=[('created_at', -1)], limit=2000, projection={
        'number': 1, 'title': 1, 'priority': 1, 'status': 1, 'geo': 1, 'location': 1, 'service_name': 1,
        'category': 1, 'created_at': 1, 'assigned_name': 1, 'sla': 1})
    points, by_building = [], defaultdict(list)
    for d in docs:
        loc = d.get('location') or {}
        building = loc.get('hostel_name') or loc.get('academic_block')
        p = {'id': str(d['_id']), 'number': d.get('number'), 'title': d.get('title'), 'priority': d.get('priority'),
             'status': d.get('status'), 'service_name': d.get('service_name'), 'category': d.get('category'),
             'location': loc.get('formatted'), 'building': building, 'created_at': d.get('created_at'),
             'assigned_name': d.get('assigned_name'), 'sla_status': (d.get('sla') or {}).get('status'),
             **{k: d['geo'].get(k) for k in ('lat', 'lng', 'accuracy_m', 'source')}}
        points.append(p)
        if building:
            by_building[building].append(p)
    s = await container.settings.get_settings()
    threshold = int(s['correlation_threshold'])
    hotspots = sorted(({
        'building': b, 'count': len(items), 'open': sum(i['status'] in OPEN_STATUSES for i in items),
        'worst_priority': max((i['priority'] for i in items if i['priority']), key=lambda x: SEVERITY.get(x, 0),
                              default=None),
        'breached': sum(i['sla_status'] == 'BREACHED' for i in items),
        'is_hotspot': len(items) >= threshold,
    } for b, items in by_building.items()), key=lambda h: h['count'], reverse=True)
    outages = await container.intel.building_clusters(int(s['correlation_window_minutes']), threshold)
    return {'points': points, 'hotspots': hotspots, 'outages': outages, 'days': days, 'threshold': threshold}

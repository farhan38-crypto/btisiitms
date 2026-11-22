from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.container import container
from app.core.security import get_current_user, require_roles
from app.domain.enums import Role
from app.models.schemas import IncidentCreate, IncidentUpdate, AssignRequest, TransitionRequest, NoteInput, clean_doc

router = APIRouter(prefix='/incidents', tags=['incidents'])
service = container.incident_service
STAFF = (Role.ADMIN.value, Role.TECHNICIAN.value)


def out(d):
    return clean_doc(d)


@router.get('')
async def listing(user=Depends(get_current_user), q: Optional[str] = None, status: Optional[str] = None,
                  priority: Optional[str] = None, category: Optional[str] = None, service_id: Optional[str] = None,
                  assigned_to: Optional[str] = None, sla_status: Optional[str] = None, scope: Optional[str] = None,
                  date_from: Optional[str] = None, date_to: Optional[str] = None, escalated: bool = False,
                  limit: int = Query(300, ge=1, le=500)):
    filters = dict(q=q, status=status, priority=priority, category=category, service_id=service_id,
                   assigned_to=assigned_to, sla_status=sla_status, scope=scope, date_from=date_from,
                   date_to=date_to, escalated=escalated, limit=limit)
    return await service.search(user, filters)


@router.post('', status_code=201)
async def create(data: IncidentCreate, user=Depends(require_roles(Role.CUSTOMER.value, *STAFF))):
    return out(await service.create(data, user))


@router.get('/{iid}')
async def get(iid, user=Depends(get_current_user)):
    inc = await service.get(iid)
    service.assert_access(inc, user)
    staff = user['role'] in STAFF
    return {
        'incident': out(inc),
        'allowed_transitions': service.allowed_transitions(inc, user),
        'audit': await service.audit.for_incident(str(inc['_id'])),
        'recommendations': await service.intel.recommend(inc) if staff else [],
        'related': await service.intel.related_incidents(inc) if staff else [],
        'suggested_resolutions': await service.intel.suggest_resolutions(inc) if staff else [],
    }


@router.post('/{iid}/transition')
async def transition(iid, data: TransitionRequest, user=Depends(get_current_user)):
    return out(await service.transition(iid, data, user))


@router.post('/{iid}/assign')
async def assign(iid, data: AssignRequest, user=Depends(require_roles(*STAFF))):
    return out(await service.assign(await service.get(iid), data.technician_id, user))


@router.post('/{iid}/auto-assign')
async def auto_assign(iid, user=Depends(require_roles(Role.ADMIN.value))):
    return out(await service.auto_assign(await service.get(iid), user))


@router.post('/{iid}/notes')
async def note(iid, data: NoteInput, user=Depends(get_current_user)):
    return out(await service.add_note(iid, data, user))


@router.patch('/{iid}')
async def update(iid, data: IncidentUpdate, user=Depends(require_roles(*STAFF))):
    return out(await service.update(iid, data, user))

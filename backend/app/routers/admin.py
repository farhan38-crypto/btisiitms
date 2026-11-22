"""Administrator / IT manager endpoints: users, technicians, IT services,
categories, SLA policies, strategy settings, audit logs and SLA violations."""
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request

from app.core.container import container
from app.core.security import require_roles, hash_password
from app.domain.enums import Role, Priority
from app.domain.exceptions import (InvalidInputError, ResourceInUseError, AlreadyExistsError,
                                   UnauthorizedOperationError)
from app.domain.models import UserFactory
from app.domain.strategies import AssignmentStrategyFactory, PriorityStrategyFactory
from app.models.schemas import (ServiceInput, CategoryInput, SlaPolicyInput, CreateUserRequest, UpdateUserRequest,
                                SettingsUpdate, clean_doc)

router = APIRouter(prefix='/admin', tags=['admin'])
c = container


async def admin(u=Depends(require_roles(Role.ADMIN.value))):
    if not u.get('two_factor_enabled') and (await c.settings.get_settings()).get('require_admin_2fa'):
        raise UnauthorizedOperationError('Administrators must turn on an authenticator app before using the admin '
                                         'pages. Open Account & security to set it up.', code='2fa_required')
    return u


# ───────────── users & technicians ─────────────
@router.get('/users')
async def users(_=Depends(admin)):
    return [clean_doc(x) for x in await c.users.list_public()]


@router.post('/users', status_code=201)
async def create_user(data: CreateUserRequest, _=Depends(admin)):
    role = data.role.strip().lower()
    if role not in (Role.ADMIN.value, Role.TECHNICIAN.value):
        raise InvalidInputError("Admin can only create 'admin' or 'technician' accounts.")
    if await c.users.by_email(data.email):
        raise AlreadyExistsError(f"A user with email '{data.email.strip().lower()}' already exists.")
    user = UserFactory.create(role, name=data.name, email=data.email, phone=data.phone, skills=data.skills,
                              max_concurrent=data.max_concurrent)
    doc = await c.users.add(user.to_doc(hash_password(data.password)))
    doc.pop('password_hash', None)
    return clean_doc(doc)


@router.patch('/users/{uid}')
async def update_user(uid: str, data: UpdateUserRequest, _=Depends(admin)):
    current = await c.users.get(uid)
    changes = data.model_dump(exclude_none=True)
    if current.get('role') != Role.TECHNICIAN.value:
        changes.pop('skills', None)
        changes.pop('max_concurrent', None)
    if not changes:
        raise InvalidInputError('Nothing to update')
    # Validate through the domain object so the same rules apply as on creation.
    UserFactory.from_doc({**current, **changes})
    if 'skills' in changes:
        changes['skills'] = list(dict.fromkeys(s.strip() for s in changes['skills'] if s and s.strip()))
    updated = await c.users.update(uid, changes)
    updated.pop('password_hash', None)
    return clean_doc(updated)


@router.patch('/users/{uid}/active')
async def active(uid: str, payload: dict, current=Depends(admin)):
    is_active = bool(payload.get('is_active', True))
    if not is_active and uid == current['id']:
        raise InvalidInputError('You cannot deactivate your own administrator account.')
    await c.users.update(uid, {'is_active': is_active})
    return {'ok': True}


@router.post('/users/{uid}/reset-2fa')
async def reset_two_factor(uid: str, request: Request, current=Depends(admin)):
    """For a user who lost their phone and their backup codes: they can sign in with the password again."""
    target = await c.users.get(uid)
    if uid == current['id']:
        raise InvalidInputError('Use Account & security to change your own authenticator.')
    if not target.get('totp_enabled'):
        raise InvalidInputError('This user does not use an authenticator app.')
    await c.db.users.update_one({'_id': target['_id']}, {
        '$set': {'totp_enabled': False},
        '$unset': {'totp_secret': '', 'totp_pending_secret': '', 'backup_codes': '', 'totp_last_step': '',
                   'totp_enabled_at': ''}})
    await c.security_log.record(target, '2fa_reset_by_admin', request=request, actor=current['email'])
    return {'ok': True}


# ───────────── IT services ─────────────
@router.get('/services')
async def services(_=Depends(admin)):
    docs = await c.services.find({}, sort=[('name', 1)], limit=200)
    return [{**clean_doc(x), 'incident_count': await c.incidents.uses('service_id', str(x['_id']))} for x in docs]


@router.post('/services', status_code=201)
async def add_service(data: ServiceInput, _=Depends(admin)):
    if await c.services.by_name(data.name.strip()):
        raise AlreadyExistsError(f"A service named '{data.name.strip()}' already exists.")
    return clean_doc(await c.services.add({**data.model_dump(), 'name': data.name.strip()}))


@router.put('/services/{sid}')
async def edit_service(sid: str, data: ServiceInput, _=Depends(admin)):
    other = await c.services.by_name(data.name.strip())
    if other and str(other['_id']) != sid:
        raise AlreadyExistsError(f"A service named '{data.name.strip()}' already exists.")
    updated = await c.services.update(sid, {**data.model_dump(), 'name': data.name.strip()})
    # Keep the denormalised name on incidents in sync.
    await c.db.incidents.update_many({'service_id': sid}, {'$set': {'service_name': updated['name']}})
    return clean_doc(updated)


@router.delete('/services/{sid}')
async def delete_service(sid: str, _=Depends(admin)):
    await c.services.get(sid)
    used = await c.incidents.uses('service_id', sid)
    if used:
        raise ResourceInUseError(f'This service is used by {used} incident(s) and cannot be deleted.')
    await c.sla_policies.col.delete_many({'service_id': sid})
    await c.services.delete(sid)
    return {'ok': True}


# ───────────── categories ─────────────
@router.get('/categories')
async def categories(_=Depends(admin)):
    docs = await c.categories.find({}, sort=[('name', 1)], limit=200)
    return [{**clean_doc(x), 'incident_count': await c.incidents.uses('category', x['name'])} for x in docs]


@router.post('/categories', status_code=201)
async def add_category(data: CategoryInput, _=Depends(admin)):
    name = data.name.strip()
    if await c.categories.by_name(name):
        raise AlreadyExistsError(f"The category '{name}' already exists.")
    return clean_doc(await c.categories.add({'name': name}))


@router.delete('/categories/{cid}')
async def delete_category(cid: str, _=Depends(admin)):
    cat = await c.categories.get(cid)
    used = await c.incidents.uses('category', cat['name'])
    if used:
        raise ResourceInUseError(f"'{cat['name']}' is used by {used} incident(s) and cannot be deleted.")
    await c.categories.delete(cid)
    return {'ok': True}


# ───────────── SLA policies ─────────────
async def _validate_policy(data: SlaPolicyInput, policy_id: Optional[str] = None):
    if data.resolution_minutes < data.response_minutes:
        raise InvalidInputError('The resolution target cannot be shorter than the response target.')
    if data.service_id:
        await c.services.get(data.service_id)
    clash = await c.sla_policies.col.find_one({'priority': data.priority, 'service_id': data.service_id or None})
    if clash and str(clash['_id']) != policy_id:
        raise AlreadyExistsError('A policy for this priority and service already exists — edit it instead.')


@router.get('/sla')
async def sla(_=Depends(admin)):
    names = {str(s['_id']): s['name'] for s in await c.services.find({}, limit=500)}
    docs = await c.sla_policies.find({}, sort=[('priority', 1)], limit=200)
    return [{**clean_doc(x), 'service_name': names.get(x.get('service_id')) if x.get('service_id') else 'All services (default)'}
            for x in docs]


@router.post('/sla', status_code=201)
async def add_sla(data: SlaPolicyInput, _=Depends(admin)):
    await _validate_policy(data)
    return clean_doc(await c.sla_policies.add({**data.model_dump(), 'service_id': data.service_id or None}))


@router.put('/sla/{pid}')
async def edit_sla(pid: str, data: SlaPolicyInput, _=Depends(admin)):
    existing = await c.sla_policies.get(pid)
    if existing.get('service_id') is None and (data.service_id or data.priority != existing['priority']):
        raise InvalidInputError('Default policies keep their priority and apply to all services; only the name and '
                                'targets can change.')
    await _validate_policy(data, pid)
    return clean_doc(await c.sla_policies.update(pid, {**data.model_dump(), 'service_id': data.service_id or None}))


@router.delete('/sla/{pid}')
async def delete_sla(pid: str, _=Depends(admin)):
    doc = await c.sla_policies.get(pid)
    if doc.get('service_id') is None:
        raise ResourceInUseError(f"The default {doc['priority']} policy is required (every incident needs an SLA). "
                                 'Edit its targets instead.')
    await c.sla_policies.delete(pid)
    return {'ok': True}


# ───────────── strategy & automation settings ─────────────
@router.get('/settings')
async def get_settings(_=Depends(admin)):
    return {'settings': await c.settings.get_settings(),
            'assignment_strategies': AssignmentStrategyFactory.describe(),
            'priority_strategies': PriorityStrategyFactory.describe()}


@router.put('/settings')
async def put_settings(data: SettingsUpdate, current=Depends(admin)):
    changes = data.model_dump(exclude_none=True)
    if changes.get('require_admin_2fa') and not current.get('two_factor_enabled'):
        raise InvalidInputError('Turn on your own authenticator app first (Account & security), '
                                'otherwise this setting would lock you out of the admin pages.')
    if 'assignment_strategy' in changes and changes['assignment_strategy'] not in AssignmentStrategyFactory.registry:
        raise InvalidInputError(f"Unknown assignment strategy '{changes['assignment_strategy']}'")
    if 'priority_strategy' in changes and changes['priority_strategy'] not in PriorityStrategyFactory.registry:
        raise InvalidInputError(f"Unknown priority strategy '{changes['priority_strategy']}'")
    if 'escalation_priorities' in changes:
        valid = {p.value for p in Priority}
        if not set(changes['escalation_priorities']) <= valid:
            raise InvalidInputError('Escalation priorities must be P1–P4')
    return {'settings': await c.settings.update_settings(changes),
            'assignment_strategies': AssignmentStrategyFactory.describe(),
            'priority_strategies': PriorityStrategyFactory.describe()}


# ───────────── audit & SLA monitoring ─────────────
@router.get('/audit')
async def audit_log(_=Depends(admin), incident: Optional[str] = None, action: Optional[str] = None,
                    actor: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
                    limit: int = Query(200, ge=1, le=1000)):
    import re
    q = {}
    if incident:
        q['incident_number'] = {'$regex': re.escape(incident.strip()), '$options': 'i'}
    if action:
        q['action'] = action
    if actor:
        q['actor_name'] = {'$regex': re.escape(actor.strip()), '$options': 'i'}
    if date_from or date_to:
        from app.services.incident_service import IncidentService
        from datetime import timedelta
        rng = {}
        if date_from:
            rng['$gte'] = IncidentService._parse_day(date_from, 'date_from').isoformat()
        if date_to:
            rng['$lt'] = (IncidentService._parse_day(date_to, 'date_to') + timedelta(days=1)).isoformat()
        q['timestamp'] = rng
    return [clean_doc(x) for x in await c.audit.find(q, sort=[('timestamp', -1)], limit=limit)]


@router.get('/sla-violations')
async def sla_violations(_=Depends(admin), limit: int = Query(100, ge=1, le=1000)):
    return [clean_doc(x) for x in await c.sla_violations.find({}, sort=[('detected_at', -1)], limit=limit)]

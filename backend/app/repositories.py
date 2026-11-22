"""Repository pattern: all MongoDB access lives here.

Services work with repositories (and domain objects) instead of raw
collections, so the database could be swapped (e.g. PostgreSQL) by writing
new repository classes without touching business logic.
"""
from abc import ABC
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ReturnDocument

from app.domain.enums import Role, OPEN_STATUSES
from app.domain.exceptions import ResourceNotFoundError


def to_object_id(value, what='record'):
    try:
        return value if isinstance(value, ObjectId) else ObjectId(str(value))
    except (InvalidId, TypeError) as exc:
        raise ResourceNotFoundError(f'{what.capitalize()} not found') from exc


class MongoRepository(ABC):
    """Common CRUD for one collection; subclasses add domain-specific queries."""
    collection_name: str = ''
    entity_name: str = 'record'

    def __init__(self, db):
        self.db = db

    @property
    def col(self):
        return self.db[self.collection_name]

    async def get(self, id) -> dict:
        doc = await self.col.find_one({'_id': to_object_id(id, self.entity_name)})
        if not doc:
            raise ResourceNotFoundError(f'{self.entity_name.capitalize()} not found')
        return doc

    async def find(self, query=None, sort=None, limit=500, projection=None) -> list:
        cursor = self.col.find(query or {}, projection)
        if sort:
            cursor = cursor.sort(sort)
        return await cursor.limit(limit).to_list(limit)

    async def count(self, query=None) -> int:
        return await self.col.count_documents(query or {})

    async def add(self, doc: dict) -> dict:
        res = await self.col.insert_one(doc)
        doc['_id'] = res.inserted_id
        return doc

    async def update(self, id, changes: dict) -> dict:
        res = await self.col.update_one({'_id': to_object_id(id, self.entity_name)}, {'$set': changes})
        if not res.matched_count:
            raise ResourceNotFoundError(f'{self.entity_name.capitalize()} not found')
        return await self.get(id)

    async def delete(self, id):
        res = await self.col.delete_one({'_id': to_object_id(id, self.entity_name)})
        if not res.deleted_count:
            raise ResourceNotFoundError(f'{self.entity_name.capitalize()} not found')


class IncidentRepository(MongoRepository):
    collection_name = 'incidents'
    entity_name = 'incident'

    async def get(self, id_or_number) -> dict:
        key = str(id_or_number)
        if key.startswith('INC-'):
            doc = await self.col.find_one({'number': key})
        else:
            try:
                doc = await self.col.find_one({'_id': ObjectId(key)})
            except (InvalidId, TypeError):
                doc = await self.col.find_one({'number': key})
        if not doc:
            raise ResourceNotFoundError('Incident not found')
        return doc

    async def next_number(self) -> str:
        n = await self.db.counters.find_one_and_update({'_id': 'incident'}, {'$inc': {'value': 1}}, upsert=True,
                                                       return_document=ReturnDocument.AFTER)
        return f"INC-{n['value']:05d}"

    async def save_changes(self, incident) -> None:
        update = {}
        if incident.changes():
            update['$set'] = incident.changes()
        if incident.new_notes():
            update['$push'] = {'notes': {'$each': incident.new_notes()}}   # append, never overwrite
        if update:
            await self.col.update_one({'_id': to_object_id(incident.id, 'incident')}, update)
        incident.mark_saved()

    async def open_count_for(self, technician_id, exclude_id=None) -> int:
        q = {'assigned_to': technician_id, 'status': {'$in': OPEN_STATUSES}}
        if exclude_id is not None:
            q['_id'] = {'$ne': to_object_id(exclude_id)}
        return await self.count(q)

    async def open_incidents(self) -> list:
        return await self.find({'status': {'$in': OPEN_STATUSES}}, limit=5000)

    async def uses(self, field, value) -> int:
        return await self.count({field: value})


class UserRepository(MongoRepository):
    collection_name = 'users'
    entity_name = 'user'

    async def by_email(self, email) -> Optional[dict]:
        return await self.col.find_one({'email': (email or '').strip().lower()})

    async def active_technicians(self) -> list:
        return await self.find({'role': Role.TECHNICIAN.value, 'is_active': True}, limit=500)

    async def active_admins(self) -> list:
        return await self.find({'role': Role.ADMIN.value, 'is_active': True}, limit=200)

    # Fields that must never leave the server (see also schemas.serialize).
    PRIVATE_FIELDS = ('password_hash', 'totp_secret', 'totp_pending_secret', 'backup_codes', 'totp_last_step')

    async def list_public(self) -> list:
        return await self.find({}, sort=[('created_at', -1)], projection={f: 0 for f in self.PRIVATE_FIELDS},
                               limit=1000)


class ServiceRepository(MongoRepository):
    collection_name = 'services'
    entity_name = 'service'

    async def by_name(self, name):
        return await self.col.find_one({'name': name})


class CategoryRepository(MongoRepository):
    collection_name = 'categories'
    entity_name = 'category'

    async def by_name(self, name):
        return await self.col.find_one({'name': name})


class SlaPolicyRepository(MongoRepository):
    collection_name = 'sla_policies'
    entity_name = 'SLA policy'

    async def find_for(self, priority, service_id) -> Optional[dict]:
        """Service-specific policy first, then the default policy for the priority."""
        if service_id:
            doc = await self.col.find_one({'priority': priority, 'service_id': service_id})
            if doc:
                return doc
        return await self.col.find_one({'priority': priority, 'service_id': None})


class AuditRepository(MongoRepository):
    collection_name = 'audit_logs'
    entity_name = 'audit record'

    async def for_incident(self, incident_id) -> list:
        from app.models.schemas import clean_doc
        docs = await self.find({'incident_id': incident_id}, sort=[('timestamp', 1)], limit=1000)
        return [clean_doc(d) for d in docs]


class SecurityEventRepository(MongoRepository):
    """Sign-ins and account-security changes, shown on the Account & security page."""
    collection_name = 'security_events'
    entity_name = 'security event'

    @staticmethod
    def _client(request):
        if request is None:
            return None, None
        forwarded = request.headers.get('x-forwarded-for', '')
        ip = forwarded.split(',')[0].strip() or (request.client.host if request.client else None)
        return ip, (request.headers.get('user-agent') or '')[:300]

    async def record(self, user: dict, event: str, request=None, method=None, actor=None, detail=None):
        from datetime import datetime, timezone
        ip, agent = self._client(request)
        await self.add({'user_id': str(user.get('_id') or user.get('id')), 'email': user.get('email'),
                        'event': event, 'method': method, 'ip': ip, 'user_agent': agent,
                        'actor': actor, 'detail': detail, 'at': datetime.now(timezone.utc)})

    async def recent(self, user_id: str, limit=20) -> list:
        return await self.find({'user_id': user_id}, sort=[('at', -1)], limit=limit)


class NotificationRepository(MongoRepository):
    collection_name = 'notifications'
    entity_name = 'notification'


class SlaViolationRepository(MongoRepository):
    collection_name = 'sla_violations'
    entity_name = 'SLA violation'


class CorrelationAlertRepository(MongoRepository):
    collection_name = 'correlation_alerts'
    entity_name = 'correlation alert'


class SettingsRepository(MongoRepository):
    """Single document holding the admin-configurable system settings."""
    collection_name = 'settings'
    entity_name = 'settings'
    DOC_ID = 'system'
    DEFAULTS = {
        'assignment_strategy': 'smart',
        'priority_strategy': 'weighted',
        'auto_assign_on_create': False,
        'escalation_enabled': True,
        'escalation_priorities': ['P1', 'P2'],
        'correlation_window_minutes': 120,
        'correlation_threshold': 3,
        'require_admin_2fa': False,
        'require_handover_code': True,     # hostel repairs need the student's 4-digit code to resolve
        'arrival_radius_m': 150,           # how close the technician must be to count as "arrived"
    }

    async def get_settings(self) -> dict:
        doc = await self.col.find_one({'_id': self.DOC_ID}) or {}
        return {**self.DEFAULTS, **{k: v for k, v in doc.items() if k != '_id'}}

    async def update_settings(self, changes: dict) -> dict:
        await self.col.update_one({'_id': self.DOC_ID}, {'$set': changes}, upsert=True)
        return await self.get_settings()


class AttachmentRepository(MongoRepository):
    """Photos and voice notes; listing never loads the binary content."""
    collection_name = 'attachments'
    entity_name = 'attachment'

    async def for_incident(self, incident_id) -> list:
        return await self.find({'incident_id': str(incident_id)}, sort=[('created_at', 1)], projection={'data': 0},
                               limit=200)

    async def count_for(self, incident_id, kind=None) -> int:
        q = {'incident_id': str(incident_id)}
        if kind:
            q['kind'] = kind
        return await self.count(q)


class HandoverRepository(MongoRepository):
    """One handover code per on-site incident, kept apart from the incident so it never leaks in listings."""
    collection_name = 'handover_codes'
    entity_name = 'handover code'

    async def for_incident(self, incident_id) -> Optional[dict]:
        return await self.col.find_one({'incident_id': str(incident_id)})

    async def save(self, code) -> None:
        await self.col.update_one({'incident_id': code.incident_id}, {'$set': code.to_doc()}, upsert=True)


class AssetRepository(MongoRepository):
    """Physical things with a QR sticker (lab PCs, routers, projectors, rooms)."""
    collection_name = 'assets'
    entity_name = 'asset'

    async def by_code(self, code) -> Optional[dict]:
        return await self.col.find_one({'code': str(code or '').strip().upper()})

    async def next_code(self) -> str:
        n = await self.db.counters.find_one_and_update({'_id': 'asset'}, {'$inc': {'value': 1}}, upsert=True,
                                                       return_document=ReturnDocument.AFTER)
        return f"AST-{n['value']:04d}"


class BuildingPinRepository(MongoRepository):
    """Admin corrections to the default building pins (see app/domain/geo.py)."""
    collection_name = 'building_pins'
    entity_name = 'building pin'

    async def overrides(self) -> dict:
        return {d['name']: {'lat': d['lat'], 'lng': d['lng']} for d in await self.find({}, limit=500)}

    async def set_pin(self, name, lat, lng, by) -> None:
        await self.col.update_one({'name': name}, {'$set': {'name': name, 'lat': lat, 'lng': lng, 'updated_by': by}},
                                  upsert=True)

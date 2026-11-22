"""Domain model: the core business objects of BITS reports.

    User (abstract)                    Incident (aggregate root)
     ├── Employee     (customer)        ├── Location        (composition)
     ├── Technician                     ├── SLA tracking    (composition, app/domain/sla.py)
     ├── Administrator                  ├── Note[]          (composition)
     └── SystemActor  (automation)      ├── Resolution      (composition)
                                        ├── Closure         (composition)
    ItService, SlaPolicy, Category      ├── reporter  → User        (association)
                                        ├── assignee  → Technician  (association)
                                        ├── service   → ItService   (association)
                                        └── state     → IncidentState (State pattern)

Inheritance is used only for real "is-a" relationships (an Employee *is a*
User). Incidents *have* locations, notes and resolutions, so those are
composed. Fields are kept private and exposed through read-only properties;
state only changes through methods that enforce the business rules.

Persistence is MongoDB, so every class can convert itself to and from a
document (`from_doc` / `to_doc`). The rest of the app never edits incident
documents directly; it asks the Incident to change and saves `changes()`.
"""
from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional

from app.domain.enums import Role, IncidentStatus as S, Priority, OPEN_STATUSES
from app.domain.exceptions import InvalidInputError, InvalidStateTransitionError, WorkloadExceededError
from app.domain.sla import build_sla, evaluate_sla, utcnow
from app.domain.state import StateFactory


# ───────────────────────────── Users ─────────────────────────────

class User(ABC):
    """Anyone who can act on the system. Subclasses define what they may see/do."""
    role: Role

    def __init__(self, id: Optional[str], name: str, email: Optional[str], phone: Optional[str] = None,
                 is_active: bool = True):
        if not (name or '').strip():
            raise InvalidInputError('Name is required')
        self._id = id
        self._name = name.strip()
        self._email = (email or '').strip().lower() or None
        self._phone = (phone or '').strip() or None
        self._is_active = bool(is_active)

    id = property(lambda self: self._id)
    name = property(lambda self: self._name)
    email = property(lambda self: self._email)
    phone = property(lambda self: self._phone)
    is_active = property(lambda self: self._is_active)

    @abstractmethod
    def can_view(self, incident: 'Incident') -> bool:
        """Polymorphic access rule: each kind of user sees different incidents."""

    def can_manage_configuration(self) -> bool:
        return False

    def describe(self) -> str:
        return f'{self._name} ({self.role.value})'

    def to_doc(self, password_hash: str) -> dict:
        """Document stored in the `users` collection."""
        return {'name': self._name, 'email': self._email, 'phone': self._phone, 'role': self.role.value,
                'is_active': self._is_active, 'password_hash': password_hash, 'created_at': utcnow(),
                **self._extra_fields()}

    def _extra_fields(self) -> dict:
        return {'skills': [], 'max_concurrent': 0}

    def to_actor(self) -> dict:
        """Lightweight description used in events and audit records."""
        return {'id': self._id, 'name': self._name, 'role': self.role.value, 'email': self._email}


class Employee(User):
    """A student/employee who reports incidents (role 'customer' in the API)."""
    role = Role.CUSTOMER

    def __init__(self, *args, student_id: Optional[str] = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._student_id = student_id

    student_id = property(lambda self: self._student_id)

    def can_view(self, incident):
        return incident.reporter_id == self._id

    def _extra_fields(self):
        return {'skills': [], 'max_concurrent': 0, 'student_id': self._student_id}


class Technician(User):
    """Support engineer with skills and a concurrent-workload limit."""
    role = Role.TECHNICIAN
    MAX_CAPACITY = 50

    def __init__(self, *args, skills=None, max_concurrent: int = 5, **kwargs):
        super().__init__(*args, **kwargs)
        if not 1 <= int(max_concurrent) <= self.MAX_CAPACITY:
            raise InvalidInputError(f'max_concurrent must be between 1 and {self.MAX_CAPACITY}')
        self._skills = tuple(dict.fromkeys(s.strip() for s in (skills or []) if s and s.strip()))
        self._max_concurrent = int(max_concurrent)

    skills = property(lambda self: list(self._skills))
    max_concurrent = property(lambda self: self._max_concurrent)

    def has_skill(self, category: str) -> bool:
        return category in self._skills

    def ensure_capacity(self, open_count: int, priority: str):
        """P1 incidents may exceed capacity; everything else may not."""
        if open_count >= self._max_concurrent and priority != Priority.P1.value:
            raise WorkloadExceededError(
                f'{self._name} already has {open_count} open incidents (limit {self._max_concurrent})')

    def can_view(self, incident):
        return (not incident.assigned_to or incident.assigned_to == self._id
                or incident.status in (S.NEW, S.CLASSIFIED))

    def _extra_fields(self):
        return {'skills': list(self._skills), 'max_concurrent': self._max_concurrent}


class Administrator(User):
    """IT manager / administrator with full access."""
    role = Role.ADMIN

    def can_view(self, incident):
        return True

    def can_manage_configuration(self):
        return True

    def _extra_fields(self):
        return {'skills': [], 'max_concurrent': 99}


class SystemActor(User):
    """The automation itself (SLA monitor, escalation, auto-assignment)."""
    role = Role.SYSTEM

    def __init__(self, name='BITS reports automation'):
        super().__init__('system', name, None)

    def can_view(self, incident):
        return True


SYSTEM = SystemActor()


class UserFactory:
    """Factory pattern: builds the right User subclass for a role."""
    _registry = {Role.CUSTOMER: Employee, Role.TECHNICIAN: Technician, Role.ADMIN: Administrator}

    @classmethod
    def create(cls, role, *, name, email, phone=None, student_id=None, skills=None, max_concurrent=5,
               is_active=True, id=None) -> User:
        try:
            role = Role(role)
        except ValueError as exc:
            raise InvalidInputError(f"Unknown role '{role}'") from exc
        if role == Role.SYSTEM:
            return SYSTEM
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', (email or '').strip()):
            raise InvalidInputError('A valid email address is required')
        common = dict(id=id, name=name, email=email, phone=phone, is_active=is_active)
        if role == Role.CUSTOMER:
            return Employee(student_id=student_id, **common)
        if role == Role.TECHNICIAN:
            return Technician(skills=skills, max_concurrent=max_concurrent, **common)
        return Administrator(**common)

    @classmethod
    def from_doc(cls, doc: dict) -> User:
        """From a Mongo document or the public user dict used by the API."""
        if doc.get('role') == Role.SYSTEM.value:
            return SYSTEM
        return cls.create(doc.get('role'), id=str(doc.get('_id') or doc.get('id')), name=doc.get('name') or '?',
                          email=doc.get('email') or 'unknown@invalid.local', phone=doc.get('phone'),
                          student_id=doc.get('student_id'), skills=doc.get('skills'),
                          max_concurrent=max(1, min(int(doc.get('max_concurrent') or 5), Technician.MAX_CAPACITY)),
                          is_active=doc.get('is_active', True))


# ───────────────────────── Catalog value objects ─────────────────────────

@dataclass(frozen=True)
class ItService:
    id: str
    name: str
    description: str = ''
    criticality: int = 1     # 1 = low, 3 = business critical

    @classmethod
    def from_doc(cls, d):
        return cls(str(d['_id']), d['name'], d.get('description', ''), int(d.get('criticality', 1)))


@dataclass(frozen=True)
class SlaPolicy:
    id: str
    name: str
    priority: str
    response_minutes: int
    resolution_minutes: int
    service_id: Optional[str] = None

    @classmethod
    def from_doc(cls, d):
        return cls(str(d.get('_id', '')), d.get('name', 'Default SLA'), d['priority'], int(d['response_minutes']),
                   int(d['resolution_minutes']), d.get('service_id'))

    def start_clock(self, created: datetime) -> dict:
        """SLA calculation: deadlines for an incident created at `created`."""
        return build_sla({'_id': self.id, 'name': self.name, 'response_minutes': self.response_minutes,
                          'resolution_minutes': self.resolution_minutes}, created)


# ───────────────────────────── Incident parts ─────────────────────────────

LOCATION_TYPES = ('online', 'hostel', 'academics')


@dataclass(frozen=True)
class Location:
    type: str = 'online'
    academic_block: Optional[str] = None
    hostel_name: Optional[str] = None
    room_number: Optional[str] = None

    def __post_init__(self):
        if self.type not in LOCATION_TYPES:
            raise InvalidInputError("location_type must be 'online', 'hostel' or 'academics'")

    @property
    def formatted(self) -> str:
        if self.type == 'online':
            place = ', '.join(x for x in (self.hostel_name or self.academic_block,
                                          f'Room {self.room_number}' if self.room_number else None) if x)
            return f'Online assistance — {place}' if place else 'Online assistance'
        if self.type == 'hostel':
            room = f'Room {self.room_number}' if self.room_number else ''
            return f"{self.hostel_name or 'Hostel'}, {room}".strip(', ')
        room = f'Room/Lab {self.room_number}' if self.room_number else ''
        return f"{self.academic_block or 'Academic Block'}, {room}".strip(', ')

    def to_doc(self):
        return {**asdict(self), 'formatted': self.formatted}

    @classmethod
    def from_doc(cls, d):
        d = d or {}
        return cls(d.get('type') or 'academics', d.get('academic_block'), d.get('hostel_name'), d.get('room_number'))


@dataclass(frozen=True)
class Note:
    id: str
    text: str
    kind: str
    author_id: str
    author_name: str
    created_at: str

    def to_doc(self):
        return asdict(self)


@dataclass(frozen=True)
class Resolution:
    summary: str
    root_cause: str
    resolved_at: str
    resolved_by: str

    def __post_init__(self):
        if not (self.summary or '').strip():
            raise InvalidInputError('Resolution summary is required')

    def to_doc(self):
        return asdict(self)


@dataclass(frozen=True)
class Closure:
    feedback_rating: int
    feedback_comment: str
    closed_at: str
    closed_by: str

    def __post_init__(self):
        if not 1 <= int(self.feedback_rating) <= 5:
            raise InvalidInputError('Feedback rating must be between 1 and 5')

    def to_doc(self):
        return asdict(self)


# ───────────────────────────── Incident ─────────────────────────────

class Incident:
    """Aggregate root for one incident.

    Wraps the stored document, keeps the lifecycle State object in sync and
    records every field it changes so the repository can save only those.
    """

    def __init__(self, doc: dict):
        self._doc = dict(doc)
        self._state = StateFactory.get(self._doc.get('status', S.NEW.value))
        self._changes: dict = {}
        self._new_notes: list = []

    # ---- read-only view ----
    id = property(lambda self: str(self._doc['_id']) if self._doc.get('_id') is not None else None)
    number = property(lambda self: self._doc.get('number'))
    title = property(lambda self: self._doc.get('title'))
    description = property(lambda self: self._doc.get('description'))
    category = property(lambda self: self._doc.get('category'))
    service_id = property(lambda self: self._doc.get('service_id'))
    service_name = property(lambda self: self._doc.get('service_name'))
    reporter_id = property(lambda self: self._doc.get('reporter_id'))
    assigned_to = property(lambda self: self._doc.get('assigned_to'))
    assigned_name = property(lambda self: self._doc.get('assigned_name'))
    priority = property(lambda self: self._doc.get('priority'))
    created_at = property(lambda self: self._doc.get('created_at'))
    status = property(lambda self: S(self._doc.get('status', S.NEW.value)))
    sla = property(lambda self: dict(self._doc.get('sla') or {}))
    location = property(lambda self: Location.from_doc(self._doc.get('location')))
    escalation = property(lambda self: dict(self._doc.get('escalation') or {}))
    field_visit = property(lambda self: dict(self._doc.get('field_visit') or {}))

    @property
    def geo(self):
        from app.domain.geo import GeoPoint
        return GeoPoint.from_doc(self._doc.get('geo'))

    @property
    def is_on_site(self) -> bool:
        """Hostel and academic-block issues need someone to walk there."""
        return self.location.type in ('hostel', 'academics')

    @property
    def building(self):
        loc = self.location
        return loc.hostel_name if loc.type == 'hostel' else loc.academic_block if loc.type == 'academics' \
            else (loc.hostel_name or loc.academic_block)

    @property
    def is_open(self):
        return self.status.value in OPEN_STATUSES

    @property
    def is_acknowledged(self):
        return bool(self.sla.get('responded_at'))

    def allowed_targets(self, role: Role):
        return self._state.allowed_targets(role)

    def to_doc(self) -> dict:
        return dict(self._doc)

    def changes(self) -> dict:
        return dict(self._changes)

    def new_notes(self) -> list:
        return list(self._new_notes)

    def mark_saved(self):
        """Called by the repository once changes are persisted."""
        self._changes = {}
        self._new_notes = []

    def snapshot(self) -> dict:
        """Small summary used in events, notifications and audit records."""
        d = self._doc
        return {k: d.get(k) for k in ('number', 'title', 'priority', 'status', 'category', 'service_id',
                                      'service_name', 'reporter_id', 'reporter_name', 'reporter_email',
                                      'assigned_to', 'assigned_name')} | {'id': self.id}

    def _set(self, key, value):
        self._doc[key] = value
        self._changes[key] = value

    def _touch(self, now: datetime):
        self._set('updated_at', now.isoformat())

    # ---- behaviour ----
    def transition_to(self, target: S, role: Role, now: datetime) -> S:
        """Change status through the State pattern; returns the previous status."""
        previous = self.status
        self._state = self._state.transition(target, role)
        self._set('status', target.value)
        self._touch(now)
        return previous

    def classify(self, category: str, now: datetime) -> S:
        """NEW → CLASSIFIED, performed by the system once a category is known."""
        if not category:
            raise InvalidInputError('An incident needs a category before it can be classified')
        self._set('category', category)
        return self.transition_to(S.CLASSIFIED, Role.SYSTEM, now)

    def apply_priority(self, result, policy: SlaPolicy, now: datetime) -> Optional[str]:
        """Set priority/score; restarts the SLA clock if the priority changed. Returns the old priority."""
        old = self._doc.get('priority')
        self._set('priority', result.priority.value)
        self._set('score', result.score)
        self._set('strategy', result.strategy)
        if old != result.priority.value or not self._doc.get('sla'):
            from app.domain.sla import parse_dt
            created = parse_dt(self._doc.get('created_at')) or now
            new_sla = policy.start_clock(created)
            previous = self._doc.get('sla') or {}
            new_sla.update({k: previous.get(k) for k in ('responded_at', 'resolved_at', 'violations_recorded')
                            if previous.get(k)})
            self._set('sla', evaluate_sla(new_sla, now))
        self._touch(now)
        return old

    def assign_to(self, technician: Technician, open_count: int, actor_role: Role, now: datetime) -> S:
        if self.status not in (S.CLASSIFIED, S.ASSIGNED):
            raise InvalidStateTransitionError('Only classified or assigned incidents can be (re)assigned')
        technician.ensure_capacity(open_count, self.priority)
        previous = self.status
        if self.status == S.CLASSIFIED:
            self.transition_to(S.ASSIGNED, actor_role, now)
        self._set('assigned_to', technician.id)
        self._set('assigned_name', technician.name)
        self._touch(now)
        return previous

    def acknowledge(self, now: datetime):
        sla = self.sla
        if not sla.get('responded_at'):
            sla['responded_at'] = now.isoformat()
        self._set('sla', evaluate_sla(sla, now))

    def resolve(self, summary: str, root_cause: str, by: User, now: datetime):
        resolution = Resolution(summary.strip(), (root_cause or '').strip(), now.isoformat(), by.id)
        self._set('resolution', resolution.to_doc())
        self._set('sla', evaluate_sla({**self.sla, 'resolved_at': now.isoformat()}, now))

    def reopen(self, now: datetime):
        """RESOLVED → IN_PROGRESS: the fix did not work, so SLA tracking resumes."""
        self._set('resolution', None)
        self._set('sla', evaluate_sla({**self.sla, 'resolved_at': None}, now))

    def close(self, rating: Optional[int], comment: Optional[str], by: User, now: datetime):
        closure = Closure(int(rating or 5), (comment or '').strip()[:1000], now.isoformat(), by.id)
        self._set('closure', closure.to_doc())

    def note(self, text: str, kind: str, author: User, now: datetime, note_id: str) -> Note:
        n = Note(note_id, text, kind, author.id, author.name, now.isoformat())
        self._doc['notes'] = list(self._doc.get('notes') or []) + [n.to_doc()]
        self._new_notes.append(n.to_doc())
        self._touch(now)
        return n

    def update_details(self, changes: dict, now: datetime):
        if self.status == S.CLOSED:
            raise InvalidStateTransitionError('Closed incidents cannot be edited')
        location_keys = {'location_type', 'academic_block', 'hostel_name', 'room_number'}
        loc = {k: changes.pop(k) for k in list(changes) if k in location_keys}
        if loc:
            old = self.location
            self._set('location', Location(
                (loc.get('location_type') or old.type).lower(),
                loc.get('academic_block', old.academic_block), loc.get('hostel_name', old.hostel_name),
                loc.get('room_number', old.room_number)).to_doc())
        for key, value in changes.items():
            self._set(key, value)
        self._touch(now)

    def refresh_sla(self, now: datetime) -> tuple:
        """Re-evaluate SLA; returns (old_status, new_status, sla)."""
        old = self.sla
        new = evaluate_sla(old, now)
        if any(new.get(k) != old.get(k) for k in ('status', 'response_breached', 'resolution_breached')):
            self._set('sla', new)
        return old.get('status'), new.get('status'), new

    def mark_violation_recorded(self, kind: str):
        sla = self.sla
        recorded = list(sla.get('violations_recorded') or [])
        if kind not in recorded:
            recorded.append(kind)
            sla['violations_recorded'] = recorded
            self._set('sla', sla)

    # ---- field visit (technician walks to the issue) ----
    def set_geo(self, point, now: datetime):
        self._set('geo', point.to_doc() if point else None)
        self._touch(now)

    def _ensure_field_work_allowed(self, technician_id: str, actor_role: Role):
        if not self.is_on_site:
            raise InvalidInputError('This is an online issue; there is no location to visit')
        if self.status not in (S.ASSIGNED, S.ACKNOWLEDGED, S.IN_PROGRESS, S.PENDING_INFO):
            raise InvalidStateTransitionError('A visit can only be logged while the incident is assigned and open')
        if actor_role != Role.ADMIN and self.assigned_to != technician_id:
            raise InvalidStateTransitionError('Only the assigned technician can log a visit')

    def start_trip(self, technician: User, now: datetime):
        self._ensure_field_work_allowed(technician.id, technician.role)
        visit = self.field_visit
        visit.update({'status': 'EN_ROUTE', 'technician_id': technician.id, 'technician_name': technician.name,
                      'en_route_at': now.isoformat(), 'arrived_at': None, 'verified': None, 'distance_m': None})
        self._set('field_visit', visit)
        self._touch(now)

    def arrive(self, technician: User, point, check, now: datetime):
        """Record arrival. `check` is an ArrivalCheck, or None when no GPS fix was available."""
        self._ensure_field_work_allowed(technician.id, technician.role)
        visit = self.field_visit
        visit.update({'status': 'ARRIVED', 'technician_id': technician.id, 'technician_name': technician.name,
                      'en_route_at': visit.get('en_route_at'), 'arrived_at': now.isoformat(),
                      'arrival_point': point.to_doc() if point else None,
                      'distance_m': check.distance_m if check else None,
                      'verified': bool(check and check.verified)})
        self._set('field_visit', visit)
        self._touch(now)

    def record_handover(self, by_user_id: str, now: datetime):
        visit = self.field_visit
        visit['handover_verified_at'] = now.isoformat()
        visit['handover_verified_by'] = by_user_id
        self._set('field_visit', visit)

    def escalate(self, level: int, label: str, now: datetime):
        current = self.escalation
        history = list(current.get('history') or [])
        history.append({'level': level, 'label': label, 'at': now.isoformat()})
        self._set('escalation', {'level': level, 'label': label, 'escalated_at': now.isoformat(),
                                 'history': history})


class IncidentFactory:
    """Factory pattern: builds a brand-new incident in the NEW state."""

    @staticmethod
    def create(*, number: str, title: str, description: str, category: str, service: ItService,
               reporter: User, location: Location, impact: int, urgency: int, business_criticality: int,
               affected_users: int, phone: Optional[str], student_id: Optional[str], duplicates: list,
               now: datetime, visit_availability: Optional[str] = None, geo=None,
               asset: Optional[dict] = None) -> Incident:
        if not (title or '').strip() or len(title.strip()) < 4:
            raise InvalidInputError('Title must be at least 4 characters')
        doc = {
            'number': number, 'title': title.strip(), 'description': description.strip(), 'category': category,
            'service_id': service.id, 'service_name': service.name, 'service_criticality': service.criticality,
            'reporter_id': reporter.id, 'reporter_name': reporter.name, 'reporter_email': reporter.email,
            'student_id': student_id, 'phone': phone, 'location': location.to_doc(), 'visit_availability': visit_availability,
            'impact': impact, 'urgency': urgency, 'business_criticality': business_criticality,
            'affected_users': affected_users, 'priority': None, 'score': None, 'strategy': None,
            'status': S.NEW.value, 'assigned_to': None, 'assigned_name': None, 'sla': None, 'notes': [],
            'resolution': None, 'closure': None, 'escalation': None, 'possible_duplicates': duplicates,
            'geo': geo.to_doc() if geo else None, 'field_visit': None,
            'asset': {'code': asset['code'], 'name': asset['name']} if asset else None,
            'created_at': now.isoformat(), 'updated_at': now.isoformat(),
        }
        return Incident(doc)

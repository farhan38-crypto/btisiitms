"""Application service for the incident lifecycle.

Composition: IncidentService *has* repositories (persistence), an
IntelligenceService (duplicates, recommendations), the settings (which
strategies to use) and an EventBus (notifications/audit via observers).
It coordinates them; the business rules themselves live in the domain
objects (Incident, Technician, IncidentState, strategies).
"""
import logging
import re
from datetime import date, timedelta

from bson import ObjectId

from app.domain.enums import Role, IncidentStatus as S
from app.domain.events import EventBus, IncidentEvent, EventType as E
from app.domain.exceptions import (InvalidInputError, UnauthorizedOperationError, InvalidStateTransitionError,
                                   DuplicateIncidentError, MissingSlaConfigError, ServiceNotFoundError,
                                   ResourceNotFoundError, TechnicianUnavailableError, OutOfScopeError)
from app.domain.models import (Incident, IncidentFactory, Location, ItService, SlaPolicy, Technician, UserFactory,
                               SYSTEM, User)
from app.domain.sla import utcnow
from app.domain.strategies import PriorityInput, PriorityStrategyFactory, AssignmentStrategyFactory
from app.domain.geo import GeoPoint, CampusMap
from app.domain.handover import HandoverCode
from app.models.schemas import clean_doc

logger = logging.getLogger(__name__)

OFFLINE_SERVICE_BY_CATEGORY = {
    'Carpenter Needed': 'Carpenter Support',
    'Electrician Needed': 'Electrician Support',
    'Technician Needed': 'Technician Support',
}

# Which event describes a move to each status (default: STATUS_CHANGED).
TRANSITION_EVENTS = {S.PENDING_INFO: E.INFO_REQUESTED, S.RESOLVED: E.RESOLVED, S.CLOSED: E.CLOSED}


def _duration(minutes: int) -> str:
    if minutes < 60:
        return f'{minutes} min'
    if minutes < 1440:
        return f'{minutes / 60:g} h'
    days = minutes / 1440
    return f"{days:g} day{'' if days == 1 else 's'}"


def build_location(loc_type, academic_block=None, hostel_name=None, room_number=None):
    """Kept for backwards compatibility; Location is the source of truth."""
    return Location(loc_type, academic_block, hostel_name, room_number).to_doc()


class IncidentService:
    def __init__(self, incidents, users, services, categories, sla_policies, settings, audit, intel,
                 bus: EventBus, correlation_alerts=None, building_pins=None, handovers=None, assets=None):
        self.incidents = incidents
        self.users = users
        self.services = services
        self.categories = categories
        self.sla_policies = sla_policies
        self.settings = settings
        self.audit = audit
        self.intel = intel
        self.bus = bus
        self.correlation_alerts = correlation_alerts
        self.building_pins = building_pins
        self.handovers = handovers
        self.assets = assets

    # ───────────── helpers ─────────────
    @staticmethod
    def actor(user) -> User:
        return user if isinstance(user, User) else UserFactory.from_doc(user)

    async def get(self, iid) -> dict:
        return await self.incidents.get(iid)

    def assert_access(self, inc, user):
        if not self.actor(user).can_view(Incident(inc)):
            raise UnauthorizedOperationError('You do not have access to this incident')

    def allowed_transitions(self, inc, user):
        try:
            return [t.value for t in Incident(inc).allowed_targets(Role(user['role'])) if t != S.ASSIGNED]
        except Exception:
            return []

    async def _publish(self, type_, incident: Incident, actor: User, description, previous=None, new=None, **data):
        await self.bus.publish(IncidentEvent(type_, incident.snapshot(), actor.to_actor(), description,
                                             previous.value if hasattr(previous, 'value') else previous,
                                             new.value if hasattr(new, 'value') else new, data))

    async def campus_map(self) -> CampusMap:
        return CampusMap(await self.building_pins.overrides() if self.building_pins else None)

    async def locate(self, location: Location, latitude=None, longitude=None, accuracy_m=None):
        """Best pin for an incident: the reporter's GPS fix, else the building's pin, else nothing (online)."""
        if latitude is not None and longitude is not None:
            return GeoPoint(latitude, longitude, accuracy_m, 'gps')
        building = location.hostel_name if location.type == 'hostel' else location.academic_block \
            if location.type == 'academics' else (location.hostel_name or location.academic_block)
        return (await self.campus_map()).pin_for(building)

    async def policy(self, priority, service_id) -> SlaPolicy:
        doc = await self.sla_policies.find_for(priority, service_id)
        if not doc:
            raise MissingSlaConfigError(f'No SLA policy is configured for priority {priority}. '
                                        'Add one under SLA & Strategy.')
        return SlaPolicy.from_doc(doc)

    async def calculate_priority(self, impact, urgency, business_criticality, affected_users, service_criticality):
        settings = await self.settings.get_settings()
        strategy = PriorityStrategyFactory.get(settings['priority_strategy'])
        return strategy.calculate(PriorityInput(impact, urgency, business_criticality, affected_users,
                                                max(1, min(3, int(service_criticality or 1)))))

    # ───────────── create ─────────────
    async def create(self, data, user):
        reporter = self.actor(user)
        now = utcnow()
        scope = self.intel.scope_rules.assess(data.title, data.description)
        if not scope.in_scope and not getattr(data, 'confirm_in_scope', False):
            raise OutOfScopeError(scope.title, scope=scope.to_dict())
        dup = await self.intel.find_duplicates(data.title, data.description, data.service_id)
        if dup and not data.acknowledge_duplicate:
            raise DuplicateIncidentError(f"Possible duplicate incident: {dup[0]['number']}")
        try:
            service = ItService.from_doc(await self.services.get(data.service_id))
        except ResourceNotFoundError as exc:
            raise ServiceNotFoundError('Service not found') from exc
        if not await self.categories.by_name(data.category):
            raise ResourceNotFoundError('Category not found')
        location = Location((data.location_type or 'academics').lower(), data.academic_block, data.hostel_name,
                            data.room_number)
        if location.type == 'hostel' and data.category not in OFFLINE_SERVICE_BY_CATEGORY:
            raise InvalidInputError('Choose Carpenter, Electrician, or Technician support for a hostel issue')
        if location.type in ('hostel', 'academics') and data.category in OFFLINE_SERVICE_BY_CATEGORY \
                and service.name != OFFLINE_SERVICE_BY_CATEGORY[data.category]:
            raise InvalidInputError('The selected service must match the requested offline support')

        student_id = data.student_id or user.get('student_id')
        if not student_id and user.get('email'):
            prefix = user['email'].split('@')[0]
            m = re.search(r'\d{6,10}', prefix)
            student_id = m.group(0) if m else re.sub(r'^[a-zA-Z]+', '', prefix)

        pr = await self.calculate_priority(data.impact, data.urgency, data.business_criticality,
                                           data.affected_users, service.criticality)
        policy = await self.policy(pr.priority.value, service.id)
        asset = None
        if getattr(data, 'asset_code', None) and self.assets:
            asset = await self.assets.by_code(data.asset_code)
            if not asset:
                raise ResourceNotFoundError(f'No equipment is registered with the code {data.asset_code}')
        geo = await self.locate(location, getattr(data, 'latitude', None), getattr(data, 'longitude', None),
                                getattr(data, 'accuracy_m', None))

        incident = IncidentFactory.create(
            number=await self.incidents.next_number(), title=data.title, description=data.description,
            category=data.category, service=service, reporter=reporter, location=location, impact=data.impact,
            urgency=data.urgency, business_criticality=data.business_criticality,
            affected_users=data.affected_users, phone=data.phone or user.get('phone'), student_id=student_id,
            duplicates=dup, now=now,
            visit_availability=(data.visit_availability or '').strip() or None if location.type != 'online' else None,
            geo=geo, asset=asset)
        incident.classify(data.category, now)                 # NEW → CLASSIFIED (system)
        incident.apply_priority(pr, policy, now)              # priority + SLA clock
        doc = await self.incidents.add(incident.to_doc())
        incident = Incident(doc)

        sla = incident.sla
        await self._publish(E.INCIDENT_CREATED, incident, reporter,
                            f'{incident.number} reported by {reporter.describe()} at {location.formatted}', None, S.NEW)
        await self._publish(E.INCIDENT_CLASSIFIED, incident, SYSTEM,
                            f'Classified as {incident.category} (service: {service.name})', S.NEW, S.CLASSIFIED)
        await self._publish(E.PRIORITY_CALCULATED, incident, SYSTEM,
                            f'Priority calculated as {pr.priority.value} using the {pr.strategy} strategy '
                            f'({pr.explanation})', priority=pr.priority.value, score=pr.score)
        await self._publish(E.SLA_APPLIED, incident, SYSTEM,
                            f"SLA '{policy.name}' applied: respond within {_duration(policy.response_minutes)}, "
                            f"resolve within {_duration(policy.resolution_minutes)}",
                            policy=policy.name, response_due_at=sla['response_due_at'],
                            resolution_due_at=sla['resolution_due_at'])
        if dup:
            await self._publish(E.INCIDENT_UPDATED, incident, SYSTEM,
                                'Possible duplicates detected: ' + ', '.join(d['number'] for d in dup[:5]))
        if geo is not None and geo.source == 'gps':
            await self._publish(E.LOCATION_CAPTURED, incident, reporter,
                                f'Exact location shared from the reporter\'s phone'
                                + (f' (±{geo.accuracy_m:g} m)' if geo.accuracy_m is not None else ''))
        if asset:
            await self._publish(E.INCIDENT_UPDATED, incident, reporter,
                                f"Reported by scanning the QR sticker on {asset['name']} ({asset['code']})")
        if self.handovers and location.type == 'hostel':
            await self.handovers.save(HandoverCode.issue(incident.id))
        if not scope.in_scope:
            # Keep a record that the reporter overrode the warning (without repeating the report's content).
            await self._publish(E.INCIDENT_UPDATED, incident, reporter,
                                f'Reporter confirmed this is an IT/facilities issue after a "{scope.kind.value}" warning')
        await self._check_correlation(incident, now)
        await self._check_building_cluster(incident, now)

        settings = await self.settings.get_settings()
        if settings.get('auto_assign_on_create'):
            try:
                await self.auto_assign(await self.get(incident.id), SYSTEM)
            except TechnicianUnavailableError as exc:
                logger.info(f'Auto-assignment on creation skipped for {incident.number}: {exc.message}')
        return await self.get(incident.id)

    async def _check_correlation(self, incident: Incident, now):
        """Raise one 'possible major incident' alert when a service gets several reports in a short window."""
        if not self.correlation_alerts:
            return
        s = await self.settings.get_settings()
        window, threshold = int(s['correlation_window_minutes']), int(s['correlation_threshold'])
        clusters = [c for c in await self.intel.correlation_clusters(window, threshold, now)
                    if c['service_id'] == incident.service_id]
        if not clusters:
            return
        since = (now - timedelta(minutes=window)).isoformat()
        if await self.correlation_alerts.count({'service_id': incident.service_id, 'created_at': {'$gte': since}}):
            return
        c = clusters[0]
        await self.correlation_alerts.add({'service_id': c['service_id'], 'service_name': c['service_name'],
                                           'count': c['count'], 'incident_numbers': [i['number'] for i in c['incidents']],
                                           'created_at': now.isoformat()})
        await self._publish(E.CORRELATION_DETECTED, incident, SYSTEM,
                            f"{c['count']} incidents on {c['service_name']} within {window} min "
                            f"({', '.join(i['number'] for i in c['incidents'])}) — possible major incident.",
                            incidents=[i['number'] for i in c['incidents']])

    async def _check_building_cluster(self, incident: Incident, now):
        """Raise one 'possible outage in <building>' alert when one building gets several reports quickly."""
        building = incident.building
        if not self.correlation_alerts or not building:
            return
        s = await self.settings.get_settings()
        window, threshold = int(s['correlation_window_minutes']), int(s['correlation_threshold'])
        clusters = [c for c in await self.intel.building_clusters(window, threshold, now) if c['building'] == building]
        if not clusters:
            return
        since = (now - timedelta(minutes=window)).isoformat()
        if await self.correlation_alerts.count({'building': building, 'created_at': {'$gte': since}}):
            return
        c = clusters[0]
        numbers = [i['number'] for i in c['incidents']]
        await self.correlation_alerts.add({'building': building, 'count': c['count'], 'incident_numbers': numbers,
                                           'created_at': now.isoformat()})
        await self._publish(E.CORRELATION_DETECTED, incident, SYSTEM,
                            f"{c['count']} reports from {building} within {window} min ({', '.join(numbers)}) "
                            '— possible building-wide outage.', incidents=numbers, building=building)

    # ───────────── search ─────────────
    @staticmethod
    def _parse_day(value, name):
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError as exc:
            raise InvalidInputError(f'{name} must be a date like 2026-11-01') from exc

    async def search(self, user, f):
        role = user['role']
        conditions = []
        if role == Role.CUSTOMER.value:
            conditions.append({'reporter_id': user['id']})
        elif role == Role.TECHNICIAN.value:
            scope = f.get('scope')
            if scope == 'assigned':
                conditions.append({'assigned_to': user['id']})
            elif scope == 'unassigned':
                conditions.append({'assigned_to': None})
            else:
                # Technicians only see their own work and the unassigned queue (matches Technician.can_view).
                conditions.append({'$or': [{'assigned_to': user['id']}, {'assigned_to': None}]})
        elif f.get('assigned_to'):
            conditions.append({'assigned_to': None if f['assigned_to'] == 'unassigned' else f['assigned_to']})

        if role != Role.CUSTOMER.value and f.get('reporter_id'):
            conditions.append({'reporter_id': f.get('reporter_id')})
        for k in ['status', 'priority', 'category', 'service_id']:
            if f.get(k):
                conditions.append({k: f[k]})
        if f.get('sla_status'):
            conditions.append({'sla.status': f['sla_status']})
        if f.get('escalated'):
            conditions.append({'escalation.level': {'$gte': 1}})
        if f.get('date_from'):
            conditions.append({'created_at': {'$gte': self._parse_day(f['date_from'], 'date_from').isoformat()}})
        if f.get('date_to'):
            end = self._parse_day(f['date_to'], 'date_to') + timedelta(days=1)
            conditions.append({'created_at': {'$lt': end.isoformat()}})
        if f.get('q'):
            query = re.escape(str(f['q']).strip())
            conditions.append({'$or': [{k: {'$regex': query, '$options': 'i'}}
                                       for k in ('number', 'title', 'description', 'location.formatted',
                                                 'reporter_name', 'student_id')]})
        limit = min(int(f.get('limit') or 300), 500)
        docs = await self.incidents.find({'$and': conditions} if conditions else {}, sort=[('created_at', -1)],
                                         limit=limit)
        return [clean_doc(d) for d in docs]

    # ───────────── assignment ─────────────
    async def assign(self, inc, tid, user, strategy_name=None):
        actor = self.actor(user)
        self.assert_access(inc, user)
        if actor.role == Role.TECHNICIAN and actor.id != tid:
            raise UnauthorizedOperationError('Technicians may only self-assign')
        try:
            tdoc = await self.users.get(tid)
        except ResourceNotFoundError as exc:
            raise ResourceNotFoundError('Technician not found') from exc
        if tdoc.get('role') != Role.TECHNICIAN.value or not tdoc.get('is_active', True):
            raise ResourceNotFoundError('Technician not found')
        technician = UserFactory.from_doc(tdoc)
        incident = Incident(inc)
        if incident.assigned_to == technician.id:
            return inc
        now = utcnow()
        open_count = await self.incidents.open_count_for(technician.id, exclude_id=incident.id)
        previous = incident.assign_to(technician, open_count, Role(actor.role.value) if actor.role != Role.SYSTEM
                                      else Role.SYSTEM, now)
        await self.incidents.save_changes(incident)
        await self.users.update(technician.id, {'last_assigned_at': now.isoformat()})
        how = f' using the {strategy_name} strategy' if strategy_name else ''
        await self._publish(E.ASSIGNED, incident, actor, f'Assigned to {technician.name}{how}', previous, S.ASSIGNED,
                            technician_id=technician.id, strategy=strategy_name)
        return await self.get(incident.id)

    async def auto_assign(self, inc, user):
        settings = await self.settings.get_settings()
        strategy = AssignmentStrategyFactory.get(settings['assignment_strategy'])
        profiles = await self.intel.profiles(inc)
        pick = strategy.select(inc, profiles)
        return await self.assign(inc, pick.id, user, strategy_name=strategy.name)

    # ───────────── lifecycle ─────────────
    async def record_sla_breaches(self, incident: Incident, actor=SYSTEM):
        """Publish SLA_BREACHED once per deadline (response / resolution)."""
        sla = incident.sla
        recorded = set(sla.get('violations_recorded') or [])
        events = []
        for kind in ('response', 'resolution'):
            if sla.get(f'{kind}_breached') and kind not in recorded:
                incident.mark_violation_recorded(kind)
                events.append((kind, sla.get(f'{kind}_due_at')))
        if events:
            await self.incidents.save_changes(incident)
        for kind, due in events:
            await self._publish(E.SLA_BREACHED, incident, actor,
                                f'SLA violated: the {kind} deadline was missed',
                                kind=kind, due_at=due)
        return len(events)

    async def transition(self, iid, data, user):
        actor = self.actor(user)
        inc = await self.get(iid)
        self.assert_access(inc, user)
        try:
            target = S(data.target_status)
        except ValueError as exc:
            raise InvalidInputError(f'Unknown incident status: {data.target_status}') from exc
        if target == S.ASSIGNED:
            raise InvalidStateTransitionError('Use the assignment endpoint to assign a technician')
        incident = Incident(inc)
        now = utcnow()
        if target == S.RESOLVED and not (data.resolution_summary or '').strip():
            raise InvalidInputError('Resolution summary is required')
        handover_note = None
        if target == S.RESOLVED and S.RESOLVED in incident.allowed_targets(actor.role):
            handover_note = await self._check_handover(incident, actor, getattr(data, 'handover_code', None), now)
        previous = incident.transition_to(target, actor.role, now)
        event = TRANSITION_EVENTS.get(target, E.STATUS_CHANGED)
        extra = {}
        if target == S.ACKNOWLEDGED:
            incident.acknowledge(now)
        elif target == S.RESOLVED:
            incident.resolve(data.resolution_summary, data.root_cause, actor, now)
            extra = {'summary': data.resolution_summary.strip()}
        elif target == S.IN_PROGRESS and previous == S.RESOLVED:
            incident.reopen(now)
            event = E.REOPENED
        elif target == S.CLOSED:
            incident.close(data.feedback_rating, getattr(data, 'feedback_comment', None), actor, now)
            extra = {'rating': data.feedback_rating or 5}
        await self.incidents.save_changes(incident)
        description = {
            E.RESOLVED: f'Resolved: {extra.get("summary", "")}',
            E.CLOSED: f'Closed with feedback {extra.get("rating")}/5',
            E.REOPENED: 'Reopened: the fix did not work',
            E.INFO_REQUESTED: 'Additional information requested from the reporter',
        }.get(event, f'{previous.value} → {target.value}')
        await self._publish(event, incident, actor, description, previous, target, **extra)
        if handover_note:
            await self._publish(E.HANDOVER_VERIFIED, incident, actor, handover_note)
        await self.record_sla_breaches(incident)
        return await self.get(incident.id)

    async def _check_handover(self, incident: Incident, actor: User, entered, now):
        """Hostel repairs: the technician must enter the student's 4-digit code to resolve.
        Returns the audit text when a code was checked (or bypassed by an admin)."""
        if not self.handovers or incident.location.type != 'hostel':
            return None
        doc = await self.handovers.for_incident(incident.id)
        if not doc or not (await self.settings.get_settings()).get('require_handover_code', True):
            return None
        code = HandoverCode.from_doc(doc)
        if code.verified_at:
            return None
        if actor.role == Role.ADMIN and not entered:
            return 'Resolved by an administrator without the handover code'
        try:
            code.verify(entered, actor.id, now)
        finally:
            await self.handovers.save(code)       # count wrong attempts even when the check fails
        incident.record_handover(actor.id, now)
        return 'Handover code confirmed: the student was present when the job was finished'

    async def add_note(self, iid, data, user):
        actor = self.actor(user)
        inc = await self.get(iid)
        self.assert_access(inc, user)
        incident = Incident(inc)
        if incident.status == S.CLOSED:
            raise InvalidStateTransitionError('Closed incidents cannot receive new notes')
        incident.note(data.text, data.kind, actor, utcnow(), str(ObjectId()))
        await self.incidents.save_changes(incident)
        await self._publish(E.NOTE_ADDED, incident, actor, f'Note added by {actor.name}', text=data.text)
        return await self.get(incident.id)

    async def update(self, iid, data, user):
        actor = self.actor(user)
        inc = await self.get(iid)
        self.assert_access(inc, user)
        changes = data.model_dump(exclude_none=True)
        if not changes:
            return inc
        incident = Incident(inc)
        now = utcnow()
        changed_fields = sorted(changes)
        incident.update_details(dict(changes), now)
        if {'location_type', 'academic_block', 'hostel_name'} & set(changes) and \
                (incident.geo is None or incident.geo.source != 'gps'):
            incident.set_geo(await self.locate(incident.location), now)
        old_priority = incident.priority
        if {'impact', 'urgency', 'business_criticality', 'affected_users'} & set(changes):
            d = incident.to_doc()
            svc_crit = d.get('service_criticality')
            if svc_crit is None and d.get('service_id'):
                try:
                    svc_crit = ItService.from_doc(await self.services.get(d['service_id'])).criticality
                except ResourceNotFoundError:
                    svc_crit = 1
            pr = await self.calculate_priority(d.get('impact', 2), d.get('urgency', 2), d.get('business_criticality', 1),
                                               d.get('affected_users', 1), svc_crit)
            incident.apply_priority(pr, await self.policy(pr.priority.value, d.get('service_id')), now)
        await self.incidents.save_changes(incident)
        await self._publish(E.INCIDENT_UPDATED, incident, actor, f'Updated: {", ".join(changed_fields)}',
                            fields=changed_fields)
        if incident.priority != old_priority:
            await self._publish(E.PRIORITY_CHANGED, incident, actor,
                                f'Priority changed from {old_priority} to {incident.priority}',
                                old_priority, incident.priority)
        return await self.get(incident.id)

"""Composition root: builds every repository, service and observer once and
wires them together (dependency injection by hand). Routers import the
ready-made objects from here instead of constructing their own."""
from app.core.db import db
from app.domain.events import EventBus, EventType
from app.repositories import (IncidentRepository, UserRepository, ServiceRepository, CategoryRepository,
                              SlaPolicyRepository, AuditRepository, NotificationRepository, SlaViolationRepository,
                              CorrelationAlertRepository, SettingsRepository, SecurityEventRepository,
                              AttachmentRepository, HandoverRepository, AssetRepository, BuildingPinRepository)
from app.services.incident_service import IncidentService
from app.services.intelligence import IntelligenceService
from app.services.notifications import (NotificationDispatcher, InAppChannel, SimulatedEmailChannel, SmtpEmailChannel,
                                        SmtpEmailAdapter)
from app.services.observers import AuditObserver, NotificationObserver, SlaViolationObserver
from app.services.sla_monitor import SlaMonitor
from app.services.field_service import FieldVisitService, AttachmentService
from app.services.live import LiveHub, LiveEventObserver
from app.services.two_factor import TwoFactorService


class Container:
    def __init__(self, database):
        self.db = database
        # Repositories
        self.incidents = IncidentRepository(database)
        self.users = UserRepository(database)
        self.services = ServiceRepository(database)
        self.categories = CategoryRepository(database)
        self.sla_policies = SlaPolicyRepository(database)
        self.audit = AuditRepository(database)
        self.notifications = NotificationRepository(database)
        self.sla_violations = SlaViolationRepository(database)
        self.correlation_alerts = CorrelationAlertRepository(database)
        self.settings = SettingsRepository(database)
        self.security_log = SecurityEventRepository(database)
        self.two_factor = TwoFactorService(database, self.security_log)
        self.attachments = AttachmentRepository(database)
        self.handovers = HandoverRepository(database)
        self.assets = AssetRepository(database)
        self.building_pins = BuildingPinRepository(database)

        # Notification mechanisms (add a channel here to support SMS/push later)
        self.email_sender = SmtpEmailAdapter()
        self.dispatcher = NotificationDispatcher([
            InAppChannel(database),
            SimulatedEmailChannel(database),
            SmtpEmailChannel(database, self.email_sender),
        ])

        # Observer pattern: who reacts to incident events
        self.bus = EventBus()
        self.bus.subscribe(AuditObserver(self.audit))
        self.bus.subscribe(SlaViolationObserver(self.sla_violations), {EventType.SLA_BREACHED})
        self.bus.subscribe(NotificationObserver(self.users, self.dispatcher))
        self.live = LiveHub()
        self.bus.subscribe(LiveEventObserver(self.live))       # pushes events to open browser tabs (SSE)

        self.intel = IntelligenceService(database)
        self.incident_service = IncidentService(
            self.incidents, self.users, self.services, self.categories, self.sla_policies, self.settings,
            self.audit, self.intel, self.bus, self.correlation_alerts, self.building_pins, self.handovers,
            self.assets)
        self.field_visits = FieldVisitService(self.incident_service, self.handovers, self.settings)
        self.attachment_service = AttachmentService(self.incident_service, self.attachments)
        self.sla_monitor = SlaMonitor(self.incidents, self.users, self.settings, self.bus, self.incident_service)


container = Container(db)

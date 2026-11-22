"""Tests for the project-brief features: OOP domain model, configurable
strategies, notifications, SLA monitoring/escalation, correlation, suggested
resolutions, search filters, admin configuration and audit logs."""
import time
from datetime import timedelta

import pytest
from httpx import AsyncClient, ASGITransport

from server import app
from app.core.container import container
from app.core.db import init_db
from app.domain.enums import Role, IncidentStatus as S
from app.domain.exceptions import (InvalidInputError, WorkloadExceededError, TechnicianUnavailableError,
                                   InvalidStateTransitionError, UnauthorizedOperationError)
from app.domain.models import (UserFactory, Employee, Technician, Administrator, Location, IncidentFactory, ItService,
                               SlaPolicy, Incident, SYSTEM)
from app.domain.sla import utcnow, parse_dt
from app.domain.strategies import (AssignmentStrategyFactory, TechnicianProfile, PriorityInput,
                                   WeightedScorePriorityStrategy, PriorityBasedStrategy, ExperienceBasedStrategy)


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module", autouse=True)
async def setup_db(anyio_backend):
    await init_db()
    yield
    await container.settings.update_settings(dict(container.settings.DEFAULTS))


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def login(ac, email, password):
    r = await ac.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]


async def service_id(ac, h, name):
    return next(s["id"] for s in (await ac.get("/api/catalog/services", headers=h)).json() if s["name"] == name)


async def report(ac, h, service, category="Network", impact=1, urgency=1, title=None, description=None, **extra):
    ts = time.time_ns()
    r = await ac.post("/api/incidents", headers=h, json={
        "title": title or f"Feature test incident {ts}", "description": description or f"Feature test description {ts}",
        "category": category, "service_id": service, "impact": impact, "urgency": urgency,
        "location_type": "online", "acknowledge_duplicate": True, **extra})
    assert r.status_code == 201, r.text
    return r.json()


async def notifications_for(user_id):
    return await container.db.notifications.find({"user_id": user_id}).to_list(1000)


# ───────────────────────── domain model (unit) ─────────────────────────

def test_user_factory_builds_the_right_subclass():
    assert isinstance(UserFactory.create('customer', name='A', email='a@x.io'), Employee)
    assert isinstance(UserFactory.create('technician', name='T', email='t@x.io', skills=['Network']), Technician)
    assert isinstance(UserFactory.create('admin', name='M', email='m@x.io'), Administrator)
    with pytest.raises(InvalidInputError):
        UserFactory.create('wizard', name='W', email='w@x.io')
    with pytest.raises(InvalidInputError):
        UserFactory.create('customer', name='A', email='not-an-email')


def test_polymorphic_access_rules():
    inc = Incident({'_id': 'x', 'status': 'ASSIGNED', 'reporter_id': 'r1', 'assigned_to': 't1'})
    assert Employee('r1', 'R', 'r@x.io').can_view(inc)
    assert not Employee('r2', 'R2', 'r2@x.io').can_view(inc)
    assert Technician('t1', 'T', 't@x.io').can_view(inc)
    assert not Technician('t2', 'T2', 't2@x.io').can_view(inc)
    assert Administrator('a', 'A', 'a@x.io').can_view(inc)


def test_technician_capacity_boundary():
    t = Technician('t', 'T', 't@x.io', max_concurrent=2)
    t.ensure_capacity(1, 'P3')                      # below the limit
    with pytest.raises(WorkloadExceededError):
        t.ensure_capacity(2, 'P3')                  # exactly at the limit
    t.ensure_capacity(2, 'P1')                      # P1 may exceed capacity
    assert issubclass(WorkloadExceededError, TechnicianUnavailableError)
    with pytest.raises(InvalidInputError):
        Technician('t', 'T', 't@x.io', max_concurrent=0)


def test_incident_factory_starts_new_and_lifecycle_is_enforced():
    now = utcnow()
    inc = IncidentFactory.create(number='INC-T', title='Projector broken', description='Lamp does not turn on',
                                 category='Hardware', service=ItService('s', 'Svc', criticality=2),
                                 reporter=Employee('r', 'R', 'r@x.io'), location=Location('academics', 'Library', None, '3'),
                                 impact=1, urgency=1, business_criticality=1, affected_users=1, phone=None,
                                 student_id=None, duplicates=[], now=now)
    assert inc.status == S.NEW
    with pytest.raises(InvalidStateTransitionError):
        inc.transition_to(S.CLOSED, Role.ADMIN, now)
    inc.classify('Hardware', now)
    assert inc.status == S.CLASSIFIED
    with pytest.raises(UnauthorizedOperationError):
        inc.transition_to(S.ASSIGNED, Role.CUSTOMER, now)
    with pytest.raises(InvalidInputError):
        Location('moon')


def test_weighted_priority_uses_service_criticality():
    s = WeightedScorePriorityStrategy()
    low = s.calculate(PriorityInput(2, 2, 1, 1, service_criticality=1))
    high = s.calculate(PriorityInput(2, 2, 1, 1, service_criticality=3))
    assert (low.priority.value, high.priority.value) == ('P3', 'P2')
    assert 'criticality 3' in high.explanation


def test_all_assignment_strategies_are_interchangeable():
    profiles = [TechnicianProfile('busy', 'Busy', ['Network'], open_count=4, resolved_in_category=9),
                TechnicianProfile('free', 'Free', [], open_count=0)]
    incident = {'category': 'Network', 'priority': 'P3'}
    for key in AssignmentStrategyFactory.registry:
        assert AssignmentStrategyFactory.get(key).select(incident, profiles).id in ('busy', 'free')
    assert ExperienceBasedStrategy().select(incident, profiles).id == 'busy'
    assert PriorityBasedStrategy().select({**incident, 'priority': 'P1'}, profiles).id == 'busy'
    assert PriorityBasedStrategy().select({**incident, 'priority': 'P4'}, profiles).id == 'free'


# ───────────────────────── API features ─────────────────────────

@pytest.mark.anyio
async def test_creation_records_classification_priority_and_sla_in_the_audit_trail():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        inc = await report(ac, cust, await service_id(ac, cust, "Payment Gateway"), "Application", 3, 3)
        assert inc["priority"] == "P1" and inc["status"] == "CLASSIFIED"
        audit = (await ac.get(f"/api/incidents/{inc['id']}", headers=adm)).json()["audit"]
        by_action = {a["action"]: a for a in audit}
        assert by_action["INCIDENT_CREATED"]["new_state"] == "NEW"
        assert by_action["INCIDENT_CLASSIFIED"]["previous_state"] == "NEW"
        assert "criticality 3" in by_action["PRIORITY_CALCULATED"]["description"]
        assert "Default P1" in by_action["SLA_APPLIED"]["description"]
        # P1 incidents alert administrators
        admin_id = (await ac.get("/api/auth/me", headers=adm)).json()["id"]
        assert any(n["kind"] == "critical" and n["incident_number"] == inc["number"] for n in await notifications_for(admin_id))


@pytest.mark.anyio
async def test_admin_can_switch_assignment_strategy():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        r = await ac.put("/api/admin/settings", headers=adm, json={"assignment_strategy": "nonsense"})
        assert r.status_code == 422
        r = await ac.put("/api/admin/settings", headers=adm, json={"assignment_strategy": "load"})
        assert r.status_code == 200 and r.json()["settings"]["assignment_strategy"] == "load"
        assert {s["key"] for s in r.json()["assignment_strategies"]} >= {"smart", "skill", "load", "round_robin", "experience", "priority"}
        inc = await report(ac, cust, await service_id(ac, cust, "Office Wi-Fi"))
        workload = {t["id"]: t["open"] for t in (await ac.get("/api/reports/overview", headers=adm)).json()["technician_workload"]
                    if t["is_active"]}
        r = await ac.post(f"/api/incidents/{inc['id']}/auto-assign", headers=adm)
        assert r.status_code == 200, r.text
        assert workload[r.json()["assigned_to"]] == min(workload.values())
        audit = (await ac.get(f"/api/incidents/{inc['id']}", headers=adm)).json()["audit"]
        assert "Load-balanced" in audit[-1]["description"]
        await ac.put("/api/admin/settings", headers=adm, json={"assignment_strategy": "smart"})


@pytest.mark.anyio
async def test_notifications_reach_the_right_people_and_feedback_is_kept():
    async with client() as ac:
        cust, cust_user = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        tech, tech_user = await login(ac, "dan.okafor@itsm.local", "Tech@1234")
        inc = await report(ac, cust, await service_id(ac, cust, "Cloud Storage"), "Cloud")
        await ac.post(f"/api/incidents/{inc['id']}/assign", headers=adm, json={"technician_id": tech_user["id"]})
        kinds = lambda notes: {n["kind"] for n in notes if n.get("incident_number") == inc["number"]}
        assert "assignment" in kinds(await notifications_for(tech_user["id"]))
        assert "technician_assigned" in kinds(await notifications_for(cust_user["id"]))
        for st in ("ACKNOWLEDGED", "IN_PROGRESS", "PENDING_INFO"):
            assert (await ac.post(f"/api/incidents/{inc['id']}/transition", headers=tech, json={"target_status": st})).status_code == 200
        assert "info_requested" in kinds(await notifications_for(cust_user["id"]))
        await ac.post(f"/api/incidents/{inc['id']}/notes", headers=cust, json={"text": "It happens on the 2nd floor"})
        assert "note" in kinds(await notifications_for(tech_user["id"]))
        assert (await ac.post(f"/api/incidents/{inc['id']}/transition", headers=cust, json={"target_status": "IN_PROGRESS"})).status_code == 200
        r = await ac.post(f"/api/incidents/{inc['id']}/transition", headers=tech,
                          json={"target_status": "RESOLVED", "resolution_summary": "Cleared quota", "root_cause": "Disk quota full"})
        assert r.json()["resolution"]["root_cause"] == "Disk quota full"
        assert "resolved" in kinds(await notifications_for(cust_user["id"]))
        await ac.post(f"/api/incidents/{inc['id']}/transition", headers=cust, json={"target_status": "VERIFIED"})
        r = await ac.post(f"/api/incidents/{inc['id']}/transition", headers=cust,
                          json={"target_status": "CLOSED", "feedback_rating": 6})
        assert r.status_code == 422                                   # rating above 5
        r = await ac.post(f"/api/incidents/{inc['id']}/transition", headers=cust,
                          json={"target_status": "CLOSED", "feedback_rating": 4, "feedback_comment": "Quick fix, thanks"})
        assert r.json()["closure"] == {**r.json()["closure"], "feedback_rating": 4, "feedback_comment": "Quick fix, thanks"}
        assert "closed" in kinds(await notifications_for(tech_user["id"]))
        r = await ac.post(f"/api/incidents/{inc['id']}/notes", headers=cust, json={"text": "late note"})
        assert r.status_code == 409                                   # closed incidents are read-only


@pytest.mark.anyio
async def test_sla_monitor_warns_records_violations_and_escalates():
    async with client() as ac:
        cust, cust_user = await login(ac, "emma@example.com", "Customer@1234")
        adm, adm_user = await login(ac, "admin@example.com", "ChangeMe@123")
        inc = await report(ac, cust, await service_id(ac, cust, "Payment Gateway"), "Application", 3, 3)
        created = parse_dt(inc["created_at"])
        monitor = container.sla_monitor
        bob = await container.users.by_email("bob.kumar@itsm.local")      # Application skill → team

        await monitor.run_once(now=created + timedelta(minutes=3))        # >50% of 5-min response window
        doc = await container.incidents.get(inc["id"])
        assert doc["escalation"]["level"] == 1 and doc["escalation"]["label"] == "Team Lead"
        assert any(n["kind"] == "escalation" and n["incident_number"] == inc["number"] for n in await notifications_for(str(bob["_id"])))

        await monitor.run_once(now=created + timedelta(minutes=6))        # response SLA (5 min) missed
        doc = await container.incidents.get(inc["id"])
        assert doc["escalation"]["level"] == 2 and doc["sla"]["status"] == "BREACHED"
        assert doc["assigned_to"], "level-2 escalation auto-dispatches an unassigned incident"
        violations = await container.sla_violations.find({"incident_number": inc["number"]})
        assert [v["kind"] for v in violations] == ["response"]

        await monitor.run_once(now=created + timedelta(minutes=11))       # 200% → IT Manager
        await monitor.run_once(now=created + timedelta(minutes=12))       # nothing new must be duplicated
        doc = await container.incidents.get(inc["id"])
        assert doc["escalation"]["level"] == 3 and len(doc["escalation"]["history"]) == 3
        assert len(await container.sla_violations.find({"incident_number": inc["number"]})) == 1

        await monitor.run_once(now=created + timedelta(minutes=29))       # resolution deadline (30 min) close → still breached
        await monitor.run_once(now=created + timedelta(minutes=31))
        kinds = sorted(v["kind"] for v in await container.sla_violations.find({"incident_number": inc["number"]}))
        assert kinds == ["resolution", "response"]
        violations = (await ac.get("/api/admin/sla-violations", headers=adm)).json()
        assert any(v["incident_number"] == inc["number"] for v in violations)
        actions = [a["action"] for a in (await ac.get(f"/api/incidents/{inc['id']}", headers=adm)).json()["audit"]]
        assert actions.count("ESCALATED") == 3 and actions.count("SLA_BREACHED") == 2


@pytest.mark.anyio
async def test_sla_at_risk_warning_goes_to_the_technician():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        carol, carol_user = await login(ac, "carol.diaz@itsm.local", "Tech@1234")
        inc = await report(ac, cust, await service_id(ac, cust, "HR Portal"), "Hardware")    # P4: 240/1440 min
        await ac.post(f"/api/incidents/{inc['id']}/assign", headers=adm, json={"technician_id": carol_user["id"]})
        await ac.post(f"/api/incidents/{inc['id']}/transition", headers=carol, json={"target_status": "ACKNOWLEDGED"})
        created = parse_dt(inc["created_at"])
        await container.sla_monitor.run_once(now=created + timedelta(minutes=1440 - 60))
        assert (await container.incidents.get(inc["id"]))["sla"]["status"] == "AT_RISK"
        assert any(n["kind"] == "sla_at_risk" and n["incident_number"] == inc["number"]
                   for n in await notifications_for(carol_user["id"]))


@pytest.mark.anyio
async def test_correlation_alerts_admins_once_and_lists_related_incidents():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, adm_user = await login(ac, "admin@example.com", "ChangeMe@123")
        svc = (await ac.post("/api/admin/services", headers=adm, json={"name": f"Exam Portal {time.time_ns()}", "criticality": 3})).json()
        incs = [await report(ac, cust, svc["id"], "Application", title=f"Exam portal problem {i} {time.time_ns()}")
                for i in range(4)]
        alerts = [n for n in await notifications_for(adm_user["id"]) if n["kind"] == "correlation" and svc["name"] in n["message"]]
        assert len(alerts) == 1 and incs[2]["number"] in alerts[0]["message"]
        clusters = (await ac.get("/api/intelligence/correlations", headers=adm)).json()
        assert any(c["service_id"] == svc["id"] and c["count"] == 4 for c in clusters)
        related = (await ac.get(f"/api/incidents/{incs[0]['id']}", headers=adm)).json()["related"]
        assert {r["number"] for r in related} >= {i["number"] for i in incs[1:]}
        assert any(c["service_id"] == svc["id"] for c in (await ac.get("/api/reports/overview", headers=adm)).json()["correlations"])


@pytest.mark.anyio
async def test_suggested_resolutions_come_from_similar_resolved_incidents():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        svc = await service_id(ac, cust, "Email Service")
        old = await report(ac, cust, svc, "Software", title="Outlook keeps crashing on startup",
                           description="Outlook desktop client crashes immediately on startup with an add-in error")
        await ac.post(f"/api/incidents/{old['id']}/auto-assign", headers=adm)
        for st in ("ACKNOWLEDGED", "IN_PROGRESS"):
            await ac.post(f"/api/incidents/{old['id']}/transition", headers=adm, json={"target_status": st})
        await ac.post(f"/api/incidents/{old['id']}/transition", headers=adm,
                      json={"target_status": "RESOLVED", "resolution_summary": "Disabled the faulty add-in and repaired Office"})
        new = await report(ac, cust, svc, "Software", title="Outlook crashing at startup",
                           description="Outlook crashes on startup, says an add-in failed")
        suggestions = (await ac.get(f"/api/incidents/{new['id']}", headers=adm)).json()["suggested_resolutions"]
        assert suggestions and suggestions[0]["number"] == old["number"]
        assert "add-in" in suggestions[0]["summary"]
        # students don't see staff-only intelligence
        assert (await ac.get(f"/api/incidents/{new['id']}", headers=cust)).json()["suggested_resolutions"] == []


@pytest.mark.anyio
async def test_search_supports_many_filters():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        svc = await service_id(ac, cust, "Corporate VPN")
        inc = await report(ac, cust, svc, "Security", 2, 3, title=f"VPN certificate expired {time.time_ns()}")
        today = inc["created_at"][:10]
        checks = {
            "q": inc["number"], "status": "CLASSIFIED", "priority": inc["priority"], "category": "Security",
            "service_id": svc, "sla_status": inc["sla"]["status"], "date_from": today, "date_to": today,
            "assigned_to": "unassigned",
        }
        for key, value in checks.items():
            found = (await ac.get("/api/incidents", headers=adm, params={key: value})).json()
            assert inc["number"] in {i["number"] for i in found}, key
        found = (await ac.get("/api/incidents", headers=adm, params={"date_to": "2000-01-01"})).json()
        assert found == []
        r = await ac.get("/api/incidents", headers=adm, params={"date_from": "yesterday"})
        assert r.status_code == 422


@pytest.mark.anyio
async def test_admin_manages_services_categories_and_sla_policies():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        # students cannot reach admin configuration
        assert (await ac.get("/api/admin/services", headers=cust)).status_code == 403
        name = f"Library Portal {time.time_ns()}"
        svc = (await ac.post("/api/admin/services", headers=adm, json={"name": name, "criticality": 1})).json()
        assert (await ac.post("/api/admin/services", headers=adm, json={"name": name})).status_code == 409
        r = await ac.put(f"/api/admin/services/{svc['id']}", headers=adm, json={"name": name, "description": "OPAC", "criticality": 3})
        assert r.json()["criticality"] == 3
        # a service-specific SLA overrides the default
        r = await ac.post("/api/admin/sla", headers=adm, json={"name": "Library P3", "priority": "P3", "response_minutes": 10,
                                                                "resolution_minutes": 60, "service_id": svc["id"]})
        assert r.status_code == 201, r.text
        policy = r.json()
        assert (await ac.post("/api/admin/sla", headers=adm, json={"name": "dup", "priority": "P3", "response_minutes": 10,
                                                                    "resolution_minutes": 60, "service_id": svc["id"]})).status_code == 409
        assert (await ac.post("/api/admin/sla", headers=adm, json={"name": "bad", "priority": "P9", "response_minutes": 10,
                                                                    "resolution_minutes": 60})).status_code == 422
        assert (await ac.post("/api/admin/sla", headers=adm, json={"name": "bad", "priority": "P2", "response_minutes": 60,
                                                                    "resolution_minutes": 10, "service_id": svc["id"]})).status_code == 422
        inc = await report(ac, cust, svc["id"], "Software", 1, 2)       # 1×2×3 = 6 → P3
        assert inc["priority"] == "P3" and inc["sla"]["policy_name"] == "Library P3"
        # in-use items cannot be deleted; defaults cannot be deleted
        assert (await ac.delete(f"/api/admin/services/{svc['id']}", headers=adm)).status_code == 409
        default = next(p for p in (await ac.get("/api/admin/sla", headers=adm)).json() if p["priority"] == "P1" and not p["service_id"])
        assert (await ac.delete(f"/api/admin/sla/{default['id']}", headers=adm)).status_code == 409
        assert (await ac.delete(f"/api/admin/sla/{policy['id']}", headers=adm)).status_code == 200
        # categories
        cat = f"Projector {time.time_ns()}"
        created = (await ac.post("/api/admin/categories", headers=adm, json={"name": cat})).json()
        assert (await ac.post("/api/admin/categories", headers=adm, json={"name": cat})).status_code == 409
        assert (await ac.delete(f"/api/admin/categories/{created['id']}", headers=adm)).status_code == 200
        used = next(c for c in (await ac.get("/api/admin/categories", headers=adm)).json() if c["name"] == "Software")
        assert (await ac.delete(f"/api/admin/categories/{used['id']}", headers=adm)).status_code == 409


@pytest.mark.anyio
async def test_missing_sla_policy_is_reported_clearly():
    async with client() as ac:
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        backup = await container.db.sla_policies.find_one({"priority": "P4", "service_id": None})
        await container.db.sla_policies.delete_one({"_id": backup["_id"]})
        try:
            r = await ac.post("/api/incidents", headers=cust, json={
                "title": f"No policy {time.time_ns()}", "description": "Testing a missing SLA policy",
                "category": "Hardware", "service_id": await service_id(ac, cust, "HR Portal"),
                "impact": 1, "urgency": 1, "location_type": "online", "acknowledge_duplicate": True})
            assert r.status_code == 500 and r.json()["error"] == "MissingSlaConfigError"
        finally:
            await container.db.sla_policies.insert_one(backup)


@pytest.mark.anyio
async def test_admin_edits_technicians_and_reads_audit_log():
    async with client() as ac:
        adm, _ = await login(ac, "admin@example.com", "ChangeMe@123")
        tech = await container.users.by_email("dan.okafor@itsm.local")
        r = await ac.patch(f"/api/admin/users/{tech['_id']}", headers=adm, json={"skills": ["Cloud", "Cloud", "Network"], "max_concurrent": 7})
        assert r.status_code == 200 and r.json()["skills"] == ["Cloud", "Network"] and r.json()["max_concurrent"] == 7
        assert (await ac.patch(f"/api/admin/users/{tech['_id']}", headers=adm, json={"max_concurrent": 0})).status_code == 422
        logs = (await ac.get("/api/admin/audit", headers=adm, params={"action": "ESCALATED"})).json()
        assert logs and all(x["action"] == "ESCALATED" for x in logs)
        number = logs[0]["incident_number"]
        logs = (await ac.get("/api/admin/audit", headers=adm, params={"incident": number})).json()
        assert {x["incident_number"] for x in logs} == {number}


@pytest.mark.anyio
async def test_invalid_input_and_login_errors():
    async with client() as ac:
        r = await ac.post("/api/auth/login", json={"email": "emma@example.com", "password": "wrong-password"})
        assert r.status_code == 401 and r.json()["error"] == "AuthenticationError"
        cust, _ = await login(ac, "emma@example.com", "Customer@1234")
        svc = await service_id(ac, cust, "Office Wi-Fi")
        base = {"title": "Valid title", "description": "Valid description text", "category": "Network",
                "service_id": svc, "impact": 2, "urgency": 2, "location_type": "online", "acknowledge_duplicate": True}
        for bad in ({"impact": 0}, {"urgency": 4}, {"title": "abc"}, {"location_type": "moon"},
                    {"service_id": "000000000000000000000000"}, {"category": "Nope"}):
            r = await ac.post("/api/incidents", headers=cust, json={**base, **bad})
            assert r.status_code in (404, 422), (bad, r.status_code, r.text)
        # students cannot edit or assign
        inc = await report(ac, cust, svc)
        assert (await ac.patch(f"/api/incidents/{inc['id']}", headers=cust, json={"title": "Hacked title"})).status_code == 403
        assert (await ac.post(f"/api/incidents/{inc['id']}/auto-assign", headers=cust)).status_code == 403

"""Replace every incident with a fresh, realistic set of demo reports for BITS Hyderabad.

    cd backend && .venv/bin/python scripts/demo_data.py          (asks before deleting)
    ./start.sh --demo-data                                        (same thing, from the project folder)

What it does
  1. Saves a copy of everything it is about to delete to _backups/incidents-before-demo-<time>.json
  2. Deletes all incidents and what hangs off them: audit trail, notifications, SLA violations,
     outage alerts, photos/voice notes, handover codes and logged emails. Users, services,
     settings, QR stickers and building pins are kept.
  3. Adds demo students (…demo@example.com, password Student@1234) and about 70 reports spread over
     the academic blocks and bhavans, each with its own GPS pin near its building, at different
     stages: just reported, assigned, being worked on, resolved, closed, plus ~40 finished reports
     from the last two weeks at realistic hours (for the charts). Fix times mostly stay inside the SLA. It includes two live
     "possible outage" clusters (Wi-Fi in Block D, power in Ram Bhavan) and a couple of weeks of
     history so the dashboard charts have something to show.

Reports are made through the real IncidentService (priority, SLA, audit trail, auto-assignment),
with the clock wound back for each step, so everything looks exactly as if it happened.
Only the in-app notification channel is used: no real emails are sent.
"""
import asyncio
import math
import random
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from dotenv import load_dotenv  # noqa: E402
load_dotenv(BACKEND / '.env')

from bson import json_util  # noqa: E402
from app.core.db import db, init_db  # noqa: E402
from app.core.container import container  # noqa: E402
from app.core.security import hash_password, public_user  # noqa: E402
from app.domain import sla as sla_module  # noqa: E402
from app.models.schemas import IncidentCreate, TransitionRequest  # noqa: E402
from app.services.notifications import SmtpEmailChannel  # noqa: E402

WIPE = ['incidents', 'audit_logs', 'notifications', 'sla_violations', 'correlation_alerts', 'attachments',
        'handover_codes', 'email_logs']

STUDENTS = [
    ('Priya Nair', 'priya.nair.demo@example.com', '20240117', '+91 90000 11117'),
    ('Rohan Mehta', 'rohan.mehta.demo@example.com', '20230342', '+91 90000 22342'),
    ('Ananya Reddy', 'ananya.reddy.demo@example.com', '20250209', '+91 90000 33209'),
    ('Kabir Singh', 'kabir.singh.demo@example.com', '20220455', '+91 90000 44455'),
    ('Sneha Iyer', 'sneha.iyer.demo@example.com', '20240388', '+91 90000 55388'),
    ('Arjun Rao', 'arjun.rao.demo@example.com', '20230071', '+91 90000 66071'),
]

H, D = 60, 24 * 60      # minutes in an hour / a day
# (building, room, title, description, category, service, impact, urgency, minutes ago, how far it got)
REPORTS = [
    # Live cluster: Wi-Fi in Block D (four reports inside the outage window)
    ('Block D', '204', 'Wi-Fi down on the 2nd floor of D block', 'BITS-STUDENT shows no internet across the whole 2nd floor since the morning lecture.', 'Network', 'Office Wi-Fi', 3, 3, 70, 'assigned'),
    ('Block D', '210', 'No internet in D-210 tutorial room', 'Laptops connect to Wi-Fi but nothing loads. The tutorial needs the online quiz.', 'Network', 'Office Wi-Fi', 2, 3, 52, 'new'),
    ('Block D', '118', 'Access point blinking red outside D-118', 'The ceiling access point in the corridor outside D-118 is blinking red.', 'Network', 'Office Wi-Fi', 2, 2, 38, 'new'),
    ('Block D', '305', "Can't connect to BITS-STUDENT in D-305", 'Wi-Fi keeps asking for the password again and then fails.', 'Network', 'Office Wi-Fi', 2, 2, 21, 'new'),
    # Live cluster: power in Ram Bhavan
    ('Ram Bhavan', '214', 'Power cut on the 2nd floor wing', 'Half of the rooms on the 2nd floor have no power. The corridor lights are also off.', 'Electrician Needed', 'Electrician Support', 3, 3, 64, 'assigned'),
    ('Ram Bhavan', '118', 'Tube light not working in room 118', 'Tube light flickers and then goes off completely.', 'Electrician Needed', 'Electrician Support', 1, 2, 48, 'new'),
    ('Ram Bhavan', '305', 'Power socket dead in room 305', 'Neither socket near the study table works. Laptop cannot charge.', 'Electrician Needed', 'Electrician Support', 2, 2, 33, 'new'),
    # Other open reports
    ('Workshop', 'Bay 3', 'Power socket sparking near lathe 3', 'The wall socket next to lathe 3 sparked when a machine was plugged in. Area taped off.', 'Electrician Needed', 'Electrician Support', 3, 3, 14, 'new'),
    ('Block G', 'Lab 2', 'Lab 2 network switch down, whole lab offline', 'All 40 machines in Lab 2 lost network at once. Practical exam at 2 pm.', 'Network', 'Office Wi-Fi', 3, 3, 9, 'new'),
    ('Block F', '105', 'Smart board not responding in F-105', 'The touch screen does not react and the PC input shows no signal.', 'Hardware', 'Technician Support', 2, 3, 140, 'progress'),
    ('Block A', '301', "Lab PC 14 won't boot in A-301", 'PC 14 in the CP lab stops at a black screen after the BIOS logo.', 'Hardware', 'Technician Support', 2, 2, 5 * H, 'ack'),
    ('LTC (Lecture Theatre Complex)', '5104', 'Projector flickering in LTC 5104', 'The projector image cuts out every few seconds during lectures.', 'Hardware', 'Technician Support', 3, 2, 95, 'assigned'),
    ('Library', 'G1', 'Catalogue kiosk frozen at the entrance', 'The search kiosk near the entrance is stuck on a loading screen.', 'Application', 'Technician Support', 1, 2, 3 * H, 'new'),
    ('Library', 'Reading hall', "Can't sign in to library e-resources", 'Single sign-on fails with "account not found" for IEEE Xplore and JSTOR.', 'Authentication', 'Identity Provider (SSO)', 2, 2, 4 * H, 'progress'),
    ('Block B', '202', 'Ceiling fan wobbling badly in B-202', 'The fan above the second row shakes a lot at full speed.', 'Electrician Needed', 'Electrician Support', 2, 2, 200, 'assigned'),
    ('NAB (New Academic Block)', '6123', 'AC not cooling in NAB 6123', 'The AC runs but the room stays warm. Thermostat shows 30 degrees.', 'Electrician Needed', 'Electrician Support', 2, 2, 7 * H, 'ack'),
    ('Vyas Bhavan', '207', 'LAN port in room 207 not working', 'The wall LAN port gives no connection with two different cables.', 'Technician Needed', 'Technician Support', 2, 2, 260, 'ack'),
    ('Krishna Bhavan', 'Washroom 1F', 'Geyser not heating in the 1st floor washroom', 'Water stays cold even after an hour. The indicator light is off.', 'Electrician Needed', 'Electrician Support', 2, 3, 120, 'assigned'),
    ('Gandhi Bhavan', '412', 'Cupboard door came off its hinge', 'The left door of the cupboard fell off; one hinge screw is missing.', 'Carpenter Needed', 'Carpenter Support', 1, 1, 15 * H, 'progress'),
    ('Valmiki Bhavan', '330', "Window latch broken, window won't close", 'The latch snapped and the window swings open at night.', 'Carpenter Needed', 'Carpenter Support', 1, 2, 2 * D, 'new'),
    ('SAC (Student Activity Centre)', 'Auditorium', 'Sound system crackling in the SAC auditorium', 'Speakers crackle and cut out when the mic is used.', 'Hardware', 'Technician Support', 2, 2, 9 * H, 'assigned'),
    # Resolved / closed today and over the last two weeks
    ('Medical Centre', 'Reception', 'Printer at reception jammed', 'Paper jam in tray 2, prescriptions cannot be printed.', 'Hardware', 'Technician Support', 1, 2, 10 * H, 'resolved'),
    ('Gautam Bhavan', '115', 'Fan regulator broken in room 115', 'Regulator knob turns but the fan stays at full speed.', 'Electrician Needed', 'Electrician Support', 1, 2, 12 * H, 'resolved'),
    ('Vishwakarma Bhavan', '220', 'Study table drawer jammed', 'Drawer is stuck shut; the runner seems bent.', 'Carpenter Needed', 'Carpenter Support', 1, 1, 26 * H, 'closed'),
    ('Block C', '106', 'Broken chair in C-106', 'Backrest of a chair in the 3rd row has come loose.', 'Carpenter Needed', 'Carpenter Support', 1, 1, 2 * D, 'closed'),
    ('Shankar Bhavan', 'Common room', 'TV in the common room has no signal', 'Set-top box shows "no signal" on every channel.', 'Technician Needed', 'Technician Support', 1, 1, 3 * D, 'closed'),
    ('Block A', '120', 'Email not syncing on lab machines', 'Outlook on the A-120 machines asks for the password again and again.', 'Application', 'Email Service', 2, 2, 5 * D, 'closed'),
    ('NAB (New Academic Block)', '5101', 'Projector remote missing batteries', 'Remote is dead; projector cannot be switched on.', 'Hardware', 'Technician Support', 1, 1, 6 * D, 'closed'),
    ('Library', '2nd floor', 'Wi-Fi weak in the 2nd floor reading area', 'Signal is one bar near the windows; pages time out.', 'Network', 'Office Wi-Fi', 2, 2, 8 * D, 'closed'),
    ('Ram Bhavan', '010', 'Door lock jammed in room 010', 'Key turns but the lock does not open from outside.', 'Carpenter Needed', 'Carpenter Support', 2, 3, 10 * D, 'closed'),
    ('Block F', '210', 'Lab PCs slow to log in', 'Logging in takes over five minutes on all F-210 machines.', 'Authentication', 'Identity Provider (SSO)', 2, 2, 13 * D, 'closed'),
]
FIXES = {
    'Hardware': 'Replaced the faulty cable and reset the device; tested with the class rep.',
    'Network': 'Restarted the access point and replaced its PoE injector; signal checked in every room.',
    'Electrician Needed': 'Replaced the faulty component and checked the circuit with a tester.',
    'Carpenter Needed': 'Refitted the hinge/runner with new screws and checked it opens smoothly.',
    'Technician Needed': 'Re-terminated the cable and confirmed the connection works.',
    'Application': 'Cleared the cached credentials and re-linked the account.',
    'Authentication': 'Fixed the account mapping in the identity provider; sign-in tested.',
}

RESOLVE_WITHIN = {'P1': 30, 'P2': 120, 'P3': 480, 'P4': 1440}   # minutes, matches the seeded SLA policy


def history(now_ist, count=40):
    """Older, finished reports over the last two weeks, at the hours things really break:
    lecture hours in the academic blocks, evenings and early mornings in the bhavans."""
    rows = []
    for _ in range(count):
        b, room, title, desc, cat, service, impact, urgency, _age, _stage = random.choice(REPORTS)
        hostel = b.endswith('Bhavan')
        day = random.choices(range(1, 14), weights=[6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2])[0]
        hours = list(range(24))
        weights = ([1, 1, 0, 0, 0, 0, 1, 4, 5, 3, 2, 2, 2, 2, 2, 2, 3, 4, 6, 8, 9, 8, 6, 3] if hostel else
                   [0, 0, 0, 0, 0, 0, 0, 1, 3, 8, 9, 9, 6, 5, 8, 8, 6, 3, 1, 1, 0, 0, 0, 0])
        when = (now_ist - timedelta(days=day)).replace(hour=random.choices(hours, weights)[0], minute=random.randrange(60))
        if when > now_ist - timedelta(hours=6):
            when -= timedelta(days=1)
        if not hostel and when.weekday() == 6 and random.random() < .7:   # Sundays are quiet in the blocks
            when -= timedelta(days=1)
        age = (now_ist - when).total_seconds() / 60
        if hostel:
            room = str(random.choice([1, 2, 3])) + '%02d' % random.randrange(1, 40)
        rows.append((b, room, title, desc, cat, service, impact, urgency, age, 'closed' if day > 1 else 'resolved'))
    return rows


# ---------------------------------------------------------------- a clock we can wind back
NOW = datetime.now(timezone.utc)
_clock = [NOW]


def fake_utcnow():
    return _clock[0]


def install_clock():
    real = sla_module.utcnow
    for name, mod in list(sys.modules.items()):
        if name.startswith('app.') and getattr(mod, 'utcnow', None) is real:
            setattr(mod, 'utcnow', fake_utcnow)


def at(minutes_ago):
    _clock[0] = NOW - timedelta(minutes=minutes_ago)


def jitter(lat, lng, metres):
    r, a = metres * math.sqrt(random.random()), random.random() * 2 * math.pi
    return (lat + r * math.sin(a) / 111320, lng + r * math.cos(a) / (111320 * math.cos(math.radians(lat))))


async def backup():
    out_dir = BACKEND.parent / '_backups'
    out_dir.mkdir(exist_ok=True)
    path = out_dir / f"incidents-before-demo-{NOW.strftime('%Y%m%d-%H%M%S')}.json"
    data = {name: await db[name].find({}).to_list(None) for name in WIPE}
    data['counters'] = await db.counters.find({'_id': 'incident'}).to_list(None)
    path.write_text(json_util.dumps(data, indent=1))
    return path, {k: len(v) for k, v in data.items()}


async def ensure_students():
    for name, email, sid, phone in STUDENTS:
        await db.users.update_one({'email': email}, {
            '$setOnInsert': {'name': name, 'email': email, 'skills': [], 'max_concurrent': 0, 'student_id': sid,
                             'phone': phone, 'password_hash': hash_password('Student@1234'), 'is_active': True,
                             'created_at': NOW},
            '$set': {'role': 'customer'}}, upsert=True)
    return [public_user(u) for u in await db.users.find({'role': 'customer', 'is_active': {'$ne': False}}).to_list(None)]


async def user_by_id(uid):
    from bson import ObjectId
    return public_user(await db.users.find_one({'_id': ObjectId(uid)}))


def iid(inc):
    return str(inc.get('id') or inc['_id'])


async def assign(svc, inc, admin, techs):
    try:
        return await svc.auto_assign(inc, admin)
    except Exception:
        tech = min(techs, key=lambda t: t['_load'])
        return await svc.assign(inc, tech['id'], admin)


async def build():
    svc = container.incident_service
    container.dispatcher.channels = [c for c in container.dispatcher.channels if not isinstance(c, SmtpEmailChannel)]
    install_clock()

    services = {s['name']: str(s['_id']) for s in await db.services.find({}).to_list(None)}
    pins = {b['name']: (b['lat'], b['lng']) for b in (await svc.campus_map()).buildings()}
    admin = public_user(await db.users.find_one({'role': 'admin'}))
    techs = [dict(public_user(t), _load=0) for t in await db.users.find({'role': 'technician', 'is_active': {'$ne': False}}).to_list(None)]
    students = await ensure_students()
    random.seed(2213)

    made = []
    plan = REPORTS + history(NOW.astimezone(ZoneInfo('Asia/Kolkata')))
    plan.sort(key=lambda r: -r[8])   # oldest first, so report numbers run in time order
    for building, room, title, desc, cat, service, impact, urgency, age, stage in plan:
        hostel = building.endswith('Bhavan')
        reporter = random.choice(students)
        lat, lng = jitter(*pins[building], 18 if hostel else 24)
        at(age)
        data = IncidentCreate(
            title=title, description=desc, category=cat, service_id=services[service], impact=impact, urgency=urgency,
            location_type='hostel' if hostel else 'academics', hostel_name=building if hostel else None,
            academic_block=None if hostel else building, room_number=room, phone=reporter.get('phone'),
            acknowledge_duplicate=True, confirm_in_scope=True, latitude=lat, longitude=lng,
            accuracy_m=round(random.uniform(6, 22)))
        inc = await svc.create(data, reporter)
        order = ['new', 'assigned', 'ack', 'progress', 'resolved', 'closed']
        reached = order.index(stage)
        # Each step happens some minutes after the report, never later than now.
        elapsed = [0.0]

        def later(minutes):
            elapsed[0] = min(elapsed[0] + minutes, age - 0.2)
            at(age - elapsed[0])

        quick = lambda lo, hi: min(random.uniform(lo, hi), age * 0.15)  # noqa: E731
        if reached >= 1 and not inc.get('assigned_to'):
            later(quick(2, 10))
            inc = await assign(svc, await svc.get(iid(inc)), admin, techs)
        if inc.get('assigned_to'):
            tech = await user_by_id(inc['assigned_to'])
            for t in techs:
                t['_load'] += t['id'] == tech['id']
            if reached >= 2:
                later(quick(2, 12))
                inc = await svc.transition(iid(inc), TransitionRequest(target_status='ACKNOWLEDGED'), tech)
            if reached >= 3:
                later(quick(3, 20))
                inc = await svc.transition(iid(inc), TransitionRequest(target_status='IN_PROGRESS'), tech)
            if reached >= 4:
                target = RESOLVE_WITHIN.get(inc.get('priority'), 480)
                share = random.uniform(1.1, 1.5) if random.random() < .12 else random.uniform(.3, .85)   # a few miss the SLA
                later(max(target * share - elapsed[0], 5))
                extra = {'resolution_summary': FIXES.get(cat, 'Fixed and tested on site.')}
                if hostel:
                    code = await db.handover_codes.find_one({'incident_id': iid(inc)})
                    extra['handover_code'] = code['code'] if code else None
                inc = await svc.transition(iid(inc), TransitionRequest(target_status='RESOLVED', **extra), tech)
            if reached >= 5:
                reporter_user = await user_by_id(inc['reporter_id'])
                later(random.uniform(20, 300))
                try:
                    inc = await svc.transition(iid(inc), TransitionRequest(
                        target_status='VERIFIED', feedback_rating=random.choice([4, 5, 5]),
                        feedback_comment=random.choice(['Quick fix, thanks!', 'Works now.', 'Sorted the same day.'])),
                        reporter_user)
                except Exception:
                    inc = await svc.transition(iid(inc), TransitionRequest(target_status='VERIFIED'), admin)
                later(random.uniform(5, 90))
                inc = await svc.transition(iid(inc), TransitionRequest(target_status='CLOSED'), admin)
        made.append(inc)
    _clock[0] = datetime.now(timezone.utc)
    return made


async def main():
    auto = '--yes' in sys.argv
    await init_db()
    count = await db.incidents.count_documents({})
    print(f"Database '{db.name}': {count} incidents now.")
    if not auto:
        answer = input('Delete them all and load the demo reports? A backup is saved first. Type "yes": ')
        if answer.strip().lower() != 'yes':
            print('Nothing changed.')
            return
    path, counts = await backup()
    print(f'Backup saved: {path}  ({counts})')
    for name in WIPE:
        await db[name].delete_many({})
    await db.counters.update_one({'_id': 'incident'}, {'$set': {'value': 0}}, upsert=True)
    made = await build()
    by = {}
    for inc in made:
        by[inc['status']] = by.get(inc['status'], 0) + 1
    pri = {}
    for inc in made:
        pri[inc['priority']] = pri.get(inc['priority'], 0) + 1
    print(f'Loaded {len(made)} demo reports. Status: {by}. Priority: {pri}')
    print('Demo students: ' + ', '.join(e for _, e, _, _ in STUDENTS) + ' (password Student@1234)')


if __name__ == '__main__':
    asyncio.run(main())

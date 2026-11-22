import os, logging
from app.core.security import hash_password
from app.domain.enums import Role

# Default SLA targets in minutes: priority -> (respond within, resolve within).
# These follow the example table in the project brief:
#   P1 5 min / 30 min · P2 15 min / 2 h · P3 1 h / 8 h · P4 4 h / 24 h
DEFAULT_SLA_TARGETS = {'P1': (5, 30), 'P2': (15, 120), 'P3': (60, 480), 'P4': (240, 1440)}
# The defaults used before (kept only to upgrade existing databases).
OLD_DEFAULT_SLA_TARGETS = {'P1': (15, 240), 'P2': (30, 480), 'P3': (120, 1440), 'P4': (480, 4320)}

async def seed_all(db):
    try:
        cats = ['Hardware', 'Software', 'Network', 'Database', 'Cloud', 'Security', 'Authentication', 'Application', 'Storage', 'Carpenter Needed', 'Electrician Needed', 'Technician Needed']
        for c in cats:
            await db.categories.update_one({'name': c}, {'$setOnInsert': {'name': c}}, upsert=True)
        
        # criticality: 3 = business critical, 2 = important, 1 = low (feeds the priority calculation)
        services = [('Payment Gateway', 3), ('Identity Provider (SSO)', 3), ('Customer Database', 3),
                    ('Email Service', 2), ('Corporate VPN', 2), ('Cloud Storage', 2), ('HR Portal', 1),
                    ('Office Wi-Fi', 2), ('Carpenter Support', 1), ('Electrician Support', 1), ('Technician Support', 1)]
        for s, crit in services:
            await db.services.update_one({'name': s}, {'$setOnInsert': {'name': s, 'description': s, 'criticality': crit}}, upsert=True)

        from app.repositories import SettingsRepository
        await db.settings.update_one({'_id': SettingsRepository.DOC_ID},
                                     {'$setOnInsert': dict(SettingsRepository.DEFAULTS)}, upsert=True)
        
        for p, (r, rs) in DEFAULT_SLA_TARGETS.items():
            await db.sla_policies.update_one(
                {'priority': p, 'service_id': None},
                {'$setOnInsert': {'name': f'Default {p}', 'priority': p, 'response_minutes': r, 'resolution_minutes': rs, 'service_id': None}},
                upsert=True
            )
            # Databases created before the targets changed still hold the old defaults.
            # Move them to the new ones, but leave any policy an admin has edited alone.
            old_r, old_rs = OLD_DEFAULT_SLA_TARGETS[p]
            await db.sla_policies.update_one(
                {'priority': p, 'service_id': None, 'response_minutes': old_r, 'resolution_minutes': old_rs},
                {'$set': {'response_minutes': r, 'resolution_minutes': rs}}
            )
        
        admin_email = os.getenv('ADMIN_EMAIL', 'admin@example.com').lower()
        admin_pwd = os.getenv('ADMIN_PASSWORD', 'ChangeMe@123')
        await db.users.update_one(
            {'email': admin_email},
            {
                '$setOnInsert': {'name': 'System Administrator', 'skills': [], 'max_concurrent': 99},
                '$set': {'password_hash': hash_password(admin_pwd), 'role': Role.ADMIN.value, 'is_active': True}
            },
            upsert=True
        )
        
        techs = [
            ('Alice Chen', ['Network', 'Cloud', 'Security']),
            ('Bob Kumar', ['Software', 'Application', 'Database']),
            ('Carol Diaz', ['Hardware', 'Storage', 'Authentication']),
            ('Dan Okafor', ['Database', 'Cloud', 'Application'])
        ]
        for name, skills in techs:
            email = name.lower().replace(' ', '.') + '@itsm.local'
            await db.users.update_one(
                {'email': email},
                {
                    # Only set password/active state on first insert so password resets
                    # and admin deactivations survive a server restart.
                    '$setOnInsert': {'name': name, 'max_concurrent': 5, 'skills': skills, 'password_hash': hash_password('Tech@1234'), 'is_active': True},
                    '$set': {'role': Role.TECHNICIAN.value}
                },
                upsert=True
            )
        
        customers = [
            ('Emma Wilson', 'emma@example.com'),
            ('Farid Rahman', 'farid@example.com'),
            ('Aarav Sharma', 'f20250051@hyderabad.bits-pilani.ac.in')
        ]
        for name, email in customers:
            student_id = '20250051' if '20250051' in email else None
            phone = '+91 98765 43210' if student_id else None
            await db.users.update_one(
                {'email': email},
                {
                    '$setOnInsert': {'name': name, 'skills': [], 'max_concurrent': 0, 'student_id': student_id, 'phone': phone, 'password_hash': hash_password('Student@1234' if student_id else 'Customer@1234'), 'is_active': True},
                    '$set': {'role': Role.CUSTOMER.value}
                },
                upsert=True
            )
        await seed_assets(db)
        logging.getLogger("seed").info("Seed data checked: categories, services, SLA policies and demo accounts are present.")
    except Exception as e:
        logging.getLogger("seed").exception(f"Seeding the database failed: {e}")
        raise



# A few QR-sticker examples so the feature can be demoed straight away.
DEMO_ASSETS = [
    ('Lab PC 14', 'Computer', 'academics', 'Block D', None, 'D-201', 'Hardware', None),
    ('Projector, LTC 101', 'Projector', 'academics', 'LTC (Lecture Theatre Complex)', None, '101', 'Hardware', None),
    ('Wi-Fi access point, 2nd floor', 'Network', 'hostel', None, 'Valmiki Bhavan', '2nd floor corridor', 'Technician Needed',
     'Technician Support'),
    ('Ceiling fan, Room 204', 'Fan', 'hostel', None, 'Krishna Bhavan', '204', 'Electrician Needed', 'Electrician Support'),
    ('Library kiosk PC', 'Computer', 'academics', 'Library', None, 'Ground floor', 'Software', None),
]


async def seed_assets(db):
    if await db.assets.count_documents({}):
        return
    from app.domain.models import Location
    from app.domain.sla import utcnow
    for n, (name, kind, ltype, block, hostel, room, category, service) in enumerate(DEMO_ASSETS, start=1):
        await db.assets.update_one({'code': f'AST-{n:04d}'}, {'$setOnInsert': {
            'code': f'AST-{n:04d}', 'name': name, 'kind': kind, 'location': Location(ltype, block, hostel, room).to_doc(),
            'category': category, 'service_name': service, 'notes': None, 'created_at': utcnow().isoformat()}},
            upsert=True)
    await db.counters.update_one({'_id': 'asset'}, {'$max': {'value': len(DEMO_ASSETS)}}, upsert=True)

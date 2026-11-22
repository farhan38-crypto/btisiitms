import os, asyncio, logging
from motor.motor_asyncio import AsyncIOMotorClient

client = AsyncIOMotorClient(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))
db = client[os.getenv('DB_NAME', 'itsm')]

async def ensure_indexes():
    await db.users.create_index('email', unique=True)
    await db.incidents.create_index('number', unique=True)
    await db.incidents.create_index([('status', 1), ('priority', 1)])
    await db.incidents.create_index('reporter_id')
    await db.incidents.create_index('assigned_to')
    await db.audit_logs.create_index([('incident_id', 1), ('timestamp', -1)])
    await db.notifications.create_index([('user_id', 1), ('created_at', -1)])
    await db.password_resets.create_index('expires_at', expireAfterSeconds=0)
    await db.password_resets.create_index([('email', 1), ('created_at', -1)])
    await db.password_reset_requests.create_index('expires_at', expireAfterSeconds=0)
    await db.password_reset_requests.create_index([('email', 1), ('created_at', -1)])
    await db.incidents.create_index('created_at')
    await db.incidents.create_index('service_id')
    await db.audit_logs.create_index([('timestamp', -1)])
    await db.sla_violations.create_index([('detected_at', -1)])
    await db.security_events.create_index([('user_id', 1), ('at', -1)])
    await db.security_events.create_index('at', expireAfterSeconds=90 * 24 * 3600)   # keep 90 days
    await db.attachments.create_index([('incident_id', 1), ('created_at', 1)])
    await db.handover_codes.create_index('incident_id', unique=True)
    await db.assets.create_index('code', unique=True)
    await db.building_pins.create_index('name', unique=True)
    for collection in ('categories', 'services'):
        try:
            await db[collection].create_index('name', unique=True)
        except Exception as exc:  # existing duplicate names must not stop the server
            logging.getLogger('database').warning(
                f'Could not make {collection}.name unique (duplicate names exist?): {exc}')

async def init_db(max_retries=15, delay=2):
    log = logging.getLogger('database')
    for attempt in range(max_retries):
        try:
            await client.admin.command('ping')
            await ensure_indexes()
            from app.services.seed import seed_all
            await seed_all(db)
            log.info(f"Connected to MongoDB database '{db.name}'; indexes and seed data are ready.")
            return True
        except Exception as e:
            from app.core.logging_config import log_exception
            last = attempt == max_retries - 1
            log_exception(
                log,
                ('Could not start: MongoDB setup failed after %d attempts' % max_retries) if last
                else f'MongoDB not ready yet (attempt {attempt + 1}/{max_retries}); retrying in {delay}s',
                e, level=logging.ERROR if last else logging.WARNING, with_traceback=last,
                Database=db.name,
            )
            if last:
                raise
            await asyncio.sleep(delay)

import os, asyncio, logging
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent/'.env')
from app.core.logging_config import setup_logging, log_exception, redact_url
LOG_DIR = setup_logging()
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware
from app.core.db import db, client, init_db
from app.core.error_handling import register_error_handling
from app.routers import (auth, account, incidents, notifications, intelligence, reports, admin, docs, catalog,
                         client_errors, field, assets, live, campus)

log = logging.getLogger('server')


def log_configuration():
    """One readable block at startup that shows what is (and is not) configured."""
    def yes(name):
        return 'configured' if (os.getenv(name) or '').strip() else 'NOT configured'
    smtp_ready = all((os.getenv(k) or '').strip() for k in ('SMTP_HOST', 'SMTP_USERNAME', 'SMTP_PASSWORD'))
    llm_key = any((os.getenv(k) or '').strip() for k in ('LLM_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'))
    log.info('Starting BITS reports API server', extra={'details': {
        'MongoDB': f"{redact_url(os.getenv('MONGO_URL', 'mongodb://localhost:27017'))} / database '{db.name}'",
        'CORS origins': os.getenv('CORS_ORIGINS', 'http://localhost:3000'),
        'Google sign-in': yes('GOOGLE_CLIENT_ID'),
        'SMTP email': 'configured' if smtp_ready else 'NOT configured',
        'AI (Gemini)': f"configured, model {os.getenv('LLM_MODEL', 'gemini-2.5-flash')}" if llm_key
                       else 'NOT configured (built-in keyword classifier is used)',
        'Log level': os.getenv('LOG_LEVEL', 'INFO').upper(),
        'Log files': f'{LOG_DIR}/app.log (everything), {LOG_DIR}/errors.log (warnings & errors)',
    }})
    secret = os.getenv('JWT_SECRET', '')
    if not secret:
        log.error('JWT_SECRET is not set — every sign-in will fail with a 500 error', extra={'details': {
            'How to fix': 'Add JWT_SECRET=<a long random string> to backend/.env and restart. '
                          'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"'}})
    elif secret.startswith('change-this') or len(secret) < 16:
        log.warning('JWT_SECRET is a placeholder or too short', extra={'details': {
            'Why this matters': 'Anyone who knows it can forge sign-in tokens for any account, including admin.',
            'How to fix': 'Use a long random value before deploying anywhere other than your laptop.'}})
    if not smtp_ready:
        log.warning('SMTP email is not configured', extra={'details': {
            'Effect': 'Password-reset codes and "incident resolved" emails cannot be sent.',
            'How to fix': 'Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD and SMTP_FROM_EMAIL in backend/.env.'}})


async def sla_loop():
    from app.core.container import container
    monitor = container.sla_monitor
    sla_log = logging.getLogger('sla-monitor')
    while True:
        try:
            changed = await monitor.run_once()
            if changed:
                sla_log.info(f'SLA check updated {changed} incident(s)')
        except Exception as exc:
            log_exception(sla_log, 'SLA monitor run failed; it will try again in 60 seconds', exc)
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(application: FastAPI):
    log_configuration()
    await init_db()
    application.state.sla_task = asyncio.create_task(sla_loop())
    log.info('BITS reports API is ready')
    try:
        yield
    finally:
        log.info('Shutting down BITS reports API server')
        task = getattr(application.state, 'sla_task', None)
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        client.close()

app = FastAPI(title='BITS reports API', version='1.0.0', lifespan=lifespan)
for m in [auth, account, incidents, notifications, intelligence, reports, admin, docs, catalog, client_errors,
          field, assets, live, campus]:
    app.include_router(m.router, prefix='/api')
app.include_router(field.attachments_router, prefix='/api')


@app.get('/api/health')
async def health():
    return {'status': 'ok', 'service': 'BITS reports'}


# Order matters: error handling first, CORS last (outermost) so even 500
# responses carry CORS headers and the browser can read the error message.
register_error_handling(app)
origins = [x.strip() for x in os.getenv('CORS_ORIGINS', 'http://localhost:3000').split(',') if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=True, allow_methods=['*'],
                   allow_headers=['*'], expose_headers=['X-Request-ID'])

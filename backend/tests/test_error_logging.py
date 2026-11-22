"""The error log must be readable, point at the cause, and never leak secrets."""
import os
from pathlib import Path
import pytest
from httpx import AsyncClient, ASGITransport
from server import app
from app.core.db import init_db
from app.core.logging_config import explain_exception


def errors_log():
    return (Path(os.environ['LOG_DIR']) / 'errors.log').read_text(encoding='utf-8')


@pytest.fixture(scope="module")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="module", autouse=True)
async def setup_db(anyio_backend):
    await init_db()


async def _boom():
    {'a': 1}['missing_field']


app.add_api_route('/api/_test/boom', _boom, methods=['GET'])


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.mark.anyio
async def test_unhandled_error_returns_reference_and_logs_full_story():
    async with client() as ac:
        r = await ac.get('/api/_test/boom', headers={'X-Request-ID': 'trace1234'})
    assert r.status_code == 500
    body = r.json()
    assert body['request_id'] == 'trace1234' == r.headers['x-request-id']
    assert 'trace1234' in body['detail']
    log = errors_log()
    entry = log[log.index('req trace1234'):]
    for text in ('500 Internal Server Error', 'What happened', "Expected the field 'missing_field'",
                 'GET /api/_test/boom', 'tests/test_error_logging.py', 'How to fix', 'Traceback'):
        assert text in entry, text


@pytest.mark.anyio
async def test_validation_errors_are_explained_without_leaking_passwords():
    async with client() as ac:
        r = await ac.post('/api/auth/register', json={'name': 'X', 'email': 'f20250099@hyderabad.bits-pilani.ac.in',
                                                     'password': 'Sh0rtpw'})
    assert r.status_code == 422
    assert r.json()['detail'][0]['input'] == '[hidden]'
    entry = errors_log().split('req ' + r.json()['request_id'])[1]
    assert '• password: String should have at least 8 characters' in entry
    assert '[hidden' in entry
    assert 'Sh0rtpw' not in errors_log()


@pytest.mark.anyio
async def test_business_rule_errors_say_why_and_where():
    async with client() as ac:
        r = await ac.post('/api/auth/login', json={'email': 'admin@example.com', 'password': 'ChangeMe@123'})
        h = {'Authorization': f"Bearer {r.json()['access_token']}"}
        r = await ac.post('/api/incidents/INC-99999/transition', json={'target_status': 'CLOSED'}, headers=h)
    assert r.status_code == 404
    entry = errors_log().split('req ' + r.json()['request_id'])[1]
    assert 'ResourceNotFoundError' in entry
    assert 'admin@example.com (admin)' in entry
    assert 'app/repositories.py' in entry


@pytest.mark.anyio
async def test_browser_errors_are_recorded():
    async with client() as ac:
        r = await ac.post('/api/client-errors', json={'kind': 'render', 'message': 'Cannot read properties of undefined',
                                                      'url': 'http://localhost:3000/incidents/1', 'reference': 'ui-abc'})
    assert r.status_code == 204
    log = errors_log()
    assert 'Browser error — Cannot read properties of undefined' in log
    assert 'A page crashed while rendering' in log


def test_mongo_outage_is_explained():
    from pymongo.errors import ServerSelectionTimeoutError
    what, fix = explain_exception(ServerSelectionTimeoutError('localhost:27017: Connection refused'))
    assert 'MongoDB' in what and 'MONGO_URL' in fix

"""Appearance (MiniMusic-style looks and gradients) is saved per account and comes back
with the user profile."""
import pytest
from httpx import AsyncClient, ASGITransport

from server import app
from app.core.db import init_db
from app.domain.appearance import Appearance, GradientTheme, ThemeColor
from tests.test_account_security import new_student


@pytest.fixture(scope='module')
def anyio_backend():
    return 'asyncio'


@pytest.fixture(scope='module', autouse=True)
async def setup_db(anyio_backend):
    await init_db()
    yield


def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url='http://test')


SUNSET = {'colors': [{'h': 0.07, 's': 0.78, 'b': 0.92}, {'h': 0.93, 's': 0.6, 'b': 0.85}], 'angle': 200}


def test_value_objects_fall_back_to_defaults():
    assert Appearance.from_doc(None) is None
    a = Appearance.from_doc({'theme': 'neon', 'gradient': {'colors': []}, 'saved_gradients': 'x'})
    assert a == Appearance() and a.theme == 'original' and a.gradient == GradientTheme() and a.saved_gradients == ()
    g = GradientTheme.from_doc({'colors': [{'h': 2, 's': -1, 'b': 'x'}] * 5, 'angle': 999})
    assert len(g.colors) == 3 and g.colors[0] == ThemeColor(1.0, 0.0, 0.0) and g.angle == 360
    assert Appearance.from_doc({'theme': 'gradient'}).is_gradient
    # documents saved by the earlier theme menu still load
    assert Appearance.from_doc({'theme': 'amoled', 'dark_variant': 'forest', 'amoled_style': 'material'}).theme == 'amoled'


@pytest.mark.anyio
async def test_appearance_saved_per_account():
    async with client() as ac:
        _, h1 = await new_student(ac)
        _, h2 = await new_student(ac)
        assert (await ac.get('/api/auth/me', headers=h1)).json()['appearance'] is None

        body = {'theme': 'gradient', 'gradient': SUNSET, 'saved_gradients': [SUNSET]}
        r = await ac.put('/api/account/appearance', headers=h1, json=body)
        assert r.status_code == 200, r.text
        saved = (await ac.get('/api/auth/me', headers=h1)).json()['appearance']
        assert saved['theme'] == 'gradient' and saved['gradient'] == SUNSET and saved['saved_gradients'] == [SUNSET]
        assert (await ac.get('/api/auth/me', headers=h2)).json()['appearance'] is None   # other account untouched

        # the glass frontend saves its theme without wiping the classic app's choice, and back
        r = await ac.put('/api/account/appearance', headers=h1, json={'theme': 'gradient', 'glass_theme': 'ember'})
        a = r.json()['appearance']
        assert a['glass_theme'] == 'ember' and a['gradient'] == SUNSET and a['saved_gradients'] == [SUNSET]
        r = await ac.put('/api/account/appearance', headers=h1, json={'theme': 'dark'})
        assert r.json()['appearance']['glass_theme'] == 'ember'
        assert (await ac.put('/api/account/appearance', headers=h1, json={'theme': 'dark', 'glass_theme': 'Neon Theme!'})).status_code == 422
        # any well-formed id is kept (new themes need no server change), and display preferences ride along
        r = await ac.put('/api/account/appearance', headers=h1, json={'theme': 'dark', 'glass_theme': 'sunlight', 'glass_prefs': {'colour_safe': True, 'auto_dark': 'graphite'}})
        assert r.json()['appearance']['glass_theme'] == 'sunlight' and r.json()['appearance']['glass_prefs']['colour_safe'] is True
        r = await ac.put('/api/account/appearance', headers=h1, json={'theme': 'light'})
        assert r.json()['appearance']['glass_prefs']['auto_dark'] == 'graphite'

        for look in ('greenboard', 'original', 'indigo'):
            r = await ac.put('/api/account/appearance', headers=h1, json={'theme': look})
            assert r.json()['appearance']['theme'] == look

        for bad in ({'theme': 'neon'},
                    {'theme': 'gradient', 'gradient': {'colors': [], 'angle': 0}},
                    {'theme': 'gradient', 'gradient': {'colors': [{'h': 1.5, 's': 0, 'b': 0}]}},
                    {'theme': 'light', 'saved_gradients': [SUNSET] * 25}):
            assert (await ac.put('/api/account/appearance', headers=h1, json=bad)).status_code == 422, bad
    async with client() as anonymous:      # fresh client: no sign-in cookie
        assert (await anonymous.put('/api/account/appearance', json={'theme': 'light'})).status_code == 401

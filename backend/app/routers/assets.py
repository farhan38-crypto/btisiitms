"""QR stickers: every registered PC, router, projector or room gets a code. Scanning
the sticker opens the report form with the equipment and location filled in."""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from app.core.container import container
from app.core.security import get_current_user, require_roles
from app.domain.enums import Role
from app.domain.exceptions import ResourceNotFoundError, InvalidInputError
from app.domain.models import Location
from app.domain.sla import utcnow
from app.models.schemas import AssetInput, clean_doc
from app.services.two_factor import qr_svg

router = APIRouter(prefix='/assets', tags=['assets & QR stickers'])
ADMIN = Role.ADMIN.value


def report_url(base: str, code: str) -> str:
    base = (base or '').strip().rstrip('/')
    if not base.startswith(('http://', 'https://')):
        raise InvalidInputError('base must be the address of the web app, e.g. https://example.ngrok-free.dev')
    return f'{base}/incidents/new?asset={code}'


def asset_doc(data: AssetInput, code=None) -> dict:
    loc = Location(data.location_type, data.academic_block if data.location_type != 'hostel' else None,
                   data.hostel_name if data.location_type == 'hostel' else None, (data.room_number or '').strip() or None)
    d = {'name': data.name.strip(), 'kind': data.kind.strip() or 'Equipment', 'location': loc.to_doc(),
         'category': data.category, 'service_name': data.service_name, 'notes': (data.notes or '').strip() or None}
    if code:
        d['code'] = code
    return d


@router.get('')
async def list_assets(_=Depends(require_roles(ADMIN, Role.TECHNICIAN.value))):
    return [clean_doc(d) for d in await container.assets.find({}, sort=[('code', 1)], limit=1000)]


@router.post('', status_code=201)
async def create_asset(data: AssetInput, _=Depends(require_roles(ADMIN))):
    code = await container.assets.next_code()
    return clean_doc(await container.assets.add({**asset_doc(data, code), 'created_at': utcnow().isoformat()}))


@router.put('/{code}')
async def update_asset(code: str, data: AssetInput, _=Depends(require_roles(ADMIN))):
    doc = await container.assets.by_code(code)
    if not doc:
        raise ResourceNotFoundError('Asset not found')
    return clean_doc(await container.assets.update(doc['_id'], asset_doc(data)))


@router.delete('/{code}', status_code=204)
async def delete_asset(code: str, _=Depends(require_roles(ADMIN))):
    doc = await container.assets.by_code(code)
    if not doc:
        raise ResourceNotFoundError('Asset not found')
    await container.assets.delete(doc['_id'])
    return Response(status_code=204)


@router.get('/{code}')
async def get_asset(code: str, _=Depends(get_current_user)):
    """Used by the report form after a sticker is scanned (any signed-in user)."""
    doc = await container.assets.by_code(code)
    if not doc:
        raise ResourceNotFoundError(f'No equipment is registered with the code {code.upper()}')
    open_reports = await container.incidents.count({'asset.code': doc['code'],
                                                    'status': {'$nin': ['RESOLVED', 'VERIFIED', 'CLOSED']}})
    return {**clean_doc(doc), 'open_reports': open_reports}


@router.get('/{code}/qr.svg')
async def asset_qr(code: str, base: str = Query(..., max_length=300), _=Depends(require_roles(ADMIN))):
    doc = await container.assets.by_code(code)
    if not doc:
        raise ResourceNotFoundError('Asset not found')
    return Response(content=qr_svg(report_url(base, doc['code'])), media_type='image/svg+xml')

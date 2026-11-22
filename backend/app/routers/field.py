"""On-site work: navigation, "on my way", GPS check-in, handover code, photos and voice notes."""
from fastapi import APIRouter, Depends
from fastapi.responses import Response

from app.core.container import container
from app.core.security import get_current_user, require_roles
from app.domain.enums import Role
from app.models.schemas import GeoInput, AttachmentInput, clean_doc

router = APIRouter(prefix='/incidents', tags=['field visits & attachments'])
STAFF = (Role.ADMIN.value, Role.TECHNICIAN.value)


@router.get('/{iid}/field')
async def field_info(iid, user=Depends(get_current_user)):
    return await container.field_visits.info(iid, user)


@router.post('/{iid}/field/en-route')
async def en_route(iid, user=Depends(require_roles(*STAFF))):
    return clean_doc(await container.field_visits.start_trip(iid, user))


@router.post('/{iid}/field/arrive')
async def arrive(iid, data: GeoInput, user=Depends(require_roles(*STAFF))):
    return clean_doc(await container.field_visits.arrive(iid, data, user))


@router.get('/{iid}/attachments')
async def list_attachments(iid, user=Depends(get_current_user)):
    return await container.attachment_service.list(iid, user)


@router.post('/{iid}/attachments', status_code=201)
async def add_attachment(iid, data: AttachmentInput, user=Depends(get_current_user)):
    return await container.attachment_service.add(iid, data, user)


attachments_router = APIRouter(prefix='/attachments', tags=['field visits & attachments'])


@attachments_router.get('/{aid}/content')
async def attachment_content(aid, user=Depends(get_current_user)):
    doc = await container.attachment_service.content(aid, user)
    return Response(content=bytes(doc['data']), media_type=doc.get('content_type') or 'application/octet-stream',
                    headers={'Cache-Control': 'private, max-age=3600'})

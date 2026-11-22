from fastapi import APIRouter, Depends

from app.core.container import container
from app.core.security import get_current_user, require_roles
from app.domain.enums import Role
from app.models.schemas import clean_doc

router = APIRouter(prefix='/catalog', tags=['catalog'])


@router.get('/services')
async def services(_=Depends(get_current_user)):
    return [clean_doc(x) for x in await container.services.find({}, sort=[('name', 1)], limit=200)]


@router.get('/categories')
async def categories(_=Depends(get_current_user)):
    return [clean_doc(x) for x in await container.categories.find({}, sort=[('name', 1)], limit=100)]


@router.get('/technicians')
async def technicians(_=Depends(require_roles(Role.ADMIN.value, Role.TECHNICIAN.value))):
    """Names for the technician filter and assignment pickers."""
    return [{'id': str(t['_id']), 'name': t['name'], 'skills': t.get('skills', [])}
            for t in await container.users.active_technicians()]

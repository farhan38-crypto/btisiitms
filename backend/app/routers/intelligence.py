from fastapi import APIRouter, Depends

from app.core.container import container
from app.core.security import get_current_user, require_roles
from app.domain.enums import Role
from app.models.schemas import AIGenerateRequest, AIGeneratedDetails, ScopeCheckRequest, SuggestRequest

router = APIRouter(prefix='/intelligence', tags=['intelligence'])
intel = container.intel
STAFF = (Role.ADMIN.value, Role.TECHNICIAN.value)


@router.post('/classify')
async def classify(payload: dict, user=Depends(get_current_user)):
    """Incident categorisation: suggests a category, impact and urgency from free text."""
    return await intel.classify(payload.get('title', ''), payload.get('description', ''))


@router.post('/generate-incident', response_model=AIGeneratedDetails)
async def generate_incident(payload: AIGenerateRequest, user=Depends(get_current_user)):
    return await intel.generate_incident_details(payload.description)


@router.post('/duplicates')
async def duplicates(payload: dict, user=Depends(require_roles(*STAFF))):
    return await intel.find_duplicates(payload.get('title', ''), payload.get('description', ''), payload.get('service_id'))


@router.get('/recommend/{iid}')
async def recommend(iid, user=Depends(require_roles(*STAFF))):
    service = container.incident_service
    incident = await service.get(iid)
    service.assert_access(incident, user)
    return await intel.recommend(incident)


@router.get('/correlations')
async def correlations(user=Depends(require_roles(*STAFF))):
    """Incident correlation: groups of open incidents that probably share one root cause."""
    s = await container.settings.get_settings()
    return await intel.correlation_clusters(int(s['correlation_window_minutes']), int(s['correlation_threshold']))


@router.post('/scope')
async def scope(payload: ScopeCheckRequest, user=Depends(get_current_user)):
    """Is this report an IT/facilities issue? Non-IT reports come back with who to contact instead.
    use_ai=false gives an instant rules-only answer (used while the student is typing)."""
    result = await intel.assess_scope(payload.title, payload.description, use_ai=payload.use_ai)
    return result.to_dict()


@router.post('/suggest')
async def suggest(payload: SuggestRequest, user=Depends(get_current_user)):
    """Autofill for the report form: likely categories and services (keyword rules, no AI, instant)."""
    return intel.suggest(payload.title, payload.description, payload.categories, payload.services)

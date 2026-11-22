from datetime import datetime, timezone
from typing import Literal, Optional
from bson import ObjectId
from pydantic import BaseModel, Field
class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str = Field(min_length=8)
    phone: Optional[str] = None

class LoginRequest(BaseModel):
    email: str
    password: str

class GoogleAuthRequest(BaseModel):
    credential: Optional[str] = None
    # Random value the browser sent to Google; Google copies it into the ID token.
    nonce: Optional[str] = None

class PasswordResetRequest(BaseModel):
    email: str

class PasswordResetConfirm(BaseModel):
    email: str
    code: str = Field(min_length=6, max_length=6, pattern=r'^\d{6}$')
    password: str = Field(min_length=8)

class AIGenerateRequest(BaseModel):
    description: str = Field(min_length=10, max_length=6000)

class AIGeneratedDetails(BaseModel):
    title: str = Field(min_length=4, max_length=160)
    description: str = Field(min_length=10, max_length=6000)
    category: str
    subcategory: Optional[str] = None
    priority: str
    impact: int = Field(ge=1, le=3)
    urgency: int = Field(ge=1, le=3)
    tags: list[str] = Field(default_factory=list, max_length=8)
    suggested_assignment_group: Optional[str] = None
    missing_information: list[str] = Field(default_factory=list, max_length=5)
    clarifying_questions: list[str] = Field(default_factory=list, max_length=4)
    confidence: float = Field(ge=0, le=1)
    scope: Optional[dict] = None        # is this an IT issue? (see app/domain/scope.py)
    service: Optional[str] = None       # likely affected service name
    affected_users: int = Field(default=1, ge=1)
    business_criticality: int = Field(default=1, ge=1, le=3)
    location: Optional[dict] = None     # {type, hostel_name, academic_block, room_number} read from the text

class SuggestRequest(BaseModel):
    title: str = Field(default='', max_length=300)
    description: str = Field(default='', max_length=6000)
    categories: Optional[list[str]] = Field(default=None, max_length=100)
    services: Optional[list[str]] = Field(default=None, max_length=200)

class ScopeCheckRequest(BaseModel):
    title: str = Field(default='', max_length=300)
    description: str = Field(default='', max_length=6000)
    use_ai: bool = True

class CreateUserRequest(BaseModel):
    name: str
    email: str
    password: str = Field(min_length=8)
    role: str  # 'admin' or 'technician'
    skills: list[str] = []
    max_concurrent: int = Field(default=5, ge=1, le=50)
    phone: Optional[str] = None

class IncidentCreate(BaseModel):
    title: str = Field(min_length=4, max_length=160)
    description: str = Field(min_length=10)
    category: str
    service_id: str
    impact: int = Field(ge=1, le=3)
    urgency: int = Field(ge=1, le=3)
    business_criticality: int = Field(default=1, ge=1, le=3)
    affected_users: int = Field(default=1, ge=1)
    location_type: Optional[str] = 'online'  # 'academics', 'hostel', or 'online'
    academic_block: Optional[str] = None
    hostel_name: Optional[str] = None
    room_number: Optional[str] = None
    phone: Optional[str] = None
    student_id: Optional[str] = None
    visit_availability: Optional[str] = Field(default=None, max_length=200)   # when a technician can visit the room
    acknowledge_duplicate: bool = False
    confirm_in_scope: bool = False      # reporter confirmed it is IT/facilities after a non-IT warning
    # Where exactly (phone GPS, optional). Without it the building's pin is used.
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    accuracy_m: Optional[float] = Field(default=None, ge=0, le=100000)
    asset_code: Optional[str] = Field(default=None, max_length=20)     # scanned from a QR sticker

class IncidentUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=4, max_length=160)
    description: Optional[str] = Field(default=None, min_length=10)
    impact: Optional[int] = Field(default=None, ge=1, le=3)
    urgency: Optional[int] = Field(default=None, ge=1, le=3)
    business_criticality: Optional[int] = Field(default=None, ge=1, le=3)
    affected_users: Optional[int] = Field(default=None, ge=1)
    location_type: Optional[str] = None
    academic_block: Optional[str] = None
    hostel_name: Optional[str] = None
    room_number: Optional[str] = None
    phone: Optional[str] = None

class TransitionRequest(BaseModel):
    target_status: str
    resolution_summary: Optional[str] = Field(default=None, max_length=3000)
    root_cause: Optional[str] = Field(default=None, max_length=1000)
    feedback_rating: Optional[int] = Field(default=None, ge=1, le=5)
    feedback_comment: Optional[str] = Field(default=None, max_length=1000)
    handover_code: Optional[str] = Field(default=None, max_length=10)

class GeoInput(BaseModel):
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)
    accuracy_m: Optional[float] = Field(default=None, ge=0, le=100000)

class AttachmentInput(BaseModel):
    kind: str = Field(pattern=r'^(photo|voice)$')
    content_type: str = Field(max_length=100)
    data_base64: str = Field(min_length=8, max_length=12 * 1024 * 1024)
    stage: Optional[str] = Field(default=None, pattern=r'^(before|after|evidence)$')
    caption: Optional[str] = Field(default=None, max_length=200)
    duration_s: Optional[float] = Field(default=None, gt=0, le=200)
    transcript: Optional[str] = Field(default=None, max_length=4000)

class AssetInput(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    kind: str = Field(default='Computer', max_length=40)
    location_type: str = Field(default='academics', pattern=r'^(academics|hostel|online)$')
    academic_block: Optional[str] = None
    hostel_name: Optional[str] = None
    room_number: Optional[str] = Field(default=None, max_length=40)
    category: Optional[str] = Field(default=None, max_length=60)
    service_name: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=300)

class BuildingPinInput(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)

class AssignRequest(BaseModel):
    technician_id: str

class NoteInput(BaseModel):
    text: str = Field(min_length=1, max_length=3000)
    kind: str = 'investigation'

class ServiceInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str = Field(default='', max_length=500)
    criticality: int = Field(default=1, ge=1, le=3)

class CategoryInput(BaseModel):
    name: str = Field(min_length=2, max_length=60)

class SlaPolicyInput(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    priority: str = Field(pattern=r'^P[1-4]$')
    response_minutes: int = Field(gt=0, le=60 * 24 * 30)
    resolution_minutes: int = Field(gt=0, le=60 * 24 * 90)
    service_id: Optional[str] = None

class UpdateUserRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=30)
    skills: Optional[list[str]] = None
    max_concurrent: Optional[int] = Field(default=None, ge=1, le=50)

class SettingsUpdate(BaseModel):
    assignment_strategy: Optional[str] = None
    priority_strategy: Optional[str] = None
    auto_assign_on_create: Optional[bool] = None
    escalation_enabled: Optional[bool] = None
    escalation_priorities: Optional[list[str]] = None
    correlation_window_minutes: Optional[int] = Field(default=None, ge=10, le=1440)
    correlation_threshold: Optional[int] = Field(default=None, ge=2, le=20)
    require_admin_2fa: Optional[bool] = None
    require_handover_code: Optional[bool] = None
    arrival_radius_m: Optional[int] = Field(default=None, ge=30, le=1000)
# Never sent to the browser, whatever endpoint returns the document.
PRIVATE_FIELDS = {'password_hash', 'totp_secret', 'totp_pending_secret', 'backup_codes', 'totp_last_step', 'code_hash'}

def serialize(v):
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, list):
        return [serialize(x) for x in v]
    if isinstance(v, dict):
        return {k: serialize(x) for k, x in v.items() if k not in PRIVATE_FIELDS}
    return v

def clean_doc(d):
    if d is None:
        return None
    d = dict(d)
    if '_id' in d:
        d['id'] = str(d.pop('_id'))
    elif 'id' not in d:
        d['id'] = None
    return serialize(d)


# ───────────── account & security ─────────────
PHONE_PATTERN = r'^\+?[0-9][0-9 ()-]{6,19}$'

class TwoFactorLoginRequest(BaseModel):
    mfa_token: str = Field(min_length=10, max_length=2000)
    code: str = Field(min_length=6, max_length=20)

class AuthenticatorResetRequest(BaseModel):
    email: str
    code: str = Field(min_length=6, max_length=20)
    password: str = Field(min_length=8, max_length=128)

class ProfileUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=30)

class PasswordChange(BaseModel):
    current_password: Optional[str] = Field(default=None, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)

class CodeInput(BaseModel):
    code: str = Field(min_length=6, max_length=20)

class PreferencesUpdate(BaseModel):
    email_notifications: Optional[bool] = None

class ThemeColorIn(BaseModel):
    h: float = Field(ge=0, le=1)
    s: float = Field(ge=0, le=1)
    b: float = Field(ge=0, le=1)

class GradientIn(BaseModel):
    colors: list[ThemeColorIn] = Field(min_length=1, max_length=3)
    angle: float = Field(default=135, ge=0, le=360)

class AppearanceUpdate(BaseModel):
    theme: Literal['original', 'indigo', 'amoled', 'dark', 'greenboard', 'light', 'gradient']
    gradient: Optional[GradientIn] = None
    saved_gradients: list[GradientIn] = Field(default_factory=list, max_length=24)
    glass_theme: Optional[str] = Field(default=None, pattern=r'^[a-z0-9][a-z0-9-]{1,39}$')
    glass_prefs: Optional['GlassPrefsIn'] = None

class GlassPrefsIn(BaseModel):
    reduce_transparency: bool = False
    reduce_motion: bool = False
    colour_safe: bool = False
    auto_light: Optional[str] = Field(default=None, pattern=r'^[a-z0-9][a-z0-9-]{1,39}$')
    auto_dark: Optional[str] = Field(default=None, pattern=r'^[a-z0-9][a-z0-9-]{1,39}$')

AppearanceUpdate.model_rebuild()

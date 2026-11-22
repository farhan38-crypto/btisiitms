// Shapes of what the backend sends and accepts. Written from backend/app (routers,
// models/schemas.py, domain/*); comments name the source when it helps.

export type Role = 'admin' | 'technician' | 'customer'
export type Priority = 'P1' | 'P2' | 'P3' | 'P4'
export type Status = 'NEW' | 'CLASSIFIED' | 'ASSIGNED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'PENDING_INFO' | 'RESOLVED' | 'VERIFIED' | 'CLOSED'
export type SlaStatus = 'ON_TRACK' | 'AT_RISK' | 'BREACHED' | 'MET'
export type LocationType = 'online' | 'hostel' | 'academics'

export const OPEN_STATUSES: Status[] = ['NEW', 'CLASSIFIED', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'PENDING_INFO']
export const DONE_STATUSES: Status[] = ['RESOLVED', 'VERIFIED', 'CLOSED']
export const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4']

// ───────── users & account (core/security.public_user, routers/account) ─────────
export interface GlassPrefs { reduce_transparency: boolean; reduce_motion: boolean; colour_safe: boolean; auto_light?: string; auto_dark?: string }
export interface Appearance { theme: string; glass_theme?: string; glass_prefs?: GlassPrefs; [k: string]: unknown }

export interface User {
  id: string; name: string; email: string; role: Role
  student_id?: string | null; phone?: string | null; picture?: string | null
  skills: string[]; max_concurrent: number; is_active: boolean
  two_factor_enabled: boolean
  two_factor_required?: boolean          // only from /auth/me
  appearance?: Appearance | null
  created_at?: string
}

export interface Session { access_token: string; token_type: 'bearer'; user: User; backup_codes_left?: number }
export interface MfaChallenge { mfa_required: true; mfa_token: string; methods: ('authenticator' | 'backup_code')[] }
export type LoginResult = Session | MfaChallenge
export const isMfa = (r: LoginResult): r is MfaChallenge => (r as MfaChallenge).mfa_required === true

export interface SecurityEvent { id: string; event: string; label: string; method?: string | null; method_label?: string | null; ip?: string | null; user_agent?: string | null; actor?: string | null; detail?: string | null; at: string }
export interface TwoFactorState { enabled: boolean; enabled_at?: string | null; backup_codes_left: number; required?: boolean }
export interface AccountOverview {
  user: User; created_at?: string | null; google_linked: boolean; password_set: boolean
  two_factor: TwoFactorState; preferences: { email_notifications: boolean }; activity: SecurityEvent[]
}
export interface TwoFactorSetup { secret: string; otpauth_uri: string; qr_svg: string; issuer: string; account: string }

// ───────── incidents (domain/models.Incident, IncidentFactory) ─────────
export interface Location { type: LocationType; academic_block?: string | null; hostel_name?: string | null; room_number?: string | null; formatted: string }
export interface Geo { lat: number; lng: number; accuracy_m?: number | null; source: 'gps' | 'building' | 'asset' | 'manual' }
export interface Sla {
  policy_id?: string; policy_name?: string; response_minutes: number; resolution_minutes: number
  response_due_at: string; resolution_due_at: string; status: SlaStatus
  responded_at?: string | null; resolved_at?: string | null
  response_breached?: boolean; resolution_breached?: boolean; violations_recorded?: string[]
}
export interface Note { id: string; text: string; kind: string; author_id: string; author_name: string; created_at: string }
export interface Resolution { summary: string; root_cause?: string; resolved_at: string; resolved_by: string }
export interface Closure { feedback_rating: number; feedback_comment?: string; closed_at: string; closed_by: string }
export interface Escalation { level: number; label: string; escalated_at: string; history?: { level: number; label: string; at: string }[] }
export interface FieldVisit {
  status: 'EN_ROUTE' | 'ARRIVED'; technician_id: string; technician_name: string
  en_route_at?: string | null; arrived_at?: string | null; arrival_point?: Geo | null
  distance_m?: number | null; verified?: boolean | null
  handover_verified_at?: string; handover_verified_by?: string
}
export interface IncidentRef { id: string; number: string; title: string; status: Status; priority: Priority; service_name?: string; score?: number }

export interface Incident {
  id: string; number: string; title: string; description: string
  category: string; service_id: string; service_name: string; service_criticality?: number
  reporter_id: string; reporter_name: string; reporter_email?: string; student_id?: string | null; phone?: string | null
  location: Location; visit_availability?: string | null
  impact: number; urgency: number; business_criticality: number; affected_users: number
  priority: Priority; score?: number; strategy?: string
  status: Status; assigned_to?: string | null; assigned_name?: string | null
  sla?: Sla | null; notes: Note[]; resolution?: Resolution | null; closure?: Closure | null
  escalation?: Escalation | null; possible_duplicates?: IncidentRef[]
  geo?: Geo | null; field_visit?: FieldVisit | null; asset?: { code: string; name: string } | null
  created_at: string; updated_at: string
}

export interface AuditEntry {
  id: string; incident_id: string; incident_number: string; actor_id?: string; actor_name: string; actor_role?: string
  action: string; description: string; previous_state?: string | null; new_state?: string | null
  data?: Record<string, unknown> | null; timestamp: string
}
export interface Recommendation {
  technician_id: string; name: string; skills: string[]; open_count: number; max_concurrent: number
  has_capacity: boolean; score: number; breakdown: Record<string, number>
}
export interface RelatedIncident { id: string; number: string; title: string; status: Status; priority: Priority; service_name?: string; reason: string }
export interface SuggestedResolution { id: string; number: string; title: string; summary: string; root_cause?: string; score: number }

export interface IncidentDetail {
  incident: Incident
  allowed_transitions: Status[]
  audit: AuditEntry[]
  recommendations: Recommendation[]
  related: RelatedIncident[]
  suggested_resolutions: SuggestedResolution[]
}

export interface IncidentFilters {
  q?: string; status?: Status | ''; priority?: Priority | ''; category?: string; service_id?: string
  assigned_to?: string; sla_status?: SlaStatus | ''; scope?: 'assigned' | 'unassigned' | ''
  date_from?: string; date_to?: string; escalated?: boolean; limit?: number
}

export interface IncidentCreate {
  title: string; description: string; category: string; service_id: string
  impact: number; urgency: number; business_criticality?: number; affected_users?: number
  location_type: LocationType; academic_block?: string | null; hostel_name?: string | null; room_number?: string | null
  phone?: string | null; student_id?: string | null; visit_availability?: string | null
  acknowledge_duplicate?: boolean; confirm_in_scope?: boolean
  latitude?: number | null; longitude?: number | null; accuracy_m?: number | null; asset_code?: string | null
}
export type IncidentUpdate = Partial<Pick<IncidentCreate, 'title' | 'description' | 'impact' | 'urgency' | 'business_criticality' | 'affected_users' | 'location_type' | 'academic_block' | 'hostel_name' | 'room_number' | 'phone'>>
export interface TransitionInput {
  target_status: Status; resolution_summary?: string; root_cause?: string
  feedback_rating?: number; feedback_comment?: string; handover_code?: string
}

// ───────── field visits & attachments (services/field_service.py, domain/attachments.py) ─────────
export interface FieldInfo {
  on_site: boolean; geo: Geo | null; precise: boolean; building: string | null
  navigation: { google: string; osm: string } | null
  visit: FieldVisit | null
  handover: { required: boolean; verified_at: string | null; locked: boolean; attempts_left: number; code: string | null } | null
}
export interface Attachment {
  id: string; incident_id: string; kind: 'photo' | 'voice'; content_type: string; size: number
  uploaded_by: string; uploaded_by_name: string; uploaded_by_role: Role; created_at: string
  stage?: 'before' | 'after' | 'evidence'; caption?: string | null
  duration_s?: number | null; transcript?: string | null
}
export interface AttachmentInput {
  kind: 'photo' | 'voice'; content_type: string; data_base64: string
  stage?: 'before' | 'after' | 'evidence'; caption?: string; duration_s?: number; transcript?: string
}

// ───────── intelligence (services/intelligence.py, domain/scope.py) ─────────
export interface Contact { label: string; number: string; note?: string }
export interface ScopeAssessment {
  in_scope: boolean; kind: string; source: string; matched: string[]
  title: string; message: string; contacts: Contact[]; emergency: boolean
}
export interface GeneratedIncident {
  title: string; description: string; category: string; subcategory?: string | null; priority: Priority
  impact: number; urgency: number; tags: string[]; suggested_assignment_group?: string | null
  missing_information: string[]; clarifying_questions: string[]; confidence: number
  scope?: ScopeAssessment | null; service?: string | null; affected_users: number; business_criticality: number
  location?: { type?: LocationType; hostel_name?: string | null; academic_block?: string | null; room_number?: string | null } | null
}
export interface Suggestions { categories: { name: string; score: number }[]; services: { name: string; score: number }[] }
export interface Correlation {
  service_id: string; service_name: string; count: number; window_minutes: number; first_seen: string; last_seen: string
  incidents: IncidentRef[]; suggestion: string
}
export interface BuildingCluster {
  building: string; count: number; window_minutes: number; services: string[]; first_seen: string
  incidents: IncidentRef[]; suggestion: string
}

// ───────── catalog & admin ─────────
export interface Service { id: string; name: string; description: string; criticality: number; incident_count?: number }
export interface Category { id: string; name: string; incident_count?: number }
export interface Technician { id: string; name: string; skills: string[] }
export interface SlaPolicy { id: string; name: string; priority: Priority; response_minutes: number; resolution_minutes: number; service_id: string | null; service_name?: string }
export interface StrategyInfo { key: string; name: string; description: string }
export interface Settings {
  assignment_strategy: string; priority_strategy: string; auto_assign_on_create: boolean
  escalation_enabled: boolean; escalation_priorities: Priority[]
  correlation_window_minutes: number; correlation_threshold: number
  require_admin_2fa: boolean; require_handover_code: boolean; arrival_radius_m: number
}
export interface SettingsBundle { settings: Settings; assignment_strategies: StrategyInfo[]; priority_strategies: StrategyInfo[] }
export interface SlaViolation {
  id: string; incident_id: string; incident_number: string; title: string; priority: Priority; service_name?: string
  assigned_to?: string | null; assigned_name?: string | null; kind: 'response' | 'resolution'; due_at: string; detected_at: string
}
export interface NewUser { name: string; email: string; password: string; role: 'admin' | 'technician'; skills?: string[]; max_concurrent?: number; phone?: string }

// ───────── reports (routers/reports.py) ─────────
export interface Overview {
  totals: {
    total: number; open: number; resolved: number; resolved_today: number; critical: number; p1_open: number
    breached: number; at_risk: number; escalated_open: number; sla_violations: number; avg_resolution_minutes: number | null
  }
  by_status: { name: Status; value: number }[]
  by_priority: { name: Priority; value: number }[]
  by_category: { name: string; value: number }[]
  by_service: { name: string; total: number; open: number; breached: number }[]
  sla: { met: number; breached: number; at_risk: number; on_track: number; compliance_rate: number }
  technician_workload: { id: string; name: string; skills: string[]; max_concurrent: number; is_active: boolean; open: number; resolved: number }[]
  recent_violations: SlaViolation[]
  correlations: Correlation[]
  strategies: { assignment: string; priority: string }
}
export interface Trends {
  days: number; timezone: string
  daily: { date: string; created: number; resolved: number; open: number }[]
  heatmap: number[][]
  buildings: { building: string; P1: number; P2: number; P3: number; P4: number; total: number }[]
}

// ───────── campus & assets ─────────
export interface Building { name: string; lat: number; lng: number; corrected: boolean }
export interface MapPoint {
  id: string; number: string; title: string; priority: Priority; status: Status; service_name?: string; category?: string
  location?: string; building?: string | null; created_at: string; assigned_name?: string | null; sla_status?: SlaStatus
  lat: number; lng: number; accuracy_m?: number | null; source?: string
}
export interface Hotspot { building: string; count: number; open: number; worst_priority: Priority | null; breached: number; is_hotspot: boolean }
export interface CampusMapData { points: MapPoint[]; hotspots: Hotspot[]; outages: BuildingCluster[]; days: number; threshold: number }

export interface Asset {
  id: string; code: string; name: string; kind: string; location: Location
  category?: string | null; service_name?: string | null; notes?: string | null; created_at?: string; open_reports?: number
}
export interface AssetInput {
  name: string; kind: string; location_type: LocationType; academic_block?: string | null; hostel_name?: string | null
  room_number?: string | null; category?: string | null; service_name?: string | null; notes?: string | null
}

// ───────── notifications, live, docs ─────────
export interface Notification {
  id: string; user_id: string; title: string; message: string; kind: string
  incident_id?: string | null; incident_number?: string | null; read: boolean; created_at: string
}
export interface LiveEvent {
  type: string; incident_id: string; number: string; title: string; status: Status; priority: Priority
  description: string; actor_id?: string; actor_name?: string; new_state?: string | null; timestamp: string
}
export interface DocsPayload { title: string; sections: { title: string; body: string }[] }

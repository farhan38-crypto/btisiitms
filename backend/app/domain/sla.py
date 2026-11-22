from datetime import datetime, timezone, timedelta
from app.domain.enums import SlaStatus

def utcnow():
    return datetime.now(timezone.utc)

def parse_dt(v):
    if not v:
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(v).replace('Z', '+00:00'))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None

def build_sla(policy, created):
    resp_min = policy.get('response_minutes', 60)
    res_min = policy.get('resolution_minutes', 480)
    return {
        'policy_id': str(policy.get('_id', '')),
        'policy_name': policy.get('name', 'Default SLA'),
        'response_minutes': resp_min,
        'resolution_minutes': res_min,
        'response_due_at': (created + timedelta(minutes=resp_min)).isoformat(),
        'resolution_due_at': (created + timedelta(minutes=res_min)).isoformat(),
        'status': SlaStatus.ON_TRACK.value,
        'responded_at': None,
        'resolved_at': None
    }

AT_RISK_FRACTION = 0.25

def at_risk_window(sla):
    """Warn when the last 25% of the resolution window starts
    (P1 30 min → last 7.5 min, P4 24 h → last 6 h)."""
    return timedelta(minutes=sla.get('resolution_minutes', 60) * AT_RISK_FRACTION)

def evaluate_sla(sla, now=None):
    if not sla or not isinstance(sla, dict):
        return sla
    now = parse_dt(now) if now else utcnow()
    response_due = parse_dt(sla.get('response_due_at'))
    resolution_due = parse_dt(sla.get('resolution_due_at'))
    if not response_due or not resolution_due:
        return sla
    responded_at = parse_dt(sla.get('responded_at'))
    resolved_at = parse_dt(sla.get('resolved_at'))
    response_breached = (responded_at > response_due) if responded_at else (now >= response_due)
    resolution_breached = (resolved_at > resolution_due) if resolved_at else (now >= resolution_due)
    if sla.get('resolved_at'):
        status = SlaStatus.MET.value if (not response_breached and not resolution_breached) else SlaStatus.BREACHED.value
    elif resolution_breached or response_breached:
        status = SlaStatus.BREACHED.value
    elif (resolution_due - now) <= at_risk_window(sla):
        status = SlaStatus.AT_RISK.value
    else:
        status = SlaStatus.ON_TRACK.value
    return {**sla, 'response_breached': response_breached, 'resolution_breached': resolution_breached, 'status': status}


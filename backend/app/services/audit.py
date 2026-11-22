"""Kept for backwards compatibility: the audit trail now lives in
app/repositories.py (AuditRepository) and is written by AuditObserver
(app/services/observers.py) for every incident event."""
from app.repositories import AuditRepository as AuditLogger  # noqa: F401

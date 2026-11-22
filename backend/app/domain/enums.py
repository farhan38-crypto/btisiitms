from enum import Enum

class Role(str, Enum):
    ADMIN="admin"; TECHNICIAN="technician"; CUSTOMER="customer"; SYSTEM="system"
class IncidentStatus(str, Enum):
    NEW="NEW"; CLASSIFIED="CLASSIFIED"; ASSIGNED="ASSIGNED"; ACKNOWLEDGED="ACKNOWLEDGED"; IN_PROGRESS="IN_PROGRESS"; PENDING_INFO="PENDING_INFO"; RESOLVED="RESOLVED"; VERIFIED="VERIFIED"; CLOSED="CLOSED"
class Priority(str, Enum): P1="P1"; P2="P2"; P3="P3"; P4="P4"
class SlaStatus(str, Enum): ON_TRACK="ON_TRACK"; AT_RISK="AT_RISK"; BREACHED="BREACHED"; MET="MET"
OPEN_STATUSES=[x.value for x in [IncidentStatus.NEW,IncidentStatus.CLASSIFIED,IncidentStatus.ASSIGNED,IncidentStatus.ACKNOWLEDGED,IncidentStatus.IN_PROGRESS,IncidentStatus.PENDING_INFO]]

from app.domain.strategies import *
from app.domain.enums import *
from app.domain.state import StateFactory
from app.domain.exceptions import *
def test_priority_boundaries():assert WeightedScorePriorityStrategy().calculate(PriorityInput(3,3,2,1)).priority==Priority.P1;assert WeightedScorePriorityStrategy().calculate(PriorityInput(1,1,1,1)).priority==Priority.P4
def test_invalid_priority():
 import pytest
 with pytest.raises(InvalidInputError):PriorityInput(0,2,1,1)
def test_state():
 import pytest
 with pytest.raises(InvalidStateTransitionError):StateFactory.get(IncidentStatus.NEW).transition(IncidentStatus.CLOSED,Role.ADMIN)
def test_assignment():
 p=TechnicianProfile('1','A',['Network']);assert SkillBasedStrategy().select({'category':'Network','priority':'P3'},[p]).id=='1'

def test_matrix_priority_p1(): assert MatrixPriorityStrategy().calculate(PriorityInput(3,3)).priority==Priority.P1
def test_matrix_priority_p2(): assert MatrixPriorityStrategy().calculate(PriorityInput(2,3)).priority==Priority.P2
def test_matrix_priority_p3(): assert MatrixPriorityStrategy().calculate(PriorityInput(1,3)).priority==Priority.P3
def test_matrix_priority_p4(): assert MatrixPriorityStrategy().calculate(PriorityInput(1,1)).priority==Priority.P4
def test_capacity_rejects_non_p1():
 import pytest
 p=TechnicianProfile('1','A',['Network'],open_count=5,max_concurrent=5)
 with pytest.raises(TechnicianUnavailableError):LoadBalancedStrategy().select({'category':'Network','priority':'P3'},[p])
def test_p1_capacity_override():
 p=TechnicianProfile('1','A',['Network'],open_count=5,max_concurrent=5);assert LoadBalancedStrategy().select({'category':'Network','priority':'P1'},[p]).id=='1'
def test_smart_has_breakdown():
 p=TechnicianProfile('1','A',['Database']);r=SmartRecommendationStrategy().rank({'category':'Database'},[p])[0];assert set(r.breakdown)=={'skill','load','experience','service','speed'}
def test_closed_terminal(): assert StateFactory.get(IncidentStatus.CLOSED).is_terminal()
def test_customer_can_verify(): assert StateFactory.get(IncidentStatus.RESOLVED).transition(IncidentStatus.VERIFIED,Role.CUSTOMER).name==IncidentStatus.VERIFIED
def test_technician_cannot_verify():
 import pytest
 with pytest.raises(UnauthorizedOperationError):StateFactory.get(IncidentStatus.RESOLVED).transition(IncidentStatus.VERIFIED,Role.TECHNICIAN)
def test_pending_info_customer_resume(): assert StateFactory.get(IncidentStatus.PENDING_INFO).transition(IncidentStatus.IN_PROGRESS,Role.CUSTOMER).name==IncidentStatus.IN_PROGRESS

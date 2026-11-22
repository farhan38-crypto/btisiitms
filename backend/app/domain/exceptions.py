"""Custom exception hierarchy.

Every business-rule failure is an ITSMError subclass carrying its own HTTP
status code, so routers never translate errors by hand: a single handler in
app/core/error_handling.py turns any ITSMError into a JSON response.
"""


class ITSMError(Exception):
    status_code = 400

    def __init__(self, message, **extra):
        super().__init__(message)
        self.message = message
        self.extra = extra          # extra JSON fields for the error response


class InvalidInputError(ITSMError):
    """Request data breaks a business rule (invalid user input)."""
    status_code = 422


class InvalidCodeError(InvalidInputError):
    """A one-time code (authenticator, backup code) is wrong or already used."""


class TooManyAttemptsError(ITSMError):
    """Too many wrong attempts in a short time; the user has to wait."""
    status_code = 429


class AuthenticationError(ITSMError):
    """Invalid login: wrong email/password or unusable credentials."""
    status_code = 401


class UnauthorizedOperationError(ITSMError):
    """The user's role may not perform this operation."""
    status_code = 403


class ResourceNotFoundError(ITSMError):
    """Invalid incident, user, service or category reference."""
    status_code = 404


class ServiceNotFoundError(ResourceNotFoundError):
    """The affected IT service does not exist."""


class InvalidStateTransitionError(ITSMError):
    """The incident lifecycle does not allow this status change."""
    status_code = 409


class TechnicianUnavailableError(ITSMError):
    """No suitable technician can take the incident."""
    status_code = 409


class WorkloadExceededError(TechnicianUnavailableError):
    """A specific technician is already at their max_concurrent limit."""


class DuplicateIncidentError(ITSMError):
    """A very similar open incident already exists."""
    status_code = 409


class AlreadyExistsError(ITSMError):
    """A user, service, category or policy with the same identity already exists."""
    status_code = 409


class ResourceInUseError(ITSMError):
    """A configuration item (service, category, SLA policy) is still referenced."""
    status_code = 409


class OutOfScopeError(ITSMError):
    """The report is not an IT/facilities issue (e.g. a medical emergency)."""
    status_code = 422


class MissingSlaConfigError(ITSMError):
    """No SLA policy matches the incident's priority/service."""
    status_code = 500


class ExternalServiceError(ITSMError):
    """An external integration (SMTP email, Google, AI) failed or is not configured."""
    status_code = 503


class DatabaseUnavailableError(ITSMError):
    """The database could not be reached (database failure)."""
    status_code = 503

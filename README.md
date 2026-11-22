# BITS reports | Campus IT Support

A full-stack campus IT reporting application for CS F213/MAC F212. It provides role-based report workflows, Google Workspace sign-in, and optional server-side AI assistance.

## Stack
- React 19 + TypeScript + Vite (`frontend-next/`, the app) with a typed API layer, Motion, MapLibre and Lucide
- The original React app (`frontend/`) is kept as a backup
- FastAPI + Pydantic + Motor
- MongoDB
- JWT authentication + bcrypt password hashing
- Strategy + State patterns, service-layer composition, custom exceptions
- Intelligent classification, duplicate detection, smart technician recommendation and SLA evaluation

## Run locally

### 1. MongoDB
Run MongoDB locally on `mongodb://localhost:27017`, or change `backend/.env`.

### 2. Backend
```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

### 3. Frontend
```bash
cd frontend-next
npm install
npm run dev
```
Open http://localhost:3000. (The original app in `frontend/` still runs with `./start.sh --classic`, on port 3001.)

## Quick start on any computer (Mac or Windows)

The start script sets everything up on the first run (settings files, Python environment, packages, MongoDB) and starts the app. Later runs skip what is already done.

**Install once:** [Python 3.12](https://www.python.org/downloads/) (on Windows tick *Add python.exe to PATH*), [Node.js LTS](https://nodejs.org), and MongoDB Community Server. On a Mac that's `brew tap mongodb/brew && brew install mongodb-community`. On Windows use the [installer](https://www.mongodb.com/try/download/community) (keep *Install MongoD as a Service* ticked) or `winget install MongoDB.Server`. If Docker Desktop is installed, you can skip MongoDB and the script runs it in Docker.

**Run:**

| | Mac | Windows |
|---|---|---|
| Start | `./start.sh` in Terminal | double-click `start.bat` |
| Without the public link | `./start.sh --local` | `start.bat -Local` |
| Also run the old app (port 3001) | `./start.sh --classic` | `start.bat -Classic` |
| Stop | Ctrl+C | press Enter in the start window |

Then open http://localhost:3000. Google sign-in works on `localhost` with no extra setup.

**Optional public link (phones, other laptops):** install ngrok (`brew install ngrok` / `winget install ngrok.ngrok`), sign up free at dashboard.ngrok.com, then run `ngrok config add-authtoken <your token>` once. The start script then prints your own permanent `https://….ngrok-free.dev` link. For Google sign-in on that link, the owner of the Google Cloud project has to add `<that link>/login` to the OAuth client's Authorized redirect URIs (once per person).

**Docker instead:** with only Docker Desktop installed, run `docker compose up --build` and open http://localhost:3000. `docker compose down` stops it (reports are kept). Add `--profile classic` to also run the old app on http://localhost:3001. Edits to `frontend-next/src` and `backend/app` show up live.

AI suggestions and password-reset emails need the Gemini and SMTP keys in `backend/.env`. Without them the app still works and uses its built-in fallbacks.

## Seeded accounts
- Admin: `admin@example.com` / `ChangeMe@123`
- Customer: `emma@example.com` / `Customer@1234`
- Technician: `alice.chen@itsm.local` / `Tech@1234`

Change the admin password and JWT secret before any real deployment.

## Google sign-in and AI configuration

Copy `backend/.env.example` to `backend/.env` and configure the following values without committing credentials:

- `GOOGLE_CLIENT_ID` — Google OAuth web client ID. Also set it in the frontend as `REACT_APP_GOOGLE_CLIENT_ID`.
- `ALLOWED_EMAIL_DOMAIN` — permitted verified Workspace domain (defaults to `hyderabad.bits-pilani.ac.in`).
- `COOKIE_SECURE=true` in HTTPS production.
- `LLM_API_KEY` and `LLM_MODEL` — optional Gemini-compatible model configuration. When unavailable, the report assistant uses a deterministic, validated fallback.

In Google Cloud Console (APIs & Services → Credentials → your **Web application** OAuth client), add `/login` on every address the app is opened from to **Authorized redirect URIs**, for example `http://localhost:3000/login` and `https://<your-tunnel-host>/login`. Sign-in uses a full-page redirect with `prompt=select_account`, so Google always shows the account chooser and it works on phones (no popups or third-party cookies needed).

Google only accepts `https://` addresses or `http://localhost`. A phone opening `http://192.168.x.x:3000` cannot use Google sign-in, so open the app through an HTTPS tunnel (e.g. Cloudflare) instead. A Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:3000`) gets a new random hostname every time it starts, and each new hostname has to be added to the redirect URIs; a named tunnel keeps one hostname. Google also blocks sign-in inside in-app browsers (links opened from WhatsApp, Instagram, etc.), so open the link in Chrome or Safari. The backend verifies every Google ID token's signature, audience, issuer, expiry, and verified email before it creates a default Student account. Existing roles are retained; Google sign-in never elevates a user.

## Error logs

The backend writes human-readable logs to the terminal and to two files:

| File | Contains |
|---|---|
| `backend/logs/app.log` | Everything: startup summary, one line per request, warnings and errors |
| `backend/logs/errors.log` | Only warnings and errors, including crashes reported by the browser |

Each error entry explains itself:

```
2026-11-01 16:20:03 +0530 | WARNING | errors         | req 7f3a2c1d | 409 Conflict — Illegal transition CLASSIFIED -> CLOSED
    What happened : Illegal transition CLASSIFIED -> CLOSED
    Error type    : InvalidStateTransitionError (a business rule refused the request)
    Request       : POST /api/incidents/6ae7184e.../transition
    User          : emma@example.com (customer)
    Where         : app/domain/state.py:8 in transition()  →  raise InvalidStateTransitionError(...)
    Likely cause  : The incident is not in a status that allows this change. Allowed moves are listed in app/domain/state.py.
```

- **Request ids.** Every response carries an `X-Request-ID` header, and every error response includes `request_id`. Server errors show the id to the user (for example "ref: 7f3a2c1d"). To find the matching entry, search the log for `req 7f3a2c1d`.
- **Unexpected crashes (500).** These entries add a plain-English cause, a suggested fix (for example "MongoDB could not be reached — is it running?"), the line of project code that failed, and a short traceback. Framework frames are hidden; set `LOG_FULL_TRACEBACKS=true` to see everything.
- **Validation errors (422).** These list each bad field, for example `• password: String should have at least 8 characters`. Passwords, OTP codes, tokens and API keys are never written to the logs.
- **Browser crashes.** These are shown to the user as an error screen with a reference code (`ui-xxxxxx`) and are logged in `errors.log` as `Browser error — …`. Failed API calls are also printed in the browser console with their request id.
- **Startup summary.** At startup the server logs what is configured (MongoDB, Google sign-in, SMTP, Gemini). It warns about problems such as a missing or placeholder `JWT_SECRET`.
- **Settings in `backend/.env`.** `LOG_LEVEL` (DEBUG/INFO/WARNING), `LOG_DIR` (where to write log files), and `SLOW_REQUEST_MS` (requests slower than this are logged as warnings). Log files rotate at 5 MB and the last 5 are kept.

## Important
AI credentials remain server-side. The report-generation endpoint only suggests editable fields and never creates a report automatically.

## Mermaid
Mermaid is intentionally not installed. The supplied environment uses Node 20 while the current Mermaid parser requires a newer Node runtime. The documentation page therefore uses a dependency-free lifecycle representation; Mermaid can be added later after upgrading Node.

## Features

| Brief requirement | Where it lives |
|---|---|
| Users: student (employee), technician, administrator | `app/domain/models.py` (`User` → `Employee`, `Technician`, `Administrator`) |
| Incident create / view / update / assign / resolve / close | `IncidentService`, incident detail page (edit, resolve, close with rating + comment) |
| Priority from impact, urgency, business criticality, affected users **and the affected service** | `WeightedScorePriorityStrategy`, `MatrixPriorityStrategy` — selectable in Configuration |
| Six assignment strategies (smart, skill, load, round robin, experience, priority-based) | `app/domain/strategies.py` — selectable in Configuration |
| SLA calculation, deadline tracking, warnings, violation register | `SlaPolicy`, `SlaMonitor` (every 60 s), `sla_violations` collection, Audit & SLA log page |
| Automatic escalation (Team Lead → System Administrator → IT Manager) | `EscalationPolicy` in `app/services/sla_monitor.py` |
| Notifications: in-app, simulated email, real SMTP email | `NotificationChannel` subclasses in `app/services/notifications.py` |
| Complete audit trail | `AuditObserver` → `audit_logs`; timeline on each incident; admin Audit log with filters |
| Search by ID/text, status, priority, category, service, technician, SLA status, date range, escalation | Filters on the incidents page; `IncidentService.search` |
| Reports: overview, technician workload, service analysis, categories, SLA, violations | Overview dashboard (`/api/reports/overview`) |
| Intelligent features | AI report assistant & categorisation, duplicate detection, incident correlation, smart recommendation, SLA risk detection, suggested resolutions, auto-escalation |
| Admin configuration | Configuration page: strategies & automation, IT services, categories, SLA policies; technician skills/capacity editing |

## Field service, voice & live updates

Location capture with Google Maps navigation, "on my way", GPS-verified check-in, the
handover code, dictation, voice notes, before/after photos, QR stickers, live updates
(SSE), a campus map with outage detection, and offline reporting.
See **[docs/FIELD_SERVICE_FEATURES.md](docs/FIELD_SERVICE_FEATURES.md)** for the feature list, the OOP design,
the API and a demo script. Animations follow **[docs/ANIMATION_GUIDELINES.md](docs/ANIMATION_GUIDELINES.md)**.

> GPS and the microphone only work over **https** (your ngrok link) or on **localhost**.

## Account & security

Every user has an **Account & security** page (sidebar, or click your name at the bottom of it):

| Option | What it does |
|---|---|
| Profile | Edit name and phone (names of Google accounts come from Google). |
| Change / set password | Needs the current password; at least 8 characters with letters and numbers. Signs out every other device. Google-only accounts can set a first password. |
| Two-step sign-in | Authenticator app (Google Authenticator, Microsoft Authenticator, Authy): scan a QR code, confirm with the first code, save 8 one-time backup codes. Turn off or create new backup codes with a current code. |
| Notifications | Turn incident emails on/off. In-app notifications and security alerts (password changed, authenticator on/off) always arrive. |
| Devices | Sign out of all other devices (this one stays signed in). |
| Recent security activity | Sign-ins (and how: password, Google, authenticator, backup code), wrong passwords or codes, and account changes, kept for 90 days. |

**How two-step sign-in works** (`app/services/two_factor.py`, `app/routers/account.py`, `POST /api/auth/login/2fa`):
- After a correct password, accounts with the authenticator on get a 5-minute *sign-in pass* instead of a session; the session is only issued after a correct code.
- Codes are TOTP (RFC 6238): 6 digits, new every 30 s; the previous and next code are also accepted for phone clocks that are slightly off. A code can never be used twice.
- `SecondFactor` is an interface with two implementations, `TotpFactor` and `BackupCodeFactor`; `TwoFactorService` tries each (polymorphism) and blocks further tries for 15 minutes after 5 wrong codes.
- The secret is encrypted at rest (Fernet/AES, key from `TOTP_ENCRYPTION_KEY` or `JWT_SECRET`); backup codes are stored only as HMAC-SHA256 hashes. Neither ever appears in an API response.
- **Forgot password?** → *Use my authenticator app instead* resets the password with a code from the app (no email needed).
- **Lost phone and backup codes?** An administrator opens *User & Role Admin* and clicks **Reset authenticator** on that user.
- **Configuration → Sign-in security** can require administrators to use an authenticator; admins without one are locked out of the admin pages until they set it up. You must turn on your own first.
- Sessions carry a version number; changing the password, resetting it, or "sign out of all other devices" increases it, which ends every older session at once.

## SLA targets and duplicate detection

**Default SLA targets** (from the project brief; editable on the Configuration page, and per-service policies override them):

| Priority | Respond within | Resolve within | "At risk" warning from |
|---|---|---|---|
| P1 | 5 min | 30 min | last 7.5 min |
| P2 | 15 min | 2 h | last 30 min |
| P3 | 1 h | 8 h | last 2 h |
| P4 | 4 h | 24 h | last 6 h |

The warning starts when the last 25% of the resolution window begins. On startup, default policies that still hold the old targets (15 min/4 h, 30 min/8 h, 2 h/24 h, 8 h/72 h) are moved to these; policies an admin edited are left alone. Incidents already open keep the deadlines they were given.

**Duplicate detection** (`DuplicateDetector` in `app/services/intelligence.py`) compares meaning-level *concepts* rather than raw words, so "Payment application unavailable", "Payment transaction failing" and "Unable to make payment" are recognised as the same problem:
1. Phrases such as "not working", "can't", "unable to", "down", "failing" become one *failure* concept.
2. Simple endings are stripped (failing → fail, transactions → transaction) and synonyms are merged (pay / paid / transaction / UPI → *payment*).
3. Similarity is the higher of title-vs-title (Dice) and whole-report (Jaccard) overlap; score = 0.75 × similarity + 0.25 × same service. Open or resolved incidents scoring at least 0.45 are shown as possible duplicates.

The *failure* concept counts only 0.3 in the overlap, because almost every report says something is broken; "Printer not working" and "Laptop not working" are therefore not matched.

## Non-IT and emergency reports

Reports that the IT help desk cannot handle are caught before they become tickets. That covers mental-health crises, medical emergencies, fire or gas, electrical danger, security incidents, animals and pests, and admin matters like mess, fees or grades. Instead of creating a ticket, the student sees a popup with tap-to-call numbers for the right campus service (Medical Center, Ambulance, Fire and Security, Electrical Emergency, Pest Control), plus Tele-MANAS 14416 and 112.

- **The rules work without AI.** `app/domain/scope.py` contains offline rules that also run when there's no internet. They understand IT jargon, so "kill the process", "firewall", "stolen password" and "battery died" stay IT tickets.
- **Gemini adds a second opinion** when it's configured. Life-safety matches from the rules always win, so the AI can't dismiss a crisis.
- **Students see the warning before submitting.** An emergency banner appears while they type. The server also re-checks every submission.
- **False alarms are one click away from going through.** The student can choose "It is an IT / facilities issue — continue". The incident history records that override without copying the report text.
- **Update the campus numbers** in `CAMPUS_CONTACTS` in `app/domain/scope.py` if they change.

## OOP design

```
app/domain/        business rules, no database code
  models.py        User hierarchy, Incident aggregate, value objects, UserFactory, IncidentFactory
  state.py         State pattern: one class per lifecycle status
  strategies.py    Strategy pattern: priority + assignment algorithms
  events.py        Observer pattern: IncidentEvent, EventBus, EventObserver interface
  exceptions.py    custom exception hierarchy (each maps to an HTTP status)
app/repositories.py   Repository pattern: all MongoDB access
app/services/      application services composed from the pieces above
  incident_service.py  lifecycle orchestration (composition of repositories, intelligence, bus)
  observers.py         AuditObserver, NotificationObserver, SlaViolationObserver
  notifications.py     NotificationChannel interface + EmailSender Adapter
  intelligence.py      IncidentClassifier interface + GeminiAdapter, duplicates, correlation, suggestions
  sla_monitor.py       SLA monitoring + EscalationPolicy
app/core/container.py composition root that wires everything together
```

- **Encapsulation:** domain objects keep fields private behind read-only properties. Their state changes only through methods that enforce the rules: `Incident.assign_to`, `Technician.ensure_capacity`, and so on.
- **Abstraction and interfaces:** each of these defines a contract through an abstract base class: `PriorityStrategy`, `AssignmentStrategy`, `NotificationChannel`, `EmailSender`, `IncidentClassifier`, `EventObserver` and `MongoRepository`.
- **Inheritance (only for real "is-a" relationships):** user roles, lifecycle states, strategies, repositories and exceptions. For example, `WorkloadExceededError` is a kind of `TechnicianUnavailableError`.
- **Polymorphism:** `User.can_view()` gives each role its own access rule. Strategies and notification channels can be swapped for one another at runtime.
- **Composition and aggregation:** an `Incident` is composed of its `Location`, `Note`s, `Resolution`, `Closure` and SLA. `IncidentService` is composed of repositories, the event bus and the intelligence service.
- **Association:** an incident refers to its reporter (a `User`), its assignee (a `Technician`) and its affected service (an `ItService`).
- **Design patterns:**
  - Strategy (priority and assignment algorithms)
  - State (incident lifecycle)
  - Factory (users, incidents, strategies, states)
  - Observer (audit, notifications, SLA violation records)
  - Repository (database access)
  - Adapter (SMTP email, Gemini AI)
  - Template Method (`AssignmentStrategy.select`)
  - Composition root (`app/core/container.py`)
- **Exception handling:** these custom exceptions cover the brief's error cases:
  - `AuthenticationError` (invalid login)
  - `UnauthorizedOperationError`
  - `ResourceNotFoundError` and `ServiceNotFoundError`
  - `InvalidStateTransitionError`
  - `TechnicianUnavailableError` and `WorkloadExceededError`
  - `MissingSlaConfigError`
  - `DuplicateIncidentError`
  - `DatabaseUnavailableError` (returned as a 503)
  - `ExternalServiceError` (network or integration failures)
  - `InvalidInputError`

## Tests

```bash
cd backend && pytest
pytest tests/test_gemini.py -k live -v   # calls the real Gemini API with LLM_API_KEY from backend/.env
```
The Gemini edge-case tests in `tests/test_gemini.py` simulate the API, so they run offline. The `live` tests are skipped automatically when the key is missing or Google can't be reached.
Needs MongoDB, and uses a separate `itsm_test` database. 54 tests cover:
- the domain model
- strategies
- the lifecycle
- notifications
- SLA monitoring and escalation (using simulated time)
- correlation
- suggested resolutions
- search filters
- admin configuration
- error handling and logging

#!/bin/bash
# BITS reports: one command to set up (first run) and start everything on macOS / Linux.
#   ./start.sh            backend + frontend + public ngrok link (if ngrok is set up)
#   ./start.sh --local    backend + frontend only
#   ./start.sh --demo-data   first replace all incidents with fresh demo reports (a backup is saved
#                            in _backups/), then start as usual. Can be combined with --local.
#   ./start.sh --classic  also start the old (classic) frontend on http://localhost:3001
# The app is the glass frontend (frontend-next) on http://localhost:3000; the classic frontend
# (frontend/) is kept as a backup and only starts with --classic.
# Press Ctrl+C once to stop everything.
#
# First run creates backend/.env and frontend/.env from the .env.example files,
# makes the Python environment, installs packages and starts MongoDB if it can.
# Optional: pin your ngrok address in the project's .env:  NGROK_URL=https://name.ngrok-free.dev

cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
mkdir -p "$ROOT/logs"

SHARE=true
DEMO_DATA=false
CLASSIC=false
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --local) SHARE=false ;;
    --demo-data|--reset-demo) DEMO_DATA=true ;;
    --classic) CLASSIC=true ;;
    *) ARGS+=("$arg") ;;
  esac
done
set -- "${ARGS[@]}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m%s\033[0m\n' "$*"; exit 1; }

env_value() { grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }

# ---------------------------------------------------------------- tools
PY=""
for c in python3.12 python3.13 python3.11 python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then PY="$c"; break; fi
done
[ -n "$PY" ] || fail "Python 3.10 or newer is needed. Install it from https://www.python.org/downloads/ (or: brew install python@3.12), then run ./start.sh again."
command -v npm >/dev/null 2>&1 || fail "Node.js is needed. Install the LTS version from https://nodejs.org (or: brew install node), then run ./start.sh again."

# ---------------------------------------------------------------- settings files
if [ ! -f backend/.env ]; then
  say "Creating backend/.env from backend/.env.example"
  "$PY" - <<'PYEOF'
import re, secrets
s = open('backend/.env.example').read()
s = re.sub(r'^JWT_SECRET=.*$', 'JWT_SECRET=' + secrets.token_urlsafe(48), s, flags=re.M)
open('backend/.env', 'w').write(s)
PYEOF
fi
[ -f frontend/.env ] || { say "Creating frontend/.env"; cp frontend/.env.example frontend/.env; }   # also read by the glass app (Google client id)

# ---------------------------------------------------------------- backend packages
VENV_PY="$ROOT/backend/.venv/bin/python"
if ! "$VENV_PY" -c 'import sys' >/dev/null 2>&1; then
  # Missing, or copied from another computer (those never work): make a fresh one.
  say "Creating the backend Python environment (first run only)"
  rm -rf "$ROOT/backend/.venv"
  "$PY" -m venv "$ROOT/backend/.venv" || fail "Could not create backend/.venv"
fi
if ! cmp -s backend/requirements.txt backend/.venv/.installed-requirements; then
  say "Installing backend packages"
  "$VENV_PY" -m pip install --upgrade pip -q
  "$VENV_PY" -m pip install -r backend/requirements.txt || fail "Backend package install failed (see above)."
  cp backend/requirements.txt backend/.venv/.installed-requirements
fi

# ---------------------------------------------------------------- frontend packages
[ -f frontend-next/.env ] || { say "Creating frontend-next/.env"; cp frontend-next/.env.example frontend-next/.env; }
if ! cmp -s frontend-next/package.json frontend-next/node_modules/.installed-package.json; then
  say "Installing frontend packages (takes a minute the first time)"
  (cd frontend-next && npm install) || fail "Frontend package install failed (see above)."
  cp frontend-next/package.json frontend-next/node_modules/.installed-package.json
fi
if $CLASSIC && ! cmp -s frontend/package.json frontend/node_modules/.installed-package.json; then
  say "Installing classic frontend packages (takes a few minutes the first time)"
  (cd frontend && npm install) || fail "Classic frontend package install failed (see above)."
  cp frontend/package.json frontend/node_modules/.installed-package.json
fi

# ---------------------------------------------------------------- MongoDB
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
MONGO_URL="$(env_value backend/.env MONGO_URL)"
case "$MONGO_URL" in
  *localhost*|*127.0.0.1*|"")
    if ! port_open 27017; then
      say "MongoDB is not running; trying to start it"
      BREW_MONGO="$(command -v brew >/dev/null 2>&1 && brew services list 2>/dev/null | awk '/^mongodb-community/{print $1; exit}')"
      if [ -n "$BREW_MONGO" ]; then
        brew services start "$BREW_MONGO"
      elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        docker start bits-mongo >/dev/null 2>&1 ||
          docker run -d --name bits-mongo -p 27017:27017 -v bits-mongo-data:/data/db mongo:7
      fi
      for _ in $(seq 1 20); do port_open 27017 && break; sleep 1; done
      port_open 27017 || fail "MongoDB is not installed. Install it once, then run ./start.sh again:
  brew tap mongodb/brew && brew install mongodb-community
(or install Docker Desktop and the script will run MongoDB in Docker for you)."
    fi ;;
esac

# ---------------------------------------------------------------- start
stop_all() {
  trap - INT TERM EXIT
  echo; echo "Stopping BITS reports..."
  for pid in $BACKEND_PID $FRONTEND_PID $CLASSIC_PID $NGROK_PID; do
    pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null
  done
  exit 0
}
trap stop_all INT TERM EXIT

free_port() {
  local pids; pids="$(lsof -ti tcp:"$1" -sTCP:LISTEN 2>/dev/null)"
  if [ -n "$pids" ]; then echo "Port $1 was in use by an old run; closing it."; kill -9 $pids 2>/dev/null; sleep 1; fi
}
free_port 8000; free_port 3000; free_port 5173; $CLASSIC && free_port 3001; $SHARE && free_port 4040

if $DEMO_DATA; then
  say "Replacing all incidents with demo reports"
  ( cd backend && "$VENV_PY" scripts/demo_data.py --yes ) || fail "Demo data could not be loaded (see above). Is MongoDB running?"
fi

say "Starting backend  (http://localhost:8000)"
( cd backend && exec "$VENV_PY" -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload ) &
BACKEND_PID=$!

say "Starting frontend (http://localhost:3000)"
( cd frontend-next && exec npx vite --port 3000 --strictPort > ../logs/frontend.log 2>&1 ) &
FRONTEND_PID=$!

if $CLASSIC; then
  say "Starting the classic frontend (http://localhost:3001)"
  ( cd frontend && BROWSER=none PORT=3001 exec npm start > ../logs/frontend-classic.log 2>&1 ) &
  CLASSIC_PID=$!
fi

# ---------------------------------------------------------------- ngrok
public_url() {
  curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | "$PY" -c 'import sys, json
try: print(next(t["public_url"] for t in json.load(sys.stdin)["tunnels"] if t["public_url"].startswith("https")))
except Exception: pass' 2>/dev/null
}
start_ngrok() {   # $1 = optional fixed URL
  if [ -n "$1" ]; then ngrok http 3000 --url="$1" --log=stdout > logs/ngrok.log 2>&1 &
  else ngrok http 3000 --log=stdout > logs/ngrok.log 2>&1 & fi
  NGROK_PID=$!
  PUBLIC_URL=""
  for _ in $(seq 1 20); do
    sleep 1
    kill -0 "$NGROK_PID" 2>/dev/null || return 1
    PUBLIC_URL="$(public_url)"; [ -n "$PUBLIC_URL" ] && return 0
  done
  return 1
}

PUBLIC_URL=""
if $SHARE; then
  if ! command -v ngrok >/dev/null 2>&1; then
    echo "(ngrok is not installed, so there is no public link. Optional: brew install ngrok, then"
    echo " ngrok config add-authtoken <token from dashboard.ngrok.com>.)"
  else
    NGROK_URL="${NGROK_URL:-$(env_value .env NGROK_URL)}"
    if ! start_ngrok "$NGROK_URL" && [ -n "$NGROK_URL" ]; then
      # A pinned address from someone else's ngrok account fails; use this account's own address.
      kill "$NGROK_PID" 2>/dev/null; start_ngrok ""
    fi
    if [ -z "$PUBLIC_URL" ]; then
      echo "ngrok could not start. Last lines of logs/ngrok.log:"; tail -5 logs/ngrok.log
      echo "(If it mentions an authtoken: ngrok config add-authtoken <token from dashboard.ngrok.com>)"
    else
      echo "$PUBLIC_URL" > logs/public-url.txt
    fi
  fi
fi

# Print the links once the app answers.
for _ in $(seq 1 120); do curl -s -o /dev/null http://localhost:3000 && break; sleep 1; done
sleep 1
echo
echo "=================================================================="
echo "  BITS reports is running"
echo "  On this computer:  http://localhost:3000"
$CLASSIC && echo "  Classic app:       http://localhost:3001"
if [ -n "$PUBLIC_URL" ]; then
echo "  Public link:       $PUBLIC_URL"
echo "  Google sign-in on the public link needs this address registered once"
echo "  (Google Cloud Console > Authorized redirect URIs):  $PUBLIC_URL/login"
fi
echo "  Press Ctrl+C to stop everything."
echo "=================================================================="
echo
wait

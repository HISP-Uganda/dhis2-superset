#!/usr/bin/env bash
# ============================================================================
# Superset Local Manager (macOS-friendly)
# Backend: Apache Superset
# Frontend: Superset frontend dev/build
# ============================================================================
set -Eeuo pipefail

# ----------------------------------------------------------------------------
# Colors
# ----------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()      { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
header()  {
  echo
  echo -e "${BOLD}${BLUE}================================================================${NC}"
  echo -e "${BOLD}${BLUE}$*${NC}"
  echo -e "${BOLD}${BLUE}================================================================${NC}"
  echo
}

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
PROJECT_DIR="${PROJECT_DIR:-/Users/stephocay/projects/hispuganda/ss_latest/superset}"
BACKEND_DIR="$PROJECT_DIR"
FRONTEND_DIR="$PROJECT_DIR/superset-frontend"
VENV_DIR="$PROJECT_DIR/venv"
CONFIG_PATH="$PROJECT_DIR/superset_config.py"
LOG_DIR="$PROJECT_DIR/logs"

BACKEND_LOG_FILE="$LOG_DIR/superset_backend.log"
FRONTEND_LOG_FILE="$LOG_DIR/superset_frontend.log"
REDIS_LOG_FILE="$LOG_DIR/redis.log"

BACKEND_PID_FILE="$PROJECT_DIR/superset_backend.pid"
FRONTEND_PID_FILE="$PROJECT_DIR/superset_frontend.pid"
REDIS_PID_FILE="$PROJECT_DIR/redis.pid"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8088}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-9000}"
FRONTEND_DISABLE_TYPE_CHECK="${FRONTEND_DISABLE_TYPE_CHECK:-1}"
BACKEND_ENABLE_RELOAD="${BACKEND_ENABLE_RELOAD:-0}"
BACKEND_ENABLE_DEBUGGER="${BACKEND_ENABLE_DEBUGGER:-0}"

CACHE_DIR="$PROJECT_DIR/superset_home/cache"

# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
ensure_log_dir() {
  mkdir -p "$LOG_DIR"
}

require_dir() {
  local d="$1"
  [[ -d "$d" ]] || { error "Missing directory: $d"; exit 1; }
}

require_file() {
  local f="$1"
  [[ -f "$f" ]] || { error "Missing file: $f"; exit 1; }
}

require_cmd() {
  local c="$1"
  command -v "$c" >/dev/null 2>&1 || { error "Missing command: $c"; exit 1; }
}

read_pid_file() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  cat "$pid_file"
}

pid_is_running() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 1
  ps -p "$pid" >/dev/null 2>&1
}

port_is_in_use() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

kill_pid_file() {
  local pid_file="$1"
  local name="$2"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" || true)"
    if [[ -n "${pid:-}" ]] && ps -p "$pid" >/dev/null 2>&1; then
      info "Stopping $name (PID: $pid)"
      kill -TERM "$pid" 2>/dev/null || true
      sleep 2
      if ps -p "$pid" >/dev/null 2>&1; then
        warn "$name still running, forcing kill"
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
    rm -f "$pid_file"
  fi
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -n "${pids:-}" ]]; then
    info "Killing process(es) on port $port"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

wait_for_http() {
  local url="$1"
  local max_tries="${2:-60}"
  local sleep_secs="${3:-1}"

  for ((i=1; i<=max_tries; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_secs"
  done
  return 1
}

spawn_detached() {
  local pid_file="$1"
  local log_file="$2"
  shift 2

  rm -f "$pid_file"
  : >"$log_file"

  python3 - "$pid_file" "$log_file" "$@" <<'PY'
import os
import sys
import time

pid_file, log_file, *cmd = sys.argv[1:]

if not cmd:
    raise SystemExit("missing command")

first_pid = os.fork()
if first_pid > 0:
    sys.exit(0)

os.setsid()

second_pid = os.fork()
if second_pid > 0:
    with open(pid_file, "w", encoding="utf-8") as handle:
        handle.write(str(second_pid))
    sys.exit(0)

with open(os.devnull, "rb", buffering=0) as devnull:
    os.dup2(devnull.fileno(), 0)

log_fd = os.open(log_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(log_fd, 1)
os.dup2(log_fd, 2)
os.close(log_fd)

try:
    os.execvp(cmd[0], cmd)
except Exception as ex:  # pragma: no cover - startup failure path
    print(f"Failed to exec {' '.join(cmd)}: {ex}", file=sys.stderr)
    time.sleep(1)
    raise
PY

  local pid=""
  for _ in {1..20}; do
    if [[ -f "$pid_file" ]]; then
      pid="$(cat "$pid_file" 2>/dev/null || true)"
      if [[ -n "${pid:-}" ]]; then
        break
      fi
    fi
    sleep 0.25
  done

  if [[ -z "${pid:-}" ]]; then
    error "Failed to capture detached process PID"
    tail -20 "$log_file" || true
    exit 1
  fi

  echo "$pid"
}

venv_activate() {
  require_dir "$VENV_DIR"
  require_file "$VENV_DIR/bin/activate"
  # shellcheck disable=SC1090
  source "$VENV_DIR/bin/activate"
}

set_backend_env() {
  export SUPERSET_CONFIG_PATH="$CONFIG_PATH"
  export FLASK_APP=superset
  export PYTHONUNBUFFERED=1
  export FLASK_ENV="${FLASK_ENV:-production}"
  export FLASK_DEBUG="$BACKEND_ENABLE_DEBUGGER"
}

frontend_dev_command() {
  require_file "$FRONTEND_DIR/package.json"

  if grep -q '"dev-server"' "$FRONTEND_DIR/package.json"; then
    echo "npm run dev-server -- --port $FRONTEND_PORT"
    return 0
  fi

  if grep -q '"dev"' "$FRONTEND_DIR/package.json"; then
    echo "npm run dev -- --port $FRONTEND_PORT"
    return 0
  fi

  if grep -q '"start"' "$FRONTEND_DIR/package.json"; then
    echo "npm run start -- --port $FRONTEND_PORT"
    return 0
  fi

  return 1
}

backend_running() {
  local pid
  pid="$(read_pid_file "$BACKEND_PID_FILE" || true)"
  if [[ -n "${pid:-}" ]] && pid_is_running "$pid"; then
    return 0
  fi
  port_is_in_use "$BACKEND_PORT"
}

frontend_running() {
  local pid
  pid="$(read_pid_file "$FRONTEND_PID_FILE" || true)"
  if [[ -n "${pid:-}" ]] && pid_is_running "$pid"; then
    return 0
  fi
  port_is_in_use "$FRONTEND_PORT"
}

redis_running() {
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli ping >/dev/null 2>&1
  else
    return 1
  fi
}

# ----------------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------------
validate_project() {
  require_dir "$PROJECT_DIR"
  require_dir "$FRONTEND_DIR"
  require_file "$CONFIG_PATH"
  require_cmd python3
  require_cmd curl
  require_cmd lsof
}

validate_backend() {
  validate_project
  require_dir "$VENV_DIR"
  require_file "$VENV_DIR/bin/superset"
}

validate_frontend() {
  validate_project
  require_cmd npm
  require_file "$FRONTEND_DIR/package.json"
}

# ----------------------------------------------------------------------------
# Redis
# ----------------------------------------------------------------------------
start_redis() {
  header "Starting Redis"

  if ! command -v redis-server >/dev/null 2>&1; then
    warn "Redis not installed. Skipping."
    warn "Install with: brew install redis"
    return 1
  fi

  ensure_log_dir

  if redis_running; then
    ok "Redis is already running"
    return 0
  fi

  info "Starting Redis daemon"
  redis-server --daemonize yes --dir "$PROJECT_DIR" --logfile "$REDIS_LOG_FILE" >/dev/null 2>&1 || true

  for _ in {1..10}; do
    sleep 1
    if redis_running; then
      ok "Redis started"
      return 0
    fi
  done

  warn "Redis did not start. Continuing without Redis."
  return 1
}

stop_redis() {
  header "Stopping Redis"

  if ! command -v redis-cli >/dev/null 2>&1; then
    warn "redis-cli not installed"
    return 0
  fi

  if redis_running; then
    redis-cli shutdown >/dev/null 2>&1 || true
    ok "Redis stopped"
  else
    warn "Redis is not running"
  fi
}

redis_status() {
  header "Redis Status"

  if ! command -v redis-server >/dev/null 2>&1; then
    warn "Redis not installed"
    return 0
  fi

  if redis_running; then
    local keys mem
    keys="$(redis-cli DBSIZE 2>/dev/null | awk '{print $2}' || echo 0)"
    mem="$(redis-cli INFO memory 2>/dev/null | awk -F: '/used_memory_human/ {print $2}' | tr -d '\r' || true)"
    ok "Redis running"
    echo "  Keys: ${keys:-0}"
    echo "  Memory: ${mem:-unknown}"
  else
    warn "Redis not running"
  fi
}

# ----------------------------------------------------------------------------
# Backend
# ----------------------------------------------------------------------------
start_backend() {
  header "Starting Superset Backend"

  validate_backend
  ensure_log_dir

  if backend_running; then
    warn "Backend already running on port $BACKEND_PORT"
    return 0
  fi

  start_redis || true

  cd "$BACKEND_DIR"
  venv_activate
  set_backend_env

  info "Using config: $SUPERSET_CONFIG_PATH"
  info "Compiling config to verify syntax"
  python -m py_compile "$CONFIG_PATH"

  info "Starting backend on http://$BACKEND_HOST:$BACKEND_PORT"
  local backend_cmd
  if [[ "$BACKEND_ENABLE_RELOAD" == "1" || "$BACKEND_ENABLE_DEBUGGER" == "1" ]]; then
    backend_cmd=(
      "$VENV_DIR/bin/superset"
      run
      -h "$BACKEND_HOST"
      -p "$BACKEND_PORT"
      --with-threads
    )

    if [[ "$BACKEND_ENABLE_RELOAD" == "1" ]]; then
      backend_cmd+=(--reload)
    fi

    if [[ "$BACKEND_ENABLE_DEBUGGER" == "1" ]]; then
      backend_cmd+=(--debugger)
    fi
  else
    backend_cmd=(
      "$VENV_DIR/bin/gunicorn"
      --bind "$BACKEND_HOST:$BACKEND_PORT"
      --workers "${BACKEND_GUNICORN_WORKERS:-1}"
      --threads "${BACKEND_GUNICORN_THREADS:-8}"
      --worker-class gthread
      --timeout "${SUPERSET_WEBSERVER_TIMEOUT:-300}"
      "superset.app:create_app()"
    )
  fi

  local pid
  pid="$(spawn_detached "$BACKEND_PID_FILE" "$BACKEND_LOG_FILE" "${backend_cmd[@]}")"

  info "Waiting for backend health endpoint"
  if wait_for_http "http://$BACKEND_HOST:$BACKEND_PORT/health" 90 1; then
    ok "Backend started successfully (PID: $pid)"
    echo "  URL:  http://$BACKEND_HOST:$BACKEND_PORT"
    echo "  Logs: $BACKEND_LOG_FILE"
  else
    error "Backend failed to start"
    tail -100 "$BACKEND_LOG_FILE" || true
    exit 1
  fi
}

stop_backend() {
  header "Stopping Superset Backend"
  kill_pid_file "$BACKEND_PID_FILE" "Superset backend"
  kill_port "$BACKEND_PORT"

  if backend_running; then
    error "Backend still appears to be running"
    exit 1
  fi

  ok "Backend stopped"
}

restart_backend() {
  header "Restarting Superset Backend"
  stop_backend || true
  sleep 1
  start_backend
}

backend_status() {
  header "Superset Backend Status"

  if backend_running; then
    ok "Backend is running"
    echo "  URL:  http://$BACKEND_HOST:$BACKEND_PORT"
    if curl -fsS "http://$BACKEND_HOST:$BACKEND_PORT/health" >/dev/null 2>&1; then
      ok "Health check OK"
    else
      warn "Health endpoint not responding"
    fi
    echo "  Logs: $BACKEND_LOG_FILE"
  else
    warn "Backend is not running"
  fi
}

# ----------------------------------------------------------------------------
# Frontend
# ----------------------------------------------------------------------------
start_frontend() {
  header "Starting Superset Frontend Dev Server"

  validate_frontend
  ensure_log_dir

  if frontend_running; then
    warn "Frontend already running on port $FRONTEND_PORT"
    return 0
  fi

  local cmd
  if ! cmd="$(frontend_dev_command)"; then
    error "Could not determine frontend dev command from package.json"
    error "Expected one of: dev-server, dev, start"
    exit 1
  fi

  cd "$FRONTEND_DIR"

  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    info "Installing frontend dependencies"
    npm install
  else
    info "Using existing frontend dependencies"
  fi

  info "Starting frontend with command:"
  echo "  $cmd"
  if [[ "$FRONTEND_DISABLE_TYPE_CHECK" == "1" ]]; then
    info "Disabling webpack dev-server type checking to avoid ForkTsChecker crashes"
  fi

  local pid
  pid="$(
    spawn_detached \
      "$FRONTEND_PID_FILE" \
      "$FRONTEND_LOG_FILE" \
      bash \
      -c \
      "cd '$FRONTEND_DIR' && export PATH=\"$FRONTEND_DIR/node_modules/.bin:\$PATH\" && export DISABLE_TYPE_CHECK=\"$FRONTEND_DISABLE_TYPE_CHECK\" && $cmd"
  )"

  info "Waiting for frontend on http://$FRONTEND_HOST:$FRONTEND_PORT"
  for _ in {1..90}; do
    sleep 2
    if port_is_in_use "$FRONTEND_PORT"; then
      ok "Frontend started successfully (PID: $pid)"
      echo "  URL:  http://$FRONTEND_HOST:$FRONTEND_PORT"
      echo "  Logs: $FRONTEND_LOG_FILE"
      return 0
    fi
  done

  error "Frontend failed to start"
  tail -100 "$FRONTEND_LOG_FILE" || true
  exit 1
}

stop_frontend() {
  header "Stopping Superset Frontend Dev Server"
  kill_pid_file "$FRONTEND_PID_FILE" "Superset frontend"
  kill_port "$FRONTEND_PORT"

  if frontend_running; then
    error "Frontend still appears to be running"
    exit 1
  fi

  ok "Frontend stopped"
}

restart_frontend() {
  header "Restarting Superset Frontend Dev Server"
  stop_frontend || true
  sleep 1
  start_frontend
}

frontend_status() {
  header "Superset Frontend Status"

  if frontend_running; then
    ok "Frontend is running"
    echo "  URL:  http://$FRONTEND_HOST:$FRONTEND_PORT"
    echo "  Logs: $FRONTEND_LOG_FILE"
  else
    warn "Frontend is not running"
  fi
}

build_frontend() {
  header "Building Superset Frontend"

  validate_frontend
  cd "$FRONTEND_DIR"

  npm install
  npm run build

  ok "Frontend build completed"
}

# ----------------------------------------------------------------------------
# Cache / Logs / DB
# ----------------------------------------------------------------------------
clear_backend_cache() {
  header "Clearing Backend Cache"

  if backend_running; then
    error "Stop backend before clearing backend cache"
    exit 1
  fi

  if [[ -d "$CACHE_DIR" ]]; then
    rm -rf "$CACHE_DIR"/* || true
    ok "Backend cache cleared: $CACHE_DIR"
  else
    warn "Cache directory not found: $CACHE_DIR"
  fi

  find "$PROJECT_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
  find "$PROJECT_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true
  ok "Python cache cleared"
}

clear_frontend_cache() {
  header "Clearing Frontend Cache"

  validate_frontend
  cd "$FRONTEND_DIR"

  rm -rf dist build .webpack .next .eslintcache 2>/dev/null || true
  rm -rf node_modules/.cache node_modules/.webpack 2>/dev/null || true
  npm cache clean --force >/dev/null 2>&1 || true

  ok "Frontend cache cleared"
}

clear_all_cache() {
  clear_backend_cache
  clear_frontend_cache
}

clear_logs() {
  header "Clearing Logs"
  ensure_log_dir
  rm -f "$BACKEND_LOG_FILE" "$FRONTEND_LOG_FILE" "$REDIS_LOG_FILE"
  ok "Logs cleared"
}

install_deps() {
  header "Installing Python Dependencies"

  validate_project
  require_dir "$VENV_DIR"

  cd "$BACKEND_DIR"
  venv_activate

  # Install base requirements into the venv
  if [[ -f "$BACKEND_DIR/requirements/base.txt" ]]; then
    info "Installing base requirements..."
    "$VENV_DIR/bin/pip" install --quiet -r "$BACKEND_DIR/requirements/base.txt"
    ok "Base requirements installed"
  else
    warn "No requirements/base.txt found — skipping"
  fi

  # Install the superset package itself in editable mode if setup.py/pyproject.toml exists
  if [[ -f "$BACKEND_DIR/setup.py" || -f "$BACKEND_DIR/pyproject.toml" ]]; then
    info "Installing superset package (editable)..."
    "$VENV_DIR/bin/pip" install --quiet -e "$BACKEND_DIR" --no-deps
    ok "Superset package installed"
  fi
}

db_upgrade() {
  header "Running Superset DB Upgrade"

  validate_backend
  cd "$BACKEND_DIR"
  venv_activate
  set_backend_env

  info "Running migrations..."
  "$VENV_DIR/bin/superset" db upgrade
  info "Running superset init..."
  "$VENV_DIR/bin/superset" init

  ok "Database upgrade/init completed"
}

setup() {
  header "Full Setup: Install → Migrate → Create Admin"
  install_deps
  db_upgrade
  create_admin
  ok "Setup complete — run './superset-manager.sh start-all' to launch"
}

create_admin() {
  header "Creating/Updating Admin User"

  validate_backend
  cd "$BACKEND_DIR"
  venv_activate
  set_backend_env

  "$VENV_DIR/bin/superset" fab create-admin \
    --username admin \
    --firstname Admin \
    --lastname User \
    --email admin@example.com \
    --password Admin@2026 || true

  ok "Admin command executed"
}

health_check() {
  header "Health Check"

  validate_project

  [[ -d "$VENV_DIR" ]] && ok "Virtual environment exists" || warn "Virtual environment missing"
  [[ -f "$CONFIG_PATH" ]] && ok "Config file exists" || warn "Config file missing"

  if [[ -f "$CONFIG_PATH" ]]; then
    if python3 -m py_compile "$CONFIG_PATH" >/dev/null 2>&1; then
      ok "Config syntax OK"
    else
      error "Config syntax invalid"
    fi
  fi

  if backend_running; then
    ok "Backend process running"
    if curl -fsS "http://localhost:$BACKEND_PORT/health" >/dev/null 2>&1; then
      ok "Backend health endpoint OK"
    else
      warn "Backend process exists but health endpoint failed"
    fi
  else
    warn "Backend not running"
  fi

  if frontend_running; then
    ok "Frontend process running"
  else
    warn "Frontend not running"
  fi
}

view_logs() {
  local which="${1:-backend}"
  local mode="${2:-tail}"

  local file
  case "$which" in
    backend)  file="$BACKEND_LOG_FILE" ;;
    frontend) file="$FRONTEND_LOG_FILE" ;;
    redis)    file="$REDIS_LOG_FILE" ;;
    *)
      error "Unknown log type: $which"
      exit 1
      ;;
  esac

  require_file "$file"

  if [[ "$mode" == "follow" ]]; then
    tail -f "$file"
  else
    tail -50 "$file"
  fi
}

# ----------------------------------------------------------------------------
# Combined
# ----------------------------------------------------------------------------
start_all() {
  header "Starting Backend + Frontend"
  start_backend
  start_frontend
  ok "All services started"
}

stop_all() {
  header "Stopping Backend + Frontend"
  stop_frontend || true
  stop_backend || true
  stop_redis || true
  ok "All services stopped"
}

restart_all() {
  header "Restarting Backend + Frontend"
  stop_all || true
  sleep 1
  clear_all_cache || true
  sleep 1
  db_upgrade
  start_all
}

status_all() {
  header "Full Status"
  backend_status
  frontend_status
  redis_status
}

# ----------------------------------------------------------------------------
# Usage
# ----------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage: ./superset-manager.sh <command>

Commands:
  start                 Start backend
  stop                  Stop backend
  restart               Restart backend
  status                Backend status

  start-frontend        Start frontend dev server
  stop-frontend         Stop frontend dev server
  restart-frontend      Restart frontend dev server
  status-frontend       Frontend status
  build-frontend        Build frontend assets

  start-all             Start backend + frontend
  stop-all              Stop backend + frontend + redis
  restart-all           Restart everything with cache cleanup
  status-all            Show full status

  start-redis           Start Redis
  stop-redis            Stop Redis
  redis-status          Redis status

  db-upgrade            Run superset db upgrade && superset init
  install               Install Python requirements into venv
  setup                 Full first-time setup: install + migrate + create admin
  create-admin          Create/update local admin user

  cache                 Clear backend cache
  cache-frontend        Clear frontend cache
  cache-all             Clear all caches
  clear-logs            Clear logs

  logs [backend|frontend|redis] [follow]
  health
  help

Examples:
  ./superset-manager.sh setup              # First-time setup
  ./superset-manager.sh restart-all        # Stop → migrate → restart everything
  ./superset-manager.sh start-all          # Start backend + frontend + redis
  ./superset-manager.sh db-upgrade         # Run migrations only
  ./superset-manager.sh logs backend follow
EOF
}

# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------
main() {
  case "${1:-help}" in
    start) start_backend ;;
    stop) stop_backend ;;
    restart) restart_backend ;;
    status) backend_status ;;

    start-frontend) start_frontend ;;
    stop-frontend) stop_frontend ;;
    restart-frontend) restart_frontend ;;
    status-frontend) frontend_status ;;
    build-frontend) build_frontend ;;

    start-all) start_all ;;
    stop-all) stop_all ;;
    restart-all) restart_all ;;
    status-all) status_all ;;

    start-redis) start_redis ;;
    stop-redis) stop_redis ;;
    redis-status) redis_status ;;

    db-upgrade) db_upgrade ;;
    install) install_deps ;;
    setup) setup ;;
    create-admin) create_admin ;;

    cache) clear_backend_cache ;;
    cache-frontend) clear_frontend_cache ;;
    cache-all) clear_all_cache ;;
    clear-logs) clear_logs ;;

    logs) view_logs "${2:-backend}" "${3:-tail}" ;;
    health) health_check ;;
    help|--help|-h) usage ;;
    *)
      error "Unknown command: ${1:-}"
      usage
      exit 1
      ;;
  esac
}

main "$@"

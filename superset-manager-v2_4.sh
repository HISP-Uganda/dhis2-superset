#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Superset Manager v2 (macOS-safe / remote-deploy-safe)
# - Local development helpers
# - Server installation and upgrade
# - Remote deployment from local codebase or Git repo
# - Safe quoting for macOS bash/zsh invocation
# ==============================================================================

# ------------------------------------------------------------------------------
# Colors / logging
# ------------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

print() { printf '%b\n' "$*"; }
info()  { print "${BLUE}[INFO]${NC} $*"; }
ok()    { print "${GREEN}[OK]${NC} $*"; }
warn()  { print "${YELLOW}[WARN]${NC} $*"; }
err()   { print "${RED}[ERROR]${NC} $*" >&2; }
die()   { err "$*"; exit 1; }
header() {
  echo
  echo -e "${BOLD}${BLUE}================================================================${NC}"
  echo -e "${BOLD}${BLUE}$*${NC}"
  echo -e "${BOLD}${BLUE}================================================================${NC}"
  echo
}

command_exists() { command -v "$1" >/dev/null 2>&1; }
require_cmd() { command_exists "$1" || die "Missing command: $1"; }
require_dir() { [[ -d "$1" ]] || die "Missing directory: $1"; }
require_file() { [[ -f "$1" ]] || die "Missing file: $1"; }

# ------------------------------------------------------------------------------
# Core config
# ------------------------------------------------------------------------------
APP_NAME="${APP_NAME:-dhis2-superset}"
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/$APP_NAME}"
REMOTE_INSTALL_DIR="${REMOTE_INSTALL_DIR:-${INSTALL_DIR:-/opt/superset}}"

VENV_DIR="${VENV_DIR:-$INSTALL_DIR/venv}"
CONFIG_DIR="${CONFIG_DIR:-$INSTALL_DIR/config}"
DATA_DIR="${DATA_DIR:-$INSTALL_DIR/data}"
LOG_DIR="${LOG_DIR:-$INSTALL_DIR/logs}"
RUN_DIR="${RUN_DIR:-$INSTALL_DIR/run}"
ENV_FILE="${ENV_FILE:-$INSTALL_DIR/.env}"
SUPERSET_CONFIG_FILE="${SUPERSET_CONFIG_FILE:-$CONFIG_DIR/superset_config.py}"

LOCAL_PROJECT_DIR="${LOCAL_PROJECT_DIR:-$PROJECT_DIR}"
BACKEND_DIR="${BACKEND_DIR:-$PROJECT_DIR}"
FRONTEND_DIR="${FRONTEND_DIR:-$PROJECT_DIR/superset-frontend}"

# ------------------------------------------------------------------------------
# Network / domain / app settings
# ------------------------------------------------------------------------------
DOMAIN="${DOMAIN:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_FIRSTNAME="${ADMIN_FIRSTNAME:-Superset}"
ADMIN_LASTNAME="${ADMIN_LASTNAME:-Admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"

SUPERSET_HOST="${SUPERSET_HOST:-127.0.0.1}"
SUPERSET_PORT="${SUPERSET_PORT:-8088}"
SUPERSET_SECRET_KEY="${SUPERSET_SECRET_KEY:-$(openssl rand -base64 42 2>/dev/null | tr -d '\n' || echo change_me_now)}"
GUEST_TOKEN_JWT_SECRET="${GUEST_TOKEN_JWT_SECRET:-$(openssl rand -base64 42 2>/dev/null | tr -d '\n' || echo change_me_now)}"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8088}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-9001}"

# ------------------------------------------------------------------------------
# Remote deployment config
# ------------------------------------------------------------------------------
REMOTE_HOST="${REMOTE_HOST:-62.171.147.64}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PORT="${REMOTE_PORT:-22}"
REMOTE_APP_USER="${REMOTE_APP_USER:-superset}"
REMOTE_SUDO_APP_USER="${REMOTE_SUDO_APP_USER:-1}"
REMOTE_SCRIPT_BASENAME="${REMOTE_SCRIPT_BASENAME:-superset-manager-v2.sh}"
REMOTE_SCRIPT_PATH="${REMOTE_SCRIPT_PATH:-$REMOTE_INSTALL_DIR/$REMOTE_SCRIPT_BASENAME}"

SSH_OPTS=(-p "$REMOTE_PORT" -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-P "$REMOTE_PORT" -o StrictHostKeyChecking=accept-new)
RSYNC_SSH="ssh -p ${REMOTE_PORT} -o StrictHostKeyChecking=accept-new"

CODEBASE_SOURCE="${CODEBASE_SOURCE:-local}"   # local | git
GIT_REPO_URL="${GIT_REPO_URL:-}"
GIT_BRANCH="${GIT_BRANCH:-main}"
GIT_REF="${GIT_REF:-}"
GIT_CLONE_DEPTH="${GIT_CLONE_DEPTH:-1}"

# ------------------------------------------------------------------------------
# Service feature toggles
# ------------------------------------------------------------------------------
CLICKHOUSE_ENABLED="${CLICKHOUSE_ENABLED:-1}"
DUCKDB_ENABLED="${DUCKDB_ENABLED:-1}"
POSTGRES_ENABLED="${POSTGRES_ENABLED:-1}"
POSTGRES_INSTALL_EXTENSIONS="${POSTGRES_INSTALL_EXTENSIONS:-1}"

AUTO_SSL="${AUTO_SSL:-1}"
ENABLE_HTTPS="${ENABLE_HTTPS:-1}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$ADMIN_EMAIL}"
LETSENCRYPT_STAGING="${LETSENCRYPT_STAGING:-0}"

UFW_ENABLE="${UFW_ENABLE:-1}"
ALLOW_SSH_PORT="${ALLOW_SSH_PORT:-22}"
EXPOSE_SUPERSET_PORT="${EXPOSE_SUPERSET_PORT:-0}"
EXPOSE_CLICKHOUSE_HTTP="${EXPOSE_CLICKHOUSE_HTTP:-0}"
EXPOSE_CLICKHOUSE_NATIVE="${EXPOSE_CLICKHOUSE_NATIVE:-0}"
EXPOSE_POSTGRES_PORT="${EXPOSE_POSTGRES_PORT:-0}"
EXPOSE_REDIS_PORT="${EXPOSE_REDIS_PORT:-0}"

# ------------------------------------------------------------------------------
# Database / cache
# ------------------------------------------------------------------------------
POSTGRES_DB="${POSTGRES_DB:-superset}"
POSTGRES_USER="${POSTGRES_USER:-superset}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 18 2>/dev/null || echo change_me_now)}"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_DB="${REDIS_DB:-0}"

# ------------------------------------------------------------------------------
# Local logs / pid files
# ------------------------------------------------------------------------------
BACKEND_LOG_FILE="${BACKEND_LOG_FILE:-$LOG_DIR/superset_backend.log}"
FRONTEND_LOG_FILE="${FRONTEND_LOG_FILE:-$LOG_DIR/superset_frontend.log}"
REDIS_LOG_FILE="${REDIS_LOG_FILE:-$LOG_DIR/redis.log}"
CELERY_WORKER_LOG_FILE="${CELERY_WORKER_LOG_FILE:-$LOG_DIR/celery_worker.log}"
CELERY_BEAT_LOG_FILE="${CELERY_BEAT_LOG_FILE:-$LOG_DIR/celery_beat.log}"

BACKEND_PID_FILE="${BACKEND_PID_FILE:-$RUN_DIR/superset_backend.pid}"
FRONTEND_PID_FILE="${FRONTEND_PID_FILE:-$RUN_DIR/superset_frontend.pid}"
CELERY_WORKER_PID_FILE="${CELERY_WORKER_PID_FILE:-$RUN_DIR/celery_worker.pid}"
CELERY_BEAT_PID_FILE="${CELERY_BEAT_PID_FILE:-$RUN_DIR/celery_beat.pid}"

CELERY_BEAT_SCHEDULE="${CELERY_BEAT_SCHEDULE:-$RUN_DIR/celerybeat-schedule}"
FRONTEND_DISABLE_TYPE_CHECK="${FRONTEND_DISABLE_TYPE_CHECK:-1}"
BACKEND_ENABLE_RELOAD="${BACKEND_ENABLE_RELOAD:-0}"
BACKEND_ENABLE_DEBUGGER="${BACKEND_ENABLE_DEBUGGER:-0}"
CELERY_CONCURRENCY="${CELERY_CONCURRENCY:-2}"

NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/${APP_NAME}}"

# Frontend compatibility defaults for older Superset branches
NODE_MAJOR="${NODE_MAJOR:-18}"
NPM_INSTALL_FLAGS="${NPM_INSTALL_FLAGS:---legacy-peer-deps --force}"
NPM_CONFIG_LEGACY_PEER_DEPS="${NPM_CONFIG_LEGACY_PEER_DEPS:-true}"
NPM_CONFIG_FORCE="${NPM_CONFIG_FORCE:-true}"

# ------------------------------------------------------------------------------
# Common helpers
# ------------------------------------------------------------------------------
ensure_dirs() { mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR" "$RUN_DIR"; }
check_not_root() { [[ ${EUID} -ne 0 ]] || die "Do not run as root. Use a sudo-capable app user."; }
require_domain() { [[ -n "$DOMAIN" ]] || die "DOMAIN is required. Example: DOMAIN=supersets.vitalplatforms.com"; }

read_pid_file() { [[ -f "$1" ]] && cat "$1"; }
pid_is_running() { [[ -n "${1:-}" ]] && ps -p "$1" >/dev/null 2>&1; }
port_is_in_use() { lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

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
      ps -p "$pid" >/dev/null 2>&1 && kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
}

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
  if [[ -n "${pids:-}" ]]; then
    info "Killing listeners on port $port"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

wait_for_http() {
  local url="$1" max_tries="${2:-60}" sleep_secs="${3:-1}"
  local i
  i=1
  while [[ $i -le $max_tries ]]; do
    curl -fsS "$url" >/dev/null 2>&1 && return 0
    sleep "$sleep_secs"
    i=$((i+1))
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
import os, sys, time
pid_file, log_file, *cmd = sys.argv[1:]
first = os.fork()
if first > 0:
    sys.exit(0)
os.setsid()
second = os.fork()
if second > 0:
    with open(pid_file, "w", encoding="utf-8") as f:
        f.write(str(second))
    sys.exit(0)
with open(os.devnull, "rb", buffering=0) as devnull:
    os.dup2(devnull.fileno(), 0)
log_fd = os.open(log_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(log_fd, 1)
os.dup2(log_fd, 2)
os.close(log_fd)
try:
    os.execvp(cmd[0], cmd)
except Exception as ex:
    print("Failed to exec {}: {}".format(" ".join(cmd), ex), file=sys.stderr)
    time.sleep(1)
    raise
PY
  local pid=""
  local n=0
  while [[ $n -lt 20 ]]; do
    [[ -f "$pid_file" ]] && pid="$(cat "$pid_file" 2>/dev/null || true)"
    [[ -n "${pid:-}" ]] && break
    sleep 0.25
    n=$((n+1))
  done
  [[ -n "${pid:-}" ]] || die "Failed to capture detached process PID"
  echo "$pid"
}

venv_activate() {
  require_file "$VENV_DIR/bin/activate"
  # shellcheck disable=SC1090
  source "$VENV_DIR/bin/activate"
}

set_backend_env() {
  export SUPERSET_CONFIG_PATH="$SUPERSET_CONFIG_FILE"
  export FLASK_APP=superset
  export PYTHONUNBUFFERED=1
  export FLASK_ENV="${FLASK_ENV:-production}"
  export FLASK_DEBUG="$BACKEND_ENABLE_DEBUGGER"
  export DATABASE_URL="postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
}

frontend_dev_command() {
  require_file "$FRONTEND_DIR/package.json"
  grep -q '"dev-server"' "$FRONTEND_DIR/package.json" && { echo "npm run dev-server -- --port $FRONTEND_PORT"; return 0; }
  grep -q '"dev"' "$FRONTEND_DIR/package.json" && { echo "npm run dev -- --port $FRONTEND_PORT"; return 0; }
  grep -q '"start"' "$FRONTEND_DIR/package.json" && { echo "npm run start -- --port $FRONTEND_PORT"; return 0; }
  return 1
}

# ------------------------------------------------------------------------------
# Auto-tuning
# ------------------------------------------------------------------------------
get_cpu_cores() { nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2; }
get_total_mem_mb() {
  awk '/MemTotal/ { printf "%d", $2/1024 }' /proc/meminfo 2>/dev/null || \
  python3 - <<'PY'
import subprocess
try:
    val = subprocess.check_output(["sysctl", "-n", "hw.memsize"]).decode().strip()
    print(int(val)//1024//1024)
except Exception:
    print(4096)
PY
}
get_disk_gb() { df -BG --output=size / 2>/dev/null | tail -1 | tr -dc '0-9' || echo 50; }

calc_autotune() {
  CPU_CORES="$(get_cpu_cores)"
  TOTAL_MEM_MB="$(get_total_mem_mb)"
  ROOT_DISK_GB="$(get_disk_gb)"

  if (( CPU_CORES <= 2 )); then
    GUNICORN_WORKERS=2; GUNICORN_THREADS=4; CELERY_CONCURRENCY=1
  elif (( CPU_CORES <= 4 )); then
    GUNICORN_WORKERS=3; GUNICORN_THREADS=6; CELERY_CONCURRENCY=2
  elif (( CPU_CORES <= 8 )); then
    GUNICORN_WORKERS=4; GUNICORN_THREADS=8; CELERY_CONCURRENCY=4
  else
    if (( CPU_CORES > 12 )); then GUNICORN_WORKERS=6; else GUNICORN_WORKERS=$(( CPU_CORES / 2 )); fi
    GUNICORN_THREADS=8
    CELERY_CONCURRENCY=$(( CPU_CORES / 2 ))
  fi

  if (( TOTAL_MEM_MB < 4096 )); then
    PG_SHARED_BUFFERS_MB=$(( TOTAL_MEM_MB / 6 ))
    PG_EFFECTIVE_CACHE_MB=$(( TOTAL_MEM_MB / 2 ))
    PG_MAINTENANCE_MB=128
    PG_WORK_MEM_MB=8
    REDIS_MAXMEMORY_MB=256
  elif (( TOTAL_MEM_MB < 8192 )); then
    PG_SHARED_BUFFERS_MB=$(( TOTAL_MEM_MB / 5 ))
    PG_EFFECTIVE_CACHE_MB=$(( TOTAL_MEM_MB * 60 / 100 ))
    PG_MAINTENANCE_MB=256
    PG_WORK_MEM_MB=16
    REDIS_MAXMEMORY_MB=512
  elif (( TOTAL_MEM_MB < 16384 )); then
    PG_SHARED_BUFFERS_MB=$(( TOTAL_MEM_MB / 4 ))
    PG_EFFECTIVE_CACHE_MB=$(( TOTAL_MEM_MB * 65 / 100 ))
    PG_MAINTENANCE_MB=512
    PG_WORK_MEM_MB=24
    REDIS_MAXMEMORY_MB=1024
  elif (( TOTAL_MEM_MB < 32768 )); then
    PG_SHARED_BUFFERS_MB=$(( TOTAL_MEM_MB / 4 ))
    PG_EFFECTIVE_CACHE_MB=$(( TOTAL_MEM_MB * 70 / 100 ))
    PG_MAINTENANCE_MB=1024
    PG_WORK_MEM_MB=32
    REDIS_MAXMEMORY_MB=2048
  else
    PG_SHARED_BUFFERS_MB=$(( TOTAL_MEM_MB / 4 ))
    PG_EFFECTIVE_CACHE_MB=$(( TOTAL_MEM_MB * 75 / 100 ))
    PG_MAINTENANCE_MB=2048
    PG_WORK_MEM_MB=48
    REDIS_MAXMEMORY_MB=4096
  fi

  if (( TOTAL_MEM_MB <= 8192 )); then
    NGINX_PROXY_BUFFERS="16 16k"; NGINX_PROXY_BUFFER_SIZE="16k"; NGINX_PROXY_BUSY="64k"
  else
    NGINX_PROXY_BUFFERS="32 16k"; NGINX_PROXY_BUFFER_SIZE="32k"; NGINX_PROXY_BUSY="128k"
  fi

  GUNICORN_TIMEOUT=300
  GUNICORN_KEEPALIVE=5
  CACHE_DEFAULT_TIMEOUT=300
  DATA_CACHE_TIMEOUT=300
  FILTER_STATE_CACHE_TIMEOUT=86400
  EXPLORE_FORM_DATA_CACHE_TIMEOUT=86400
  SQLLAB_ASYNC_TIME_LIMIT_SEC=21600
  WORKER_PREFETCH_MULTIPLIER=1
}

# ------------------------------------------------------------------------------
# Local development validation
# ------------------------------------------------------------------------------
validate_project() {
  require_dir "$PROJECT_DIR"
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
  require_dir "$FRONTEND_DIR"
  require_cmd npm
  require_file "$FRONTEND_DIR/package.json"
}

# ------------------------------------------------------------------------------
# Local status helpers
# ------------------------------------------------------------------------------
backend_running() {
  local pid
  pid="$(read_pid_file "$BACKEND_PID_FILE" || true)"
  { [[ -n "${pid:-}" ]] && pid_is_running "$pid"; } || port_is_in_use "$BACKEND_PORT"
}
frontend_running() {
  local pid
  pid="$(read_pid_file "$FRONTEND_PID_FILE" || true)"
  { [[ -n "${pid:-}" ]] && pid_is_running "$pid"; } || port_is_in_use "$FRONTEND_PORT"
}
celery_worker_running() {
  local pid
  pid="$(read_pid_file "$CELERY_WORKER_PID_FILE" || true)"
  [[ -n "${pid:-}" ]] && pid_is_running "$pid"
}
celery_beat_running() {
  local pid
  pid="$(read_pid_file "$CELERY_BEAT_PID_FILE" || true)"
  [[ -n "${pid:-}" ]] && pid_is_running "$pid"
}
redis_running() {
  command_exists redis-cli && redis-cli ping >/dev/null 2>&1
}

# ------------------------------------------------------------------------------
# Local management
# ------------------------------------------------------------------------------
start_redis() {
  header "Starting Redis"
  if ! command_exists redis-server; then
    warn "Redis not installed locally"
    return 1
  fi
  ensure_dirs
  if redis_running; then ok "Redis already running"; return 0; fi
  redis-server --daemonize yes --dir "$PROJECT_DIR" --logfile "$REDIS_LOG_FILE" >/dev/null 2>&1 || true
  local i=0
  while [[ $i -lt 10 ]]; do
    sleep 1
    redis_running && { ok "Redis started"; return 0; }
    i=$((i+1))
  done
  warn "Redis failed to start"
  return 1
}
stop_redis() {
  header "Stopping Redis"
  command_exists redis-cli || { warn "redis-cli not installed"; return 0; }
  redis_running && redis-cli shutdown >/dev/null 2>&1 || warn "Redis not running"
}

start_backend() {
  header "Starting Superset Backend"
  validate_backend
  ensure_dirs
  backend_running && { warn "Backend already running on port $BACKEND_PORT"; return 0; }
  start_redis || true
  cd "$BACKEND_DIR"
  venv_activate
  set_backend_env
  python -m py_compile "$SUPERSET_CONFIG_FILE"

  local backend_cmd=()
  if [[ "$BACKEND_ENABLE_RELOAD" == "1" || "$BACKEND_ENABLE_DEBUGGER" == "1" ]]; then
    backend_cmd=("$VENV_DIR/bin/superset" run -h "$BACKEND_HOST" -p "$BACKEND_PORT" --with-threads)
    [[ "$BACKEND_ENABLE_RELOAD" == "1" ]] && backend_cmd+=(--reload)
    [[ "$BACKEND_ENABLE_DEBUGGER" == "1" ]] && backend_cmd+=(--debugger)
  else
    backend_cmd=("$VENV_DIR/bin/gunicorn" --bind "$BACKEND_HOST:$BACKEND_PORT" --workers "${BACKEND_GUNICORN_WORKERS:-1}" --threads "${BACKEND_GUNICORN_THREADS:-8}" --worker-class gthread --timeout "${SUPERSET_WEBSERVER_TIMEOUT:-300}" "superset.app:create_app()")
  fi

  local pid
  pid="$(spawn_detached "$BACKEND_PID_FILE" "$BACKEND_LOG_FILE" "${backend_cmd[@]}")"
  wait_for_http "http://$BACKEND_HOST:$BACKEND_PORT/health" 90 1 || { tail -100 "$BACKEND_LOG_FILE" || true; die "Backend failed to start"; }
  ok "Backend started (PID: $pid)"
  echo "  URL:  http://$BACKEND_HOST:$BACKEND_PORT"
}
stop_backend() {
  header "Stopping Superset Backend"
  kill_pid_file "$BACKEND_PID_FILE" "Superset backend"
  kill_port "$BACKEND_PORT"
  backend_running && die "Backend still appears to be running"
  ok "Backend stopped"
}
restart_backend() { stop_backend || true; sleep 1; start_backend; }

start_frontend() {
  header "Starting Superset Frontend Dev Server"
  validate_frontend
  ensure_dirs
  frontend_running && { warn "Frontend already running on port $FRONTEND_PORT"; return 0; }
  local cmd
  cmd="$(frontend_dev_command)" || die "Could not determine frontend dev command from package.json"
  cd "$FRONTEND_DIR"
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    export npm_config_legacy_peer_deps="${NPM_CONFIG_LEGACY_PEER_DEPS}"
    export npm_config_force="${NPM_CONFIG_FORCE}"
    npm install ${NPM_INSTALL_FLAGS}
  fi
  local pid
  pid="$(spawn_detached "$FRONTEND_PID_FILE" "$FRONTEND_LOG_FILE" bash -c "cd '$FRONTEND_DIR' && export PATH=\"$FRONTEND_DIR/node_modules/.bin:\$PATH\" && export DISABLE_TYPE_CHECK=\"$FRONTEND_DISABLE_TYPE_CHECK\" && export WEBPACK_DEVSERVER_PORT=\"$FRONTEND_PORT\" && $cmd")"
  local i=0
  while [[ $i -lt 90 ]]; do
    sleep 2
    port_is_in_use "$FRONTEND_PORT" && { ok "Frontend started (PID: $pid)"; echo "  URL: http://$FRONTEND_HOST:$FRONTEND_PORT"; return 0; }
    i=$((i+1))
  done
  tail -100 "$FRONTEND_LOG_FILE" || true
  die "Frontend failed to start"
}
stop_frontend() {
  header "Stopping Superset Frontend"
  kill_pid_file "$FRONTEND_PID_FILE" "Superset frontend"
  kill_port "$FRONTEND_PORT"
  frontend_running && die "Frontend still appears to be running"
  ok "Frontend stopped"
}
restart_frontend() { stop_frontend || true; sleep 1; start_frontend; }

start_celery_worker() {
  header "Starting Celery Worker"
  validate_backend
  ensure_dirs
  redis_running || start_redis || die "Redis unavailable"
  celery_worker_running && { ok "Celery worker already running"; return 0; }
  cd "$BACKEND_DIR"
  venv_activate
  set_backend_env
  local pid
  pid="$(spawn_detached "$CELERY_WORKER_PID_FILE" "$CELERY_WORKER_LOG_FILE" "$VENV_DIR/bin/celery" --app=superset.tasks.celery_app:app worker --loglevel=info --pool=prefork --concurrency="$CELERY_CONCURRENCY" -Q celery,dhis2)"
  local i=0
  while [[ $i -lt 20 ]]; do
    sleep 1
    celery_worker_running && { ok "Celery worker started (PID: $pid)"; return 0; }
    i=$((i+1))
  done
  tail -50 "$CELERY_WORKER_LOG_FILE" || true
  die "Celery worker failed to start"
}
stop_celery_worker() {
  header "Stopping Celery Worker"
  kill_pid_file "$CELERY_WORKER_PID_FILE" "Celery worker"
  pkill -f "celery.*superset.tasks.celery_app.*worker" 2>/dev/null || true
  ok "Celery worker stopped"
}
start_celery_beat() {
  header "Starting Celery Beat"
  validate_backend
  ensure_dirs
  redis_running || start_redis || die "Redis unavailable"
  celery_beat_running && { ok "Celery beat already running"; return 0; }
  cd "$BACKEND_DIR"
  venv_activate
  set_backend_env
  local pid
  pid="$(spawn_detached "$CELERY_BEAT_PID_FILE" "$CELERY_BEAT_LOG_FILE" "$VENV_DIR/bin/celery" --app=superset.tasks.celery_app:app beat --loglevel=info --schedule="$CELERY_BEAT_SCHEDULE")"
  local i=0
  while [[ $i -lt 20 ]]; do
    sleep 1
    celery_beat_running && { ok "Celery beat started (PID: $pid)"; return 0; }
    i=$((i+1))
  done
  tail -50 "$CELERY_BEAT_LOG_FILE" || true
  die "Celery beat failed to start"
}
stop_celery_beat() {
  header "Stopping Celery Beat"
  kill_pid_file "$CELERY_BEAT_PID_FILE" "Celery beat"
  pkill -f "celery.*superset.tasks.celery_app.*beat" 2>/dev/null || true
  ok "Celery beat stopped"
}
restart_celery() { stop_celery_beat || true; stop_celery_worker || true; sleep 1; start_celery_worker; start_celery_beat; }

build_frontend() {
  header "Building Superset Frontend"
  validate_frontend
  cd "$FRONTEND_DIR"
  export npm_config_legacy_peer_deps="${NPM_CONFIG_LEGACY_PEER_DEPS}"
  export npm_config_force="${NPM_CONFIG_FORCE}"
  npm install ${NPM_INSTALL_FLAGS}
  npm run build
  ok "Frontend build complete"
}

install_deps_local() {
  header "Installing Python Dependencies (local)"
  validate_project
  require_dir "$VENV_DIR"
  cd "$BACKEND_DIR"
  venv_activate
  [[ -f "$BACKEND_DIR/requirements/base.txt" ]] && "$VENV_DIR/bin/pip" install -r "$BACKEND_DIR/requirements/base.txt"
  if [[ -f "$BACKEND_DIR/setup.py" || -f "$BACKEND_DIR/pyproject.toml" ]]; then
    "$VENV_DIR/bin/pip" install -e "$BACKEND_DIR" --no-deps || true
  fi
  ok "Local Python dependencies installed"
}

db_upgrade_local() {
  header "Running Superset DB Upgrade (local)"
  validate_backend
  cd "$BACKEND_DIR"
  venv_activate
  set_backend_env
  "$VENV_DIR/bin/superset" db upgrade
  "$VENV_DIR/bin/superset" init
  ok "Database upgrade/init complete"
}

create_admin_local() {
  header "Creating/Updating Local Admin User"
  validate_backend
  cd "$BACKEND_DIR"
  venv_activate
  set_backend_env
  "$VENV_DIR/bin/superset" fab create-admin \
    --username "$ADMIN_USERNAME" \
    --firstname "$ADMIN_FIRSTNAME" \
    --lastname "$ADMIN_LASTNAME" \
    --email "$ADMIN_EMAIL" \
    --password "$ADMIN_PASSWORD" || true
  ok "Admin command executed"
}

clear_backend_cache() {
  header "Clearing Backend Cache"
  [[ ! -d "$PROJECT_DIR/superset_home/cache" ]] || rm -rf "$PROJECT_DIR/superset_home/cache"/* 2>/dev/null || true
  find "$PROJECT_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
  find "$PROJECT_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true
  ok "Backend cache cleared"
}
clear_frontend_cache() {
  header "Clearing Frontend Cache"
  validate_frontend
  cd "$FRONTEND_DIR"
  rm -rf dist build .webpack .next .eslintcache node_modules/.cache node_modules/.webpack 2>/dev/null || true
  npm cache clean --force >/dev/null 2>&1 || true
  ok "Frontend cache cleared"
}
clear_all_cache() { clear_backend_cache; clear_frontend_cache; }
clear_logs() {
  header "Clearing Logs"
  rm -f "$BACKEND_LOG_FILE" "$FRONTEND_LOG_FILE" "$REDIS_LOG_FILE" "$CELERY_WORKER_LOG_FILE" "$CELERY_BEAT_LOG_FILE"
  ok "Logs cleared"
}

backend_status() {
  header "Backend Status"
  if backend_running; then
    ok "Backend running"
    echo "  URL: http://$BACKEND_HOST:$BACKEND_PORT"
    curl -fsS "http://$BACKEND_HOST:$BACKEND_PORT/health" >/dev/null 2>&1 && ok "Health check OK" || warn "Health endpoint failed"
  else
    warn "Backend not running"
  fi
}
frontend_status() {
  header "Frontend Status"
  frontend_running && { ok "Frontend running"; echo "  URL: http://$FRONTEND_HOST:$FRONTEND_PORT"; } || warn "Frontend not running"
}
redis_status() {
  header "Redis Status"
  if redis_running; then
    ok "Redis running"
    local keys mem
    keys="$(redis-cli DBSIZE 2>/dev/null | awk '{print $2}' || echo 0)"
    mem="$(redis-cli INFO memory 2>/dev/null | awk -F: '/used_memory_human/ {print $2}' | tr -d '\r' || true)"
    echo "  Keys: ${keys:-0}"
    echo "  Memory: ${mem:-unknown}"
  else
    warn "Redis not running"
  fi
}
celery_status() {
  header "Celery Status"
  celery_worker_running && ok "Celery worker running" || warn "Celery worker not running"
  celery_beat_running && ok "Celery beat running" || warn "Celery beat not running"
}
status_all_local() { backend_status; celery_status; frontend_status; redis_status; }

view_logs() {
  local which="${1:-backend}" mode="${2:-tail}" file=""
  case "$which" in
    backend) file="$BACKEND_LOG_FILE" ;;
    frontend) file="$FRONTEND_LOG_FILE" ;;
    redis) file="$REDIS_LOG_FILE" ;;
    celery|celery-worker) file="$CELERY_WORKER_LOG_FILE" ;;
    celery-beat) file="$CELERY_BEAT_LOG_FILE" ;;
    *) die "Unknown log type: $which" ;;
  esac
  require_file "$file"
  [[ "$mode" == "follow" ]] && tail -f "$file" || tail -50 "$file"
}

start_all_local() {
  header "Starting Local Stack"
  start_backend
  start_celery_worker
  start_celery_beat
  start_frontend || true
  ok "Local services started"
}
stop_all_local() {
  header "Stopping Local Stack"
  stop_frontend || true
  stop_celery_beat || true
  stop_celery_worker || true
  stop_backend || true
  stop_redis || true
  ok "Local services stopped"
}
restart_all_local() {
  header "Restarting Local Stack"
  stop_all_local || true
  sleep 2
  clear_all_cache || true
  clear_logs || true
  db_upgrade_local || true
  start_all_local
}

# ------------------------------------------------------------------------------
# Server install / production config
# ------------------------------------------------------------------------------
install_system_packages() {
  info "Installing OS packages"
  sudo apt-get update
  sudo apt-get install -y \
    curl wget gnupg ca-certificates apt-transport-https lsb-release software-properties-common \
    build-essential pkg-config git unzip rsync jq ufw \
    python3 python3-venv python3-dev python3-pip \
    libffi-dev libssl-dev libsasl2-dev libldap2-dev libpq-dev default-libmysqlclient-dev \
    redis-server nginx postgresql postgresql-contrib postgresql-client \
    certbot python3-certbot-nginx
  if ! command_exists node || ! command_exists npm; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  # Older Superset workspaces tend to behave better with npm 9 than npm 10+
  sudo npm install -g npm@9 || true
  sudo systemctl enable --now redis-server postgresql nginx
  ok "OS packages installed"
}

setup_venv_server() {
  info "Creating Python virtual environment"
  python3 -m venv "$VENV_DIR"
  venv_activate
  pip install --upgrade pip wheel setuptools
  ok "Virtual environment ready"
}

install_python_dependencies_server() {
  info "Installing Python dependencies"
  venv_activate
  [[ -f "$INSTALL_DIR/requirements/base.txt" ]] && pip install -r "$INSTALL_DIR/requirements/base.txt"
  [[ -f "$INSTALL_DIR/requirements/development.txt" ]] && pip install -r "$INSTALL_DIR/requirements/development.txt" || true
  pip install apache-superset psycopg2-binary redis celery gevent gunicorn cachelib
  [[ "$DUCKDB_ENABLED" == "1" ]] && pip install duckdb duckdb-engine
  if [[ -f "$INSTALL_DIR/setup.py" || -f "$INSTALL_DIR/pyproject.toml" ]]; then
    pip install -e "$INSTALL_DIR" || true
  fi
  ok "Python dependencies installed"
}

build_frontend_if_present_server() {
  if [[ -d "$INSTALL_DIR/superset-frontend" ]]; then
    info "Building frontend assets"
    cd "$INSTALL_DIR/superset-frontend"
    export npm_config_legacy_peer_deps="${NPM_CONFIG_LEGACY_PEER_DEPS}"
    export npm_config_force="${NPM_CONFIG_FORCE}"
    export CI=1
    if [[ -f package-lock.json ]]; then
      npm ci ${NPM_INSTALL_FLAGS} || npm install ${NPM_INSTALL_FLAGS}
    else
      npm install ${NPM_INSTALL_FLAGS}
    fi
    npm run build || npm run prod || true
    ok "Frontend assets built"
  fi
}

configure_redis_server() {
  info "Tuning Redis"
  sudo sed -i "s/^#*maxmemory .*/maxmemory ${REDIS_MAXMEMORY_MB}mb/" /etc/redis/redis.conf || true
  sudo sed -i "s/^#*maxmemory-policy .*/maxmemory-policy allkeys-lru/" /etc/redis/redis.conf || true
  sudo systemctl restart redis-server
  ok "Redis tuned"
}

configure_postgresql_server() {
  [[ "$POSTGRES_ENABLED" == "1" ]] || return 0
  info "Configuring PostgreSQL"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'" | grep -q 1 || sudo -u postgres psql -c "CREATE USER ${POSTGRES_USER} WITH PASSWORD '${POSTGRES_PASSWORD}';"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER} ENCODING 'UTF8';"
  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB} TO ${POSTGRES_USER};"

  if [[ "$POSTGRES_INSTALL_EXTENSIONS" == "1" ]]; then
    sudo -u postgres psql -d "$POSTGRES_DB" -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
    sudo -u postgres psql -d "$POSTGRES_DB" -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
    sudo -u postgres psql -d "$POSTGRES_DB" -c 'CREATE EXTENSION IF NOT EXISTS citext;'
    sudo -u postgres psql -d "$POSTGRES_DB" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
  fi

  local pg_version pg_conf
  pg_version="$(psql --version | awk '{print $3}' | cut -d. -f1)"
  pg_conf="/etc/postgresql/${pg_version}/main/postgresql.conf"
  sudo cp "$pg_conf" "${pg_conf}.bak.$(date +%s)" || true
  sudo sed -i "s/^#\?shared_buffers =.*/shared_buffers = ${PG_SHARED_BUFFERS_MB}MB/" "$pg_conf"
  sudo sed -i "s/^#\?effective_cache_size =.*/effective_cache_size = ${PG_EFFECTIVE_CACHE_MB}MB/" "$pg_conf"
  sudo sed -i "s/^#\?maintenance_work_mem =.*/maintenance_work_mem = ${PG_MAINTENANCE_MB}MB/" "$pg_conf"
  sudo sed -i "s/^#\?work_mem =.*/work_mem = ${PG_WORK_MEM_MB}MB/" "$pg_conf"
  sudo sed -i "s/^#\?wal_compression =.*/wal_compression = on/" "$pg_conf" || echo "wal_compression = on" | sudo tee -a "$pg_conf" >/dev/null
  sudo sed -i "s/^#\?max_connections =.*/max_connections = 100/" "$pg_conf"
  grep -q '^random_page_cost' "$pg_conf" && sudo sed -i 's/^random_page_cost =.*/random_page_cost = 1.1/' "$pg_conf" || echo 'random_page_cost = 1.1' | sudo tee -a "$pg_conf" >/dev/null
  grep -q '^effective_io_concurrency' "$pg_conf" && sudo sed -i 's/^effective_io_concurrency =.*/effective_io_concurrency = 200/' "$pg_conf" || echo 'effective_io_concurrency = 200' | sudo tee -a "$pg_conf" >/dev/null
  sudo systemctl restart postgresql
  ok "PostgreSQL configured and tuned"
}

generate_env_server() {
  info "Writing .env"
  cat > "$ENV_FILE" <<EOF
DOMAIN=${DOMAIN}
SUPERSET_ENV=production
SUPERSET_HOST=${SUPERSET_HOST}
SUPERSET_PORT=${SUPERSET_PORT}
SUPERSET_SECRET_KEY=${SUPERSET_SECRET_KEY}
GUEST_TOKEN_JWT_SECRET=${GUEST_TOKEN_JWT_SECRET}

ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_FIRSTNAME=${ADMIN_FIRSTNAME}
ADMIN_LASTNAME=${ADMIN_LASTNAME}
ADMIN_EMAIL=${ADMIN_EMAIL}

POSTGRES_ENABLED=${POSTGRES_ENABLED}
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_HOST=${POSTGRES_HOST}
POSTGRES_PORT=${POSTGRES_PORT}
DATABASE_URL=postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}

REDIS_HOST=${REDIS_HOST}
REDIS_PORT=${REDIS_PORT}
REDIS_DB=${REDIS_DB}
CELERY_BROKER_URL=redis://${REDIS_HOST}:${REDIS_PORT}/0
CELERY_RESULT_BACKEND=redis://${REDIS_HOST}:${REDIS_PORT}/1
RESULTS_BACKEND_REDIS_URL=redis://${REDIS_HOST}:${REDIS_PORT}/2

CACHE_DEFAULT_TIMEOUT=${CACHE_DEFAULT_TIMEOUT}
DATA_CACHE_TIMEOUT=${DATA_CACHE_TIMEOUT}
FILTER_STATE_CACHE_TIMEOUT=${FILTER_STATE_CACHE_TIMEOUT}
EXPLORE_FORM_DATA_CACHE_TIMEOUT=${EXPLORE_FORM_DATA_CACHE_TIMEOUT}
SQLLAB_ASYNC_TIME_LIMIT_SEC=${SQLLAB_ASYNC_TIME_LIMIT_SEC}

CPU_CORES=${CPU_CORES}
TOTAL_MEM_MB=${TOTAL_MEM_MB}
ROOT_DISK_GB=${ROOT_DISK_GB}
GUNICORN_WORKERS=${GUNICORN_WORKERS}
GUNICORN_THREADS=${GUNICORN_THREADS}
GUNICORN_TIMEOUT=${GUNICORN_TIMEOUT}
GUNICORN_KEEPALIVE=${GUNICORN_KEEPALIVE}
CELERY_CONCURRENCY=${CELERY_CONCURRENCY}
REDIS_MAXMEMORY_MB=${REDIS_MAXMEMORY_MB}
PG_SHARED_BUFFERS_MB=${PG_SHARED_BUFFERS_MB}
PG_EFFECTIVE_CACHE_MB=${PG_EFFECTIVE_CACHE_MB}
PG_MAINTENANCE_MB=${PG_MAINTENANCE_MB}
PG_WORK_MEM_MB=${PG_WORK_MEM_MB}
WORKER_PREFETCH_MULTIPLIER=${WORKER_PREFETCH_MULTIPLIER}
GUNICORN_CMD_ARGS=--bind ${SUPERSET_HOST}:${SUPERSET_PORT} --workers ${GUNICORN_WORKERS} --threads ${GUNICORN_THREADS} --worker-class gthread --timeout ${GUNICORN_TIMEOUT} --keep-alive ${GUNICORN_KEEPALIVE} --max-requests 2000 --max-requests-jitter 200

UFW_ENABLE=${UFW_ENABLE}
ALLOW_SSH_PORT=${ALLOW_SSH_PORT}
ENABLE_HTTPS=${ENABLE_HTTPS}
AUTO_SSL=${AUTO_SSL}
LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL}
LETSENCRYPT_STAGING=${LETSENCRYPT_STAGING}
EXPOSE_SUPERSET_PORT=${EXPOSE_SUPERSET_PORT}
EXPOSE_POSTGRES_PORT=${EXPOSE_POSTGRES_PORT}
EXPOSE_REDIS_PORT=${EXPOSE_REDIS_PORT}
EOF
  ok ".env written"
}

generate_superset_config_server() {
  info "Writing superset_config.py"
  cat > "$SUPERSET_CONFIG_FILE" <<'PY'
import os
from cachelib.redis import RedisCache

SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL")
SECRET_KEY = os.getenv("SUPERSET_SECRET_KEY")
WTF_CSRF_ENABLED = True
TALISMAN_ENABLED = False
ROW_LIMIT = 5000
SUPERSET_WEBSERVER_TIMEOUT = int(os.getenv("GUNICORN_TIMEOUT", "300"))
SQLLAB_ASYNC_TIME_LIMIT_SEC = int(os.getenv("SQLLAB_ASYNC_TIME_LIMIT_SEC", "21600"))
FEATURE_FLAGS = {
    "EMBEDDED_SUPERSET": True,
    "ENABLE_TEMPLATE_PROCESSING": True,
    "THUMBNAILS": True,
    "ALERT_REPORTS": True,
    "DASHBOARD_RBAC": True,
    "DYNAMIC_PLUGINS": True,
}
REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))

FILTER_STATE_CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": int(os.getenv("FILTER_STATE_CACHE_TIMEOUT", "86400")),
    "CACHE_KEY_PREFIX": "superset_filter_state_",
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
    "CACHE_REDIS_DB": 3,
}
EXPLORE_FORM_DATA_CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": int(os.getenv("EXPLORE_FORM_DATA_CACHE_TIMEOUT", "86400")),
    "CACHE_KEY_PREFIX": "superset_explore_form_",
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
    "CACHE_REDIS_DB": 4,
}
DATA_CACHE_CONFIG = {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": int(os.getenv("DATA_CACHE_TIMEOUT", "300")),
    "CACHE_KEY_PREFIX": "superset_data_",
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
    "CACHE_REDIS_DB": 5,
}
RESULTS_BACKEND = RedisCache(
    host=REDIS_HOST,
    port=REDIS_PORT,
    db=2,
    key_prefix="superset_results_",
)

class CeleryConfig:
    broker_url = os.getenv("CELERY_BROKER_URL", "redis://127.0.0.1:6379/0")
    result_backend = os.getenv("CELERY_RESULT_BACKEND", "redis://127.0.0.1:6379/1")
    worker_prefetch_multiplier = int(os.getenv("WORKER_PREFETCH_MULTIPLIER", "1"))
    task_acks_late = True
    task_annotations = {"sql_lab.get_sql_results": {"rate_limit": "100/s"}}

CELERY_CONFIG = CeleryConfig
ENABLE_PROXY_FIX = True
PREFERRED_URL_SCHEME = "https"
PY
  ok "superset_config.py written"
}

create_systemd_units_server() {
  info "Creating systemd units"
  sudo tee /etc/systemd/system/superset-web.service >/dev/null <<EOF
[Unit]
Description=Superset Web
After=network.target postgresql.service redis-server.service

[Service]
User=${USER}
Group=${USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
Environment=SUPERSET_CONFIG_PATH=${SUPERSET_CONFIG_FILE}
ExecStart=${VENV_DIR}/bin/gunicorn -w ${GUNICORN_WORKERS} --threads ${GUNICORN_THREADS} -k gthread -b ${SUPERSET_HOST}:${SUPERSET_PORT} --timeout ${GUNICORN_TIMEOUT} --keep-alive ${GUNICORN_KEEPALIVE} 'superset.app:create_app()'
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

  sudo tee /etc/systemd/system/superset-worker.service >/dev/null <<EOF
[Unit]
Description=Superset Celery Worker
After=network.target postgresql.service redis-server.service

[Service]
User=${USER}
Group=${USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
Environment=SUPERSET_CONFIG_PATH=${SUPERSET_CONFIG_FILE}
ExecStart=${VENV_DIR}/bin/celery --app=superset.tasks.celery_app:app worker --pool=prefork -O fair --concurrency=${CELERY_CONCURRENCY}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  sudo tee /etc/systemd/system/superset-beat.service >/dev/null <<EOF
[Unit]
Description=Superset Celery Beat
After=network.target postgresql.service redis-server.service

[Service]
User=${USER}
Group=${USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
Environment=SUPERSET_CONFIG_PATH=${SUPERSET_CONFIG_FILE}
ExecStart=${VENV_DIR}/bin/celery --app=superset.tasks.celery_app:app beat
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable superset-web superset-worker superset-beat
  ok "systemd units created"
}

configure_firewall_server() {
  [[ "$UFW_ENABLE" == "1" ]] || { warn "UFW disabled; skipping firewall config"; return 0; }
  info "Configuring UFW"
  sudo ufw allow "${ALLOW_SSH_PORT}"/tcp comment 'SSH' || true
  sudo ufw allow 80/tcp comment 'HTTP' || true
  if [[ "$ENABLE_HTTPS" == "1" || "$AUTO_SSL" == "1" ]]; then
    sudo ufw allow 443/tcp comment 'HTTPS' || true
  fi
  [[ "$EXPOSE_SUPERSET_PORT" == "1" ]] && sudo ufw allow "${SUPERSET_PORT}"/tcp comment 'Superset direct' || true
  [[ "$EXPOSE_POSTGRES_PORT" == "1" ]] && sudo ufw allow "${POSTGRES_PORT}"/tcp comment 'PostgreSQL' || true
  [[ "$EXPOSE_REDIS_PORT" == "1" ]] && sudo ufw allow "${REDIS_PORT}"/tcp comment 'Redis' || true
  sudo ufw --force enable || true
  sudo ufw reload || true
  ok "UFW configured"
}

configure_nginx_server() {
  info "Configuring Nginx reverse proxy"
  sudo tee "$NGINX_SITE" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 64m;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types
        text/plain
        text/css
        application/json
        application/javascript
        text/xml
        application/xml
        application/xml+rss
        text/javascript
        image/svg+xml;

    location / {
        proxy_pass http://${SUPERSET_HOST}:${SUPERSET_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_buffering on;
        proxy_buffer_size ${NGINX_PROXY_BUFFER_SIZE};
        proxy_buffers ${NGINX_PROXY_BUFFERS};
        proxy_busy_buffers_size ${NGINX_PROXY_BUSY};
        proxy_read_timeout 300;
        proxy_send_timeout 300;
        proxy_connect_timeout 60;
    }
}
EOF
  sudo ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/${APP_NAME}"
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl enable --now nginx
  sudo systemctl reload nginx
  ok "Nginx configured for HTTP"
}

configure_ssl_server() {
  [[ "$AUTO_SSL" == "1" ]] || { warn "Automatic SSL disabled"; return 0; }
  [[ -n "$DOMAIN" ]] || { warn "DOMAIN not set; skipping Let's Encrypt"; return 0; }
  [[ -n "$LETSENCRYPT_EMAIL" ]] || { warn "LETSENCRYPT_EMAIL not set; skipping Let's Encrypt"; return 0; }

  info "Requesting Let's Encrypt certificate for ${DOMAIN}"
  local staging_arg=""
  [[ "$LETSENCRYPT_STAGING" == "1" ]] && staging_arg="--staging"
  sudo systemctl enable --now nginx
  sudo nginx -t
  sudo systemctl reload nginx
  sudo certbot --nginx --non-interactive --agree-tos --email "$LETSENCRYPT_EMAIL" -d "$DOMAIN" ${staging_arg} --redirect || {
    warn "Let's Encrypt provisioning failed. Check DNS for ${DOMAIN} and ensure ports 80/443 are open."
    return 1
  }
  sudo systemctl reload nginx
  ok "Let's Encrypt SSL configured"
}

initialize_superset_server() {
  info "Initializing Superset"
  venv_activate
  export SUPERSET_CONFIG_PATH="$SUPERSET_CONFIG_FILE"
  export FLASK_APP=superset
  export DATABASE_URL="postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
  superset db upgrade
  superset fab create-admin \
    --username "$ADMIN_USERNAME" \
    --firstname "$ADMIN_FIRSTNAME" \
    --lastname "$ADMIN_LASTNAME" \
    --email "$ADMIN_EMAIL" \
    --password "$ADMIN_PASSWORD" || true
  superset init
  ok "Superset initialized"
}

start_services_server() {
  sudo systemctl restart superset-web superset-worker superset-beat nginx redis-server postgresql
  ok "Services started"
}
stop_services_server() {
  sudo systemctl stop superset-web superset-worker superset-beat || true
  ok "Services stopped"
}
restart_services_server() {
  sudo systemctl restart superset-web superset-worker superset-beat nginx redis-server postgresql
  ok "Services restarted"
}
show_status_server() {
  echo "Resources: CPU=${CPU_CORES:-?} RAM=${TOTAL_MEM_MB:-?}MB DISK=${ROOT_DISK_GB:-?}GB"
  echo "Gunicorn: workers=${GUNICORN_WORKERS:-?} threads=${GUNICORN_THREADS:-?} timeout=${GUNICORN_TIMEOUT:-?}"
  echo "Celery: concurrency=${CELERY_CONCURRENCY:-?}"
  echo "PostgreSQL: shared_buffers=${PG_SHARED_BUFFERS_MB:-?}MB effective_cache=${PG_EFFECTIVE_CACHE_MB:-?}MB work_mem=${PG_WORK_MEM_MB:-?}MB"
  echo "Redis: maxmemory=${REDIS_MAXMEMORY_MB:-?}MB"
  sudo systemctl --no-pager --full status superset-web superset-worker superset-beat nginx redis-server postgresql || true
}

install_server() {
  check_not_root
  require_domain
  calc_autotune
  ensure_dirs
  install_system_packages
  setup_venv_server
  install_python_dependencies_server
  build_frontend_if_present_server
  configure_redis_server
  configure_postgresql_server
  generate_env_server
  generate_superset_config_server
  create_systemd_units_server
  configure_firewall_server
  configure_nginx_server
  configure_ssl_server || true
  initialize_superset_server
  start_services_server
  show_status_server
  cat <<EOF

Deployment complete.
URL: https://${DOMAIN}
Detected resources: ${CPU_CORES} CPU cores, ${TOTAL_MEM_MB}MB RAM, ${ROOT_DISK_GB}GB disk.
EOF
}

# ------------------------------------------------------------------------------
# Remote deployment helpers
# ------------------------------------------------------------------------------
validate_codebase_source() {
  case "$CODEBASE_SOURCE" in
    local)
      require_dir "$LOCAL_PROJECT_DIR"
      ;;
    git)
      [[ -n "$GIT_REPO_URL" ]] || die "GIT_REPO_URL is required when CODEBASE_SOURCE=git"
      ;;
    *)
      die "Unsupported CODEBASE_SOURCE: $CODEBASE_SOURCE (use local or git)"
      ;;
  esac
}

remote_login() { echo "${REMOTE_USER}@${REMOTE_HOST}"; }
remote_exec() { ssh "${SSH_OPTS[@]}" "$(remote_login)" "$@"; }

ensure_remote_prereqs() {
  require_cmd ssh
  require_cmd rsync
}

remote_run_as_app_user_stdin() {
  if [[ "$REMOTE_USER" == "root" && "$REMOTE_SUDO_APP_USER" == "1" ]]; then
    ssh "${SSH_OPTS[@]}" "$(remote_login)" "sudo -H -u '${REMOTE_APP_USER}' bash -s"
  else
    ssh "${SSH_OPTS[@]}" "$(remote_login)" "bash -s"
  fi
}

remote_run_as_app_user() {
  local cmd="$1"
  printf '%s\n' "$cmd" | remote_run_as_app_user_stdin
}

ensure_remote_app_user() {
  local target_dir="${REMOTE_INSTALL_DIR:-${INSTALL_DIR:-/opt/superset}}"
  local parent_dir
  parent_dir="$(dirname "$target_dir")"

  if [[ "$REMOTE_USER" == "root" ]]; then
    header "Ensuring remote app user"
    remote_exec "id -u '${REMOTE_APP_USER}' >/dev/null 2>&1 || useradd -m -d /home/${REMOTE_APP_USER} -s /bin/bash '${REMOTE_APP_USER}'"
    remote_exec "mkdir -p /home/${REMOTE_APP_USER}"
    remote_exec "chown -R '${REMOTE_APP_USER}:${REMOTE_APP_USER}' /home/${REMOTE_APP_USER}"
    remote_exec "usermod -aG sudo '${REMOTE_APP_USER}' || true"

    remote_exec "mkdir -p '${parent_dir}'"
    remote_exec "mkdir -p '${target_dir}'"
    remote_exec "mkdir -p '${target_dir}/config' '${target_dir}/data' '${target_dir}/logs' '${target_dir}/run'"
    remote_exec "chown -R '${REMOTE_APP_USER}:${REMOTE_APP_USER}' '${target_dir}'"
    remote_exec "chmod 755 '${parent_dir}' '${target_dir}' || true"

    ok "Remote app user ready: ${REMOTE_APP_USER}"
    ok "Remote install directory ready: ${target_dir}"
  else
    header "Using remote user directly"
    remote_exec "mkdir -p '${target_dir}' '${target_dir}/config' '${target_dir}/data' '${target_dir}/logs' '${target_dir}/run'"
    ok "Remote install directory ready: ${target_dir}"
  fi
}

prepare_remote_codebase_from_git() {
  header "Preparing remote codebase from Git"
  [[ -n "$GIT_REPO_URL" ]] || die "GIT_REPO_URL is required for git source"

  case "$REMOTE_INSTALL_DIR" in
    /Users/*|/Volumes/*)
      die "REMOTE_INSTALL_DIR points to a local macOS path: $REMOTE_INSTALL_DIR. Set REMOTE_INSTALL_DIR to a Linux server path such as /opt/superset or /srv/apps/superset"
      ;;
  esac

  local dir_q repo_q branch_q ref_q depth_q
  dir_q=$(printf '%q' "$REMOTE_INSTALL_DIR")
  repo_q=$(printf '%q' "$GIT_REPO_URL")
  branch_q=$(printf '%q' "$GIT_BRANCH")
  ref_q=$(printf '%q' "$GIT_REF")
  depth_q=$(printf '%q' "$GIT_CLONE_DEPTH")

  remote_run_as_app_user_stdin <<EOF
set -Eeuo pipefail
REMOTE_INSTALL_DIR=$dir_q
GIT_REPO_URL=$repo_q
GIT_BRANCH=$branch_q
GIT_REF=$ref_q
GIT_CLONE_DEPTH=$depth_q

mkdir -p "\$REMOTE_INSTALL_DIR"

shopt -s nullglob dotglob
entries=( "\$REMOTE_INSTALL_DIR"/* )
non_runtime=()
for entry in "\${entries[@]}"; do
  base="\$(basename "\$entry")"
  case "\$base" in
    .git|config|data|logs|run|venv|.env|superset-manager.sh|superset-manager-v2.sh)
      ;;
    *)
      non_runtime+=("\$base")
      ;;
  esac
done

if [[ -d "\$REMOTE_INSTALL_DIR/.git" ]]; then
  cd "\$REMOTE_INSTALL_DIR"
  git remote set-url origin "\$GIT_REPO_URL"
  git fetch --all --tags
  if [[ -n "\$GIT_REF" ]]; then
    git checkout "\$GIT_REF"
  else
    git checkout "\$GIT_BRANCH"
    git pull --ff-only origin "\$GIT_BRANCH"
  fi
else
  if (( \${#non_runtime[@]} > 0 )); then
    echo "Install dir exists and contains non-runtime content: \${non_runtime[*]}" >&2
    echo "Refusing to overwrite existing contents automatically." >&2
    exit 1
  fi
  git clone --depth "\$GIT_CLONE_DEPTH" --branch "\$GIT_BRANCH" "\$GIT_REPO_URL" "\$REMOTE_INSTALL_DIR/src"
  shopt -s dotglob nullglob
  mv "\$REMOTE_INSTALL_DIR"/src/* "\$REMOTE_INSTALL_DIR"/
  rmdir "\$REMOTE_INSTALL_DIR/src"
  if [[ -n "\$GIT_REF" ]]; then
    cd "\$REMOTE_INSTALL_DIR"
    git fetch --all --tags
    git checkout "\$GIT_REF"
  fi
fi
EOF

  ok "Remote codebase prepared from Git"
}

rsync_local_code_to_remote() {
  ensure_remote_prereqs
  header "Syncing local codebase to remote server"

  case "$REMOTE_INSTALL_DIR" in
    /Users/*|/Volumes/*)
      die "REMOTE_INSTALL_DIR points to a local macOS path: $REMOTE_INSTALL_DIR. Set REMOTE_INSTALL_DIR to a Linux server path such as /opt/superset or /srv/apps/superset"
      ;;
  esac

  local remote_target
  if [[ "$REMOTE_USER" == "root" && "$REMOTE_SUDO_APP_USER" == "1" ]]; then
    remote_target="$(remote_login):/tmp/${APP_NAME}-sync/"
    remote_exec "mkdir -p /tmp/${APP_NAME}-sync"
    rsync -az --delete -e "$RSYNC_SSH" \
      --exclude '.git' \
      --exclude 'venv' \
      --exclude 'node_modules' \
      --exclude 'dist' \
      --exclude 'build' \
      --exclude '__pycache__' \
      --exclude '*.pyc' \
      --exclude 'logs' \
      --exclude 'run' \
      --exclude 'data' \
      --exclude '.DS_Store' \
      "$LOCAL_PROJECT_DIR"/ "$remote_target"
    remote_exec "mkdir -p '${REMOTE_INSTALL_DIR}' && rsync -az --delete /tmp/${APP_NAME}-sync/ '${REMOTE_INSTALL_DIR}/' && chown -R '${REMOTE_APP_USER}:${REMOTE_APP_USER}' '${REMOTE_INSTALL_DIR}'"
  else
    remote_target="$(remote_login):${REMOTE_INSTALL_DIR}/"
    remote_exec "mkdir -p '${REMOTE_INSTALL_DIR}'"
    rsync -az --delete -e "$RSYNC_SSH" \
      --exclude '.git' \
      --exclude 'venv' \
      --exclude 'node_modules' \
      --exclude 'dist' \
      --exclude 'build' \
      --exclude '__pycache__' \
      --exclude '*.pyc' \
      --exclude 'logs' \
      --exclude 'run' \
      --exclude 'data' \
      --exclude '.DS_Store' \
      "$LOCAL_PROJECT_DIR"/ "$remote_target"
  fi
  ok "Local code synced to remote"
}

prepare_remote_codebase() {
  validate_codebase_source
  if [[ "$CODEBASE_SOURCE" == "git" ]]; then
    prepare_remote_codebase_from_git
  else
    rsync_local_code_to_remote
  fi
}

push_self_to_remote() {
  local src_script="$0"
  local tmp_script="/tmp/${REMOTE_SCRIPT_BASENAME}"
  info "Uploading manager script to remote: ${tmp_script}"
  scp "${SCP_OPTS[@]}" "$src_script" "$(remote_login):${tmp_script}" >/dev/null
  if [[ "$REMOTE_USER" == "root" && "$REMOTE_SUDO_APP_USER" == "1" ]]; then
    remote_exec "mkdir -p '${REMOTE_INSTALL_DIR}' && cp '${tmp_script}' '${REMOTE_SCRIPT_PATH}' && chown '${REMOTE_APP_USER}:${REMOTE_APP_USER}' '${REMOTE_SCRIPT_PATH}' && chmod +x '${REMOTE_SCRIPT_PATH}'"
  else
    remote_exec "mkdir -p '${REMOTE_INSTALL_DIR}' && cp '${tmp_script}' '${REMOTE_SCRIPT_PATH}' && chmod +x '${REMOTE_SCRIPT_PATH}'"
  fi
  ok "Remote manager script updated"
}

deploy_remote() {
  ensure_remote_prereqs
  require_domain
  ensure_remote_app_user
  prepare_remote_codebase
  push_self_to_remote
  header "Running remote install from synced code"
  local remote_script
  remote_script=$(cat <<EOF
set -Eeuo pipefail
cd '${REMOTE_INSTALL_DIR}'
export APP_NAME='${APP_NAME}'
export REMOTE_APP_USER='${REMOTE_APP_USER}'
export REMOTE_INSTALL_DIR='${REMOTE_INSTALL_DIR}'
export INSTALL_DIR='${REMOTE_INSTALL_DIR}'
export PROJECT_DIR='${REMOTE_INSTALL_DIR}'
export DOMAIN='${DOMAIN}'
export ADMIN_USERNAME='${ADMIN_USERNAME}'
export ADMIN_FIRSTNAME='${ADMIN_FIRSTNAME}'
export ADMIN_LASTNAME='${ADMIN_LASTNAME}'
export ADMIN_EMAIL='${ADMIN_EMAIL}'
export ADMIN_PASSWORD='${ADMIN_PASSWORD}'
export POSTGRES_ENABLED='${POSTGRES_ENABLED}'
export POSTGRES_DB='${POSTGRES_DB}'
export POSTGRES_USER='${POSTGRES_USER}'
export POSTGRES_PASSWORD='${POSTGRES_PASSWORD}'
export POSTGRES_HOST='${POSTGRES_HOST}'
export POSTGRES_PORT='${POSTGRES_PORT}'
export POSTGRES_INSTALL_EXTENSIONS='${POSTGRES_INSTALL_EXTENSIONS}'
export CLICKHOUSE_ENABLED='${CLICKHOUSE_ENABLED}'
export DUCKDB_ENABLED='${DUCKDB_ENABLED}'
export AUTO_SSL='${AUTO_SSL}'
export ENABLE_HTTPS='${ENABLE_HTTPS}'
export LETSENCRYPT_EMAIL='${LETSENCRYPT_EMAIL}'
export LETSENCRYPT_STAGING='${LETSENCRYPT_STAGING}'
export UFW_ENABLE='${UFW_ENABLE}'
export ALLOW_SSH_PORT='${ALLOW_SSH_PORT}'
export EXPOSE_SUPERSET_PORT='${EXPOSE_SUPERSET_PORT}'
export EXPOSE_POSTGRES_PORT='${EXPOSE_POSTGRES_PORT}'
export EXPOSE_REDIS_PORT='${EXPOSE_REDIS_PORT}'
export NODE_MAJOR='${NODE_MAJOR}'
export NPM_INSTALL_FLAGS='${NPM_INSTALL_FLAGS}'
export NPM_CONFIG_LEGACY_PEER_DEPS='${NPM_CONFIG_LEGACY_PEER_DEPS}'
export NPM_CONFIG_FORCE='${NPM_CONFIG_FORCE}'
test -f '${REMOTE_SCRIPT_PATH}' || { echo 'Missing remote manager script: ${REMOTE_SCRIPT_PATH}' >&2; exit 1; }
chmod +x '${REMOTE_SCRIPT_PATH}'
'${REMOTE_SCRIPT_PATH}' install-server
EOF
)
  remote_run_as_app_user "$remote_script"
}

upgrade_remote() {
  ensure_remote_prereqs
  ensure_remote_app_user
  prepare_remote_codebase
  push_self_to_remote
  header "Running remote upgrade"
  local remote_script
  remote_script=$(cat <<EOF
set -Eeuo pipefail
cd '${REMOTE_INSTALL_DIR}'
export APP_NAME='${APP_NAME}'
export REMOTE_APP_USER='${REMOTE_APP_USER}'
export REMOTE_INSTALL_DIR='${REMOTE_INSTALL_DIR}'
export INSTALL_DIR='${REMOTE_INSTALL_DIR}'
export PROJECT_DIR='${REMOTE_INSTALL_DIR}'
export DOMAIN='${DOMAIN}'
export ADMIN_USERNAME='${ADMIN_USERNAME}'
export ADMIN_FIRSTNAME='${ADMIN_FIRSTNAME}'
export ADMIN_LASTNAME='${ADMIN_LASTNAME}'
export ADMIN_EMAIL='${ADMIN_EMAIL}'
export ADMIN_PASSWORD='${ADMIN_PASSWORD}'
export POSTGRES_ENABLED='${POSTGRES_ENABLED}'
export POSTGRES_DB='${POSTGRES_DB}'
export POSTGRES_USER='${POSTGRES_USER}'
export POSTGRES_PASSWORD='${POSTGRES_PASSWORD}'
export POSTGRES_HOST='${POSTGRES_HOST}'
export POSTGRES_PORT='${POSTGRES_PORT}'
export CLICKHOUSE_ENABLED='${CLICKHOUSE_ENABLED}'
export DUCKDB_ENABLED='${DUCKDB_ENABLED}'
export AUTO_SSL='${AUTO_SSL}'
export ENABLE_HTTPS='${ENABLE_HTTPS}'
export LETSENCRYPT_EMAIL='${LETSENCRYPT_EMAIL}'
export LETSENCRYPT_STAGING='${LETSENCRYPT_STAGING}'
export NODE_MAJOR='${NODE_MAJOR}'
export NPM_INSTALL_FLAGS='${NPM_INSTALL_FLAGS}'
export NPM_CONFIG_LEGACY_PEER_DEPS='${NPM_CONFIG_LEGACY_PEER_DEPS}'
export NPM_CONFIG_FORCE='${NPM_CONFIG_FORCE}'
test -f '${REMOTE_SCRIPT_PATH}' || { echo 'Missing remote manager script: ${REMOTE_SCRIPT_PATH}' >&2; exit 1; }
chmod +x '${REMOTE_SCRIPT_PATH}'
'${REMOTE_SCRIPT_PATH}' upgrade-server
EOF
)
  remote_run_as_app_user "$remote_script"
}

reset_remote() {
  header "Resetting remote deployment"
  ensure_remote_prereqs
  remote_exec "systemctl stop superset-web superset-worker superset-beat 2>/dev/null || true"
  if [[ "$REMOTE_USER" == "root" && "$REMOTE_SUDO_APP_USER" == "1" ]]; then
    remote_exec "rm -rf '${REMOTE_INSTALL_DIR}' && rm -f /etc/systemd/system/superset-web.service /etc/systemd/system/superset-worker.service /etc/systemd/system/superset-beat.service && systemctl daemon-reload || true"
  else
    remote_exec "rm -rf '${REMOTE_INSTALL_DIR}' || true"
  fi
  ok "Remote deployment reset"
}

status_remote() {
  header "Remote status"
  remote_exec "bash -lc 'systemctl --no-pager --full status superset-web superset-worker superset-beat nginx redis-server postgresql || true'"
}
restart_remote() { remote_exec "systemctl restart superset-web superset-worker superset-beat nginx redis-server postgresql || true"; }
start_remote() { remote_exec "systemctl start superset-web superset-worker superset-beat nginx redis-server postgresql || true"; }
stop_remote() { remote_exec "systemctl stop superset-web superset-worker superset-beat || true"; }
shell_remote() { ssh "${SSH_OPTS[@]}" "$(remote_login)"; }

# ------------------------------------------------------------------------------
# Server upgrade helper
# ------------------------------------------------------------------------------
upgrade_server() {
  check_not_root
  require_domain
  calc_autotune
  ensure_dirs
  generate_env_server
  generate_superset_config_server
  install_python_dependencies_server
  build_frontend_if_present_server
  initialize_superset_server
  restart_services_server
  show_status_server
}

# ------------------------------------------------------------------------------
# Usage
# ------------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage: ./superset-manager-v2.sh <command>

Local development:
  start                Start local backend
  stop                 Stop local backend
  restart              Restart local backend
  status               Show local backend status

  start-frontend       Start local frontend dev server
  stop-frontend        Stop local frontend dev server
  restart-frontend     Restart local frontend dev server
  status-frontend      Show local frontend status
  build-frontend       Build local frontend assets

  start-celery         Start local Celery worker + beat
  stop-celery          Stop local Celery worker + beat
  restart-celery       Restart local Celery worker + beat
  celery-status        Show local Celery status

  start-all            Start local backend + celery + frontend
  stop-all             Stop local stack
  restart-all          Restart local stack
  status-all           Show full local status

  install              Install local Python dependencies into venv
  db-upgrade           Run local superset db upgrade && init
  create-admin         Create/update local admin user
  cache                Clear local backend cache
  cache-frontend       Clear local frontend cache
  cache-all            Clear all local caches
  clear-logs           Clear local logs
  logs [type] [follow] Tail local logs
  health               Local health check

Server install on current machine:
  install-server       Full production install on current machine
  upgrade-server       Upgrade synced/current code on current machine
  start-server         Start server services
  stop-server          Stop server services
  restart-server       Restart server services
  status-server        Show server service status

Remote deployment:
  deploy-remote        Deploy remote using CODEBASE_SOURCE=local or CODEBASE_SOURCE=git
  upgrade-remote       Upgrade remote using CODEBASE_SOURCE=local or CODEBASE_SOURCE=git
  reset-remote         Remove remote install and systemd units
  status-remote        Show remote systemd service status
  start-remote         Start remote services
  stop-remote          Stop remote services
  restart-remote       Restart remote services
  shell-remote         Open remote shell

Important environment variables:
  DOMAIN=...                       Required for install-server/deploy-remote
  CODEBASE_SOURCE=local|git
  GIT_REPO_URL=...
  GIT_BRANCH=main
  GIT_REF=...                      Optional exact tag/commit/branch override
  REMOTE_HOST=62.171.147.64
  REMOTE_USER=root
  REMOTE_APP_USER=superset
  INSTALL_DIR=/opt/superset        # or /srv/apps/superset
  ADMIN_EMAIL=...
  ADMIN_PASSWORD=...
  LETSENCRYPT_EMAIL=...
  POSTGRES_PASSWORD=...
  NODE_MAJOR=18
  NPM_INSTALL_FLAGS='--legacy-peer-deps --force'

Examples:
  CODEBASE_SOURCE=local DOMAIN=supersets.vitalplatforms.com ADMIN_EMAIL=admin@vitalplatforms.com ADMIN_PASSWORD='StrongPass' ./superset-manager-v2.sh deploy-remote
  CODEBASE_SOURCE=git GIT_REPO_URL=https://github.com/HISP-Uganda/dhis2-superset.git GIT_BRANCH=martbase DOMAIN=supersets.vitalplatforms.com ./superset-manager-v2.sh deploy-remote
  CODEBASE_SOURCE=git GIT_REPO_URL=https://github.com/HISP-Uganda/dhis2-superset.git GIT_REF=martbase DOMAIN=supersets.vitalplatforms.com ./superset-manager-v2.sh upgrade-remote
  ./superset-manager-v2.sh start-all
EOF
}

health_check_local() {
  header "Health Check"
  validate_project
  [[ -d "$VENV_DIR" ]] && ok "Virtual environment exists" || warn "Virtual environment missing"
  [[ -f "$SUPERSET_CONFIG_FILE" ]] && ok "Config file exists" || warn "Config file missing"
  if [[ -f "$SUPERSET_CONFIG_FILE" ]]; then
    python3 -m py_compile "$SUPERSET_CONFIG_FILE" >/dev/null 2>&1 && ok "Config syntax OK" || err "Config syntax invalid"
  fi
  backend_running && ok "Backend process running" || warn "Backend not running"
  frontend_running && ok "Frontend process running" || warn "Frontend not running"
  redis_running && ok "Redis running" || warn "Redis not running"
}

# ------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------
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

    start-celery) restart_celery ;;
    stop-celery) stop_celery_beat; stop_celery_worker ;;
    restart-celery) restart_celery ;;
    celery-status) celery_status ;;

    start-all) start_all_local ;;
    stop-all) stop_all_local ;;
    restart-all) restart_all_local ;;
    status-all) status_all_local ;;

    install) install_deps_local ;;
    db-upgrade) db_upgrade_local ;;
    create-admin) create_admin_local ;;
    cache) clear_backend_cache ;;
    cache-frontend) clear_frontend_cache ;;
    cache-all) clear_all_cache ;;
    clear-logs) clear_logs ;;
    logs) view_logs "${2:-backend}" "${3:-tail}" ;;
    health) health_check_local ;;

    install-server) install_server ;;
    upgrade-server) upgrade_server ;;
    start-server) start_services_server ;;
    stop-server) stop_services_server ;;
    restart-server) restart_services_server ;;
    status-server) calc_autotune; show_status_server ;;

    deploy-remote) deploy_remote ;;
    upgrade-remote) upgrade_remote ;;
    reset-remote) reset_remote ;;
    status-remote) status_remote ;;
    start-remote) start_remote ;;
    stop-remote) stop_remote ;;
    restart-remote) restart_remote ;;
    shell-remote) shell_remote ;;

    help|--help|-h) usage ;;
    *) err "Unknown command: ${1:-}"; usage; exit 1 ;;
  esac
}
main "$@"

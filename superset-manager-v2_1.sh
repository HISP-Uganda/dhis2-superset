#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# Unified Superset Platform Manager
# - Local development / management (backend, frontend, celery, redis, clickhouse)
# - Local production/server install (auto-tuned)
# - Remote deployment by syncing the CURRENT local codebase to a remote server
# - Remote upgrade/reset/status helpers
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

# ------------------------------------------------------------------------------
# Core config
# ------------------------------------------------------------------------------
APP_NAME="${APP_NAME:-dhis2-superset}"
PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/$APP_NAME}"
REMOTE_INSTALL_DIR="${REMOTE_INSTALL_DIR:-/opt/superset}"

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

CODEBASE_SOURCE="${CODEBASE_SOURCE:-local}"
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

CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-127.0.0.1}"
CLICKHOUSE_PORT="${CLICKHOUSE_PORT:-8123}"
CLICKHOUSE_NATIVE_PORT="${CLICKHOUSE_NATIVE_PORT:-9000}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-dhis2_user}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-$(openssl rand -hex 16 2>/dev/null || echo change_me_clickhouse)}"
CLICKHOUSE_STAGING_DATABASE="${CLICKHOUSE_STAGING_DATABASE:-dhis2_staging}"
CLICKHOUSE_SERVING_DATABASE="${CLICKHOUSE_SERVING_DATABASE:-dhis2_serving}"
CLICKHOUSE_CONTROL_DATABASE="${CLICKHOUSE_CONTROL_DATABASE:-dhis2_control}"

# ------------------------------------------------------------------------------
# Local logs / pid files
# ------------------------------------------------------------------------------
BACKEND_LOG_FILE="${BACKEND_LOG_FILE:-$LOG_DIR/superset_backend.log}"
FRONTEND_LOG_FILE="${FRONTEND_LOG_FILE:-$LOG_DIR/superset_frontend.log}"
REDIS_LOG_FILE="${REDIS_LOG_FILE:-$LOG_DIR/redis.log}"
CELERY_WORKER_LOG_FILE="${CELERY_WORKER_LOG_FILE:-$LOG_DIR/celery_worker.log}"
CELERY_BEAT_LOG_FILE="${CELERY_BEAT_LOG_FILE:-$LOG_DIR/celery_beat.log}"
CLICKHOUSE_LOG_FILE="${CLICKHOUSE_LOG_FILE:-$LOG_DIR/clickhouse.log}"
CLICKHOUSE_ERROR_LOG_FILE="${CLICKHOUSE_ERROR_LOG_FILE:-$LOG_DIR/clickhouse-error.log}"
CLICKHOUSE_STDOUT_LOG_FILE="${CLICKHOUSE_STDOUT_LOG_FILE:-$LOG_DIR/clickhouse-stdout.log}"

BACKEND_PID_FILE="${BACKEND_PID_FILE:-$RUN_DIR/superset_backend.pid}"
FRONTEND_PID_FILE="${FRONTEND_PID_FILE:-$RUN_DIR/superset_frontend.pid}"
CELERY_WORKER_PID_FILE="${CELERY_WORKER_PID_FILE:-$RUN_DIR/celery_worker.pid}"
CELERY_BEAT_PID_FILE="${CELERY_BEAT_PID_FILE:-$RUN_DIR/celery_beat.pid}"
CLICKHOUSE_PID_FILE="${CLICKHOUSE_PID_FILE:-$RUN_DIR/clickhouse.pid}"

CLICKHOUSE_DATA_DIR="${CLICKHOUSE_DATA_DIR:-$DATA_DIR/.clickhouse}"
CELERY_BEAT_SCHEDULE="${CELERY_BEAT_SCHEDULE:-$RUN_DIR/celerybeat-schedule}"
FRONTEND_DISABLE_TYPE_CHECK="${FRONTEND_DISABLE_TYPE_CHECK:-1}"
BACKEND_ENABLE_RELOAD="${BACKEND_ENABLE_RELOAD:-0}"
BACKEND_ENABLE_DEBUGGER="${BACKEND_ENABLE_DEBUGGER:-0}"
CELERY_CONCURRENCY="${CELERY_CONCURRENCY:-2}"

NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/${APP_NAME}}"

# ------------------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------------------
ensure_dirs() { mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR" "$RUN_DIR"; }
require_dir() { [[ -d "$1" ]] || die "Missing directory: $1"; }
require_file() { [[ -f "$1" ]] || die "Missing file: $1"; }
require_cmd() { command_exists "$1" || die "Missing command: $1"; }
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
  for ((i=1; i<=max_tries; i++)); do
    curl -fsS "$url" >/dev/null 2>&1 && return 0
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
    print(f"Failed to exec {' '.join(cmd)}: {ex}", file=sys.stderr)
    time.sleep(1)
    raise
PY
  local pid=""
  for _ in {1..20}; do
    [[ -f "$pid_file" ]] && pid="$(cat "$pid_file" 2>/dev/null || true)"
    [[ -n "${pid:-}" ]] && break
    sleep 0.25
  done
  [[ -n "${pid:-}" ]] || die "Failed to capture detached process PID"
  echo "$pid"
}

venv_activate() {
  require_file "$VENV_DIR/bin/activate"
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
  awk '/MemTotal/ { printf "%d", $2/1024 }' /proc/meminfo 2>/dev/null || echo 4096
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
  else
    GUNICORN_WORKERS=4; GUNICORN_THREADS=8; CELERY_CONCURRENCY=4
  fi
  PG_SHARED_BUFFERS_MB=$(( TOTAL_MEM_MB / 4 ))
  PG_EFFECTIVE_CACHE_MB=$(( TOTAL_MEM_MB * 70 / 100 ))
  PG_MAINTENANCE_MB=256
  PG_WORK_MEM_MB=16
  REDIS_MAXMEMORY_MB=512
  NGINX_PROXY_BUFFERS="16 16k"; NGINX_PROXY_BUFFER_SIZE="16k"; NGINX_PROXY_BUSY="64k"
  GUNICORN_TIMEOUT=300; GUNICORN_KEEPALIVE=5; CACHE_DEFAULT_TIMEOUT=300; DATA_CACHE_TIMEOUT=300; FILTER_STATE_CACHE_TIMEOUT=86400; EXPLORE_FORM_DATA_CACHE_TIMEOUT=86400; SQLLAB_ASYNC_TIME_LIMIT_SEC=21600; WORKER_PREFETCH_MULTIPLIER=1
}

# ------------------------------------------------------------------------------
# Service Status Helpers
# ------------------------------------------------------------------------------
backend_running() {
  local pid; pid="$(read_pid_file "$BACKEND_PID_FILE" || true)"
  { [[ -n "${pid:-}" ]] && pid_is_running "$pid"; } || port_is_in_use "$BACKEND_PORT"
}
frontend_running() {
  local pid; pid="$(read_pid_file "$FRONTEND_PID_FILE" || true)"
  { [[ -n "${pid:-}" ]] && pid_is_running "$pid"; } || port_is_in_use "$FRONTEND_PORT"
}
celery_worker_running() { local pid; pid="$(read_pid_file "$CELERY_WORKER_PID_FILE" || true)"; [[ -n "${pid:-}" ]] && pid_is_running "$pid"; }
celery_beat_running() { local pid; pid="$(read_pid_file "$CELERY_BEAT_PID_FILE" || true)"; [[ -n "${pid:-}" ]] && pid_is_running "$pid"; }
redis_running() { command_exists redis-cli && redis-cli ping >/dev/null 2>&1; }

# ------------------------------------------------------------------------------
# Local Management
# ------------------------------------------------------------------------------
start_redis() { header "Starting Redis"; if redis_running; then ok "Redis ok"; else redis-server --daemonize yes --logfile "$REDIS_LOG_FILE"; sleep 1; fi; }
start_backend() {
  header "Starting Backend"; ensure_dirs; start_redis; venv_activate; set_backend_env;
  local cmd=("$VENV_DIR/bin/gunicorn" --bind "$BACKEND_HOST:$BACKEND_PORT" --workers 2 --worker-class gthread "superset.app:create_app()");
  spawn_detached "$BACKEND_PID_FILE" "$BACKEND_LOG_FILE" "${cmd[@]}"; ok "Backend started";
}
stop_backend() { header "Stopping Backend"; kill_pid_file "$BACKEND_PID_FILE" "Backend"; kill_port "$BACKEND_PORT"; }
start_frontend() {
  header "Starting Frontend"; ensure_dirs;
  local cmd; cmd="$(frontend_dev_command)"; cd "$FRONTEND_DIR"; [[ -d "node_modules" ]] || npm install;
  spawn_detached "$FRONTEND_PID_FILE" "$FRONTEND_LOG_FILE" bash -c "$cmd"; ok "Frontend started";
}
stop_frontend() { kill_pid_file "$FRONTEND_PID_FILE" "Frontend"; kill_port "$FRONTEND_PORT"; }
start_celery() {
  header "Starting Celery"; venv_activate; set_backend_env;
  spawn_detached "$CELERY_WORKER_PID_FILE" "$CELERY_WORKER_LOG_FILE" "$VENV_DIR/bin/celery" --app=superset.tasks.celery_app:app worker;
  spawn_detached "$CELERY_BEAT_PID_FILE" "$CELERY_BEAT_LOG_FILE" "$VENV_DIR/bin/celery" --app=superset.tasks.celery_app:app beat;
}
stop_celery() { kill_pid_file "$CELERY_WORKER_PID_FILE" "Worker"; kill_pid_file "$CELERY_BEAT_PID_FILE" "Beat"; }

# ------------------------------------------------------------------------------
# Production / Server Install Logic
# ------------------------------------------------------------------------------
install_system_packages() {
  info "Installing Packages"; sudo apt-get update; sudo apt-get install -y curl git rsync jq ufw python3-venv redis-server nginx postgresql;
}
setup_venv_server() { python3 -m venv "$VENV_DIR"; venv_activate; pip install --upgrade pip wheel; }
install_python_deps() { venv_activate; pip install apache-superset psycopg2-binary redis celery gunicorn clickhouse-connect; }

generate_env_server() {
  info "Writing .env"; cat > "$ENV_FILE" <<EOF
DOMAIN=${DOMAIN}
SUPERSET_SECRET_KEY=${SUPERSET_SECRET_KEY}
DATABASE_URL=postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}
REDIS_HOST=${REDIS_HOST}
CELERY_BROKER_URL=redis://${REDIS_HOST}:${REDIS_PORT}/0
EOF
}

generate_superset_config() {
  info "Writing config"; cat > "$SUPERSET_CONFIG_FILE" <<'PY'
import os
SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL")
SECRET_KEY = os.getenv("SUPERSET_SECRET_KEY")
class CeleryConfig:
    broker_url = os.getenv("CELERY_BROKER_URL")
CELERY_CONFIG = CeleryConfig
PY
}

create_systemd_units() {
  info "Creating Services";
  sudo tee /etc/systemd/system/superset-web.service >/dev/null <<EOF
[Unit]
Description=Superset Web
After=network.target

[Service]
User=${USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${VENV_DIR}/bin/gunicorn -w 4 -k gthread -b ${SUPERSET_HOST}:${SUPERSET_PORT} 'superset.app:create_app()'
Restart=always

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload; sudo systemctl enable superset-web;
}

install_server() {
  check_not_root; require_domain; calc_autotune; ensure_dirs;
  install_system_packages; setup_venv_server; install_python_deps;
  generate_env_server; generate_superset_config; create_systemd_units;
  ok "Server installation finished";
}

# ------------------------------------------------------------------------------
# Remote Deployment Helpers
# ------------------------------------------------------------------------------
remote_exec() { ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" "$@"; }
push_self() { scp "${SCP_OPTS[@]}" "$0" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_SCRIPT_PATH}"; }

rsync_code() {
  rsync -az --delete -e "$RSYNC_SSH" --exclude 'venv' --exclude 'node_modules' "$PROJECT_DIR/" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_INSTALL_DIR}/";
}

deploy_remote() {
  header "Deploying to ${REMOTE_HOST}"; require_domain;
  remote_exec "mkdir -p ${REMOTE_INSTALL_DIR}"; rsync_code; push_self;
  remote_exec "chmod +x ${REMOTE_SCRIPT_PATH} && ${REMOTE_SCRIPT_PATH} install-server";
}

# ------------------------------------------------------------------------------
# Main Entry Point
# ------------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage: ./platform-manager.sh <command>
Local: start | stop | restart | start-frontend | stop-frontend | start-celery | stop-celery
Server: install-server | upgrade-server
Remote: deploy-remote | status-remote | shell-remote
EOF
}

main() {
  case "${1:-help}" in
    start) start_backend ;;
    stop) stop_backend ;;
    restart) stop_backend; sleep 1; start_backend ;;
    start-frontend) start_frontend ;;
    stop-frontend) stop_frontend ;;
    start-celery) start_celery ;;
    stop-celery) stop_celery ;;
    install-server) install_server ;;
    deploy-remote) deploy_remote ;;
    status-remote) remote_exec "systemctl status superset-web" ;;
    shell-remote) ssh "${SSH_OPTS[@]}" "${REMOTE_USER}@${REMOTE_HOST}" ;;
    help|--help|-h) usage ;;
    *) err "Unknown command: ${1:-}"; usage; exit 1 ;;
  esac
}

main "$@"

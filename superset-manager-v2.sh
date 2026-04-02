#!/usr/bin/env bash
# v15.35 tuned for martbase branch: ClickHouse default, dynamic plugins off, Celery Beat schedule fixed in Python, stronger frontend memory tuning
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

use_local_runtime_layout() {
  INSTALL_DIR="$PROJECT_DIR"
  VENV_DIR="$PROJECT_DIR/venv"
  CONFIG_DIR="$PROJECT_DIR/config"
  DATA_DIR="$PROJECT_DIR/data"
  LOG_DIR="$PROJECT_DIR/logs"
  RUN_DIR="$PROJECT_DIR/.run"
  ENV_FILE="$PROJECT_DIR/.env"
  SUPERSET_CONFIG_FILE="$CONFIG_DIR/superset_config.py"
  GUNICORN_LOG="$LOG_DIR/gunicorn.log"
  GUNICORN_PID_FILE="$RUN_DIR/gunicorn.pid"
  CELERY_WORKER_LOG="$LOG_DIR/celery-worker.log"
  CELERY_BEAT_LOG="$LOG_DIR/celery-beat.log"
  BACKEND_LOG_FILE="$LOG_DIR/superset_backend.log"
  FRONTEND_LOG_FILE="$LOG_DIR/superset_frontend.log"
  REDIS_LOG_FILE="$LOG_DIR/redis.log"
  CELERY_WORKER_LOG_FILE="$LOG_DIR/celery_worker.log"
  CELERY_BEAT_LOG_FILE="$LOG_DIR/celery_beat.log"
  BACKEND_PID_FILE="$RUN_DIR/superset_backend.pid"
  FRONTEND_PID_FILE="$RUN_DIR/superset_frontend.pid"
  CELERY_WORKER_PID_FILE="$RUN_DIR/celery_worker.pid"
  CELERY_BEAT_PID_FILE="$RUN_DIR/celery_beat.pid"
  CELERY_BEAT_SCHEDULE="$RUN_DIR/celerybeat-schedule"
  FRONTEND_BUILD_LOG_FILE="$LOG_DIR/frontend-build.log"
  FRONTEND_DEP_FINGERPRINT_FILE="$RUN_DIR/frontend-deps.sha256"
}

# ------------------------------------------------------------------------------
# Network / domain / app settings
# ------------------------------------------------------------------------------

# Core runtime defaults
APP_NAME="${APP_NAME:-superset}"
INSTALL_DIR="${INSTALL_DIR:-/srv/apps/superset}"
CONFIG_DIR="${CONFIG_DIR:-$INSTALL_DIR/config}"
LOG_DIR="${LOG_DIR:-$INSTALL_DIR/logs}"
RUN_DIR="${RUN_DIR:-$INSTALL_DIR/run}"
DATA_DIR="${DATA_DIR:-$INSTALL_DIR/data}"
ENV_FILE="${ENV_FILE:-$INSTALL_DIR/.env}"
SUPERSET_CONFIG_FILE="${SUPERSET_CONFIG_FILE:-$CONFIG_DIR/superset_config.py}"
SUPERSET_PORT="${SUPERSET_PORT:-8088}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/${APP_NAME}}"
GUNICORN_LOG="${GUNICORN_LOG:-$LOG_DIR/gunicorn.log}"
GUNICORN_PID_FILE="${GUNICORN_PID_FILE:-$RUN_DIR/gunicorn.pid}"
CELERY_WORKER_LOG="${CELERY_WORKER_LOG:-$LOG_DIR/celery-worker.log}"
CELERY_BEAT_LOG="${CELERY_BEAT_LOG:-$LOG_DIR/celery-beat.log}"

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
FORCE_ROTATE_SECRETS="${FORCE_ROTATE_SECRETS:-0}"
RESET_ENCRYPTED_DATABASE_SECRETS_ON_KEY_MISMATCH="${RESET_ENCRYPTED_DATABASE_SECRETS_ON_KEY_MISMATCH:-1}"

BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8088}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-9001}"
LOCAL_FRONTEND_DEV_SERVER="${LOCAL_FRONTEND_DEV_SERVER:-0}"

# ------------------------------------------------------------------------------
# Remote deployment config
# ------------------------------------------------------------------------------
REMOTE_HOST="${REMOTE_HOST:-62.171.147.64}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_PORT="${REMOTE_PORT:-22}"
REMOTE_APP_USER="${REMOTE_APP_USER:-superset}"
REMOTE_SUDO_APP_USER="${REMOTE_SUDO_APP_USER:-1}"
REMOTE_RUN_AS_APP_USER="${REMOTE_RUN_AS_APP_USER:-0}"
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
DUCKDB_ENABLED="${DUCKDB_ENABLED:-0}"
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
# ClickHouse / DHIS2 serving engine
# ------------------------------------------------------------------------------
DHIS2_SERVING_ENGINE="${DHIS2_SERVING_ENGINE:-clickhouse}"
CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-127.0.0.1}"
CLICKHOUSE_HTTP_HOST="${CLICKHOUSE_HTTP_HOST:-127.0.0.1}"
CLICKHOUSE_HTTP_PORT="${CLICKHOUSE_HTTP_PORT:-8123}"
CLICKHOUSE_NATIVE_PORT="${CLICKHOUSE_NATIVE_PORT:-9000}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-dhis2_user}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-$(openssl rand -hex 18 2>/dev/null || echo clickhouse_change_me)}"
CLICKHOUSE_STAGING_DATABASE="${CLICKHOUSE_STAGING_DATABASE:-dhis2_staging}"
CLICKHOUSE_SERVING_DATABASE="${CLICKHOUSE_SERVING_DATABASE:-dhis2_serving}"
CLICKHOUSE_CONTROL_DATABASE="${CLICKHOUSE_CONTROL_DATABASE:-dhis2_control}"
CLICKHOUSE_SUPERSET_DB_NAME="${CLICKHOUSE_SUPERSET_DB_NAME:-DHIS2 ClickHouse}"
CLICKHOUSE_PYTHON_PACKAGE="${CLICKHOUSE_PYTHON_PACKAGE:-clickhouse-connect}"

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

# Frontend compatibility and quiet install settings
NODE_MAJOR="${NODE_MAJOR:-20}"
NPM_VERSION="${NPM_VERSION:-10.8.2}"
NPM_INSTALL_FLAGS="${NPM_INSTALL_FLAGS:---legacy-peer-deps --no-audit --no-fund --progress=false --loglevel=error}"
NPM_CONFIG_LEGACY_PEER_DEPS="${NPM_CONFIG_LEGACY_PEER_DEPS:-true}"
NPM_CONFIG_AUDIT="${NPM_CONFIG_AUDIT:-false}"
NPM_CONFIG_FUND="${NPM_CONFIG_FUND:-false}"
NPM_CONFIG_PROGRESS="${NPM_CONFIG_PROGRESS:-false}"
NPM_CONFIG_UPDATE_NOTIFIER="${NPM_CONFIG_UPDATE_NOTIFIER:-false}"
NPM_CONFIG_LOGLEVEL="${NPM_CONFIG_LOGLEVEL:-error}"
FRONTEND_PATCH_TSCONFIGS="${FRONTEND_PATCH_TSCONFIGS:-1}"
FRONTEND_BUILD_STRATEGY="${FRONTEND_BUILD_STRATEGY:-build}"
TSC_COMPILE_ON_ERROR="${TSC_COMPILE_ON_ERROR:-true}"
FRONTEND_FORCE_RETRY_ON_TS_ERRORS="${FRONTEND_FORCE_RETRY_ON_TS_ERRORS:-1}"
FRONTEND_BUILD_MAX_RETRIES="${FRONTEND_BUILD_MAX_RETRIES:-2}"
FRONTEND_REWRITE_PLUGIN_TSCONFIGS="${FRONTEND_REWRITE_PLUGIN_TSCONFIGS:-1}"
FRONTEND_VERBOSE_LOGS="${FRONTEND_VERBOSE_LOGS:-1}"
FRONTEND_HEARTBEAT_SECONDS="${FRONTEND_HEARTBEAT_SECONDS:-30}"
FRONTEND_HEARTBEAT_TAIL_LINES="${FRONTEND_HEARTBEAT_TAIL_LINES:-3}"
FRONTEND_HEARTBEAT_SHOW_PS="${FRONTEND_HEARTBEAT_SHOW_PS:-1}"
FRONTEND_BUILD_LOG_FILE="${FRONTEND_BUILD_LOG_FILE:-$LOG_DIR/frontend-build.log}"
FRONTEND_DISABLE_SOURCEMAPS="${FRONTEND_DISABLE_SOURCEMAPS:-1}"
FRONTEND_CLEAN="${FRONTEND_CLEAN:-0}"
FRONTEND_TIMEOUT_MINUTES="${FRONTEND_TIMEOUT_MINUTES:-180}"
FRONTEND_TYPECHECK="${FRONTEND_TYPECHECK:-0}"
FRONTEND_NODE_OLD_SPACE_SIZE_MB="${FRONTEND_NODE_OLD_SPACE_SIZE_MB:-auto}"
FRONTEND_FORK_TS_MEMORY_LIMIT_MB="${FRONTEND_FORK_TS_MEMORY_LIMIT_MB:-auto}"
FRONTEND_SKIP_IF_ASSETS_EXIST="${FRONTEND_SKIP_IF_ASSETS_EXIST:-1}"
FRONTEND_LOG_TAIL_LINES="${FRONTEND_LOG_TAIL_LINES:-200}"
FRONTEND_DEP_FINGERPRINT_FILE="${FRONTEND_DEP_FINGERPRINT_FILE:-$RUN_DIR/frontend-deps.sha256}"
WEBPACK_VERBOSE_ARGS="${WEBPACK_VERBOSE_ARGS:-}"
NPM_INSTALL_VERBOSE="${NPM_INSTALL_VERBOSE:-0}"

# ------------------------------------------------------------------------------
# Common helpers
# ------------------------------------------------------------------------------
ensure_dirs() { mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR" "$RUN_DIR"; }
check_not_root() {
  if [[ ${EUID} -eq 0 ]]; then
    warn "Running as root; privileged deployment mode enabled"
  fi
}

run_privileged() {
  if [[ ${EUID} -eq 0 ]]; then
    bash -lc "$*"
  elif command -v sudo >/dev/null 2>&1; then
    sudo bash -lc "$*"
  else
    die "Privileged operation required but sudo/root is unavailable: $*"
  fi
}

require_docollect_service_status_server() {
  header "Collecting service status"

  local gunicorn_log="${GUNICORN_LOG:-${LOG_DIR:-${INSTALL_DIR:-/srv/apps/superset}/logs}/gunicorn.log}"
  local celery_worker_log="${CELERY_WORKER_LOG:-${LOG_DIR:-${INSTALL_DIR:-/srv/apps/superset}/logs}/celery-worker.log}"
  local celery_beat_log="${CELERY_BEAT_LOG:-${LOG_DIR:-${INSTALL_DIR:-/srv/apps/superset}/logs}/celery-beat.log}"

  info "Collecting service status"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --no-pager --full status nginx 2>/dev/null || true
    systemctl --no-pager --full status postgresql 2>/dev/null || true
    systemctl --no-pager --full status redis-server 2>/dev/null || true
    systemctl --no-pager --full status superset-web 2>/dev/null || true
    systemctl --no-pager --full status superset-worker 2>/dev/null || true
    systemctl --no-pager --full status superset-beat 2>/dev/null || true
  fi

  [[ -f "$gunicorn_log" ]] && { echo; echo "--- gunicorn log tail ---"; tail -n 60 "$gunicorn_log" || true; }
  [[ -f "$celery_worker_log" ]] && { echo; echo "--- celery worker log tail ---"; tail -n 60 "$celery_worker_log" || true; }
  [[ -f "$celery_beat_log" ]] && { echo; echo "--- celery beat log tail ---"; tail -n 60 "$celery_beat_log" || true; }

  ok "Collecting service status completed"
}


require_domain() {
  if [[ -z "${DOMAIN:-}" ]]; then
    echo "[ERROR] DOMAIN is required" >&2
    exit 1
  fi
}

main() { [[ -n "$DOMAIN" ]] || die "DOMAIN is required. Example: DOMAIN=supersets.vitalplatforms.com"; }

source_runtime_env() {
  [[ -f "$ENV_FILE" ]] || die "Missing runtime environment file: $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE" || die "Failed to source runtime environment file: $ENV_FILE"
  set +a
  export SUPERSET_CONFIG_PATH="$SUPERSET_CONFIG_FILE"
  export FLASK_APP=superset
}


read_pid_file() { [[ -f "$1" ]] && cat "$1"; }
pid_is_running() { [[ -n "${1:-}" ]] && ps -p "$1" >/dev/null 2>&1; }
port_is_in_use() { lsof -tiTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

kill_process_tree() {
  local pid="$1"
  [[ -n "${pid:-}" ]] || return 0
  local child
  while IFS= read -r child; do
    [[ -n "${child:-}" ]] || continue
    kill_process_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)
  kill -9 "$pid" 2>/dev/null || true
}


run_step() {
  local label="$1"
  shift
  header "$label"
  local started_at ended_at rc=0
  started_at="$(date +%s)"
  "$@" || rc=$?
  ended_at="$(date +%s)"
  if [[ "$rc" -eq 0 ]]; then
    ok "$label completed in $((ended_at - started_at))s"
  else
    err "$label failed after $((ended_at - started_at))s"
    return "$rc"
  fi
}


frontend_dep_fingerprint() {
  local dir="$1"
  (
    cd "$dir"
    if [[ -f package-lock.json ]]; then
      cat package.json package-lock.json 2>/dev/null | sha256sum | awk '{print $1}'
    else
      cat package.json 2>/dev/null | sha256sum | awk '{print $1}'
    fi
  )
}


frontend_node_modules_ready() {
  local dir="$1"
  [[ -d "$dir/node_modules" ]] || return 1
  frontend_required_bins_ready "$dir"
}



frontend_apply_common_env() {
  export npm_config_legacy_peer_deps="${NPM_CONFIG_LEGACY_PEER_DEPS}"
  export npm_config_audit="${NPM_CONFIG_AUDIT}"
  export npm_config_fund="${NPM_CONFIG_FUND}"
  export npm_config_progress="${NPM_CONFIG_PROGRESS}"
  export npm_config_update_notifier="${NPM_CONFIG_UPDATE_NOTIFIER}"
  export npm_config_loglevel="${NPM_CONFIG_LOGLEVEL}"
  export npm_config_include=dev
  export npm_config_production=false
  export DISABLE_TYPE_CHECK="${FRONTEND_DISABLE_TYPE_CHECK}"
  export TSC_COMPILE_ON_ERROR="${TSC_COMPILE_ON_ERROR}"
  export PUPPETEER_SKIP_DOWNLOAD=1
  export CI=1
  export FRONTEND_NODE_OPTIONS="--max_old_space_size=${FRONTEND_NODE_OLD_SPACE_SIZE_EFFECTIVE_MB:-14336}"
  export NODE_OPTIONS="${FRONTEND_NODE_OPTIONS}${NODE_OPTIONS:+ ${NODE_OPTIONS}}"
  if [[ "${FRONTEND_DISABLE_SOURCEMAPS:-1}" == "1" ]]; then
    export GENERATE_SOURCEMAP=false
  fi
  export DISABLE_ESLINT_PLUGIN=true
  unset NODE_ENV || true
  unset BABEL_ENV || true
}

frontend_cleanup_dirs() {
  local dir="$1"
  rm -rf \
    "$dir/node_modules" \
    "$dir/.cache" \
    "$dir/.temp_cache" \
    "$dir/node_modules/.cache" \
    /tmp/webpack-* \
    /tmp/.webpack-* 2>/dev/null || true
}

run_frontend_logged_command() {
  local log_file="$1"
  local heartbeat_seconds="$2"
  local timeout_minutes="$3"
  shift 3
  local runner_pid=""
  local rc=0
  local elapsed=0
  local last_size=0
  local current_size=0
  local delta_size=0
  local sid=""
  local hb_tail_lines="${FRONTEND_HEARTBEAT_TAIL_LINES:-3}"

  mkdir -p "$(dirname "$log_file")"
  : > "$log_file"
  printf "===== frontend command start %s =====
" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log_file"

  (
    set -o pipefail
    if command -v timeout >/dev/null 2>&1; then
      if command -v stdbuf >/dev/null 2>&1; then
        timeout --foreground "${timeout_minutes}m" stdbuf -oL -eL "$@" 2>&1 | tee -a "$log_file"
      else
        timeout --foreground "${timeout_minutes}m" "$@" 2>&1 | tee -a "$log_file"
      fi
    else
      if command -v stdbuf >/dev/null 2>&1; then
        stdbuf -oL -eL "$@" 2>&1 | tee -a "$log_file"
      else
        "$@" 2>&1 | tee -a "$log_file"
      fi
    fi
  ) &
  runner_pid=$!

  sid="$(ps -o sid= -p "$runner_pid" 2>/dev/null | tr -d ' ' || true)"
  [[ -n "${sid:-}" ]] || sid="$runner_pid"

  while kill -0 "$runner_pid" 2>/dev/null; do
    sleep 1
    elapsed=$((elapsed + 1))
    if (( heartbeat_seconds > 0 )) && (( elapsed % heartbeat_seconds == 0 )); then
      current_size="$(wc -c < "$log_file" 2>/dev/null || echo 0)"
      delta_size=$(( current_size - last_size ))
      last_size="$current_size"

      {
        echo "[INFO] Frontend build heartbeat $(date -u +%Y-%m-%dT%H:%M:%SZ); elapsed=${elapsed}s; log_size=${current_size}B; delta=${delta_size}B; log: $log_file"
        if [[ "${FRONTEND_HEARTBEAT_SHOW_PS:-1}" == "1" ]]; then
          echo "[INFO] Frontend process snapshot:"
          ps -o pid,ppid,etime,%cpu,%mem,cmd --forest -g "$sid" 2>/dev/null | sed 's/^/[INFO]   /' || true
        fi
        echo "[INFO] Frontend recent log tail:"
        tail -n "$hb_tail_lines" "$log_file" 2>/dev/null | sed 's/^/[INFO]   /' || true
      } | tee -a "$log_file"
    fi
  done

  wait "$runner_pid" || rc=$?
  if [[ "$rc" -eq 124 ]]; then
    echo "[ERROR] Frontend command timed out after ${timeout_minutes} minute(s); log: $log_file" | tee -a "$log_file" >&2
  elif [[ "$rc" -eq 0 ]]; then
    echo "[OK] Frontend command finished successfully; log: $log_file" | tee -a "$log_file"
  else
    echo "[ERROR] Frontend command failed with exit code $rc; log: $log_file" | tee -a "$log_file" >&2
  fi
  return "$rc"
}

frontend_run_step() {
  local desc="$1"
  local log_file="$2"
  local heartbeat="$3"
  local timeout_minutes="$4"
  shift 4
  info "[frontend] START ${desc}"
  local rc=0
  run_frontend_logged_command "$log_file" "$heartbeat" "$timeout_minutes" "$@" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    warn "[frontend] FAILED ${desc}"
    echo "----- frontend log tail (${FRONTEND_LOG_TAIL_LINES:-200} lines) -----"
    tail -n "${FRONTEND_LOG_TAIL_LINES:-200}" "$log_file" || true
    return "$rc"
  fi
  info "[frontend] END ${desc}"
  return 0
}


frontend_required_bins_ready() {
  local dir="$1"
  [[ -d "$dir/node_modules/webpack" ]] || return 1
  if [[ -f "$dir/node_modules/webpack-cli/bin/cli.js" ]]; then
    return 0
  fi
  if [[ -f "$dir/node_modules/webpack-cli/lib/bootstrap.js" ]]; then
    return 0
  fi
  if [[ -f "$dir/node_modules/webpack/bin/webpack.js" ]]; then
    return 0
  fi
  return 1
}

frontend_ensure_required_bins() {
  local dir="$1"
  local log_file="$2"
  local heartbeat="$3"
  local timeout_minutes="$4"
  local fingerprint_file="$5"

  if frontend_required_bins_ready "$dir"; then
    return 0
  fi

  warn "[frontend] required frontend packages are missing (webpack/webpack-cli); repairing frontend dependencies"
  rm -rf "$dir/node_modules/.cache" "$dir/.cache" "$dir/.temp_cache" 2>/dev/null || true

  if [[ -f "$dir/package-lock.json" ]]; then
    if ! frontend_run_step "npm ci repair" "$log_file" "$heartbeat" "$timeout_minutes" bash -lc "cd '$dir' && env -u NODE_ENV -u BABEL_ENV npm ci --include=dev --production=false ${NPM_INSTALL_FLAGS}"; then
      warn "[frontend] npm ci repair failed; falling back to npm install"
      frontend_run_step "npm install repair" "$log_file" "$heartbeat" "$timeout_minutes" bash -lc "cd '$dir' && env -u NODE_ENV -u BABEL_ENV npm install --include=dev --production=false ${NPM_INSTALL_FLAGS}" || return $?
    fi
  else
    frontend_run_step "npm install repair" "$log_file" "$heartbeat" "$timeout_minutes" bash -lc "cd '$dir' && env -u NODE_ENV -u BABEL_ENV npm install --include=dev --production=false ${NPM_INSTALL_FLAGS}" || return $?
  fi

  if ! frontend_required_bins_ready "$dir"; then
    warn "[frontend] installing explicit frontend build dependencies (webpack, webpack-cli, cross-env)"
    frontend_run_step "npm install explicit build deps" "$log_file" "$heartbeat" "$timeout_minutes" bash -lc "cd '$dir' && env -u NODE_ENV -u BABEL_ENV npm install -D --no-save --include=dev --production=false --legacy-peer-deps webpack webpack-cli cross-env" || return $?
  fi

  if ! frontend_required_bins_ready "$dir"; then
    err "[frontend] dependency repair finished but required binaries are still missing"
    return 127
  fi

  local current_fingerprint=""
  current_fingerprint="$(frontend_dep_fingerprint "$dir")"
  [[ -n "$current_fingerprint" ]] && printf '%s
' "$current_fingerprint" > "$fingerprint_file"
  ok "[frontend] required frontend binaries verified"
  return 0
}

frontend_install_deps_if_needed() {
  local dir="$1"
  local log_file="$2"
  local heartbeat="$3"
  local timeout_minutes="$4"
  local fingerprint_file="$5"

  mkdir -p "$(dirname "$fingerprint_file")"

  if [[ "${FRONTEND_CLEAN:-0}" == "1" ]]; then
    info "[frontend] FRONTEND_CLEAN=1; clearing node_modules and webpack caches"
    frontend_cleanup_dirs "$dir"
    rm -f "$fingerprint_file"
  fi

  local current_fingerprint=""
  local saved_fingerprint=""
  current_fingerprint="$(frontend_dep_fingerprint "$dir")"
  [[ -f "$fingerprint_file" ]] && saved_fingerprint="$(cat "$fingerprint_file" 2>/dev/null || true)"

  if [[ -n "$current_fingerprint" && "$current_fingerprint" == "$saved_fingerprint" ]] && frontend_node_modules_ready "$dir"; then
    info "[frontend] package fingerprint unchanged; reusing existing node_modules"
    return 0
  fi

  if [[ -n "$current_fingerprint" && "$current_fingerprint" == "$saved_fingerprint" ]]; then
    warn "[frontend] fingerprint unchanged but node_modules is incomplete; repairing dependencies"
    frontend_ensure_required_bins "$dir" "$log_file" "$heartbeat" "$timeout_minutes" "$fingerprint_file" || return $?
    return 0
  fi

  if [[ -f "$dir/package-lock.json" ]]; then
    if ! frontend_run_step "npm ci" "$log_file" "$heartbeat" "$timeout_minutes" bash -lc "cd '$dir' && env -u NODE_ENV -u BABEL_ENV npm ci --include=dev --production=false ${NPM_INSTALL_FLAGS}"; then
      warn "[frontend] npm ci failed; falling back to npm install"
      frontend_run_step "npm install fallback" "$log_file" "$heartbeat" "$timeout_minutes" bash -lc "cd '$dir' && env -u NODE_ENV -u BABEL_ENV npm install --include=dev --production=false ${NPM_INSTALL_FLAGS}" || return $?
    fi
  else
    frontend_run_step "npm install" "$log_file" "$heartbeat" "$timeout_minutes" bash -lc "cd '$dir' && env -u NODE_ENV -u BABEL_ENV npm install --include=dev --production=false ${NPM_INSTALL_FLAGS}" || return $?
  fi

  [[ -n "$current_fingerprint" ]] && printf '%s
' "$current_fingerprint" > "$fingerprint_file"
  frontend_ensure_required_bins "$dir" "$log_file" "$heartbeat" "$timeout_minutes" "$fingerprint_file" || return $?
  return 0
}

frontend_run_optional_checks() {
  local log_file="$1"
  local heartbeat="$2"
  local timeout_minutes="$3"

  if [[ "${FRONTEND_TYPECHECK:-0}" == "1" ]]; then
    if npm run 2>/dev/null | grep -q 'type:refs'; then
      frontend_run_step "npm run type:refs" "$log_file" "$heartbeat" "$timeout_minutes" npm run type:refs || return $?
    fi
    if npm run 2>/dev/null | grep -qE '^[[:space:]]+type[[:space:]]'; then
      frontend_run_step "npm run type" "$log_file" "$heartbeat" "$timeout_minutes" npm run type -- --pretty false || return $?
    fi
  fi
  return 0
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
    while IFS= read -r pid; do
      [[ -n "${pid:-}" ]] || continue
      kill_process_tree "$pid"
    done <<< "$pids"
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

  if [[ -z "${FRONTEND_NODE_OLD_SPACE_SIZE_MB:-}" || "${FRONTEND_NODE_OLD_SPACE_SIZE_MB}" == "auto" ]]; then
    if (( TOTAL_MEM_MB >= 32768 )); then
      FRONTEND_NODE_OLD_SPACE_SIZE_EFFECTIVE_MB=20480
    elif (( TOTAL_MEM_MB >= 24576 )); then
      FRONTEND_NODE_OLD_SPACE_SIZE_EFFECTIVE_MB=18432
    elif (( TOTAL_MEM_MB >= 16384 )); then
      FRONTEND_NODE_OLD_SPACE_SIZE_EFFECTIVE_MB=14336
    elif (( TOTAL_MEM_MB >= 12288 )); then
      FRONTEND_NODE_OLD_SPACE_SIZE_EFFECTIVE_MB=12288
    elif (( TOTAL_MEM_MB >= 8192 )); then
      FRONTEND_NODE_OLD_SPACE_SIZE_EFFECTIVE_MB=8192
    else
      FRONTEND_NODE_OLD_SPACE_SIZE_EFFECTIVE_MB=6144
    fi
  else
    FRONTEND_NODE_OLD_SPACE_SIZE_EFFECTIVE_MB="${FRONTEND_NODE_OLD_SPACE_SIZE_MB}"
  fi

  if [[ -z "${FRONTEND_FORK_TS_MEMORY_LIMIT_MB:-}" || "${FRONTEND_FORK_TS_MEMORY_LIMIT_MB}" == "auto" ]]; then
    if (( TOTAL_MEM_MB >= 32768 )); then
      FRONTEND_FORK_TS_MEMORY_LIMIT_EFFECTIVE_MB=12288
    elif (( TOTAL_MEM_MB >= 24576 )); then
      FRONTEND_FORK_TS_MEMORY_LIMIT_EFFECTIVE_MB=10240
    elif (( TOTAL_MEM_MB >= 16384 )); then
      FRONTEND_FORK_TS_MEMORY_LIMIT_EFFECTIVE_MB=8192
    elif (( TOTAL_MEM_MB >= 12288 )); then
      FRONTEND_FORK_TS_MEMORY_LIMIT_EFFECTIVE_MB=6144
    elif (( TOTAL_MEM_MB >= 8192 )); then
      FRONTEND_FORK_TS_MEMORY_LIMIT_EFFECTIVE_MB=4096
    else
      FRONTEND_FORK_TS_MEMORY_LIMIT_EFFECTIVE_MB=3072
    fi
  else
    FRONTEND_FORK_TS_MEMORY_LIMIT_EFFECTIVE_MB="${FRONTEND_FORK_TS_MEMORY_LIMIT_MB}"
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
  use_local_runtime_layout
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
  use_local_runtime_layout
  validate_frontend
  ensure_dirs
  frontend_running && { warn "Frontend already running on port $FRONTEND_PORT"; return 0; }
  local cmd
  cmd="$(frontend_dev_command)" || die "Could not determine frontend dev command from package.json"
  cd "$FRONTEND_DIR"
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    export npm_config_legacy_peer_deps="${NPM_CONFIG_LEGACY_PEER_DEPS}"
    export npm_config_audit="${NPM_CONFIG_AUDIT}"
    export npm_config_fund="${NPM_CONFIG_FUND}"
    export npm_config_progress="${NPM_CONFIG_PROGRESS}"
    export npm_config_update_notifier="${NPM_CONFIG_UPDATE_NOTIFIER}"
  export npm_config_loglevel="${NPM_CONFIG_LOGLEVEL}"
    export npm_config_loglevel="${NPM_CONFIG_LOGLEVEL}"
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
  local listener_pid=""
  listener_pid="$(lsof -tiTCP:"$FRONTEND_PORT" -sTCP:LISTEN | head -n 1 || true)"
  kill_port "$FRONTEND_PORT"
  if [[ -n "${listener_pid:-}" ]]; then
    local ancestor_pid="$listener_pid"
    local hops=0
    while [[ -n "${ancestor_pid:-}" && "$ancestor_pid" != "1" && $hops -lt 8 ]]; do
      kill -9 "$ancestor_pid" 2>/dev/null || true
      ancestor_pid="$(ps -o ppid= -p "$ancestor_pid" 2>/dev/null | tr -d ' ' || true)"
      hops=$((hops+1))
    done
  fi
  pkill -f "WEBPACK_DEVSERVER_PORT=\"$FRONTEND_PORT\"" 2>/dev/null || true
  pkill -f "webpack-dev-server.js --mode=development --port $FRONTEND_PORT" 2>/dev/null || true
  pkill -f "npm run dev-server --port $FRONTEND_PORT" 2>/dev/null || true
  pkill -f "npm run dev-server -- --port $FRONTEND_PORT" 2>/dev/null || true
  pkill -f "npm run dev -- --port $FRONTEND_PORT" 2>/dev/null || true
  local i=0
  while [[ $i -lt 10 ]]; do
    frontend_running || break
    sleep 1
    i=$((i+1))
  done
  frontend_running && die "Frontend still appears to be running"
  ok "Frontend stopped"
}
restart_frontend() { stop_frontend || true; sleep 1; start_frontend; }

local_should_start_frontend_dev() {
  if [[ "$LOCAL_FRONTEND_DEV_SERVER" == "1" ]]; then
    return 0
  fi

  local assets_dir="$PROJECT_DIR/superset/static/assets"
  if [[ ! -d "$assets_dir" ]]; then
    return 0
  fi

  find "$assets_dir" -maxdepth 1 -name 'spa*.entry.js' -print -quit | grep -q .
}

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
  use_local_runtime_layout
  if [[ "${FRONTEND_SKIP_IF_ASSETS_EXIST:-1}" == "1" && -d "$PROJECT_DIR/superset/static/assets" ]]; then
    info "Skipping frontend build because assets already exist at $PROJECT_DIR/superset/static/assets"
    return 0
  fi
  validate_frontend
  patch_frontend_workspace_for_custom_branch
  patch_frontend_webpack_memory_for_branch
  cd "$FRONTEND_DIR"

  frontend_apply_common_env

  local build_log="${FRONTEND_BUILD_LOG_FILE:-$PROJECT_DIR/frontend-build.log}"
  local heartbeat="${FRONTEND_HEARTBEAT_SECONDS:-30}"
  local timeout_minutes="${FRONTEND_TIMEOUT_MINUTES:-90}"
  local fingerprint_file="${FRONTEND_DEP_FINGERPRINT_FILE:-$PROJECT_DIR/.frontend-deps.sha256}"

  frontend_install_deps_if_needed "$FRONTEND_DIR" "$build_log" "$heartbeat" "$timeout_minutes" "$fingerprint_file" || return $?
  frontend_run_optional_checks "$build_log" "$heartbeat" "$timeout_minutes" || return $?
  frontend_run_step "webpack production build" "$build_log" "$heartbeat" "$timeout_minutes" bash -lc 'cd "$0" && export PATH="$PWD/node_modules/.bin:$PATH" NODE_OPTIONS="${NODE_OPTIONS:-$FRONTEND_NODE_OPTIONS}" NODE_ENV=production BABEL_ENV="${BABEL_ENV:-production}" DISABLE_TYPE_CHECK="${DISABLE_TYPE_CHECK:-$FRONTEND_DISABLE_TYPE_CHECK}"; HEAP="${FRONTEND_NODE_OLD_SPACE_SIZE_EFFECTIVE_MB:-14336}"; if [[ -f "$PWD/node_modules/webpack-cli/bin/cli.js" ]]; then exec node --max_old_space_size="$HEAP" "$PWD/node_modules/webpack-cli/bin/cli.js" --color --mode production; elif [[ -f "$PWD/node_modules/webpack-cli/lib/bootstrap.js" ]]; then exec node --max_old_space_size="$HEAP" "$PWD/node_modules/webpack-cli/lib/bootstrap.js" --color --mode production; elif [[ -f "$PWD/node_modules/webpack/bin/webpack.js" ]]; then exec node --max_old_space_size="$HEAP" "$PWD/node_modules/webpack/bin/webpack.js" --color --mode production; else echo "ERROR: webpack package files missing under $PWD/node_modules" >&2; exit 127; fi' "$FRONTEND_DIR" || return $?

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
  if local_should_start_frontend_dev; then
    start_frontend || true
  else
    info "Skipping local frontend dev server; backend will serve built static assets"
  fi
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
  # Keep npm in the engine-compatible range for this frontend branch
  sudo npm install -g "npm@${NPM_VERSION}" >/dev/null 2>&1 || true
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
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] && pip install -U "${CLICKHOUSE_PYTHON_PACKAGE}"
  if [[ -f "$INSTALL_DIR/setup.py" || -f "$INSTALL_DIR/pyproject.toml" ]]; then
    pip install -e "$INSTALL_DIR" || true
  fi
  ok "Python dependencies installed"
}


patch_frontend_workspace_for_custom_branch() {
  [[ "${FRONTEND_PATCH_TSCONFIGS:-1}" == "1" ]] || return 0
  [[ -d "$INSTALL_DIR/superset-frontend" ]] || return 0
  info "Patching frontend TypeScript workspace for custom branch imports"

  local frontend_dir="$INSTALL_DIR/superset-frontend"

  python3 - "$frontend_dir" "${FRONTEND_REWRITE_PLUGIN_TSCONFIGS:-1}" <<'PY'
import json
import os
import re
import sys
from pathlib import Path

frontend = Path(sys.argv[1]).resolve()
rewrite_plugins = sys.argv[2] == "1"

def strip_jsonc(txt: str) -> str:
    txt = re.sub(r"/\*.*?\*/", "", txt, flags=re.S)
    txt = re.sub(r"^\s*//.*$", "", txt, flags=re.M)
    txt = re.sub(r",(\s*[}\]])", r"\1", txt)
    return txt

def load_jsonc(path: Path):
    raw = path.read_text(encoding="utf-8")
    return json.loads(strip_jsonc(raw))

def dump_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

def rel_from_tsconfig_to_frontend(path: Path) -> str:
    rel = os.path.relpath(frontend, path.parent)
    rel = rel.replace(os.sep, "/")
    return "." if rel == "." else rel

def uniq(seq):
    out = []
    for item in seq:
        if item not in out:
            out.append(item)
    return out

patched = 0

COMMON_EXCLUDE = [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/*.stories.ts",
    "**/*.stories.tsx",
    "**/__tests__/**",
    "**/__mocks__/**",
    "**/test/**",
    "**/spec/**",
]

for path in frontend.rglob("tsconfig*.json"):
    try:
        data = load_jsonc(path)
    except Exception:
        continue

    compiler = data.setdefault("compilerOptions", {})
    rel = rel_from_tsconfig_to_frontend(path)
    changed = False

    desired_pairs = {
        "baseUrl": rel,
        "rootDir": rel,
        "composite": False,
        "incremental": False,
        "skipLibCheck": True,
        "noEmitOnError": False,
        "allowJs": True,
        "resolveJsonModule": True,
    }
    for key, value in desired_pairs.items():
        if compiler.get(key) != value:
            compiler[key] = value
            changed = True

    root_dirs = [f"{rel}/src", f"{rel}/packages", f"{rel}/plugins"]
    if compiler.get("rootDirs") != root_dirs:
        compiler["rootDirs"] = root_dirs
        changed = True

    paths = dict(compiler.get("paths") or {})
    desired_paths = {
        "src/*": ["src/*"],
        "packages/*": ["packages/*"],
        "plugins/*": ["plugins/*"],
    }
    merged_paths = dict(paths)
    merged_paths.update(desired_paths)
    if merged_paths != paths:
        compiler["paths"] = merged_paths
        changed = True

    include = data.get("include")
    if not isinstance(include, list):
        include = []

    # IMPORTANT: production build should not pull test/spec/story files
    desired_include = [
        f"{rel}/src/**/*",
        "src/**/*",
    ]
    merged_include = uniq(include + desired_include)
    if merged_include != include:
        data["include"] = merged_include
        changed = True

    excludes = data.get("exclude")
    if not isinstance(excludes, list):
        excludes = []
    merged_exclude = uniq(excludes + COMMON_EXCLUDE)
    if merged_exclude != excludes:
        data["exclude"] = merged_exclude
        changed = True

    for key in ("files", "references"):
        if key in data:
            del data[key]
            changed = True

    rel_parts = path.relative_to(frontend).parts
    is_plugin_tsconfig = len(rel_parts) >= 3 and rel_parts[0] == "plugins" and rel_parts[-1] == "tsconfig.json"
    if rewrite_plugins and is_plugin_tsconfig:
        data = {
            "extends": "../../tsconfig.json",
            "compilerOptions": {
                **compiler,
                "baseUrl": "../..",
                "rootDir": "../..",
                "rootDirs": ["../../src", "../../packages", "../../plugins"],
                "composite": False,
                "incremental": False,
                "skipLibCheck": True,
                "noEmitOnError": False,
                "allowJs": True,
                "resolveJsonModule": True,
                "paths": {
                    **dict(compiler.get("paths") or {}),
                    "src/*": ["src/*"],
                    "packages/*": ["packages/*"],
                    "plugins/*": ["plugins/*"],
                },
            },
            "include": [
                "../../src/**/*",
                "../../packages/**/src/**/*",
                "../../plugins/**/src/**/*",
                "src/**/*",
            ],
            "exclude": COMMON_EXCLUDE,
        }
        changed = True

    if changed:
        dump_json(path, data)
        patched += 1

constants = frontend / "src/explore/components/controls/DateFilterControl/utils/constants.ts"
if constants.exists():
    txt = constants.read_text(encoding="utf-8")
    new = txt.replace("extendedDayjs()\n  .utc()", "(extendedDayjs() as any)\n  .utc()")
    if new != txt:
        constants.write_text(new, encoding="utf-8")
        patched += 1

print(patched)
PY

  ok "Frontend workspace patch applied"
}

patch_frontend_webpack_memory_for_branch() {
  [[ -d "$INSTALL_DIR/superset-frontend" ]] || return 0
  info "Patching frontend webpack memory settings"

  local frontend_dir="$INSTALL_DIR/superset-frontend"
  local mem_limit="${FRONTEND_FORK_TS_MEMORY_LIMIT_EFFECTIVE_MB:-8192}"

  python3 - "$frontend_dir" "$mem_limit" <<'PY'
import re
import sys
from pathlib import Path

frontend = Path(sys.argv[1])
mem_limit = sys.argv[2]
patched = 0

for path in list(frontend.rglob("webpack*.js")) + list(frontend.rglob("webpack.config.ts")):
    try:
        txt = path.read_text(encoding="utf-8")
    except Exception:
        continue
    if "ForkTsCheckerWebpackPlugin" not in txt and "TYPESCRIPT_MEMORY_LIMIT" not in txt:
        continue

    new = txt
    new = re.sub(r'(const\s+TYPESCRIPT_MEMORY_LIMIT\s*=\s*)\d+(\s*;)', rf'\g<1>{mem_limit}\2', new)
    new = re.sub(r'(memoryLimit\s*:\s*)\d+', rf'\g<1>{mem_limit}', new)

    if new == txt and "ForkTsCheckerWebpackPlugin" in txt:
        patterns = [
            r'ForkTsCheckerWebpackPlugin\(\s*\{',
            r'new\s+ForkTsCheckerWebpackPlugin\(\s*\{',
        ]
        replaced = False
        for pat in patterns:
            mo = re.search(pat, new)
            if mo:
                inject = mo.group(0) + f'\n      typescript: {{ memoryLimit: {mem_limit} }},'
                new = new[:mo.start()] + inject + new[mo.end():]
                replaced = True
                break
        if not replaced:
            continue

    if new != txt:
        path.write_text(new, encoding="utf-8")
        patched += 1

print(patched)
PY
  ok "Frontend webpack memory patch applied"
}


build_frontend_if_present_server() {
  if [[ -d "$INSTALL_DIR/superset-frontend" ]]; then
    if [[ "${FRONTEND_SKIP_IF_ASSETS_EXIST:-1}" == "1" && -d "$INSTALL_DIR/superset/static/assets" ]]; then
      info "Skipping frontend build because assets already exist at $INSTALL_DIR/superset/static/assets"
      return 0
    fi
    info "Building frontend assets"
    info "Frontend Node heap target: ${FRONTEND_NODE_OLD_SPACE_SIZE_EFFECTIVE_MB:-8192} MB; ForkTsChecker memory limit target: ${FRONTEND_FORK_TS_MEMORY_LIMIT_EFFECTIVE_MB:-6144} MB"
    patch_frontend_workspace_for_custom_branch
    patch_frontend_webpack_memory_for_branch
    cd "$INSTALL_DIR/superset-frontend"

    frontend_apply_common_env

    local build_log="${FRONTEND_BUILD_LOG_FILE:-$INSTALL_DIR/logs/frontend-build.log}"
    local heartbeat="${FRONTEND_HEARTBEAT_SECONDS:-30}"
    local timeout_minutes="${FRONTEND_TIMEOUT_MINUTES:-90}"
    local fingerprint_file="${FRONTEND_DEP_FINGERPRINT_FILE:-$RUN_DIR/frontend-deps.sha256}"

    frontend_install_deps_if_needed "$INSTALL_DIR/superset-frontend" "$build_log" "$heartbeat" "$timeout_minutes" "$fingerprint_file" || return $?
    frontend_run_optional_checks "$build_log" "$heartbeat" "$timeout_minutes" || return $?
    frontend_run_step "webpack production build" "$build_log" "$heartbeat" "$timeout_minutes" bash -lc 'cd "$0" && export PATH="$PWD/node_modules/.bin:$PATH" NODE_OPTIONS="${NODE_OPTIONS:-$FRONTEND_NODE_OPTIONS}" NODE_ENV=production BABEL_ENV="${BABEL_ENV:-production}" DISABLE_TYPE_CHECK="${DISABLE_TYPE_CHECK:-$FRONTEND_DISABLE_TYPE_CHECK}"; HEAP="${FRONTEND_NODE_OLD_SPACE_SIZE_EFFECTIVE_MB:-14336}"; if [[ -f "$PWD/node_modules/webpack-cli/bin/cli.js" ]]; then exec node --max_old_space_size="$HEAP" "$PWD/node_modules/webpack-cli/bin/cli.js" --color --progress --mode production; elif [[ -f "$PWD/node_modules/webpack-cli/lib/bootstrap.js" ]]; then exec node --max_old_space_size="$HEAP" "$PWD/node_modules/webpack-cli/lib/bootstrap.js" --color --progress --mode production; elif [[ -f "$PWD/node_modules/webpack/bin/webpack.js" ]]; then exec node --max_old_space_size="$HEAP" "$PWD/node_modules/webpack/bin/webpack.js" --color --progress --mode production; else echo "ERROR: webpack package files missing under $PWD/node_modules" >&2; exit 127; fi' "$INSTALL_DIR/superset-frontend" || return $?

    [[ -d "$INSTALL_DIR/superset/static/assets" ]] || die "Frontend build did not produce $INSTALL_DIR/superset/static/assets"
    ok "Frontend assets built"
    info "Continuing with Redis, PostgreSQL, config generation, and Superset initialization"
  fi
}

configure_redis_server() {
  info "Tuning Redis"
  sudo sed -i "s/^#*maxmemory .*/maxmemory ${REDIS_MAXMEMORY_MB}mb/" /etc/redis/redis.conf || true
  sudo sed -i "s/^#*maxmemory-policy .*/maxmemory-policy allkeys-lru/" /etc/redis/redis.conf || true
  sudo systemctl restart redis-server
  ok "Redis tuned"
}


postgres_role_exists_server() {
  sudo -u postgres psql -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'" 2>/dev/null | grep -q 1
}

postgres_database_exists_server() {
  sudo -u postgres psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" 2>/dev/null | grep -q 1
}

ensure_postgres_role_and_database_server() {
  [[ "${POSTGRES_ENABLED:-1}" == "1" ]] || return 0
  info "Ensuring PostgreSQL role and database exist"

  if postgres_role_exists_server; then
    sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE ${POSTGRES_USER} WITH LOGIN PASSWORD '${POSTGRES_PASSWORD}';" >/dev/null
  else
    sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE ${POSTGRES_USER} LOGIN PASSWORD '${POSTGRES_PASSWORD}';" >/dev/null
  fi

  if ! postgres_database_exists_server; then
    sudo -u postgres createdb -O "${POSTGRES_USER}" -E UTF8 "${POSTGRES_DB}"
  fi

  sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 <<SQL >/dev/null
ALTER DATABASE ${POSTGRES_DB} OWNER TO ${POSTGRES_USER};
GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB} TO ${POSTGRES_USER};
SQL

  ok "PostgreSQL role/database ensured"
}

configure_postgresql_server() {
  [[ "$POSTGRES_ENABLED" == "1" ]] || return 0
  info "Configuring PostgreSQL"

  ensure_postgres_role_and_database_server || return $?

  if [[ "$POSTGRES_INSTALL_EXTENSIONS" == "1" ]]; then
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
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

  ensure_postgres_role_and_database_server || return $?

  PGPASSWORD="${POSTGRES_PASSWORD}" psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -c 'SELECT current_user, current_database();' >/dev/null

  ok "PostgreSQL configured, password synchronized, and connectivity verified"
}


preserve_existing_runtime_secrets_server() {
  [[ -f "$ENV_FILE" ]] || return 0
  [[ "${FORCE_ROTATE_SECRETS:-0}" == "1" ]] && return 0

  info "Preserving existing runtime secrets from $ENV_FILE"

  local existing_secret existing_guest existing_pg existing_ch
  existing_secret="$(bash -lc 'set -a; source "$1" >/dev/null 2>&1; set +a; printf "%s" "${SUPERSET_SECRET_KEY:-${SECRET_KEY:-}}"' _ "$ENV_FILE" 2>/dev/null || true)"
  existing_guest="$(bash -lc 'set -a; source "$1" >/dev/null 2>&1; set +a; printf "%s" "${GUEST_TOKEN_JWT_SECRET:-}"' _ "$ENV_FILE" 2>/dev/null || true)"
  existing_pg="$(bash -lc 'set -a; source "$1" >/dev/null 2>&1; set +a; printf "%s" "${POSTGRES_PASSWORD:-}"' _ "$ENV_FILE" 2>/dev/null || true)"
  existing_ch="$(bash -lc 'set -a; source "$1" >/dev/null 2>&1; set +a; printf "%s" "${CLICKHOUSE_PASSWORD:-}"' _ "$ENV_FILE" 2>/dev/null || true)"

  [[ -n "$existing_secret" && -z "${SUPERSET_SECRET_KEY:-}" ]] && SUPERSET_SECRET_KEY="$existing_secret"
  [[ -n "$existing_guest" && -z "${GUEST_TOKEN_JWT_SECRET:-}" ]] && GUEST_TOKEN_JWT_SECRET="$existing_guest"
  [[ -n "$existing_pg" && -z "${POSTGRES_PASSWORD:-}" ]] && POSTGRES_PASSWORD="$existing_pg"
  [[ -n "$existing_ch" && -z "${CLICKHOUSE_PASSWORD:-}" ]] && CLICKHOUSE_PASSWORD="$existing_ch"

  ok "Existing runtime secrets preserved"
}

reset_invalid_database_secrets_server() {
  [[ "${POSTGRES_ENABLED:-1}" == "1" ]] || return 0
  warn "Resetting encrypted database secrets in metadata DB because SECRET_KEY does not match existing ciphertext"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${POSTGRES_DB:-superset}" <<'SQL' >/dev/null
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='dbs' AND column_name='password'
  ) THEN
    EXECUTE 'UPDATE public.dbs SET password = NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='dbs' AND column_name='encrypted_extra'
  ) THEN
    EXECUTE 'UPDATE public.dbs SET encrypted_extra = NULL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='dbs' AND column_name='server_cert'
  ) THEN
    EXECUTE 'UPDATE public.dbs SET server_cert = NULL';
  END IF;
END
$$;
SQL
  ok "Encrypted database secrets reset in metadata DB"
}


verify_postgres_runtime_credentials_server() {
  [[ "${POSTGRES_ENABLED:-1}" == "1" ]] || return 0
  info "Verifying PostgreSQL runtime credentials"
  PGPASSWORD="${POSTGRES_PASSWORD}" psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -c 'SELECT current_user, current_database();' >/dev/null
  ok "PostgreSQL runtime credentials verified"
}

generate_env_server() {
  info "Writing production .env"
  preserve_existing_runtime_secrets_server

  local runtime_domain="${DOMAIN}"
  local runtime_base_url="https://${runtime_domain}"
  local runtime_db_uri="postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
  local csrf_exempt_json='["superset.views.core.log","ChartDataRestApi.data","ChartDataRestApi.get_data","ChartDataRestApi.data_from_cache","DashboardRestApi.get","DashboardRestApi.get_charts","DashboardRestApi.get_datasets","DashboardRestApi.get_tabs","DatabaseRestApi.dhis2_chart_data"]'
  local cors_origins_json="[\"${runtime_base_url}\"]"
  local cors_allow_headers_json='["*"]'
  local cors_resources_json='["/*"]'
  local celery_accept_json='["json"]'
  local public_navbar_custom_links_json='[]'
  local public_footer_links_json='[{"text":"Privacy Policy"},{"text":"Terms of Service"}]'
  local ai_allowed_roles_json='[]'
  local ai_mode_roles_json='{"chart":[],"dashboard":[],"sql":[]}'
  local celery_task_annotations_json='{"sql_lab.get_sql_results":{"rate_limit":"100/s"}}'
  local celery_task_routes_json='{"superset.tasks.dhis2_sync.*":{"queue":"dhis2"},"superset.tasks.dhis2_cache.*":{"queue":"dhis2"},"superset.tasks.dhis2_metadata.*":{"queue":"dhis2"},"dhis2.finalize_repository_org_units":{"queue":"dhis2"}}'
  local theme_dark_json='{"algorithm":"dark","token":{"colorPrimary":"#2893B3","colorLink":"#2893B3","colorError":"#e04355","colorWarning":"#fcc700","colorSuccess":"#5ac189","colorInfo":"#66bcfe","fontFamily":"Inter, Helvetica, Arial","fontFamilyCode":"'\''Fira Code'\'', '\''Courier New'\'', monospace","transitionTiming":0.3,"brandIconMaxWidth":37,"fontSizeXS":"8","fontSizeXXL":"28","fontWeightNormal":"400","fontWeightLight":"300","fontWeightStrong":"500","colorBgBase":"#111827"}}'
  local theme_dark_json_escaped="${theme_dark_json//\\/\\\\}"
  theme_dark_json_escaped="${theme_dark_json_escaped//\"/\\\"}"

  cat > "$ENV_FILE" <<EOF
DOMAIN=${runtime_domain}
SUPERSET_ENV=production
SUPERSET_CONFIG_PATH=${SUPERSET_CONFIG_FILE}
SUPERSET_HOST=${SUPERSET_HOST}
SUPERSET_PORT=${SUPERSET_PORT}
SUPERSET_BASE_URL=${runtime_base_url}
WEBDRIVER_BASEURL=http://127.0.0.1:${SUPERSET_PORT}/
WEBDRIVER_BASEURL_USER_FRIENDLY=${runtime_base_url}
SUPERSET_DEBUG=0
ENABLE_PROXY_FIX=true
PREFERRED_URL_SCHEME=https
POSTGRES_ENABLED=${POSTGRES_ENABLED}
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_HOST=${POSTGRES_HOST}
POSTGRES_PORT=${POSTGRES_PORT}
DATABASE_URL=${runtime_db_uri}
SUPERSET_DB_URI=${runtime_db_uri}
SUPERSET_SECRET_KEY=${SUPERSET_SECRET_KEY}
SECRET_KEY=${SUPERSET_SECRET_KEY}
GUEST_TOKEN_JWT_SECRET=${GUEST_TOKEN_JWT_SECRET}
GUEST_TOKEN_JWT_ALGO=HS256
GUEST_TOKEN_HEADER_NAME=X-GuestToken
GUEST_TOKEN_JWT_EXP_SECONDS=86400
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_FIRSTNAME=${ADMIN_FIRSTNAME}
ADMIN_LASTNAME=${ADMIN_LASTNAME}
ADMIN_EMAIL=${ADMIN_EMAIL}
ROW_LIMIT=50000
SUPERSET_WEBSERVER_TIMEOUT=${GUNICORN_TIMEOUT}
SQLLAB_TIMEOUT=300
SQLLAB_ASYNC_TIME_LIMIT_SEC=${SQLLAB_ASYNC_TIME_LIMIT_SEC}
WTF_CSRF_ENABLED=true
WTF_CSRF_EXEMPT_LIST='${csrf_exempt_json}'
MAPBOX_API_KEY=
EMBEDDED_SUPERSET=true
PUBLIC_ROLE_LIKE=Gamma
FAB_ADD_SECURITY_VIEWS=true
AUTH_TYPE=1
AUTH_ROLE_PUBLIC=Public
PUBLIC_DASHBOARD_ENTRY_ENABLED=true
GUEST_ROLE_NAME=Public
ENABLE_CORS=true
CORS_SUPPORTS_CREDENTIALS=true
CORS_ALLOW_HEADERS=${cors_allow_headers_json}
CORS_RESOURCES=${cors_resources_json}
CORS_ORIGINS_JSON='${cors_origins_json}'
FF_EMBEDDED_SUPERSET=true
FF_EMBEDDABLE_CHARTS=true
FF_DASHBOARD_RBAC=true
FF_DASHBOARD_NATIVE_FILTERS=true
FF_ENABLE_TEMPLATE_PROCESSING=true
FF_AI_INSIGHTS=true
FF_DRILL_BY=true
FF_DRILL_TO_DETAIL=true
FF_THUMBNAILS=true
FF_ALERT_REPORTS=true
FF_DYNAMIC_PLUGINS=false
AI_INSIGHTS_ENABLED=true
AI_INSIGHTS_ALLOW_SQL_EXECUTION=false
AI_INSIGHTS_MAX_CONTEXT_ROWS=20
AI_INSIGHTS_MAX_CONTEXT_COLUMNS=25
AI_INSIGHTS_MAX_DASHBOARD_CHARTS=12
AI_INSIGHTS_MAX_FOLLOW_UP_MESSAGES=6
AI_INSIGHTS_MAX_GENERATED_SQL_ROWS=200
AI_INSIGHTS_REQUEST_TIMEOUT_SECONDS=30
AI_INSIGHTS_MAX_TOKENS=1200
AI_INSIGHTS_TEMPERATURE=0.1
AI_INSIGHTS_ENABLE_MOCK=1
AI_INSIGHTS_ALLOWED_ROLES='${ai_allowed_roles_json}'
AI_INSIGHTS_MODE_ROLES='${ai_mode_roles_json}'
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODELS=gpt-4.1-mini
OPENAI_DEFAULT_MODEL=gpt-4.1-mini
OLLAMA_BASE_URL=
OLLAMA_MODELS=llama3.1:8b
OLLAMA_DEFAULT_MODEL=llama3.1:8b
TALISMAN_ENABLED=true
TALISMAN_FORCE_HTTPS=false
SESSION_COOKIE_SECURE=true
REDIS_HOST=${REDIS_HOST}
REDIS_PORT=${REDIS_PORT}
REDIS_DB=${REDIS_DB}
CACHE_REDIS_URL=redis://${REDIS_HOST}:${REDIS_PORT}/0
DATA_CACHE_REDIS_URL=redis://${REDIS_HOST}:${REDIS_PORT}/1
RESULTS_BACKEND_REDIS_URL=redis://${REDIS_HOST}:${REDIS_PORT}/2
RESULTS_BACKEND_REDIS_DB=2
RATELIMIT_STORAGE_URI=redis://${REDIS_HOST}:${REDIS_PORT}/6
CACHE_DEFAULT_TIMEOUT=${CACHE_DEFAULT_TIMEOUT}
DATA_CACHE_TIMEOUT=${DATA_CACHE_TIMEOUT}
FILTER_STATE_CACHE_TIMEOUT=${FILTER_STATE_CACHE_TIMEOUT}
EXPLORE_FORM_DATA_CACHE_TIMEOUT=${EXPLORE_FORM_DATA_CACHE_TIMEOUT}
CELERY_BROKER_URL=redis://${REDIS_HOST}:${REDIS_PORT}/0
CELERY_RESULT_BACKEND=redis://${REDIS_HOST}:${REDIS_PORT}/1
CELERY_TASK_SERIALIZER=json
CELERY_RESULT_SERIALIZER=json
CELERY_ACCEPT_CONTENT=${celery_accept_json}
CELERY_TIMEZONE=Africa/Kampala
CELERY_ENABLE_UTC=true
CELERY_WORKER_PREFETCH_MULTIPLIER=${WORKER_PREFETCH_MULTIPLIER}
CELERY_TASK_ACKS_LATE=true
CELERY_TASK_ANNOTATIONS='${celery_task_annotations_json}'
CELERY_TASK_ROUTES='${celery_task_routes_json}'
DHIS2_SYNC_CRON_MINUTE=*/15
REPORTS_SCHEDULER_MINUTE=*
REPORTS_SCHEDULER_HOUR=*
REPORTS_PRUNE_MINUTE=0
REPORTS_PRUNE_HOUR=0
PUBLIC_NAVBAR_TITLE="National Malaria Data Repository"
PUBLIC_NAVBAR_LOGO_ALT="National Malaria Data Repository"
PUBLIC_LOGIN_TEXT=Login
PUBLIC_LOGIN_URL=/login/
PUBLIC_LOGIN_TYPE=primary
PUBLIC_NAVBAR_CUSTOM_LINKS=${public_navbar_custom_links_json}
PUBLIC_SIDEBAR_POSITION=left
PUBLIC_SIDEBAR_TITLE=Categories
PUBLIC_WELCOME_TITLE=Welcome
PUBLIC_WELCOME_DESCRIPTION="Select a category from the sidebar to view dashboards."
PUBLIC_FOOTER_TEXT="© 2026 Your Organization"
PUBLIC_FOOTER_LINKS='${public_footer_links_json}'
DHIS2_CACHE_REFRESH_INTERVAL=21600
DHIS2_CACHE_TTL_GEOJSON=21600
DHIS2_CACHE_TTL_ORG_HIERARCHY=3600
DHIS2_CACHE_TTL_ORG_LEVELS=7200
DHIS2_CACHE_TTL_ANALYTICS=1800
DHIS2_CACHE_TTL_FILTER_OPTIONS=3600
DHIS2_CACHE_TTL_NAME_TO_UID=3600
DHIS2_CACHE_MAX_SIZE_MB=500
ENABLE_UI_THEME_ADMINISTRATION=true
THEME_DARK_JSON="${theme_dark_json_escaped}"
LOG_LEVEL=INFO
LOG_FORMAT='%(asctime)s:%(levelname)s:%(name)s:%(message)s'
SUPERSET_LOG_FILE=${INSTALL_DIR}/logs/superset.log

CLICKHOUSE_ENABLED=${CLICKHOUSE_ENABLED}
DUCKDB_ENABLED=${DUCKDB_ENABLED}
DHIS2_SERVING_ENGINE=clickhouse
DHIS2_CLICKHOUSE_ENABLED=true
DHIS2_CLICKHOUSE_HOST=${CLICKHOUSE_HOST}
DHIS2_CLICKHOUSE_PORT=${CLICKHOUSE_NATIVE_PORT}
DHIS2_CLICKHOUSE_HTTP_PORT=${CLICKHOUSE_HTTP_PORT}
DHIS2_CLICKHOUSE_DATABASE=${CLICKHOUSE_STAGING_DATABASE}
DHIS2_CLICKHOUSE_SERVING_DATABASE=${CLICKHOUSE_SERVING_DATABASE}
DHIS2_CLICKHOUSE_CONTROL_DATABASE=${CLICKHOUSE_CONTROL_DATABASE}
DHIS2_CLICKHOUSE_USER=${CLICKHOUSE_USER}
DHIS2_CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD}
DHIS2_CLICKHOUSE_SECURE=false
DHIS2_CLICKHOUSE_HTTP_PROTOCOL=http
DHIS2_CLICKHOUSE_SUPERSET_DB_NAME="${CLICKHOUSE_SUPERSET_DB_NAME}"
DHIS2_CLICKHOUSE_REFRESH_STRATEGY=versioned_view_swap
DHIS2_CLICKHOUSE_KEEP_OLD_VERSIONS=2

NODE_MAJOR=${NODE_MAJOR}
NPM_VERSION=${NPM_VERSION}
FRONTEND_CLEAN=${FRONTEND_CLEAN}
FRONTEND_TYPECHECK=${FRONTEND_TYPECHECK}
FRONTEND_TIMEOUT_MINUTES=${FRONTEND_TIMEOUT_MINUTES}
FRONTEND_NODE_OLD_SPACE_SIZE_MB=${FRONTEND_NODE_OLD_SPACE_SIZE_MB}
FRONTEND_FORK_TS_MEMORY_LIMIT_MB=${FRONTEND_FORK_TS_MEMORY_LIMIT_MB}
EOF

  chmod 600 "$ENV_FILE" || true
  ok ".env written to $ENV_FILE"
}

create_systemd_units_server() {
  info "Creating systemd units"
  local svc_user="${REMOTE_APP_USER:-${USER}}"
  local svc_group="${REMOTE_APP_USER:-${USER}}"

  if [[ ${EUID} -eq 0 ]]; then
    mkdir -p "$INSTALL_DIR" "$LOG_DIR" "$RUN_DIR" "$DATA_DIR" "$CONFIG_DIR"
    id "$svc_user" >/dev/null 2>&1 && chown -R "$svc_user:$svc_group" "$INSTALL_DIR" || true
  fi

  run_privileged "cat > /etc/systemd/system/superset-web.service <<'EOF'
[Unit]
Description=Superset Web
After=network.target postgresql.service redis-server.service
Wants=postgresql.service redis-server.service

[Service]
User=${svc_user}
Group=${svc_group}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
Environment=SUPERSET_CONFIG_PATH=${SUPERSET_CONFIG_FILE}
ExecStart=${VENV_DIR}/bin/gunicorn -w ${GUNICORN_WORKERS} --threads ${GUNICORN_THREADS} -k gthread -b ${SUPERSET_HOST}:${SUPERSET_PORT} --timeout ${GUNICORN_TIMEOUT} --keep-alive ${GUNICORN_KEEPALIVE} --access-logfile ${GUNICORN_LOG} --error-logfile ${GUNICORN_LOG} 'superset.app:create_app()'
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF"

  run_privileged "cat > /etc/systemd/system/superset-worker.service <<'EOF'
[Unit]
Description=Superset Celery Worker
After=network.target postgresql.service redis-server.service
Wants=postgresql.service redis-server.service

[Service]
Type=simple
User=${svc_user}
Group=${svc_group}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
Environment=SUPERSET_CONFIG_PATH=${SUPERSET_CONFIG_FILE}
ExecStart=${VENV_DIR}/bin/celery --app=superset.tasks.celery_app:app worker --pool=prefork -O fair --concurrency=${CELERY_CONCURRENCY} --queues=celery,dhis2 --hostname=${APP_NAME}@%H --pidfile=${RUN_DIR}/celery-worker.pid --logfile=${CELERY_WORKER_LOG} --loglevel=INFO
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF"

  run_privileged "cat > /etc/systemd/system/superset-beat.service <<'EOF'
[Unit]
Description=Superset Celery Beat
After=network.target postgresql.service redis-server.service
Wants=postgresql.service redis-server.service

[Service]
Type=simple
User=${svc_user}
Group=${svc_group}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
Environment=SUPERSET_CONFIG_PATH=${SUPERSET_CONFIG_FILE}
ExecStart=${VENV_DIR}/bin/celery --app=superset.tasks.celery_app:app beat --loglevel=INFO --schedule=${RUN_DIR}/celerybeat-schedule --pidfile=${RUN_DIR}/celerybeat.pid --logfile=${CELERY_BEAT_LOG}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF"
  run_privileged "systemctl daemon-reload"
  run_privileged "systemctl enable superset-web superset-worker superset-beat"
  ok "systemd units created"
}

generate_superset_config_server() {
  info "Writing merged env-driven superset_config.py"
  cat > "$SUPERSET_CONFIG_FILE" <<'PY'
# Merged, environment-driven Superset configuration for DHIS2/custom deployment
# Place at: /srv/apps/superset/config/superset_config.py

import json
import os
from datetime import timedelta

from cachelib.redis import RedisCache
from cachelib import FileSystemCache
from celery.schedules import crontab

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def env_bool(name: str, default: bool = False) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}

def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return default

def env_json(name: str, default):
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default

def env_csv(name: str, default: str = ""):
    raw = os.getenv(name, default)
    return [x.strip() for x in raw.split(",") if x.strip()]

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
APP_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
DATA_DIR = os.path.join(APP_DIR, "data")
UPLOAD_FOLDER = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# -----------------------------------------------------------------------------
# Core runtime
# -----------------------------------------------------------------------------
SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL") or os.getenv("SUPERSET_DB_URI")
SECRET_KEY = os.getenv("SECRET_KEY") or os.getenv("SUPERSET_SECRET_KEY")

if not SQLALCHEMY_DATABASE_URI:
    raise RuntimeError("Missing DATABASE_URL or SUPERSET_DB_URI in environment")

if SQLALCHEMY_DATABASE_URI.startswith("sqlite:") or "superset.db" in SQLALCHEMY_DATABASE_URI:
    raise RuntimeError("Refusing to start with SQLite metadata in deployment")

if not SECRET_KEY:
    raise RuntimeError("Missing SECRET_KEY or SUPERSET_SECRET_KEY in environment")

SQLALCHEMY_TRACK_MODIFICATIONS = False
SQLALCHEMY_ENGINE_OPTIONS = {
    "pool_pre_ping": env_bool("SQLALCHEMY_POOL_PRE_PING", True),
    "pool_recycle": env_int("SQLALCHEMY_POOL_RECYCLE", 1800),
}

SUPERSET_WEBSERVER_TIMEOUT = env_int("SUPERSET_WEBSERVER_TIMEOUT", int(timedelta(minutes=5).total_seconds()))
SQLLAB_TIMEOUT = env_int("SQLLAB_TIMEOUT", int(timedelta(minutes=5).total_seconds()))
SQLLAB_ASYNC_TIME_LIMIT_SEC = env_int("SQLLAB_ASYNC_TIME_LIMIT_SEC", int(timedelta(hours=6).total_seconds()))
ROW_LIMIT = env_int("ROW_LIMIT", 50000)

SUPERSET_BASE_URL = os.getenv("SUPERSET_BASE_URL", "https://supersets.vitalplatforms.com")
WEBDRIVER_BASEURL = os.getenv("WEBDRIVER_BASEURL", "http://127.0.0.1:8088/")
WEBDRIVER_BASEURL_USER_FRIENDLY = os.getenv("WEBDRIVER_BASEURL_USER_FRIENDLY", SUPERSET_BASE_URL)

DEBUG = env_bool("SUPERSET_DEBUG", False)
if os.getenv("WEBPACK_DEV_SERVER_URL"):
    WEBPACK_DEV_SERVER_URL = os.getenv("WEBPACK_DEV_SERVER_URL")

# -----------------------------------------------------------------------------
# Proxy / security / CSRF
# -----------------------------------------------------------------------------
ENABLE_PROXY_FIX = env_bool("ENABLE_PROXY_FIX", True)
PREFERRED_URL_SCHEME = os.getenv("PREFERRED_URL_SCHEME", "https")

WTF_CSRF_ENABLED = env_bool("WTF_CSRF_ENABLED", True)
WTF_CSRF_TIME_LIMIT = None
WTF_CSRF_EXEMPT_LIST = env_json("WTF_CSRF_EXEMPT_LIST", [
    "superset.views.core.log",
    "ChartDataRestApi.data",
    "ChartDataRestApi.get_data",
    "ChartDataRestApi.data_from_cache",
    "DashboardRestApi.get",
    "DashboardRestApi.get_charts",
    "DashboardRestApi.get_datasets",
    "DashboardRestApi.get_tabs",
    "DatabaseRestApi.dhis2_chart_data",
])

MAPBOX_API_KEY = os.getenv("MAPBOX_API_KEY", "")

# -----------------------------------------------------------------------------
# Embedding / public access
# -----------------------------------------------------------------------------
EMBEDDED_SUPERSET = env_bool("EMBEDDED_SUPERSET", True)
PUBLIC_ROLE_LIKE = os.getenv("PUBLIC_ROLE_LIKE", "Gamma")
FAB_ADD_SECURITY_VIEWS = env_bool("FAB_ADD_SECURITY_VIEWS", True)
AUTH_TYPE = env_int("AUTH_TYPE", 1)  # AUTH_DB
AUTH_ROLE_PUBLIC = os.getenv("AUTH_ROLE_PUBLIC", "Public")
PUBLIC_DASHBOARD_ENTRY_ENABLED = env_bool("PUBLIC_DASHBOARD_ENTRY_ENABLED", True)

GUEST_ROLE_NAME = os.getenv("GUEST_ROLE_NAME", "Public")
GUEST_TOKEN_JWT_SECRET = os.getenv("GUEST_TOKEN_JWT_SECRET", SECRET_KEY)
GUEST_TOKEN_JWT_ALGO = os.getenv("GUEST_TOKEN_JWT_ALGO", "HS256")
GUEST_TOKEN_HEADER_NAME = os.getenv("GUEST_TOKEN_HEADER_NAME", "X-GuestToken")
GUEST_TOKEN_JWT_EXP_SECONDS = env_int("GUEST_TOKEN_JWT_EXP_SECONDS", 86400)

# -----------------------------------------------------------------------------
# CORS
# -----------------------------------------------------------------------------
ENABLE_CORS = env_bool("ENABLE_CORS", True)
CORS_OPTIONS = {
    "supports_credentials": env_bool("CORS_SUPPORTS_CREDENTIALS", True),
    "allow_headers": env_json("CORS_ALLOW_HEADERS", ["*"]),
    "resources": env_json("CORS_RESOURCES", [r"/*"]),
    "origins": env_json("CORS_ORIGINS_JSON", env_csv("CORS_ORIGINS", "*")),
}

# -----------------------------------------------------------------------------
# Feature flags
# -----------------------------------------------------------------------------
FEATURE_FLAGS = {
    "EMBEDDED_SUPERSET": env_bool("FF_EMBEDDED_SUPERSET", True),
    "EMBEDDABLE_CHARTS": env_bool("FF_EMBEDDABLE_CHARTS", True),
    "DASHBOARD_RBAC": env_bool("FF_DASHBOARD_RBAC", True),
    "DASHBOARD_NATIVE_FILTERS": env_bool("FF_DASHBOARD_NATIVE_FILTERS", True),
    "ENABLE_TEMPLATE_PROCESSING": env_bool("FF_ENABLE_TEMPLATE_PROCESSING", True),
    "AI_INSIGHTS": env_bool("FF_AI_INSIGHTS", True),
    "DrillBy": env_bool("FF_DRILL_BY", True),
    "DrillToDetail": env_bool("FF_DRILL_TO_DETAIL", True),
    "THUMBNAILS": env_bool("FF_THUMBNAILS", True),
    "ALERT_REPORTS": env_bool("FF_ALERT_REPORTS", True),
    "DYNAMIC_PLUGINS": env_bool("FF_DYNAMIC_PLUGINS", False),
}

# -----------------------------------------------------------------------------
# AI Insights providers
# -----------------------------------------------------------------------------
_AI_INSIGHTS_PROVIDERS = {}

if os.getenv("OPENAI_API_KEY"):
    _AI_INSIGHTS_PROVIDERS["openai"] = {
        "enabled": env_bool("OPENAI_ENABLED", True),
        "type": os.getenv("OPENAI_PROVIDER_TYPE", "openai_compatible"),
        "label": os.getenv("OPENAI_PROVIDER_LABEL", "OpenAI"),
        "base_url": os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        "api_key_env": "OPENAI_API_KEY",
        "models": env_csv("OPENAI_MODELS", "gpt-4.1-mini"),
        "default_model": os.getenv("OPENAI_DEFAULT_MODEL", "gpt-4.1-mini"),
        "is_local": False,
    }

ollama_base_url = os.getenv("OLLAMA_BASE_URL") or os.getenv("OLLAMA_HOST")
if ollama_base_url:
    _AI_INSIGHTS_PROVIDERS["ollama"] = {
        "enabled": env_bool("OLLAMA_ENABLED", True),
        "type": "ollama",
        "label": os.getenv("OLLAMA_PROVIDER_LABEL", "Ollama"),
        "base_url": ollama_base_url,
        "models": env_csv("OLLAMA_MODELS", "llama3.1:8b"),
        "default_model": os.getenv("OLLAMA_DEFAULT_MODEL", "llama3.1:8b"),
        "is_local": True,
    }

if not _AI_INSIGHTS_PROVIDERS and env_bool("AI_INSIGHTS_ENABLE_MOCK", True):
    _AI_INSIGHTS_PROVIDERS["mock"] = {
        "enabled": True,
        "type": "mock",
        "label": "Mock AI (local)",
        "models": ["mock-1"],
        "default_model": "mock-1",
        "is_local": True,
    }

AI_INSIGHTS_CONFIG = {
    "enabled": env_bool("AI_INSIGHTS_ENABLED", True),
    "allow_sql_execution": env_bool("AI_INSIGHTS_ALLOW_SQL_EXECUTION", False),
    "max_context_rows": env_int("AI_INSIGHTS_MAX_CONTEXT_ROWS", 20),
    "max_context_columns": env_int("AI_INSIGHTS_MAX_CONTEXT_COLUMNS", 25),
    "max_dashboard_charts": env_int("AI_INSIGHTS_MAX_DASHBOARD_CHARTS", 12),
    "max_follow_up_messages": env_int("AI_INSIGHTS_MAX_FOLLOW_UP_MESSAGES", 6),
    "max_generated_sql_rows": env_int("AI_INSIGHTS_MAX_GENERATED_SQL_ROWS", 200),
    "request_timeout_seconds": env_int("AI_INSIGHTS_REQUEST_TIMEOUT_SECONDS", 30),
    "max_tokens": env_int("AI_INSIGHTS_MAX_TOKENS", 1200),
    "temperature": float(os.getenv("AI_INSIGHTS_TEMPERATURE", "0.1")),
    "default_provider": os.getenv("AI_INSIGHTS_DEFAULT_PROVIDER", next(iter(_AI_INSIGHTS_PROVIDERS), None)),
    "default_model": os.getenv("AI_INSIGHTS_DEFAULT_MODEL", None),
    "allowed_roles": env_json("AI_INSIGHTS_ALLOWED_ROLES", []),
    "mode_roles": env_json("AI_INSIGHTS_MODE_ROLES", {
        "chart": [],
        "dashboard": [],
        "sql": [],
    }),
    "providers": _AI_INSIGHTS_PROVIDERS,
}

# -----------------------------------------------------------------------------
# CSP / Talisman for DHIS2 maps and embeds
# -----------------------------------------------------------------------------
TALISMAN_ENABLED = env_bool("TALISMAN_ENABLED", True)

_default_csp = {
    "base-uri": ["'self'"],
    "default-src": ["'self'"],
    "img-src": [
        "'self'",
        "blob:",
        "data:",
        "https://a.basemaps.cartocdn.com",
        "https://b.basemaps.cartocdn.com",
        "https://c.basemaps.cartocdn.com",
        "https://tile.openstreetmap.org",
        "https://a.tile.openstreetmap.org",
        "https://b.tile.openstreetmap.org",
        "https://c.tile.openstreetmap.org",
        "https://tile.opentopomap.org",
        "https://a.tile.opentopomap.org",
        "https://b.tile.opentopomap.org",
        "https://c.tile.opentopomap.org",
        "https://server.arcgisonline.com",
        "https://apachesuperset.gateway.scarf.sh",
        "https://static.scarf.sh/",
        "https://cdn.document360.io",
    ],
    "worker-src": ["'self'", "blob:"],
    "connect-src": [
        "'self'",
        "https://a.basemaps.cartocdn.com",
        "https://b.basemaps.cartocdn.com",
        "https://c.basemaps.cartocdn.com",
        "https://tile.openstreetmap.org",
        "https://a.tile.openstreetmap.org",
        "https://b.tile.openstreetmap.org",
        "https://c.tile.openstreetmap.org",
        "https://tile.opentopomap.org",
        "https://a.tile.opentopomap.org",
        "https://b.tile.opentopomap.org",
        "https://c.tile.opentopomap.org",
        "https://server.arcgisonline.com",
        "https://api.mapbox.com",
        "https://events.mapbox.com",
        "https://unpkg.com",
    ],
    "object-src": ["'none'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
}
_CSP_CONFIG = {
    "content_security_policy": env_json("CONTENT_SECURITY_POLICY_JSON", _default_csp),
    "content_security_policy_nonce_in": env_json("CONTENT_SECURITY_POLICY_NONCE_IN", ["script-src"]),
    "force_https": env_bool("TALISMAN_FORCE_HTTPS", False),
    "session_cookie_secure": env_bool("SESSION_COOKIE_SECURE", False),
}

if os.getenv("WEBPACK_DEV_SERVER_URL"):
    _CSP_CONFIG["content_security_policy"]["connect-src"].extend([
        "ws://localhost:8081",
        "ws://localhost:8088",
        "ws://localhost:9000",
        "ws://localhost:9001",
    ])
TALISMAN_CONFIG = _CSP_CONFIG
TALISMAN_DEV_CONFIG = _CSP_CONFIG

# -----------------------------------------------------------------------------
# Cache / Redis
# -----------------------------------------------------------------------------
REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
REDIS_PORT = env_int("REDIS_PORT", 6379)

CACHE_CONFIG = env_json("CACHE_CONFIG_JSON", {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": env_int("CACHE_DEFAULT_TIMEOUT", 86400),
    "CACHE_KEY_PREFIX": os.getenv("CACHE_KEY_PREFIX", "superset_"),
    "CACHE_REDIS_URL": os.getenv("CACHE_REDIS_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/0"),
})

DATA_CACHE_CONFIG = env_json("DATA_CACHE_CONFIG_JSON", {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": env_int("DATA_CACHE_TIMEOUT", 86400),
    "CACHE_KEY_PREFIX": os.getenv("DATA_CACHE_KEY_PREFIX", "superset_data_"),
    "CACHE_REDIS_URL": os.getenv("DATA_CACHE_REDIS_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/1"),
})

FILTER_STATE_CACHE_CONFIG = env_json("FILTER_STATE_CACHE_CONFIG_JSON", {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": env_int("FILTER_STATE_CACHE_TIMEOUT", 86400),
    "CACHE_KEY_PREFIX": os.getenv("FILTER_STATE_CACHE_KEY_PREFIX", "superset_filter_state_"),
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
    "CACHE_REDIS_DB": env_int("FILTER_STATE_CACHE_REDIS_DB", 3),
})

EXPLORE_FORM_DATA_CACHE_CONFIG = env_json("EXPLORE_FORM_DATA_CACHE_CONFIG_JSON", {
    "CACHE_TYPE": "RedisCache",
    "CACHE_DEFAULT_TIMEOUT": env_int("EXPLORE_FORM_DATA_CACHE_TIMEOUT", 86400),
    "CACHE_KEY_PREFIX": os.getenv("EXPLORE_FORM_DATA_CACHE_KEY_PREFIX", "superset_explore_form_"),
    "CACHE_REDIS_HOST": REDIS_HOST,
    "CACHE_REDIS_PORT": REDIS_PORT,
    "CACHE_REDIS_DB": env_int("EXPLORE_FORM_DATA_CACHE_REDIS_DB", 4),
})

# Async query results backend: Redis preferred, filesystem fallback
if os.getenv("RESULTS_BACKEND_REDIS_URL"):
    RESULTS_BACKEND = RedisCache(
        host=REDIS_HOST,
        port=REDIS_PORT,
        db=env_int("RESULTS_BACKEND_REDIS_DB", 2),
        key_prefix=os.getenv("RESULTS_BACKEND_KEY_PREFIX", "superset_results_"),
    )
else:
    _RESULTS_BACKEND_DIR = os.getenv(
        "RESULTS_BACKEND_DIR",
        os.path.join(APP_DIR, "superset_home", "sqllab_results"),
    )
    os.makedirs(_RESULTS_BACKEND_DIR, exist_ok=True)
    RESULTS_BACKEND = FileSystemCache(
        cache_dir=_RESULTS_BACKEND_DIR,
        default_timeout=SQLLAB_ASYNC_TIME_LIMIT_SEC,
        threshold=env_int("RESULTS_BACKEND_THRESHOLD", 5000),
    )

RATELIMIT_STORAGE_URI = os.getenv(
    "RATELIMIT_STORAGE_URI",
    f"redis://{REDIS_HOST}:{REDIS_PORT}/6",
)

# -----------------------------------------------------------------------------
# Celery
# -----------------------------------------------------------------------------
class CeleryConfig:
    broker_url = os.getenv("CELERY_BROKER_URL", f"redis://{REDIS_HOST}:{REDIS_PORT}/2")
    result_backend = os.getenv("CELERY_RESULT_BACKEND", f"redis://{REDIS_HOST}:{REDIS_PORT}/2")
    task_serializer = os.getenv("CELERY_TASK_SERIALIZER", "json")
    accept_content = env_json("CELERY_ACCEPT_CONTENT", ["json"])
    result_serializer = os.getenv("CELERY_RESULT_SERIALIZER", "json")
    timezone = os.getenv("CELERY_TIMEZONE", "Africa/Kampala")
    enable_utc = env_bool("CELERY_ENABLE_UTC", True)
    worker_prefetch_multiplier = env_int("CELERY_WORKER_PREFETCH_MULTIPLIER", 1)
    task_acks_late = env_bool("CELERY_TASK_ACKS_LATE", True)
    task_annotations = env_json("CELERY_TASK_ANNOTATIONS", {
        "sql_lab.get_sql_results": {"rate_limit": "100/s"}
    })
    task_routes = env_json("CELERY_TASK_ROUTES", {
        "superset.tasks.dhis2_sync.*": {"queue": "dhis2"},
        "superset.tasks.dhis2_cache.*": {"queue": "dhis2"},
        "superset.tasks.dhis2_metadata.*": {"queue": "dhis2"},
        "dhis2.finalize_repository_org_units": {"queue": "dhis2"},
    })
    beat_schedule = {
        "dhis2-sync-scheduled": {
            "task": "superset.tasks.dhis2_sync.sync_all_scheduled_datasets",
            "schedule": crontab(minute=os.getenv("DHIS2_SYNC_CRON_MINUTE", "*/15")),
        },
        "reports.scheduler": {
            "task": "reports.scheduler",
            "schedule": crontab(
                minute=os.getenv("REPORTS_SCHEDULER_MINUTE", "*"),
                hour=os.getenv("REPORTS_SCHEDULER_HOUR", "*"),
            ),
        },
        "reports.prune_log": {
            "task": "reports.prune_log",
            "schedule": crontab(
                minute=env_int("REPORTS_PRUNE_MINUTE", 0),
                hour=env_int("REPORTS_PRUNE_HOUR", 0),
            ),
        },
    }

CELERY_CONFIG = CeleryConfig

# -----------------------------------------------------------------------------
# Public page configuration
# -----------------------------------------------------------------------------
PUBLIC_PAGE_CONFIG = env_json("PUBLIC_PAGE_CONFIG_JSON", {
    "navbar": {
        "enabled": True,
        "height": 60,
        "backgroundColor": "#ffffff",
        "boxShadow": "0 2px 8px rgba(0, 0, 0, 0.1)",
        "logo": {
            "enabled": True,
            "src": None,
            "alt": os.getenv("PUBLIC_NAVBAR_LOGO_ALT", "National Malaria Data Repository"),
            "height": 40,
        },
        "title": {
            "enabled": True,
            "text": os.getenv("PUBLIC_NAVBAR_TITLE", "National Malaria Data Repository"),
            "fontSize": "18px",
            "fontWeight": 700,
            "color": "#1890ff",
        },
        "loginButton": {
            "enabled": True,
            "text": os.getenv("PUBLIC_LOGIN_TEXT", "Login"),
            "url": os.getenv("PUBLIC_LOGIN_URL", "/login/"),
            "type": os.getenv("PUBLIC_LOGIN_TYPE", "primary"),
        },
        "customLinks": env_json("PUBLIC_NAVBAR_CUSTOM_LINKS", []),
    },
    "sidebar": {
        "enabled": True,
        "width": 280,
        "position": os.getenv("PUBLIC_SIDEBAR_POSITION", "left"),
        "backgroundColor": "#ffffff",
        "borderStyle": "1px solid #f0f0f0",
        "title": os.getenv("PUBLIC_SIDEBAR_TITLE", "Categories"),
        "collapsibleOnMobile": True,
        "mobileBreakpoint": 768,
    },
    "content": {
        "backgroundColor": "#f5f5f5",
        "padding": "0",
        "showWelcomeMessage": True,
        "welcomeTitle": os.getenv("PUBLIC_WELCOME_TITLE", "Welcome"),
        "welcomeDescription": os.getenv("PUBLIC_WELCOME_DESCRIPTION", "Select a category from the sidebar to view dashboards."),
    },
    "footer": {
        "enabled": True,
        "height": 50,
        "backgroundColor": "#fafafa",
        "text": os.getenv("PUBLIC_FOOTER_TEXT", "© 2026 Your Organization"),
        "textColor": "#666666",
        "links": env_json("PUBLIC_FOOTER_LINKS", [
            {"text": "Privacy Policy"},
            {"text": "Terms of Service"},
        ]),
    },
})

# -----------------------------------------------------------------------------
# DHIS2 cache / tuning
# -----------------------------------------------------------------------------
DHIS2_CACHE_REFRESH_INTERVAL = env_int("DHIS2_CACHE_REFRESH_INTERVAL", 21600)
DHIS2_CACHE_TTL = env_json("DHIS2_CACHE_TTL_JSON", {
    "geojson": env_int("DHIS2_CACHE_TTL_GEOJSON", 21600),
    "org_hierarchy": env_int("DHIS2_CACHE_TTL_ORG_HIERARCHY", 3600),
    "org_levels": env_int("DHIS2_CACHE_TTL_ORG_LEVELS", 7200),
    "analytics": env_int("DHIS2_CACHE_TTL_ANALYTICS", 1800),
    "filter_options": env_int("DHIS2_CACHE_TTL_FILTER_OPTIONS", 3600),
    "name_to_uid": env_int("DHIS2_CACHE_TTL_NAME_TO_UID", 3600),
})
DHIS2_CACHE_MAX_SIZE_MB = env_int("DHIS2_CACHE_MAX_SIZE_MB", 500)

# -----------------------------------------------------------------------------
# Theme administration / dark theme
# -----------------------------------------------------------------------------
ENABLE_UI_THEME_ADMINISTRATION = env_bool("ENABLE_UI_THEME_ADMINISTRATION", True)
THEME_DARK = env_json("THEME_DARK_JSON", {
    "algorithm": "dark",
    "token": {
        "colorPrimary": "#2893B3",
        "colorLink": "#2893B3",
        "colorError": "#e04355",
        "colorWarning": "#fcc700",
        "colorSuccess": "#5ac189",
        "colorInfo": "#66bcfe",
        "fontFamily": "Inter, Helvetica, Arial",
        "fontFamilyCode": "'Fira Code', 'Courier New', monospace",
        "transitionTiming": 0.3,
        "brandIconMaxWidth": 37,
        "fontSizeXS": "8",
        "fontSizeXXL": "28",
        "fontWeightNormal": "400",
        "fontWeightLight": "300",
        "fontWeightStrong": "500",
        "colorBgBase": "#111827",
    },
})

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FORMAT = os.getenv("LOG_FORMAT", "%(asctime)s:%(levelname)s:%(name)s:%(message)s")
LOG_FILE = os.getenv("SUPERSET_LOG_FILE", os.path.join(APP_DIR, "logs", "superset.log"))

PY
  chmod 640 "$SUPERSET_CONFIG_FILE" || true
  ok "superset_config.py written to $SUPERSET_CONFIG_FILE"
}


configure_ssl_server() {
  header "Configuring Let's Encrypt SSL"
  if [[ "${AUTO_SSL:-0}" != "1" && "${ENABLE_HTTPS:-0}" != "1" ]]; then
    info "Skipping Let's Encrypt SSL configuration"
    return 0
  fi
  if [[ -z "${DOMAIN:-}" || -z "${LETSENCRYPT_EMAIL:-}" ]]; then
    warn "Skipping Let's Encrypt SSL because DOMAIN or LETSENCRYPT_EMAIL is missing"
    return 0
  fi
  if ! command -v certbot >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      run_privileged "apt-get update -y >/dev/null 2>&1 || true"
      run_privileged "DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1 || true"
    fi
  fi
  if ! command -v certbot >/dev/null 2>&1; then
    warn "certbot not installed; skipping SSL setup"
    return 0
  fi
  local staging=""
  [[ "${LETSENCRYPT_STAGING:-0}" == "1" ]] && staging="--staging"
  run_privileged "certbot --nginx -d '${DOMAIN}' --non-interactive --agree-tos -m '${LETSENCRYPT_EMAIL}' ${staging} --redirect" || warn "Let's Encrypt setup did not complete successfully"
  ok "Let's Encrypt SSL configuration attempted"
}


patch_metadata_db_schema_for_dhis2() {
  [[ "$POSTGRES_ENABLED" == "1" ]] || return 0
  info "Patching metadata DB schema for DHIS2 custom columns"

  local psql_prefix=""
  if [[ ${EUID} -eq 0 ]]; then
    psql_prefix="sudo -u postgres"
  else
    psql_prefix="sudo -n -u postgres"
  fi

  local has_dbs
  has_dbs="$($psql_prefix psql -d "$POSTGRES_DB" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='dbs' LIMIT 1;" 2>/dev/null || true)"
  if [[ "$has_dbs" != "1" ]]; then
    ok "Metadata DB schema patch skipped (table dbs not created yet)"
    return 0
  fi

  $psql_prefix psql -v ON_ERROR_STOP=1 -d "$POSTGRES_DB" <<'SQL' >/dev/null
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS is_dhis2_staging_internal BOOLEAN DEFAULT FALSE;
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_reporting_unit_approach VARCHAR(255);
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS lowest_data_level_to_use VARCHAR(255);
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS primary_instance_id INTEGER;
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_data_scope VARCHAR(255);
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_org_unit_config_json JSONB;
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_org_unit_status VARCHAR(255);
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_org_unit_status_message TEXT;
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_org_unit_task_id VARCHAR(255);
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_org_unit_last_finalized_at TIMESTAMPTZ;
SQL

  ok "Metadata DB schema patch applied"
}



superset_db_upgrade_once_server() {
  local log_file="${1:-$LOG_DIR/superset-db-upgrade.log}"
  mkdir -p "$LOG_DIR"
  : > "$log_file"
  info "Running: superset db upgrade"
  set +e
  bash -lc '
    set -a
    source "'"$ENV_FILE"'"
    set +a
    export SUPERSET_CONFIG_PATH="'"$SUPERSET_CONFIG_FILE"'"
    cd "'"$INSTALL_DIR"'"
    "'"$INSTALL_DIR"'/venv/bin/superset" db upgrade
  ' 2>&1 | tee -a "$log_file"
  local rc="${PIPESTATUS[0]}"
  set -e
  if [[ "$rc" -ne 0 ]]; then
    err "superset db upgrade failed. See $log_file"
    return "$rc"
  fi
  ok "superset db upgrade complete"
  return 0
}

patch_dhis2_dbs_columns_now_server() {
  [[ "${POSTGRES_ENABLED:-1}" == "1" ]] || return 0
  info "Ensuring DHIS2 custom dbs columns exist now"
  local has_dbs=""
  has_dbs="$(sudo -u postgres psql -d "${POSTGRES_DB:-superset}" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='dbs' LIMIT 1;" 2>/dev/null || true)"
  if [[ "$has_dbs" != "1" ]]; then
    warn "dbs table does not exist yet; skipping DHIS2 dbs column patch for now"
    return 0
  fi

  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${POSTGRES_DB:-superset}" <<'SQL' >/dev/null
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS is_dhis2_staging_internal BOOLEAN DEFAULT FALSE;
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_reporting_unit_approach VARCHAR(255);
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS lowest_data_level_to_use VARCHAR(255);
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS primary_instance_id INTEGER;
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_data_scope VARCHAR(255);
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_org_unit_config_json JSONB;
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_org_unit_status VARCHAR(255);
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_org_unit_status_message TEXT;
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_org_unit_task_id VARCHAR(255);
ALTER TABLE public.dbs ADD COLUMN IF NOT EXISTS repository_org_unit_last_finalized_at TIMESTAMPTZ;
SQL

  ok "DHIS2 custom dbs columns ensured"
}

superset_db_upgrade_with_dhis2_retry_server() {
  local log_file="$LOG_DIR/superset-db-upgrade.log"
  if superset_db_upgrade_once_server "$log_file"; then
    ok "superset db upgrade complete"
    return 0
  fi

  warn "superset db upgrade failed on first attempt; patching DHIS2 dbs columns and retrying"
  patch_dhis2_dbs_columns_now_server || return $?

  if superset_db_upgrade_once_server "$log_file"; then
    ok "superset db upgrade complete after DHIS2 dbs column patch"
    return 0
  fi

  err "superset db upgrade failed after retry. See $log_file"
  return 1
}

superset_create_admin_server() {
  info "Running: superset fab create-admin"
  set +e
  bash -lc '
    set -a
    source "'"$ENV_FILE"'"
    set +a
    export SUPERSET_CONFIG_PATH="'"$SUPERSET_CONFIG_FILE"'"
    cd "'"$INSTALL_DIR"'"
    "'"$INSTALL_DIR"'/venv/bin/superset" fab create-admin \
      --username "${ADMIN_USERNAME:-admin}" \
      --firstname "${ADMIN_FIRSTNAME:-Admin}" \
      --lastname "${ADMIN_LASTNAME:-User}" \
      --email "${ADMIN_EMAIL}" \
      --password "${ADMIN_PASSWORD}"
  '
  local rc=$?
  set -e
  if [[ "$rc" -ne 0 ]]; then
    warn "superset fab create-admin returned non-zero (likely because the user already exists); continuing"
  else
    ok "superset fab create-admin complete"
  fi
  return 0
}

superset_init_once_server() {
  info "Running: superset init"
  local log_file="${LOG_DIR:-$INSTALL_DIR/logs}/superset-init.log"
  mkdir -p "$(dirname "$log_file")"
  : > "$log_file"

  set +e
  bash -lc '
    set -a
    source "'"$ENV_FILE"'"
    set +a
    export SUPERSET_CONFIG_PATH="'"$SUPERSET_CONFIG_FILE"'"
    cd "'"$INSTALL_DIR"'"
    "'"$INSTALL_DIR"'/venv/bin/superset" init
  ' 2>&1 | tee -a "$log_file"
  local rc="${PIPESTATUS[0]}"
  set -e

  if [[ "$rc" -ne 0 ]] && grep -q "Invalid decryption key" "$log_file" 2>/dev/null; then
    if [[ "${RESET_ENCRYPTED_DATABASE_SECRETS_ON_KEY_MISMATCH:-1}" == "1" ]]; then
      warn "Detected invalid decryption key during superset init; preserving current SECRET_KEY going forward and resetting encrypted database secrets once"
      reset_invalid_database_secrets_server || return $?

      : > "$log_file"
      set +e
      bash -lc '
        set -a
        source "'"$ENV_FILE"'"
        set +a
        export SUPERSET_CONFIG_PATH="'"$SUPERSET_CONFIG_FILE"'"
        cd "'"$INSTALL_DIR"'"
        "'"$INSTALL_DIR"'/venv/bin/superset" init
      ' 2>&1 | tee -a "$log_file"
      rc="${PIPESTATUS[0]}"
      set -e
    fi
  fi

  if [[ "$rc" -ne 0 ]]; then
    err "superset init failed"
    return "$rc"
  fi
  ok "superset init complete"
  return 0
}


patch_problematic_postgres_migrations_server() {
  info "Patching known problematic migrations for PostgreSQL deployment"

  local mig1="$INSTALL_DIR/superset/migrations/versions/2024-05-01_10-52_58d051681a3b_add_catalog_perm_to_tables.py"
  if [[ -f "$mig1" ]]; then
    python3 - "$mig1" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

old1 = '    upgrade_catalog_perms(engines={"postgresql"})'
old2 = """    try:
        upgrade_catalog_perms(engines={\"postgresql\"})
    except Exception as ex:
        print(f\"[migration patch] temporarily skipping upgrade_catalog_perms on PostgreSQL bootstrap: {ex}\")"""
new = '    print("[migration patch] skipping upgrade_catalog_perms on PostgreSQL bootstrap")'

changed = False
if old2 in s:
    s = s.replace(old2, new, 1)
    changed = True
elif old1 in s:
    s = s.replace(old1, new, 1)
    changed = True

if changed:
    p.write_text(s)
PY
  fi

  ok "Problematic PostgreSQL bootstrap migrations patched"
}


assert_superset_core_tables_server() {
  [[ "${POSTGRES_ENABLED:-1}" == "1" ]] || return 0
  local missing=""
  missing="$(sudo -u postgres psql -d "${POSTGRES_DB:-superset}" -tAc "
SELECT string_agg(tbl, ',')
FROM (
  SELECT unnest(ARRAY['alembic_version','dbs','tables','slices','dashboards']) AS tbl
) x
WHERE NOT EXISTS (
  SELECT 1
  FROM information_schema.tables
  WHERE table_schema='public' AND table_name=x.tbl
);" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -n "$missing" && "$missing" != "" ]]; then
    err "Superset core tables are still missing after migration: $missing"
    return 1
  fi
  ok "Superset core tables verified"
}



ensure_alembic_version_table_server() {
  ensure_postgres_role_and_database_server || return $?

  [[ "${POSTGRES_ENABLED:-1}" == "1" ]] || return 0
  info "Ensuring alembic_version table exists with wide version_num and correct ownership"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${POSTGRES_DB:-superset}" <<SQL >/dev/null
CREATE TABLE IF NOT EXISTS public.alembic_version (
  version_num VARCHAR(255) NOT NULL PRIMARY KEY
);
ALTER TABLE public.alembic_version
  ALTER COLUMN version_num TYPE VARCHAR(255);
ALTER TABLE public.alembic_version
  OWNER TO "${POSTGRES_USER:-superset}";
GRANT ALL PRIVILEGES ON TABLE public.alembic_version TO "${POSTGRES_USER:-superset}";
SQL
  ok "alembic_version table prepared"
}

ensure_alembic_version_width_server() {
  ensure_postgres_role_and_database_server || return $?

  [[ "${POSTGRES_ENABLED:-1}" == "1" ]] || return 0
  ensure_alembic_version_table_server || return $?
  info "Ensuring alembic_version.version_num is wide enough for long revision IDs"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${POSTGRES_DB:-superset}" <<SQL >/dev/null
ALTER TABLE public.alembic_version
  ALTER COLUMN version_num TYPE VARCHAR(255);
ALTER TABLE public.alembic_version
  OWNER TO "${POSTGRES_USER:-superset}";
GRANT ALL PRIVILEGES ON TABLE public.alembic_version TO "${POSTGRES_USER:-superset}";
SQL
  ok "alembic_version width checked"
}


superset_db_upgrade_with_recovery_server() {
  ensure_postgres_role_and_database_server || return $?

  local log_file="${1:-$LOG_DIR/superset-db-upgrade.log}"

  ensure_alembic_version_table_server || return $?
  ensure_alembic_version_width_server || return $?
  if superset_db_upgrade_once_server "$log_file"; then
    return 0
  fi

  if grep -q "value too long for type character varying(32)" "$log_file" 2>/dev/null; then
    warn "Detected alembic_version width failure; creating/widening version table and retrying"
    ensure_alembic_version_table_server || return $?
    ensure_alembic_version_width_server || return $?
    if superset_db_upgrade_once_server "$log_file"; then
      return 0
    fi
  fi

  if grep -q "column dbs.is_dhis2_staging_internal does not exist" "$log_file" 2>/dev/null; then
    warn "Detected missing DHIS2 dbs columns during migration; patching and retrying"
    patch_dhis2_dbs_columns_now_server || return $?
    ensure_alembic_version_table_server || return $?
    ensure_alembic_version_width_server || return $?
    if superset_db_upgrade_once_server "$log_file"; then
      return 0
    fi
  fi

  if grep -q "Can't locate revision identified by '2026_04_02_push_analysis_enhancements'" "$log_file" 2>/dev/null; then
    warn "Detected missing custom alembic revision 2026_04_02_push_analysis_enhancements; restamping to 2026_04_01_ai_conversations_and_usage and retrying"
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${POSTGRES_DB:-superset}" \
      -c "UPDATE public.alembic_version SET version_num='2026_04_01_ai_conversations_and_usage' WHERE version_num='2026_04_02_push_analysis_enhancements';" \
      >/dev/null
    ensure_alembic_version_table_server || return $?
    ensure_alembic_version_width_server || return $?
    if superset_db_upgrade_once_server "$log_file"; then
      return 0
    fi
  fi

  return 1
}


stop_superset_services_before_upgrade_server() {
  info "Stopping Superset services before database upgrade"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop superset-web 2>/dev/null || true
    systemctl stop superset-worker 2>/dev/null || true
    systemctl stop superset-beat 2>/dev/null || true
  fi

  pkill -f "/srv/apps/superset/venv/bin/gunicorn" 2>/dev/null || true
  pkill -f "celery.*superset" 2>/dev/null || true

  if [[ "${POSTGRES_ENABLED:-1}" == "1" ]]; then
    sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${POSTGRES_DB:-superset}' AND pid <> pg_backend_pid();" \
      >/dev/null 2>&1 || true
  fi

  ok "Superset services quiesced for migration"
}


patch_deadlock_prone_postgres_migrations_server() {
  info "Patching known deadlock-prone migrations for PostgreSQL deployment"

  local mig="$INSTALL_DIR/superset/migrations/versions/2023-09-15_12-58_4b85906e5b91_add_on_delete_cascade_for_dashboard_roles.py"
  if [[ -f "$mig" ]]; then
    python3 - "$mig" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

old = """def upgrade():
    for foreign_key in foreign_keys:
        redefine(foreign_key, on_delete="CASCADE")"""
new = """def upgrade():
    print("[migration patch] skipping dashboard_roles cascade rewrite on PostgreSQL bootstrap")"""

if old in s and new not in s:
    s = s.replace(old, new, 1)
    p.write_text(s)
PY
  fi

  ok "Deadlock-prone PostgreSQL bootstrap migrations patched"
}


repair_alembic_version_privileges_server() {
  ensure_postgres_role_and_database_server || return $?

  [[ "${POSTGRES_ENABLED:-1}" == "1" ]] || return 0
  info "Repairing alembic_version ownership and privileges"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "${POSTGRES_DB:-superset}" <<'SQL' >/dev/null
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema='public' AND table_name='alembic_version'
  ) THEN
    ALTER TABLE public.alembic_version OWNER TO superset;
    GRANT ALL PRIVILEGES ON TABLE public.alembic_version TO superset;
  END IF;
END
$$;
SQL
  ok "alembic_version ownership and privileges repaired"
}


patch_boolean_sql_postgres_migrations_server() {
  info "Patching PostgreSQL boolean SQL in latest repo migrations"

  local mig="$INSTALL_DIR/superset/migrations/versions/2026_03_20_public_portal_cms_admin_v2.py"
  if [[ -f "$mig" ]]; then
    python3 - "$mig" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

old = "WHERE is_published = 1 AND published_on IS NULL"
new = "WHERE is_published IS TRUE AND published_on IS NULL"

if old in s and new not in s:
    s = s.replace(old, new, 1)
    p.write_text(s)
PY
  fi

  ok "PostgreSQL boolean SQL migrations patched"
}


patch_identifier_length_postgres_migrations_server() {
  info "Patching PostgreSQL identifier-length issues in latest repo migrations"

  local mig="$INSTALL_DIR/superset/migrations/versions/2026_03_21_public_portal_design_system_v3.py"
  if [[ -f "$mig" ]]; then
    python3 - "$mig" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

replacements = {
    "fk_public_pages_theme_id_public_cms_themes": "fk_pub_pages_theme_id",
    "fk_public_pages_template_id_public_cms_templates": "fk_pub_pages_template_id",
    "fk_public_pages_style_bundle_id_public_cms_style_bundles": "fk_pub_pages_style_bundle_id",
    "fk_public_page_sections_style_bundle_id_public_cms_style_bundles": "fk_pub_page_sections_style_bundle_id",
    "fk_public_page_components_style_bundle_id_public_cms_style_bundles": "fk_pub_page_components_style_bundle_id",
}

changed = False
for old, new in replacements.items():
    if old in s:
        s = s.replace(old, new)
        changed = True

if changed:
    p.write_text(s)
PY
  fi

  ok "PostgreSQL identifier-length migrations patched"
}


patch_boolean_assignment_postgres_migrations_server() {
  info "Patching PostgreSQL boolean assignment SQL in latest repo migrations"

  local mig="$INSTALL_DIR/superset/migrations/versions/2026-03-27_00-06_87fd02a1b791_disable_sqllab_for_dhis2.py"
  if [[ -f "$mig" ]]; then
    python3 - "$mig" <<'PY'
from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()

replacements = {
    "UPDATE dbs SET expose_in_sqllab = 0 WHERE sqlalchemy_uri LIKE 'dhis2%'":
        "UPDATE dbs SET expose_in_sqllab = FALSE WHERE sqlalchemy_uri LIKE 'dhis2%'",
    "UPDATE dbs SET expose_in_sqllab = 1 WHERE sqlalchemy_uri LIKE 'dhis2%'":
        "UPDATE dbs SET expose_in_sqllab = TRUE WHERE sqlalchemy_uri LIKE 'dhis2%'",
}

changed = False
for old, new in replacements.items():
    if old in s and new not in s:
        s = s.replace(old, new)
        changed = True

if changed:
    p.write_text(s)
PY
  fi

  ok "PostgreSQL boolean assignment migrations patched"
}


verify_clickhouse_runtime_server() {
  [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
  info "Verifying ClickHouse runtime connectivity"

  curl -fsS "http://127.0.0.1:${CLICKHOUSE_HTTP_PORT}/ping" >/dev/null
  "$VENV_DIR/bin/python" - <<PY
import clickhouse_connect
client = clickhouse_connect.get_client(
    host="${CLICKHOUSE_HOST}",
    port=int("${CLICKHOUSE_HTTP_PORT}"),
    username="${CLICKHOUSE_USER}",
    password="${CLICKHOUSE_PASSWORD}",
    database="${CLICKHOUSE_STAGING_DATABASE}",
)
print("CLICKHOUSE_OK", client.query("SELECT version()").result_rows[0][0])
PY

  ok "ClickHouse runtime connectivity verified"
}

initialize_superset_server() {
  header "Initializing Superset application"
  info "Initializing Superset"

  mkdir -p "$LOG_DIR" "$RUN_DIR" "$DATA_DIR"

  stop_superset_services_before_upgrade_server || return $?
  ensure_postgres_role_and_database_server || return $?
  ensure_alembic_version_table_server || return $?
  repair_alembic_version_privileges_server || return $?
  patch_problematic_postgres_migrations_server || return $?
  patch_deadlock_prone_postgres_migrations_server || return $?
  patch_boolean_sql_postgres_migrations_server || return $?
  patch_identifier_length_postgres_migrations_server || return $?
  patch_boolean_assignment_postgres_migrations_server || return $?

  superset_db_upgrade_with_recovery_server "$LOG_DIR/superset-db-upgrade.log" || return $?

  patch_dhis2_dbs_columns_now_server || return $?
  ensure_alembic_version_table_server || return $?
  repair_alembic_version_privileges_server || return $?
  ensure_alembic_version_width_server || return $?

  superset_db_upgrade_with_recovery_server "$LOG_DIR/superset-db-upgrade.log" || return $?

  assert_superset_core_tables_server || return $?

  superset_create_admin_server || return $?
  superset_init_once_server || return $?

  ok "Superset initialized"
}

start_services_server() {
  sudo rm -f "${RUN_DIR}/celerybeat-schedule" "${RUN_DIR}/celerybeat.pid" "${INSTALL_DIR}/celerybeat-schedule" || true
  sudo chown -R "${REMOTE_APP_USER:-superset}:${REMOTE_APP_USER:-superset}" "${RUN_DIR}" "${LOG_DIR}" || true
  sudo systemctl restart superset-web superset-worker superset-beat nginx redis-server postgresql
  ok "Services started"
}
stop_services_server() {
  sudo systemctl stop superset-web superset-worker superset-beat || true
  ok "Services stopped"
}
restart_services_server() {
  sudo rm -f "${RUN_DIR}/celerybeat-schedule" "${RUN_DIR}/celerybeat.pid" "${INSTALL_DIR}/celerybeat-schedule" || true
  sudo chown -R "${REMOTE_APP_USER:-superset}:${REMOTE_APP_USER:-superset}" "${RUN_DIR}" "${LOG_DIR}" || true
  sudo systemctl restart superset-web superset-worker superset-beat nginx redis-server postgresql
  ok "Services restarted"
}
show_status_server() {
  echo "Resources: CPU=${CPU_CORES:-?} RAM=${TOTAL_MEM_MB:-?}MB DISK=${ROOT_DISK_GB:-?}GB"
  echo "Gunicorn: workers=${GUNICORN_WORKERS:-?} threads=${GUNICORN_THREADS:-?} timeout=${GUNICORN_TIMEOUT:-?}"
  echo "Celery: concurrency=${CELERY_CONCURRENCY:-?}"
  echo "PostgreSQL: shared_buffers=${PG_SHARED_BUFFERS_MB:-?}MB effective_cache=${PG_EFFECTIVE_CACHE_MB:-?}MB work_mem=${PG_WORK_MEM_MB:-?}MB"
  echo "Redis: maxmemory=${REDIS_MAXMEMORY_MB:-?}MB"
  echo "Checking service states..."
  sudo systemctl is-active superset-web || true
  sudo systemctl is-active superset-worker || true
  sudo systemctl is-active superset-beat || true
  sudo systemctl is-active nginx || true
  sudo systemctl is-active redis-server || true
  sudo systemctl is-active postgresql || true
  sudo systemctl is-active clickhouse-server || true
  sudo systemctl --no-pager --full status superset-web superset-worker superset-beat nginx redis-server postgresql clickhouse-server || true
  if command -v curl >/dev/null 2>&1; then
    curl -sf "http://127.0.0.1:${CLICKHOUSE_HTTP_PORT:-8123}/ping" >/dev/null 2>&1 && echo "ClickHouse HTTP ping: OK" || echo "ClickHouse HTTP ping: FAILED"
  fi
  if [[ -f "${ENV_FILE}" && -x "${VENV_DIR}/bin/celery" ]]; then
    set +e
    (
      set -a
      . "${ENV_FILE}"
      set +a
      export SUPERSET_CONFIG_PATH="${SUPERSET_CONFIG_FILE}"
      export FLASK_APP=superset
      "${VENV_DIR}/bin/celery" --app=superset.tasks.celery_app:app inspect ping
    ) || true
    set -e
  fi
}

show_runtime_paths() {
  cat <<EOF
Superset runtime paths
  Install dir         : ${INSTALL_DIR}
  Env file            : ${ENV_FILE}
  Config file         : ${SUPERSET_CONFIG_FILE}
  Frontend build log  : ${FRONTEND_BUILD_LOG_FILE:-$INSTALL_DIR/logs/frontend-build.log}
  Gunicorn log        : ${GUNICORN_LOG}
  ClickHouse HTTP     : http://${CLICKHOUSE_HOST}:${CLICKHOUSE_HTTP_PORT}
  ClickHouse DBs      : ${CLICKHOUSE_STAGING_DATABASE}, ${CLICKHOUSE_SERVING_DATABASE}, ${CLICKHOUSE_CONTROL_DATABASE}
EOF
}


configure_firewall_server() {
  header "Configuring firewall"
  if [[ "${CONFIGURE_FIREWALL:-1}" != "1" ]]; then
    info "Skipping firewall configuration"
    return 0
  fi

  info "Configuring UFW rules"
  if ! command -v ufw >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      run_privileged "apt-get update -y >/dev/null 2>&1 || true"
      run_privileged "DEBIAN_FRONTEND=noninteractive apt-get install -y ufw >/dev/null 2>&1 || true"
    fi
  fi

  if command -v ufw >/dev/null 2>&1; then
    run_privileged "ufw allow 22/tcp >/dev/null 2>&1 || true"
    run_privileged "ufw allow 80/tcp >/dev/null 2>&1 || true"
    run_privileged "ufw allow 443/tcp >/dev/null 2>&1 || true"
    if [[ "${EXPOSE_SUPERSET_PORT:-0}" == "1" ]]; then
      run_privileged "ufw allow ${SUPERSET_PORT:-8088}/tcp >/dev/null 2>&1 || true"
    fi
    if [[ "${EXPOSE_POSTGRES_PORT:-0}" == "1" ]]; then
      run_privileged "ufw allow ${POSTGRES_PORT:-5432}/tcp >/dev/null 2>&1 || true"
    fi
    if [[ "${EXPOSE_REDIS_PORT:-0}" == "1" ]]; then
      run_privileged "ufw allow ${REDIS_PORT:-6379}/tcp >/dev/null 2>&1 || true"
    fi
    if [[ "${EXPOSE_CLICKHOUSE_HTTP:-0}" == "1" ]]; then
      run_privileged "ufw allow ${CLICKHOUSE_HTTP_PORT:-8123}/tcp >/dev/null 2>&1 || true"
    fi
    if [[ "${EXPOSE_CLICKHOUSE_NATIVE:-0}" == "1" ]]; then
      run_privileged "ufw allow ${CLICKHOUSE_NATIVE_PORT:-9000}/tcp >/dev/null 2>&1 || true"
    fi
    run_privileged "ufw --force enable >/dev/null 2>&1 || true"
    ok "Firewall configured (SSH 22, HTTP 80, HTTPS 443, optional service ports)"
  else
    warn "UFW not installed; skipping firewall configuration"
  fi
}

configure_nginx_server() {
  header "Configuring Nginx reverse proxy"
  info "Configuring Nginx reverse proxy"

  if ! command -v nginx >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then
      run_privileged "apt-get update -y >/dev/null 2>&1 || true"
      run_privileged "DEBIAN_FRONTEND=noninteractive apt-get install -y nginx >/dev/null 2>&1 || true"
    fi
  fi

  local server_name="${DOMAIN:-_}"
  local nginx_site="${NGINX_SITE:-/etc/nginx/sites-available/${APP_NAME:-superset}}"
  local nginx_link="/etc/nginx/sites-enabled/$(basename "$nginx_site")"
  local superset_port="${SUPERSET_PORT:-8088}"

  run_privileged "mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled"

  run_privileged "cat > '$nginx_site' <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name ${server_name};

    client_max_body_size 100m;

    location / {
        proxy_pass http://127.0.0.1:${superset_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_read_timeout 300;
        proxy_connect_timeout 60;
        proxy_send_timeout 300;
    }
}
EOF"

  run_privileged "ln -sf '$nginx_site' '$nginx_link'"
  run_privileged "rm -f /etc/nginx/sites-enabled/default || true"
  run_privileged "nginx -t"
  if command -v systemctl >/dev/null 2>&1; then
    run_privileged "systemctl enable nginx >/dev/null 2>&1 || true"
    run_privileged "systemctl restart nginx"
  else
    run_privileged "nginx -s reload || nginx"
  fi

  ok "Nginx configured and restarted"
}


ensure_clickhouse_env_vars() {
  [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
  info "Ensuring ClickHouse env vars in $ENV_FILE"
  python3 - "$ENV_FILE" <<'PY'
from pathlib import Path
import shlex, sys

env_file = Path(sys.argv[1])
existing = {}
if env_file.exists():
    for line in env_file.read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        existing[k.strip()] = v

updates = {
    "DHIS2_SERVING_ENGINE": "clickhouse",
    "DHIS2_CLICKHOUSE_ENABLED": "true",
    "DHIS2_CLICKHOUSE_HOST": "'"${CLICKHOUSE_HOST}"'",
    "DHIS2_CLICKHOUSE_PORT": "'"${CLICKHOUSE_NATIVE_PORT}"'",
    "DHIS2_CLICKHOUSE_HTTP_PORT": "'"${CLICKHOUSE_HTTP_PORT}"'",
    "DHIS2_CLICKHOUSE_DATABASE": "'"${CLICKHOUSE_STAGING_DATABASE}"'",
    "DHIS2_CLICKHOUSE_SERVING_DATABASE": "'"${CLICKHOUSE_SERVING_DATABASE}"'",
    "DHIS2_CLICKHOUSE_CONTROL_DATABASE": "'"${CLICKHOUSE_CONTROL_DATABASE}"'",
    "DHIS2_CLICKHOUSE_USER": "'"${CLICKHOUSE_USER}"'",
    "DHIS2_CLICKHOUSE_PASSWORD": "'"${CLICKHOUSE_PASSWORD}"'",
    "DHIS2_CLICKHOUSE_SECURE": "false",
    "DHIS2_CLICKHOUSE_HTTP_PROTOCOL": "http",
    "DHIS2_CLICKHOUSE_SUPERSET_DB_NAME": "'"${CLICKHOUSE_SUPERSET_DB_NAME}"'",
    "DHIS2_CLICKHOUSE_REFRESH_STRATEGY": "versioned_view_swap",
    "DHIS2_CLICKHOUSE_KEEP_OLD_VERSIONS": "2",
}
for k, raw in updates.items():
    existing[k] = shlex.quote(raw)

lines = []
seen = set()
if env_file.exists():
    for line in env_file.read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
            lines.append(line)
            continue
        k = line.split('=', 1)[0].strip()
        if k in updates:
            lines.append(f"{k}={existing[k]}")
            seen.add(k)
        else:
            lines.append(line)

for k in updates:
    if k not in seen and not any(l.startswith(f"{k}=") for l in lines):
        lines.append(f"{k}={existing[k]}")

env_file.write_text("\n".join(lines).rstrip() + "\n", encoding='utf-8')
PY
  ok "ClickHouse env vars ensured"
}

install_clickhouse() {
  [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
  info "Installing ClickHouse if missing"

  if command -v clickhouse-server >/dev/null 2>&1; then
    ok "ClickHouse already installed"
    clickhouse-server --version 2>/dev/null | head -1 || true
    return 0
  fi

  run_privileged "apt-get update"
  run_privileged "DEBIAN_FRONTEND=noninteractive apt-get install -y apt-transport-https ca-certificates curl gnupg"

  run_privileged "rm -f /usr/share/keyrings/clickhouse-keyring.gpg"
  run_privileged "bash -lc \"curl -fsSL 'https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key' | gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg\""

  run_privileged "bash -lc 'ARCH=\$(dpkg --print-architecture); echo \"deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg arch=\${ARCH}] https://packages.clickhouse.com/deb stable main\" > /etc/apt/sources.list.d/clickhouse.list'"

  run_privileged "apt-get update"
  run_privileged "DEBIAN_FRONTEND=noninteractive apt-get install -y clickhouse-server clickhouse-client"

  ok "ClickHouse installation complete"
  clickhouse-server --version 2>/dev/null | head -1 || true
}

start_clickhouse() {
  [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
  info "Starting and enabling ClickHouse"

  command -v clickhouse-server >/dev/null 2>&1 || die "clickhouse-server not found; run install_clickhouse first"

  if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files clickhouse-server.service >/dev/null 2>&1; then
    run_privileged "systemctl enable clickhouse-server >/dev/null 2>&1 || true"
    run_privileged "systemctl restart clickhouse-server"
  elif command -v service >/dev/null 2>&1; then
    run_privileged "service clickhouse-server restart"
  else
    run_privileged "clickhouse-server --daemon --config-file=/etc/clickhouse-server/config.xml || true"
  fi

  local tries=0
  while ! curl -sf "http://127.0.0.1:${CLICKHOUSE_HTTP_PORT}/ping" >/dev/null 2>&1; do
    tries=$((tries + 1))
    if [[ "$tries" -ge 30 ]]; then
      warn "ClickHouse did not respond on HTTP port ${CLICKHOUSE_HTTP_PORT}; checking service state"
      command -v systemctl >/dev/null 2>&1 && run_privileged "systemctl --no-pager -l status clickhouse-server || true"
      die "ClickHouse did not start in 30s"
    fi
    sleep 1
  done
  ok "ClickHouse server ready"
}

setup_clickhouse_dbs() {
  [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
  info "Bootstrapping ClickHouse databases and user"

  command -v clickhouse-client >/dev/null 2>&1 || die "clickhouse-client not found"

  run_privileged "clickhouse-client --multiquery <<SQL
CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_STAGING_DATABASE};
CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_SERVING_DATABASE};
CREATE DATABASE IF NOT EXISTS ${CLICKHOUSE_CONTROL_DATABASE};
CREATE USER IF NOT EXISTS ${CLICKHOUSE_USER} IDENTIFIED BY '${CLICKHOUSE_PASSWORD}';
ALTER USER ${CLICKHOUSE_USER} IDENTIFIED BY '${CLICKHOUSE_PASSWORD}';
GRANT ALL ON ${CLICKHOUSE_STAGING_DATABASE}.* TO ${CLICKHOUSE_USER};
GRANT ALL ON ${CLICKHOUSE_SERVING_DATABASE}.* TO ${CLICKHOUSE_USER};
GRANT ALL ON ${CLICKHOUSE_CONTROL_DATABASE}.* TO ${CLICKHOUSE_USER};
GRANT SELECT ON system.tables TO ${CLICKHOUSE_USER};
GRANT SELECT ON system.columns TO ${CLICKHOUSE_USER};
GRANT SELECT ON system.parts TO ${CLICKHOUSE_USER};
SQL"

  ok "ClickHouse bootstrap complete"
}

install_clickhouse_python_package() {
  [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
  info "Installing ClickHouse Python package"
  venv_activate
  "$VENV_DIR/bin/pip" install -U "${CLICKHOUSE_PYTHON_PACKAGE}"

  "$VENV_DIR/bin/python" - <<PY
import sys
try:
    import clickhouse_connect
    client = clickhouse_connect.get_client(
        host='${CLICKHOUSE_HOST}',
        port=${CLICKHOUSE_HTTP_PORT},
        username='${CLICKHOUSE_USER}',
        password='${CLICKHOUSE_PASSWORD}',
    )
    result = client.query('SELECT version()')
    print('CLICKHOUSE_CONNECT_OK', result.result_rows[0][0])
except Exception as e:
    print(f'CLICKHOUSE_CONNECT_WARN: {e}', file=sys.stderr)
    sys.exit(0)
PY

  ok "ClickHouse Python package installed"
}

sync_superset_clickhouse_config_server() {
  [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
  info "Syncing ClickHouse credentials into Superset local_staging_settings"

  source_runtime_env
  "$VENV_DIR/bin/python" - <<PY
import os, sys
sys.path.insert(0, "${INSTALL_DIR}")
os.environ.setdefault("FLASK_APP", "superset")
from superset import create_app, db
from superset.local_staging.platform_settings import LocalStagingSettings

app = create_app()
with app.app_context():
    s = LocalStagingSettings.get()
    cfg = s.get_clickhouse_config() or {}
    cfg.update({
        "host": os.environ.get("DHIS2_CLICKHOUSE_HOST", "${CLICKHOUSE_HOST}"),
        "http_port": int(os.environ.get("DHIS2_CLICKHOUSE_HTTP_PORT", "${CLICKHOUSE_HTTP_PORT}")),
        "port": int(os.environ.get("DHIS2_CLICKHOUSE_PORT", "${CLICKHOUSE_NATIVE_PORT}")),
        "database": os.environ.get("DHIS2_CLICKHOUSE_DATABASE", "${CLICKHOUSE_STAGING_DATABASE}"),
        "serving_database": os.environ.get("DHIS2_CLICKHOUSE_SERVING_DATABASE", "${CLICKHOUSE_SERVING_DATABASE}"),
        "control_database": os.environ.get("DHIS2_CLICKHOUSE_CONTROL_DATABASE", "${CLICKHOUSE_CONTROL_DATABASE}"),
        "user": os.environ.get("DHIS2_CLICKHOUSE_USER", "${CLICKHOUSE_USER}"),
        "password": os.environ.get("DHIS2_CLICKHOUSE_PASSWORD", "${CLICKHOUSE_PASSWORD}"),
        "secure": os.environ.get("DHIS2_CLICKHOUSE_SECURE", "false").lower() == "true",
        "verify": True,
        "connect_timeout": 10,
        "send_receive_timeout": 300,
    })
    s.set_clickhouse_config(cfg)
    s.active_engine = "clickhouse"
    db.session.commit()
    print("CONFIG_SYNC_OK", cfg["user"], cfg["host"], cfg["http_port"], cfg["database"])
PY

  ok "Superset ClickHouse config synchronized"
}

install_server() {
  check_not_root
  require_domain
  calc_autotune
  ensure_dirs
  preserve_existing_runtime_secrets_server

  run_step "Installing system packages" install_system_packages
  run_step "Installing ClickHouse" install_clickhouse
  run_step "Starting ClickHouse" start_clickhouse
  run_step "Bootstrapping ClickHouse databases" setup_clickhouse_dbs
  run_step "Creating Python virtual environment" setup_venv_server
  run_step "Installing Python dependencies" install_python_dependencies_server
  run_step "Installing ClickHouse Python package" install_clickhouse_python_package
  run_step "Building frontend assets" build_frontend_if_present_server
  run_step "Configuring Redis" configure_redis_server
  run_step "Configuring PostgreSQL" configure_postgresql_server
  run_step "Verifying PostgreSQL credentials" verify_postgres_runtime_credentials_server
  run_step "Writing environment file" generate_env_server
  run_step "Writing Superset configuration" generate_superset_config_server
  run_step "Creating systemd units" create_systemd_units_server
  run_step "Configuring firewall" configure_firewall_server
  run_step "Configuring Nginx reverse proxy" configure_nginx_server
  run_step "Configuring Let's Encrypt SSL" configure_ssl_server || true
  run_step "Patching DHIS2 metadata schema" patch_metadata_db_schema_for_dhis2
  run_step "Initializing Superset application" initialize_superset_server
  run_step "Syncing Superset ClickHouse config" sync_superset_clickhouse_config_server
  run_step "Starting services" start_services_server
  run_step "Collecting service status" show_status_server
  show_runtime_paths

  cat <<EOF

Deployment complete.
URL: https://${DOMAIN}
Detected resources: ${CPU_CORES} CPU cores, ${TOTAL_MEM_MB}MB RAM, ${ROOT_DISK_GB}GB disk.
Serving engine: ${DHIS2_SERVING_ENGINE}
ClickHouse HTTP: http://${CLICKHOUSE_HOST}:${CLICKHOUSE_HTTP_PORT}
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
  if [[ "$REMOTE_USER" == "root" && "${REMOTE_RUN_AS_APP_USER:-0}" == "1" ]]; then
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

# Avoid Git "dubious ownership" failures when the install dir ownership differs
# from the current remote user context (common during root/app-user handoffs).
git config --global --add safe.directory "\$REMOTE_INSTALL_DIR" >/dev/null 2>&1 || true

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
  git config --global --add safe.directory "\$REMOTE_INSTALL_DIR" >/dev/null 2>&1 || true

  # Remove deployment-time drift before syncing from Git.
  rm -f "\$REMOTE_INSTALL_DIR/superset-manager.sh" "\$REMOTE_INSTALL_DIR/superset-manager-v2.sh" || true
  if git rev-parse --verify HEAD >/dev/null 2>&1; then
    git reset --hard HEAD
  fi
  git clean -fd -e config -e data -e logs -e run -e venv -e .env || true

  git remote set-url origin "\$GIT_REPO_URL"
  git fetch --all --tags
  if [[ -n "\$GIT_REF" ]]; then
    git checkout -f "\$GIT_REF"
    git reset --hard "\$GIT_REF" || true
  else
    git checkout -f "\$GIT_BRANCH"
    git reset --hard "origin/\$GIT_BRANCH"
  fi
else
  if (( \${#non_runtime[@]} > 0 )); then
    echo "Install dir exists and contains non-runtime content: \${non_runtime[*]}" >&2
    echo "Bootstrapping existing install dir into a git-managed checkout." >&2
    cd "\$REMOTE_INSTALL_DIR"
    git init
    git config --global --add safe.directory "\$REMOTE_INSTALL_DIR" >/dev/null 2>&1 || true
    if git remote get-url origin >/dev/null 2>&1; then
      git remote set-url origin "\$GIT_REPO_URL"
    else
      git remote add origin "\$GIT_REPO_URL"
    fi
    git fetch --all --tags
    git clean -fdx \
      -e config \
      -e data \
      -e logs \
      -e run \
      -e venv \
      -e .env \
      -e .clickhouse \
      -e superset_home || true
    if [[ -n "\$GIT_REF" ]]; then
      git checkout -f "\$GIT_REF"
      git reset --hard "\$GIT_REF" || true
    else
      git checkout -B "\$GIT_BRANCH" "origin/\$GIT_BRANCH"
      git reset --hard "origin/\$GIT_BRANCH"
    fi
    git clean -fd -e config -e data -e logs -e run -e venv -e .env || true
    exit 0
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
      --exclude '.clickhouse' \
      --exclude 'venv' \
      --exclude 'node_modules' \
      --exclude 'dist' \
      --exclude 'build' \
      --exclude '__pycache__' \
      --exclude '*.pyc' \
      --exclude 'superset.db' \
      --exclude 'superset.db-shm' \
      --exclude 'superset.db-wal' \
      --exclude '/logs' \
      --exclude '/run' \
      --exclude '/data' \
      --exclude '.DS_Store' \
      "$LOCAL_PROJECT_DIR"/ "$remote_target"
    remote_exec "mkdir -p '${REMOTE_INSTALL_DIR}' && rsync -az --delete /tmp/${APP_NAME}-sync/ '${REMOTE_INSTALL_DIR}/' && chown -R '${REMOTE_APP_USER}:${REMOTE_APP_USER}' '${REMOTE_INSTALL_DIR}'"
  else
    remote_target="$(remote_login):${REMOTE_INSTALL_DIR}/"
    remote_exec "mkdir -p '${REMOTE_INSTALL_DIR}'"
    rsync -az --delete -e "$RSYNC_SSH" \
      --exclude '.git' \
      --exclude '.clickhouse' \
      --exclude 'venv' \
      --exclude 'node_modules' \
      --exclude 'dist' \
      --exclude 'build' \
      --exclude '__pycache__' \
      --exclude '*.pyc' \
      --exclude 'superset.db' \
      --exclude 'superset.db-shm' \
      --exclude 'superset.db-wal' \
      --exclude '/logs' \
      --exclude '/run' \
      --exclude '/data' \
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
export NPM_VERSION='${NPM_VERSION}'
export NPM_INSTALL_FLAGS='${NPM_INSTALL_FLAGS}'
export NPM_CONFIG_LEGACY_PEER_DEPS='${NPM_CONFIG_LEGACY_PEER_DEPS}'
export NPM_CONFIG_AUDIT='${NPM_CONFIG_AUDIT}'
export NPM_CONFIG_FUND='${NPM_CONFIG_FUND}'
export NPM_CONFIG_PROGRESS='${NPM_CONFIG_PROGRESS}'
export NPM_CONFIG_UPDATE_NOTIFIER='${NPM_CONFIG_UPDATE_NOTIFIER}'
export NPM_CONFIG_LOGLEVEL='${NPM_CONFIG_LOGLEVEL}'
export FRONTEND_PATCH_TSCONFIGS='${FRONTEND_PATCH_TSCONFIGS}'
export FRONTEND_BUILD_STRATEGY='${FRONTEND_BUILD_STRATEGY}'
export TSC_COMPILE_ON_ERROR='${TSC_COMPILE_ON_ERROR}'
export FRONTEND_FORCE_RETRY_ON_TS_ERRORS='${FRONTEND_FORCE_RETRY_ON_TS_ERRORS}'
export FRONTEND_BUILD_MAX_RETRIES='${FRONTEND_BUILD_MAX_RETRIES}'
export FRONTEND_REWRITE_PLUGIN_TSCONFIGS='${FRONTEND_REWRITE_PLUGIN_TSCONFIGS}'
export FRONTEND_VERBOSE_LOGS='${FRONTEND_VERBOSE_LOGS}'
export FRONTEND_HEARTBEAT_SECONDS='${FRONTEND_HEARTBEAT_SECONDS}'
export FRONTEND_BUILD_LOG_FILE='${FRONTEND_BUILD_LOG_FILE}'
export FRONTEND_CLEAN='${FRONTEND_CLEAN}'
export FRONTEND_SKIP_IF_ASSETS_EXIST='${FRONTEND_SKIP_IF_ASSETS_EXIST}'
export FRONTEND_TIMEOUT_MINUTES='${FRONTEND_TIMEOUT_MINUTES}'
export FRONTEND_TYPECHECK='${FRONTEND_TYPECHECK}'
export FRONTEND_LOG_TAIL_LINES='${FRONTEND_LOG_TAIL_LINES}'
export FRONTEND_DEP_FINGERPRINT_FILE='${FRONTEND_DEP_FINGERPRINT_FILE}'
export WEBPACK_VERBOSE_ARGS='${WEBPACK_VERBOSE_ARGS}'
export NPM_INSTALL_VERBOSE='${NPM_INSTALL_VERBOSE}'
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
export NPM_VERSION='${NPM_VERSION}'
export NPM_INSTALL_FLAGS='${NPM_INSTALL_FLAGS}'
export NPM_CONFIG_LEGACY_PEER_DEPS='${NPM_CONFIG_LEGACY_PEER_DEPS}'
export NPM_CONFIG_AUDIT='${NPM_CONFIG_AUDIT}'
export NPM_CONFIG_FUND='${NPM_CONFIG_FUND}'
export NPM_CONFIG_PROGRESS='${NPM_CONFIG_PROGRESS}'
export NPM_CONFIG_UPDATE_NOTIFIER='${NPM_CONFIG_UPDATE_NOTIFIER}'
export NPM_CONFIG_LOGLEVEL='${NPM_CONFIG_LOGLEVEL}'
export FRONTEND_PATCH_TSCONFIGS='${FRONTEND_PATCH_TSCONFIGS}'
export FRONTEND_BUILD_STRATEGY='${FRONTEND_BUILD_STRATEGY}'
export TSC_COMPILE_ON_ERROR='${TSC_COMPILE_ON_ERROR}'
export FRONTEND_FORCE_RETRY_ON_TS_ERRORS='${FRONTEND_FORCE_RETRY_ON_TS_ERRORS}'
export FRONTEND_BUILD_MAX_RETRIES='${FRONTEND_BUILD_MAX_RETRIES}'
export FRONTEND_REWRITE_PLUGIN_TSCONFIGS='${FRONTEND_REWRITE_PLUGIN_TSCONFIGS}'
export FRONTEND_VERBOSE_LOGS='${FRONTEND_VERBOSE_LOGS}'
export FRONTEND_HEARTBEAT_SECONDS='${FRONTEND_HEARTBEAT_SECONDS}'
export FRONTEND_BUILD_LOG_FILE='${FRONTEND_BUILD_LOG_FILE}'
export FRONTEND_CLEAN='${FRONTEND_CLEAN}'
export FRONTEND_SKIP_IF_ASSETS_EXIST='${FRONTEND_SKIP_IF_ASSETS_EXIST}'
export FRONTEND_TIMEOUT_MINUTES='${FRONTEND_TIMEOUT_MINUTES}'
export FRONTEND_TYPECHECK='${FRONTEND_TYPECHECK}'
export FRONTEND_LOG_TAIL_LINES='${FRONTEND_LOG_TAIL_LINES}'
export FRONTEND_DEP_FINGERPRINT_FILE='${FRONTEND_DEP_FINGERPRINT_FILE}'
export WEBPACK_VERBOSE_ARGS='${WEBPACK_VERBOSE_ARGS}'
export NPM_INSTALL_VERBOSE='${NPM_INSTALL_VERBOSE}'
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

  run_step "Writing environment file" generate_env_server
  run_step "Writing Superset configuration" generate_superset_config_server
  run_step "Installing Python dependencies" install_python_dependencies_server
  run_step "Building frontend assets" build_frontend_if_present_server
  run_step "Patching DHIS2 metadata schema" patch_metadata_db_schema_for_dhis2
  run_step "Initializing Superset application" initialize_superset_server
  run_step "Restarting services" restart_services_server
  run_step "Collecting service status" show_status_server
}

# ------------------------------------------------------------------------------
# Usage
# ------------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage: ./superset-manager-v2-v15.sh <command>

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
  show-config-paths    Show runtime config and log paths

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
  FRONTEND_NODE_OLD_SPACE_SIZE_MB=auto   # auto-sizes Node heap from server RAM
  FRONTEND_FORK_TS_MEMORY_LIMIT_MB=auto  # auto-sizes ForkTsChecker memory limit
  NODE_MAJOR=20
  NPM_VERSION=10.8.2
  NPM_INSTALL_FLAGS='--legacy-peer-deps --no-audit --no-fund --progress=false --loglevel=error'
  NPM_CONFIG_LOGLEVEL=error
  FRONTEND_PATCH_TSCONFIGS=1
  TSC_COMPILE_ON_ERROR=true
  FRONTEND_FORCE_RETRY_ON_TS_ERRORS=1
  FRONTEND_BUILD_MAX_RETRIES=2
  FRONTEND_REWRITE_PLUGIN_TSCONFIGS=1
  FRONTEND_CLEAN=0
  FRONTEND_TIMEOUT_MINUTES=90
  FRONTEND_TYPECHECK=0
  FRONTEND_LOG_TAIL_LINES=200
  FRONTEND_VERBOSE_LOGS=1
  FRONTEND_HEARTBEAT_SECONDS=30
  FRONTEND_BUILD_LOG_FILE=/srv/apps/superset/logs/frontend-build.log
  WEBPACK_VERBOSE_ARGS=''  # keep empty for normal deploys; extra webpack args slowed or broke builds in this repo
  NPM_INSTALL_VERBOSE=0

Examples:
  CODEBASE_SOURCE=local DOMAIN=supersets.vitalplatforms.com ADMIN_EMAIL=admin@vitalplatforms.com ADMIN_PASSWORD='StrongPass' ./superset-manager-v2-v15.sh deploy-remote
  CODEBASE_SOURCE=git GIT_REPO_URL=https://github.com/HISP-Uganda/dhis2-superset.git GIT_BRANCH=martbase DOMAIN=supersets.vitalplatforms.com ./superset-manager-v2-v15.sh deploy-remote
  CODEBASE_SOURCE=git GIT_REPO_URL=https://github.com/HISP-Uganda/dhis2-superset.git GIT_REF=martbase DOMAIN=supersets.vitalplatforms.com ./superset-manager-v2-v15.sh upgrade-remote
  ./superset-manager-v2-v15.sh start-all
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
    show-config-paths) calc_autotune; show_runtime_paths ;;

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

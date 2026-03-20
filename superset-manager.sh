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
FRONTEND_PORT="${FRONTEND_PORT:-9001}"
FRONTEND_DISABLE_TYPE_CHECK="${FRONTEND_DISABLE_TYPE_CHECK:-1}"
BACKEND_ENABLE_RELOAD="${BACKEND_ENABLE_RELOAD:-0}"
BACKEND_ENABLE_DEBUGGER="${BACKEND_ENABLE_DEBUGGER:-0}"

CACHE_DIR="$PROJECT_DIR/superset_home/cache"

CELERY_WORKER_LOG_FILE="$LOG_DIR/celery_worker.log"
CELERY_BEAT_LOG_FILE="$LOG_DIR/celery_beat.log"
CELERY_WORKER_PID_FILE="$PROJECT_DIR/celery_worker.pid"
CELERY_BEAT_PID_FILE="$PROJECT_DIR/celery_beat.pid"
CELERY_CONCURRENCY="${CELERY_CONCURRENCY:-2}"
CELERY_BEAT_SCHEDULE="$PROJECT_DIR/celerybeat-schedule"

# ClickHouse (set CLICKHOUSE_ENABLED=1 to install and manage it)
# By default, enable it if ClickHouse binary is found (staging/dev mode)
CLICKHOUSE_ENABLED="${CLICKHOUSE_ENABLED:-}"
if [[ -z "$CLICKHOUSE_ENABLED" ]]; then
  if command -v clickhouse >/dev/null 2>&1 || command -v clickhouse-server >/dev/null 2>&1; then
    CLICKHOUSE_ENABLED=1
  else
    CLICKHOUSE_ENABLED=0
  fi
fi

CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-127.0.0.1}"
CLICKHOUSE_HTTP_PORT="${CLICKHOUSE_HTTP_PORT:-8123}"
CLICKHOUSE_NATIVE_PORT="${CLICKHOUSE_NATIVE_PORT:-9000}"
CLICKHOUSE_STAGING_DATABASE="${CLICKHOUSE_STAGING_DATABASE:-dhis2_staging}"
CLICKHOUSE_SERVING_DATABASE="${CLICKHOUSE_SERVING_DATABASE:-dhis2_serving}"
CLICKHOUSE_CONTROL_DATABASE="${CLICKHOUSE_CONTROL_DATABASE:-dhis2_control}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-dhis2_user}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-change_me_securely}"
CLICKHOUSE_SUPERSET_DB_NAME="${CLICKHOUSE_SUPERSET_DB_NAME:-DHIS2 Serving (ClickHouse)}"

# Reliable direct-managed ClickHouse paths
CLICKHOUSE_MANAGED_MODE="${CLICKHOUSE_MANAGED_MODE:-direct}"
CLICKHOUSE_DATA_DIR="${CLICKHOUSE_DATA_DIR:-$PROJECT_DIR/.clickhouse}"
CLICKHOUSE_PID_FILE="${CLICKHOUSE_PID_FILE:-$PROJECT_DIR/clickhouse.pid}"
CLICKHOUSE_LOG_FILE="${CLICKHOUSE_LOG_FILE:-$LOG_DIR/clickhouse.log}"
CLICKHOUSE_ERROR_LOG_FILE="${CLICKHOUSE_ERROR_LOG_FILE:-$LOG_DIR/clickhouse-error.log}"
CLICKHOUSE_STDOUT_LOG_FILE="${CLICKHOUSE_STDOUT_LOG_FILE:-$LOG_DIR/clickhouse-stdout.log}"

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
# Platform detection
# ----------------------------------------------------------------------------
detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin)
      case "$arch" in
        arm64)  echo "macos-arm64" ;;
        x86_64) echo "macos-x86_64" ;;
        *)      echo "macos-$arch" ;;
      esac
      ;;
    Linux)
      case "$arch" in
        aarch64|arm64) echo "linux-arm64" ;;
        x86_64)        echo "linux-x86_64" ;;
        *)             echo "linux-$arch" ;;
      esac
      ;;
    *)
      echo "unknown-$os-$arch"
      ;;
  esac
}

# ----------------------------------------------------------------------------
# ClickHouse
# ----------------------------------------------------------------------------
clickhouse_running() {
  curl -fsS "http://$CLICKHOUSE_HOST:$CLICKHOUSE_HTTP_PORT/ping" >/dev/null 2>&1
}

clickhouse_pid() {
  read_pid_file "$CLICKHOUSE_PID_FILE" || true
}

clickhouse_pid_running() {
  local pid
  pid="$(clickhouse_pid)"
  [[ -n "${pid:-}" ]] && pid_is_running "$pid"
}

clickhouse_ports_busy() {
  port_is_in_use "$CLICKHOUSE_HTTP_PORT" || port_is_in_use "$CLICKHOUSE_NATIVE_PORT"
}

clickhouse_binary() {
  if command -v clickhouse >/dev/null 2>&1; then
    command -v clickhouse
    return 0
  fi
  if command -v clickhouse-server >/dev/null 2>&1; then
    command -v clickhouse-server
    return 0
  fi
  return 1
}

cleanup_stale_clickhouse() {
  kill_pid_file "$CLICKHOUSE_PID_FILE" "ClickHouse"

  if clickhouse_ports_busy; then
    info "Cleaning up ClickHouse listeners on ports $CLICKHOUSE_HTTP_PORT/$CLICKHOUSE_NATIVE_PORT"
    kill_port "$CLICKHOUSE_HTTP_PORT"
    kill_port "$CLICKHOUSE_NATIVE_PORT"
  fi

  pkill -f "clickhouse server" 2>/dev/null || true
  pkill -f "clickhouse-server" 2>/dev/null || true

  rm -f "$CLICKHOUSE_PID_FILE"
  sleep 2
}

# Return the clickhouse-client executable path, or empty string if not found
_ch_client() {
  if command -v clickhouse-client >/dev/null 2>&1; then
    echo "clickhouse-client"
  elif command -v clickhouse >/dev/null 2>&1; then
    echo "clickhouse client"
  else
    echo ""
  fi
}

# Run a SQL statement against ClickHouse (tries native client, falls back to HTTP)
_ch_exec() {
  local sql="$1"
  local client
  client="$(_ch_client)"

  if [[ -n "$client" ]]; then
    $client \
      --host="$CLICKHOUSE_HOST" \
      --port="$CLICKHOUSE_NATIVE_PORT" \
      --user=default \
      --multiquery \
      --query="$sql" 2>/dev/null && return 0
  fi

  curl -fsS \
    "http://$CLICKHOUSE_HOST:$CLICKHOUSE_HTTP_PORT/" \
    --data-binary "$sql" >/dev/null 2>&1
}

install_clickhouse() {
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] || return 0
  header "Installing ClickHouse"

  if command -v clickhouse >/dev/null 2>&1 || command -v clickhouse-server >/dev/null 2>&1; then
    ok "ClickHouse already installed"
    return 0
  fi

  local platform
  platform="$(detect_platform)"
  info "Detected platform: $platform"

  case "$platform" in
    macos-arm64|macos-x86_64)
      _install_clickhouse_macos
      ;;
    linux-x86_64|linux-arm64)
      _install_clickhouse_linux
      ;;
    *)
      warn "Unsupported platform: $platform"
      warn "Please install ClickHouse manually"
      return 1
      ;;
  esac
}

_install_clickhouse_macos() {
  if ! command -v brew >/dev/null 2>&1; then
    error "Homebrew is required for macOS ClickHouse install"
    error "Install Homebrew: https://brew.sh"
    exit 1
  fi

  if brew list clickhouse >/dev/null 2>&1; then
    ok "ClickHouse already installed via Homebrew"
    brew upgrade clickhouse 2>/dev/null || true
    return 0
  fi

  info "Installing ClickHouse via Homebrew"
  brew install clickhouse
  ok "ClickHouse installed"

  if command -v xattr >/dev/null 2>&1; then
    local ch_bin
    ch_bin="$(command -v clickhouse || true)"
    if [[ -n "$ch_bin" && -f "$ch_bin" ]]; then
      info "Removing macOS quarantine attribute from ClickHouse binary"
      xattr -dr com.apple.quarantine "$ch_bin" 2>/dev/null || true
    fi
  fi
}

_install_clickhouse_linux() {
  if command -v apt-get >/dev/null 2>&1; then
    _install_clickhouse_apt
  elif command -v yum >/dev/null 2>&1 || command -v dnf >/dev/null 2>&1; then
    _install_clickhouse_rpm
  else
    warn "No supported package manager found (apt/yum/dnf)"
    warn "Attempting binary install"
    _install_clickhouse_binary
  fi
}

_install_clickhouse_apt() {
  if command -v clickhouse-server >/dev/null 2>&1; then
    ok "ClickHouse server already installed"
    return 0
  fi

  info "Installing ClickHouse via APT"
  export DEBIAN_FRONTEND=noninteractive
  sudo apt-get update -qq
  sudo apt-get install -y -qq apt-transport-https ca-certificates curl gnupg

  curl -fsSL 'https://packages.clickhouse.com/deb/archive-keyring.gpg' \
    | sudo gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg

  echo 'deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg] https://packages.clickhouse.com/deb stable main' \
    | sudo tee /etc/apt/sources.list.d/clickhouse.list

  sudo apt-get update -qq
  sudo apt-get install -y -qq clickhouse-server clickhouse-client
  ok "ClickHouse installed (APT)"
}

_install_clickhouse_rpm() {
  if command -v clickhouse-server >/dev/null 2>&1; then
    ok "ClickHouse server already installed"
    return 0
  fi

  info "Installing ClickHouse via RPM"
  local pm="yum"
  command -v dnf >/dev/null 2>&1 && pm="dnf"

  sudo "$pm" install -y 'https://packages.clickhouse.com/rpm/stable/clickhouse-common-static-23.8.1.2992.x86_64.rpm' 2>/dev/null || \
  sudo "$pm" install -y clickhouse-server clickhouse-client || {
    warn "RPM install failed; trying curl install"
    _install_clickhouse_binary
  }
}

_install_clickhouse_binary() {
  local arch
  arch="$(uname -m)"
  local bin_url="https://github.com/ClickHouse/ClickHouse/releases/latest/download/clickhouse-linux-${arch}"
  local dest="/usr/local/bin/clickhouse"

  info "Downloading ClickHouse binary for $arch"
  sudo curl -fsSL -o "$dest" "$bin_url"
  sudo chmod +x "$dest"
  ok "ClickHouse binary installed at $dest"
}

_start_clickhouse_direct() {
  ensure_log_dir

  local ch_bin=""
  ch_bin="$(clickhouse_binary)" || {
    error "Cannot find clickhouse binary; install ClickHouse first"
    exit 1
  }

  mkdir -p "$CLICKHOUSE_DATA_DIR"
  : > "$CLICKHOUSE_LOG_FILE"
  : > "$CLICKHOUSE_ERROR_LOG_FILE"
  : > "$CLICKHOUSE_STDOUT_LOG_FILE"

  info "Using ClickHouse binary: $ch_bin"
  info "Using ClickHouse data dir: $CLICKHOUSE_DATA_DIR"

  local pid
  pid="$(spawn_detached \
    "$CLICKHOUSE_PID_FILE" \
    "$CLICKHOUSE_STDOUT_LOG_FILE" \
    "$ch_bin" \
    server \
    -- \
    --http_port="$CLICKHOUSE_HTTP_PORT" \
    --tcp_port="$CLICKHOUSE_NATIVE_PORT" \
    --path="$CLICKHOUSE_DATA_DIR" \
    --logger.log="$CLICKHOUSE_LOG_FILE" \
    --logger.errorlog="$CLICKHOUSE_ERROR_LOG_FILE" \
    --logger.level=information
  )"

  info "ClickHouse PID: $pid"
}

start_clickhouse() {
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] || return 0
  header "Starting ClickHouse"

  if clickhouse_running; then
    ok "ClickHouse is already running"
    return 0
  fi

  cleanup_stale_clickhouse
  _start_clickhouse_direct

  info "Waiting for ClickHouse HTTP port $CLICKHOUSE_HTTP_PORT"
  local tries=0
  while ! clickhouse_running; do
    tries=$((tries + 1))
    if [[ $tries -ge 45 ]]; then
      error "ClickHouse did not become ready in 45 seconds"
      [[ -f "$CLICKHOUSE_STDOUT_LOG_FILE" ]] && tail -100 "$CLICKHOUSE_STDOUT_LOG_FILE" || true
      [[ -f "$CLICKHOUSE_LOG_FILE" ]] && tail -100 "$CLICKHOUSE_LOG_FILE" || true
      [[ -f "$CLICKHOUSE_ERROR_LOG_FILE" ]] && tail -100 "$CLICKHOUSE_ERROR_LOG_FILE" || true
      exit 1
    fi
    sleep 1
  done

  ok "ClickHouse is ready (HTTP port $CLICKHOUSE_HTTP_PORT)"
}

stop_clickhouse() {
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] || return 0
  header "Stopping ClickHouse"

  local stopped=0

  if clickhouse_pid_running; then
    local pid
    pid="$(clickhouse_pid)"
    info "Stopping ClickHouse (PID: $pid)"
    kill -TERM "$pid" 2>/dev/null || true
    sleep 3
    if ps -p "$pid" >/dev/null 2>&1; then
      warn "ClickHouse still running, forcing kill"
      kill -9 "$pid" 2>/dev/null || true
    fi
    stopped=1
  fi

  if clickhouse_ports_busy; then
    info "Cleaning up ClickHouse listeners on ports $CLICKHOUSE_HTTP_PORT/$CLICKHOUSE_NATIVE_PORT"
    kill_port "$CLICKHOUSE_HTTP_PORT"
    kill_port "$CLICKHOUSE_NATIVE_PORT"
    pkill -f "clickhouse server" 2>/dev/null || true
    pkill -f "clickhouse-server" 2>/dev/null || true
    stopped=1
  fi

  rm -f "$CLICKHOUSE_PID_FILE"

  local tries=0
  while clickhouse_running || clickhouse_ports_busy; do
    tries=$((tries + 1))
    if [[ $tries -ge 10 ]]; then
      error "ClickHouse still appears to be running after stop"
      return 1
    fi
    sleep 1
  done

  if [[ $stopped -eq 1 ]]; then
    ok "ClickHouse stopped"
  else
    warn "ClickHouse was not running"
  fi
}

restart_clickhouse() {
  header "Restarting ClickHouse"
  stop_clickhouse || true
  sleep 2
  start_clickhouse
}

# Create databases and the dhis2_user account.
setup_clickhouse_dbs() {
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] || return 0
  header "Bootstrapping ClickHouse Databases and User"

  if ! clickhouse_running; then
    error "ClickHouse is not running; start it first with: ./superset-manager.sh start-clickhouse"
    exit 1
  fi

  info "Creating databases: $CLICKHOUSE_STAGING_DATABASE, $CLICKHOUSE_SERVING_DATABASE, $CLICKHOUSE_CONTROL_DATABASE"
  _ch_exec "CREATE DATABASE IF NOT EXISTS \`${CLICKHOUSE_STAGING_DATABASE}\`"
  _ch_exec "CREATE DATABASE IF NOT EXISTS \`${CLICKHOUSE_SERVING_DATABASE}\`"
  _ch_exec "CREATE DATABASE IF NOT EXISTS \`${CLICKHOUSE_CONTROL_DATABASE}\`"

  info "Creating user: $CLICKHOUSE_USER"
  _ch_exec "CREATE USER IF NOT EXISTS ${CLICKHOUSE_USER} IDENTIFIED BY '${CLICKHOUSE_PASSWORD}'"

  info "Granting privileges to $CLICKHOUSE_USER"
  _ch_exec "GRANT ALL ON \`${CLICKHOUSE_STAGING_DATABASE}\`.* TO ${CLICKHOUSE_USER}"
  _ch_exec "GRANT ALL ON \`${CLICKHOUSE_SERVING_DATABASE}\`.* TO ${CLICKHOUSE_USER}"
  _ch_exec "GRANT ALL ON \`${CLICKHOUSE_CONTROL_DATABASE}\`.* TO ${CLICKHOUSE_USER}"
  _ch_exec "GRANT SELECT ON system.tables  TO ${CLICKHOUSE_USER}"
  _ch_exec "GRANT SELECT ON system.columns TO ${CLICKHOUSE_USER}"
  _ch_exec "GRANT SELECT ON system.parts   TO ${CLICKHOUSE_USER}"

  ok "ClickHouse bootstrap complete"
  info "  Staging DB:  $CLICKHOUSE_STAGING_DATABASE"
  info "  Serving DB:  $CLICKHOUSE_SERVING_DATABASE"
  info "  Control DB:  $CLICKHOUSE_CONTROL_DATABASE"
  info "  User:        $CLICKHOUSE_USER"

  _sync_superset_clickhouse_config
}

_sync_superset_clickhouse_config() {
  if [[ ! -d "$VENV_DIR" ]]; then
    warn "_sync_superset_clickhouse_config: venv not found at $VENV_DIR — skipping config sync"
    return 0
  fi
  info "Syncing ClickHouse credentials into Superset local_staging_settings …"
  "$VENV_DIR/bin/python" - <<PY
import sys, os
os.environ.setdefault('FLASK_APP', 'superset')
try:
    from superset import create_app
    app = create_app()
    with app.app_context():
        from superset import db
        from superset.local_staging.platform_settings import LocalStagingSettings

        s = LocalStagingSettings.get()
        cfg = s.get_clickhouse_config()
        cfg.update({
            "host":             "${CLICKHOUSE_HOST}",
            "http_port":        ${CLICKHOUSE_HTTP_PORT},
            "port":             ${CLICKHOUSE_NATIVE_PORT},
            "database":         "${CLICKHOUSE_STAGING_DATABASE}",
            "serving_database": "${CLICKHOUSE_SERVING_DATABASE}",
            "user":             "${CLICKHOUSE_USER}",
            "password":         "${CLICKHOUSE_PASSWORD}",
            "secure":           False,
            "verify":           True,
            "connect_timeout":  10,
            "send_receive_timeout": 300,
        })
        s.set_clickhouse_config(cfg)
        if s.active_engine != "clickhouse":
            s.active_engine = "clickhouse"
        db.session.commit()
        print("CONFIG_SYNC_OK host=${CLICKHOUSE_HOST}:${CLICKHOUSE_HTTP_PORT} user=${CLICKHOUSE_USER}")
except Exception as e:
    print(f"CONFIG_SYNC_WARN: {e}", file=sys.stderr)
    sys.exit(0)
PY
}

install_clickhouse_python() {
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] || return 0
  header "Installing clickhouse-connect Python Package"

  require_dir "$VENV_DIR"
  venv_activate

  info "Installing clickhouse-connect into venv"
  "$VENV_DIR/bin/pip" install --quiet -U clickhouse-connect

  info "Verifying connectivity to $CLICKHOUSE_HOST:$CLICKHOUSE_HTTP_PORT"
  "$VENV_DIR/bin/python" - <<PY
import sys
try:
    import clickhouse_connect
    client = clickhouse_connect.get_client(
        host="${CLICKHOUSE_HOST}",
        port=${CLICKHOUSE_HTTP_PORT},
        username="${CLICKHOUSE_USER}",
        password="${CLICKHOUSE_PASSWORD}",
    )
    result = client.query("SELECT version()")
    version = result.result_rows[0][0] if result.result_rows else "?"
    print(f"CLICKHOUSE_CONNECT_OK version={version}")
except Exception as e:
    print(f"CLICKHOUSE_CONNECT_WARN: {e}", file=sys.stderr)
    sys.exit(0)
PY

  ok "clickhouse-connect installed"
}

setup_clickhouse_full() {
  header "Full ClickHouse Setup"
  CLICKHOUSE_ENABLED=1
  install_clickhouse
  start_clickhouse
  setup_clickhouse_dbs
  install_clickhouse_python
  ok "ClickHouse fully configured"
  echo
  echo "  HTTP port:   $CLICKHOUSE_HTTP_PORT"
  echo "  Native port: $CLICKHOUSE_NATIVE_PORT"
  echo "  Staging DB:  $CLICKHOUSE_STAGING_DATABASE"
  echo "  Serving DB:  $CLICKHOUSE_SERVING_DATABASE"
  echo "  User:        $CLICKHOUSE_USER"
  echo
  ok "Superset local_staging_settings updated — engine is now 'clickhouse'"
  info "Credentials can be reviewed / changed at Settings → Local Staging Engine"
}

clickhouse_status() {
  header "ClickHouse Status"

  if [[ "$CLICKHOUSE_ENABLED" != "1" ]]; then
    warn "ClickHouse is disabled (CLICKHOUSE_ENABLED != 1)"
    info "Enable with: CLICKHOUSE_ENABLED=1 ./superset-manager.sh clickhouse-status"
    return 0
  fi

  echo "  HTTP port:   $CLICKHOUSE_HTTP_PORT"
  echo "  Native port: $CLICKHOUSE_NATIVE_PORT"
  echo "  Data dir:    $CLICKHOUSE_DATA_DIR"
  echo "  PID file:    $CLICKHOUSE_PID_FILE"

  if ! command -v clickhouse >/dev/null 2>&1 && ! command -v clickhouse-server >/dev/null 2>&1; then
    warn "ClickHouse is not installed"
    echo "  Install with: ./superset-manager.sh install-clickhouse"
    return 0
  fi

  if clickhouse_running; then
    ok "ClickHouse is running (HTTP ping OK)"
    local version
    version="$(curl -fsS "http://${CLICKHOUSE_HOST}:${CLICKHOUSE_HTTP_PORT}/" \
      --data-binary "SELECT version()" 2>/dev/null || echo "?")"
    echo "  Version: $version"

    local dbs
    dbs="$(curl -fsS "http://${CLICKHOUSE_HOST}:${CLICKHOUSE_HTTP_PORT}/" \
      -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
      --data-binary "SHOW DATABASES" 2>/dev/null || echo "")"
    if [[ -n "$dbs" ]]; then
      echo "  Databases:"
      echo "$dbs" | sed 's/^/    /'
    fi
  else
    warn "ClickHouse is not running"
    echo "  Start with: ./superset-manager.sh start-clickhouse"
  fi
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
      "cd '$FRONTEND_DIR' && export PATH=\"$FRONTEND_DIR/node_modules/.bin:\$PATH\" && export DISABLE_TYPE_CHECK=\"$FRONTEND_DISABLE_TYPE_CHECK\" && export WEBPACK_DEVSERVER_PORT=\"$FRONTEND_PORT\" && $cmd"
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

  mkdir -p "$CACHE_DIR"
  rm -rf "$CACHE_DIR"/* 2>/dev/null || true
  ok "Backend cache cleared: $CACHE_DIR"

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
  rm -f \
    "$BACKEND_LOG_FILE" \
    "$FRONTEND_LOG_FILE" \
    "$REDIS_LOG_FILE" \
    "$CELERY_WORKER_LOG_FILE" \
    "$CELERY_BEAT_LOG_FILE" \
    "$CLICKHOUSE_LOG_FILE" \
    "$CLICKHOUSE_ERROR_LOG_FILE" \
    "$CLICKHOUSE_STDOUT_LOG_FILE"
  ok "Logs cleared"
}

install_deps() {
  header "Installing Python Dependencies"

  validate_project
  require_dir "$VENV_DIR"

  cd "$BACKEND_DIR"
  venv_activate

  if [[ -f "$BACKEND_DIR/requirements/base.txt" ]]; then
    info "Installing base requirements..."
    "$VENV_DIR/bin/pip" install --quiet -r "$BACKEND_DIR/requirements/base.txt"
    ok "Base requirements installed"
  else
    warn "No requirements/base.txt found — skipping"
  fi

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

  if [[ "${CLICKHOUSE_ENABLED:-0}" == "1" ]]; then
    if clickhouse_running; then
      ok "ClickHouse running"
    else
      warn "ClickHouse not running"
    fi
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
    celery|celery-worker) file="$CELERY_WORKER_LOG_FILE" ;;
    celery-beat)          file="$CELERY_BEAT_LOG_FILE" ;;
    clickhouse)           file="$CLICKHOUSE_LOG_FILE" ;;
    clickhouse-error)     file="$CLICKHOUSE_ERROR_LOG_FILE" ;;
    clickhouse-stdout)    file="$CLICKHOUSE_STDOUT_LOG_FILE" ;;
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
# Celery worker + beat
# ----------------------------------------------------------------------------
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

start_celery_worker() {
  header "Starting Celery Worker"

  validate_backend
  ensure_log_dir

  if ! redis_running; then
    warn "Redis not running — starting it first"
    start_redis || { error "Redis unavailable; cannot start Celery worker"; exit 1; }
  fi

  if celery_worker_running; then
    ok "Celery worker already running"
    return 0
  fi

  cd "$BACKEND_DIR"
  venv_activate
  set_backend_env

  info "Starting Celery worker (concurrency=$CELERY_CONCURRENCY, queues=celery,dhis2)"
  local pid
  pid="$(spawn_detached \
    "$CELERY_WORKER_PID_FILE" \
    "$CELERY_WORKER_LOG_FILE" \
    "$VENV_DIR/bin/celery" \
      --app=superset.tasks.celery_app:app \
      worker \
      --loglevel=info \
      --pool=prefork \
      --concurrency="$CELERY_CONCURRENCY" \
      -Q celery,dhis2 \
  )"

  local ready=0
  for _ in {1..20}; do
    sleep 1
    if celery_worker_running; then
      ready=1
      break
    fi
  done

  if [[ "$ready" == "1" ]]; then
    ok "Celery worker started (PID: $pid)"
    echo "  Queues: celery, dhis2"
    echo "  Logs:   $CELERY_WORKER_LOG_FILE"
  else
    error "Celery worker failed to start"
    tail -30 "$CELERY_WORKER_LOG_FILE" || true
    exit 1
  fi
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
  ensure_log_dir

  if ! redis_running; then
    warn "Redis not running — starting it first"
    start_redis || { error "Redis unavailable; cannot start Celery beat"; exit 1; }
  fi

  if celery_beat_running; then
    ok "Celery beat already running"
    return 0
  fi

  cd "$BACKEND_DIR"
  venv_activate
  set_backend_env

  info "Starting Celery beat scheduler"
  local pid
  pid="$(spawn_detached \
    "$CELERY_BEAT_PID_FILE" \
    "$CELERY_BEAT_LOG_FILE" \
    "$VENV_DIR/bin/celery" \
      --app=superset.tasks.celery_app:app \
      beat \
      --loglevel=info \
      --schedule="$CELERY_BEAT_SCHEDULE" \
  )"

  local ready=0
  for _ in {1..15}; do
    sleep 1
    if celery_beat_running; then
      ready=1
      break
    fi
  done

  if [[ "$ready" == "1" ]]; then
    ok "Celery beat started (PID: $pid)"
    echo "  Schedule: $CELERY_BEAT_SCHEDULE"
    echo "  Logs:     $CELERY_BEAT_LOG_FILE"
  else
    error "Celery beat failed to start"
    tail -30 "$CELERY_BEAT_LOG_FILE" || true
    exit 1
  fi
}

stop_celery_beat() {
  header "Stopping Celery Beat"
  kill_pid_file "$CELERY_BEAT_PID_FILE" "Celery beat"
  pkill -f "celery.*superset.tasks.celery_app.*beat" 2>/dev/null || true
  ok "Celery beat stopped"
}

restart_celery() {
  header "Restarting Celery Worker + Beat"
  stop_celery_beat || true
  stop_celery_worker || true
  sleep 1
  start_celery_worker
  start_celery_beat
}

celery_status() {
  header "Celery Status"

  if celery_worker_running; then
    local pid
    pid="$(read_pid_file "$CELERY_WORKER_PID_FILE" || echo '?')"
    ok "Celery worker running (PID: $pid)"
    echo "  Logs: $CELERY_WORKER_LOG_FILE"
  else
    warn "Celery worker not running"
    echo "  Start with: ./superset-manager.sh start-celery"
  fi

  if celery_beat_running; then
    local pid
    pid="$(read_pid_file "$CELERY_BEAT_PID_FILE" || echo '?')"
    ok "Celery beat running (PID: $pid)"
    echo "  Logs: $CELERY_BEAT_LOG_FILE"
  else
    warn "Celery beat not running"
    echo "  Start with: ./superset-manager.sh start-celery-beat"
  fi
}

# ----------------------------------------------------------------------------
# Combined
# ----------------------------------------------------------------------------
start_all() {
  header "Starting Backend + Frontend + Celery"
  if [[ "${CLICKHOUSE_ENABLED:-0}" == "1" ]]; then
    start_clickhouse
  fi
  start_backend
  start_celery_worker
  start_celery_beat
  start_frontend
  ok "All services started"
}

stop_all() {
  header "Stopping Backend + Frontend + Celery"
  stop_frontend || true
  stop_celery_beat || true
  stop_celery_worker || true
  stop_backend || true
  if [[ "${CLICKHOUSE_ENABLED:-0}" == "1" ]]; then
    stop_clickhouse || true
  fi
  stop_redis || true
  ok "All services stopped"
}

restart_all() {
  header "Restarting Backend + Frontend + Celery"

  stop_all || true
  sleep 2

  clear_all_cache || true
  clear_logs || true
  sleep 1

  if [[ "${CLICKHOUSE_ENABLED:-0}" == "1" ]]; then
    start_clickhouse
  fi

  db_upgrade
  start_backend
  start_celery_worker
  start_celery_beat
  start_frontend

  ok "All services restarted"
}

status_all() {
  header "Full Status"
  backend_status
  celery_status
  frontend_status
  redis_status
  if [[ "${CLICKHOUSE_ENABLED:-0}" == "1" ]]; then
    clickhouse_status
  fi
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

  start-all             Start backend + celery worker + beat + frontend
  stop-all              Stop everything (frontend, celery, backend, clickhouse, redis)
  restart-all           Restart everything with cache cleanup
  status-all            Show full status

  start-celery          Start Celery worker + beat
  stop-celery           Stop Celery worker + beat
  restart-celery        Restart Celery worker + beat
  start-celery-beat     Start Celery beat scheduler only
  stop-celery-beat      Stop Celery beat scheduler only
  celery-status         Celery worker + beat status

  start-redis           Start Redis
  stop-redis            Stop Redis
  redis-status          Redis status

  install-clickhouse    Install ClickHouse (platform-aware: brew/apt/rpm/binary)
  start-clickhouse      Start ClickHouse server
  stop-clickhouse       Stop ClickHouse server
  restart-clickhouse    Restart ClickHouse server
  clickhouse-status     ClickHouse status (version, databases)
  setup-clickhouse      Create ClickHouse databases, user, and grants
  setup-clickhouse-full Install + start + setup + install Python package (one shot)
  install-clickhouse-python  Install clickhouse-connect Python package

  db-upgrade            Run superset db upgrade && superset init
  install               Install Python requirements into venv
  setup                 Full first-time setup: install + migrate + create admin
  create-admin          Create/update local admin user

  cache                 Clear backend cache
  cache-frontend        Clear frontend cache
  cache-all             Clear all caches
  clear-logs            Clear logs

  logs [backend|frontend|redis|celery|celery-beat|clickhouse|clickhouse-error|clickhouse-stdout] [follow]
  health
  help

Environment:
  CELERY_CONCURRENCY    Worker concurrency (default: 2)
  CLICKHOUSE_ENABLED    Enable ClickHouse management (default: auto-detect)
  CLICKHOUSE_DATA_DIR   ClickHouse data dir (default: \$PROJECT_DIR/.clickhouse)

Examples:
  ./superset-manager.sh setup
  ./superset-manager.sh restart-all
  ./superset-manager.sh start-all
  ./superset-manager.sh start-celery
  ./superset-manager.sh logs celery follow
  ./superset-manager.sh logs clickhouse-error follow
  ./superset-manager.sh db-upgrade
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

    start-celery) restart_celery ;;
    stop-celery) stop_celery_beat; stop_celery_worker ;;
    restart-celery) restart_celery ;;
    start-celery-beat) start_celery_beat ;;
    stop-celery-beat) stop_celery_beat ;;
    celery-status) celery_status ;;

    start-redis) start_redis ;;
    stop-redis) stop_redis ;;
    redis-status) redis_status ;;

    install-clickhouse) install_clickhouse ;;
    start-clickhouse) start_clickhouse ;;
    stop-clickhouse) stop_clickhouse ;;
    restart-clickhouse) restart_clickhouse ;;
    clickhouse-status) clickhouse_status ;;
    setup-clickhouse) setup_clickhouse_dbs ;;
    setup-clickhouse-full) setup_clickhouse_full ;;
    install-clickhouse-python) install_clickhouse_python ;;

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

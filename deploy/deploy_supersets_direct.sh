#!/usr/bin/env bash
set -Eeuo pipefail

# ==============================================================================
# deploy_supersets_direct.sh
# Direct host deployment for DHIS2 Superset
#
# Installs and configures locally on the host machine:
#   - PostgreSQL      (Superset metadata DB)
#   - ClickHouse      (DHIS2 staging / serving / control DBs)
#   - Redis           (Celery broker/backend)
#   - Apache Superset (repo runtime in /opt/superset/work/src)
#   - Gunicorn        (systemd)
#   - Celery worker   (systemd)
#   - Celery beat     (systemd, optional)
#   - Apache2 reverse proxy (optional)
#
# Preserved:
#   - /etc/superset/superset.env
#   - /opt/superset/config/superset_config.py
#   - /opt/superset/backups
#   - /etc/clickhouse-server/clickhouse.env
# ==============================================================================

usage() {
  cat <<'USAGE'
USAGE:
  sudo ./deploy_supersets_direct.sh deploy [options]
  sudo ./deploy_supersets_direct.sh update [options]
  sudo ./deploy_supersets_direct.sh restart [options]
  sudo ./deploy_supersets_direct.sh restart-gunicorn [options]
  sudo ./deploy_supersets_direct.sh restart-celery [options]
  sudo ./deploy_supersets_direct.sh backup [options]

OPTIONS:
  --repo <url>
  --ref <branch|tag|sha>
  --depth <N>
  --submodules
  --domain <fqdn>

  --superset-user <user>
  --superset-group <group>
  --webserver-port <port>
  --bind-address <addr>

  --admin-user <user>
  --admin-email <email>
  --admin-pass <password>
  --admin-first <first>
  --admin-last <last>

  --postgres-db <db>
  --postgres-user <user>
  --postgres-password <password>
  --postgres-port <port>

  --clickhouse-user <user>
  --clickhouse-password <password>
  --clickhouse-host <host>
  --clickhouse-http-port <port>
  --clickhouse-native-port <port>
  --no-clickhouse

  --duckdb
  --no-duckdb
  --celery-beat
  --no-celery-beat
  --celery-concurrency <N>

  --no-frontend
  --frontend-timeout-minutes <N>
  --frontend-typecheck
  --no-frontend-typecheck

  --apache-proxy
  --no-apache-proxy
  --backup
  --help
USAGE
}

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }
log()  { printf '==> [%s] %s\n' "$(timestamp)" "$*"; }
warn() { printf 'WARN [%s] %s\n' "$(timestamp)" "$*" >&2; }
die()  { printf 'ERROR [%s] %s\n' "$(timestamp)" "$*" >&2; exit 1; }
has_cmd() { command -v "$1" >/dev/null 2>&1; }

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Run this script as root (sudo)."
}

shell_quote() { printf '%q' "$1"; }

random_password() {
  if has_cmd openssl; then
    openssl rand -base64 48 | tr -d '\n' | sed 's#[/=+]#A#g' | cut -c1-32
    return
  fi
  python3 - <<'PY'
import secrets
alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%._-'
print(''.join(secrets.choice(alphabet) for _ in range(32)))
PY
}

safe_apt_update() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=5 update
}

safe_apt_install() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=5 install -y "$@"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$SCRIPT_DIR/.env}"

# Repo / source
REPO_URL="${REPO_URL:-https://github.com/HISP-Uganda/dhis2-superset.git}"
GIT_REF="${GIT_REF:-martbase}"
GIT_DEPTH="${GIT_DEPTH:-0}"
GIT_SUBMODULES="${GIT_SUBMODULES:-0}"

# Runtime paths
SUPERSET_USER="${SUPERSET_USER:-superset}"
SUPERSET_GROUP="${SUPERSET_GROUP:-superset}"
SUPERSET_HOME="${SUPERSET_HOME:-/opt/superset}"
CONFIG_DIR="${CONFIG_DIR:-$SUPERSET_HOME/config}"
BACKUP_DIR="${BACKUP_DIR:-$SUPERSET_HOME/backups}"
LOG_DIR="${LOG_DIR:-$SUPERSET_HOME/logs}"
WORK_DIR="${WORK_DIR:-$SUPERSET_HOME/work}"
WORK_SRC="${WORK_SRC:-$WORK_DIR/src}"
VENV="${VENV:-$SUPERSET_HOME/venv}"

ENV_DIR="${ENV_DIR:-/etc/superset}"
ENV_FILE="${ENV_FILE:-$ENV_DIR/superset.env}"
SUPERSET_CONFIG_FILE="${SUPERSET_CONFIG_FILE:-$CONFIG_DIR/superset_config.py}"
CLICKHOUSE_ENV_FILE="${CLICKHOUSE_ENV_FILE:-/etc/clickhouse-server/clickhouse.env}"

# Service / networking
DOMAIN="${DOMAIN:-supersets.hispuganda.org}"
BIND_ADDRESS="${BIND_ADDRESS:-127.0.0.1}"
SUPERSET_WEBSERVER_PORT="${SUPERSET_WEBSERVER_PORT:-8088}"
PUBLIC_PORT="${PUBLIC_PORT:-80}"
APACHE_PROXY_ENABLED="${APACHE_PROXY_ENABLED:-1}"

# Frontend
FRONTEND="${FRONTEND:-best}"
FRONTEND_CLEAN="${FRONTEND_CLEAN:-1}"
FRONTEND_TIMEOUT_MINUTES="${FRONTEND_TIMEOUT_MINUTES:-90}"
FRONTEND_TYPECHECK="${FRONTEND_TYPECHECK:-0}"
NPM_LEGACY_PEER_DEPS="${NPM_LEGACY_PEER_DEPS:-1}"
NODE_OPTIONS_VALUE="${NODE_OPTIONS_VALUE:---max_old_space_size=8192}"
FRONTEND_LOG="${FRONTEND_LOG:-$LOG_DIR/frontend-build.log}"

# PostgreSQL metadata DB
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-superset_metadata}"
POSTGRES_USER="${POSTGRES_USER:-superset}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-__AUTO_GENERATE__}"

# Redis / Celery
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}"
ENABLE_CELERY_WORKER="${ENABLE_CELERY_WORKER:-1}"
ENABLE_CELERY_BEAT="${ENABLE_CELERY_BEAT:-1}"
CELERY_CONCURRENCY="${CELERY_CONCURRENCY:-0}"

# ClickHouse
CLICKHOUSE_ENABLED="${CLICKHOUSE_ENABLED:-1}"
CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-127.0.0.1}"
CLICKHOUSE_HTTP_PORT="${CLICKHOUSE_HTTP_PORT:-8123}"
CLICKHOUSE_NATIVE_PORT="${CLICKHOUSE_NATIVE_PORT:-9000}"
CLICKHOUSE_STAGING_DATABASE="${CLICKHOUSE_STAGING_DATABASE:-dhis2_staging}"
CLICKHOUSE_SERVING_DATABASE="${CLICKHOUSE_SERVING_DATABASE:-dhis2_serving}"
CLICKHOUSE_CONTROL_DATABASE="${CLICKHOUSE_CONTROL_DATABASE:-dhis2_control}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-superset_clickhouse}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-__AUTO_GENERATE__}"
CLICKHOUSE_SUPERSET_DB_NAME="${CLICKHOUSE_SUPERSET_DB_NAME:-DHIS2_Serving_Clickhouse}"
CLICKHOUSE_PYTHON_PACKAGE="${CLICKHOUSE_PYTHON_PACKAGE:-clickhouse-connect}"

# DuckDB
DUCKDB_ENABLED="${DUCKDB_ENABLED:-0}"
DUCKDB_PYTHON_PACKAGE="${DUCKDB_PYTHON_PACKAGE:-duckdb}"
DUCKDB_SQLALCHEMY_PACKAGE="${DUCKDB_SQLALCHEMY_PACKAGE:-duckdb-engine}"

# Admin / app config
SECRET_KEY="${SECRET_KEY:-__AUTO_GENERATE__}"
SUPERSET_SECRET_KEY="${SUPERSET_SECRET_KEY:-}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASS="${ADMIN_PASS:-Admin@2026}"
ADMIN_FIRST="${ADMIN_FIRST:-Admin}"
ADMIN_LAST="${ADMIN_LAST:-User}"

# Optional behavior
DO_BACKUP="${DO_BACKUP:-0}"

# Resource assignment defaults (host-aware)
HOST_CPU_COUNT="$(nproc 2>/dev/null || echo 2)"
HOST_MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 4096)"
GUNICORN_WORKERS="${GUNICORN_WORKERS:-0}"
GUNICORN_THREADS="${GUNICORN_THREADS:-4}"

if [[ -f "$DEPLOY_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$DEPLOY_ENV_FILE"
  set +a
fi

compute_defaults() {
  if [[ "$GUNICORN_WORKERS" == "0" ]]; then
    local workers=$(( HOST_CPU_COUNT * 2 ))
    (( workers < 2 )) && workers=2
    (( workers > 8 )) && workers=8
    GUNICORN_WORKERS="$workers"
  fi

  if [[ "$CELERY_CONCURRENCY" == "0" ]]; then
    local conc="$HOST_CPU_COUNT"
    (( conc < 2 )) && conc=2
    (( conc > 8 )) && conc=8
    CELERY_CONCURRENCY="$conc"
  fi
}

parse_args() {
  local cmd="${1:-}"
  shift || true
  [[ -n "$cmd" ]] || { usage; exit 1; }

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo) REPO_URL="$2"; shift 2 ;;
      --ref) GIT_REF="$2"; shift 2 ;;
      --depth) GIT_DEPTH="$2"; shift 2 ;;
      --submodules) GIT_SUBMODULES=1; shift ;;
      --domain) DOMAIN="$2"; shift 2 ;;

      --superset-user) SUPERSET_USER="$2"; SUPERSET_GROUP="$2"; shift 2 ;;
      --superset-group) SUPERSET_GROUP="$2"; shift 2 ;;
      --webserver-port) SUPERSET_WEBSERVER_PORT="$2"; shift 2 ;;
      --bind-address) BIND_ADDRESS="$2"; shift 2 ;;

      --admin-user) ADMIN_USER="$2"; shift 2 ;;
      --admin-email) ADMIN_EMAIL="$2"; shift 2 ;;
      --admin-pass) ADMIN_PASS="$2"; shift 2 ;;
      --admin-first) ADMIN_FIRST="$2"; shift 2 ;;
      --admin-last) ADMIN_LAST="$2"; shift 2 ;;

      --postgres-db) POSTGRES_DB="$2"; shift 2 ;;
      --postgres-user) POSTGRES_USER="$2"; shift 2 ;;
      --postgres-password) POSTGRES_PASSWORD="$2"; shift 2 ;;
      --postgres-port) POSTGRES_PORT="$2"; shift 2 ;;

      --clickhouse-user) CLICKHOUSE_USER="$2"; shift 2 ;;
      --clickhouse-password) CLICKHOUSE_PASSWORD="$2"; shift 2 ;;
      --clickhouse-host) CLICKHOUSE_HOST="$2"; shift 2 ;;
      --clickhouse-http-port) CLICKHOUSE_HTTP_PORT="$2"; shift 2 ;;
      --clickhouse-native-port) CLICKHOUSE_NATIVE_PORT="$2"; shift 2 ;;
      --no-clickhouse) CLICKHOUSE_ENABLED=0; shift ;;

      --duckdb) DUCKDB_ENABLED=1; shift ;;
      --no-duckdb) DUCKDB_ENABLED=0; shift ;;
      --celery-beat) ENABLE_CELERY_BEAT=1; shift ;;
      --no-celery-beat) ENABLE_CELERY_BEAT=0; shift ;;
      --celery-concurrency) CELERY_CONCURRENCY="$2"; shift 2 ;;

      --no-frontend) FRONTEND=skip; shift ;;
      --frontend-timeout-minutes) FRONTEND_TIMEOUT_MINUTES="$2"; shift 2 ;;
      --frontend-typecheck) FRONTEND_TYPECHECK=1; shift ;;
      --no-frontend-typecheck) FRONTEND_TYPECHECK=0; shift ;;

      --apache-proxy) APACHE_PROXY_ENABLED=1; shift ;;
      --no-apache-proxy) APACHE_PROXY_ENABLED=0; shift ;;
      --backup) DO_BACKUP=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1" ;;
    esac
  done

  printf '%s\n' "$cmd"
}

ensure_users_and_dirs() {
  getent group "$SUPERSET_GROUP" >/dev/null 2>&1 || groupadd --system "$SUPERSET_GROUP"
  id -u "$SUPERSET_USER" >/dev/null 2>&1 || useradd --system --gid "$SUPERSET_GROUP" --home-dir "$SUPERSET_HOME" --create-home --shell /bin/bash "$SUPERSET_USER"

  mkdir -p "$SUPERSET_HOME" "$CONFIG_DIR" "$BACKUP_DIR" "$LOG_DIR" "$WORK_DIR" "$ENV_DIR"
  chown -R "$SUPERSET_USER:$SUPERSET_GROUP" "$SUPERSET_HOME"
  chmod 0755 "$SUPERSET_HOME" "$CONFIG_DIR" "$BACKUP_DIR" "$LOG_DIR" "$WORK_DIR"
}

install_base_packages() {
  log "Installing OS packages"
  safe_apt_update
  safe_apt_install \
    ca-certificates curl gnupg lsb-release apt-transport-https software-properties-common \
    build-essential git rsync tar unzip procps psmisc netcat-openbsd util-linux pkg-config \
    python3 python3-dev python3-venv libpq-dev libffi-dev libssl-dev libsasl2-dev libldap2-dev \
    libjpeg-dev zlib1g-dev redis-server apache2 postgresql postgresql-contrib
}

install_node_if_needed() {
  if has_cmd node && has_cmd npm; then
    return 0
  fi
  log "Installing Node.js 20.x"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  safe_apt_install nodejs
}

install_clickhouse_repo_and_packages() {
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] || return 0
  if has_cmd clickhouse-server && has_cmd clickhouse-client; then
    return 0
  fi

  log "Installing ClickHouse"
  safe_apt_install apt-transport-https ca-certificates curl gnupg
  rm -f /usr/share/keyrings/clickhouse-keyring.gpg
  curl -fsSL https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key \
    | gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg
  local arch
  arch="$(dpkg --print-architecture)"
  cat > /etc/apt/sources.list.d/clickhouse.list <<EOF2

deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg arch=${arch}] https://packages.clickhouse.com/deb stable main
EOF2
  safe_apt_update
  safe_apt_install clickhouse-server clickhouse-client
}

ensure_postgres_running() {
  systemctl enable --now postgresql
  systemctl is-active --quiet postgresql || die "PostgreSQL did not start"
}

ensure_redis_running() {
  systemctl enable --now redis-server
  systemctl is-active --quiet redis-server || die "Redis did not start"
}

ensure_clickhouse_running() {
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] || return 0
  systemctl enable --now clickhouse-server
  local tries=0
  until curl -sf "http://127.0.0.1:${CLICKHOUSE_HTTP_PORT}/ping" >/dev/null 2>&1; do
    tries=$((tries + 1))
    (( tries <= 30 )) || die "ClickHouse did not become ready"
    sleep 1
  done
}

ensure_passwords() {
  [[ "$POSTGRES_PASSWORD" != "__AUTO_GENERATE__" ]] || POSTGRES_PASSWORD="$(random_password)"
  [[ "$CLICKHOUSE_PASSWORD" != "__AUTO_GENERATE__" ]] || CLICKHOUSE_PASSWORD="$(random_password)"

  if [[ "$SECRET_KEY" == "__AUTO_GENERATE__" ]]; then
    SECRET_KEY="$(random_password)$(random_password | cut -c1-16)"
  fi
  [[ -n "$SUPERSET_SECRET_KEY" ]] || SUPERSET_SECRET_KEY="$SECRET_KEY"
}

write_clickhouse_env() {
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] || return 0
  mkdir -p "$(dirname "$CLICKHOUSE_ENV_FILE")"
  umask 077
  cat > "$CLICKHOUSE_ENV_FILE" <<EOF2
CLICKHOUSE_USER=$(shell_quote "$CLICKHOUSE_USER")
CLICKHOUSE_PASSWORD=$(shell_quote "$CLICKHOUSE_PASSWORD")
CLICKHOUSE_HOST=$(shell_quote "$CLICKHOUSE_HOST")
CLICKHOUSE_PORT=$(shell_quote "$CLICKHOUSE_NATIVE_PORT")
CLICKHOUSE_HTTP_PORT=$(shell_quote "$CLICKHOUSE_HTTP_PORT")
CLICKHOUSE_DATABASE=$(shell_quote "$CLICKHOUSE_STAGING_DATABASE")
CLICKHOUSE_SERVING_DATABASE=$(shell_quote "$CLICKHOUSE_SERVING_DATABASE")
CLICKHOUSE_CONTROL_DATABASE=$(shell_quote "$CLICKHOUSE_CONTROL_DATABASE")
EOF2
}

configure_postgres_metadata_db() {
  log "Configuring PostgreSQL metadata database"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF2
DO \
\$\$\
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${POSTGRES_USER}') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', '${POSTGRES_USER}', '${POSTGRES_PASSWORD}');
  ELSE
    EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', '${POSTGRES_USER}', '${POSTGRES_PASSWORD}');
  END IF;
END
\$\$;
EOF2

  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | grep -q 1 \
    || sudo -u postgres createdb -O "$POSTGRES_USER" "$POSTGRES_DB"

  sudo -u postgres psql -v ON_ERROR_STOP=1 <<EOF2
ALTER DATABASE "${POSTGRES_DB}" OWNER TO "${POSTGRES_USER}";
GRANT ALL PRIVILEGES ON DATABASE "${POSTGRES_DB}" TO "${POSTGRES_USER}";
EOF2
}

configure_clickhouse() {
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] || return 0
  log "Configuring ClickHouse user and databases"

  clickhouse-client --multiquery <<EOF2
CREATE DATABASE IF NOT EXISTS \`${CLICKHOUSE_STAGING_DATABASE}\`;
CREATE DATABASE IF NOT EXISTS \`${CLICKHOUSE_SERVING_DATABASE}\`;
CREATE DATABASE IF NOT EXISTS \`${CLICKHOUSE_CONTROL_DATABASE}\`;
CREATE USER IF NOT EXISTS ${CLICKHOUSE_USER} IDENTIFIED BY '${CLICKHOUSE_PASSWORD}';
ALTER USER ${CLICKHOUSE_USER} IDENTIFIED BY '${CLICKHOUSE_PASSWORD}';
GRANT ALL ON \`${CLICKHOUSE_STAGING_DATABASE}\`.* TO ${CLICKHOUSE_USER};
GRANT ALL ON \`${CLICKHOUSE_SERVING_DATABASE}\`.* TO ${CLICKHOUSE_USER};
GRANT ALL ON \`${CLICKHOUSE_CONTROL_DATABASE}\`.* TO ${CLICKHOUSE_USER};
GRANT SELECT ON system.tables TO ${CLICKHOUSE_USER};
GRANT SELECT ON system.columns TO ${CLICKHOUSE_USER};
GRANT SELECT ON system.parts TO ${CLICKHOUSE_USER};
EOF2
}

write_superset_env() {
  log "Writing $ENV_FILE"
  umask 077
  cat > "$ENV_FILE" <<EOF2
SUPERSET_HOME=$(shell_quote "$SUPERSET_HOME")
SUPERSET_CONFIG_PATH=$(shell_quote "$SUPERSET_CONFIG_FILE")
SUPERSET_WEBSERVER_PORT=$(shell_quote "$SUPERSET_WEBSERVER_PORT")
SUPERSET_WEBSERVER_ADDRESS=$(shell_quote "$BIND_ADDRESS")

SECRET_KEY=$(shell_quote "$SECRET_KEY")
SUPERSET_SECRET_KEY=$(shell_quote "$SUPERSET_SECRET_KEY")

POSTGRES_HOST=$(shell_quote "$POSTGRES_HOST")
POSTGRES_PORT=$(shell_quote "$POSTGRES_PORT")
POSTGRES_DB=$(shell_quote "$POSTGRES_DB")
POSTGRES_USER=$(shell_quote "$POSTGRES_USER")
POSTGRES_PASSWORD=$(shell_quote "$POSTGRES_PASSWORD")
SUPERSET_DB_URI=$(shell_quote "postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}")

REDIS_URL=$(shell_quote "$REDIS_URL")
CELERY_BROKER_URL=$(shell_quote "$REDIS_URL")
CELERY_RESULT_BACKEND=$(shell_quote "$REDIS_URL")

FEATURE_FLAGS=$(shell_quote '{"ALERT_REPORTS": false}')
MAPBOX_API_KEY=$(shell_quote "")

DHIS2_SERVING_ENGINE=$(shell_quote "$( [[ "$CLICKHOUSE_ENABLED" == "1" ]] && printf clickhouse || printf postgres )")
DHIS2_CLICKHOUSE_ENABLED=$(shell_quote "$( [[ "$CLICKHOUSE_ENABLED" == "1" ]] && printf true || printf false )")
DHIS2_CLICKHOUSE_HOST=$(shell_quote "$CLICKHOUSE_HOST")
DHIS2_CLICKHOUSE_PORT=$(shell_quote "$CLICKHOUSE_NATIVE_PORT")
DHIS2_CLICKHOUSE_HTTP_PORT=$(shell_quote "$CLICKHOUSE_HTTP_PORT")
DHIS2_CLICKHOUSE_DATABASE=$(shell_quote "$CLICKHOUSE_STAGING_DATABASE")
DHIS2_CLICKHOUSE_SERVING_DATABASE=$(shell_quote "$CLICKHOUSE_SERVING_DATABASE")
DHIS2_CLICKHOUSE_CONTROL_DATABASE=$(shell_quote "$CLICKHOUSE_CONTROL_DATABASE")
DHIS2_CLICKHOUSE_USER=$(shell_quote "$CLICKHOUSE_USER")
DHIS2_CLICKHOUSE_PASSWORD=$(shell_quote "$CLICKHOUSE_PASSWORD")
DHIS2_CLICKHOUSE_SECURE=$(shell_quote "false")
DHIS2_CLICKHOUSE_HTTP_PROTOCOL=$(shell_quote "http")
DHIS2_CLICKHOUSE_SUPERSET_DB_NAME=$(shell_quote "$CLICKHOUSE_SUPERSET_DB_NAME")
DHIS2_CLICKHOUSE_REFRESH_STRATEGY=$(shell_quote "versioned_view_swap")
DHIS2_CLICKHOUSE_KEEP_OLD_VERSIONS=$(shell_quote "2")

DUCKDB_ENABLED=$(shell_quote "$DUCKDB_ENABLED")
DUCKDB_PYTHON_PACKAGE=$(shell_quote "$DUCKDB_PYTHON_PACKAGE")
DUCKDB_SQLALCHEMY_PACKAGE=$(shell_quote "$DUCKDB_SQLALCHEMY_PACKAGE")
DHIS2_DUCKDB_PATH=$(shell_quote "/var/lib/superset/dhis2_staging.duckdb")
DHIS2_DUCKDB_READ_ONLY_RETRY_COUNT=$(shell_quote "3")
DHIS2_DUCKDB_READ_ONLY_RETRY_DELAY_MS=$(shell_quote "300")
DHIS2_DUCKDB_SINGLE_WRITER_ENABLED=$(shell_quote "true")
DHIS2_DUCKDB_ENABLE_TEMP_SWAP_LOADS=$(shell_quote "true")
DHIS2_DUCKDB_VISIBLE_DATASET_MODE=$(shell_quote "canonical_only")

PYTHONPATH=$(shell_quote "$WORK_SRC")
EOF2

  chown root:"$SUPERSET_GROUP" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
}

write_superset_config_if_missing() {
  if [[ -f "$SUPERSET_CONFIG_FILE" ]]; then
    log "Keeping existing $SUPERSET_CONFIG_FILE"
    return 0
  fi

  log "Creating default $SUPERSET_CONFIG_FILE"
  cat > "$SUPERSET_CONFIG_FILE" <<'PY'
import json
import os
from celery.schedules import crontab

SQLALCHEMY_DATABASE_URI = os.environ["SUPERSET_DB_URI"]
SECRET_KEY = os.environ.get("SECRET_KEY") or os.environ.get("SUPERSET_SECRET_KEY")

ROW_LIMIT = 5000
SQLLAB_ASYNC_TIME_LIMIT_SEC = 6 * 60 * 60
SUPERSET_WEBSERVER_PORT = int(os.environ.get("SUPERSET_WEBSERVER_PORT", "8088"))
SUPERSET_WEBSERVER_ADDRESS = os.environ.get("SUPERSET_WEBSERVER_ADDRESS", "127.0.0.1")

REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", REDIS_URL)
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", REDIS_URL)

class CeleryConfig:
    broker_url = CELERY_BROKER_URL
    result_backend = CELERY_RESULT_BACKEND
    imports = (
        "superset.sql_lab",
        "superset.tasks.scheduler",
        "superset.tasks.thumbnails",
        "superset.tasks.cache",
    )
    task_annotations = {"sql_lab.get_sql_results": {"rate_limit": "100/s"}}
    worker_prefetch_multiplier = 1
    task_acks_late = False
    beat_schedule = {
        "reports.scheduler": {
            "task": "reports.scheduler",
            "schedule": crontab(minute="*", hour="*"),
        },
        "cache-warmup": {
            "task": "cache-warmup",
            "schedule": crontab(minute="*/30", hour="*"),
            "kwargs": {"strategy_name": "top_n_dashboards", "top_n": 10, "since": "7 days ago"},
        },
    }

CELERY_CONFIG = CeleryConfig

FEATURE_FLAGS = json.loads(os.environ.get("FEATURE_FLAGS", "{}"))
WTF_CSRF_ENABLED = True
TALISMAN_ENABLED = False
ENABLE_PROXY_FIX = True
PREFERRED_URL_SCHEME = "https"
PY

  chown "$SUPERSET_USER:$SUPERSET_GROUP" "$SUPERSET_CONFIG_FILE"
  chmod 0640 "$SUPERSET_CONFIG_FILE"
}

clone_or_update_repo() {
  log "Syncing repository to $WORK_SRC"
  if [[ ! -d "$WORK_SRC/.git" ]]; then
    rm -rf "$WORK_SRC"
    mkdir -p "$WORK_DIR"
    if [[ "$GIT_DEPTH" != "0" ]]; then
      git clone --depth "$GIT_DEPTH" "$REPO_URL" "$WORK_SRC"
    else
      git clone "$REPO_URL" "$WORK_SRC"
    fi
  fi

  git -C "$WORK_SRC" remote set-url origin "$REPO_URL"
  git -C "$WORK_SRC" fetch origin --tags --prune

  if git -C "$WORK_SRC" show-ref --verify --quiet "refs/remotes/origin/$GIT_REF"; then
    git -C "$WORK_SRC" checkout -B "$GIT_REF" "origin/$GIT_REF"
    git -C "$WORK_SRC" reset --hard "origin/$GIT_REF"
  else
    git -C "$WORK_SRC" checkout --force "$GIT_REF"
    git -C "$WORK_SRC" reset --hard "$GIT_REF"
  fi

  git -C "$WORK_SRC" clean -fd

  if [[ "$GIT_SUBMODULES" == "1" ]]; then
    git -C "$WORK_SRC" submodule sync --recursive
    git -C "$WORK_SRC" submodule update --init --recursive
  fi

  chown -R "$SUPERSET_USER:$SUPERSET_GROUP" "$WORK_SRC"
}

ensure_venv_and_backend() {
  log "Installing Python environment"
  [[ -x "$VENV/bin/python3" ]] || python3 -m venv "$VENV"
  "$VENV/bin/pip" install -U pip setuptools wheel

  cd "$WORK_SRC"
  [[ -f setup.py || -f pyproject.toml ]] || die "Repository at $WORK_SRC is not installable"

  [[ -f requirements/base.txt ]] && "$VENV/bin/pip" install -r requirements/base.txt || true
  [[ -f requirements/local.txt ]] && "$VENV/bin/pip" install -r requirements/local.txt || true
  "$VENV/bin/pip" install -U .
  "$VENV/bin/pip" install -U 'gunicorn>=22.0.0' 'redis>=4.6,<5.0' 'celery>=5.3,<5.6' 'psycopg2-binary>=2.9,<3.0'

  if [[ "$CLICKHOUSE_ENABLED" == "1" ]]; then
    "$VENV/bin/pip" install -U "$CLICKHOUSE_PYTHON_PACKAGE"
  fi

  if [[ "$DUCKDB_ENABLED" == "1" ]]; then
    "$VENV/bin/pip" install -U "$DUCKDB_PYTHON_PACKAGE" "$DUCKDB_SQLALCHEMY_PACKAGE"
  fi

  chown -R "$SUPERSET_USER:$SUPERSET_GROUP" "$VENV"
}

build_frontend() {
  [[ "$FRONTEND" != "skip" ]] || { log "Skipping frontend build"; return 0; }
  [[ -d "$WORK_SRC/superset-frontend" ]] || { warn "superset-frontend not found; skipping frontend build"; return 0; }

  install_node_if_needed

  log "Building frontend assets"
  cd "$WORK_SRC/superset-frontend"

  if [[ "$FRONTEND_CLEAN" == "1" ]]; then
    rm -rf node_modules .cache .temp_cache node_modules/.cache "$WORK_SRC/superset/static/assets" dist /tmp/webpack-* /tmp/.webpack-*
  fi

  export NODE_OPTIONS="$NODE_OPTIONS_VALUE"
  export CI=1
  export npm_config_progress=false
  export npm_config_audit=false
  export npm_config_fund=false
  export PUPPETEER_SKIP_DOWNLOAD=1

  mkdir -p "$LOG_DIR"
  : > "$FRONTEND_LOG"

  if [[ -f package-lock.json ]]; then
    timeout --foreground "${FRONTEND_TIMEOUT_MINUTES}m" npm ci --legacy-peer-deps >> "$FRONTEND_LOG" 2>&1 \
      || timeout --foreground "${FRONTEND_TIMEOUT_MINUTES}m" npm install --legacy-peer-deps >> "$FRONTEND_LOG" 2>&1
  else
    if [[ "$NPM_LEGACY_PEER_DEPS" == "1" ]]; then
      timeout --foreground "${FRONTEND_TIMEOUT_MINUTES}m" npm install --legacy-peer-deps >> "$FRONTEND_LOG" 2>&1
    else
      timeout --foreground "${FRONTEND_TIMEOUT_MINUTES}m" npm install >> "$FRONTEND_LOG" 2>&1
    fi
  fi

  if [[ "$FRONTEND_TYPECHECK" == "1" ]]; then
    timeout --foreground "${FRONTEND_TIMEOUT_MINUTES}m" npm run type:refs >> "$FRONTEND_LOG" 2>&1
    timeout --foreground "${FRONTEND_TIMEOUT_MINUTES}m" npm run type -- --pretty false >> "$FRONTEND_LOG" 2>&1
  fi

  timeout --foreground "${FRONTEND_TIMEOUT_MINUTES}m" npm run build >> "$FRONTEND_LOG" 2>&1
  [[ -d "$WORK_SRC/superset/static/assets" ]] || die "Frontend build did not create superset/static/assets. See $FRONTEND_LOG"

  chown -R "$SUPERSET_USER:$SUPERSET_GROUP" "$WORK_SRC"
}

validate_python_env() {
  log "Validating Python runtime"
  sudo -u "$SUPERSET_USER" -H bash -lc "
    set -a
    . '$ENV_FILE'
    set +a
    PYTHONPATH='$WORK_SRC' '$VENV/bin/python' - <<'PY'
import inspect
import os
import psycopg2
import redis
import superset
print('SUPERSET_FROM', inspect.getfile(superset))
print('DB_URI_OK', os.environ.get('SUPERSET_DB_URI', ''))
print('PSYCOPG2_OK', psycopg2.__version__)
print('REDIS_OK', redis.__version__)
PY
  "

  if [[ "$CLICKHOUSE_ENABLED" == "1" ]]; then
    sudo -u "$SUPERSET_USER" -H bash -lc "
      set -a
      . '$ENV_FILE'
      set +a
      PYTHONPATH='$WORK_SRC' '$VENV/bin/python' - <<'PY'
import clickhouse_connect
client = clickhouse_connect.get_client(
    host='${CLICKHOUSE_HOST}',
    port=${CLICKHOUSE_HTTP_PORT},
    username='${CLICKHOUSE_USER}',
    password='${CLICKHOUSE_PASSWORD}',
)
print('CLICKHOUSE_OK', client.query('SELECT version()').result_rows[0][0])
PY
    "
  fi
}

backup_metadata_db() {
  mkdir -p "$BACKUP_DIR"
  local stamp
  stamp="$(date +%Y%m%d%H%M%S)"
  log "Backing up PostgreSQL metadata DB to $BACKUP_DIR"
  sudo -u postgres pg_dump -Fc "$POSTGRES_DB" > "$BACKUP_DIR/metadata-${POSTGRES_DB}-${stamp}.dump"
  chown "$SUPERSET_USER:$SUPERSET_GROUP" "$BACKUP_DIR/metadata-${POSTGRES_DB}-${stamp}.dump"
}

superset_cli() {
  local cmdline
  printf -v cmdline '%q ' "$@"
  sudo -u "$SUPERSET_USER" -H bash -lc "
    set -a
    . '$ENV_FILE'
    set +a
    export PYTHONPATH='$WORK_SRC'
    exec $(printf '%q' "$VENV/bin/superset") ${cmdline}
  "
}

run_db_upgrade_and_init() {
  [[ "$DO_BACKUP" == "1" ]] && backup_metadata_db
  log "Running Superset DB migrations and init"
  superset_cli db upgrade
  superset_cli fab create-admin \
    --username "$(shell_quote "$ADMIN_USER")" \
    --firstname "$(shell_quote "$ADMIN_FIRST")" \
    --lastname "$(shell_quote "$ADMIN_LAST")" \
    --email "$(shell_quote "$ADMIN_EMAIL")" \
    --password "$(shell_quote "$ADMIN_PASS")" || true
  superset_cli init
}

sync_local_staging_clickhouse_config() {
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] || return 0
  log "Syncing ClickHouse config into local staging settings"
  sudo -u "$SUPERSET_USER" -H bash -lc "
    set -a
    . '$ENV_FILE'
    set +a
    export PYTHONPATH='$WORK_SRC'
    '$VENV/bin/python' - <<'PY'
import os
import sys
sys.path.insert(0, os.environ['PYTHONPATH'])
try:
    from superset import create_app, db
    app = create_app()
    with app.app_context():
        from superset.local_staging.platform_settings import LocalStagingSettings
        s = LocalStagingSettings.get()
        cfg = s.get_clickhouse_config()
        cfg.update({
            'host': os.environ.get('DHIS2_CLICKHOUSE_HOST', '${CLICKHOUSE_HOST}'),
            'http_port': int(os.environ.get('DHIS2_CLICKHOUSE_HTTP_PORT', '${CLICKHOUSE_HTTP_PORT}')),
            'port': int(os.environ.get('DHIS2_CLICKHOUSE_PORT', '${CLICKHOUSE_NATIVE_PORT}')),
            'database': os.environ.get('DHIS2_CLICKHOUSE_DATABASE', '${CLICKHOUSE_STAGING_DATABASE}'),
            'serving_database': os.environ.get('DHIS2_CLICKHOUSE_SERVING_DATABASE', '${CLICKHOUSE_SERVING_DATABASE}'),
            'user': os.environ.get('DHIS2_CLICKHOUSE_USER', '${CLICKHOUSE_USER}'),
            'password': os.environ.get('DHIS2_CLICKHOUSE_PASSWORD', '${CLICKHOUSE_PASSWORD}'),
            'secure': False,
            'verify': True,
            'connect_timeout': 10,
            'send_receive_timeout': 300,
        })
        s.set_clickhouse_config(cfg)
        if getattr(s, 'active_engine', None) != 'clickhouse':
            s.active_engine = 'clickhouse'
        db.session.commit()
        print('CLICKHOUSE_CONFIG_SYNC_OK')
except Exception as exc:
    print(f'CLICKHOUSE_CONFIG_SYNC_WARN: {exc}')
PY
  "
}

run_dhis2_backfill_if_present() {
  log "Running DHIS2 compatibility backfill if available"
  sudo -u "$SUPERSET_USER" -H bash -lc "
    set -a
    . '$ENV_FILE'
    set +a
    export PYTHONPATH='$WORK_SRC'
    '$VENV/bin/python' - <<'PY'
import sys
import os
sys.path.insert(0, os.environ['PYTHONPATH'])
try:
    from superset import create_app
    app = create_app()
    with app.app_context():
        try:
            from superset.dhis2.backfill import run_compatibility_backfill
            run_compatibility_backfill()
            print('DHIS2_BACKFILL_OK')
        except Exception as exc:
            print(f'DHIS2_BACKFILL_WARN: {exc}')
except Exception as exc:
    print(f'DHIS2_APP_WARN: {exc}')
PY
  "
}

write_gunicorn_service() {
  cat > /etc/systemd/system/superset-gunicorn.service <<EOF2
[Unit]
Description=Apache Superset Gunicorn
After=network.target postgresql.service redis-server.service
Wants=postgresql.service redis-server.service

[Service]
Type=simple
User=${SUPERSET_USER}
Group=${SUPERSET_GROUP}
WorkingDirectory=${SUPERSET_HOME}
EnvironmentFile=${ENV_FILE}
Environment=PYTHONPATH=${WORK_SRC}
Environment=PYTHONUNBUFFERED=1
ExecStart=${VENV}/bin/gunicorn \
  --workers ${GUNICORN_WORKERS} \
  --threads ${GUNICORN_THREADS} \
  --worker-class gthread \
  --timeout 300 \
  --graceful-timeout 60 \
  --keep-alive 5 \
  --bind ${BIND_ADDRESS}:${SUPERSET_WEBSERVER_PORT} \
  --access-logfile - \
  --error-logfile - \
  'superset.app:create_app()'
Restart=always
RestartSec=5
TimeoutStartSec=120
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${SUPERSET_HOME} /tmp /var/tmp

[Install]
WantedBy=multi-user.target
EOF2
}

write_celery_services() {
  cat > /etc/systemd/system/superset-celery-worker.service <<EOF2
[Unit]
Description=Superset Celery Worker
After=network.target redis-server.service postgresql.service
Wants=redis-server.service postgresql.service

[Service]
Type=simple
User=${SUPERSET_USER}
Group=${SUPERSET_GROUP}
WorkingDirectory=${SUPERSET_HOME}
EnvironmentFile=${ENV_FILE}
Environment=PYTHONPATH=${WORK_SRC}
ExecStart=${VENV}/bin/celery --app=superset.tasks.celery_app:app worker --pool=prefork -O fair -c ${CELERY_CONCURRENCY} -Q celery,dhis2
Restart=always
RestartSec=5
TimeoutStartSec=120
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${SUPERSET_HOME} /tmp /var/tmp

[Install]
WantedBy=multi-user.target
EOF2

  cat > /etc/systemd/system/superset-celery-beat.service <<EOF2
[Unit]
Description=Superset Celery Beat
After=network.target redis-server.service postgresql.service
Wants=redis-server.service postgresql.service

[Service]
Type=simple
User=${SUPERSET_USER}
Group=${SUPERSET_GROUP}
WorkingDirectory=${SUPERSET_HOME}
EnvironmentFile=${ENV_FILE}
Environment=PYTHONPATH=${WORK_SRC}
ExecStart=${VENV}/bin/celery --app=superset.tasks.celery_app:app beat --schedule=${SUPERSET_HOME}/celerybeat-schedule
Restart=always
RestartSec=5
TimeoutStartSec=120
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=${SUPERSET_HOME} /tmp /var/tmp

[Install]
WantedBy=multi-user.target
EOF2
}

configure_apache_proxy() {
  [[ "$APACHE_PROXY_ENABLED" == "1" ]] || return 0
  log "Configuring Apache reverse proxy"
  a2enmod proxy proxy_http headers rewrite >/dev/null

  cat > /etc/apache2/sites-available/superset.conf <<EOF2
<VirtualHost *:${PUBLIC_PORT}>
    ServerName ${DOMAIN}

    ProxyPreserveHost On
    ProxyPass / http://${BIND_ADDRESS}:${SUPERSET_WEBSERVER_PORT}/ retry=0 timeout=300 Keepalive=On
    ProxyPassReverse / http://${BIND_ADDRESS}:${SUPERSET_WEBSERVER_PORT}/

    RequestHeader set X-Forwarded-Proto "http"
    RequestHeader set X-Forwarded-Port "${PUBLIC_PORT}"

    <IfModule mod_headers.c>
      SetEnvIfExpr "%{REQUEST_URI} =~ m#^/static/assets/#" is_superset_static=1
      SetEnvIfExpr "%{REQUEST_URI} !~ m#^/static/assets/#" is_superset_html=1
      Header always set Cache-Control "no-store, no-cache, must-revalidate, max-age=0" env=is_superset_html
      Header always set Pragma "no-cache" env=is_superset_html
      Header always set Expires "0" env=is_superset_html
      Header always set Cache-Control "public, max-age=31536000, immutable" env=is_superset_static
    </IfModule>

    ErrorLog ${APACHE_LOG_DIR}/superset-error.log
    CustomLog ${APACHE_LOG_DIR}/superset-access.log combined
</VirtualHost>
EOF2

  a2dissite 000-default >/dev/null 2>&1 || true
  a2ensite superset >/dev/null
  apache2ctl -t
  systemctl enable --now apache2
  systemctl reload apache2
}

restart_gunicorn() {
  systemctl daemon-reload
  systemctl enable --now superset-gunicorn
  systemctl restart superset-gunicorn

  local tries=0
  until curl -sf "http://${BIND_ADDRESS}:${SUPERSET_WEBSERVER_PORT}/health" >/dev/null 2>&1; do
    tries=$((tries + 1))
    (( tries <= 30 )) || {
      journalctl -u superset-gunicorn -n 100 --no-pager >&2 || true
      die "Superset health check failed"
    }
    sleep 2
  done
}

restart_celery() {
  systemctl daemon-reload

  if [[ "$ENABLE_CELERY_WORKER" == "1" ]]; then
    systemctl enable --now superset-celery-worker
    systemctl restart superset-celery-worker
  else
    systemctl disable --now superset-celery-worker >/dev/null 2>&1 || true
  fi

  if [[ "$ENABLE_CELERY_BEAT" == "1" ]]; then
    systemctl enable --now superset-celery-beat
    systemctl restart superset-celery-beat
  else
    systemctl disable --now superset-celery-beat >/dev/null 2>&1 || true
  fi
}

show_summary() {
  cat <<EOF2

============================================================
Direct Superset deployment complete
------------------------------------------------------------
Repo                 : $REPO_URL
Ref                  : $GIT_REF
Runtime user         : $SUPERSET_USER:$SUPERSET_GROUP
Superset home        : $SUPERSET_HOME
Source               : $WORK_SRC
Virtualenv           : $VENV
Env file             : $ENV_FILE
Superset config      : $SUPERSET_CONFIG_FILE

Superset URL         : http://${DOMAIN}
Gunicorn bind        : ${BIND_ADDRESS}:${SUPERSET_WEBSERVER_PORT}
Gunicorn workers     : ${GUNICORN_WORKERS}
Gunicorn threads     : ${GUNICORN_THREADS}
Celery concurrency   : ${CELERY_CONCURRENCY}
Host CPU count       : ${HOST_CPU_COUNT}
Host memory (MB)     : ${HOST_MEM_MB}

PostgreSQL DB        : ${POSTGRES_DB}
PostgreSQL user      : ${POSTGRES_USER}
PostgreSQL password  : ${POSTGRES_PASSWORD}

ClickHouse enabled   : ${CLICKHOUSE_ENABLED}
ClickHouse user      : ${CLICKHOUSE_USER}
ClickHouse password  : ${CLICKHOUSE_PASSWORD}
ClickHouse DBs       : ${CLICKHOUSE_STAGING_DATABASE}, ${CLICKHOUSE_SERVING_DATABASE}, ${CLICKHOUSE_CONTROL_DATABASE}
ClickHouse env       : ${CLICKHOUSE_ENV_FILE}

Admin user           : ${ADMIN_USER}
Admin email          : ${ADMIN_EMAIL}
Admin password       : ${ADMIN_PASS}
============================================================
EOF2
}

deploy_or_update() {
  compute_defaults
  ensure_passwords
  ensure_users_and_dirs
  install_base_packages
  install_clickhouse_repo_and_packages
  ensure_postgres_running
  ensure_redis_running
  ensure_clickhouse_running
  write_clickhouse_env
  configure_postgres_metadata_db
  configure_clickhouse
  write_superset_env
  write_superset_config_if_missing
  clone_or_update_repo
  ensure_venv_and_backend
  build_frontend
  validate_python_env
  run_db_upgrade_and_init
  sync_local_staging_clickhouse_config
  run_dhis2_backfill_if_present
  write_gunicorn_service
  write_celery_services
  restart_gunicorn
  restart_celery
  configure_apache_proxy
  show_summary
}

main() {
  require_root
  local cmd
  cmd="$(parse_args "$@")"

  case "$cmd" in
    deploy|update)
      deploy_or_update
      ;;
    restart)
      compute_defaults
      write_gunicorn_service
      write_celery_services
      restart_gunicorn
      restart_celery
      ;;
    restart-gunicorn)
      compute_defaults
      write_gunicorn_service
      restart_gunicorn
      ;;
    restart-celery)
      compute_defaults
      write_celery_services
      restart_celery
      ;;
    backup)
      backup_metadata_db
      ;;
    *)
      usage
      die "Unknown command: $cmd"
      ;;
  esac
}

main "$@"

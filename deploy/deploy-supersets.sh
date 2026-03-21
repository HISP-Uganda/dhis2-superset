#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# deploy-supersets.sh
# Clean, deploy, update Apache Superset on a remote LXD host
# ==============================================================================
#
# Runtime model:
#   - Source code runtime comes from: /opt/superset/work/src
#   - Python dependencies come from:  /opt/superset/venv
#   - Gunicorn runs with nohup
#   - Celery worker/beat run with systemd
#   - Existing legacy/systemd Superset services are stopped/disabled/masked
#
# Preserved:
#   - /etc/superset/superset.env
#   - /opt/superset/config/superset_config.py   (unless forced config sync)
#   - /opt/superset/backups
# ==============================================================================
#
# Default staging engine: ClickHouse (installed and configured automatically)
#   - Installs clickhouse-server, creates a dedicated user, and bootstraps DBs
#   - Stores ClickHouse credentials in: /etc/clickhouse-server/clickhouse.env
#   - Auto-generates a strong random ClickHouse password on first deploy
#   - Syncs credentials into /etc/superset/superset.env automatically
#   - Prints final ClickHouse credentials after deploy/update
#   - Can be disabled with: --no-clickhouse
#
# DuckDB support (opt-in):
#   - Enable with: --duckdb  or  DUCKDB_ENABLED=1
# ==============================================================================

TARGET="${TARGET:-socaya@209.145.54.74}"
SSH_PORT="${SSH_PORT:-22}"

CT_SUP="${CT_SUP:-supersets}"
CT_PG="${CT_PG:-postgres}"
CT_PROXY="${CT_PROXY:-proxy}"
DOMAIN="${DOMAIN:-supersets.hispuganda.org}"

REPO_URL="${REPO_URL:-https://github.com/HISP-Uganda/dhis2-superset.git}"
GIT_REF="${GIT_REF:-main}"
GIT_DEPTH="${GIT_DEPTH:-0}"
GIT_SUBMODULES="${GIT_SUBMODULES:-0}"

UPSTREAM_REPO_URL="${UPSTREAM_REPO_URL:-https://github.com/HISP-Uganda/dhis2-superset.git}"
USE_UPSTREAM_MIGRATIONS="${USE_UPSTREAM_MIGRATIONS:-0}"

HOST_SRC_DIR="${HOST_SRC_DIR:-/opt/superset-src}"
CT_SRC_DIR="${CT_SRC_DIR:-/opt/superset/src}"
LEGACY_SRC_DEVICE_NAME="${LEGACY_SRC_DEVICE_NAME:-superset-src}"

SUPERSET_HOME="${SUPERSET_HOME:-/opt/superset}"
CONFIG_DIR="${CONFIG_DIR:-$SUPERSET_HOME/config}"
BACKUP_DIR="${BACKUP_DIR:-$SUPERSET_HOME/backups}"
LOG_DIR="${LOG_DIR:-$SUPERSET_HOME/logs}"
WORK_DIR="${WORK_DIR:-$SUPERSET_HOME/work}"
WORK_SRC="${WORK_SRC:-$WORK_DIR/src}"
VENV="${VENV:-$SUPERSET_HOME/venv}"

ENV_FILE="${ENV_FILE:-/etc/superset/superset.env}"
SUPERSET_CONFIG_FILE="${SUPERSET_CONFIG_FILE:-$CONFIG_DIR/superset_config.py}"

GUNICORN_CONF="${GUNICORN_CONF:-$CONFIG_DIR/gunicorn.conf.py}"
GUNICORN_LOG="${GUNICORN_LOG:-$LOG_DIR/gunicorn.log}"
GUNICORN_PID_FILE="${GUNICORN_PID_FILE:-$SUPERSET_HOME/gunicorn.pid}"

CELERY_LOG="${CELERY_LOG:-$LOG_DIR/celery.log}"
CELERY_PID_FILE="${CELERY_PID_FILE:-$SUPERSET_HOME/celery.pid}"

CELERY_BEAT_LOG="${CELERY_BEAT_LOG:-$LOG_DIR/celery-beat.log}"
CELERY_BEAT_PID_FILE="${CELERY_BEAT_PID_FILE:-$SUPERSET_HOME/celery-beat.pid}"

DEPLOY_LOG_IN_CT="${DEPLOY_LOG_IN_CT:-$LOG_DIR/deploy.log}"
FRONTEND_LOG_IN_CT="${FRONTEND_LOG_IN_CT:-$LOG_DIR/frontend-build.log}"

FRONTEND="${FRONTEND:-best}"   # best | skip
FRONTEND_CLEAN="${FRONTEND_CLEAN:-1}"
NPM_LEGACY_PEER_DEPS="${NPM_LEGACY_PEER_DEPS:-1}"
NODE_OPTIONS_VALUE="${NODE_OPTIONS_VALUE:---max_old_space_size=8192}"
FRONTEND_TIMEOUT_MINUTES="${FRONTEND_TIMEOUT_MINUTES:-90}"
FRONTEND_TYPECHECK="${FRONTEND_TYPECHECK:-1}"
FRONTEND_LOG_TAIL_LINES="${FRONTEND_LOG_TAIL_LINES:-200}"

DB_SYNC="${DB_SYNC:-1}"
PATCH_MIGRATIONS="${PATCH_MIGRATIONS:-1}"
APACHE_CACHE_FIX="${APACHE_CACHE_FIX:-1}"

ENABLE_CELERY_WORKER="${ENABLE_CELERY_WORKER:-1}"
ENABLE_CELERY_BEAT="${ENABLE_CELERY_BEAT:-1}"
CELERY_CONCURRENCY="${CELERY_CONCURRENCY:-4}"

DUCKDB_ENABLED="${DUCKDB_ENABLED:-0}"
DUCKDB_PYTHON_PACKAGE="${DUCKDB_PYTHON_PACKAGE:-duckdb}"
DUCKDB_SQLALCHEMY_PACKAGE="${DUCKDB_SQLALCHEMY_PACKAGE:-duckdb-engine}"

CLICKHOUSE_ENABLED="${CLICKHOUSE_ENABLED:-1}"
CLICKHOUSE_PYTHON_PACKAGE="${CLICKHOUSE_PYTHON_PACKAGE:-clickhouse-connect}"
CLICKHOUSE_HOST="${CLICKHOUSE_HOST:-127.0.0.1}"
CLICKHOUSE_HTTP_PORT="${CLICKHOUSE_HTTP_PORT:-8123}"
CLICKHOUSE_NATIVE_PORT="${CLICKHOUSE_NATIVE_PORT:-9000}"
CLICKHOUSE_STAGING_DATABASE="${CLICKHOUSE_STAGING_DATABASE:-dhis2_staging}"
CLICKHOUSE_SERVING_DATABASE="${CLICKHOUSE_SERVING_DATABASE:-dhis2_serving}"
CLICKHOUSE_CONTROL_DATABASE="${CLICKHOUSE_CONTROL_DATABASE:-dhis2_control}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-superset_clickhouse}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-__AUTO_GENERATE__}"
CLICKHOUSE_SUPERSET_DB_NAME="${CLICKHOUSE_SUPERSET_DB_NAME:-DHIS2_Serving_Clickhouse}"
CLICKHOUSE_ENV_FILE="${CLICKHOUSE_ENV_FILE:-/etc/clickhouse-server/clickhouse.env}"

WIPE_METADATA="${WIPE_METADATA:-0}"
CONFIRM_WIPE_METADATA="${CONFIRM_WIPE_METADATA:-0}"
DO_BACKUP="${DO_BACKUP:-0}"

CONFIG_SYNC="${CONFIG_SYNC:-0}"
FORCE_CONFIG_SYNC="${FORCE_CONFIG_SYNC:-0}"
CONFIG_CANDIDATE_PATH="${CONFIG_CANDIDATE_PATH:-}"

ALEMBIC_FIX_MODE="${ALEMBIC_FIX_MODE:-auto}"
ALEMBIC_AUTO_FALLBACK="${ALEMBIC_AUTO_FALLBACK:-none}"

ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASS="${ADMIN_PASS:-Admin@2026}"
ADMIN_FIRST="${ADMIN_FIRST:-Admin}"
ADMIN_LAST="${ADMIN_LAST:-User}"

HOST_LOG="${HOST_LOG:-/var/log/supersets-deploy-host.log}"
REMOTE_SCRIPT_PATH="${REMOTE_SCRIPT_PATH:-/tmp/deploy-supersets.sh}"
REMOTE_ENV_PATH="${REMOTE_ENV_PATH:-/tmp/deploy-supersets.env}"

usage() {
  cat <<'EOF'
USAGE:
  ./deploy-supersets.sh cleanup [options]
  ./deploy-supersets.sh reset [options]
  ./deploy-supersets.sh deploy [options]
  ./deploy-supersets.sh update [options]
  ./deploy-supersets.sh restart [options]
  ./deploy-supersets.sh restart-gunicorn [options]
  ./deploy-supersets.sh restart-celery [options]

OPTIONS:
  --target user@host
  --port 22
  --domain <domain>

  --repo <url>
  --ref <branch|tag|sha>
  --depth <N>
  --submodules

  --alembic-fix auto|stamp-head|wipe
  --alembic-fallback stamp-head|wipe|none
  --no-upstream-migrations

  --no-frontend
  --no-frontend-clean
  --frontend-timeout-minutes <N>

  --no-db-sync
  --no-migration-patch

  --wipe-metadata
  --confirm-wipe-metadata
  --backup

  --no-apache-cache-fix

  --config-sync
  --force-config-sync
  --no-config-sync
  --config-candidate <repo-relative-path>

  --no-celery-worker
  --celery-beat
  --celery-concurrency <N>

  --no-clickhouse
  --clickhouse-password <pw>
  --clickhouse-user <user>
  --clickhouse-host <host>
  --clickhouse-http-port <N>

  --duckdb
  --no-duckdb
EOF
}

log()  { printf '==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
has_cmd() { command -v "$1" >/dev/null 2>&1; }

ssh_tty() {
  ssh \
    -o BatchMode=no \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=6 \
    -tt \
    -p "$SSH_PORT" \
    "$TARGET" "$@"
}

scp_to_remote() { scp -P "$SSH_PORT" "$1" "${TARGET}:$2"; }
quote_env_value() { printf '%q' "$1"; }

write_remote_env_file() {
  local f="$1"
  : > "$f"
  chmod 600 "$f"

  local vars=(
    CT_SUP CT_PG CT_PROXY DOMAIN
    REPO_URL GIT_REF GIT_DEPTH GIT_SUBMODULES
    UPSTREAM_REPO_URL USE_UPSTREAM_MIGRATIONS
    HOST_SRC_DIR CT_SRC_DIR LEGACY_SRC_DEVICE_NAME
    SUPERSET_HOME CONFIG_DIR BACKUP_DIR LOG_DIR WORK_DIR WORK_SRC VENV
    ENV_FILE SUPERSET_CONFIG_FILE
    GUNICORN_CONF GUNICORN_LOG GUNICORN_PID_FILE
    CELERY_LOG CELERY_PID_FILE CELERY_BEAT_LOG CELERY_BEAT_PID_FILE
    DEPLOY_LOG_IN_CT FRONTEND_LOG_IN_CT
    FRONTEND FRONTEND_CLEAN NPM_LEGACY_PEER_DEPS NODE_OPTIONS_VALUE FRONTEND_TIMEOUT_MINUTES
    DB_SYNC PATCH_MIGRATIONS APACHE_CACHE_FIX
    ENABLE_CELERY_WORKER ENABLE_CELERY_BEAT CELERY_CONCURRENCY
    DUCKDB_ENABLED DUCKDB_PYTHON_PACKAGE DUCKDB_SQLALCHEMY_PACKAGE
    CLICKHOUSE_ENABLED CLICKHOUSE_PYTHON_PACKAGE
    CLICKHOUSE_HOST CLICKHOUSE_HTTP_PORT CLICKHOUSE_NATIVE_PORT
    CLICKHOUSE_STAGING_DATABASE CLICKHOUSE_SERVING_DATABASE CLICKHOUSE_CONTROL_DATABASE
    CLICKHOUSE_USER CLICKHOUSE_PASSWORD CLICKHOUSE_SUPERSET_DB_NAME CLICKHOUSE_ENV_FILE
    WIPE_METADATA CONFIRM_WIPE_METADATA DO_BACKUP
    CONFIG_SYNC FORCE_CONFIG_SYNC CONFIG_CANDIDATE_PATH
    ALEMBIC_FIX_MODE ALEMBIC_AUTO_FALLBACK
    ADMIN_USER ADMIN_EMAIL ADMIN_PASS ADMIN_FIRST ADMIN_LAST
    HOST_LOG
  )

  local v
  for v in "${vars[@]}"; do
    printf '%s=%s\n' "$v" "$(quote_env_value "${!v}")" >> "$f"
  done
}

is_local_lxd_host() {
  has_cmd lxc || return 1
  lxc info "$CT_SUP" >/dev/null 2>&1 || return 1
  lxc info "$CT_PG"  >/dev/null 2>&1 || return 1
  return 0
}

remote_worker() {
  local cmd="${1:-}"
  shift || true

  sudo mkdir -p "$(dirname "$HOST_LOG")" || true
  sudo touch "$HOST_LOG" || true
  sudo chown "$(id -un)":"$(id -gn)" "$HOST_LOG" 2>/dev/null || true
  exec > >(tee -a "$HOST_LOG") 2>&1

  local RUN_USER="${SUDO_USER:-$(id -un)}"

  run_as_user() {
    if [[ "$(id -u)" == "0" && -n "$RUN_USER" && "$RUN_USER" != "root" ]]; then
      sudo -u "$RUN_USER" -H bash -lc "$*"
    else
      bash -lc "$*"
    fi
  }

  safe_kill_matching_procs() {
    local pattern="$1"
    local me="$$"
    local ppid="$PPID"
    local pid cmdline

    for pid in $(pgrep -f "$pattern" 2>/dev/null || true); do
      [[ -n "$pid" ]] || continue
      [[ "$pid" = "$me" ]] && continue
      [[ "$pid" = "$ppid" ]] && continue
      [[ -r "/proc/$pid/cmdline" ]] || continue

      cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
      case "$cmdline" in
        *"bash -lc"*|*"pkill -f"*|*"pgrep -f"*)
          continue
          ;;
      esac

      kill "$pid" >/dev/null 2>&1 || true
    done
  }

  apt_quiesce_background_services() {
    echo "[apt] quiescing background package services"

    local have_timeout=0
    command -v timeout >/dev/null 2>&1 && have_timeout=1

    local pid1=""
    pid1="$(ps -p 1 -o comm= 2>/dev/null || true)"
    echo "[apt] pid1=${pid1:-unknown}"

    if command -v systemctl >/dev/null 2>&1 && [[ "${pid1:-}" == "systemd" ]]; then
      echo "[apt] systemd detected; stopping apt timers/services"
      if [[ "$have_timeout" -eq 1 ]]; then
        timeout 15s systemctl stop apt-daily.service apt-daily-upgrade.service unattended-upgrades.service >/dev/null 2>&1 || true
        timeout 15s systemctl stop apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1 || true
        timeout 15s systemctl reset-failed apt-daily.service apt-daily-upgrade.service unattended-upgrades.service >/dev/null 2>&1 || true
      else
        systemctl stop apt-daily.service apt-daily-upgrade.service unattended-upgrades.service >/dev/null 2>&1 || true
        systemctl stop apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1 || true
        systemctl reset-failed apt-daily.service apt-daily-upgrade.service unattended-upgrades.service >/dev/null 2>&1 || true
      fi
    else
      echo "[apt] skipping systemctl operations (systemd not active as PID 1)"
    fi

    echo "[apt] killing unattended-upgrade if present"
    safe_kill_matching_procs 'unattended-upgrade'
    safe_kill_matching_procs 'apt.systemd.daily'
    safe_kill_matching_procs 'apt-daily'

    echo "[apt] background package quiesce complete"
  }

  apt_repair_if_needed() {
    echo "[apt] repairing dpkg state if needed"
    dpkg --configure -a >/dev/null 2>&1 || true
    apt-get -f install -y >/dev/null 2>&1 || true
    echo "[apt] dpkg repair step complete"
  }

  safe_apt_run() {
    export DEBIAN_FRONTEND=noninteractive
    local rc=0
    local attempt

    for attempt in 1 2 3; do
      echo "[apt] attempt ${attempt}: apt-get $*"
      apt_quiesce_background_services
      apt_repair_if_needed

      echo "[apt] executing: /usr/bin/apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=5 $*"
      set +e
      /usr/bin/apt-get -o DPkg::Lock::Timeout=600 -o Acquire::Retries=5 "$@"
      rc=$?
      set -e

      if [[ "$rc" -eq 0 ]]; then
        echo "[apt] success: apt-get $*"
        return 0
      fi

      echo "[apt] failed rc=${rc}: apt-get $*" >&2
      sleep 10
    done

    return "$rc"
  }

  safe_apt_update() {
    safe_apt_run update -y
  }

  safe_apt_install() {
    safe_apt_run install -y "$@"
  }

  exec_in_ct() {
    local ct="$1"
    shift || true
    local payload
    payload=$'
set -Eeuo pipefail
trap '\''rc=$?; echo "[exec_in_ct:'"$ct"'] ERROR rc=${rc} line=${LINENO} cmd=${BASH_COMMAND}" >&2; exit ${rc}'\'' ERR
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
'"$(declare -f safe_kill_matching_procs apt_quiesce_background_services apt_repair_if_needed safe_apt_run safe_apt_update safe_apt_install)"$'
'"$*"
    lxc exec "$ct" -- env LANG=C LC_ALL=C bash -lc "$payload"
  }

  exec_in_ct_as_postgres() {
  local ct="$1"
  shift || true
  local inner="$*"
  local quoted_inner
  quoted_inner="$(printf '%q' "$inner")"

  lxc exec "$ct" -- env LANG=C LC_ALL=C bash -lc "
set -Eeuo pipefail
trap 'rc=\$?; echo \"[exec_in_ct_as_postgres:$ct] ERROR rc=\${rc} line=\${LINENO} cmd=\${BASH_COMMAND}\" >&2; exit \${rc}' ERR
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
su - postgres -s /bin/bash -c $quoted_inner
"
}

  ct_ip() {
    local ct="$1"
    lxc exec "$ct" -- bash -lc "hostname -I 2>/dev/null | awk '{print \$1}'" | tr -d '\r'
  }

  normalize_secret_env_snippet() {
    cat <<'EOS'
if [ -z "${SECRET_KEY:-}" ] && [ -n "${SUPERSET_SECRET_KEY:-}" ]; then
  export SECRET_KEY="${SUPERSET_SECRET_KEY}"
fi
EOS
  }

  ensure_env_exists() {
    exec_in_ct "$CT_SUP" "test -f '$ENV_FILE' || { echo 'ERROR: missing $ENV_FILE'; exit 2; }"
  }

  ensure_superset_config_exists() {
    exec_in_ct "$CT_SUP" "test -f '$SUPERSET_CONFIG_FILE' || { echo 'ERROR: missing $SUPERSET_CONFIG_FILE'; exit 3; }"
  }

  ensure_clickhouse_credentials_file() {
    [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
    log "[supersets] ensure ClickHouse credentials in $CLICKHOUSE_ENV_FILE"

    local out final_user final_password
    out="$(exec_in_ct "$CT_SUP" "
      set -euo pipefail

      ENV_FILE='$CLICKHOUSE_ENV_FILE'
      mkdir -p \"\$(dirname \"\$ENV_FILE\")\"
      touch \"\$ENV_FILE\"
      chmod 600 \"\$ENV_FILE\"

      _get_env_var() {
        local key=\"\$1\"
        grep -E \"^[[:space:]]*\${key}=\" \"\$ENV_FILE\" | tail -n1 | cut -d= -f2- || true
      }

      _shell_quote() {
        printf '%q' \"\$1\"
      }

      _upsert_env_var() {
        local key=\"\$1\"
        local raw_val=\"\$2\"
        local val tmp
        val=\$(_shell_quote \"\$raw_val\")
        tmp=\$(mktemp)

        if grep -qE \"^[[:space:]]*\${key}=\" \"\$ENV_FILE\"; then
          sed \"s|^[[:space:]]*\${key}=.*|\${key}=\${val}|\" \"\$ENV_FILE\" > \"\$tmp\"
          cat \"\$tmp\" > \"\$ENV_FILE\"
          rm -f \"\$tmp\"
          echo \"[clickhouse-env] updated \${key} in \$ENV_FILE\"
        else
          printf '%s=%s\n' \"\$key\" \"\$val\" >> \"\$ENV_FILE\"
          echo \"[clickhouse-env] added \${key} to \$ENV_FILE\"
        fi
      }

      _generate_password() {
        if command -v openssl >/dev/null 2>&1; then
          openssl rand -base64 48 | tr -d '\n' | sed 's#[/=+]#A#g' | cut -c1-32
          return 0
        fi
        if command -v python3 >/dev/null 2>&1; then
          python3 - <<'PY'
import secrets
alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%._-'
print(''.join(secrets.choice(alphabet) for _ in range(32)))
PY
          return 0
        fi
        date +%s | sha256sum | awk '{print substr(\$1,1,32)}'
      }

      requested_user='${CLICKHOUSE_USER}'
      requested_password='${CLICKHOUSE_PASSWORD}'

      current_user=\$(_get_env_var CLICKHOUSE_USER)
      current_password=\$(_get_env_var CLICKHOUSE_PASSWORD)

      if [ -n \"\$requested_user\" ] && [ \"\$requested_user\" != '__AUTO_GENERATE__' ]; then
        final_user=\"\$requested_user\"
      elif [ -n \"\$current_user\" ]; then
        final_user=\"\$current_user\"
      else
        final_user='superset_clickhouse'
      fi

      if [ -n \"\$requested_password\" ] && [ \"\$requested_password\" != '__AUTO_GENERATE__' ] && [ \"\$requested_password\" != 'change_me_securely' ]; then
        final_password=\"\$requested_password\"
      elif [ -n \"\$current_password\" ]; then
        final_password=\"\$current_password\"
      else
        final_password=\$(_generate_password)
      fi

      _upsert_env_var CLICKHOUSE_USER \"\$final_user\"
      _upsert_env_var CLICKHOUSE_PASSWORD \"\$final_password\"
      _upsert_env_var CLICKHOUSE_HOST '${CLICKHOUSE_HOST}'
      _upsert_env_var CLICKHOUSE_PORT '${CLICKHOUSE_NATIVE_PORT}'
      _upsert_env_var CLICKHOUSE_HTTP_PORT '${CLICKHOUSE_HTTP_PORT}'
      _upsert_env_var CLICKHOUSE_DATABASE '${CLICKHOUSE_STAGING_DATABASE}'
      _upsert_env_var CLICKHOUSE_SERVING_DATABASE '${CLICKHOUSE_SERVING_DATABASE}'
      _upsert_env_var CLICKHOUSE_CONTROL_DATABASE '${CLICKHOUSE_CONTROL_DATABASE}'

      echo \"FINAL_CLICKHOUSE_USER=\$final_user\"
      echo \"FINAL_CLICKHOUSE_PASSWORD=\$final_password\"
    ")"

    final_user="$(printf '%s\n' "$out" | sed -n 's/^FINAL_CLICKHOUSE_USER=//p' | tail -n1)"
    final_password="$(printf '%s\n' "$out" | sed -n 's/^FINAL_CLICKHOUSE_PASSWORD=//p' | tail -n1)"

    [[ -n "$final_user" ]] || die "Failed to determine final ClickHouse user"
    [[ -n "$final_password" ]] || die "Failed to determine final ClickHouse password"

    CLICKHOUSE_USER="$final_user"
    CLICKHOUSE_PASSWORD="$final_password"
  }

  show_clickhouse_credentials() {
    [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
    echo
    echo "============================================================"
    echo "ClickHouse credentials"
    echo "  Env file : $CLICKHOUSE_ENV_FILE"
    echo "  User     : $CLICKHOUSE_USER"
    echo "  Password : $CLICKHOUSE_PASSWORD"
    echo "============================================================"
    echo
  }

  ensure_duckdb_env_vars() {
    [[ "${DUCKDB_ENABLED:-0}" == "1" ]] || return 0
    log "[supersets] ensure DuckDB env vars in $ENV_FILE"

    exec_in_ct "$CT_SUP" "
      set -euo pipefail

      ENV_FILE='$ENV_FILE'
      DUCKDB_DATA_DIR=\${DHIS2_DUCKDB_DIR:-/var/lib/superset}
      DUCKDB_DB_PATH=\${DHIS2_DUCKDB_PATH:-\$DUCKDB_DATA_DIR/dhis2_staging.duckdb}

      if [ ! -d \"\$DUCKDB_DATA_DIR\" ]; then
        mkdir -p \"\$DUCKDB_DATA_DIR\"
        chown www-data:www-data \"\$DUCKDB_DATA_DIR\" 2>/dev/null || true
        chmod 750 \"\$DUCKDB_DATA_DIR\" 2>/dev/null || true
        echo \"[duckdb] created data directory \$DUCKDB_DATA_DIR\"
      fi

      _add_env_var() {
        local key=\"\$1\"
        local val=\"\$2\"
        if ! grep -qE \"^[[:space:]]*\${key}[[:space:]]*=\" \"\$ENV_FILE\"; then
          echo \"\${key}=\${val}\" >> \"\$ENV_FILE\"
          echo \"[duckdb] added \${key}=\${val} to \$ENV_FILE\"
        fi
      }

      _add_env_var DHIS2_DUCKDB_PATH \"\$DUCKDB_DB_PATH\"
      _add_env_var DHIS2_DUCKDB_READ_ONLY_RETRY_COUNT 3
      _add_env_var DHIS2_DUCKDB_READ_ONLY_RETRY_DELAY_MS 300
      _add_env_var DHIS2_DUCKDB_SINGLE_WRITER_ENABLED true
      _add_env_var DHIS2_DUCKDB_ENABLE_TEMP_SWAP_LOADS true
      _add_env_var DHIS2_DUCKDB_VISIBLE_DATASET_MODE canonical_only

      echo '[duckdb] env vars OK'
    "
  }

  ensure_clickhouse_env_vars() {
    [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
    log "[supersets] ensure ClickHouse env vars in $ENV_FILE"

    exec_in_ct "$CT_SUP" "
      set -euo pipefail

      ENV_FILE='$ENV_FILE'

      _shell_quote() {
        printf '%q' \"\$1\"
      }

      _add_or_update_env_var() {
        local key=\"\$1\"
        local raw_val=\"\$2\"
        local val tmp
        val=\$(_shell_quote \"\$raw_val\")
        tmp=\$(mktemp)

        if grep -qE \"^[[:space:]]*\${key}[[:space:]]*=\" \"\$ENV_FILE\"; then
          sed \"s|^[[:space:]]*\${key}[[:space:]]*=.*|\${key}=\${val}|\" \"\$ENV_FILE\" > \"\$tmp\"
          cat \"\$tmp\" > \"\$ENV_FILE\"
          rm -f \"\$tmp\"
          echo \"[clickhouse] updated \${key} in \$ENV_FILE\"
        else
          printf '%s=%s\n' \"\$key\" \"\$val\" >> \"\$ENV_FILE\"
          echo \"[clickhouse] added \${key} to \$ENV_FILE\"
        fi
      }

      _add_or_update_env_var DHIS2_SERVING_ENGINE clickhouse
      _add_or_update_env_var DHIS2_CLICKHOUSE_ENABLED true
      _add_or_update_env_var DHIS2_CLICKHOUSE_HOST '${CLICKHOUSE_HOST}'
      _add_or_update_env_var DHIS2_CLICKHOUSE_PORT '${CLICKHOUSE_NATIVE_PORT}'
      _add_or_update_env_var DHIS2_CLICKHOUSE_HTTP_PORT '${CLICKHOUSE_HTTP_PORT}'
      _add_or_update_env_var DHIS2_CLICKHOUSE_DATABASE '${CLICKHOUSE_STAGING_DATABASE}'
      _add_or_update_env_var DHIS2_CLICKHOUSE_SERVING_DATABASE '${CLICKHOUSE_SERVING_DATABASE}'
      _add_or_update_env_var DHIS2_CLICKHOUSE_CONTROL_DATABASE '${CLICKHOUSE_CONTROL_DATABASE}'
      _add_or_update_env_var DHIS2_CLICKHOUSE_USER '${CLICKHOUSE_USER}'
      _add_or_update_env_var DHIS2_CLICKHOUSE_PASSWORD '${CLICKHOUSE_PASSWORD}'
      _add_or_update_env_var DHIS2_CLICKHOUSE_SECURE false
      _add_or_update_env_var DHIS2_CLICKHOUSE_HTTP_PROTOCOL http
      _add_or_update_env_var DHIS2_CLICKHOUSE_SUPERSET_DB_NAME '${CLICKHOUSE_SUPERSET_DB_NAME}'
      _add_or_update_env_var DHIS2_CLICKHOUSE_REFRESH_STRATEGY versioned_view_swap
      _add_or_update_env_var DHIS2_CLICKHOUSE_KEEP_OLD_VERSIONS 2

      echo '[clickhouse] env vars OK'
    "
  }

  install_clickhouse() {
    [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
    log "[supersets] install ClickHouse if missing"

    exec_in_ct "$CT_SUP" "
      if command -v clickhouse-server >/dev/null 2>&1; then
        echo '[clickhouse] already installed, skipping'
        clickhouse-server --version 2>/dev/null | head -1 || true
        exit 0
      fi

      echo '[clickhouse] apt update'
      safe_apt_update

      echo '[clickhouse] install prereqs'
      safe_apt_install apt-transport-https ca-certificates curl gnupg

      echo '[clickhouse] add repo key'
      rm -f /usr/share/keyrings/clickhouse-keyring.gpg
      curl -fsSL 'https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key' \
        | gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg

      echo '[clickhouse] add repo'
      ARCH=\$(dpkg --print-architecture)
      echo \"deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg arch=\${ARCH}] https://packages.clickhouse.com/deb stable main\" \
        > /etc/apt/sources.list.d/clickhouse.list

      echo '[clickhouse] apt update after repo'
      safe_apt_update

      echo '[clickhouse] install server and client'
      safe_apt_install clickhouse-server clickhouse-client

      echo '[clickhouse] installation complete'
      clickhouse-server --version 2>/dev/null | head -1 || true
    "
  }

  start_clickhouse() {
    [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
    log "[supersets] start and enable ClickHouse"

    exec_in_ct "$CT_SUP" "
      set -euo pipefail

      if ! command -v clickhouse-server >/dev/null 2>&1; then
        echo 'ERROR: clickhouse-server not found; run install_clickhouse first'
        exit 60
      fi

      if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files clickhouse-server.service >/dev/null 2>&1; then
        systemctl enable clickhouse-server >/dev/null 2>&1 || true
        systemctl restart clickhouse-server >/dev/null 2>&1 || true
      elif command -v service >/dev/null 2>&1; then
        service clickhouse-server restart || true
      else
        clickhouse-server --daemon --config-file=/etc/clickhouse-server/config.xml || true
      fi

      tries=0
      while ! curl -sf 'http://localhost:${CLICKHOUSE_HTTP_PORT}/ping' >/dev/null 2>&1; do
        tries=\$((tries + 1))
        [ \"\$tries\" -lt 30 ] || { echo 'ERROR: ClickHouse did not start in 30s'; exit 61; }
        sleep 1
      done
      echo '[clickhouse] server ready'
    "
  }

  setup_clickhouse_dbs() {
    [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
    log "[supersets] bootstrap ClickHouse databases and user"

    exec_in_ct "$CT_SUP" "
      set -euo pipefail

      CH_PASS='${CLICKHOUSE_PASSWORD}'
      CH_USER='${CLICKHOUSE_USER}'
      CH_STAGING='${CLICKHOUSE_STAGING_DATABASE}'
      CH_SERVING='${CLICKHOUSE_SERVING_DATABASE}'
      CH_CONTROL='${CLICKHOUSE_CONTROL_DATABASE}'
      HTTP_PORT='${CLICKHOUSE_HTTP_PORT}'

      _ch() {
        clickhouse-client --multiquery --query=\"\$1\" 2>/dev/null || \
        curl -sf \"http://localhost:\${HTTP_PORT}/\" --data-binary \"\$1\" || true
      }

      echo '[clickhouse] creating databases'
      _ch \"CREATE DATABASE IF NOT EXISTS \\\`\${CH_STAGING}\\\`\"
      _ch \"CREATE DATABASE IF NOT EXISTS \\\`\${CH_SERVING}\\\`\"
      _ch \"CREATE DATABASE IF NOT EXISTS \\\`\${CH_CONTROL}\\\`\"

      echo \"[clickhouse] creating user \${CH_USER}\"
      _ch \"CREATE USER IF NOT EXISTS \${CH_USER} IDENTIFIED BY '\${CH_PASS}'\"

      echo '[clickhouse] granting privileges'
      _ch \"GRANT ALL ON \\\`\${CH_STAGING}\\\`.* TO \${CH_USER}\"
      _ch \"GRANT ALL ON \\\`\${CH_SERVING}\\\`.* TO \${CH_USER}\"
      _ch \"GRANT ALL ON \\\`\${CH_CONTROL}\\\`.* TO \${CH_USER}\"
      _ch \"GRANT SELECT ON system.tables TO \${CH_USER}\"
      _ch \"GRANT SELECT ON system.columns TO \${CH_USER}\"
      _ch \"GRANT SELECT ON system.parts TO \${CH_USER}\"

      echo '[clickhouse] bootstrap complete'
    "
  }

  install_clickhouse_python_package() {
    [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
    log "[supersets] install clickhouse-connect Python package"

    exec_in_ct "$CT_SUP" "
      set -euo pipefail
      echo '[clickhouse] installing ${CLICKHOUSE_PYTHON_PACKAGE}'
      '$VENV/bin/pip' install -U '${CLICKHOUSE_PYTHON_PACKAGE}'

      '$VENV/bin/python' - <<PY
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
    "
  }

  sync_superset_clickhouse_config_in_ct() {
    [[ "${CLICKHOUSE_ENABLED:-1}" == "1" ]] || return 0
    log "[supersets] sync ClickHouse credentials into Superset local_staging_settings"

    exec_in_ct "$CT_SUP" "
      set -a; . '$ENV_FILE'; set +a
      PYTHONPATH='$WORK_SRC' '$VENV/bin/python' - <<PY
import sys, os
os.environ.setdefault('FLASK_APP', 'superset')
sys.path.insert(0, '$WORK_SRC')
try:
    from superset import create_app
    app = create_app()
    with app.app_context():
        from superset import db
        from superset.local_staging.platform_settings import LocalStagingSettings
        s = LocalStagingSettings.get()
        cfg = s.get_clickhouse_config()
        cfg.update({
            'host':             os.environ.get('DHIS2_CLICKHOUSE_HOST', '${CLICKHOUSE_HOST}'),
            'http_port':        int(os.environ.get('DHIS2_CLICKHOUSE_HTTP_PORT', '${CLICKHOUSE_HTTP_PORT}')),
            'port':             int(os.environ.get('DHIS2_CLICKHOUSE_PORT', '${CLICKHOUSE_NATIVE_PORT}')),
            'database':         os.environ.get('DHIS2_CLICKHOUSE_DATABASE', '${CLICKHOUSE_STAGING_DATABASE}'),
            'serving_database': os.environ.get('DHIS2_CLICKHOUSE_SERVING_DATABASE', '${CLICKHOUSE_SERVING_DATABASE}'),
            'user':             os.environ.get('DHIS2_CLICKHOUSE_USER', '${CLICKHOUSE_USER}'),
            'password':         os.environ.get('DHIS2_CLICKHOUSE_PASSWORD', '${CLICKHOUSE_PASSWORD}'),
            'secure':           os.environ.get('DHIS2_CLICKHOUSE_SECURE', 'false').lower() == 'true',
            'verify':           True,
            'connect_timeout':  10,
            'send_receive_timeout': 300,
        })
        s.set_clickhouse_config(cfg)
        if s.active_engine != 'clickhouse':
            s.active_engine = 'clickhouse'
        db.session.commit()
        print('CONFIG_SYNC_OK host=${CLICKHOUSE_HOST}:${CLICKHOUSE_HTTP_PORT} user=${CLICKHOUSE_USER}')
except Exception as e:
    print(f'CONFIG_SYNC_WARN: {e}', file=sys.stderr)
    sys.exit(0)
PY
    "
  }

  disable_systemd_superset_services() {
    log "[supersets] stop/disable/mask legacy systemd superset services"
    exec_in_ct "$CT_SUP" "
      for svc in superset.service superset-worker.service superset-beat.service; do
        systemctl stop \$svc >/dev/null 2>&1 || true
        systemctl disable \$svc >/dev/null 2>&1 || true
        systemctl mask \$svc >/dev/null 2>&1 || true
      done
      systemctl daemon-reload >/dev/null 2>&1 || true
    " || true
  }

  stop_pidfile_proc_in_ct() {
    local ct="$1"
    local pidfile="$2"
    local label="$3"

    exec_in_ct "$ct" "
      set +e
      if [ -f '$pidfile' ]; then
        pid=\$(cat '$pidfile' 2>/dev/null || true)
        if [ -n \"\$pid\" ] && kill -0 \"\$pid\" 2>/dev/null; then
          echo 'stopping $label via pidfile: '\$pid
          kill \"\$pid\" 2>/dev/null || true
          for _ in 1 2 3 4 5; do
            kill -0 \"\$pid\" 2>/dev/null || break
            sleep 1
          done
          kill -9 \"\$pid\" 2>/dev/null || true
        fi
        rm -f '$pidfile'
      fi
      true
    " || true
  }

  stop_matching_procs_in_ct() {
    local ct="$1"
    local regex="$2"
    local label="$3"
    local qregex
    qregex="$(printf '%q' "$regex")"

    exec_in_ct "$ct" "
      set +e
      me=\$\$
      ppid=\$PPID
      found=0

      for pid in \$(pgrep -f $qregex 2>/dev/null || true); do
        [ -n \"\$pid\" ] || continue
        [ \"\$pid\" = \"\$me\" ] && continue
        [ \"\$pid\" = \"\$ppid\" ] && continue
        cmdline=\$(tr '\0' ' ' < /proc/\$pid/cmdline 2>/dev/null || true)
        case \"\$cmdline\" in
          *'bash -c '*|*'pgrep -f '*)
            ;;
        esac
        echo 'stopping $label pid='\$pid
        kill \"\$pid\" 2>/dev/null || true
        found=1
      done

      if [ \"\$found\" = '1' ]; then
        sleep 2
        for pid in \$(pgrep -f $qregex 2>/dev/null || true); do
          [ -n \"\$pid\" ] || continue
          [ \"\$pid\" = \"\$me\" ] && continue
          [ \"\$pid\" = \"\$ppid\" ] && continue
          kill -9 \"\$pid\" 2>/dev/null || true
        done
      fi
      true
    " || true
  }

  stop_gunicorn() {
    stop_pidfile_proc_in_ct "$CT_SUP" "$GUNICORN_PID_FILE" "gunicorn"
    stop_matching_procs_in_ct "$CT_SUP" 'gunicorn.*superset.app:create_app' "gunicorn"
    stop_matching_procs_in_ct "$CT_SUP" 'gunicorn.*superset' "gunicorn"
  }

  stop_celery_runtime() {
    exec_in_ct "$CT_SUP" "
      set +e
      systemctl stop superset-celery-worker superset-celery-beat >/dev/null 2>&1 || true
      systemctl disable superset-celery-worker superset-celery-beat >/dev/null 2>&1 || true
      true
    " || true

    stop_pidfile_proc_in_ct "$CT_SUP" "$CELERY_PID_FILE" "celery-worker"
    stop_pidfile_proc_in_ct "$CT_SUP" "$CELERY_BEAT_PID_FILE" "celery-beat"
    stop_matching_procs_in_ct "$CT_SUP" 'celery.*superset.tasks.celery_app.*worker' "celery-worker"
    stop_matching_procs_in_ct "$CT_SUP" 'celery.*superset.tasks.celery_app.*beat' "celery-beat"
    stop_matching_procs_in_ct "$CT_SUP" 'celery.*superset.tasks.celery_app' "celery"
  }

  ensure_host_tools() {
    if ! has_cmd git; then
      sudo bash -lc "$(declare -f safe_kill_matching_procs apt_quiesce_background_services apt_repair_if_needed safe_apt_run safe_apt_update safe_apt_install); safe_apt_update; safe_apt_install git ca-certificates"
    fi
  }

  ensure_host_src_dir() {
    sudo mkdir -p "$HOST_SRC_DIR"
    sudo chown -R "$RUN_USER":"$RUN_USER" "$HOST_SRC_DIR" 2>/dev/null || true
  }

  detach_legacy_src_mount_if_present() {
    log "[host] detach legacy LXD source mount/device if present"

    if sudo lxc config device show "$CT_SUP" | grep -q "^${LEGACY_SRC_DEVICE_NAME}:"; then
      log "[host] removing LXD device: $LEGACY_SRC_DEVICE_NAME"
      sudo lxc config device remove "$CT_SUP" "$LEGACY_SRC_DEVICE_NAME" || true
    fi

    exec_in_ct "$CT_SUP" "
      if mountpoint -q '$CT_SRC_DIR'; then
        umount -lf '$CT_SRC_DIR' || true
      fi
      rm -rf '$CT_SRC_DIR' 2>/dev/null || true
      rmdir '$CT_SRC_DIR' 2>/dev/null || true
      echo LEGACY_SRC_DETACHED
    " || true
  }

  cleanup_host_src_dir() {
    log "[host] cleanup host source checkout: $HOST_SRC_DIR"

    case "$HOST_SRC_DIR" in
      /opt/superset-src) ;;
      *) die "Refusing to remove unexpected HOST_SRC_DIR: $HOST_SRC_DIR" ;;
    esac

    if sudo lxc config device show "$CT_SUP" | grep -q "^${LEGACY_SRC_DEVICE_NAME}:"; then
      die "Refusing to remove $HOST_SRC_DIR because LXD device '$LEGACY_SRC_DEVICE_NAME' is still attached"
    fi

    sudo rm -rf "$HOST_SRC_DIR"
    echo HOST_SRC_REMOVED
  }

  git_clone_or_update() {
    ensure_host_tools
    ensure_host_src_dir

    if [[ ! -d "$HOST_SRC_DIR/.git" ]]; then
      log "[host] cloning $REPO_URL -> $HOST_SRC_DIR"
      sudo rm -rf "$HOST_SRC_DIR"
      sudo mkdir -p "$HOST_SRC_DIR"
      sudo chown -R "$RUN_USER":"$RUN_USER" "$HOST_SRC_DIR" 2>/dev/null || true

      if [[ "$GIT_DEPTH" != "0" ]]; then
        run_as_user "git clone --depth '$GIT_DEPTH' '$REPO_URL' '$HOST_SRC_DIR'"
      else
        run_as_user "git clone '$REPO_URL' '$HOST_SRC_DIR'"
      fi
    fi

    run_as_user "cd '$HOST_SRC_DIR' && git remote set-url origin '$REPO_URL' && git fetch origin --tags --prune"

    local ref="$GIT_REF"
    if [[ -z "$ref" ]]; then
      ref="$(run_as_user "cd '$HOST_SRC_DIR' && git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##'")"
      [[ -n "$ref" ]] || ref="main"
    fi

    if run_as_user "cd '$HOST_SRC_DIR' && git show-ref --verify --quiet refs/remotes/origin/$ref"; then
      log "[host] checkout origin/$ref"
      run_as_user "cd '$HOST_SRC_DIR' && git checkout -B '$ref' 'origin/$ref' && git reset --hard 'origin/$ref'"
    elif run_as_user "cd '$HOST_SRC_DIR' && git show-ref --verify --quiet refs/heads/$ref"; then
      log "[host] checkout local $ref"
      run_as_user "cd '$HOST_SRC_DIR' && git checkout --force '$ref' && git reset --hard '$ref'"
    elif run_as_user "cd '$HOST_SRC_DIR' && git rev-parse --verify --quiet '$ref^{commit}' >/dev/null"; then
      log "[host] checkout commit/tag $ref"
      run_as_user "cd '$HOST_SRC_DIR' && git checkout --force '$ref'"
    else
      run_as_user "cd '$HOST_SRC_DIR' && git for-each-ref --format='%(refname:short)' refs/remotes/origin/" >&2 || true
      die "Requested ref '$ref' does not exist in $REPO_URL"
    fi

    if [[ "$GIT_SUBMODULES" == "1" ]]; then
      run_as_user "cd '$HOST_SRC_DIR' && git submodule sync --recursive && git submodule update --init --recursive"
    fi

    log "[host] revision: $(run_as_user "cd '$HOST_SRC_DIR' && git rev-parse --short HEAD")"
  }

  verify_host_repo_checkout() {
    [[ -d "$HOST_SRC_DIR/.git" ]] || die "Missing .git in $HOST_SRC_DIR"
    [[ -f "$HOST_SRC_DIR/setup.py" || -f "$HOST_SRC_DIR/pyproject.toml" || -d "$HOST_SRC_DIR/superset-frontend" ]] \
      || die "Host checkout at $HOST_SRC_DIR does not look like Superset"
  }

  install_supersets_base_tools() {
    log "[supersets] ensure OS packages"
    exec_in_ct "$CT_SUP" "
      echo '[supersets] container preflight'
      command -v apt-get
      uname -a || true
      cat /etc/os-release || true

      echo '[supersets] running apt update'
      safe_apt_update

      echo '[supersets] running apt install for base packages'
      safe_apt_install \
        python3 python3-venv python3-dev build-essential \
        libffi-dev libssl-dev libsasl2-dev libldap2-dev libpq-dev \
        libjpeg-dev zlib1g-dev pkg-config ca-certificates curl \
        netcat-openbsd procps rsync git tar util-linux coreutils psmisc

      echo '[supersets] base packages installed successfully'
    "
  }

  ensure_redis_present() {
    log "[supersets] ensure redis-server present"
    exec_in_ct "$CT_SUP" "
      echo '[redis] apt update'
      safe_apt_update

      echo '[redis] apt install redis-server'
      safe_apt_install redis-server

      if command -v systemctl >/dev/null 2>&1; then
        systemctl enable --now redis-server >/dev/null 2>&1 || true
      else
        pgrep -x redis-server >/dev/null 2>&1 || redis-server --daemonize yes || true
      fi

      echo '[redis] redis step complete'
    " || true
  }

  validate_existing_config() {
    log "[supersets] validate current live config"

    exec_in_ct "$CT_SUP" "
      set -a; . '$ENV_FILE'; set +a
      $(normalize_secret_env_snippet)

      cfg=\${SUPERSET_CONFIG_PATH:-}
      [ -n \"\$cfg\" ] || { echo 'ERROR: SUPERSET_CONFIG_PATH missing in superset.env'; exit 4; }
      [ \"\$cfg\" = '$SUPERSET_CONFIG_FILE' ] || { echo 'ERROR: SUPERSET_CONFIG_PATH must be $SUPERSET_CONFIG_FILE'; exit 5; }
      [ -f \"\$cfg\" ] || { echo 'ERROR: config file not found: '\$cfg; exit 6; }
      python3 -m py_compile \"\$cfg\"

      [ -n \"\${SUPERSET_DB_URI:-}\" ] || { echo 'ERROR: SUPERSET_DB_URI missing in superset.env'; exit 7; }
      [ -n \"\${SECRET_KEY:-}\" ] || { echo 'ERROR: SECRET_KEY / SUPERSET_SECRET_KEY missing in superset.env'; exit 9; }

      case \"\$SUPERSET_DB_URI\" in
        sqlite:*|*superset.db*)
          echo 'ERROR: SQLite/superset.db is not allowed for deployed metadata'
          exit 8
          ;;
      esac

      echo \"CONFIG_OK \$cfg\"
    "
  }

  parse_db_uri_json() {
    exec_in_ct "$CT_SUP" "
      set -a; . '$ENV_FILE'; set +a
      python3 - <<'PY'
import json, os
from urllib.parse import urlparse, unquote

dsn = os.environ.get('SUPERSET_DB_URI', '')
if not dsn:
    raise SystemExit('SUPERSET_DB_URI missing in superset.env')

u = urlparse(dsn)
print(json.dumps({
    'dsn': dsn,
    'user': unquote(u.username or ''),
    'password': unquote(u.password or ''),
    'host': u.hostname or '',
    'port': u.port or 5432,
    'db': (u.path or '').lstrip('/'),
}))
PY
    "
  }

  db_json_field() {
    local key="$1"
    local json="$2"
    JSON_INPUT="$json" python3 - "$key" <<'PY'
import json, os, sys
obj = json.loads(os.environ['JSON_INPUT'])
print(obj.get(sys.argv[1], ''))
PY
  }

  db_sync_from_env() {
    [[ "$DB_SYNC" == "1" ]] || return 0

    local dbjson user pw db
    dbjson="$(parse_db_uri_json)"
    user="$(db_json_field user "$dbjson")"
    pw="$(db_json_field password "$dbjson")"
    db="$(db_json_field db "$dbjson")"

    [[ -n "$user" ]] || die "SUPERSET_DB_URI user is empty"
    [[ -n "$db" ]] || die "SUPERSET_DB_URI database is empty"

    log "[db-sync] ensuring role/database exist"
    exec_in_ct "$CT_PG" "
      safe_apt_update >/dev/null 2>&1 || true
      safe_apt_install postgresql-client >/dev/null 2>&1 || true
    " || true

    exec_in_ct_as_postgres "$CT_PG" "psql -v ON_ERROR_STOP=1 -v usr=$(printf '%q' "$user") -v pwd=$(printf '%q' "$pw") -v db=$(printf '%q' "$db") <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'usr', :'pwd')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'usr')
\gexec

SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'usr', :'pwd')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'usr')
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'usr')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db')
\gexec

SELECT format('ALTER DATABASE %I OWNER TO %I', :'db', :'usr')
\gexec

SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'db', :'usr')
\gexec
SQL"
  }

  cleanup_container_opt_layout() {
    log "[supersets] cleanup container /opt layout and preserve only required folders"

    stop_gunicorn
    stop_celery_runtime

    exec_in_ct "$CT_SUP" "
      echo 'cleanup: checking required files'
      test -f '$ENV_FILE' || { echo 'ERROR: missing $ENV_FILE'; exit 2; }
      test -f '$SUPERSET_CONFIG_FILE' || { echo 'ERROR: missing $SUPERSET_CONFIG_FILE'; exit 3; }

      echo 'cleanup: making base dirs'
      mkdir -p '$SUPERSET_HOME' '$CONFIG_DIR' '$BACKUP_DIR'

      echo 'cleanup: pre-clearing work/src'
      if [ -d '$WORK_SRC' ]; then
        find '$WORK_SRC' -depth -delete 2>/dev/null || rm -rf '$WORK_SRC' 2>/dev/null || true
      fi

      echo 'cleanup: removing non-superset items from /opt'
      find /opt -mindepth 1 -maxdepth 1 ! -name 'superset' -exec rm -rf {} + 2>/dev/null || true

      echo 'cleanup: removing runtime dirs from $SUPERSET_HOME'
      find '$SUPERSET_HOME' -mindepth 1 -maxdepth 1 \
        ! -name 'config' ! -name 'backups' ! -name 'src' \
        -exec rm -rf {} + 2>/dev/null \
        || { echo 'WARN: some items in $SUPERSET_HOME could not be removed'; true; }

      echo 'cleanup: unmounting legacy src mount if present'
      if mountpoint -q '$CT_SRC_DIR' 2>/dev/null; then
        umount -lf '$CT_SRC_DIR' || true
      fi
      rm -rf '$CT_SRC_DIR' 2>/dev/null || true
      rmdir '$CT_SRC_DIR' 2>/dev/null || true

      echo 'cleanup: creating fresh layout dirs'
      mkdir -p '$CONFIG_DIR' '$BACKUP_DIR' '$LOG_DIR' '$WORK_DIR' '$WORK_SRC'
      echo 'cleanup: done'
    "
  }

  sync_to_workdir() {
    log "[supersets] sync host repo -> container workdir"
    verify_host_repo_checkout

    exec_in_ct "$CT_SUP" "
      if [ -d '$WORK_SRC' ]; then
        find '$WORK_SRC' -depth -delete 2>/dev/null || rm -rf '$WORK_SRC' || true
      fi
      mkdir -p '$WORK_SRC'
    "

    sudo tar -C "$HOST_SRC_DIR" \
      --exclude=.git \
      --exclude=node_modules \
      --exclude=superset-frontend/node_modules \
      --exclude=superset-frontend/.cache \
      --exclude=superset-frontend/.temp_cache \
      -cf - . \
    | lxc exec "$CT_SUP" -- env LANG=C LC_ALL=C bash -lc "
        set -e
        mkdir -p '$WORK_SRC'
        tar -C '$WORK_SRC' -xf -
        chown -R root:root '$WORK_SRC' || true
        echo WORKDIR_SYNC_OK
      "
  }

  resolve_work_repo_root() {
    exec_in_ct "$CT_SUP" "
      python3 - <<'PY'
import os

base = '$WORK_SRC'
candidates = [base]

if os.path.isdir(base):
    for name in sorted(os.listdir(base)):
        p = os.path.join(base, name)
        if os.path.isdir(p):
            candidates.append(p)
            candidates.append(os.path.join(p, 'superset'))

def is_repo_root(path):
    return (
        os.path.isfile(os.path.join(path, 'setup.py')) or
        os.path.isfile(os.path.join(path, 'pyproject.toml')) or
        os.path.isdir(os.path.join(path, 'superset-frontend'))
    )

seen = set()
for c in candidates:
    if c in seen:
        continue
    seen.add(c)
    if is_repo_root(c):
        print(c)
        raise SystemExit(0)

print('')
PY
    "
  }

  repo_config_candidate() {
    local repo_root
    repo_root="$(resolve_work_repo_root)"
    [[ -n "$repo_root" ]] || return 0

    exec_in_ct "$CT_SUP" "
      python3 - <<'PY'
import os

repo_root = '$repo_root'
explicit = '$CONFIG_CANDIDATE_PATH'.strip()

candidates = []
if explicit:
    candidates.append(os.path.join(repo_root, explicit))

candidates.extend([
    os.path.join(repo_root, 'superset_config.py'),
    os.path.join(repo_root, 'deploy', 'superset_config.py'),
    os.path.join(repo_root, 'config', 'superset_config.py'),
    os.path.join(repo_root, 'docker', 'pythonpath', 'superset_config.py'),
])

for c in candidates:
    if os.path.isfile(c):
        print(c)
        break
else:
    print('')
PY
    "
  }

  sync_config_from_repo_if_available() {
    [[ "$CONFIG_SYNC" == "1" ]] || { log "[config] sync disabled; preserving live config"; return 0; }
    [[ "$FORCE_CONFIG_SYNC" == "1" ]] || { log "[config] sync requested but not forced; preserving live config"; return 0; }

    local candidate
    candidate="$(repo_config_candidate || true)"
    if [[ -z "${candidate:-}" ]]; then
      log "[config] no repo superset_config.py candidate found; preserving live config"
      return 0
    fi

    log "[config] repo candidate found: $candidate"

    exec_in_ct "$CT_SUP" "
      mkdir -p '$CONFIG_DIR'
      if [ -f '$SUPERSET_CONFIG_FILE' ]; then
        if cmp -s '$candidate' '$SUPERSET_CONFIG_FILE'; then
          echo 'CONFIG_UNCHANGED'
          exit 0
        fi
        cp -a '$SUPERSET_CONFIG_FILE' '$CONFIG_DIR/superset_config.py.bak.\$(date +%Y%m%d%H%M%S)'
      fi
      cp -a '$candidate' '$SUPERSET_CONFIG_FILE'
      python3 -m py_compile '$SUPERSET_CONFIG_FILE'
      echo 'CONFIG_UPDATED_FROM_REPO'
    "
  }

  frontend_build_in_workdir() {
    [[ "$FRONTEND" != "skip" ]] || { log "[frontend] skipped"; return 0; }

    local repo_root
    repo_root="$(resolve_work_repo_root)"
    [[ -n "$repo_root" ]] || die "Could not detect repository root for frontend build"

    log "[frontend] rebuild frontend from $repo_root"

    exec_in_ct "$CT_SUP" "
      [ -d '$repo_root/superset-frontend' ] || { echo 'ERROR: superset-frontend missing under $repo_root'; exit 6; }

      if ! command -v node >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
        safe_apt_install nodejs >/dev/null 2>&1 || true
      fi

      safe_apt_install coreutils >/dev/null 2>&1 || true
      cd '$repo_root/superset-frontend'

      if [ '$FRONTEND_CLEAN' = '1' ]; then
        rm -rf \
          node_modules \
          .cache \
          .temp_cache \
          node_modules/.cache \
          '$repo_root/superset/static/assets' \
          '$repo_root/superset-frontend/dist' \
          /tmp/webpack-* \
          /tmp/.webpack-* || true
      fi

      export NODE_OPTIONS='$NODE_OPTIONS_VALUE'
      export CI=1
      export npm_config_progress=false
      export npm_config_audit=false
      export npm_config_fund=false
      export PUPPETEER_SKIP_DOWNLOAD=1

      mkdir -p '$LOG_DIR'
      : > '$FRONTEND_LOG_IN_CT'

      heartbeat() {
        while true; do
          echo \"[frontend] still running: \$(date -Iseconds)\"
          sleep 30
        done
      }

      hb_pid=''

      cleanup_heartbeat() {
        if [ -n \"\${hb_pid:-}\" ]; then
          kill \"\$hb_pid\" >/dev/null 2>&1 || true
          wait \"\$hb_pid\" >/dev/null 2>&1 || true
          hb_pid=''
        fi
      }

      print_frontend_failure() {
        desc=\"\$1\"
        rc=\"\$2\"
        if [ \"\$rc\" -eq 124 ]; then
          echo \"ERROR: \$desc timed out after ${FRONTEND_TIMEOUT_MINUTES} minute(s)\"
        else
          echo \"ERROR: \$desc failed with rc=\$rc\"
        fi
        echo '----- frontend log tail -----'
        tail -n '${FRONTEND_LOG_TAIL_LINES}' '$FRONTEND_LOG_IN_CT' || true
      }

      trap cleanup_heartbeat EXIT

      run_with_log() {
        desc=\"\$1\"
        shift
        echo \"[frontend] START \$desc: \$(date -Iseconds)\"
        heartbeat &
        hb_pid=\$!
        set +e
        timeout --foreground '${FRONTEND_TIMEOUT_MINUTES}m' \"\$@\" >> '$FRONTEND_LOG_IN_CT' 2>&1
        rc=\$?
        cleanup_heartbeat
        set -e

        if [ \$rc -ne 0 ]; then
          print_frontend_failure \"\$desc\" \"\$rc\"
          return \$rc
        fi

        echo \"[frontend] END \$desc: \$(date -Iseconds)\"
        return 0
      }

      if [ -f package-lock.json ]; then
        if ! run_with_log 'npm ci' npm ci --legacy-peer-deps; then
          echo 'WARN: npm ci failed, falling back to npm install --legacy-peer-deps'
          run_with_log 'npm install fallback' npm install --legacy-peer-deps
        fi
      else
        if [ '$NPM_LEGACY_PEER_DEPS' = '1' ]; then
          run_with_log 'npm install' npm install --legacy-peer-deps
        else
          run_with_log 'npm install' npm install
        fi
      fi

      if [ '$FRONTEND_TYPECHECK' = '1' ]; then
        run_with_log 'npm run type' npm run type -- --pretty false
      fi

      run_with_log 'npm run build' npm run build

      test -d '$repo_root/superset/static/assets' || {
        echo 'ERROR: frontend build did not produce superset/static/assets'
        echo '----- frontend log tail -----'
        tail -n '${FRONTEND_LOG_TAIL_LINES}' '$FRONTEND_LOG_IN_CT' || true
        exit 7
      }

      echo 'FRONTEND_REPLACEMENT_READY'
    "
  }

  cleanup_installed_runtime_artifacts() {
    log "[supersets] cleanup stale installed runtime artifacts"

    stop_gunicorn
    stop_celery_runtime

    exec_in_ct "$CT_SUP" "
      rm -rf /tmp/webpack-* /tmp/.webpack-* 2>/dev/null || true
      rm -rf /root/.cache/pip 2>/dev/null || true
      rm -rf /root/.npm/_cacache 2>/dev/null || true
      rm -f '$GUNICORN_LOG' '$GUNICORN_PID_FILE' '$CELERY_LOG' '$CELERY_PID_FILE' '$CELERY_BEAT_LOG' '$CELERY_BEAT_PID_FILE' '$DEPLOY_LOG_IN_CT' '$FRONTEND_LOG_IN_CT' 2>/dev/null || true

      '$VENV/bin/pip' uninstall -y apache-superset >/dev/null 2>&1 || true
      find '$VENV/lib' -maxdepth 4 \\( -name 'apache_superset*.dist-info' -o -name 'apache_superset*.egg-info' \\) -exec rm -rf {} + 2>/dev/null || true

      find '$VENV/lib' -type d -path '*/site-packages/superset' -prune -exec rm -rf {} + 2>/dev/null || true
      find '$VENV/lib' -type d -path '*/site-packages/superset-frontend' -prune -exec rm -rf {} + 2>/dev/null || true
    " || true
  }

  ensure_venv_and_install_backend_from_workdir() {
    local repo_root
    repo_root="$(resolve_work_repo_root)"
    [[ -n "$repo_root" ]] || die "Could not detect repository root for backend install"

    log "[supersets] install backend dependencies from $repo_root and use repo as runtime"

    exec_in_ct "$CT_SUP" "
      mkdir -p '$CONFIG_DIR' '$LOG_DIR'
      [ -x '$VENV/bin/python3' ] || python3 -m venv '$VENV'
      '$VENV/bin/pip' install -U pip setuptools wheel

      cd '$repo_root'

      '$VENV/bin/pip' uninstall -y apache-superset >/dev/null 2>&1 || true
      find '$VENV/lib' -maxdepth 4 \\( -name 'apache_superset*.dist-info' -o -name 'apache_superset*.egg-info' \\) -exec rm -rf {} + 2>/dev/null || true
      find '$VENV/lib' -type d -path '*/site-packages/superset' -prune -exec rm -rf {} + 2>/dev/null || true

      [ -f requirements/base.txt ] && '$VENV/bin/pip' install -r requirements/base.txt || true
      [ -f requirements/local.txt ] && '$VENV/bin/pip' install -r requirements/local.txt || true

      [ -f setup.py ] || [ -f pyproject.toml ] || {
        echo 'ERROR: repo root is not installable'
        ls -la '$repo_root'
        exit 12
      }

      '$VENV/bin/pip' install -U .
      '$VENV/bin/pip' install -U 'gunicorn>=22.0.0'
      '$VENV/bin/pip' install -U 'redis>=4.6,<5.0'
      '$VENV/bin/pip' install -U 'celery>=5.3,<5.6'

      set -a; . '$ENV_FILE'; set +a
      DBURI=\${SUPERSET_DB_URI:-}
      case \"\$DBURI\" in
        postgresql*|postgres* )
          '$VENV/bin/pip' install -U 'psycopg2-binary>=2.9,<3.0'
          ;;
      esac

      if [ \"\${DUCKDB_ENABLED:-0}\" = '1' ]; then
        echo '[duckdb] installing DuckDB support packages'
        '$VENV/bin/pip' install -U \"\${DUCKDB_PYTHON_PACKAGE:-duckdb}\" \"\${DUCKDB_SQLALCHEMY_PACKAGE:-duckdb-engine}\"

        '$VENV/bin/python' - <<'PY'
from sqlalchemy import create_engine, text
import duckdb
import duckdb_engine

engine = create_engine('duckdb:///:memory:')
with engine.connect() as conn:
    value = conn.execute(text('select 1')).scalar()

assert value == 1, f'Unexpected DuckDB test result: {value}'
print('DUCKDB_OK', getattr(duckdb, '__version__', 'unknown'))
print('DUCKDB_ENGINE_OK', getattr(duckdb_engine, '__version__', 'unknown'))
PY
      fi

      '$VENV/bin/python' - <<PY
from importlib.metadata import version, PackageNotFoundError
import inspect, sys
sys.path.insert(0, '$WORK_SRC')
import superset

for name in ['apache-superset', 'celery', 'redis', 'psycopg2-binary', 'gunicorn', 'clickhouse-connect', 'duckdb', 'duckdb-engine']:
    try:
        print(name, version(name))
    except PackageNotFoundError:
        print(name, 'NOT_FOUND')

print('USING_SUPERSET_FROM=', inspect.getfile(superset))
PY
    "
  }

  install_runtime_db_drivers() {
    log "[supersets] validate DB driver required by SUPERSET_DB_URI"

    exec_in_ct "$CT_SUP" "
      set -a; . '$ENV_FILE'; set +a
      DBURI=\${SUPERSET_DB_URI:-}
      [ -n \"\$DBURI\" ] || { echo 'ERROR: SUPERSET_DB_URI missing'; exit 13; }

      case \"\$DBURI\" in
        postgresql*|postgres* )
          '$VENV/bin/pip' install -U 'psycopg2-binary>=2.9,<3.0'
          '$VENV/bin/python' - <<'PY'
import psycopg2
print('DB_DRIVER_OK psycopg2', psycopg2.__version__)
PY
          ;;
        mysql* )
          '$VENV/bin/pip' install -U 'mysqlclient>=2.2'
          '$VENV/bin/python' - <<'PY'
import MySQLdb
print('DB_DRIVER_OK mysqlclient')
PY
          ;;
        duckdb* )
          '$VENV/bin/pip' install -U \"\${DUCKDB_PYTHON_PACKAGE:-duckdb}\" \"\${DUCKDB_SQLALCHEMY_PACKAGE:-duckdb-engine}\"
          '$VENV/bin/python' - <<'PY'
from sqlalchemy import create_engine, text
import duckdb
import duckdb_engine

engine = create_engine('duckdb:///:memory:')
with engine.connect() as conn:
    value = conn.execute(text('select 1')).scalar()

print('DB_DRIVER_OK duckdb', getattr(duckdb, '__version__', 'unknown'), value)
PY
          ;;
        sqlite* )
          echo 'ERROR: SQLite metadata backend is not allowed'
          exit 14
          ;;
        * )
          echo \"WARN: no explicit driver rule for \$DBURI\"
          ;;
      esac

      if [ \"\${DUCKDB_ENABLED:-0}\" = '1' ]; then
        '$VENV/bin/python' - <<'PY'
import importlib
mods = ['duckdb', 'duckdb_engine']
for mod in mods:
    importlib.import_module(mod)
print('DUCKDB_IMPORTS_OK')
PY
      fi

      if [ \"\${CLICKHOUSE_ENABLED:-1}\" = '1' ]; then
        '$VENV/bin/python' - <<'PY'
import importlib.util
if importlib.util.find_spec('clickhouse_connect') is None:
    print('CLICKHOUSE_CONNECT_MISSING — install with: pip install clickhouse-connect')
else:
    import clickhouse_connect
    print('CLICKHOUSE_CONNECT_OK', getattr(clickhouse_connect, '__version__', 'unknown'))
PY
      fi
    "
  }

  validate_metadata_source() {
    log "[supersets] validate metadata source from superset.env via superset_config.py"

    exec_in_ct "$CT_SUP" "
      set -a; . '$ENV_FILE'; set +a
      $(normalize_secret_env_snippet)

      [ -n \"\${SUPERSET_CONFIG_PATH:-}\" ] || { echo 'ERROR: SUPERSET_CONFIG_PATH missing'; exit 30; }
      [ \"\$SUPERSET_CONFIG_PATH\" = '$SUPERSET_CONFIG_FILE' ] || {
        echo 'ERROR: SUPERSET_CONFIG_PATH does not point to $SUPERSET_CONFIG_FILE'
        exit 31
      }

      [ -n \"\${SUPERSET_DB_URI:-}\" ] || { echo 'ERROR: SUPERSET_DB_URI missing'; exit 32; }
      [ -n \"\${SECRET_KEY:-}\" ] || { echo 'ERROR: SECRET_KEY / SUPERSET_SECRET_KEY missing'; exit 34; }

      case \"\$SUPERSET_DB_URI\" in
        sqlite:*|*superset.db*)
          echo 'ERROR: Refusing SQLite/superset.db metadata source in deployment'
          exit 33
          ;;
      esac

      PYTHONPATH='$WORK_SRC' '$VENV/bin/python' - <<'PY'
import importlib.util
import os

cfg = os.environ['SUPERSET_CONFIG_PATH']
spec = importlib.util.spec_from_file_location('superset_config', cfg)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

uri = getattr(mod, 'SQLALCHEMY_DATABASE_URI', '')
secret = getattr(mod, 'SECRET_KEY', '') or os.environ.get('SECRET_KEY') or os.environ.get('SUPERSET_SECRET_KEY', '')
print('CONFIG_DB_URI=' + uri)
print('SECRET_KEY_SET=' + ('yes' if bool(secret) else 'no'))

if not uri:
    raise SystemExit('Missing SQLALCHEMY_DATABASE_URI in loaded superset_config.py')
if uri.startswith('sqlite:') or 'superset.db' in uri:
    raise SystemExit('Refusing SQLite/superset.db metadata source from loaded config')
if not secret:
    raise SystemExit('Missing SECRET_KEY in loaded superset_config.py')
PY
    "
  }

  sitepkg_superset_dir() {
    exec_in_ct "$CT_SUP" "
      python3 - <<'PY'
import glob, os
paths = glob.glob('${VENV}/lib/python3.*/site-packages/superset')
paths = [p for p in paths if os.path.isdir(p)]
print(paths[0] if paths else '')
PY
    "
  }

  sitepkg_versions_dir() {
    exec_in_ct "$CT_SUP" "
      python3 - <<'PY'
import glob, os
paths = glob.glob('${VENV}/lib/python3.*/site-packages/superset/migrations/versions')
paths = [p for p in paths if os.path.isdir(p)]
print(paths[0] if paths else '')
PY
    "
  }

  sitepkg_static_dir() {
    exec_in_ct "$CT_SUP" "
      python3 - <<'PY'
import glob, os
paths = glob.glob('${VENV}/lib/python3.*/site-packages/superset/static')
paths = [p for p in paths if os.path.isdir(p)]
print(paths[0] if paths else '')
PY
    "
  }

  sitepkg_templates_dir() {
    exec_in_ct "$CT_SUP" "
      python3 - <<'PY'
import glob, os
paths = glob.glob('${VENV}/lib/python3.*/site-packages/superset/templates')
paths = [p for p in paths if os.path.isdir(p)]
print(paths[0] if paths else '')
PY
    "
  }

  sync_repo_migrations_to_site_packages() {
    log "[supersets] sync repo migrations into installed package path"

    local sitepkg_dir repo_root
    sitepkg_dir="$(sitepkg_superset_dir || true)"
    repo_root="$(resolve_work_repo_root)"

    if [[ -z "$sitepkg_dir" ]]; then
      sitepkg_dir="$(exec_in_ct "$CT_SUP" "python3 - <<'PY'
import glob, os
base='${VENV}/lib/python3.'
for p in glob.glob(base+'*/site-packages'):
    if os.path.isdir(p):
        print(p + '/superset')
        break
PY")"
      exec_in_ct "$CT_SUP" "mkdir -p '$sitepkg_dir'"
    fi

    [[ -n "$repo_root" ]] || die "Cannot detect repo root for migrations sync"

    exec_in_ct "$CT_SUP" "
      test -d '$repo_root/superset/migrations' || { echo 'ERROR: repo migrations missing'; exit 4; }

      mkdir -p '$sitepkg_dir/migrations'
      rsync -a --delete '$repo_root/superset/migrations/' '$sitepkg_dir/migrations/'

      test -f '$sitepkg_dir/migrations/env.py'
      test -d '$sitepkg_dir/migrations/versions'

      find '$sitepkg_dir' -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
      python3 -m compileall '$sitepkg_dir/migrations' >/dev/null
      echo 'MIGRATIONS_SYNC_OK'
    "
  }

  force_replace_installed_frontend_from_repo() {
    log "[supersets] fully replace installed frontend-facing files from repo"

    local static_dir templates_dir repo_root
    static_dir="$(sitepkg_static_dir || true)"
    templates_dir="$(sitepkg_templates_dir || true)"
    repo_root="$(resolve_work_repo_root)"

    if [[ -z "$static_dir" ]]; then
      static_dir="$(exec_in_ct "$CT_SUP" "python3 - <<'PY'
import glob, os
for p in glob.glob('${VENV}/lib/python3.*/site-packages'):
    if os.path.isdir(p):
        print(p + '/superset/static')
        break
PY")"
    fi

    if [[ -z "$templates_dir" ]]; then
      templates_dir="$(exec_in_ct "$CT_SUP" "python3 - <<'PY'
import glob, os
for p in glob.glob('${VENV}/lib/python3.*/site-packages'):
    if os.path.isdir(p):
        print(p + '/superset/templates')
        break
PY")"
    fi

    [[ -n "$repo_root" ]] || die "Cannot detect repo root for frontend replacement"

    exec_in_ct "$CT_SUP" "
      test -d '$repo_root/superset/static' || { echo 'ERROR: repo static dir missing'; exit 8; }
      test -d '$repo_root/superset/templates' || { echo 'ERROR: repo templates dir missing'; exit 9; }
      if [ '$FRONTEND' != 'skip' ]; then
        test -d '$repo_root/superset/static/assets' || { echo 'ERROR: built assets missing'; exit 10; }
      fi

      rm -rf '$static_dir' '$templates_dir'
      mkdir -p '$static_dir' '$templates_dir'

      rsync -a --delete '$repo_root/superset/static/' '$static_dir/'
      rsync -a --delete '$repo_root/superset/templates/' '$templates_dir/'

      if [ '$FRONTEND' != 'skip' ]; then
        test -d '$static_dir/assets' || { echo 'ERROR: installed assets missing after sync'; exit 11; }
      fi

      echo 'FRONTEND_REPLACEMENT_OK'
    "
  }

  patch_dhis2_migrations_in_site_packages() {
    [[ "$PATCH_MIGRATIONS" == "1" ]] || return 0
    log "[supersets] patch DHIS2/custom migrations in installed package path"

    exec_in_ct "$CT_SUP" "
      python3 - <<'PY'
import glob
import re
import shutil
from datetime import datetime
from pathlib import Path

roots = glob.glob('${VENV}/lib/python3.*/site-packages/superset/migrations/versions')
roots = [r for r in roots if Path(r).exists()]

def patch_groupby(text: str) -> str:
    text = re.sub(r'(\\bAND\\b|\\bWHERE\\b)\\s+groupby\\s*=\\s*1\\b', r'\\1 groupby IS TRUE', text, flags=re.I)
    text = re.sub(r'(\\bAND\\b|\\bWHERE\\b)\\s+groupby\\s*=\\s*0\\b', r'\\1 groupby IS FALSE', text, flags=re.I)
    text = re.sub(r'\\bSET\\s+groupby\\s*=\\s*1\\b', 'SET groupby = TRUE', text, flags=re.I)
    text = re.sub(r'\\bSET\\s+groupby\\s*=\\s*0\\b', 'SET groupby = FALSE', text, flags=re.I)
    return text

def patch_sanitize(text: str) -> str:
    return text.replace('%(idd)s', '%(id)s').replace(':idd', ':id')

for root in roots:
    for file_path in glob.glob(str(Path(root) / '*.py')):
        p = Path(file_path)
        original = p.read_text(errors='ignore')
        updated = original
        lower = p.name.lower()

        if 'dhis2' in lower:
            updated = patch_groupby(updated)

        if 'sanitize_dhis2_columns' in lower or 'preview' in lower:
            updated = patch_sanitize(updated)

        if updated != original:
            backup = str(p) + '.bak.' + datetime.now().strftime('%Y%m%d%H%M%S')
            shutil.copy2(p, backup)
            p.write_text(updated)
PY
    "
  }

  git_fetch_upstream_if_needed() {
    [[ "$USE_UPSTREAM_MIGRATIONS" == "1" ]] || return 0
    run_as_user "cd '$HOST_SRC_DIR' && (git remote get-url upstream >/dev/null 2>&1 || git remote add upstream '$UPSTREAM_REPO_URL')"
    run_as_user "cd '$HOST_SRC_DIR' && git fetch upstream --prune --tags"
  }

  inject_missing_revision_by_content() {
    local rev="$1"
    local file=""
    local commit=""
    local destdir=""
    local tmpfile=""

    file="$(run_as_user "cd '$HOST_SRC_DIR' && grep -RslE \"revision\\s*=\\s*['\\\"]${rev}['\\\"]\" superset/migrations/versions 2>/dev/null | head -n1 || true")"
    if [[ -n "$file" ]]; then
      commit="$(run_as_user "cd '$HOST_SRC_DIR' && git rev-parse HEAD")"
    else
      commit="$(run_as_user "cd '$HOST_SRC_DIR' && git log --all -n 1 --pretty=format:%H -G \"revision\\s*=\\s*['\\\"]${rev}['\\\"]\" -- superset/migrations/versions || true")"
      if [[ -n "$commit" ]]; then
        file="$(run_as_user "cd '$HOST_SRC_DIR' && git grep -l \"revision\\s*=\\s*['\\\"]${rev}['\\\"]\" '$commit' -- superset/migrations/versions | head -n1 || true")"
      fi
    fi

    if [[ -z "$file" || -z "$commit" ]]; then
      if [[ "$USE_UPSTREAM_MIGRATIONS" == "1" ]]; then
        git_fetch_upstream_if_needed
        commit="$(run_as_user "cd '$HOST_SRC_DIR' && git log --all -n 1 --pretty=format:%H -G \"revision\\s*=\\s*['\\\"]${rev}['\\\"]\" -- superset/migrations/versions || true")"
        if [[ -n "$commit" ]]; then
          file="$(run_as_user "cd '$HOST_SRC_DIR' && git grep -l \"revision\\s*=\\s*['\\\"]${rev}['\\\"]\" '$commit' -- superset/migrations/versions | head -n1 || true")"
        fi
      fi
    fi

    [[ -n "$file" && -n "$commit" ]] || return 2
    destdir="$(sitepkg_versions_dir)"
    [[ -n "$destdir" ]] || return 3

    tmpfile="$(mktemp /tmp/alembic-${rev}.XXXX.py)"
    run_as_user "cd '$HOST_SRC_DIR' && git show '${commit}:${file}' > '$tmpfile'"
    sudo lxc file push --uid 0 --gid 0 --mode 0644 "$tmpfile" "${CT_SUP}${destdir}/$(basename "$file")"
    rm -f "$tmpfile"

    exec_in_ct "$CT_SUP" "
      test -f '${destdir}/$(basename "$file")'
      python3 -m py_compile '${destdir}/$(basename "$file")'
      echo 'INJECT_OK ${destdir}/$(basename "$file")'
    "
  }

  backup_metadata_db() {
    [[ "$DO_BACKUP" == "1" ]] || return 0

    local dbjson db
    dbjson="$(parse_db_uri_json)"
    db="$(db_json_field db "$dbjson")"
    [[ -n "$db" ]] || die "Cannot determine metadata DB name"

    log "[backup] pg_dump metadata database: $db"
    exec_in_ct "$CT_PG" "
      mkdir -p '$BACKUP_DIR'
      chown -R postgres:postgres '$BACKUP_DIR' || true
    "
    exec_in_ct_as_postgres "$CT_PG" "pg_dump -Fc -f '$BACKUP_DIR/metadata-${db}-\$(date +%Y%m%d%H%M%S).dump' '$db' || true"
  }

  wipe_metadata_db() {
    [[ "$WIPE_METADATA" == "1" ]] || return 0
    [[ "$CONFIRM_WIPE_METADATA" == "1" ]] || die "Refusing metadata wipe without --confirm-wipe-metadata"
    log "[wipe] destructive metadata reset requested"

    backup_metadata_db

    local dbjson user pw host db pgip
    dbjson="$(parse_db_uri_json)"
    user="$(db_json_field user "$dbjson")"
    pw="$(db_json_field password "$dbjson")"
    host="$(db_json_field host "$dbjson")"
    db="$(db_json_field db "$dbjson")"
    pgip="$(ct_ip "$CT_PG")"

    [[ -n "$db" ]] || die "SUPERSET_DB_URI database is empty"
    if [[ -n "$host" && "$host" != "$pgip" && "$host" != "127.0.0.1" && "$host" != "localhost" && "$host" != "$CT_PG" ]]; then
      die "Refusing wipe: SUPERSET_DB_URI host=$host does not match postgres container/IP"
    fi

    stop_gunicorn
    stop_celery_runtime

    exec_in_ct_as_postgres "$CT_PG" "psql -v ON_ERROR_STOP=1 -v db=$(printf '%q' "$db") -v usr=$(printf '%q' "$user") -v pwd=$(printf '%q' "$pw") <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'db' AND pid <> pg_backend_pid();

SELECT format('DROP DATABASE IF EXISTS %I', :'db')
\gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'usr', :'pwd')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'usr')
\gexec

SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'usr', :'pwd')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'usr')
\gexec

SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'usr')
\gexec

SELECT format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', :'db', :'usr')
\gexec
SQL"
  }

  run_db_upgrade_init_with_alembic_fix() {
    log "[supersets] run db upgrade / create-admin / init"

    local tries=0
    local max_tries=8
    local out rc missing_rev

    while true; do
      tries=$((tries + 1))
      set +e
      out="$(exec_in_ct "$CT_SUP" "
        touch '$DEPLOY_LOG_IN_CT'
        exec > >(tee -a '$DEPLOY_LOG_IN_CT') 2>&1
        set -a; . '$ENV_FILE'; set +a
        $(normalize_secret_env_snippet)

        set +e
        PYTHONPATH='$WORK_SRC' '$VENV/bin/superset' db upgrade
        rc=\$?
        set -e

        if [ \$rc -ne 0 ]; then
          if grep -q 'Multiple head revisions are present' '$DEPLOY_LOG_IN_CT'; then
            echo '[alembic] multiple heads detected; retrying with heads'
            PYTHONPATH='$WORK_SRC' '$VENV/bin/superset' db upgrade heads
          else
            exit \$rc
          fi
        fi

        PYTHONPATH='$WORK_SRC' '$VENV/bin/superset' fab create-admin \
          --username '$ADMIN_USER' \
          --firstname '$ADMIN_FIRST' \
          --lastname '$ADMIN_LAST' \
          --email '$ADMIN_EMAIL' \
          --password '$ADMIN_PASS' || true

        PYTHONPATH='$WORK_SRC' '$VENV/bin/superset' init
      " 2>&1)"
      rc=$?
      set -e

      if [[ "$rc" -eq 0 ]]; then
        return 0
      fi

      if ! grep -q "Can't locate revision identified by" <<<"$out"; then
        printf '%s\n' "$out"
        return "$rc"
      fi

      missing_rev="$(sed -n "s/.*identified by '\([^']\+\)'.*/\1/p" <<<"$out" | head -n1)"
      [[ -n "$missing_rev" ]] || { printf '%s\n' "$out"; return 60; }
      [[ "$tries" -lt "$max_tries" ]] || { printf '%s\n' "$out"; return 61; }

      case "$ALEMBIC_FIX_MODE" in
        auto)
          if inject_missing_revision_by_content "$missing_rev"; then
            continue
          fi
          case "$ALEMBIC_AUTO_FALLBACK" in
            stamp-head)
              backup_metadata_db
              exec_in_ct "$CT_SUP" "
                set -a; . '$ENV_FILE'; set +a
                $(normalize_secret_env_snippet)
                PYTHONPATH='$WORK_SRC' '$VENV/bin/superset' db stamp heads
              "
              ;;
            wipe)
              WIPE_METADATA=1
              wipe_metadata_db
              ;;
            none|'')
              printf '%s\n' "$out"
              return 62
              ;;
            *)
              die "Invalid ALEMBIC_AUTO_FALLBACK=$ALEMBIC_AUTO_FALLBACK"
              ;;
          esac
          ;;
        stamp-head)
          backup_metadata_db
          exec_in_ct "$CT_SUP" "
            set -a; . '$ENV_FILE'; set +a
            $(normalize_secret_env_snippet)
            PYTHONPATH='$WORK_SRC' '$VENV/bin/superset' db stamp heads
          "
          ;;
        wipe)
          WIPE_METADATA=1
          wipe_metadata_db
          ;;
        *)
          die "Invalid ALEMBIC_FIX_MODE=$ALEMBIC_FIX_MODE"
          ;;
      esac
    done
  }

  restart_gunicorn() {
    log "[supersets] restart Gunicorn with nohup and verify /health"

    stop_gunicorn

    exec_in_ct "$CT_SUP" "
      set -a; . '$ENV_FILE'; set +a
      $(normalize_secret_env_snippet)
      [ -n \"\${SECRET_KEY:-}\" ] || { echo 'ERROR: SECRET_KEY / SUPERSET_SECRET_KEY missing for gunicorn'; exit 35; }

      PORT=\${SUPERSET_WEBSERVER_PORT:-8088}
      ADDR=\${SUPERSET_WEBSERVER_ADDRESS:-0.0.0.0}

      mkdir -p '$CONFIG_DIR' '$LOG_DIR'
      cat > '$GUNICORN_CONF' <<PY
import multiprocessing
bind = \"\${ADDR}:\" + str(\${PORT})
workers = max(2, min(8, multiprocessing.cpu_count() * 2))
worker_class = \"gthread\"
threads = 4
timeout = 300
graceful_timeout = 60
keepalive = 5
accesslog = \"-\"
errorlog = \"-\"
capture_output = True
PY
      python3 -m py_compile '$GUNICORN_CONF'

      rm -f '$GUNICORN_PID_FILE'
      fuser -k \${PORT}/tcp >/dev/null 2>&1 || true
      sleep 1

      touch '$GUNICORN_LOG'
      chmod 664 '$GUNICORN_LOG' || true

      set +e
      PYTHONPATH='$WORK_SRC' nohup '$VENV/bin/gunicorn' -c '$GUNICORN_CONF' 'superset.app:create_app()' >> '$GUNICORN_LOG' 2>&1 &
      gunicorn_pid=\$!
      echo \$gunicorn_pid > '$GUNICORN_PID_FILE'
      sleep 5

      if ! kill -0 \$gunicorn_pid 2>/dev/null; then
        echo 'ERROR: gunicorn exited immediately'
        tail -n 200 '$GUNICORN_LOG' || true
        exit 21
      fi

      ok=0
      for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        code=\$(curl -s -o /dev/null -w '%{http_code}' \"http://127.0.0.1:\${PORT}/health\" || true)
        if [ \"\$code\" = '200' ]; then ok=1; break; fi
        sleep 2
      done
      set -e

      echo \"health_ok=\$ok\"
      if [ \"\$ok\" != '1' ]; then
        echo 'ERROR: Superset health check failed'
        tail -n 200 '$GUNICORN_LOG' || true
        exit 20
      fi
    "
  }

  install_celery_systemd_units() {
    log "[supersets] write systemd unit files for Celery worker + beat"

    exec_in_ct "$CT_SUP" "
      mkdir -p '$LOG_DIR'

      cat > /etc/systemd/system/superset-celery-worker.service <<UNIT
[Unit]
Description=Superset Celery Worker
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=root
WorkingDirectory=$SUPERSET_HOME
EnvironmentFile=$ENV_FILE
Environment=PYTHONPATH=$WORK_SRC
ExecStart=$VENV/bin/celery --app=superset.tasks.celery_app:app worker --pool=prefork -O fair -c $CELERY_CONCURRENCY -Q celery,dhis2
StandardOutput=append:$CELERY_LOG
StandardError=append:$CELERY_LOG
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

      cat > /etc/systemd/system/superset-celery-beat.service <<UNIT
[Unit]
Description=Superset Celery Beat
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=root
WorkingDirectory=$SUPERSET_HOME
EnvironmentFile=$ENV_FILE
Environment=PYTHONPATH=$WORK_SRC
ExecStart=$VENV/bin/celery --app=superset.tasks.celery_app:app beat --schedule=$SUPERSET_HOME/celerybeat-schedule
StandardOutput=append:$CELERY_BEAT_LOG
StandardError=append:$CELERY_BEAT_LOG
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

      systemctl daemon-reload
      echo 'systemd_units_installed=1'
    "
  }

  restart_celery_worker() {
    [[ "$ENABLE_CELERY_WORKER" == "1" ]] || { log "[supersets] celery worker skipped"; return 0; }

    log "[supersets] enable + start Celery worker via systemd"

    stop_celery_runtime

    exec_in_ct "$CT_SUP" "
      set -a; . '$ENV_FILE'; set +a
      $(normalize_secret_env_snippet)
      [ -n \"\${SECRET_KEY:-}\" ] || { echo 'ERROR: SECRET_KEY / SUPERSET_SECRET_KEY missing for celery'; exit 40; }
      [ -n \"\${SUPERSET_CONFIG_PATH:-}\" ] || { echo 'ERROR: SUPERSET_CONFIG_PATH missing for celery'; exit 41; }

      mkdir -p '$LOG_DIR'
      touch '$CELERY_LOG'
      chmod 664 '$CELERY_LOG' || true

      systemctl enable superset-celery-worker
      systemctl restart superset-celery-worker

      tries=0
      while true; do
        PYTHONPATH='$WORK_SRC' '$VENV/bin/celery' --app=superset.tasks.celery_app:app inspect ping >/dev/null 2>&1 && break
        tries=\$((tries + 1))
        if [ \"\$tries\" -ge 30 ]; then
          echo 'ERROR: celery worker not ready after 30 seconds'
          journalctl -u superset-celery-worker -n 50 --no-pager || tail -n 50 '$CELERY_LOG' || true
          exit 47
        fi
        sleep 1
      done

      echo 'celery_worker_ok=1'
      systemctl status superset-celery-worker --no-pager || true
    "
  }

  restart_celery_beat() {
    [[ "$ENABLE_CELERY_BEAT" == "1" ]] || { log "[supersets] celery beat skipped"; return 0; }

    log "[supersets] enable + start Celery beat via systemd"

    exec_in_ct "$CT_SUP" "
      set -a; . '$ENV_FILE'; set +a
      $(normalize_secret_env_snippet)
      [ -n \"\${SECRET_KEY:-}\" ] || { echo 'ERROR: SECRET_KEY / SUPERSET_SECRET_KEY missing for celery beat'; exit 44; }
      [ -n \"\${SUPERSET_CONFIG_PATH:-}\" ] || { echo 'ERROR: SUPERSET_CONFIG_PATH missing for celery beat'; exit 45; }

      mkdir -p '$LOG_DIR'
      touch '$CELERY_BEAT_LOG'
      chmod 664 '$CELERY_BEAT_LOG' || true

      systemctl enable superset-celery-beat
      systemctl restart superset-celery-beat

      tries=0
      while true; do
        systemctl is-active --quiet superset-celery-beat && break
        tries=\$((tries + 1))
        if [ \"\$tries\" -ge 30 ]; then
          echo 'ERROR: celery beat not running after 30 seconds'
          journalctl -u superset-celery-beat -n 50 --no-pager || tail -n 50 '$CELERY_BEAT_LOG' || true
          exit 48
        fi
        sleep 1
      done

      echo 'celery_beat_ok=1'
      systemctl status superset-celery-beat --no-pager || true
    "
  }

  apache_cache_fix() {
    [[ "$APACHE_CACHE_FIX" == "1" ]] || return 0
    log "[proxy] apply Apache cache helper config"

    exec_in_ct "$CT_PROXY" "
      safe_apt_update >/dev/null 2>&1 || true
      safe_apt_install apache2 >/dev/null 2>&1 || true
      a2enmod headers >/dev/null 2>&1 || true

      CONF=/etc/apache2/conf-available/superset-nocache.conf
      cat > \"\$CONF\" <<'AP'
<IfModule mod_headers.c>
  SetEnvIfExpr \"%{HTTP_HOST} == '${DOMAIN}' && %{REQUEST_URI} =~ m#^/static/assets/#\" is_superset_static=1
  SetEnvIfExpr \"%{HTTP_HOST} == '${DOMAIN}' && %{REQUEST_URI} !~ m#^/static/assets/#\" is_superset_html=1

  Header always set Cache-Control \"no-store, no-cache, must-revalidate, max-age=0\" env=is_superset_html
  Header always set Pragma \"no-cache\" env=is_superset_html
  Header always set Expires \"0\" env=is_superset_html

  Header always set Cache-Control \"public, max-age=31536000, immutable\" env=is_superset_static
</IfModule>
AP

      a2enconf superset-nocache >/dev/null 2>&1 || true
      apache2ctl -t
      apache2ctl -k graceful || true
    " || true
  }

  proxy_verify() {
    log "[proxy] verify proxy"
    exec_in_ct "$CT_PROXY" "
      apache2ctl -t >/dev/null 2>&1 || true
      apache2ctl -k graceful >/dev/null 2>&1 || true

      curl -s  -o /dev/null -w 'HTTP  /login=%{http_code}\n'  -H 'Host: $DOMAIN' http://127.0.0.1/login || true
      curl -s  -o /dev/null -w 'HTTP  /health=%{http_code}\n' -H 'Host: $DOMAIN' http://127.0.0.1/health || true
      curl -k -s -o /dev/null -w 'HTTPS /login=%{http_code}\n' -H 'Host: $DOMAIN' https://127.0.0.1/login || true
      curl -k -s -o /dev/null -w 'HTTPS /health=%{http_code}\n' -H 'Host: $DOMAIN' https://127.0.0.1/health || true
    "
  }

  reset_deployment_artifacts() {
    log "[reset] preserve env/config and clear deployment artifacts"

    ensure_env_exists
    ensure_superset_config_exists

    stop_gunicorn
    stop_celery_runtime

    exec_in_ct "$CT_SUP" "
      test -f '$SUPERSET_CONFIG_FILE'
      test -f '$ENV_FILE'

      if [ -d '$WORK_SRC' ]; then
        find '$WORK_SRC' -depth -delete 2>/dev/null || rm -rf '$WORK_SRC' 2>/dev/null || true
      fi
      rm -rf '$WORK_DIR' 2>/dev/null || true
      rm -rf '$VENV'     2>/dev/null || true
      rm -rf '$LOG_DIR'  2>/dev/null || true
      rm -f '$GUNICORN_PID_FILE' '$CELERY_PID_FILE' '$CELERY_BEAT_PID_FILE'
      mkdir -p '$CONFIG_DIR' '$BACKUP_DIR'

      test -f '$SUPERSET_CONFIG_FILE'
      test -f '$ENV_FILE'
      echo RESET_CONTAINER_OK
    "

    cleanup_host_src_dir
    sudo mkdir -p "$HOST_SRC_DIR"
    sudo chown -R "$RUN_USER":"$RUN_USER" "$HOST_SRC_DIR" 2>/dev/null || true
  }

  log "REMOTE worker command: $cmd"

  case "$cmd" in
    cleanup)
      ensure_env_exists
      ensure_superset_config_exists
      disable_systemd_superset_services
      detach_legacy_src_mount_if_present
      cleanup_host_src_dir
      cleanup_container_opt_layout
      ;;
    reset)
      ensure_env_exists
      ensure_superset_config_exists
      disable_systemd_superset_services
      detach_legacy_src_mount_if_present
      reset_deployment_artifacts
      cleanup_container_opt_layout
      ;;
    deploy|update)
      ensure_env_exists
      ensure_duckdb_env_vars
      ensure_clickhouse_credentials_file
      ensure_clickhouse_env_vars
      ensure_superset_config_exists
      disable_systemd_superset_services
      detach_legacy_src_mount_if_present
      git_clone_or_update
      install_supersets_base_tools
      ensure_redis_present
      install_clickhouse
      start_clickhouse
      setup_clickhouse_dbs
      db_sync_from_env
      validate_existing_config
      cleanup_container_opt_layout
      cleanup_installed_runtime_artifacts
      sync_to_workdir
      sync_config_from_repo_if_available
      frontend_build_in_workdir
      ensure_venv_and_install_backend_from_workdir
      install_clickhouse_python_package
      sync_superset_clickhouse_config_in_ct
      install_runtime_db_drivers
      validate_metadata_source
      sync_repo_migrations_to_site_packages
      force_replace_installed_frontend_from_repo
      patch_dhis2_migrations_in_site_packages
      run_db_upgrade_init_with_alembic_fix
      restart_gunicorn
      install_celery_systemd_units
      restart_celery_worker
      restart_celery_beat
      apache_cache_fix
      proxy_verify
      show_clickhouse_credentials
      ;;
    restart)
      ensure_env_exists
      ensure_duckdb_env_vars
      ensure_clickhouse_credentials_file
      ensure_clickhouse_env_vars
      ensure_superset_config_exists
      restart_gunicorn
      install_celery_systemd_units
      restart_celery_worker
      restart_celery_beat
      ;;
    restart-gunicorn)
      ensure_env_exists
      ensure_superset_config_exists
      restart_gunicorn
      ;;
    restart-celery)
      ensure_env_exists
      ensure_superset_config_exists
      install_celery_systemd_units
      restart_celery_worker
      restart_celery_beat
      ;;
    *)
      die "Unknown command: $cmd"
      ;;
  esac
}

main() {
  local cmd="${1:-}"
  shift || true
  [[ -n "$cmd" ]] || { usage; exit 1; }

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --target) TARGET="$2"; shift 2 ;;
      --port) SSH_PORT="$2"; shift 2 ;;
      --domain) DOMAIN="$2"; shift 2 ;;

      --repo) REPO_URL="$2"; shift 2 ;;
      --ref) GIT_REF="$2"; shift 2 ;;
      --depth) GIT_DEPTH="$2"; shift 2 ;;
      --submodules) GIT_SUBMODULES=1; shift ;;

      --alembic-fix) ALEMBIC_FIX_MODE="$2"; shift 2 ;;
      --alembic-fallback) ALEMBIC_AUTO_FALLBACK="$2"; shift 2 ;;
      --no-upstream-migrations) USE_UPSTREAM_MIGRATIONS=0; shift ;;

      --no-frontend) FRONTEND="skip"; shift ;;
      --no-frontend-clean) FRONTEND_CLEAN=0; shift ;;
      --frontend-timeout-minutes) FRONTEND_TIMEOUT_MINUTES="$2"; shift 2 ;;

      --no-db-sync) DB_SYNC=0; shift ;;
      --no-migration-patch) PATCH_MIGRATIONS=0; shift ;;

      --wipe-metadata) WIPE_METADATA=1; shift ;;
      --confirm-wipe-metadata) CONFIRM_WIPE_METADATA=1; shift ;;
      --backup) DO_BACKUP=1; shift ;;
      --no-apache-cache-fix) APACHE_CACHE_FIX=0; shift ;;

      --config-sync) CONFIG_SYNC=1; shift ;;
      --force-config-sync) FORCE_CONFIG_SYNC=1; shift ;;
      --no-config-sync) CONFIG_SYNC=0; FORCE_CONFIG_SYNC=0; shift ;;
      --config-candidate) CONFIG_CANDIDATE_PATH="$2"; shift 2 ;;

      --no-celery-worker) ENABLE_CELERY_WORKER=0; shift ;;
      --celery-beat) ENABLE_CELERY_BEAT=1; shift ;;
      --celery-concurrency) CELERY_CONCURRENCY="$2"; shift 2 ;;

      --no-duckdb) DUCKDB_ENABLED=0; shift ;;
      --duckdb) DUCKDB_ENABLED=1; shift ;;

      --no-clickhouse) CLICKHOUSE_ENABLED=0; shift ;;
      --clickhouse-password) CLICKHOUSE_PASSWORD="$2"; shift 2 ;;
      --clickhouse-user) CLICKHOUSE_USER="$2"; shift 2 ;;
      --clickhouse-host) CLICKHOUSE_HOST="$2"; shift 2 ;;
      --clickhouse-http-port) CLICKHOUSE_HTTP_PORT="$2"; shift 2 ;;

      -h|--help) usage; exit 0 ;;
      *) die "Unknown option: $1" ;;
    esac
  done

  has_cmd ssh || die "ssh not found"
  has_cmd scp || die "scp not found"

  if [[ "$WIPE_METADATA" == "1" && "$CONFIRM_WIPE_METADATA" != "1" ]]; then
    die "--wipe-metadata requires --confirm-wipe-metadata"
  fi

  case "$FRONTEND_TIMEOUT_MINUTES" in
    ''|*[!0-9]*) die "--frontend-timeout-minutes must be an integer" ;;
  esac

  case "$CELERY_CONCURRENCY" in
    ''|*[!0-9]*) die "--celery-concurrency must be an integer" ;;
  esac

  if is_local_lxd_host; then
    log "Detected local LXD host; running locally"
    remote_worker "$cmd"
    exit 0
  fi

  log "Remote target: $TARGET:$SSH_PORT"

  local env_tmp
  env_tmp="$(mktemp /tmp/deploy-supersets-env.XXXXXX)"
  write_remote_env_file "$env_tmp"

  scp_to_remote "$0" "$REMOTE_SCRIPT_PATH"
  scp_to_remote "$env_tmp" "$REMOTE_ENV_PATH"
  rm -f "$env_tmp"

  ssh_tty "chmod 700 '$REMOTE_SCRIPT_PATH' '$REMOTE_ENV_PATH'"
  ssh_tty "sudo bash -lc 'set -a; . \"$REMOTE_ENV_PATH\"; set +a; exec bash \"$REMOTE_SCRIPT_PATH\" __remote \"$cmd\"'"
}

if [[ "${1:-}" == "__remote" ]]; then
  shift
  remote_worker "$@"
else
  main "$@"
fi

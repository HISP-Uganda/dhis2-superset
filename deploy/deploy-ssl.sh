#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="dhis2-superset"
INSTALL_DIR="${INSTALL_DIR:-$HOME/$APP_NAME}"
VENV_DIR="${VENV_DIR:-$INSTALL_DIR/venv}"
ENV_FILE="${ENV_FILE:-$INSTALL_DIR/.env}"
CONFIG_DIR="${CONFIG_DIR:-$INSTALL_DIR/config}"
DATA_DIR="${DATA_DIR:-$INSTALL_DIR/data}"
LOG_DIR="${LOG_DIR:-$INSTALL_DIR/logs}"
RUN_DIR="${RUN_DIR:-$INSTALL_DIR/run}"
SUPERSET_CONFIG_FILE="${SUPERSET_CONFIG_FILE:-$CONFIG_DIR/superset_config.py}"
NGINX_SITE="/etc/nginx/sites-available/superset"

DOMAIN="${DOMAIN:-}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_FIRSTNAME="${ADMIN_FIRSTNAME:-Superset}"
ADMIN_LASTNAME="${ADMIN_LASTNAME:-Admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@localhost}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"

CLICKHOUSE_ENABLED="${CLICKHOUSE_ENABLED:-1}"
DUCKDB_ENABLED="${DUCKDB_ENABLED:-1}"
POSTGRES_ENABLED="${POSTGRES_ENABLED:-1}"
POSTGRES_DB="${POSTGRES_DB:-superset}"
POSTGRES_USER="${POSTGRES_USER:-superset}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 18 2>/dev/null || echo change_me_now)}"
POSTGRES_HOST="${POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_INSTALL_EXTENSIONS="${POSTGRES_INSTALL_EXTENSIONS:-1}"
SUPERSET_PORT="${SUPERSET_PORT:-8088}"
SUPERSET_HOST="${SUPERSET_HOST:-127.0.0.1}"
SUPERSET_SECRET_KEY="${SUPERSET_SECRET_KEY:-$(openssl rand -base64 42 2>/dev/null | tr -d '\n' || echo change_me)}"
GUEST_TOKEN_JWT_SECRET="${GUEST_TOKEN_JWT_SECRET:-$(openssl rand -base64 42 2>/dev/null | tr -d '\n' || echo change_me)}"

print() { printf '%b\n' "$*"; }
info() { print "\033[1;34m[INFO]\033[0m $*"; }
success() { print "\033[1;32m[OK]\033[0m $*"; }
warn() { print "\033[1;33m[WARN]\033[0m $*"; }
fail() { print "\033[1;31m[ERR]\033[0m $*"; exit 1; }

check_not_root() {
  if [[ ${EUID} -eq 0 ]]; then
    fail "Please do not run this script as root. Use a sudo-capable app user."
  fi
}

require_domain() {
  [[ -n "$DOMAIN" ]] || fail "Set DOMAIN, for example: DOMAIN=superset.example.org ./deploy_autotuned.sh install"
}

command_exists() { command -v "$1" >/dev/null 2>&1; }

get_cpu_cores() {
  nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo || echo 2
}

get_total_mem_mb() {
  awk '/MemTotal/ { printf "%d", $2/1024 }' /proc/meminfo
}

get_disk_gb() {
  df -BG --output=size / | tail -1 | tr -dc '0-9'
}

calc_autotune() {
  CPU_CORES="$(get_cpu_cores)"
  TOTAL_MEM_MB="$(get_total_mem_mb)"
  ROOT_DISK_GB="$(get_disk_gb)"

  if (( CPU_CORES <= 2 )); then
    GUNICORN_WORKERS=2
    GUNICORN_THREADS=4
    CELERY_CONCURRENCY=1
  elif (( CPU_CORES <= 4 )); then
    GUNICORN_WORKERS=3
    GUNICORN_THREADS=6
    CELERY_CONCURRENCY=2
  elif (( CPU_CORES <= 8 )); then
    GUNICORN_WORKERS=4
    GUNICORN_THREADS=8
    CELERY_CONCURRENCY=4
  else
    GUNICORN_WORKERS=$(( CPU_CORES > 12 ? 6 : CPU_CORES / 2 ))
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
    NGINX_PROXY_BUFFERS="16 16k"
    NGINX_PROXY_BUFFER_SIZE="16k"
    NGINX_PROXY_BUSY="64k"
  else
    NGINX_PROXY_BUFFERS="32 16k"
    NGINX_PROXY_BUFFER_SIZE="32k"
    NGINX_PROXY_BUSY="128k"
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


preflight_domain_checks() {
  if [ "${AUTO_SSL}" != "1" ]; then
    return
  fi

  if [ -z "${DOMAIN}" ]; then
    print_warning "DOMAIN not set; Let's Encrypt will be skipped"
    return
  fi

  print_info "Preflight SSL check for domain ${DOMAIN}..."
  if command -v getent >/dev/null 2>&1; then
    if ! getent ahosts "${DOMAIN}" >/dev/null 2>&1; then
      print_warning "Domain ${DOMAIN} does not currently resolve from this server. SSL may fail until DNS is set."
    fi
  fi
}

install_system_packages() {
  info "Installing OS packages"
  sudo apt-get update
  sudo apt-get install -y \
    curl wget gnupg ca-certificates apt-transport-https lsb-release software-properties-common \
    build-essential pkg-config git unzip rsync \
    python3 python3-venv python3-dev python3-pip \
    libffi-dev libssl-dev libsasl2-dev libldap2-dev libpq-dev default-libmysqlclient-dev \
    redis-server nginx postgresql postgresql-contrib postgresql-client \
    jq

  if ! command_exists node || ! command_exists npm; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  fi

  if [[ "$CLICKHOUSE_ENABLED" == "1" ]] && ! command_exists clickhouse-client; then
    if [[ ! -f /usr/share/keyrings/clickhouse-keyring.gpg ]]; then
      curl -fsSL https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key | sudo gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg
    fi
    echo "deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg arch=$(dpkg --print-architecture)] https://packages.clickhouse.com/deb stable main" | sudo tee /etc/apt/sources.list.d/clickhouse.list >/dev/null
    sudo apt-get update
    sudo apt-get install -y clickhouse-server clickhouse-client
  fi

  sudo systemctl enable --now redis-server
  sudo systemctl enable --now postgresql
  sudo systemctl enable --now nginx
  if [[ "$CLICKHOUSE_ENABLED" == "1" ]]; then
    sudo systemctl enable --now clickhouse-server || true
  fi
  success "OS packages installed"
}

setup_dirs() {
  mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR" "$RUN_DIR"
}

setup_venv() {
  info "Creating Python virtual environment"
  python3 -m venv "$VENV_DIR"
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
  pip install --upgrade pip wheel setuptools
  success "Virtual environment ready"
}

install_python_dependencies() {
  info "Installing Python dependencies"
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"

  if [[ -f "$INSTALL_DIR/requirements/base.txt" ]]; then
    pip install -r "$INSTALL_DIR/requirements/base.txt"
  fi
  if [[ -f "$INSTALL_DIR/requirements/development.txt" ]]; then
    pip install -r "$INSTALL_DIR/requirements/development.txt" || true
  fi

  pip install apache-superset psycopg2-binary redis celery gevent gunicorn clickhouse-connect cachelib
  if [[ "$DUCKDB_ENABLED" == "1" ]]; then
    pip install duckdb duckdb-engine
  fi
  if [[ -f "$INSTALL_DIR/setup.py" || -f "$INSTALL_DIR/pyproject.toml" ]]; then
    pip install -e "$INSTALL_DIR" || true
  fi
  success "Python dependencies installed"
}

build_frontend_if_present() {
  if [[ -d "$INSTALL_DIR/superset-frontend" ]]; then
    info "Building frontend assets"
    pushd "$INSTALL_DIR/superset-frontend" >/dev/null
    npm install
    npm run build || npm run prod || true
    popd >/dev/null
    success "Frontend assets built"
  fi
}

configure_redis() {
  info "Configuring Redis"
  sudo sed -i "s/^#*maxmemory .*/maxmemory ${REDIS_MAXMEMORY_MB}mb/" /etc/redis/redis.conf || true
  sudo sed -i "s/^#*maxmemory-policy .*/maxmemory-policy allkeys-lru/" /etc/redis/redis.conf || true
  sudo systemctl restart redis-server
  success "Redis tuned"
}

configure_postgresql() {
  [[ "$POSTGRES_ENABLED" == "1" ]] || return 0
  info "Configuring PostgreSQL"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER ${POSTGRES_USER} WITH PASSWORD '${POSTGRES_PASSWORD}';"

  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER} ENCODING 'UTF8';"

  sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB} TO ${POSTGRES_USER};"

  if [[ "$POSTGRES_INSTALL_EXTENSIONS" == "1" ]]; then
    sudo -u postgres psql -d "$POSTGRES_DB" -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'
    sudo -u postgres psql -d "$POSTGRES_DB" -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";'
    sudo -u postgres psql -d "$POSTGRES_DB" -c 'CREATE EXTENSION IF NOT EXISTS citext;'
    sudo -u postgres psql -d "$POSTGRES_DB" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;'
  fi

  PG_VERSION=$(psql --version | awk '{print $3}' | cut -d. -f1)
  PG_CONF="/etc/postgresql/${PG_VERSION}/main/postgresql.conf"
  sudo cp "$PG_CONF" "${PG_CONF}.bak.$(date +%s)" || true
  sudo sed -i "s/^#\?shared_buffers =.*/shared_buffers = ${PG_SHARED_BUFFERS_MB}MB/" "$PG_CONF"
  sudo sed -i "s/^#\?effective_cache_size =.*/effective_cache_size = ${PG_EFFECTIVE_CACHE_MB}MB/" "$PG_CONF"
  sudo sed -i "s/^#\?maintenance_work_mem =.*/maintenance_work_mem = ${PG_MAINTENANCE_MB}MB/" "$PG_CONF"
  sudo sed -i "s/^#\?work_mem =.*/work_mem = ${PG_WORK_MEM_MB}MB/" "$PG_CONF"
  sudo sed -i "s/^#\?wal_compression =.*/wal_compression = on/" "$PG_CONF" || echo "wal_compression = on" | sudo tee -a "$PG_CONF" >/dev/null
  sudo sed -i "s/^#\?max_connections =.*/max_connections = 100/" "$PG_CONF"
  grep -q '^random_page_cost' "$PG_CONF" && sudo sed -i 's/^random_page_cost =.*/random_page_cost = 1.1/' "$PG_CONF" || echo 'random_page_cost = 1.1' | sudo tee -a "$PG_CONF" >/dev/null
  grep -q '^effective_io_concurrency' "$PG_CONF" && sudo sed -i 's/^effective_io_concurrency =.*/effective_io_concurrency = 200/' "$PG_CONF" || echo 'effective_io_concurrency = 200' | sudo tee -a "$PG_CONF" >/dev/null

  sudo systemctl restart postgresql
  success "PostgreSQL tuned"
}

configure_clickhouse() {
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] || return 0
  info "Configuring ClickHouse"
  sudo mkdir -p /etc/clickhouse-server/users.d /etc/clickhouse-server/config.d
  sudo systemctl restart clickhouse-server || true
  success "ClickHouse ready"
}

generate_env() {
  info "Writing .env"
  cat > "$ENV_FILE" <<EOF
DOMAIN=${DOMAIN}
SUPERSET_ENV=production
SUPERSET_HOST=${SUPERSET_HOST}
SUPERSET_PORT=${SUPERSET_PORT}
SUPERSET_SECRET_KEY=${SUPERSET_SECRET_KEY}
GUEST_TOKEN_JWT_SECRET=${GUEST_TOKEN_JWT_SECRET}

POSTGRES_ENABLED=${POSTGRES_ENABLED}
POSTGRES_DB=${POSTGRES_DB}
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_HOST=${POSTGRES_HOST}
POSTGRES_PORT=${POSTGRES_PORT}
DATABASE_URL=postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=0
CELERY_BROKER_URL=redis://127.0.0.1:6379/0
CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/1
RESULTS_BACKEND_REDIS_URL=redis://127.0.0.1:6379/2

CACHE_DEFAULT_TIMEOUT=${CACHE_DEFAULT_TIMEOUT}
DATA_CACHE_TIMEOUT=${DATA_CACHE_TIMEOUT}
FILTER_STATE_CACHE_TIMEOUT=${FILTER_STATE_CACHE_TIMEOUT}
EXPLORE_FORM_DATA_CACHE_TIMEOUT=${EXPLORE_FORM_DATA_CACHE_TIMEOUT}
SQLLAB_ASYNC_TIME_LIMIT_SEC=${SQLLAB_ASYNC_TIME_LIMIT_SEC}

CLICKHOUSE_ENABLED=${CLICKHOUSE_ENABLED}
DUCKDB_ENABLED=${DUCKDB_ENABLED}

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
EOF
  success ".env written"
}

generate_superset_config() {
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
CACHE_DEFAULT_TIMEOUT = int(os.getenv("CACHE_DEFAULT_TIMEOUT", "300"))

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
  success "superset_config.py written"
}

create_systemd_units() {
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
  success "systemd units created"
}


configure_nginx() {
  print_info "Configuring Nginx reverse proxy..."

  local nginx_conf="/etc/nginx/sites-available/${APP_NAME}"
  sudo tee "${nginx_conf}" >/dev/null <<EOF
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
        proxy_buffer_size 16k;
        proxy_buffers 16 16k;
        proxy_busy_buffers_size 64k;

        proxy_read_timeout 300;
        proxy_send_timeout 300;
        proxy_connect_timeout 60;
    }
}
EOF

  sudo ln -sf "${nginx_conf}" "/etc/nginx/sites-enabled/${APP_NAME}"
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl enable --now nginx
  sudo systemctl reload nginx

  print_success "Nginx configured for HTTP"
}

configure_ssl() {
  if [ "${AUTO_SSL}" != "1" ]; then
    print_warning "Automatic SSL disabled; skipping Let's Encrypt provisioning"
    return
  fi

  if [ -z "${DOMAIN}" ]; then
    print_warning "DOMAIN not set; skipping Let's Encrypt provisioning"
    return
  fi

  if [ -z "${LETSENCRYPT_EMAIL}" ]; then
    if [ -n "${ADMIN_EMAIL:-}" ]; then
      LETSENCRYPT_EMAIL="${ADMIN_EMAIL}"
    else
      print_warning "LETSENCRYPT_EMAIL not set; skipping Let's Encrypt provisioning"
      return
    fi
  fi

  print_info "Requesting Let's Encrypt certificate for ${DOMAIN}..."

  local staging_arg=""
  if [ "${LETSENCRYPT_STAGING}" = "1" ]; then
    staging_arg="--staging"
    print_warning "Using Let's Encrypt staging environment"
  fi

  sudo systemctl enable --now nginx
  sudo nginx -t
  sudo systemctl reload nginx

  sudo certbot --nginx \
    --non-interactive \
    --agree-tos \
    --email "${LETSENCRYPT_EMAIL}" \
    -d "${DOMAIN}" \
    ${staging_arg} \
    --redirect || {
      print_warning "Let's Encrypt provisioning failed. Ensure DNS for ${DOMAIN} points to this server and ports 80/443 are open."
      return 1
    }

  ENABLE_HTTPS=1
  sudo systemctl reload nginx
  print_success "Let's Encrypt SSL configured for ${DOMAIN}"
}

initialize_superset() {
  info "Initializing Superset"
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
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
  success "Superset initialized"
}

start_services() {
  sudo systemctl restart superset-web superset-worker superset-beat nginx redis-server postgresql
  [[ "$CLICKHOUSE_ENABLED" == "1" ]] && sudo systemctl restart clickhouse-server || true
  success "Services started"
}

show_status() {
  echo "Resources: CPU=${CPU_CORES} RAM=${TOTAL_MEM_MB}MB DISK=${ROOT_DISK_GB}GB"
  echo "Gunicorn: workers=${GUNICORN_WORKERS} threads=${GUNICORN_THREADS} timeout=${GUNICORN_TIMEOUT}"
  echo "Celery: concurrency=${CELERY_CONCURRENCY}"
  echo "PostgreSQL: shared_buffers=${PG_SHARED_BUFFERS_MB}MB effective_cache=${PG_EFFECTIVE_CACHE_MB}MB work_mem=${PG_WORK_MEM_MB}MB"
  echo "Redis: maxmemory=${REDIS_MAXMEMORY_MB}MB"
  sudo systemctl --no-pager --full status superset-web superset-worker superset-beat nginx redis-server postgresql || true
}

install_all() {
  check_not_root
  require_domain
  calc_autotune
  setup_dirs
  install_system_packages
  setup_venv
  install_python_dependencies
  build_frontend_if_present
  configure_redis
  configure_postgresql
  configure_clickhouse
  generate_env
  generate_superset_config
  create_systemd_units
  configure_nginx
  configure_ssl
  initialize_superset
  start_services
  show_status
  cat <<EOF

Deployment complete.
Open: http://${DOMAIN}
Detected resources: ${CPU_CORES} CPU cores, ${TOTAL_MEM_MB}MB RAM, ${ROOT_DISK_GB}GB disk.
EOF
}

case "${1:-}" in
  install) install_all ;;
  status) calc_autotune; show_status ;;
  start) sudo systemctl start superset-web superset-worker superset-beat nginx redis-server postgresql ;;
  stop) sudo systemctl stop superset-web superset-worker superset-beat ;;
  restart) sudo systemctl restart superset-web superset-worker superset-beat nginx redis-server postgresql ;;
  *) echo "Usage: $0 {install|start|stop|restart|status}"; exit 1 ;;
esac

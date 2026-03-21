#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# deploy-supersets-local.sh
# Deploy Superset to a remote host using the current local source tree instead
# of cloning from GitHub on the remote host.
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE_DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-supersets.sh"

TARGET="${TARGET:-socaya@209.145.54.74}"
SSH_PORT="${SSH_PORT:-22}"
HOST_SRC_DIR="${HOST_SRC_DIR:-/tmp/superset-src-local}"
LOCAL_SRC_DIR="${LOCAL_SRC_DIR:-$REPO_ROOT}"

usage() {
  cat <<'EOF'
USAGE:
  ./deploy/deploy-supersets-local.sh deploy [same options as deploy-supersets.sh]
  ./deploy/deploy-supersets-local.sh update [same options as deploy-supersets.sh]
  ./deploy/deploy-supersets-local.sh restart [same options as deploy-supersets.sh]

Behavior:
  - For deploy/update, uploads the current local source tree to the remote host
    and then runs deploy-supersets.sh in SOURCE_MODE=local.
  - For restart/restart-gunicorn/restart-celery/cleanup/reset, delegates to the
    normal deploy script without uploading sources.

Env overrides:
  TARGET, SSH_PORT, HOST_SRC_DIR, LOCAL_SRC_DIR
EOF
}

log()  { printf '==> %s\n' "$*"; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
has_cmd() { command -v "$1" >/dev/null 2>&1; }

ssh_base() {
  ssh \
    -o BatchMode=no \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=6 \
    -p "$SSH_PORT" \
    "$TARGET" "$@"
}

quote_arg() {
  printf '%q' "$1"
}

validate_local_source() {
  [[ -d "$LOCAL_SRC_DIR" ]] || die "LOCAL_SRC_DIR not found: $LOCAL_SRC_DIR"
  [[ -f "$LOCAL_SRC_DIR/setup.py" || -f "$LOCAL_SRC_DIR/pyproject.toml" || -d "$LOCAL_SRC_DIR/superset-frontend" ]] \
    || die "LOCAL_SRC_DIR does not look like the Superset repository: $LOCAL_SRC_DIR"
}

show_local_revision() {
  if command -v git >/dev/null 2>&1 && git -C "$LOCAL_SRC_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    local rev dirty
    rev="$(git -C "$LOCAL_SRC_DIR" rev-parse --short HEAD 2>/dev/null || true)"
    dirty="$(git -C "$LOCAL_SRC_DIR" status --short 2>/dev/null | wc -l | tr -d ' ')"
    log "Deploying local source tree rev=${rev:-unknown} dirty_files=${dirty:-0}"
  else
    log "Deploying local source tree from $LOCAL_SRC_DIR"
  fi
}

prepare_remote_source_dir() {
  local q_host_src_dir
  q_host_src_dir="$(quote_arg "$HOST_SRC_DIR")"

  ssh_base "bash -lc 'set -euo pipefail; rm -rf $q_host_src_dir; mkdir -p $q_host_src_dir'"
}

sync_local_source_to_remote() {
  validate_local_source
  show_local_revision
  prepare_remote_source_dir

  log "Uploading local source tree to $TARGET:$HOST_SRC_DIR"

  tar -C "$LOCAL_SRC_DIR" \
    --exclude='.clickhouse' \
    --exclude='.pytest_cache' \
    --exclude='.mypy_cache' \
    --exclude='.ruff_cache' \
    --exclude='.venv' \
    --exclude='venv' \
    --exclude='node_modules' \
    --exclude='superset-frontend/node_modules' \
    --exclude='superset-frontend/.cache' \
    --exclude='superset-frontend/.temp_cache' \
    --exclude='superset-frontend/dist' \
    --exclude='superset/static/assets' \
    -cf - . \
  | ssh_base "tar -C $(quote_arg "$HOST_SRC_DIR") -xf -"

  ssh_base "bash -lc 'test -d $(quote_arg "$HOST_SRC_DIR/superset-frontend") && echo LOCAL_SOURCE_SYNC_OK'"
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    ''|-h|--help)
      usage
      exit 0
      ;;
  esac

  local passthrough=("$cmd")

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --target)
        TARGET="$2"
        passthrough+=("$1" "$2")
        shift 2
        ;;
      --port)
        SSH_PORT="$2"
        passthrough+=("$1" "$2")
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        passthrough+=("$1")
        shift
        ;;
    esac
  done

  has_cmd ssh || die "ssh not found"
  has_cmd tar || die "tar not found"
  [[ -x "$BASE_DEPLOY_SCRIPT" ]] || die "Missing base deploy script: $BASE_DEPLOY_SCRIPT"

  case "$cmd" in
    deploy|update)
      sync_local_source_to_remote
      ;;
    cleanup|reset|restart|restart-gunicorn|restart-celery)
      ;;
    *)
      die "Unsupported command: $cmd"
      ;;
  esac

  SOURCE_MODE=local HOST_SRC_DIR="$HOST_SRC_DIR" TARGET="$TARGET" SSH_PORT="$SSH_PORT" \
    "$BASE_DEPLOY_SCRIPT" "${passthrough[@]}"
}

main "$@"

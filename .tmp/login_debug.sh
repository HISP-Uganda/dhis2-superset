#!/bin/zsh
set -euo pipefail

COOKIE_FILE="$(mktemp /tmp/superset-cookie.XXXXXX)"
LOGIN_HTML="$(mktemp /tmp/superset-login.XXXXXX.html)"

curl -sS -c "$COOKIE_FILE" -m 10 http://127.0.0.1:8088/login/ > "$LOGIN_HTML"
CSRF_TOKEN="$(
  sed -n '/name="csrf_token"/{n;n;s/.*value="\([^"]*\)".*/\1/p;}' "$LOGIN_HTML"
)"

echo "COOKIE_FILE=$COOKIE_FILE"
echo "CSRF_TOKEN=$CSRF_TOKEN"

curl -sS -b "$COOKIE_FILE" -c "$COOKIE_FILE" -m 10 \
  -X POST http://127.0.0.1:8088/login/ \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrf_token=$CSRF_TOKEN" \
  --data-urlencode 'username=admin' \
  --data-urlencode 'password=Admin@2026' \
  --data-urlencode 'provider=db' \
  > /tmp/superset-login-post.html

curl -sS -b "$COOKIE_FILE" -m 10 http://127.0.0.1:8088/api/v1/me/

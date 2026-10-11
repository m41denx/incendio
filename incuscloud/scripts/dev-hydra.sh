#!/bin/sh
# In-memory Ory Hydra for development and integration tests.
#   IC_PUBLIC_URL (default https://127.0.0.1:7443) is where IncusCloud serves
#   its login, consent and device pages. Public :4444, admin :4445 (localhost).
set -eu
cd "$(dirname "$0")/.."
DEV="$PWD/.dev"
PUB="${IC_PUBLIC_URL:-https://127.0.0.1:7443}"
[ -s "$DEV/hydra-secret" ] || head -c 32 /dev/urandom | base64 | tr -d '\n=' > "$DEV/hydra-secret"
cat > "$DEV/hydra.yml" <<YML
dsn: memory
serve:
  public: { port: 4444, host: 0.0.0.0 }
  admin: { port: 4445, host: 127.0.0.1 }
  tls:
    enabled: true
    cert: { path: $DEV/tls/server.crt }
    key: { path: $DEV/tls/server.key }
urls:
  self: { issuer: https://127.0.0.1:4444/ }
  login: $PUB/auth/login
  consent: $PUB/auth/consent
  error: $PUB/auth/error
  logout: $PUB/auth/logout
  post_logout_redirect: $PUB/
  device:
    verification: $PUB/auth/device
    success: $PUB/auth/device/done
secrets:
  system: ["$(cat "$DEV/hydra-secret")"]
strategies:
  access_token: jwt
oauth2:
  allowed_top_level_claims: [email, name]
  mirror_top_level_claims: false
  client_credentials:
    default_grant_allowed_scope: true
log: { level: warn }
YML
exec "$DEV/bin/hydra" serve all -c "$DEV/hydra.yml"

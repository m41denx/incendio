#!/bin/sh
# In-memory Ory Hydra for development and integration tests.
#   IC_PUBLIC_URL (default https://127.0.0.1:7443) is where IncusCloud serves
#   its login, consent and device pages. Public :4444, admin :4445 (localhost).
#   IC_DEV_HOST (default 127.0.0.1) is the issuer's host: use an address your
#   dev clusters can reach (e.g. the incusbr address) to log in through them.
#   IC_OIDC_ISSUER overrides the issuer: set it to "$IC_PUBLIC_URL/" and
#   IncusCloud serves Hydra's public endpoints on its own origin.
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
  self: { issuer: ${IC_OIDC_ISSUER:-https://${IC_DEV_HOST:-127.0.0.1}:4444/} }
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

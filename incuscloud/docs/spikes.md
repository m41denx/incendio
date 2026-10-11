# P0 spike results

Throwaway code in `incuscloud/spikes/`. Local Incus 7.5.1, Ory Hydra v26.2.0.

## A. Incus accepts Hydra-issued tokens — YES

Setup: Hydra (`dsn: memory`, needs the **SQLite build**; TLS needs
`serve.tls.enabled: true` besides cert/key), `strategies.access_token: jwt`,
issuer `https://127.0.0.1:4444/`. Incus: `oidc.issuer`, `oidc.client.id=incus-cli`,
`oidc.audience=incuscloud`, `oidc.claim=sub`. incusd trusts the dev CA through
`SSL_CERT_DIR` (systemd drop-in), the CLI through the same env var.

| Case | Result |
|---|---|
| client_credentials JWT (`aud: incuscloud`, `sub: spike-svc`) | 200; `/1.0` says `auth: trusted`, `auth_user_method: oidc`, `auth_user_name: spike-svc` |
| Stock `incus remote add … --auth-type=oidc` (device flow) | Works. The CLI prints `URL: https://<issuer>/oauth2/device/verify?user_code=…`; Hydra forwards to our verification page with `device_challenge` **and** `user_code`; accept device → login → consent → done. `auth_user_name: spike-user` |
| Token for another audience | 401 `Provided OIDC token doesn't allow the configured audience` |
| Garbage / tampered signature | 401 (`invalid character…`, `invalid signature …`) |
| Expired token | 401 `token has expired` |
| No token | `/1.0` answers `auth: untrusted` (unchanged) |
| incusd restart with Hydra down | incusd **starts**; OIDC calls 401 `Failed calling OIDC discovery endpoint` until Hydra is back; TLS clients unaffected |
| Hydra down after discovery | Valid tokens keep working (signing keys cached) |

Consequences for the design:

- D1/D2/D3 hold. The consent step must set `grant_access_token_audience:
  ["incuscloud"]`; the CLI already sends `audience` on the device request
  (`client/incus_oidc.go`), from the `X-Incus-OIDC-audience` header.
- Hydra availability matters only for new logins and the first call after an
  incusd restart: HA Hydra (D8) but not a hard dependency like OpenFGA.
- Hydra's signing keys must persist (Postgres DSN in production); with
  `memory`, a Hydra restart invalidates every issued token.
- Incus must trust the issuer's certificate: in production the issuer has a
  public certificate, or enrolment installs the CA on every member (Firecloud
  can do this).

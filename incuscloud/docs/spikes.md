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

## B. Authenticating reverse proxy in Bun — YES, on node:https

`spikes/proxy.ts`, local Incus behind it, stock `incus` 7.5.1 CLI.

| Case | Result |
|---|---|
| REST through the proxy (bearer forwarded, no client cert) | Same answers as direct |
| `incus remote add https://<proxy>/clusters/local` (**path prefix**) | **Fails**: the Go client drops the path and requests `/1.0`, `/` at the root |
| `incus remote add https://local.<CLUSTER_DOMAIN>:9443` (**host routing**) + device login | Works; `incus list/query/exec/monitor/export/import/file push/pull` all work |
| Unauthenticated `/1.0` | Passed through; Incus answers `untrusted` and sends `X-Incus-OIDC-*` on 401, which the CLI needs to start a login |
| `incus exec` (websockets) | stdout, stdin and exit codes correct |
| `incus file push/pull` 1 GiB | Uses **`Upgrade: sftp`** (raw TCP after 101, not a websocket). Works with a raw relay; sha256 matches; ~6 s each way; proxy peak RSS 84 MiB |
| `incus export` 256 MB / `incus import` | Streamed both ways; peak RSS 90 MiB |
| `incus monitor` (events websocket) | Events arrive |
| Upgrade without a token | 401 from the proxy, nothing sent upstream |
| Upgrade with a bad token | Incus's 401 relayed as a normal response |

Findings that change the build:

1. **`Bun.serve` cannot be the gateway's front.** It only supports websocket
   upgrades; SFTP needs the raw socket after a 101. The gateway runs on
   `node:https` (`upgrade` event → raw byte relay), which Bun implements.
   Elysia (platform API) runs on its own listener or behind the same server.
2. **Bun's `fetch` cannot pin Incus certificates**: with
   `rejectUnauthorized: false` it never calls `checkServerIdentity` (both the
   right and a wrong fingerprint were accepted), and a self-signed leaf is not
   accepted as `ca`. Upstream connections use `node:https` with the SDK's
   `PinnedAgent` (fingerprint checked before any byte, verified: wrong pin is
   refused before the request is written).
3. **The CLI sends GET bodies** (`incus query` sends `""`, `Content-Length: 3`).
   Bun's `Request` drops GET bodies; forwarding the length without the bytes
   hangs Incus. On node:http the body is piped as-is, so no special case.
4. Websocket close codes 1005/1006 must not be forwarded (`ws` throws); with a
   raw relay there is nothing to translate.
5. **Host routing is the default for API clients** (D11): wildcard DNS
   `*.<CLUSTER_DOMAIN>` and a wildcard certificate. Path routing stays for the
   browser UI (Incendio derives `ROOT_PATH` from the path).

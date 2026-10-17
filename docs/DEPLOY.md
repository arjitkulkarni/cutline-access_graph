# Deploying CUTLINE for judging

The rules prefer a live deployment (or complete local setup instructions plus a working demo video). CUTLINE needs
three things running: FalkorDB, the API (FastAPI, `backend/`), and the console (Next.js, `frontend/`).

## 1. FalkorDB

* **FalkorDB Cloud** — copy host, port and password from the instance's *Connectivity* tab. The default user is
  `falkordb`. The Free tier has **no TLS** (`FALKORDB_TLS=false`), 100 MB RAM, **no persistence**, and is **stopped
  after 1 day without use** (deleted after 7). CUTLINE re-seeds the demo scenario automatically when its graph is
  missing, but a *stopped* instance takes the demo down — keep it in use (below) or self-host.
* **Self-hosted** — run `falkordb/falkordb-server:latest` next to the API (e.g. a second service on the same host).

Verify before deploying: `cd backend && .venv/Scripts/python -m scripts.falkordb_smoke`.

## 2. API (any Docker host: Railway, Render, Fly.io, a VM)

Build context `backend/` (it has a `Dockerfile`). Environment:

| Variable | Value |
|---|---|
| `FALKORDB_HOST` / `FALKORDB_PORT` | from FalkorDB Cloud (or the private address of a self-hosted FalkorDB) |
| `FALKORDB_USERNAME` / `FALKORDB_PASSWORD` | `falkordb` / your password (store as secrets) |
| `FALKORDB_GRAPH` | `cutline_dev` |
| `DEMO_MODE` | `true` (enables reset + live-mutation endpoints) |
| `BACKEND_PORT` | the port the platform routes to (often `8000` or `$PORT`) |
| `CORS_ORIGINS` | the console's public URL |
| `AUTHZ_ENGINE` / `OPA_URL` | `reference`, or `opa` + the URL of an `openpolicyagent/opa:1.21.2` service running `backend/policies/cutline_authz.rego` |
| `ANTHROPIC_API_KEY` | optional — enables the Claude Opus 5.5 agent mode |

Runtime verification sends real HTTP requests to `DEMO_API_BASE_URL`, which defaults to the API itself
(`http://127.0.0.1:$BACKEND_PORT`) — correct for a single container.

## 3. Console (Vercel, Netlify, or the same Docker host)

`frontend/` is a Next.js app. Set `CUTLINE_API_URL` to the API's public URL; the console proxies `/api/*` to it
server-side, so the browser never needs CORS.

## 4. Keep it alive until judging ends

Point an uptime monitor (UptimeRobot, a GitHub Actions `schedule`, or cron) at `GET <api>/api/health` every few
hours. The health check runs `PING` and `GRAPH.LIST` against FalkorDB, so the instance sees regular use.

## 5. Smoke-test the deployment

```bash
curl -s <api>/api/health                     # falkordb.connected must be true
curl -s -X POST <api>/demo/customers/export -H "X-Cutline-Principal: maya"     # 200 before the repair
```

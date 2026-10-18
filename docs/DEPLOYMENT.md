# Deploying CUTLINE

CUTLINE runs as three managed services: the **console** (Next.js, `frontend/`) on **Vercel**, the **API**
(FastAPI, `backend/`) on **Railway**, and the policy graphs on **FalkorDB Cloud**. When it is set up as described
here, nothing runs on a local machine: no localhost, WSL or Docker Compose.

```text
                       INTERNET (browser)
                              |  HTTPS
                              v
   VERCEL ─ static pages from the CDN (every route is prerendered)
            /api/*  ── rewrite at the CDN, server to server ──┐   (browser never calls Railway: no CORS needed)
                                                              |  HTTPS
                                                              v
   RAILWAY ─ FastAPI in Docker (uvicorn, 1 process, non-root, binds $PORT)
              │   runtime verification sends real HTTP requests to itself over 127.0.0.1:$PORT
              ├────────── redis protocol (TLS when the instance has it) ──>  FALKORDB CLOUD
              │                                                              policy graph, isolated candidate
              │                                                              graphs, evidence ledger graph
              └────────── HTTPS (optional, key stays on Railway) ───────────>  ANTHROPIC API (Claude Opus 5.5)
```

* **All state lives in FalkorDB** (active policy graph, candidate graphs, the ledger of repairs and events). The API
  is stateless and writes nothing to disk, so Railway redeploys and restarts lose nothing.
* **The browser only talks to Vercel.** `frontend/next.config.ts` rewrites `/api/*` to `CUTLINE_API_URL`. That URL
  is compiled in at build time, and no secret reaches the frontend.
* **Secrets stay on Railway:** the FalkorDB password and `ANTHROPIC_API_KEY`.

Contents: [Before you start](#0-before-you-start) · [A. FalkorDB Cloud](#part-a-falkordb-cloud) ·
[B. Railway](#part-b-railway-backend) · [C. Vercel](#part-c-vercel-frontend) · [D. Connect](#part-d-connect-everything) ·
[E. Troubleshooting](#part-e-troubleshooting) · [Environment variables](#6-environment-variables) ·
[Local vs production](#7-local-development-vs-production) · [Security and limits](#8-security-posture-and-known-limits)

---

## 0. Before you start

* Accounts: GitHub (the repository), FalkorDB Cloud, Railway (a trial or a plan with usage credit), Vercel (Hobby works).
* Order matters: **FalkorDB, then Railway, then Vercel, then go back to Railway for the CORS origin.** Each step needs
  a URL from the one before.
* **Pick regions close together.** Planning runs many small graph queries, so latency between the API and FalkorDB
  dominates. With the FalkorDB instance in `ap-south-1` (Mumbai), deploy the Railway service in
  **Southeast Asia (Singapore)**; a US region adds roughly 200 ms to every round trip.
* Deadline note: the hackathon closes on **2026-10-18 23:59 IST**. Keep the services and the uptime ping (D.8) running
  until judging ends.

## Part A: FalkorDB Cloud

1. **Create or select an instance** at FalkorDB Cloud. The existing CUTLINE instance (`ap-south-1`, engine 4.22) works
   as is. Check which tier you are on:
   * **Free:** no TLS, ~100 MB, **no persistence**, **stopped after 1 day without use** (deleted after 7). Fine for a
     demo: CUTLINE re-seeds the scenario automatically when its graph is missing. The evidence ledger, though, does not
     survive an instance restart, and a stopped instance takes the demo down. Keep it in use (D.8).
   * **Paid tiers:** pick one with **persistence** if evidence must survive instance restarts, and enable **TLS when
     creating the instance** (it can't be added later).
2. **Persistent storage:** nothing to configure in CUTLINE. Persistence is a property of the FalkorDB tier.
3. **Credentials:** from the instance's *Connectivity* tab copy the **host**, **port** and **password**. The default
   user is `falkordb`.
4. **TLS:** `FALKORDB_TLS=true` only if the instance was created with TLS (Free: `false`). With TLS on, the API also
   checks that the certificate matches the host (`FALKORDB_TLS_CHECK_HOSTNAME=true`). FalkorDB Cloud certificates
   chain to public CAs, so `FALKORDB_TLS_CA_CERT` stays empty unless you run your own CA.
5. **Graph name:** use a **dedicated name for production**, e.g. `FALKORDB_GRAPH=cutline_prod`. It must not be a name
   your local runs use (`cutline_dev`) or a recording uses. Two deployments sharing one graph would see each other's
   resets and challenges.
6. **Validate connectivity** from your machine before deploying. The smoke test is non-destructive: it creates a
   uniquely named scratch graph, checks every Cypher shape CUTLINE uses, and deletes only that graph.
   ```bash
   cd backend
   .venv/Scripts/python -m scripts.falkordb_smoke          # Linux/macOS: .venv/bin/python; reads backend/.env
   ```
7. **Data migration: none needed, and none recommended.** On first start with `DEMO_MODE=true`, the API seeds the
   Customer Operations scenario into `FALKORDB_GRAPH` if that graph does not exist. It creates `<graph>__ledger` on the
   first write. Nothing is overwritten: an existing graph is used as is. Evidence from a local graph is *not* worth
   copying, because it references that graph's own candidate graphs and revisions. Starting fresh is the honest
   state for a new deployment.

## Part B: Railway (backend)

1. Sign in at railway.com → **New Project** → **Deploy from GitHub repo** → pick `cutline-access_graph`. Grant Railway
   access to the repository if asked.
2. Open the new service → **Settings**:

   | Setting | Value |
   |---|---|
   | Source → **Root Directory** | `/backend` |
   | Build → **Builder** | Dockerfile (detected automatically from `backend/Dockerfile`) |
   | Build → **Watch Paths** | `/backend/**`. Patterns are matched from the repository root even with a root directory, so docs and frontend commits don't redeploy the API. |
   | Deploy → **Region** | Southeast Asia (Singapore), or whichever is nearest your FalkorDB region |
   | Deploy → **Healthcheck Path** | `/health` |
   | Deploy → **Restart Policy** | On Failure |
   | Deploy → **Serverless / App Sleeping** | Off (a sleeping API would make the console show "unreachable") |
   | Deploy → Teardown → **Draining Seconds** | `25`. Uvicorn finishes in-flight requests for up to 20 s after SIGTERM (or set the variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=25`). |
   | Custom start command | leave empty: the Dockerfile `CMD` is correct |

   Railway no longer reads `railway.json` for new services (config-as-code is deprecated), so these settings live in
   the dashboard. Nothing Railway-specific is committed.
3. **Variables** (service → Variables → *Raw Editor* works). Use real values; never commit them:
   ```env
   ENVIRONMENT=production
   FALKORDB_HOST=<host from Connectivity tab>
   FALKORDB_PORT=<port>
   FALKORDB_USERNAME=falkordb
   FALKORDB_PASSWORD=<password>
   FALKORDB_TLS=false
   FALKORDB_GRAPH=cutline_prod
   DEMO_MODE=true
   AUTHZ_ENGINE=reference
   CORS_ORIGINS=https://<your-project>.vercel.app
   # optional, enables the Claude agent mode:
   ANTHROPIC_API_KEY=<key>
   ```
   Leave **`PORT` and `BACKEND_PORT` unset.** Railway injects `PORT`, and the container binds it and exports
   `BACKEND_PORT` to match. If they disagreed, runtime verification would call the wrong port and every check would fail.
   You will know the Vercel URL only after Part C: set `CORS_ORIGINS` then (D.2). The console doesn't need it to work.
4. **Deploy:** Railway builds `backend/Dockerfile` (Python 3.11, runtime dependencies only, non-root user) and starts
   `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. A deployment goes live once `/health` returns 2xx. Railway
   checks only at deploy time, not continuously.
5. **Public HTTPS domain:** Settings → Networking → **Generate Domain**. If Railway asks for a port, use the one printed
   in the deploy log (`Uvicorn running on http://0.0.0.0:<port>`). You get `https://<service>.up.railway.app`.
6. **Test the API and read the logs:**
   ```bash
   API=https://<service>.up.railway.app
   curl -s $API/health                     # {"status":"ok",...} liveness, touches no dependency
   curl -s $API/ready                      # 200 + latency when FalkorDB answers, 503 otherwise
   curl -s $API/api/health                 # falkordb.connected must be true; the host shows as [hidden]
   curl -s -X POST $API/demo/customers/export -H "X-Cutline-Principal: maya" -o /dev/null -w "%{http_code}\n"  # 200 before a repair
   ```
   The deploy logs should show `CUTLINE 0.1.0 starting (environment=production, ...)` and then
   `FalkorDB ready; active graph 'cutline_prod'`. On the Free tier you will also see `FALKORDB_TLS is off: ...`
   (see [section 8](#8-security-posture-and-known-limits)). Interactive API docs are at `$API/docs`.

### Optional: OPA as the enforcement engine

The default `AUTHZ_ENGINE=reference` is a fully independent fixpoint engine and needs nothing else. To show Open Policy
Agent instead, add a second service from the same repository with **Root Directory** `/backend/policies` (it builds
`backend/policies/Dockerfile`: `openpolicyagent/opa:1.21.2` serving `cutline_authz.rego` on `:8181`), with no public
domain and Watch Paths `/backend/policies/**`. Then on the API service set `AUTHZ_ENGINE=opa` and
`OPA_URL=http://<opa-service-name>.railway.internal:8181` (private networking). `/api/health` reports
`authz_engine.name = "opa"` once it answers. This is a second billed service; skip it if credit is tight.

## Part C: Vercel (frontend)

1. Sign in at vercel.com → **Add New… → Project** → **Import** the GitHub repository.
2. **Root Directory:** `frontend`. **Framework Preset:** Next.js (detected). Keep the default build command
   (`npm run build`) and output; the install uses `package-lock.json`.
3. Settings → Build and Deployment → **Node.js Version:** `24.x` (what the project is built and tested with).
4. **Environment Variables:**

   | Name | Value | Environments |
   |---|---|---|
   | `CUTLINE_API_URL` | `https://<service>.up.railway.app` (origin only: no path, no trailing `/api`) | Production, and Preview if you use previews |

   It is read **at build time** and compiled into the `/api` rewrite, so changing it requires a **redeploy**. It is
   intentionally not `NEXT_PUBLIC_`: no browser code needs it. On Vercel the build **fails on purpose** when it is
   missing, not `https://`, or has a path. That way a console can never silently ship pointing at localhost.
5. **Deploy.** Every route (`/`, `/overview`, `/graph`, `/repair`, `/evidence`, `/tests`) is prerendered and served
   from the CDN, and `/api/*` is a CDN rewrite, so the console runs no serverless functions. Refreshing or deep-linking
   any route works. Unknown paths render the app's 404 page.
6. **Verify:** open `https://<project>.vercel.app/` (landing page; renders even without the API) and `/overview`
   (console). In DevTools → Network, requests go to `https://<project>.vercel.app/api/...` and never to Railway or
   localhost. If the API can't be reached, the console shows "The CUTLINE API is not reachable" with deployment
   guidance, not a crash.

Preview deployments sit behind Vercel Authentication by default; the production domain is public. Share the
production URL with judges.

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

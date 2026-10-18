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

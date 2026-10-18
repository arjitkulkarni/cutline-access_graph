# CUTLINE — Build Flow & Status

> Living log of what has been built, in what order, and what remains.
> Updated at every milestone so work can stop at any point (the user asked to stop at ~40% weekly usage)
> and resume from here. Last update: 2026-10-17 (night IST, deployment prep).

Legend: ✅ done · 🔄 in progress · ⏳ not started · ⚠️ needs user action

---

## 0. Discovery (✅)

- Workspace `D:\CUTLINE` was empty → greenfield build. Windows: no Docker, no WSL; local Redis 3.0 on :6379 is NOT
  FalkorDB (CUTLINE detects and reports this).
- FalkorDB Cloud `r-6jissuruar…ap-south-1…:56731` (engine **4.22**, Free tier, no TLS). Credentials live only in the
  gitignored `backend/.env`.
- On Windows consoles run Python scripts with `PYTHONIOENCODING=utf-8` (output contains `→`).
- ⚠️ Never edit source files with PowerShell `Get-Content`/`Set-Content` (cp1252 round-trip corrupts UTF-8 — it
  happened once to `repair_planner.py`; `tests/test_source_hygiene.py` now guards against it).

## 1. Research (✅) — FalkorDB dialect verified from v6.0.2/v4.22.1 sources, hackathon rules, MCP v2, OPA, Next.js stack

## 2. Architecture & contracts (✅) — `docs/API_CONTRACT.md`; scenario adds **DSAR Bot** so `support_safe` is the
honest unique repair.

## 3–6. Backend (✅ verified on real FalkorDB Cloud)

- FalkorDB schema/seed/queries, bounded multi-path discovery, planner (single cuts, minimal hitting sets, scoped-role
  migration) with every candidate on its own `GRAPH.COPY` (retry on "could not fork", replay fallback), independent
  enforcement point (reference engine or OPA 1.21.2), real HTTP runtime verification, human approval, atomic
  revision-guarded apply, post-apply verification, stale by revision **or hash drift**, auto re-seed when the Free-tier
  instance loses its graphs, evidence ledger graph, regression export (JSON + executable pytest).
- **Real FalkorDB:** smoke script ALL PASS · `pytest -m falkordb` 3/3 pass (full lifecycle).

## 7. Frontend — Next.js 16 console (✅)

- Overview, Access Graph (React Flow), Repair Studio (Before/After, candidates with counterexamples, runtime table,
  apply dialog, contract parse, agent trace, live challenge), Evidence, Regression Tests; disconnected/unreachable states.
- `npm run build` + `tsc` clean. `frontend/scripts/e2e-live.mjs` **passes the full demo against the real API on real
  FalkorDB** with zero API/browser errors (screenshots in `frontend/qa-screenshots-live/`).
- Fixed after live testing: agent run lost on studio remount (now in the mutation cache), truncated "must keep" cards,
  half-hidden "Generate safe repair" CTA (sticky), truncated "Support (safe) · New" node, plural grammar.
- `frontend/scripts/screenshot.mjs` = fixture-based visual QA (fixtures are hand-written, QA only).
- ⏳ Optional further design-review round (the original multi-round review workflow was interrupted).
- ✅ "Graphite & Copper" redesign of the console (see `docs/UI_REDESIGN.md`).
- ✅ 2026-10-17: console re-themed to the landing page's **black, bone, blood red** (user request: one palette on all
  pages). Token remap in `globals.css` (+ 2–4 px radii), new red-slash logo/favicon, graph colours in `graph.css` and
  `GraphMarkers.tsx`. Meaning kept: red = action/danger, bone = selected/new/in-progress, sage = verified, amber =
  stale/modified; migration removals are red (the cut). Verified on all 5 routes against the live API; build clean.

## 7b. Landing page at `/` (✅ 2026-10-16 night)

- **Routing change:** `/` is now the public landing page; the console Overview moved to **`/overview`**. Updated the
  sidebar (logo now links home), command search, 404 link, and the QA scripts (`e2e-live.mjs`, `screenshot.mjs`,
  `qa-redesign.mjs` now open `/overview`). `AppShell` renders `/` bare (no sidebar, no backend gate), so the landing
  page works even when the API is down.
- **Redesign 2026-10-17 — black, bone, blood red** (user request; later the same day the console adopted it too).
  Red means only "dangerous route" and "the cut"; bone white is what survives. Signature motion = the incision:
  CSS curtain split by a red line, hero headline sliced by a blade (`Blade` in `primitives.tsx`), red rules that cut
  across each chapter, a scroll-scrubbed slice through the giant footer wordmark.
- Code: `frontend/src/components/landing/` — content in `data.ts` (every number traced to README / benchmarks /
  the live run). `Story.tsx` = hero + sticky three.js stage + 4 scroll steps (Trace → Reject → Repair → Verify);
  `GraphScene.ts` is a state-driven scene (channels eased per step, both obvious fixes acted out with markers,
  sparks on the cut, bloom via EffectComposer). Chapters 02–08: Isolation (GRAPH.COPY tiles struck through),
  Proof (scanned 12-request log), Protocol, Live challenge, Why FalkorDB (unplug → CRT power-down + 503s), Track 01
  (typing agent terminal), Results (rolling-digit counters). `landing.css` sits inside `@layer components`.
- Gotchas fixed: EffectComposer double-encodes the clear colour (#050505 rendered #262626) → compensated in
  `GraphScene.ts`; `vector-effect: non-scaling-stroke` + `pathLength` dashes broke the blades → `Blade` draws in px.
- Verified: `tsc` + ESLint + `next build` clean; Playwright at 1440 / 820 / 390 px: no horizontal overflow, no
  console/page errors; stage background measured rgb(5,5,5) = page; reduced motion = static repaired scene, curtain
  skipped, no hydration errors.
- Known, pre-existing (dev only): every console route logs Next 16's "Could not validate … instant navigation" because
  `BackendGate` renders a skeleton while it checks `/api/health`. Fix later with `export const instant = false` per
  page or by rendering the segment during the check.

## 8. MCP server + agent (Track 01) (✅ deterministic path verified live · ⚠️ LLM path needs ANTHROPIC_API_KEY)

- 11 typed tools (no raw Cypher), MCP SDK v2 server, `POST /api/agent/investigate` (Claude Opus 5.5 tool loop when a
  key is set; labelled deterministic run otherwise). Agent can never approve/apply.

## 9. Tests (✅ 72/72 passed with real FalkorDB Cloud + OPA enabled; 67 run by default, 5 are env-gated)

`CUTLINE_TEST_FALKORDB=1 CUTLINE_TEST_OPA_URL=http://127.0.0.1:8181 pytest` (OPA serving `backend/policies/cutline_authz.rego`).

## 9b. Benchmarks (✅ on FalkorDB Cloud) — `docs/benchmarks.md`: **10/10 correct, safe repairs 7/7 vs greedy 2/7**,
detection 11/12 vs direct-grant 7/12, median plan 1.46 s.

## 10. Docs & ops

- ✅ `README.md` (judge-oriented, includes exact Cypher and real-FalkorDB results), `docs/DEPLOYMENT.md`,
  `docker-compose.yml` (FalkorDB + OPA + API + console), `backend/Dockerfile`, `frontend/Dockerfile`, `.env.example`.
- ✅ 2026-10-18: README rewritten against hackathon Rule 10 (submission table at the top, graph data model incl.
  ledger/candidate graphs, every Cypher statement + FalkorDB commands, planner algorithm, complete local setup:
  Docker Compose or native Windows/macOS/Linux with FalkorDB Docker or Cloud, verify-with-curl, config, troubleshooting).
  Step 3 curls checked against the live API. ⚠️ Still to fill: demo-video link, live-deployment link, team
  contribution note (marked `<!-- TODO -->` in README.md).
- 🔄 `docs/CUTLINE_Winning_Blueprint.pdf` (analysis/rating/plan PDF — being authored by a background agent).

## 11. Production deployment prep (✅ code · ⚠️ dashboards need the user) — 2026-10-17

Target: console on **Vercel** (root `frontend/`), API on **Railway** (Docker, root `/backend`), graphs on **FalkorDB
Cloud**. Guide: `docs/DEPLOYMENT.md` (dashboard settings, env tables, troubleshooting, security limits).

- Backend: `ENVIRONMENT=production` (generic 500s, FalkorDB host shown as `[hidden]`, no default CORS origins);
  `/health` liveness + `/ready` readiness; `Cache-Control: no-store` on every response; CORS from `CORS_ORIGINS` +
  optional `CORS_ORIGIN_REGEX`; lifespan shutdown closes FalkorDB + verifier clients; app logging to stdout;
  FalkorDB TLS hostname check + optional CA PEM, keepalive, 30 s idle health check; LLM agent: 100 s time budget
  (Vercel's CDN waits 120 s), typed Claude API errors → readable narrative, one manual retry, 30 runs/h + 2 at once.
- Dockerfile: Python 3.11 (the tested interpreter), runtime deps only (`requirements-dev.txt` adds pytest), non-root,
  binds `$PORT` and exports `BACKEND_PORT` to match (runtime verification calls itself on that port), `exec` for
  SIGTERM. `backend/.dockerignore`; optional `backend/policies/Dockerfile` for an OPA service.
- Frontend: Vercel build fails without an `https://` `CUTLINE_API_URL`; disconnected screen gives deployment advice
  (not the local start command) for a remote target; 504 → "took too long" message; `frontend/.env.example`.
- No `railway.json`: Railway stopped reading config-as-code for new services (deprecated).
- Verified: 83 backend tests pass (16 new in `tests/test_deployment.py`); real FalkorDB `-m falkordb` 3/3; smoke ALL
  PASS; image simulation (clean 3.11 venv, only `app/`+`policies/`, Dockerfile CMD, `PORT=8123`, production) ran
  the full plan → verify 12/12 → approve → apply → challenge → stale lifecycle on FalkorDB Cloud (scratch graph
  `cutline_deploycheck`, deleted afterwards); `e2e-live.mjs` passed through `next start` against it; tsc, ESLint,
  `next build` clean. Not run: an actual `docker build` (no Docker on this machine), Railway/Vercel deploys.

---

## Remaining (in order)

1. ✅ Public repo: https://github.com/arjitkulkarni/cutline-access_graph (2026-10-17, 66 commits on `main`, pushed in
   9 batches). `backend/.env` is not committed; `deliverables/` (unrelated Digithon promo workspace) is excluded
   locally via `.git/info/exclude`. The benchmark report masks the FalkorDB Cloud hostname.
2. ⚠️ Deploy (code ready, see §11 and `docs/DEPLOYMENT.md`): Railway API + Vercel console + FalkorDB Cloud; needs
   the user's accounts. Keep the Free instance warm with an uptime ping on `/ready` (it stops after 1 idle day and
   has no persistence; CUTLINE re-seeds automatically).
3. ⚠️ Optional: set `ANTHROPIC_API_KEY` and run the agent once in LLM mode (show the Claude tool trace in the video).
4. ✅ Demo video (2026-10-17): `deliverables/cutline_demo/hackathon_4k/CUTLINE_Hackathon_4K.mp4` — 4:20, 3840×2160
   30 fps, 17 chapters, narration + burned-in captions, `.srt` and `Script_and_Chapters.md` alongside. Pipeline:
   `narrate.py` (edge-tts) → `capture.cjs` (Playwright, isolated graph `cutline_recording_4k_20261017`) → `render.py`
   (ffmpeg/nvenc). render.py re-renders a clip only when its command/overlay/inputs change (`*-final.key`).
   Synthetic demo graph; agent shown in deterministic mode. Still ⚠️: upload (YouTube/Drive) and link it in the form.
   🔄 Superseding it (user request, 2026-10-17 night): an animation-led 4K film in `deliverables/cutline_demo/motion/`.
   - `capture/vclock.cjs`: deterministic 4K page capture (virtual clock for performance.now/timers/rAF, CDP-frozen
     animation timeline + per-frame WAAPI seek, scripted cursor, 3840×2160 PNG → NVENC). `capture/landing.cjs` films the
     landing (3D story, isolation, proof, protocol, FalkorDB unplug, agent terminal, results, closing wordmark);
     `capture/app.cjs` films the real console against an isolated API on :8100 (graph `cutline_film_20261017`,
     production console on :3100). Clips + marks/boxes in `public/footage/`.
   - Remotion edit (`src/`): incision transitions, camera moves/callouts on footage, word-timed captions, ledger
     overlay, pytest panel, end card; synthesized sound bed + SFX (`audio.py`); `finish.py` masters to -14 LUFS with
     chapters + SRT. Narration = the hackathon_4k voice track. Target ≈ 4:20.
   - Gotchas: each failed capture run leaves plans in the recording graph's ledger (sidebar shows "Stale" and later
     revisions) → always capture on a fresh graph; CDP screenshots need the device-metrics override on their own
     session; never give OffthreadVideo a negative start; Remotion's frame extraction needs
     `--offthreadvideo-video-threads=16` (default 2 starves it); render detached (`render.cmd`) so a session restart
     does not kill it.
   - 2026-10-18: all footage captured (fresh graph, one clean run: r2 → r3 applied, r4 stale, agent 1-edit repair
     verified), every scene QA'd from stills; full 4K render running (`render.cmd` → `out/film_raw.mp4`, ~45 min),
     then `finish.py` → `out/CUTLINE_Graph_Hacks_4K.mp4`. Local servers (3000/3100/8000/8100) are stopped.
5. ⚠️ Fill the AI-disclosure / team-contribution note in README; submit (form opens **Oct 17 01:03 IST**, closes
   **Oct 18 23:59 IST**; editable until the deadline; name Track 01).
6. Optional: blog post (AirPods side prize), star the FalkorDB repo (keyboard giveaway).

## How to run (local)

```
cd backend && .venv\Scripts\python -m uvicorn app.main:app --port 8000      # uses backend/.env (FalkorDB Cloud)
cd frontend && npm run build && npm start      # landing http://localhost:3000 · console http://localhost:3000/overview
```

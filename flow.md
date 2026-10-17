# CUTLINE — Build Flow & Status

> Living log of what has been built, in what order, and what remains.
> Updated at every milestone so work can stop at any point (the user asked to stop at ~40% weekly usage)
> and resume from here. Last update: 2026-10-16 (evening IST).

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

- ✅ `README.md` (judge-oriented, includes exact Cypher and real-FalkorDB results), `docs/DEPLOY.md`,
  `docker-compose.yml` (FalkorDB + OPA + API + console), `backend/Dockerfile`, `frontend/Dockerfile`, `.env.example`.
- 🔄 `docs/CUTLINE_Winning_Blueprint.pdf` (analysis/rating/plan PDF — being authored by a background agent).

---

## Remaining (in order)

1. ⚠️ **Team decision:** `git init`, first commit, create the public GitHub repo (rule 10). Do not commit `backend/.env`.
2. ⚠️ Deploy (see `docs/DEPLOY.md`): API container + console, FalkorDB Cloud; keep the Free instance warm with an
   uptime ping on `/api/health` (it stops after 1 idle day and has no persistence; CUTLINE re-seeds automatically).
3. ⚠️ Optional: set `ANTHROPIC_API_KEY` and run the agent once in LLM mode (show the Claude tool trace in the video).
4. ⚠️ Record the 3-minute demo video (script in README → "Three-minute demo").
5. ⚠️ Fill the AI-disclosure / team-contribution note in README; submit (form opens **Oct 17 01:03 IST**, closes
   **Oct 18 23:59 IST**; editable until the deadline; name Track 01).
6. Optional: blog post (AirPods side prize), star the FalkorDB repo (keyboard giveaway).

## How to run (local)

```
cd backend && .venv\Scripts\python -m uvicorn app.main:app --port 8000      # uses backend/.env (FalkorDB Cloud)
cd frontend && npm run build && npm start      # landing http://localhost:3000 · console http://localhost:3000/overview
```

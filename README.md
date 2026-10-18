# CUTLINE

**Repair excessive permissions without breaking the work that still has to happen, and prove the repair worked.**

CUTLINE is a graph-native permission-repair agent built on **FalkorDB**. You tell it which capability must disappear
and which business workflows must survive. FalkorDB traces every route to the dangerous capability. A deterministic
planner generates structural repairs and tests each one on its own **isolated FalkorDB graph**, rejecting the unsafe
ones with counterexamples. The chosen repair is proven with **real HTTP requests** against a running application,
applied only after a human approves it (one revision-guarded, atomic Cypher write), and shipped with executable
regression tests. If the policy changes underneath it, the evidence goes **stale**: CUTLINE refuses to apply it and
plans again.

## The problem

```
POST /demo/customers/export      X-Cutline-Principal: maya      →  200 OK · 1,000 customer records
```

Maya is a support agent. She should look up orders and generate reports, and never bulk-export customer data. She can
export anyway, through **two independent inherited paths**:

```
maya → Support → Shared Ops    → export_customers      (Shared Ops is also how Finance exports)
maya → Support → Export Helper → export_customers      (Export Helper was attached so the DSAR bot could export)
```

Every obvious fix breaks something:

| Obvious fix | What FalkorDB proves on an isolated copy of the graph |
|---|---|
| Revoke `export_customers` from Shared Ops | ❌ Felix loses export → **Finance close breaks**; Maya still exports via Export Helper |
| Detach Shared Ops from Support | ❌ `maya → support → export_helper → export_customers` is still open |
| Detach Export Helper from Support | ❌ `maya → support → shared_ops → export_customers` is still open |
| Detach both bundles from Support | ❌ DSAR Bot loses export → **legally required DSAR fulfilment breaks** |
| **Create `support_safe` (view_orders, generate_reports), move Maya and Noah onto it** | ✅ every guardrail holds, every workflow survives, no new access |

A human reviewer has to hold all of these routes and dependencies in their head at once. CUTLINE makes the graph do it.

## How CUTLINE works

1. **Discover.** FalkorDB returns every bounded access path (`[:INHERITS*0..6]`) for each guardrail violation.
2. **Contract.** Guardrails (`must_deny`) and workflows (`must_allow`) are nodes in the graph. An operator can add
   constraints in natural language; they are parsed into a typed contract and confirmed before use.
3. **Plan.** Bounded, deterministic candidate generation (single cuts, minimal hitting sets, scoped-role migration).
   Each candidate is applied to its own `GRAPH.COPY` of the policy and re-checked by FalkorDB. A failure carries a
   witness path or the broken workflow. The cheapest passing candidate under a transparent cost model wins.
4. **Verify.** Real requests to the synthetic Customer Ops API, decided by an **independent enforcement point**
   (a reference closure engine, or Open Policy Agent) that reads the candidate graph. The graph prediction and the
   runtime decision must agree on every check.
5. **Approve and apply.** A human approves. The edits land in **one atomic Cypher statement** guarded by a
   compare-and-set on the policy revision. Post-apply verification re-runs against the live policy.
6. **Stay honest.** Evidence is bound to a revision *and* a content hash. A live mutation (or an out-of-band edit in
   FalkorDB Browser) makes it stale, apply is refused, and the agent plans again. Regression tests (JSON and pytest)
   pin every decision.

## Architecture

```mermaid
flowchart LR
  user([Operator]) --> console["Next.js console<br/>frontend/"]
  claude(["Claude Code / any MCP client"]) --> mcp["MCP server<br/>app.mcp_server"]
  console -- "/api proxy" --> api["FastAPI<br/>backend/app"]
  mcp --> svc
  api --> svc["Analyzer · Planner · Verifier · Agent"]
  svc -- "Cypher" --> active[("FalkorDB<br/>cutline_dev<br/>active policy")]
  svc -- "GRAPH.COPY + edits" --> cand[("FalkorDB<br/>cutline_dev__cand__*<br/>candidate copies")]
  svc -- "evidence + memory" --> ledger[("FalkorDB<br/>cutline_dev__ledger")]
  svc -- "real HTTP" --> demo["Synthetic Customer Ops API<br/>/demo/*"]
  demo --> pdp["Enforcement point<br/>reference engine or OPA"]
  pdp -- "one-hop relations only" --> active
  pdp -- "one-hop relations only" --> cand
```

| Layer | Technology |
|---|---|
| Graph database | FalkorDB (FalkorDB Cloud engine 4.22, or the `falkordb/falkordb` Docker image), `falkordb` Python client 1.8 |
| API | Python 3.11, FastAPI, Pydantic v2, uvicorn |
| Agent | Claude API (Claude Opus 5.5) tool-use loop, optional; deterministic fallback without a key |
| Tools protocol | MCP Python SDK v2 (stdio or streamable HTTP) |
| Independent enforcement | built-in reference closure engine, or Open Policy Agent 1.21 with [backend/policies/cutline_authz.rego](backend/policies/cutline_authz.rego) |
| Console | Next.js 16, React 19, TanStack Query, React Flow (graph view), three.js (landing page) |

## Track 01 fit

| Track 01 focus | What CUTLINE does |
|---|---|
| Multi-hop reasoning | Variable-length traversals (`ASSIGNED_TO → INHERITS*0..6 → GRANTS`) find every route, not just direct grants |
| Graph queries and algorithms as agent tools | 11 typed tools (trace, check, plan, verify, recall …) wrap the Cypher below; the model never writes Cypher |
| Tool selection through MCP | The same tools are served by an MCP server; Claude chooses which to call |
| Actions based on what the graph shows | Repairs are generated from the witness paths and applied as graph edits after approval |
| Explainable results | Every rejected candidate carries a counterexample path or the workflow it breaks; every pass carries runtime evidence |

---

## Graph data model

CUTLINE keeps three kinds of graph in FalkorDB. Names derive from `FALKORDB_GRAPH` (default `cutline_dev`).

| Graph | Name | Holds | Lifetime |
|---|---|---|---|
| Active policy | `cutline_dev` | Users, roles, capabilities, resources, workflows, guardrails, policy revision | Seeded on first start |
| Candidate | `cutline_dev__cand__<repair_id>__<n>` | A `GRAPH.COPY` of the active policy with one candidate repair applied | Created per candidate, deleted after use |
| Ledger | `cutline_dev__ledger` | Repairs, the revisions they are based on, and an activity log (agent memory across sessions) | Created on first write |

### Policy graph

```mermaid
graph LR
  maya((Maya)) -- ASSIGNED_TO --> support[Support]
  noah((Noah)) -- ASSIGNED_TO --> support
  bot((DSAR Bot)) -- ASSIGNED_TO --> support
  felix((Felix)) -- ASSIGNED_TO --> finance[Finance]
  support -- INHERITS --> shared[Shared Ops]
  support -- INHERITS --> helper[Export Helper]
  finance -- INHERITS --> shared
  support -- GRANTS --> vo{{view_orders}}
  support -- GRANTS --> gr{{generate_reports}}
  shared -- GRANTS --> ex{{export_customers}}
  helper -- GRANTS --> ex
  ex -- ACTS_ON --> cr[(customer_records)]
  dsar[/DSAR fulfilment/] -- REQUIRES --> ex
  close[/Finance close/] -- REQUIRES --> ex
  guard{{no_support_bulk_export}} -- FORBIDS --> ex
  guard -- APPLIES_TO --> maya
  guard -- APPLIES_TO --> noah
```

**Node labels**

| Label | Properties | Meaning |
|---|---|---|
| `User` | `id`, `name`, `department`, `principal_type` (`human` / `service`), `title` | A principal: a person or a service account |
| `Role` | `id`, `name`, `description`, `origin` (`idp` / `cutline` / `challenge`) | A permission bundle; `origin = 'cutline'` marks roles CUTLINE created |
| `Capability` | `id`, `name`, `sensitivity`, `method`, `endpoint` | An operation on the application (maps to an HTTP endpoint) |
| `Resource` | `id`, `name`, `classification` | Data a capability acts on |
| `Workflow` | `id`, `name`, `criticality`, `description` | A business process that must keep working (`must_allow`) |
| `Guardrail` | `id`, `description` | A security rule that must hold (`must_deny`) |
| `Policy` | `id = 'active'`, `revision`, `updated_at`, `scenario`, `last_change` | The revision boundary every plan and write is checked against |

**Relationships** (direction matters: `A INHERITS B` means A receives B's grants)

| Relationship | From → To | Meaning |
|---|---|---|
| `ASSIGNED_TO` | `User → Role` | The principal holds the role |
| `INHERITS` | `Role → Role` | The role receives everything the parent role grants (transitively) |
| `GRANTS` | `Role → Capability` | The role allows the operation |
| `ACTS_ON` | `Capability → Resource` | The operation reads or writes this data |
| `REQUIRES` | `Workflow → Capability` | The workflow needs this capability |
| `PERFORMS` | `User → Workflow` | The principal carries out the workflow |
| `FORBIDS` | `Guardrail → Capability` | The guardrail bans this capability … |
| `APPLIES_TO` | `Guardrail → User` | … for these principals |

**Effective access** is derived, never stored: a user can perform a capability if a path
`(User)-[:ASSIGNED_TO]->(:Role)-[:INHERITS*0..6]->(:Role)-[:GRANTS]->(Capability)` exists. The **contract** is also
derived from the graph: each `(Guardrail)-[:APPLIES_TO]->(User)` × `(Guardrail)-[:FORBIDS]->(Capability)` pair must be
unreachable, and each `(User)-[:PERFORMS]->(Workflow)-[:REQUIRES]->(Capability)` pair must stay reachable.

**Indexes and constraints.** A range index on `id` for every label, plus `GRAPH.CONSTRAINT` unique constraints on
`User.id`, `Role.id` and `Capability.id`.

**Seeded dataset.** The *Customer Operations* scenario ([backend/app/db/scenario.py](backend/app/db/scenario.py)):
19 nodes (4 users, 4 roles, 3 capabilities, 3 resources, 3 workflows, 1 guardrail, 1 policy) and 25 relationships.
All data is synthetic (Rule 6); no real people or customer records are loaded. The ten benchmark scenarios (this one
plus nine variations) live in [backend/benchmarks/scenarios.py](backend/benchmarks/scenarios.py).

### Ledger graph (evidence and agent memory)

```
(:Repair {id, doc, status, created_at, updated_at})-[:BASED_ON]->(:Revision {n, hash})
(:Event  {id, ts, kind, summary, revision, repair_id})-[:AT]->(:Revision {n})
```

Every plan is pinned to the revision and content hash it was computed on. The agent's `recall_history` tool reads this
graph, which is how it remembers earlier repairs across sessions.

# CUTLINE · Graphite & Copper redesign

> **Palette update, 2026-10-17:** the whole site (landing page and console) now uses **black, bone and blood red**.
> The tokens in `frontend/src/app/globals.css` were remapped: `accent` is blood red (primary actions, focus, active
> place); `red`/`risk` are the danger red; sage stays for required/verified, amber for stale; corners are 2–4 px.
> Graph selection and new structure are bone and "modified" is amber, so red always means a forbidden route. Where
> this document says copper, read red. Layout, interaction and validation notes below still apply.

Implemented directly in the existing Next.js application. The FastAPI/FalkorDB integration, repair planning, verification, operator approval, exports, and revision guards remain in use. No application data or security results were replaced with fixtures.

## Design and interaction changes

- Centralized graphite surfaces, ivory typography, copper selection/action states, sage verification, muted risk red, borders, radii, and motion tokens. Retained the locally bundled Geist Sans and Geist Mono fonts.
- Refined the CUTLINE mark, workspace identity, navigation, connection footer, policy context, page headers, and shared controls across Overview, Access Graph, Repair Studio, Evidence, and Regression Tests.
- Added workspace search (`Ctrl/⌘ K`) for pages and actual policy entities, plus collapsible desktop navigation. Graph search remains available with `/`; `Escape` clears selection outside dialogs and text fields.
- Graph nodes now show entity type beneath their label. Unrelated nodes remain readable. Proven capability paths extend through the graph's actual `ACTS_ON` relationships to resources.
- Required paths use heavier solid sage lines; unwanted paths use dashed muted red; permitted paths use dotted neutral lines. Arrowheads, the legend, inspector labels, and badges complement the colors.
- Selection runs a finite, sequential 800 ms traversal. Explicit route selection retraces that route. Idle canvases do not run continuous marker loops. Hover emphasizes incident relationships.
- Moved graph search and status into stable toolbar rows, with a separate legend, zoom percentage, fit controls, and navigation hints. Narrow canvases retain readable zoom and support panning.
- The inspector has a clear identity header, vertical role paths, readable metadata, animated property disclosure, and synchronized selection. Below 1400 px it uses a native modal drawer with focus trapping and Escape dismissal.
- Policy changes preserve the viewport. Comparisons show added, removed, and modified entities/relationships using two snapshots actually observed in the current browser session. Removed relationships remain as dashed ghosts until the comparison is dismissed.
- Improved small-screen plan selection, comparison-canvas sizing, evidence details, test filters, and horizontally scrollable verification tables. Screen-reader-only content stays inside its scroll container.

## Implementation map

| Area | Main files under `frontend/` |
| --- | --- |
| Tokens, typography, motion | `src/app/globals.css`, `src/app/layout.tsx`, `src/app/icon.svg`, `src/lib/motion.ts` |
| Shell and navigation | `src/components/shell/Sidebar.tsx`, `CommandSearch.tsx`, `PageHeader.tsx`, `Logo.tsx` |
| Graph workspace | `src/components/screens/AccessGraphScreen.tsx`, `src/components/graph/PermissionGraph.tsx`, `GraphNodes.tsx`, `RelationEdge.tsx`, `GraphMarkers.tsx`, `GraphToolbar.tsx`, `graph.css` |
| Graph presentation model | `src/lib/graph/view.ts`, `layout.ts`, `changes.ts` |
| Inspector | `src/components/inspector/InspectorPanel.tsx`, `parts.tsx`, `RouteList.tsx`, `EntityInspectors.tsx`, `CapabilityInspector.tsx` |
| Supporting screens | `OverviewScreen.tsx`, `RepairStudioScreen.tsx`, `EvidenceScreen.tsx`, `RegressionTestsScreen.tsx` in `src/components/screens/` |
| Shared/workflow components | `ui/button-styles.ts`, `ui/Toast.tsx`, `ui/Dialog.tsx`, `ui/Segmented.tsx`, `common/Entity.tsx`, `repair/PlanPicker.tsx`, `repair/BeforeAfterComparison.tsx`, `repair/ContractPanel.tsx`, `repair/CandidateList.tsx`, `repair/VerificationTable.tsx`, `repair/ApplyDialog.tsx`, `evidence/EvidencePanel.tsx`, `tests/RegressionTestList.tsx`, `src/lib/hooks.ts` |
| Browser QA | `scripts/screenshot.mjs`, `scripts/qa-redesign.mjs`, `package.json` |

No new dependencies. The existing deterministic layered layout was retained instead of adding ELK: it already handles inheritance depth, crossing reduction, routing slots, and shared before/after layouts. Graph renderers remain memoized, layout calculations are memoized, and traversal clocks restart on meaningful selection/path changes rather than hover.

## Validation

- Production build, ESLint, and TypeScript checks pass.
- Backend regression suite: **67 passed, 5 skipped**. The skipped integration tests require their opt-in external services/settings.
- Existing fixture-backed browser workflow suite passed and captured **23 screenshots**: graph investigation, repair generation, before/after, runtime verification, approval dialog, contract parsing, agent log, evidence, regression tests, stale-policy behavior, and disconnected/error states.
- Focused redesign browser suite: **15 checks passed**, no browser runtime errors. Covers keyboard search/navigation, graph overlays, complete resource highlighting, finite animation, drawer behavior, six viewport widths, supporting-screen overflow, revision additions/removals, viewport preservation, and reduced motion.
- Visually inspected desktop, laptop, tablet, and mobile captures. Tested graph widths: **1920, 1440, 1280, 1024, 768, and 390 px**. Supporting screens were checked at 1440 and 390 px.
- Read-only browser smoke test against the connected real API passed on all five routes: **39 API requests, zero API failures, zero browser runtime errors**. No policy reset, approval, or application was performed by this smoke test.

Screenshots and machine-readable results are in `frontend/qa-screenshots/` and `frontend/qa-screenshots-redesign/`. Fixtures are used only through browser request interception in the QA scripts; production components do not import them.

To reproduce the browser checks on a dedicated local server after building:

```powershell
Set-Location D:\CUTLINE\frontend
npm run build
$env:BASE_URL = 'http://localhost:3101'
$env:QA_PORT = '3101'
npm run qa:screenshots
npm run qa:redesign
```

The harness starts and stops its own production server if the selected port is unused. On this Windows environment, build workers and browser/local HTTP tests required execution outside the restricted socket sandbox. An initial Turbopack worker failure was resolved by clearing generated `.next` output and rebuilding.

## Boundaries

- Revision comparisons are session-local observations, not a server-provided historical revision browser. Reloading starts a new comparison baseline.
- Mobile graph navigation deliberately uses pan/search rather than shrinking the entire graph to illegible text; dense verification tables scroll horizontally.
- The browser workflow tests use recorded API fixtures. Real-API validation was read-only; applying a repair remains subject to the existing explicit human approval workflow.
- No Git repository was present at `D:\CUTLINE`, so no commit or Git diff was created.

Design references reviewed: [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh), [Railway projects](https://docs.railway.com/projects), [GitKraken's commit graph](https://www.gitkraken.com/features/commit-graph), [Geist](https://vercel.com/geist/introduction), [React Flow edge animation](https://reactflow.dev/examples/edges/animating-edges), and [Motion](https://motion.dev/).

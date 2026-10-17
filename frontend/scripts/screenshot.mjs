#!/usr/bin/env node
/**
 * Visual QA for the CUTLINE console.
 *
 *   npm run build && npm run qa:screenshots
 *
 * - Drives the INSTALLED Microsoft Edge through Playwright (`channel: "msedge"`); no browser download.
 * - Uses a running console at BASE_URL (default http://localhost:3000). If nothing answers there, it starts
 *   `next start` on QA_PORT (default 3100) from the existing production build and stops it afterwards.
 * - Every /api/** request is intercepted with page.route() and answered from qa-fixtures/*.json through a
 *   small state machine (plan → verify → live challenge). The application code never imports fixtures.
 * - Writes 1440×900 PNGs to qa-screenshots/.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(ROOT, "qa-fixtures");
const OUT = path.join(ROOT, "qa-screenshots");
const VIEWPORT = { width: 1440, height: 900 };
const QA_PORT = Number(process.env.QA_PORT ?? 3100);
let BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

// ------------------------------------------------------------------------------------ fixtures
const fixtureCache = new Map();
function fx(name) {
  if (!fixtureCache.has(name)) fixtureCache.set(name, JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")));
  return structuredClone(fixtureCache.get(name));
}

// Fixture timestamps are authored around 2026-10-16T01:00Z; shift them so relative times read naturally.
const ANCHOR = Date.parse("2026-10-16T01:00:00.000Z");
const OFFSET = Date.now() - ANCHOR;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function shift(v) {
  if (typeof v === "string" && ISO.test(v)) return new Date(Date.parse(v) + OFFSET).toISOString();
  if (Array.isArray(v)) return v.map(shift);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shift(x)]));
  return v;
}

// ------------------------------------------------------------------------------- fake backend
const state = { rev: "r3", plan: null, health: "ok", approved: false };

function currentPlan() {
  if (!state.plan) return null;
  const plan = fx(state.plan === "proposed" ? "repair-proposed.json" : "repair-verified.json");
  if (state.approved) {
    plan.status = "APPROVED";
    plan.approval = { approved_by: "QA Operator", approved_at: "2026-10-16T00:30:00.000Z", note: null, edits_hash: "sha256:7be2c0d14f9a" };
  }
  if (state.rev === "r4") {
    plan.stale = true;
    plan.current_revision = fx("revision-r4.json");
  }
  return plan;
}

function activity() {
  const events = [...fx("activity-base.json")];
  if (state.plan) events.push(fx("activity-planned.json"));
  if (state.plan === "verified") events.push(fx("activity-verified.json"));
  if (state.rev === "r4") events.push(fx("activity-mutated.json"));
  return events.reverse();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function handleApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.replace(/^\/api/, "");
  const method = req.method();
  const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(shift(body)) });
  const notFound = (what) => json(404, { error: { code: "NOT_FOUND", message: `${what} does not exist.` } });

  if (p === "/health") {
    if (state.health === "unreachable") return route.fulfill({ status: 500, contentType: "text/plain", body: "Internal Server Error" });
    return json(200, fx(state.health === "down" ? "health-disconnected.json" : "health.json"));
  }
  if (p === "/scenarios") return json(200, fx("scenarios.json"));
  if (p === "/policy/revision") return json(200, fx(`revision-${state.rev}.json`));
  if (p === "/graph") return json(200, fx(`graph-${state.rev}.json`));
  if (p === "/risks") return json(200, fx(`risks-${state.rev}.json`));
  if (p === "/contract") return json(200, fx("contract.json"));
  if (p === "/contract/parse" && method === "POST") {
    await sleep(350);
    return json(200, fx("contract-parse.json"));
  }
  if (p === "/access/paths" && method === "POST") {
    const body = req.postDataJSON();
    const hit = fx(`paths-${state.rev}.json`)[`${body.principal}:${body.capability}`];
    return hit ? json(200, hit) : notFound(`Pair ${body.principal}:${body.capability}`);
  }
  if (p === "/activity") return json(200, { events: activity() });
  if (p === "/repairs" && method === "GET") return json(200, { repairs: state.plan ? [currentPlan()] : [] });
  if (p === "/repairs/plan" && method === "POST") {
    await sleep(900);
    state.plan = "proposed";
    return json(200, currentPlan());
  }
  const repairMatch = /^\/repairs\/([^/]+)(\/(verify|approve|apply))?$/.exec(p);
  if (repairMatch) {
    const plan = currentPlan();
    if (!plan || plan.id !== repairMatch[1]) return notFound(`Repair plan '${repairMatch[1]}'`);
    const action = repairMatch[3];
    if (!action) return json(200, plan);
    if (action === "verify") {
      await sleep(1600);
      state.plan = "verified";
      return json(200, currentPlan());
    }
    if (action === "approve") {
      state.approved = true;
      return json(200, currentPlan());
    }
    return json(409, { error: { code: "INVALID_STATE", message: "QA fixtures do not simulate apply." } });
  }
  const evidenceMatch = /^\/evidence\/([^/]+)$/.exec(p);
  if (evidenceMatch) {
    if (!state.plan) return notFound(`Repair plan '${evidenceMatch[1]}'`);
    return json(200, fx(state.rev === "r4" ? "evidence-stale.json" : "evidence-verified.json"));
  }
  const suiteMatch = /^\/regression-tests\/([^/]+)(\/export)?$/.exec(p);
  if (suiteMatch) {
    if (!state.plan) return notFound(`Repair plan '${suiteMatch[1]}'`);
    if (suiteMatch[2]) {
      const format = url.searchParams.get("format");
      if (format === "pytest") {
        return route.fulfill({
          status: 200,
          contentType: "text/x-python",
          headers: { "Content-Disposition": `attachment; filename="${suiteMatch[1]}_regression_test.py"` },
          body: fs.readFileSync(path.join(FIXTURES, "regression-export.py"), "utf8"),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "Content-Disposition": `attachment; filename="${suiteMatch[1]}_regression.json"` },
        body: JSON.stringify(fx("regression-suite.json"), null, 2),
      });
    }
    const suite = fx("regression-suite.json");
    if (state.plan === "proposed") for (const c of suite.cases) c.last_result = null;
    return json(200, suite);
  }
  if (p === "/demo/mutate-policy" && method === "POST") {
    await sleep(400);
    state.rev = "r4";
    return json(200, fx("mutate-response.json"));
  }
  if (p === "/agent/investigate" && method === "POST") {
    await sleep(500);
    return json(200, fx("agent-run.json"));
  }
  return notFound(`Route ${method} ${p}`);
}

// ------------------------------------------------------------------------------------- server
async function reachable(base) {
  try {
    const res = await fetch(base, { redirect: "manual" });
    return res.status > 0;
  } catch {
    return false;
  }
}

/** Something else (another project's dev server) may own the default port — check it is CUTLINE. */
async function isCutlineConsole(base) {
  try {
    const res = await fetch(`${base}/`, { redirect: "follow" });
    const html = await res.text();
    return html.includes("CUTLINE");
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await isCutlineConsole(BASE_URL)) {
    console.log(`Using running console at ${BASE_URL}`);
    return null;
  }
  if (await reachable(BASE_URL)) console.log(`${BASE_URL} is not the CUTLINE console; starting a dedicated server.`);
  if (!fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    throw new Error(`No console at ${BASE_URL} and no production build. Run "npm run build" (or start "npm run dev") first.`);
  }
  BASE_URL = `http://localhost:${QA_PORT}`;
  console.log(`Starting next start on ${BASE_URL} …`);
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(QA_PORT)], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NODE_ENV: "production" },
  });
  child.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 60; i++) {
    if (await reachable(BASE_URL)) return child;
    await sleep(500);
  }
  child.kill();
  throw new Error("next start did not become ready in 30 s");
}

// ---------------------------------------------------------------------------------------- run
async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await ensureServer();
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: "dark", acceptDownloads: true });
  await context.route("**/api/**", handleApi);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  const shots = [];
  const shot = async (name, opts = {}) => {
    await page.waitForTimeout(opts.settle ?? 450);
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: Boolean(opts.fullPage) });
    shots.push(file);
    console.log("  ✓", path.relative(ROOT, file));
  };
  const go = async (route, waitFor) => {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
    if (waitFor) await page.getByText(waitFor, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
  };

  try {
    // 1 — Overview, nothing planned yet
    await go("/overview", "Risky access");
    await shot("01-overview");

    // 2 — Access Graph, unwanted routes visible before any selection
    await go("/graph", "Start from what must be protected");
    await page.locator(".react-flow__node-entity").first().waitFor();
    await shot("02-access-graph", { settle: 700 });

    // 3 — select export_customers by clicking the node, then trace route A
    await page.locator('.react-flow__node[data-id="export_customers"]').click();
    await page.getByText("Unwanted access").first().waitFor();
    await page.getByText("Must keep access").first().waitFor();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /Shared Ops/ }).filter({ visible: true }).first().click();
    await shot("03-access-graph-export-customers", { settle: 1150 });

    // 4 — a principal selected (effective access, color classes)
    await go("/graph?focus=maya", "Effective access");
    await shot("04-access-graph-principal", { settle: 900 });

    // 5 — Repair Studio before planning
    await go("/repair", "No repair plan yet");
    await shot("05-repair-studio-empty", { settle: 700 });

    // 6 — generate a plan (preview only) from the studio
    await page.getByRole("button", { name: "Generate repair" }).filter({ visible: true }).first().click();
    await page.waitForURL(/plan=rp_/, { timeout: 15_000 });
    await page.getByText("Migration plan").first().waitFor();
    await shot("06-repair-plan-before", { settle: 900 });

    // 7 — After view on the same layout
    await page.getByRole("radio", { name: "After" }).click();
    await shot("07-repair-plan-after", { settle: 900 });

    // 8 — candidates + verification region, verification running
    await page.getByRole("button", { name: "Run verification" }).filter({ visible: true }).first().click();
    await page.getByText("Why not a simpler fix?").scrollIntoViewIfNeeded();
    await shot("08-repair-verification-running", { settle: 350 });

    // 9 — verification passed
    await page.getByText(/Verified · 12\/12/).first().waitFor({ timeout: 15_000 });
    await page.getByText("Why not a simpler fix?").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: /Revoke export_customers from Shared Ops/ }).click();
    await shot("09-repair-verification-passed", { settle: 900 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot("10-repair-verified-top", { settle: 600 });
    await shot("10b-repair-verified-full", { fullPage: true, settle: 300 });

    // 11 — apply confirmation (not submitted)
    await page.getByRole("button", { name: "Apply verified migration" }).click();
    await page.getByLabel(/Approved by/).fill("Dana Whitfield");
    await page.getByLabel(/I reviewed these 7 edits/).check();
    await shot("11-apply-dialog", { settle: 500 });
    await page.keyboard.press("Escape");

    // 12 — contract refinement (parse → review)
    await page.getByRole("button", { name: /^Contract/ }).click();
    await page.getByLabel("Refine with a requirement").fill("Support agents must not export customer data, but keep order lookup and reporting before the quarterly audit");
    await page.getByRole("button", { name: "Parse" }).click();
    await page.getByText("Parsed contract").waitFor();
    await page.getByText("Parsed contract").scrollIntoViewIfNeeded();
    await shot("12-contract-parse", { settle: 500 });

    // 13 — agent run log
    await page.getByRole("button", { name: "Run investigation" }).click();
    await page.getByText("get_policy_revision").waitFor();
    await page.getByText("get_policy_revision").scrollIntoViewIfNeeded();
    await shot("13-agent-run", { settle: 500 });

    // 14 — Evidence (current)
    await go("/evidence", "Verification results");
    await shot("14-evidence", { settle: 600 });

    // 15 — Regression tests
    await go("/tests", "test_maya_cannot_export_customers");
    await shot("15-regression-tests", { settle: 700 });

    // 16 — Overview with a verified plan
    await go("/overview", "Recent policy activity");
    await shot("16-overview-verified", { settle: 600 });

    // 17 — live challenge from the Repair Studio
    await go("/repair", "Migration plan");
    await page.getByRole("button", { name: "Live challenge" }).click();
    await page.getByRole("button", { name: "Introduce path" }).click();
    await page.getByText(/Evidence is stale/).first().waitFor({ timeout: 15_000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot("17-repair-studio-stale", { settle: 900 });

    // 18 — Evidence after the policy moved
    await go("/evidence", "Evidence is stale");
    await shot("18-evidence-stale", { settle: 600 });

    // 19 — Access Graph at r4: a third unwanted route
    await go("/graph?focus=export_customers", "Unwanted access");
    await shot("19-access-graph-r4", { settle: 1000 });

    // 20 — Regression tests flagged as protecting an older revision
    await go("/tests", "test_maya_cannot_export_customers");
    await shot("20-regression-tests-stale", { settle: 600 });

    // 21 — FalkorDB disconnected (health says connected=false)
    state.health = "down";
    await go("/overview", "FalkorDB is not connected");
    await shot("21-falkordb-disconnected", { settle: 500 });

    // 22 — API unreachable (proxy answers a plain-text 500)
    state.health = "unreachable";
    await go("/graph", "The CUTLINE API is not reachable");
    await shot("22-api-unreachable", { settle: 500 });
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  console.log(`\n${shots.length} screenshots in ${path.relative(process.cwd(), OUT) || OUT}`);
  const relevant = consoleErrors.filter((t) => !/Failed to load resource/.test(t));
  if (relevant.length) {
    console.log(`\nBrowser console errors (${relevant.length}):`);
    for (const t of relevant.slice(0, 20)) console.log("  •", t.slice(0, 300));
  }
}

export { state, handleApi, ensureServer };
export const getBaseUrl = () => BASE_URL;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Live end-to-end check of the CUTLINE console against the REAL API (no request interception).
 *
 *   # API on :8000 (FalkorDB behind it), console built and served on :3000
 *   node scripts/e2e-live.mjs
 *
 * Walks the demo: overview → access graph → generate repair → verify → approve & apply → evidence →
 * regression tests → live challenge (stale) → agent run. Fails on any /api response >= 500, any
 * unexpected 4xx, or any browser error. Screenshots go to qa-screenshots-live/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "qa-screenshots-live");
const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API = (process.env.CUTLINE_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await fetch(`${API}/api/scenarios/customer-ops/reset`, { method: "POST" });

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (err) => problems.push(`pageerror: ${err}`));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource/.test(msg.text())) problems.push(`console: ${msg.text()}`);
  });
  page.on("response", async (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith("/api/")) return;
    const expected409 = res.status() === 409 && /\/(apply|verify|approve)$/.test(url.pathname);
    if (res.status() >= 400 && !expected409) {
      let body = "";
      try { body = (await res.text()).slice(0, 300); } catch {}
      problems.push(`${res.request().method()} ${url.pathname} → ${res.status()} ${body}`);
    }
  });

  const shot = async (name, settle = 600) => {
    await page.waitForTimeout(settle);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log("  ✓", name);
  };
  const go = async (route, text) => {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
    if (text) await page.getByText(text, { exact: false }).first().waitFor({ timeout: 30_000 });
  };
  const click = (role, name) => page.getByRole(role, { name }).filter({ visible: true }).first().click();

  try {
    await go("/overview", "Risky access");
    await shot("01-overview");

    await go("/graph", null);
    await page.locator('.react-flow__node[data-id="export_customers"]').waitFor({ timeout: 30_000 });
    await page.locator('.react-flow__node[data-id="export_customers"]').click();
    await page.getByText("Unwanted access").first().waitFor({ timeout: 30_000 });
    await shot("02-graph-export-customers", 1000);

    await go("/repair", null);
    await click("button", /^Generate (new )?repair$/);
    await page.waitForURL(/plan=rp_/, { timeout: 120_000 });
    await page.getByText("Migration plan").first().waitFor({ timeout: 60_000 });
    await shot("03-plan-before", 900);
    await page.getByRole("radio", { name: "After" }).click();
    await shot("04-plan-after", 900);

    await click("button", "Run verification");
    await page.getByText(/Verified · \d+\/\d+ runtime checks passed/).first().waitFor({ timeout: 120_000 });
    await shot("05-verified", 900);

    await click("button", "Apply verified migration");
    await page.getByLabel(/Approved by/).fill("Live E2E");
    await page.getByLabel(/I reviewed these/).check();
    await page.getByRole("button", { name: /Approve and apply|Apply migration/ }).click();
    await page.getByText(/Applied|post-apply/i).first().waitFor({ timeout: 120_000 });
    await shot("06-applied", 1200);

    await go("/evidence", "Verification");
    await shot("07-evidence", 800);
    await go("/tests", "test_maya_cannot_export_customers");
    await shot("08-regression-tests", 800);

    await go("/repair", null);
    await click("button", "Live challenge");
    await click("button", "Introduce path");
    await page.getByText(/stale/i).first().waitFor({ timeout: 60_000 });
    await shot("09-stale-after-challenge", 1000);

    await go("/graph?focus=export_customers", "Unwanted access");
    await shot("10-graph-new-path", 1000);

    await go("/repair", null);
    await page.getByText("Migration plan").first().waitFor({ timeout: 60_000 }); // let the studio settle first
    await page.waitForTimeout(800);
    const agent = page.getByRole("button", { name: /Run investigation|Run again/ }).filter({ visible: true }).first();
    if (await agent.count()) {
      await agent.click();
      await page.getByText("propose_repair").first().waitFor({ timeout: 180_000 });
      await shot("11-agent-run", 1000);
    } else {
      problems.push("agent panel button not found");
    }
  } catch (err) {
    problems.push(`flow aborted: ${err.message.split("\n")[0]}`);
    await page.screenshot({ path: path.join(OUT, "zz-failure.png") }).catch(() => {});
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log("  •", p);
    process.exit(1);
  }
  console.log("\nLive end-to-end flow passed with no API errors or browser errors.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

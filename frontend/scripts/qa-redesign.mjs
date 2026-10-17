/** Focused interaction and responsive regression checks, using test-only API fixtures. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { state, handleApi, ensureServer, getBaseUrl } from "./screenshot.mjs";

const out = path.resolve("qa-screenshots-redesign");
fs.mkdirSync(out, { recursive: true });
const server = await ensureServer();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
await context.route("**/api/**", handleApi);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const checks = [];
const pass = (name) => { checks.push(name); console.log(`  ✓ ${name}`); };
const go = async (route) => {
  await page.goto(`${getBaseUrl()}${route}`, { waitUntil: "networkidle" });
};
const shot = async (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
const noOverflow = async (name) => {
  const dims = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(dims.scroll <= dims.width + 1, `${name}: horizontal overflow ${dims.scroll} > ${dims.width}`);
};

try {
  await go("/graph?focus=felix");
  await page.getByText("Effective access", { exact: true }).waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.react-flow__node[data-id="customer_records"] .cl-node.is-dimmed').count(), 0);
  assert.ok(await page.locator('.react-flow__node[data-id="customer_records"] .cl-node--required').count());
  assert.ok((await page.locator('.cl-signal').evaluateAll((els) => els.every((e) => Number(e.style.opacity) === 0))));
  pass("Principal route includes its resource; traversal stops after selection");

  await page.getByRole("switch", { name: "Derived paths" }).click();
  assert.equal(await page.locator(".cl-lane").count(), 0);
  await page.getByRole("switch", { name: "Derived paths" }).click();
  pass("Derived path switch controls overlays");

  await page.keyboard.press("/");
  await page.getByRole("combobox", { name: "Search principals, roles and capabilities" }).fill("Maya");
  await page.keyboard.press("Enter");
  await page.waitForURL(/focus=maya/);
  await page.waitForTimeout(500);
  assert.ok(await page.locator(".cl-edge.tone-unwanted").count());
  await page.getByRole("button", { name: /Stored properties/ }).click();
  await page.getByText("department", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForURL((url) => !url.searchParams.has("focus"));
  pass("Keyboard graph search, selection, properties, and Escape");

  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search pages and policy entities" }).fill("Evidence");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/evidence$/);
  await page.getByRole("heading", { name: "Evidence", exact: true }).waitFor();
  pass("Global command search navigates pages");

  await page.getByRole("button", { name: "Collapse navigation", exact: true }).click();
  assert.equal(Math.round((await page.getByRole("complementary", { name: "Primary" }).boundingBox()).width), 60);
  await page.getByRole("link", { name: "Access Graph", exact: true }).click();
  await page.getByRole("heading", { name: "Access Graph" }).waitFor();
  await page.getByRole("button", { name: "Expand navigation", exact: true }).click();
  pass("Collapsed navigation remains operable");

  for (const width of [1920, 1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await go(width >= 1400 ? "/graph?focus=felix" : "/graph");
    await page.locator(".react-flow__node-entity").first().waitFor();
    await page.waitForTimeout(600);
    await noOverflow(`graph ${width}`);
    const canvas = await page.getByRole("region", { name: "Authorization graph canvas" }).boundingBox();
    const controls = await page.getByRole("button", { name: "Fit graph to view" }).boundingBox();
    assert.ok(controls.x >= canvas.x && controls.x + controls.width <= canvas.x + canvas.width + 1);
    assert.ok(controls.y + controls.height <= canvas.y + canvas.height + 1, `Controls clipped at ${width}`);
    await shot(`graph-${width}`);
    if (width < 1400) {
      await page.getByRole("button", { name: "Open inspector" }).click();
      await page.getByRole("dialog", { name: "Inspector" }).waitFor();
      await page.getByRole("dialog").getByRole("button", { name: /Export customers/ }).click();
      await page.getByText("Unwanted access", { exact: true }).waitFor();
      await shot(`inspector-${width}`);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog[open]").count(), 0);
    }
    pass(`Graph and inspector layout at ${width}px`);
  }

  state.plan = "verified";
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/overview", "/repair", "/evidence", "/tests"]) {
      await go(route);
      await page.waitForTimeout(500);
      await noOverflow(`${route} ${width}`);
      await shot(`${route.slice(1) || "overview"}-${width}`);
    }
    pass(`All supporting screens fit ${width}px`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await go("/graph?focus=felix");
  await page.getByText("Effective access", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.waitForTimeout(500);
  const before = await page.locator(".react-flow__viewport").getAttribute("style");
  state.rev = "r4";
  await page.getByText("Since r3", { exact: true }).waitFor({ timeout: 22000 });
  assert.equal(await page.locator(".react-flow__viewport").getAttribute("style"), before);
  assert.ok(await page.locator(".cl-node.is-added").count());
  await shot("revision-added");
  state.rev = "r3";
  await page.getByText("Since r4", { exact: true }).waitFor({ timeout: 22000 });
  assert.ok(await page.locator(".cl-node.is-removed").count());
  await shot("revision-removed");
  await page.getByRole("button", { name: "Dismiss revision comparison" }).click();
  assert.equal(await page.locator(".cl-node.is-removed").count(), 0);
  pass("Revision additions/removals use observed snapshots and preserve viewport");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await go("/graph?focus=maya");
  await page.getByText("Effective access", { exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".cl-signal").count(), 0);
  pass("Reduced motion disables traversal markers");
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify({ checks, browserErrors: errors }, null, 2));
  console.log(`${checks.length} checks passed; no browser runtime errors.`);
} catch (error) {
  await shot("failure");
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (server) server.kill();
}

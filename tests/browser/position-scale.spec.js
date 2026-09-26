import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  serializeCatalog,
  parseCatalog,
  BUILTIN_PRESETS,
} from "../../src/core/catalog.js";
import { fourFigureLibrary } from "../fixtures/fourFigureLibrary.js";
import { ready } from "./helpers/ready.js";
import { openLibraryFilters } from "./helpers/library.js";
const positions = async (page) => {
  await page.getByRole("button", { name: "Positions", exact: true }).click();
  await openLibraryFilters(page);
  await page.getByLabel("Support status").selectOption("interaction-3d");
  await expect(page.locator(".preset-card")).toHaveCount(24);
};
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
let browserErrors = [];
test.beforeEach(async ({ context }) => {
  browserErrors = [];
  const watch = (page) =>
    page.on("pageerror", (error) => browserErrors.push(error.message));
  context.pages().forEach(watch);
  context.on("page", watch);
});
test.afterEach(() => expect(browserErrors).toEqual([]));

test("all 1283 position IDs are reachable through bounded pages without changing or solving the active scene", async ({
  page,
}) => {
  const errors = [],
    requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("catalog/sexposes-v1.json")) requests.push(r.url());
  });
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    window.__workerSends = 0;
    Worker.prototype.postMessage = function (...args) {
      window.__workerSends++;
      return original.apply(this, args);
    };
  });
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  // The index is fetched once at startup to list the built-in 3D positions.
  expect(requests.length).toBeLessThanOrEqual(1);
  const sceneTitle = await page.locator("#scene-title").textContent();
  await positions(page);
  const sends = await page.evaluate(() => window.__workerSends);
  const ids = [];
  for (let p = 1; p <= 54; p++) {
    await expect(page.locator("#catalog-page")).toHaveText(`${p} / 54`);
    const pageIds = await page
      .locator("[data-source]")
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.source));
    expect(pageIds.length).toBeLessThanOrEqual(24);
    ids.push(...pageIds);
    if (p < 54)
      await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  expect(ids).toHaveLength(1283);
  expect(new Set(ids).size).toBe(1283);
  const source = JSON.parse(
    await readFile(
      new URL("../../public/catalog/sexposes-v1.json", import.meta.url),
      "utf8",
    ),
  );
  expect(ids).toEqual(source.entries.map((e) => e.sourceId));
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Search positions").fill("img-0001");
  await expect(page.locator(".preset-card")).toHaveCount(1);
  const card = page.getByRole("button", {
    name: "Position details img-0001",
    exact: true,
  });
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText(
    "not a verified reconstruction",
  );
  await page.keyboard.press("Escape");
  await expect(card).toBeFocused();
  await expect(page.locator("#scene-title")).toHaveText(sceneTitle);
  expect(await page.evaluate(() => window.__workerSends)).toBeGreaterThanOrEqual(
    sends,
  );
  expect(requests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("position categories, statuses and mobile controls remain accessible", async ({
  page,
}, info) => {
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  await positions(page);
  await page.getByText("Browse position categories", { exact: true }).click();
  await expect(page.locator(".position-category")).toHaveCount(9);
  await expect(
    page.locator(".position-category").filter({ hasText: "Face-to-face" }),
  ).toHaveCount(1);
  await expect(
    page.locator(".position-category").filter({ hasText: "Partner on top" }),
  ).toHaveCount(1);
  await page.getByLabel("Support status").selectOption("verified-3d");
  await expect(page.locator(".preset-card")).toHaveCount(23);
  await page.getByLabel("Support status").selectOption("all");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    if (width < 760)
      await page
        .getByRole("button", { name: "Library", exact: false })
        .last()
        .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeInViewport();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`position-catalog-${width}.png`),
    });
  }
});

test("position fetch failure is retryable and does not block preset editing", async ({
  page,
}) => {
  let failing = true;
  await page.route("**/catalog/sexposes-v1.json", async (route) => {
    if (failing)
      await route.fulfill({ status: 503, body: "temporarily unavailable" });
    else await route.continue();
  });
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  await expect(page.locator(".positions-status")).toContainText("503");
  await expect(page.locator("#save-preset")).toBeEnabled();
  await expect(page.locator(".preset-card")).toHaveCount(23);
  failing = false;
  await page
    .getByRole("button", { name: "Retry positions", exact: true })
    .click();
  await expect(page.locator(".preset-card")).toHaveCount(24);
});

test("source association survives save, export and reload without inheriting a verification badge", async ({
  page,
}) => {
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  await positions(page);
  await page.getByLabel("Search positions").fill("img-0001");
  await page
    .getByRole("button", { name: "Position details img-0001", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Associate current study with this source",
      exact: true,
    })
    .click();
  await expect(page.locator("#scene-title")).toHaveText("Standing · female");
  await expect(page.locator("#scene-source")).toContainText("img-0001");
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Source-linked standing study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await expect(page.locator(".preset-card .support-badge")).toHaveText(
    "Needs adjustment",
  );
  await page.reload();
  await ready(page);
  await expect(page.locator("#scene-source")).toContainText("img-0001");
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await openLibraryFilters(page);
  await page.getByLabel("Support status").selectOption("needs-adjustment");
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await page.getByLabel("Support status").selectOption("verified-3d");
  await expect(page.locator(".preset-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Positions", exact: true }).click();
  await page.getByLabel("Support status").selectOption("verified-3d");
  await expect(page.locator(".preset-card")).toHaveCount(23);
  await page.getByLabel("Support status").selectOption("needs-adjustment");
  await expect(page.locator(".preset-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.getByLabel("Search presets").fill("img-0001");
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Library tools", exact: true }).click();
  const tools = page.getByRole("dialog", { name: "Library tools" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    tools
      .getByRole("button", { name: "Export saved presets", exact: true })
      .click(),
  ]);
  await tools.getByRole("button", { name: "Close dialog" }).click();
  const pack = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(pack.presets[0].source.recordId).toBe("img-0001");
  expect(pack.presets[0].status).toBeUndefined();
  expect(pack.presets[0].scene.actors[0].posture).toBe("standing");
});

test("1283 full four-figure presets persist beyond localStorage scale with bounded browsing and lossless export", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  const original = fourFigureLibrary(1283);
  const buffer = Buffer.from(serializeCatalog(original));
  expect(buffer.length).toBeGreaterThan(5_000_000);
  await page.locator("#catalog-file").setInputFiles({
    name: "large.json",
    mimeType: "application/json",
    buffer,
  });
  await expect(page.locator("#toast")).toContainText("Imported 1283");
  await expect(page.locator(".preset-card")).toHaveCount(24);
  await expect(page.locator(".library-title > span")).toHaveText(
    "1,283 studies",
  );
  await expect(page.locator("#library-storage")).toContainText("IndexedDB");
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(page.locator(".library-title > span")).toHaveText(
    "1,283 studies",
  );
  await expect(page.locator(".preset-card")).toHaveCount(24);
  await page.getByLabel("Search presets").fill("Capacity study 1283");
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Favorite Capacity study 1283", exact: true })
    .click();
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Library tools", exact: true }).click();
  const tools = page.getByRole("dialog", { name: "Library tools" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    tools
      .getByRole("button", { name: "Export saved presets", exact: true })
      .click(),
  ]);
  await tools.getByRole("button", { name: "Close dialog" }).click();
  const restored = parseCatalog(await readFile(await download.path(), "utf8"));
  const dataHash = (entries) =>
    digest(entries.map(({ id, ...entry }) => entry));
  expect(restored).toHaveLength(1283);
  expect(dataHash(restored)).toBe(dataHash(parseCatalog(buffer.toString())));
  expect(new Set(restored.map((p) => p.id)).size).toBe(1283);
  expect(errors).toEqual([]);
});

test("IndexedDB transaction failure keeps the prior saved library and permits retry", async ({
  page,
}) => {
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  await page.evaluate(() => {
    window.__originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "library")
        throw new DOMException("quota", "QuotaExceededError");
      return window.__originalPut.apply(this, args);
    };
  });
  await page.locator("#catalog-file").setInputFiles({
    name: "one.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeCatalog([BUILTIN_PRESETS[1]])),
  });
  await expect(page.locator("#toast")).toContainText("Import failed");
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(0);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.__originalPut;
  });
  await page.locator("#catalog-file").setInputFiles({
    name: "one.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeCatalog([BUILTIN_PRESETS[1]])),
  });
  await expect(page.locator("#toast")).toContainText("Imported 1");
  await expect(page.locator(".preset-card")).toHaveCount(1);
});

test("unavailable IndexedDB has a visible functional legacy fallback", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", { value: undefined }),
  );
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  await expect(page.locator(".storage-notice")).toContainText(
    "IndexedDB is unavailable",
  );
  await page.locator("#catalog-file").setInputFiles({
    name: "one.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeCatalog([BUILTIN_PRESETS[1]])),
  });
  await expect(page.locator("#toast")).toContainText("Imported 1");
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(1);
});

test("two real tabs reject a stale library transaction and recover on reload", async ({
  page,
  context,
}) => {
  const second = await context.newPage();
  await Promise.all([
    page.goto("/?preset=builtin.standing-female"),
    second.goto("/?preset=builtin.standing-female"),
  ]);
  await Promise.all([ready(page), ready(second)]);
  const input = {
    name: "one.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeCatalog([BUILTIN_PRESETS[1]])),
  };
  await page.locator("#catalog-file").setInputFiles(input);
  await expect(page.locator("#toast")).toContainText("Imported 1");
  await second.locator("#catalog-file").setInputFiles(input);
  await expect(second.locator("#toast")).toContainText("another tab");
  await second.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(second.locator(".preset-card")).toHaveCount(0);
  await second.reload();
  await ready(second);
  await second.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(second.locator(".preset-card")).toHaveCount(1);
  await second.close();
});

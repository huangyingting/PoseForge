import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fourFigureLibrary } from "../fixtures/fourFigureLibrary.js";
import {
  BUILTIN_PRESETS,
  parseCatalog,
  MAX_PACK_BYTES,
} from "../../src/core/catalog.js";
import { LIBRARY_KEY } from "../../src/app/libraryStore.js";

import { ready } from "./helpers/ready.js";
async function seed(page, saved) {
  await page.addInitScript(
    ({ key, saved }) => {
      if (sessionStorage.getItem("capacity-audit-seeded")) return;
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, saved, favorites: [] }),
      );
      sessionStorage.setItem("capacity-audit-seeded", "true");
    },
    { key: LIBRARY_KEY, saved },
  );
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
}
async function exported(page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export library", exact: false }).click(),
  ]);
  return readFile(await download.path());
}

test("a 200-preset four-figure library exports compactly and re-imports without data loss", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page, fourFigureLibrary());
  const bytes = await exported(page);
  expect(bytes.length).toBeLessThanOrEqual(MAX_PACK_BYTES);
  const original = parseCatalog(bytes.toString());
  expect(original).toHaveLength(200);
  expect(original.every((p) => p.scene.actors.length === 4)).toBe(true);
  await page.evaluate((key) => localStorage.removeItem(key), LIBRARY_KEY);
  await page.reload();
  await ready(page);
  await expect(page.locator(".preset-card")).toHaveCount(
    BUILTIN_PRESETS.length,
  );
  await page.locator("#catalog-file").setInputFiles({
    name: "capacity-library.json",
    mimeType: "application/json",
    buffer: bytes,
  });
  await expect(page.locator("#toast")).toContainText("Imported 200");
  await expect(page.locator(".preset-card")).toHaveCount(200);
  const restored = parseCatalog((await exported(page)).toString());
  expect(restored.map(({ id, ...preset }) => preset)).toEqual(
    original.map(({ id, ...preset }) => preset),
  );
  expect(errors).toEqual([]);
});

test("a genuinely oversized library export explains the limit without deleting saved studies", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = [];
  let downloads = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("download", () => downloads++);
  await seed(page, fourFigureLibrary(200, 3000));
  await page
    .getByRole("button", { name: "Export library", exact: false })
    .click();
  await expect(page.locator("#toast")).toContainText("Export failed");
  await expect(page.locator("#toast")).toContainText("2 MB");
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(200);
  expect(downloads).toBe(0);
  expect(errors).toEqual([]);
});

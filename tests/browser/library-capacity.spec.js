import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fourFigureLibrary } from "../fixtures/fourFigureLibrary.js";
import {
  BUILTIN_PRESETS,
  parseCatalog,
  MAX_PACK_BYTES,
} from "../../src/core/catalog.js";
import { LIBRARY_KEY } from "../../src/app/libraryStore.js";
import { LIBRARY_DB, MIGRATION_KEY } from "../../src/app/persistentLibrary.js";

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
  await page.getByRole("button", { name: "Library tools", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Library tools" });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    modal
      .getByRole("button", { name: "Export saved presets", exact: true })
      .click(),
  ]);
  await modal.getByRole("button", { name: "Close dialog" }).click();
  return readFile(await download.path());
}

test("a legacy 200-preset four-figure library migrates and re-imports without data loss", async ({
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
  await page.evaluate(
    async ({ key, dbName, marker }) => {
      localStorage.removeItem(key);
      localStorage.removeItem(marker);
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("library", "readwrite");
          tx.objectStore("library").clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    { key: LIBRARY_KEY, dbName: LIBRARY_DB, marker: MIGRATION_KEY },
  );
  await page.reload();
  await ready(page);
  await expect(page.locator(".library-title > span")).toHaveText(
    `${(BUILTIN_PRESETS.length + 1283).toLocaleString("en")} positions`,
  );
  await page.locator("#catalog-file").setInputFiles({
    name: "capacity-library.json",
    mimeType: "application/json",
    buffer: bytes,
  });
  await expect(page.locator("#toast")).toContainText("Imported 200");
  await expect(page.locator(".preset-card")).toHaveCount(24);
  await expect(page.locator(".library-title > span")).toHaveText("200 studies");
  const restored = parseCatalog((await exported(page)).toString());
  expect(restored.map(({ id, ...preset }) => preset)).toEqual(
    original.map(({ id, ...preset }) => preset),
  );
  expect(errors).toEqual([]);
});

test("an oversized import explains the new limit without deleting saved studies", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = [];
  let downloads = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("download", () => downloads++);
  await seed(page, fourFigureLibrary(200, 3000));
  await page.locator("#catalog-file").setInputFiles({
    name: "oversized.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(MAX_PACK_BYTES + 1, " "),
  });
  await expect(page.locator("#toast")).toContainText("Import failed");
  await expect(page.locator("#toast")).toContainText("32 MB");
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(24);
  await expect(page.locator(".library-title > span")).toHaveText("200 studies");
  expect(downloads).toBe(0);
  expect(errors).toEqual([]);
});

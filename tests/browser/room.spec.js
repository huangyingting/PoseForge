import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ready } from "./helpers/ready.js";

// The config starts every suite in the studio; this one starts where a first
// visit does, with no setting saved.
test.use({
  storageState: {
    cookies: [],
    origins: [
      {
        origin: "http://127.0.0.1:5174",
        localStorage: [
          {
            name: "poseforge.layout.v1",
            value: JSON.stringify({ library: true, inspector: true }),
          },
        ],
      },
    ],
  },
});

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});
test.afterEach(() => expect(errors).toEqual([]));

const pixels = async (page) =>
  createHash("sha256")
    .update(
      await page.locator("#viewport").evaluate((canvas) => canvas.toDataURL()),
    )
    .digest("hex");

/** The colour at a fraction of the way across and down the canvas. */
const colourAt = (page, x, y) =>
  page.locator("#viewport").evaluate(
    (canvas, [x, y]) => {
      const copy = document.createElement("canvas");
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext("2d");
      context.drawImage(canvas, 0, 0);
      return [
        ...context.getImageData(
          Math.floor(canvas.width * x),
          Math.floor(canvas.height * y),
          1,
          1,
        ).data,
      ].slice(0, 3);
    },
    [x, y],
  );

/** How much of a downloaded PNG is opaque, and its top corner's alpha. */
async function coverage(page, download) {
  const bytes = await readFile(await download.path());
  return page.evaluate(async (encoded) => {
    const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([raw], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 200) opaque++;
    return { corner: data[3], opaque: opaque / (data.length / 4) };
  }, bytes.toString("base64"));
}

async function exportPng(page, name) {
  await page.locator("#open-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: new RegExp(`^${name}`) }).click(),
  ]);
  await ready(page);
  return coverage(page, download);
}

test("a first visit opens in a bedroom, each setting is its own room, and the choice is kept", async ({
  page,
}) => {
  await page.goto("/?preset=builtin.position.kneeling-missionary");
  await ready(page);
  const setting = page.getByLabel("Setting", { exact: true });
  await expect(setting).toHaveValue("bedroom");
  expect(await setting.locator("option").allTextContents()).toEqual([
    "Bedroom",
    "Living room",
    "Hotel suite",
    "Beach",
    "Poolside",
    "Fashion shoot",
    "Studio",
  ]);

  // Up in the top corner the three-quarter view looks at a wall, at the sky
  // or into the dark of a shoot, or in the studio at the backdrop.
  const seen = {};
  const look = async () => ({ hash: await pixels(page), corner: await colourAt(page, 0.2, 0.08) });
  await page.waitForTimeout(400);
  seen.bedroom = await look();
  const places = ["living", "hotel", "beach", "pool", "fashion", "studio"];
  for (const name of places) {
    const before = await pixels(page);
    await setting.selectOption(name);
    // The old room stays up until the new one's pictures have been made, and
    // the figures dress for the beach, the pool and the shoot.
    await expect.poll(() => pixels(page)).not.toBe(before);
    await ready(page);
    await page.waitForTimeout(400);
    seen[name] = await look();
  }
  expect(new Set(Object.values(seen).map((entry) => entry.hash)).size).toBe(places.length + 1);
  for (const room of ["bedroom", ...places.slice(0, -1)])
    expect(seen[room].corner, `${room} against the studio`).not.toEqual(seen.studio.corner);

  await setting.selectOption("living");
  await page.reload();
  await ready(page);
  await expect(setting).toHaveValue("living");
  expect(await page.evaluate(() => localStorage.getItem("poseforge.setting.v1"))).toBe("living");
});

test("on the beach the figures are dressed for it, until that is turned off", async ({ page }) => {
  await page.goto("/?preset=builtin.position.kneeling-missionary");
  await ready(page);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page.getByText("Appearance", { exact: true }).first().click();
  const suited = page.getByLabel("Dress for the setting").first();
  const outfit = page.getByLabel("Outfit", { exact: true }).first();
  // A bedroom has no dress code to keep.
  await expect(suited).toBeHidden();
  await expect(outfit).toBeEnabled();
  await page.getByLabel("Setting", { exact: true }).selectOption("beach");
  await ready(page);
  await expect(suited).toBeVisible();
  await expect(suited).toBeChecked();
  await expect(outfit).toBeDisabled();
  await page.waitForTimeout(400);
  const dressed = await pixels(page);
  await suited.uncheck();
  await ready(page);
  await expect(outfit).toBeEnabled();
  await page.waitForTimeout(400);
  expect(await pixels(page)).not.toBe(dressed);
  expect(await page.evaluate(() => localStorage.getItem("poseforge.dress.v1"))).toBe("off");
  // The figures' own clothes are the scene's still: the beach's were a way of
  // seeing it, not an edit.
  await expect(page.locator("#scene-badge")).not.toHaveText("Unsaved changes");
});

test("on a phone the camera bar, with its longest setting, stays on the screen", async ({
  page,
}) => {
  await page.goto("/?preset=builtin.position.kneeling-missionary");
  await ready(page);
  await page.getByLabel("Setting", { exact: true }).selectOption("fashion");
  for (const width of [390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bar = await page
      .locator(".stage-toolbar")
      .evaluate((node) => node.getBoundingClientRect().toJSON());
    expect(bar.left, `${width}`).toBeGreaterThanOrEqual(0);
    expect(bar.right, `${width}`).toBeLessThanOrEqual(width);
    for (const name of ["Tour", "Zoom in"])
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeInViewport({ ratio: 1 });
    await expect(page.getByLabel("Material", { exact: true })).toBeInViewport({
      ratio: 1,
    });
  }
});

test("the room is in the picture but not in the cut-out", async ({ page }) => {
  await page.goto("/?preset=builtin.position.kneeling-missionary");
  await ready(page);
  await expect(page.getByLabel("Setting", { exact: true })).toHaveValue("bedroom");
  const full = await exportPng(page, "PNG image");
  const cut = await exportPng(page, "Transparent PNG");
  expect(full.corner).toBe(255);
  expect(full.opaque).toBeGreaterThan(0.99);
  expect(cut.corner).toBe(0);
  // Only the figures are left, which fill a small part of the frame.
  expect(cut.opaque).toBeGreaterThan(0.01);
  expect(cut.opaque).toBeLessThan(0.4);
});

test("the setting reads in Chinese, and fits the phone toolbar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?preset=builtin.position.kneeling-missionary");
  await ready(page);
  await page.locator("#language").click();
  await expect(page.locator("#status")).toContainText("就绪", { timeout: 60_000 });
  const setting = page.getByLabel("布景", { exact: true });
  await expect(setting).toBeVisible();
  expect(await setting.locator("option").allTextContents()).toEqual(["卧室", "客厅", "酒店套房", "海滩", "泳池边", "时装摄影", "摄影棚"]);
  const box = await setting.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

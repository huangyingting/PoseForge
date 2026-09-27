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
    "Studio",
  ]);

  // Up in the top corner the three-quarter view looks at a wall, or in the
  // studio at the backdrop.
  const seen = {};
  for (const name of ["bedroom", "living", "studio"]) {
    await setting.selectOption(name);
    await page.waitForTimeout(400);
    seen[name] = { hash: await pixels(page), corner: await colourAt(page, 0.2, 0.08) };
  }
  expect(new Set(Object.values(seen).map((entry) => entry.hash)).size).toBe(3);
  for (const room of ["bedroom", "living"])
    expect(seen[room].corner, `${room} against the studio`).not.toEqual(seen.studio.corner);

  await setting.selectOption("living");
  await page.reload();
  await ready(page);
  await expect(setting).toHaveValue("living");
  expect(await page.evaluate(() => localStorage.getItem("poseforge.setting.v1"))).toBe("living");
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
  expect(await setting.locator("option").allTextContents()).toEqual(["卧室", "客厅", "摄影棚"]);
  const box = await setting.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

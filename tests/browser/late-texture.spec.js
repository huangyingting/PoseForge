import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { ready } from "./helpers/ready.js";

const pixels = async (page) =>
  createHash("sha256")
    .update(
      await page.locator("#viewport").evaluate((canvas) => canvas.toDataURL()),
    )
    .digest("hex");

test("a skin atlas arriving after the final pose redraws the idle viewport without another solve", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route("**/skin-female*.png", async (route) => {
    requests++;
    await held;
    await route.continue();
  });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__textureFinals = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.stage === "final") window.__textureFinals.push(data.id);
        });
      }
    };
  });
  try {
    await page.goto("/?preset=builtin.standing-female", {
      waitUntil: "domcontentloaded",
    });
    await ready(page);
    await expect.poll(() => requests).toBe(1);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const before = await pixels(page);
    const finals = await page.evaluate(() => window.__textureFinals);
    expect(finals).toHaveLength(1);
    release();
    await expect.poll(() => pixels(page), { timeout: 20_000 }).not.toBe(before);
    expect(await page.evaluate(() => window.__textureFinals)).toEqual(finals);
    await expect(page.locator("#scene-title")).toHaveText("Standing · female");
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});

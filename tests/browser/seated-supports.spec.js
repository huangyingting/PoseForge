import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { ready } from "./helpers/ready.js";
const clear = async (page) => {
  const result = await page.evaluate(() => window.__seatedReport);
  expect(result.actors[0].supportMeasurement).toBe("rendered");
  expect(result.actors[0].seatResidual).toBeLessThanOrEqual(0.004);
  expect(result.quality.propSurfaces).toHaveLength(2);
  expect(result.quality.propSurfaces.every((p) => p.intersects === false)).toBe(
    true,
  );
  expect(result.quality.propPenetration).toBe(0);
  expect(result.quality.proxyPropPenetration).toBeGreaterThan(0.05);
  expect(result.quality.verifiedPropContacts).toBeGreaterThan(0);
  await expect(page.locator(".notes .warning, .notes .error")).toHaveCount(0);
  return result;
};

for (const type of ["male", "female"])
  test(`${type} seated support is clear and captured placement survives save, reload and export`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", ({ data }) => {
            if (data.stage === "final")
              window.__seatedReport = {
                actors: data.actors,
                quality: data.quality,
              };
          });
        }
      };
    });
    await page.goto(`/?preset=builtin.seated-${type}`);
    await ready(page);
    const before = await clear(page);
    expect(
      before.quality.adjustments.some((note) =>
        note.includes("adjusted seated support"),
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`grounded-${type}.png`) });
    await page.getByRole("button", { name: "Figures", exact: true }).click();
    await page
      .getByRole("button", { name: "Capture current layout", exact: true })
      .click();
    await ready(page);
    const captured = await clear(page);
    captured.actors[0].root.position.forEach((value, i) =>
      expect(value).toBeCloseTo(before.actors[0].root.position[i], 7),
    );
    expect(
      captured.quality.adjustments.some((note) =>
        note.includes("adjusted seated support"),
      ),
    ).toBe(false);
    await page.locator("#save-preset").click();
    await page.getByLabel("Preset name").fill(`Grounded ${type} study`);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save preset", exact: true })
      .click();
    await ready(page);
    await page.reload();
    await ready(page);
    const restored = await clear(page);
    restored.actors[0].root.position.forEach((value, i) =>
      expect(value).toBeCloseTo(before.actors[0].root.position[i], 7),
    );
    await page.locator("#open-export").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^Editable preset/ }).click(),
    ]);
    const pack = JSON.parse(await readFile(await download.path(), "utf8")),
      actor = pack.presets[0].scene.actors[0];
    expect(actor.jointMode).toBe("fixed");
    expect(actor.placement).toBeTruthy();
    expect(Object.keys(actor.joints).length).toBeGreaterThan(20);
    expect(errors).toEqual([]);
  });

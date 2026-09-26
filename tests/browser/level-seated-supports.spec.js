import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { ready } from "./helpers/ready.js";
async function grounded(page, plane, props) {
  const report = await page.evaluate(() => window.__levelSeatedReport);
  expect(report.actors).toHaveLength(1);
  expect(report.actors[0].supportMeasurement).toBe("rendered");
  expect(report.actors[0].seatResidual).toBeLessThanOrEqual(0.004);
  expect(report.actors[0].supportPenetration).toBe(0);
  expect(report.quality.renderedBalance[0].supported).toBe(true);
  expect(report.quality.floorSurfaces[0].penetration).toBe(0);
  expect(report.quality.floorSurfaces[0].minimumY).toBeGreaterThanOrEqual(
    plane - 1e-7,
  );
  expect(report.quality.propSurfaces).toHaveLength(props);
  expect(report.quality.propSurfaces.every((p) => p.intersects === false)).toBe(
    true,
  );
  expect(report.quality.propPenetration).toBe(0);
  expect(report.quality.contactDetail).toHaveLength(0);
  await expect(page.locator(".notes .warning, .notes .error")).toHaveCount(0);
  return report;
}

test("shared-plane seating clears the sofa for both body types and survives surface edits, capture, reload and export", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("requestfailed", (request) => errors.push(request.url()));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.stage === "final")
            window.__levelSeatedReport = {
              actors: data.actors,
              quality: data.quality,
            };
        });
      }
    };
  });
  await page.goto("/?preset=builtin.reclined");
  await ready(page);
  const initial = await grounded(page, 0.45, 2);
  expect(
    initial.quality.adjustments.some((note) =>
      note.includes("adjusted seated support on a shared surface"),
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("female-sofa-grounded.png") });
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page.getByLabel("Body type", { exact: true }).selectOption("male");
  await ready(page);
  await grounded(page, 0.45, 2);
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await page.getByLabel("Surface", { exact: true }).selectOption("bed");
  await ready(page);
  await grounded(page, 0.55, 1);
  await page.getByLabel("Surface", { exact: true }).selectOption("sofa");
  await ready(page);
  const before = await grounded(page, 0.45, 2);
  await page.screenshot({ path: info.outputPath("male-sofa-grounded.png") });
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page
    .getByRole("button", { name: "Capture current layout", exact: true })
    .click();
  await ready(page);
  await grounded(page, 0.45, 2);
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Grounded sofa study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await ready(page);
  await page.reload();
  await ready(page);
  const restored = await grounded(page, 0.45, 2);
  restored.actors[0].root.position.forEach((n, i) =>
    expect(n).toBeCloseTo(before.actors[0].root.position[i], 7),
  );
  await page.locator("#open-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Editable preset/ }).click(),
  ]);
  const scene = JSON.parse(await readFile(await download.path(), "utf8"))
    .presets[0].scene;
  expect(scene.support.surface).toBe("sofa");
  expect(scene.actors[0]).toMatchObject({
    bodyType: "male",
    posture: "seated_reclined",
    jointMode: "fixed",
  });
  expect(scene.actors[0].placement).toBeTruthy();
  expect(errors).toEqual([]);
});

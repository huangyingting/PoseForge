import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { ready } from "./helpers/ready.js";
async function clear(page, count, contacts) {
  const data = await page.evaluate(() => window.__kneelingReport);
  expect(data.actors).toHaveLength(count);
  for (const actor of data.actors) {
    expect(actor.supportMeasurement).toBe("rendered");
    expect(actor.seatResidual).toBeLessThanOrEqual(0.004);
    expect(actor.supportPenetration).toBe(0);
  }
  expect(data.quality.renderedBalance.every((b) => b?.supported)).toBe(true);
  expect(data.quality.figureSurfaces.every((p) => p.intersects === false)).toBe(
    true,
  );
  expect(data.quality.contactDetail).toHaveLength(contacts);
  expect(
    data.quality.contactDetail.every(
      (c) => !c.intersects && c.surfaceGap <= 0.004,
    ),
  ).toBe(true);
  await expect(page.locator(".notes .warning, .notes .error")).toHaveCount(0);
  return data;
}
for (const [id, count, contacts] of [
  ["low-kneel", 1, 0],
  ["paired-kneel", 2, 1],
])
  test(`${id} is grounded and preserves contacts through capture, reload and export`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", ({ data }) => {
            if (data.stage === "final")
              window.__kneelingReport = {
                actors: data.actors,
                quality: data.quality,
              };
          });
        }
      };
    });
    await page.goto(`/?preset=builtin.${id}`);
    await ready(page);
    const before = await clear(page, count, contacts);
    expect(
      before.quality.adjustments.some((note) =>
        note.includes("adjusted kneeling support"),
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`${id}-grounded.png`) });
    await page.getByRole("button", { name: "Figures", exact: true }).click();
    await page
      .getByRole("button", { name: "Capture current layout", exact: true })
      .click();
    await ready(page);
    const captured = await clear(page, count, contacts);
    for (let i = 0; i < count; i++)
      captured.actors[i].root.position.forEach((n, k) =>
        expect(n).toBeCloseTo(before.actors[i].root.position[k], 7),
      );
    await page.locator("#save-preset").click();
    await page.getByLabel("Preset name").fill(`Grounded ${id}`);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save preset", exact: true })
      .click();
    await ready(page);
    await page.reload();
    await ready(page);
    const restored = await clear(page, count, contacts);
    for (let i = 0; i < count; i++)
      restored.actors[i].root.position.forEach((n, k) =>
        expect(n).toBeCloseTo(before.actors[i].root.position[k], 7),
      );
    await page.locator("#open-export").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^Editable preset/ }).click(),
    ]);
    const pack = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(pack.presets[0].scene.actors).toHaveLength(count);
    for (const actor of pack.presets[0].scene.actors) {
      expect(actor.jointMode).toBe("fixed");
      expect(actor.placement).toBeTruthy();
    }
    expect(errors).toEqual([]);
  });

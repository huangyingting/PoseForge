import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { ready } from "./helpers/ready.js";

for (const bodyType of ["female", "male"]) {
  test(`${bodyType} brace hands render and retain their geometry through edits, saved reload and export`, async ({
    page,
  }, info) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => errors.push(request.url()));
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", ({ data }) => {
            if (data.stage !== "final" || data.actors?.length !== 1) return;
            const mesh = data.meshes[0];
            const skin = mesh.parts.find((part) => part.primary);
            let sum = 0,
              absolute = 0;
            for (let i = 0; i < skin.positions.length; i++) {
              sum += skin.positions[i] * (1 + (i % 37));
              absolute += Math.abs(skin.positions[i]);
            }
            window.__handShapeReport = {
              bodyType: mesh.bodyType,
              source: mesh.source,
              hands: data.actors[0].hands,
              signature: `${sum.toFixed(6)}:${absolute.toFixed(6)}`,
              finite:
                skin.positions.every(Number.isFinite) &&
                skin.normals.every(Number.isFinite),
            };
          });
        }
      };
    });
    await page.goto(`/?preset=builtin.standing-${bodyType}`);
    await ready(page);
    const original = await page.evaluate(() => window.__handShapeReport);
    await page.getByRole("button", { name: "Figures", exact: true }).click();
    await page.getByText("Hands & feet", { exact: true }).click();
    for (const side of ["Left", "Right"]) {
      await page
        .getByLabel(`${side} hand`, { exact: true })
        .selectOption("brace");
      await ready(page);
    }
    const braced = await page.evaluate(() => window.__handShapeReport);
    expect(braced.bodyType).toBe(bodyType);
    expect(braced.source).toBe("scanned");
    expect(braced.finite).toBe(true);
    expect(braced.hands).toEqual({ l: "brace", r: "brace" });
    expect(braced.signature).not.toBe(original.signature);
    await page.screenshot({ path: info.outputPath(`braced-${bodyType}.png`) });

    await page.locator("#save-preset").click();
    await page.getByLabel("Preset name").fill(`${bodyType} hand study`);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save preset", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await ready(page);
    expect(await page.evaluate(() => window.__handShapeReport)).toEqual(braced);
    await page.getByRole("button", { name: "Figures", exact: true }).click();
    await page.getByText("Hands & feet", { exact: true }).click();
    await expect(page.getByLabel("Left hand", { exact: true })).toHaveValue(
      "brace",
    );
    await expect(page.getByLabel("Right hand", { exact: true })).toHaveValue(
      "brace",
    );
    await page
      .getByLabel("Right hand", { exact: true })
      .selectOption("relaxed");
    await ready(page);
    const mixed = await page.evaluate(() => window.__handShapeReport);
    expect(mixed.hands).toEqual({ l: "brace", r: "relaxed" });
    expect(mixed.signature).not.toBe(braced.signature);
    await page.getByLabel("Right hand", { exact: true }).selectOption("brace");
    await ready(page);
    expect(await page.evaluate(() => window.__handShapeReport)).toEqual(braced);

    await page.locator("#open-export").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /^Editable preset/ }).click(),
    ]);
    const scene = JSON.parse(await readFile(await download.path(), "utf8"))
      .presets[0].scene;
    expect(scene.actors[0].bodyType).toBe(bodyType);
    // The editor deliberately uses the public shorthand when both sides agree.
    expect(scene.actors[0].hands).toBe("brace");
    expect(errors).toEqual([]);
  });
}

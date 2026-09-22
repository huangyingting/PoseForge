import { test, expect } from "@playwright/test";
import { GARMENT_COLOURS } from "../../src/core/garments.js";

import { ready } from "./helpers/ready.js";
const apply = async (page, text) => {
  await page.getByLabel("Pose description").fill(text);
  await page
    .getByRole("button", { name: "Apply description", exact: true })
    .click();
  await ready(page);
};

test("equivalent body defaults reuse shaping across height and outfit changes without stale colors", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => errors.push(request.url()));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__templatePhases = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.stage !== "draft") return;
          window.__templatePhases.push({
            id: data.id,
            models: data.timings.models,
            heights: data.scene.actors.map((a) => a.stature),
            sources: data.meshes.map((m) => m.source),
            garments: data.meshes.map((m) =>
              m.parts
                .filter((p) => p.garment)
                .map((p) => ({ name: p.name, colour: p.colour })),
            ),
          });
        });
      }
    };
  });
  await page.goto("/?preset=builtin.named.reverse_cowgirl");
  await ready(page);
  const original = await page.evaluate(() => window.__templatePhases.at(-1));
  expect(original.sources).toEqual(["scanned", "scanned"]);
  original.garments.forEach((parts, i) => {
    expect(parts.map((p) => p.name).sort()).toEqual(["shorts", "top"]);
    for (const part of parts)
      expect(part.colour).toEqual(GARMENT_COLOURS[i === 0 ? "sage" : "navy"]);
  });
  await apply(page, "reverse cowgirl, he is tall");
  const edited = await page.evaluate(() => window.__templatePhases.at(-1));
  expect(edited.id).toBeGreaterThan(original.id);
  expect(edited.heights[0]).toBe(1.85);
  expect(edited.sources).toEqual(["scanned", "scanned"]);
  for (const parts of edited.garments) {
    expect(parts.map((p) => p.name).sort()).toEqual(["shorts", "top"]);
    for (const part of parts)
      expect(part.colour).toEqual(GARMENT_COLOURS.black);
  }
  // Relative work, not a machine-specific whole-scene FPS promise. The old
  // single-tier cache spent roughly another cold build on this edit.
  expect(edited.models).toBeLessThan(original.models * 0.5);
  await apply(page, "reverse cowgirl");
  const restored = await page.evaluate(() => window.__templatePhases.at(-1));
  expect(restored.models).toBeLessThan(original.models * 0.5);
  expect(restored.garments).toEqual(original.garments);
  await expect(page.locator(".contact-result.warning")).toHaveCount(0);
  await expect(page.locator(".notes .warning, .notes .error")).toHaveCount(0);
  await info.attach("template-timings", {
    body: JSON.stringify({
      coldMs: original.models,
      editedMs: edited.models,
      restoredMs: restored.models,
    }),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});

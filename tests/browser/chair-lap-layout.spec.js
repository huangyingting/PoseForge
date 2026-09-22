import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { CHAIR_LAP_LAYOUT } from "../../src/nlp/chairLapLayout.js";

const phrase = "on his lap in a chair";
import { ready } from "./helpers/ready.js";
const apply = async (page, text) => {
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await page.getByLabel("Pose description").fill(text);
  await page
    .getByRole("button", { name: "Apply description", exact: true })
    .click();
  await ready(page);
};
async function clear(page, propCount) {
  const report = await page.evaluate(() => window.__chairLayoutReport);
  expect(report.actors).toHaveLength(2);
  expect(report.actors[0].supportMeasurement).toBe("rendered");
  expect(report.actors[0].seatResidual).toBeLessThanOrEqual(0.004);
  expect(report.actors[0].supportPenetration).toBe(0);
  expect(report.actors[1].supportBasis).toBe("partner");
  expect(report.actors[1].seatResidual).toBeNull();
  expect(report.quality.renderedBalance[0].supported).toBe(true);
  expect(report.quality.contactDetail).toHaveLength(3);
  expect(
    report.quality.contactDetail.every(
      (c) => c.basis === "rendered" && !c.intersects && c.surfaceGap <= 0.004,
    ),
  ).toBe(true);
  expect(
    report.quality.figureSurfaces.every((p) => p.intersects === false),
  ).toBe(true);
  expect(report.quality.propSurfaces).toHaveLength(propCount);
  expect(report.quality.propSurfaces.every((p) => p.intersects === false)).toBe(
    true,
  );
  expect(report.quality.floorSurfaces.every((p) => p.penetration === 0)).toBe(
    true,
  );
  expect(report.quality.proxyPropPenetration).toBeGreaterThan(0);
  await expect(page.locator(".notes .warning, .notes .error")).toHaveCount(0);
  await expect(page.locator(".contact-result.warning")).toHaveCount(0);
  return report;
}

test("calibrated chair and bench support keep three close contacts through save, reload and export", async ({
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
            window.__chairLayoutReport = {
              actors: data.actors,
              quality: data.quality,
            };
        });
      }
    };
  });
  await page.goto("/?preset=builtin.named.chair_straddle");
  await ready(page);
  await clear(page, 4);
  await expect(
    page.getByRole("button", { name: "Side", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("chair-supported-pair.png") });
  await apply(page, `${phrase} on the bench`);
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
    "bench",
  );
  const before = await clear(page, 2);
  await page.screenshot({ path: info.outputPath("bench-supported-pair.png") });
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Supported bench pair");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await ready(page);
  await page.reload();
  await ready(page);
  const restored = await clear(page, 2);
  restored.actors.forEach((actor, i) =>
    actor.root.position.forEach((n, k) =>
      expect(n).toBeCloseTo(before.actors[i].root.position[k], 7),
    ),
  );
  await page.locator("#open-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Editable preset/ }).click(),
  ]);
  const scene = JSON.parse(await readFile(await download.path(), "utf8"))
    .presets[0].scene;
  expect(scene.support.surface).toBe("bench");
  scene.actors.forEach((actor, i) =>
    expect(actor).toMatchObject(
      CHAIR_LAP_LAYOUT.surfaceVariants.bench.actors[i],
    ),
  );
  expect(errors).toEqual([]);
});

test("chair-layout body, facing and unsupported-surface requests remain explicit editable variations", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?preset=builtin.named.chair_straddle");
  await ready(page);
  const hint = page.getByText("2 figures use guided starting placement.", {
    exact: false,
  });
  await expect(hint).toBeVisible();
  await apply(page, `${phrase}, he is tall`);
  await expect(hint).not.toBeVisible();
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(
    page.locator(".actor-card").nth(0).getByLabel("Height", { exact: true }),
  ).toHaveValue("1.85");
  for (const actor of await page.locator(".actor-card").all()) {
    await actor.getByText(/^Placement(?: \(fixed\))?$/).click();
    await expect(
      actor.getByLabel("Keep placement", { exact: true }),
    ).not.toBeChecked();
  }
  await apply(page, `${phrase}, facing away`);
  await expect(page.getByLabel("Facing", { exact: true })).toHaveValue("away");
  await expect(hint).not.toBeVisible();
  await apply(page, `${phrase} on the floor`);
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
    "floor",
  );
  await expect(hint).not.toBeVisible();
  expect(errors).toEqual([]);
});

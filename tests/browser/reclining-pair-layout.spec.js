import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { RECLINING_PAIR_LAYOUT } from "../../src/nlp/recliningPairLayout.js";

const ready = async (page) => {
  await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#save-preset")).toBeEnabled();
};
async function apply(page, description) {
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await page.getByLabel("Pose description").fill(description);
  await page
    .getByRole("button", { name: "Apply description", exact: true })
    .click();
  await ready(page);
}
async function clear(page, surface, guided = true) {
  const report = await page.evaluate(() => window.__recliningPairReport);
  expect(report.actors.map((actor) => actor.posture)).toEqual([
    "supine",
    "forearms_and_knees",
  ]);
  expect(report.actors[0].supportBasis).toBe("surface");
  expect(report.actors[0].supportMeasurement).toBe("rendered");
  expect(report.actors[0].seatResidual).toBeLessThanOrEqual(0.004);
  expect(report.actors[0].supportPenetration).toBe(0);
  expect(report.actors[0].bodySupportResidual).toBeGreaterThan(0.025);
  expect(report.actors[1].supportBasis).toBe("partner");
  expect(report.actors[1].seatResidual).toBeNull();
  expect(report.actors[1].bodySupportResidual).toBeNull();
  expect(report.quality.renderedBalance[0].supported).toBe(true);
  expect(report.quality.renderedBalance[1]).toBeNull();
  expect(
    report.quality.supportSurfaces[0].supports.map(({ landmark }) => landmark),
  ).toEqual(["upperBack", "buttocks", "head"]);
  expect(
    report.quality.supportSurfaces[0].supports.every(
      ({ measurement }) =>
        measurement.withinFootprint &&
        measurement.plane === (surface === "bed" ? 0.55 : 0) &&
        measurement.gap <= 0.004 &&
        measurement.penetration === 0,
    ),
  ).toBe(true);
  expect(report.quality.supportSurfaces[1].gap).toBeNull();
  expect(report.quality.contactDetail).toHaveLength(1);
  expect(report.quality.contactDetail[0]).toMatchObject({
    fromActor: 1,
    toActor: 0,
    from: "pelvis",
    to: "pelvis",
    basis: "rendered",
    intersects: false,
  });
  expect(report.quality.contactDetail[0].surfaceGap).toBeGreaterThanOrEqual(
    0.001,
  );
  expect(report.quality.contactDetail[0].surfaceGap).toBeLessThanOrEqual(0.004);
  expect(report.quality.figureSurfaces).toHaveLength(1);
  expect(
    report.quality.figureSurfaces.every((entry) => entry.intersects === false),
  ).toBe(true);
  expect(report.quality.propSurfaces).toHaveLength(surface === "bed" ? 2 : 0);
  expect(
    report.quality.propSurfaces.every((entry) => entry.intersects === false),
  ).toBe(true);
  expect(
    report.quality.floorSurfaces.every((entry) => entry.penetration === 0),
  ).toBe(true);
  expect(
    report.quality.adjustments.some((note) =>
      note.includes("guided starting pose"),
    ),
  ).toBe(guided);
  await expect(page.locator(".contact-result.warning")).toHaveCount(0);
  await expect(page.locator(".notes .warning, .notes .error")).toHaveCount(0);
  return report;
}
async function exportedScene(page) {
  await page.locator("#open-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Editable preset/ }).click(),
  ]);
  const scene = JSON.parse(await readFile(await download.path(), "utf8"))
    .presets[0].scene;
  await page.keyboard.press("Escape");
  return scene;
}

test("the reclining pair retains mixed placement and its original contact on bed and floor through saved reload, export and capture", async ({
  page,
}, info) => {
  test.setTimeout(300_000);
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
          if (data.stage === "final")
            window.__recliningPairReport = {
              actors: data.actors,
              quality: data.quality,
            };
        });
      }
    };
  });
  await page.goto("/?preset=builtin.named.missionary");
  await ready(page);
  await clear(page, "bed");
  await expect(
    page.getByRole("button", { name: "Side", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("1 figure uses guided starting placement.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("1 figure keeps fixed placement.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("reclining-pair-bed.png") });
  await apply(page, "missionary on the floor");
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
    "floor",
  );
  const before = await clear(page, "floor");
  await page.screenshot({ path: info.outputPath("reclining-pair-floor.png") });
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Reclining pair study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await ready(page);
  await page.reload();
  await ready(page);
  await clear(page, "floor");
  const mixed = await exportedScene(page);
  expect(mixed.support.surface).toBe("floor");
  expect(mixed.contacts).toHaveLength(0);
  expect(mixed.relationship.arrangement).toBe("over_supine");
  mixed.actors.forEach((actor, i) =>
    expect(actor).toMatchObject(RECLINING_PAIR_LAYOUT.actors[i]),
  );
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page
    .getByRole("button", { name: "Capture current layout", exact: true })
    .click();
  await ready(page);
  const captured = await clear(page, "floor", false);
  captured.actors.forEach((actor, i) => {
    actor.root.position.forEach((value, k) =>
      expect(value).toBeCloseTo(before.actors[i].root.position[k], 7),
    );
    expect(actor.joints).toEqual(before.actors[i].joints);
  });
  await page.locator("#save-preset").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Update preset", exact: true })
    .click();
  await ready(page);
  await page.reload();
  await ready(page);
  await clear(page, "floor", false);
  const fixed = await exportedScene(page);
  expect(
    fixed.actors.every(
      (actor) =>
        actor.jointMode === "fixed" && actor.placement.mode !== "guided",
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("the reclining calibration respects explicit height, facing and unsupported-surface requests", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?preset=builtin.named.missionary");
  await ready(page);
  const hint = page.getByText("1 figure uses guided starting placement.", {
    exact: false,
  });
  await expect(hint).toBeVisible();
  await apply(page, "missionary, he is tall");
  await expect(hint).not.toBeVisible();
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(
    page.locator(".actor-card").last().getByLabel("Height", { exact: true }),
  ).toHaveValue("1.85");
  await apply(page, "missionary, facing away");
  await expect(page.getByLabel("Facing", { exact: true })).toHaveValue("away");
  await expect(hint).not.toBeVisible();
  await apply(page, "missionary on the chair");
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
    "chair",
  );
  await expect(hint).not.toBeVisible();
  expect(errors).toEqual([]);
});

import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { HEAD_TO_TOE_LAYOUT } from "../../src/nlp/headToToeLayout.js";

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
  const report = await page.evaluate(() => window.__headToToeReport);
  expect(report.actors.map((actor) => actor.posture)).toEqual([
    "supine",
    "prone",
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
  expect(report.quality.contactDetail).toHaveLength(2);
  expect(
    report.quality.contactDetail.map((c) => [
      c.fromActor,
      c.toActor,
      c.from,
      c.to,
      c.source,
    ]),
  ).toEqual([
    [1, 0, "head", "pelvis", "arrangement"],
    [1, 0, "pelvis", "head", "arrangement"],
  ]);
  for (const contact of report.quality.contactDetail) {
    expect(contact.basis).toBe("rendered");
    expect(contact.intersects).toBe(false);
    expect(contact.surfaceGap).toBeGreaterThanOrEqual(0.001);
    expect(contact.surfaceGap).toBeLessThanOrEqual(0.004);
  }
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

test("the head-to-toe pair retains guided placement and both original contacts on bed and floor through saved reload, export and capture", async ({
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
            window.__headToToeReport = {
              actors: data.actors,
              quality: data.quality,
            };
        });
      }
    };
  });
  await page.goto("/?preset=builtin.named.sixty_nine");
  await ready(page);
  await clear(page, "bed");
  await expect(
    page.getByRole("button", { name: "Side", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("2 figures use guided starting placement.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("head-to-toe-bed.png") });
  await apply(page, "sixty nine on the floor");
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
    "floor",
  );
  const before = await clear(page, "floor");
  await page.screenshot({ path: info.outputPath("head-to-toe-floor.png") });
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Head-to-toe study");
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
  expect(mixed.relationship.arrangement).toBe("head_to_toe");
  mixed.actors.forEach((actor, i) =>
    expect(actor).toMatchObject(HEAD_TO_TOE_LAYOUT.actors[i]),
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

test("the head-to-toe calibration respects explicit height, facing and unsupported-surface requests", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?preset=builtin.named.sixty_nine");
  await ready(page);
  const hint = page.getByText("2 figures use guided starting placement.", {
    exact: false,
  });
  await expect(hint).toBeVisible();
  await apply(page, "sixty nine, he is tall");
  await expect(hint).not.toBeVisible();
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(
    page.locator(".actor-card").last().getByLabel("Height", { exact: true }),
  ).toHaveValue("1.85");
  await apply(page, "sixty nine, facing away");
  await expect(page.getByLabel("Facing", { exact: true })).toHaveValue("away");
  await expect(hint).not.toBeVisible();
  await apply(page, "sixty nine on the chair");
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
    "chair",
  );
  await expect(hint).not.toBeVisible();
  expect(errors).toEqual([]);
});

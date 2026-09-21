import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { KNEELING_PAIR_LAYOUT } from "../../src/nlp/kneelingPairLayout.js";

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
  const report = await page.evaluate(() => window.__kneelingPairReport);
  expect(report.actors.map((actor) => actor.posture)).toEqual([
    "all_fours",
    "kneeling",
  ]);
  expect(
    report.actors.every(
      (actor) =>
        actor.supportBasis === "surface" &&
        actor.supportMeasurement === "rendered" &&
        actor.seatResidual <= 0.004 &&
        actor.supportPenetration === 0,
    ),
  ).toBe(true);
  expect(report.actors[0].hands).toEqual({ l: "brace", r: "brace" });
  expect(report.quality.renderedBalance.every((entry) => entry.supported)).toBe(
    true,
  );
  expect(
    report.quality.supportSurfaces.map((entry) =>
      entry.supports.map(({ landmark, side }) => [landmark, side]),
    ),
  ).toEqual([
    [
      ["knee", "l"],
      ["knee", "r"],
      ["hand", "l"],
      ["hand", "r"],
    ],
    [
      ["knee", "l"],
      ["knee", "r"],
    ],
  ]);
  expect(
    report.quality.supportSurfaces.every(
      (entry) =>
        entry.unavailable === 0 &&
        entry.supports.every(
          ({ measurement }) =>
            measurement.withinFootprint &&
            measurement.plane === (surface === "bed" ? 0.55 : 0) &&
            measurement.gap <= 0.004 &&
            measurement.penetration === 0,
        ),
    ),
  ).toBe(true);
  expect(report.quality.contactDetail).toHaveLength(3);
  expect(
    report.quality.contactDetail.every(
      (contact) =>
        contact.basis === "rendered" &&
        !contact.intersects &&
        contact.surfaceGap >= 0.001 &&
        contact.surfaceGap <= 0.004,
    ),
  ).toBe(true);
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

test("the kneeling pair retains six supports and three contacts on bed and floor through saved reload, export and capture", async ({
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
            window.__kneelingPairReport = {
              actors: data.actors,
              quality: data.quality,
            };
        });
      }
    };
  });
  await page.goto("/?preset=builtin.named.doggy_style");
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
  await page.screenshot({ path: info.outputPath("kneeling-pair-bed.png") });
  await apply(page, "doggy style on the floor");
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
    "floor",
  );
  const before = await clear(page, "floor");
  await page.screenshot({ path: info.outputPath("kneeling-pair-floor.png") });
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Kneeling pair study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await ready(page);
  await page.reload();
  await ready(page);
  await clear(page, "floor");
  const guided = await exportedScene(page);
  expect(guided.support.surface).toBe("floor");
  expect(guided.contacts).toHaveLength(0);
  expect(guided.relationship.arrangement).toBe("rear_alignment");
  guided.actors.forEach((actor, i) =>
    expect(actor).toMatchObject(KNEELING_PAIR_LAYOUT.actors[i]),
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

test("the kneeling calibration respects explicit height, facing and unsupported-surface requests", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?preset=builtin.named.doggy_style");
  await ready(page);
  const hint = page.getByText("2 figures use guided starting placement.", {
    exact: false,
  });
  await expect(hint).toBeVisible();
  await apply(page, "doggy style, he is tall");
  await expect(hint).not.toBeVisible();
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(
    page.locator(".actor-card").last().getByLabel("Height", { exact: true }),
  ).toHaveValue("1.85");
  await apply(page, "doggy style, facing away");
  await expect(page.getByLabel("Facing", { exact: true })).toHaveValue("away");
  await expect(hint).not.toBeVisible();
  await apply(page, "doggy style on the chair");
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
    "chair",
  );
  await expect(hint).not.toBeVisible();
  expect(errors).toEqual([]);
});

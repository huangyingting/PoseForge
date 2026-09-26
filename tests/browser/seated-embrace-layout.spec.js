import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { SEATED_EMBRACE_LAYOUT } from "../../src/nlp/seatedEmbraceLayout.js";

import { ready } from "./helpers/ready.js";
async function apply(page, description) {
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await page.getByLabel("Pose description").fill(description);
  await page
    .getByRole("button", { name: "Apply description", exact: true })
    .click();
  await ready(page);
}
async function clear(page, surface, guidedSteps = 1) {
  const report = await page.evaluate(() => window.__seatedEmbraceReport);
  expect(report.actors).toHaveLength(2);
  expect(report.actors[0].supportMeasurement).toBe("rendered");
  expect(report.actors[0].seatResidual).toBeLessThanOrEqual(0.004);
  expect(report.actors[0].supportPenetration).toBe(0);
  expect(report.actors[1].supportBasis).toBe("partner");
  expect(report.actors[1].seatResidual).toBeNull();
  expect(report.quality.renderedBalance[0].supported).toBe(true);
  expect(report.quality.contactDetail).toHaveLength(5);
  expect(
    report.quality.contactDetail.every(
      (contact) =>
        contact.basis === "rendered" &&
        !contact.intersects &&
        contact.surfaceGap <= 0.004,
    ),
  ).toBe(true);
  expect(
    report.quality.supportSurfaces[0].supports.every(
      (support) =>
        support.measurement.plane === (surface === "bed" ? 0.55 : 0) &&
        support.measurement.gap <= 0.004 &&
        support.measurement.penetration === 0,
    ),
  ).toBe(true);
  expect(report.quality.figureSurfaces).toHaveLength(1);
  expect(
    report.quality.figureSurfaces.every((pair) => pair.intersects === false),
  ).toBe(true);
  expect(report.quality.propSurfaces).toHaveLength(surface === "bed" ? 2 : 0);
  expect(
    report.quality.propSurfaces.every((pair) => pair.intersects === false),
  ).toBe(true);
  expect(
    report.quality.floorSurfaces.every((entry) => entry.penetration === 0),
  ).toBe(true);
  expect(
    report.quality.adjustments.filter((note) =>
      note.includes("guided starting pose"),
    ),
  ).toHaveLength(guidedSteps);
  await expect(page.locator(".notes .warning, .notes .error")).toHaveCount(0);
  await expect(page.locator(".contact-result.warning")).toHaveCount(0);
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

test("seated embrace keeps five contacts on floor and bed through save, reload, export and fixed capture", async ({
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
            window.__seatedEmbraceReport = {
              actors: data.actors,
              quality: data.quality,
            };
        });
      }
    };
  });
  await page.goto("/?preset=builtin.named.lotus");
  await ready(page);
  await clear(page, "floor");
  await expect(
    page.getByRole("button", { name: "Side", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("seated-embrace-floor.png") });
  await apply(page, "seated embrace on the bed");
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue("bed");
  const before = await clear(page, "bed");
  await page.screenshot({ path: info.outputPath("seated-embrace-bed.png") });
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Seated embrace study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await ready(page);
  await page.reload();
  await ready(page);
  await clear(page, "bed");
  const guided = await exportedScene(page);
  expect(guided.support.surface).toBe("bed");
  expect(guided.contacts).toHaveLength(2);
  expect(guided.relationship.arrangement).toBe("straddle_lap");
  guided.actors.forEach((actor, i) => {
    const expected = structuredClone(SEATED_EMBRACE_LAYOUT.actors[i]);
    expected.placement.position[1] += 0.55;
    expect(actor).toMatchObject(expected);
  });
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page
    .getByRole("button", { name: "Capture current layout", exact: true })
    .click();
  await ready(page);
  const captured = await clear(page, "bed", 0);
  captured.actors.forEach((actor, i) =>
    actor.root.position.forEach((value, k) =>
      expect(value).toBeCloseTo(before.actors[i].root.position[k], 7),
    ),
  );
  await page.locator("#save-preset").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Update preset", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await ready(page);
  await page.reload();
  await ready(page);
  await clear(page, "bed", 0);
  const fixed = await exportedScene(page);
  expect(
    fixed.actors.every(
      (actor) =>
        actor.jointMode === "fixed" && actor.placement.mode !== "guided",
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("seated embrace calibration does not override explicit body, facing or unsupported-surface requests", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?preset=builtin.named.lotus");
  await ready(page);
  const hint = page.getByText("2 figures use guided starting placement.", {
    exact: false,
  });
  await expect(hint).toBeVisible();
  await apply(page, "seated embrace, he is tall");
  await expect(hint).not.toBeVisible();
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(
    page.locator(".actor-card").first().getByLabel("Height", { exact: true }),
  ).toHaveValue("1.85");
  await apply(page, "seated embrace, facing away");
  await expect(page.getByLabel("Facing", { exact: true })).toHaveValue("away");
  await expect(hint).not.toBeVisible();
  await apply(page, "seated embrace on the chair");
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
    "chair",
  );
  await expect(hint).not.toBeVisible();
  expect(errors).toEqual([]);
});

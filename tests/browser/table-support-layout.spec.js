import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { TABLE_SUPPORT_LAYOUT } from "../../src/nlp/tableSupportLayout.js";

import { ready } from "./helpers/ready.js";
async function apply(page, description) {
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await page.getByLabel("Pose description").fill(description);
  await page
    .getByRole("button", { name: "Apply description", exact: true })
    .click();
  await ready(page);
}
async function clear(page, guided = true) {
  const report = await page.evaluate(() => window.__tableSupportReport);
  expect(report.actors.map((actor) => actor.posture)).toEqual([
    "bent_over_support",
    "standing",
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
  expect(
    report.quality.supportSurfaces.map((part) =>
      part.supports.map((support) => [
        support.landmark,
        support.measurement.plane,
      ]),
    ),
  ).toEqual([
    [
      ["chest", 0.75],
      ["hips", 0.75],
      ["foot", 0],
      ["foot", 0],
    ],
    [
      ["foot", 0],
      ["foot", 0],
    ],
  ]);
  expect(
    report.quality.supportSurfaces.every(
      (part) =>
        part.unavailable === 0 &&
        part.supports.every(
          (support) =>
            support.measurement.withinFootprint &&
            support.measurement.penetration === 0 &&
            support.measurement.gap <= 0.004,
        ),
    ),
  ).toBe(true);
  expect(report.quality.renderedBalance.every((part) => part.supported)).toBe(
    true,
  );
  expect(report.quality.contactDetail).toHaveLength(3);
  expect(
    report.quality.contactDetail.every(
      (contact) =>
        contact.basis === "rendered" &&
        !contact.intersects &&
        contact.surfaceGap <= 0.004,
    ),
  ).toBe(true);
  expect(report.quality.figureSurfaces).toHaveLength(1);
  expect(
    report.quality.figureSurfaces.every((pair) => pair.intersects === false),
  ).toBe(true);
  expect(report.quality.propSurfaces).toHaveLength(2);
  expect(
    report.quality.propSurfaces.every((pair) => pair.intersects === false),
  ).toBe(true);
  expect(
    report.quality.floorSurfaces.every((part) => part.penetration === 0),
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
async function exportScene(page) {
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

test("table support retains mixed placement, six supports and three contacts through save, reload, export and capture", async ({
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
            window.__tableSupportReport = {
              actors: data.actors,
              quality: data.quality,
            };
        });
      }
    };
  });
  await page.goto("/?preset=builtin.named.bent_over_table");
  await ready(page);
  const before = await clear(page);
  await expect(
    page.getByRole("button", { name: "Side", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("1 figure keeps fixed placement.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("1 figure uses guided starting placement.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("table-supported-pair.png") });
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Table support study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await ready(page);
  await page.reload();
  await ready(page);
  await clear(page);
  const authored = await exportScene(page);
  expect(authored.support.surface).toBe("table");
  expect(authored.relationship.arrangement).toBe("behind_bent_over");
  expect(authored.contacts).toEqual([]);
  authored.actors.forEach((actor, i) =>
    expect(actor).toMatchObject(TABLE_SUPPORT_LAYOUT.actors[i]),
  );
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page
    .getByRole("button", { name: "Capture current layout", exact: true })
    .click();
  await ready(page);
  const captured = await clear(page, false);
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
  await ready(page);
  await page.reload();
  await ready(page);
  await clear(page, false);
  const fixed = await exportScene(page);
  expect(
    fixed.actors.every(
      (actor) =>
        actor.jointMode === "fixed" && actor.placement.mode !== "guided",
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("table calibration preserves explicit body, facing and other-surface requests", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?preset=builtin.named.bent_over_table");
  await ready(page);
  const fixed = page.getByText("1 figure keeps fixed placement.", {
    exact: false,
  });
  const guided = page.getByText("1 figure uses guided starting placement.", {
    exact: false,
  });
  await expect(fixed).toBeVisible();
  await expect(guided).toBeVisible();
  await apply(page, "bent over the table, he is tall");
  await expect(fixed).not.toBeVisible();
  await expect(guided).not.toBeVisible();
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(
    page.locator(".actor-card").nth(1).getByLabel("Height", { exact: true }),
  ).toHaveValue("1.85");
  await apply(page, "bent over the table, facing away");
  await expect(page.getByLabel("Facing", { exact: true })).toHaveValue("away");
  await expect(fixed).not.toBeVisible();
  await expect(guided).not.toBeVisible();
  await apply(page, "bent over the table on the floor");
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
    "floor",
  );
  await expect(fixed).not.toBeVisible();
  await expect(guided).not.toBeVisible();
  expect(errors).toEqual([]);
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { ARCHETYPES } from "../../src/nlp/archetypes.js";

const ready = async (page, timeout = 30_000) => {
  await expect(page.locator("#status")).toContainText("Ready", { timeout });
  await expect(page.locator("#save-preset")).toBeEnabled();
};
async function apply(page, description, timeout = 30_000) {
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await page.getByLabel("Pose description").fill(description);
  await page
    .getByRole("button", { name: "Apply description", exact: true })
    .click();
  await ready(page, timeout);
}
async function exportedScene(page) {
  await page.locator("#open-export").click();
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Editable preset/ }).click(),
  ]);
  const scene = JSON.parse(await readFile(await file.path(), "utf8")).presets[0]
    .scene;
  await page.keyboard.press("Escape");
  return scene;
}
async function clear(page, surface, guided = true) {
  const report = await page.evaluate(() => window.__straddleReport);
  expect(report.actors.map((a) => a.posture)).toEqual([
    "supine",
    "kneeling_straddle",
  ]);
  expect(report.actors.map((a) => a.supportBasis)).toEqual([
    "surface",
    "partner",
  ]);
  expect(report.actors[0].supportMeasurement).toBe("rendered");
  expect(report.actors[0].seatResidual).toBeLessThanOrEqual(0.004);
  expect(report.actors[0].supportPenetration).toBe(0);
  expect(report.actors[0].bodySupportResidual).toBeGreaterThan(0.06);
  expect(report.actors[1].seatResidual).toBeNull();
  expect(report.actors[1].bodySupportResidual).toBeNull();
  expect(report.quality.renderedBalance[0].supported).toBe(true);
  expect(report.quality.renderedBalance[1]).toBeNull();
  expect(
    report.quality.supportSurfaces[0].supports.map((s) => s.landmark),
  ).toEqual(["upperBack", "buttocks", "head"]);
  expect(
    report.quality.supportSurfaces[0].supports.every(
      ({ measurement: m }) =>
        m.withinFootprint &&
        m.plane === (surface === "bed" ? 0.55 : 0) &&
        m.gap <= 0.004 &&
        m.penetration === 0,
    ),
  ).toBe(true);
  expect(report.quality.contactDetail).toHaveLength(5);
  expect(
    report.quality.contactDetail.map((c) => [c.from, c.to, c.source]),
  ).toEqual([
    ["pelvis", "pelvis", "arrangement"],
    ["hand", "chest", "arrangement"],
    ["hand", "chest", "arrangement"],
    ["hand", "knee", "custom"],
    ["hand", "knee", "custom"],
  ]);
  for (const contact of report.quality.contactDetail) {
    expect(contact.basis).toBe("rendered");
    expect(contact.intersects).toBe(false);
    expect(contact.surfaceGap).toBeGreaterThanOrEqual(0.001);
    expect(contact.surfaceGap).toBeLessThanOrEqual(0.004);
  }
  expect(report.quality.figureSurfaces).toHaveLength(1);
  expect(
    report.quality.figureSurfaces.every((p) => p.intersects === false),
  ).toBe(true);
  expect(report.quality.propSurfaces).toHaveLength(surface === "bed" ? 2 : 0);
  expect(report.quality.propSurfaces.every((p) => p.intersects === false)).toBe(
    true,
  );
  expect(report.quality.floorSurfaces.every((p) => p.penetration === 0)).toBe(
    true,
  );
  expect(
    report.quality.adjustments.some((note) =>
      note.includes("guided starting pose"),
    ),
  ).toBe(guided);
  await expect(page.locator(".contact-result")).toHaveCount(5);
  await expect(page.locator(".contact-result.warning")).toHaveCount(0);
  await expect(page.locator(".notes .warning, .notes .error")).toHaveCount(0);
  return report;
}

for (const id of ["cowgirl", "reverse_cowgirl"]) {
  const definition = ARCHETYPES.find((a) => a.id === id);
  const phrase = definition.phrases[0];
  test(`${id}: bed and floor preserve five contacts through saved reload, export and fixed capture`, async ({
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
              window.__straddleReport = {
                actors: data.actors,
                quality: data.quality,
              };
          });
        }
      };
    });
    await page.goto(`/?preset=builtin.named.${id}`);
    await ready(page);
    await clear(page, "bed");
    await expect(page.getByLabel("Facing", { exact: true })).toHaveValue(
      id === "cowgirl" ? "as written" : "away",
    );
    await expect(
      page.getByText("2 figures use guided starting placement.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Contact type")).toHaveCount(2);
    for (const row of await page.locator(".contact-card").all())
      await expect(row.getByLabel("Contact type")).toHaveValue("support");
    await page.screenshot({ path: info.outputPath(`${id}-bed.png`) });
    await apply(page, `${phrase} on the floor`);
    await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
      "floor",
    );
    const before = await clear(page, "floor");
    await page.screenshot({ path: info.outputPath(`${id}-floor.png`) });
    await page.locator("#save-preset").click();
    await page.getByLabel("Preset name").fill(`${id} supported study`);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Save preset", exact: true })
      .click();
    await ready(page);
    await page.reload();
    await ready(page);
    await clear(page, "floor");
    const guided = await exportedScene(page);
    expect(guided.contacts).toEqual(definition.contacts);
    expect(guided.relationship.yaw ?? 0).toBe(definition.layout.yaw);
    guided.actors.forEach((a, i) =>
      expect(a).toMatchObject(definition.layout.actors[i]),
    );
    await page.getByRole("button", { name: "Figures", exact: true }).click();
    await page
      .getByRole("button", { name: "Capture current layout", exact: true })
      .click();
    await ready(page);
    const captured = await clear(page, "floor", false);
    captured.actors.forEach((a, i) => {
      a.root.position.forEach((v, k) =>
        expect(v).toBeCloseTo(before.actors[i].root.position[k], 7),
      );
      expect(a.joints).toEqual(before.actors[i].joints);
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
    expect(fixed.contacts).toEqual(definition.contacts);
    expect(
      fixed.actors.every(
        (a) => a.jointMode === "fixed" && a.placement.mode !== "guided",
      ),
    ).toBe(true);
    if (id === "reverse_cowgirl") {
      await page.setViewportSize({ width: 320, height: 844 });
      await page
        .getByRole("button", { name: "Edit", exact: false })
        .last()
        .click();
      await page.getByRole("button", { name: "Scene", exact: true }).click();
      const row = page.locator(".contact-card").first();
      await row.scrollIntoViewIfNeeded();
      await expect(row.getByLabel("Contact type")).toHaveValue("support");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath("held-knee-contacts-mobile.png"),
      });
    }
    expect(errors).toEqual([]);
  });

  test(`${id}: explicit height, opposite facing and unsupported surface remain editable variations`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/?preset=builtin.named.${id}`);
    await ready(page);
    const hint = page.getByText("2 figures use guided starting placement.", {
      exact: false,
    });
    await expect(hint).toBeVisible();
    // This uncalibrated body variation rebuilds the clothed models before
    // refinement (measured at 30.7 s in software Chrome). Preserve the usual
    // stock-pose readiness limit; allow bounded time for this explicit edit.
    await apply(
      page,
      `${phrase}, he is tall`,
      id === "reverse_cowgirl" ? 60_000 : 30_000,
    );
    await expect(hint).not.toBeVisible();
    await page.getByRole("button", { name: "Figures", exact: true }).click();
    await expect(
      page.locator(".actor-card").first().getByLabel("Height", { exact: true }),
    ).toHaveValue("1.85");
    await apply(page, `${phrase}, facing ${id === "cowgirl" ? "away" : "him"}`);
    await expect(page.getByLabel("Facing", { exact: true })).toHaveValue(
      id === "cowgirl" ? "away" : "as written",
    );
    await expect(hint).not.toBeVisible();
    await apply(page, `${phrase} on the chair`);
    await expect(page.getByLabel("Surface", { exact: true })).toHaveValue(
      "chair",
    );
    await expect(hint).not.toBeVisible();
    expect(errors).toEqual([]);
  });
}

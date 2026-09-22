import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { rootFromPlacement } from "../../src/core/placement.js";
import { quatRotate } from "../../src/core/math.js";

import { ready } from "./helpers/ready.js";
const placement = async (actor) => {
  const output = actor.getByLabel("Solved placement", { exact: true });
  return {
    position: JSON.parse(await output.getAttribute("data-position")),
    rotation: JSON.parse(await output.getAttribute("data-rotation")),
  };
};
function expectPlacement(actual, expected) {
  actual.position.forEach((value, i) =>
    expect(value).toBeCloseTo(expected.position[i], 7),
  );
  const a = rootFromPlacement(actual).quaternion,
    b = rootFromPlacement(expected).quaternion;
  for (const axis of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ])
    quatRotate(a, axis).forEach((value, i) =>
      expect(value).toBeCloseTo(quatRotate(b, axis)[i], 7),
    );
}

test("a complete captured layout preserves both figures through history, save, reload and JSON export", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?preset=builtin.named.standing_embrace");
  await ready(page);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  const actors = page.locator(".actor-card");
  const before = await Promise.all([
    placement(actors.nth(0)),
    placement(actors.nth(1)),
  ]);
  const capture = page.getByRole("button", {
    name: "Capture current layout",
    exact: true,
  });
  await capture.click();
  await expect(capture).toBeDisabled();
  await expect(
    actors.first().getByLabel("Solved placement", { exact: true }),
  ).not.toHaveAttribute("data-position", /.+/);
  await ready(page);
  for (let i = 0; i < 2; i++) {
    expectPlacement(await placement(actors.nth(i)), before[i]);
    await expect(
      actors.nth(i).getByLabel("Keep placement", { exact: true }),
    ).toBeChecked();
    await expect(
      actors.nth(i).getByLabel("Keep edited angles", { exact: true }),
    ).toBeChecked();
  }
  await expect(page.locator(".contact-result.warning")).toHaveCount(0);
  await page.locator("#undo").click();
  await ready(page);
  await expect(
    actors.first().getByLabel("Keep placement", { exact: true }),
  ).not.toBeChecked();
  await page.locator("#redo").click();
  await ready(page);
  for (let i = 0; i < 2; i++)
    expectPlacement(await placement(actors.nth(i)), before[i]);

  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Captured standing layout");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await ready(page);
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  for (let i = 0; i < 2; i++)
    expectPlacement(await placement(actors.nth(i)), before[i]);
  await expect(page.locator(".contact-result.warning")).toHaveCount(0);
  await page.locator("#open-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Editable preset/ }).click(),
  ]);
  const pack = JSON.parse(await readFile(await download.path(), "utf8"));
  for (let i = 0; i < 2; i++) {
    const actor = pack.presets[0].scene.actors[i];
    expectPlacement(actor.placement, before[i]);
    expect(actor.jointMode).toBe("fixed");
    expect(Object.keys(actor.joints).length).toBeGreaterThan(20);
  }
  await page.screenshot({ path: info.outputPath("captured-layout.png") });
  expect(errors).toEqual([]);
});

test("placement fields preserve untouched precision, validate edits, report support errors and reset on mobile", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  const actor = page.locator(".actor-card").first();
  await actor.getByText("Placement", { exact: true }).click();
  const keep = actor.getByLabel("Keep placement", { exact: true });
  const x = actor.getByLabel("Position X (m)", { exact: true });
  const y = actor.getByLabel("Position Y (m)", { exact: true });
  const yaw = actor.getByLabel("Rotation Y (degrees)", { exact: true });
  const original = await placement(actor);
  await expect(x).toBeDisabled();
  await keep.check();
  await ready(page);
  expectPlacement(await placement(actor), original);
  await expect(
    actor.getByLabel("Keep edited angles", { exact: true }),
  ).not.toBeChecked();
  const preciseX = 0.450123456789;
  await x.fill(String(preciseX));
  await x.press("Tab");
  await ready(page);
  const moved = await placement(actor);
  expect(moved.position[0]).toBe(preciseX);
  expect(moved.position.slice(1)).toEqual(original.position.slice(1));
  await yaw.fill("35");
  await yaw.press("Tab");
  await ready(page);
  await actor
    .getByRole("button", { name: "Capture solved pose", exact: true })
    .click();
  await ready(page);
  await expect(
    actor.getByLabel("Keep edited angles", { exact: true }),
  ).toBeChecked();
  const held = await placement(actor);
  const raised = Number((held.position[1] + 0.2).toFixed(3));
  await y.fill(String(raised));
  await y.press("Tab");
  await ready(page);
  expect((await placement(actor)).position[1]).toBe(raised);
  await expect(page.locator(".notes")).toContainText("support gap");

  await x.fill("11");
  await x.press("Tab");
  await expect(actor.getByRole("alert")).toContainText("must be a number");
  expect((await placement(actor)).position[0]).toBe(preciseX);
  await x.fill("0.25");
  await x.press("Tab");
  await ready(page);
  await expect(actor.getByRole("alert")).toBeEmpty();
  expect((await placement(actor)).position[0]).toBe(0.25);
  await page.locator("#undo").click();
  await ready(page);
  expect((await placement(actor)).position[0]).toBe(preciseX);
  await page.locator("#redo").click();
  await ready(page);
  expect((await placement(actor)).position[0]).toBe(0.25);
  await keep.uncheck();
  await ready(page);
  await expect(x).toBeDisabled();
  await expect(
    actor.getByLabel("Keep edited angles", { exact: true }),
  ).toBeChecked();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "Edit", exact: false }).last().click();
  await keep.scrollIntoViewIfNeeded();
  await expect(keep).toBeInViewport();
  const mobileCapture = actor.getByRole("button", {
    name: "Capture solved pose",
    exact: true,
  });
  const mobileBefore = await placement(actor);
  await mobileCapture.scrollIntoViewIfNeeded();
  await mobileCapture.click();
  await ready(page);
  await expect(keep).toBeChecked();
  await expect(x).toBeEnabled();
  expectPlacement(await placement(actor), mobileBefore);
  await keep.scrollIntoViewIfNeeded();
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
  await page.screenshot({ path: info.outputPath("placement-mobile.png") });
  expect(errors).toEqual([]);
});

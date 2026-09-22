import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

import { ready } from "./helpers/ready.js";
const solvedY = async (actor) =>
  JSON.parse(
    await actor
      .getByLabel("Solved placement", { exact: true })
      .getAttribute("data-position"),
  )[1];

test("guided placement can adjust, switch to fixed, survive history/reload/export and reset on mobile", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  const actor = page.locator(".actor-card").first();
  await actor.getByText("Placement", { exact: true }).click();
  const keep = actor.getByLabel("Keep placement", { exact: true });
  const y = actor.getByLabel("Position Y (m)", { exact: true });
  await actor
    .getByRole("button", { name: "Use solved pose as guide", exact: true })
    .click();
  await ready(page);
  await expect(
    actor.getByText("Placement (guided)", { exact: true }),
  ).toBeVisible();
  await expect(keep).not.toBeChecked();
  await expect(y).toBeEnabled();
  await y.fill("2");
  await y.press("Tab");
  await ready(page);
  await expect(y).toHaveValue("2");
  expect(await solvedY(actor)).toBeLessThan(1.2);
  await keep.check();
  await ready(page);
  await expect(
    actor.getByText("Placement (fixed)", { exact: true }),
  ).toBeVisible();
  await y.fill("2");
  await y.press("Tab");
  await ready(page);
  expect(await solvedY(actor)).toBeCloseTo(2, 7);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  await expect(keep).not.toBeChecked();
  await expect(y).toHaveValue("2");
  expect(await solvedY(actor)).toBeLessThan(1.2);
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Guided placement study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await ready(page);
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await actor.getByText("Placement (guided)", { exact: true }).click();
  await expect(keep).not.toBeChecked();
  await expect(y).toHaveValue("2");
  expect(await solvedY(actor)).toBeLessThan(1.2);
  await page.locator("#open-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Editable preset/ }).click(),
  ]);
  const scene = JSON.parse(await readFile(await download.path(), "utf8"))
    .presets[0].scene;
  expect(scene.actors[0].placement.mode).toBe("guided");
  expect(scene.actors[0].placement.position[1]).toBe(2);
  expect(scene.actors[0].jointMode).toBe("guided");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "Edit", exact: false }).last().click();
  await actor
    .getByRole("button", { name: "Use solved pose as guide", exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const audit = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(audit.violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("guided-placement-mobile.png"),
  });
  await actor
    .getByRole("button", { name: "Reset placement", exact: true })
    .click();
  await ready(page);
  await expect(actor.getByText("Placement", { exact: true })).toBeVisible();
  await expect(y).toBeDisabled();
  await expect(
    actor.getByRole("button", { name: "Reset placement", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

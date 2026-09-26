import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { serializeCatalog } from "../../src/core/catalog.js";

import { ready } from "./helpers/ready.js";
const fixture = {
  id: "fixture.joint-mode",
  title: "Precision study",
  description: "A clothed seated reference study.",
  category: "Seated",
  tags: ["authoring"],
  scene: {
    support: { surface: "chair" },
    relationship: { arrangement: "straddle_lap" },
    actors: [
      {
        bodyType: "male",
        posture: "seated",
        label: "Anchor",
        wearing: ["top", "shorts"],
      },
      {
        bodyType: "female",
        posture: "seated_straddle",
        label: "Guest",
        wearing: ["top", "shorts"],
        joints: {
          hip_l: { flexion: 45, abduction: 65 },
          hip_r: { flexion: 45, abduction: 65 },
          knee_l: { flexion: 110 },
          knee_r: { flexion: 110 },
        },
      },
    ],
  },
};

test("fixed edited channels and actual solved angles survive history, save, reload and export", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  await page.locator("#catalog-file").setInputFiles({
    name: "precision.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeCatalog([fixture])),
  });
  await page
    .getByRole("button", { name: "Load Precision study", exact: true })
    .click();
  await ready(page);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  const actor = page.locator(".actor-card").nth(1);
  await actor.getByText("Joints (4 set)", { exact: true }).click();
  await actor.getByLabel("Joint", { exact: true }).selectOption("hip_l");
  const keep = actor.getByLabel("Keep edited angles", { exact: true });
  const solved = actor.getByLabel("Solved joint angles", { exact: true });
  await expect(keep).not.toBeChecked();
  await expect(solved).toBeVisible();
  expect(Number(await solved.getAttribute("data-abduction"))).toBeLessThan(55);
  await expect(actor.getByLabel("Abduction", { exact: true })).toHaveValue(
    "65",
  );

  await keep.check();
  await ready(page);
  await expect(solved).toHaveAttribute("data-abduction", "65");
  await expect(solved).toHaveAttribute("data-flexion", "45");
  const pendingAngles = await actor
    .getByLabel("Flexion", { exact: true })
    .evaluate((node) => {
      node.value = "55";
      node.dispatchEvent(new Event("change", { bubbles: true }));
      return node.closest(".actor-card").querySelector(".solved-joints")
        .textContent;
    });
  expect(pendingAngles).toBe("No solved angles available yet.");
  await ready(page);
  await expect(solved).toHaveAttribute("data-flexion", "55");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  await expect(solved).toHaveAttribute("data-flexion", "45");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await ready(page);
  await expect(solved).toHaveAttribute("data-flexion", "55");
  await keep.uncheck();
  await ready(page);
  await expect(keep).not.toBeChecked();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  await expect(keep).toBeChecked();
  await expect(solved).toHaveAttribute("data-abduction", "65");

  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("My precise study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Update preset", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await ready(page);
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await actor.getByText("Joints (4 set)", { exact: true }).click();
  await actor.getByLabel("Joint", { exact: true }).selectOption("hip_l");
  await expect(keep).toBeChecked();
  await expect(solved).toHaveAttribute("data-abduction", "65");
  await expect(solved).toHaveAttribute("data-flexion", "55");
  await page.locator("#open-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Editable preset/ }).click(),
  ]);
  const exported = JSON.parse(await readFile(await download.path(), "utf8"))
    .presets[0].scene.actors[1];
  expect(exported.jointMode).toBe("fixed");
  expect(exported.joints.hip_l).toEqual({ flexion: 55, abduction: 65 });

  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "Edit", exact: false }).last().click();
  await keep.scrollIntoViewIfNeeded();
  await expect(keep).toBeInViewport();
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
  await page.screenshot({ path: info.outputPath("fixed-joints-mobile.png") });
  expect(errors).toEqual([]);
});

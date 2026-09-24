import { ready } from "./helpers/ready.js";
import { openLibraryFilters } from "./helpers/library.js";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

test("positions are a visible collection and collection filters stay usable on narrow screens", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Positions", exact: true }).click();
  await expect(page.locator(".library-title > span")).toHaveText(
    "1,295 studies",
  );
  await expect(page.locator(".preset-card")).toHaveCount(24);
  await expect(
    page.getByRole("button", { name: "Load Missionary", exact: true }),
  ).toBeVisible();
  await openLibraryFilters(page);
  await page.getByLabel("Category", { exact: true }).selectOption("Side-lying");
  await expect(page.locator(".preset-card")).toHaveCount(2);
  await page.getByLabel("Category", { exact: true }).selectOption("all");
  await page.getByLabel("Search presets").fill("拥抱");
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await page.getByLabel("Search presets").fill("");
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page
      .getByRole("button", { name: "Library", exact: false })
      .last()
      .click();
    await expect(
      page.getByRole("button", { name: "Positions", exact: true }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("positions-mobile.png") });
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(0);
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(24);
});

test("unread description text remains visible as a warning through the worker and draft reload", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await page
    .getByLabel("Pose description")
    .fill("a woman standing flibbertigibbet");
  await page
    .getByRole("button", { name: "Apply description", exact: true })
    .click();
  await ready(page);
  await expect(page.locator(".notes")).toContainText("flibbertigibbet");
  await expect(page.locator("#show-notes")).toBeVisible();
  await page.locator("#show-notes").click();
  await expect(page.locator(".notes")).toBeVisible();
  await page.reload();
  await ready(page);
  await expect(page.locator(".notes")).toContainText("flibbertigibbet");
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Command study");
  await page
    .getByRole("dialog")
    .getByLabel("Description", { exact: true })
    .fill("A personal catalog caption.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await expect(page.locator("#scene-description")).toHaveText(
    "A personal catalog caption.",
  );
  await expect(page.getByLabel("Pose description")).toHaveValue(
    "a woman standing flibbertigibbet",
  );
  await page.locator("#open-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Editable preset/ }).click(),
  ]);
  const entry = JSON.parse(await readFile(await download.path(), "utf8"))
    .presets[0];
  expect(entry.description).toBe("A personal catalog caption.");
  expect(entry.scene.description).toBe("a woman standing flibbertigibbet");
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ready } from "./helpers/ready.js";
import { openLibraryFilters } from "./helpers/library.js";

// These tests cover the first-visit layout: library open, editor closed.
test.use({ storageState: { cookies: [], origins: [] } });
let errors;
test.beforeEach(async ({ context }) => {
  errors = [];
  const watch = (page) =>
    page.on("pageerror", (error) => errors.push(error.message));
  context.pages().forEach(watch);
  context.on("page", watch);
});
test.afterEach(() => expect(errors).toEqual([]));
async function start(page) {
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
}
async function positions(page) {
  await page.getByRole("button", { name: "Positions", exact: true }).click();
  await openLibraryFilters(page);
  await page.getByLabel("Support status").selectOption("interaction-3d");
  await page.getByRole("button", { name: "Filters (1)", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(24);
}
const noOverflow = async (page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
async function axe(page) {
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
}

test("compact desktop and mobile layouts expose more rows and give the scene the window", async ({
  page,
}, info) => {
  await start(page);
  const measurements = [];
  for (const [width, height] of [
    [1440, 844],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [320, 700],
  ]) {
    await page.setViewportSize({ width, height });
    if (width <= 900) await page.locator('[data-region="library"]').click();
    await positions(page);
    const metrics = await page.evaluate(
      ({ width, height }) => {
        const list = document
          .querySelector(".catalog-list")
          .getBoundingClientRect();
        const cards = [...document.querySelectorAll(".preset-card")].map(
          (n) => n.getBoundingClientRect(),
        );
        const canvas = document
          .querySelector("#viewport")
          .getBoundingClientRect();
        return {
          width,
          height,
          headerHeight: document
            .querySelector(".topbar")
            .getBoundingClientRect().height,
          libraryTopHeight: document
            .querySelector(".library-top")
            .getBoundingClientRect().height,
          listHeight: list.height,
          fullyVisibleCards: cards.filter(
            (r) => r.top >= list.top && r.bottom <= list.bottom,
          ).length,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
        };
      },
      { width, height },
    );
    measurements.push(metrics);
    expect(metrics.headerHeight).toBe(56);
    expect(metrics.libraryTopHeight).toBeLessThanOrEqual(245);
    expect(metrics.fullyVisibleCards).toBeGreaterThanOrEqual(
      width === 320 ? 2 : 3,
    );
    if (width > 900) {
      // The canvas runs under the transparent top bar and beside the drawer.
      expect(metrics.canvasHeight).toBe(height);
      expect(metrics.canvasWidth).toBeGreaterThanOrEqual(width - 330);
    }
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: /^Filters/ }),
    ).toBeInViewport();
    await expect(page.locator("#catalog-filters")).toBeHidden();
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath(`compact-library-${width}.png`),
    });
  }
  await info.attach("compact-layout-measurements", {
    body: JSON.stringify(measurements),
    contentType: "application/json",
  });
});

test("categories disclose, filters reset pagination, and search clears without losing focus", async ({
  page,
}) => {
  await start(page);
  await positions(page);
  await openLibraryFilters(page);
  await page.getByLabel("Category", { exact: true }).selectOption("From behind");
  await expect(
    page.getByRole("button", { name: "Filters (2)", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Category", { exact: true }).selectOption("all");
  await page.getByRole("button", { name: "Filters (1)", exact: true }).click();
  await expect(page.locator("#catalog-filters")).toBeHidden();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("#catalog-page")).toHaveText("2 / 54");
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(page.locator("#catalog-page")).toHaveText("1 / 55");
  await expect(page.locator(".library-title > span")).toHaveText(
    "1,306 positions",
  );
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toBeFocused();
  await page.getByLabel("Search positions").fill("img-0001");
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByLabel("Search positions")).toBeFocused();
  await expect(page.locator(".preset-card")).toHaveCount(24);
  await openLibraryFilters(page);
  await page.getByLabel("Category", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#catalog-filters")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toBeFocused();
});

test("drawers give the window back to the scene, persist, and / reopens search without hijacking typing", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    window.__bodyRequests = 0;
    Worker.prototype.postMessage = function (data, ...args) {
      if (data?.scene && !data?.key) window.__bodyRequests++;
      return original.call(this, data, ...args);
    };
  });
  await start(page);
  const requests = await page.evaluate(() => window.__bodyRequests);
  const library = page.getByRole("button", { name: "Library", exact: true });
  const editor = page.getByRole("button", { name: "Edit", exact: true });
  await expect(library).toHaveAttribute("aria-expanded", "true");
  await expect(editor).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#panel")).toBeHidden();
  await library.click();
  await expect(library).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#library")).toBeHidden();
  await expect
    .poll(async () => (await page.locator("#viewport").boundingBox()).width)
    .toBe(1440);
  await page.screenshot({ path: info.outputPath("scene-only.png") });
  await editor.click();
  await expect(editor).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Pose description")).toBeVisible();
  await expect
    .poll(async () => (await page.locator("#viewport").boundingBox()).width)
    .toBeLessThan(1440 - 300);
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("A / typed title");
  await page.keyboard.press("/");
  await expect(page.getByLabel("Preset name")).toHaveValue("A / typed title/");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#library")).toBeHidden();
  await page.keyboard.press("/");
  await expect(library).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Search positions")).toBeFocused();
  await page.keyboard.type("/");
  await expect(page.getByLabel("Search positions")).toHaveValue("/");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByLabel("Pose description").focus();
  await page.keyboard.press("/");
  await expect(page.getByLabel("Pose description")).toBeFocused();
  await expect(page.locator("#scene-title")).toHaveText("Standing · female");
  expect(await page.evaluate(() => window.__bodyRequests)).toBe(requests);
  await page.reload();
  await ready(page);
  await expect(library).toHaveAttribute("aria-expanded", "true");
  await expect(editor).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#library")).toBeVisible();
  await expect(page.locator("#panel")).toBeVisible();
});

test("responsive transitions and short landscape screens keep editing, filters and camera actions reachable", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Library", exact: true }).focus();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#toggle-library")).toBeHidden();
  await expect(page.locator("#toggle-inspector")).toBeHidden();
  await expect(page.locator('[data-region="studio"]')).toBeFocused();
  await expect(page.locator("#stage")).toBeVisible();
  await page.locator('[data-region="edit"]').click();
  await expect(page.getByLabel("Pose description")).toBeVisible();
  await page.getByText("Contact help", { exact: true }).click();
  await expect(page.locator(".contact-help")).toHaveAttribute("open", "");
  await page.getByText("Contact help", { exact: true }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('[data-region="library"]').click();
  await positions(page);
  await openLibraryFilters(page);
  await page.getByLabel("Category", { exact: true }).selectOption("From behind");
  await page.getByRole("button", { name: "Filters (2)", exact: true }).click();
  await page
    .getByRole("button", { name: "Next", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeInViewport();
  await page.locator('[data-region="studio"]').click();
  await page
    .getByRole("button", { name: "Zoom in", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Zoom in", exact: true }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Fit figures", exact: true }).click();
  await noOverflow(page);
  // Visiting the editor on a small screen opens its drawer at desktop width.
  await page.setViewportSize({ width: 1440, height: 844 });
  await expect(page.locator("#library")).toBeVisible();
  await expect(page.locator("#panel")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
});

test("compact controls, filters, information dialogs and enlarged text remain accessible", async ({
  page,
}, info) => {
  await start(page);
  await axe(page);
  await page
    .getByRole("button", { name: "About this library", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "plus 23 studio presets",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "1,283 source-linked 3D positions",
  );
  await axe(page);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "About this library", exact: true }),
  ).toBeFocused();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[data-region="library"]').click();
    await positions(page);
    await openLibraryFilters(page);
    await axe(page);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.locator('[data-region="edit"]').click();
    await page.getByRole("button", { name: "Figures", exact: true }).click();
    await axe(page);
    await page.screenshot({
      path: info.outputPath(`compact-editor-${width}.png`),
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator('[data-region="library"]').click();
  await page.addStyleTag({
    content:
      "button, input, select, textarea, label, .preset-name { font-size: 16px !important; }",
  });
  await noOverflow(page);
  await page
    .getByRole("button", { name: "Next", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeInViewport();
});

test("keyboard-focused fields scroll below the sticky inspector tabs", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page.getByText("Appearance", { exact: true }).click();
  await page.getByText("Joints", { exact: true }).click();
  for (const width of [390, 1440, 320]) {
    await page.setViewportSize({ width, height: 844 });
    if (width <= 900) await page.locator('[data-region="edit"]').click();
    const control = page.getByLabel("Body type", { exact: true });
    await control.evaluate((node) => {
      const panel = document.querySelector("#panel");
      node.blur();
      panel.scrollTop +=
        node.getBoundingClientRect().top -
        panel.getBoundingClientRect().top -
        20;
      node.focus();
    });
    await expect(control).toBeFocused();
    await expect
      .poll(() =>
        control.evaluate(
          (node) =>
            node.getBoundingClientRect().top >=
            document.querySelector(".inspector-heading").getBoundingClientRect()
              .bottom,
        ),
      )
      .toBe(true);
    await expect(control).toBeInViewport();
  }
});

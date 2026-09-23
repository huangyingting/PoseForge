import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ready } from "./helpers/ready.js";
import { openLibraryFilters } from "./helpers/library.js";

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
async function references(page) {
  await page.getByRole("button", { name: "References", exact: true }).click();
  await expect(page.locator(".reference-card")).toHaveCount(24);
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

test("compact desktop and mobile layouts expose more rows and reserve the canvas for the scene", async ({
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
    await references(page);
    const metrics = await page.evaluate(
      ({ width, height }) => {
        const list = document
          .querySelector(".catalog-list")
          .getBoundingClientRect();
        const cards = [...document.querySelectorAll(".reference-card")].map(
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
    expect(metrics.libraryTopHeight).toBeLessThanOrEqual(230);
    expect(metrics.fullyVisibleCards).toBeGreaterThanOrEqual(
      width === 320 ? 4 : 5,
    );
    if (width === 1440) expect(metrics.canvasHeight).toBeGreaterThan(620);
    await expect(
      page.getByRole("button", { name: "Next", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Filters", exact: true }),
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

test("filters disclose, stay indicated while closed, reset pagination, and clear search without losing focus", async ({
  page,
}) => {
  await start(page);
  await references(page);
  await openLibraryFilters(page);
  await page.getByLabel("Support status").selectOption("artistic-3d");
  await page.getByLabel("Group matching annotations").check();
  await expect(page.locator(".library-title > span")).toHaveText("379 groups");
  await page.getByLabel("Family", { exact: true }).selectOption("Standing");
  await expect(
    page.getByRole("button", { name: "Filters (3)", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Family", { exact: true }).selectOption("all");
  await page.getByRole("button", { name: "Filters (2)", exact: true }).click();
  await expect(page.locator("#catalog-filters")).toBeHidden();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator("#catalog-page")).toHaveText("2 / 16");
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(page.locator("#catalog-page")).toHaveText("1 / 54");
  await expect(page.locator(".library-title > span")).toHaveText(
    "1,283 references",
  );
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toBeFocused();
  await page.getByLabel("Search references").fill("img-0001");
  await expect(page.locator(".reference-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.getByLabel("Search references")).toBeFocused();
  await expect(page.locator(".reference-card")).toHaveCount(24);
  await openLibraryFilters(page);
  await page.getByLabel("Family", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator("#catalog-filters")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Filters", exact: true }),
  ).toBeFocused();
});

test("focus view and search shortcuts preserve the scene, honor dialogs and leave typing alone", async ({
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
  const before = await page.locator("#viewport").boundingBox();
  const focus = page.getByRole("button", { name: "Focus view", exact: true });
  await focus.click();
  await expect(focus).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#library")).toBeHidden();
  await expect(page.locator("#panel")).toBeHidden();
  expect((await page.locator("#viewport").boundingBox()).width).toBeGreaterThan(
    before.width + 400,
  );
  await page.screenshot({ path: info.outputPath("focus-view.png") });
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("A / typed title");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(focus).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#library")).toBeVisible();
  await expect(focus).toBeFocused();
  await focus.click();
  await page.keyboard.press("/");
  await expect(focus).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Search presets")).toBeFocused();
  await page.keyboard.type("/");
  await expect(page.getByLabel("Search presets")).toHaveValue("/");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByLabel("Pose description").focus();
  await page.keyboard.press("/");
  await expect(page.getByLabel("Pose description")).toBeFocused();
  await expect(page.locator("#scene-title")).toHaveText("Standing · female");
  expect(await page.evaluate(() => window.__bodyRequests)).toBe(requests);
});

test("responsive transitions and short landscape screens keep editing, filters and camera actions reachable", async ({
  page,
}) => {
  await start(page);
  await page.getByRole("button", { name: "Focus view", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#app")).toHaveAttribute("data-focus", "false");
  await expect(page.locator("#focus-view")).toBeHidden();
  await expect(page.locator("#stage")).toBeVisible();
  await page.locator('[data-region="edit"]').click();
  await expect(page.getByLabel("Pose description")).toBeVisible();
  await page.getByText("Contact help", { exact: true }).click();
  await expect(page.locator(".contact-help")).toHaveAttribute("open", "");
  await page.getByText("Contact help", { exact: true }).click();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator('[data-region="library"]').click();
  await references(page);
  await openLibraryFilters(page);
  await page.getByLabel("Family", { exact: true }).selectOption("Standing");
  await page.getByRole("button", { name: "Filters (1)", exact: true }).click();
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
  await page.setViewportSize({ width: 1440, height: 844 });
  await expect(page.locator("#library")).toBeVisible();
  await expect(page.locator("#panel")).toBeVisible();
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
    "23 verified stock 3D presets",
  );
  await expect(page.getByRole("dialog")).toContainText(
    "1,283 source references",
  );
  await axe(page);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "About this library", exact: true }),
  ).toBeFocused();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('[data-region="library"]').click();
    await references(page);
    await openLibraryFilters(page);
    await axe(page);
    await page.getByRole("button", { name: "Filters", exact: true }).click();
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
      "button, input, select, textarea, label, .preset-name, .reference-family { font-size: 16px !important; }",
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

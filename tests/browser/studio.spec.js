import { test, expect } from "@playwright/test";
import {
  BUILTIN_PRESETS,
  STUDIO_PRESETS,
  serializeCatalog,
} from "../../src/core/catalog.js";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

const ready = async (page) => {
  await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#save-preset")).toBeEnabled();
};
const load = async (page, name) => {
  await page.getByRole("button", { name: `Load ${name}`, exact: true }).click();
  await ready(page);
};

test("long metadata fits narrow screens and keyboard selection preserves focus", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const preset = structuredClone(BUILTIN_PRESETS[1]);
  preset.title = "Study".repeat(16);
  preset.description = "A calm reference study. ".repeat(20);
  preset.category = "Category".repeat(5);
  await page.locator("#catalog-file").setInputFiles({
    name: "long.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeCatalog([preset])),
  });
  const card = page.getByRole("button", {
    name: `Load ${preset.title}`,
    exact: true,
  });
  await card.focus();
  await page.keyboard.press("Enter");
  await ready(page);
  await expect(card).toBeFocused();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.locator("#fit-view")).toBeInViewport();
  }
});

test("catalog, figure edits, undo, save, update, duplicate, reload and delete", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await ready(page);
  await expect(page.locator(".preset-name").first()).toBeInViewport();
  await page.getByLabel("Search presets").fill("kneel");
  await expect(page.locator(".preset-card")).toHaveCount(6);
  await page.getByLabel("Category", { exact: true }).selectOption("Together");
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await page.getByLabel("Search presets").fill("");
  await page.getByLabel("Category", { exact: true }).selectOption("all");
  await page
    .getByRole("button", { name: "Favorite Standing · female", exact: true })
    .click();
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await load(page, "Standing · female");
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page.getByLabel("Body type", { exact: true }).selectOption("male");
  await ready(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  await expect(page.getByLabel("Body type", { exact: true })).toHaveValue(
    "female",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await ready(page);
  await expect(page.getByLabel("Body type", { exact: true })).toHaveValue(
    "male",
  );
  await page.getByText("Appearance", { exact: true }).click();
  await page.getByLabel("Colour", { exact: true }).selectOption("sage");
  await ready(page);
  await page.getByLabel("Height", { exact: true }).evaluate((node) => {
    node.value = "1.85";
  });
  await page.getByLabel("Height", { exact: true }).dispatchEvent("change");
  await ready(page);
  await page.getByText("Joints", { exact: true }).click();
  await page.getByLabel("Joint", { exact: true }).selectOption("elbow_l");
  await page.getByLabel("Flexion", { exact: true }).evaluate((node) => {
    node.value = "60";
  });
  await page.getByLabel("Flexion", { exact: true }).dispatchEvent("change");
  await ready(page);
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("My standing study");
  await page.getByLabel("Category", { exact: true }).last().fill("Portraits");
  await page
    .getByLabel("Tags (separate with commas)")
    .fill("personal, standing");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#scene-title")).toHaveText("My standing study");
  await page.reload();
  await ready(page);
  await expect(page.locator("#scene-title")).toHaveText("My standing study");
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(page.getByLabel("Height", { exact: true })).toHaveValue("1.85");
  await page.getByText("Joints (1 set)", { exact: true }).click();
  await page.getByLabel("Joint", { exact: true }).selectOption("elbow_l");
  await expect(page.getByLabel("Flexion", { exact: true })).toHaveValue("60");
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Renamed study");
  await page
    .getByRole("button", { name: "Update preset", exact: true })
    .click();
  await expect(page.locator("#scene-title")).toHaveText("Renamed study");
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Study copy");
  await page.getByRole("button", { name: "Save a copy", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(2);
  await page.locator("#save-preset").click();
  await page
    .getByRole("button", { name: "Delete preset", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await expect(page.locator("#scene-badge")).toHaveText("Unsaved changes");
  expect(errors).toEqual([]);
});

test("valid and invalid imports are atomic, and downloaded JSON reloads", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const file = page.locator("#catalog-file");
  await file.setInputFiles({
    name: "studies.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeCatalog([BUILTIN_PRESETS[1]])),
  });
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await load(page, "Standing · female");
  await file.setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(page.locator("#toast")).toContainText("Import failed");
  await expect(page.locator(".preset-card")).toHaveCount(1);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export library ↗", exact: true }).click(),
  ]);
  const pack = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(pack.presets).toHaveLength(1);
  expect(pack.presets[0].scene.actors[0].wearing).toEqual(["top", "shorts"]);
  await file.setInputFiles({
    name: "repeat.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pack)),
  });
  await expect(page.locator(".preset-card")).toHaveCount(2);
});

test("description, figure controls and workspace draft preserve the latest edits", async ({
  page,
}) => {
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(page.getByLabel("Height", { exact: true })).toHaveValue("1.66");
  await page.getByLabel("Body type").selectOption("male");
  await ready(page);
  await expect(page.getByLabel("Height", { exact: true })).toHaveValue("1.78");
  await page.getByText("Appearance", { exact: true }).click();
  await page.getByLabel("Hair", { exact: true }).selectOption("short");
  await ready(page);
  await page.getByLabel("Skin tone", { exact: true }).fill("#af7951");
  await page.getByLabel("Skin tone", { exact: true }).dispatchEvent("change");
  await ready(page);
  await page.getByRole("button", { name: "+ Add figure", exact: true }).click();
  await ready(page);
  await expect(page.locator(".actor-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Remove figure", exact: true })
    .last()
    .click();
  await ready(page);
  await expect(page.locator(".actor-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await page.getByLabel("Pose description").fill("a woman seated on a chair");
  await page
    .getByRole("button", { name: "Apply description", exact: true })
    .click();
  await ready(page);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(page.getByLabel("Posture", { exact: true })).toHaveValue(
    "seated",
  );
  await page.getByText("Hands & feet", { exact: true }).click();
  await page.getByLabel("Left hand", { exact: true }).selectOption("relaxed");
  await ready(page);
  await page.reload();
  await ready(page);
  await expect(page.locator("#scene-title")).toHaveText("Custom study");
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(page.getByLabel("Posture", { exact: true })).toHaveValue(
    "seated",
  );
  await page.getByText("Hands & feet", { exact: true }).click();
  await expect(page.getByLabel("Left hand", { exact: true })).toHaveValue(
    "relaxed",
  );
});

test("PNG, transparent PNG, SVG and editable preset downloads contain real output", async ({
  page,
}) => {
  await page.goto("/?preset=builtin.standing-male");
  await ready(page);
  for (const [name, extension] of [
    ["PNG image", "png"],
    ["Transparent PNG", "png"],
    ["SVG line art", "svg"],
    ["Editable preset", "json"],
  ]) {
    await page.locator("#open-export").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: new RegExp(`^${name}`) }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`\\.${extension}$`),
    );
    const bytes = await readFile(await download.path());
    expect(bytes.length).toBeGreaterThan(extension === "json" ? 400 : 1000);
    if (extension === "png") {
      expect(bytes.subarray(1, 4).toString()).toBe("PNG");
      const decoded = await page.evaluate(async (encoded) => {
        const raw = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(
          new Blob([raw], { type: "image/png" }),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        let opaque = 0;
        for (let i = 3; i < pixels.length; i += 4)
          if (pixels[i] > 200) opaque++;
        return { width: bitmap.width, cornerAlpha: pixels[3], opaque };
      }, bytes.toString("base64"));
      expect(decoded.width).toBeGreaterThan(500);
      expect(decoded.opaque).toBeGreaterThan(1000);
      expect(decoded.cornerAlpha).toBe(name === "Transparent PNG" ? 0 : 255);
    }
    if (extension === "svg") expect(bytes.toString()).toContain("<svg");
    if (extension === "json")
      expect(
        JSON.parse(bytes.toString()).presets[0].scene.actors[0].bodyType,
      ).toBe("male");
    await ready(page);
  }
});

test("reference studies render, camera and material work, desktop has no overflow", async ({
  page,
}, testInfo) => {
  const errors = [],
    failures = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (req) => failures.push(req.url()));
  await page.goto("/");
  await ready(page);
  for (const preset of STUDIO_PRESETS) {
    await load(page, preset.title);
    await expect(page.locator("#scene-title")).toHaveText(preset.title);
    await expect(page.locator(".notes .warning, .notes .error")).toHaveCount(0);
  }
  await load(page, "Side by side");
  await page.getByRole("button", { name: "Front", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Front", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Material", { exact: true }).selectOption("clay");
  await page.locator("#viewport").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await page.keyboard.press("f");
  await page.getByLabel("Material", { exact: true }).selectOption("natural");
  await page.getByRole("button", { name: "3D", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("desktop.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

test("mobile library, inspector, editing, saving and export remain reachable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await ready(page);
  await page.screenshot({ path: testInfo.outputPath("mobile-studio.png") });
  await page
    .getByRole("button", { name: "Library", exact: false })
    .last()
    .click();
  await load(page, "Standing · male");
  await expect(page.locator("#stage")).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: false }).last().click();
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page.getByLabel("Body type").selectOption("female");
  await ready(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  await expect(page.getByLabel("Body type")).toHaveValue("male");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await ready(page);
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Mobile study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await page.screenshot({ path: testInfo.outputPath("mobile-editor.png") });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.locator("#open-export").click();
      await page.getByRole("button", { name: /^PNG image/ }).click();
    })(),
  ]);
  expect((await readFile(await download.path())).length).toBeGreaterThan(1000);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("desktop, mobile and save dialog meet automated accessibility checks", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  const audit = async () =>
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  await audit();
  await page.locator("#save-preset").click();
  await audit();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await audit();
  await page.getByRole("button", { name: "Edit", exact: false }).last().click();
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await audit();
});

test("corrupt library can be recovered and a blocked WebGL preview keeps JSON editing usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("poseforge.library.v1", "broken");
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.includes("webgl") ? null : original.call(this, type, ...args);
    };
  });
  await page.goto("/");
  await ready(page);
  await expect(page.locator("#viewport-error")).toContainText(
    "3D preview is unavailable",
  );
  await expect(page.locator(".recovery")).toBeVisible();
  await page.getByRole("button", { name: "Reset saved library" }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.locator(".recovery")).toHaveCount(0);
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Recovered study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await expect(page.locator("#scene-title")).toHaveText("Recovered study");
});

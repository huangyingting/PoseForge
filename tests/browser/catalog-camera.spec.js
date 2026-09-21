import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { NAMED_PRESETS, serializeCatalog } from "../../src/core/catalog.js";

const ready = async (page) => {
  await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#save-preset")).toBeEnabled();
};
const pixels = async (page) =>
  createHash("sha256")
    .update(
      await page.locator("#viewport").evaluate((canvas) => canvas.toDataURL()),
    )
    .digest("hex");

test("every existing named definition loads and renders; known quality notes are discoverable", async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors = [],
    failures = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => failures.push(request.url()));
  // Observe only the public support metadata, not mesh buffers or storage.
  // UI assertions should track the returned pose, not require a catalog defect
  // (such as today's particular floating gap) to remain forever.
  await page.addInitScript(() => {
    const NativePoseWorker = window.Worker;
    window.Worker = class extends NativePoseWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.stage === "final")
            window.__latestSupportReport = data.actors.map(
              ({
                label,
                supportBasis,
                seatResidual,
                supportMeasurement,
                supportPenetration,
              }) => ({
                label,
                supportBasis,
                seatResidual,
                supportMeasurement,
                supportPenetration,
              }),
            );
        });
      }
    };
  });
  await page.goto("/");
  await ready(page);
  for (const preset of NAMED_PRESETS) {
    await page
      .getByRole("button", { name: `Load ${preset.title}`, exact: true })
      .click();
    await ready(page);
    await expect(page.locator("#scene-title")).toHaveText(preset.title);
    await expect(page.locator(".preset-card.selected svg")).toHaveAttribute(
      "data-basis",
      "refined",
    );
    const support = await page.evaluate(() => window.__latestSupportReport);
    expect(support).toHaveLength(preset.scene.actors.length);
    for (const actor of support) {
      if (actor.supportBasis === "surface" && actor.seatResidual > 0.02) {
        const kind =
          actor.supportMeasurement === "rendered" &&
          actor.supportPenetration >= actor.seatResidual - 1e-9
            ? "support penetration"
            : "support gap";
        await expect(page.locator(".notes")).toContainText(
          `${actor.label} has a ${Math.round(actor.seatResidual * 1000)} mm ${actor.supportMeasurement ? `${actor.supportMeasurement} ` : ""}${kind}.`,
        );
      }
      if (actor.supportBasis === "partner") {
        expect(actor.seatResidual).toBeNull();
        await expect(page.locator(".notes")).not.toContainText(
          `${actor.label} has a `,
        );
      }
    }
    if (preset.id === "builtin.named.standing_embrace") {
      await expect(page.locator(".contact-result.warning")).toHaveCount(0);
      await expect(page.locator(".contact-result")).toHaveCount(4);
      await expect(page.getByText(/adjusted the standing stance/)).toHaveCount(
        1,
      );
      await page.screenshot({
        path: info.outputPath("standing-clearance.png"),
      });
    }
    if (
      [
        "builtin.named.chair_straddle",
        "builtin.named.lotus",
        "builtin.named.standing_carry",
        "builtin.named.bent_over_table",
      ].includes(preset.id)
    ) {
      await expect(page.locator(".contact-result.warning")).toHaveCount(0);
      await expect(page.locator(".contact-result")).toHaveCount(
        [
          "builtin.named.chair_straddle",
          "builtin.named.bent_over_table",
        ].includes(preset.id)
          ? 3
          : 5,
      );
      await expect(page.locator(".notes .warning, .notes .error")).toHaveCount(
        0,
      );
    }
  }
  await page.getByLabel("Search presets").fill("拥抱");
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await page.getByLabel("Search presets").fill("");
  // Keep warning navigation covered even after all bundled layouts are fixed.
  const warning = structuredClone(
    NAMED_PRESETS.find((p) => p.id === "builtin.named.chair_straddle"),
  );
  warning.id = "test.unreachable-contact";
  warning.title = "Unreachable contact study";
  for (const actor of warning.scene.actors) {
    delete actor.placement.mode;
    actor.jointMode = "fixed";
  }
  warning.scene.actors[1].placement.position[0] += 2.5;
  await page.locator("#catalog-file").setInputFiles({
    name: "unreachable-contact.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeCatalog([warning])),
  });
  await page
    .getByRole("button", {
      name: "Load Unreachable contact study",
      exact: true,
    })
    .click();
  await ready(page);
  await expect(page.locator("#show-notes")).toBeVisible();
  await page.locator("#show-notes").click();
  await expect(page.locator(".contact-result.warning").first()).toBeFocused();
  await page.getByLabel("Search presets").fill("standing");
  await page.screenshot({ path: info.outputPath("solved-library.png") });
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

test("preview failure preserves the library and loading a pose supplies its final preview", async ({
  page,
  context,
}) => {
  await context.route("**/previewWorker-*.js", (route) =>
    route.abort("failed"),
  );
  await page.goto("/");
  await ready(page);
  const card = page.getByRole("button", {
    name: "Load Standing · male",
    exact: true,
  });
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator(".preset-note")).toHaveText("Preview unavailable");
  await card.click();
  await ready(page);
  await expect(page.locator(".preset-card.selected svg")).toHaveAttribute(
    "data-basis",
    "refined",
  );
  await expect(page.locator("#scene-title")).toHaveText("Standing · male");
});

test("live refined previews survive filter changes and match saved copies", async ({
  page,
}) => {
  await page.goto("/?preset=builtin.helping-hand");
  await ready(page);
  const image = page.locator(".preset-card.selected svg");
  await expect(image).toHaveAttribute("data-basis", "refined");
  const before = await image.evaluate((node) => node.innerHTML);
  await page.getByLabel("Search presets").fill("no matching study");
  await expect(page.locator(".preset-card")).toHaveCount(0);
  await page.getByLabel("Search presets").fill("");
  await expect(image).toHaveAttribute("data-basis", "refined");
  expect(await image.evaluate((node) => node.innerHTML)).toBe(before);
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Diagram copy");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await expect(image).toHaveAttribute("data-basis", "refined");
  expect(await image.evaluate((node) => node.innerHTML)).toBe(before);
});

test.describe("mobile camera", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("trusted pinch/cancel gestures, buttons and keyboard change the rendered camera without overflow", async ({
    page,
    context,
  }, info) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await ready(page);
    await page.waitForLoadState("networkidle");
    const before = await pixels(page);
    const box = await page.locator("#viewport").boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const client = await context.newCDPSession(page);
    const points = (spread) => [
      { id: 1, x: x - spread, y },
      { id: 2, x: x + spread, y },
    ];
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(35),
    });
    for (const spread of [45, 55, 65])
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points(spread),
      });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });
    await expect.poll(() => pixels(page)).not.toBe(before);
    await expect(
      page.getByRole("button", { name: "3D", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const pinched = await pixels(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ id: 3, x, y }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 3, x: x + 35, y: y + 8 }],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect.poll(() => pixels(page)).not.toBe(pinched);
    await expect(
      page.getByRole("button", { name: "3D", exact: true }),
    ).toHaveAttribute("aria-pressed", "false");
    const orbited = await pixels(page);
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect.poll(() => pixels(page)).not.toBe(orbited);
    const zoomedOut = await pixels(page);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect.poll(() => pixels(page)).not.toBe(zoomedOut);
    await page.locator("#viewport").focus();
    await page.keyboard.press("f");
    await page.getByRole("button", { name: "3D", exact: true }).click();
    await page.screenshot({ path: info.outputPath("mobile-camera.png") });
    await page
      .getByRole("button", { name: "Library", exact: false })
      .last()
      .click();
    await page.getByRole("link", { name: "Skip to the studio" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#viewport")).toBeVisible();
    await expect(page.locator("#viewport")).toBeFocused();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(
        page.getByRole("button", { name: "Zoom in", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "Zoom out", exact: true }),
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
    expect(errors).toEqual([]);
  });
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { HAIR_STYLES } from "../../src/core/hair.js";
import {
  CUPPED,
  GARMENT_COLOURS,
  GARMENT_LABELS,
  GARMENT_NAMES,
  GARMENT_SLOTS,
  OUTFITS,
} from "../../src/core/garments.js";
import { HAND_SHAPE_NAMES } from "../../src/core/handPose.js";
import { FOOT_SHAPE_NAMES } from "../../src/core/footPose.js";

import { ready } from "./helpers/ready.js";
const report = async (page) => {
  const value = await page.evaluate(() => window.__appearanceReport);
  expect(value.source).toBe("scanned");
  expect(value.finite).toBe(true);
  expect(value.triangles).toBeGreaterThan(10_000);
  return value;
};

for (const bodyType of ["female", "male", "neutral"])
  test(`${bodyType} appearance registry renders every hair, palette, hand and foot choice`, async ({
    page,
  }, info) => {
    test.setTimeout(bodyType === "female" ? 600_000 : 300_000);
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
            if (data.stage !== "final") return;
            const mesh = data.meshes[0],
              spec = data.scene.actors[0];
            window.__appearanceReport = {
              source: mesh.source,
              bodyType: mesh.bodyType,
              skinTone: mesh.skinTone,
              hair: spec.hair,
              hands: data.actors[0].hands,
              feet: spec.feet,
              hairParts: mesh.parts.filter((p) => p.hair && p.name.startsWith("hair-")).length,
              cardParts: mesh.parts.filter((p) => p.cards).map((p) => p.name),
              garments: mesh.parts
                .filter((p) => p.garment)
                .map((p) => ({ name: p.name, colour: p.colour, finish: p.finish })),
              triangles: mesh.triangles,
              finite: mesh.parts.every(
                (p) =>
                  p.positions.every(Number.isFinite) &&
                  p.normals.every(Number.isFinite),
              ),
            };
          });
        }
      };
    });
    await page.goto(
      `/?preset=builtin.standing-${bodyType === "neutral" ? "female" : bodyType}`,
    );
    await ready(page);
    await page.getByRole("button", { name: "Figures", exact: true }).click();
    if (bodyType === "neutral") {
      await page
        .getByLabel("Body type", { exact: true })
        .selectOption(bodyType);
      await ready(page);
    }
    expect((await report(page)).bodyType).toBe(bodyType);
    await page.getByText("Appearance", { exact: true }).click();
    for (const style of Object.keys(HAIR_STYLES)) {
      await page.getByLabel("Hair", { exact: true }).selectOption(style);
      await ready(page);
      const value = await report(page);
      expect(value.hair).toBe(style);
      expect(value.hairParts).toBe(style === "none" ? 0 : 1);
      // Drawn as MakeHuman's cards, and the brows and lashes with them
      // whatever the style - a shaved head still has eyebrows.
      expect(value.cardParts).toEqual(
        style === "none" ? ["brows", "lashes"] : ["brows", "lashes", `hair-${style}`],
      );
      await page
        .locator("#viewport")
        .screenshot({ path: info.outputPath(`hair-${style}.png`) });
    }
    for (const [name, colour] of Object.entries(GARMENT_COLOURS)) {
      await page.getByLabel("Colour", { exact: true }).selectOption(name);
      await ready(page);
      const value = await report(page);
      expect(value.garments.map((p) => p.name).sort()).toEqual([
        "shorts",
        "top",
      ]);
      for (const part of value.garments) expect(part.colour).toEqual(colour);
    }
    const worn = async (expected) => {
      await ready(page);
      const value = await report(page);
      expect(value.garments.map((p) => p.name).sort()).toEqual([...expected].sort());
      for (const part of value.garments) expect(part.finish).toBeTruthy();
      return value;
    };
    const outfit = page.getByLabel("Outfit", { exact: true });
    await expect(outfit).toHaveValue("studio");
    if (bodyType === "female") {
      // Every set, then every piece on its own control: between them, every
      // garment there is, built and drawn on the body that can wear it all.
      const seen = new Set();
      for (const [name, pieces] of Object.entries(OUTFITS)) {
        await outfit.selectOption(name);
        (await worn(pieces)).garments.forEach((p) => seen.add(p.name));
      }
      await outfit.selectOption("");
      await worn([]);
      for (const name of GARMENT_SLOTS.chest) {
        await page.getByLabel("Top", { exact: true }).selectOption(name);
        await worn([name]);
        seen.add(name);
      }
      for (const name of GARMENT_SLOTS.hips) {
        await page.getByLabel("Bottom", { exact: true }).selectOption(name);
        await worn(["top", name]);
        seen.add(name);
      }
      // Top and shorts, which is a set.
      await expect(outfit).toHaveValue("studio");
      const extras = GARMENT_NAMES.filter(
        (name) => !Object.values(GARMENT_SLOTS).flat().includes(name),
      );
      for (const [i, name] of extras.entries()) {
        await page.getByRole("checkbox", { name: GARMENT_LABELS[name], exact: true }).check();
        await worn(["top", "shorts", ...extras.slice(0, i + 1)]);
        seen.add(name);
      }
      await expect(outfit).toHaveValue("custom");
      expect([...seen].sort()).toEqual([...GARMENT_NAMES].sort());
      await outfit.selectOption("studio");
      await worn(OUTFITS.studio);
    } else {
      // No cups without a bust: not offered, and a set that has them comes
      // without them.
      for (const name of CUPPED)
        await expect(
          page.getByLabel("Top", { exact: true }).locator(`option[value="${name}"]`),
        ).toBeDisabled();
      await outfit.selectOption("lingerie");
      await worn(OUTFITS.lingerie.filter((name) => !CUPPED.has(name)));
      await expect(outfit).toHaveValue("lingerie");
      await outfit.selectOption("studio");
      await worn(OUTFITS.studio);
    }
    await page.getByLabel("Skin tone", { exact: true }).evaluate((input) => {
      input.value = "#9d7152";
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await ready(page);
    expect((await report(page)).skinTone).toBe("#9d7152");
    await page.getByText("Hands & feet", { exact: true }).click();
    for (const name of HAND_SHAPE_NAMES) {
      await page.getByLabel("Left hand", { exact: true }).selectOption(name);
      await ready(page);
      expect((await report(page)).hands.l).toBe(name);
    }
    for (const name of FOOT_SHAPE_NAMES) {
      await page.getByLabel("Left foot", { exact: true }).selectOption(name);
      await ready(page);
      expect((await report(page)).feet.l).toBe(name);
    }
    await page.getByLabel("Left foot", { exact: true }).selectOption("flat");
    await ready(page);
    await page
      .getByLabel("Hair", { exact: true })
      .selectOption(bodyType === "female" ? "medium" : "short");
    await ready(page);
    await page
      .getByLabel("Colour", { exact: true })
      .selectOption(bodyType === "female" ? "sage" : "navy");
    await ready(page);
    await page.screenshot({ path: info.outputPath(`${bodyType}-desktop.png`) });
    await page.setViewportSize({ width: 320, height: 844 });
    await page
      .getByRole("button", { name: "Edit", exact: false })
      .last()
      .click();
    await page.getByLabel("Hair", { exact: true }).scrollIntoViewIfNeeded();
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
      path: info.outputPath(`${bodyType}-mobile-controls.png`),
    });
    await page
      .getByRole("button", { name: "Studio", exact: false })
      .last()
      .click();
    await page.screenshot({ path: info.outputPath(`${bodyType}-mobile.png`) });
    expect(errors).toEqual([]);
  });

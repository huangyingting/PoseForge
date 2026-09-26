import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { ready } from "./helpers/ready.js";

const entries = JSON.parse(
  readFileSync(
    new URL("../../public/catalog/sexposes-v1.json", import.meta.url),
    "utf8",
  ),
).entries;
const interactionCounts = new Map(
  JSON.parse(
    readFileSync(
      new URL("../../public/catalog/interaction-studies-v1.json", import.meta.url),
      "utf8",
    ),
  ).studies.map((s) => [s.sourceId, s.scene.actors.length]),
);
const names = JSON.parse(
  readFileSync(
    new URL("../../scripts/data/position-names.json", import.meta.url),
    "utf8",
  ),
);
const representatives = [
  ...new Map(entries.map((e) => [e.generatedKey, e])).values(),
];
const solo = entries.find((e) => e.figures === 1),
  trio = entries.find((e) => interactionCounts.get(e.sourceId) === 3);
let errors, sourceImages;
test.beforeEach(async ({ page }) => {
  errors = [];
  sourceImages = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/\.avif(?:\?|$)|annotated-pose-dataset\/images/.test(request.url()))
      sourceImages.push(request.url());
  });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.stage !== "final") return;
          window.__positionMesh = {
            title: data.scene.title,
            bodies: data.meshes.map((m) => ({
              source: m.source,
              triangles: m.triangles,
              garments: m.parts
                .filter((p) => p.garment)
                .map((p) => p.name)
                .sort(),
              finite: m.parts.every(
                (p) =>
                  p.positions.every(Number.isFinite) &&
                  p.normals.every(Number.isFinite),
              ),
            })),
            actorCount: data.actors.length,
            roots: data.actors.map((a) => a.root.position),
            penetration: data.quality.maxDepth,
            surfaceWarnings: data.quality.warnings,
          };
        });
      }
    };
  });
});
test.afterEach(() => {
  expect(errors).toEqual([]);
  expect(sourceImages).toEqual([]);
});

async function loaded(page, entry, generated = false) {
  const sceneTitle = page.locator("#scene-title");
  const name = names[entry.sourceId].name;
  await expect(sceneTitle).toHaveText(
    generated ? `${name} · Generated approximation` : name,
  );
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText(
    generated ? "Approximate 3D" : "Interaction 3D",
  );
  await expect(page.locator("#viewport-error")).toBeHidden();
  const mesh = await page.evaluate(() => window.__positionMesh);
  expect(mesh.title).toBe(await sceneTitle.textContent());
  const figures = generated ? entry.figures : interactionCounts.get(entry.sourceId);
  expect(mesh.bodies).toHaveLength(figures);
  expect(mesh.actorCount).toBe(figures);
  for (const body of mesh.bodies) {
    expect(body.source).toBe("scanned");
    expect(body.finite).toBe(true);
    expect(body.triangles).toBeGreaterThan(10_000);
    expect(body.garments).toEqual(["shorts", "top"]);
  }
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const coloured = await page.locator("#viewport").evaluate((canvas) => {
    const sample = document.createElement("canvas");
    sample.width = sample.height = 64;
    const ctx = sample.getContext("2d");
    ctx.drawImage(canvas, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4)
      if (
        Math.max(data[i], data[i + 1], data[i + 2]) -
          Math.min(data[i], data[i + 1], data[i + 2]) >
          25 &&
        data[i + 3] > 200
      )
        count++;
    return count;
  });
  expect(coloured).toBeGreaterThan(8);
  return {
    sourceId: entry.sourceId,
    generatedKey: entry.generatedKey,
    figures: entry.figures,
    colouredPixels: coloured,
    mesh,
  };
}

async function select(page, entry, generated = false) {
  await page.getByLabel("Search positions").fill(entry.sourceId);
  if (generated) {
    await page
      .getByRole("button", {
        name: `Position details ${entry.sourceId}`,
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name: "Open generated approximation",
        exact: true,
      })
      .click();
    return loaded(page, entry, true);
  }
  await page
    .locator(`[data-source="${entry.sourceId}"]`)
    .click();
  return loaded(page, entry);
}

for (let batch = 0; batch < 4; batch++) {
  const subset = representatives.slice(batch * 51, (batch + 1) * 51);
  test(`distinct generated geometries render with real clothed meshes and pixels, batch ${batch + 1}`, async ({
    page,
  }, info) => {
    test.setTimeout(600_000);
    await page.goto(
      `/?preset=builtin.position.${subset[0].sourceId}&variant=generated`,
    );
    const results = [await loaded(page, subset[0], true)];
    for (const entry of subset.slice(1))
      results.push(await select(page, entry, true));
    expect(results).toHaveLength(subset.length);
    await info.attach("position-render-coverage", {
      body: JSON.stringify(results),
      contentType: "application/json",
    });
  });
}

test("solo and three-person previews support deep links, camera controls, saving and exports", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await page.goto(`/?preset=builtin.position.${solo.sourceId}`);
  await loaded(page, solo);
  await select(page, trio);
  await expect(page).toHaveURL(
    new RegExp(`preset=builtin.position.${trio.sourceId}`),
  );
  await expect(page.locator(".notes")).toContainText(
    "Approximate 3D interaction",
  );
  await page.screenshot({ path: info.outputPath("three-person-preview.png") });
  await page.getByRole("button", { name: "Front", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Front", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.locator("#viewport").focus();
  await page.keyboard.press("ArrowRight");
  await page.locator("#open-export").click();
  const [png] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^PNG image/ }).click(),
  ]);
  expect((await readFile(await png.path())).length).toBeGreaterThan(5000);
  await page.locator("#open-export").click();
  const [json] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Editable preset/ }).click(),
  ]);
  const preset = JSON.parse(await readFile(await json.path(), "utf8"))
    .presets[0];
  expect(preset.scene.actors).toHaveLength(interactionCounts.get(trio.sourceId));
  expect(preset.source.recordId).toBe(trio.sourceId);
  expect(preset.scene.contacts.length).toBeGreaterThan(0);
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Saved generated posture study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await expect(page.locator(".preset-card .support-badge")).toHaveText(
    "Needs adjustment",
  );
  await page.reload();
  await ready(page);
  await expect(page.locator("#scene-title")).toHaveText(
    "Saved generated posture study",
  );
  await expect(page.locator("#scene-source")).toContainText(trio.sourceId);
});

test("a failed preview download preserves the current study and retry loads it", async ({
  page,
}) => {
  let failing = true;
  await page.route("**/catalog/interaction-studies-v1.json", async (route) => {
    if (failing) await route.fulfill({ status: 503, body: "not available" });
    else await route.continue();
  });
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  await expect(page.locator(".positions-status")).toContainText(
    "could not load",
  );
  await expect(page.locator("#scene-title")).toHaveText("Standing · female");
  failing = false;
  await page
    .getByRole("button", { name: "Retry positions", exact: true })
    .click();
  await page.getByLabel("Search positions").fill(solo.sourceId);
  await page.locator(`[data-source="${solo.sourceId}"]`).click();
  await loaded(page, solo);
});

test("a delayed position request cannot overwrite a newer stock selection", async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/catalog/interaction-studies-v1.json", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  await page.goto(`/?preset=builtin.position.${solo.sourceId}`);
  await page.getByLabel("Search positions").fill("Standing · male");
  await page
    .getByRole("button", { name: "Load Standing · male", exact: true })
    .click();
  release();
  await ready(page);
  await expect(page.locator("#scene-title")).toHaveText("Standing · male");
  await expect(page).toHaveURL(/preset=builtin.standing-male/);
});

test("mobile position selection opens the 3D studio while details remain separately accessible", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?preset=builtin.position.${solo.sourceId}`);
  await loaded(page, solo);
  await expect(page.locator("#stage")).toBeVisible();
  await page.locator('[data-region="library"]').click();
  await page.getByLabel("Search positions").fill(trio.sourceId);
  await page
    .getByRole("button", {
      name: `Position details ${trio.sourceId}`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "not a verified reconstruction",
  );
  await page
    .getByRole("button", { name: "Open 3D interaction", exact: true })
    .click();
  await loaded(page, trio);
  await page.screenshot({ path: info.outputPath("mobile-position-3d.png") });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("missing scanned models do not substitute an unclothed field for a clothed position", async ({
  page,
}) => {
  await page.route("**/*.glb", (route) => route.abort());
  await page.goto(`/?preset=builtin.position.${solo.sourceId}`);
  await expect(page.locator("#viewport-error")).toContainText(
    "Clothed 3D position unavailable",
    { timeout: 60_000 },
  );
  await expect(page.locator("#save-preset")).toBeDisabled();
  await expect(page.locator("#status")).not.toContainText("Ready");
});

test("opening Save cancels a pending position so it cannot replace the saved study", async ({
  page,
}) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/catalog/interaction-studies-v1.json", async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  await page.goto(`/?preset=builtin.position.${entries[0].sourceId}`);
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("Keep my standing study");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  const response = page.waitForResponse(
    "**/catalog/interaction-studies-v1.json",
  );
  release();
  await response;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.locator("#scene-title")).toHaveText(
    "Keep my standing study",
  );
  await expect(page).toHaveURL(/preset=user\./);
  expect((await page.evaluate(() => window.__positionMesh)).actorCount).toBe(
    1,
  );
});

test("keyboard preview selection retains focus on desktop and invalid deep links keep a usable study", async ({
  page,
}) => {
  await page.goto("/?preset=builtin.position.missing-position");
  await expect(page.locator("#toast")).toContainText(
    "Position source not found",
  );
  await ready(page);
  await page.getByLabel("Search positions").fill(solo.sourceId);
  const preview = page.locator(`[data-source="${solo.sourceId}"]`);
  await preview.focus();
  await page.keyboard.press("Enter");
  await loaded(page, solo);
  await expect(preview).toBeFocused();
  await expect(page.getByLabel("Pose description")).toHaveValue("");
});

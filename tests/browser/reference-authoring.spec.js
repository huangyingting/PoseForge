import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { referencePreset } from "../../src/core/referencePreviews.js";
import { serializeCatalog } from "../../src/core/catalog.js";
import { referenceStudyId } from "../../src/core/referenceStudies.js";
import { ready } from "./helpers/ready.js";

const entries = JSON.parse(
  readFileSync(
    new URL("../../public/catalog/sexposes-v1.json", import.meta.url),
  ),
).entries;
const scenes = new Map(
  JSON.parse(
    readFileSync(
      new URL(
        "../../public/catalog/reference-previews-v1.json",
        import.meta.url,
      ),
    ),
  ).scenes.map(({ key, scene }) => [key, scene]),
);
const solo = entries.find((e) => e.figures === 1);
const trio = entries.find((e) => e.figures === 3);
const preset = (entry) => referencePreset(entry, scenes);
let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(() => expect(errors).toEqual([]));

async function start(page, entry = solo) {
  await page.goto(`/?reference=${entry.sourceId}`);
  await ready(page);
  await expect(page.locator("#scene-title")).toContainText(
    entry.sourceId.toUpperCase(),
  );
}
async function saveStudy(page, title, replace = false) {
  await page
    .getByRole("button", { name: "Save position override", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Save position override",
    exact: true,
  });
  await page.getByLabel("Study name", { exact: true }).fill(title);
  if (replace)
    await page
      .getByLabel("Replace the existing override for this position")
      .check();
  await modal.getByRole("button", { name: "Save override", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator("#scene-title")).toHaveText(title);
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText(
    "Authored · unreviewed",
  );
}
async function tools(page) {
  if (await page.locator('[data-region="library"]').isVisible())
    await page.locator('[data-region="library"]').click();
  await page
    .getByRole("button", { name: "Library tools", exact: true })
    .click();
  return page.getByRole("dialog", { name: "Library tools", exact: true });
}
async function upload(page, presets) {
  await page.getByLabel("Import position overrides (JSON)").setInputFiles({
    name: "studies.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeCatalog(presets)),
  });
}
async function exported(page, modal) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    modal
      .getByRole("button", { name: "Export position overrides", exact: true })
      .click(),
  ]);
  return JSON.parse(await readFile(await download.path(), "utf8")).presets;
}

test("a reference has an independently edited, captured and replace-confirmed pose across reload and export", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await start(page);
  await page.getByRole("button", { name: "Focus view", exact: true }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-focus", "true");
  await page.getByRole("button", { name: "Edit posture", exact: true }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-focus", "false");
  await expect(
    page.getByRole("button", { name: "Figures", exact: true }),
  ).toBeFocused();
  await page
    .locator(".actor-card")
    .locator("summary")
    .filter({ hasText: /^Joints/ })
    .click();
  await page.getByLabel("Joint", { exact: true }).selectOption("elbow_l");
  await page.getByLabel("Flexion", { exact: true }).evaluate((el) => {
    el.value = "60";
  });
  await page.getByLabel("Flexion", { exact: true }).dispatchEvent("change");
  await ready(page);
  await saveStudy(page, "My independent posture");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("Support status").selectOption("authored-3d");
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await expect(page.locator(".preset-card .support-badge")).toHaveText(
    "Authored · unreviewed",
  );
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`reference=${solo.sourceId}$`));
  await page.reload();
  await expect(page.locator("#scene-title")).toHaveText(
    "My independent posture",
  );
  await ready(page);
  await page
    .getByRole("button", { name: "Save position override", exact: true })
    .click();
  await page.getByLabel("Study name", { exact: true }).fill("Updated posture");
  await page.getByRole("button", { name: "Save override", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Confirm replacement");
  await page
    .getByLabel("Replace the existing override for this position")
    .check();
  await page.getByRole("button", { name: "Save override", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await ready(page);
  const modal = await tools(page);
  const data = await exported(page, modal);
  expect(data).toHaveLength(1);
  expect(data[0].id).toBe(referenceStudyId(solo.sourceId));
  expect(data[0].scene.actors[0].joints.elbow_l.flexion).toBeCloseTo(60, 6);
  expect(data[0].scene.actors[0].jointMode).toBe("fixed");
  expect(data[0].source.annotationHash).toBe(solo.annotationHash);
  expect(data[0].status).toBeUndefined();
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator("#toast")).toBeHidden();
  await page.screenshot({ path: info.outputPath("authored-desktop.png") });
  await page
    .getByRole("button", {
      name: `Position details ${solo.sourceId}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Open generated approximation", exact: true })
    .click();
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText("Approximate 3D");
  await expect(page).toHaveURL(/preview=generated/);
  await page.reload();
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText("Approximate 3D");
  await page.locator(`[data-source="${solo.sourceId}"]`).click();
  await expect(page.locator("#scene-title")).toHaveText("Updated posture");
  await ready(page);
  await page.locator("#save-preset").click();
  await page
    .getByRole("button", { name: "Delete preset", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(`[data-source="${solo.sourceId}"]`).click();
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText("Interaction 3D");
  await expect(page.locator(".preset-card .support-badge")).toHaveText(
    "Interaction 3D",
  );
});

test("bulk imports preview counts, keep existing by default, replace explicitly and reject an invalid batch atomically", async ({
  page,
}) => {
  await start(page);
  const modal = await tools(page);
  await upload(page, [preset(solo), preset(trio)]);
  await expect(modal).toContainText(
    "2 valid studies · 2 new · 0 already authored",
  );
  await expect(modal).toContainText(
    "0 / 1,283 source-linked positions have local overrides",
  );
  await page.evaluate(() => {
    window.__studyPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "library")
        throw new DOMException("quota", "QuotaExceededError");
      return window.__studyPut.apply(this, args);
    };
  });
  await modal
    .getByRole("button", { name: "Import overrides", exact: true })
    .click();
  await expect(modal.getByRole("alert")).toContainText(
    "Could not save the library",
  );
  await expect(modal).toContainText(
    "0 / 1,283 source-linked positions have local overrides",
  );
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.__studyPut;
  });
  await modal
    .getByRole("button", { name: "Import overrides", exact: true })
    .click();
  await expect(modal).toContainText(
    "Saved 2 studies; kept 0 existing studies.",
  );
  const edited = { ...preset(solo), title: "Imported replacement" };
  await upload(page, [edited, preset(entries[0])]);
  await expect(modal).toContainText(
    "2 valid studies · 1 new · 1 already authored",
  );
  await modal
    .getByRole("button", { name: "Import overrides", exact: true })
    .click();
  await expect(modal).toContainText(
    "Saved 1 studies; kept 1 existing studies.",
  );
  expect(
    (await exported(page, modal)).find(
      (p) => p.source.recordId === solo.sourceId,
    ).title,
  ).toBe(`Reference ${solo.sourceId}`);
  await upload(page, [edited]);
  await page.getByLabel("Replace 1 existing position overrides").check();
  await modal
    .getByRole("button", { name: "Import overrides", exact: true })
    .click();
  await expect(modal).toContainText(
    "Saved 1 studies; kept 0 existing studies.",
  );
  const bad = preset(entries[2]);
  bad.source.annotationHash = "0".repeat(64);
  await upload(page, [preset(entries[1]), bad]);
  await expect(modal.getByRole("alert")).toContainText("Nothing was saved");
  const output = await exported(page, modal);
  expect(output).toHaveLength(3);
  expect(output.find((p) => p.source.recordId === solo.sourceId).title).toBe(
    "Imported replacement",
  );
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(page.locator("#scene-title")).toHaveText("Imported replacement");
  await ready(page);
  await page.getByLabel("Search positions").fill("");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("Support status").selectOption("authored-3d");
  await expect(page.locator(".library-title > span")).toHaveText("3 positions");
});

test("all 1283 entries can be imported, exported and individually selected as authored test fixtures", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await start(page);
  const modal = await tools(page);
  // Fixture adoption tests capacity only, not 1283 independently authored poses.
  await upload(page, entries.map(preset));
  await expect(modal).toContainText(
    "1283 valid studies · 1283 new · 0 already authored",
  );
  await modal
    .getByRole("button", { name: "Import overrides", exact: true })
    .click();
  await expect(modal).toContainText(
    "Saved 1283 studies; kept 0 existing studies.",
  );
  const output = await exported(page, modal);
  expect(output).toHaveLength(1283);
  expect(new Set(output.map((p) => p.source.recordId)).size).toBe(1283);
  expect(output.map((p) => p.source.recordId).sort()).toEqual(
    entries.map((e) => e.sourceId).sort(),
  );
  expect(output.reduce((n, p) => n + p.scene.actors.length, 0)).toBe(2567);
  await info.attach("reference-authoring-scale", {
    body: JSON.stringify({
      sourceRecords: output.length,
      uniqueSourceIds: new Set(output.map((p) => p.source.recordId)).size,
      participants: output.reduce((n, p) => n + p.scene.actors.length, 0),
      exportedPresetBytes: Buffer.byteLength(JSON.stringify(output)),
      fixtures:
        "Existing generated approximations adopted to test capacity, not newly authored geometry.",
    }),
    contentType: "application/json",
  });
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await page.getByLabel("Search positions").fill(entries.at(-1).sourceId);
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await page.locator(`[data-source="${entries.at(-1).sourceId}"]`).click();
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText(
    "Authored · unreviewed",
  );
  await page.reload();
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText(
    "Authored · unreviewed",
  );
});

test("mobile authoring and import are reachable, accessible and reject a missing participant", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page, trio);
  await expect(
    page.getByRole("button", { name: "Edit posture", exact: true }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Edit posture", exact: true }).click();
  await expect(page.locator("#app")).toHaveAttribute("data-mobile", "edit");
  await page
    .getByRole("button", { name: "Remove figure", exact: true })
    .last()
    .click();
  await ready(page);
  await page.locator('[data-region="studio"]').click();
  await page
    .getByRole("button", { name: "Save position override", exact: true })
    .click();
  await expect(page.locator("#toast")).toContainText(
    "figure count does not match",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await ready(page);
  const modal = await tools(page);
  await upload(page, [preset(trio)]);
  await expect(modal).toContainText("1 valid studies");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: info.outputPath("authored-mobile-import.png"),
  });
  await modal
    .getByRole("button", { name: "Import overrides", exact: true })
    .click();
  await expect(modal).toContainText("Saved 1 studies");
  await modal.getByRole("button", { name: "Close dialog" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("Search positions").fill(trio.sourceId);
  const card = page.locator(`[data-source="${trio.sourceId}"]`);
  await card.focus();
  await page.keyboard.press("Enter");
  await ready(page);
  await expect(page.locator("#viewport")).toBeFocused();
  await expect(page.locator("#scene-badge")).toHaveText(
    "Authored · unreviewed",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("authored-mobile.png") });
});

test("saving an authored study cancels a pending generated selection", async ({
  page,
}) => {
  await start(page);
  await saveStudy(page, "Keep this authored pose");
  let release;
  let received;
  const requested = new Promise((resolve) => {
    received = resolve;
  });
  await page.route("**/catalog/interaction-studies-v1.json", async (route) => {
    await new Promise((resolve) => {
      release = async () => {
        await route.fulfill({
          contentType: "application/json",
          body: readFileSync(
            new URL(
              "../../public/catalog/interaction-studies-v1.json",
              import.meta.url,
            ),
          ),
        });
        resolve();
      };
      received();
    });
  });
  // The startup positions preload shares this held pack request.
  await page.reload();
  await ready(page);
  await page.goto(`/?reference=${trio.sourceId}`);
  await requested;
  await saveStudy(page, "Saved while another preview was pending", true);
  await release();
  await page.waitForTimeout(1000);
  await expect(page.locator("#scene-title")).toHaveText(
    "Saved while another preview was pending",
  );
  await expect(page.locator("#scene-badge")).toHaveText(
    "Authored · unreviewed",
  );
  await expect(page).toHaveURL(new RegExp(`reference=${solo.sourceId}$`));
});

test("a committed reference save cannot replace a newer selection after its dialog closes", async ({
  page,
}) => {
  await start(page);
  await page
    .getByRole("button", { name: "Save position override", exact: true })
    .click();
  await page
    .getByLabel("Study name", { exact: true })
    .fill("Saved in background");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.name === "library") {
        IDBObjectStore.prototype.put = put;
        document.querySelector("dialog[open]").close();
        document.querySelector('[data-scope="positions"]').click();
        const search = document.querySelector("#catalog-search");
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
        document
          .querySelector('[data-preset="builtin.standing-female"]')
          .click();
      }
      return request;
    };
  });
  await page.getByRole("button", { name: "Save override", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#scene-title")).toHaveText("Standing · female");
  await ready(page);
  await expect(page.locator("#scene-title")).toHaveText("Standing · female");
  await page.getByRole("button", { name: "Positions", exact: true }).click();
  await page.getByLabel("Search positions").fill(solo.sourceId);
  await page.locator(`[data-source="${solo.sourceId}"]`).click();
  await expect(page.locator("#scene-title")).toHaveText("Saved in background");
  await ready(page);
});

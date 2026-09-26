import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ready } from "./helpers/ready.js";

const pack = JSON.parse(
  readFileSync(
    new URL("../../public/catalog/interaction-studies-v1.json", import.meta.url),
    "utf8",
  ),
);
const record = pack.studies.find((s) => s.template === "reverse_cowgirl");
const trio = pack.studies.find((s) => s.scene.actors.length === 3);
let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.stage !== "final") return;
          window.__positionResult = {
            title: data.scene.title,
            bodies: data.meshes.length,
            roots: data.actors.map((a) => a.root.position),
          };
        });
      }
    };
  });
});
test.afterEach(() => expect(errors).toEqual([]));

async function loaded(page, study) {
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText("Interaction 3D");
  const result = await page.evaluate(() => window.__positionResult);
  expect(result.bodies).toBe(study.scene.actors.length);
  expect(result.roots).toEqual(study.scene.actors.map((a) => a.placement.position));
  return result;
}

test("all 1,283 positions are in the library and open in 3D, searchable, favoritable and deep-linkable", async ({
  page,
}, info) => {
  await page.goto("/");
  await ready(page);
  await expect(page.locator(".library-title > span")).toHaveText(
    "1,306 positions",
  );
  await expect(
    page.getByRole("button", { name: "Positions", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByText("Browse position categories", { exact: true }).click();
  await expect(page.locator(".position-category")).toHaveCount(9);
  await expect(
    page.locator(".position-category").filter({ hasText: "Partner on top" }),
  ).toContainText("Reverse cowgirl");
  await page
    .getByLabel("Search positions")
    .fill(`reverse cowgirl ${record.sourceId}`);
  const card = page.locator(".preset-card");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".preset-name")).toHaveText(record.title);
  await expect(card.locator(".preset-description")).toContainText(
    "Astride, facing the partner's feet",
  );
  await expect(card.locator(".support-badge")).toHaveText("Interaction 3D");
  await page
    .getByRole("button", {
      name: `Position details ${record.sourceId}`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(record.title);
  await expect(page.getByRole("dialog")).toContainText("Reverse cowgirl");
  await expect(page.getByRole("dialog")).toContainText(record.sourceId);
  await page.keyboard.press("Escape");
  await card.locator(".preset-select").click();
  await loaded(page, record);
  await expect(page.locator("#scene-title")).toHaveText(record.title);
  await expect(page).toHaveURL(
    new RegExp(`preset=builtin.position.${record.sourceId}`),
  );
  await card.locator(".favorite").click();
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("position-desktop.png") });

  await page.goto(`/?preset=builtin.position.${trio.sourceId}`);
  await loaded(page, trio);
  await page.getByRole("button", { name: "Favorites", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(1);
});

test("a failed positions download is retryable and leaves the stock presets usable", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/catalog/interaction-studies-v1.json", async (route) => {
    if (++attempts === 1) await route.fulfill({ status: 503, body: "busy" });
    else await route.continue();
  });
  await page.goto("/");
  await ready(page);
  await expect(page.locator(".positions-status")).toContainText(
    "could not load",
  );
  await expect(page.locator(".preset-card").first()).toBeVisible();
  await page.getByRole("button", { name: "Retry positions", exact: true }).click();
  await expect(page.locator(".positions-status")).toHaveCount(0);
  await expect(page.locator(".library-title > span")).toHaveText(
    "1,306 positions",
  );
});

test("choosing a card keeps the reader's search and page, and a selection made elsewhere is brought into view", async ({
  page,
}) => {
  await page.goto("/");
  await ready(page);
  await expect(page.locator(".library-title > span")).toHaveText(
    "1,306 positions",
  );
  const search = page.getByLabel("Search positions");
  const count = page.locator(".library-title > span");
  const pageLabel = page.locator("#catalog-page");
  await search.fill("reverse cowgirl");
  const total = await count.textContent();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(pageLabel).toHaveText(/^2 \//);
  const chosen = page.locator(".preset-card").nth(1);
  const sourceId = await chosen
    .locator(".preset-select")
    .getAttribute("data-source");
  await chosen.locator(".preset-select").click();
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText("Interaction 3D");
  await expect(search).toHaveValue("reverse cowgirl");
  await expect(count).toHaveText(total);
  await expect(pageLabel).toHaveText(/^2 \//);
  await expect(page.locator(".preset-card.selected .preset-select")).toHaveAttribute(
    "data-source",
    sourceId,
  );

  await search.fill(trio.sourceId);
  await page.locator(`[data-source="${trio.sourceId}"]`).click();
  await loaded(page, trio);
  await expect(search).toHaveValue(trio.sourceId);

  // Undo is a selection made outside the list: it is revealed even though the
  // current search does not list it.
  await search.fill("missionary");
  await page.locator("#undo").click();
  await ready(page);
  await expect(search).toHaveValue(sourceId);
  await expect(page.locator(".preset-card.selected .preset-select")).toHaveAttribute(
    "data-source",
    sourceId,
  );
});

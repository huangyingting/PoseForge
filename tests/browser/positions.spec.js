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
    /^1,3\d\d studies$/,
  );
  await page.getByRole("button", { name: "Positions", exact: true }).click();
  await page.getByLabel("Search presets").fill(`reverse cowgirl ${record.sourceId}`);
  const card = page.locator(".preset-card");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".support-badge")).toHaveText("Interaction 3D");
  await card.locator(".preset-select").click();
  await loaded(page, record);
  await expect(page.locator("#scene-title")).toHaveText(/^Reverse cowgirl \d+/);
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
    /^1,3\d\d studies$/,
  );
});

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { ready } from "./helpers/ready.js";

const pack = JSON.parse(
  readFileSync(
    new URL("../../public/catalog/artistic-studies-v1.json", import.meta.url),
  ),
);
const names = JSON.parse(
  readFileSync(
    new URL("../../scripts/data/position-names.json", import.meta.url),
  ),
);
const tokens = (p) =>
  new Set([
    `figures:${p.scene.actors.length}`,
    ...p.scene.actors.flatMap((a) => [
      `posture:${a.posture}`,
      `body:${a.bodyType}`,
    ]),
    ...p.motifs.map((m) => `gesture:${m.split(".")[1]}`),
  ]);
const uncovered = new Set(pack.studies.flatMap((p) => [...tokens(p)])),
  representatives = [];
while (uncovered.size) {
  let best = null,
    score = 0;
  for (const p of pack.studies) {
    const n = [...tokens(p)].filter((v) => uncovered.has(v)).length;
    if (n > score) {
      score = n;
      best = p;
    }
  }
  if (!best) throw new Error("Uncovered artistic palette");
  representatives.push(best);
  for (const t of tokens(best)) uncovered.delete(t);
}
let errors, sourceImages;
test.beforeEach(async ({ page }) => {
  errors = [];
  sourceImages = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/annotated-pose-dataset\/images|\.avif(?:\?|$)/.test(r.url()))
      sourceImages.push(r.url());
  });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.stage !== "final") return;
          window.__artisticResult = {
            title: data.scene.title,
            actors: data.actors.map((a) => ({
              id: a.id,
              root: a.root.position,
              joints: a.joints,
            })),
            meshes: data.meshes.map((m) => ({
              source: m.source,
              finite: m.parts.every(
                (p) =>
                  p.positions.every(Number.isFinite) &&
                  p.normals.every(Number.isFinite),
              ),
              garments: m.parts
                .filter((p) => p.garment)
                .map((p) => p.name)
                .sort(),
            })),
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
async function check(page, record) {
  await expect(page.locator("#scene-title")).toHaveText(
    `${names[record.sourceId].name} · Artistic interpretation`,
  );
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText("Artistic 3D");
  await expect(page.locator("#viewport-error")).toBeHidden();
  const result = await page.evaluate(() => window.__artisticResult);
  expect(result.title).toBe(
    `${names[record.sourceId].name} · Artistic interpretation`,
  );
  expect(result.meshes).toHaveLength(record.scene.actors.length);
  for (const m of result.meshes) {
    expect(m.source).toBe("scanned");
    expect(m.finite).toBe(true);
    expect(m.garments).toEqual(["shorts", "top"]);
  }
  for (const actor of record.scene.actors) {
    const actual = result.actors.find((a) => a.id === actor.id);
    expect(actual.root).toEqual(actor.placement.position);
    for (const [name, angles] of Object.entries(actor.joints))
      for (const [channel, value] of Object.entries(angles))
        expect(actual.joints[name][channel]).toBeCloseTo(value, 7);
  }
}

for (let batch = 0; batch < Math.ceil(representatives.length / 6); batch++) {
  const records = representatives.slice(batch * 6, (batch + 1) * 6);
  test(`artistic posture and gesture palette survives the full worker, batch ${batch + 1}`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    for (const record of records) {
      await page.goto(
        `/?preset=builtin.position.${record.sourceId}&variant=artistic`,
      );
      await check(page, record);
    }
    await info.attach("artistic-worker-coverage", {
      body: JSON.stringify(
        records.map((p) => ({ sourceId: p.sourceId, tokens: [...tokens(p)] })),
      ),
      contentType: "application/json",
    });
  });
}

test("a fresh library has all artistic previews ready without importing or creating personal data", async ({
  page,
}, info) => {
  const requests = [];
  page.on("request", (r) => {
    if (r.url().includes("/catalog/")) requests.push(r.url().split("/").at(-1));
  });
  await page.goto(
    "/?preset=builtin.position.kneeling-missionary&variant=artistic",
  );
  await check(page, pack.studies[0]);
  await expect(page).toHaveURL(/variant=artistic/);
  await expect(page.locator("#scene-description")).toContainText(
    "Artistic interpretation, not a reconstruction",
  );
  expect(requests).toContain("artistic-studies-v1.json");
  expect(requests).not.toContain("generated-studies-v1.json");
  await page.getByLabel("Search positions").fill("");
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByLabel("Support status").selectOption("interaction-3d");
  await expect(page.locator(".library-title > span")).toHaveText(
    "1,283 positions",
  );
  await page.locator("#open-export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Editable preset/ }).click(),
  ]);
  const exported = JSON.parse(await readFile(await download.path(), "utf8"))
    .presets[0];
  expect(exported.tags).toContain("artistic");
  expect(exported.description).toContain("not a reconstruction");
  expect(exported.status).toBeUndefined();
  expect(exported.source.recordId).toBe("kneeling-missionary");
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await expect(page.locator(".preset-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Positions", exact: true }).click();
  await expect(page.locator("#toast")).toBeHidden();
  await page.screenshot({ path: info.outputPath("artistic-desktop.png") });
});

test("artistic previews and their distinction from legacy approximations remain usable on mobile", async ({
  page,
}, info) => {
  const record = pack.studies.find((p) => p.scene.actors.length === 3);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(
    `/?preset=builtin.position.${record.sourceId}&variant=artistic`,
  );
  await check(page, record);
  await expect(page.locator("#viewport")).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("artistic-mobile.png") });
  await page.locator('[data-region="library"]').click();
  await page.getByLabel("Search positions").fill(record.sourceId);
  await page
    .getByRole("button", {
      name: `Position details ${record.sourceId}`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "not measured source coordinates",
  );
  await page
    .getByRole("button", { name: "Open generated approximation", exact: true })
    .click();
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText("Approximate 3D");
  await expect(page).toHaveURL(/variant=generated/);
  await page.locator('[data-region="library"]').click();
  await page
    .getByRole("button", {
      name: `Position details ${record.sourceId}`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Open artistic interpretation", exact: true })
    .click();
  await check(page, record);
  await expect(page).toHaveURL(/variant=artistic/);
  await page.locator('[data-region="library"]').click();
  await page.locator(`[data-source="${record.sourceId}"]`).click();
  await ready(page);
  await expect(page.locator("#scene-badge")).toHaveText("Interaction 3D");
  await expect(page).not.toHaveURL(/variant=/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

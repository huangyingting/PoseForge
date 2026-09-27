import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { BODY_MODELS } from "../../src/core/bodyModels.js";
import { ready } from "./helpers/ready.js";

const pixels = async (page) =>
  createHash("sha256")
    .update(
      await page.locator("#viewport").evaluate((canvas) => canvas.toDataURL()),
    )
    .digest("hex");

// The built files carry an eight-character content hash after the stem, so
// `realistic-female` must not also match `realistic-female-european`.
const fetched = (urls, stem, ext) =>
  urls.filter((url) => {
    const name = new URL(url).pathname.split("/").pop();
    return (
      name === `${stem}.${ext}` ||
      (name.startsWith(`${stem}-`) &&
        name.endsWith(`.${ext}`) &&
        name.length === stem.length + 10 + ext.length)
    );
  }).length;

test("the body model picker draws each model's own scan and skin, and only once each", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => errors.push(request.url()));
  // The context sees the worker's fetches as well as the page's.
  let urls = [];
  page.context().on("request", (request) => {
    if (/\.(glb|png)(\?|$)/.test(request.url())) urls.push(request.url());
  });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.stage !== "final") return;
          const mesh = data.meshes[0];
          window.__modelReport = {
            source: mesh.source,
            bodyType: mesh.bodyType,
            model: mesh.model ?? null,
            specModel: data.scene.actors[0].model ?? null,
            triangles: mesh.triangles,
            warnings: data.warnings,
          };
        });
      }
    };
  });
  const report = async () => {
    const value = await page.evaluate(() => window.__modelReport);
    expect(value.source).toBe("scanned");
    expect(value.triangles).toBeGreaterThan(10_000);
    expect(value.warnings.filter((w) => /body model|scanned body/.test(w))).toEqual([]);
    return value;
  };
  const choose = async (label, value) => {
    urls = [];
    await page.getByLabel(label, { exact: true }).selectOption(value);
    await ready(page);
    // The atlas is the renderer's, fetched once the final pose is drawn.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };

  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  expect(fetched(urls, "realistic-female", "glb")).toBe(1);
  await expect.poll(() => fetched(urls, "skin-female", "png")).toBe(1);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page.getByText("Appearance", { exact: true }).click();
  const picker = page.getByLabel("Body model", { exact: true });
  await expect(picker).toHaveValue("asian");
  expect(
    await picker.locator("option").evaluateAll((options) =>
      options.map((option) => [option.value, option.textContent]),
    ),
  ).toEqual(Object.entries(BODY_MODELS).map(([name, { label }]) => [name, label]));
  expect(await report()).toMatchObject({ bodyType: "female", model: null, specModel: null });
  const standard = await pixels(page);

  for (const model of ["european", "african", "mature"]) {
    await choose("Body model", model);
    expect(await report()).toMatchObject({ bodyType: "female", model, specModel: model });
    expect(fetched(urls, `realistic-female-${model}`, "glb"), model).toBe(1);
    await expect.poll(() => fetched(urls, `skin-female-${model}`, "png"), { message: model }).toBe(1);
    expect(await pixels(page), model).not.toBe(standard);
  }

  // Back to the default: the scene stops naming a model, and nothing already
  // fetched is fetched again.
  await choose("Body model", "asian");
  expect(await report()).toMatchObject({ bodyType: "female", model: null, specModel: null });
  expect(urls).toEqual([]);
  expect(await pixels(page)).toBe(standard);

  // The neutral body has its own scan but wears the female skin.
  await choose("Body type", "neutral");
  expect(await report()).toMatchObject({ bodyType: "neutral", model: null });
  expect(fetched(urls, "realistic-neutral", "glb")).toBe(1);
  expect(urls.filter((url) => url.endsWith(".png"))).toEqual([]);
  await choose("Body model", "mature");
  expect(await report()).toMatchObject({ bodyType: "neutral", model: "mature" });
  expect(fetched(urls, "realistic-neutral-mature", "glb")).toBe(1);
  expect(urls.filter((url) => url.endsWith(".png"))).toEqual([]);

  // A model carries across a change of body type.
  await choose("Body type", "male");
  expect(await report()).toMatchObject({ bodyType: "male", model: "mature" });
  expect(fetched(urls, "realistic-male-mature", "glb")).toBe(1);
  await expect.poll(() => fetched(urls, "skin-male-mature", "png")).toBe(1);
  expect(errors).toEqual([]);
});

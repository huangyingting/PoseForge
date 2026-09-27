import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ready } from "./helpers/ready.js";

const pack = JSON.parse(
  readFileSync(
    new URL(
      "../../public/catalog/interaction-studies-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const record = pack.studies.find((s) => s.template === "reverse_cowgirl");

// The rest of the suite runs with reduced motion, which turns tours off; here
// the reader has asked for nothing.
test.use({ reducedMotion: "no-preference" });

let errors;
test.beforeEach(({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(() => expect(errors).toEqual([]));

/** Keep a copy of the canvas's pixels in the page, under `name`. */
const shot = (page, name) =>
  page.locator("#viewport").evaluate((canvas, name) => {
    const copy = document.createElement("canvas");
    [copy.width, copy.height] = [canvas.width, canvas.height];
    const context = copy.getContext("2d");
    context.drawImage(canvas, 0, 0);
    window.__shots ??= {};
    window.__shots[name] = context.getImageData(
      0,
      0,
      copy.width,
      copy.height,
    ).data;
  }, name);
/** The fraction of pixels that visibly differ between two shots. */
const differing = (page, a, b) =>
  page.evaluate(
    ([a, b]) => {
      const [x, y] = [window.__shots[a], window.__shots[b]];
      let count = 0;
      for (let i = 0; i < x.length; i += 4) {
        const change =
          Math.abs(x[i] - y[i]) +
          Math.abs(x[i + 1] - y[i + 1]) +
          Math.abs(x[i + 2] - y[i + 2]);
        if (change > 24) count += 1;
      }
      return count / (x.length / 4);
    },
    [a, b],
  );
const touring = (page) => page.locator("#viewport[data-touring]");
const tourButton = (page) =>
  page.getByRole("button", { name: "Tour", exact: true });
const threeD = (page) => page.getByRole("button", { name: "3D", exact: true });

test("a position that loads is toured once round and left on its framed view", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto(`/?preset=builtin.position.${record.sourceId}`);
  await expect(tourButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(touring(page)).toHaveCount(1);
  await ready(page);
  await page.waitForLoadState("networkidle");
  // The camera travels well away from where it started.
  await shot(page, "early");
  await expect
    .poll(
      async () => {
        await shot(page, "later");
        return differing(page, "early", "later");
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0.05);
  // It ends by itself, on the view the position was framed in.
  await expect(touring(page)).toHaveCount(0, { timeout: 40_000 });
  await expect(threeD(page)).toHaveAttribute("aria-pressed", "true");
  await shot(page, "ended");
  await threeD(page).click();
  await shot(page, "framed");
  expect(await differing(page, "ended", "framed")).toBeLessThan(0.002);
  // Opening another position from the library tours again.
  await page.getByLabel("Search positions").fill("Flying Missionary");
  await page.locator(".preset-card .preset-select").first().click();
  await expect(touring(page)).toHaveCount(1);
  await ready(page);
  await expect(page.locator("#scene-title")).toHaveText("Flying Missionary");
});

test("taking hold of the camera stops a tour where it is", async ({ page }) => {
  await page.goto(`/?preset=builtin.position.${record.sourceId}`);
  await ready(page);
  await page.waitForLoadState("networkidle");
  await expect(touring(page)).toHaveCount(1);
  const box = await page.locator("#viewport").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 160);
  await page.mouse.down();
  await page.mouse.up();
  await expect(touring(page)).toHaveCount(0);
  // Nothing moves the camera once the reader has it.
  await page.waitForTimeout(300);
  await shot(page, "held");
  await page.waitForTimeout(1500);
  await shot(page, "still");
  expect(await differing(page, "held", "still")).toBe(0);
  // Keys and the wheel take it over too.
  await tourButton(page).click();
  await tourButton(page).click();
  await expect(touring(page)).toHaveCount(1);
  await page.locator("#viewport").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(touring(page)).toHaveCount(0);
  await tourButton(page).click();
  await tourButton(page).click();
  await expect(touring(page)).toHaveCount(1);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await expect(touring(page)).toHaveCount(0);
});

test("tours can be turned off, and stay off, and turned back on", async ({
  page,
}) => {
  await page.goto(`/?preset=builtin.position.${record.sourceId}`);
  await ready(page);
  await expect(touring(page)).toHaveCount(1);
  await tourButton(page).click();
  await expect(tourButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(touring(page)).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("poseforge.tour.v1")),
  ).toBe("off");
  await page.reload();
  await ready(page);
  await expect(tourButton(page)).toHaveAttribute("aria-pressed", "false");
  await expect(touring(page)).toHaveCount(0);
  // Turning it on shows the position straight away.
  await tourButton(page).click();
  await expect(tourButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(touring(page)).toHaveCount(1);
  expect(
    await page.evaluate(() => localStorage.getItem("poseforge.tour.v1")),
  ).toBe("on");
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });
  test("a reader who asks for less motion gets no tour unless they turn it on", async ({
    page,
  }) => {
    await page.goto(`/?preset=builtin.position.${record.sourceId}`);
    await ready(page);
    await expect(tourButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(touring(page)).toHaveCount(0);
    await tourButton(page).click();
    await expect(touring(page)).toHaveCount(1);
  });
});

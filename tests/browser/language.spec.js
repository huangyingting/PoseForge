import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

let errors;
test.beforeEach(async ({ context }) => {
  errors = [];
  const watch = (page) =>
    page.on("pageerror", (error) => errors.push(error.message));
  context.pages().forEach(watch);
  context.on("page", watch);
});
test.afterEach(() => expect(errors).toEqual([]));

const cjk = /[一-鿿]/;
const ready = (page, word) =>
  expect(page.locator("#status")).toContainText(word, { timeout: 60_000 });

test("the studio switches to Chinese and back, and keeps the choice and the scene", async ({
  page,
}) => {
  await page.goto("/?preset=builtin.position.kneeling-missionary");
  await ready(page, "Ready");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const toggle = page.locator("#language");
  await expect(toggle).toHaveText("中文");
  await expect(toggle).toHaveAttribute("title", "Switch to Chinese");
  await expect(page.locator("#scene-title")).toHaveText("Kneeling Missionary");

  await toggle.click();
  await ready(page, "就绪");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(toggle).toHaveText("EN");
  await expect(toggle).toHaveAttribute("title", "切换到英文");
  expect(await page.evaluate(() => localStorage.getItem("poseforge.language.v1"))).toBe("zh");
  // The position that was open is open again, now in Chinese.
  await expect(page.locator("#scene-title")).toHaveText("跪姿传教士");
  await expect(page.locator("#scene-description")).toContainText("跪于双腿之间");
  await expect(page).toHaveTitle("PoseForge — 你的姿势工作室");
  await expect(page.locator("#save-preset")).toHaveText(/保存预设/);
  await expect(page.getByRole("button", { name: "场景", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "人物", exact: true })).toBeVisible();

  // The library's cards and categories read in Chinese too.
  await page.getByRole("button", { name: "体位", exact: true }).click();
  await expect(page.locator(".preset-card").first()).toBeVisible();
  const lines = await page.locator(".preset-card .preset-meta").allTextContents();
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(line).toMatch(/^[^A-Za-z]+$/);
  const titles = await page.locator(".preset-card .preset-name").allTextContents();
  expect(titles.filter((title) => cjk.test(title)).length).toBeGreaterThan(titles.length / 2);
  await expect(page.getByLabel("搜索体位")).toBeVisible();

  // A description can be written in Chinese.
  await page.getByRole("button", { name: "场景", exact: true }).click();
  await page.getByLabel("姿势描述").fill("一个男人坐在椅子上");
  await page.getByRole("button", { name: "应用描述", exact: true }).click();
  await ready(page, "就绪");
  await expect(page.getByLabel("支撑面", { exact: true })).toHaveValue("chair");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);

  // It stays Chinese across a reload, and the switch returns to English.
  await page.reload();
  await ready(page, "就绪");
  await page.locator("#language").click();
  await ready(page, "Ready");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#language")).toHaveText("中文");
  await expect(page.locator("#save-preset")).toHaveText(/Save preset/);
});

test("a link can name the language", async ({ page }) => {
  await page.goto("/?preset=builtin.standing-female&lang=zh");
  await ready(page, "就绪");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("#scene-title")).toHaveText("站姿 · 女性");
  await page.goto("/?preset=builtin.standing-female&lang=en");
  await ready(page, "Ready");
  await expect(page.locator("#scene-title")).toHaveText("Standing · female");
});

test.describe("a first visit", () => {
  test.use({ locale: "zh-CN" });
  test("follows a browser that reads Chinese", async ({ page }) => {
    await page.goto("/?preset=builtin.standing-female");
    await ready(page, "就绪");
    await expect(page.locator("#language")).toHaveText("EN");
  });
});

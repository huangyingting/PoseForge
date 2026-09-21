import { test, expect } from "@playwright/test";

const ready = async (page) => {
  await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#save-preset")).toBeEnabled();
};
const apply = async (page, text) => {
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await page.getByLabel("Pose description").fill(text);
  await page.getByRole("button", { name: "Apply description", exact: true }).click();
  await ready(page);
};

test("calibrated card and floor text are clear, while taller and away requests remain editable variations", async ({ page }, info) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await ready(page);
  await page.getByRole("button", { name: "Load Side by side facing", exact: true }).click();
  await ready(page);
  await expect(page.getByRole("button", { name: "Top", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".contact-result")).toHaveCount(2);
  await expect(page.locator(".contact-result.warning")).toHaveCount(0);
  const hint = page.getByText("2 figures keep fixed placement.", { exact: false });
  await expect(hint).toBeVisible();
  await page.screenshot({ path: info.outputPath("calibrated-bed.png") });
  await apply(page, "lying face to face on the floor");
  await expect(page.getByLabel("Surface", { exact: true })).toHaveValue("floor");
  await expect(hint).toBeVisible();
  await expect(page.locator(".contact-result")).toHaveCount(2);
  await expect(page.locator(".contact-result.warning")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Top", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("calibrated-floor.png") });
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  for (const actor of await page.locator(".actor-card").all()) {
    await actor.getByText(/^Placement(?: \(fixed\))?$/).click();
    await expect(actor.getByLabel("Keep placement", { exact: true })).toBeChecked();
    const position = JSON.parse(await actor.getByLabel("Solved placement", { exact: true }).getAttribute("data-position"));
    expect(position[1]).toBeLessThan(0.2);
  }
  await apply(page, "lying face to face, he is tall");
  await expect(hint).not.toBeVisible();
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await expect(page.locator(".actor-card").nth(1).getByLabel("Height", { exact: true })).toHaveValue("1.85");
  for (const actor of await page.locator(".actor-card").all()) {
    await actor.getByText(/^Placement(?: \(fixed\))?$/).click();
    await expect(actor.getByLabel("Keep placement", { exact: true })).not.toBeChecked();
  }
  await apply(page, "lying face to face, facing away");
  await expect(page.getByLabel("Facing", { exact: true })).toHaveValue("away");
  await expect(hint).not.toBeVisible();
  expect(errors).toEqual([]);
});

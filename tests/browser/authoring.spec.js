import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { BUILTIN_PRESETS, serializeCatalog } from "../../src/core/catalog.js";

const ready = async (page) => {
  await expect(page.locator("#status")).toContainText("Ready");
  await expect(page.locator("#save-preset")).toBeEnabled();
};
async function exportedScene(page) {
  await page.locator("#open-export").click();
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^Editable preset/ }).click(),
  ]);
  return JSON.parse(await readFile(await file.path(), "utf8")).presets[0].scene;
}

test("contact targets, figure names and custom behavior survive save, reload, export and history", async ({
  page,
}, info) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?preset=builtin.helping-hand");
  await ready(page);
  await expect(page.getByLabel("Contact behavior")).toHaveValue("custom");
  const contact = page.getByRole("group", { name: "Contact 1", exact: true });
  await expect(contact.locator(".contact-result")).toContainText("On target");
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page.getByLabel("Figure name", { exact: true }).nth(0).fill("Alex");
  await page.getByLabel("Figure name", { exact: true }).nth(0).press("Tab");
  await ready(page);
  await page.getByLabel("Figure name", { exact: true }).nth(1).fill("Sam");
  await page.getByLabel("Figure name", { exact: true }).nth(1).press("Tab");
  await ready(page);
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await expect(contact.getByLabel("Moving figure")).toHaveValue("0");
  await expect(
    contact.getByLabel("Moving figure").locator("option:checked"),
  ).toHaveText("Alex (1)");
  await expect(
    contact.getByLabel("Target figure").locator("option:checked"),
  ).toHaveText("Sam (2)");
  await page.getByLabel("Contact behavior").selectOption("automatic");
  await ready(page);
  await expect(page.locator(".contact-defaults li")).toHaveCount(1);
  await page.getByLabel("Contact behavior").selectOption("custom");
  await ready(page);
  await expect(page.locator(".contact-defaults")).toBeHidden();
  await contact
    .getByLabel("Target body part", { exact: true })
    .selectOption("hand.l");
  await ready(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await ready(page);
  await expect(contact.getByLabel("Target body part")).toHaveValue("forearm.l");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await ready(page);
  await expect(contact.getByLabel("Target body part")).toHaveValue("hand.l");
  await contact.getByLabel("Target body part").selectOption("forearm.l");
  await ready(page);
  await page.locator("#save-preset").click();
  await page.getByLabel("Preset name").fill("My partner gesture");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save preset", exact: true })
    .click();
  await page.reload();
  await ready(page);
  await expect(page.getByLabel("Contact behavior")).toHaveValue("custom");
  await expect(contact.getByLabel("Target body part")).toHaveValue("forearm.l");
  await expect(contact.locator(".contact-result")).toContainText("On target");
  const scene = await exportedScene(page);
  expect(scene.actors.map((actor) => actor.label)).toEqual(["Alex", "Sam"]);
  expect(scene.relationship.contactMode).toBe("custom");
  expect(scene.contacts).toMatchObject([
    { fromActor: 0, toActor: 1, from: "hand.r", to: "forearm.l", strength: 1 },
  ]);
  await contact.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("contact-editor.png") });
  expect(errors).toEqual([]);
});

test("new studies have independent figures and contacts can be added, swapped and removed on mobile", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await ready(page);
  await page
    .getByRole("button", { name: "Library", exact: false })
    .last()
    .click();
  await page.getByRole("button", { name: "+ New study", exact: true }).click();
  await ready(page);
  await expect(page.locator("#scene-title")).toHaveText("Untitled study");
  await page.getByRole("button", { name: "Edit", exact: false }).last().click();
  await expect(
    page.getByRole("button", { name: "+ Add contact", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page.getByRole("button", { name: "+ Add figure", exact: true }).click();
  await ready(page);
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await expect(page.getByLabel("Contact behavior")).toHaveValue("custom");
  await page
    .getByRole("button", { name: "+ Add contact", exact: true })
    .click();
  await ready(page);
  const row = page.getByRole("group", { name: "Contact 1", exact: true });
  await row.getByLabel("Moving figure").selectOption("1");
  await ready(page);
  await expect(row.getByLabel("Target figure")).toHaveValue("0");
  await expect(
    row.getByLabel("Target figure").locator('option[value="1"]'),
  ).toBeDisabled();
  await row.getByLabel("Body part", { exact: true }).selectOption("hand.l");
  await ready(page);
  await row.getByLabel("Target body part").selectOption("forearm.r");
  await ready(page);
  await row.getByLabel("Pull strength").evaluate((input) => {
    input.value = "0.5";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await ready(page);
  await expect(row.locator("output")).toHaveText("50%");
  const report = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(report.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("mobile-contacts.png") });
  await page
    .getByRole("button", { name: "Remove contact 1", exact: true })
    .click();
  await ready(page);
  await expect(page.locator(".contact-card")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "+ Add contact", exact: true }),
  ).toBeFocused();
});

test("removing a figure remaps surviving contacts and invalid imported sides cannot enter the library", async ({
  page,
}) => {
  const preset = structuredClone(BUILTIN_PRESETS[0]);
  preset.id = "example.three";
  preset.title = "Three figures";
  preset.scene.actors.push({
    ...preset.scene.actors[0],
    id: "third",
    label: "Figure C",
  });
  preset.scene.relationship.contactMode = "custom";
  preset.scene.contacts = [
    { fromActor: 1, toActor: 2, from: "hand.r", to: "hand.l", strength: 1 },
  ];
  await page.goto("/");
  await ready(page);
  await page
    .locator("#catalog-file")
    .setInputFiles({
      name: "three.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeCatalog([preset])),
    });
  await page
    .getByRole("button", { name: "Load Three figures", exact: true })
    .click();
  await ready(page);
  await page.getByRole("button", { name: "Figures", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove figure", exact: true })
    .first()
    .click();
  await ready(page);
  let scene = await exportedScene(page);
  expect(scene.actors.map((actor) => actor.id)).toEqual(["male", "third"]);
  expect(scene.contacts).toMatchObject([{ fromActor: 0, toActor: 1 }]);
  await page
    .getByRole("button", { name: "Remove figure", exact: true })
    .first()
    .click();
  await ready(page);
  scene = await exportedScene(page);
  expect(scene.contacts).toEqual([]);
  const invalid = JSON.parse(serializeCatalog([preset]));
  invalid.presets[0].scene.contacts[0].from = "hand.middle";
  await page
    .locator("#catalog-file")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(invalid)),
    });
  await expect(page.locator("#toast")).toContainText("Import failed");
  await expect(page.locator(".preset-card")).toHaveCount(1);
});

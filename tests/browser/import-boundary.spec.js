import { ready } from "./helpers/ready.js";
import { test, expect } from "@playwright/test";
import { BUILTIN_PRESETS, serializeCatalog } from "../../src/core/catalog.js";

test("malformed contact types reject an entire imported pack before changing the library or viewport", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?preset=builtin.standing-female");
  await ready(page);
  const count = await page.locator(".preset-card").count();
  const valid = structuredClone(
    BUILTIN_PRESETS.find((p) => p.id === "builtin.helping-hand"),
  );
  valid.id = "example.valid-import";
  valid.title = "Must not import partially";
  for (const [i, type] of [
    { toString: "invalid" },
    true,
    "",
    "x".repeat(81),
  ].entries()) {
    const pack = JSON.parse(serializeCatalog([valid]));
    const invalid = structuredClone(valid);
    invalid.id = "example.invalid-import";
    invalid.scene.contacts[0].type = type;
    pack.presets.push(invalid);
    await page.locator("#catalog-file").setInputFiles({
      name: `invalid-type-${i}.json`,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(pack)),
    });
    await expect(page.locator("#toast")).toContainText("Import failed");
    await expect(page.locator("#toast")).toContainText("Contact type");
    await expect(page.locator(".preset-card")).toHaveCount(count);
    await expect(
      page.getByRole("button", {
        name: "Load Must not import partially",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator("#scene-title")).toHaveText("Standing · female");
    await ready(page);
  }
  expect(errors).toEqual([]);
});

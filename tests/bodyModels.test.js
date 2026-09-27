import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  BODY_MODELS,
  BODY_MODEL_NAMES,
  DEFAULT_BODY_MODEL,
  bodyModel,
  modelFiles,
} from "../src/core/bodyModels.js";
import { buildHumanTemplate } from "../src/core/humanMesh.js";
import { readCards } from "../src/core/hairCards.js";
import { validateScene } from "../src/core/scene.js";

const MODELS = new URL("../assets/models/", import.meta.url);
const BODY_TYPES = ["female", "male", "neutral"];

test("the default model is the original pair of scans, and neutral wears the female skin", () => {
  assert.equal(DEFAULT_BODY_MODEL, "asian");
  assert.deepEqual(modelFiles("female"), { mesh: "female", atlas: "female" });
  assert.deepEqual(modelFiles("male", "asian"), { mesh: "male", atlas: "male" });
  assert.deepEqual(modelFiles("neutral"), { mesh: "neutral", atlas: "female" });
  assert.deepEqual(modelFiles("neutral", "mature"), {
    mesh: "neutral-mature",
    atlas: "female-mature",
  });
  assert.deepEqual(modelFiles("male", "african"), {
    mesh: "male-african",
    atlas: "male-african",
  });
  // Anything unknown is the default rather than a file that is not there.
  for (const odd of [undefined, null, "", "elf", "constructor", "__proto__"])
    assert.equal(bodyModel(odd), DEFAULT_BODY_MODEL, String(odd));
  assert.deepEqual(modelFiles("robot", "elf"), modelFiles("neutral"));
  for (const name of BODY_MODEL_NAMES)
    assert.ok(BODY_MODELS[name].label.length > 0, name);
});

test("every body type in every model has a scan, an atlas and its hair, and nothing else ships", () => {
  const expected = new Set(["HUMAN-MODEL-LICENSE.txt", "hair"]);
  // The hair is what every body shares, where each body's copy of it sits,
  // and the texture each trim names.
  const hair = new Set(["cards.bin"]);
  const { meta } = readCards(readFileSync(new URL("hair/cards.bin", MODELS)));
  for (const trim of Object.values(meta.trims)) hair.add(`${trim.texture}.png`);
  for (const model of BODY_MODEL_NAMES)
    for (const bodyType of BODY_TYPES) {
      const { mesh, atlas } = modelFiles(bodyType, model);
      expected.add(`realistic-${mesh}.glb`);
      expected.add(`skin-${atlas}.png`);
      hair.add(`cards-${mesh}.bin`);
    }
  assert.deepEqual(new Set(readdirSync(MODELS)), expected);
  assert.deepEqual(new Set(readdirSync(new URL("hair/", MODELS))), hair);
});

test("every scan parses into the same rig and topology, and every atlas is one the renderers can read", () => {
  const shapes = new Set();
  for (const model of BODY_MODEL_NAMES)
    for (const bodyType of BODY_TYPES) {
      const { mesh, atlas } = modelFiles(bodyType, model);
      const bytes = readFileSync(new URL(`realistic-${mesh}.glb`, MODELS));
      const template = buildHumanTemplate(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
      const primary = template.submeshes.find((part) => part.primary);
      assert.ok(primary?.uvs, mesh);
      // Triangles rather than vertices: the exporter splits vertices along
      // seams wherever the normals differ, so their count moves with the
      // shape. The eyes are split into white, iris and pupil by where they
      // are, so only their sum is fixed.
      shapes.add(
        JSON.stringify([
          primary.indices.length,
          template.submeshes.reduce((sum, part) => sum + part.indices.length, 0),
          template.joints.length,
        ]),
      );
      // The headless renderer decodes 8-bit truecolour, non-interlaced PNG
      // only (scripts/atlas.mjs), so a stray RGBA or palette file would draw
      // flat there and nowhere else.
      const png = readFileSync(new URL(`skin-${atlas}.png`, MODELS));
      assert.equal(png.readUInt32BE(16), 2048, atlas);
      assert.equal(png.readUInt32BE(20), 2048, atlas);
      assert.deepEqual([png[24], png[25], png[28]], [8, 2, 0], atlas);
    }
  assert.equal(shapes.size, 1, "one topology and one rig for every scan");
});

test("the generator's spec names exactly the bodies the registry loads", () => {
  const bodies = JSON.parse(
    readFileSync(new URL("../scripts/models/bodies.json", import.meta.url), "utf8"),
  );
  const meshes = new Set();
  for (const model of BODY_MODEL_NAMES)
    for (const bodyType of BODY_TYPES) {
      const { mesh, atlas } = modelFiles(bodyType, model);
      meshes.add(mesh);
      // A body wearing another's skin must say so, or the generator would
      // write a second copy of the same photograph.
      assert.equal(bodies[mesh].atlasOf ?? mesh, atlas, mesh);
      assert.equal(bodies[mesh].skin, bodies[atlas].skin, mesh);
    }
  assert.deepEqual(new Set(Object.keys(bodies)), meshes);
});

test("a scene keeps a known model and drops an unknown one with a warning", () => {
  const { scene, issues } = validateScene({
    actors: [
      { id: "a", bodyType: "female", posture: "standing", model: "european" },
      { id: "b", bodyType: "male", posture: "standing", model: "elf" },
    ],
  });
  assert.equal(scene.actors[0].model, "european");
  assert.equal(scene.actors[1].model, undefined);
  assert.ok(
    issues.some((issue) => /b: no such body model "elf"/.test(issue.message)),
    JSON.stringify(issues),
  );
});

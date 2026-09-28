import assert from "node:assert/strict";
import test from "node:test";
import { humanTemplateKey, humanBodyKey } from "../src/workers/templateKey.js";
import { DEFAULT_HAIR } from "../src/core/hair.js";
import { NAMED_PRESETS } from "../src/core/catalog.js";
import { parseDescription } from "../src/nlp/parser.js";

test("calibrated presets and taller text variations reuse the same shaped bodies", () => {
  for (const preset of NAMED_PRESETS) {
    const edited = parseDescription(
      `${preset.scene.description}, he is tall`,
    ).scene;
    for (const [i, actor] of preset.scene.actors.entries()) {
      const other = edited.actors.find((a) => a.bodyType === actor.bodyType);
      assert.ok(other, preset.id);
      assert.equal(
        humanBodyKey(actor),
        humanBodyKey(other),
        `${preset.id}: ${i}`,
      );
      // A fresh description may choose a different outfit. That must stay a
      // distinct dressed template even though its expensive body shape matches.
      assert.equal(
        humanTemplateKey(actor),
        humanTemplateKey({
          ...other,
          wearing: actor.wearing,
          outfit: actor.outfit,
        }),
        `${preset.id}: ${i}`,
      );
    }
  }
});

test("default appearance and explicit equivalent settings have one immutable key", () => {
  for (const [bodyType, bust] of [
    ["male", 0],
    ["female", 1],
    ["neutral", 0.7],
  ]) {
    const implicit = Object.freeze({
      bodyType,
      wearing: Object.freeze(["top", "shorts"]),
    });
    const explicit = {
      bodyType,
      model: "asian",
      bust,
      build: 1,
      hair: DEFAULT_HAIR[bodyType],
      wearing: ["shorts", "top", "top"],
      outfit: "black",
      expression: "soft",
    };
    assert.equal(humanTemplateKey(implicit), humanTemplateKey(explicit));
    assert.deepEqual(implicit.wearing, ["top", "shorts"]);
  }
  assert.equal(
    humanTemplateKey({}),
    humanTemplateKey({ bodyType: "neutral", wearing: [] }),
  );
  // A model nobody makes is the default, as it is for the loader.
  assert.equal(
    humanTemplateKey({ model: "elf" }),
    humanTemplateKey({ model: "asian" }),
  );
  // And an expression nobody baked is the resting face.
  assert.equal(
    humanTemplateKey({ expression: "grimace" }),
    humanTemplateKey({ expression: "soft" }),
  );
});

test("real template changes stay distinct while pose, skin tone and metadata do not rebuild geometry", () => {
  const source = {
    bodyType: "female",
    bust: 1,
    build: 1,
    hair: "medium",
    wearing: ["top", "shorts"],
    outfit: "sage",
  };
  const key = humanTemplateKey(source);
  for (const change of [
    { bodyType: "male" },
    { bodyType: "neutral" },
    { model: "european" },
    { model: "african" },
    { model: "mature" },
    { bust: 0 },
    { bust: 0.8 },
    { build: 1.1 },
    { hair: "bob" },
    { wearing: ["top"] },
    { wearing: [] },
    { outfit: "navy" },
    { expression: "smile" },
    { expression: "neutral" },
  ])
    assert.notEqual(
      humanTemplateKey({ ...source, ...change }),
      key,
      JSON.stringify(change),
    );
  assert.equal(
    humanTemplateKey({
      ...source,
      stature: 1.85,
      posture: "kneeling",
      skinTone: "#c69571",
      id: "new",
      label: "Study",
      jointMode: "fixed",
      joints: { neck: { flexion: 10 } },
      placement: { position: [1, 0, 0], rotation: [0, 90, 0] },
      hands: { l: "brace", r: "brace" },
    }),
    key,
  );
});

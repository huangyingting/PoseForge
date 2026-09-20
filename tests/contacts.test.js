import assert from "node:assert/strict";
import test from "node:test";
import { resolveLandmark } from "../src/core/landmarks.js";
import {
  checkScene,
  checkPreset,
  BUILTIN_PRESETS,
  parseCatalog,
  serializeCatalog,
} from "../src/core/catalog.js";
import { validateScene } from "../src/core/scene.js";
import { solveScene } from "../src/core/solver.js";

const study = () => structuredClone(BUILTIN_PRESETS[0].scene);
const contact = {
  fromActor: 0,
  toActor: 1,
  from: "hand.r",
  to: "hand.l",
  strength: 0.75,
};

test("invalid landmark sides and inherited property names are rejected before solving", () => {
  for (const name of [
    "hand.middle",
    "hand.",
    "hand.left.extra",
    "chest.left",
    "constructor",
    "__proto__",
    "toString",
    null,
    7,
  ]) {
    assert.equal(resolveLandmark(name), null, String(name));
    const scene = study();
    scene.contacts = [{ ...contact, from: name }];
    assert.throws(() => checkScene(scene), /body part|JSON/, String(name));
  }
  assert.equal(resolveLandmark("hand.left").bone, "hand_l");
  assert.equal(resolveLandmark("hand", "r").bone, "hand_r");
  assert.equal(resolveLandmark("upperBack").bone, "spine03");
});

test("existing scenes retain arrangement contacts unless they opt into custom-only", () => {
  const original = solveScene(checkScene(study()));
  assert.ok(original.contacts.length > 0);
  assert.ok(original.contacts.every((c) => c.source === "arrangement"));
  const scene = study();
  scene.relationship.contactMode = "custom";
  const custom = solveScene(checkScene(scene));
  assert.equal(custom.contacts.length, 0);
  assert.equal(custom.quality.contactDetail.length, 0);
  assert.ok(
    custom.actors.every((actor) =>
      actor.evaluated.positions.flat().every(Number.isFinite),
    ),
  );
});

test("custom-only removes arrangement contact alignment as well as solver targets", () => {
  // face_to_face normally closes the gap using trunk contacts before iterating.
  // With zero iterations these two runs isolate that initial alignment.
  const scene = study();
  scene.relationship.arrangement = "face_to_face";
  const automatic = solveScene(checkScene(scene), { iterations: 0 });
  scene.relationship.contactMode = "custom";
  const custom = solveScene(checkScene(scene), { iterations: 0 });
  assert.notDeepEqual(
    automatic.actors[1].pose.root.position,
    custom.actors[1].pose.root.position,
  );
  assert.equal(custom.contacts.length, 0);
});

test("authored contacts are identified separately from defaults and report both figures and sides", () => {
  const scene = study();
  scene.contacts = [contact];
  let result = solveScene(checkScene(scene));
  assert.ok(result.contacts.some((c) => c.source === "arrangement"));
  const report = result.quality.contactDetail.find(
    (c) => c.source === "custom",
  );
  assert.ok(report);
  assert.equal(report.sourceIndex, 0);
  assert.equal(report.fromActor, 0);
  assert.equal(report.toActor, 1);
  assert.equal(report.fromSide, "r");
  assert.equal(report.toSide, "l");
  assert.ok(Number.isFinite(report.distance));
  assert.equal(report.strength, 0.75);
  scene.relationship.contactMode = "custom";
  result = solveScene(checkScene(scene));
  assert.equal(result.contacts.length, 1);
  assert.equal(result.contacts[0].source, "custom");
});

test("contact behavior, labels and targets round trip together; unknown behavior fails validation", () => {
  const preset = structuredClone(BUILTIN_PRESETS[0]);
  preset.scene.relationship.contactMode = "custom";
  preset.scene.contacts = [
    { ...contact, fromActor: "female", toActor: "male" },
  ];
  preset.scene.actors[0].label = "Alex";
  assert.deepEqual(parseCatalog(serializeCatalog([preset])), [
    checkPreset(preset),
  ]);
  preset.scene.relationship.contactMode = "anything";
  assert.throws(() => checkScene(preset.scene), /Contact mode/);
  const corrected = validateScene(preset.scene);
  assert.equal(corrected.scene.relationship.contactMode, "automatic");
  assert.ok(corrected.issues.length);
});

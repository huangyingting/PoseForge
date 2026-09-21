import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  NAMED_PRESETS,
  checkScene,
  parseCatalog,
  serializeCatalog,
} from "../src/core/catalog.js";
import { ARCHETYPES } from "../src/nlp/archetypes.js";
import { parseDescription } from "../src/nlp/parser.js";
import { applyPresetLayout } from "../src/nlp/presetLayouts.js";
import { solveScene } from "../src/core/solver.js";
import { solvedPreview } from "../src/core/posePreview.js";
import { buildHumanTemplate, featureRelief, skinHumanMesh } from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";
import { withHair } from "../src/core/hair.js";
import { refineSurfaceContacts, SURFACE_CONTACT_TOLERANCE } from "../src/core/surfaceContacts.js";

const definition = ARCHETYPES.find((entry) => entry.id === "side_by_side_facing");
const preset = NAMED_PRESETS.find((entry) => entry.id === `builtin.named.${definition.id}`);
const portable = (value) => JSON.parse(JSON.stringify(value));
const draft = () => ({
  actors: structuredClone(definition.actors),
  support: { surface: definition.surface },
  relationship: { arrangement: definition.arrangement },
  contacts: structuredClone(definition.contacts ?? []),
});
const actorGeometry = (scene) => scene.actors.map(({ id, label, ...actor }) => actor);

test("all calibrated aliases and the catalog share the complete portable pose", () => {
  for (const phrase of definition.phrases) {
    const parsed = parseDescription(phrase);
    assert.deepEqual(parsed.warnings, [], phrase);
    const scene = checkScene(portable(parsed.scene));
    assert.deepEqual(actorGeometry(scene), actorGeometry(preset.scene), phrase);
    for (const key of ["contacts", "relationship", "support", "camera"])
      assert.deepEqual(scene[key], preset.scene[key], `${phrase}: ${key}`);
    assert.ok(parsed.interpretation.some((item) => item.field === "layout" && item.value === definition.id));
  }
  assert.deepEqual(parseCatalog(serializeCatalog([preset])), [preset]);
});

test("layout application is pure, preserves appearance and gives explicit cameras precedence", () => {
  const source = draft();
  Object.assign(source.actors[0], {
    id: "custom-id", label: "Custom label", skinTone: "#9d7152", outfit: "red",
    wearing: ["shorts", "top"],
  });
  source.camera = { view: "front" };
  const before = structuredClone(source), recipe = structuredClone(definition.layout);
  const result = applyPresetLayout(source, definition);
  assert.equal(result.applied, true);
  assert.deepEqual(source, before);
  assert.deepEqual(definition.layout, recipe);
  assert.deepEqual(result.scene.camera, source.camera);
  for (const key of ["id", "label", "skinTone", "outfit", "wearing"])
    assert.deepEqual(result.scene.actors[0][key], source.actors[0][key]);
  result.scene.actors[0].placement.position[0] = 9;
  result.scene.actors[0].joints.neck.flexion = 12;
  result.scene.camera.view = "side";
  assert.deepEqual(definition.layout, recipe);
  assert.deepEqual(source, before);
  assert.equal(applyPresetLayout(draft(), definition).scene.camera.view, "top");
});

test("bed and floor reference layouts differ only by the support-plane translation", () => {
  const bed = applyPresetLayout(draft(), definition).scene;
  const floorDraft = draft();
  floorDraft.support.surface = "floor";
  const floor = applyPresetLayout(floorDraft, definition);
  assert.equal(floor.applied, true);
  const shifted = structuredClone(bed.actors);
  shifted.forEach((actor) => actor.placement.position[1] -= 0.55);
  assert.deepEqual(floor.scene.actors, shifted);
  assert.deepEqual(floor.scene.camera, bed.camera);
});

test("requested variations never inherit or overwrite a stock fixed layout", () => {
  const variations = [
    (scene) => scene.actors.pop(),
    (scene) => scene.actors[0].bodyType = "male",
    (scene) => scene.actors[0].stature = 1.85,
    (scene) => scene.actors[0].build = 1.1,
    (scene) => scene.actors[0].bust = 0.8,
    (scene) => scene.actors[0].posture = "supine",
    (scene) => scene.actors[0].wearing = ["top"],
    (scene) => scene.actors[0].wearing = [],
    (scene) => scene.actors[0].jointMode = "fixed",
    (scene) => scene.actors[0].joints = { elbow_l: { flexion: 45 } },
    (scene) => scene.actors[0].placement = { position: [0, 1, 0], rotation: [0, 0, 0] },
    ...["arms", "legs", "trunk", "hands", "feet", "hair", "mobility"].map(
      (key) => (scene) => scene.actors[0][key] = key === "mobility" ? 0 : "explicit",
    ),
    (scene) => scene.relationship.arrangement = "side_by_side",
    (scene) => scene.relationship.yaw = 0,
    (scene) => scene.relationship.contactMode = "custom",
    (scene) => scene.contacts.push({ from: "hand.l", to: "hand.r", fromActor: 0, toActor: 1 }),
    (scene) => scene.support.surface = "sofa",
  ];
  for (const change of variations) {
    const scene = draft();
    change(scene);
    const before = structuredClone(scene), result = applyPresetLayout(scene, definition);
    assert.equal(result.applied, false, String(change));
    assert.ok(result.reason);
    assert.equal(result.scene, scene);
    assert.deepEqual(scene, before);
  }
});

test("literal floor calibration and taller or away fallback retain the requested settings", () => {
  const floor = parseDescription("lying face to face on the floor");
  assert.deepEqual(floor.warnings, []);
  assert.equal(floor.scene.support.surface, "floor");
  assert.equal(floor.scene.camera.view, "top");
  assert.ok(floor.scene.actors.every((actor) => actor.placement));
  for (const [text, check] of [
    ["lying face to face, he is tall", (scene) => assert.equal(scene.actors[1].stature, 1.85)],
    ["lying face to face, facing away", (scene) => assert.equal(scene.relationship.yaw, 0)],
  ]) {
    const parsed = parseDescription(text);
    assert.deepEqual(parsed.warnings, []);
    assert.ok(parsed.scene.actors.every((actor) => !actor.placement && actor.jointMode === "guided"));
    assert.ok(parsed.interpretation.some((item) => item.field === "layout" && item.value === "automatic"));
    check(parsed.scene);
  }
});

test("definitions without a calibrated recipe retain automatic placement", () => {
  for (const entry of ARCHETYPES.filter((entry) => !entry.layout)) {
    assert.ok(parseDescription(entry.phrases[0]).scene.actors.every((actor) => !actor.placement), entry.id);
    const source = draft(), result = applyPresetLayout(source, entry);
    assert.equal(result.applied, false);
    assert.equal(result.scene, source);
  }
});

const templates = new Map();
function dressed(actor) {
  const spec = actor.spec;
  if (!templates.has(spec.bodyType)) {
    const body = featureRelief(buildHumanTemplate(readFileSync(
      new URL(`../assets/models/realistic-${spec.bodyType}.glb`, import.meta.url),
    )), spec);
    templates.set(spec.bodyType, withHair(withGarments(body, {
      bodyType: spec.bodyType, wearing: spec.wearing, colour: spec.outfit,
    }), { bodyType: spec.bodyType, style: spec.hair }));
  }
  return templates.get(spec.bodyType);
}

for (const surface of ["bed", "floor"])
  test(`the clothed ${surface} layout has close contacts, clear figures and supported unchanged rigs`, () => {
    const scene = checkScene(portable(parseDescription(`lying face to face on the ${surface}`).scene));
    const solved = solveScene(scene), bodies = solved.actors.map(dressed);
    const poses = structuredClone(solved.actors.map((actor) => actor.pose));
    refineSurfaceContacts(solved, bodies);
    assert.deepEqual(solvedPreview(solved).issues, []);
    assert.deepEqual(solved.actors.map((actor) => actor.pose), poses);
    assert.equal(solved.quality.surfaceRefinement.steps, 0);
    assert.equal(solved.quality.unmetContacts, 0);
    assert.equal(solved.quality.contactDetail.length, 2);
    for (const contact of solved.quality.contactDetail) {
      assert.equal(contact.basis, "rendered");
      assert.equal(contact.intersects, false);
      assert.ok(contact.surfaceGap >= 0 && contact.surfaceGap <= SURFACE_CONTACT_TOLERANCE);
    }
    assert.equal(solved.quality.figureSurfaces.length, 1);
    assert.ok(solved.quality.figureSurfaces.every((pair) => pair.intersects === false));
    for (const key of ["maxDepth", "maxSelfDepth", "maxBodyDepth", "propPenetration"])
      assert.equal(solved.quality[key], 0, key);
    assert.ok(solved.quality.balance.every((balance) => balance.supported));
    solved.actors.forEach((actor, i) => {
      assert.equal(actor.supportBasis, "surface");
      assert.ok(actor.seatResidual <= 0.02);
      let minY = Infinity;
      for (const part of skinHumanMesh(bodies[i], actor.skeleton, actor.evaluated, undefined, actor.hands, actor.hang))
        for (const index of part.indices)
          minY = Math.min(minY, part.positions[index * 3 + 1]);
      assert.ok(Math.abs(minY - solved.surface.height) <= 0.004, `${surface} lowest surface: ${minY}`);
    });
  });

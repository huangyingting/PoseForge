import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BUILTIN_PRESETS, checkScene } from "../src/core/catalog.js";
import { limbFirstContact } from "../src/core/contactOrientation.js";
import { solveScene, measureContactTargets } from "../src/core/solver.js";
import { buildHumanTemplate, featureRelief } from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";
import { captureSolvedPose } from "../src/core/placement.js";
import {
  createSurfaceContactQuery,
  measureSurfaceSafety,
  refineSurfaceContacts,
  surfaceContactSteps,
  SURFACE_CONTACT_TOLERANCE,
} from "../src/core/surfaceContacts.js";

const reverse = (contact) => ({
  ...contact,
  from: contact.to,
  fromSide: contact.toSide,
  fromActor: contact.toActor,
  to: contact.from,
  toSide: contact.fromSide,
  toActor: contact.fromActor,
});
const scene = (reversed = true) => {
  const result = structuredClone(
    BUILTIN_PRESETS.find((p) => p.id === "builtin.named.standing_embrace")
      .scene,
  );
  if (reversed) result.contacts = result.contacts.map(reverse);
  return checkScene(JSON.parse(JSON.stringify(result)));
};
const cache = new Map();
function bodies(solved) {
  return solved.actors.map((actor) => {
    if (!cache.has(actor.bodyType))
      cache.set(
        actor.bodyType,
        withGarments(
          featureRelief(
            buildHumanTemplate(
              readFileSync(
                new URL(
                  `../assets/models/realistic-${actor.bodyType}.glb`,
                  import.meta.url,
                ),
              ),
            ),
            { bodyType: actor.bodyType, build: 1 },
          ),
          { bodyType: actor.bodyType, wearing: ["top", "shorts"] },
        ),
      );
    return cache.get(actor.bodyType);
  });
}
const poses = (solved) =>
  structuredClone(solved.actors.map((actor) => actor.pose));
const descriptor = ({
  from,
  to,
  fromActor,
  toActor,
  fromSide,
  toSide,
  strength,
  source,
  sourceIndex,
}) => ({
  from,
  to,
  fromActor,
  toActor,
  fromSide,
  toSide,
  strength,
  source,
  sourceIndex,
});

test("limb-first working contacts preserve metadata, side syntax and the original object", () => {
  const bodyFirst = {
    from: "back",
    fromActor: 0,
    to: "hand.right",
    toActor: 1,
    strength: 0.7,
    source: "custom",
    sourceIndex: 3,
  };
  const before = structuredClone(bodyFirst),
    working = limbFirstContact(bodyFirst);
  assert.deepEqual(working, reverse(bodyFirst));
  assert.deepEqual(bodyFirst, before);
  assert.equal(limbFirstContact(working), working);
  for (const contact of [
    { from: "chest", to: "back" },
    { from: "hand.left", to: "forearm.right" },
    { from: "chest", to: "shoulder.left" },
  ])
    assert.equal(limbFirstContact(contact), contact);
});

test("equivalent body-first and hand-first inputs produce the same coarse pose and retain authored reports", () => {
  const forward = solveScene(scene(false)),
    input = scene(),
    before = structuredClone(input);
  const reversed = solveScene(input);
  assert.deepEqual(poses(reversed), poses(forward));
  assert.deepEqual(input, before);
  assert.deepEqual(
    reversed.quality.contactDetail.map(descriptor),
    reversed.contacts.map(descriptor),
  );
  assert.deepEqual(
    measureContactTargets(reversed),
    measureContactTargets(forward),
  );
  assert.deepEqual(
    reversed.quality.contactDetail.map((c) => c.distance),
    measureContactTargets(reversed),
  );
});

test("supporting-hand IK does not introduce coarse overlap failures in standing and kneeling carry variants", () => {
  for (const [primary, secondary] of [
    ["standing", "lifted"],
    ["kneeling", "lifted"],
    ["kneeling", "inverted"],
  ]) {
    const solved = solveScene({
      support: { surface: "bed" },
      relationship: { arrangement: "supported_lift" },
      actors: [
        { posture: primary, bodyType: "female" },
        { posture: secondary, bodyType: "male" },
      ],
      contacts: [],
    });
    assert.ok(
      solved.quality.maxDepth <= 0.022,
      `${primary}/${secondary}: ${solved.quality.maxDepth}`,
    );
    assert.ok(Math.min(...solved.quality.convergence) <= 0.022);
  }
});

test("overlap-aware snapshot selection still reports an unavoidable fixed-body collision", () => {
  const solved = solveScene({
    support: { surface: "floor" },
    relationship: { contactMode: "custom" },
    actors: ["female", "male"].map((bodyType) => ({
      bodyType,
      posture: "standing",
      placement: { position: [0, 0.95, 0], rotation: [0, 0, 0] },
    })),
    contacts: [],
  });
  assert.ok(solved.quality.maxDepth > 0.022);
  assert.ok(solved.quality.count > 0);
});

test("body-first rendered contacts move the free hands while retaining roots, target figure and authored direction", () => {
  const solved = solveScene(scene()),
    original = poses(solved),
    contacts = structuredClone(solved.contacts);
  const templates = bodies(solved),
    query = createSurfaceContactQuery(solved.actors, templates);
  const initial = measureSurfaceSafety(solved, query);
  assert.deepEqual(initial.limbIntersections, [true, true]);
  refineSurfaceContacts(solved, templates, { maxBodySteps: 0 });
  assert.deepEqual(solved.contacts, contacts);
  assert.deepEqual(
    solved.quality.contactDetail.map(descriptor),
    contacts.map(descriptor),
  );
  const hands = solved.quality.contactDetail.filter((c) => c.to === "hand");
  assert.equal(hands.length, 2);
  assert.ok(
    hands.every(
      (c) =>
        c.basis === "rendered" &&
        !c.intersects &&
        c.surfaceGap <= SURFACE_CONTACT_TOLERANCE,
    ),
  );
  assert.deepEqual(solved.actors[0].pose, original[0]);
  solved.actors.forEach((actor, i) => {
    assert.deepEqual(actor.pose.root, original[i].root);
    for (const [bone, angles] of Object.entries(original[i].joints))
      if (!/^(shoulder|elbow|wrist)_/.test(bone))
        assert.deepEqual(actor.pose.joints[bone], angles);
  });
  const violations = new Map(initial.violations.map((v) => [v.key, v.depth]));
  assert.ok(
    solved.quality.violations.every(
      (v) => v.depth <= (violations.get(v.key) ?? 0) + 1e-8,
    ),
  );
  assert.ok(solved.quality.surfaceRefinement.steps <= 32);
});

test("fixed target-end hands and load-bearing target limbs are not released by contact reversal", () => {
  const input = scene(),
    initial = solveScene(input);
  input.actors.forEach((actor, i) =>
    Object.assign(actor, captureSolvedPose(initial.actors[i])),
  );
  const fixed = solveScene(input),
    before = poses(fixed);
  refineSurfaceContacts(fixed, bodies(fixed), { maxBodySteps: 0 });
  assert.deepEqual(poses(fixed), before);
  assert.equal(fixed.quality.surfaceRefinement.steps, 0);
  assert.ok(
    fixed.quality.contactDetail
      .filter((c) => c.to === "hand")
      .every((c) => c.reason === "fixed_channels"),
  );
  const bearing = solveScene(scene());
  bearing.contacts = [
    {
      from: "chest",
      to: "foot",
      fromActor: 0,
      toActor: 1,
      toSide: "l",
      strength: 1,
    },
  ];
  const supported = poses(bearing);
  refineSurfaceContacts(bearing, bodies(bearing));
  assert.deepEqual(poses(bearing), supported);
  assert.equal(bearing.quality.contactDetail[0].reason, "load_bearing");
});

test("the complete reversed standing scene resolves its body and hand contacts without changing report direction", () => {
  const solved = solveScene(scene()),
    contacts = structuredClone(solved.contacts);
  refineSurfaceContacts(solved, bodies(solved));
  assert.equal(solved.quality.unmetContacts, 0);
  assert.ok(
    solved.quality.contactDetail.every(
      (contact) =>
        contact.basis === "rendered" &&
        !contact.intersects &&
        contact.surfaceGap <= SURFACE_CONTACT_TOLERANCE,
    ),
  );
  assert.ok(
    solved.quality.figureSurfaces.every((pair) => pair.intersects === false),
  );
  assert.deepEqual(
    solved.quality.contactDetail.map(descriptor),
    contacts.map(descriptor),
  );
});

test("zero-strength reversed contacts and unavailable models retain the coarse pose", () => {
  for (const missing of [false, true]) {
    const solved = solveScene(scene());
    solved.contacts = solved.contacts.filter((c) => c.to === "hand");
    if (!missing)
      solved.contacts.forEach((c) => {
        c.strength = 0;
      });
    const before = poses(solved);
    refineSurfaceContacts(solved, missing ? [null, null] : bodies(solved));
    assert.deepEqual(poses(solved), before);
    assert.equal(solved.quality.surfaceRefinement.steps, 0);
    if (missing)
      assert.ok(
        solved.quality.contactDetail.every((c) => c.basis === "body-model"),
      );
  }
});

test("reversed limb work respects the shared budget and cancellation restores an accepted candidate", () => {
  const limited = solveScene(scene());
  refineSurfaceContacts(limited, bodies(limited), {
    maxSteps: 1,
    maxBodySteps: 0,
  });
  assert.ok(limited.quality.surfaceRefinement.steps <= 1);
  const solved = solveScene(scene()),
    before = poses(solved),
    quality = structuredClone(solved.quality);
  const iterator = surfaceContactSteps(solved, bodies(solved), {
    maxBodySteps: 0,
  });
  let changed = false;
  for (let i = 0; i < 64; i++) {
    const step = iterator.next();
    if (step.done) break;
    if (JSON.stringify(poses(solved)) !== JSON.stringify(before)) {
      changed = true;
      break;
    }
  }
  assert.equal(changed, true);
  iterator.return();
  assert.deepEqual(poses(solved), before);
  assert.deepEqual(solved.quality, quality);
});

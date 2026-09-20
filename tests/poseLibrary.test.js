/**
 * The pose library and the scene it validates.
 *
 * Every posture, arrangement and surface in here is data, and data with no
 * code in it fails silently: an authored joint angle outside the range of
 * motion is quietly clamped to something else, a support naming a landmark
 * that does not exist is quietly ignored, an alias pointing at a deleted entry
 * quietly becomes a standing figure. None of that throws and none of it shows
 * up in a render as anything more specific than "that looks a bit wrong", so
 * the catalogue is checked against the rig and against itself here.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ARRANGEMENTS,
  ARRANGEMENT_ALIASES,
  ARRANGEMENT_NAMES,
  POSTURES,
  POSTURE_ALIASES,
  POSTURE_NAMES,
  SURFACES,
  SURFACE_ALIASES,
  SURFACE_NAMES,
  canBeCarried,
  isKnownSurface,
  isRecumbent,
  orientationFromAxes,
  reconcileArrangement,
  resolveArrangement,
  resolvePosture,
  resolveSurface,
  rollPosture,
  supportPlaneFor,
} from "../src/core/poseLibrary.js";
import { validateScene, emptyScene, BODY_TYPES } from "../src/core/scene.js";
import { Skeleton } from "../src/core/skeleton.js";
import { resolveLandmark } from "../src/core/landmarks.js";
import { createActor, refresh, seatOnSurface, solveScene } from "../src/core/solver.js";
import { quatRotate, v3dot, v3len } from "../src/core/math.js";

const AXES = ["flexion", "abduction", "rotation"];
const skeleton = new Skeleton({ bodyType: "neutral" });

const warningsOf = (result) => result.issues.map((issue) => issue.message).join(" | ");

test("every posture is complete and describes a real body", () => {
  for (const [name, posture] of Object.entries(POSTURES)) {
    assert.ok(posture.label, `${name} has no label`);
    assert.ok(Array.isArray(posture.supports), `${name} has no supports list`);
    assert.ok(posture.joints && Object.keys(posture.joints).length, `${name} has no joints`);
    // `rootHeight` is a fraction of stature and only a starting guess, but a
    // guess outside the body is not a guess.
    assert.ok(
      posture.rootHeight >= 0 && posture.rootHeight <= 1,
      `${name}: rootHeight ${posture.rootHeight}`
    );
    // The two axes have to be close to unit and genuinely independent, or
    // `orientationFromAxes` builds a basis out of a degenerate pair.
    assert.ok(Math.abs(v3len(posture.spineDir) - 1) < 0.01, `${name}: spineDir is not unit`);
    assert.ok(Math.abs(v3len(posture.faceDir) - 1) < 0.01, `${name}: faceDir is not unit`);
    assert.ok(
      Math.abs(v3dot(posture.spineDir, posture.faceDir)) < 0.02,
      `${name}: the spine and the face point the same way`
    );
  }
});

test("no posture asks a joint for an angle the body cannot make", () => {
  // An authored angle outside the range of motion does not fail, it is clamped
  // - so the posture that gets rendered is not the posture that was written,
  // and nothing anywhere says so.
  for (const [name, posture] of Object.entries(POSTURES)) {
    for (const [joint, angles] of Object.entries(posture.joints)) {
      assert.ok(skeleton.boneIndex(joint) >= 0, `${name}: there is no joint called ${joint}`);
      const clamped = skeleton.clampAngles(joint, angles);
      for (const axis of AXES) {
        assert.ok(
          Math.abs((clamped[axis] ?? 0) - (angles[axis] ?? 0)) < 1e-9,
          `${name}: ${joint}.${axis} was authored at ${angles[axis]} and clamps to ${clamped[axis]}`
        );
      }
    }
  }
});

test("every declared support names a landmark that exists", () => {
  for (const [name, posture] of Object.entries(POSTURES)) {
    for (const support of posture.supports) {
      assert.ok(
        resolveLandmark(support.landmark, support.side ?? null),
        `${name}: no landmark called "${support.landmark}"`
      );
      if (support.side) assert.ok(["l", "r"].includes(support.side), `${name}: side ${support.side}`);
    }
  }
});

test("a posture the ground holds up is not a posture a partner can carry", () => {
  // The test is what the posture rests on: a trunk resting on something could
  // as easily rest on a person, but limbs braced against the floor are
  // load-bearing and a person is not what they are braced against.
  assert.equal(canBeCarried(POSTURES.standing), false, "a standing figure was called carryable");
  assert.equal(canBeCarried(POSTURES.all_fours), false, "hands and knees are load-bearing");
  assert.equal(canBeCarried(POSTURES.supine), true, "a supine figure cannot be carried");
  assert.equal(canBeCarried(POSTURES.lifted), true, "the lifted posture cannot be lifted");

  for (const [name, posture] of Object.entries(POSTURES)) {
    if (posture.supports.some((s) => ["foot", "knee", "hand", "shin", "forearm"].includes(s.landmark))) {
      assert.equal(canBeCarried(posture), false, `${name} is braced on the ground but called carryable`);
    }
  }
});

test("lying down is not the same as being horizontal", () => {
  // Someone on all fours has a horizontal spine too, and the difference
  // matters: a body lying along the floor can be rolled about its own spine
  // and is still lying on the floor, whereas rolling an all-fours body about
  // its spine turns it upside down.
  for (const name of ["supine", "prone", "side_lying"]) {
    assert.equal(isRecumbent(POSTURES[name]), true, `${name} is not recumbent`);
  }
  for (const name of ["standing", "all_fours", "kneeling", "seated", "bent_over_support"]) {
    assert.equal(isRecumbent(POSTURES[name]), false, `${name} was called recumbent`);
  }
});

test("rolling a posture swaps which side is underneath and nothing else", () => {
  const rolled = rollPosture(resolvePosture("side_lying"));
  assert.notEqual(rolled.id, "side_lying");
  // A rigid rotation about the spine does not change any joint angle; what it
  // changes is which landmarks end up holding the actor up.
  assert.deepEqual(rolled.joints, POSTURES.side_lying.joints);
  assert.equal(rolled.supports.length, POSTURES.side_lying.supports.length);
  POSTURES.side_lying.supports.forEach((support, index) => {
    const after = rolled.supports[index];
    assert.equal(after.landmark, support.landmark, "the roll changed which parts bear weight");
    const expected = support.side === "l" ? "r" : support.side === "r" ? "l" : support.side;
    assert.equal(after.side, expected, `${support.landmark} did not swap sides`);
  });
});

test("orientationFromAxes builds the frame it was asked for", () => {
  for (const [spine, face] of [
    [[0, 1, 0], [0, 0, 1]], // standing
    [[0, 0, 1], [0, -1, 0]], // supine: head down +z, face at the ceiling
    [[1, 0, 0], [0, 0, 1]],
  ]) {
    const q = orientationFromAxes(spine, face);
    // Four components, not three: a quaternion whose w is ignored looks like a
    // unit vector for the identity rotation and like nothing at all otherwise.
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-9, "the orientation is not a unit quaternion");
    // The rig is authored with the spine along +y and the face along +z, so
    // the quaternion has to carry those two axes onto the declared ones.
    const gotSpine = quatRotate(q, [0, 1, 0]);
    const gotFace = quatRotate(q, [0, 0, 1]);
    for (let i = 0; i < 3; i += 1) {
      assert.ok(Math.abs(gotSpine[i] - spine[i]) < 1e-9, `spine axis went to ${gotSpine}`);
      assert.ok(Math.abs(gotFace[i] - face[i]) < 1e-9, `face axis went to ${gotFace}`);
    }
  }
  // Every posture's own pair has to survive the same trip.
  for (const [name, posture] of Object.entries(POSTURES)) {
    const q = orientationFromAxes(posture.spineDir, posture.faceDir);
    for (const value of q) assert.ok(Number.isFinite(value), `${name} produced a NaN orientation`);
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-6, `${name} produced a non-unit orientation`);
  }
});

test("every arrangement is complete and refers to real body parts", () => {
  for (const [name, arrangement] of Object.entries(ARRANGEMENTS)) {
    assert.ok(arrangement.label, `${name} has no label`);
    assert.equal(arrangement.offset?.length, 3, `${name}: offset is not a 3-vector`);
    for (const value of arrangement.offset) {
      assert.ok(Number.isFinite(value), `${name}: offset holds ${value}`);
      // Offsets are fractions of stature, so anything past one body length is
      // a typo rather than a pose.
      assert.ok(Math.abs(value) <= 1, `${name}: offset component ${value} is over a stature`);
    }
    assert.ok(Number.isFinite(arrangement.yaw), `${name}: yaw is ${arrangement.yaw}`);
    assert.ok(arrangement.yaw >= 0 && arrangement.yaw < 360, `${name}: yaw ${arrangement.yaw}`);
    // An arrangement with no contacts has nothing holding the pair together,
    // and the collision stage is free to slide them apart - and does.
    assert.ok(arrangement.contacts?.length, `${name} has no contacts to hold the pair together`);
    for (const contact of arrangement.contacts) {
      for (const end of [contact.from, contact.to]) {
        assert.ok(resolveLandmark(String(end)), `${name}: no body part called "${end}"`);
      }
      assert.ok(
        contact.strength > 0 && contact.strength <= 1,
        `${name}: contact strength ${contact.strength}`
      );
    }
  }
});

test("an arrangement declares what it needs rather than leaving it to be inferred", () => {
  // The library's rule is that anything the solver would otherwise have to
  // guess is written down. These are the flags that carry it, and they only
  // work if they are on the arrangements that actually mean them.
  assert.equal(ARRANGEMENTS.over_supine.mounted, true, "being on top of someone is not declared");
  assert.equal(ARRANGEMENTS.head_to_toe.carried, true, "head to toe does not declare its support");
  assert.equal(ARRANGEMENTS.head_to_toe.turn, "vertical", "head to toe does not declare its turn");
  assert.ok(ARRANGEMENTS.supported_lift.clear, "a lift does not declare what it must clear");
  assert.ok(
    ["approach", "lateral", "vertical"].includes(ARRANGEMENTS.supported_lift.clear.axis),
    `unknown clearance axis ${ARRANGEMENTS.supported_lift.clear.axis}`
  );
});

test("every alias points at something that still exists", () => {
  // An alias to a renamed entry does not throw: it resolves to nothing and the
  // scene silently becomes a standing figure on the floor.
  for (const [alias, target] of Object.entries(POSTURE_ALIASES)) {
    assert.ok(POSTURES[target], `posture alias "${alias}" points at missing "${target}"`);
    assert.equal(resolvePosture(alias).id, target);
  }
  for (const [alias, target] of Object.entries(ARRANGEMENT_ALIASES)) {
    assert.ok(ARRANGEMENTS[target], `arrangement alias "${alias}" points at missing "${target}"`);
    assert.equal(resolveArrangement(alias).id, target);
  }
  for (const [alias, target] of Object.entries(SURFACE_ALIASES)) {
    assert.ok(SURFACES[target], `surface alias "${alias}" points at missing "${target}"`);
    assert.equal(resolveSurface(alias).id, target);
  }
  // And no alias shadows a real name, which would make the alias unreachable.
  for (const alias of Object.keys(POSTURE_ALIASES)) {
    assert.ok(!(alias in POSTURES), `"${alias}" is both a posture and an alias`);
  }
});

test("resolving says no to an unknown name, except where it must not", () => {
  assert.equal(resolvePosture("hammock"), null);
  assert.equal(resolvePosture(null), null);
  assert.equal(resolveArrangement("piggyback"), null);
  assert.equal(resolveArrangement(null), null);
  // The surface is the exception: the solver always needs something to stand
  // on, so `resolveSurface` falls back rather than failing - which is exactly
  // why it cannot be used to tell a known name from an unknown one.
  assert.equal(resolveSurface("hammock").id, "floor");
  assert.equal(resolveSurface(null).id, "floor");
  assert.equal(isKnownSurface("hammock"), false);
  assert.equal(isKnownSurface("couch"), true, "a known alias was called unknown");
  assert.equal(isKnownSurface("bed"), true);
  assert.equal(isKnownSurface(null), false);
});

test("a surface carries both of the heights a posture can need", () => {
  for (const [name, surface] of Object.entries(SURFACES)) {
    assert.ok(Number.isFinite(surface.height), `${name}: height is ${surface.height}`);
    assert.ok(Number.isFinite(surface.ground), `${name}: ground is ${surface.ground}`);
    assert.ok(surface.ground <= surface.height, `${name}: the floor is above the surface`);
    // The two are equal exactly when the surface is one you get on top of.
    // Anything else is a prop you stand beside, and its ground is the floor.
    assert.ok(
      surface.ground === surface.height || surface.ground === 0,
      `${name}: ground ${surface.ground} is neither the top nor the floor`
    );
    if (surface.props.length) {
      const tops = surface.props.map((prop) => prop.center[1] + prop.size[1] / 2);
      assert.ok(
        tops.some((top) => Math.abs(top - surface.height) < 1e-9),
        `${name}: no prop's top is at the declared height of ${surface.height}`
      );
      for (const prop of surface.props) {
        for (const size of prop.size) assert.ok(size > 0, `${name}: a prop has size ${size}`);
        assert.ok(
          prop.center[1] - prop.size[1] / 2 >= -1e-9,
          `${name}: the ${prop.kind} starts below the floor`
        );
      }
    }
  }
});

test("a trunk seeks the surface and the limbs seek the ground", () => {
  const foot = { landmark: "foot", side: "l" };
  const trunk = { landmark: "buttocks" };
  const bed = resolveSurface("bed");
  const chair = resolveSurface("chair");
  const table = resolveSurface("table");

  // On a bed the two heights are the same and the rule costs nothing.
  assert.equal(supportPlaneFor(foot, bed), bed.height);
  assert.equal(supportPlaneFor(trunk, bed), bed.height);

  // On a chair it is the difference between sitting and toppling backwards
  // until your feet come up level with your own buttocks.
  assert.equal(supportPlaneFor(trunk, chair), chair.height);
  assert.equal(supportPlaneFor(foot, chair), chair.ground);
  assert.ok(supportPlaneFor(trunk, chair) - supportPlaneFor(foot, chair) > 0.4);

  // And a woman bent over a table has her chest at 750mm and her feet down on
  // the floor with it.
  assert.equal(supportPlaneFor({ landmark: "chest" }, table), 0.75);
  assert.equal(supportPlaneFor(foot, table), 0);
});

test("reconciling leaves a mounted arrangement alone and mounts the ones that need it", () => {
  const behind = resolveArrangement("rear_alignment");
  const over = resolveArrangement("over_supine");

  // Already mounted, or with nothing to reconcile: unchanged.
  assert.equal(reconcileArrangement(over, POSTURES.supine, POSTURES.kneeling), over);
  assert.equal(reconcileArrangement(behind, POSTURES.standing, POSTURES.standing), behind);
  assert.equal(reconcileArrangement(null, POSTURES.supine, POSTURES.kneeling), null);

  // A partner on the ground with the other up on their limbs: "behind" means
  // over. Put an all-fours partner a third of a stature in front of someone
  // lying down and you have put their knees on that person's shoulders.
  const mounted = reconcileArrangement(behind, POSTURES.supine, POSTURES.all_fours);
  assert.equal(mounted.mounted, true, "the pair was not mounted");
  assert.equal(mounted.reconciledFrom, "rear_alignment", "the original was not recorded");
  // A trace of the original direction survives, but small enough that the pair
  // starts overlapping rather than end to end.
  assert.ok(
    Math.abs(mounted.offset[2]) < Math.abs(behind.offset[2]),
    "the offset was not pulled in"
  );
  assert.equal(Math.sign(mounted.offset[2]), Math.sign(behind.offset[2]), "behind became in front");
  assert.equal(mounted.yaw, behind.yaw, "reconciling changed who faces whom");

  // Face down, the front of the lower partner is against the bed, so what the
  // partner above can reach is the back of the same region.
  const onFront = reconcileArrangement(behind, POSTURES.prone, POSTURES.all_fours);
  const targets = onFront.contacts.map((c) => c.to);
  assert.ok(!targets.includes("chest"), "a chest against the mattress was still targeted");
  assert.ok(
    targets.includes("buttocks") || targets.includes("upperBack"),
    `nothing was remapped: ${targets}`
  );
});

test("validateScene always returns the same shape, whatever it is given", () => {
  for (const input of [null, undefined, 42, "a scene", {}, { actors: [] }, emptyScene()]) {
    const { scene, issues } = validateScene(input);
    assert.ok(Array.isArray(scene.actors) && scene.actors.length >= 1, "nobody in the scene");
    assert.ok(Array.isArray(scene.contacts), "contacts is not a list");
    assert.ok(scene.support && typeof scene.support.surface === "string", "no surface");
    assert.ok(scene.relationship && typeof scene.relationship === "object", "no relationship");
    assert.ok(Array.isArray(issues), "issues is not a list");
    for (const issue of issues) {
      assert.ok(["error", "warning"].includes(issue.level), `unknown level ${issue.level}`);
      assert.ok(issue.message, "an issue with no message");
    }
  }
});

test("a scene that cannot be rendered as asked is repaired, and the repair is reported", () => {
  // Never a throw and never an empty screen: a bad field becomes a sensible
  // picture plus a note saying what was substituted.
  const { scene, issues } = validateScene({
    actors: [
      { id: "a", posture: "standingg", bodyType: "femal", stature: 3.4, build: 9 },
      { id: "b", posture: "kneeling" },
    ],
    relationship: { arrangement: "behind_the_other" },
    support: { surface: "hammock" },
  });

  assert.equal(scene.actors[0].posture, "standing");
  assert.ok(BODY_TYPES.includes(scene.actors[0].bodyType));
  assert.ok(scene.actors[0].stature <= 2.1, `stature ${scene.actors[0].stature}`);
  assert.ok(scene.actors[0].build <= 1.3, `build ${scene.actors[0].build}`);
  assert.ok(ARRANGEMENT_NAMES.includes(scene.relationship.arrangement));
  assert.equal(scene.support.surface, "floor");

  const said = warningsOf({ issues });
  for (const mention of ["standingg", "femal", "hammock", "behind_the_other"]) {
    assert.ok(said.includes(mention), `nothing was said about "${mention}": ${said}`);
  }
  // A near miss gets a suggestion, because "unknown posture" alone does not
  // tell anyone what to type instead.
  assert.ok(/did you mean "standing"/.test(said), `no suggestion offered: ${said}`);
});

test("a contact the solver could not act on is dropped and explained", () => {
  const { scene, issues } = validateScene({
    actors: [{ id: "a", posture: "standing" }, { id: "b", posture: "standing" }],
    contacts: [
      { from: "hand.l", to: "hip", fromActor: "a", toActor: "b" },
      { from: "hand.l", to: "hip", fromActor: "a", toActor: "a" }, // itself
      { from: "hand.l", to: "antenna", fromActor: "a", toActor: "b" }, // no such part
      { from: "hand.l", to: "hip", fromActor: "a", toActor: "nobody" }, // no such person
    ],
  });
  assert.equal(scene.contacts.length, 1, `kept ${scene.contacts.length} contacts`);
  assert.equal(scene.contacts[0].fromActor, 0);
  assert.equal(scene.contacts[0].toActor, 1);

  const said = warningsOf({ issues });
  assert.ok(said.includes("both ends are the same person"), said);
  assert.ok(said.includes("antenna"), said);
  assert.ok(said.includes("no such person"), said);
});

test("a facing direction with nobody to turn relative to is ignored, not applied", () => {
  const alone = validateScene({
    actors: [{ posture: "standing" }],
    relationship: { yaw: 180 },
  });
  assert.equal(alone.scene.relationship.yaw, undefined, "a lone figure was turned relative to nobody");
  assert.ok(warningsOf(alone).includes("nobody to turn"), warningsOf(alone));

  // With two people and an arrangement it is kept exactly as given.
  const pair = validateScene({
    actors: [{ posture: "supine" }, { posture: "kneeling_straddle" }],
    relationship: { arrangement: "straddle_supine", yaw: 180 },
  });
  assert.equal(pair.scene.relationship.yaw, 180);
  assert.equal(pair.scene.relationship.arrangement, "straddle_supine");
});

test("two people with nothing said about them are still arranged somehow", () => {
  const { scene } = validateScene({ actors: [{ posture: "standing" }, { posture: "standing" }] });
  assert.ok(ARRANGEMENT_NAMES.includes(scene.relationship.arrangement), "a pair with no arrangement");
  // One person needs none, and inventing one would place them against nobody.
  const solo = validateScene({ actors: [{ posture: "standing" }] });
  assert.equal(solo.scene.relationship.arrangement, undefined);
});

test("the catalogue name lists match the catalogues", () => {
  assert.deepEqual(POSTURE_NAMES, Object.keys(POSTURES));
  assert.deepEqual(ARRANGEMENT_NAMES, Object.keys(ARRANGEMENTS));
  assert.deepEqual(SURFACE_NAMES, Object.keys(SURFACES));
  // The UI builds its menus from these, so an entry missing from one is an
  // entry a user cannot choose.
  assert.ok(POSTURE_NAMES.length > 10 && ARRANGEMENT_NAMES.length > 5);
});

/**
 * Every validator in this repository seats an actor once and measures it.
 * `solveScene` used to seat twice - once, then again after standing clear of
 * any props - and seating is not idempotent: `settleLimbs` finds a little more
 * to give each time it runs. So `forearms_and_knees` measured as a figure on
 * her forearms and knees and rendered as one balanced on the top of her head,
 * with half a metre between the two pictures and nothing in the suite able to
 * see it, because nothing in the suite went round twice.
 *
 * This pins the invariant the rest of the file relies on rather than the
 * particular fix: what the solver draws has to be what the validators check.
 * Postures that bring a prop with them are left out, because for those the two
 * are *meant* to differ - the solver puts a chair in the scene and steps the
 * figure onto it, which is the one case the second seating exists for.
 */
test("a figure on the floor is drawn where seating alone puts her", () => {
  for (const name of POSTURE_NAMES) {
    if (POSTURES[name].surface) continue;
    const { scene } = validateScene({ actors: [{ posture: name, bodyType: "female" }] });
    const surface = resolveSurface("floor");

    const seated = refresh(createActor(scene.actors[0], 0));
    seatOnSurface(seated, surface);
    const solved = solveScene(scene).actors[0];

    let worst = 0;
    for (let i = 0; i < seated.volumes.length; i += 1) {
      for (const end of ["a", "b"]) {
        for (let axis = 0; axis < 3; axis += 1) {
          const drift = Math.abs(seated.volumes[i][end][axis] - solved.volumes[i][end][axis]);
          worst = Math.max(worst, drift);
        }
      }
    }
    // Room for the contact and collision work the solver does afterwards, which
    // moves a limb by a couple of centimetres. The bug this guards against moved
    // a whole figure by 480mm.
    assert.ok(
      worst < 0.05,
      `${name}: the solved pose is ${(worst * 1000).toFixed(0)}mm from the seated one`,
    );
  }
});

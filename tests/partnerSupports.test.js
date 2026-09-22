import assert from "node:assert/strict";
import test from "node:test";
import {
  solveScene,
  seatOnSurface,
  refresh,
  createActor,
} from "../src/core/solver.js";
import { resolveLandmark } from "../src/core/landmarks.js";
import { POSTURES } from "../src/core/poseLibrary.js";
import { limbFirstContact } from "../src/core/contactOrientation.js";

const links = [
  {
    from: "hand.l",
    to: "knee.r",
    fromActor: 0,
    toActor: 1,
    type: "support",
    strength: 0.7,
  },
  {
    from: "hand.r",
    to: "knee.l",
    fromActor: 0,
    toActor: 1,
    type: "support",
    strength: 0.7,
  },
];
const scene = (contacts = links) => ({
  actors: [
    { bodyType: "male", posture: "supine" },
    {
      bodyType: "female",
      posture: "kneeling_straddle",
      joints: { hip_l: { abduction: 65 }, hip_r: { abduction: 65 } },
    },
  ],
  support: { surface: "floor" },
  relationship: { arrangement: "straddle_supine" },
  contacts: structuredClone(contacts),
});
const kneeY = (actor, side) => {
  const bones = resolveLandmark("knee", side).bones;
  return Math.min(
    ...actor.volumes
      .filter((v) => bones.includes(v.bone))
      .flatMap((v) => [v.a[1] - v.ra, v.b[1] - v.rb]),
  );
};
const reverse = ({ from, to, fromActor, toActor, ...rest }) => ({
  from: to,
  to: from,
  fromActor: toActor,
  toActor: fromActor,
  ...rest,
});

test("positive hand supports preserve a mounted figure's held-knee stance before contact iteration", () => {
  for (const contacts of [links, links.map(reverse)]) {
    const spec = scene(contacts),
      before = structuredClone(spec),
      posture = structuredClone(POSTURES.kneeling_straddle);
    const solved = solveScene(spec, { iterations: 0 }),
      actor = solved.actors[1];
    assert.equal(actor.mountedOn, 0);
    assert.equal(actor.supportBasis, "partner");
    assert.equal(actor.seatResidual, null);
    assert.equal(actor.pose.joints.hip_l.abduction, 65);
    assert.equal(actor.pose.joints.hip_r.abduction, 65);
    assert.ok(kneeY(actor, "l") > 0.1 && kneeY(actor, "r") > 0.1);
    assert.deepEqual([...actor.partnerSupportKeys].sort(), [
      "knee.l",
      "knee.r",
    ]);
    assert.deepEqual(actor.posture.supports, posture.supports);
    assert.ok(
      actor.loadBearing.has("knee_l") && actor.loadBearing.has("knee_r"),
    );
    assert.deepEqual(spec, before, "ownership must not mutate scene input");
    assert.deepEqual(
      POSTURES.kneeling_straddle,
      posture,
      "shared posture definitions remain unchanged",
    );
    assert.deepEqual(
      solved.contacts
        .slice(-2)
        .map(({ fromActor, toActor, type, strength }) => [
          fromActor,
          toActor,
          type,
          strength,
        ]),
      contacts.map((c) => [c.fromActor, c.toActor, c.type, c.strength]),
    );
  }
});

test("one supported knee does not release the other knee from its surface", () => {
  const actor = solveScene(scene([links[0]]), { iterations: 0 }).actors[1];
  assert.deepEqual([...actor.partnerSupportKeys], ["knee.r"]);
  assert.ok(Math.abs(kneeY(actor, "l")) < 0.004);
  assert.ok(kneeY(actor, "r") > 0.1);
  assert.equal(actor.pose.joints.hip_r.abduction, 65);
  assert.notEqual(actor.pose.joints.hip_l.abduction, 65);
});

test("held-knee contacts drive the hand in either authored endpoint order", () => {
  const forward = solveScene(scene()),
    reversed = solveScene(scene(links.map(reverse)));
  assert.deepEqual(
    reversed.actors.map((a) => a.pose),
    forward.actors.map((a) => a.pose),
  );
  assert.deepEqual(
    reversed.quality.contactDetail.map((c) => c.distance),
    forward.quality.contactDetail.map((c) => c.distance),
  );
  for (const contact of reversed.contacts.slice(-2)) {
    assert.equal(contact.fromActor, 1);
    assert.equal(contact.from, "knee");
    const working = limbFirstContact(contact, reversed.actors);
    assert.equal(working.from, "hand");
    assert.equal(working.fromActor, 0);
    assert.equal(working.sourceIndex, contact.sourceIndex);
    assert.equal(
      limbFirstContact(contact),
      contact,
      "no context keeps existing limb-first behavior",
    );
  }
});

test("zero-strength, ordinary touch and unrelated links retain normal knee seating", () => {
  for (const contacts of [
    links.map((c) => ({ ...c, strength: 0 })),
    links.map((c) => ({ ...c, type: "rest" })),
    links.map((c) => ({ ...c, type: "surface" })),
    links.map((c) => ({ ...c, type: "grip" })),
    links.map((c) => ({ ...c, to: "hip.l" })),
    links.map((c) => ({ ...c, from: "elbow.l" })),
  ]) {
    const actor = solveScene(scene(contacts), { iterations: 0 }).actors[1];
    assert.ok(!actor.partnerSupportKeys.has("knee.l"));
    assert.ok(!actor.partnerSupportKeys.has("knee.r"));
    assert.ok(Math.abs(kneeY(actor, "l")) < 0.004);
    assert.ok(Math.abs(kneeY(actor, "r")) < 0.004);
  }
});

test("support links match the load-bearing side after a recumbent arrangement roll", () => {
  const spec = scene([
    {
      from: "hand.l",
      to: "shoulder.l",
      fromActor: 0,
      toActor: 1,
      type: "support",
    },
    { from: "hand.r", to: "hip.l", fromActor: 0, toActor: 1, type: "support" },
    {
      from: "hand.r",
      to: "thigh.l",
      fromActor: 0,
      toActor: 1,
      type: "support",
    },
  ]);
  spec.actors[1] = { bodyType: "female", posture: "side_lying" };
  spec.relationship = { arrangement: "over_supine", yaw: 180 };
  const before = structuredClone(createActor(spec.actors[1], 1).pose.joints);
  const actor = solveScene(spec, { iterations: 0 }).actors[1];
  assert.equal(actor.posture.id, "side_lying_rolled");
  assert.ok(actor.posture.supports.every((support) => support.side === "l"));
  assert.deepEqual([...actor.partnerSupportKeys].sort(), [
    "hip.l",
    "shoulder.l",
    "thigh.l",
  ]);
  assert.deepEqual(
    actor.pose.joints,
    before,
    "rolled held supports must not be IK-fitted to the floor",
  );
});

test("partner links do not remove support targets after a figure is unmounted", () => {
  const ordinary = scene();
  ordinary.actors[0].posture = "standing";
  ordinary.relationship.arrangement = "side_by_side";
  const standingPair = solveScene(ordinary, { iterations: 0 }).actors[1];
  assert.equal(standingPair.mountedOn, null);
  assert.equal(standingPair.supportBasis, "surface");
  assert.ok(Math.abs(kneeY(standingPair, "l")) < 0.004);
  assert.ok(Math.abs(kneeY(standingPair, "r")) < 0.004);

  const solved = solveScene(scene(), { iterations: 0 }),
    actor = solved.actors[1];
  actor.mountedOn = null;
  seatOnSurface(actor, solved.surface);
  assert.ok(Math.abs(kneeY(actor, "l")) < 0.004);
  assert.ok(Math.abs(kneeY(actor, "r")) < 0.004);
});

test("held supports retain fixed authoring and global floor protection", () => {
  const spec = scene();
  Object.assign(spec.actors[1], {
    jointMode: "fixed",
    placement: { position: [0, 0.5, 0], rotation: [0, 0, 0] },
  });
  const fixed = solveScene(spec).actors[1];
  assert.deepEqual(fixed.pose.root.position, [0, 0.5, 0]);
  assert.equal(fixed.pose.joints.hip_l.abduction, 65);
  assert.equal(fixed.pose.joints.hip_r.abduction, 65);

  const solved = solveScene(scene(), { iterations: 0 }),
    actor = solved.actors[1];
  actor.pose.root.position[1] -= 1;
  refresh(actor);
  const joints = structuredClone(actor.pose.joints);
  seatOnSurface(actor, solved.surface);
  assert.deepEqual(
    actor.pose.joints,
    joints,
    "floor protection must not re-seat held knees by IK",
  );
  assert.ok(
    Math.min(...actor.volumes.flatMap((v) => [v.a[1] - v.ra, v.b[1] - v.rb])) >=
      -1e-8,
  );
});

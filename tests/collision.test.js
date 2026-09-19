/**
 * Collision geometry: round cones against round cones, against boxes, and the
 * distance field they share.
 *
 * The architectural claim this project makes is that one set of volumes is the
 * rendered surface, the collision geometry and the AO source at once. That is
 * only worth anything if the narrowphase and the SDF actually agree about where
 * the surface is, so that is checked here alongside the contact maths itself.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPRESSION,
  alignedWith,
  capsuleBoxContact,
  capsuleContact,
  contactKey,
  detectContacts,
  detectPropContacts,
  lowestPoint,
  penetrationReport,
  rigidCorrection,
  volumeBounds,
} from "../src/core/collision.js";
import {
  bodyDistance,
  closestOnVolume,
  radiusAt,
  roundConeDistance,
  smoothMin,
} from "../src/core/body.js";
import { v3add, v3dist, v3dot, v3len, v3mul, v3normalize, v3sub } from "../src/core/math.js";

let nextId = 0;
/** A posed volume in the shape `poseVolumes` produces. */
const cone = (a, b, ra, rb = ra, extra = {}) => ({
  id: nextId++,
  actorId: 0,
  bone: "test",
  group: "torso",
  soft: false,
  blend: 0.035,
  selfIgnore: new Set(),
  a,
  b,
  ra,
  rb,
  ...extra,
});

const box = (min, max) => ({ min, max });

const nearVec = (got, want, tolerance = 1e-12) => {
  for (let i = 0; i < want.length; i += 1) {
    assert.ok(Math.abs(got[i] - want[i]) <= tolerance, `[${i}] expected ${want[i]}, got ${got[i]}`);
  }
};

/** Normalised gradient of the field around one volume, by central difference. */
const fieldNormal = (p, volume, h = 1e-5) => {
  const d = (q) => roundConeDistance(q, volume);
  return v3normalize([
    d([p[0] + h, p[1], p[2]]) - d([p[0] - h, p[1], p[2]]),
    d([p[0], p[1] + h, p[2]]) - d([p[0], p[1] - h, p[2]]),
    d([p[0], p[1], p[2] + h]) - d([p[0], p[1], p[2] - h]),
  ]);
};

/** One capsule, one taper, one degenerate sphere. */
const SHAPES = [
  cone([0, 0, 0], [0.5, 0, 0], 0.12),
  cone([0, 0, 0], [0.4, 0.1, 0], 0.05, 0.16),
  cone([0, 0, 0], [0, 0, 0], 0.09),
];

const PROBES = [
  [0.25, 0.4, 0.3],
  [-0.5, 0.2, 0],
  [0.2, -0.3, 0.45],
  [0.6, 0.05, -0.2],
];

test("volumeBounds covers both end spheres and honours padding", () => {
  const volume = cone([0, 0, 0], [1, 0, 0], 0.1, 0.3);
  const bounds = volumeBounds(volume);
  nearVec(bounds.min, [-0.1, -0.3, -0.3]);
  nearVec(bounds.max, [1.3, 0.3, 0.3]);
  const padded = volumeBounds(volume, 0.05);
  nearVec(padded.min, [-0.15, -0.35, -0.35]);
  nearVec(padded.max, [1.35, 0.35, 0.35]);
});

test("radiusAt interpolates between the two ends", () => {
  const volume = cone([0, 0, 0], [1, 0, 0], 0.1, 0.3);
  assert.equal(radiusAt(volume, 0), 0.1);
  assert.equal(radiusAt(volume, 1), 0.3);
  assert.ok(Math.abs(radiusAt(volume, 0.5) - 0.2) < 1e-12);
});

test("two overlapping capsules report the depth and direction of the overlap", () => {
  const lower = cone([0, 0, 0], [1, 0, 0], 0.1);
  const upper = cone([0, 0.15, 0], [1, 0.15, 0], 0.1);
  const contact = capsuleContact(lower, upper);
  assert.ok(contact, "a 50mm overlap was not detected");
  assert.ok(Math.abs(contact.depth - 0.05) < 1e-9, `depth was ${contact.depth}`);
  // The normal points from the first capsule toward the second, which is the
  // convention `rigidCorrection` relies on to know which way to push.
  assert.ok(v3dot(contact.normal, [0, 1, 0]) > 0.999, `normal was ${contact.normal}`);
  assert.ok(Math.abs(v3len(contact.normal) - 1) < 1e-9, "the normal is not a unit vector");
  // The two witness points sit on the two surfaces, so they are 50mm apart in
  // the overlapping direction - not at the axes.
  assert.ok(Math.abs(contact.pointA[1] - 0.1) < 1e-9, `pointA at ${contact.pointA}`);
  assert.ok(Math.abs(contact.pointB[1] - 0.05) < 1e-9, `pointB at ${contact.pointB}`);
});

test("capsules that do not touch report nothing, unless a margin asks them to", () => {
  const lower = cone([0, 0, 0], [1, 0, 0], 0.1);
  const upper = cone([0, 0.3, 0], [1, 0.3, 0], 0.1);
  assert.equal(capsuleContact(lower, upper), null, "a 100mm gap was called a contact");
  // The same pair inside a 150mm detection margin is a contact with a negative
  // depth: the solver uses this to find near misses it should close.
  const near = capsuleContact(lower, upper, 0.15);
  assert.ok(near, "the margin did not widen detection");
  assert.ok(near.depth < 0, `a gap reported a positive depth of ${near.depth}`);
  assert.ok(Math.abs(near.depth + 0.1) < 1e-9, `gap depth was ${near.depth}`);
});

test("capsules sharing an axis separate along a stable direction rather than NaN", () => {
  const one = cone([0, 0, 0], [1, 0, 0], 0.1);
  const two = cone([0, 0, 0], [1, 0, 0], 0.1);
  const contact = capsuleContact(one, two);
  assert.ok(contact, "concentric capsules were not detected");
  for (const value of contact.normal) assert.ok(Number.isFinite(value), "normal is NaN");
  assert.ok(Math.abs(v3len(contact.normal) - 1) < 1e-9, "the fallback normal is not normalised");
  // Perpendicular to the shared axis, or the correction would slide the two
  // capsules along each other for ever without separating them.
  assert.ok(Math.abs(v3dot(contact.normal, [1, 0, 0])) < 1e-9, "the escape is along the axis");
  assert.ok(Math.abs(contact.depth - 0.2) < 1e-9, `depth was ${contact.depth}`);
});

test("a capsule resting on a box is pushed out of its top face", () => {
  const table = box([-1, -1, -1], [1, 0, 1]);
  // 50mm of a 100mm-radius limb is below the top.
  const limb = cone([-0.5, 0.05, 0], [0.5, 0.05, 0], 0.1);
  const contact = capsuleBoxContact(limb, table);
  assert.ok(contact, "a limb 50mm into the table was missed");
  assert.ok(Math.abs(contact.depth - 0.05) < 1e-9, `depth was ${contact.depth}`);
  assert.ok(v3dot(contact.normal, [0, 1, 0]) > 0.999, `normal was ${contact.normal}`);

  // Clear of it by a millimetre: no contact at all.
  assert.equal(capsuleBoxContact(cone([-0.5, 0.101, 0], [0.5, 0.101, 0], 0.1), table), null);
});

test("a capsule buried inside a box escapes through its nearest face", () => {
  const solid = box([-1, -1, -1], [1, 1, 1]);
  // Well below the middle, so the floor of the box is the shortest way out.
  const buried = cone([0, -0.8, 0], [0.2, -0.8, 0], 0.1);
  const contact = capsuleBoxContact(buried, solid);
  assert.ok(contact, "a capsule inside the box reported no contact");
  assert.ok(v3dot(contact.normal, [0, -1, 0]) > 0.999, `normal was ${contact.normal}`);
  // Depth is the whole way out: the 200mm to the face plus the radius.
  assert.ok(Math.abs(contact.depth - 0.3) < 1e-9, `depth was ${contact.depth}`);
});

test("box contact samples along the axis, not just the endpoints", () => {
  // A limb bridging a narrow pillar: both ends are outside the box in plan and
  // only the middle is over it. Endpoint-only testing misses this entirely.
  const pillar = box([-0.1, -1, -0.1], [0.1, 0, 0.1]);
  const bridge = cone([-1, 0.05, 0], [1, 0.05, 0], 0.1);
  const contact = capsuleBoxContact(bridge, pillar);
  assert.ok(contact, "the middle of the limb missed the pillar under it");
  assert.ok(contact.t > 0.3 && contact.t < 0.7, `contact was at t=${contact.t}, not mid-span`);
});

test("contactKey is the same whichever way round the pair is given", () => {
  assert.equal(contactKey("a", "hand_l", "b", "hips"), contactKey("b", "hips", "a", "hand_l"));
  assert.notEqual(contactKey("a", "hand_l", "b", "hips"), contactKey("a", "hand_r", "b", "hips"));
});

test("detectContacts skips exempt neighbours and sorts the rest deepest first", () => {
  const shallow = cone([0, 0, 0], [0.4, 0, 0], 0.1);
  const deep = cone([0, 0.05, 0], [0.4, 0.05, 0], 0.1);
  const neighbour = cone([0, 0.12, 0], [0.4, 0.12, 0], 0.1);
  // Adjacent bones on a real rig always interpenetrate at the joint; the rig
  // marks those pairs exempt, and honouring that is what keeps a straight arm
  // from reporting an elbow collision with itself.
  shallow.selfIgnore = new Set([neighbour.id]);
  neighbour.selfIgnore = new Set([shallow.id]);

  const body = { id: "a", volumes: [shallow, deep, neighbour] };
  const contacts = detectContacts([body], { selfCollision: true });
  assert.ok(contacts.length >= 1, "self collision found nothing");
  for (const contact of contacts) {
    const pair = new Set([contact.volumeA.id, contact.volumeB.id]);
    assert.ok(
      !(pair.has(shallow.id) && pair.has(neighbour.id)),
      "an exempt pair was reported"
    );
    assert.equal(contact.self, true);
  }
  for (let i = 1; i < contacts.length; i += 1) {
    assert.ok(contacts[i - 1].depth >= contacts[i].depth, "contacts are not sorted by depth");
  }
});

test("a declared contact is allowed to sink in further than an accidental one", () => {
  // 15mm of overlap: past the 10mm a rigid pair gets, inside the 22mm a
  // declared one does. Bodies flatten where they touch, and without this the
  // solver pushes partners apart until they hover.
  const make = () => [
    { id: "a", volumes: [cone([0, 0, 0], [0.4, 0, 0], 0.1, 0.1, { bone: "hips" })] },
    { id: "b", volumes: [cone([0, 0.185, 0], [0.4, 0.185, 0], 0.1, 0.1, { bone: "hand_l" })] },
  ];

  const accidental = detectContacts(make(), { selfCollision: false });
  assert.equal(accidental.length, 1, "a 15mm overlap was not reported");
  assert.equal(accidental[0].allowance, COMPRESSION.default);
  assert.ok(Math.abs(accidental[0].rawDepth - 0.015) < 1e-9, `raw depth ${accidental[0].rawDepth}`);
  assert.ok(Math.abs(accidental[0].depth - 0.005) < 1e-9, `reported depth ${accidental[0].depth}`);

  const declared = detectContacts(make(), {
    selfCollision: false,
    declared: new Set([contactKey("a", "hips", "b", "hand_l")]),
  });
  assert.equal(declared.length, 0, "a declared contact was still reported as a penetration");
});

test("soft volumes get the soft allowance", () => {
  const bodies = [
    { id: "a", volumes: [cone([0, 0, 0], [0.4, 0, 0], 0.1, 0.1, { soft: true })] },
    { id: "b", volumes: [cone([0, 0.185, 0], [0.4, 0.185, 0], 0.1)] },
  ];
  const contacts = detectContacts(bodies, { selfCollision: false });
  // 15mm of overlap is inside the 18mm soft budget, so nothing is reported.
  assert.equal(contacts.length, 0, "soft tissue was treated as rigid");
});

test("prop contacts carry the body they belong to and the prop they hit", () => {
  const floor = { name: "floor", box: box([-5, -0.1, -5], [5, 0, 5]) };
  const table = { name: "table", box: box([-0.4, 0, -0.4], [0.4, 0.75, 0.4]) };
  // Sunk into the floor, well clear of the table's footprint in plan.
  const bodies = [{ id: "a", volumes: [cone([-2.2, -0.05, 0], [-1.8, -0.05, 0], 0.1)] }];
  const contacts = detectPropContacts(bodies, [floor, table]);
  assert.equal(contacts.length, 1, `expected one prop contact, got ${contacts.length}`);
  assert.equal(contacts[0].bodyIndex, 0);
  assert.equal(contacts[0].prop.name, "floor");
  // 150mm below the floor's top less the 10mm allowance.
  assert.ok(Math.abs(contacts[0].depth - 0.14) < 1e-9, `depth was ${contacts[0].depth}`);
});

test("penetrationReport totals what it was given", () => {
  const empty = penetrationReport([]);
  assert.equal(empty.clean, true);
  assert.equal(empty.maxDepth, 0);

  const report = penetrationReport([
    { depth: 0.01, self: false },
    { depth: 0.04, self: true },
    { depth: 0.02, self: false },
  ]);
  assert.equal(report.count, 3);
  assert.equal(report.clean, false);
  assert.ok(Math.abs(report.maxDepth - 0.04) < 1e-12);
  assert.ok(Math.abs(report.totalDepth - 0.07) < 1e-12);
  assert.equal(report.selfCount, 1);
});

test("lowestPoint finds the bottom of the lowest sphere, not the lowest axis point", () => {
  const volumes = [
    cone([0, 1, 0], [0, 2, 0], 0.1),
    // Its axis sits higher than the first one's, but its radius reaches lower.
    cone([0, 1.2, 0], [0, 3, 0], 0.5, 0.2),
  ];
  assert.ok(Math.abs(lowestPoint(volumes) - 0.7) < 1e-12, `got ${lowestPoint(volumes)}`);
});

test("rigidCorrection pushes the two bodies in opposite directions", () => {
  const contact = {
    bodyA: 0,
    bodyB: 1,
    self: false,
    depth: 0.05,
    normal: [0, 1, 0],
    pointA: [0.3, 0.1, 0],
    pointB: [0.3, 0.05, 0],
  };
  const a = rigidCorrection([contact], 0, [0, 0, 0]);
  const b = rigidCorrection([contact], 1, [0, 0, 0]);
  // The normal points from A to B, so A goes down and B goes up.
  assert.ok(a.translation[1] < 0, `body A moved ${a.translation}`);
  assert.ok(b.translation[1] > 0, `body B moved ${b.translation}`);
  assert.ok(Math.abs(a.translation[1] + b.translation[1]) < 1e-12, "the pair is not symmetric");
  // Off-centre contacts produce torque; that is how a shoved body also turns.
  assert.ok(v3len(a.torque) > 0, "an off-centre push produced no torque");

  // A body with nothing touching it is left exactly alone.
  const none = rigidCorrection([contact], 2, [0, 0, 0]);
  assert.deepEqual(none.translation, [0, 0, 0]);
  assert.deepEqual(none.torque, [0, 0, 0]);
  // Self contacts cannot move a body: there is nothing to push against.
  const selfOnly = rigidCorrection([{ ...contact, bodyB: 0, self: true }], 0, [0, 0, 0]);
  assert.deepEqual(selfOnly.translation, [0, 0, 0]);
});

test("alignedWith classifies a normal against a reference direction", () => {
  assert.equal(alignedWith([0, 1, 0], [0, 1, 0]), true);
  assert.equal(alignedWith([0, -1, 0], [0, 1, 0]), false);
  assert.equal(alignedWith([0, 3, 0], [0, 0.5, 0]), true, "magnitude should not matter");
  // 60 degrees off: inside a loose threshold, outside the default.
  const tilted = v3normalize([Math.sin(Math.PI / 3), Math.cos(Math.PI / 3), 0]);
  assert.equal(alignedWith(tilted, [0, 1, 0]), false);
  assert.equal(alignedWith(tilted, [0, 1, 0], 0.4), true);
});

test("the round cone SDF is an exact distance, not merely a bound", () => {
  // An exact field means one step of length `d` down the gradient lands on the
  // surface. An approximate one - which is what most capsule-ish fields are,
  // and what the reference system's ellipsoids were - undershoots, and the ray
  // marcher then needs many more steps and still shows faceting at the joins.
  for (const volume of SHAPES) {
    for (const probe of PROBES) {
      const d = roundConeDistance(probe, volume);
      assert.ok(d > 0, `an outside probe reported ${d}`);
      const landed = v3add(probe, v3mul(fieldNormal(probe, volume), -d));
      assert.ok(
        Math.abs(roundConeDistance(landed, volume)) < 1e-9,
        `one Newton step landed ${roundConeDistance(landed, volume)} from the surface`
      );
    }
    // Inside is negative, and the centre of an end sphere is a full radius in.
    assert.ok(Math.abs(roundConeDistance(volume.a, volume) + volume.ra) < 1e-9);
    assert.ok(Math.abs(roundConeDistance(volume.b, volume) + volume.rb) < 1e-9);
  }
});

test("closestOnVolume lands on the drawn surface, and never outside it", () => {
  for (const volume of SHAPES) {
    for (const probe of PROBES) {
      const { point, distance, normal } = closestOnVolume(probe, volume);
      const field = roundConeDistance(point, volume);
      // `closestOnVolume` treats the cone as a capsule whose radius varies
      // along the axis, which is exact when the two ends match and slightly
      // conservative when they taper. Conservative in the right direction: the
      // point it returns is on or just inside the surface the renderer draws,
      // so a hand placed there touches rather than floats.
      assert.ok(field <= 1e-9, `contact point sits ${field} outside the surface`);
      const tolerance = volume.ra === volume.rb ? 1e-9 : 0.006;
      assert.ok(field > -tolerance, `contact point is ${field} inside the surface`);
      if (volume.ra === volume.rb) {
        assert.ok(
          Math.abs(roundConeDistance(probe, volume) - distance) < 1e-9,
          "the two distance functions disagree on an untapered volume"
        );
      }
      assert.ok(Math.abs(v3len(normal) - 1) < 1e-9, "the surface normal is not normalised");
    }
  }
});

test("the SDF never overstates the distance it is safe to march", () => {
  // Sphere tracing is only correct if the field is a lower bound on the true
  // distance. Checked by marching: each step must not pass through the surface.
  const volumes = [cone([0, 0, 0], [0.4, 0.1, 0], 0.08, 0.14), cone([0.4, 0.1, 0], [0.4, 0.5, 0.1], 0.1)];
  const origin = [-0.8, 0.6, 0.7];
  const direction = v3normalize(v3sub([0.2, 0.05, 0], origin));
  let travelled = 0;
  for (let step = 0; step < 64; step += 1) {
    const p = v3add(origin, v3mul(direction, travelled));
    const d = bodyDistance(p, volumes);
    assert.ok(Number.isFinite(d), "the field returned a non-number");
    if (d < 1e-4) break;
    // Take the full step, then check we have not tunnelled inside.
    travelled += d;
    const next = v3add(origin, v3mul(direction, travelled));
    assert.ok(
      bodyDistance(next, volumes) > -1e-6,
      `a full-length step tunnelled to ${bodyDistance(next, volumes)}`
    );
  }
  assert.ok(travelled > 0 && travelled < 10, `the march did not converge (${travelled})`);
});

test("smoothMin blends without ever exceeding the minimum it blends", () => {
  assert.equal(smoothMin(0.3, 0.7, 0), 0.3, "a zero radius is not a plain min");
  const k = 0.05;
  for (const [a, b] of [[0.3, 0.7], [0.1, 0.1], [-0.2, 0.05], [2, -3]]) {
    const blended = smoothMin(a, b, k);
    const min = Math.min(a, b);
    // A union must never report a point as further away than the nearest of its
    // parts, or the ray marcher steps straight through the join.
    assert.ok(blended <= min + 1e-12, `smoothMin(${a}, ${b}) = ${blended} exceeds ${min}`);
    // And it must not round the corner by more than the radius it was given.
    assert.ok(blended >= min - k, `smoothMin(${a}, ${b}) = ${blended} dug past ${min - k}`);
  }
  // Far apart, the blend is exactly the nearer one.
  assert.ok(Math.abs(smoothMin(0.1, 5, k) - 0.1) < 1e-12);
});

test("bodyDistance is the union of its volumes, and finds the nearest one", () => {
  const near = cone([0, 0, 0], [0.3, 0, 0], 0.1);
  const far = cone([2, 0, 0], [2.3, 0, 0], 0.1);
  const probe = [0.15, 0.5, 0];
  const single = bodyDistance(probe, [near]);
  const both = bodyDistance(probe, [near, far]);
  assert.ok(Math.abs(single - both) < 1e-9, "a distant volume changed the answer");
  assert.ok(Math.abs(single - 0.4) < 1e-9, `distance was ${single}`);
  // Deep inside one volume the union is still inside.
  assert.ok(bodyDistance([0.15, 0, 0], [near, far]) < 0);
});

test("the narrowphase and the field agree about where two bodies touch", () => {
  // The claim is that one geometry serves both. If a contact's witness point
  // is not on the surface the renderer draws, then hands placed by the solver
  // will not look like they are touching anything.
  const partner = cone([0.2, 0.16, 0.05], [0.2, 0.5, 0.05], 0.08);
  for (const [a, tolerance] of [
    [cone([0, 0, 0], [0.4, 0, 0], 0.1), 1e-9],
    // A taper is where the narrowphase's capsule approximation costs
    // something. At body scale that is a third of a millimetre - far below the
    // 10mm compression allowance a contact gets anyway.
    [cone([0, 0, 0], [0.4, 0, 0], 0.09, 0.12), 1e-3],
  ]) {
    const contact = capsuleContact(a, partner);
    assert.ok(contact, "the two volumes were not detected as touching");
    assert.ok(
      Math.abs(roundConeDistance(contact.pointA, a)) < tolerance,
      `pointA is ${roundConeDistance(contact.pointA, a)} off surface A`
    );
    assert.ok(
      Math.abs(roundConeDistance(contact.pointB, partner)) < 1e-9,
      `pointB is ${roundConeDistance(contact.pointB, partner)} off surface B`
    );
    // The witness points are exactly the depth apart, along the normal.
    assert.ok(
      Math.abs(v3dist(contact.pointA, contact.pointB) - contact.depth) < 1e-9,
      "the witness points do not span the reported depth"
    );
    const span = v3normalize(v3sub(contact.pointB, contact.pointA));
    assert.ok(v3dot(span, contact.normal) < -0.999, "the witness points do not straddle the overlap");
  }
});

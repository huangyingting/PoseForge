import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildHumanTemplate, skinHumanMesh } from "../src/core/humanMesh.js";
import { createActor, refresh } from "../src/core/solver.js";
import {
  createSurfaceContactQuery,
  measureFigureSurfaces,
} from "../src/core/surfaceContacts.js";
import { resolveLandmark } from "../src/core/landmarks.js";
import { quatFromAxisAngle, quatMultiply } from "../src/core/math.js";

// Small, independently specified patches use the real rig but no scene solver
// or preset geometry. Region selection must work even without a nearby target.
const rig = buildHumanTemplate(
  readFileSync(
    new URL("../assets/models/realistic-female.glb", import.meta.url),
  ),
);
function patchTemplate({
  side = "l",
  down = 0.035,
  weights = [[`hip_${side}`, 1]],
} = {}) {
  const hip = rig.jointByBone.get(`hip_${side}`).rest;
  const center = [hip[12], hip[13] - down, hip[14] + 0.055];
  const positions = new Float32Array([
    center[0] - 0.006,
    center[1] - 0.006,
    center[2],
    center[0] + 0.006,
    center[1] - 0.006,
    center[2],
    center[0],
    center[1] + 0.006,
    center[2],
  ]);
  const joints = new Uint16Array(12),
    skinWeights = new Float32Array(12);
  for (let vertex = 0; vertex < 3; vertex++)
    weights.forEach(([bone, weight], slot) => {
      joints[vertex * 4 + slot] = rig.jointByBone.get(bone).index;
      skinWeights[vertex * 4 + slot] = weight;
    });
  return {
    ...rig,
    submeshes: [
      {
        name: "anatomical patch",
        primary: true,
        positions,
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        joints,
        weights: skinWeights,
      },
    ],
  };
}

function pair(posture = "standing", stature = 1.7, yaw = 0) {
  return [0, 1].map((index) => {
    const actor = createActor({ bodyType: "female", posture, stature }, index);
    actor.pose.root.quaternion = quatMultiply(
      quatFromAxisAngle([0, 1, 0], yaw),
      actor.pose.root.quaternion,
    );
    return refresh(actor);
  });
}

const contact = {
  fromActor: 0,
  toActor: 1,
  from: "thigh",
  fromSide: "l",
  to: "lap",
};

test("lap ownership includes both thighs without moving its landmark point", () => {
  const lap = resolveLandmark("lap");
  assert.equal(lap.bone, "pelvis");
  assert.deepEqual(lap.local, [0, 0.01, 0.075]);
  assert.deepEqual(lap.bones, ["pelvis", "hip_l", "hip_r"]);
  assert.deepEqual(resolveLandmark("pelvis").bones, ["pelvis"]);
  assert.deepEqual(resolveLandmark("foot.r").bones, ["ankle_r", "toe_r"]);
});

test("proximal thigh surfaces are measured as lap across pose, scale and heading", () => {
  for (const [posture, stature, yaw] of [
    ["standing", 1.4, 0],
    ["seated", 1.7, 0.8],
    ["seated", 2.05, -1.2],
  ]) {
    for (const side of ["l", "r"]) {
      const actors = pair(posture, stature, yaw),
        template = patchTemplate({ side });
      const original = template.submeshes[0].positions.slice();
      const posed = skinHumanMesh(
        template,
        actors[1].skeleton,
        actors[1].evaluated,
      )[0];
      const p = (i) => Array.from(posed.positions.slice(i * 3, i * 3 + 3));
      const [a, b, c] = [0, 1, 2].map(p);
      const ab = b.map((v, i) => v - a[i]),
        ac = c.map((v, i) => v - a[i]);
      const normal = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ];
      const length = Math.hypot(...normal),
        gap = 0.01;
      actors[0].pose.root.position = actors[0].pose.root.position.map(
        (v, i) => v + (normal[i] / length) * gap,
      );
      refresh(actors[0]);
      const measured = createSurfaceContactQuery(actors, [template, template])({
        ...contact,
        fromSide: side,
      });
      assert.ok(
        measured,
        `${posture}/${stature}: thigh surface was excluded from lap`,
      );
      assert.ok(Math.abs(measured.distance - gap) < 1e-6);
      assert.equal(measured.intersects, false);
      assert.deepEqual(template.submeshes[0].positions, original);
    }
  }
});

test("distant knee-height and unrelated-bone surfaces cannot enter the lap region", () => {
  const actors = pair();
  for (const target of [
    patchTemplate({ down: 0.22 }),
    patchTemplate({ weights: [["knee_l", 1]] }),
    patchTemplate({
      weights: [
        ["hip_l", 0.01],
        ["spine01", 0.99],
      ],
    }),
  ]) {
    assert.equal(
      createSurfaceContactQuery(actors, [patchTemplate(), target])(contact),
      null,
    );
  }
});

test("whole-group safety coverage is not a substitute for a named pelvic region", () => {
  const actors = pair(),
    source = patchTemplate({
      weights: [
        ["hip_l", 0.96],
        ["pelvis", 0.04],
      ],
    }),
    target = patchTemplate();
  const query = createSurfaceContactQuery(actors, [source, target]);
  assert.equal(
    query({ ...contact, from: "pelvis", fromSide: null }),
    null,
    "a tiny pelvis influence must not make the thigh a pelvic target",
  );
  assert.ok(
    query.limbs({
      fromActor: 0,
      toActor: 1,
      fromBones: new Set(["pelvis"]),
      toBones: new Set(["hip_l"]),
    }),
    "whole-group collision checks must still cover skin-weight tails",
  );
});

test("limb-to-body checks catch crossings outside the named patch, including colored auxiliary meshes", () => {
  for (const auxiliary of [false, true]) {
    const actors = pair(),
      proximal = patchTemplate(),
      distant = patchTemplate({ down: 0.5 }),
      crossing = patchTemplate({ down: 0.5 }).submeshes[0];
    actors[0].pose.root.position[2] += 0.01;
    refresh(actors[0]);
    crossing.positions[2] -= 0.03;
    crossing.positions[5] += 0.03;
    crossing.positions[8] += 0.03;
    if (auxiliary) {
      crossing.primary = false;
      crossing.colour = [0.2, 0.3, 0.4];
    }
    const source = {
      ...rig,
      submeshes: [...proximal.submeshes, ...distant.submeshes],
    };
    const clear = createSurfaceContactQuery(actors, [source, proximal])(
      contact,
    );
    assert.ok(clear.distance > 0.009);
    assert.equal(clear.intersects, false);
    const target = { ...rig, submeshes: [...proximal.submeshes, crossing] };
    const query = createSurfaceContactQuery(actors, [source, target]);
    const measured = query(contact);
    assert.ok(Math.abs(measured.distance - clear.distance) < 1e-9);
    assert.equal(measured.regionIntersects, false);
    assert.equal(measured.limbIntersects, true);
    assert.equal(measured.intersects, true);
    const reverse = query({
      fromActor: 1,
      toActor: 0,
      from: "lap",
      to: "thigh",
      toSide: "l",
    });
    assert.equal(reverse.regionIntersects, false);
    assert.equal(reverse.limbIntersects, true);
    assert.equal(query.figures(0, 1, true).intersects, true);
    assert.deepEqual(measureFigureSurfaces({ actors }, query), [
      { fromActor: 0, toActor: 1, intersects: true },
    ]);
  }
});

test("whole-figure audits cover pairs without contacts and keep unavailable geometry distinct", () => {
  const actors = [...pair(), pair()[0]],
    source = patchTemplate();
  actors[2].pose.root.position[0] += 2;
  refresh(actors[2]);
  const query = createSurfaceContactQuery(actors, [source, null, source]);
  assert.deepEqual(measureFigureSurfaces({ actors }, query), [
    { fromActor: 0, toActor: 1, intersects: null },
    { fromActor: 0, toActor: 2, intersects: false },
    { fromActor: 1, toActor: 2, intersects: null },
  ]);
  const invalid = patchTemplate();
  invalid.submeshes[0].positions[0] = NaN;
  assert.equal(
    createSurfaceContactQuery(actors, [source, invalid, source]).figures(0, 1),
    null,
  );
});

test("whole figures include drawn auxiliary triangles without any core-bone ownership", () => {
  const actors = pair(),
    source = patchTemplate(),
    target = patchTemplate();
  for (const template of [source, target]) {
    const part = template.submeshes[0];
    part.weights.fill(0);
    part.primary = false;
    part.colour = [0.2, 0.3, 0.4];
  }
  target.submeshes[0].positions[2] -= 0.03;
  target.submeshes[0].positions[5] += 0.03;
  target.submeshes[0].positions[8] += 0.03;
  const query = createSurfaceContactQuery(actors, [source, target]);
  assert.equal(
    query(contact),
    null,
    "unowned triangles are not an anatomical contact patch",
  );
  assert.equal(query.figures(0, 1, true).intersects, true);
});

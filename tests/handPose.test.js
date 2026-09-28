import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Skeleton, evaluatePose } from "../src/core/skeleton.js";
import {
  bindCorrections,
  buildHumanTemplate,
  poseJoints,
  skinHumanMesh,
} from "../src/core/humanMesh.js";
import { HAND_SHAPE_NAMES, backFirstShape } from "../src/core/handPose.js";
import {
  quatFromEulerXYZ,
  v3cross,
  v3dot,
  v3normalize,
  v3sub,
} from "../src/core/math.js";

const models = ["female", "male"].map((bodyType) => ({
  bodyType,
  template: buildHumanTemplate(
    readFileSync(
      new URL(`../assets/models/realistic-${bodyType}.glb`, import.meta.url),
    ),
  ),
}));
const fingers = ["index", "middle", "ring", "pinky", "thumb"];
const rotate = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
];
const variations = [
  { root: { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }, joints: {} },
  {
    root: {
      position: [0.2, 0.6, -0.4],
      quaternion: quatFromEulerXYZ(1, 0.7, -0.4),
    },
    joints: {
      shoulder_l: { flexion: 60, abduction: 20, rotation: -30 },
      elbow_l: { flexion: 70, rotation: 60 },
      wrist_l: { flexion: 30, abduction: 20, rotation: 10 },
      shoulder_r: { flexion: 90, abduction: 30, rotation: 20 },
      elbow_r: { flexion: 45, rotation: -40 },
      wrist_r: { flexion: -25, abduction: -10, rotation: -5 },
    },
  },
];

test("only an inferred cupped hand that arrived back first changes shape", () => {
  const actor = { hands: { l: "cup", r: "grip" }, spec: {} };
  assert.equal(backFirstShape(actor, "l", -0.8), "lay");
  assert.equal(backFirstShape(actor, "l", 0.2), null, "palm roughly first");
  assert.equal(backFirstShape(actor, "l", Number.NaN), null);
  assert.equal(backFirstShape(actor, "r", -0.8), null, "a grip is not a rest");
  for (const hands of ["cup", { l: "cup" }])
    assert.equal(
      backFirstShape({ ...actor, spec: { hands } }, "l", -0.8),
      null,
      "a shape the figure asked for stays",
    );
  assert.equal(
    backFirstShape({ ...actor, spec: { hands: { r: "fist" } } }, "l", -0.8),
    "lay",
  );
});

for (const { bodyType, template } of models) {
  const skeleton = new Skeleton({ bodyType });
  const align = bindCorrections(template, skeleton);
  const indices = new Map(template.joints.map((joint, i) => [joint.name, i]));

  test(`${bodyType}: braced fingers and thumbs follow the palm plane in both posed hands`, () => {
    for (const pose of variations) {
      const world = poseJoints(
        template,
        skeleton,
        evaluatePose(skeleton, pose),
        align,
        { l: "brace", r: "brace" },
      );
      const at = (name) => world[indices.get(name)].slice(12, 15);
      for (const side of ["l", "r"]) {
        const normal = v3normalize(
          v3cross(
            v3sub(at(`middle_01_${side}`), at(`hand_${side}`)),
            v3sub(at(`pinky_01_${side}`), at(`index_01_${side}`)),
          ),
        );
        for (const finger of fingers) {
          for (let segment = 1; segment <= 3; segment++) {
            const name = `${finger}_0${segment}_${side}`;
            const i = indices.get(name),
              joint = template.joints[i];
            const child = indices.get(`${finger}_0${segment + 1}_${side}`);
            const rest =
              child == null
                ? v3sub(
                    joint.rest.slice(12, 15),
                    template.joints[joint.parent].rest.slice(12, 15),
                  )
                : v3sub(
                    template.joints[child].rest.slice(12, 15),
                    joint.rest.slice(12, 15),
                  );
            const direction =
              child == null
                ? rotate(world[i], rotate(joint.inverseBind, rest))
                : v3sub(world[child].slice(12, 15), world[i].slice(12, 15));
            assert.ok(
              Math.abs(v3dot(v3normalize(direction), normal)) < 1e-6,
              `${name} still curls through the palm plane`,
            );
            const lengthError = Math.abs(
              Math.hypot(...direction) - Math.hypot(...rest),
            );
            // GLB bind rotations are float32; this is below a micrometre at
            // either figure's stature, not a support-quality tolerance.
            assert.ok(
              lengthError < 1e-7,
              `${name} changed length by ${lengthError}`,
            );
          }
        }
      }
    }
  });

  test(`${bodyType}: bracing changes only finger rotations and retains all other hand shapes`, () => {
    const before = structuredClone(template.joints);
    const uncorrected = {
      ...template,
      joints: template.joints.map(({ brace, ...joint }) => joint),
    };
    for (const pose of variations) {
      const evaluated = evaluatePose(skeleton, pose);
      const relaxed = poseJoints(template, skeleton, evaluated, align);
      const braced = poseJoints(template, skeleton, evaluated, align, {
        l: "brace",
        r: "relaxed",
      });
      template.joints.forEach((joint, i) => {
        if (joint.side !== "l" || !joint.finger)
          assert.deepEqual(braced[i], relaxed[i], joint.name);
        if (joint.brace)
          assert.deepEqual(
            joint.brace.slice(12, 16),
            joint.localRest.slice(12, 16),
            joint.name,
          );
      });
      for (const shape of HAND_SHAPE_NAMES.filter((name) => name !== "brace")) {
        const hands = { l: shape, r: shape };
        assert.deepEqual(
          poseJoints(template, skeleton, evaluated, align, hands),
          poseJoints(uncorrected, skeleton, evaluated, align, hands),
          shape,
        );
      }
      for (const part of skinHumanMesh(template, skeleton, evaluated, align, {
        l: "brace",
        r: "brace",
      })) {
        assert.ok(part.positions.every(Number.isFinite));
        assert.ok(part.normals.every(Number.isFinite));
      }
    }
    assert.deepEqual(
      template.joints,
      before,
      "posing must not mutate the cached template",
    );
  });

  test(`${bodyType}: rendered brace thumbs no longer hold the palm centimetres off its support`, () => {
    for (const pose of variations) {
      const evaluated = evaluatePose(skeleton, pose),
        hands = { l: "brace", r: "brace" };
      const world = poseJoints(template, skeleton, evaluated, align, hands);
      const mesh = skinHumanMesh(template, skeleton, evaluated, align, hands);
      const at = (name) =>
        world[indices.get(name)].slice(12, 15).map((n) => n * skeleton.stature);
      for (const side of ["l", "r"]) {
        const wrist = at(`hand_${side}`);
        const along = v3normalize(v3sub(at(`middle_01_${side}`), wrist));
        let normal = v3normalize(
          v3cross(along, v3sub(at(`pinky_01_${side}`), at(`index_01_${side}`))),
        );
        if (v3dot(v3sub(at(`thumb_01_${side}`), wrist), normal) < 0)
          normal = normal.map((n) => -n);
        const extent = {
          palm: -Infinity,
          thumb: -Infinity,
          fingers: -Infinity,
        };
        const count = { palm: 0, thumb: 0, fingers: 0 };
        template.submeshes.forEach((part, k) => {
          for (const v of new Set(part.indices)) {
            const point = mesh[k].positions.slice(v * 3, v * 3 + 3);
            const relative = v3sub(point, wrist),
              weights = { palm: 0, thumb: 0, fingers: 0 };
            for (let slot = 0; slot < 4; slot++) {
              const joint = template.joints[part.joints[v * 4 + slot]];
              const weight = part.weights[v * 4 + slot];
              if (joint?.name === `hand_${side}`) weights.palm += weight;
              if (joint?.side === side && joint.finger)
                weights[joint.finger === "thumb" ? "thumb" : "fingers"] +=
                  weight;
            }
            for (const region of Object.keys(extent)) {
              if (
                weights[region] <= 0.8 ||
                (region === "palm" &&
                  v3dot(relative, along) <= 0.02 * skeleton.stature)
              )
                continue;
              extent[region] = Math.max(
                extent[region],
                v3dot(relative, normal),
              );
              count[region]++;
            }
          }
        });
        assert.ok(
          Object.values(count).every((n) => n > 100),
          "measure actual drawn palm, thumb and finger vertices",
        );
        assert.ok(
          extent.thumb - extent.palm < 0.004,
          `${side}: thumb projects ${extent.thumb - extent.palm} m below the palm`,
        );
        assert.ok(
          extent.fingers - extent.palm < 0.001,
          `${side}: fingers curl below the palm`,
        );
      }
    }
  });
}

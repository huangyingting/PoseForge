/**
 * Clothes.
 *
 * One property matters here and it is not a property of the garment mesh on its
 * own: a hem has to be as smooth *posed* as it is in bind space. Everything in
 * `lift` is built and measured in bind space, where a waistband cut by a plane
 * is a plane by construction and every check passes trivially, so a hem can be
 * exactly right there and come apart into teeth the moment a bone turns. That is
 * not hypothetical - it is what the waistband did, for as long as it took to
 * notice that the only measurements being taken were the ones that could not
 * see it. The cut vertices carried the skin weights of whichever end of their
 * edge was inside the garment, so consecutive hem vertices were driven by body
 * vertices at scattered heights, and the hem followed the scatter.
 *
 * So these tests pose the figure before they measure. The bind-space checks are
 * still worth having - they say the cutting works at all - but they are the
 * cheap half.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { validateScene } from "../src/core/scene.js";
import { solveScene } from "../src/core/solver.js";
import { buildHumanTemplate, featureRelief, skinHumanMesh } from "../src/core/humanMesh.js";
import { withGarments, GARMENT_NAMES } from "../src/core/garments.js";

const MODEL = new URL("../assets/models/realistic-female.glb", import.meta.url);

/** The scan, relieved and dressed, built once for the whole file. */
const dressed = (() => {
  const body = featureRelief(buildHumanTemplate(readFileSync(MODEL)), {
    bodyType: "female",
    build: 1,
  });
  return withGarments(body, { bodyType: "female", wearing: GARMENT_NAMES, colour: "red" });
})();

/** The same template skinned into a standing pose. */
const posed = (() => {
  const { scene } = validateScene({
    actors: [{ id: "a", bodyType: "female", posture: "standing", wearing: GARMENT_NAMES }],
  });
  const actor = solveScene(scene).actors[0];
  const parts = [...skinHumanMesh(dressed, actor.skeleton, actor.evaluated, undefined, actor.hands, actor.hang)];
  return new Map(parts.map((part) => [part.name, part]));
})();

const submesh = (name) => {
  const found = dressed.submeshes.find((s) => s.name === name);
  assert.ok(found, `no ${name} submesh`);
  return found;
};

/**
 * The free boundary of a mesh: the edges used by exactly one triangle.
 *
 * Welded on position first. The scan is split along its UV seams into coincident
 * copies of a vertex, so counting by index calls every seam a boundary - about
 * twenty times as many edges as there really are, scattered over the whole
 * garment, which is enough noise to hide a hem entirely.
 */
const freeBoundary = (mesh) => {
  const { positions, indices } = mesh;
  const weld = new Int32Array(positions.length / 3);
  const seen = new Map();
  for (let v = 0; v < weld.length; v += 1) {
    const key = [0, 1, 2].map((k) => Math.round(positions[v * 3 + k] * 1e6)).join(",");
    if (!seen.has(key)) seen.set(key, v);
    weld[v] = seen.get(key);
  }
  const used = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = weld[indices[i + e]];
      const b = weld[indices[i + ((e + 1) % 3)]];
      if (a === b) continue;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      used.set(key, (used.get(key) ?? 0) + 1);
    }
  }
  const out = [];
  for (const [key, count] of used) {
    if (count !== 1) continue;
    const [a, b] = key.split(",").map(Number);
    out.push([
      [positions[a * 3], positions[a * 3 + 1], positions[a * 3 + 2]],
      [positions[b * 3], positions[b * 3 + 1], positions[b * 3 + 2]],
    ]);
  }
  return out;
};

test("garments are built for a female body", () => {
  for (const name of GARMENT_NAMES) {
    const mesh = submesh(name);
    assert.ok(mesh.indices.length >= 3, `${name} has no triangles`);
    assert.ok(mesh.colour, `${name} should carry its own colour, not the skin tone`);
  }
});

test("the briefs hide the anatomy they cover", () => {
  assert.ok(
    !dressed.submeshes.some((s) => s.name === "pelvis-anatomy"),
    "pelvis-anatomy should be dropped once briefs are worn"
  );
});

test("every garment vertex is bound to bones that sum to one", () => {
  for (const name of GARMENT_NAMES) {
    const { weights } = submesh(name);
    for (let v = 0; v < weights.length / 4; v += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        assert.ok(weights[v * 4 + k] >= 0, `${name} vertex ${v} has a negative weight`);
        sum += weights[v * 4 + k];
      }
      assert.ok(Math.abs(sum - 1) < 1e-5, `${name} vertex ${v} weights sum to ${sum}`);
    }
  }
});

test("coincident garment vertices agree on their bones", () => {
  // Two copies of one point that disagree about their weights are two points as
  // soon as anything moves, and the garment is an offset surface, so they part
  // by the lift times the disagreement rather than by nothing at all.
  //
  // Compared as a map from bone to weight, and to a tolerance. Not as the four
  // slots in order, because `cut` sorts a blend by weight and two bones of
  // nearly equal share can come out either way round; and not exactly, because
  // both this grouping and the weld inside `lift` quantise position to decide
  // what "the same point" means, on different numbers - one before the lift and
  // one after - so a pair a nanometre apart can fall one side of the boundary
  // here and the other side there. That pair really is left unwelded, and at a
  // thousandth of a unit of weight it moves the fabric by a millionth of the
  // lift. The bar is set where the defect starts mattering.
  for (const name of GARMENT_NAMES) {
    const { positions, joints, weights } = submesh(name);
    const seen = new Map();
    for (let v = 0; v < positions.length / 3; v += 1) {
      const key = [0, 1, 2].map((k) => Math.round(positions[v * 3 + k] * 1e6)).join(",");
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, v);
        continue;
      }
      const bones = new Map();
      for (let k = 0; k < 4; k += 1) {
        const share = weights[first * 4 + k];
        if (share > 0) bones.set(joints[first * 4 + k], share);
      }
      for (let k = 0; k < 4; k += 1) {
        const share = weights[v * 4 + k];
        if (share <= 0) continue;
        const bone = joints[v * 4 + k];
        const was = bones.get(bone);
        assert.ok(was !== undefined, `${name}: bone ${bone} at ${key} on one copy only`);
        assert.ok(
          Math.abs(was - share) < 1e-3,
          `${name}: bone ${bone} at ${key} weighted ${was} and ${share}`
        );
        bones.delete(bone);
      }
      for (const [bone, share] of bones) {
        assert.ok(share < 1e-3, `${name}: bone ${bone} at ${key} on one copy only, at ${share}`);
      }
    }
  }
});

test("the waistband is cut flat in bind space", () => {
  // The field's top term is `waist - y`, a plane, and cutting puts the hem on
  // the zero set of the field rather than on the tessellation. So the front of
  // the waistband is flat to within the interpolation along one edge, and a
  // failure here means the cutting has stopped happening at all.
  const front = freeBoundary(submesh("briefs")).filter(
    ([a, b]) => a[2] > 0.035 && b[2] > 0.035 && a[1] > 0.54 && b[1] > 0.54
  );
  assert.ok(front.length > 20, `only ${front.length} waistband edges found`);
  const rise = front.map(([a, b]) => Math.abs(a[1] - b[1]));
  assert.ok(Math.max(...rise) < 0.002, `waistband steps by ${(Math.max(...rise) * 1720).toFixed(1)}mm in bind space`);
});

test("the waistband stays smooth once the figure is posed", () => {
  // The one that matters, and the one the bind-space check above cannot make:
  // a hem is only as good as the weights its vertices carry, and those are only
  // visible under a pose. Measured in metres of world space rather than bind
  // millimetres, because that is what gets drawn.
  const briefs = posed.get("briefs");
  assert.ok(briefs, "the briefs should survive skinning");
  const front = freeBoundary(briefs).filter(
    ([a, b]) => a[2] > 0.06 && b[2] > 0.06 && a[1] > 0.93 && b[1] > 0.93
  );
  assert.ok(front.length > 20, `only ${front.length} posed waistband edges found`);
  const rise = front.map(([a, b]) => Math.abs(a[1] - b[1]));
  const worst = Math.max(...rise) * 1000;
  // Six millimetres: the hem genuinely descends as it wraps onto the hip, and
  // over a chord across the widest part of the scan's tessellation that is a
  // few millimetres of honest slope. Teeth were nine and alternated in sign.
  assert.ok(worst < 6, `posed waistband steps by ${worst.toFixed(1)}mm`);
});

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
import {
  buildHumanTemplate,
  featureRelief,
  skinHumanMesh,
} from "../src/core/humanMesh.js";
import {
  withGarments,
  resolveWearing,
  CUPPED,
  GARMENT_COLOURS,
  GARMENT_FINISHES,
  GARMENT_NAMES,
} from "../src/core/garments.js";

/** A scan, relieved, built once for the whole file. */
const templates = Object.fromEntries(
  ["female", "male"].map((bodyType) => [
    bodyType,
    featureRelief(
      buildHumanTemplate(
        readFileSync(new URL(`../assets/models/realistic-${bodyType}.glb`, import.meta.url)),
      ),
      { bodyType, build: 1 },
    ),
  ]),
);

// One piece to a place, so a figure cannot wear everything at once: this is
// one of each kind of thing that is not in a slot, over a bra and briefs.
const OUTFIT = ["bra", "briefs", "stockings", "garter-belt", "harness", "cuffs"];

/** The female scan dressed in all of that. */
const dressed = withGarments(templates.female, {
  bodyType: "female",
  wearing: OUTFIT,
  colour: "red",
});

/**
 * Every garment, each built on its own on each body it is made for: all of
 * them for the female scan, and all but the cupped ones for the male.
 */
const alone = ["female", "male"].flatMap((bodyType) =>
  GARMENT_NAMES.filter((name) => bodyType === "female" || !CUPPED.has(name)).map((name) => {
    const mesh = withGarments(templates[bodyType], { bodyType, wearing: [name], colour: "red" })
      .submeshes.find((s) => s.name === name);
    assert.ok(mesh, `${bodyType}: no ${name} submesh`);
    return { bodyType, name, mesh };
  }),
);

/** The same template skinned into a standing pose. */
const posed = (() => {
  const { scene } = validateScene({
    actors: [
      {
        id: "a",
        bodyType: "female",
        posture: "standing",
        wearing: OUTFIT,
      },
    ],
  });
  const actor = solveScene(scene).actors[0];
  const parts = [
    ...skinHumanMesh(
      dressed,
      actor.skeleton,
      actor.evaluated,
      undefined,
      actor.hands,
      actor.hang,
    ),
  ];
  return new Map(parts.map((part) => [part.name, part]));
})();

const submesh = (name) => {
  const found = dressed.submeshes.find((s) => s.name === name);
  assert.ok(found, `no ${name} submesh`);
  return found;
};

test("opaque studio clothing removes covered skin without changing the source or exposed extremities", () => {
  for (const bodyType of ["female", "male"]) {
    // A fresh one, not the file's: that has been dressed a dozen times already,
    // and if any of them had changed it this would be comparing against the
    // changed copy.
    const template = featureRelief(
      buildHumanTemplate(readFileSync(new URL(`../assets/models/realistic-${bodyType}.glb`, import.meta.url))),
      { bodyType, build: 1 },
    );
    const skin = template.submeshes.find((part) => part.primary);
    const original = skin.indices.slice();
    const clothed = withGarments(template, {
      bodyType,
      wearing: ["top", "shorts"],
    });
    const visible = clothed.submeshes.find((part) => part.primary).indices;
    assert.ok(
      visible.length < original.length * 0.85,
      `${bodyType}: covered torso still renders`,
    );
    assert.deepEqual(
      skin.indices,
      original,
      "dressing must not mutate the cached skin template",
    );
    const kept = new Set();
    for (let i = 0; i < visible.length; i += 3)
      kept.add(`${visible[i]},${visible[i + 1]},${visible[i + 2]}`);
    let exposed = 0;
    for (let i = 0; i < original.length; i += 3) {
      const triangle = [original[i], original[i + 1], original[i + 2]];
      if (
        triangle.every(
          (v) =>
            skin.positions[v * 3 + 1] > 0.9 || skin.positions[v * 3 + 1] < 0.2,
        )
      ) {
        assert.ok(
          kept.has(triangle.join(",")),
          `${bodyType}: removed exposed head or lower leg`,
        );
        exposed++;
      }
    }
    assert.ok(exposed > 500, "test must examine real exposed geometry");
    assert.equal(withGarments(template, { bodyType, wearing: [] }), template);
  }
});

test("studio outfits stay attached to male and female figures through standing, seated and kneeling poses", () => {
  for (const bodyType of ["female", "male"]) {
    const template = templates[bodyType];
    const studio = withGarments(template, {
      bodyType,
      wearing: ["top", "shorts"],
      colour: "sage",
    });
    assert.ok(!studio.submeshes.some((part) => part.name === "pelvis-anatomy"));
    for (const posture of ["standing", "seated", "kneeling"]) {
      const { scene } = validateScene({
        actors: [{ bodyType, posture }],
        support: { surface: posture === "seated" ? "chair" : "floor" },
      });
      const actor = solveScene(scene).actors[0];
      const parts = [
        ...skinHumanMesh(
          studio,
          actor.skeleton,
          actor.evaluated,
          undefined,
          actor.hands,
          actor.hang,
        ),
      ];
      for (const name of ["top", "shorts"]) {
        const mesh = parts.find((part) => part.name === name);
        assert.ok(
          mesh?.indices.length > 300,
          `${bodyType} ${posture}: missing ${name}`,
        );
        assert.ok(
          mesh.positions.every(
            (value) => Number.isFinite(value) && Math.abs(value) < 3,
          ),
          `${bodyType} ${posture}: detached or invalid ${name}`,
        );
      }
    }
  }
});

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
    const key = [0, 1, 2]
      .map((k) => Math.round(positions[v * 3 + k] * 1e6))
      .join(",");
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

test("every garment is built for a female body, and all but the cupped ones for a male", () => {
  // The ones whose finish is the point of them: lace that is not lace is a
  // plain bra, and on a man the thong's front stands off the skin over the
  // bulge, where holes would be a view into the figure, so there it is solid.
  const finishes = {
    "female lace-bra": "lace",
    "female lace-thong": "lace",
    "male lace-thong": "lycra",
    "female bikini-top": "lycra",
    "female stockings": "sheer",
    "female garter-belt": "lace",
    "female harness": "leather",
    "male harness": "leather",
    "female cuffs": "leather",
  };
  assert.equal(alone.length, GARMENT_NAMES.length * 2 - CUPPED.size);
  for (const { bodyType, name, mesh } of alone) {
    const label = `${bodyType} ${name}`;
    const count = mesh.positions.length / 3;
    assert.ok(mesh.indices.length >= 300, `${label} has ${mesh.indices.length / 3} triangles`);
    assert.deepEqual(mesh.colour, GARMENT_COLOURS.red, `${label} should carry its own colour, not the skin tone`);
    assert.ok(GARMENT_FINISHES.includes(mesh.finish), `${label} is made of ${mesh.finish}`);
    if (finishes[label]) assert.equal(mesh.finish, finishes[label], `${label} finish`);
    // Lace is cut out of the texture the body is mapped with, so a garment
    // without the body's texture coordinates has no holes to show.
    assert.equal(mesh.uvs?.length, count * 2, `${label} texture coordinates`);
    if (mesh.trim) {
      assert.equal(mesh.trim.length, count, `${label} trim`);
      assert.ok(mesh.trim.every(Number.isFinite), `${label} trim is not finite`);
    }
  }
});

test("the briefs hide the anatomy they cover", () => {
  assert.ok(
    !dressed.submeshes.some((s) => s.name === "pelvis-anatomy"),
    "pelvis-anatomy should be dropped once briefs are worn",
  );
});

test("cuffs are four straps, one above each wrist and each ankle, and nothing else", () => {
  const { positions } = submesh("cuffs");
  const joints = ["wrist_l", "wrist_r", "ankle_l", "ankle_r"].map((bone) => {
    const rest = dressed.jointByBone.get(bone).rest;
    return [rest[12], rest[13], rest[14]];
  });
  const counts = joints.map(() => 0);
  for (let v = 0; v < positions.length / 3; v += 1) {
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    const distances = joints.map((j) => Math.hypot(p[0] - j[0], p[1] - j[1], p[2] - j[2]));
    const nearest = distances.indexOf(Math.min(...distances));
    assert.ok(distances[nearest] < 0.06, `cuff vertex ${v} is ${distances[nearest].toFixed(3)} from any wrist or ankle`);
    counts[nearest] += 1;
  }
  for (const [i, count] of counts.entries()) assert.ok(count > 20, `no strap at ${["wrist_l", "wrist_r", "ankle_l", "ankle_r"][i]}`);
});

test("every garment vertex is bound to bones that sum to one", () => {
  for (const { bodyType, mesh } of alone) {
    const name = `${bodyType} ${mesh.name}`;
    const { weights } = mesh;
    for (let v = 0; v < weights.length / 4; v += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        assert.ok(
          weights[v * 4 + k] >= 0,
          `${name} vertex ${v} has a negative weight`,
        );
        sum += weights[v * 4 + k];
      }
      assert.ok(
        Math.abs(sum - 1) < 1e-5,
        `${name} vertex ${v} weights sum to ${sum}`,
      );
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
  for (const { bodyType, mesh } of alone) {
    const name = `${bodyType} ${mesh.name}`;
    const { positions, joints, weights } = mesh;
    const seen = new Map();
    for (let v = 0; v < positions.length / 3; v += 1) {
      const key = [0, 1, 2]
        .map((k) => Math.round(positions[v * 3 + k] * 1e6))
        .join(",");
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
        assert.ok(
          was !== undefined,
          `${name}: bone ${bone} at ${key} on one copy only`,
        );
        assert.ok(
          Math.abs(was - share) < 1e-3,
          `${name}: bone ${bone} at ${key} weighted ${was} and ${share}`,
        );
        bones.delete(bone);
      }
      for (const [bone, share] of bones) {
        assert.ok(
          share < 1e-3,
          `${name}: bone ${bone} at ${key} on one copy only, at ${share}`,
        );
      }
    }
  }
});

test("every garment is one piece, but for a stocking on each leg and a cuff on each limb", () => {
  // Welded on position, as `freeBoundary` is, so the scan's UV seams do not
  // count as cuts. A strap is three or four millimetres wide and the scan's
  // vertex rows are a centimetre apart in places; if the cutting misses one,
  // it is not missing, it is two straps with a gap in them, and the only way to
  // see that in a number is to count the pieces.
  const expected = { stockings: 2, cuffs: 4 };
  for (const { bodyType, name, mesh } of alone) {
    const { positions, indices } = mesh;
    const weld = new Int32Array(positions.length / 3);
    const seen = new Map();
    for (let v = 0; v < weld.length; v += 1) {
      const key = [0, 1, 2].map((k) => Math.round(positions[v * 3 + k] * 1e6)).join(",");
      if (!seen.has(key)) seen.set(key, v);
      weld[v] = seen.get(key);
    }
    const parent = Int32Array.from(weld);
    const find = (v) => {
      while (parent[v] !== v) v = parent[v] = parent[parent[v]];
      return v;
    };
    for (let i = 0; i < indices.length; i += 3) {
      const a = find(weld[indices[i]]);
      for (const other of [indices[i + 1], indices[i + 2]]) {
        const b = find(weld[other]);
        if (a !== b) parent[b] = a;
      }
    }
    const pieces = new Set();
    for (let i = 0; i < indices.length; i += 3) pieces.add(find(weld[indices[i]]));
    assert.equal(pieces.size, expected[name] ?? 1, `${bodyType} ${name} comes in ${pieces.size} pieces`);
  }
});

test("a figure wears one piece to a place, the first it is given", () => {
  assert.deepEqual(resolveWearing(["bra", "top", "briefs", "bra", "shorts", "cuffs", "stockings"]), {
    wearing: ["bra", "briefs", "cuffs", "stockings"],
    dropped: ["top", "shorts"],
  });
  assert.deepEqual(resolveWearing([]), { wearing: [], dropped: [] });

  // And a caller that has not asked the scene first gets the same answer
  // rather than two surfaces fighting over the same skin.
  const both = withGarments(templates.female, { bodyType: "female", wearing: ["briefs", "shorts"] });
  const garments = both.submeshes.filter((s) => s.garment).map((s) => s.name);
  assert.deepEqual(garments, ["briefs"]);

  const { scene, issues } = validateScene({
    actors: [{ id: "a", bodyType: "female", wearing: ["bra", "top", "briefs"] }],
  });
  assert.deepEqual(scene.actors[0].wearing, ["bra", "briefs"]);
  assert.ok(
    issues.some((issue) => issue.level === "warning" && /already wearing something there, left off top/.test(issue.message)),
    JSON.stringify(issues),
  );
});

test("cups are made for a bust and refused without one", () => {
  for (const name of CUPPED) {
    assert.equal(
      withGarments(templates.male, { bodyType: "male", wearing: [name] }),
      templates.male,
      `${name} was built on a male figure`,
    );
  }
  const { scene, issues } = validateScene({
    actors: [{ id: "a", bodyType: "male", wearing: ["lace-bra", "lace-thong"] }],
  });
  assert.deepEqual(scene.actors[0].wearing, ["lace-thong"]);
  assert.ok(
    issues.some((issue) => issue.level === "warning" && /lace-bra needs a bust to hold, left off/.test(issue.message)),
    JSON.stringify(issues),
  );
});

test("the waistband is cut flat in bind space", () => {
  // The field's top term is `waist - y`, a plane, and cutting puts the hem on
  // the zero set of the field rather than on the tessellation. So the front of
  // the waistband is flat to within the interpolation along one edge, and a
  // failure here means the cutting has stopped happening at all.
  const front = freeBoundary(submesh("briefs")).filter(
    ([a, b]) => a[2] > 0.035 && b[2] > 0.035 && a[1] > 0.54 && b[1] > 0.54,
  );
  assert.ok(front.length > 20, `only ${front.length} waistband edges found`);
  const rise = front.map(([a, b]) => Math.abs(a[1] - b[1]));
  assert.ok(
    Math.max(...rise) < 0.002,
    `waistband steps by ${(Math.max(...rise) * 1720).toFixed(1)}mm in bind space`,
  );
});

test("the waistband stays smooth once the figure is posed", () => {
  // The one that matters, and the one the bind-space check above cannot make:
  // a hem is only as good as the weights its vertices carry, and those are only
  // visible under a pose. Measured in metres of world space rather than bind
  // millimetres, because that is what gets drawn.
  const briefs = posed.get("briefs");
  assert.ok(briefs, "the briefs should survive skinning");
  const front = freeBoundary(briefs).filter(
    ([a, b]) => a[2] > 0.06 && b[2] > 0.06 && a[1] > 0.93 && b[1] > 0.93,
  );
  assert.ok(
    front.length > 20,
    `only ${front.length} posed waistband edges found`,
  );
  const rise = front.map(([a, b]) => Math.abs(a[1] - b[1]));
  const worst = Math.max(...rise) * 1000;
  // Six millimetres: the hem genuinely descends as it wraps onto the hip, and
  // over a chord across the widest part of the scan's tessellation that is a
  // few millimetres of honest slope. Teeth were nine and alternated in sign.
  assert.ok(worst < 6, `posed waistband steps by ${worst.toFixed(1)}mm`);
});

import assert from "node:assert/strict";
import test from "node:test";
import { resolveLandmark } from "../src/core/landmarks.js";
import {
  resolveArrangement,
  resolveSurface,
  supportPlaneFor,
} from "../src/core/poseLibrary.js";
import {
  applyArrangement,
  createActor,
  refresh,
  seatOnSurface,
  solveScene,
} from "../src/core/solver.js";

const scene = (
  surface = "chair",
  types = ["male", "female"],
  overrides = [],
) => ({
  support: { surface },
  relationship: { arrangement: "straddle_lap" },
  actors: ["seated", "seated_straddle"].map((posture, index) => ({
    posture,
    bodyType: types[index],
    wearing: ["top", "shorts"],
    ...overrides[index],
  })),
});

function checkSupports(solved, tolerance = 0.01) {
  for (const actor of solved.actors) {
    const lowest = Math.min(
      ...actor.volumes.flatMap((v) => [v.a[1] - v.ra, v.b[1] - v.rb]),
    );
    assert.ok(
      lowest >= solved.surface.ground - 0.002,
      `figure ${actor.index} sunk through the floor`,
    );
    for (const support of actor.posture.supports) {
      const { bones } = resolveLandmark(support.landmark, support.side);
      const supportY = Math.min(
        ...actor.volumes
          .filter((v) => bones.includes(v.bone))
          .flatMap((v) => [v.a[1] - v.ra, v.b[1] - v.rb]),
      );
      const gap = Math.abs(supportY - supportPlaneFor(support, solved.surface));
      assert.ok(
        gap <= tolerance,
        `${support.landmark}.${support.side ?? ""}: ${gap} support gap`,
      );
    }
  }
}

test("chair-supported pairs close their contacts across body types without floating or overlap", () => {
  for (const types of [
    ["male", "female"],
    ["female", "male"],
    ["male", "male"],
    ["female", "female"],
  ]) {
    const solved = solveScene(scene("chair", types));
    assert.equal(solved.quality.unmetContacts, 0, types.join("/"));
    assert.ok(solved.quality.contactDetail.every((c) => c.distance < 0.01));
    assert.ok(solved.quality.maxDepth < 0.005);
    assert.ok(solved.quality.propPenetration < 0.005);
    const rise =
      solved.actors[1].pose.root.position[1] -
      solved.actors[0].pose.root.position[1];
    assert.ok(rise > 0 && rise < 0.35, `unsupported vertical retreat: ${rise}`);
    checkSupports(solved);
  }
});

test("body-supported placement follows the measured geometry across furniture and proportions", () => {
  const cases = [
    scene("bench"),
    scene(
      "chair",
      ["male", "female"],
      [
        { stature: 1.9, build: 1.15 },
        { stature: 1.55, build: 0.9 },
      ],
    ),
    scene(
      "chair",
      ["female", "male"],
      [
        { stature: 1.55, build: 0.9 },
        { stature: 1.9, build: 1.15 },
      ],
    ),
  ];
  for (const spec of cases) {
    const solved = solveScene(spec);
    assert.equal(solved.quality.unmetContacts, 0);
    assert.ok(solved.quality.contactDetail.every((c) => c.distance < 0.01));
    assert.ok(solved.quality.maxDepth < 0.012);
    assert.ok(solved.quality.propPenetration < 0.005);
    checkSupports(solved);
  }
});

test("a shorter retreat cannot replace an already close floor support with thigh overlap", () => {
  for (const spec of [
    scene("floor", ["male", "male"]),
    scene("floor", ["female", "male"], [{ posture: "seated_reclined" }]),
  ]) {
    const solved = solveScene(spec);
    assert.equal(solved.quality.unmetContacts, 0);
    assert.ok(solved.quality.contactDetail.every((c) => c.distance < 0.05));
    assert.ok(solved.quality.maxDepth < 0.02);
    assert.equal(solved.quality.propPenetration, 0);
    checkSupports(solved);
  }
});

test("explicit clearance directions still win and placement never mutates scene intent", () => {
  const spec = scene(),
    before = structuredClone(spec);
  const surface = resolveSurface("chair");
  const roots = [];
  for (const clear of [
    null,
    { axis: "vertical", measure: "bulk" },
    { axis: "approach", measure: "bulk" },
  ]) {
    const [primary, secondary] = spec.actors.map((actor, index) =>
      refresh(createActor(actor, index)),
    );
    seatOnSurface(primary, surface);
    applyArrangement(
      primary,
      secondary,
      { ...resolveArrangement("straddle_lap"), ...(clear ? { clear } : {}) },
      surface,
    );
    roots.push([...secondary.pose.root.position]);
  }
  assert.deepEqual(
    roots[0],
    roots[2],
    "inferred clearance should select the nearer horizontal seed",
  );
  assert.ok(
    roots[1][1] > roots[0][1] + 0.5,
    "explicit vertical clearance was ignored",
  );
  assert.deepEqual(spec, before);
});

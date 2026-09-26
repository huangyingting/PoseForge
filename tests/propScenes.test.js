import assert from "node:assert/strict";
import test from "node:test";
import { compose, measure, sceneFor } from "../scripts/interaction-composer.mjs";
import { figure } from "../scripts/interaction-templates.mjs";
import { landmarkPoint } from "../src/core/landmarks.js";

/** Compose a one-figure plan and measure it as the viewer solves it. */
function solo(surface, spec, place) {
  const plan = { surface, mode: "fit", roles: { a: 0 }, actors: [spec], place: [{ index: 0, ...place }], fit: [], contacts: [], checks: [] };
  const actors = compose(plan).map(({ override, tilt, ...clean }, i) => ({ ...clean, id: `partner-${i + 1}`, label: "Partner", outfit: "sage", wearing: ["top", "shorts"] }));
  const m = measure(sceneFor(plan, actors).scene);
  return { m, actor: m.solved.actors[0] };
}

test("a figure let down onto an exercise ball comes to rest on it, off the floor", () => {
  const { m, actor } = solo("ball", figure("female", "supine", { soloSurface: "floor" }), { pitch: -10, pelvisTo: [0, 1.5, 0.1], settle: {} });
  assert.ok(m.pen.prop < 0.035, `into the ball by ${m.pen.prop}`);
  // Resting on the crest: well below where it started, with nothing on the floor.
  assert.ok(landmarkPoint(actor, "pelvis")[1] < 1, "still in the air");
  assert.ok(m.frames[0].lowest > 0.3, `lowest ${m.frames[0].lowest}`);
});

test("a figure resting a hair into the floor settles sideways against a prop without backing out of the floor", () => {
  // Kneeling behind a ball and brought in towards it, as a chest laid over it is.
  const spec = figure("female", "kneeling", { soloSurface: "floor" });
  const { m, actor } = solo("ball", spec, { yaw: 180, pelvisTo: [0, null, 0.9], rest: -0.004, settle: { along: [0, 0, -1] } });
  assert.ok(Math.abs(m.frames[0].lowest + 0.004) < 0.002, `lowest ${m.frames[0].lowest}`);
  assert.ok(landmarkPoint(actor, "pelvis")[2] < 0.8, "did not move in");
  assert.ok(m.pen.prop < 0.035, `into the ball by ${m.pen.prop}`);
});

test("a figure let down a wedge's slope lies along it, the hips on the tall end", () => {
  const { m, actor } = solo("wedge", figure("female", "prone", { soloSurface: "floor" }), { pitch: 17, pelvisTo: [0, 1.2, -0.22], settle: {} });
  assert.ok(m.pen.prop < 0.035, `into the wedge by ${m.pen.prop}`);
  const pelvis = landmarkPoint(actor, "pelvis"),
    head = landmarkPoint(actor, "head");
  assert.ok(pelvis[1] > head[1], "the hips are not raised");
  assert.ok(pelvis[1] > 0.2 && pelvis[1] < 0.4, `pelvis at ${pelvis[1]}`);
});

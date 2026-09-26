import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composeStudy } from "../scripts/build-interaction-studies.mjs";
import { DETAILS, SEATS, TURNS, detailFor } from "../scripts/interaction-templates.mjs";
import { poseDifference, poseSignature } from "../scripts/scene-distance.mjs";
import { solveScene } from "../src/core/solver.js";
import { landmarkPoint } from "../src/core/landmarks.js";
import { quatAngle } from "../src/core/math.js";

const classifications = JSON.parse(readFileSync(new URL("../scripts/data/interaction-classifications.json", import.meta.url)));
const byId = new Map(classifications.map((c) => [c.id, c]));

/** Compose a record as classified, or with fields changed (`null` removes one), and check it passes. */
function compose(id, patch = {}) {
  const cls = { ...byId.get(id), ...patch };
  for (const key of Object.keys(cls)) if (cls[key] === null) delete cls[key];
  const study = composeStudy(cls);
  assert.ok(study.passed, `${id} ${JSON.stringify(patch)}: ${study.failures.join("; ")}`);
  const solved = solveScene(study.scene);
  return { ...study, at: (index, landmark) => landmarkPoint(solved.actors[index], landmark) };
}
const turn = (study) => (quatAngle(poseSignature(study.scene).turns[1]) * 180) / Math.PI;

test("every detail a record names is known, and an unknown one is refused", () => {
  for (const cls of classifications)
    for (const role of ["a", "b", "c"])
      for (const name of cls[`${role}_pose`] ?? []) assert.ok(DETAILS[name] || TURNS[name] != null, `${cls.id} ${role}_pose ${name}`);
  assert.throws(() => composeStudy({ ...byId.get("img-0173"), a_pose: ["no_such_detail"] }), /unknown a_pose detail no_such_detail/);
});

test("a detail read off the source image shows in the figure it is laid on", () => {
  // Lying on the side, the top leg raised.
  const raised = compose("img-0173");
  const plain = compose("img-0173", { a_pose: null });
  assert.ok(poseDifference(poseSignature(raised.scene), poseSignature(plain.scene)).difference >= 1);
  assert.ok(raised.at(0, "ankle.l")[1] > plain.at(0, "ankle.l")[1] + 0.2);
});

test("kneeling astride, a knee brought up sets that foot flat in front, out beside the partner", () => {
  const lunge = compose("img-0057");
  const kneeling = compose("img-0057", { b_pose: null });
  const hips = lunge.at(1, "pelvis");
  const [up, down] = ["ankle.l", "ankle.r"].map((name) => lunge.at(1, name));
  assert.ok(up[2] > hips[2] + 0.2 && up[1] < 0.25, `foot at ${up}`);
  assert.ok(down[2] < hips[2] && kneeling.at(1, "ankle.l")[2] < kneeling.at(1, "pelvis")[2]);
});

test("bent forward, a raised leg goes out behind, not forward under the chest", () => {
  assert.equal(detailFor("leg_up_l", "standing").hip_l.flexion, 100);
  assert.ok(detailFor("leg_up_l", "standing_bent_forward").hip_l.flexion < 0);
  const study = compose("img-1122");
  const [pelvis, head, foot] = ["pelvis", "head", "ankle.l"].map((name) => study.at(0, name));
  assert.ok(foot[1] > pelvis[1] - 0.1, `raised foot at ${foot[1]}`);
  // Behind the hips, away from the head.
  assert.ok(Math.sign(foot[2] - pelvis[2]) !== Math.sign(head[2] - pelvis[2]));
});

test("a wheelbarrow's hands rest on the ledge the note names, and a kneeling partner holds the hips lower", () => {
  // Drawn with an ottoman on the floor: the note, not the floor, names the ledge.
  const kneeling = compose("img-0026");
  const standing = compose("img-0471");
  assert.equal(kneeling.surface, "bed");
  assert.equal(compose("img-0278").surface, "bench");
  assert.equal(kneeling.scene.actors[0].posture, "kneeling");
  assert.equal(standing.scene.actors[0].posture, "standing");
  // A's hips (actor 1) over B's feet: lower, and B nearer the ledge.
  const hips = (study) => study.at(1, "pelvis")[1] - study.at(0, "ankle.l")[1];
  assert.ok(hips(kneeling) < hips(standing) - 0.15, `${hips(kneeling)} vs ${hips(standing)}`);
  assert.ok(kneeling.at(0, "pelvis")[2] < standing.at(0, "pelvis")[2]);
});

test("between the legs, a partner lying flat is prone with the legs long, or the feet up", () => {
  const flat = compose("img-0020");
  const feetUp = compose("img-0273");
  for (const study of [flat, feetUp]) assert.equal(study.scene.actors[1].posture, "prone");
  assert.ok(flat.scene.actors[1].joints.knee_l.flexion < 20);
  assert.ok(feetUp.scene.actors[1].joints.knee_l.flexion > 60);
  assert.ok(feetUp.at(1, "ankle.l")[1] > flat.at(1, "ankle.l")[1] + 0.15);
});

test("on a sofa the partner receiving oral lies back along it at the edge only when noted", () => {
  assert.equal(compose("img-1280").scene.actors[0].posture, "supine");
  assert.equal(compose("img-1280", { notes: null }).scene.actors[0].posture, "seated");
});

test("head to foot, the partner behind lies turned round, on the side or face down", () => {
  assert.ok(turn(compose("img-0030")) > 150);
  assert.ok(turn(compose("img-0030", { notes: null })) < 30);
  assert.ok(turn(compose("img-0152")) > 150);
});

test("squatting over a partner lying face down, the feet are flat either side of the hips", () => {
  const study = compose("img-0267");
  assert.equal(study.scene.actors[1].posture, "squatting");
  const hips = study.at(0, "pelvis");
  const [left, right] = ["ankle.l", "ankle.r"].map((name) => study.at(1, name));
  for (const foot of [left, right]) assert.ok(foot[1] < 0.2, `foot at ${foot[1]}`);
  assert.ok(Math.sign(left[0] - hips[0]) !== Math.sign(right[0] - hips[0]));
});

test("crouched astride a piledriver, the partner sinks on bent knees", () => {
  const crouched = compose("img-0048");
  const upright = compose("img-0048", { notes: "piledriver" });
  assert.ok(crouched.scene.actors[1].joints.knee_l.flexion > upright.scene.actors[1].joints.knee_l.flexion + 30);
});

test("on a low table or seat, A squats with the feet on its top, or kneels up", () => {
  const squat = compose("img-0139");
  assert.equal(squat.scene.actors[0].posture, "squatting");
  assert.ok(squat.at(0, "ankle.l")[1] > SEATS.bench.top);
  assert.equal(compose("img-0626").scene.actors[0].posture, "kneeling");
});

test("astride a partner arched over an exercise ball, B faces them", () => {
  const study = compose("img-0402");
  assert.equal(study.surface, "ball");
  assert.ok(turn(study) > 150);
});

test("in a 69 noted lying on top, the partner above lies full length instead of on hands and knees", () => {
  assert.equal(compose("img-0635").scene.actors[1].posture, "prone");
  assert.equal(compose("img-0635", { notes: null }).scene.actors[1].posture, "all_fours");
});

test("kneeling up on the seat astride a partner sitting on it, the knees are on the seat either side of the thighs", () => {
  const study = compose("img-0091");
  assert.equal(study.surface, "sofa");
  assert.match(study.scene.actors[1].posture, /^kneeling/);
  // Unnoted, A sits astride B's lap with the feet down off the seat.
  assert.equal(compose("img-0091", { notes: null }).scene.actors[1].posture, "seated_straddle");
  const across = (index, name) => Math.abs(study.at(index, name)[0] - study.at(0, "pelvis")[0]);
  for (const side of ["l", "r"]) {
    const knee = study.at(1, `knee.${side}`);
    assert.ok(knee[2] < SEATS.sofa.z && knee[1] > SEATS.sofa.top && knee[1] < SEATS.sofa.top + 0.2, `knee at ${knee}`);
    assert.ok(across(1, `knee.${side}`) > across(0, `knee.${side}`) + 0.1);
  }
});

test("side saddle on a sofa, B sits across the hips of A lying along it, facing out with the feet on the floor", () => {
  const study = compose("img-0815");
  assert.equal(study.surface, "sofa");
  assert.deepEqual(study.scene.actors.map((a) => a.posture), ["supine", "seated"]);
  // A lies along the sofa; B's knees point out over its front edge, across A.
  assert.ok(Math.abs(study.at(0, "head")[0] - study.at(0, "pelvis")[0]) > 0.5);
  assert.ok(study.at(1, "knee.l")[2] > study.at(1, "pelvis")[2] + 0.1);
  for (const foot of ["ankle.l", "ankle.r"]) assert.ok(study.at(1, foot)[1] < 0.15, `${foot} at ${study.at(1, foot)[1]}`);
  // Legs crossed, the right foot comes over beside the left, and the picture changes.
  const crossed = compose("img-0693");
  const side = (s, foot) => Math.sign(s.at(1, foot)[0] - s.at(1, "pelvis")[0]);
  assert.notEqual(side(study, "ankle.r"), side(study, "ankle.l"));
  assert.equal(side(crossed, "ankle.r"), side(crossed, "ankle.l"));
  assert.ok(poseDifference(poseSignature(crossed.scene), poseSignature(study.scene)).difference >= 1);
});

test("standing with a foot up on a bench, B's hands go where the record puts them", () => {
  const targets = (patch) => compose("img-0763", patch).scene.contacts.filter((c) => c.from.startsWith("hand.")).map((c) => c.to);
  assert.deepEqual(targets({}), ["hip.r", "hip.l"]);
  assert.deepEqual(targets({ b_hands: "shoulders" }), ["shoulder.r", "shoulder.l"]);
  assert.deepEqual(targets({ b_hands: "embrace" }), ["back", "back"]);
});

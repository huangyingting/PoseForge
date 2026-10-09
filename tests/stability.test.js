import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkInteractionStudies, interactionPreset } from "../src/core/interactionStudies.js";
import { solveScene } from "../src/core/solver.js";
import { supportProps } from "../src/core/supports.js";
import { bearings, hanging, stability } from "../src/core/stability.js";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
const entries = read("public/catalog/sexposes-v1.json").entries;
const studies = checkInteractionStudies(
  read("public/catalog/interaction-studies-v1.json"),
  read("src/data/interaction-manifest.json"),
  entries,
);
const solve = (id) => solveScene(interactionPreset(entries.find((entry) => entry.sourceId === id), studies).scene);
const propsOf = (solved) => [...solved.props, ...supportProps(solved)];

/** The solved scene with the figures `which` lifted straight up by `dy`. */
function lifted(solved, which, dy) {
  const up = (p) => [p[0], p[1] + dy, p[2]];
  return {
    ...solved,
    actors: solved.actors.map((actor, i) =>
      which.includes(i) ? { ...actor, volumes: actor.volumes.map((v) => ({ ...v, a: up(v.a), b: up(v.b) })) } : actor,
    ),
  };
}

// What the build lets a figure fall short by (UNHELD in the composer).
const HELD = { lift: 0.1, tip: 0.08 };
const held = ({ lift, tip }) => lift <= HELD.lift && tip <= HELD.tip;
// On the floor, to within a millimetre.
const grounded = (gaps) => gaps.every((gap) => gap < 0.001);

test("a figure kneeling to a standing partner is held by the floor, and lifted off it hangs", () => {
  const solved = solve("standing-oral");
  const props = propsOf(solved);
  for (const [i, short] of stability(solved, props).entries()) assert.ok(held(short), `actor ${i} short by ${JSON.stringify(short)}`);
  assert.ok(grounded(hanging(solved, props)), "both on the floor");

  // Ten centimetres up, nothing is left under either of them.
  const up = lifted(solved, [0, 1], 0.1);
  for (const [i, { lift }] of stability(up, props).entries()) assert.ok(lift > 0.95, `actor ${i} still ${(1 - lift).toFixed(2)} held`);
  for (const [i, gap] of hanging(up, props).entries()) assert.ok(Math.abs(gap - 0.1) < 0.01, `actor ${i} hangs ${gap.toFixed(3)} m`);
});

test("beside a bed what holds a standing figure up is the floor, not the bed's top", () => {
  const solved = solve("wheelbarrow-bed");
  const props = propsOf(solved);
  for (const [i, short] of stability(solved, props).entries()) assert.ok(held(short), `actor ${i} short by ${JSON.stringify(short)}`);
  assert.ok(grounded(hanging(solved, props)), "both down");

  // Stood level with the mattress beside it, the partner behind stands on air.
  const top = (actor) => Math.max(...actor.volumes.flatMap((v) => [v.a[1], v.b[1]]));
  const standing = top(solved.actors[0]) > top(solved.actors[1]) ? 0 : 1;
  const ground = solved.surface.ground;
  assert.ok(ground > 0.5, `the bed is ${ground} m high`);
  const up = lifted(solved, [standing], ground);
  assert.ok(stability(up, props)[standing].lift > 0.9, "held up beside the bed");
  assert.ok(Math.abs(hanging(up, props)[standing] - ground) < 0.01, "stood on the bed's height");
});

test("a carried figure is held by the partner who carries it, and both by the floor", () => {
  const solved = solve("ascent-to-desire");
  const props = propsOf(solved);
  const forces = bearings(solved, props);
  // One of them touches nothing but the other...
  const carried = solved.actors.findIndex((_, i) => !forces.some(({ on, from }) => on === i && from < 0));
  assert.ok(carried >= 0, "someone is off the floor");
  assert.ok(forces.some(({ on, from }) => on === carried && from === 1 - carried), "the carried figure rests on or is held by the partner");
  // ...and is held up all the same.
  for (const [i, short] of stability(solved, props, forces).entries()) assert.ok(held(short), `actor ${i} short by ${JSON.stringify(short)}`);
  assert.ok(grounded(hanging(solved, props, forces)), "both on the floor");

  // Lifted together, the two hang as one: the carried figure's weight goes
  // nowhere, however it is held.
  const up = lifted(solved, [0, 1], 0.1);
  const upForces = bearings(up, props);
  const shortfall = stability(up, props, upForces);
  for (const [i, short] of shortfall.entries()) assert.ok(!held(short), `actor ${i} held in the air`);
  for (const [i, gap] of hanging(up, props, upForces).entries()) assert.ok(Math.abs(gap - 0.1) < 0.01, `actor ${i} hangs ${gap.toFixed(3)} m`);
});

/**
 * A body of balls, `[bone, centre, radius]`, and any `more` volumes, for what a
 * whole pose would take too much else to show: all its weight is at the first
 * ball's centre.
 */
function balls(list, more = []) {
  return {
    bodyType: "female",
    skeleton: { bones: [{ name: "pelvis" }], boneIndex: () => 0 },
    evaluated: { positions: [list[0][1]] },
    volumes: [...more, ...list.map(([bone, c, r]) => ({ bone, a: c, b: c, ra: r, rb: r }))],
  };
}
// A partner lying along the floor, a metre long and propped at the corners,
// wide enough to hold up whatever is laid on it, and anything else of theirs.
const log = (...hands) =>
  balls(
    [["spine01", [0, 0.2, 0], 0.2], ...[-0.5, 0.5].flatMap((x) => [-0.3, 0.3].map((z) => ["toe_l", [x, 0.05, z], 0.05])), ...hands],
    [{ bone: "spine01", a: [-0.5, 0.2, 0], b: [0.5, 0.2, 0], ra: 0.2, rb: 0.2 }],
  );
const scene = (...actors) => ({ actors, surface: { ground: 0 }, props: [] });

test("a body lies on a partner only on top of them, not against the slope of their side", () => {
  // A ball laid on the log at an angle off its top: at 30 degrees it lies on it, at 60 it slides off.
  const on = (degrees) => {
    const t = (degrees * Math.PI) / 180;
    return scene(balls([["pelvis", [0, 0.2 + 0.3 * Math.cos(t), 0.3 * Math.sin(t)], 0.1]]), log());
  };
  const [top, partner] = stability(on(30));
  assert.ok(held(top), `on top, short by ${JSON.stringify(top)}`);
  assert.ok(held(partner), `under it, short by ${JSON.stringify(partner)}`);
  assert.ok(stability(on(60))[0].lift > 0.9, "held against the side");
});

test("a partner's hands hold up a trunk from beneath it, or a limb either way, but not pressed on top of a trunk", () => {
  // Two hands of the partner lying under, either side of the middle of what they hold, over it or under it.
  const holding = (bone, over) => {
    const y = 1 + over * 0.16;
    return scene(balls([[bone, [0, 1, 0], 0.12]]), log(["hand_l", [-0.05, y, 0], 0.04], ["hand_r", [0.05, y, 0], 0.04]));
  };
  assert.ok(held(stability(holding("pelvis", -1))[0]), "lifted from beneath");
  assert.ok(stability(holding("pelvis", 1))[0].lift > 0.9, "a trunk lifted by hands laid on top of it");
  assert.ok(held(stability(holding("hip_l", 1))[0]), "a thigh held by hands closed round it from above");
});

test("a head pressed to a partner leans on them with little more than its own weight", () => {
  const resting = (bone) => stability(scene(balls([[bone, [0, 0.5, 0], 0.1]]), log()))[0];
  assert.ok(held(resting("spine03")), "the chest laid on them");
  const head = resting("head");
  assert.ok(head.lift > 0.8, `held up by its head, short by only ${head.lift.toFixed(2)}`);
});

test("a body is held up by a partner it lies on with no more than its weight, not squeezed level between two of theirs", () => {
  // Out in the air, lying on one of the partner's arms and under the other: held over the one, not out past them both.
  const caught = (x) =>
    stability(scene(balls([["pelvis", [x, 1, 0], 0.05], ["hip_l", [0, 1, 0], 0.1], ["knee_l", [0.2, 1, 0], 0.1]]), log(["spine02", [0.2, 0.8, 0], 0.1], ["spine03", [0, 1.2, 0], 0.1])))[0];
  assert.ok(held(caught(0.2)), "over the arm it lies on");
  const out = caught(0.6);
  assert.ok(!held(out), `held out past the arms, short by only ${JSON.stringify(out)}`);
});

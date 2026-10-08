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

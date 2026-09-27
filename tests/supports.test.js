import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkInteractionStudies, interactionPreset } from "../src/core/interactionStudies.js";
import { propBox, propDistance } from "../src/core/propShapes.js";
import { centreOfMass, solveScene } from "../src/core/solver.js";
import { supportProps } from "../src/core/supports.js";

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url)));
const entries = read("public/catalog/sexposes-v1.json").entries;
const studies = checkInteractionStudies(
  read("public/catalog/interaction-studies-v1.json"),
  read("src/data/interaction-manifest.json"),
  entries,
);
const solve = (id) => solveScene(interactionPreset(entries.find((entry) => entry.sourceId === id), studies).scene);

/** The nearest each figure comes to a prop: negative where it sinks in. */
function gaps(solved, prop) {
  return solved.actors.map((actor) => {
    let nearest = Infinity;
    for (const { a, b, ra, rb } of actor.volumes)
      for (let k = 0; k <= 8; k += 1) {
        const t = k / 8;
        const centre = a.map((value, i) => value + (b[i] - value) * t);
        nearest = Math.min(nearest, propDistance(prop, centre).distance - (ra + (rb - ra) * t));
      }
    return nearest;
  });
}

test("a partner sitting back on the floor with a lover on the lap is given a cushion and a wedge", () => {
  for (const id of ["caboose", "seated-ball", "face-off"]) {
    const solved = solve(id);
    const before = JSON.stringify(solved.actors.map((actor) => actor.evaluated.positions));
    const added = supportProps(solved);
    assert.deepEqual(added.map((prop) => prop.kind), ["cushion", "backrest"], id);
    // Built to the figure as it is: nobody is moved to fit them.
    assert.equal(JSON.stringify(solved.actors.map((actor) => actor.evaluated.positions)), before, id);
    const seated = solved.actors.findIndex((actor) => actor.posture.id === "seated_reclined");
    for (const prop of added) {
      assert.equal(propBox(prop).min[1], solved.surface.ground ?? 0, `${id} ${prop.kind} stands on the floor`);
      const near = gaps(solved, prop);
      // The seated figure rests on it, sinking in no more than a cushion gives...
      assert.ok(near[seated] < 0.001, `${id} ${prop.kind} is ${near[seated].toFixed(3)} m off`);
      // ...and nothing else cuts into it.
      for (const gap of near) assert.ok(gap > -0.009, `${id} ${prop.kind} cut ${(-gap).toFixed(3)} m deep`);
    }
    // Between them they carry the weight that was hanging over the back.
    const com = centreOfMass(solved.actors[seated]);
    const [lo, hi] = [Math.min(...added.map((prop) => propBox(prop).min[2])), Math.max(...added.map((prop) => propBox(prop).max[2]))];
    assert.ok(com[2] > lo && com[2] < hi, `${id} centre of mass at z ${com[2].toFixed(2)}, supports ${lo.toFixed(2)}..${hi.toFixed(2)}`);
  }
});

test("nothing is brought for a figure the surface, a partner or its own arms hold up", () => {
  // Lying down, kneeling, standing and astride a partner are held already. A
  // wheelbarrow's face-down trunk is held off the floor by its arms, so a
  // wedge is not pushed under its chest.
  for (const id of ["missionary", "kneeling-missionary", "cowgirl", "standing-missionary", "back-lift", "clip"])
    assert.deepEqual(supportProps(solve(id)), [], id);
});

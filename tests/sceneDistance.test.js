import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lookalikes, poseDifference, poseSignature, VISIBLE } from "../scripts/scene-distance.mjs";
import { placementFromRoot, rootFromPlacement } from "../src/core/placement.js";
import { quatFromEulerXYZ, quatMultiply, quatRotate } from "../src/core/math.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const pack = JSON.parse(read("public/catalog/interaction-studies-v1.json"));
const manifest = JSON.parse(read("src/data/interaction-manifest.json"));
const scene = (id) => structuredClone(pack.studies.find((s) => s.sourceId === id).scene);
const difference = (p, q) => poseDifference(poseSignature(p), poseSignature(q));

test("a scene moved or turned about the room, or dressed differently, is the same picture", () => {
  const base = scene("img-0001");
  const moved = structuredClone(base);
  const yaw = quatFromEulerXYZ(0, (70 * Math.PI) / 180, 0);
  for (const actor of moved.actors) {
    const root = rootFromPlacement(actor.placement);
    actor.placement = placementFromRoot({ position: quatRotate(yaw, root.position).map((v, k) => v + [1.2, 0, -0.4][k]), quaternion: quatMultiply(yaw, root.quaternion) });
    actor.outfit = "sage";
  }
  assert.ok(difference(base, moved).difference < 0.01, JSON.stringify(difference(base, moved)));
});

test("the smallest visible bend, spine curve or step apart reads as a different picture", () => {
  const base = scene("img-0001");
  const knee = structuredClone(base);
  knee.actors[1].joints.knee_l.flexion += VISIBLE.joint;
  assert.deepEqual(difference(base, knee), { difference: 1, by: "actor 1 knee_l.flexion" });
  // The spine bends as one: a third of the angle at each of its three joints.
  const spine = structuredClone(base);
  for (const bone of ["spine01", "spine02", "spine03"]) spine.actors[0].joints[bone].flexion += VISIBLE.joint / 3;
  const curved = difference(base, spine);
  assert.equal(curved.by, "actor 0 spine.flexion");
  assert.ok(Math.abs(curved.difference - 1) < 1e-9);
  const apart = structuredClone(base);
  apart.actors[1].placement.position[0] += VISIBLE.offset;
  const stepped = difference(base, apart);
  assert.equal(stepped.by, "actor 1 offset");
  assert.ok(Math.abs(stepped.difference - 1) < 1e-6);
});

test("a different support or number of people is never the same picture", () => {
  const base = scene("img-0001");
  assert.deepEqual(difference(base, { ...base, support: { surface: "bed" } }), { difference: Infinity, by: "surface" });
  assert.deepEqual(difference(base, { ...base, actors: base.actors.slice(0, 1) }), { difference: Infinity, by: "people" });
});

test("every position in the catalog looks different from every other", () => {
  const pairs = lookalikes(pack.studies.map((s) => ({ id: s.sourceId, scene: s.scene })));
  assert.deepEqual(
    pairs.map((p) => `${p.a} ≈ ${p.b} (${p.difference.toFixed(2)}, ${p.by})`),
    [],
  );
  assert.equal(manifest.distinctScenes, manifest.records);
});

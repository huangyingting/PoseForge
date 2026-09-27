import test from "node:test";
import assert from "node:assert/strict";
import { bodyDistance, bodyField, bodyNormal, buildBodyVolumes, fieldNormal, poseVolumes } from "../src/core/body.js";
import { Skeleton, evaluatePose } from "../src/core/skeleton.js";
import { fieldOcclusion } from "../src/render/meshBuilder.js";
import { occludeParts } from "../src/workers/occlusionPool.js";

// Pseudo-random, so a failure names the same point every run.
const random = (() => {
  let seed = 7;
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
})();

function posedVolumes(bodyType) {
  const skeleton = new Skeleton({ bodyType, build: 1 });
  const evaluated = evaluatePose(skeleton, {
    root: { position: [0, 0.9, 0], quaternion: [0, 0, 0, 1] },
    joints: skeleton.restPose(),
  });
  return poseVolumes(skeleton, evaluated, buildBodyVolumes(skeleton, {}), 0);
}

test("a compiled field is the body's distance and gradient to the last bit", () => {
  // It stands in for `bodyDistance` in meshing, occlusion and the feature
  // relief, and those are only unchanged if every answer is the same number.
  for (const bodyType of ["female", "male"]) {
    const all = posedVolumes(bodyType);
    for (const volumes of [all, all.slice(4, 11), [all[0]]]) {
      const field = bodyField(volumes);
      for (let i = 0; i < 3000; i += 1) {
        const p = [random() - 0.5, random() * 1.9, random() - 0.5];
        assert.ok(Object.is(field(...p), bodyDistance(p, volumes)), `${bodyType} at ${p}`);
        if (i % 10 === 0) assert.deepEqual(fieldNormal(field, p), bodyNormal(p, volumes));
      }
    }
  }
});

test("occlusion shared out in runs is the occlusion of the whole mesh", () => {
  const volumes = [...posedVolumes("female"), ...posedVolumes("male").map((v) => ({ ...v, a: [v.a[0] + 0.3, v.a[1], v.a[2]], b: [v.b[0] + 0.3, v.b[1], v.b[2]] }))];
  // More vertices than a run holds, so the pieces have to be put back in place.
  const part = (count) => {
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    for (let v = 0; v < count; v += 1) {
      positions.set([random() - 0.4, random() * 1.8, random() * 0.6 - 0.3], v * 3);
      const n = [random() - 0.5, random() - 0.5, random() - 0.5];
      const length = Math.hypot(...n);
      normals.set(n.map((value) => value / length), v * 3);
    }
    return { positions, normals };
  };
  const parts = [part(40000), part(900)];
  return occludeParts(parts, volumes, 0.012).then((shaded) => {
    parts.forEach((p, i) => assert.deepEqual(shaded[i], fieldOcclusion(p.positions, p.normals, volumes, 0.012)));
    return occludeParts(parts, volumes, 0.012, () => true).then((given) => assert.equal(given, null));
  });
});

/**
 * Drawn-surface validator.
 *
 * The field is what collides; the scanned mesh is what you see. Nothing forces
 * them to agree, so this measures the disagreement and reports it as numbers.
 *
 * Two questions, because they fail differently:
 *
 *   1. **Does the drawn body sit where the collided one does?** A systematic
 *      gap means the solver is placing contacts against a surface the picture
 *      does not have. Reported per region, since the answer is not uniform:
 *      these models are leaner than the anthropometric field through the limbs
 *      and close to it through the trunk.
 *
 *   2. **Does the drawn body carry the features the field carries?** The bust
 *      and the genitals are built into the field on every body type, and the
 *      scanned bodies have a small chest and no genitals at all. `featureRelief`
 *      is what closes that, and this measures whether it did - protrusion of the
 *      drawn surface above the surrounding body, against the same measurement
 *      taken on the field.
 *
 *   3. **Is the painted areola on the field's bust?** The relief moves the
 *      drawn chest onto the field's bust wherever the scan's own breast was, so
 *      a scan whose nipple sits off the bust's centre shows it off-centre on
 *      every figure. Found as the darkest skin, through the model's UVs, on the
 *      front of the right-hand chest.
 *
 * Every body type is measured in every model (`src/core/bodyModels.js`).
 *
 * Run with `node scripts/validate-skin.mjs [model ...]`.
 */

import { readFileSync } from "node:fs";
import { bodyDistance, buildBodyVolumes, poseVolumes } from "../src/core/body.js";
import { buildHumanTemplate, featureRelief, skinHumanMesh } from "../src/core/humanMesh.js";
import { HIP_HEIGHT_RATIO, Skeleton, evaluatePose } from "../src/core/skeleton.js";
import { BODY_MODEL_NAMES, modelFiles } from "../src/core/bodyModels.js";
import { decodePNG, sampleAtlas } from "./atlas.mjs";

const mm = (v) => `${(v * 1000).toFixed(1)}mm`.padStart(8);
const pct = (v) => `${(v * 100).toFixed(1)}%`.padStart(6);

function load(bodyType, model) {
  const file = new URL(`../assets/models/realistic-${modelFiles(bodyType, model).mesh}.glb`, import.meta.url);
  const bytes = readFileSync(file);
  return buildHumanTemplate(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

const atlases = new Map();
function atlas(bodyType, model) {
  const name = modelFiles(bodyType, model).atlas;
  if (!atlases.has(name)) atlases.set(name, decodePNG(readFileSync(new URL(`../assets/models/skin-${name}.png`, import.meta.url))));
  return atlases.get(name);
}

/**
 * The painted areola's centre on the drawn body, in the XY plane.
 *
 * The darkest forty vertices of the front of the right-hand chest, by the
 * atlas under their UVs. Forty is about how many fall inside the areola on
 * these meshes, and taking a count rather than a threshold keeps the answer the
 * same on a dark skin as on a light one.
 */
function areola(positions, uvs, image, H) {
  const found = [];
  for (let v = 0; v < positions.length / 3; v += 1) {
    const [x, y, z] = [positions[v * 3] / H, positions[v * 3 + 1] / H, positions[v * 3 + 2] / H];
    if (x < 0.025 || x > 0.1 || y < 0.68 || y > 0.79 || z < 0.03) continue;
    const [r, g, b] = sampleAtlas(image, uvs[v * 2], uvs[v * 2 + 1]);
    found.push({ x: positions[v * 3], y: positions[v * 3 + 1], lum: 0.2126 * r + 0.7152 * g + 0.0722 * b });
  }
  const darkest = found.sort((a, b) => a.lum - b.lum).slice(0, 40);
  return [darkest.reduce((sum, p) => sum + p.x, 0) / darkest.length, darkest.reduce((sum, p) => sum + p.y, 0) / darkest.length];
}

/**
 * Furthest the surface reaches along +Z inside a cylinder about `axis`.
 *
 * A protrusion has to be measured against something. `baseline` is the same
 * probe with the feature volumes dropped from the field, so what is reported is
 * the height of the feature above the body it sits on rather than its distance
 * from the origin - which is the only version of the number that is comparable
 * between a field and a mesh that disagree about girth by centimetres anyway.
 */
function reachOnMesh(positions, centre, radius) {
  let furthest = -Infinity;
  for (let v = 0; v < positions.length; v += 3) {
    const dx = positions[v] - centre[0];
    const dy = positions[v + 1] - centre[1];
    if (Math.hypot(dx, dy) > radius) continue;
    if (positions[v + 2] > furthest) furthest = positions[v + 2];
  }
  return Number.isFinite(furthest) ? furthest : NaN;
}

function reachOnField(volumes, centre, from = 0) {
  let z = from;
  for (let step = 0; step < 4000; step += 1, z += 0.0005) {
    if (bodyDistance([centre[0], centre[1], z], volumes) > 0) return z;
  }
  return NaN;
}

/**
 * Every skin part's positions in one array. A part with a `colour` and no
 * `primary` flag is trim - the eyes - and is the one thing here that is not
 * flesh; everything else, scan or added, is the drawn body.
 */
function skinAll(template, skeleton, evaluated) {
  const parts = skinHumanMesh(template, skeleton, evaluated).filter((p) => p.primary || !p.colour);
  const total = parts.reduce((n, p) => n + p.positions.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part.positions, at);
    at += part.positions.length;
  }
  return out;
}

let failures = 0;

const models = process.argv.slice(2).length ? process.argv.slice(2) : BODY_MODEL_NAMES;
for (const model of models) if (!BODY_MODEL_NAMES.includes(model)) throw new Error(`no body model "${model}"`);

for (const model of models) for (const bodyType of ["female", "male", "neutral"]) {
  const skeleton = new Skeleton({ bodyType });
  const H = skeleton.stature;
  const evaluated = evaluatePose(skeleton, {
    root: { position: [0, H * HIP_HEIGHT_RATIO, 0], quaternion: [0, 0, 0, 1] },
    joints: skeleton.restPose(),
  });
  const all = poseVolumes(skeleton, evaluated, buildBodyVolumes(skeleton, {}), 0);
  const frame = all.filter((volume) => !volume.feature);

  const plain = load(bodyType, model);
  const relieved = featureRelief(plain, { bodyType });
  // Everything the viewer reads as flesh, which after `featureRelief` is the
  // scan *plus* whatever it had to add. Measuring only the primary part would
  // report the added genitals as missing.
  const before = skinAll(plain, skeleton, evaluated);
  const after = skinAll(relieved, skeleton, evaluated);

  console.log(`\n=== ${bodyType}, ${model} (${H}m, realistic-${modelFiles(bodyType, model).mesh}.glb) ===`);
  console.log(
    `relief: ${relieved.relief.moved} vertices moved, ` +
      `mean ${mm(relieved.relief.mean).trim()}, worst ${mm(relieved.relief.worst).trim()}` +
      `, ${relieved.relief.added} part(s) added`
  );

  // --- 1. where the drawn surface sits relative to the field ---------------
  const regions = {
    trunk: (p) => p[1] > 0.55 * H && p[1] < 0.80 * H,
    pelvis: (p) => p[1] > 0.46 * H && p[1] <= 0.55 * H,
    limbs: (p) => p[1] <= 0.46 * H,
    head: (p) => p[1] >= 0.80 * H,
  };
  for (const [name, test] of Object.entries(regions)) {
    const gaps = [];
    for (let v = 0; v < after.length; v += 3) {
      const p = [after[v], after[v + 1], after[v + 2]];
      if (test(p)) gaps.push(bodyDistance(p, all));
    }
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    const outside = gaps.filter((g) => g > 0).length / gaps.length;
    console.log(
      `  ${name.padEnd(7)} n=${String(gaps.length).padStart(6)}  median${mm(median)}` +
        `  p10${mm(gaps[Math.floor(gaps.length * 0.1)])}  p90${mm(gaps[Math.floor(gaps.length * 0.9)])}` +
        `  outside the field ${pct(outside)}`
    );
  }

  // --- 2. do the features show on the drawn surface ------------------------
  // Probe axes are the feature volumes' own centres, read off the field rather
  // than restated here, so this cannot drift out of step with `body.js`.
  const probes = [];
  const bust = all.find((v) => v.feature && v.bone === "spine03" && v.a[0] > 0);
  if (bust) probes.push({ name: "bust", centre: [bust.a[0], bust.a[1]], radius: 0.030 });
  const crotch = all.filter((v) => v.feature && v.bone === "pelvis");
  if (crotch.length) {
    const lowest = crotch.reduce((a, b) => (Math.min(a.a[1], a.b[1]) < Math.min(b.a[1], b.b[1]) ? a : b));
    probes.push({ name: "genitals", centre: [0, (lowest.a[1] + lowest.b[1]) / 2], radius: 0.022 });
  }

  for (const probe of probes) {
    const fieldWith = reachOnField(all, probe.centre);
    const fieldWithout = reachOnField(frame, probe.centre);
    const meshBefore = reachOnMesh(before, probe.centre, probe.radius);
    const meshAfter = reachOnMesh(after, probe.centre, probe.radius);
    const wanted = fieldWith - fieldWithout;
    const got = meshAfter - meshBefore;
    // The drawn feature is allowed to be shallower than the field's, because
    // the mesh it grows out of is not the field's frame - but not by half.
    const ok = wanted < 0.004 || got >= wanted * 0.5;
    if (!ok) failures += 1;
    console.log(
      `  ${probe.name.padEnd(9)} field protrudes${mm(wanted)}   drawn gains${mm(got)}` +
        `   (${meshBefore === meshAfter ? "unchanged" : `${mm(meshBefore).trim()} -> ${mm(meshAfter).trim()}`})` +
        `  ${ok ? "ok" : "TOO SHALLOW"}`
    );
  }

  // --- 3. is the painted areola on the field's bust -------------------------
  // Measured on the scan before relief: relief moves the chest along its own
  // normals, so where the paint is in the plane is where the scan put it.
  // The nipple is the one bust volume that stands proud of the others.
  const nipple = all
    .filter((v) => v.feature && v.bone === "spine03" && v.a[0] > 0)
    .reduce((a, b) => (a && a.a[2] >= b.a[2] ? a : b), null);
  if (nipple) {
    const [primary] = skinHumanMesh(plain, skeleton, evaluated).filter((p) => p.primary);
    const [x, y] = areola(primary.positions, plain.submeshes.find((part) => part.primary).uvs, atlas(bodyType, model), H);
    const off = Math.hypot(x - nipple.a[0], y - nipple.a[1]);
    // The default female, which the bust is fitted to, measures 1.8 mm.
    const ok = off <= 0.005;
    if (!ok) failures += 1;
    console.log(
      `  areola    painted at (${mm(x).trim()}, ${mm(y).trim()})  field nipple (${mm(nipple.a[0]).trim()}, ${mm(nipple.a[1]).trim()})` +
        `  off by${mm(off)}  ${ok ? "ok" : "OFF THE BUST"}`
    );
  }
}

console.log(failures ? `\n${failures} feature(s) not carried onto the drawn body` : "\nall features carried onto the drawn body, every areola on its bust");
process.exit(failures ? 1 : 0);

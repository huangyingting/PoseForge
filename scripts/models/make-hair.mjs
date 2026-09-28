/**
 * Regenerate the hair, eyebrow and eyelash cards in assets/models/hair.
 *
 *   node scripts/models/make-hair.mjs [body ...] [--out dir]
 *
 * For every body in bodies.json, MakeHuman builds the body exactly as
 * make-bodies.mjs does and then, instead of exporting it, fits each trim below
 * to it and writes the result out (`trim` in makehuman_body.py). The fitting is
 * MakeHuman's own and has to happen there: a proxy's vertices are placed off
 * the base mesh's helper geometry, which no exported body carries.
 *
 * What comes back is in MakeHuman's coordinates. The body's own visible
 * vertices come back with it, and the GLB this body was exported as is the
 * same vertices in the template's bind space, so the transform between the two
 * is read off them - a uniform scale by the body's height and a lift by its
 * lowest point, which is all `buildHumanTemplate` does - and then checked
 * vertex for vertex. A body whose GLB was made from different parameters fails
 * that check instead of shipping hair fitted to some other skull.
 *
 * MakeHuman's quads become triangles, and its vertices are split wherever one
 * carries two UVs, which a card's corners often do. The weights keep
 * MakeHuman's bones but not all of them: hair that reaches the shoulders is
 * weighted partly to the upper arms, and long hair partly to the thighs, which
 * in MakeHuman's standing pose is harmless and in a figure lifting an arm or
 * sitting down is a lock of hair lifting with the arm or folding with the leg.
 * Those move to the clavicle and the pelvis, which is where hair lying on a
 * shoulder or down a back actually rests.
 *
 * Writes cards.bin, cards-<body>.bin for each body (see src/core/hairCards.js)
 * and <trim>.png for each trim (see card_textures.py). Naming bodies writes
 * only theirs, and only if cards.bin already describes the same trims.
 *
 * Needs what make-bodies.mjs needs to run MakeHuman, plus a Python with numpy
 * and Pillow for the textures (CARD_PYTHON, default python3).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CARD_BOX, packCards, readCards } from "../../src/core/hairCards.js";
import { bodies, calibrate, corners, fit, MAKEHUMAN, run } from "./makehuman.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const [, value] = args.splice(at, 2);
  return value;
};
const out = resolve(option("out", join(here, "../../assets/models/hair")));
const CARD_PYTHON = process.env.CARD_PYTHON ?? "python3";

/**
 * The trims: MakeHuman's name, its proxy type, and the texture size to ship.
 *
 * Every hairstyle MakeHuman has, at half its 2048px: a head is rarely more
 * than a few hundred pixels tall in the viewport, and 1024 is already two
 * texels per strand width. The brows and lashes are the pair each body type
 * wears, not all sixteen, and keep their own 512.
 */
const TRIMS = [
  ...["afro01", "bob01", "bob02", "braid01", "long01", "ponytail01", "short01", "short02", "short03", "short04"].map(
    (name) => ({ name, kind: "Hair", folder: `hair/${name}`, size: 1024 }),
  ),
  ...["eyebrow009", "eyebrow010"].map((name) => ({ name, kind: "Eyebrows", folder: `eyebrows/${name}`, size: 512 })),
  ...["eyelashes01", "eyelashes02"].map((name) => ({ name, kind: "Eyelashes", folder: `eyelashes/${name}`, size: 512 })),
];

/** Where a bone's share of a card goes instead; see the note at the top. */
const REST_ON = { upperarm_l: "clavicle_l", upperarm_r: "clavicle_r", thigh_l: "pelvis", thigh_r: "pelvis" };

const names = args.length ? args : Object.keys(bodies);
for (const name of names) if (!bodies[name]) throw new Error(`no body "${name}" in bodies.json`);

/** MakeHuman's fit of every trim to one body, as the plugin wrote it. */
function fitTrims(name, work) {
  const output = join(work, `${name}.json`);
  const request = { proxies: TRIMS.map(({ name, kind, folder }) => [name, kind, `${folder}/${name}.mhpxy`]), output };
  return fit(name, work, { POSEFORGE_TRIM: JSON.stringify(request) }, output);
}

/** The shared half of one trim: triangles, UVs, weights, and the vertex split. */
function topology(trim) {
  const { split, uvs, triangles } = corners(trim);

  const influences = Array.from({ length: trim.coords.length }, () => new Map());
  for (const [bone, [vertices, values]] of Object.entries(trim.weights)) {
    const to = REST_ON[bone] ?? bone;
    vertices.forEach((vertex, i) => influences[vertex].set(to, (influences[vertex].get(to) ?? 0) + values[i]));
  }
  const bones = [...new Set(influences.flatMap((map) => [...map.keys()]))].sort();
  const boneIndex = new Map(bones.map((bone, i) => [bone, i]));
  const joints = new Uint8Array(split.length * 4);
  const weights = new Uint8Array(split.length * 4);
  split.forEach((vertex, v) => {
    const top = [...influences[vertex]].sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (!top.length) throw new Error(`vertex ${vertex} has no weights`);
    const total = top.reduce((sum, [, w]) => sum + w, 0);
    const bytes = top.map(([, w]) => Math.round((w / total) * 255));
    // Exactly 255 between them, the rounding error on the largest.
    bytes[0] += 255 - bytes.reduce((sum, b) => sum + b, 0);
    top.forEach(([bone], k) => {
      joints[v * 4 + k] = boneIndex.get(bone);
      weights[v * 4 + k] = bytes[k];
    });
  });

  return {
    split,
    bones,
    indices: split.length < 65536 ? Uint16Array.from(triangles) : Uint32Array.from(triangles),
    uvs: Uint16Array.from(uvs, (value) => Math.round(Math.min(1, Math.max(0, value)) * 65535)),
    joints,
    weights,
  };
}

/** One body's copy of a trim, quantised into `CARD_BOX`. */
function placed(trim, split, toTemplate) {
  const positions = new Int16Array(split.length * 3);
  split.forEach((vertex, v) => {
    const p = toTemplate(trim.coords[vertex]);
    for (let axis = 0; axis < 3; axis += 1) {
      const t = (p[axis] - CARD_BOX.min[axis]) / (CARD_BOX.max[axis] - CARD_BOX.min[axis]);
      if (!(t >= 0 && t <= 1)) throw new Error(`a vertex sits outside CARD_BOX on axis ${axis}`);
      positions[v * 3 + axis] = Math.round(t * 65534 - 32767);
    }
  });
  return positions;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

mkdirSync(out, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "poseforge-hair-"));
try {
  let shared = null;
  let reference = null;
  const partial = names.length !== Object.keys(bodies).length;
  if (partial) {
    shared = readCards(readFileSync(join(out, "cards.bin")));
    if (!same(Object.keys(shared.meta.trims), TRIMS.map(({ name }) => name)))
      throw new Error("cards.bin describes other trims; regenerate every body");
  }

  for (const name of names) {
    const started = Date.now();
    const fitted = fitTrims(name, join(work, name));
    const { toTemplate, worst } = calibrate(name, fitted.body);

    // The topology is the first body's and every later one must match it -
    // MakeHuman moves a proxy's vertices per body and nothing else, and the
    // shared file relies on exactly that.
    if (!reference) {
      reference = {};
      for (const { name: trim } of TRIMS) {
        const source = fitted.proxies[trim];
        reference[trim] = { faces: source.faces, faceUVs: source.faceUVs, uvs: source.uvs, weights: source.weights, ...topology(source) };
      }
    }
    const arrays = {};
    const counts = {};
    for (const { name: trim } of TRIMS) {
      const source = fitted.proxies[trim];
      const shape = reference[trim];
      if (!same(source.faces, shape.faces) || !same(source.faceUVs, shape.faceUVs))
        throw new Error(`${trim} on ${name} is not the same mesh as on the first body`);
      if (shared && shared.meta.trims[trim].vertices !== shape.split.length)
        throw new Error(`${trim} on ${name} splits differently from cards.bin; regenerate every body`);
      arrays[`${trim}.positions`] = placed(source, shape.split, toTemplate);
      counts[trim] = shape.split.length;
    }
    const file = join(out, `cards-${name}.bin`);
    writeFileSync(file, packCards({ body: name, trims: counts }, arrays));
    console.log(`${name}: fitted in ${((Date.now() - started) / 1000).toFixed(0)}s, body within ${(worst * 1720 * 1000).toFixed(2)}um of its GLB`);
  }

  if (!partial) {
    const jobs = TRIMS.map(({ name, folder, size }) => {
      const material = readFileSync(join(MAKEHUMAN, "data", folder, `${name}.mhmat`), "utf8");
      const texture = material.match(/^diffuseTexture\s+(\S+)/m)[1];
      return { source: resolve(join(MAKEHUMAN, "data", folder), texture), target: join(out, `${name}.png`), size };
    });
    const converted = run(CARD_PYTHON, [join(here, "card_textures.py"), JSON.stringify(jobs)], { timeout: 600_000 }, "card_textures.py");
    if (converted.status !== 0) throw new Error(`card_textures.py failed:\n${converted.stderr.slice(-4000)}`);
    const gains = JSON.parse(converted.stdout);

    const trims = {};
    const arrays = {};
    for (const { name, kind } of TRIMS) {
      const shape = reference[name];
      trims[name] = {
        kind: kind.toLowerCase(),
        vertices: shape.split.length,
        triangles: shape.indices.length / 3,
        bones: shape.bones,
        texture: name,
        gain: Number(gains[join(out, `${name}.png`)].toFixed(4)),
      };
      arrays[`${name}.indices`] = shape.indices;
      arrays[`${name}.uvs`] = shape.uvs;
      arrays[`${name}.joints`] = shape.joints;
      arrays[`${name}.weights`] = shape.weights;
    }
    writeFileSync(join(out, "cards.bin"), packCards({ trims }, arrays));
    for (const [name, trim] of Object.entries(trims))
      console.log(`${name}: ${trim.vertices} vertices, ${trim.triangles} triangles, gain ${trim.gain}, bones ${trim.bones.join(" ")}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

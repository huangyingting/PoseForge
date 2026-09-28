/**
 * Headless render.
 *
 * A browser is the wrong place to check whether the renderer is right. Pulling
 * up a page, typing a sentence and squinting at it does not tell you whether
 * last week's version looked the same, and it cannot run in a test. So this
 * draws the same scene without a GPU: a z-buffered software rasteriser, a
 * shadow map, and a PNG encoder built on node's own zlib.
 *
 * It is deliberately a second implementation of the shading rather than a
 * shared one. The WebGL material is a patch into three's standard shader and
 * cannot be lifted out of it; trying to share code with this would mean
 * reimplementing three's lighting in JavaScript, and the result would agree
 * with the real renderer only by coincidence. What this is for is the part that
 * a second implementation checks well - that the geometry is where it should
 * be, that the figures are the right way round, that nothing is inside the
 * mattress - and for that, a picture that is merely similar is enough.
 *
 *   node scripts/render-cli.mjs "missionary on the bed"
 *   node scripts/render-cli.mjs "spooning" --view top --out top.png
 *   node scripts/render-cli.mjs "cowgirl" --svg
 */

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { parseDescription } from "../src/nlp/parser.js";
import { validateScene } from "../src/core/scene.js";
import { BUILTIN_PRESETS, parseCatalog } from '../src/core/catalog.js';
import { solveScene } from "../src/core/solver.js";
import { refineSurfaceContacts } from '../src/core/surfaceContacts.js';
import { bindCorrections, buildHumanTemplate, featureRelief, skinHumanMesh } from "../src/core/humanMesh.js";
import { withHair } from "../src/core/hair.js";
import { withGarments } from "../src/core/garments.js";
import { LACE_REPEAT, LACE_SIZE, lacePattern } from "../src/core/lace.js";
import { buildBodyMesh, fieldOcclusion } from "../src/render/meshBuilder.js";
import {
  mat4InvertRigid,
  mat4LookAt,
  mat4Multiply,
  mat4Orthographic,
  mat4Perspective,
  v3normalize,
} from "../src/core/math.js";
import { propShape, propTriangles } from "../src/core/propShapes.js";
import { modelFiles } from "../src/core/bodyModels.js";
import { decodePNG, sampleAtlas } from "./atlas.mjs";
import { cardTexture, withBodyCards, withBodyFaces } from "./cards.mjs";
import { inMouth, withExpression } from "../src/core/faces.js";

/* ------------------------------------------------------------------ */
/* Arguments                                                           */
/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
// Flags take a value, except the ones listed as switches. Splitting them
// explicitly is what stops `--svg "missionary"` from eating the description.
const SWITCHES = new Set(["svg", "quiet"]);
const options = new Map();
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith("--")) {
    positional.push(arg);
    continue;
  }
  const name = arg.slice(2);
  if (SWITCHES.has(name)) options.set(name, true);
  else options.set(name, argv[++i]);
}
const flag = (name, fallback) => options.get(name) ?? fallback;
const has = (name) => options.has(name);

const text =
  positional[0] ?? "she is lying on her back on the bed, he is kneeling between her legs";

// A scene file bypasses the parser entirely. The reference corpus names its
// poses in the pose library's own vocabulary rather than in English, so
// round-tripping them through a sentence would measure the parser instead of
// the thing being checked - and there is no sentence for most of them anyway.
const SCENE_FILE = flag("scene", null);

const WIDTH = Number(flag("width", 900));
const HEIGHT = Number(flag("height", 640));
const RESOLUTION = Number(flag("res", 12)) / 1000;
const OUT = flag("out", "pose.png");
// Supersampling, not a smarter edge rule. Everything in the picture is an
// interpenetrating curved surface, and the cases where a coverage heuristic
// goes wrong - a silhouette crossing another silhouette at a shallow angle -
// are exactly the cases this scene is made of.
const SS = Math.max(1, Math.min(3, Number(flag("aa", 2))));

const VIEWS = {
  front: [0, 0.18, 1],
  side: [1, 0.18, 0],
  top: [0.001, 1, 0.001],
  three_quarter: [0.75, 0.42, 1],
};
// `--view x,y,z` as well as a name. Four fixed cameras are the right set for
// looking at a pose; they are the wrong set for looking at a *part*, because
// anything between the thighs is occluded from all four and the one that is
// not - `top`, on a supine figure - sees it edge-on. This is the same argument
// `--at` and `--span` are already here for.

// The first two of `SKIN` in `src/render/renderer.js`, in the 0..1 the shader
// here wants. East Asian rather than northern European: green within a dozen
// levels of red instead of thirty, and blue well down, which is an olive
// undertone rather than a pink one. Keep these in step with that file - the
// export has to look like the viewport.
const SKIN = [
  [0.910, 0.788, 0.643],
  [0.851, 0.694, 0.514],
];
const PROP_COLOUR = {
  bed: [0.91, 0.89, 0.85],
  "bed-frame": [0.43, 0.36, 0.29],
  sofa: [0.55, 0.6, 0.65],
  "sofa-back": [0.49, 0.54, 0.59],
  chair: [0.6, 0.52, 0.44],
  "chair-back": [0.6, 0.52, 0.44],
  table: [0.71, 0.63, 0.52],
  "table-leg": [0.61, 0.54, 0.44],
  bench: [0.66, 0.59, 0.5],
  ball: [0.79, 0.84, 0.86],
  wedge: [0.73, 0.64, 0.55],
  ottoman: [0.56, 0.55, 0.53],
  wall: [0.9, 0.88, 0.85],
  "car-seat": [0.36, 0.37, 0.4],
  "car-seat-back": [0.33, 0.34, 0.37],
  "car-roof": [0.62, 0.71, 0.76],
  "car-door": [0.62, 0.71, 0.76],
  "car-glass": [0.62, 0.71, 0.76],
  "car-front-seat": [0.33, 0.34, 0.37],
  "swing-seat": [0.25, 0.5, 0.53],
  "swing-strap": [0.29, 0.56, 0.58],
  "swing-bar": [0.55, 0.56, 0.59],
  "swing-chain": [0.49, 0.51, 0.53],
  sling: [0.23, 0.23, 0.24],
  "sling-chain": [0.49, 0.51, 0.53],
  "sling-bar": [0.55, 0.56, 0.59],
  pole: [0.79, 0.69, 0.54],
  stair: [0.69, 0.6, 0.5],
  pillow: [0.94, 0.89, 0.8],
  "spreader-bar": [0.55, 0.56, 0.59],
  chain: [0.49, 0.51, 0.53],
};
// A car's shell is drawn see-through, over everything else; see the pass below.
const SHELL_OPACITY = { "car-front-seat": 0.22, default: 0.12 };
const GROUND_COLOUR = [0.85, 0.83, 0.8];

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

function sceneInput() {
  const reference = flag('preset', null);
  if (has('preset') && !reference) throw new Error('--preset needs a preset ID.');
  if (has('scene') && !SCENE_FILE) throw new Error('--scene needs a JSON file.');
  if (SCENE_FILE) {
    const source = readFileSync(SCENE_FILE, 'utf8');
    const value = JSON.parse(source);
    if (value?.format != null || value?.presets != null) {
      const presets = parseCatalog(source);
      const selected = reference ? presets.find(p => p.id === reference) : presets[0];
      if (!selected) throw new Error(`No preset named "${reference}" in this catalog.`);
      return { scene: selected.scene, warnings: presets.length > 1 && !reference ? [`Rendering the first preset: ${selected.title}. Use --preset ID to select another.`] : [] };
    }
    if (reference) throw new Error('--preset selects an entry in a catalog; a raw scene has no preset IDs.');
    const checked = validateScene(value);
    return { scene: checked.scene, warnings: checked.issues.map(issue => issue.message) };
  }
  if (reference) {
    const preset = BUILTIN_PRESETS.find(p => p.id === reference);
    if (!preset) throw new Error(`No built-in preset named "${reference}".`);
    return { scene: preset.scene, warnings: [] };
  }
  return parseDescription(text);
}
const parsed = sceneInput();
const savedView = parsed.scene.camera?.view;
const named = flag(
  "view",
  typeof savedView === "string" && Object.hasOwn(VIEWS, savedView)
    ? savedView
    : "three_quarter",
);
const VIEW = VIEWS[named] ??
  (named.includes(",") ? named.split(",").map(Number) : null) ??
  VIEWS.three_quarter;
const solved = solveScene(parsed.scene);

/**
 * A draw call: positions, normals, occlusion, indices and one flat colour.
 *
 * Bodies, furniture and the ground all reduce to this, which is why the
 * rasteriser below has no notion of what it is drawing. The alternative - a
 * separate path per kind of object - is how the shadow of a table ends up being
 * computed differently from the shadow of a person.
 */
const objects = [];

/**
 * Sheer draw calls - the stockings - kept apart from the rest, because they are
 * drawn after everything else and over it: they neither cast a shadow nor hide
 * the leg they are on, only tint it.
 */
const veils = [];

/**
 * How each finish of cloth takes the light, in the terms the hair's highlight
 * below is written in: `sheen` scales its two broad lobes and `gloss` adds a
 * tight third one, which is what makes leather and wet-look lycra read as a
 * surface with a coat on it rather than as a matt one. The viewport's
 * `garmentMaterial` is the same five, in three's terms.
 */
const FINISH = {
  cotton: { sheen: 0.35, gloss: 0 },
  lycra: { sheen: 0.7, gloss: 0.12 },
  lace: { sheen: 0.4, gloss: 0 },
  sheer: { sheen: 0.9, gloss: 0.06 },
  leather: { sheen: 0.4, gloss: 0.55 },
};

/**
 * Which body to draw: the scanned human mesh, or the distance field itself.
 *
 * `--body sdf` is not a fallback, it is the diagnostic. The field is what
 * collides, so when a figure is drawn intersecting a mattress the first
 * question is whether the *field* intersects it, and the only way to see that
 * is to draw the field. Keeping both paths in one renderer, sharing a camera
 * and lighting, is what makes the two pictures comparable.
 */
const BODY = flag("body", "skin");

const MODELS = new URL("../assets/models/", import.meta.url);
const templates = new Map();
const scanned = (bodyType, model) => {
  const { mesh } = modelFiles(bodyType, model);
  const file = `realistic-${mesh}.glb`;
  if (!templates.has(file))
    templates.set(file, withBodyFaces(withBodyCards(buildHumanTemplate(readFileSync(new URL(file, MODELS))), mesh), mesh));
  return templates.get(file);
};

/**
 * The skin atlases that ship with the scans.
 *
 * Same files, same UVs and the same argument as in the viewport: these are the
 * diffuse maps the meshes were made for, they are nude photographic skin, and a
 * flat tone over a correct silhouette does not read as a body however good the
 * geometry is. `--texture off` turns them off, which is the only honest way to
 * see what the geometry alone is doing.
 */
const TEXTURED = flag("texture", "on") !== "off";
const atlases = new Map();
const skinAtlas = (bodyType, model) => {
  if (!TEXTURED) return null;
  const file = `skin-${modelFiles(bodyType, model).atlas}.png`;
  if (!atlases.has(file)) {
    try {
      atlases.set(file, decodePNG(readFileSync(new URL(file, MODELS))));
    } catch {
      // A missing or unreadable atlas is not worth failing a render over; the
      // flat tone is the picture this renderer drew before they existed.
      atlases.set(file, null);
    }
  }
  return atlases.get(file);
};

/**
 * The per-actor tone, weakened so it can multiply a photograph.
 *
 * `SKIN` is a set of finished skin colours, chosen to be read directly, and so
 * is the atlas; the product of two of those is neither. See the same constant
 * in `src/render/renderer.js` - the two renderers have to agree or the export
 * will not look like the viewport.
 */
const ATLAS_TINT = 0.65;
const tinted = (colour) => colour.map((c) => c + (1 - c) * ATLAS_TINT);

// The relief is cached apart from the scan and on a different key: two actors
// on the same GLB are the same parse but not the same body, because
// `featureRelief` reads the volumes `bust` and `build` produce. The hair goes on
// the same key rather than a later one - it is measured off the scalp, which
// relief never touches, but it is cheaper to cache one template than two. The
// face goes on last, as the viewport's cache puts it on, and for the same
// reason: it moves the skin the relief and the clothes were measured from.
const relieved = new Map();
const humanTemplate = (actor) => {
  const { bodyType, build } = actor.skeleton;
  const bust = actor.spec?.bust;
  const hair = actor.spec?.hair;
  const wearing = actor.spec?.wearing;
  const outfit = actor.spec?.outfit;
  const model = actor.spec?.model;
  const key = `${bodyType}|${model ?? ""}|${bust ?? ""}|${build ?? 1}|${hair ?? ""}|${(wearing ?? []).join(",")}|${outfit ?? ""}|${actor.face ?? ""}`;
  if (!relieved.has(key)) {
    const body = featureRelief(scanned(bodyType, model), { bodyType, bust, build: build ?? 1 });
    const dressed = withGarments(body, { bodyType, wearing, colour: outfit });
    relieved.set(key, withExpression(withHair(dressed, { bodyType, style: hair }), actor.face));
  }
  return relieved.get(key);
};

// Occlusion is sampled against every body in the scene rather than each figure
// against itself, so the crease where two people touch darkens on both of them.
if (BODY !== 'sdf') refineSurfaceContacts(solved, solved.actors.map(humanTemplate));
const allVolumes = solved.actors.flatMap((actor) => actor.volumes);

solved.actors.forEach((actor, index) => {
  if (BODY === "sdf") {
    const mesh = buildBodyMesh(actor.volumes, { resolution: RESOLUTION, ao: true });
    objects.push({
      positions: mesh.positions,
      normals: mesh.normals,
      occlusion: mesh.occlusion,
      indices: mesh.indices,
      colour: SKIN[index % SKIN.length],
      skin: true,
    });
    return;
  }

  const template = humanTemplate(actor);
  const atlas = skinAtlas(actor.skeleton.bodyType, actor.spec?.model);
  for (const part of skinHumanMesh(template, actor.skeleton, actor.evaluated, undefined, actor.hands, actor.hang)) {
    // ONLY=<regex> draws just the submeshes whose names match, and it is worth
    // the two lines. Anything small and concave on a body is unreadable in a
    // render of the whole body: the scrotum sits behind a shaft, between two
    // thighs, under an arm, and three successive close-ups of it produced three
    // different and two wrong readings of which silhouette was which. Drawn
    // alone - `ONLY=anatomy`, then again with one cone commented out - it took
    // one picture. A diagnostic that cheap belongs in the tool rather than in a
    // patch that has to be applied and then remembered and then reverted.
    if (process.env.ONLY && !new RegExp(process.env.ONLY).test(part.name)) continue;
    // Flesh takes the per-actor skin tone; trim keeps the colour it was
    // authored with. The scan's body part carries a baseColorFactor of its own,
    // so "is this flesh" is `primary` *or* the absence of a colour - which is
    // what marks the anatomy `featureRelief` adds.
    const flesh = part.primary || !part.colour;
    const textured = flesh && atlas && part.uvs;
    // Hair cards are cut out of their texture by its alpha, and drawn from
    // both sides because a strip of hair has two.
    const cards = part.cards && part.uvs ? { image: cardTexture(part.cards.texture), gain: part.cards.gain } : null;
    const finish = part.garment ? FINISH[part.finish] ?? FINISH.cotton : null;
    const lace = part.finish === "lace" && part.uvs;
    (part.finish === "sheer" ? veils : objects).push({
      positions: part.positions,
      normals: part.normals,
      // A part that brought its own occlusion keeps it. Only the eyes and the
      // inside of the mouth do, and only because the field has no socket and
      // no mouth in it to shade them with. Inside the mouth it is all the
      // light there is, so it dims everything (`dim`), as it does the skin
      // round it (`cavity`): a lip does not let the key in any more than the
      // sky.
      occlusion: part.mouth ? null : part.occlusion ?? fieldOcclusion(part.positions, part.normals, allVolumes, RESOLUTION),
      dim: part.mouth ? part.occlusion : part.cavity ? inMouth(new Float32Array(part.positions.length / 3).fill(1), part.cavity) : null,
      indices: part.indices,
      uvs: textured || cards || lace ? part.uvs : null,
      atlas: textured ? atlas : null,
      cards,
      lace,
      // Where a garment is worked solid - an edge, a strap, a waistband - and
      // what colour that is, if not the garment's own.
      trim: part.trim ?? null,
      trimColour: part.trimColour ?? null,
      colour: flesh ? (textured ? tinted(SKIN[index % SKIN.length]) : SKIN[index % SKIN.length]) : part.colour,
      skin: flesh,
      sheen: part.hair ? 1 : finish ? finish.sheen : 0,
      gloss: finish ? finish.gloss : 0,
    });
  }
});

/** A box as 12 triangles with flat normals. */
function boxObject(center, size, colour) {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size.map((s) => s / 2);
  const positions = [];
  const normals = [];
  const indices = [];
  const faces = [
    [[1, 0, 0], [[cx + sx, cy - sy, cz - sz], [cx + sx, cy - sy, cz + sz], [cx + sx, cy + sy, cz + sz], [cx + sx, cy + sy, cz - sz]]],
    [[-1, 0, 0], [[cx - sx, cy - sy, cz + sz], [cx - sx, cy - sy, cz - sz], [cx - sx, cy + sy, cz - sz], [cx - sx, cy + sy, cz + sz]]],
    [[0, 1, 0], [[cx - sx, cy + sy, cz - sz], [cx + sx, cy + sy, cz - sz], [cx + sx, cy + sy, cz + sz], [cx - sx, cy + sy, cz + sz]]],
    [[0, -1, 0], [[cx - sx, cy - sy, cz + sz], [cx + sx, cy - sy, cz + sz], [cx + sx, cy - sy, cz - sz], [cx - sx, cy - sy, cz - sz]]],
    [[0, 0, 1], [[cx - sx, cy - sy, cz + sz], [cx - sx, cy + sy, cz + sz], [cx + sx, cy + sy, cz + sz], [cx + sx, cy - sy, cz + sz]]],
    [[0, 0, -1], [[cx + sx, cy - sy, cz - sz], [cx + sx, cy + sy, cz - sz], [cx - sx, cy + sy, cz - sz], [cx - sx, cy - sy, cz - sz]]],
  ];
  for (const [normal, corners] of faces) {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      normals.push(...normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    occlusion: null,
    indices: Uint32Array.from(indices),
    colour,
  };
}

/** A ball or a wedge as the surface the solver collided with. */
function shapeObject(prop, colour) {
  const { positions, normals, indices } = propTriangles(prop);
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    occlusion: null,
    indices: Uint32Array.from(indices),
    colour,
  };
}

for (const prop of solved.props) {
  const colour = PROP_COLOUR[prop.kind] ?? [0.6, 0.6, 0.6];
  objects.push(propShape(prop) === "box" ? boxObject(prop.center, prop.size, colour) : shapeObject(prop, colour));
}

// The ground, as one big quad.
const R = 14;
objects.push({
  positions: Float32Array.from([-R, 0, -R, R, 0, -R, R, 0, R, -R, 0, R]),
  normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
  occlusion: null,
  indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  colour: GROUND_COLOUR,
  ground: true,
});

/**
 * Every colour in this file, and every base colour in the models, was picked by
 * eye - which means it was picked as the colour it should *look*, in sRGB. The
 * shading then multiplies it by light and hands it to `encode`, which tonemaps
 * and sRGB-encodes what it is given, so the whole pipeline downstream of here
 * is linear-light and an sRGB number dropped into it is a reflectance about a
 * third too high.
 *
 * On its own that is a figure lit slightly too brightly, which is easy to miss.
 * What is not easy to miss is what it does to the *hue*: the error is largest
 * in the channels that are already darkest, so it lifts blue and green towards
 * red, pushing the result up into the shoulder of the tonemap where the three
 * channels converge. Skin at 0.88/0.71/0.61 came out of the encoder as
 * 243/236/229 - a figure the colour of plaster, with the tan crushed out of it
 * by the same curve that was supposed to be protecting the highlights.
 *
 * One conversion, in one place, once per object rather than per pixel.
 */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
for (const object of [...objects, ...veils]) {
  object.colour = object.colour.map(toLinear);
  if (object.trimColour) object.trimColour = object.trimColour.map(toLinear);
}

/* ------------------------------------------------------------------ */
/* Framing                                                             */
/* ------------------------------------------------------------------ */

const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (const object of objects) {
  if (object.ground) continue;
  for (let v = 0; v < object.positions.length; v += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = object.positions[v + axis];
      if (value < bounds.min[axis]) bounds.min[axis] = value;
      if (value > bounds.max[axis]) bounds.max[axis] = value;
    }
  }
}
const focus = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2);
const extent = Math.max(...[0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis]), 0.5);

// Close-ups, for looking at one part of a body rather than at a scene.
//
// Whole-figure framing puts a bust or a set of genitals about forty pixels
// across, which is enough to see that something is there and not nearly enough
// to see whether it is the right shape. `--at` re-centres the camera and
// `--span` says how many metres to fit in frame: one number is a height, three
// are x,y,z in metres. So `--at 1.24 --span 0.42` is a chest and
// `--at 0.09,1.19,0.11 --span 0.18` is one breast.
const at = flag("at", null);
const span = Number(flag("span", 0));
if (at != null) {
  const parts = String(at).split(",").map(Number);
  if (parts.length === 1) focus[1] = parts[0];
  else for (let axis = 0; axis < Math.min(3, parts.length); axis += 1) focus[axis] = parts[axis];
}
const frameExtent = span > 0 ? span : extent;

const FOV = (38 * Math.PI) / 180;
const distance = (frameExtent * 0.62) / Math.tan(FOV / 2) + frameExtent * 0.5;
const direction = v3normalize(VIEW);
const eye = focus.map((c, axis) => c + direction[axis] * distance);

const NEAR = Math.max(0.05, distance - frameExtent * 1.5);
const FAR = distance + frameExtent * 4 + extent;
const view = mat4InvertRigid(mat4LookAt(eye, focus, Math.abs(direction[1]) > 0.95 ? [0, 0, -1] : [0, 1, 0]));
const projection = mat4Perspective(FOV, WIDTH / HEIGHT, NEAR, FAR);
const viewProjection = mat4Multiply(projection, view);

/* ------------------------------------------------------------------ */
/* Lighting                                                            */
/* ------------------------------------------------------------------ */

const KEY = v3normalize([2.4, 3.2, 2.0]);
const FILL = v3normalize([-3, 1.6, 1.4]);
const RIM = v3normalize([-1.2, 2.2, -3.2]);

// How far past the terminator the key wraps, per channel, and the exponents
// that warm its shadow's edge - skin's, then everything else's. See the shading
// below; skin's are `renderer.js`'s.
const SKIN_WRAP = [0.5, 0.4, 0.34];
const PLAIN_WRAP = [0.05, 0.05, 0.05];
const SKIN_PENUMBRA = [0.8, 1.05, 1.2];
const PLAIN_PENUMBRA = [1, 1, 1];

const SHADOW_SIZE = 2048;
// Sized to what is in frame, not to the scene.
//
// 2048 texels across a whole two-metre scene is 2.4mm each, which is under a
// pixel at full-body framing and invisible. Point `--at`/`--span` at a 220mm
// close-up and the same texel is five pixels wide: the soft shading under a
// breast comes out as a staircase of hard grey blocks, and it looks so much
// like torn geometry that it was chased through the mesher for a long time
// before it was recognised. It shows in an `--body sdf` render too, which is
// what finally gave it away - the field and the drawn mesh share no triangles
// and cannot share a mesh artefact, but they do share a light.
//
// The `+ 0.4` keeps the frustum wide enough to catch casters just outside the
// crop, since an ortho shadow needs the thing casting the shadow as well as the
// thing receiving it. At full-body framing `frameExtent` is `extent` and this
// is exactly what it was.
const shadowRadius = frameExtent * 1.15 + 0.4;
const shadowEye = focus.map((c, axis) => c + KEY[axis] * (extent * 2.5 + 2));
const shadowView = mat4InvertRigid(mat4LookAt(shadowEye, focus));
const shadowProjection = mat4Orthographic(
  -shadowRadius,
  shadowRadius,
  -shadowRadius,
  shadowRadius,
  0.05,
  extent * 5 + 6
);
const shadowMatrix = mat4Multiply(shadowProjection, shadowView);

/* ------------------------------------------------------------------ */
/* Rasteriser                                                          */
/* ------------------------------------------------------------------ */

/** Transform a point, keeping w so the interpolation can be perspective-correct. */
function clipSpace(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

/**
 * Scanline-fill every triangle, writing depth and calling back per surviving
 * fragment.
 *
 * Triangles that cross the near plane are dropped rather than clipped. Clipping
 * properly means splitting a triangle into two and re-deriving its attributes,
 * and the only geometry that can cross the near plane here is geometry behind
 * the camera - the camera is framed from the scene's own bounds and never ends
 * up inside anybody.
 */
/**
 * The alpha a card's texel needs to count as hair. A half, as the viewport's
 * alpha-to-coverage treats it; supersampling does the rest of what coverage
 * does there, which is to soften the cut into an edge.
 */
const CARD_CUTOFF = 0.5;

/**
 * The lace tile as a mip chain of coverage, and a 4x4 ordered dither to cut it
 * with.
 *
 * Lace is cut out where its thread is not, like a card - but the holes in it
 * are a couple of millimetres across, which in a whole-figure picture is under
 * a pixel, so a cut at one half of the full tile would be decided by which
 * thread each pixel centre happened to land on and the garment would come out
 * as noise. Each triangle reads the level of the chain whose texels are about
 * a pixel on screen, so at a distance what it reads is how much of the area is
 * thread, and the dither turns that fraction into the same fraction of pixels.
 * Supersampling does the rest, which is what the viewport's alpha to coverage
 * does with the same number.
 */
const LACE_LEVELS = (() => {
  let size = LACE_SIZE;
  let data = Float32Array.from(lacePattern(), (value) => value / 255);
  const levels = [{ size, data }];
  while (size > 1) {
    const half = size / 2;
    const next = new Float32Array(half * half);
    for (let y = 0; y < half; y += 1)
      for (let x = 0; x < half; x += 1)
        next[y * half + x] =
          (data[2 * y * size + 2 * x] + data[2 * y * size + 2 * x + 1] + data[(2 * y + 1) * size + 2 * x] + data[(2 * y + 1) * size + 2 * x + 1]) / 4;
    levels.push({ size: half, data: next });
    size = half;
    data = next;
  }
  return levels;
})();
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((value) => (value + 0.5) / 16);

function laceCoverage(u, v, level) {
  const { size, data } = LACE_LEVELS[Math.min(level, LACE_LEVELS.length - 1)];
  const x = ((Math.floor(u * LACE_REPEAT * size) % size) + size) % size;
  const y = ((Math.floor(v * LACE_REPEAT * size) % size) + size) % size;
  return data[y * size + x];
}

/** Which level of the lace chain a triangle's texels are a pixel on. */
function laceLevel(uvs, i0, i1, i2, screenArea) {
  const scale = LACE_REPEAT * LACE_SIZE;
  const du1 = (uvs[i1 * 2] - uvs[i0 * 2]) * scale;
  const dv1 = (uvs[i1 * 2 + 1] - uvs[i0 * 2 + 1]) * scale;
  const du2 = (uvs[i2 * 2] - uvs[i0 * 2]) * scale;
  const dv2 = (uvs[i2 * 2 + 1] - uvs[i0 * 2 + 1]) * scale;
  const texels = Math.abs(du1 * dv2 - dv1 * du2);
  const perPixel = Math.sqrt(texels / Math.max(screenArea, 1e-6));
  return perPixel > 1 ? Math.ceil(Math.log2(perPixel)) : 0;
}

function rasterise(matrix, width, height, depth, onFragment, awayFrom = null, list = objects) {
  const area2 = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

  for (const object of list) {
    const { positions, normals, occlusion, indices } = object;
    const count = positions.length / 3;
    const sx = new Float32Array(count);
    const sy = new Float32Array(count);
    const sz = new Float32Array(count);
    const sw = new Float32Array(count);

    for (let v = 0; v < count; v += 1) {
      const [x, y, z, w] = clipSpace(
        matrix,
        positions[v * 3],
        positions[v * 3 + 1],
        positions[v * 3 + 2]
      );
      sw[v] = w;
      const inv = 1 / (w || 1e-6);
      sx[v] = (x * inv * 0.5 + 0.5) * width;
      sy[v] = (1 - (y * inv * 0.5 + 0.5)) * height;
      sz[v] = z * inv;
    }

    for (let t = 0; t < indices.length; t += 3) {
      const i0 = indices[t];
      const i1 = indices[t + 1];
      const i2 = indices[t + 2];
      if (sw[i0] <= 1e-4 || sw[i1] <= 1e-4 || sw[i2] <= 1e-4) continue;

      // Shadow pass: keep only the triangles turned away from the light. See
      // the note above `shadowDepth` for why the map wants the far side of a
      // body rather than the near one. The test is on the shading normals, not
      // on the winding, so it agrees exactly with the `ndl > 0` test the main
      // pass uses to decide whether to look the shadow up at all.
      if (awayFrom !== null && !object.cards) {
        const facing =
          (normals[i0 * 3] + normals[i1 * 3] + normals[i2 * 3]) * awayFrom[0] +
          (normals[i0 * 3 + 1] + normals[i1 * 3 + 1] + normals[i2 * 3 + 1]) * awayFrom[1] +
          (normals[i0 * 3 + 2] + normals[i1 * 3 + 2] + normals[i2 * 3 + 2]) * awayFrom[2];
        if (facing > 0) continue;
      }

      const area = area2(sx[i0], sy[i0], sx[i1], sy[i1], sx[i2], sy[i2]);
      // Both windings are drawn. The isosurface is closed, so backfaces are
      // invisible anyway, and the props are closed and seen from outside - and the
      // shadow pass wants backfaces specifically, so it selects them by normal
      // above rather than by winding here.
      if (Math.abs(area) < 1e-9) continue;

      const minX = Math.max(0, Math.floor(Math.min(sx[i0], sx[i1], sx[i2])));
      const maxX = Math.min(width - 1, Math.ceil(Math.max(sx[i0], sx[i1], sx[i2])));
      const minY = Math.max(0, Math.floor(Math.min(sy[i0], sy[i1], sy[i2])));
      const maxY = Math.min(height - 1, Math.ceil(Math.max(sy[i0], sy[i1], sy[i2])));
      if (minX > maxX || minY > maxY) continue;

      const invArea = 1 / area;
      const level = object.lace ? laceLevel(object.uvs, i0, i1, i2, Math.abs(area)) : 0;
      const iw0 = 1 / sw[i0];
      const iw1 = 1 / sw[i1];
      const iw2 = 1 / sw[i2];

      for (let py = minY; py <= maxY; py += 1) {
        const cy = py + 0.5;
        for (let px = minX; px <= maxX; px += 1) {
          const cx = px + 0.5;
          let w0 = area2(sx[i1], sy[i1], sx[i2], sy[i2], cx, cy) * invArea;
          let w1 = area2(sx[i2], sy[i2], sx[i0], sy[i0], cx, cy) * invArea;
          let w2 = area2(sx[i0], sy[i0], sx[i1], sy[i1], cx, cy) * invArea;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;

          const z = w0 * sz[i0] + w1 * sz[i1] + w2 * sz[i2];
          const offset = py * width + px;
          if (z >= depth[offset]) continue;

          // Screen-space barycentrics interpolate a plane in screen space,
          // which is not how attributes vary across a perspective triangle.
          // Dividing through by w is the correction; without it the shading
          // slides across large near-edge-on triangles, which on a torso is a
          // visible band.
          const persp = w0 * iw0 + w1 * iw1 + w2 * iw2;
          const b0 = (w0 * iw0) / persp;
          const b1 = (w1 * iw1) / persp;
          const b2 = (w2 * iw2) / persp;

          // A card is only where its texture says there is hair, and that has
          // to be decided before the depth is written - in both passes, or the
          // clear half of every strip shadows and hides what is behind it.
          if (object.cards) {
            const { uvs } = object;
            const u = b0 * uvs[i0 * 2] + b1 * uvs[i1 * 2] + b2 * uvs[i2 * 2];
            const v = b0 * uvs[i0 * 2 + 1] + b1 * uvs[i1 * 2 + 1] + b2 * uvs[i2 * 2 + 1];
            if (sampleAtlas(object.cards.image, u, v)[1] < CARD_CUTOFF) continue;
          }
          // So is lace where its thread is, except where it is worked solid.
          if (object.lace) {
            const { uvs, trim } = object;
            if (!trim || b0 * trim[i0] + b1 * trim[i1] + b2 * trim[i2] <= 0.5) {
              const u = b0 * uvs[i0 * 2] + b1 * uvs[i1 * 2] + b2 * uvs[i2 * 2];
              const v = b0 * uvs[i0 * 2 + 1] + b1 * uvs[i1 * 2 + 1] + b2 * uvs[i2 * 2 + 1];
              if (laceCoverage(u, v, level) <= BAYER[(py & 3) * 4 + (px & 3)]) continue;
            }
          }
          depth[offset] = z;
          if (!onFragment) continue;

          onFragment(offset, object, i0, i1, i2, b0, b1, b2);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Shadow pass                                                         */
/* ------------------------------------------------------------------ */

/**
 * The shadow map stores the *back* of every object, not the front.
 *
 * A depth map built from the surfaces facing the light has to be compared
 * against those same surfaces, and the comparison is a coin toss wherever the
 * light grazes them: one texel's footprint on a thigh lit tangentially is
 * centimetres long, so the depth it stored is wrong by centimetres and the
 * surface shadows itself in blocks that size. That is what a standing figure
 * came out with - stair-stepped grey slabs down the flank and the inner thigh,
 * running the length of the leg.
 *
 * Bias fights that and loses. Enough bias to cover the worst grazing texel is
 * enough to lift every shadow in the picture off the thing casting it.
 *
 * Keeping only the triangles that face away from the light removes the
 * comparison instead of trying to win it. The bodies and the props are closed,
 * so every lit point has its own far side stored behind it and can never be
 * found in front of the stored depth - self-shadowing becomes impossible rather
 * than merely unlikely. The cost is that a shadow starts from the caster's far
 * side, so it slips along the light by the caster's thickness: about 20mm
 * through a hand, and nothing at all where a sole meets the floor, because
 * there the far side *is* the contact. The ground quad is one-sided and faces
 * the light, so it drops out of the map entirely, which is correct - it has
 * nothing behind it to shadow.
 */
const shadowDepth = new Float32Array(SHADOW_SIZE * SHADOW_SIZE).fill(Infinity);
rasterise(shadowMatrix, SHADOW_SIZE, SHADOW_SIZE, shadowDepth, null, KEY);

/**
 * How much of the key light reaches a point.
 *
 * Four taps rather than one. A single comparison against a 2048-pixel map
 * across a two-metre scene gives a shadow edge two millimetres wide, which at
 * this output size is a hard jagged line; the contact shadow where two bodies
 * meet is the most important shadow in the picture and it is the one that looks
 * worst that way.
 *
 * The bias is small and nearly flat, which is only affordable because the map
 * holds back faces. What it now has to cover is not a grazing texel's footprint
 * but the thinnest thing in the scene - a finger, around 15mm - so a couple of
 * millimetres of slack is enough, and the shadows stay attached to their
 * casters. The residual slope term is for the few places a thin part is also
 * edge-on to the light, such as the rim of an ear.
 */
const SHADOW_TEXEL = (2 * shadowRadius) / SHADOW_SIZE;

// The taps are spread by a fixed distance on the *body*, not by a fixed number
// of texels, so the penumbra is the same width whatever is in frame. Spreading
// by texels instead ties the softness to the frustum: tightening the map for a
// close-up made every edge four times harder at the same time, and the shadow
// under a breast came back as a black cut-out with a clean line round it.
//
// 3mm rather than the 1.5mm this started at, and eight taps in a ring rather
// than four at the corners, because 1.5mm was still hard enough to read as an
// edge and four taps quantise the penumbra into five steps - which on a shadow
// as broad as a breast's is visible banding rather than softness. Eight taps at
// 3mm is a nine-level ramp about 6mm wide, which is what a window-sized source
// casts at arm's length.
const SHADOW_TAP = Math.max(0.7, 0.003 / SHADOW_TEXEL);
const SHADOW_RING = [
  [-1, -1], [0, -1.4], [1, -1], [1.4, 0],
  [1, 1], [0, 1.4], [-1, 1], [-1.4, 0],
];

function shadowFactor(x, y, z, nx, ny, nz, ndl) {
  const slope = Math.min(6, Math.sqrt(1 - ndl * ndl) / Math.max(ndl, 0.08));
  // Off the surface far enough that this point does not shadow itself, and no
  // further. Scaling this by the slope as well as the depth bias below is what
  // put a set of nested brown arcs under the breast.
  //
  // A normal offset does two things at once and only one of them is wanted: it
  // moves the sample deeper, and it moves the sample *sideways in the map*. At
  // a grazing angle the first is worth almost nothing - the depth gained is
  // `push * ndl`, and `ndl` is what is small - while the second is worth the
  // whole offset. Scaled by a slope running to 6 the offset reached 37mm, so
  // under the lower pole, where `ndl` changes fast, neighbouring pixels sampled
  // the map tens of millimetres apart and read different sides of the breast's
  // own shadow. The bands that came back looked like a fault in the bust and
  // survived disabling the key light, the occlusion term and the glow: the
  // geometry under them is smooth to a millimetre.
  //
  // What the slope is actually needed for is the *filter*: the eight taps sit
  // 3mm away on the surface, so they read depths up to `3mm * slope` nearer
  // than this point. That is a depth, and the depth bias below already covers
  // it - it grows by 3.75mm of depth per unit of slope against the 3mm the taps
  // need. So the slope term belongs there and only there.
  const push = SHADOW_TEXEL * (SHADOW_TAP / 0.7) * 1.4;
  const [cx, cy, cz, cw] = clipSpace(
    shadowMatrix,
    x + nx * push,
    y + ny * push,
    z + nz * push
  );
  const inv = 1 / (cw || 1);
  const u = (cx * inv * 0.5 + 0.5) * SHADOW_SIZE;
  const v = (1 - (cy * inv * 0.5 + 0.5)) * SHADOW_SIZE;
  const depth = cz * inv;
  if (u < 1 || v < 1 || u >= SHADOW_SIZE - 1 || v >= SHADOW_SIZE - 1) return 1;

  // Enough to clear a fold where the body nearly touches itself - under a
  // breast, inside an elbow - where the back face this map stores can sit a
  // millimetre behind the front one and stripe it. Still well under half what
  // a front-face map needed, which is the whole point of storing back faces,
  // and measured against the one thing worth protecting: at this bias a hand
  // held near a thigh still casts its separate fingers onto it.
  const bias = 0.0005 + 0.0005 * slope;
  const limit = depth - bias;
  // Each tap bilinearly, not to the nearest texel. Eight binary comparisons can
  // only return nine values, and `Math.round` made sure neighbouring pixels got
  // the *same* nine: under the breast, where the shadow's edge runs along a
  // fold and the caster is millimetres from the receiver, the result flipped
  // between levels from pixel to pixel and the edge came out stippled rather
  // than soft. Weighting the four texels around each tap makes a tap's result
  // continuous, so the eight of them make a ramp instead of a staircase, and it
  // costs four array reads where there was one.
  //
  // The clamp a line above guarantees `u` and `v` are at least one texel inside
  // the map, and `SHADOW_TAP` can push a tap 1.4 of its radius past that, so
  // the floor is taken against the bounds rather than trusted.
  const edge = SHADOW_SIZE - 2;
  let lit = 0;
  for (const [du, dv] of SHADOW_RING) {
    const su = Math.max(0, Math.min(edge, u + du * SHADOW_TAP));
    const sv = Math.max(0, Math.min(edge, v + dv * SHADOW_TAP));
    const u0 = Math.floor(su);
    const v0 = Math.floor(sv);
    const fu = su - u0;
    const fv = sv - v0;
    const row = v0 * SHADOW_SIZE;
    const next = row + SHADOW_SIZE;
    const a = limit <= shadowDepth[row + u0] ? 1 : 0;
    const b = limit <= shadowDepth[row + u0 + 1] ? 1 : 0;
    const c = limit <= shadowDepth[next + u0] ? 1 : 0;
    const d = limit <= shadowDepth[next + u0 + 1] ? 1 : 0;
    const top = a + (b - a) * fu;
    lit += (top + (c + (d - c) * fu - top) * fv) / SHADOW_RING.length;
  }
  return lit;
}

/* ------------------------------------------------------------------ */
/* Main pass                                                           */
/* ------------------------------------------------------------------ */

const W = WIDTH * SS;
const H = HEIGHT * SS;
const depth = new Float32Array(W * H).fill(Infinity);
const colour = new Float32Array(W * H * 3);
const BACKDROP = [0.95, 0.94, 0.91];
for (let i = 0; i < W * H; i += 1) {
  colour[i * 3] = BACKDROP[0];
  colour[i * 3 + 1] = BACKDROP[1];
  colour[i * 3 + 2] = BACKDROP[2];
}

const eyeDir = [0, 0, 0];

function shade(offset, object, i0, i1, i2, b0, b1, b2) {
  const { positions, normals, occlusion, colour: base } = object;
  const px = b0 * positions[i0 * 3] + b1 * positions[i1 * 3] + b2 * positions[i2 * 3];
  const py = b0 * positions[i0 * 3 + 1] + b1 * positions[i1 * 3 + 1] + b2 * positions[i2 * 3 + 1];
  const pz = b0 * positions[i0 * 3 + 2] + b1 * positions[i1 * 3 + 2] + b2 * positions[i2 * 3 + 2];

  let nx = b0 * normals[i0 * 3] + b1 * normals[i1 * 3] + b2 * normals[i2 * 3];
  let ny = b0 * normals[i0 * 3 + 1] + b1 * normals[i1 * 3 + 1] + b2 * normals[i2 * 3 + 1];
  let nz = b0 * normals[i0 * 3 + 2] + b1 * normals[i1 * 3 + 2] + b2 * normals[i2 * 3 + 2];
  const length = Math.hypot(nx, ny, nz) || 1;
  nx /= length;
  ny /= length;
  nz /= length;

  eyeDir[0] = eye[0] - px;
  eyeDir[1] = eye[1] - py;
  eyeDir[2] = eye[2] - pz;
  const eyeLength = Math.hypot(eyeDir[0], eyeDir[1], eyeDir[2]) || 1;
  const vx = eyeDir[0] / eyeLength;
  const vy = eyeDir[1] / eyeLength;
  const vz = eyeDir[2] / eyeLength;

  // The far side of a card is seen through the gaps in the near one, and is
  // lit as the side it is.
  if (object.cards && nx * vx + ny * vy + nz * vz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }

  const ao = occlusion
    ? b0 * occlusion[i0] + b1 * occlusion[i1] + b2 * occlusion[i2]
    : 1;

  // Wrapped diffuse. Skin lit from the side stays lit well past ninety degrees,
  // because the light that gets under the surface comes back out somewhere
  // nearby - and the eye reads that soft terminator as flesh. Red wraps
  // furthest, being what travels furthest under the surface, which is what
  // warms the terminator; `SKIN_WRAP` in `renderer.js` is the same three.
  const wrap = object.skin ? SKIN_WRAP : PLAIN_WRAP;
  const ndl = nx * KEY[0] + ny * KEY[1] + nz * KEY[2];

  // The shadow map holds only surfaces turned away from the light, so a lookup
  // is only meaningful on a surface turned toward it - and the obvious gate,
  // `ndl > 0 ? lookup : 0`, is what put stepped grey slabs down the flank and
  // the inner thigh of every standing figure. It is a discontinuity: the
  // wrapped term is still worth a third of full brightness at ndl = 0, and
  // multiplying it by a shadow that falls from 1 to 0 across that same point
  // drops the surface by two thirds in one pixel. On a thigh the light grazes,
  // ndl crosses zero so slowly that the contour wanders centimetres for a
  // degree of normal, so the step lands as a ragged band rather than a line.
  //
  // Fading the shadow out over the band the wrap covers removes the step
  // without softening a cast shadow anywhere it is legible. Where the surface
  // faces the light the term is the lookup, unchanged; where it faces away the
  // term is 1 and the wrap alone takes the light out - which is the right
  // reading anyway, because light that reaches the dark side of a limb got
  // there through the limb, and what shadows it is the lit side, not this one.
  const gate = Math.min(1, Math.max(0, ndl / 0.3)) ** 2;
  const shadow = gate > 0 ? shadowFactor(px, py, pz, nx, ny, nz, Math.max(ndl, 0.12)) : 1;

  // What the key is worth where the map says it is fully blocked. Not zero, and
  // the reason is the source rather than the surface: this scene is lit as if by
  // a window, and a window is several hundred millimetres across. A breast is
  // forty. Nothing that small casts a true umbra from a source that large - what
  // it casts is penumbra all the way through, and the darkest part of it still
  // sees a good slice of the source. Ray-testing one direction and taking the
  // answer as all-or-nothing is what produced a black ellipse under one breast
  // of every female render, read - correctly, given how it looked - as a hole in
  // the mesh. It was not: the surface there is watertight and symmetric to the
  // micron, and turning the texture off left the ellipse exactly where it was.
  //
  // 0.18 for skin, because a body is surrounded by its own bounce as well; a
  // prop gets less, having usually only the floor. This is the only term
  // standing in for the source's angular size, so it is set by what a shadow
  // under a breast, a chin or a hand should read as, which is "dim" and not
  // "absent".
  //
  // On skin the shadow's edge is warmed on its way down to that floor, by the
  // same scatter as the terminator: light entering on the lit side of the edge
  // comes out on the dark side, and red is the part of it that gets there.
  const umbra = object.skin ? 0.18 : 0.08;
  const visible = 1 - gate * (1 - shadow);
  const penumbra = object.skin ? SKIN_PENUMBRA : PLAIN_PENUMBRA;
  const leak = umbra * (1 - visible);
  const keyR = Math.max(0, (ndl + wrap[0]) / (1 + wrap[0])) * (visible ** penumbra[0] + leak) * 2.1;
  const keyG = Math.max(0, (ndl + wrap[1]) / (1 + wrap[1])) * (visible ** penumbra[1] + leak) * 2.1;
  const keyB = Math.max(0, (ndl + wrap[2]) / (1 + wrap[2])) * (visible ** penumbra[2] + leak) * 2.1;

  const fill = Math.max(0, nx * FILL[0] + ny * FILL[1] + nz * FILL[2]) * 0.4;
  const rim = Math.max(0, nx * RIM[0] + ny * RIM[1] + nz * RIM[2]) * 0.55;

  // Hemisphere ambient, occluded. This is the term the field's AO acts on, and
  // it is what darkens the crease where two bodies touch.
  const sky = (ny * 0.5 + 0.5) * 0.5 * ao;
  const bounce = 0.11 * ao;

  // The atlas, if this part has one. Sampled here rather than folded into the
  // vertex colour because the texture carries detail an order of magnitude
  // finer than the mesh - a nipple is four vertices and a hundred texels.
  let tint = base;
  if (object.atlas) {
    const { uvs, atlas } = object;
    const u = b0 * uvs[i0 * 2] + b1 * uvs[i1 * 2] + b2 * uvs[i2 * 2];
    const v = b0 * uvs[i0 * 2 + 1] + b1 * uvs[i1 * 2 + 1] + b2 * uvs[i2 * 2 + 1];
    const texel = sampleAtlas(atlas, u, v);
    tint = [base[0] * texel[0], base[1] * texel[1], base[2] * texel[2]];
  } else if (object.cards) {
    const { uvs, cards } = object;
    const u = b0 * uvs[i0 * 2] + b1 * uvs[i1 * 2] + b2 * uvs[i2 * 2];
    const v = b0 * uvs[i0 * 2 + 1] + b1 * uvs[i1 * 2 + 1] + b2 * uvs[i2 * 2 + 1];
    const grey = sampleAtlas(cards.image, u, v)[0] * cards.gain;
    tint = [base[0] * grey, base[1] * grey, base[2] * grey];
  } else if (object.trimColour && b0 * object.trim[i0] + b1 * object.trim[i1] + b2 * object.trim[i2] > 0.5) {
    tint = object.trimColour;
  }

  // The rim is added rather than tinted, which is deliberate - it stands in for
  // light the surface is edge-on to, and that light is the source's colour, not
  // the surface's. It is also why it has to be pulled off hair. On skin the term
  // is a thin bright line at a silhouette, because skin's albedo is high and the
  // rim is only a fifth of what the key gives; on hair at 0.05 albedo the key is
  // worth 0.1 and the rim is worth 0.5, so a term meant to draw an edge instead
  // floods the whole shape. The first hair render came out a uniform mid-grey
  // cape over the shoulders for exactly this reason. Tinted, it sits back under
  // the diffuse where it belongs, and the sheen - which is a real reflection and
  // properly independent of albedo - does the edge work instead.
  const rimAdd = object.sheen ? 0 : rim;
  const rimMul = object.sheen ? rim : 0;

  let r = tint[0] * (keyR * 1.03 + fill * 0.78 + sky * 0.88 + bounce + rimMul) + rimAdd * 0.9;
  let g = tint[1] * (keyG * 0.96 + fill * 0.86 + sky * 0.92 + bounce + rimMul) + rimAdd * 0.9;
  let b = tint[2] * (keyB * 0.9 + fill * 1.0 + sky * 1.0 + bounce + rimMul) + rimAdd * 0.92;

  if (object.skin) {
    // The transmission glow, concentrated where the surface turns away from the
    // camera and is not buried in a crease.
    const facing = 1 - Math.abs(nx * vx + ny * vy + nz * vz);
    // Smoothstep rather than a clamped ramp, which is what the webapp's shader
    // has always used - `smoothstep(0.35, 1.0, vOcclusion)` in `renderer.js`.
    // A ramp clamped at zero has a corner in it, and this term is strongly
    // coloured - 0.62 red against 0.16 blue - so a corner in it draws a line on
    // the skin wherever `ao` crosses the knee. `ao` does cross it twice under
    // the breast, falling to 0.25 in the fold and recovering to 0.5 below, so
    // the two renderers were drawing measurably different pictures there.
    const t = Math.max(0, Math.min(1, (ao - 0.35) / 0.65));
    const thin = t * t * (3 - 2 * t);
    const glow = facing * facing * facing * thin * 0.3;
    r += 0.62 * glow;
    g += 0.23 * glow;
    b += 0.16 * glow;

    // Skin's two specular lobes, as the webapp draws them: the skin's own,
    // broad, and the tighter, weaker one off the film of oil over it, which is
    // what puts a small highlight on a shoulder or the bridge of a nose. Without
    // them skin is chalk. Blinn-Phong exponents matched to the webapp's GGX
    // roughnesses (0.52 and the coat's 0.34), and strengths set against the
    // webapp side by side - normalised and scaled to these lights they came out
    // a third stronger than it draws, and the figure looked oiled. Reflectance
    // is skin's 2.8% at normal incidence, the coat's 4%, and neither takes the
    // floor the diffuse does - a highlight in a shadow is a glint that could
    // not be there. The key's warm white, not the surface's colour: the first
    // reflection off a dielectric is the colour of the light.
    const hx = KEY[0] + vx;
    const hy = KEY[1] + vy;
    const hz = KEY[2] + vz;
    const hl = Math.hypot(hx, hy, hz) || 1;
    const ndh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
    const schlick = (1 - Math.max(0, (vx * hx + vy * hy + vz * hz) / hl)) ** 5;
    const lit = Math.max(0, ndl) * visible;
    const spec = lit * ((0.028 + 0.972 * schlick) * 6 * ndh ** 25 + (0.04 + 0.96 * schlick) * 4 * ndh ** 148);
    r += spec;
    g += spec * 0.96;
    b += spec * 0.91;
  }

  if (object.sheen) {
    // Hair is the one surface here that cannot be drawn by diffuse shading
    // alone. Black hair has an albedo around 0.05: under this key that is a
    // twentieth of what the skin beside it returns, so every diffuse term
    // lands in the bottom two or three levels of the output and the whole
    // head - crown, temple, the fall over the shoulder - comes out one flat
    // dark shape, indistinguishable from a hole in the picture. What tells a
    // viewer it is hair and not a hole is the specular band, which is not
    // attenuated by albedo at all and so survives being black.
    //
    // Two lobes. The tight one is the band itself, which on a head of hair sits
    // a little above the diffuse highlight and is what reads as gloss; the
    // broad one is the sheen over the rest of the crown, which keeps the
    // shading from falling off a cliff either side of the band. Both take the
    // shadow - hair under a chin should not glint - and both are white, because
    // the first reflection off a dielectric is the colour of the light.
    //
    // The tight lobe is deliberately weak and deliberately wide: at exponent 48
    // and 0.55 it drew a single clean blob on the crown and the head came back
    // looking like a swimming cap, because that is what one broad mirror
    // highlight on a smooth dark dome is. Hair's real highlight is scattered
    // across thousands of strands, so it is dimmer, spread over more of the
    // head, and broken up - the breaking up is the shell's own lumpiness, and
    // it only shows once the lobe is wide enough to cover several lumps at once.
    //
    // Wide is not the same as *broad*, though, and at exponent 22 and 0.20 this
    // had gone past wide into broad: the lobe covered the whole front of the cap
    // at once, so the lumps it was supposed to be broken up by were all inside
    // it and it came back as one smooth sheet of gloss - a visor, or a wet head.
    // 30 and 0.14 is narrow enough that a lock ridge carries it and the next one
    // does not, which is the whole point of having ridges, and the broad lobe is
    // up in compensation so the crown does not go black between them.
    const hx = KEY[0] + vx;
    const hy = KEY[1] + vy;
    const hz = KEY[2] + vz;
    const hl = Math.hypot(hx, hy, hz) || 1;
    const ndh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
    const lit = Math.max(0, ndl) * (1 - gate * (1 - shadow) * (1 - umbra));
    // And a coat over leather or wet-look lycra: a tight lobe, which on a strap
    // is the thin bright line along its crown that says it is not cloth.
    const spec = lit * ((ndh ** 30 * 0.14 + ndh ** 5 * 0.10) * object.sheen + ndh ** 90 * object.gloss);
    r += spec;
    g += spec * 0.98;
    b += spec * 0.94;
  }

  if (object.dim) {
    const dim = b0 * object.dim[i0] + b1 * object.dim[i1] + b2 * object.dim[i2];
    r *= dim;
    g *= dim;
    b *= dim;
  }

  colour[offset * 3] = r;
  colour[offset * 3 + 1] = g;
  colour[offset * 3 + 2] = b;
}

rasterise(viewProjection, W, H, depth, shade);

/**
 * Stockings, over the finished picture.
 *
 * Tested against the depth of what is drawn and never writing it, like the
 * glass below, and each pixel takes only the nearest veil in front of it - the
 * hit is recorded in a first pass and shaded in a second, because shading as
 * the triangles come would tint a pixel once for each layer of the tube, and
 * at the edge of a leg there are two.
 *
 * How much of what is behind comes through is the nylon's: a sheer knit is
 * mostly holes seen square on and mostly thread seen at a slant, because the
 * slant looks through more of it. `DENIER` is what it covers square on; the
 * welt at the top is knitted close, and covers nearly all of it.
 */
const DENIER = 0.45;
if (veils.length) {
  const veilDepth = Float32Array.from(depth);
  const hit = new Int32Array(W * H).fill(-1);
  const corners = new Uint32Array(W * H * 3);
  const weights = new Float32Array(W * H * 3);
  rasterise(viewProjection, W, H, veilDepth, (offset, object, i0, i1, i2, b0, b1, b2) => {
    hit[offset] = veils.indexOf(object);
    corners.set([i0, i1, i2], offset * 3);
    weights.set([b0, b1, b2], offset * 3);
  }, null, veils);
  const behind = [0, 0, 0];
  for (let offset = 0; offset < W * H; offset += 1) {
    if (hit[offset] < 0) continue;
    const object = veils[hit[offset]];
    const [i0, i1, i2] = corners.subarray(offset * 3, offset * 3 + 3);
    const [b0, b1, b2] = weights.subarray(offset * 3, offset * 3 + 3);
    const { positions, normals, trim } = object;
    let nx = b0 * normals[i0 * 3] + b1 * normals[i1 * 3] + b2 * normals[i2 * 3];
    let ny = b0 * normals[i0 * 3 + 1] + b1 * normals[i1 * 3 + 1] + b2 * normals[i2 * 3 + 1];
    let nz = b0 * normals[i0 * 3 + 2] + b1 * normals[i1 * 3 + 2] + b2 * normals[i2 * 3 + 2];
    const vx = eye[0] - (b0 * positions[i0 * 3] + b1 * positions[i1 * 3] + b2 * positions[i2 * 3]);
    const vy = eye[1] - (b0 * positions[i0 * 3 + 1] + b1 * positions[i1 * 3 + 1] + b2 * positions[i2 * 3 + 1]);
    const vz = eye[2] - (b0 * positions[i0 * 3 + 2] + b1 * positions[i1 * 3 + 2] + b2 * positions[i2 * 3 + 2]);
    const facing = Math.abs(nx * vx + ny * vy + nz * vz) / ((Math.hypot(nx, ny, nz) || 1) * (Math.hypot(vx, vy, vz) || 1));
    const welt = trim && b0 * trim[i0] + b1 * trim[i1] + b2 * trim[i2] > 0.5;
    const alpha = Math.max(1 - (1 - DENIER) ** (1 / Math.max(facing, 0.08)), welt ? 0.92 : 0);
    for (let c = 0; c < 3; c += 1) behind[c] = colour[offset * 3 + c];
    shade(offset, object, i0, i1, i2, b0, b1, b2);
    for (let c = 0; c < 3; c += 1) colour[offset * 3 + c] = behind[c] * (1 - alpha) + colour[offset * 3 + c] * alpha;
  }
}

/**
 * A car's shell, laid over the finished picture.
 *
 * It is glass, so it neither casts a shadow nor hides anything: each panel is
 * tested against the depth of what is already drawn, never writes depth of its
 * own, and tints each pixel once - its two faces a few centimetres apart would
 * otherwise tint the same pixel twice.
 */
for (const panel of solved.surface.shell ?? []) {
  const object = boxObject(panel.center, panel.size, (PROP_COLOUR[panel.kind] ?? [0.6, 0.6, 0.6]).map(toLinear));
  const alpha = SHELL_OPACITY[panel.kind] ?? SHELL_OPACITY.default;
  const touched = new Uint8Array(W * H);
  rasterise(viewProjection, W, H, Float32Array.from(depth), (offset, { normals, colour: tint }, i0) => {
    if (touched[offset]) return;
    touched[offset] = 1;
    const light = 0.8 + 0.4 * Math.abs(normals[i0 * 3] * KEY[0] + normals[i0 * 3 + 1] * KEY[1] + normals[i0 * 3 + 2] * KEY[2]);
    for (let c = 0; c < 3; c += 1) colour[offset * 3 + c] = colour[offset * 3 + c] * (1 - alpha) + tint[c] * light * alpha;
  }, null, [object]);
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

/** Narkowicz's ACES fit, the same curve three's tone mapping uses. */
function tonemap(x) {
  const v = x * 0.6;
  return Math.max(0, Math.min(1, (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14)));
}

const encode = (linear) => {
  const c = tonemap(linear);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
};

const pixels = Buffer.alloc(HEIGHT * (WIDTH * 3 + 1));
const inv = 1 / (SS * SS);
for (let y = 0; y < HEIGHT; y += 1) {
  const row = y * (WIDTH * 3 + 1);
  pixels[row] = 0; // filter type: none
  for (let x = 0; x < WIDTH; x += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const offset = ((y * SS + sy) * W + x * SS + sx) * 3;
        r += colour[offset];
        g += colour[offset + 1];
        b += colour[offset + 2];
      }
    }
    const at = row + 1 + x * 3;
    pixels[at] = encode(r * inv);
    pixels[at + 1] = encode(g * inv);
    pixels[at + 2] = encode(b * inv);
  }
}

/* PNG container. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // truecolour
writeFileSync(
  OUT,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ])
);

/* ------------------------------------------------------------------ */
/* Vector line art                                                     */
/* ------------------------------------------------------------------ */

/**
 * The same silhouette extraction the browser exporter does, against the depth
 * buffer that was just filled in rather than against a GPU depth pass.
 *
 * Having both is the point: the browser version depends on a render target
 * readback and a packed-depth round trip that cannot be exercised without a
 * GPU, and this one shares none of that. If the two disagree about where a
 * figure's outline is, one of them is wrong about the geometry.
 */
function lineArt() {
  const segments = [];
  const scale = 1 / SS;

  for (const object of [...objects, ...veils]) {
    if (object.ground) continue;
    const { positions, indices } = object;
    const count = indices.length / 3;
    // `front * 8 + back`, counting the adjacent triangles that face the camera
    // and those that do not. An edge they disagree about is the silhouette; an
    // edge with only one triangle is a hole in the surface.
    const edges = new Map();

    for (let t = 0; t < count; t += 1) {
      const i0 = indices[t * 3];
      const i1 = indices[t * 3 + 1];
      const i2 = indices[t * 3 + 2];
      const ax = positions[i0 * 3];
      const ay = positions[i0 * 3 + 1];
      const az = positions[i0 * 3 + 2];
      const ux = positions[i1 * 3] - ax;
      const uy = positions[i1 * 3 + 1] - ay;
      const uz = positions[i1 * 3 + 2] - az;
      const vx = positions[i2 * 3] - ax;
      const vy = positions[i2 * 3 + 1] - ay;
      const vz = positions[i2 * 3 + 2] - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const front =
        nx * (eye[0] - ax) + ny * (eye[1] - ay) + nz * (eye[2] - az) > 0 ? 8 : 1;

      for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
        const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
        edges.set(key, (edges.get(key) ?? 0) + front);
      }
    }

    for (const [key, code] of edges) {
      const front = code >> 3;
      const back = code & 7;
      if (!((front > 0 && back > 0) || front + back === 1)) continue;
      const b = key % 4294967296;
      const a = (key - b) / 4294967296;
      const pa = screen(positions, a);
      const pb = screen(positions, b);
      if (!pa || !pb) continue;
      for (const run of visibleRuns(pa, pb)) {
        segments.push(
          `M${(run[0].x * scale).toFixed(1)} ${(run[0].y * scale).toFixed(1)}` +
            `L${(run[1].x * scale).toFixed(1)} ${(run[1].y * scale).toFixed(1)}`
        );
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" ` +
    `viewBox="0 0 ${WIDTH} ${HEIGHT}">` +
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>` +
    `<g fill="none" stroke="#1b1b1b" stroke-width="1.4" stroke-linecap="round">` +
    `<path d="${segments.join("")}"/></g></svg>`
  );
}

function screen(positions, index) {
  const [x, y, z, w] = clipSpace(
    viewProjection,
    positions[index * 3],
    positions[index * 3 + 1],
    positions[index * 3 + 2]
  );
  if (w <= 1e-4) return null;
  const inv = 1 / w;
  const ndc = z * inv;
  if (ndc < -1 || ndc > 1) return null;
  return { x: (x * inv * 0.5 + 0.5) * W, y: (1 - (y * inv * 0.5 + 0.5)) * H, z: ndc };
}

/**
 * Split a segment into the parts the depth buffer says are in front.
 *
 * Sampled rather than solved. The exact answer means intersecting the segment
 * with every triangle in the scene, and at the width a line is drawn at, a
 * sample every few pixels is indistinguishable from it.
 *
 * The comparison takes the *farthest* depth in a small neighbourhood rather
 * than the depth under the sample. A silhouette is by definition the pixel
 * where the surface is turning away fastest, so the depth gradient across it is
 * as steep as it gets anywhere in the picture, and half a pixel of rounding
 * puts the stored value well behind the line that generated it. Testing against
 * the nearest neighbour makes an object occlude its own outline, which is why
 * the first version of this drew the furniture perfectly and the people as
 * confetti.
 */
function visibleRuns(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.min(80, Math.ceil(length / (3 * SS))));
  const runs = [];
  let start = null;
  // In NDC depth, which is heavily non-linear - but both the line and the
  // buffer came out of the same projection, so the comparison is like for like.
  const tolerance = 1e-3;

  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = Math.round(from.x + dx * t);
    const y = Math.round(from.y + dy * t);
    const z = from.z + (to.z - from.z) * t;
    let visible = x >= 1 && y >= 1 && x < W - 1 && y < H - 1;
    if (visible) {
      let behind = -Infinity;
      for (let v = -1; v <= 1; v += 1) {
        for (let u = -1; u <= 1; u += 1) {
          const sample = depth[(y + v) * W + x + u];
          if (sample > behind) behind = sample;
        }
      }
      visible = z <= behind + tolerance;
    }
    if (visible && start === null) start = t;
    else if (!visible && start !== null) {
      runs.push([start, t]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, 1]);

  // A mesh edge at this resolution is only a handful of pixels long, so the
  // shortest run worth keeping is well under one output pixel.
  return runs
    .filter(([a, b]) => (b - a) * length > 0.4 * SS)
    .map(([a, b]) => [
      { x: from.x + dx * a, y: from.y + dy * a },
      { x: from.x + dx * b, y: from.y + dy * b },
    ]);
}

let svgOut = null;
if (has("svg")) {
  svgOut = OUT.replace(/\.png$/i, "") + ".svg";
  writeFileSync(svgOut, lineArt());
}

/* ------------------------------------------------------------------ */
/* Report                                                             */
/* ------------------------------------------------------------------ */

const triangles = [...objects, ...veils].reduce((sum, object) => sum + object.indices.length / 3, 0);
console.log(JSON.stringify(parsed.scene.title || parsed.scene.description || SCENE_FILE || flag('preset', null) || text));
console.log(`  ${OUT}  ${WIDTH}x${HEIGHT} (${SS}x) · ${(triangles / 1000).toFixed(1)}k triangles`);
if (svgOut) console.log(`  ${svgOut}  vector outlines`);
console.log(
  `  postures ${solved.actors.map((a) => a.posture.id ?? a.spec.posture).join(" + ")} · ` +
    `${parsed.scene.relationship.arrangement ?? "solo"} on ${parsed.scene.support.surface}`
);
console.log(
  `  penetration ${(solved.quality.maxDepth * 1000).toFixed(0)}mm · ` +
    `${solved.quality.unmetContacts} unmet contacts`
);
for (const warning of [...parsed.warnings, ...solved.quality.warnings]) {
  console.log(`  ! ${warning}`);
}

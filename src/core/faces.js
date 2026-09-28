/**
 * An expression laid on a template.
 *
 * `scripts/models/make-faces.mjs` poses each body's face in every mix in
 * `expressions.js`, in MakeHuman, and keeps how far each vertex of the skin,
 * the brows and the lashes moved: faces-<body>.bin, in the hair cards'
 * container. A template carries its body's file (`withFaces`) and has its face
 * put in an expression (`withExpression`) on its bind mesh, before anything is
 * skinned, the way `featureRelief` puts the bust on: skinning is affine, so a
 * face made in the rest pose is the same face turned with the head. And it is
 * the template the contact queries measure, so the lips that meet a partner's
 * are the lips drawn.
 *
 * The same file carries what an open mouth shows: MakeHuman's teeth and
 * tongue, fitted to the body and moving with the jaw, and how dark it is in
 * there (see `MOUTH_COLOURS`).
 *
 * Apart from `expressions.js` so the solver, which only needs to know which
 * expression, does not bring the mesh code with it.
 */

import { movedNormals } from "./humanMesh.js";

/**
 * The inside of the mouth, each part in one flat colour (sRGB, 0..1), as the
 * eyes are drawn: the texture MakeHuman paints them with is mostly the shading
 * of the teeth into each other, and that is baked here as occlusion instead.
 *
 * The teeth are ivory, not white, for the reason the whites of the eyes are
 * off-white: a white that clips under the key is a flat bar across the mouth.
 * The gums, the tongue and the lining of a fine body's mouth (which is the
 * MakeHuman body's) are the pink of the inside of a lip, and are drawn in the
 * dark that the rays `make-faces.mjs` casts find there - most of an open mouth
 * is the shadow in it.
 */
export const MOUTH_COLOURS = {
  teeth: [0.84, 0.8, 0.72],
  gums: [0.74, 0.4, 0.42],
  tongue: [0.76, 0.44, 0.45],
  lining: [0.72, 0.38, 0.4],
};

/**
 * Carry a body's baked expressions on its template, and put its teeth and
 * tongue in its mouth.
 *
 * Carried rather than applied, like the hair cards, so that everything between
 * the loader and `withExpression` - `featureRelief`, the clothes, the hair -
 * passes it through untouched. The offsets are for the scan's own vertices:
 * `featureRelief` only adds vertices after them, so they stay where they were.
 *
 * The teeth, the gums and the tongue are submeshes of their own, carried on the
 * head like the eyes and, like them, with their own occlusion, since the field
 * the rest of the body is shaded from has no mouth in it. The skin gets the
 * dark of the mouth as `cavity`, the vertices that are in it and how much light
 * each keeps, for the renderers to take out of the field's occlusion.
 *
 * @param {object} template from `buildHumanTemplate`
 * @param {{meta:object, arrays:object}} faces `readCards` of faces-<body>.bin
 */
export function withFaces(template, faces) {
  const body = template.submeshes.find((submesh) => submesh.primary);
  if (body?.positions.length / 3 !== faces.meta.vertices)
    throw new Error(`faces-${faces.meta.body}.bin is for ${faces.meta.vertices} vertices, the body has ${body?.positions.length / 3}`);
  const head = template.jointByBone?.get("head");
  const mouth = head ? Object.keys(faces.meta.mouth ?? {}).map((part) => mouthPart(faces, part, head.index)) : [];
  const indices = mouth.length ? opened(body.indices, faces.arrays["body.cut"]) : body.indices;
  const submeshes = template.submeshes.map((submesh) => (submesh === body ? { ...body, indices, cavity: cavity(faces, "rest") } : submesh));
  return { ...template, submeshes: [...submeshes, ...mouth], faces };
}

/**
 * The body's triangles without the ones `cut`: a fine body's lips are one
 * surface, and the row they are joined along is cut for the mouth to open. Only
 * with the mouth in to be seen through the cut.
 */
function opened(indices, cut) {
  if (!cut?.length) return indices;
  const gone = new Uint8Array(indices.length / 3);
  for (const t of cut) gone[t] = 1;
  const kept = [];
  for (let t = 0; t < gone.length; t += 1) if (!gone[t]) kept.push(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);
  return new indices.constructor(kept);
}

/** One part of the mouth, at rest, as a submesh carried on the head. */
function mouthPart(faces, part, head) {
  const positions = Float32Array.from(faces.arrays[`${part}.positions`]);
  const indices = Uint32Array.from(faces.arrays[`${part}.indices`]);
  const count = positions.length / 3;
  const joints = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let v = 0; v < count; v += 1) {
    joints[v * 4] = head;
    weights[v * 4] = 1;
  }
  return {
    name: part,
    primary: false,
    mouth: true,
    colour: MOUTH_COLOURS[part] ?? MOUTH_COLOURS.gums,
    positions,
    normals: facetNormals(positions, indices),
    indices,
    joints,
    weights,
    occlusion: lit(faces, "rest", part),
  };
}

/** The skin's shade inside the mouth, at rest or in an expression. */
function cavity(faces, state) {
  const vertices = faces.arrays[`${state}.body.cavity.vertices`];
  return vertices ? { vertices, shade: faces.arrays[`${state}.body.cavity`] } : null;
}

/** A part of the mouth's occlusion, at rest or in an expression. */
function lit(faces, state, part) {
  const shade = faces.arrays[`${state}.${part}.occlusion`];
  return shade ? Float32Array.from(shade, (value) => value / 255) : null;
}

/** Area-weighted vertex normals, for a part that brought none. */
function facetNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const wx = positions[c] - positions[a], wy = positions[c + 1] - positions[a + 1], wz = positions[c + 2] - positions[a + 2];
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k += 1) normals[v + k] += n[k];
  }
  for (let v = 0; v < normals.length; v += 3) {
    const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
    for (let k = 0; k < 3; k += 1) normals[v + k] /= length;
  }
  return normals;
}

/**
 * Take the dark of the mouth out of an occlusion the field gave the skin, in
 * place, and return it.
 *
 * @param {Float32Array} occlusion one per vertex of the skin as it is drawn
 * @param {{vertices:ArrayLike<number>, shade:Uint8Array}|null} cavity
 */
export function inMouth(occlusion, cavity) {
  if (!cavity) return occlusion;
  cavity.vertices.forEach((v, i) => {
    if (v < occlusion.length) occlusion[v] *= cavity.shade[i] / 255;
  });
  return occlusion;
}

/** Sparse offsets, `vertices` and their steps, laid on a copy of `positions`. */
function moved(positions, vertices, offsets, step) {
  const out = positions.slice();
  const marked = new Uint8Array(positions.length / 3);
  vertices.forEach((vertex, i) => {
    for (let axis = 0; axis < 3; axis += 1) out[vertex * 3 + axis] += offsets[i * 3 + axis] * step;
    marked[vertex] = 1;
  });
  return { positions: out, marked };
}

/**
 * The template with its face in an expression.
 *
 * The skin's offsets go on the scan's vertices and its normals are rebuilt
 * where they moved, since a smile is as much the shading of the fold beside
 * the mouth as the mouth. The brows and the lashes, drawn as cards, go with
 * the skin under them; the teeth and the tongue with the jaw; and the dark in
 * the mouth is the dark of the mouth open that far. A template without faces,
 * or an expression it was not made with, is returned as it is.
 *
 * @param {object} template carrying `faces` (see `withFaces`)
 * @param {string} name a key of `EXPRESSIONS`
 */
export function withExpression(template, name) {
  const faces = template.faces;
  if (!faces || !faces.meta.expressions.includes(name)) return template;
  const step = faces.meta.step;
  const submeshes = template.submeshes.map((submesh) => {
    if (submesh.primary || submesh.mouth) {
      const key = submesh.primary ? "body" : submesh.name;
      const vertices = faces.arrays[`${name}.${key}.vertices`];
      if (!vertices) return submesh;
      const { positions, marked } = moved(submesh.positions, vertices, faces.arrays[`${name}.${key}`], step);
      const shaded = submesh.primary ? { cavity: cavity(faces, name) ?? submesh.cavity } : { occlusion: lit(faces, name, key) ?? submesh.occlusion };
      return { ...submesh, positions, normals: movedNormals(submesh, positions, marked), ...shaded };
    }
    const offsets = submesh.trim && faces.arrays[`${name}.${submesh.trim}`];
    if (!offsets || offsets.length !== submesh.positions.length) return submesh;
    const positions = submesh.positions.slice();
    for (let i = 0; i < positions.length; i += 1) positions[i] += offsets[i] * step;
    return { ...submesh, positions };
  });
  return { ...template, submeshes, expression: name };
}

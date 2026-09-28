/**
 * Hair cards: MakeHuman's own hairstyles, eyebrows and eyelashes, fitted to
 * each scanned body and drawn as textured, alpha-cut sheets.
 *
 * `hair.js` grows a closed shell off the scalp, and a shell reads as what it
 * is - one solid mass with a surface on it - however much it is lumped and
 * ridged. Hair is not a surface, it is a hundred thousand fibres with gaps
 * between them, and what a camera sees of it is mostly the gaps: the light
 * through the ends, the scalp between the strands at a parting, the outline
 * broken into wisps. The cheapest honest model of that is the one games use,
 * which is also what MakeHuman ships: a few thousand strips, each one a strip
 * of painted strands with transparent space round them, layered over the head.
 * The painting carries the fibres; the transparency carries the gaps; the
 * layering carries the volume.
 *
 * MakeHuman fits every such proxy to whatever body it has built, and does it
 * against the base mesh's hidden helper geometry, which no exported body
 * carries. So the fitting cannot happen here. `scripts/models/make-hair.mjs`
 * runs it once per body, in MakeHuman, and writes two kinds of file:
 *
 *   cards.bin           what every body shares: each trim's triangles, UVs
 *                       and skin weights, and the name and gain of its texture
 *   cards-<body>.bin    where that body's copy of every trim sits, in the
 *                       template's bind space
 *
 * and a grey-and-alpha texture per trim. Only the positions differ between
 * bodies - MakeHuman moves a proxy's vertices and nothing else - so the split
 * costs one small file per body rather than a dozen copies of the topology.
 *
 * Both files are one container: a magic number, a JSON header, and the typed
 * arrays it names, each on a four-byte boundary so it can be viewed in place.
 */

const MAGIC = 0x43484650; // "PFHC", little-endian
const VERSION = 1;

/**
 * The box positions are quantised into, in the template's stature-normalised
 * bind space: a sixteen-bit step across it is 0.03mm on a 1.7m body, far under
 * anything a render can resolve, and every trim - a braid down the back
 * included - sits well inside it.
 */
export const CARD_BOX = { min: [-0.5, -0.05, -0.5], max: [0.5, 1.15, 0.5] };

const TYPES = { Uint8Array, Uint16Array, Int16Array, Uint32Array, Float32Array };

const align = (n) => (n + 3) & ~3;

/**
 * Write a container.
 *
 * @param {object} meta anything JSON can hold; `arrays` is reserved
 * @param {Record<string, ArrayBufferView>} arrays typed arrays to store by name
 * @returns {Uint8Array}
 */
export function packCards(meta, arrays) {
  const entries = [];
  let size = 0;
  for (const [name, array] of Object.entries(arrays)) {
    const type = array.constructor.name;
    if (TYPES[type] !== array.constructor) throw new TypeError(`${name}: cannot store a ${type}`);
    size = align(size);
    entries.push([name, type, size, array.length]);
    size += array.byteLength;
  }
  const header = new TextEncoder().encode(JSON.stringify({ ...meta, version: VERSION, arrays: entries }));
  const headerLength = align(header.length);
  const bytes = new Uint8Array(8 + headerLength + align(size));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, headerLength, true);
  bytes.set(header, 8);
  bytes.fill(0x20, 8 + header.length, 8 + headerLength);
  for (const [name, , offset] of entries) {
    const array = arrays[name];
    bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), 8 + headerLength + offset);
  }
  return bytes;
}

/**
 * Read a container.
 *
 * The arrays are views into `bytes`, not copies, so they cost nothing and must
 * not be written to - the same file backs every template that loaded it.
 *
 * @param {ArrayBuffer|Uint8Array} bytes
 * @returns {{meta: object, arrays: Record<string, ArrayBufferView>}}
 */
export function readCards(bytes) {
  const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const view = new DataView(buffer);
  if (buffer.byteLength < 8 || view.getUint32(0, true) !== MAGIC) throw new Error("not a hair-card file");
  const headerLength = view.getUint32(4, true);
  const { arrays: entries, ...meta } = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength)));
  if (meta.version !== VERSION) throw new Error(`hair-card file version ${meta.version}, expected ${VERSION}`);
  const arrays = {};
  for (const [name, type, offset, length] of entries) {
    const Type = TYPES[type];
    if (!Type) throw new Error(`hair-card array ${name} has unknown type ${type}`);
    const start = 8 + headerLength + offset;
    if (start + length * Type.BYTES_PER_ELEMENT > buffer.byteLength) throw new Error(`hair-card array ${name} runs past the end of the file`);
    arrays[name] = new Type(buffer, start, length);
  }
  return { meta, arrays };
}

/**
 * A template that knows where its body's cards are.
 *
 * Carried on the template rather than passed to `withHair` so that everything
 * between the loader and the dresser - `featureRelief`, `withGarments`, the
 * template cache - passes it through untouched, as they already do any field
 * they do not recognise. A template without it still gets hair: the shell.
 *
 * @param {object} template from `buildHumanTemplate`
 * @param {{meta:object, arrays:object}} shared `readCards` of cards.bin
 * @param {{meta:object, arrays:object}} fitted `readCards` of cards-<body>.bin
 */
export function withCards(template, shared, fitted) {
  for (const [name, trim] of Object.entries(shared.meta.trims)) {
    const count = fitted.meta.trims?.[name];
    if (count !== trim.vertices)
      throw new Error(`cards-${fitted.meta.body}.bin has ${count ?? "no"} vertices for ${name}, cards.bin has ${trim.vertices}`);
  }
  return { ...template, cards: { shared, fitted } };
}

/**
 * The point a head's cards are lit about: level with the top of the ears and
 * midway through the braincase, found the way `hair.js` finds the centre of
 * its shell and for the same reasons.
 */
export function headCentre(template) {
  const body = template.submeshes.find((submesh) => submesh.primary);
  const head = template.jointByBone.get("head");
  if (!body || !head) return null;
  const count = body.positions.length / 3;
  let ymin = Infinity;
  let ymax = -Infinity;
  const isHead = new Uint8Array(count);
  for (let v = 0; v < count; v += 1) {
    let w = 0;
    for (let k = 0; k < 4; k += 1) if (body.joints[v * 4 + k] === head.index) w += body.weights[v * 4 + k];
    if (w < 0.35) continue;
    isHead[v] = 1;
    ymin = Math.min(ymin, body.positions[v * 3 + 1]);
    ymax = Math.max(ymax, body.positions[v * 3 + 1]);
  }
  if (!Number.isFinite(ymin)) return null;
  const cy = ymax - 0.42 * (ymax - ymin);
  let zmin = Infinity;
  let zmax = -Infinity;
  for (let v = 0; v < count; v += 1) {
    if (!isHead[v] || body.positions[v * 3 + 1] < cy) continue;
    zmin = Math.min(zmin, body.positions[v * 3 + 2]);
    zmax = Math.max(zmax, body.positions[v * 3 + 2]);
  }
  return [0, cy, (zmin + zmax) / 2];
}

/**
 * How much of a card's shading normal is its own facet, and how much the
 * direction out of the head's centre.
 *
 * All facet and the head shades as what it geometrically is, a few thousand
 * separate strips at slightly different angles: every strip catches the key on
 * its own and the crown breaks into a patchwork of lit and dark tiles, the
 * signature of a game character's hair. All radial and every card on the head
 * shades as one smooth sphere, which is the shell again. Most of the way to
 * radial is what hair does, because a head of hair scatters like the volume it
 * fills rather than like the strips it is made of - and the facet share left
 * over is what still breaks the highlight up along the locks.
 */
const RADIAL = 0.6;

/**
 * One trim, fitted to this template's body, as a submesh.
 *
 * @param {object} template carrying `cards` (see `withCards`)
 * @param {string} trim a key of cards.bin's trims
 * @param {object} options
 * @param {string} options.name the submesh's name
 * @param {number[]} options.colour sRGB 0..1, what the card averages to
 * @returns {object|null} null if this template has no cards or no such trim
 */
export function cardSubmesh(template, trim, { name, colour }) {
  const { shared, fitted } = template.cards ?? {};
  const meta = shared?.meta.trims[trim];
  if (!meta) return null;
  const quantised = fitted.arrays[`${trim}.positions`];
  const indices = Uint32Array.from(shared.arrays[`${trim}.indices`]);
  const packedUVs = shared.arrays[`${trim}.uvs`];
  const packedJoints = shared.arrays[`${trim}.joints`];
  const packedWeights = shared.arrays[`${trim}.weights`];
  const count = meta.vertices;

  const positions = new Float32Array(count * 3);
  for (let v = 0; v < count; v += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const t = (quantised[v * 3 + axis] + 32767) / 65534;
      positions[v * 3 + axis] = CARD_BOX.min[axis] + t * (CARD_BOX.max[axis] - CARD_BOX.min[axis]);
    }
  }
  const uvs = new Float32Array(count * 2);
  for (let i = 0; i < uvs.length; i += 1) uvs[i] = packedUVs[i] / 65535;

  const byName = new Map(template.joints.map((joint) => [joint.name, joint.index]));
  const bones = meta.bones.map((bone) => {
    if (!byName.has(bone)) throw new Error(`${trim} is weighted to ${bone}, which this body has no joint for`);
    return byName.get(bone);
  });
  const joints = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i += 1) {
    joints[i] = bones[packedJoints[i]];
    weights[i] = packedWeights[i] / 255;
  }

  // Facet normals, area-weighted, each turned to face out of the head before
  // it is summed - MakeHuman winds its strips whichever way they were modelled,
  // and a vertex shared by two strips wound opposite ways would average to
  // nothing. The triangle is rewound to match: a renderer drawing both sides
  // turns the normal round on whichever it takes for the back, and it can only
  // tell which that is from the winding.
  const centre = headCentre(template) ?? [0, 0.93, 0];
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    const ux = positions[b * 3] - positions[a * 3];
    const uy = positions[b * 3 + 1] - positions[a * 3 + 1];
    const uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3];
    const vy = positions[c * 3 + 1] - positions[a * 3 + 1];
    const vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const ox = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3 - centre[0];
    const oy = (positions[a * 3 + 1] + positions[b * 3 + 1] + positions[c * 3 + 1]) / 3 - centre[1];
    const oz = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3 - centre[2];
    if (nx * ox + ny * oy + nz * oz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
      indices[i + 1] = c;
      indices[i + 2] = b;
    }
    for (const v of [a, b, c]) {
      normals[v * 3] += nx;
      normals[v * 3 + 1] += ny;
      normals[v * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < count; v += 1) {
    const facet = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    const rx = positions[v * 3] - centre[0];
    const ry = positions[v * 3 + 1] - centre[1];
    const rz = positions[v * 3 + 2] - centre[2];
    const radius = Math.hypot(rx, ry, rz) || 1;
    const nx = (normals[v * 3] / facet) * (1 - RADIAL) + (rx / radius) * RADIAL;
    const ny = (normals[v * 3 + 1] / facet) * (1 - RADIAL) + (ry / radius) * RADIAL;
    const nz = (normals[v * 3 + 2] / facet) * (1 - RADIAL) + (rz / radius) * RADIAL;
    const length = Math.hypot(nx, ny, nz) || 1;
    normals[v * 3] = nx / length;
    normals[v * 3 + 1] = ny / length;
    normals[v * 3 + 2] = nz / length;
  }

  return {
    name,
    primary: false,
    colour,
    hair: true,
    // What the renderers need to draw it as cards rather than as a surface:
    // the texture by name (theirs to find), and the factor that brings its
    // stretched grey back to an average of one.
    cards: { texture: meta.texture, gain: meta.gain },
    // Which trim it is, for what moves it after it is made (see `withExpression`).
    trim,
    positions,
    normals,
    uvs,
    indices,
    joints,
    weights,
  };
}

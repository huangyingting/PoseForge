/**
 * A glTF 2.0 / GLB reader, in plain JavaScript.
 *
 * There is a perfectly good `GLTFLoader` in three.js and this deliberately does
 * not use it. `src/core/` has no dependencies - that is what lets the
 * validators and the headless renderer run the real geometry in plain Node,
 * without a browser or a GPU - and a model that could only be read through
 * three.js would put the body mesh on the wrong side of that line. The mesh is
 * geometry, so it belongs where the rest of the geometry is.
 *
 * The scope is exactly what the bundled MakeHuman bodies need and no more:
 * a single binary chunk, no extensions, no Draco, no sparse accessors. Anything
 * outside that throws rather than silently producing a wrong body. That is a
 * defensible limit because the models ship with the repo - this is not a
 * general asset pipeline, it is a reader for two known files.
 */

const MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** Element count per accessor type. */
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

/**
 * Component type -> [byte size, DataView getter name, normalisation divisor].
 * The divisor is what turns a `normalized` integer attribute back into the
 * 0..1 or -1..1 range it stands for; joint weights arrive that way.
 */
const COMPONENT_TYPES = {
  5120: [1, "getInt8", 127],
  5121: [1, "getUint8", 255],
  5122: [2, "getInt16", 32767],
  5123: [2, "getUint16", 65535],
  5125: [4, "getUint32", 4294967295],
  5126: [4, "getFloat32", 1],
};

/**
 * Split a GLB container into its JSON and binary chunks.
 *
 * @param {ArrayBuffer|Uint8Array} source
 * @returns {{json: object, bin: DataView}}
 */
export function parseGLB(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 12 || view.getUint32(0, true) !== MAGIC) {
    throw new Error("Not a GLB file");
  }
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`Unsupported GLB version ${version}`);

  let json = null;
  let bin = null;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length)));
    } else if (type === CHUNK_BIN) {
      bin = new DataView(bytes.buffer, bytes.byteOffset + start, length);
    }
    // Chunks are padded to a four-byte boundary; the padding is not counted in
    // `length`, so stepping by `length` alone desynchronises on the second
    // chunk of any model whose JSON is not a multiple of four bytes long.
    offset = start + length;
    offset += (4 - (offset % 4)) % 4;
  }
  if (!json) throw new Error("GLB has no JSON chunk");

  if (json.extensionsRequired?.length) {
    throw new Error(`Unsupported glTF extensions: ${json.extensionsRequired.join(", ")}`);
  }
  return { json, bin };
}

/**
 * Read one accessor into a flat array.
 *
 * Every read goes through `DataView` rather than a typed-array view over the
 * buffer. A typed array needs its byte offset aligned to the component size and
 * nothing guarantees that here: the binary chunk starts wherever the JSON chunk
 * happened to end, and in Node a `Buffer` is a window into a shared pool at an
 * arbitrary offset. Typed-array views are faster, but this runs once per model.
 *
 * @param {{json: object, bin: DataView}} gltf
 * @param {number} index accessor index
 * @param {boolean} [normalize] apply the accessor's `normalized` flag
 * @returns {Float64Array|Uint32Array} flat, `count * components` long
 */
export function readAccessor(gltf, index, normalize = true) {
  const accessor = gltf.json.accessors?.[index];
  if (!accessor) throw new Error(`No accessor ${index}`);
  if (accessor.sparse) throw new Error("Sparse accessors are not supported");

  const components = COMPONENTS[accessor.type];
  const spec = COMPONENT_TYPES[accessor.componentType];
  if (!components || !spec) throw new Error(`Unsupported accessor ${accessor.type}/${accessor.componentType}`);
  const [size, getter, divisor] = spec;
  const total = accessor.count * components;

  // Indices and joint ids stay integral; everything else becomes float. Joint
  // indices in particular must not be scaled by the normalisation divisor.
  const integral = accessor.type === "SCALAR" || !normalize || !accessor.normalized;
  const out = accessor.componentType === 5125 || accessor.componentType === 5123 || accessor.componentType === 5121
    ? (accessor.normalized && normalize ? new Float64Array(total) : new Uint32Array(total))
    : new Float64Array(total);

  if (accessor.bufferView === undefined) return out; // spec-legal: all zeroes

  const bufferView = gltf.json.bufferViews[accessor.bufferView];
  if (!gltf.bin) throw new Error("Accessor needs a binary chunk that is not present");
  const base = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  // Interleaved data has an explicit stride; tightly packed data does not.
  const stride = bufferView.byteStride || components * size;
  const scale = accessor.normalized && normalize && !integral ? 1 / divisor : 1;

  for (let i = 0; i < accessor.count; i += 1) {
    const at = base + i * stride;
    for (let c = 0; c < components; c += 1) {
      out[i * components + c] = gltf.bin[getter](at + c * size, true) * scale;
    }
  }
  return out;
}

/**
 * Local transform of a node as a column-major 4x4.
 *
 * glTF allows either an explicit `matrix` or a TRS triple, never both.
 */
export function nodeLocalMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const m = [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
  return m;
}

/**
 * Parent index per node, derived from the `children` lists.
 * @returns {Int32Array} -1 for roots
 */
export function nodeParents(json) {
  const parents = new Int32Array(json.nodes.length).fill(-1);
  json.nodes.forEach((node, i) => {
    for (const child of node.children ?? []) parents[child] = i;
  });
  return parents;
}

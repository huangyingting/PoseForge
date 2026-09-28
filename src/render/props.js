/**
 * Furniture.
 *
 * The solver already knows the boxes - it collides against them, and a partner
 * bent over a table is bent over *that* table, at that height. So the renderer
 * builds its geometry from the same `props` array rather than from a parallel
 * set of models, for the same reason the body mesh comes out of the collision
 * field: two descriptions of the same object drift apart, and then the figure
 * is leaning on thin air an inch above the visible surface.
 *
 * A ball or a wedge is drawn as the shape the solver collides with, not as its
 * bounding box, for the same reason.
 *
 * The furniture people sit and lie on is made the way it is made, inside that
 * box: a bed is a mattress on a divan on four feet, a sofa its frame with its
 * seat cushions on top and its back cushions behind, a table a top on legs,
 * each in cloth or wood rather than in one smooth colour, with its edges
 * rounded. A solid block the size of a bed is a plinth, and a room with a
 * plinth in it is a gallery. Everything the solver leans on - the top of the
 * mattress, the front of the back cushions - is still the box's face, so a
 * figure lying on the bed lies on the sheet. Nothing is added past the box
 * except under it: a sofa's back does not stop in the air above the floor.
 */

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShadowMaterial,
} from "three";
import { propOutline, propShape, propTriangles } from "../core/propShapes.js";
import { clothFinish, WOOD_TILE, woodFinish } from "./room.js";

const PALETTE = {
  bed: 0xe8e2d9,
  "bed-frame": 0x6d5c4a,
  sofa: 0x8d9aa6,
  "sofa-back": 0x7d8a96,
  chair: 0x9a8570,
  "chair-back": 0x9a8570,
  table: 0xb4a084,
  "table-leg": 0x9c8a70,
  bench: 0xa89680,
  ball: 0xc9d6dc,
  wedge: 0xb9a48c,
  ottoman: 0x8f8b86,
  wall: 0xe6e1d8,
  "car-seat": 0x5b5f66,
  "car-seat-back": 0x53575e,
  "car-roof": 0x9fb4c2,
  "car-door": 0x9fb4c2,
  "car-glass": 0x9fb4c2,
  "car-front-seat": 0x53575e,
  "swing-seat": 0x3f7f86,
  "swing-strap": 0x4a8e94,
  "swing-bar": 0x8c9096,
  "swing-chain": 0x7d8187,
  sling: 0x3b3a3c,
  "sling-chain": 0x7d8187,
  "sling-bar": 0x8c9096,
  pole: 0xc9b08a,
  stair: 0xb09a80,
  pillow: 0xf0e4cc,
  // A floor cushion and the wedge behind it, brought for a figure left sitting
  // or leaning back on nothing (see `supports.js`).
  cushion: 0xa89684,
  backrest: 0x9a8876,
  "spreader-bar": 0x8c9096,
  chain: 0x7d8187,
  default: 0x9b9b9b,
};

// How much of a car's shell shows. Glass is barely there; the front seats are
// solid enough to read as seats without hiding a foot behind them.
const SHELL_OPACITY = { "car-front-seat": 0.22, default: 0.1 };

/**
 * A box, or for a ball or a wedge the solver's own surface. That is built in
 * world space, so the mesh stays at the origin.
 */
function propGeometry(prop) {
  if (propShape(prop) === "box") return new BoxGeometry(...prop.size);
  const { positions, normals, indices } = propTriangles(prop);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Furniture as it is made                                             */
/* ------------------------------------------------------------------ */

/** How much of a weave one tile covers on a sheet and on upholstery, in metres. */
const SHEET_TILE = 0.012;
const UPHOLSTERY_TILE = 0.03;

/** What the rest of each piece is made of, beside its own colour. */
const DIVAN = 0x8f877d;
const FEET = 0x43352a;

/**
 * A box with its edges rounded to `radius`, moved to `at`, with its UVs in
 * tiles of `tile` metres and `u` along each face's longer side - so a board's
 * grain runs down it. The flat of each face is one quad; only the rounding is
 * cut up, into `bevel` steps.
 */
function roundedBox(size, radius, at = [0, 0, 0], tile = 1, bevel = 3) {
  const r = Math.max(1e-4, Math.min(radius, ...size.map((s) => s / 2 - 1e-4)));
  const n = bevel * 2 + 1;
  // A unit box cut in an odd number of steps has no vertex at the middle of a
  // face, so each is on one side or the other of it, and the middle step is
  // the flat. Every vertex goes out from the inner box - the box less the
  // rounding - along its own direction from that step's edge.
  const geometry = new BoxGeometry(1, 1, 1, n, n, n);
  const inner = size.map((s) => s / 2 - r);
  const half = 0.5 / n;
  const { position, normal, uv } = geometry.attributes;
  for (let i = 0; i < position.count; i += 1) {
    const p = [position.getX(i), position.getY(i), position.getZ(i)];
    const q = p.map((v) => v - Math.sign(v) * half);
    const length = Math.hypot(...q);
    const out = q.map((v) => v / length);
    const point = out.map((v, k) => Math.sign(p[k]) * inner[k] + v * r + at[k]);
    const face = [normal.getX(i), normal.getY(i), normal.getZ(i)].findIndex((v) => Math.abs(v) > 0.5);
    const [a, b] = [[2, 1], [0, 2], [0, 1]][face];
    const [u, v] = size[a] >= size[b] ? [a, b] : [b, a];
    position.setXYZ(i, ...point);
    normal.setXYZ(i, ...out);
    uv.setXY(i, point[u] / tile, point[v] / tile);
  }
  return geometry;
}

/** A piece's parts as one geometry, with a group for each material. */
function assemble(parts) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const geometry = new BufferGeometry();
  for (const { geometry: part, material } of [...parts].sort((a, b) => a.material - b.material)) {
    const base = positions.length / 3;
    const start = indices.length;
    positions.push(...part.attributes.position.array);
    normals.push(...part.attributes.normal.array);
    uvs.push(...part.attributes.uv.array);
    for (const k of part.index.array) indices.push(base + k);
    const last = geometry.groups.at(-1);
    if (last?.materialIndex === material) last.count += indices.length - start;
    else geometry.addGroup(start, indices.length - start, material);
    part.dispose();
  }
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

const cloth = (size, radius, at, tile = UPHOLSTERY_TILE) => roundedBox(size, radius, at, tile);
const timber = (size, at, radius = 0.005) => roundedBox(size, radius, at, WOOD_TILE, 1);
/** Four of `make`, one at each corner `inset` in from a box `w` by `d`. */
const corners = (w, d, inset, make) => [-1, 1].flatMap((x) => [-1, 1].map((z) => make(x * (w / 2 - inset), z * (d / 2 - inset), x, z)));

/**
 * The pieces, each a function of the prop's box, its colour, and where the
 * floor is below the box's bottom, that returns its parts about the box's
 * centre and the materials they are in.
 */
const PIECES = {
  bed([w, h, d], colour) {
    const mattress = 0.24;
    const foot = 0.06;
    const base = h - mattress - foot;
    if (base < 0.08) return { materials: [clothFinish(colour)], parts: [{ geometry: cloth([w, h, d], 0.05, undefined, SHEET_TILE), material: 0 }] };
    return {
      // Percale is a close, flat weave, and a sheet pulled tight is flatter still.
      materials: [clothFinish(colour, { normalScale: 0.45 }), clothFinish(DIVAN), woodFinish(FEET)],
      parts: [
        { geometry: cloth([w, mattress, d], 0.05, [0, h / 2 - mattress / 2, 0], SHEET_TILE), material: 0 },
        { geometry: cloth([w - 0.03, base + 0.01, d - 0.03], 0.02, [0, -h / 2 + foot + base / 2, 0]), material: 1 },
        ...corners(w, d, 0.15, (x, z) => ({ geometry: timber([0.07, foot + 0.01, 0.07], [x, -h / 2 + (foot + 0.01) / 2, z]), material: 2 })),
      ],
    };
  },

  sofa([w, h, d], colour) {
    const foot = 0.06;
    const cushion = Math.min(0.14, 0.3 * h);
    const frame = h - foot - cushion;
    const count = Math.max(1, Math.round(w / 0.7));
    const each = w / count;
    return {
      materials: [clothFinish(colour), woodFinish(FEET)],
      parts: [
        { geometry: cloth([w, frame + 0.01, d], 0.03, [0, -h / 2 + foot + frame / 2, 0]), material: 0 },
        ...Array.from({ length: count }, (_, k) => ({
          geometry: cloth([each - 0.008, cushion, d], 0.05, [-w / 2 + each * (k + 0.5), h / 2 - cushion / 2, 0]),
          material: 0,
        })),
        ...corners(w, d, 0.08, (x, z) => ({ geometry: timber([0.05, foot + 0.01, 0.05], [x, -h / 2 + (foot + 0.01) / 2, z]), material: 1 })),
      ],
    };
  },

  "sofa-back"([w, h, d], colour, floor) {
    const count = Math.max(1, Math.round(w / 0.7));
    const each = w / count;
    const parts = Array.from({ length: count }, (_, k) => ({ geometry: cloth([each - 0.008, h, d], 0.07, [-w / 2 + each * (k + 0.5), 0, 0]), material: 0 }));
    // The frame the cushions stand on, behind the seat, down to the floor.
    if (floor > 0.01) parts.push({ geometry: cloth([w, floor + 0.02, d], 0.02, [0, -h / 2 - floor / 2 + 0.01, 0]), material: 0 });
    return { materials: [clothFinish(colour)], parts };
  },

  chair([w, h, d], colour) {
    const seat = 0.045;
    const leg = 0.04;
    const apron = 0.07;
    const rail = (size, at) => ({ geometry: timber(size, at), material: 0 });
    const y = h / 2 - seat - apron / 2;
    const reach = (s) => s / 2 - 0.01 - leg / 2;
    return {
      materials: [woodFinish(colour)],
      parts: [
        rail([w, seat, d], [0, h / 2 - seat / 2, 0]),
        ...corners(w, d, 0.01 + leg / 2, (x, z) => rail([leg, h - seat + 0.002, leg], [x, -h / 2 + (h - seat) / 2 + 0.001, z])),
        ...[-1, 1].map((s) => rail([w - 2 * (leg + 0.01), apron, 0.02], [0, y, s * reach(d)])),
        ...[-1, 1].map((s) => rail([0.02, apron, d - 2 * (leg + 0.01)], [s * reach(w), y, 0])),
      ],
    };
  },

  /**
   * Two posts with a rail across the top and one at the seat, and two slats
   * between them, on the side of the box the seat is on so that the back
   * meets it.
   */
  "chair-back"([w, h, d], colour, floor, facing = 0) {
    const post = 0.04;
    const top = 0.08;
    const low = 0.04;
    // The bottom rail sits on the seat, which the box's bottom is a little below.
    const seat = -h / 2 + 0.03;
    const z = facing * (d / 2 - post / 2);
    const part = (size, at) => ({ geometry: timber(size, at), material: 0 });
    const slat = h / 2 - top - (seat + low);
    return {
      materials: [woodFinish(colour)],
      parts: [
        ...[-1, 1].map((s) => part([post, h, post], [s * (w / 2 - post / 2), 0, z])),
        part([w, top, 0.03], [0, h / 2 - top / 2, z]),
        part([w - 2 * post, low, 0.025], [0, seat + low / 2, z]),
        ...[-1, 1].map((s) => part([0.05, slat + 0.004, 0.018], [s * w * 0.16, seat + low + slat / 2, z])),
      ],
    };
  },

  table([w, h, d], colour) {
    if (h <= 0.1) return { materials: [woodFinish(colour, 0.45)], parts: [{ geometry: timber([w, h, d], undefined, 0.006), material: 0 }] };
    const top = 0.04;
    const leg = 0.06;
    const inset = 0.05;
    const apron = 0.09;
    const y = h / 2 - top - apron / 2;
    const part = (size, at) => ({ geometry: timber(size, at), material: 0 });
    const reach = (s) => s / 2 - inset - leg / 2;
    return {
      materials: [woodFinish(colour, 0.45)],
      parts: [
        part([w, top, d], [0, h / 2 - top / 2, 0]),
        ...corners(w, d, inset + leg / 2, (x, z) => part([leg, h - top + 0.002, leg], [x, -top / 2 + 0.001, z])),
        ...[-1, 1].map((s) => part([w - 2 * (inset + leg), apron, 0.022], [0, y, s * reach(d)])),
        ...[-1, 1].map((s) => part([0.022, apron, d - 2 * (inset + leg)], [s * reach(w), y, 0])),
      ],
    };
  },

  "table-leg"(size, colour) {
    return { materials: [woodFinish(colour, 0.45)], parts: [{ geometry: timber(size), material: 0 }] };
  },

  bench([w, h, d], colour) {
    const pad = 0.1;
    const leg = 0.05;
    return {
      materials: [clothFinish(colour), woodFinish(FEET)],
      parts: [
        { geometry: cloth([w, pad, d], 0.03, [0, h / 2 - pad / 2, 0]), material: 0 },
        ...corners(w, d, 0.06, (x, z) => ({ geometry: timber([leg, h - pad + 0.01, leg], [x, -h / 2 + (h - pad + 0.01) / 2, z]), material: 1 })),
        ...[-1, 1].map((s) => ({ geometry: timber([0.025, 0.04, d - 0.12], [s * (w / 2 - 0.06), -h / 2 + 0.12, 0]), material: 1 })),
      ],
    };
  },

  ottoman([w, h, d], colour) {
    const foot = 0.05;
    return {
      materials: [clothFinish(colour), woodFinish(FEET)],
      parts: [
        { geometry: cloth([w, h - foot, d], 0.05, [0, foot / 2, 0]), material: 0 },
        ...corners(w, d, 0.06, (x, z) => ({ geometry: timber([0.045, foot + 0.01, 0.045], [x, -h / 2 + (foot + 0.01) / 2, z]), material: 1 })),
      ],
    };
  },

  stair(size, colour) {
    return { materials: [woodFinish(colour, 0.5)], parts: [{ geometry: timber(size, undefined, 0.006), material: 0 }] };
  },
};

// Soft things are one cushion each, as round at the edges as they are thick.
for (const kind of ["cushion", "backrest", "pillow"])
  PIECES[kind] = (size, colour) => ({
    materials: [clothFinish(colour)],
    parts: [{ geometry: cloth(size, Math.min(0.06, 0.35 * Math.min(...size))), material: 0 }],
  });

/** The side of a chair-back its seat is on: +1 or -1 along its thinner way. */
function seatSide(prop, props) {
  const across = prop.size[0] < prop.size[2] ? 0 : 2;
  const seat = props.find(
    (other) =>
      other.kind === "chair" &&
      [0, 1, 2].every((k) => Math.abs(other.center[k] - prop.center[k]) <= (other.size[k] + prop.size[k]) / 2 + 0.01)
  );
  return { across, facing: seat ? Math.sign(seat.center[across] - prop.center[across]) || 1 : 0 };
}

/** The twelve edges of a prop's box, in the world, for the line art. */
function boxOutline({ size, center }) {
  const corner = (i) => [0, 1, 2].map((k) => center[k] + ((i >> (2 - k)) & 1 ? 0.5 : -0.5) * size[k]);
  const pairs = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
  return pairs.map(([a, b]) => [corner(a), corner(b)]);
}

/**
 * A piece of furniture as it is made, or null for a prop with no piece. Its
 * lines in the line art are still the box's: the solver's surface, and the
 * lines the eye reads a table by.
 */
function furniture(prop, props) {
  const make = PIECES[prop.kind];
  if (!make || propShape(prop) !== "box") return null;
  const colour = PALETTE[prop.kind] ?? PALETTE.default;
  const floor = prop.center[1] - prop.size[1] / 2;
  let piece;
  if (prop.kind === "chair-back") {
    // Built with its thin way along z, and turned if it is the other way.
    const { across, facing } = seatSide(prop, props);
    const size = across === 0 ? [prop.size[2], prop.size[1], prop.size[0]] : prop.size;
    piece = make(size, colour, floor, facing);
    if (across === 0) piece.parts.forEach((part) => part.geometry.rotateY(Math.PI / 2));
  } else piece = make(prop.size, colour, floor);
  const mesh = new Mesh(assemble(piece.parts), piece.materials);
  mesh.userData.edges = boxOutline(prop);
  return mesh;
}

function propMesh(prop, props = [prop]) {
  const made = furniture(prop, props);
  if (made) {
    made.position.set(...prop.center);
    made.userData.shape = "box";
    made.castShadow = true;
    made.receiveShadow = true;
    made.name = prop.kind;
    return made;
  }
  const colour = PALETTE[prop.kind] ?? PALETTE.default;
  const material = new MeshStandardMaterial({
    color: new Color(colour),
    roughness: prop.kind.startsWith("bed") || prop.kind === "cushion" || prop.kind === "backrest" ? 0.95 : prop.kind === "ball" ? 0.45 : 0.78,
    metalness: 0,
  });
  const mesh = new Mesh(propGeometry(prop), material);
  if (propShape(prop) === "box")
    mesh.position.set(prop.center[0], prop.center[1], prop.center[2]);
  mesh.userData.shape = propShape(prop);
  // Line art draws a prism's hard edges, which its geometry alone does not say.
  if (propShape(prop) === "prism") mesh.userData.edges = propOutline(prop);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = prop.kind;
  return mesh;
}

/**
 * A see-through panel of a car's shell, with its edges drawn so the cabin
 * reads as a box around the figures rather than a haze.
 */
function shellMesh(prop) {
  const colour = new Color(PALETTE[prop.kind] ?? PALETTE.default);
  const geometry = new BoxGeometry(...prop.size);
  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({
      color: colour,
      roughness: 0.3,
      metalness: 0,
      transparent: true,
      opacity: SHELL_OPACITY[prop.kind] ?? SHELL_OPACITY.default,
      depthWrite: false,
      side: DoubleSide,
    })
  );
  mesh.position.set(prop.center[0], prop.center[1], prop.center[2]);
  // Drawn after the figures, so they show through it.
  mesh.renderOrder = 2;
  mesh.name = prop.kind;
  const edges = new LineSegments(
    new EdgesGeometry(geometry),
    new LineBasicMaterial({ color: colour.clone().multiplyScalar(0.7), transparent: true, opacity: 0.45, depthWrite: false })
  );
  edges.renderOrder = 2;
  mesh.add(edges);
  return mesh;
}

/**
 * The ground.
 *
 * Shadow-receiving only, with no colour of its own beyond a wash, so the
 * contact shadow under the figures is the thing that reads. That shadow is what
 * tells the eye where the floor is; a textured floor plane competes with it.
 */
function groundMesh() {
  const material = new ShadowMaterial({
    color: new Color(0x35443a),
    opacity: 0.18,
  });
  const mesh = new Mesh(new PlaneGeometry(200, 200), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = "ground";
  return mesh;
}

/**
 * Build the furniture for a solved scene.
 *
 * A car's shell goes in a group of its own, named "shell", so the line-art
 * export can leave it out: it is glass, and outlining it would bury the
 * figures behind it.
 * @param {Array<{kind:string, size:number[], center:number[], shape?:string, profile?:number[][]}>} props
 * @param {{ground?: boolean, shell?: Array<{kind:string, size:number[], center:number[]}>}} [options]
 * @returns {Group}
 */
export function buildProps(props, { ground = true, shell = [] } = {}) {
  const group = new Group();
  group.name = "props";
  if (ground) group.add(groundMesh());
  for (const prop of props ?? []) group.add(propMesh(prop, props));
  if (shell?.length) {
    const cabin = new Group();
    cabin.name = "shell";
    for (const panel of shell) cabin.add(shellMesh(panel));
    group.add(cabin);
  }
  return group;
}

/**
 * Release the geometry and materials a prop group owns. `release` is handed
 * each material, for a caller that wants to let go of them later than now.
 */
export function disposeProps(group, release = (material) => material.dispose()) {
  group.traverse((node) => {
    if (!node.isMesh && !node.isLineSegments) return;
    node.geometry.dispose();
    for (const material of [].concat(node.material)) release(material);
  });
}

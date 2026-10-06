/**
 * The places a scene can be set in that are not rooms: a beach, a pool on a
 * terrace over the sea, and a photographer's studio with its paper sweep.
 *
 * Each is laid out as a room is (see `roomLayout` in `room.js`) - the same
 * clear ground kept round the figures, `half` of it each way - and built the
 * same way. What lies flat and what is far - the sand and the sea, the deck and
 * the pool, the sky, the headlands - is always drawn. What stands about is put
 * just beyond the clear ground, in four sides that hide, as a room's walls do,
 * when the camera is past them and they would stand between it and the figures.
 *
 * As in the room, every picture is drawn in code on the worker (see
 * `placeTiles.js`), and most of what stands is a mesh or two of its own: a
 * palm is its trunk and its fronds, a stand its rods, whatever it is made of.
 */

import {
  BackSide,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { seeded } from "./roomTiles.js";
import {
  board,
  boards,
  box,
  channels,
  clothFinish,
  finished,
  grainedBox,
  laid,
  LINEN_TILE,
  linen,
  made,
  mesh,
  pattern,
  picture,
  plaster,
  PLASTER_TILE,
  standard,
  steps,
  surface,
  tiled,
  wood,
  woodFinish,
} from "./roomKit.js";

/**
 * The haze on the horizon, which the sky fades down to and the distance fades
 * into (see the fog in `renderer.js`): the two must be the one colour, or the
 * sea would end at a line. Brighter than white, as linear light, since the
 * exposure takes a fifth off everything.
 */
export const HAZE = 0xe2eaee;
export const SKY_GAIN = 1.25;

/** How much of each surface one tile covers, in metres. */
const SAND_TILE = 1;
const WATER_TILE = 3;
const FOAM_TILE = 3;
const PAVER_TILE = 1.2;
const MOSAIC_TILE = 0.4;
const CAUSTIC_TILE = 1.4;
const CONCRETE_TILE = 2;
const TERRY_TILE = 0.02;
const TERRY = { size: 128, threads: 16, slub: 0.9, strength: 2.5, seed: 0x74657279 };

const sand = made(() => ["sand"], surface);
const water = made(() => ["water"], surface);
const foam = made(() => ["foam"], pattern);
const towel = made((colours) => ["towel", colours.map(channels)], picture);
const terry = made(() => ["weave", TERRY], surface);
const pavers = made(() => ["paver"], surface);
const mosaic = made(() => ["mosaic"], boards);
const caustic = made(() => ["caustic"], pattern);
const concrete = made(() => ["concrete"], surface);

const BEACH_TOWEL = [0x2b7aa3, 0xf3eee4, 0xe2a43a];
/** A towel where a room has its rug: as big as a big beach towel gets, if the rug is bigger. */
const towelSize = (layout) => [Math.min(layout.rug.size[0], 2.4), Math.min(layout.rug.size[1], 2)];
const POOL_TOWEL = [0xf1ece3, 0x27344a, 0x27344a];

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Values from each `[from, to, by]` span, merged and in order: a grid finer where it is wanted. */
function ticks(...spans) {
  const values = new Set();
  for (const [from, to, by] of spans) {
    for (let v = from; v < to - 1e-6; v += by) values.add(+v.toFixed(4));
    values.add(+to.toFixed(4));
  }
  return [...values].sort((a, b) => a - b);
}

/**
 * A sheet of quads over a grid of `columns` by `rows` points, facing up when
 * the rows run north to south and the columns west to east: `point(i, j)` gives
 * each one's position, UV and, if it has one, colour (three channels, or four
 * with an alpha).
 */
function sheet(columns, rows, point) {
  const count = columns * rows;
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  let colours = null;
  for (let j = 0; j < rows; j += 1)
    for (let i = 0; i < columns; i += 1) {
      const k = j * columns + i;
      const { position, uv, colour } = point(i, j);
      positions.set(position, k * 3);
      uvs.set(uv, k * 2);
      if (colour) (colours ??= new Float32Array(count * colour.length)).set(colour, k * colour.length);
    }
  const index = [];
  for (let j = 0; j < rows - 1; j += 1)
    for (let i = 0; i < columns - 1; i += 1) {
      const a = j * columns + i;
      index.push(a, a + columns, a + 1, a + 1, a + columns, a + columns + 1);
    }
  const geometry = new BufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  if (colours) geometry.setAttribute("color", new Float32BufferAttribute(colours, colours.length / count));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Ground over the grid `xs` by `zs`: `vertex(x, z)` gives each point's height
 * and colour, and the UVs are in tiles of `tile` metres.
 */
function ground(xs, zs, vertex, tile) {
  return sheet(xs.length, zs.length, (i, j) => {
    const [x, z] = [xs[i], zs[j]];
    const [y, ...colour] = vertex(x, z);
    return { position: [x, y, z], uv: [x / tile, -z / tile], colour };
  });
}

/**
 * Pieces in colours, as one geometry: each `{geometry, matrix, colour}`. A
 * stand is a dozen rods and a rack a dozen garments, and drawn one to a mesh
 * they would be a dozen draws for one thing at the edge of the picture.
 */
function merged(parts) {
  const positions = [];
  const normals = [];
  const colours = [];
  const p = new Vector3();
  const turn = new Matrix3();
  for (const { geometry, matrix = new Matrix4(), colour = new Color(1, 1, 1) } of parts) {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const position = flat.attributes.position;
    const normal = flat.attributes.normal;
    turn.getNormalMatrix(matrix);
    for (let i = 0; i < position.count; i += 1) {
      p.fromBufferAttribute(position, i).applyMatrix4(matrix);
      positions.push(p.x, p.y, p.z);
      p.fromBufferAttribute(normal, i).applyMatrix3(turn).normalize();
      normals.push(p.x, p.y, p.z);
      colours.push(colour.r, colour.g, colour.b);
    }
    if (flat !== geometry) flat.dispose();
    geometry.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  return geometry;
}

const UP = new Vector3(0, 1, 0);
const placed = (at, quaternion = new Quaternion(), scale = new Vector3(1, 1, 1)) =>
  new Matrix4().compose(new Vector3(...at), quaternion, scale);

/** A rod from `from` to `to`, as a part for `merged`. */
function rod(from, to, radius, colour) {
  const [a, b] = [new Vector3(...from), new Vector3(...to)];
  const along = b.clone().sub(a);
  const middle = a.clone().add(b).multiplyScalar(0.5);
  return {
    geometry: new CylinderGeometry(radius, radius, along.length(), 8, 1),
    matrix: placed(middle.toArray(), new Quaternion().setFromUnitVectors(UP, along.normalize())),
    colour: colour && new Color(colour),
  };
}

/** One mesh of `merged` parts, its colours on its vertices. */
function assembled(parts, options = {}, { cast = true } = {}) {
  return mesh(merged(parts), standard(0xffffff, { vertexColors: true, ...options }), { cast });
}

/* ------------------------------------------------------------------ */
/* Sky and sea                                                         */
/* ------------------------------------------------------------------ */

const SKY_RADIUS = 40;

/**
 * The sky: a dome round the place, haze at the horizon going up through a
 * pale blue to a deeper one overhead, and haze below it too, which is where
 * the distance shows through past the sea's end. Drawn first and behind
 * everything, out of the fog, the sky's own colour.
 */
function skyDome() {
  const geometry = new SphereGeometry(SKY_RADIUS, 48, 20, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const position = geometry.attributes.position;
  const colour = new Float32Array(position.count * 3);
  const [haze, pale, zenith] = [HAZE, 0xa7c8e6, 0x5893d0].map((hex) => new Color(hex).multiplyScalar(SKY_GAIN));
  const c = new Color();
  for (let i = 0; i < position.count; i += 1) {
    const up = position.getY(i) / SKY_RADIUS;
    if (up < 0.2) c.lerpColors(haze, pale, smooth(0, 0.2, up));
    else c.lerpColors(pale, zenith, smooth(0.2, 1, up) ** 0.8);
    c.toArray(colour, i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colour, 3));
  const node = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  node.name = "sky";
  node.renderOrder = -1;
  node.userData.outline = false;
  return node;
}

/**
 * Land across the water, low and far. Its colour is the haze's own mix, made
 * once on its vertices rather than left to the fog: the fog that lets the sea
 * fade into the sky by its end would have it white where it stands, and it is
 * hazier at its foot than up its sunny side.
 */
function headland(at, scale, seed) {
  const geometry = new SphereGeometry(1, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const position = geometry.attributes.position;
  const random = seeded(seed);
  const [a, b] = [random() * 6, random() * 6];
  for (let i = 0; i < position.count; i += 1) {
    const angle = Math.atan2(position.getZ(i), position.getX(i));
    const lump = 1 + 0.12 * Math.sin(3 * angle + a) + 0.07 * Math.sin(7 * angle + b);
    position.setXYZ(i, position.getX(i) * lump, position.getY(i) * lump, position.getZ(i) * lump);
  }
  geometry.scale(...scale);
  geometry.computeVertexNormals();
  const [land, haze] = [new Color(0x5a6a55), new Color(HAZE).multiplyScalar(SKY_GAIN)];
  const sun = new Vector3(3.2, 2.6, 1.7).normalize();
  const normal = geometry.attributes.normal;
  const colour = new Float32Array(position.count * 3);
  const c = new Color();
  for (let i = 0; i < position.count; i += 1) {
    const lit = 0.9 + 0.9 * Math.max(0, normal.getX(i) * sun.x + normal.getY(i) * sun.y + normal.getZ(i) * sun.z);
    c.copy(land).multiplyScalar(lit).lerp(haze, 0.55 - 0.25 * (position.getY(i) / scale[1]));
    c.toArray(colour, i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colour, 3));
  const node = mesh(geometry, new MeshBasicMaterial({ vertexColors: true, fog: false }), { cast: false, receive: false });
  node.position.set(...at);
  return node;
}

/** A sail far out, white, on a dark hull. */
function sailboat(at, turn) {
  const sail = new BufferGeometry();
  sail.setAttribute("position", new Float32BufferAttribute([0, 0.35, 0, 0, 4.2, 0, 1.6, 0.35, 0, 0, 0.35, 0, 0, 3.6, 0, -1.3, 0.35, 0], 3));
  sail.computeVertexNormals();
  const node = assembled(
    [
      { geometry: sail, colour: new Color(0xf6f4ef) },
      { geometry: new SphereGeometry(1, 16, 8), matrix: placed([0, 0.15, 0], undefined, new Vector3(2, 0.35, 0.45)), colour: new Color(0x2f3438) },
    ],
    { side: DoubleSide, roughness: 0.7 },
    { cast: false }
  );
  node.position.set(...at);
  node.rotation.y = turn;
  node.scale.setScalar(0.75);
  return node;
}

/* ------------------------------------------------------------------ */
/* What stands about                                                   */
/* ------------------------------------------------------------------ */

/**
 * The four sides of the clear ground, each a group of what stands beyond it,
 * hidden as a room's wall is (see `updateRoom`) when the camera is past it.
 */
function sides(room, half) {
  const side = (name, axis, at, normal) => {
    const group = new Group();
    group.name = `side-${name}`;
    group.userData = { axis, at, normal };
    room.add(group);
    room.userData.walls.push(group);
    return group;
  };
  return {
    north: side("north", 2, -half[1], [0, 0, 1]),
    south: side("south", 2, half[1], [0, 0, -1]),
    west: side("west", 0, -half[0], [1, 0, 0]),
    east: side("east", 0, half[0], [-1, 0, 0]),
  };
}

const at = (node, position, turn = 0) => {
  node.position.set(...position);
  node.rotation.y = turn;
  return node;
};

/**
 * A sun lounger, along its own z with its back raised at -z: a frame of
 * `frame`'s wood on four legs, slats, and a cushion of `cushion`.
 */
function lounger(frame, cushion) {
  const group = new Group();
  for (const side of [-1, 1]) {
    group.add(board([0.045, 0.07, 1.95], frame, [side * 0.31, 0.28, 0]));
    for (const end of [-1, 1]) group.add(board([0.05, 0.25, 0.05], frame, [side * 0.31, 0.125, end * 0.9]));
  }
  group.add(board([0.62, 0.035, 1.25], frame, [0, 0.33, 0.33]));
  const pad = (size, position) => {
    const node = mesh(grainedBox(size, LINEN_TILE), cushion);
    node.position.set(...position);
    return node;
  };
  group.add(pad([0.6, 0.07, 1.22], [0, 0.383, 0.33]));
  // The back, hinged where the bed ends and raised.
  const back = new Group();
  back.position.set(0, 0.33, -0.3);
  back.rotation.x = 0.75;
  back.add(board([0.62, 0.035, 0.66], frame, [0, 0, -0.33]));
  back.add(pad([0.6, 0.07, 0.64], [0, 0.053, -0.33]));
  group.add(back);
  return group;
}

/**
 * A parasol: a pole, a canopy of eight panels in `colours` by turns with a
 * short valance round it, and a weighted base where it stands on stone.
 */
function parasol(colours, pole, { height = 2.35, radius = 1.2, base = false } = {}) {
  const group = new Group();
  const [a, b] = colours.map((hex) => new Color(hex));
  const panels = (geometry) => {
    const flat = geometry.toNonIndexed();
    geometry.dispose();
    const position = flat.attributes.position;
    const colour = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i += 3) {
      const x = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
      const z = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3;
      const panel = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 8) % 2;
      for (let k = 0; k < 3; k += 1) (panel ? a : b).toArray(colour, (i + k) * 3);
    }
    flat.setAttribute("color", new Float32BufferAttribute(colour, 3));
    flat.computeVertexNormals();
    return flat;
  };
  const cloth = standard(0xffffff, { vertexColors: true, side: DoubleSide, roughness: 0.92 });
  const canopy = mesh(panels(new ConeGeometry(radius, 0.42, 16, 3, true)), cloth);
  canopy.position.y = height - 0.21;
  const valance = mesh(panels(new CylinderGeometry(radius, radius, 0.13, 16, 1, true)), cloth);
  valance.position.y = height - 0.42 - 0.065;
  const stick = mesh(new CylinderGeometry(0.02, 0.022, height, 10), pole);
  stick.position.y = height / 2;
  const finial = mesh(new SphereGeometry(0.035, 12, 8), pole);
  finial.position.y = height + 0.02;
  group.add(canopy, valance, stick, finial);
  if (base) {
    const weight = mesh(new CylinderGeometry(0.26, 0.28, 0.07, 32), standard(0x6d6b67, { roughness: 0.6 }));
    weight.position.y = 0.035;
    group.add(weight);
  }
  return group;
}

/**
 * A coconut palm `height` tall, its trunk leaning `lean` of its height out
 * along x and bending as it goes, ringed where the old fronds fell; and a
 * crown of fronds, the young ones up, the old ones hanging, each a stem with
 * its leaflets drooping either side.
 */
function palm(height, lean, seed) {
  const random = seeded(seed);
  const group = new Group();
  const rings = Math.ceil(height / 0.045);
  const around = 10;
  const spine = (t) => [lean * height * t * t, height * t];
  const positions = [];
  const colours = [];
  const index = [];
  const bark = new Color(0x8b7d68);
  const c = new Color();
  for (let r = 0; r <= rings; r += 1) {
    const t = r / rings;
    const [dx, y] = spine(t);
    const scar = Math.cos((t * height * Math.PI * 2) / 0.12);
    const radius = (0.15 - 0.05 * t + 0.11 * Math.exp((-t * height) / 0.25)) * (1 - 0.07 * Math.max(0, scar) ** 3);
    c.copy(bark).multiplyScalar(0.8 + 0.12 * scar - 0.15 * t);
    for (let s = 0; s <= around; s += 1) {
      const angle = (s / around) * Math.PI * 2;
      positions.push(dx + Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      colours.push(c.r, c.g, c.b);
    }
  }
  for (let r = 0; r < rings; r += 1)
    for (let s = 0; s < around; s += 1) {
      const a = r * (around + 1) + s;
      index.push(a, a + around + 1, a + 1, a + 1, a + around + 1, a + around + 2);
    }
  const trunk = new BufferGeometry();
  trunk.setIndex(index);
  trunk.setAttribute("position", new Float32BufferAttribute(positions, 3));
  trunk.setAttribute("color", new Float32BufferAttribute(colours, 3));
  trunk.computeVertexNormals();
  group.add(mesh(trunk, standard(0xffffff, { vertexColors: true, roughness: 0.92 })));

  const top = new Vector3(lean * height, height, 0);
  const leaves = [];
  const tints = [];
  const fronds = 13;
  const green = [new Color(0x46702c), new Color(0x5a7f2e), new Color(0x7c8a3c)];
  for (let f = 0; f < fronds; f += 1) {
    const tier = f % 3;
    const azimuth = (f / fronds) * Math.PI * 2 + (random() - 0.5) * 0.5;
    const out = new Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
    const length = 2 + random() * 0.7;
    const rise = [1.1, 0.65, 0.25][tier] + random() * 0.2;
    const droop = [0.9, 1.25, 1.6][tier] + random() * 0.3;
    const along = (s) => top.clone().addScaledVector(out, length * 0.92 * s).addScaledVector(UP, length * 0.6 * (rise * s - droop * s * s));
    const tint = green[tier].clone().multiplyScalar(0.85 + random() * 0.3);
    const count = 26;
    for (let k = 0; k < count; k += 1) {
      const s = 0.06 + (0.92 * k) / count;
      const point = along(s);
      const tangent = along(s + 0.02).sub(point).normalize();
      const across = new Vector3().crossVectors(tangent, UP).normalize();
      // The stem: a narrow strip to the next point along it.
      const next = along(s + 0.92 / count);
      const w = 0.018 * (1 - 0.6 * s);
      leaves.push(
        ...point.clone().addScaledVector(across, -w).toArray(), ...point.clone().addScaledVector(across, w).toArray(), ...next.toArray()
      );
      tints.push(tint, tint, tint);
      const reach = 0.62 * (length / 2.4) * Math.sin(Math.PI * (0.08 + 0.86 * s)) ** 0.6;
      for (const side of [-1, 1]) {
        const direction = across.clone().multiplyScalar(side * 0.8).addScaledVector(tangent, 0.45).addScaledVector(UP, -0.5 - 0.3 * s).normalize();
        const width = 0.035;
        const tip = point.clone().addScaledVector(direction, reach);
        leaves.push(
          ...point.clone().addScaledVector(tangent, -width).toArray(), ...point.clone().addScaledVector(tangent, width).toArray(), ...tip.toArray()
        );
        const shade = tint.clone().multiplyScalar(0.9 + 0.2 * random());
        tints.push(shade, shade, shade.clone().multiplyScalar(1.15));
      }
    }
  }
  const crown = new BufferGeometry();
  crown.setAttribute("position", new Float32BufferAttribute(leaves, 3));
  crown.setAttribute("color", new Float32BufferAttribute(tints.flatMap((t) => [t.r, t.g, t.b]), 3));
  crown.computeVertexNormals();
  group.add(mesh(crown, standard(0xffffff, { vertexColors: true, side: DoubleSide, roughness: 0.6 })));
  // Coconuts, under the crown.
  const nuts = [];
  for (let k = 0; k < 4; k += 1) {
    const angle = k * 1.7 + random();
    nuts.push({
      geometry: new SphereGeometry(0.085, 12, 8),
      matrix: placed([top.x + Math.cos(angle) * 0.13, height - 0.18 - random() * 0.08, Math.sin(angle) * 0.13]),
      colour: new Color(k % 2 ? 0x5e4a2a : 0x6f6a30),
    });
  }
  group.add(assembled(nuts, { roughness: 0.55 }));
  return group;
}

/** A surfboard stood up in the sand, white with a stripe down it. */
function surfboard(stripe) {
  const geometry = new SphereGeometry(1, 24, 16);
  const position = geometry.attributes.position;
  const colour = new Float32Array(position.count * 3);
  const [white, band] = [new Color(0xf4f2ec), new Color(stripe)];
  for (let i = 0; i < position.count; i += 1) {
    // Narrower at the nose than the tail.
    const y = position.getY(i);
    position.setX(i, position.getX(i) * (1 - 0.25 * Math.max(0, y)));
    (Math.abs(position.getX(i)) < 0.12 ? band : white).toArray(colour, i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colour, 3));
  geometry.computeVertexNormals();
  const node = mesh(geometry, standard(0xffffff, { vertexColors: true, roughness: 0.3 }));
  node.scale.set(0.27, 1.05, 0.035);
  return node;
}

/** An olive tree in a terracotta pot: a twisted trunk and a grey-green crown in clumps. */
function oliveTree(seed) {
  const random = seeded(seed);
  const group = new Group();
  const pot = mesh(
    new LatheGeometry(
      [[0, 0.01], [0.2, 0], [0.24, 0.05], [0.31, 0.5], [0.34, 0.52], [0.34, 0.58], [0.3, 0.58], [0.29, 0.52], [0, 0.52]].map(([x, y]) => new Vector2(x, y)),
      32
    ),
    standard(0xb4693f, { roughness: 0.85 })
  );
  group.add(pot);
  const bark = 0x6b5f50;
  const parts = [rod([0, 0.5, 0], [0.06, 1.05, 0.02], 0.045, bark), rod([0.06, 1.05, 0.02], [-0.05, 1.45, -0.03], 0.035, bark), rod([0.06, 1.05, 0.02], [0.22, 1.4, 0.06], 0.028, bark)];
  for (let k = 0; k < 9; k += 1) {
    const angle = (k / 9) * Math.PI * 2 + random();
    const geometry = new IcosahedronGeometry(0.24 + random() * 0.1, 1);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      const lump = 0.85 + 0.3 * random();
      position.setXYZ(i, position.getX(i) * lump, position.getY(i) * lump * 0.8, position.getZ(i) * lump);
    }
    geometry.computeVertexNormals();
    const spread = k === 8 ? 0 : 0.32 + random() * 0.12;
    parts.push({
      geometry,
      matrix: placed([Math.cos(angle) * spread, 1.55 + (random() - 0.4) * 0.35 + (k === 8 ? 0.2 : 0), Math.sin(angle) * spread]),
      colour: new Color(0x6f7c56).multiplyScalar(0.8 + random() * 0.35),
    });
  }
  group.add(assembled(parts, { roughness: 0.8, flatShading: true }));
  return group;
}

/** A light stand: a column `height` tall on three legs. */
function lightStand(height, colour = 0x1c1c1e) {
  const parts = [rod([0, 0.42, 0], [0, height, 0], 0.016, colour)];
  for (let k = 0; k < 3; k += 1) {
    const angle = (k / 3) * Math.PI * 2 + 0.3;
    parts.push(rod([0, 0.45, 0], [Math.cos(angle) * 0.45, 0.01, Math.sin(angle) * 0.45], 0.011, colour));
  }
  return assembled(parts, { roughness: 0.45, metalness: 0.5 });
}

/**
 * A softbox, its front at +z: a black housing narrowing back to its ring and a
 * white face lit from inside - `sides` four for a rectangle `width` by `height`,
 * eight for an octabox `width` across.
 */
function softbox(width, height, depth, sides = 4) {
  const group = new Group();
  // A square's corners are half its diagonal out, an octagon's half its width.
  const [radius, turn] = sides === 4 ? [Math.SQRT1_2, Math.PI / 4] : [0.5, 0];
  const housing = mesh(
    new CylinderGeometry(0.08, radius, depth, sides, 1, true, turn),
    standard(0x151516, { roughness: 0.9, side: DoubleSide }),
    { cast: false }
  );
  housing.scale.set(width, 1, sides === 4 ? height : width);
  housing.rotation.x = -Math.PI / 2;
  const face = new Mesh(
    sides === 4 ? new PlaneGeometry(width * 0.98, height * 0.98) : new CircleGeometry((width / 2) * 0.98, 8),
    new MeshBasicMaterial({ color: new Color(1, 1, 1).multiplyScalar(2.6) })
  );
  face.position.z = depth / 2 + 0.002;
  face.userData.outline = false;
  const ring = mesh(new CylinderGeometry(0.09, 0.09, 0.06, 16), standard(0x2a2a2c, { metalness: 0.6, roughness: 0.4 }), { cast: false });
  ring.rotation.x = Math.PI / 2;
  ring.position.z = -depth / 2 - 0.03;
  group.add(housing, face, ring);
  return group;
}

/** A light on a stand at `foot`, raised to `height` and turned to `target`. */
function lamp(light, foot, height, target) {
  const group = new Group();
  group.add(at(lightStand(height - 0.1), foot));
  light.position.set(foot[0], height, foot[2]);
  light.lookAt(new Vector3(...target));
  group.add(light);
  return group;
}

/* ------------------------------------------------------------------ */
/* The beach                                                           */
/* ------------------------------------------------------------------ */

/** Where the water stands, a little under the dry sand. */
const SEA_LEVEL = -0.035;

function beach(layout) {
  const { half } = layout;
  const room = new Group();
  room.name = "room";
  room.userData.walls = [];
  room.add(skyDome());

  // The sea is to the north. Where the beach starts to fall towards it, and
  // under it, wandering; the water's edge is where the sand goes under.
  const shore = Math.min(layout.north, -half[1]) - 1.1;
  const brink = (x) => shore + 0.35 * Math.sin(0.42 * x + 0.7) + 0.18 * Math.sin(1.13 * x + 2.1);
  const height = (x, z) => {
    const d = brink(x) - z;
    return d <= 0 ? 0 : -Math.min(3, 0.09 * d + 0.004 * d * d);
  };
  const edge = (x) => brink(x) - 0.38;
  const dry = new Color(1, 1, 1);
  const c = new Color();
  const sandGeometry = ground(
    ticks([-45, -12, 2], [-12, 12, 0.5], [12, 45, 2]),
    ticks([-50, shore - 4, 2.5], [shore - 4, shore + 2.5, 0.2], [shore + 2.5, 12, 1], [12, 45, 3]),
    (x, z) => {
      // Darker where the waves wet it, and darker again under them.
      const up = z - edge(x);
      const wet = 1 - smooth(-0.1, 1.5, up);
      c.copy(dry).multiplyScalar(1 - 0.36 * wet - 0.12 * smooth(0, -3, up));
      c.b *= 1 - 0.06 * wet;
      return [height(x, z), c.r, c.g, c.b];
    },
    SAND_TILE
  );
  const floor = mesh(sandGeometry, finished(0xdcccb1, sand(), { roughness: 0.95, normalScale: 1, vertexColors: true }), { cast: false });
  floor.name = "room-floor";
  room.add(floor);

  // The water: clear and pale over the sand at its edge, deepening to blue
  // as the sand falls away under it.
  const shallow = new Color(0x8fd0c4);
  const middle = new Color(0x2d8aa3);
  const deep = new Color(0x18557c);
  const seaGeometry = ground(
    ticks([-50, 50, 2.5]),
    ticks([-55, shore - 6, 4], [shore - 6, shore + 0.8, 0.4]),
    (x, z) => {
      const under = SEA_LEVEL - height(x, z);
      c.lerpColors(shallow, middle, smooth(0, 1.4, under)).lerp(deep, smooth(4, 25, edge(x) - z));
      return [SEA_LEVEL, c.r, c.g, c.b, 0.3 + 0.65 * smooth(0, 1.1, under)];
    },
    WATER_TILE
  );
  const sea = mesh(
    seaGeometry,
    new MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      roughness: 0.06,
      metalness: 0,
      normalMap: water().normal,
      normalScale: new Vector2(0.55, 0.55),
    }),
    { cast: false }
  );
  sea.renderOrder = 1;
  room.add(sea);

  // The foam a wave leaves running up the sand, and a line of it further out
  // where the next one breaks.
  const froth = new MeshStandardMaterial({
    map: foam(),
    transparent: true,
    depthWrite: false,
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const band = (line, width, lift, opacity) => {
    const xs = ticks([-45, 45, 0.25]);
    const rows = [0, 0.25, 0.5, 0.75, 1];
    const geometry = sheet(xs.length, rows.length, (i, j) => {
      const z = line(xs[i]) + (rows[j] - 0.5) * width;
      return { position: [xs[i], Math.max(height(xs[i], z), SEA_LEVEL) + lift, z], uv: [xs[i] / FOAM_TILE, 1 - rows[j]] };
    });
    const node = mesh(geometry, opacity < 1 ? Object.assign(froth.clone(), { opacity }) : froth, { cast: false });
    node.renderOrder = 2;
    return node;
  };
  room.add(band((x) => edge(x) + 0.12, 0.6, 0.004, 1));
  room.add(band((x) => shore - 5 + 0.4 * Math.sin(0.27 * x + 1.3), 1, 0.01, 0.55));
  room.add(band((x) => shore - 2.4 + 0.25 * Math.sin(0.5 * x + 0.2), 0.7, 0.008, 0.35));

  room.add(headland([-30, -0.4, -36], [11, 2, 4], 0x4e41));
  room.add(headland([33, -0.4, -38], [8, 1.4, 3.5], 0x4e42));
  room.add(sailboat([11, SEA_LEVEL, -30], 0.4));

  room.add(laid(towelSize(layout), layout.rug.at, towel(BEACH_TOWEL), terry(), TERRY_TILE, { roughness: 0.98, normalScale: 1 }));

  const side = sides(room, half);
  const driftwood = woodFinish(0xcfc4b3, 0.7);
  const cushion = clothFinish(0x8fa9ae);
  side.west.add(at(lounger(driftwood, cushion), [-half[0] - 0.75, 0, -0.2], Math.PI));
  side.west.add(at(lounger(driftwood, cushion), [-half[0] - 1.65, 0, -0.35], Math.PI));
  side.west.add(at(parasol([0xf4efe6, 0x2b7aa3], woodFinish(0xd8cfc0, 0.6)), [-half[0] - 1.2, 0, 0.85]));
  side.west.add(at(palm(5.6, 0.22, 0x9a1), [-half[0] - 3.4, 0, -2.1], 2.6));
  side.west.add(at(surfboard(0x2b7aa3), [-half[0] - 2.4, 0.8, 1.6], 0.5));
  side.east.add(at(palm(6.2, 0.28, 0x9a2), [half[0] + 1.6, 0, -1.4], 0.3));
  side.east.add(at(palm(4.8, 0.18, 0x9a3), [half[0] + 2.9, 0, 1.3], -0.6));
  side.south.add(at(palm(5.4, 0.25, 0x9a4), [-1.2, 0, half[1] + 2.4], -1.8));
  return room;
}

/* ------------------------------------------------------------------ */
/* The pool                                                            */
/* ------------------------------------------------------------------ */

/** A quad from four corners, facing `normal`, for a mesh of them. */
function quads(list, uvOf) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const uv1s = [];
  for (const { corners, normal, tiles } of list) {
    const [a, b, c, d] = corners.map((p) => new Vector3(...p));
    const facing = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).dot(new Vector3(...normal)) > 0;
    const order = facing ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const p of order) {
      positions.push(p.x, p.y, p.z);
      normals.push(...normal);
      const [u, v] = uvOf(p, normal);
      uvs.push(u / tiles[0], v / tiles[0]);
      uv1s.push(u / tiles[1], v / tiles[1]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("uv1", new Float32BufferAttribute(uv1s, 2));
  return geometry;
}

/** Each point's UVs in metres on the plane it faces: across and up a wall, east and north on a floor. */
const metres = (p, normal) => (normal[1] ? [p.x, -p.z] : normal[0] ? [p.z, p.y] : [p.x, p.y]);

/** The villa's wall behind the deck, white, with a glass door in it, lamps either side and a planter. */
function villa(width) {
  const group = new Group();
  const tall = 3.4;
  const wall = mesh(
    tiled(new PlaneGeometry(width, tall), width, tall, PLASTER_TILE),
    finished(0xf0ebe2, plaster(), { roughness: 0.9, normalScale: 0.6 }),
    { cast: false }
  );
  wall.position.y = tall / 2;
  wall.rotation.y = Math.PI;
  group.add(wall);
  group.add(box([width, 0.12, 0.04], standard(0xd9d1c4, { roughness: 0.8 }), [0, 0.06, -0.02]));
  // The door: a deep reveal round dark glass in thin bronze frames.
  const render = standard(0xeee8de, { roughness: 0.9 });
  const [w, h] = [2.8, 2.5];
  group.add(box([w + 0.24, 0.12, 0.2], render, [0, h + 0.06, -0.1]));
  for (const s of [-1, 1]) group.add(box([0.12, h, 0.2], render, [s * (w / 2 + 0.06), h / 2, -0.1]));
  const glass = new MeshStandardMaterial({ color: 0x1b2328, roughness: 0.04, metalness: 0.2 });
  const pane = mesh(new PlaneGeometry(w, h), glass, { cast: false });
  pane.position.set(0, h / 2, -0.01);
  pane.rotation.y = Math.PI;
  group.add(pane);
  const bronze = standard(0x3a3128, { roughness: 0.35, metalness: 0.7 });
  for (const x of [-w / 2 + 0.025, 0, w / 2 - 0.025]) group.add(box([0.05, h, 0.06], bronze, [x, h / 2, -0.04]));
  group.add(box([w, 0.05, 0.06], bronze, [0, h - 0.025, -0.04]), box([w, 0.08, 0.06], bronze, [0, 0.04, -0.04]));
  for (const s of [-1, 1]) {
    const lantern = box([0.14, 0.24, 0.1], standard(0xfff2da, { emissive: new Color(0xffd8a0), emissiveIntensity: 1.2, roughness: 0.6 }), [s * (w / 2 + 0.6), 2.25, -0.06]);
    lantern.castShadow = false;
    group.add(lantern);
  }
  // A long planter to one side, clipped box in it.
  group.add(box([2.2, 0.5, 0.45], render, [w / 2 + 2.2, 0.25, -0.3]));
  const hedge = mesh(clipped(2.1, 0.55, 0.4), standard(0x4b6236, { roughness: 0.9, flatShading: true }));
  hedge.position.set(w / 2 + 2.2, 0.75, -0.3);
  group.add(hedge);
  return group;
}

/** A box with its faces broken up a little, the way a clipped hedge is. */
function clipped(width, height, depth) {
  const geometry = new IcosahedronGeometry(0.5, 3);
  const position = geometry.attributes.position;
  const random = seeded(0x4ed6e);
  for (let i = 0; i < position.count; i += 1) {
    const p = new Vector3().fromBufferAttribute(position, i);
    // Pushed out towards a box, and roughened.
    const q = p.clone().divideScalar(Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) * 2);
    p.lerp(q, 0.8).multiplyScalar(1 + 0.05 * (random() - 0.5));
    position.setXYZ(i, p.x * width, p.y * height, p.z * depth);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function poolside(layout) {
  const { half } = layout;
  const room = new Group();
  room.name = "room";
  room.userData.walls = [];
  room.add(skyDome());

  // The pool lies across the north of the deck, wider than the clear ground,
  // its far edge the terrace's: the water runs over it and there is nothing
  // past it but the sea far below.
  const width = 2 * half[0] + 2;
  const length = 4.4;
  const south = Math.min(layout.north, -half[1]);
  const north = south - length;
  const [west, east] = [-width / 2, width / 2];
  const bottom = -1.35;
  const level = -0.06;
  const reach = 40;
  const deck = quads(
    [
      [-reach, reach, south, reach],
      [-reach, west, north, south],
      [east, reach, north, south],
    ].map(([x0, x1, z0, z1]) => ({
      corners: [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]],
      normal: [0, 1, 0],
      tiles: [PAVER_TILE, PAVER_TILE],
    })),
    metres
  );
  const stone = pavers();
  const floor = mesh(deck, finished(0xe4d9c6, stone, { roughness: 0.8 }), { cast: false });
  floor.name = "room-floor";
  room.add(floor);
  // The coping round the three sides one walks on, a step proud of the deck.
  const coping = finished(0xeee6d7, stone, { roughness: 0.75 });
  const lip = (size, position) => {
    const node = mesh(grainedBox(size, PAVER_TILE), coping);
    node.position.set(...position);
    return node;
  };
  room.add(lip([width + 0.7, 0.05, 0.35], [0, -0.01, south + 0.135]));
  for (const s of [-1, 1]) room.add(lip([0.35, 0.05, length], [s * (width / 2 + 0.135), -0.01, (north + south) / 2]));

  // The basin, tiled, with the light the ripples throw moving over it.
  const basin = quads(
    [
      { corners: [[west, bottom, north], [east, bottom, north], [east, bottom, south], [west, bottom, south]], normal: [0, 1, 0] },
      { corners: [[west, bottom, south], [east, bottom, south], [east, 0, south], [west, 0, south]], normal: [0, 0, -1] },
      { corners: [[west, bottom, north], [east, bottom, north], [east, level - 0.01, north], [west, level - 0.01, north]], normal: [0, 0, 1] },
      { corners: [[west, bottom, north], [west, bottom, south], [west, 0, south], [west, 0, north]], normal: [1, 0, 0] },
      { corners: [[east, bottom, north], [east, bottom, south], [east, 0, south], [east, 0, north]], normal: [-1, 0, 0] },
    ].map((quad) => ({ ...quad, tiles: [MOSAIC_TILE, CAUSTIC_TILE] })),
    metres
  );
  const glaze = mosaic();
  const light = caustic();
  light.channel = 1;
  room.add(
    mesh(
      basin,
      finished(0xffffff, { ...glaze, mean: 1 }, { roughness: 0.25, emissive: new Color(0xbfeaff), emissiveMap: light, emissiveIntensity: 0.4 }),
      { cast: false }
    )
  );
  const surfaceGeometry = tiled(new PlaneGeometry(width, length), width, length, 2);
  const pool = mesh(
    surfaceGeometry,
    new MeshStandardMaterial({
      color: 0x2e9bb5,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      roughness: 0.03,
      metalness: 0,
      normalMap: water().normal,
      normalScale: new Vector2(0.35, 0.35),
    }),
    { cast: false }
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, level, (north + south) / 2);
  pool.renderOrder = 1;
  room.add(pool);

  // Below the terrace's edge, its stone face down to the sea.
  const drop = -3.2;
  const cliff = mesh(
    tiled(new PlaneGeometry(2 * reach, -drop), 2 * reach, -drop, PLASTER_TILE * 4),
    finished(0xcbbfa9, plaster(), { roughness: 0.95, normalScale: 0.8 }),
    { cast: false, receive: false }
  );
  cliff.position.set(0, drop / 2, north);
  cliff.rotation.y = Math.PI;
  room.add(cliff);
  const c = new Color();
  const [near, far] = [new Color(0x2b84a0), new Color(0x1a5378)];
  room.add(
    mesh(
      ground(ticks([-55, 55, 5]), ticks([-60, north, 4]), (x, z) => [drop, ...c.lerpColors(near, far, smooth(0, 30, north - z)).toArray()], WATER_TILE),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0, normalMap: water().normal, normalScale: new Vector2(0.8, 0.8) }),
      { cast: false, receive: false }
    )
  );
  room.add(headland([-30, drop - 0.4, -36], [11, 2.6, 4], 0x4e43));
  room.add(headland([33, drop - 0.4, -38], [8, 1.8, 3.5], 0x4e44));
  room.add(sailboat([-8, drop, -32], -0.5));

  room.add(laid(towelSize(layout), layout.rug.at, towel(POOL_TOWEL), terry(), TERRY_TILE, { roughness: 0.98, normalScale: 1 }));

  const side = sides(room, half);
  const teak = woodFinish(0xa47a52, 0.6);
  const cushion = clothFinish(0xf1ede5);
  for (const [k, x] of [[0, -half[0] - 0.7], [1, -half[0] - 1.6]])
    side.west.add(at(lounger(teak, cushion), [x, 0, south + 1.45 + k * 0.1], Math.PI));
  side.west.add(at(parasol([0xf0ebe0, 0xf0ebe0], teak, { base: true }), [-half[0] - 1.15, 0, south + 3.2]));
  side.east.add(at(oliveTree(0x011), [half[0] + 0.8, 0, -0.9]));
  side.east.add(at(oliveTree(0x012), [half[0] + 0.8, 0, 1.5], 1.4));
  side.south.add(at(villa(2 * half[0] + 8), [0, 0, half[1] + 1.4]));
  return room;
}

/* ------------------------------------------------------------------ */
/* The fashion studio                                                  */
/* ------------------------------------------------------------------ */

/** The paper the figures stand on and against. */
const PAPER = 0xa29b94;

/**
 * A sweep of paper hung from a roll: flat on the floor from `front` back,
 * curving up through a cove into the hang at `back`, `width` wide. Lit
 * brightest in its middle and falling off to its edges and up its height, as
 * paper under one big light is.
 */
function sweep(width, front, back, height) {
  const cove = 0.9;
  const profile = [];
  for (let z = front; z > back + cove + 1e-6; z -= 0.25) profile.push([z, 0]);
  for (let k = 0; k <= 12; k += 1) {
    const angle = (k / 12) * (Math.PI / 2);
    profile.push([back + cove - cove * Math.sin(angle), cove - cove * Math.cos(angle)]);
  }
  for (let y = cove + 0.25; y < height + 1e-6; y += 0.25) profile.push([back, y]);
  const xs = ticks([-width / 2, width / 2, 0.25]);
  const n = xs.length;
  const positions = [];
  const uvs = [];
  const colours = [];
  let s = 0;
  profile.forEach(([z, y], j) => {
    if (j) s += Math.hypot(z - profile[j - 1][0], y - profile[j - 1][1]);
    for (const x of xs) {
      positions.push(x, y + 0.002, z);
      uvs.push(x / PLASTER_TILE, s / PLASTER_TILE);
      const shade = (0.3 + 0.7 * Math.exp(-((x / (width * 0.36)) ** 2))) * (1 - 0.5 * smooth(1, height, y));
      colours.push(shade, shade, shade);
    }
  });
  const index = [];
  for (let j = 0; j < profile.length - 1; j += 1)
    for (let i = 0; i < n - 1; i += 1) {
      const a = j * n + i;
      index.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  const geometry = new BufferGeometry();
  geometry.setIndex(index);
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(colours, 3));
  geometry.computeVertexNormals();
  return mesh(geometry, finished(PAPER, plaster(), { roughness: 0.95, normalScale: 0.15, vertexColors: true }), { cast: false });
}

/** A camera on a tripod, looking along +z. */
function cameraRig() {
  const group = new Group();
  const black = 0x161617;
  const parts = [rod([0, 0.75, 0], [0, 1.3, 0], 0.014, black)];
  for (let k = 0; k < 3; k += 1) {
    const angle = (k / 3) * Math.PI * 2 + Math.PI / 2;
    parts.push(rod([0, 0.78, 0], [Math.cos(angle) * 0.42, 0.01, Math.sin(angle) * 0.42], 0.013, black));
  }
  parts.push({ geometry: new CylinderGeometry(0.035, 0.04, 0.06, 16), matrix: placed([0, 1.33, 0]), colour: new Color(0x222224) });
  group.add(assembled(parts, { roughness: 0.5, metalness: 0.3 }));
  const body = box([0.15, 0.11, 0.08], standard(0x19191a, { roughness: 0.55 }), [0, 1.42, 0]);
  const lens = mesh(new CylinderGeometry(0.038, 0.042, 0.13, 24), standard(0x101011, { roughness: 0.35 }));
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 1.42, 0.1);
  const glass = mesh(new CircleGeometry(0.03, 24), new MeshStandardMaterial({ color: 0x0b1018, roughness: 0.02, metalness: 0.5 }), { cast: false });
  glass.position.set(0, 1.42, 0.1655);
  group.add(body, lens, glass);
  return group;
}

/** A V-flat: two tall white boards hinged at an edge, the V opening along +z. */
function vFlat() {
  const group = new Group();
  const white = standard(0xf1f0ec, { roughness: 0.9 });
  for (const s of [-1, 1]) {
    const leaf = box([1.2, 2.4, 0.05], white, [s * 0.6 * Math.SQRT1_2, 1.2, 0.6 * Math.SQRT1_2]);
    leaf.rotation.y = -s * (Math.PI / 4);
    group.add(leaf);
  }
  return group;
}

/** A rail of clothes for the shoot, on a stand, each garment hung edge on to it. */
function clothesRail() {
  const group = new Group();
  const steel = 0xb9bbbd;
  const parts = [rod([-0.7, 0.04, 0], [-0.7, 1.62, 0], 0.012, steel), rod([0.7, 0.04, 0], [0.7, 1.62, 0], 0.012, steel), rod([-0.72, 1.62, 0], [0.72, 1.62, 0], 0.012, steel)];
  for (const x of [-0.7, 0.7]) parts.push(rod([x, 0.03, -0.25], [x, 0.03, 0.25], 0.014, steel));
  group.add(assembled(parts, { roughness: 0.3, metalness: 0.8 }));
  const random = seeded(0x7a11);
  const colours = [0x151515, 0xe9e2d4, 0xb08a5a, 0x8d2a2a, 0xf4f2ee, 0x6c6e70, 0x26324a, 0xc7a7a0, 0x2d2b29];
  const garments = colours.map((hex, k) => {
    const long = 0.6 + random() * 0.5;
    return {
      geometry: new CylinderGeometry(0.2, 0.25, long, 10, 1),
      matrix: placed([-0.6 + k * 0.15, 1.56 - long / 2, 0], undefined, new Vector3(0.18, 1, 1)),
      colour: new Color(hex),
    };
  });
  group.add(assembled(garments, { roughness: 0.85 }));
  return group;
}

function fashion(layout) {
  const { half } = layout;
  const room = new Group();
  room.name = "room";
  room.userData.walls = [];

  // A concrete floor, lit in the middle by the shoot's lights and falling
  // away into the dark of the studio round it.
  const c = new Color();
  const floor = mesh(
    ground(ticks([-30, -10, 4], [-10, 10, 1], [10, 30, 4]), ticks([-30, -10, 4], [-10, 10, 1], [10, 30, 4]), (x, z) => {
      const lit = 0.08 + 0.92 * Math.exp(-((Math.hypot(x, z * 1.2) / 5.5) ** 2));
      return [0, ...c.setRGB(lit, lit, lit).toArray()];
    }, CONCRETE_TILE),
    finished(0x6c6864, concrete(), { roughness: 0.75, normalScale: 0.5, vertexColors: true, envMapIntensity: 0.35 }),
    { cast: false }
  );
  floor.name = "room-floor";
  room.add(floor);

  // The paper, from a roll on two stands, wide enough for the figures and
  // the light falling off it either side of them.
  const width = 2 * half[0] - 0.6;
  const back = layout.north;
  const top = 3;
  room.add(sweep(width, half[1] - 0.45, back, top));
  const black = 0x1b1b1d;
  const parts = [rod([-width / 2 - 0.12, top + 0.12, back - 0.1], [width / 2 + 0.12, top + 0.12, back - 0.1], 0.016, black)];
  for (const s of [-1, 1]) {
    parts.push(rod([s * (width / 2 + 0.12), 0.42, back - 0.1], [s * (width / 2 + 0.12), top + 0.16, back - 0.1], 0.018, black));
    for (let k = 0; k < 3; k += 1) {
      const angle = (k / 3) * Math.PI * 2 + 0.5;
      parts.push(rod([s * (width / 2 + 0.12), 0.45, back - 0.1], [s * (width / 2 + 0.12) + Math.cos(angle) * 0.4, 0.01, back - 0.1 + Math.sin(angle) * 0.4], 0.012, black));
    }
  }
  parts.push({
    geometry: new CylinderGeometry(0.075, 0.075, width + 0.04, 24),
    matrix: placed([0, top + 0.02, back - 0.06], new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2)),
    colour: new Color(PAPER),
  });
  room.add(assembled(parts, { roughness: 0.6 }, { cast: false }));

  const side = sides(room, half);
  const middle = [0, 1.1, 0];
  side.east.add(lamp(softbox(1.5, 1.5, 0.55, 8), [half[0] + 0.7, 0, 0.9], 2.3, middle));
  side.west.add(lamp(softbox(0.35, 1.5, 0.3), [-half[0] - 0.4, 0, -1.2], 1.75, [0, 1.2, -0.3]));
  const flat = vFlat();
  side.west.add(at(flat, [-half[0] - 1.1, 0, 0.3]));
  flat.lookAt(0, 0, 0);
  side.west.add(at(clothesRail(), [-half[0] - 2.4, 0, -1.4], Math.PI / 2));
  const rig = cameraRig();
  side.south.add(at(rig, [0.4, 0, half[1] + 0.8]));
  rig.lookAt(0, 0, 0);
  const pine = woodFinish(0xc9a476, 0.6);
  side.south.add(board([0.5, 0.2, 0.3], pine, [-1, 0.1, half[1] + 0.5]), board([0.5, 0.2, 0.3], pine, [-1.05, 0.3, half[1] + 0.52]));
  return room;
}

/* ------------------------------------------------------------------ */
/* The places                                                          */
/* ------------------------------------------------------------------ */

/**
 * Each place: the colour of a wall to lean on there (see `paintWall`), and how
 * much of the plaster's texture shows in it; its textures, to make ahead (see
 * `roomTextures`); and how it is built from its layout.
 */
export const PLACES = {
  beach: {
    wall: 0xe9e3d8,
    textures: () =>
      steps([[sand], [water], [foam], [towel, BEACH_TOWEL], [terry], [wood], [linen], [plaster]]),
    build: beach,
  },
  pool: {
    wall: 0xf0ebe2,
    textures: () =>
      steps([[pavers], [mosaic], [caustic], [water], [towel, POOL_TOWEL], [terry], [wood], [linen], [plaster]]),
    build: poolside,
  },
  fashion: {
    wall: PAPER,
    plaster: 0.15,
    textures: () => steps([[concrete], [plaster], [wood]]),
    build: fashion,
  },
};

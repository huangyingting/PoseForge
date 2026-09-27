/**
 * The room the figures are in.
 *
 * A studio backdrop says nothing about where a pose happens, and a pose on a
 * bed or against a wall reads more easily when there is a floor with boards in
 * it and a window beyond. So the viewport can put the scene inside a room: a
 * floor, four walls, a rug under the figures, and a few things along the walls
 * - a window with curtains, lamps, a plant, a picture, a nightstand or a
 * bookcase.
 *
 * None of it is furniture the solver knows about, and it is kept where the
 * solver's furniture cannot be: the room is sized from the scene's own bounds
 * with a margin, and everything in it stands against a wall. The props that
 * the figures do use are drawn by `props.js` as before, in the middle.
 *
 * The camera orbits outside the room as often as inside it, so the room is a
 * dollhouse: each wall faces into the room and is drawn only from that side,
 * which hides whichever walls stand between the camera and the figures and
 * keeps the far ones as a backdrop. What stands against a hidden wall is
 * hidden with it (see `updateRoom`), or a nightstand would float in front of
 * the picture with no wall behind it.
 *
 * Every texture is made here, from seeded noise, so the room costs no
 * download, draws the same on every run, and is made once per look and shared.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
} from "three";

/** The looks a scene can be set in; "studio" is the plain backdrop. */
export const SETTINGS = ["bedroom", "living", "studio"];

/**
 * What each room is made of. Colours are sRGB, as a designer would give them;
 * the materials convert. The walls are kept pale and unsaturated so the skin
 * in front of them is still the warmest, most saturated thing in the picture.
 */
const LOOKS = {
  bedroom: {
    wall: 0xd8cfc3,
    trim: 0xf1ede6,
    floor: { base: [0.62, 0.45, 0.3], spread: 0.1 },
    rug: { field: 0xe6dccd, border: 0xb89f82, line: 0x8f7760 },
    curtain: 0xe9e1d3,
    wood: 0x7a5a40,
    shade: 0xf6e7cc,
    accent: 0x6f8a78,
    art: [0xc9a98b, 0x8fa39a, 0xe7d8c4, 0x9c6f55],
  },
  living: {
    wall: 0xc9cfc6,
    trim: 0xeef0ea,
    floor: { base: [0.43, 0.3, 0.2], spread: 0.12 },
    rug: { field: 0x7d8b94, border: 0x4f5c66, line: 0xc9c2b4 },
    curtain: 0xd8d4c8,
    wood: 0x5b4331,
    shade: 0xf3e3c3,
    accent: 0xa7683f,
    art: [0x3f5663, 0xd0b48a, 0xe9e3d6, 0xa35d3f],
  },
};

/** The height of the walls: a little over the 2.4 m the pole and wall props stand. */
const WALL_HEIGHT = 2.6;

/** The clear floor kept round the scene before the walls, and the smallest room. */
const MARGIN = 1.15;
const MIN_HALF = [2.5, 2.5];

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise on a lattice that wraps every `period` cells, a power of two. */
function valueNoise(random, period) {
  const lattice = Float32Array.from({ length: period * period }, random);
  const mask = period - 1;
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const i0 = i & mask;
    const i1 = (i + 1) & mask;
    const j0 = (j & mask) * period;
    const j1 = ((j + 1) & mask) * period;
    const top = lattice[j0 + i0] + (lattice[j0 + i1] - lattice[j0 + i0]) * sx;
    const bottom = lattice[j1 + i0] + (lattice[j1 + i1] - lattice[j1 + i0]) * sx;
    return top + (bottom - top) * sy;
  };
}

function texture(data, size, { repeat = true, colour = true } = {}) {
  const map = new DataTexture(data, size[0], size[1]);
  if (colour) map.colorSpace = SRGBColorSpace;
  map.wrapS = map.wrapT = repeat ? RepeatWrapping : map.wrapS;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

// A Uint8Array rounds and clamps what it is given only by truncating and
// wrapping, so the bytes are made here.
const toByte = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);
const channels = (hex) => {
  const c = new Color(hex);
  return [c.r, c.g, c.b].map((v) => new Color().setRGB(v, v, v).convertLinearToSRGB().r);
};

/**
 * Floorboards: rows of planks 18 cm wide, each a slightly different tone,
 * butted end to end at staggered joints, with a grain that wanders along the
 * plank and a dark hairline where two meet. One tile is 1.44 m square - eight
 * rows - so the repeat is longer than anything standing on it.
 */
export const FLOOR_TILE = 1.44;
function floorTexture(look) {
  const size = 1024;
  const rows = 8;
  const random = seeded(0xf100 + Math.round(look.base[0] * 100));
  const grain = valueNoise(seeded(0x6a1), 64);
  const fleck = valueNoise(seeded(0x6a2), 256);
  const data = new Uint8Array(size * size * 4);
  const rowHeight = size / rows;
  const planks = [];
  for (let r = 0; r < rows; r += 1) {
    // Each row starts where the tile's own repeat can pick it up again, so
    // the joints stagger inside a row and still tile across the edge.
    const joints = [Math.floor(random() * size)];
    joints.push((joints[0] + Math.floor(size * (0.42 + 0.2 * random()))) % size);
    planks.push({ joints: joints.sort((a, b) => a - b), tones: [random(), random()], phase: random() * 40 });
  }
  const [red, green, blue] = look.base;
  for (let y = 0; y < size; y += 1) {
    const r = Math.floor(y / rowHeight);
    const across = (y % rowHeight) / rowHeight;
    const { joints, tones, phase } = planks[r];
    const edgeY = Math.min(y % rowHeight, rowHeight - 1 - (y % rowHeight));
    for (let x = 0; x < size; x += 1) {
      const which = x >= joints[0] && x < joints[1] ? 0 : 1;
      const tone = (tones[which] - 0.5) * 2 * look.spread;
      const wander = grain(x / 64, (y + phase) / 9) * 3;
      const ring = Math.sin((across * 11 + wander + which * 3.1) * Math.PI);
      const figure = 0.06 * ring * ring + 0.05 * grain(x / 20, y / 3);
      const speck = 0.03 * (fleck(x / 2.5, y / 2.5) - 0.5);
      const edgeX = Math.min(Math.abs(x - joints[0]), Math.abs(x - joints[1]));
      const seam = edgeY < 1.5 || edgeX < 1.2 ? 0.55 : edgeY < 3 || edgeX < 2.5 ? 0.85 : 1;
      const shade = (1 + tone - figure + speck) * seam;
      const o = (y * size + x) * 4;
      data[o] = toByte(red * shade);
      data[o + 1] = toByte(green * shade);
      data[o + 2] = toByte(blue * shade);
      data[o + 3] = 255;
    }
  }
  return texture(data, [size, size]);
}

/**
 * A flat-woven rug: a plain field, a border band inside a margin, a fine line
 * either side of the band, and the fibre's noise over all of it. Drawn once
 * across the whole rug, not tiled, so the border goes round the edge.
 */
function rugTexture(rug) {
  const size = 512;
  const [field, border, line] = [rug.field, rug.border, rug.line].map(channels);
  const fibre = valueNoise(seeded(0x7a9), 128);
  const weave = valueNoise(seeded(0x7aa), 256);
  // A lattice of faint diamonds in the field, the way a kilim's is.
  const diamond = field.map((c, i) => c * 0.8 + border[i] * 0.2);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const v = y / (size - 1);
      const edge = Math.min(u, 1 - u, v, 1 - v);
      let colour = field;
      if (edge > 0.035 && edge < 0.1) colour = border;
      if (Math.abs(edge - 0.035) < 0.006 || Math.abs(edge - 0.1) < 0.006 || Math.abs(edge - 0.14) < 0.004) colour = line;
      if (edge >= 0.14) {
        const d = Math.abs(((u * 9) % 1) - 0.5) + Math.abs(((v * 6) % 1) - 0.5);
        if (Math.abs(d - 0.36) < 0.025) colour = diamond;
      }
      const shade = 1 + 0.07 * (fibre(x / 3, y / 3) - 0.5) + 0.05 * (weave(x, y / 2) - 0.5);
      const o = (y * size + x) * 4;
      for (let i = 0; i < 3; i += 1) data[o + i] = toByte(colour[i] * shade);
      data[o + 3] = 255;
    }
  }
  return texture(data, [size, size], { repeat: false });
}

/** A quiet abstract for the frame: overlapping soft discs and bands. */
function artTexture(palette) {
  const w = 256;
  const h = 320;
  const colours = palette.map(channels);
  const random = seeded(0xa27 + palette[0]);
  const shapes = Array.from({ length: 6 }, (_, i) => ({
    x: random(),
    y: random(),
    r: 0.18 + random() * 0.28,
    c: colours[(i % (colours.length - 1)) + 1],
  }));
  const canvas = valueNoise(seeded(0xa28), 64);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const u = x / w;
      const v = y / h;
      let [r, g, b] = colours[0];
      for (const s of shapes) {
        const d = Math.hypot(u - s.x, (v - s.y) * (h / w)) / s.r;
        const cover = Math.max(0, Math.min(1, (1 - d) * 6)) * 0.85;
        r += (s.c[0] - r) * cover;
        g += (s.c[1] - g) * cover;
        b += (s.c[2] - b) * cover;
      }
      const shade = 1 + 0.06 * (canvas(x / 2, y / 2) - 0.5);
      const o = (y * w + x) * 4;
      data[o] = toByte(r * shade);
      data[o + 1] = toByte(g * shade);
      data[o + 2] = toByte(b * shade);
      data[o + 3] = 255;
    }
  }
  return texture(data, [w, h], { repeat: false });
}

/** Daylight through the glass: pale sky over a band of distant haze. */
function skyTexture() {
  const w = 64;
  const h = 128;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const v = y / (h - 1);
    const sky = [0.8 + 0.18 * v, 0.88 + 0.1 * v, 0.97];
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      for (let i = 0; i < 3; i += 1) data[o + i] = toByte(sky[i]);
      data[o + 3] = 255;
    }
  }
  return texture(data, [w, h], { repeat: false });
}

/** A soft round falloff, for the pool of light a lamp throws on a wall. */
function glowTexture() {
  const n = 128;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const d = Math.hypot(x / (n - 1) - 0.5, y / (n - 1) - 0.5) * 2;
      const a = Math.max(0, 1 - d) ** 2.2;
      const o = (y * n + x) * 4;
      data[o] = toByte(1);
      data[o + 1] = toByte(0.8);
      data[o + 2] = toByte(0.55);
      data[o + 3] = toByte(a);
    }
  }
  return texture(data, [n, n], { repeat: false });
}

const textures = new Map();
function cached(key, make) {
  if (!textures.has(key)) textures.set(key, make());
  return textures.get(key);
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function standard(colour, options = {}) {
  return new MeshStandardMaterial({ color: new Color(colour), roughness: 0.8, metalness: 0, ...options });
}

function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const node = new Mesh(geometry, material);
  node.castShadow = cast;
  node.receiveShadow = receive;
  // Line art is of the figures and what they touch, not the room.
  node.userData.outline = false;
  return node;
}

function box(size, colour, at, options) {
  const node = mesh(new BoxGeometry(...size), typeof colour === "object" ? colour : standard(colour, options));
  node.position.set(...at);
  return node;
}

/** A curtain: a sheet hung in folds, deeper at the top where it is gathered. */
function curtain(width, height, colour) {
  const geometry = new PlaneGeometry(width, height, 48, 8);
  const position = geometry.attributes.position;
  const folds = Math.round(width / 0.11);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const gather = 0.75 + 0.25 * ((y / height) + 0.5);
    position.setZ(i, Math.sin(((x / width) + 0.5) * folds * Math.PI * 2) * 0.035 * gather);
  }
  geometry.computeVertexNormals();
  return mesh(geometry, standard(colour, { roughness: 0.95, side: DoubleSide }), { cast: false });
}

/** A lamp shade that glows from inside, open top and bottom. */
function shade(top, bottom, height, colour) {
  const material = standard(colour, {
    emissive: new Color(0xffd9a0),
    emissiveIntensity: 0.9,
    roughness: 0.9,
    side: DoubleSide,
  });
  return mesh(new CylinderGeometry(top, bottom, height, 32, 1, true), material, { cast: false });
}

/** The pool of light a lamp leaves on the wall behind it. */
function glow(width, height) {
  const node = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({
      map: cached("glow", glowTexture),
      transparent: true,
      opacity: 0.32,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  );
  node.userData.outline = false;
  node.renderOrder = 1;
  return node;
}

function floorLamp(look) {
  const group = new Group();
  const metal = standard(0x2f2d2b, { roughness: 0.45, metalness: 0.6 });
  const base = mesh(new CylinderGeometry(0.15, 0.16, 0.025, 32), metal);
  base.position.y = 0.0125;
  const pole = mesh(new CylinderGeometry(0.011, 0.011, 1.42, 12), metal);
  pole.position.y = 0.73;
  const top = shade(0.16, 0.22, 0.3, look.shade);
  top.position.y = 1.52;
  group.add(base, pole, top);
  return group;
}

function tableLamp(look) {
  const group = new Group();
  const body = mesh(
    new LatheGeometry(
      [[0, 0], [0.05, 0], [0.085, 0.06], [0.09, 0.13], [0.06, 0.21], [0.018, 0.25], [0.018, 0.28], [0, 0.28]].map(([x, y]) => new Vector2(x, y)),
      32
    ),
    standard(look.accent, { roughness: 0.35 })
  );
  const top = shade(0.1, 0.15, 0.2, look.shade);
  top.position.y = 0.36;
  group.add(body, top);
  return group;
}

function nightstand(look) {
  const group = new Group();
  const wood = standard(look.wood, { roughness: 0.6 });
  group.add(box([0.5, 0.52, 0.4], wood, [0, 0.26, 0]));
  const face = standard(new Color(look.wood).multiplyScalar(0.8), { roughness: 0.6 });
  group.add(box([0.44, 0.16, 0.01], face, [0, 0.4, 0.2]));
  group.add(box([0.44, 0.2, 0.01], face, [0, 0.17, 0.2]));
  const brass = standard(0xb8955a, { roughness: 0.3, metalness: 0.8 });
  group.add(box([0.1, 0.012, 0.02], brass, [0, 0.4, 0.212]));
  group.add(box([0.1, 0.012, 0.02], brass, [0, 0.17, 0.212]));
  const lamp = tableLamp(look);
  lamp.position.set(-0.08, 0.52, -0.02);
  group.add(lamp);
  return group;
}

function plant(look, height = 1.1) {
  const group = new Group();
  const pot = mesh(new CylinderGeometry(0.17, 0.13, 0.32, 32), standard(look.trim, { roughness: 0.5 }));
  pot.position.y = 0.16;
  const soil = mesh(new CylinderGeometry(0.155, 0.155, 0.01, 24), standard(0x3b2e25, { roughness: 1 }), { cast: false });
  soil.position.y = 0.3;
  group.add(pot, soil);
  // Sword-shaped leaves, the way a snake plant grows them: tall, stiff, each
  // leaning a little out from the middle.
  const random = seeded(0x91a + Math.round(height * 100));
  const leaf = new SphereGeometry(1, 12, 16);
  for (let i = 0; i < 13; i += 1) {
    const green = new Color().setHSL(0.27 + random() * 0.05, 0.38, 0.24 + random() * 0.1);
    const node = mesh(leaf, standard(green, { roughness: 0.55 }));
    const tall = height * (0.45 + random() * 0.4);
    node.scale.set(0.035 + random() * 0.015, tall / 2, 0.008);
    const turn = (i / 13) * Math.PI * 2 + random() * 0.4;
    const lean = 0.06 + random() * 0.14;
    node.position.set(Math.cos(turn) * 0.06, 0.3 + tall / 2 - 0.04, Math.sin(turn) * 0.06);
    node.rotation.set(Math.sin(turn) * lean, turn, -Math.cos(turn) * lean);
    group.add(node);
  }
  return group;
}

function framedArt(look, width = 0.8, height = 1.0) {
  const group = new Group();
  const frame = standard(look.wood, { roughness: 0.5 });
  const t = 0.035;
  group.add(box([width, t, 0.03], frame, [0, height / 2 - t / 2, 0.015]));
  group.add(box([width, t, 0.03], frame, [0, -height / 2 + t / 2, 0.015]));
  group.add(box([t, height, 0.03], frame, [-width / 2 + t / 2, 0, 0.015]));
  group.add(box([t, height, 0.03], frame, [width / 2 - t / 2, 0, 0.015]));
  const mount = mesh(new PlaneGeometry(width - 2 * t, height - 2 * t), standard(0xf4f0e8, { roughness: 0.95 }), { cast: false });
  mount.position.z = 0.008;
  const picture = mesh(
    new PlaneGeometry(width - 2 * t - 0.12, height - 2 * t - 0.12),
    standard(0xffffff, { map: cached(`art-${look.art.join()}`, () => artTexture(look.art)), roughness: 0.85 }),
    { cast: false }
  );
  picture.position.z = 0.01;
  group.add(mount, picture);
  return group;
}

function bookcase(look) {
  const group = new Group();
  const wood = standard(look.wood, { roughness: 0.6 });
  const width = 0.9;
  const height = 1.9;
  const depth = 0.32;
  group.add(box([width, height, 0.02], wood, [0, height / 2, -depth / 2 + 0.01]));
  for (const side of [-1, 1]) group.add(box([0.025, height, depth], wood, [side * (width / 2 - 0.0125), height / 2, 0]));
  const shelves = [0.04, 0.42, 0.8, 1.18, 1.56, height - 0.012];
  for (const y of shelves) group.add(box([width - 0.05, 0.025, depth - 0.02], wood, [0, y, 0.005]));
  const random = seeded(0xb00c);
  const spines = [0x8b3a2e, 0x2f4858, 0xc9b27c, 0x5d6b4a, 0xe3dccb, 0x3e3a36, 0x9a6a3a, 0x6b7f8e];
  for (const y of shelves.slice(0, -1)) {
    let x = -width / 2 + 0.05;
    while (x < width / 2 - 0.08) {
      const thick = 0.02 + random() * 0.03;
      const tall = 0.2 + random() * 0.12;
      if (random() < 0.12) {
        x += 0.08;
        continue;
      }
      const book = box([thick, tall, 0.2 + random() * 0.05], spines[Math.floor(random() * spines.length)], [x + thick / 2, y + 0.0125 + tall / 2, 0.02], { roughness: 0.7 });
      book.castShadow = false;
      group.add(book);
      x += thick + 0.002;
    }
  }
  return group;
}

/** A window: the sky beyond, a painted frame and glazing bars, and a sill. */
function windowUnit(look, width = 1.3, height = 1.5) {
  const group = new Group();
  const sky = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ map: cached("sky", skyTexture), toneMapped: false })
  );
  sky.userData.outline = false;
  sky.position.z = 0.002;
  group.add(sky);
  const paint = standard(look.trim, { roughness: 0.4 });
  const t = 0.06;
  group.add(box([width + 2 * t, t, 0.06], paint, [0, height / 2 + t / 2, 0.03]));
  group.add(box([width + 2 * t, t, 0.06], paint, [0, -height / 2 - t / 2, 0.03]));
  for (const side of [-1, 1]) group.add(box([t, height, 0.06], paint, [side * (width / 2 + t / 2), 0, 0.03]));
  group.add(box([0.03, height, 0.04], paint, [0, 0, 0.02]));
  group.add(box([width, 0.03, 0.04], paint, [0, height * 0.12, 0.02]));
  group.add(box([width + 0.26, 0.035, 0.16], paint, [0, -height / 2 - t - 0.0175, 0.08]));
  return group;
}

/* ------------------------------------------------------------------ */
/* The room                                                            */
/* ------------------------------------------------------------------ */

/**
 * The walls, each as the plane it stands in and the direction into the room:
 * `axis` is the one it is perpendicular to, `side` which end of the room it is
 * at. `u` runs along the wall, left to right as seen from inside.
 */
function wallFrames(half) {
  return {
    north: { axis: 2, side: -1, length: 2 * half[0], normal: [0, 0, 1], turn: 0 },
    south: { axis: 2, side: 1, length: 2 * half[0], normal: [0, 0, -1], turn: Math.PI },
    west: { axis: 0, side: -1, length: 2 * half[1], normal: [1, 0, 0], turn: Math.PI / 2 },
    east: { axis: 0, side: 1, length: 2 * half[1], normal: [-1, 0, 0], turn: -Math.PI / 2 },
  };
}

/**
 * Lay a room out round the scene.
 *
 * Centred on the origin, where the solver builds every scene, and grown in
 * half-metre steps, the rug with it, so an edit that moves an arm moves
 * neither: two layouts that compare equal are the same room, and the viewport
 * keeps the one it has.
 *
 * @param {string} setting one of `SETTINGS`
 * @param {{min:number[], max:number[]}} bounds the figures and their props
 * @param {Array<object>} props the solver's props
 * @returns {object|null} null for the studio, which is no room at all
 */
export function roomLayout(setting, bounds, props = []) {
  if (!LOOKS[setting]) return null;
  const reach = (axis) => Math.max(Math.abs(bounds.min[axis]), Math.abs(bounds.max[axis])) + MARGIN;
  const step = (value, least, by = 0.5) => Math.max(least, Math.ceil(value / by - 1e-9) * by);
  const half = [step(reach(0), MIN_HALF[0]), step(reach(2), MIN_HALF[1])];
  // A wall to lean on is part of the room: its back goes against the north
  // wall, so the figures lean on the room rather than on a panel in it.
  const wall = props.find((prop) => prop.kind === "wall");
  const north = wall ? wall.center[2] - wall.size[2] / 2 : -half[1];
  const depth = half[1] - north;
  const snap = (value) => Math.round(value * 2) / 2 + 0;
  // The rug lies under the figures and their furniture, a little wider than
  // both, and clear of the walls and what stands against them.
  const rug = [
    Math.min(2 * half[0] - 1.4, step(bounds.max[0] - bounds.min[0] + 0.9, 1.5)),
    Math.min(depth - (wall ? 0.75 : 1.4), step(bounds.max[2] - bounds.min[2] + 0.9, 1.5)),
  ];
  const middle = [snap((bounds.min[0] + bounds.max[0]) / 2), snap((bounds.min[2] + bounds.max[2]) / 2)];
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  // Nothing stands along a wall prop but the prop, so the rug may go up to it.
  const clear = wall ? 0.05 : 0.7;
  const at = [
    clamp(middle[0], -half[0] + 0.7 + rug[0] / 2, half[0] - 0.7 - rug[0] / 2),
    clamp(middle[1], north + clear + rug[1] / 2, half[1] - 0.7 - rug[1] / 2),
  ];
  return { setting, half, north: +north.toFixed(3), wall: !!wall, rug: { size: rug, at } };
}

/** The paint a room's walls are, for a wall prop standing against them. */
export function wallColour(setting) {
  return LOOKS[setting]?.wall ?? null;
}

/**
 * Build a room from its layout.
 *
 * @param {object} layout from `roomLayout`
 * @returns {Group}
 */
export function buildRoom(layout) {
  const { setting, half, north } = layout;
  const look = LOOKS[setting];
  const south = half[1];
  const depth = south - north;
  const middleZ = (north + south) / 2;
  const room = new Group();
  room.name = "room";
  room.userData.walls = [];

  const floorMap = cached(`floor-${setting}`, () => floorTexture(look.floor)).clone();
  floorMap.repeat.set((2 * half[0]) / FLOOR_TILE, depth / FLOOR_TILE);
  floorMap.needsUpdate = true;
  const floor = mesh(
    new PlaneGeometry(2 * half[0], depth),
    standard(0xffffff, { map: floorMap, roughness: 0.55 }),
    { cast: false }
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, middleZ);
  floor.name = "room-floor";
  room.add(floor);
  room.userData.floorMap = floorMap;

  // Flat: 3 mm is enough to catch the light as a thing of its own without
  // lifting anybody lying on it off the floor they were solved on.
  const rug = mesh(
    new BoxGeometry(layout.rug.size[0], 0.003, layout.rug.size[1]),
    standard(0xffffff, { map: cached(`rug-${setting}`, () => rugTexture(look.rug)), roughness: 0.97 }),
    { cast: false }
  );
  rug.position.set(layout.rug.at[0], 0.0015, layout.rug.at[1]);
  room.add(rug);

  const paint = standard(look.wall, { roughness: 0.92 });
  const trim = standard(look.trim, { roughness: 0.5 });
  const frames = wallFrames(half);
  const centre = { north: [0, north], south: [0, south], west: [-half[0], middleZ], east: [half[0], middleZ] };
  const along = { north: 2 * half[0], south: 2 * half[0], west: depth, east: depth };
  const walls = {};
  for (const [name, frame] of Object.entries(frames)) {
    const wall = new Group();
    wall.name = `wall-${name}`;
    wall.position.set(centre[name][0], 0, centre[name][1]);
    wall.rotation.y = frame.turn;
    const plane = mesh(new PlaneGeometry(along[name], WALL_HEIGHT), paint, { cast: false });
    plane.position.y = WALL_HEIGHT / 2;
    const skirting = mesh(new BoxGeometry(along[name], 0.1, 0.018), trim, { cast: false });
    skirting.position.set(0, 0.05, 0.009);
    wall.add(plane, skirting);
    wall.userData.normal = frame.normal;
    wall.userData.at = centre[name][frame.axis === 0 ? 0 : 1];
    wall.userData.axis = frame.axis;
    room.add(wall);
    room.userData.walls.push(wall);
    walls[name] = wall;
  }

  /**
   * Put `piece` against a wall, `u` along it from the middle, `off` out from
   * it. Along the north wall `u` runs east, along the west wall north, along
   * the east wall south and along the south wall west.
   */
  const place = (name, piece, u, y = 0, off = 0) => {
    piece.position.set(u, y, off);
    walls[name].add(piece);
    return piece;
  };
  const width = 2 * half[0];

  /** A window, with curtains either side hung in front of its sill, and their rod. */
  const hangWindow = (name, u) => {
    place(name, windowUnit(look), u, 1.55, 0);
    for (const side of [-1, 1]) place(name, curtain(0.55, 2.3, look.curtain), u + side * 0.95, 1.2, 0.2);
    const rod = mesh(new CylinderGeometry(0.012, 0.012, 2.5, 12), standard(0x3a3632, { roughness: 0.4, metalness: 0.6 }));
    rod.rotation.z = Math.PI / 2;
    place(name, rod, u, 2.38, 0.2);
  };
  const lamp = (name, u) => {
    place(name, floorLamp(look), u, 0, 0.35);
    place(name, glow(1.4, 1.6), u, 1.5, 0.01);
  };

  // What the three-quarter view looks at is the north and the west walls, so
  // the room's best things are there. A wall prop is 3 m of the north wall's
  // middle, and what would have stood in front of it goes round the corner.
  if (!layout.wall) {
    hangWindow("north", -width * 0.1);
    if (setting === "bedroom") {
      lamp("north", width / 2 - 0.35);
      place("west", framedArt(look), depth * 0.12, 1.55, 0.002);
      place("west", nightstand(look), depth * 0.12 + 0.35, 0, 0.22);
      place("east", framedArt(look, 0.6, 0.75), 0, 1.45, 0.002);
      place("east", plant(look, 1.05), depth / 2 - 0.4, 0, 0.35);
    } else {
      place("north", plant(look, 1.25), width / 2 - 0.4, 0, 0.4);
      lamp("west", depth / 2 - 0.35);
      place("west", bookcase(look), depth * 0.2, 0, 0.18);
      place("west", framedArt(look), -depth * 0.2, 1.5, 0.002);
      place("south", plant(look, 0.9), width / 2 - 0.45, 0, 0.4);
    }
  } else {
    hangWindow("west", 0);
    lamp("north", width / 2 - 0.35);
    place("north", plant(look, setting === "bedroom" ? 1.05 : 1.25), -width / 2 + 0.55, 0, 0.4);
    if (setting === "bedroom") {
      place("east", framedArt(look, 0.6, 0.75), 0, 1.45, 0.002);
    } else {
      place("east", bookcase(look), 0, 0, 0.18);
    }
  }
  return room;
}

/**
 * Make a setting's textures before its first room is wanted - while the first
 * scene is still being solved - so that room costs no more than its meshes.
 */
export function prepareRoom(setting) {
  const layout = roomLayout(setting, { min: [-1, 0, -1], max: [1, 1.8, 1] });
  if (layout) disposeRoom(buildRoom(layout));
}

/**
 * Hide the walls the camera is behind, and everything on them.
 *
 * A wall's own plane would cull itself - it faces into the room - but what
 * stands against it would not, so the whole wall group is switched off
 * together. A wall is drawn when the camera is on the room's side of it.
 */
export function updateRoom(room, camera) {
  if (!room) return;
  for (const wall of room.userData.walls) {
    const { axis, at, normal } = wall.userData;
    wall.visible = (camera.position.getComponent(axis) - at) * normal[axis] > 0;
  }
}

/** Release the geometry and materials a room owns; the textures are shared. */
export function disposeRoom(room) {
  if (!room) return;
  room.userData.floorMap?.dispose();
  const seen = new Set();
  room.traverse((node) => {
    if (!node.isMesh) return;
    if (!seen.has(node.geometry)) node.geometry.dispose();
    seen.add(node.geometry);
    if (!seen.has(node.material)) node.material.dispose();
    seen.add(node.material);
  });
}

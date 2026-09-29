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
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import { ROUGHNESS_SPAN } from "./fabric.js";
import { seeded } from "./roomTiles.js";
import { tiles } from "./tiles.js";

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

const channels = (hex) => {
  const c = new Color(hex);
  return [c.r, c.g, c.b].map((v) => new Color().setRGB(v, v, v).convertLinearToSRGB().r);
};

/** One tile of the floorboards, in metres: eight rows of planks 18 cm wide. */
export const FLOOR_TILE = 1.44;

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

/** How much wall, board, curtain and rug one tile of each covers, in metres. */
const PLASTER_TILE = 0.4;
export const WOOD_TILE = 0.6;
const LINEN_TILE = 0.025;
const KILIM_TILE = 0.06;
const KILIM = { size: 128, threads: 8, slub: 0.5, strength: 3, seed: 0x6b696c6d };

/** A tile from `fabric.js` or `surfaces.js`, as the textures three reads. */
function surface(tile) {
  const square = (data) => texture(data, [tile.size, tile.size], { colour: false });
  return {
    normal: square(tile.normal),
    map: tile.map ? square(tile.map) : null,
    mean: tile.mean ?? 1,
    roughness: tile.roughness ? square(tile.roughness.data) : null,
    factor: tile.roughness?.factor ?? 1,
  };
}

/** The floorboards' tile (see `roomTiles.js`) as the textures three reads. */
function boards(tile) {
  const square = (data, options) => texture(data, [tile.size, tile.size], options);
  return {
    map: square(tile.map),
    normal: square(tile.normal, { colour: false }),
    roughness: square(tile.roughness.data, { colour: false }),
    factor: tile.roughness.factor,
  };
}

/** A picture drawn once across what it is on, not tiled. */
const picture = (tile) => texture(tile.data, [tile.width, tile.height], { repeat: false });

const textures = new Map();
/**
 * A texture made of a tile: `request` names the tile (see `tiles.js`) and
 * `wrap` makes the texture of it. Made once for each tile and shared; `ready`
 * has the tile made ahead, on the worker.
 */
function made(request, wrap) {
  const get = (...args) => {
    const [name, ...rest] = request(...args);
    const key = `${name}${JSON.stringify(rest)}`;
    if (!textures.has(key)) textures.set(key, wrap(tiles.take(name, ...rest)));
    return textures.get(key);
  };
  get.ready = (...args) => tiles.prepare(...request(...args));
  return get;
}

const plaster = made(() => ["plaster"], surface);
const wood = made(() => ["wood"], surface);
const linen = made(() => ["weave"], surface);
const kilim = made(() => ["weave", KILIM], surface);
const floorboards = made((setting) => ["floor", LOOKS[setting].floor], boards);
const rugPattern = made((setting) => {
  const { field, border, line } = LOOKS[setting].rug;
  return ["rug", [field, border, line].map(channels)];
}, picture);
const artwork = made((look) => ["art", look.art.map(channels), look.art[0]], picture);
const sky = made(() => ["sky"], picture);
const pool = made(() => ["glow"], picture);

/**
 * What a room in `setting` is drawn with, one texture to a step, for making
 * ahead of the room itself: together they take the best part of a second,
 * the floor's million texels alone a third of it. The tiles are all asked for
 * at once, and made on the worker; each step's `ready` settles once its own
 * has come, and the step makes the texture of it.
 */
export function roomTextures(setting) {
  const look = LOOKS[setting];
  return [[floorboards, setting], [plaster], [wood], [linen], [kilim], [rugPattern, setting], [artwork, look], [sky], [pool]].map(
    ([get, ...args]) => Object.assign(() => get(...args), { ready: get.ready(...args) }),
  );
}

/** Once every tile of a room in `setting` - the studio has none - has been made. */
export function roomReady(setting) {
  return Promise.all(LOOKS[setting] ? roomTextures(setting).map((step) => step.ready) : []);
}

/**
 * A material over a surface: the colour given, divided by the surface's own
 * average so that from across the room it is still that colour, and the
 * roughness likewise.
 */
function finished(colour, look, { roughness = 0.8, normalScale = 1, ...options } = {}) {
  return standard(new Color(colour).multiplyScalar(1 / look.mean), {
    map: look.map,
    normalMap: look.normal,
    normalScale: new Vector2(normalScale, normalScale),
    roughness: look.roughness ? (roughness * ROUGHNESS_SPAN) / look.factor : roughness,
    roughnessMap: look.roughness,
    ...options,
  });
}

/** A plane's UVs in tiles of `tile` metres, so one texture does for any size of it. */
function tiled(geometry, width, height, tile) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, (uv.getX(i) * width) / tile, (uv.getY(i) * height) / tile);
  return geometry;
}

/**
 * A box with its UVs in tiles of `tile` metres face by face, and the grain -
 * which runs along `u` - down each face's longer side, the way a board's does.
 * Each face starts somewhere else in the tile, so two boards side by side are
 * not the same board twice.
 */
function grainedBox(size, tile, segments = [1, 1, 1]) {
  const [w, h, d] = size;
  const [sw, sh, sd] = segments;
  const geometry = new BoxGeometry(w, h, d, sw, sh, sd);
  // Three's faces in order, +x, -x, +y, -y, +z, -z: each one's extent across
  // and down, and the segments it is cut into each way.
  const faces = [[d, h, sd, sh], [d, h, sd, sh], [w, d, sw, sd], [w, d, sw, sd], [w, h, sw, sh], [w, h, sw, sh]];
  const uv = geometry.attributes.uv;
  let start = 0;
  faces.forEach(([du, dv, gu, gv], f) => {
    const shift = (f * 0.37 + w * 7.3 + h * 3.1 + d * 5.7) % 1;
    const end = start + (gu + 1) * (gv + 1);
    for (let k = start; k < end; k += 1) {
      const u = (uv.getX(k) * du) / tile;
      const v = (uv.getY(k) * dv) / tile;
      if (dv > du) uv.setXY(k, v, u + shift);
      else uv.setXY(k, u, v + shift);
    }
    start = end;
  });
  return geometry;
}

/**
 * The light a corner gets, as a colour on the vertices: `shade` of each
 * vertex's own x and y.
 *
 * A room is darker where its walls meet each other and the floor, because each
 * hides half the room from the other. It is the thing about indoor light that
 * most says indoors, and the one three's lights, which see no walls, do not
 * do: without it the walls met the floor like sheets of card stood on a board.
 */
function shaded(geometry, shade) {
  const position = geometry.attributes.position;
  const colour = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) colour.fill(shade(position.getX(i), position.getY(i)), i * 3, i * 3 + 3);
  geometry.setAttribute("color", new Float32BufferAttribute(colour, 3));
  return geometry;
}

/** How dark a corner is `d` metres out from it, with `depth` of shade in it at most. */
const corner = (d, depth, reach) => 1 - depth * Math.exp(-Math.max(0, d) / reach);

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

/** A box of wood, its grain along it; `material` is one of `woodFinish`'s. */
function board(size, material, at) {
  const node = mesh(grainedBox(size, WOOD_TILE), material);
  node.position.set(...at);
  return node;
}

/** Wood in a colour, figured, with its pores duller than its face. */
export function woodFinish(colour, roughness = 0.55) {
  return finished(colour, wood(), { roughness });
}

/**
 * Woven cloth in a colour, for what is upholstered or made up: the curtains'
 * linen, on geometry whose UVs are in tiles of however fine a weave it is.
 */
export function clothFinish(colour, options) {
  return finished(colour, linen(), { roughness: 0.95, normalScale: 0.8, ...options });
}

/**
 * A curtain: a sheet of linen hung in folds, deeper at the top where it is
 * gathered and each a little different from the next - an even ripple, every
 * fold the same, is what a curtain in a render looks like and no curtain does.
 */
function curtain(width, height, colour, seed = 1) {
  const geometry = tiled(new PlaneGeometry(width, height, 64, 12), width, height, LINEN_TILE);
  const position = geometry.attributes.position;
  const folds = Math.round(width / 0.11);
  const random = seeded(0xc0f7 + seed);
  const [phase, wobble, drift] = [random() * 6, random() * 6, 0.6 + random() * 0.8];
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const along = x / width + 0.5;
    const down = 0.5 - y / height;
    const gather = 0.75 + 0.25 * (1 - down);
    // The folds' spacing wanders, and loosens towards the hem as they fall.
    const turn = along * folds * Math.PI * 2 + 0.9 * Math.sin(along * 5 + phase) + drift * down * Math.sin(along * 9 + wobble);
    const depth = 0.035 * gather * (0.85 + 0.15 * Math.sin(along * 7 + wobble));
    position.setZ(i, Math.sin(turn) * depth);
  }
  geometry.computeVertexNormals();
  return mesh(geometry, finished(colour, linen(), { roughness: 0.95, side: DoubleSide, normalScale: 0.8 }), { cast: false });
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
      map: pool(),
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
  const carcass = woodFinish(look.wood);
  // A top that overhangs a little, on a carcass on a plinth set back from it -
  // the three lines a made piece of furniture has and a box does not.
  group.add(board([0.5, 0.03, 0.4], carcass, [0, 0.505, 0]));
  group.add(board([0.47, 0.44, 0.37], carcass, [0, 0.27, -0.015]));
  group.add(board([0.43, 0.05, 0.33], woodFinish(new Color(look.wood).multiplyScalar(0.6)), [0, 0.025, -0.02]));
  const face = woodFinish(new Color(look.wood).multiplyScalar(0.85));
  group.add(board([0.44, 0.16, 0.012], face, [0, 0.4, 0.17]));
  group.add(board([0.44, 0.2, 0.012], face, [0, 0.18, 0.17]));
  const brass = standard(0xb8955a, { roughness: 0.3, metalness: 0.8 });
  group.add(box([0.1, 0.012, 0.02], brass, [0, 0.4, 0.186]));
  group.add(box([0.1, 0.012, 0.02], brass, [0, 0.18, 0.186]));
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
  const frame = woodFinish(look.wood, 0.5);
  const t = 0.035;
  group.add(board([width, t, 0.03], frame, [0, height / 2 - t / 2, 0.015]));
  group.add(board([width, t, 0.03], frame, [0, -height / 2 + t / 2, 0.015]));
  group.add(board([t, height, 0.03], frame, [-width / 2 + t / 2, 0, 0.015]));
  group.add(board([t, height, 0.03], frame, [width / 2 - t / 2, 0, 0.015]));
  const mount = mesh(new PlaneGeometry(width - 2 * t, height - 2 * t), standard(0xf4f0e8, { roughness: 0.95 }), { cast: false });
  mount.position.z = 0.008;
  const picture = mesh(
    new PlaneGeometry(width - 2 * t - 0.12, height - 2 * t - 0.12),
    standard(0xffffff, { map: artwork(look), roughness: 0.85 }),
    { cast: false }
  );
  picture.position.z = 0.01;
  group.add(mount, picture);
  return group;
}

function bookcase(look) {
  const group = new Group();
  const wood = woodFinish(look.wood);
  const width = 0.9;
  const height = 1.9;
  const depth = 0.32;
  group.add(board([width, height, 0.02], wood, [0, height / 2, -depth / 2 + 0.01]));
  for (const side of [-1, 1]) group.add(board([0.025, height, depth], wood, [side * (width / 2 - 0.0125), height / 2, 0]));
  const shelves = [0.04, 0.42, 0.8, 1.18, 1.56, height - 0.012];
  for (const y of shelves) group.add(board([width - 0.05, 0.025, depth - 0.02], wood, [0, y, 0.005]));
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
  const view = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: sky(), toneMapped: false }));
  view.userData.outline = false;
  view.position.z = 0.002;
  group.add(view);
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

/**
 * Paint a wall to lean on as the room's own walls are painted. It stands where
 * the room's north wall is (see `roomLayout`) and is the same wall as far as
 * the picture goes, so a flat panel of the same colour in front of the plaster
 * would give it away.
 *
 * @param {Mesh} node the prop's mesh, a box
 * @param {string} setting
 */
export function paintWall(node, setting) {
  const look = LOOKS[setting];
  if (!look) return;
  node.geometry.computeBoundingBox();
  const size = node.geometry.boundingBox.getSize(new Vector3()).toArray();
  node.geometry.dispose();
  node.geometry = shaded(grainedBox(size, PLASTER_TILE, [1, Math.ceil(size[1] / 0.1), 1]), (x, y) => corner(y + size[1] / 2, 0.25, 0.2));
  node.material.dispose();
  node.material = finished(look.wall, plaster(), { roughness: 0.92, normalScale: 0.7, vertexColors: true });
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

  const width = 2 * half[0];
  const boards = floorboards(setting);
  // A vertex every ten centimetres, which is what the corners' shade needs to
  // fall off smoothly, and the boards in metres rather than stretched.
  const floorGeometry = tiled(
    new PlaneGeometry(width, depth, Math.ceil(width / 0.1), Math.ceil(depth / 0.1)),
    width,
    depth,
    FLOOR_TILE
  );
  shaded(floorGeometry, (x, y) => corner(width / 2 - Math.abs(x), 0.3, 0.2) * corner(depth / 2 - Math.abs(y), 0.3, 0.2));
  // Varnished: the boards' own sheen under a coat that gives back the window.
  const floor = mesh(
    floorGeometry,
    new MeshPhysicalMaterial({
      map: boards.map,
      normalMap: boards.normal,
      roughnessMap: boards.roughness,
      roughness: (0.6 * ROUGHNESS_SPAN) / boards.factor,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.22,
      vertexColors: true,
    }),
    { cast: false }
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, middleZ);
  floor.name = "room-floor";
  room.add(floor);

  // Flat: 3 mm is enough to catch the light as a thing of its own without
  // lifting anybody lying on it off the floor they were solved on. Its pattern
  // is drawn once across it and its weave tiled over that, from a second set
  // of UVs in metres.
  const rugGeometry = new BoxGeometry(layout.rug.size[0], 0.003, layout.rug.size[1]);
  const inMetres = rugGeometry.attributes.uv.clone();
  for (let i = 0; i < inMetres.count; i += 1)
    inMetres.setXY(i, (inMetres.getX(i) * layout.rug.size[0]) / KILIM_TILE, (inMetres.getY(i) * layout.rug.size[1]) / KILIM_TILE);
  rugGeometry.setAttribute("uv1", inMetres);
  const weave = kilim();
  weave.normal.channel = 1;
  const rug = mesh(
    rugGeometry,
    standard(0xffffff, {
      map: rugPattern(setting),
      normalMap: weave.normal,
      normalScale: new Vector2(0.8, 0.8),
      roughness: 0.97,
    }),
    { cast: false }
  );
  rug.position.set(layout.rug.at[0], 0.0015, layout.rug.at[1]);
  room.add(rug);

  const paint = finished(look.wall, plaster(), { roughness: 0.92, normalScale: 0.7, vertexColors: true });
  const trim = standard(look.trim, { roughness: 0.5 });
  const frames = wallFrames(half);
  const centre = { north: [0, north], south: [0, south], west: [-half[0], middleZ], east: [half[0], middleZ] };
  const along = { north: width, south: width, west: depth, east: depth };
  const walls = {};
  for (const [name, frame] of Object.entries(frames)) {
    const wall = new Group();
    wall.name = `wall-${name}`;
    wall.position.set(centre[name][0], 0, centre[name][1]);
    wall.rotation.y = frame.turn;
    const length = along[name];
    const geometry = tiled(new PlaneGeometry(length, WALL_HEIGHT, Math.ceil(length / 0.1), 26), length, WALL_HEIGHT, PLASTER_TILE);
    shaded(geometry, (x, y) =>
      corner(length / 2 - Math.abs(x), 0.25, 0.3) *
      corner(y + WALL_HEIGHT / 2 - 0.1, 0.25, 0.2) *
      // There is no ceiling - the camera looks in over the walls - but a
      // wall is lit as if there were, or its top edge reads as the top of a
      // partition.
      corner(WALL_HEIGHT / 2 - y, 0.12, 0.25)
    );
    const plane = mesh(geometry, paint, { cast: false });
    plane.position.y = WALL_HEIGHT / 2;
    // And the cornice the ceiling would meet: a board and a lip over it.
    plane.add(box([length, 0.075, 0.02], trim, [0, WALL_HEIGHT / 2 - 0.0375, 0.01]));
    plane.add(box([length, 0.022, 0.042], trim, [0, WALL_HEIGHT / 2 - 0.011, 0.021]));
    const skirting = mesh(new BoxGeometry(length, 0.1, 0.018), trim, { cast: false });
    skirting.position.set(0, 0.05, 0.009);
    // The skirting's rounded top, as a bead standing a little proud of it.
    skirting.add(box([length, 0.012, 0.026], trim, [0, 0.044, 0.004]));
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

  /** A window, with curtains either side hung in front of its sill, and their rod. */
  const hangWindow = (name, u) => {
    place(name, windowUnit(look), u, 1.55, 0);
    for (const side of [-1, 1]) place(name, curtain(0.55, 2.3, look.curtain, side + 2), u + side * 0.95, 1.2, 0.2);
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
 * Hide the walls the camera is behind, and everything on them.
 *
 * A wall's own plane would cull itself - it faces into the room - but what
 * stands against it would not, so the whole wall group is switched off
 * together. A wall is drawn when the camera is on the room's side of it.
 * Says whether any wall came or went, since what stands against one casts.
 */
export function updateRoom(room, camera) {
  if (!room) return false;
  let changed = false;
  for (const wall of room.userData.walls) {
    const { axis, at, normal } = wall.userData;
    const visible = (camera.position.getComponent(axis) - at) * normal[axis] > 0;
    changed ||= visible !== wall.visible;
    wall.visible = visible;
  }
  return changed;
}

/**
 * Release the geometry and materials a room owns; the textures are shared.
 * `release` is handed each material, as `disposeProps` hands them.
 */
export function disposeRoom(room, release = (material) => material.dispose()) {
  if (!room) return;
  const seen = new Set();
  room.traverse((node) => {
    if (!node.isMesh) return;
    if (!seen.has(node.geometry)) node.geometry.dispose();
    seen.add(node.geometry);
    if (!seen.has(node.material)) release(node.material);
    seen.add(node.material);
  });
}

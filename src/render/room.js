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
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { ROUGHNESS_SPAN } from "./fabric.js";
import { seeded } from "./roomTiles.js";
import {
  board,
  boards,
  box,
  channels,
  clothFinish,
  corner,
  finished,
  grainedBox,
  laid,
  LINEN_TILE,
  linen,
  made,
  mesh,
  picture,
  plaster,
  PLASTER_TILE,
  shaded,
  standard,
  steps,
  surface,
  tiled,
  wood,
  WOOD_TILE,
  woodFinish,
} from "./roomKit.js";
import { PLACES } from "./places.js";

export { clothFinish, WOOD_TILE, woodFinish };

/**
 * The looks a scene can be set in: the rooms here, the places that are not
 * rooms (see `places.js`), and "studio", the plain backdrop, last.
 */
export const SETTINGS = ["bedroom", "living", "hotel", "beach", "pool", "fashion", "studio"];

/**
 * What each room is made of. Colours are sRGB, as a designer would give them;
 * the materials convert. The walls are kept pale and unsaturated so the skin
 * in front of them is still the warmest, most saturated thing in the picture.
 *
 * `plan` is which room's furniture plan a room borrows, and `night` lights its
 * lamps for a room seen after dark, with the city beyond its window.
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
  // A suite at night: dark walnut, a deep blue rug with a gold border, heavy
  // curtains, and the lamps the only light but the city's.
  hotel: {
    wall: 0xb9ab98,
    trim: 0x3a2f27,
    floor: { base: [0.34, 0.22, 0.14], spread: 0.08 },
    rug: { field: 0x26344a, border: 0xa88a52, line: 0xd9c9a3 },
    curtain: 0x6a2430,
    wood: 0x3e2a1e,
    shade: 0xf7e2bc,
    accent: 0xa98653,
    art: [0x2b2e36, 0xb08f5a, 0x7a2e38, 0xd6c8ae],
    plan: "bedroom",
    night: true,
  },
};

/** The height of the walls: a little over the 2.4 m the pole and wall props stand. */
const WALL_HEIGHT = 2.6;

/** The clear floor kept round the scene before the walls, and the smallest room. */
const MARGIN = 1.15;
const MIN_HALF = [2.5, 2.5];

/** One tile of the floorboards, in metres: eight rows of planks 18 cm wide. */
export const FLOOR_TILE = 1.44;

/** How much of a rug one tile of its weave covers, in metres. */
const KILIM_TILE = 0.06;
const KILIM = { size: 128, threads: 8, slub: 0.5, strength: 3, seed: 0x6b696c6d };

const kilim = made(() => ["weave", KILIM], surface);
const floorboards = made((setting) => ["floor", LOOKS[setting].floor], boards);
const rugPattern = made((setting) => {
  const { field, border, line } = LOOKS[setting].rug;
  return ["rug", [field, border, line].map(channels)];
}, picture);
const artwork = made((look) => ["art", look.art.map(channels), look.art[0]], picture);
const sky = made(() => ["sky"], picture);
const city = made(() => ["night"], picture);
const pool = made(() => ["glow"], picture);

/**
 * What a scene in `setting` is drawn with, one texture to a step, for making
 * ahead of the room itself: together a room's take the best part of a second,
 * the floor's million texels alone a third of it. The tiles are all asked for
 * at once, and made on the worker; each step's `ready` settles once its own
 * has come, and the step makes the texture of it.
 */
export function roomTextures(setting) {
  if (PLACES[setting]) return PLACES[setting].textures();
  const look = LOOKS[setting];
  return steps([
    [floorboards, setting], [plaster], [wood], [linen], [kilim], [rugPattern, setting], [artwork, look],
    [look.night ? city : sky], [pool],
  ]);
}

/** Once every tile of a scene in `setting` - the studio has none - has been made. */
export function roomReady(setting) {
  return Promise.all(LOOKS[setting] || PLACES[setting] ? roomTextures(setting).map((step) => step.ready) : []);
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

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

/** A lamp shade that glows from inside, open top and bottom - brighter at night, with nothing else lit. */
function shade(top, bottom, height, look) {
  const material = standard(look.shade, {
    emissive: new Color(0xffd9a0),
    emissiveIntensity: look.night ? 2.2 : 0.9,
    roughness: 0.9,
    side: DoubleSide,
  });
  return mesh(new CylinderGeometry(top, bottom, height, 32, 1, true), material, { cast: false });
}

/** The pool of light a lamp leaves on the wall behind it. */
function glow(width, height, look) {
  const node = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({
      map: pool(),
      transparent: true,
      opacity: look.night ? 0.6 : 0.32,
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
  const top = shade(0.16, 0.22, 0.3, look);
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
  const top = shade(0.1, 0.15, 0.2, look);
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

/** A window: the sky beyond - or the city, after dark - a painted frame and glazing bars, and a sill. */
function windowUnit(look, width = 1.3, height = 1.5) {
  const group = new Group();
  const view = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: look.night ? city() : sky(), toneMapped: false }));
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
  if (!LOOKS[setting] && !PLACES[setting]) return null;
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
  const look = LOOKS[setting] ?? PLACES[setting];
  if (!look) return;
  node.geometry.computeBoundingBox();
  const size = node.geometry.boundingBox.getSize(new Vector3()).toArray();
  node.geometry.dispose();
  node.geometry = shaded(grainedBox(size, PLASTER_TILE, [1, Math.ceil(size[1] / 0.1), 1]), (x, y) => corner(y + size[1] / 2, 0.25, 0.2));
  node.material.dispose();
  node.material = finished(look.wall, plaster(), { roughness: 0.92, normalScale: look.plaster ?? 0.7, vertexColors: true });
}

/**
 * Build a room from its layout.
 *
 * @param {object} layout from `roomLayout`
 * @returns {Group}
 */
export function buildRoom(layout) {
  const { setting, half, north } = layout;
  if (PLACES[setting]) return PLACES[setting].build(layout);
  const look = LOOKS[setting];
  const plan = look.plan ?? setting;
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

  room.add(laid(layout.rug.size, layout.rug.at, rugPattern(setting), kilim(), KILIM_TILE));

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

  /**
   * What lights the figures, by the part each plays (see `LIGHTING` in
   * `renderer.js`), each where it is in the room: a window's middle, or a
   * lamp's shade.
   */
  const sources = (room.userData.sources = {});
  const source = (part, name, u, y, off) => {
    walls[name].updateMatrix();
    sources[part] = new Vector3(u, y, off).applyMatrix4(walls[name].matrix).toArray();
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
    // The light comes from the shade, past the lamp's own pole, not through it.
    place(name, floorLamp(look), u, 0, 0.35).traverse((node) => (node.castShadow = false));
    place(name, glow(1.4, 1.6, look), u, 1.5, 0.01);
  };
  const bedside = (name, u, off) => {
    place(name, nightstand(look), u, 0, off);
    // After dark the bedside lamp lights the wall over it too.
    if (look.night) {
      place(name, glow(0.9, 1, look), u - 0.08, 0.95, 0.01);
      source("bedside", name, u - 0.08, 0.88, off - 0.02);
    }
  };

  // What the three-quarter view looks at is the north and the west walls, so
  // the room's best things are there. A wall prop is 3 m of the north wall's
  // middle, and what would have stood in front of it goes round the corner.
  //
  // The light comes from where the room has it. By day the key is a window on
  // the east wall, to the right of the camera and out of its picture, as a
  // photographer would have it; the window in the picture is behind the
  // figures, and edges them. After dark the key is a floor lamp on the east
  // wall, the lamp in the north-east corner edges the figures, and the bedside
  // lamp is all there is on their other side.
  const back = layout.wall ? "west" : "north";
  const backU = layout.wall ? 0 : -width * 0.1;
  hangWindow(back, backU);
  source("back", back, backU, 1.55, 0);
  // Against a wall prop the room is too shallow for the east window's curtains
  // and the corner lamp both, and by day the lamp is not lighting anything.
  if (layout.wall ? look.night : plan === "bedroom") {
    lamp("north", width / 2 - 0.35);
    source("corner", "north", width / 2 - 0.35, 1.52, 0.35);
  }
  if (look.night) {
    lamp("east", 0);
    source("key", "east", 0, 1.52, 0.35);
    place("east", framedArt(look, 0.6, 0.75), -depth * 0.28, 1.45, 0.002);
  } else {
    hangWindow("east", depth * 0.08);
    source("key", "east", depth * 0.08, 1.55, 0);
  }
  if (!layout.wall) {
    if (plan === "bedroom") {
      place("west", framedArt(look), depth * 0.12, 1.55, 0.002);
      bedside("west", depth * 0.12 + 0.35, 0.22);
      if (!look.night) place("south", framedArt(look, 0.6, 0.75), 0, 1.45, 0.002);
      place("east", plant(look, 1.05), depth / 2 - 0.4, 0, 0.35);
    } else {
      place("north", plant(look, 1.25), width / 2 - 0.4, 0, 0.4);
      lamp("west", depth / 2 - 0.35);
      place("west", bookcase(look), depth * 0.2, 0, 0.18);
      place("west", framedArt(look), -depth * 0.2, 1.5, 0.002);
      place("south", plant(look, 0.9), width / 2 - 0.45, 0, 0.4);
    }
  } else {
    // After dark the bedside lamp takes the plant's corner.
    if (look.night) bedside("north", -width / 2 + 0.55, 0.22);
    else place("north", plant(look, plan === "bedroom" ? 1.05 : 1.25), -width / 2 + 0.55, 0, 0.4);
    if (plan === "bedroom") {
      if (!look.night) place("south", framedArt(look, 0.6, 0.75), 0, 1.45, 0.002);
    } else {
      place("south", bookcase(look), 0, 0, 0.18);
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

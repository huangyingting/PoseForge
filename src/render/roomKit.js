/**
 * What every setting is built with: the room's (see `room.js`) and the other
 * places' (see `places.js`).
 *
 * Their textures, each made of a tile from the worker (see `tiles.js`) once and
 * shared; the materials laid over those so that a surface seen from across the
 * room is still the colour it was given; and geometry whose UVs are in metres,
 * so one tile does for a surface of any size.
 */

import {
  BoxGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
} from "three";
import { ROUGHNESS_SPAN } from "./fabric.js";
import { tiles } from "./tiles.js";

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */

export function texture(data, size, { repeat = true, colour = true } = {}) {
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

/** A colour as the channels a tile is drawn in: sRGB, 0 to 1. */
export const channels = (hex) => {
  const c = new Color(hex);
  return [c.r, c.g, c.b].map((v) => new Color().setRGB(v, v, v).convertLinearToSRGB().r);
};

/** How much wall, board and curtain one tile of each covers, in metres. */
export const PLASTER_TILE = 0.4;
export const WOOD_TILE = 0.6;
export const LINEN_TILE = 0.025;

/** A tile from `fabric.js`, `surfaces.js` or `placeTiles.js`, as the textures three reads. */
export function surface(tile) {
  const square = (data) => texture(data, [tile.size, tile.size], { colour: false });
  return {
    normal: square(tile.normal),
    map: tile.map ? square(tile.map) : null,
    mean: tile.mean ?? 1,
    roughness: tile.roughness ? square(tile.roughness.data) : null,
    factor: tile.roughness?.factor ?? 1,
  };
}

/** A tile that carries its own colour - floorboards, mosaic - as the textures three reads. */
export function boards(tile) {
  const square = (data, options) => texture(data, [tile.size, tile.size], options);
  return {
    map: square(tile.map),
    normal: square(tile.normal, { colour: false }),
    roughness: square(tile.roughness.data, { colour: false }),
    factor: tile.roughness.factor,
  };
}

/** A picture drawn once across what it is on, not tiled. */
export const picture = (tile) => texture(tile.data, [tile.width, tile.height], { repeat: false });

/** A picture tiled across what it is on. */
export const pattern = (tile) => texture(tile.data, [tile.width, tile.height]);

const textures = new Map();
/**
 * A texture made of a tile: `request` names the tile (see `tiles.js`) and
 * `wrap` makes the texture of it. Made once for each tile and shared; `ready`
 * has the tile made ahead, on the worker.
 */
export function made(request, wrap) {
  const get = (...args) => {
    const [name, ...rest] = request(...args);
    const key = `${name}${JSON.stringify(rest)}`;
    if (!textures.has(key)) textures.set(key, wrap(tiles.take(name, ...rest)));
    return textures.get(key);
  };
  get.ready = (...args) => tiles.prepare(...request(...args));
  return get;
}

/**
 * Textures to be made ahead of what is built with them, one to a step: each
 * step's `ready` settles once its tile has come from the worker, and the step
 * makes the texture of it.
 *
 * @param {Array<Array>} list each a `made` texture and its arguments
 */
export const steps = (list) =>
  list.map(([get, ...args]) => Object.assign(() => get(...args), { ready: get.ready(...args) }));

export const plaster = made(() => ["plaster"], surface);
export const wood = made(() => ["wood"], surface);
export const linen = made(() => ["weave"], surface);

/**
 * A material over a surface: the colour given, divided by the surface's own
 * average so that from across the room it is still that colour, and the
 * roughness likewise.
 */
export function finished(colour, look, { roughness = 0.8, normalScale = 1, ...options } = {}) {
  return standard(new Color(colour).multiplyScalar(1 / look.mean), {
    map: look.map,
    normalMap: look.normal,
    normalScale: new Vector2(normalScale, normalScale),
    roughness: look.roughness ? (roughness * ROUGHNESS_SPAN) / look.factor : roughness,
    roughnessMap: look.roughness,
    ...options,
  });
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** A plane's UVs in tiles of `tile` metres, so one texture does for any size of it. */
export function tiled(geometry, width, height, tile) {
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
export function grainedBox(size, tile, segments = [1, 1, 1]) {
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
export function shaded(geometry, shade) {
  const position = geometry.attributes.position;
  const colour = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i += 1) colour.fill(shade(position.getX(i), position.getY(i)), i * 3, i * 3 + 3);
  geometry.setAttribute("color", new Float32BufferAttribute(colour, 3));
  return geometry;
}

/** How dark a corner is `d` metres out from it, with `depth` of shade in it at most. */
export const corner = (d, depth, reach) => 1 - depth * Math.exp(-Math.max(0, d) / reach);

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

export function standard(colour, options = {}) {
  return new MeshStandardMaterial({ color: new Color(colour), roughness: 0.8, metalness: 0, ...options });
}

export function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const node = new Mesh(geometry, material);
  node.castShadow = cast;
  node.receiveShadow = receive;
  // Line art is of the figures and what they touch, not the room.
  node.userData.outline = false;
  return node;
}

export function box(size, colour, at, options) {
  const node = mesh(new BoxGeometry(...size), typeof colour === "object" ? colour : standard(colour, options));
  node.position.set(...at);
  return node;
}

/** A box of wood, its grain along it; `material` is one of `woodFinish`'s. */
export function board(size, material, at) {
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
 * Something flat laid on the floor - a rug, a towel - 3 mm thick: enough to
 * catch the light as a thing of its own without lifting anybody lying on it off
 * the floor they were solved on. Its picture is drawn once across it and the
 * weave of `cloth` tiled over that every `tile` metres, from a second set of UVs.
 */
export function laid(size, at, map, cloth, tile, { roughness = 0.97, normalScale = 0.8 } = {}) {
  const geometry = new BoxGeometry(size[0], 0.003, size[1]);
  const inMetres = geometry.attributes.uv.clone();
  for (let i = 0; i < inMetres.count; i += 1)
    inMetres.setXY(i, (inMetres.getX(i) * size[0]) / tile, (inMetres.getY(i) * size[1]) / tile);
  geometry.setAttribute("uv1", inMetres);
  cloth.normal.channel = 1;
  const node = mesh(
    geometry,
    standard(0xffffff, { map, normalMap: cloth.normal, normalScale: new Vector2(normalScale, normalScale), roughness }),
    { cast: false }
  );
  node.position.set(at[0], 0.0015, at[1]);
  return node;
}

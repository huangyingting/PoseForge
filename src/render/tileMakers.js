/**
 * Every picture the viewport draws in code, by name: the room's, the cloth's
 * and the figure's. Each is a function of its arguments and nothing else, so
 * the page and the tile worker (see `tiles.js`) make the same bytes of it.
 */
import { artTile, floorTile, glowTile, rugTile, skyTile } from "./roomTiles.js";
import { plasterTile, woodTile } from "./surfaces.js";
import { foldTile, grainTile, heatherTile, knitTile, reliefTile, ribTile, weaveTile } from "./fabric.js";
import { eyeTile, skinTile } from "./figureTiles.js";
import { LACE_SIZE, lacePattern } from "../core/lace.js";

export const TILE_MAKERS = {
  floor: floorTile,
  rug: rugTile,
  art: artTile,
  sky: skyTile,
  glow: glowTile,
  plaster: plasterTile,
  wood: woodTile,
  weave: weaveTile,
  knit: knitTile,
  grain: grainTile,
  lace: () => reliefTile(lacePattern(), LACE_SIZE),
  heather: heatherTile,
  rib: ribTile,
  fold: foldTile,
  skin: skinTile,
  eye: eyeTile,
};

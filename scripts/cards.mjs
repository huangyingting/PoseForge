/**
 * The hair cards, read in node: the headless renderer and the validators put
 * them on the templates they load, as the viewport's worker does.
 */

import { readFileSync } from "node:fs";
import { readCards, withCards } from "../src/core/hairCards.js";
import { decodePNG } from "./atlas.mjs";

const HAIR = new URL("../assets/models/hair/", import.meta.url);
let shared = null;
const fitted = new Map();
const textures = new Map();

/**
 * `template` with the cards fitted to `mesh` (a body's file stem, as
 * `modelFiles` names it) on it, or `template` unchanged if there are none to
 * read - which leaves it the shell.
 */
export function withBodyCards(template, mesh) {
  try {
    shared ??= readCards(readFileSync(new URL("cards.bin", HAIR)));
    if (!fitted.has(mesh)) fitted.set(mesh, readCards(readFileSync(new URL(`cards-${mesh}.bin`, HAIR))));
    return withCards(template, shared, fitted.get(mesh));
  } catch (error) {
    if (error.code === "ENOENT") return template;
    throw error;
  }
}

/** A card texture by name, as grey and alpha. */
export function cardTexture(name) {
  if (!textures.has(name)) textures.set(name, decodePNG(readFileSync(new URL(`${name}.png`, HAIR))));
  return textures.get(name);
}

/**
 * The viewport's drawn pictures, made off the page's thread (see
 * `render/tiles.js`): each tile the page asks for, in the order it asks, and
 * its bytes handed over rather than copied.
 */
import { TILE_MAKERS } from "../render/tileMakers.js";

// Every array in a tile, once each.
function buffers(value, found = new Set()) {
  if (ArrayBuffer.isView(value)) found.add(value.buffer);
  else if (value && typeof value === "object") for (const item of Object.values(value)) buffers(item, found);
  return found;
}

self.onmessage = ({ data: { id, name, args } }) => {
  try {
    const tile = TILE_MAKERS[name](...args);
    self.postMessage({ id, tile }, [...buffers(tile)]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};

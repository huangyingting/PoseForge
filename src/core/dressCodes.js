/**
 * What the figures wear where.
 *
 * A setting can have a dress code: swimwear on the beach and by the pool,
 * lingerie and boxer briefs at the fashion shoot. Wearing it is a way of seeing
 * the scene, like the setting itself, and not a change to it - the scene keeps
 * the clothes it was written with, and the figures are drawn in the setting's
 * instead (see `bodyWorker.js`).
 *
 * Each body has its set and its colours; two figures of a kind in one scene
 * wear the first colour and the next, so a pair on the beach is not dressed
 * alike. Cuffs are not clothes in that sense and stay on whoever has them.
 */

import { OUTFITS } from "./garments.js";

export const DRESS_CODES = {
  beach: {
    female: { wearing: OUTFITS.bikini, colours: ["red", "navy", "white", "sage"] },
    male: { wearing: OUTFITS.swim, colours: ["navy", "black", "red", "sage"] },
  },
  pool: {
    female: { wearing: OUTFITS.bikini, colours: ["white", "black", "clay", "navy"] },
    male: { wearing: OUTFITS.swim, colours: ["black", "navy", "white", "grey"] },
  },
  fashion: {
    female: { wearing: OUTFITS.lingerie, colours: ["black", "red", "nude", "white"] },
    male: { wearing: OUTFITS.boxers, colours: ["black", "grey", "white", "navy"] },
  },
};

/** What a figure keeps on whatever the setting. */
const KEPT = new Set(["cuffs"]);

/**
 * What each figure wears in the setting: its pieces and their colour, or null
 * for every figure if the setting has no dress code.
 *
 * @param {string|null} code a key of `DRESS_CODES`
 * @param {Array<{bodyType?: string, wearing?: string[]}>} figures
 * @returns {Array<{wearing: string[], outfit: string}|null>}
 */
export function dressFigures(code, figures) {
  const rules = code != null && Object.hasOwn(DRESS_CODES, code) ? DRESS_CODES[code] : null;
  if (!rules) return figures.map(() => null);
  const counts = { female: 0, male: 0 };
  return figures.map(({ bodyType, wearing }) => {
    // A cup needs a bust to hold, so a neutral body dresses as a man does.
    const kind = bodyType === "female" ? "female" : "male";
    const { wearing: set, colours } = rules[kind];
    const outfit = colours[counts[kind] % colours.length];
    counts[kind] += 1;
    return { wearing: [...set, ...(wearing ?? []).filter((piece) => KEPT.has(piece))], outfit };
  });
}

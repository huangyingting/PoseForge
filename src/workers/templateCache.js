import { featureRelief } from "../core/humanMesh.js";
import { withGarments } from "../core/garments.js";
import { withHair } from "../core/hair.js";
import {
  humanBodyOptions,
  humanBodyKey,
  humanTemplateKey,
} from "./templateKey.js";

/** Bounded promise caches: body shape can survive a clothing/color/style edit.
 * Derived templates share immutable buffers with their source; the renderer
 * still skins and transfers fresh buffers for each posed figure. */
export function createTemplateCache(
  scanned,
  {
    bodyCapacity = 8,
    templateCapacity = 24,
    relieve = featureRelief,
    dress = withGarments,
    addHair = withHair,
  } = {},
) {
  for (const value of [bodyCapacity, templateCapacity])
    if (!Number.isInteger(value) || value < 1)
      throw new RangeError(
        "Template cache capacities must be positive integers.",
      );
  const bodies = new Map(),
    templates = new Map();
  const remember = (cache, capacity, key, value) => {
    if (cache.size >= capacity) cache.delete(cache.keys().next().value);
    cache.set(key, value);
    // A missing scan is the loader's answer for now, not for good: forget it so
    // the next request asks again, and the loader decides when to refetch.
    value.then(
      (result) => {
        if (result === null && cache.get(key) === value) cache.delete(key);
      },
      () => {},
    );
    return value;
  };
  return (spec = {}) => {
    const key = humanTemplateKey(spec);
    if (templates.has(key)) return templates.get(key);
    // Snapshot options before asynchronous scan loading; caller edits must not
    // change the geometry stored under an earlier key.
    const body = humanBodyOptions(spec);
    const wearing = spec.wearing?.slice(),
      outfit = spec.outfit,
      hair = spec.hair;
    const bodyKey = humanBodyKey(body);
    if (!bodies.has(bodyKey))
      remember(
        bodies,
        bodyCapacity,
        bodyKey,
        Promise.resolve()
          .then(() => scanned(body.bodyType, body.model))
          .then((scan) => (scan ? relieve(scan, body) : null)),
      );
    const template = bodies.get(bodyKey).then((shaped) => {
      if (!shaped) return null;
      const clothed = dress(shaped, {
        bodyType: body.bodyType,
        wearing,
        colour: outfit,
      });
      return addHair(clothed, { bodyType: body.bodyType, style: hair });
    });
    return remember(templates, templateCapacity, key, template);
  };
}

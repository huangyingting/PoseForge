/** One helper of `templatePool.js`: shapes and dresses the bodies it is sent. */
import { createTemplateCache } from "./templateCache.js";
import { modelUrl, modelWarnings, scanned } from "./scans.js";

const humanTemplate = createTemplateCache(scanned);

self.onmessage = async ({ data: { id, spec } }) => {
  try {
    const template = await humanTemplate(spec);
    self.postMessage({ id, template, warnings: modelWarnings.get(modelUrl(spec.bodyType, spec.model)) ?? null });
  } catch (error) {
    self.postMessage({ id, error: { message: String(error?.message ?? error), stack: String(error?.stack ?? error) } });
  }
};

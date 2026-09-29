/**
 * The built-in positions, downloaded, verified and assembled off the page's
 * thread (see `app/positionClient.js`): the service the page would have run,
 * run here, and answering in the page's language. The positions it assembles
 * are checked here as the library registers them, too.
 */
import { createPositionService } from "../app/positionService.js";
import { checkPositions } from "../app/libraryStore.js";
import { localizePreset } from "../i18n/presets.js";
import { createTranslator } from "../i18n/translator.js";

let service = null;
let translator = null;

// A worker writes English (see `i18n/index.js`), so it is told the page's language.
const speaking = (language) =>
  (translator ??=
    language === "zh"
      ? import("../i18n/zh.js").then(({ default: zh }) => createTranslator(zh))
      : Promise.resolve(createTranslator()));

self.onmessage = async ({ data: { id, base, language, method, args } }) => {
  // The packs are published beside the page, not beside this script, so the
  // page says where that is.
  service ??= createPositionService({ base });
  try {
    const tr = await speaking(language);
    let value = await service[method](...args);
    if (method === "variant") value = localizePreset(value, tr);
    if (method === "positions") value = checkPositions(value.map((preset) => localizePreset(preset, tr)));
    self.postMessage({ id, value });
  } catch (error) {
    self.postMessage({ id, error: String(error?.message ?? error) });
  }
};

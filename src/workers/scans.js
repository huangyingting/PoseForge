/**
 * The scanned bodies, one for each body type and model (see
 * `core/bodyModels.js`), fetched once each and kept as parsed templates.
 *
 * The map holds the *promise*, not the template, so that two actors of the same
 * build in the same scene - and every later sentence that mentions one - share
 * a single fetch and a single parse rather than racing to do both twice.
 *
 * A failure here is recoverable and must not be fatal: the distance field is
 * still a correct, if plainer, picture of the same pose. So a model that will
 * not load resolves to null, the figure falls back to the field, and the
 * reason is carried into the scene's warnings where the user can see it rather
 * than disappearing into a console nobody has open. The failure is forgotten
 * after a while, so a dropped connection costs the scanned body for the next
 * few solves rather than for the rest of the session.
 *
 * Each worker that shapes bodies has its own (see `templatePool.js`).
 */
import { buildHumanTemplate } from "../core/humanMesh.js";
import { readCards, withCards } from "../core/hairCards.js";
import { withFaces } from "../core/faces.js";
import { modelFiles } from "../core/bodyModels.js";

export const modelUrl = (bodyType, model) => {
  // One name inside the template, so the bundler can see which files it may be
  // and ship all of them.
  const { mesh } = modelFiles(bodyType, model);
  return String(new URL(`../../assets/models/realistic-${mesh}.glb`, import.meta.url));
};
const templates = new Map();
export const modelWarnings = new Map();
const MODEL_RETRY_MS = 10_000;

const fetchBytes = (url) =>
  fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.arrayBuffer();
  });

/**
 * The hair cards for one body (see `core/hairCards.js`): the file every body
 * shares, fetched once, and the one fitted to this body.
 *
 * Losing them costs the hair its strands and nothing else - `withHair` grows
 * the shell on a template without them - so a failure is a warning and not
 * the collision field. The body is kept either way: the templates built on it
 * are cached, and a scan that succeeded is not worth refetching for its hair.
 */
let sharedCards = null;
function bodyCards(mesh) {
  sharedCards ??= fetchBytes(String(new URL("../../assets/models/hair/cards.bin", import.meta.url))).then(readCards);
  const shared = sharedCards;
  return Promise.all([shared, fetchBytes(String(new URL(`../../assets/models/hair/cards-${mesh}.bin`, import.meta.url))).then(readCards)])
    .then(([shared, fitted]) => ({ shared, fitted }))
    .catch((error) => {
      if (sharedCards === shared) sharedCards = null;
      throw error;
    });
}

/**
 * How one body's face moves in each expression (see `core/faces.js`). Losing
 * it costs the face its expressions and nothing else: the figure is drawn with
 * the scan's own face.
 */
const bodyFaces = (mesh) => fetchBytes(String(new URL(`../../assets/models/faces/faces-${mesh}.bin`, import.meta.url))).then(readCards);

export function scanned(bodyType, model) {
  const url = modelUrl(bodyType, model);
  if (!templates.has(url)) {
    const { mesh } = modelFiles(bodyType, model);
    const cards = bodyCards(mesh).catch((error) => error);
    const faces = bodyFaces(mesh).catch((error) => error);
    const attempt = fetchBytes(url)
      .then((bytes) => buildHumanTemplate(bytes))
      .then(async (template) => {
        modelWarnings.delete(url);
        const [loaded, face] = await Promise.all([cards, faces]);
        const lost = [];
        try {
          if (loaded instanceof Error) throw loaded;
          template = withCards(template, loaded.shared, loaded.fitted);
        } catch (error) {
          lost.push(`Could not load the hair for the ${mesh} scanned body (${error.message}); drawing a plainer shell instead.`);
        }
        try {
          if (face instanceof Error) throw face;
          template = withFaces(template, face);
        } catch (error) {
          lost.push(`Could not load the expressions for the ${mesh} scanned body (${error.message}); drawing its face at rest instead.`);
        }
        if (lost.length) modelWarnings.set(url, lost);
        return template;
      })
      .catch((error) => {
        modelWarnings.set(url, [`Could not load the ${modelFiles(bodyType, model).mesh} scanned body (${error.message}); drawing the collision field instead.`]);
        setTimeout(() => {
          if (templates.get(url) === attempt) templates.delete(url);
        }, MODEL_RETRY_MS);
        return null;
      });
    templates.set(url, attempt);
  }
  return templates.get(url);
}

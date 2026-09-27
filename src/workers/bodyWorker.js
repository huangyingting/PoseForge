/**
 * Text to triangles, off the main thread.
 *
 * Body shaping, contact fitting and meshing can all be expensive. Keeping
 * them here leaves the interface available for typing, navigation and newer
 * scene requests while the current pose is being checked.
 *
 * So the whole chain runs here and only the finished buffers cross back, as
 * transfers rather than copies.
 *
 * It answers twice after contact validation. The draft omits final occlusion;
 * the final pass shades the same triangles rather than changing the pose.
 * Contact trials and the gap between passes yield so a newer request can
 * cancel work on a scene that is no longer selected. Raw scans, shaped bodies
 * and dressed templates are cached independently of the current pose.
 */

import { parseDescription } from "../nlp/parser.js";
import { validateScene } from "../core/scene.js";
import { solveScene } from "../core/solver.js";
import { propData } from "../core/propShapes.js";
import { surfaceContactSteps } from '../core/surfaceContacts.js';
import { solvedPreview } from '../core/posePreview.js';
import { buildHumanTemplate, skinHumanMesh } from "../core/humanMesh.js";
import { createTemplateCache } from "./templateCache.js";
import { modelFiles } from "../core/bodyModels.js";
import { buildBodyMesh, fieldOcclusion } from "../render/meshBuilder.js";

// 30mm draws in around a sixth of the time of the final pass and still reads as
// the same two people in the same pose; 12mm is where the blends between limbs
// stop showing their grid. Both are only reached if a scanned body cannot be
// loaded - see `bodyParts`.
const DRAFT = 0.03;
const FINAL = 0.012;

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
 */
const modelUrl = (bodyType, model) => {
  // One name inside the template, so the bundler can see which files it may be
  // and ship all of them.
  const { mesh } = modelFiles(bodyType, model);
  return String(new URL(`../../assets/models/realistic-${mesh}.glb`, import.meta.url));
};
const templates = new Map();
const modelWarnings = new Map();
const MODEL_RETRY_MS = 10_000;

function scanned(bodyType, model) {
  const url = modelUrl(bodyType, model);
  if (!templates.has(url)) {
    const attempt = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.arrayBuffer();
      })
      .then((bytes) => buildHumanTemplate(bytes))
      .then((template) => {
        modelWarnings.delete(url);
        return template;
      })
      .catch((error) => {
        modelWarnings.set(url, `Could not load the ${modelFiles(bodyType, model).mesh} scanned body (${error.message}); drawing the collision field instead.`);
        setTimeout(() => {
          if (templates.get(url) === attempt) templates.delete(url);
        }, MODEL_RETRY_MS);
        return null;
      });
    templates.set(url, attempt);
  }
  return templates.get(url);
}

/**
 * The drawable template for one actor, with the field's secondary-sex geometry
 * carried onto it.
 *
 * Cached separately from the scan, and on a different key: two actors on the
 * same GLB are the same parse but not the same body, because `featureRelief`
 * reads the volumes `bust` and `build` produce. Keying the relief by the file
 * would give a slim figure a heavy figure's bust. The scan underneath is still
 * fetched and parsed once.
 */
const humanTemplate = createTemplateCache(scanned);

/** The newest request id seen. Anything older than this is abandoned. */
let current = 0;

/** Yield to the message queue so a queued request can overtake this one. */
const yieldToQueue = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * One actor's drawable parts.
 *
 * The scanned body arrives as several submeshes - the skin, and the white, iris
 * and pupil of each eye - because they are different materials, not because
 * they are different objects. They are kept apart all the way to the renderer
 * for that reason and no other.
 *
 * `positions` and `normals` are skinned fresh on every call and can be given
 * away. `indices` and the eyes' baked `occlusion` are not: they belong to the
 * cached template and are the same arrays every time, so transferring them
 * would detach the template and every later pose would come back empty. They
 * are copied.
 */
function bodyParts(actor, template, scene, occlusion, resolution) {
  if (!template) {
    const mesh = buildBodyMesh(actor.volumes, { resolution, ao: true });
    return [
      {
        name: "body",
        primary: true,
        colour: null,
        positions: mesh.positions,
        normals: mesh.normals,
        indices: mesh.indices,
        occlusion: mesh.occlusion ?? null,
      },
    ];
  }

  return skinHumanMesh(template, actor.skeleton, actor.evaluated, undefined, actor.hands, actor.hang).map((part) => ({
    name: part.name,
    primary: part.primary,
    colour: part.colour ?? null,
    hair: part.hair ?? false,
    garment: part.garment ?? false,
    positions: part.positions,
    normals: part.normals,
    uvs: part.uvs ?? null,
    indices: part.indices.slice(),
    // A part that brought its own occlusion keeps it - only the eyes do, and
    // only because the field has no socket in it to shade them with. Everything
    // else gets it from the field on the final pass, not on the earlier draft.
    occlusion: part.occlusion
      ? part.occlusion.slice()
      : occlusion
        ? fieldOcclusion(part.positions, part.normals, scene, FINAL)
        : null,
  }));
}

function templatesFor(actors) {
  return Promise.all(
    actors.map((actor) =>
      humanTemplate({
        bodyType: actor.skeleton.bodyType,
        model: actor.spec?.model,
        bust: actor.spec?.bust,
        build: actor.skeleton.build,
        hair: actor.spec?.hair,
        wearing: actor.spec?.wearing,
        outfit: actor.spec?.outfit,
      })
    )
  );
}

/** Package the solved actors as drawable parts, and list their buffers for transfer. */
async function meshActors(actors, { occlusion, resolution }, transfers, loaded) {
  const scene = actors.flatMap((actor) => actor.volumes);

  return actors.map((actor, index) => {
    const parts = bodyParts(actor, loaded[index], scene, occlusion, resolution);
    for (const part of parts) {
      transfers.push(part.positions.buffer, part.normals.buffer, part.indices.buffer);
      if (part.occlusion) transfers.push(part.occlusion.buffer);
      // Not transferred: the UVs are the template's own array, shared by every
      // actor on that body type and by every frame. Neutering it would leave
      // the next render with an empty buffer and an untextured figure.
      if (part.uvs) part.uvs = part.uvs.slice();
    }
    return {
      id: actor.id ?? `actor${index}`,
      parts,
      // Which skin atlas this figure wears. The renderer needs the body type
      // and model, not the file, because the file is its business.
      bodyType: actor.skeleton.bodyType,
      model: actor.spec?.model,
      skinTone: actor.spec?.skinTone,
      source: loaded[index] ? "scanned" : `field ${Math.round(resolution * 1000)}mm`,
      triangles: parts.reduce((sum, part) => sum + part.indices.length / 3, 0),
    };
  });
}


/**
 * Strip the solved scene down to what the viewport needs.
 *
 * The solved actors carry their skeletons, their volumes and their history,
 * which is tens of thousands of numbers that the renderer never looks at. The
 * structured clone of all that costs more than the meshes do.
 */
function summarise(solved) {
  return {
    preview: solvedPreview(solved, 'refined'),
    surface: solved.surface,
    props: solved.props.map(propData),
    shell: (solved.surface.shell ?? []).map(propData),
    quality: {
      maxDepth: solved.quality.maxDepth,
      proxyMaxDepth: solved.quality.proxyMaxDepth,
      verifiedProxyContacts: solved.quality.verifiedProxyContacts,
      propPenetration: solved.quality.propPenetration,
      proxyPropPenetration: solved.quality.proxyPropPenetration,
      verifiedPropContacts: solved.quality.verifiedPropContacts,
      propSurfaces: solved.quality.propSurfaces,
      floorSurfaces: solved.quality.floorSurfaces,
      unmetContacts: solved.quality.unmetContacts,
      contactDetail: solved.quality.contactDetail,
      figureSurfaces: solved.quality.figureSurfaces,
      supportSurfaces: solved.quality.supportSurfaces,
      adjustments: solved.quality.adjustments,
      balance: solved.quality.balance,
      renderedBalance: solved.quality.renderedBalance,
      warnings: solved.quality.warnings,
    },
    actors: solved.actors.map((actor) => ({
      id: actor.id,
      label: actor.label,
      bodyType: actor.bodyType,
      posture: actor.spec?.posture,
      stature: actor.skeleton.stature,
      joints: structuredClone(actor.pose.joints),
      root: structuredClone(actor.pose.root),
      hands: { ...actor.hands },
      // Surface gaps are measured on the returned rig. Null means that this
      // figure instead expects partner support, or declares no surface support.
      supportBasis: actor.supportBasis,
      seatResidual: actor.seatResidual,
      supportMeasurement: actor.supportMeasurement,
      supportPenetration: actor.supportPenetration,
      bodySupportResidual: actor.bodySupportResidual,
    })),
  };
}

self.onmessage = async (event) => {
  const { id, text, scene: given, resolution } = event.data;
  current = id;

  try {
    const started = performance.now();

    // Either end of the pipeline is a valid entry point: the text box sends a
    // sentence, and the override controls send back an edited scene. Both land
    // in the same place, which is what makes an override behave exactly like a
    // word the user could have typed instead - including the part where a bad
    // one is reported rather than quietly corrected.
    let parsed;
    if (given) {
      const checked = validateScene(given);
      parsed = {
        scene: checked.scene,
        interpretation: [],
        warnings: checked.issues.map((issue) => issue.message),
        matched: [],
      };
    } else {
      parsed = parseDescription(text ?? "");
    }

    const solved = solveScene(parsed.scene);
    const solvedAt = performance.now();
    const loaded = await templatesFor(solved.actors);
    if (current !== id) return;
    const loadedAt = performance.now();
    for (const step of surfaceContactSteps(solved, loaded)) {
      await yieldToQueue();
      if (current !== id) return;
    }
    const refinedAt = performance.now();

    const base = {
      id,
      scene: parsed.scene,
      interpretation: parsed.interpretation,
      warnings: [...parsed.warnings, ...new Set(solved.actors.map(actor => modelWarnings.get(modelUrl(actor.skeleton.bodyType, actor.spec?.model))).filter(Boolean))],
      matched: parsed.matched,
      ...summarise(solved),
    };

    const draftTransfers = [];
    const draftMeshes = await meshActors(
      solved.actors,
      { occlusion: false, resolution: resolution ?? DRAFT },
      draftTransfers,
      loaded
    );
    if (current !== id) return;
    self.postMessage(
      {
        ...base,
        stage: "draft",
        meshes: draftMeshes,
        timings: { parse: solvedAt - started, models: loadedAt - solvedAt, surface: refinedAt - loadedAt, mesh: performance.now() - refinedAt },
      },
      draftTransfers
    );

    // A fixed resolution was asked for, so there is nothing to refine.
    if (resolution) return;

    await yieldToQueue();
    if (current !== id) return;

    const fineStarted = performance.now();
    const fineTransfers = [];
    const fineMeshes = await meshActors(
      solved.actors,
      { occlusion: true, resolution: FINAL },
      fineTransfers,
      loaded
    );
    if (current !== id) return;
    self.postMessage(
      {
        ...base,
        stage: "final",
        meshes: fineMeshes,
        timings: { parse: solvedAt - started, mesh: performance.now() - fineStarted },
      },
      fineTransfers
    );
  } catch (error) {
    // A crash in here is silent otherwise: the promise has nobody waiting on it
    // and the viewport simply never updates, which looks like a hang.
    self.postMessage({ id, stage: "error", error: String(error?.stack || error) });
  }
};

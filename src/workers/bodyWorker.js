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
 * the final pass shades the same pose rather than changing it, sharing that
 * shading out among helper workers (see `occlusionPool.js`), and while they
 * work it splits the triangles finer wherever the scan's facets would show
 * (see `core/tessellate.js`).
 * Contact trials and the gap between passes yield so a newer request can
 * cancel work on a scene that is no longer selected. Raw scans, shaped bodies
 * and dressed templates are cached independently of the current pose, and the
 * bodies of a pair are shaped side by side (see `templatePool.js`).
 */

import { parseDescription } from "../nlp/parser.js";
import { validateScene } from "../core/scene.js";
import { solveScene } from "../core/solver.js";
import { propData } from "../core/propShapes.js";
import { surfaceContactSteps } from '../core/surfaceContacts.js';
import { supportProps } from "../core/supports.js";
import { solvedPreview } from '../core/posePreview.js';
import { skinHumanMesh } from "../core/humanMesh.js";
import { inMouth } from "../core/faces.js";
import { createTemplateCache } from "./templateCache.js";
import { createTemplatePool } from "./templatePool.js";
import { modelUrl, modelWarnings, scanned } from "./scans.js";
import { buildBodyMesh } from "../render/meshBuilder.js";
import { occludeParts } from "./occlusionPool.js";
import { spread, tessellate } from "../core/tessellate.js";

// 30mm draws in around a sixth of the time of the final pass and still reads as
// the same two people in the same pose; 12mm is where the blends between limbs
// stop showing their grid. Both are only reached if a scanned body cannot be
// loaded - see `bodyParts`.
const DRAFT = 0.03;
const FINAL = 0.012;

/**
 * The drawable template for one actor, with the field's secondary-sex geometry
 * carried onto it.
 *
 * Cached separately from the scan, and on a different key: two actors on the
 * same GLB are the same parse but not the same body, because `featureRelief`
 * reads the volumes `bust` and `build` produce. Keying the relief by the file
 * would give a slim figure a heavy figure's bust. The scan underneath is still
 * fetched and parsed once on each thread that shapes it (see `scans.js`).
 *
 * A second body in the scene is shaped by a helper while this worker shapes
 * the first (see `templatePool.js`), and what the helper's scan loader said
 * about it is carried into the warnings as this worker's own would be.
 */
const humanTemplate = createTemplatePool(createTemplateCache(scanned), {
  warned: ({ bodyType, model }, warnings) => {
    const url = modelUrl(bodyType, model);
    if (warnings) modelWarnings.set(url, warnings);
    else modelWarnings.delete(url);
  },
});

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
 *
 * `scan`, the template's own submesh for a part, is kept for `tessellate` and
 * not sent. The eyes and the hair cards have none: an eye is a small sphere
 * already finely cut, and a card is a flat strip.
 */
function bodyParts(actor, template, resolution) {
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

  return skinHumanMesh(template, actor.skeleton, actor.evaluated, undefined, actor.hands, actor.hang).map((part, index) => ({
    name: part.name,
    primary: part.primary,
    colour: part.colour ?? null,
    hair: part.hair ?? false,
    eye: part.eye ?? false,
    mouth: part.mouth ?? false,
    cards: part.cards ?? null,
    garment: part.garment ?? false,
    finish: part.finish ?? null,
    trim: part.trim ?? null,
    trimColour: part.trimColour ?? null,
    positions: part.positions,
    normals: part.normals,
    uvs: part.uvs ?? null,
    indices: part.indices.slice(),
    // A part that brought its own occlusion keeps it - only the eyes and the
    // inside of the mouth do, and only because the field has no socket and no
    // mouth in it to shade them with. Everything else gets it from the field
    // on the final pass, not on the earlier draft, and the skin has the dark
    // of the mouth (`cavity`) taken out of it then.
    occlusion: part.occlusion ? part.occlusion.slice() : null,
    cavity: part.cavity,
    scan: part.occlusion || part.cards ? null : template.submeshes[index],
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
        expression: actor.face,
      })
    )
  );
}

/**
 * Package the solved actors as drawable parts, and list their buffers for
 * transfer. Null if `stale()` gave the scene up while it was being shaded.
 */
async function meshActors(actors, { occlusion, resolution }, transfers, loaded, stale) {
  const meshed = actors.map((actor, index) => bodyParts(actor, loaded[index], resolution));
  if (occlusion) {
    const scene = actors.flatMap((actor) => actor.volumes);
    const unshaded = meshed.flat().filter((part) => !part.occlusion);
    const shading = occludeParts(unshaded, scene, FINAL, stale);
    // This worker only hands out runs while the helpers shade, so the finer
    // triangles are cut in the meantime - a part at a time, so the runs keep
    // coming between them.
    const finer = new Map();
    for (const part of meshed.flat()) {
      if (!part.scan) continue;
      finer.set(part, tessellate(part, part.scan.positions, { held: part.scan.beneath, bridge: part.garment }));
      await yieldToQueue();
      if (stale()) return null;
    }
    const shaded = await shading;
    if (!shaded) return null;
    unshaded.forEach((part, i) => (part.occlusion = inMouth(shaded[i], part.cavity)));
    for (const [part, { positions, normals, indices, parents }] of finer)
      Object.assign(part, {
        positions,
        normals,
        indices,
        uvs: spread(part.uvs, parents, 2),
        trim: spread(part.trim, parents),
        occlusion: spread(part.occlusion, parents),
      });
  }
  for (const part of meshed.flat()) {
    delete part.scan;
    delete part.cavity;
  }

  return actors.map((actor, index) => {
    const parts = meshed[index];
    for (const part of parts) {
      transfers.push(part.positions.buffer, part.normals.buffer, part.indices.buffer);
      if (part.occlusion) transfers.push(part.occlusion.buffer);
      // Not transferred: the UVs are the template's own array, shared by every
      // actor on that body type and by every frame. Neutering it would leave
      // the next render with an empty buffer and an untextured figure.
      if (part.uvs) part.uvs = part.uvs.slice();
      // Nor the trim, which is the garment's own array in the same way.
      if (part.trim) part.trim = part.trim.slice();
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
    // What the figures rest on, and the cushions under any left resting on air.
    props: [...solved.props, ...(solved.supports ?? [])].map(propData),
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
      face: actor.face,
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
    // After the rendered surfaces have settled, so they are built to the figure as drawn.
    solved.supports = supportProps(solved);
    const refinedAt = performance.now();

    const base = {
      id,
      scene: parsed.scene,
      interpretation: parsed.interpretation,
      warnings: [...parsed.warnings, ...new Set(solved.actors.flatMap(actor => modelWarnings.get(modelUrl(actor.skeleton.bodyType, actor.spec?.model)) ?? []))],
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
      loaded,
      () => current !== id
    );
    if (current !== id || !fineMeshes) return;
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

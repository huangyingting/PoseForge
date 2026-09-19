/**
 * Text to triangles, off the main thread.
 *
 * Meshing is the expensive step by a wide margin - parsing is under a
 * millisecond and solving is around forty, but extracting a pair of isosurfaces
 * at 12mm is most of a second. On the main thread that is most of a second with
 * no cursor, no scroll, and no response to typing, which is exactly the moment
 * the user is mid-sentence and about to type the next word.
 *
 * So the whole chain runs here and only the finished buffers cross back, as
 * transfers rather than copies.
 *
 * It answers twice. A coarse mesh comes back in around a tenth of the time and
 * is a perfectly good likeness of the pose - it is the fine detail of the
 * blends between limbs that the resolution buys, not the arrangement of the
 * bodies. Showing that first means the picture updates while the sentence is
 * still being typed, and the refinement lands quietly afterwards. Between the
 * two passes the worker yields, which is what lets a newer request arrive and
 * cancel the refinement of a pose nobody is looking at any more.
 */

import { parseDescription } from "../nlp/parser.js";
import { validateScene } from "../core/scene.js";
import { solveScene } from "../core/solver.js";
import { buildBodyMesh } from "../render/meshBuilder.js";

// 30mm draws in around a sixth of the time of the final pass and still reads as
// the same two people in the same pose; 12mm is where the blends between limbs
// stop showing their grid. Occlusion is computed on both, even though it is a
// third of the cost of a pass, because the skin shading is built on it - a
// draft without it is not a coarser picture of the same thing, it is a
// different and flatter material that then visibly changes when the fine mesh
// lands.
const DRAFT = 0.03;
const FINAL = 0.012;

/** The newest request id seen. Anything older than this is abandoned. */
let current = 0;

/** Yield to the message queue so a queued request can overtake this one. */
const yieldToQueue = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Package a solved actor's volumes as a mesh, and list its buffers for transfer. */
function meshActors(actors, resolution, transfers) {
  return actors.map((actor, index) => {
    const mesh = buildBodyMesh(actor.volumes, { resolution, ao: true });
    transfers.push(mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer);
    if (mesh.occlusion) transfers.push(mesh.occlusion.buffer);
    return {
      id: actor.id ?? `actor${index}`,
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
      occlusion: mesh.occlusion,
      bounds: mesh.bounds,
      resolution: mesh.resolution,
      triangles: mesh.indices.length / 3,
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
    surface: solved.surface,
    props: solved.props.map(({ kind, size, center }) => ({ kind, size, center })),
    quality: {
      maxDepth: solved.quality.maxDepth,
      propPenetration: solved.quality.propPenetration,
      unmetContacts: solved.quality.unmetContacts,
      contactDetail: solved.quality.contactDetail,
      balance: solved.quality.balance,
      warnings: solved.quality.warnings,
    },
    actors: solved.actors.map((actor) => ({
      id: actor.id,
      label: actor.label,
      bodyType: actor.bodyType,
      posture: actor.spec?.posture,
      stature: actor.skeleton.stature,
      // Non-zero means the posture's declared supports do not match its own
      // geometry closely enough to seat it, and the figure is floating by this
      // much. The viewport surfaces it rather than hiding it.
      seatResidual: actor.seatResidual ?? 0,
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

    const base = {
      id,
      scene: parsed.scene,
      interpretation: parsed.interpretation,
      warnings: parsed.warnings,
      matched: parsed.matched,
      ...summarise(solved),
    };

    const draftTransfers = [];
    const draftMeshes = meshActors(solved.actors, resolution ?? DRAFT, draftTransfers);
    self.postMessage(
      {
        ...base,
        stage: "draft",
        meshes: draftMeshes,
        timings: { parse: solvedAt - started, mesh: performance.now() - solvedAt },
      },
      draftTransfers
    );

    // A fixed resolution was asked for, so there is nothing to refine.
    if (resolution) return;

    await yieldToQueue();
    if (current !== id) return;

    const fineStarted = performance.now();
    const fineTransfers = [];
    const fineMeshes = meshActors(solved.actors, FINAL, fineTransfers);
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

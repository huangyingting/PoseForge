/**
 * The scene intermediate representation.
 *
 * Everything upstream - the parser, the UI, a saved file, an API call - produces
 * one of these, and `solveScene` consumes nothing else. Keeping that boundary
 * narrow is what lets the language layer be rewritten, or replaced with a model,
 * without touching a line of geometry: the contract is this shape, not the
 * English that happened to produce it.
 *
 * Validation here is deliberately loud about the things that would otherwise
 * produce a confident, wrong picture - an unknown posture silently becoming
 * "standing", a contact naming a body part that does not exist - and quiet about
 * the things that have a sane default. A scene always comes back usable; what
 * changes is how much it had to guess, and it says so.
 */

import { LANDMARK_NAMES, resolveLandmark } from "./landmarks.js";
import {
  ARRANGEMENT_NAMES,
  POSTURE_NAMES,
  SURFACE_NAMES,
  isKnownSurface,
  resolveArrangement,
  resolvePosture,
} from "./poseLibrary.js";

/** Body presets the actor spec accepts. */
export const BODY_TYPES = ["female", "male", "neutral"];

/**
 * @typedef {object} ActorSpec
 * @property {string} [id] stable identity, used by contacts and the UI
 * @property {string} [label] display name
 * @property {string} posture posture name or alias, see POSTURE_NAMES
 * @property {"female"|"male"|"neutral"} [bodyType]
 * @property {number} [stature] metres; overrides the body type's default
 * @property {number} [build] 0.8 slim .. 1.3 heavy
 * @property {number} [bust] chest fullness multiplier, 0 disables
 * @property {number} [mobility] 0 pinned .. 1 free, how much the solver may move them
 * @property {Object<string, {flexion?:number, abduction?:number, rotation?:number}>} [joints]
 *           explicit per-bone overrides, applied over the posture archetype
 */

/**
 * @typedef {object} ContactSpec
 * @property {string} from landmark name, optionally "hand.left"
 * @property {string} to landmark name
 * @property {number|string} [fromActor] actor index or id, defaults to 0
 * @property {number|string} [toActor] actor index or id, defaults to 1
 * @property {number} [strength] 0..1, how hard the solver works to close it
 * @property {string} [type] free-form tag carried through to the report
 */

/**
 * @typedef {object} Scene
 * @property {string} [id]
 * @property {string} [title]
 * @property {string} [description] the text this was interpreted from
 * @property {{surface?: string}} [support]
 * @property {{arrangement?: string}} [relationship]
 * @property {ActorSpec[]} actors
 * @property {ContactSpec[]} [contacts]
 * @property {object} [camera]
 */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Nearest known name, for "did you mean" on a typo. */
function closestName(name, candidates) {
  const target = String(name).toLowerCase().replace(/[\s-]+/g, "_");
  let best = null;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = editDistance(target, candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // Only offer a suggestion that is actually close; a wrong guess is worse than
  // none, because the caller will act on it.
  return bestScore <= Math.max(2, Math.floor(target.length / 3)) ? best : null;
}

function editDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = new Array(cols);
  for (let j = 0; j < cols; j += 1) previous[j] = j;
  for (let i = 1; i < rows; i += 1) {
    const current = [i];
    for (let j = 1; j < cols; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[cols - 1];
}

/**
 * Check and normalise a scene.
 *
 * Returns the scene the solver should be given, plus every correction that was
 * made to get there. Nothing throws: a description that mentions a posture this
 * library does not have is a normal thing for a user to type, and the useful
 * response is a sensible picture and a note saying what was substituted.
 *
 * @param {Scene} scene
 * @returns {{scene: Scene, issues: Array<{level:"error"|"warning", message:string}>}}
 */
export function validateScene(scene) {
  const issues = [];
  const note = (level, message) => issues.push({ level, message });

  // Anything that is not an object is treated as an empty one rather than
  // returned early with a hand-built stand-in. A caller that gets a scene back
  // must not have to ask which of two shapes it is, so every path out of here
  // goes through the same construction at the bottom.
  let blank = false;
  if (!scene || typeof scene !== "object") {
    note("error", "no scene given, used a single standing figure");
    scene = {};
    blank = true;
  }

  const actorSpecs = Array.isArray(scene.actors) ? scene.actors : [];
  if (actorSpecs.length === 0) {
    // Already said so above if the whole scene was missing; saying it twice
    // makes the report look like two separate problems.
    if (!blank) note("error", "no people in the scene, used a single standing figure");
    actorSpecs.push({ posture: "standing" });
  }
  if (actorSpecs.length > 4) {
    note("warning", `${actorSpecs.length} people given, only the first 4 are placed`);
  }

  const actors = actorSpecs.slice(0, 4).map((spec, index) => {
    const id = spec.id || `actor${index}`;
    const posture = resolvePosture(spec.posture);
    if (!posture) {
      const suggestion = closestName(spec.posture ?? "", POSTURE_NAMES);
      note(
        "warning",
        `${id}: unknown posture "${spec.posture}", used standing` +
          (suggestion ? ` (did you mean "${suggestion}"?)` : "")
      );
    }
    const bodyType = BODY_TYPES.includes(spec.bodyType) ? spec.bodyType : "neutral";
    if (spec.bodyType && bodyType !== spec.bodyType) {
      note("warning", `${id}: unknown body type "${spec.bodyType}", used neutral`);
    }
    // Stature outside this range is not a person, and the anthropometric tables
    // that everything else is derived from stop meaning anything.
    let stature = spec.stature;
    if (stature != null) {
      const bounded = clamp(stature, 1.4, 2.1);
      if (bounded !== stature) {
        note("warning", `${id}: stature ${stature}m is outside 1.4-2.1m, used ${bounded}m`);
        stature = bounded;
      }
    }
    return {
      ...spec,
      id,
      label: spec.label || `Partner ${String.fromCharCode(65 + index)}`,
      posture: posture ? posture.id : "standing",
      bodyType,
      ...(stature != null ? { stature } : {}),
      build: clamp(spec.build ?? 1, 0.8, 1.3),
      mobility: spec.mobility == null ? undefined : clamp(spec.mobility, 0, 1),
    };
  });

  const byId = new Map(actors.map((actor, index) => [actor.id, index]));

  // Resolve an actor reference the way a caller is likely to have written it:
  // an index, an id, or nothing at all.
  const actorIndex = (reference, fallback) => {
    if (reference == null) return fallback;
    if (typeof reference === "number") {
      return reference >= 0 && reference < actors.length ? reference : null;
    }
    return byId.has(reference) ? byId.get(reference) : null;
  };

  const contacts = [];
  for (const contact of scene.contacts || []) {
    const from = actorIndex(contact.fromActor, 0);
    const to = actorIndex(contact.toActor, actors.length > 1 ? 1 : 0);
    if (from == null || to == null) {
      note("warning", `dropped contact ${contact.from}->${contact.to}: no such person`);
      continue;
    }
    if (from === to) {
      note("warning", `dropped contact ${contact.from}->${contact.to}: both ends are the same person`);
      continue;
    }
    let bad = false;
    for (const end of ["from", "to"]) {
      if (resolveLandmark(String(contact[end] ?? ""))) continue;
      const suggestion = closestName(contact[end] ?? "", LANDMARK_NAMES);
      note(
        "warning",
        `dropped contact ${contact.from}->${contact.to}: no body part called "${contact[end]}"` +
          (suggestion ? ` (did you mean "${suggestion}"?)` : "")
      );
      bad = true;
    }
    if (bad) continue;
    contacts.push({
      ...contact,
      fromActor: from,
      toActor: to,
      strength: clamp(contact.strength ?? 0.7, 0, 1),
    });
  }

  const askedArrangement = scene.relationship?.arrangement;
  let arrangement = askedArrangement;
  if (askedArrangement && !resolveArrangement(askedArrangement)) {
    const suggestion = closestName(askedArrangement, ARRANGEMENT_NAMES);
    note(
      "warning",
      `unknown arrangement "${askedArrangement}", used face to face` +
        (suggestion ? ` (did you mean "${suggestion}"?)` : "")
    );
    arrangement = "face_to_face";
  }
  if (!arrangement && actors.length > 1) arrangement = "face_to_face";

  // A yaw override only means anything relative to an arrangement, and only
  // when there is a second person for it to turn.
  let yaw = scene.relationship?.yaw;
  if (yaw != null && (!arrangement || actors.length < 2)) {
    note("warning", "ignored the facing direction: there is nobody to turn relative to");
    yaw = undefined;
  }

  const askedSurface = scene.support?.surface;
  let surface = askedSurface;
  if (askedSurface && !isKnownSurface(askedSurface)) {
    const suggestion = closestName(askedSurface, SURFACE_NAMES);
    note(
      "warning",
      `unknown surface "${askedSurface}", used the floor` +
        (suggestion ? ` (did you mean "${suggestion}"?)` : "")
    );
    surface = "floor";
  }

  return {
    scene: {
      id: scene.id,
      title: scene.title,
      description: scene.description,
      support: { surface: surface || "floor" },
      relationship: arrangement ? { arrangement, ...(yaw != null ? { yaw } : {}) } : {},
      actors,
      contacts,
      ...(scene.camera ? { camera: scene.camera } : {}),
    },
    issues,
  };
}

/** A minimal valid scene, useful as a starting point for the UI. */
export function emptyScene() {
  return {
    support: { surface: "floor" },
    relationship: {},
    actors: [{ id: "actor0", posture: "standing", bodyType: "female" }],
    contacts: [],
  };
}

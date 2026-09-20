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
import { limbJoints } from "./limbPose.js";
import { HAIR_STYLES } from "./hair.js";
import { HAND_SHAPES } from "./handPose.js";
import { footJoints, knownFeet } from "./footPose.js";
import { GARMENT_COLOURS, GARMENT_NAMES } from "./garments.js";
import { CHANNELS, POSEABLE_BONES, ROM } from "./skeleton.js";
import {
  ARRANGEMENT_NAMES,
  POSTURE_NAMES,
  SURFACE_NAMES,
  isKnownSurface,
  resolveArrangement,
  resolvePosture,
  resolveSurface,
} from "./poseLibrary.js";

/** Body presets the actor spec accepts. */
export const BODY_TYPES = ["female", "male", "neutral"];

/**
 * @typedef {object} ActorSpec
 * @property {string} [id] stable identity, used by contacts and the UI
 * @property {string} [label] display name
 * @property {string} posture posture name or alias, see POSTURE_NAMES
 * @property {string|string[]} [support] what is holding them up, if it is known
 *           separately from the posture name; refines the posture reading only
 * @property {"female"|"male"|"neutral"} [bodyType]
 * @property {number} [stature] metres; overrides the body type's default
 * @property {number} [build] 0.8 slim .. 1.3 heavy
 * @property {number} [bust] chest fullness multiplier, 0 disables
 * @property {string} [hair] hairstyle name, see HAIR_STYLES; omitted means the
 *           default for the body type
 * @property {string|string[]} [wearing] garment names, see GARMENT_NAMES; omitted
 *           means nude, an empty array means nude explicitly
 * @property {string} [outfit] garment colour name, see GARMENT_COLOURS
 * @property {string|{l?:string,r?:string}} [hands] hand shape name, see
 *           HAND_SHAPES; overrides what the contacts imply
 * @property {string|{l?:string,r?:string}} [feet] foot shape name, see
 *           FOOT_SHAPES; compiled into `joints` over the posture's own ankles
 * @property {number} [mobility] 0 pinned .. 1 free, how much the solver may move them
 * @property {string|string[]} [arms] what the arms are doing, see ARM_POSES; read
 *           from the corpus's vocabulary or a user's, and compiled into `joints`
 * @property {string|string[]} [legs] what the legs are doing, see LEG_POSES
 * @property {string|string[]} [trunk] how far over the upper body is, see
 *           TRUNK_POSES; ignored by postures that are not upright to begin with
 * @property {Object<string, {flexion?:number, abduction?:number, rotation?:number}>} [joints]
 *           explicit per-bone overrides, applied over the posture archetype and
 *           over anything `arms`/`legs`/`trunk` produced
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
 * @property {{arrangement?: string, contactMode?: "automatic"|"custom"}} [relationship]
 * @property {ActorSpec[]} actors
 * @property {ContactSpec[]} [contacts]
 * @property {object} [camera]
 */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * Fold one set of joint overrides over another, channel by channel.
 *
 * Per-channel is the whole point: a limb shape that sets only abduction has to
 * leave an explicit `{flexion}` from the caller intact, and vice versa. This is
 * the same merge the solver does when it lays overrides over a posture, applied
 * one level earlier so the solver still sees a single flat table.
 */
function mergeJoints(base, over) {
  const merged = {};
  for (const [bone, angles] of Object.entries(base ?? {})) merged[bone] = { ...angles };
  for (const [bone, angles] of Object.entries(over ?? {})) {
    merged[bone] = { ...merged[bone], ...angles };
  }
  return merged;
}

/** Which ROM entry each bone a caller may name reads its range from. */
const BONE_KIND = new Map(POSEABLE_BONES.map((bone) => [bone.name, bone.kind]));

/**
 * `joints`, reduced to what the solver will actually act on.
 *
 * Three kinds of nonsense can be written here and every one of them is silent
 * further down: `evaluatePose` looks joints up by bone name and skips a name it
 * does not know, `quaternionFromAngles` reads only the three channels and
 * ignores anything else in the object, and it clamps whatever it is given to
 * the bone's range without saying so. Silence is the wrong answer for the one
 * field whose entire purpose is "I know the number I want" - someone who writes
 * `elbow_l: { bend: 90 }` needs to be told the arm did not move, not left to
 * conclude that the elbow is broken.
 *
 * Out-of-range angles are clamped rather than dropped, because unlike a misspelt
 * name they still say something usable: 200 degrees at an elbow means all the
 * way, and all the way is 148. Clamping here rather than leaving it to the
 * skeleton is also what lets a control panel show the angle that was used - the
 * scene that comes back is the scene that was drawn.
 *
 * @param {object} joints as written by the caller
 * @param {string} id the actor, for the message
 * @param {Function} note `(level, message)`
 */
function checkJoints(joints, id, note) {
  if (joints == null) return undefined;
  if (typeof joints !== "object" || Array.isArray(joints)) {
    note("warning", `${id}: joints must be an object keyed by bone name, ignored`);
    return undefined;
  }

  const kept = {};
  for (const [bone, angles] of Object.entries(joints)) {
    const kind = BONE_KIND.get(bone);
    if (!kind) {
      const suggestion = closestName(bone, [...BONE_KIND.keys()]);
      note(
        "warning",
        `${id}: no adjustable bone called "${bone}", ignored` +
          (suggestion ? ` (did you mean "${suggestion}"?)` : "")
      );
      continue;
    }
    if (angles == null || typeof angles !== "object") {
      note("warning", `${id}: ${bone} needs angles like {flexion: 30}, ignored`);
      continue;
    }

    const used = {};
    for (const [channel, value] of Object.entries(angles)) {
      if (!CHANNELS.includes(channel)) {
        note("warning", `${id}: ${bone} has no "${channel}" channel, ignored`);
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        note("warning", `${id}: ${bone} ${channel} is not a number, ignored`);
        continue;
      }
      const [low, high] = ROM[kind][channel];
      const bounded = clamp(value, low, high);
      if (bounded !== value) {
        note(
          "warning",
          `${id}: ${bone} ${channel} ${value}° is outside ${low}..${high}°, used ${bounded}°`
        );
      }
      used[channel] = bounded;
    }
    if (Object.keys(used).length) kept[bone] = used;
  }
  return Object.keys(kept).length ? kept : undefined;
}

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
    const posture = resolvePosture(spec.posture, spec.support ?? null);
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

    // Appearance. None of it changes the pose, so a bad value here is dropped
    // with a warning rather than substituted: falling back to a default would
    // dress someone in something they did not ask for, which is worse than
    // leaving them as the body type has them.
    let hair = spec.hair;
    if (hair != null && !(hair in HAIR_STYLES)) {
      note("warning", `${id}: unknown hair "${hair}", used the default for this body`);
      hair = undefined;
    }
    let wearing = spec.wearing == null ? undefined : [spec.wearing].flat();
    if (wearing) {
      const unknown = wearing.filter((item) => !GARMENT_NAMES.includes(item));
      if (unknown.length) {
        note("warning", `${id}: cannot make ${unknown.join(", ")}, left off`);
        wearing = wearing.filter((item) => GARMENT_NAMES.includes(item));
      }
    }
    let outfit = spec.outfit;
    if (outfit != null && !(outfit in GARMENT_COLOURS)) {
      note("warning", `${id}: no such colour "${outfit}", used black`);
      outfit = undefined;
    }

    // Hands and feet. Both are named shapes over whatever the pose would do by
    // itself, and both are dropped on a bad name for the same reason the
    // clothing is: there is no sensible substitute for a shape nobody asked
    // for. Hands stay a name - they are resolved against the contacts at solve
    // time, in `handShapes`, which is the only place that knows them. Feet are
    // resolved here, into joint angles, because that is all they are.
    let hands = spec.hands;
    const badHands =
      hands == null
        ? []
        : (typeof hands === "string" ? [hands] : [hands.l, hands.r].filter(Boolean)).filter(
            (name) => !(name in HAND_SHAPES)
          );
    if (badHands.length) {
      note("warning", `${id}: unknown hand shape ${badHands.join(", ")}, left to the pose`);
      hands = undefined;
    }
    const feet = spec.feet;
    const badFeet = knownFeet(feet);
    if (badFeet.length) {
      note("warning", `${id}: unknown foot shape ${badFeet.join(", ")}, left to the posture`);
    }
    // Angles written out by name. Checked here rather than taken on trust
    // because this is the field a control panel writes and a person hand-edits,
    // and it is the only one the skeleton would accept and then ignore.
    const written = checkJoints(spec.joints, id, note);
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
    // What the limbs are doing, on top of the posture. These are compiled here
    // rather than in the solver for the same reason the posture name is
    // resolved here: a validated scene is one that anything downstream can act
    // on without going back to the vocabulary. By the time this leaves, `arms`,
    // `legs` and `trunk` have become ordinary joint overrides.
    const limbs = limbJoints(posture ?? resolvePosture("standing"), {
      arms: spec.arms,
      legs: spec.legs,
      trunk: spec.trunk,
    });
    for (const phrase of limbs.unread) {
      note("warning", `${id}: could not read "${phrase}", left the body as the posture has it`);
    }
    return {
      ...spec,
      id,
      label: spec.label || `Partner ${String.fromCharCode(65 + index)}`,
      posture: posture ? posture.id : "standing",
      bodyType,
      ...(stature != null ? { stature } : {}),
      build: clamp(spec.build ?? 1, 0.8, 1.3),
      // Written unconditionally, because `...spec` above has already copied
      // whatever the caller wrote and a rejected value has to be overwritten
      // rather than merely not re-added.
      hair,
      wearing,
      outfit,
      mobility: spec.mobility == null ? undefined : clamp(spec.mobility, 0, 1),
      // Anything said outright wins: `joints` is the escape hatch for a caller
      // who knows the exact angle they want, and a limb phrase must not
      // silently overrule it.
      hands,
      feet: badFeet.length ? undefined : feet,
      // Precedence, weakest first: the limb phrases, then the foot shapes, then
      // anything written out as `joints`. A foot shape is more specific than
      // "her legs are apart" and less specific than an angle someone typed.
      //
      // `joints` is also rewritten unconditionally, for the reason above: what
      // comes back has to be the angles that were used, not the ones that were
      // asked for, or a panel that reads the scene back will show a slider at a
      // value the figure is not in.
      joints:
        Object.keys(limbs.joints).length || written || feet
          ? mergeJoints(
              mergeJoints(limbs.joints, badFeet.length ? null : footJoints(feet)),
              written
            )
          : undefined,
      ...(limbs.applied.length ? { limbShapes: limbs.applied } : {}),
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
  // A half turn the *name* carried - every back-to-chest and every reverse
  // straddle - which has to survive into the scene or the pair come out facing
  // the wrong way. Anything said outright still wins over it.
  let readYaw = null;
  const readArrangement = askedArrangement ? resolveArrangement(askedArrangement) : null;
  if (askedArrangement && !readArrangement) {
    const suggestion = closestName(askedArrangement, ARRANGEMENT_NAMES);
    note(
      "warning",
      `unknown arrangement "${askedArrangement}", used face to face` +
        (suggestion ? ` (did you mean "${suggestion}"?)` : "")
    );
    arrangement = "face_to_face";
  } else if (readArrangement) {
    // Store the base name, not the one asked for. A validated scene is meant to
    // be a scene anything downstream can act on without resolving names again,
    // and while that held for the postures it did not for this field: an alias
    // went through untouched, so `scene.relationship.arrangement` could be a
    // word that is not in `ARRANGEMENT_NAMES`.
    arrangement = readArrangement.id;
    if (readArrangement.inferred) {
      note("warning", `read "${askedArrangement}" as ${readArrangement.id}`);
      const defaultYaw = resolveArrangement(readArrangement.id)?.yaw;
      if (readArrangement.yaw !== defaultYaw) readYaw = readArrangement.yaw;
    }
  }
  if (!arrangement && actors.length > 1) arrangement = "face_to_face";

  let contactMode = scene.relationship?.contactMode;
  if (contactMode != null && !['automatic', 'custom'].includes(contactMode)) {
    note('warning', `unknown contact mode "${contactMode}", used automatic`);
    contactMode = 'automatic';
  }

  // A yaw override only means anything relative to an arrangement, and only
  // when there is a second person for it to turn.
  let yaw = scene.relationship?.yaw ?? readYaw ?? undefined;
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
  } else if (askedSurface) {
    // Same normalisation as the arrangement: a validated scene names a surface
    // the library has, not the words it was asked in.
    const read = resolveSurface(askedSurface);
    surface = read.id;
    if (read.inferred) note("warning", `read "${askedSurface}" as ${read.id}`);
  }

  return {
    scene: {
      id: scene.id,
      title: scene.title,
      description: scene.description,
      support: { surface: surface || "floor" },
      relationship: {
        ...(arrangement ? { arrangement } : {}),
        ...(yaw != null ? { yaw } : {}),
        ...(contactMode != null ? { contactMode } : {}),
      },
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

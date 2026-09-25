import { isFixedPlacement } from "./placement.js";
import {
  MAX_SCENE_ACTORS,
  MIN_SCENE_ACTORS,
} from "./scene.js";
import { CHANNELS, POSEABLE_BONES } from "./skeleton.js";

export const MIN_POSITION_PARTICIPANTS = MIN_SCENE_ACTORS;
export const MAX_POSITION_PARTICIPANTS = MAX_SCENE_ACTORS;
export const POSITION_VARIANTS = [
  "studio",
  "interaction",
  "artistic",
  "generated",
  "override",
];
export const POSITION_STATUS_LABELS = {
  "approximate-3d": "Approximate 3D",
  "artistic-3d": "Artistic 3D",
  "interaction-3d": "Interaction 3D",
  "authored-3d": "Authored · unreviewed",
  "needs-adjustment": "Needs adjustment",
  "verified-3d": "Verified 3D preset",
};

const POSITION_PREFIX = "builtin.position.";
const OVERRIDE_PREFIX = "user.position.sexposes.";

const text = (value, name, max) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${name} must be non-empty text up to ${max} characters.`);
  return value.trim();
};

export const positionId = (sourceId) => `${POSITION_PREFIX}${sourceId}`;
export const positionSourceId = (id) =>
  typeof id === "string" && id.startsWith(POSITION_PREFIX)
    ? id.slice(POSITION_PREFIX.length)
    : null;
export const positionOverrideId = (sourceId) => `${OVERRIDE_PREFIX}${sourceId}`;
export const isBuiltInPosition = (value) =>
  typeof value?.id === "string" && value.id.startsWith(POSITION_PREFIX);
export const isPositionOverride = (value) =>
  typeof value?.id === "string" && value.id.startsWith(OVERRIDE_PREFIX);
export const isPositionVariant = (value, variant) =>
  value?.position?.variant === variant;

export function checkPositionMetadata(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Position metadata must be an object.");
  if (
    Object.keys(input).some(
      (key) => !["type", "name", "variant"].includes(key),
    )
  )
    throw new Error("Position metadata contains an unsupported field.");
  const variant = text(input.variant, "Position variant", 32);
  if (!POSITION_VARIANTS.includes(variant))
    throw new Error("Unknown position variant.");
  const type = text(input.type, "Position type", 64);
  if (!/^[a-z0-9][a-z0-9_.-]*$/i.test(type))
    throw new Error("Position type has invalid characters.");
  return {
    type,
    name: text(input.name, "Position name", 80),
    variant,
  };
}

export function participantGraph(scene) {
  const actors = scene.actors;
  const byId = new Map(actors.map((actor, index) => [actor.id, index]));
  const graph = actors.map(() => new Set());
  const resolve = (value, fallback) =>
    typeof value === "string" ? byId.get(value) : value ?? fallback;
  for (const contact of scene.contacts ?? []) {
    const from = resolve(contact.fromActor, 0);
    const to = resolve(contact.toActor, 1);
    if (
      Number.isInteger(from) &&
      Number.isInteger(to) &&
      from >= 0 &&
      to >= 0 &&
      from < actors.length &&
      to < actors.length &&
      from !== to
    ) {
      graph[from].add(to);
      graph[to].add(from);
    }
  }
  return graph;
}

export function participantsAreConnected(scene) {
  if (scene.actors.length < 2) return true;
  const graph = participantGraph(scene);
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    for (const next of graph[queue.shift()]) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === scene.actors.length;
}

export function checkFixedPositionScene(
  scene,
  { requireConnected = scene.actors.length > 1 } = {},
) {
  if (
    scene.actors.length < MIN_POSITION_PARTICIPANTS ||
    scene.actors.length > MAX_POSITION_PARTICIPANTS
  )
    throw new Error(
      `Positions support ${MIN_POSITION_PARTICIPANTS}–${MAX_POSITION_PARTICIPANTS} participants.`,
    );
  for (const actor of scene.actors) {
    if (!actor.wearing?.includes("top") || !actor.wearing?.includes("shorts"))
      throw new Error("Every position participant must wear a top and shorts.");
    if (
      actor.jointMode !== "fixed" ||
      !isFixedPlacement(actor.placement) ||
      POSEABLE_BONES.some(({ name }) =>
        CHANNELS.some(
          (channel) => !Number.isFinite(actor.joints?.[name]?.[channel]),
        ),
      )
    )
      throw new Error(
        "Positions need fixed placements and complete joint angles for every participant.",
      );
  }
  if (requireConnected && !participantsAreConnected(scene))
    throw new Error(
      "Every participant must be connected to the position interaction graph.",
    );
  return scene;
}

export function checkSeparatePositionScene(scene) {
  checkFixedPositionScene(scene, { requireConnected: false });
  if (
    scene.support.surface !== "floor" ||
    scene.relationship.contactMode !== "custom" ||
    scene.contacts.length
  )
    throw new Error(
      "Separate position studies need a neutral floor and no participant contacts.",
    );
  return scene;
}

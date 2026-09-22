/** Drive a body/limb constraint from its limb without rewriting scene intent. */
import { resolveLandmark } from "./landmarks.js";

export const LIMB_LANDMARKS = new Set([
  "hand",
  "foot",
  "forearm",
  "knee",
  "shin",
  "elbow",
  "ankle",
]);

export function limbFirstContact(contact, actors = null) {
  const fromLandmark = resolveLandmark(contact.from, contact.fromSide);
  const from = fromLandmark?.base;
  const to = resolveLandmark(contact.to, contact.toSide)?.base;
  const receiver = actors?.[contact.fromActor];
  // A held knee/forearm is load-bearing, not the free limb in this support
  // relationship. Actor context keeps the hand as the driver in either
  // authored endpoint order without changing unrelated limb/limb contacts.
  const heldFrom =
    fromLandmark &&
    contact.type === "support" &&
    (contact.strength ?? 1) > 0 &&
    to === "hand" &&
    from !== "hand" &&
    receiver?.mountedOn != null &&
    receiver.partnerSupportKeys?.has(`${from}.${fromLandmark.side ?? ""}`) &&
    receiver.posture?.supports?.some((support) => {
      const landmark = resolveLandmark(support.landmark, support.side);
      return landmark?.base === from && landmark.side === fromLandmark.side;
    });
  if (!heldFrom && (LIMB_LANDMARKS.has(from) || !LIMB_LANDMARKS.has(to)))
    return contact;
  return {
    ...contact,
    from: contact.to,
    fromSide: contact.toSide,
    fromActor: contact.toActor,
    to: contact.from,
    toSide: contact.fromSide,
    toActor: contact.fromActor,
  };
}

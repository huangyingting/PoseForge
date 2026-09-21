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

export function limbFirstContact(contact) {
  const from = resolveLandmark(contact.from, contact.fromSide)?.base;
  const to = resolveLandmark(contact.to, contact.toSide)?.base;
  if (LIMB_LANDMARKS.has(from) || !LIMB_LANDMARKS.has(to)) return contact;
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

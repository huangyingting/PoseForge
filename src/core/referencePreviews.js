import { checkScene } from "./catalog.js";

export const REFERENCE_PREVIEW_NOTES = {
  "separate-participants":
    "Participants are shown separately. Original relationship, facing and contact details are not reconstructed.",
  "approximate-joints":
    "Joint angles are approximations from categorical posture descriptions, not measured 3D coordinates.",
  "assumed-floor":
    "A neutral floor is used for every posture study; original furniture and external supports are omitted.",
  "deferred-limb-detail":
    "Some limb or torso descriptions defer to the base posture or its supporting limbs.",
  "unread-limb-detail":
    "Some limb or torso descriptions could not be mapped; the base posture is retained for those details.",
  "clamped-joints":
    "Some inferred joint angles were limited to the rig's supported range of motion.",
  "unspecified-body-type":
    "An unspecified body choice uses the existing neutral model, which shares a scan with the female model.",
};

export function checkReferencePreviews(pack, descriptor, entries) {
  if (
    pack?.format !== "poseforge.reference-previews" ||
    pack.version !== 1 ||
    !Array.isArray(pack.scenes) ||
    pack.scenes.length !== descriptor.scenes ||
    pack.scenes.length < 1 ||
    pack.scenes.length > 20_000
  )
    throw new Error("Invalid reference preview pack.");
  const scenes = new Map();
  for (const value of pack.scenes) {
    if (
      !value ||
      typeof value.key !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.key) ||
      scenes.has(value.key)
    )
      throw new Error("Invalid or duplicate reference preview key.");
    const scene = checkScene(value.scene);
    if (
      scene.support.surface !== "floor" ||
      scene.relationship.contactMode !== "custom" ||
      scene.contacts.length ||
      scene.actors.some(
        (a) =>
          a.jointMode !== "fixed" ||
          !a.placement ||
          a.placement.mode === "guided" ||
          !a.wearing?.includes("top") ||
          !a.wearing?.includes("shorts"),
      )
    )
      throw new Error(
        "Reference previews must be clothed, separate fixed posture studies.",
      );
    scenes.set(value.key, scene);
  }
  const used = new Set();
  for (const entry of entries) {
    const scene = scenes.get(entry.previewKey);
    if (!scene || scene.actors.length !== entry.figures)
      throw new Error("A source reference is missing its complete 3D preview.");
    used.add(entry.previewKey);
  }
  if (used.size !== scenes.size)
    throw new Error("The preview pack contains unreferenced scenes.");
  return scenes;
}

export function referencePreset(entry, scenes) {
  const scene = scenes.get(entry.previewKey);
  if (!scene) throw new Error("This reference has no available 3D preview.");
  const title = `Reference ${entry.sourceId}`;
  const description =
    "Approximate clothed posture study. Participants are separate; original relationships and contacts are not reconstructed.";
  return {
    id: entry.id,
    title,
    description,
    category: "Reference previews",
    tags: ["reference", "approximate", "posture-study"],
    scene: { ...structuredClone(scene), title, description: "" },
    source: {
      dataset: "SexPoses",
      recordId: entry.sourceId,
      annotationHash: entry.annotationHash,
    },
    inputWarnings: entry.previewNotes.map(
      (code) => REFERENCE_PREVIEW_NOTES[code],
    ),
  };
}

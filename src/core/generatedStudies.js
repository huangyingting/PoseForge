import { checkPreset, checkScene } from "./catalog.js";
import { checkSeparatePositionScene } from "./positionContract.js";

export const GENERATED_STUDY_NOTES = {
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

export function checkGeneratedStudies(pack, descriptor, entries) {
  if (
    pack?.format !== "poseforge.generated-studies" ||
    pack.version !== 1 ||
    !Array.isArray(pack.scenes) ||
    pack.scenes.length !== descriptor.scenes ||
    pack.scenes.length < 1 ||
    pack.scenes.length > 20_000
  )
    throw new Error("Invalid generated study pack.");
  const scenes = new Map();
  for (const value of pack.scenes) {
    if (
      !value ||
      typeof value.key !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.key) ||
      scenes.has(value.key)
    )
      throw new Error("Invalid or duplicate generated study key.");
    const scene = checkScene(value.scene);
    checkSeparatePositionScene(scene);
    scenes.set(value.key, scene);
  }
  const used = new Set();
  for (const entry of entries) {
    const scene = scenes.get(entry.generatedKey);
    if (!scene || scene.actors.length !== entry.figures)
      throw new Error("A source is missing its complete generated study.");
    used.add(entry.generatedKey);
  }
  if (used.size !== scenes.size)
    throw new Error("The generated study pack contains unused scenes.");
  return scenes;
}

export function generatedPosition(entry, scenes, name = null) {
  const scene = scenes.get(entry.generatedKey);
  if (!scene) throw new Error("This source has no generated study.");
  const title = name
    ? `${name} · Generated approximation`
    : `Generated approximation · ${entry.sourceId.toUpperCase()}`;
  const description =
    "Approximate clothed posture study. Participants are separate; original relationships and contacts are not reconstructed.";
  const preset = checkPreset({
    id: `builtin.generated.${entry.sourceId}`,
    title,
    description,
    category: "Generated approximations",
    tags: ["position", "generated", "approximate", "posture-study"],
    position: {
      type: "generated_posture_study",
      name: "Generated approximation",
      variant: "generated",
    },
    scene: { ...structuredClone(scene), title, description: "" },
    source: {
      dataset: "SexPoses",
      recordId: entry.sourceId,
      annotationHash: entry.annotationHash,
    },
  });
  return {
    ...preset,
    inputWarnings: entry.generatedNotes.map(
      (code) => GENERATED_STUDY_NOTES[code],
    ),
  };
}

/** Verified, clothed stock layouts expressed in the public scene format. */
import { resolveArrangement, resolveSurface } from "../core/poseLibrary.js";

export const SIDE_FACING_LAYOUT = {
  referenceHeight: 0.55,
  surfaces: ["bed", "floor"],
  yaw: 180,
  camera: {
    view: "top",
  },
  actors: [
    {
      posture: "side_lying",
      bodyType: "female",
      wearing: ["top", "shorts"],
      outfit: "sage",
      stature: 1.66,
      build: 1,
      bust: 1,
      placement: {
        position: [-0.2, 0.721685741, 0],
        rotation: [84, 90, 0],
      },
      jointMode: "fixed",
      joints: {
        spine01: {
          flexion: 0.8,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: 0.8,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: 0.8,
          abduction: 0,
          rotation: 0,
        },
        neck: {
          flexion: 0,
          abduction: 5,
          rotation: 0,
        },
        head: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_l: {
          flexion: 160,
          abduction: -20,
          rotation: 0,
        },
        elbow_l: {
          flexion: 90,
          abduction: 0,
          rotation: 0,
        },
        wrist_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 150,
          abduction: 0,
          rotation: 0,
        },
        elbow_r: {
          flexion: 100,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        hip_l: {
          flexion: 0,
          abduction: 6,
          rotation: 0,
        },
        knee_l: {
          flexion: 8,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        toe_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 0,
          abduction: -6,
          rotation: 0,
        },
        knee_r: {
          flexion: 8,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        toe_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "relaxed",
        r: "relaxed",
      },
    },
    {
      posture: "side_lying",
      bodyType: "male",
      wearing: ["top", "shorts"],
      outfit: "navy",
      stature: 1.78,
      build: 1,
      bust: 0,
      placement: {
        position: [0.05, 0.713872438, 0.025],
        rotation: [82, -90, 0],
      },
      jointMode: "fixed",
      joints: {
        spine01: {
          flexion: 0.8,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: 0.8,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: 0.8,
          abduction: 0,
          rotation: 0,
        },
        neck: {
          flexion: 0,
          abduction: -10,
          rotation: 0,
        },
        head: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_l: {
          flexion: 160,
          abduction: -10,
          rotation: 0,
        },
        elbow_l: {
          flexion: 100,
          abduction: 0,
          rotation: 0,
        },
        wrist_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 160,
          abduction: -20,
          rotation: 0,
        },
        elbow_r: {
          flexion: 90,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        hip_l: {
          flexion: 0,
          abduction: -8,
          rotation: 0,
        },
        knee_l: {
          flexion: 8,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        toe_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 0,
          abduction: 8,
          rotation: 0,
        },
        knee_r: {
          flexion: 8,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        toe_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "relaxed",
        r: "relaxed",
      },
    },
  ],
};

export const SPOONING_LAYOUT = {
  referenceHeight: 0.55,
  surfaces: ["bed", "floor"],
  yaw: 0,
  camera: {
    view: "top",
  },
  actors: [
    {
      posture: "side_lying",
      bodyType: "female",
      wearing: ["top", "shorts"],
      outfit: "sage",
      stature: 1.66,
      build: 1,
      bust: 1,
      placement: {
        position: [0, 0.721685741, 0],
        rotation: [84, 90, 0],
      },
      jointMode: "fixed",
      joints: {
        spine01: {
          flexion: 0.8,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: 0.8,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: 0.8,
          abduction: 0,
          rotation: 0,
        },
        neck: {
          flexion: -30,
          abduction: 5,
          rotation: 0,
        },
        head: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_l: {
          flexion: 95,
          abduction: -20,
          rotation: 0,
        },
        elbow_l: {
          flexion: 90,
          abduction: 0,
          rotation: 0,
        },
        wrist_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 95,
          abduction: 0,
          rotation: 0,
        },
        elbow_r: {
          flexion: 100,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        hip_l: {
          flexion: 25,
          abduction: 6,
          rotation: 0,
        },
        knee_l: {
          flexion: 40,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        toe_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 25,
          abduction: -6,
          rotation: 0,
        },
        knee_r: {
          flexion: 40,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        toe_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "relaxed",
        r: "relaxed",
      },
    },
    {
      posture: "side_lying",
      bodyType: "male",
      wearing: ["top", "shorts"],
      outfit: "navy",
      stature: 1.78,
      build: 1,
      bust: 0,
      placement: {
        position: [-0.238, 0.7085, -0.025],
        rotation: [80, 90, 0],
      },
      jointMode: "fixed",
      joints: {
        spine01: {
          flexion: -3.4,
          abduction: 0,
          rotation: 0,
        },
        spine02: {
          flexion: -3.4,
          abduction: 0,
          rotation: 0,
        },
        spine03: {
          flexion: -3.4,
          abduction: 0,
          rotation: 0,
        },
        neck: {
          flexion: 30,
          abduction: 5,
          rotation: 0,
        },
        head: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_l: {
          flexion: 10.18899471,
          abduction: 10.71098418,
          rotation: 18.83705095,
        },
        elbow_l: {
          flexion: 90.51135697,
          abduction: 0,
          rotation: 0,
        },
        wrist_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        clavicle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        shoulder_r: {
          flexion: 170,
          abduction: 14,
          rotation: 0,
        },
        elbow_r: {
          flexion: 90,
          abduction: 0,
          rotation: 0,
        },
        wrist_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        hip_l: {
          flexion: 20,
          abduction: 10,
          rotation: 0,
        },
        knee_l: {
          flexion: 40,
          abduction: 0,
          rotation: 0,
        },
        ankle_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        toe_l: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        hip_r: {
          flexion: 20,
          abduction: -10,
          rotation: 0,
        },
        knee_r: {
          flexion: 40,
          abduction: 0,
          rotation: 0,
        },
        ankle_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
        toe_r: {
          flexion: 0,
          abduction: 0,
          rotation: 0,
        },
      },
      hands: {
        l: "open",
        r: "relaxed",
      },
    },
  ],
};

/** Apply authored defaults only when they cannot overrule a requested variation. */
export function applyPresetLayout(scene, definition) {
  const layout = definition?.layout;
  if (!layout) return { scene, applied: false };
  const skip = (reason) => ({ scene, applied: false, reason });
  const arrangement = resolveArrangement(scene.relationship?.arrangement);
  const yaw = scene.relationship?.yaw ?? arrangement?.yaw;
  if (
    arrangement?.id !== definition.arrangement ||
    !Number.isFinite(yaw) ||
    Math.abs((yaw - layout.yaw) % 360) > 1e-9 ||
    scene.relationship?.contactMode === "custom" ||
    JSON.stringify(scene.contacts ?? []) !==
      JSON.stringify(definition.contacts ?? [])
  )
    return skip("the arrangement, facing or contacts were changed");
  const surface = resolveSurface(scene.support?.surface);
  if (!layout.surfaces.includes(surface.id))
    return skip("that support surface has no stock calibration");
  if (scene.actors.length !== layout.actors.length)
    return skip("the figure count was changed");
  for (const [index, actor] of scene.actors.entries()) {
    const reference = layout.actors[index];
    if (
      actor.bodyType !== reference.bodyType ||
      actor.posture !== reference.posture ||
      (actor.stature != null && actor.stature !== reference.stature) ||
      (actor.build ?? 1) !== reference.build ||
      (actor.bust != null && actor.bust !== reference.bust)
    )
      return skip("the body settings or posture were changed");
    if (
      actor.placement != null ||
      actor.jointMode === "fixed" ||
      Object.keys(actor.joints ?? {}).length ||
      ["arms", "legs", "trunk", "hands", "feet", "hair", "mobility"].some(
        (key) => actor[key] != null,
      )
    )
      return skip("explicit figure settings take precedence");
    if (
      actor.wearing != null &&
      (!Array.isArray(actor.wearing) ||
        actor.wearing.length !== reference.wearing.length ||
        !reference.wearing.every((name) => actor.wearing.includes(name)))
    )
      return skip("the clothing coverage was changed");
  }
  const result = structuredClone(scene);
  result.actors = result.actors.map((actor, index) => {
    const reference = structuredClone(layout.actors[index]);
    reference.placement.position[1] += surface.height - layout.referenceHeight;
    const appearance = {};
    for (const key of ["id", "label", "skinTone", "outfit", "wearing"])
      if (actor[key] != null) appearance[key] = actor[key];
    return { ...actor, ...reference, ...appearance };
  });
  result.camera ??= structuredClone(layout.camera);
  return { scene: result, applied: true };
}

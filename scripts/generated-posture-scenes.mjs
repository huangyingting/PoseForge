/** Canonical generated posture studies derived from categorical annotations. */
import { createHash } from "node:crypto";
import { resolvePosture } from "../src/core/poseLibrary.js";
import { limbJoints } from "../src/core/limbPose.js";
import { validateScene } from "../src/core/scene.js";
import { solveScene } from "../src/core/solver.js";
import { captureSolvedPose } from "../src/core/placement.js";
import { checkScene } from "../src/core/catalog.js";

export function createGeneratedStudyBuilder() {
  const actors = new Map();
  return (annotation) => {
    const notes = new Set([
      "separate-participants",
      "approximate-joints",
      "assumed-floor",
    ]);
    const studies = annotation.participants.map((person, index) => {
      const posture = resolvePosture(person.posture, person.support);
      if (!posture)
        throw new Error(
          `No posture mapping for ${annotation.image_id}, figure ${index + 1}.`,
        );
      const limbs = limbJoints(posture, {
        arms: person.arms,
        legs: person.legs,
        trunk: person.torso_orientation,
      });
      if (limbs.deferred.length) notes.add("deferred-limb-detail");
      if (limbs.unread.length) notes.add("unread-limb-detail");
      const bodyType = ["male", "female"].includes(person.gender)
        ? person.gender
        : "neutral";
      if (bodyType === "neutral") notes.add("unspecified-body-type");
      const spec = {
        id: "figure",
        bodyType,
        posture: posture.id,
        wearing: ["top", "shorts"],
        joints: limbs.joints,
      };
      const key = JSON.stringify(spec);
      if (!actors.has(key)) {
        const checked = validateScene({
          actors: [spec],
          support: { surface: "floor" },
          relationship: { contactMode: "custom" },
          contacts: [],
        });
        if (
          checked.issues.some(
            (issue) =>
              issue.level !== "warning" ||
              !issue.message.includes("is outside"),
          )
        )
          throw new Error(
            `Invalid derived posture for ${annotation.image_id}.`,
          );
        const solved = solveScene(checked.scene).actors[0];
        const bounds = {
          min: Math.min(
            ...solved.volumes.flatMap((v) => [v.a[0] - v.ra, v.b[0] - v.rb]),
          ),
          max: Math.max(
            ...solved.volumes.flatMap((v) => [v.a[0] + v.ra, v.b[0] + v.rb]),
          ),
        };
        actors.set(key, {
          spec: { ...spec, ...captureSolvedPose(solved) },
          bounds,
          clamped: checked.issues.length > 0,
        });
      }
      if (actors.get(key).clamped) notes.add("clamped-joints");
      return structuredClone(actors.get(key));
    });
    const gap = 0.5;
    const width =
      studies.reduce((sum, a) => sum + a.bounds.max - a.bounds.min, 0) +
      gap * (studies.length - 1);
    let cursor = -width / 2;
    const scene = checkScene({
      actors: studies.map(({ spec, bounds }, index) => {
        spec.placement.position[0] += cursor - bounds.min;
        cursor += bounds.max - bounds.min + gap;
        return {
          ...spec,
          id: `figure-${index + 1}`,
          label: `Figure ${String.fromCharCode(65 + index)}`,
          outfit: ["sage", "navy", "clay", "sage"][index],
        };
      }),
      support: { surface: "floor" },
      relationship: { arrangement: "side_by_side", contactMode: "custom" },
      contacts: [],
      camera: { view: "three_quarter" },
    });
    const key = createHash("sha256")
      .update(JSON.stringify(scene))
      .digest("hex");
    return { key, scene, notes: [...notes].sort() };
  };
}

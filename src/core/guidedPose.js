/** A portable authored starting pose, never a bypass around geometry checks. */
import { rootFromPlacement } from "./placement.js";

export function guidedPoseCandidate(solved) {
  let proposed = false;
  const poses = solved.actors.map((actor) => {
    const pose = structuredClone(actor.pose);
    if (actor.spec?.placement?.mode !== "guided" || actor.mobility <= 0)
      return pose;
    proposed = true;
    pose.root = rootFromPlacement(actor.spec.placement);
    for (const [bone, angles] of Object.entries(actor.spec.joints ?? {})) {
      if (actor.skeleton.index.has(bone))
        pose.joints[bone] = actor.skeleton.clampAngles(bone, {
          ...pose.joints[bone],
          ...angles,
        });
    }
    return pose;
  });
  return proposed ? poses : null;
}

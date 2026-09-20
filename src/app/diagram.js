import { Skeleton, evaluatePose } from "../core/skeleton.js";
import { resolvePosture, orientationFromAxes } from "../core/poseLibrary.js";

const node = (name, attrs) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) =>
    el.setAttribute(key, String(value)),
  );
  return el;
};

/** Joint diagrams represent posture intent, before contact solving. */
export function poseDiagram(scene) {
  const svg = node("svg", {
    viewBox: "0 0 200 108",
    "aria-hidden": "true",
    focusable: "false",
  });
  const width = 180 / scene.actors.length;
  svg.append(
    node("path", { d: "M20 98 H180", stroke: "#d6dfd7", "stroke-width": 1 }),
  );
  scene.actors.forEach((actor, index) => {
    const skeleton = new Skeleton(actor);
    const posture = resolvePosture(actor.posture);
    const joints = structuredClone(posture.joints);
    for (const [name, angles] of Object.entries(actor.joints ?? {}))
      joints[name] = { ...joints[name], ...angles };
    const pose = evaluatePose(skeleton, {
      root: {
        quaternion: orientationFromAxes(posture.spineDir, posture.faceDir),
      },
      joints,
    });
    const points = pose.positions.map(([x, y, z]) => [
      x * 0.87 + z * 0.5,
      -y + z * 0.13,
    ]);
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]);
    const minX = Math.min(...xs),
      maxX = Math.max(...xs),
      minY = Math.min(...ys),
      maxY = Math.max(...ys);
    const scale = Math.min(
      (width - 14) / (maxX - minX + 0.1),
      79 / (maxY - minY + 0.15),
    );
    const xy = points.map(([x, y]) => [
      10 + width * (index + 0.5) + (x - (maxX + minX) / 2) * scale,
      91 + (y - maxY) * scale,
    ]);
    const color = index % 2 ? "#b17b61" : "#527c70";
    skeleton.bones.forEach((bone, i) => {
      if (bone.parentIndex < 0 || /toe|hand|headTop/.test(bone.name)) return;
      const a = xy[bone.parentIndex],
        b = xy[i];
      svg.append(
        node("line", {
          x1: a[0],
          y1: a[1],
          x2: b[0],
          y2: b[1],
          stroke: color,
          "stroke-width": /spine|neck/.test(bone.name) ? 9 : 5,
          "stroke-linecap": "round",
        }),
      );
    });
    const head = xy[skeleton.boneIndex("head")];
    svg.append(
      node("circle", { cx: head[0], cy: head[1] - 3, r: 6, fill: color }),
    );
  });
  return svg;
}

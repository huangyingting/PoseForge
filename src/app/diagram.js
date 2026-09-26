import { Skeleton, evaluatePose } from "../core/skeleton.js";
import { resolvePosture, orientationFromAxes } from "../core/poseLibrary.js";
import {
  PREVIEW_SEGMENTS,
  solvedPreview,
  projectPreview,
} from "../core/posePreview.js";

const node = (name, attrs) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) =>
    el.setAttribute(key, String(value)),
  );
  return el;
};

/** Cheap authored-pose fallback while the independent preview worker solves. */
export function authoredPreview(scene) {
  const actors = scene.actors.map((actor, index) => {
    const skeleton = new Skeleton(actor),
      posture = resolvePosture(actor.posture);
    const joints = structuredClone(posture.joints);
    for (const [name, angles] of Object.entries(actor.joints ?? {}))
      joints[name] = { ...joints[name], ...angles };
    const evaluated = evaluatePose(skeleton, {
      root: {
        position: [index * 0.7, posture.rootHeight * skeleton.stature, 0],
        quaternion: orientationFromAxes(posture.spineDir, posture.faceDir),
      },
      joints,
    });
    return { skeleton, evaluated };
  });
  return solvedPreview({ actors, props: [], quality: {} }, "authored");
}

/** One coordinate system and depth ordering for the whole composition. */
export function poseDiagram(preview) {
  const layout = projectPreview(preview);
  const svg = node("svg", {
    viewBox: "0 0 160 128",
    "aria-hidden": "true",
    focusable: "false",
    "data-basis": preview.basis,
  });
  const commands = [];
  svg.append(
    node("path", { d: "M13 114 H147", stroke: "#d6dfd7", "stroke-width": 1 }),
  );
  for (const segments of layout.props)
    for (const [a, b] of segments)
      commands.push({
        depth: Math.min(a[2], b[2]) - 0.04,
        shape: node("line", {
          x1: a[0],
          y1: a[1],
          x2: b[0],
          y2: b[1],
          stroke: "#9aa99b",
          "stroke-width": 1.2,
          opacity: 0.7,
        }),
      });
  const palette = ["#527c70", "#b17b61", "#647b9f", "#937294"];
  layout.actors.forEach((actor, index) => {
    const color = palette[index % palette.length];
    for (const [from, to, weight] of PREVIEW_SEGMENTS) {
      const a = actor.points[from],
        b = actor.points[to];
      commands.push({
        depth: (a[2] + b[2]) / 2,
        shape: node("line", {
          x1: a[0],
          y1: a[1],
          x2: b[0],
          y2: b[1],
          stroke: color,
          "stroke-width": weight,
          "stroke-linecap": "round",
        }),
      });
    }
    const head = node("g", {});
    head.append(
      node("circle", {
        cx: actor.head[0],
        cy: actor.head[1],
        r: actor.radius,
        fill: color,
      }),
    );
    const dx = actor.face[0] - actor.head[0],
      dy = actor.face[1] - actor.head[1],
      length = Math.hypot(dx, dy) || 1;
    head.append(
      node("line", {
        x1: actor.head[0],
        y1: actor.head[1],
        x2: actor.head[0] + (dx / length) * actor.radius * 1.35,
        y2: actor.head[1] + (dy / length) * actor.radius * 1.35,
        stroke: color,
        "stroke-width": 2.2,
        "stroke-linecap": "round",
      }),
    );
    commands.push({ depth: actor.head[2], shape: head });
  });
  commands
    .sort((a, b) => a.depth - b.depth)
    .forEach((command) => svg.append(command.shape));
  return svg;
}

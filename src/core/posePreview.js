/** Small, renderer-independent joint snapshots for catalog diagrams. */
import { landmarkPoint } from "./landmarks.js";
import { validateScene } from "./scene.js";

export const PREVIEW_SEGMENTS = [
  ["pelvis", "spine01", 5],
  ["spine01", "spine03", 7],
  ["spine03", "neck", 4],
  ["neck", "head", 3],
  ["shoulder_l", "shoulder_r", 4],
  ["hip_l", "hip_r", 4],
  ...["l", "r"].flatMap((side) => [
    [`spine03`, `shoulder_${side}`, 4],
    [`shoulder_${side}`, `elbow_${side}`, 3.5],
    [`elbow_${side}`, `wrist_${side}`, 3],
    [`wrist_${side}`, `hand_${side}`, 2.5],
    ["pelvis", `hip_${side}`, 4],
    [`hip_${side}`, `knee_${side}`, 4],
    [`knee_${side}`, `ankle_${side}`, 3],
    [`ankle_${side}`, `toe_${side}`, 2.5],
  ]),
];
const names = [...new Set(PREVIEW_SEGMENTS.flatMap(([a, b]) => [a, b]))];
const rounded = (point) => point.map((n) => Math.round(n * 10000) / 10000);

export function previewKey(scene) {
  const normalized = validateScene(structuredClone(scene)).scene;
  const stable = (value) =>
    Array.isArray(value)
      ? value.map(stable)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .filter((key) => value[key] !== undefined)
              .map((key) => [key, stable(value[key])]),
          )
        : value;
  return JSON.stringify(
    stable({
      actors: normalized.actors.map(({ label, ...actor }) => actor),
      support: normalized.support,
      relationship: normalized.relationship,
      contacts: normalized.contacts,
    }),
  );
}

export function solvedPreview(solved, basis = "base") {
  const issues = [];
  if (solved.quality.maxDepth > 0.022) issues.push("Body overlap");
  if (solved.quality.propPenetration > 0.022) issues.push("Support overlap");
  if (solved.quality.unmetContacts > 0) issues.push("Unresolved contacts");
  if (solved.actors.some((actor) => (actor.seatResidual ?? 0) > 0.02))
    issues.push("Support gap");
  return {
    basis,
    issues,
    actors: solved.actors.map((actor) => ({
      stature: actor.skeleton.stature,
      points: Object.fromEntries(
        names.map((name) => [
          name,
          rounded(actor.evaluated.positions[actor.skeleton.boneIndex(name)]),
        ]),
      ),
      head: rounded(landmarkPoint(actor, "head")),
      face: rounded(landmarkPoint(actor, "face")),
    })),
    props: solved.props.map(({ kind, center, size }) => ({
      kind,
      center: rounded(center),
      size: rounded(size),
    })),
  };
}

/** The same three-quarter orientation as the studio, with orthographic scale. */
const direction = [0.75, 0.42, 1];
const length = Math.hypot(...direction);
const forward = direction.map((n) => n / length);
const right = [0.8, 0, -0.6];
const up = [
  -forward[1] * 0.6,
  forward[2] * 0.8 + forward[0] * 0.6,
  -forward[1] * 0.8,
];
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const project = (point) => [
  dot(point, right),
  -dot(point, up),
  dot(point, forward),
];
const corners = (prop) =>
  Array.from({ length: 8 }, (_, index) =>
    prop.center.map(
      (n, axis) => n + prop.size[axis] * ((index >> axis) & 1 ? 0.5 : -0.5),
    ),
  );

export function projectPreview(preview) {
  const points = preview.actors.flatMap((actor) => [
    ...Object.values(actor.points),
    actor.head,
    actor.face,
  ]);
  const props = preview.props.map((prop) => corners(prop));
  points.push(...props.flat());
  const projected = points.map(project);
  if (!projected.length || projected.flat().some((n) => !Number.isFinite(n)))
    throw new Error("Invalid preview geometry.");
  const xs = projected.map((p) => p[0]),
    ys = projected.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const scale = Math.min(
    132 / Math.max(maxX - minX, 0.2),
    91 / Math.max(maxY - minY, 0.2),
  );
  const transform = (point) => {
    const p = project(point);
    return [
      80 + (p[0] - (minX + maxX) / 2) * scale,
      111 + (p[1] - maxY) * scale,
      p[2],
    ];
  };
  return {
    scale,
    actors: preview.actors.map((actor) => ({
      points: Object.fromEntries(
        Object.entries(actor.points).map(([name, point]) => [
          name,
          transform(point),
        ]),
      ),
      head: transform(actor.head),
      face: transform(actor.face),
      radius: Math.max(2, actor.stature * 0.046 * scale),
    })),
    props: props.map((points) => points.map(transform)),
  };
}

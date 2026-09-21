/** Non-graphic contact fixtures, measured against the meshes the studio draws. */
import { readFileSync } from "node:fs";
import { BUILTIN_PRESETS, checkScene } from "../src/core/catalog.js";
import { solveScene, refresh, measureSceneSafety } from "../src/core/solver.js";
import { detectContacts } from "../src/core/collision.js";
import { resolveLandmark } from "../src/core/landmarks.js";
import { buildHumanTemplate, featureRelief } from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";
import { withHair } from "../src/core/hair.js";
import {
  createSurfaceContactQuery,
  refineSurfaceContacts,
  SURFACE_CONTACT_TOLERANCE,
} from "../src/core/surfaceContacts.js";

const raw = new Map(),
  dressed = new Map();
function template(actor) {
  const type = actor.bodyType === "male" ? "male" : "female";
  if (!raw.has(type))
    raw.set(
      type,
      buildHumanTemplate(
        readFileSync(
          new URL(`../assets/models/realistic-${type}.glb`, import.meta.url),
        ),
      ),
    );
  const key = `${type}|${actor.spec.build}|${actor.spec.bust ?? ""}`;
  if (!dressed.has(key))
    dressed.set(
      key,
      withHair(
        withGarments(
          featureRelief(raw.get(type), {
            bodyType: actor.bodyType,
            build: actor.spec.build,
            bust: actor.spec.bust,
          }),
          {
            bodyType: actor.bodyType,
            wearing: ["top", "shorts"],
            colour: actor.spec.outfit,
          },
        ),
        { bodyType: actor.bodyType },
      ),
    );
  return dressed.get(key);
}
const base = () =>
  structuredClone(
    BUILTIN_PRESETS.find((p) => p.id === "builtin.helping-hand").scene,
  );
const cases = [
  ["female → male", () => {}, true],
  [
    "male → female",
    (scene) => {
      scene.actors[0].bodyType = "male";
      scene.actors[1].bodyType = "female";
    },
    true,
  ],
  [
    "female pair",
    (scene) => {
      scene.actors[1].bodyType = "female";
    },
    true,
  ],
  [
    "male pair",
    (scene) => {
      scene.actors[0].bodyType = "male";
    },
    true,
  ],
  [
    "kneeling pair",
    (scene) => {
      scene.actors.forEach((a) => {
        a.posture = "kneeling";
      });
    },
    true,
  ],
  [
    "different proportions",
    (scene) => {
      Object.assign(scene.actors[0], { stature: 1.55, build: 0.9 });
      Object.assign(scene.actors[1], { stature: 1.9, build: 1.15 });
    },
    true,
  ],
  [
    "authored wrist",
    (scene) => {
      scene.actors[0].joints = { wrist_r: { flexion: 0, abduction: 0 } };
    },
    true,
  ],
];
let failures = 0;
for (const [name, change, shouldReach] of cases) {
  const scene = base();
  change(scene);
  const solved = solveScene(checkScene(scene));
  const initial = measureSceneSafety(solved),
    templates = solved.actors.map(template);
  const roots = solved.actors.map((a) => [...a.pose.root.position]);
  const started = performance.now();
  refineSurfaceContacts(
    solved,
    templates,
    process.argv.includes("--extended") ? { maxSteps: 96, maxPasses: 16 } : {},
  );
  const elapsed = performance.now() - started,
    report = solved.quality.contactDetail[0];
  const safe = [
    "maxDepth",
    "maxSelfDepth",
    "maxBodyDepth",
    "totalDepth",
    "propPenetration",
  ].every((key) => solved.quality[key] <= initial[key] + 1e-8);
  const improves = report.beforeIntersects
    ? !report.intersects
    : !report.intersects && report.surfaceGap <= report.beforeSurfaceGap + 1e-7;
  const reaches =
    !report.intersects &&
    solved.quality.limbIntersections.every((hit) => !hit) &&
    solved.quality.figureSurfaces.every((pair) => pair.intersects === false) &&
    report.surfaceGap <= SURFACE_CONTACT_TOLERANCE;
  const ok = safe && improves && (!shouldReach || reaches);
  if (!ok) failures++;
  console.log(
    JSON.stringify({
      name,
      beforeMm: report.beforeSurfaceGap * 1000,
      initiallyIntersecting: report.beforeIntersects,
      afterMm: report.surfaceGap * 1000,
      safe,
      reaches,
      reason: report.reason,
      steps: solved.quality.surfaceRefinement.steps,
      proxyDepthMm: solved.quality.proxyMaxDepth * 1000,
      verifiedProxyContacts: solved.quality.verifiedProxyContacts,
      figureSurfaces: solved.quality.figureSurfaces,
      rootShiftMm: solved.actors.map(
        (a, i) =>
          Math.hypot(...a.pose.root.position.map((v, k) => v - roots[i][k])) *
          1000,
      ),
      milliseconds: Math.round(elapsed),
      ok,
    }),
  );
  if (!ok && process.argv.includes("--debug")) {
    const c = solved.contacts[0],
      measured = createSurfaceContactQuery(solved.actors, templates)(c);
    const actor = solved.actors[c.fromActor],
      saved = [...actor.pose.root.position];
    const delta = measured.to.map((v, k) => v - measured.from[k]),
      len = Math.hypot(delta[0], delta[2]);
    actor.pose.root.position[0] += (delta[0] / len) * 0.02;
    actor.pose.root.position[2] += (delta[2] / len) * 0.02;
    refresh(actor);
    const declared = new Set(
      solved.contacts.map((contact) => {
        const a = `${solved.actors[contact.fromActor].id}:${resolveLandmark(contact.from, contact.fromSide).bone}`;
        const b = `${solved.actors[contact.toActor].id}:${resolveLandmark(contact.to, contact.toSide).bone}`;
        return a < b ? `${a}|${b}` : `${b}|${a}`;
      }),
    );
    console.log({
      afterStep: createSurfaceContactQuery(solved.actors, templates)(c)
        .distance,
      collisions: detectContacts(
        solved.actors.map((a) => ({ id: a.id, volumes: a.volumes })),
        { declared, selfCollision: true },
      )
        .slice(0, 8)
        .map((hit) => ({
          from: hit.volumeA.bone,
          to: hit.volumeB.bone,
          self: hit.self,
          depth: hit.depth,
        })),
    });
    actor.pose.root.position = saved;
    refresh(actor);
  }
}
if (failures) process.exitCode = 1;

/**
 * Posture validator.
 *
 * For every posture in the library: build an actor, seat it on the floor, and
 * report where the declared support landmarks actually ended up, plus any
 * self-intersection. Run with `node scripts/validate-postures.mjs`.
 */

import { detectContacts, penetrationReport } from "../src/core/collision.js";
import { resolveLandmark } from "../src/core/landmarks.js";
import {
  POSTURE_NAMES,
  POSTURES,
  resolveSurface,
  supportPlaneFor,
} from "../src/core/poseLibrary.js";
import { createActor, centreOfMass, refresh, seatOnSurface } from "../src/core/solver.js";

const mm = (value) => `${(value * 1000).toFixed(0)}mm`.padStart(7);

function supportGap(actor, support) {
  const resolved = resolveLandmark(support.landmark, support.side ?? null);
  if (!resolved) return null;
  let lowest = Infinity;
  for (const volume of actor.volumes) {
    if (!resolved.bones.includes(volume.bone)) continue;
    lowest = Math.min(lowest, volume.a[1] - volume.ra, volume.b[1] - volume.rb);
  }
  return Number.isFinite(lowest) ? lowest : null;
}

let worstGap = 0;
let worstSelf = 0;
const problems = [];

for (const name of POSTURE_NAMES) {
  const posture = POSTURES[name];
  const surface = resolveSurface(posture.surface || "floor");
  const actor = refresh(createActor({ posture: name, bodyType: "female" }, 0));
  seatOnSurface(actor, surface);

  // Each support is measured against the height it was actually seeking. A
  // sitter's feet are 460mm below her buttocks and both are exactly where they
  // belong; scoring them against one plane is what let the old suite call a
  // chair pose sound while the figure lay back across it with her feet in the
  // air.
  const gaps = posture.supports.map((support) => {
    const y = supportGap(actor, support);
    const want = supportPlaneFor(support, surface);
    return {
      name: support.landmark + (support.side ? `.${support.side}` : ""),
      gap: y == null ? null : y - want,
    };
  });

  const self = detectContacts([{ id: actor.id, volumes: actor.volumes }], { selfCollision: true });
  const report = penetrationReport(self);

  let lowest = Infinity;
  for (const volume of actor.volumes) {
    lowest = Math.min(lowest, volume.a[1] - volume.ra, volume.b[1] - volume.rb);
  }
  const com = centreOfMass(actor);

  const gapText = gaps
    .map((entry) => `${entry.name}=${entry.gap == null ? "  n/a" : mm(entry.gap)}`)
    .join("  ");
  const flags = [];
  const maxGap = gaps.length ? Math.max(...gaps.map((g) => Math.abs(g.gap ?? 0))) : 0;
  if (maxGap > 0.03) flags.push("SUPPORT");
  if (report.maxDepth > 0.02) flags.push("SELF");
  if (lowest - surface.ground < -0.005) flags.push("SUNK");
  if (flags.length) problems.push(`${name}: ${flags.join("+")}`);

  worstGap = Math.max(worstGap, maxGap);
  worstSelf = Math.max(worstSelf, report.maxDepth);

  console.log(
    `${name.padEnd(22)} ${(posture.surface || "floor").padEnd(6)} floor=${mm(lowest - surface.ground)}  self=${String(report.count).padStart(2)}@${mm(report.maxDepth)}  ${flags.join("+").padEnd(8)} ${gapText}`
  );
}

console.log(`\nworst support gap ${mm(worstGap)}   worst self-penetration ${mm(worstSelf)}`);
console.log(problems.length ? `needs work: ${problems.join(", ")}` : "all postures within tolerance");

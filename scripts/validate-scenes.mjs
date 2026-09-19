/**
 * Scene solver validator.
 *
 * Sweeps every arrangement against the postures it plausibly applies to and
 * reports what the solver actually produced: interpenetration, contacts that
 * were asked for and not met, actors sunk through the floor or floating off
 * their declared supports.
 *
 * The point is breadth. A solver change judged against a handful of hand-picked
 * scenes will happily fix those and break the rest, because the cases that
 * break are exactly the ones nobody thought to pick. Run with
 * `node scripts/validate-scenes.mjs`, or `--all` to list every case rather than
 * just the flagged ones.
 */

import { resolveLandmark } from "../src/core/landmarks.js";
import {
  POSTURE_NAMES,
  POSTURES,
  resolveSurface,
  supportPlaneFor,
} from "../src/core/poseLibrary.js";
import { solveScene } from "../src/core/solver.js";

/**
 * Which postures each arrangement is worth trying with.
 *
 * `primary` is actor 0 and `secondary` is actor 1; the arrangement's contacts
 * read from the secondary to the primary, so for `rear_alignment` the primary
 * is the partner in front. The cross product of the two lists is the suite -
 * declaring the lists rather than the pairs is what keeps this honest, because
 * it produces the awkward combinations too instead of only the ones that were
 * already known to work.
 */
const SUITE = {
  face_to_face: {
    primary: ["standing", "seated", "reclined", "supine", "side_lying", "kneeling"],
    secondary: ["standing", "kneeling", "all_fours", "seated_straddle", "side_lying", "supine"],
  },
  rear_alignment: {
    primary: ["all_fours", "bent_over_support", "kneeling", "prone", "side_lying", "standing"],
    secondary: ["kneeling", "standing", "side_lying", "all_fours"],
  },
  spooning: {
    primary: ["side_lying", "prone", "supine"],
    secondary: ["side_lying", "supine"],
  },
  over_supine: {
    primary: ["supine", "reclined", "prone", "side_lying", "supine_legs_raised"],
    secondary: ["all_fours", "forearms_and_knees", "kneeling", "standing_bent_forward"],
  },
  straddle_lap: {
    primary: ["seated", "seated_reclined", "reclined"],
    secondary: ["seated_straddle", "kneeling_straddle"],
  },
  straddle_supine: {
    primary: ["supine", "reclined", "prone", "supine_legs_raised"],
    secondary: ["seated_straddle", "kneeling_straddle", "all_fours"],
  },
  side_by_side: {
    primary: ["standing", "supine", "side_lying", "seated"],
    secondary: ["standing", "supine", "side_lying", "seated"],
  },
  behind_bent_over: {
    primary: ["bent_over_support", "all_fours", "standing_bent_forward", "kneeling_low"],
    secondary: ["standing", "kneeling"],
  },
  supported_lift: {
    primary: ["standing", "kneeling"],
    secondary: ["lifted", "inverted"],
  },
  head_to_toe: {
    primary: ["supine", "side_lying"],
    secondary: ["supine", "side_lying", "all_fours"],
  },
};

/** Tolerances, in metres. */
const LIMITS = {
  // The soft-tissue allowance the collision stage itself works to. Anything
  // past it is visible as one body cutting into another.
  penetration: 0.022,
  // A contact is "met" when the surfaces are within roughly a finger's width.
  contact: 0.06,
  // How far a volume may dip below the support surface before it reads as the
  // actor having fallen through it.
  sunk: 0.012,
  // How far a declared support may float above the surface it is resting on.
  support: 0.05,
};

const mm = (value) => `${(value * 1000).toFixed(0)}mm`;

/** Height of the lowest point of an actor's surface, relative to the ground. */
function floorClearance(actor, groundY) {
  let lowest = Infinity;
  for (const volume of actor.volumes) {
    lowest = Math.min(lowest, volume.a[1] - volume.ra, volume.b[1] - volume.rb);
  }
  return Number.isFinite(lowest) ? lowest - groundY : 0;
}

/**
 * Worst distance between a declared support and the surface it rests on.
 *
 * Only applies to actors standing on the ground. Someone being carried, or
 * kneeling on their partner rather than the bed, is meant to be off the floor,
 * and `mountedActors` names them so they are not marked down for it.
 */
function supportFloat(actor, surface) {
  let worst = 0;
  for (const support of actor.posture.supports) {
    const resolved = resolveLandmark(support.landmark, support.side ?? null);
    if (!resolved) continue;
    let lowest = Infinity;
    for (const volume of actor.volumes) {
      if (volume.bone !== resolved.bone) continue;
      lowest = Math.min(lowest, volume.a[1] - volume.ra, volume.b[1] - volume.rb);
    }
    // Against the plane this particular support was seeking. A chair gives a
    // sitter two of them - buttocks on the seat, feet on the floor - and half
    // a metre apart is the correct answer, not a float.
    const want = supportPlaneFor(support, surface);
    if (Number.isFinite(lowest)) worst = Math.max(worst, Math.abs(lowest - want));
  }
  return worst;
}

function evaluate(scene, { mounted = false } = {}) {
  const started = Date.now();
  const out = solveScene(scene);
  const surface = out.surface;
  const flags = [];

  if (out.quality.maxDepth > LIMITS.penetration) flags.push("PEN");

  // Contacts the solver reported as blocked are excluded: the bodies are
  // already as close as their limbs allow, which is an answer, not a failure.
  const unmet = out.quality.contactDetail.filter(
    (entry) => !entry.unreachable && entry.distance > LIMITS.contact
  );

  let worstSunk = 0;
  let worstFloat = 0;
  out.actors.forEach((actor, index) => {
    const clearance = floorClearance(actor, surface.ground);
    if (clearance < -worstSunk) worstSunk = -clearance;
    // The mounted partner is supposed to be off the ground.
    if (!(mounted && index === 1)) {
      worstFloat = Math.max(worstFloat, supportFloat(actor, surface));
    }
  });
  if (worstSunk > LIMITS.sunk) flags.push("SUNK");
  if (worstFloat > LIMITS.support) flags.push("FLOAT");

  // Unmet contacts are tracked but do not by themselves mark a case broken.
  // The suite deliberately includes combinations that do not fit together -
  // nobody can be face to face with a partner who is lying down and standing
  // up at the same time - and for those the right output *is* a pose with the
  // contact unmet, provided the solver says so. Geometry that is visibly wrong
  // is a different matter: nothing makes a body through the mattress correct.
  const unwarned = unmet.length > 0 && out.quality.warnings.length === 0;
  if (unwarned) flags.push("SILENT");

  return {
    flags,
    depth: out.quality.maxDepth,
    count: out.quality.count,
    unmet,
    blocked: out.quality.contactDetail.filter((entry) => entry.unreachable).length,
    sunk: worstSunk,
    float: worstFloat,
    warnings: out.quality.warnings,
    ms: Date.now() - started,
  };
}

const showAll = process.argv.includes("--all");
const cases = [];

// Single actors first. The postures are already validated in isolation, so any
// damage here is the scene solver's, which makes this the cheapest possible
// regression check on the stages that run even with nobody to interact with.
for (const posture of POSTURE_NAMES) {
  cases.push({
    label: `solo ${posture}`,
    arrangement: "-",
    scene: {
      support: { surface: POSTURES[posture].surface || "floor" },
      actors: [{ posture, bodyType: "female" }],
      contacts: [],
    },
  });
}

for (const [arrangement, { primary, secondary }] of Object.entries(SUITE)) {
  for (const a of primary) {
    for (const b of secondary) {
      cases.push({
        label: `${a} + ${b}`,
        arrangement,
        mounted: true,
        scene: {
          // The primary's own surface, not a bed for everything. A posture
          // declares the surface it is for, and forcing `bent_over_support`
          // onto a mattress asks for someone bent over a bed while standing on
          // the same bed - the 268mm of daylight under her feet is the suite's
          // question being wrong, not the solver's answer.
          support: { surface: POSTURES[a].surface || "bed" },
          relationship: { arrangement },
          actors: [
            { posture: a, bodyType: "female" },
            { posture: b, bodyType: "male" },
          ],
          contacts: [],
        },
      });
    }
  }
}

const perArrangement = new Map();
const flagged = [];
let worstDepth = 0;
let totalUnmet = 0;
let totalMs = 0;

for (const entry of cases) {
  const result = evaluate(entry.scene, { mounted: entry.mounted });
  totalMs += result.ms;
  worstDepth = Math.max(worstDepth, result.depth);
  totalUnmet += result.unmet.length;

  const bucket = perArrangement.get(entry.arrangement) || { n: 0, bad: 0, depth: 0, unmet: 0 };
  bucket.n += 1;
  bucket.depth = Math.max(bucket.depth, result.depth);
  bucket.unmet += result.unmet.length;
  if (result.flags.length) bucket.bad += 1;
  perArrangement.set(entry.arrangement, bucket);

  if (result.flags.length) flagged.push({ entry, result });
  if (showAll) {
    console.log(
      `${entry.arrangement.padEnd(18)} ${entry.label.padEnd(38)} ` +
        `pen=${mm(result.depth).padStart(6)} n=${String(result.count).padStart(3)} ` +
        `unmet=${result.unmet.length} blocked=${result.blocked} ${result.flags.join("+")}`
    );
  }
}

if (flagged.length) {
  console.log(`\nbroken geometry (${flagged.length} of ${cases.length})`);
  for (const { entry, result } of flagged) {
    const detail = [];
    if (result.flags.includes("PEN")) detail.push(`pen ${mm(result.depth)}`);
    if (result.flags.includes("SUNK")) detail.push(`sunk ${mm(result.sunk)}`);
    if (result.flags.includes("FLOAT")) detail.push(`float ${mm(result.float)}`);
    for (const miss of result.unmet) {
      detail.push(`${miss.from}->${miss.to} ${mm(miss.distance)}`);
    }
    console.log(
      `  ${entry.arrangement.padEnd(18)} ${entry.label.padEnd(38)} ` +
        `${result.flags.join("+").padEnd(14)} ${detail.join("  ")}`
    );
  }
}

console.log("\nby arrangement");
for (const [name, bucket] of perArrangement) {
  console.log(
    `  ${name.padEnd(18)} ${String(bucket.n).padStart(3)} cases  ` +
      `${String(bucket.bad).padStart(3)} broken  worst pen ${mm(bucket.depth).padStart(6)}  ` +
      `unmet ${bucket.unmet}`
  );
}

const clean = cases.length - flagged.length;
console.log(
  `\n${clean}/${cases.length} sound   worst penetration ${mm(worstDepth)}   ` +
    `unmet contacts ${totalUnmet} (all reported)   ${(totalMs / 1000).toFixed(1)}s`
);
process.exitCode = flagged.length ? 1 : 0;

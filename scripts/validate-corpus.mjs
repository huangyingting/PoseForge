/**
 * Reference corpus cross-check.
 *
 * The pose library was written against a corpus of 1283 annotated photographs
 * in a sibling checkout, and the whole point of that corpus is that nobody
 * chose its contents to suit this renderer. Every other validator in here
 * sweeps combinations *this project* thought of; this one sweeps the ones a
 * set of photographs happened to contain, which is the only breadth measure
 * that cannot be gamed by adding the case to the list.
 *
 * It reports two different things and they should not be confused:
 *
 *   - **Coverage.** Of the names the corpus uses, how many does the vocabulary
 *     read at all? A name that reads as nothing becomes a standing figure on
 *     the floor, and the user is told so, but the pose is gone.
 *   - **Geometry.** Of the scenes it can build, how many come out sound? This
 *     is the same measure `validate-scenes.mjs` applies, over a different and
 *     much less friendly set of scenes.
 *
 * Limb phrases are counted three ways rather than two, because "read" is not
 * the interesting number for them: `knees_bent` reads perfectly and means "as
 * the posture has it". What matters is how many carry a shape the renderer can
 * act on, and that is reported separately as `shape`.
 *
 * Run with `node scripts/validate-corpus.mjs`, `--limit N` to sample, `--all`
 * to list every scene rather than the flagged ones. The corpus is optional: if
 * the sibling checkout is not there, this says so and exits cleanly, because a
 * clone of this repository alone must still be able to run its own checks.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readArmsName, readLegsName } from "../src/core/limbPose.js";
import { readArrangementName, readPostureName, readSurfaceName } from "../src/core/vocabulary.js";
import { validateScene } from "../src/core/scene.js";
import { solveScene } from "../src/core/solver.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const CORPUS = path.resolve(here, "../../SexPoses/annotated-pose-dataset/annotations.jsonl");

const args = process.argv.slice(2);
const showAll = args.includes("--all");
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;

if (!fs.existsSync(CORPUS)) {
  console.log(`reference corpus not found at ${CORPUS}`);
  console.log("nothing to cross-check; this validator is optional and the rest still apply.");
  process.exit(0);
}

/** Same tolerances as the scene validator, so the two numbers are comparable. */
const LIMITS = { penetration: 0.022, sunk: 0.012 };

const mm = (value) => `${(value * 1000).toFixed(0)}mm`;
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

/** One counter per field, so a coverage gap can be pinned to the field it is in. */
function counter() {
  return { total: 0, read: 0, shape: 0, missed: new Map() };
}

function count(bin, value, reading) {
  bin.total += 1;
  if (reading == null) bin.missed.set(value, (bin.missed.get(value) ?? 0) + 1);
  else {
    bin.read += 1;
    if (reading !== "defer") bin.shape += 1;
  }
}

const bins = {
  posture: counter(),
  arrangement: counter(),
  surface: counter(),
  arms: counter(),
  legs: counter(),
};

const records = [];
for (const line of fs.readFileSync(CORPUS, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const annotation = JSON.parse(line).visual_annotation;
  if (annotation) records.push(annotation);
  if (records.length >= limit) break;
}

/** A corpus annotation, as close to a scene as the names alone can get. */
function toScene(annotation) {
  const people = annotation.participants ?? [];
  const actors = people.slice(0, 2).map((person, index) => ({
    id: person.id || `p${index}`,
    posture: person.posture,
    bodyType: person.gender === "male" || person.gender === "female" ? person.gender : "neutral",
    // The corpus lists several phrases per limb where the annotator hedged.
    // They are passed through whole; the reader takes the last one it can make
    // a shape of, which is the same rule a person reading the list would use.
    ...(person.arms?.length ? { arms: person.arms } : {}),
    ...(person.legs?.length ? { legs: person.legs } : {}),
  }));
  return {
    title: annotation.image_id,
    support: { surface: annotation.relationship?.support_surface },
    relationship: { arrangement: annotation.relationship?.arrangement },
    actors: actors.length ? actors : [{ posture: "standing" }],
  };
}

let built = 0;
let sound = 0;
const problems = [];

for (const annotation of records) {
  for (const person of annotation.participants ?? []) {
    if (person.posture) count(bins.posture, person.posture, readPostureName(person.posture));
    for (const phrase of person.arms ?? []) count(bins.arms, phrase, readArmsName(phrase));
    for (const phrase of person.legs ?? []) count(bins.legs, phrase, readLegsName(phrase));
  }
  const arrangement = annotation.relationship?.arrangement;
  if (arrangement) {
    // A solo or group reading is a correct read of a name with no pairing in
    // it, so it counts as covered even though it yields no arrangement.
    const read = readArrangementName(arrangement);
    count(bins.arrangement, arrangement, read ? read.id ?? "defer" : null);
  }
  const surface = annotation.relationship?.support_surface;
  if (surface) count(bins.surface, surface, readSurfaceName(surface));

  // Geometry, for the two-person scenes. A single figure exercises the posture
  // and limb layers but none of the arrangement or contact solving, and the
  // posture validator already covers it far more precisely.
  if ((annotation.participants ?? []).length !== 2) continue;
  const { scene } = validateScene(toScene(annotation));
  built += 1;
  let out;
  try {
    out = solveScene(scene);
  } catch (error) {
    problems.push({ id: annotation.image_id, flags: ["THREW"], note: error.message });
    continue;
  }
  let worstSunk = 0;
  for (const actor of out.actors) {
    for (const volume of actor.volumes) {
      const low = Math.min(volume.a[1] - volume.ra, volume.b[1] - volume.rb) - out.surface.ground;
      if (low < -worstSunk) worstSunk = -low;
    }
  }
  const flags = [];
  if (out.quality.maxDepth > LIMITS.penetration) flags.push("PEN");
  if (worstSunk > LIMITS.sunk) flags.push("SUNK");
  if (!flags.length) sound += 1;
  if (flags.length || showAll) {
    problems.push({
      id: annotation.image_id,
      flags,
      note: `${scene.actors.map((a) => a.posture).join(" + ")} · ${scene.relationship.arrangement ?? "solo"} on ${scene.support.surface} · pen ${mm(out.quality.maxDepth)} sunk ${mm(worstSunk)}`,
    });
  }
}

console.log(`corpus: ${records.length} annotations from ${path.relative(process.cwd(), CORPUS)}\n`);
console.log("name coverage");
for (const [field, bin] of Object.entries(bins)) {
  const isLimb = field === "arms" || field === "legs";
  const detail = isLimb
    ? `read ${pct(bin.read, bin.total)}   carries a shape ${pct(bin.shape, bin.total)}`
    : `read ${pct(bin.read, bin.total)}`;
  console.log(`  ${field.padEnd(12)} ${String(bin.total).padStart(5)} uses   ${detail}`);
  const worst = [...bin.missed].sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [name, n] of worst) console.log(`      unread ${String(n).padStart(4)}x ${name}`);
}

if (problems.length) {
  console.log(`\n${showAll ? "scenes" : "flagged scenes"}`);
  for (const problem of problems.slice(0, showAll ? Infinity : 30)) {
    console.log(`  ${problem.flags.join(",").padEnd(6)} ${problem.id}  ${problem.note}`);
  }
  if (!showAll && problems.length > 30) console.log(`  ... and ${problems.length - 30} more`);
}

console.log(`\n${sound}/${built} two-person scenes sound`);

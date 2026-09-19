/**
 * Text layer validator.
 *
 * Runs a corpus of descriptions through the parser and the solver and checks
 * two separate things:
 *
 *   - did the parser read the sentence the way a person would? That is checked
 *     against an expectation written next to each description, because there is
 *     no way to derive it - only a human knows that "he kneels behind her"
 *     makes her the fixed point.
 *   - does the scene it produced actually stand up? That is checked against the
 *     geometry, the same way `validate-scenes.mjs` does.
 *
 * Both matter and neither implies the other. A parse can be perfect and the
 * resulting pose still be a body through a mattress, and a pose can be
 * geometrically immaculate while being of the wrong two people.
 *
 * Run with `node scripts/validate-text.mjs`, or `--all` to list every case.
 */

import { parseDescription } from "../src/nlp/parser.js";
import { ARCHETYPES } from "../src/nlp/archetypes.js";
import { solveScene } from "../src/core/solver.js";

/**
 * `expect` names only what the description genuinely pins down. Leaving a field
 * out means "any answer is defensible here", which keeps the suite from
 * ossifying around one arbitrary choice of default.
 */
const CASES = [
  {
    text: "she is lying on her back on the bed, he is kneeling between her legs",
    expect: { postures: ["supine", "kneeling"], arrangement: "over_supine", surface: "bed" },
  },
  {
    text: "he kneels behind her while she is on all fours, hands on her hips",
    expect: {
      postures: ["all_fours", "kneeling"],
      arrangement: "rear_alignment",
      contacts: ["1.hand.left->0.hip", "1.hand.right->0.hip"],
    },
  },
  {
    text: "missionary on the bed",
    expect: { postures: ["supine", "forearms_and_knees"], arrangement: "over_supine", surface: "bed" },
  },
  {
    // 180 is a half turn away from `straddle_supine`'s own default of 0, not an
    // absolute heading. The number is only meaningful next to the arrangement
    // it modifies, which is the point of pinning it here.
    text: "reverse cowgirl",
    expect: { postures: ["supine", "kneeling_straddle"], arrangement: "straddle_supine", yaw: 180 },
  },
  {
    text: "cowgirl",
    expect: { postures: ["supine", "kneeling_straddle"], arrangement: "straddle_supine" },
  },
  {
    text: "standing, facing each other, her hands on his chest",
    expect: {
      postures: ["standing", "standing"],
      arrangement: "face_to_face",
      contacts: ["0.hand.left->1.chest", "0.hand.right->1.chest"],
    },
  },
  {
    text: "he is carrying her against the wall",
    expect: { postures: ["standing", "lifted"], arrangement: "supported_lift" },
  },
  {
    text: "a slim woman sitting on his lap, arms around his neck",
    expect: {
      postures: ["seated", "seated_straddle"],
      arrangement: "straddle_lap",
      builds: [null, 0.85],
      contacts: ["1.upperArm.left->0.neck", "1.upperArm.right->0.neck"],
    },
  },
  {
    text: "a tall man standing behind a short woman bent over the table",
    expect: {
      postures: ["bent_over_support", "standing"],
      arrangement: "rear_alignment",
      surface: "table",
      statures: [1.62, 1.85],
    },
  },
  {
    text: "she is tall and he is short, standing face to face",
    expect: { arrangement: "face_to_face", statures: [1.85, 1.62] },
  },
  {
    text: "spooning on the bed",
    expect: { postures: ["side_lying", "side_lying"], arrangement: "spooning", surface: "bed" },
  },
  {
    // Both on their sides with one behind the other is spooning, and naming it
    // that is a better reading than the bare "behind" it is built from.
    text: "both on their sides, he is behind her",
    expect: { postures: ["side_lying", "side_lying"], arrangement: "spooning" },
  },
  {
    text: "she is on her back with her legs over his shoulders",
    expect: { postures: ["supine_legs_raised", null], arrangement: "over_supine" },
  },
  {
    text: "her legs around his waist as he holds her up",
    expect: { postures: ["standing", "lifted"], arrangement: "supported_lift" },
  },
  {
    text: "sixty nine",
    expect: { arrangement: "head_to_toe", surface: "bed" },
  },
  {
    text: "a woman kneeling on the floor in front of a seated man",
    expect: { surface: "floor" },
  },
  // Chinese. The point of these is not breadth of vocabulary - it is that the
  // same matcher handles a language with no spaces without a separate path.
  {
    text: "她仰卧在床上，他跪在她身后",
    expect: { postures: ["supine", "kneeling"], arrangement: "rear_alignment", surface: "bed" },
  },
  {
    text: "他抱起她靠墙",
    expect: { postures: ["standing", "lifted"], arrangement: "supported_lift" },
  },
  {
    text: "女方跪趴，男方跪在后面",
    expect: { postures: ["all_fours", "kneeling"], arrangement: "rear_alignment" },
  },
  {
    text: "两人侧躺，面对面在床上",
    expect: { arrangement: "face_to_face", surface: "bed" },
  },
  // Things that should fail loudly rather than quietly.
  {
    text: "two people riding a hammock in zero gravity",
    expect: { warns: true },
  },
  {
    text: "",
    expect: { warns: true },
  },
];

// Every archetype is expected to produce its own arrangement from its own name.
for (const archetype of ARCHETYPES) {
  CASES.push({
    text: archetype.phrases[0],
    expect: { arrangement: archetype.arrangement, surface: archetype.surface },
    group: "archetype",
  });
}

const LIMITS = { penetration: 0.045, sunk: 0.012 };

const contactKey = (c) => `${c.fromActor}.${c.from}->${c.toActor}.${c.to}`;

function checkParse(result, expect) {
  const problems = [];
  const { scene } = result;
  if (expect.postures) {
    expect.postures.forEach((want, index) => {
      if (want == null) return;
      const got = scene.actors[index]?.posture;
      if (got !== want) problems.push(`actor${index} posture ${got} != ${want}`);
    });
  }
  if (expect.arrangement && scene.relationship.arrangement !== expect.arrangement) {
    problems.push(`arrangement ${scene.relationship.arrangement} != ${expect.arrangement}`);
  }
  if (expect.yaw != null && scene.relationship.yaw !== expect.yaw) {
    problems.push(`yaw ${scene.relationship.yaw} != ${expect.yaw}`);
  }
  if (expect.surface && scene.support.surface !== expect.surface) {
    problems.push(`surface ${scene.support.surface} != ${expect.surface}`);
  }
  if (expect.statures) {
    expect.statures.forEach((want, index) => {
      if (want == null) return;
      const got = scene.actors[index]?.stature;
      if (got !== want) problems.push(`actor${index} stature ${got} != ${want}`);
    });
  }
  if (expect.builds) {
    expect.builds.forEach((want, index) => {
      if (want == null) return;
      const got = scene.actors[index]?.build;
      if (Math.abs((got ?? 1) - want) > 1e-6) problems.push(`actor${index} build ${got} != ${want}`);
    });
  }
  if (expect.contacts) {
    const got = new Set(scene.contacts.map(contactKey));
    for (const want of expect.contacts) if (!got.has(want)) problems.push(`missing contact ${want}`);
  }
  if (expect.warns && result.warnings.length === 0) {
    problems.push("expected a warning, got none");
  }
  if (!expect.warns && result.warnings.length > 0) {
    problems.push(`unexpected warning: ${result.warnings[0]}`);
  }
  return problems;
}

function floorClearance(out) {
  let worst = 0;
  // `ground`, not `height`: on a table the feet belong on the floor half a
  // metre below the top the trunk is resting on.
  const floor = out.surface?.ground ?? 0;
  for (const actor of out.actors) {
    for (const volume of actor.volumes) {
      const low = Math.min(volume.a[1] - volume.ra, volume.b[1] - volume.rb);
      worst = Math.max(worst, floor - low);
    }
  }
  return worst;
}

const showAll = process.argv.includes("--all");
let brokenParse = 0;
let brokenPose = 0;
const rows = [];

for (const testCase of CASES) {
  const parsed = parseDescription(testCase.text);
  const parseProblems = checkParse(parsed, testCase.expect);
  let poseProblems = [];
  let depth = 0;
  let sunk = 0;
  if (!testCase.expect.warns) {
    const out = solveScene(parsed.scene);
    depth = out.quality.maxDepth;
    sunk = floorClearance(out);
    if (depth > LIMITS.penetration) poseProblems.push(`pen ${(depth * 1000).toFixed(0)}mm`);
    if (sunk > LIMITS.sunk) poseProblems.push(`sunk ${(sunk * 1000).toFixed(0)}mm`);
    const unmet = out.quality.contactDetail.filter((c) => !c.unreachable && c.distance > 0.06);
    if (unmet.length && out.quality.warnings.length === 0) poseProblems.push("SILENT");
  }
  if (parseProblems.length) brokenParse += 1;
  if (poseProblems.length) brokenPose += 1;
  rows.push({ testCase, parseProblems, poseProblems, depth, sunk });
}

for (const row of rows) {
  const bad = row.parseProblems.length || row.poseProblems.length;
  if (!bad && !showAll) continue;
  const label = row.testCase.text || "(empty)";
  console.log(`${bad ? "x" : " "} ${label.slice(0, 58).padEnd(58)} ` +
    `${(row.depth * 1000).toFixed(0).padStart(3)}mm`);
  for (const problem of row.parseProblems) console.log(`    parse: ${problem}`);
  for (const problem of row.poseProblems) console.log(`    pose:  ${problem}`);
}

const total = CASES.length;
console.log(
  `\n${total - brokenParse}/${total} parsed as expected, ` +
    `${total - brokenPose}/${total} geometrically sound`
);
process.exitCode = brokenParse || brokenPose ? 1 : 0;

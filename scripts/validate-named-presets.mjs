/** Report the inherited definitions' quality; schema validity alone is not success. */
import { NAMED_PRESETS, checkScene } from "../src/core/catalog.js";
import { solveScene } from "../src/core/solver.js";
import { solvedPreview } from "../src/core/posePreview.js";

let flagged = 0;
for (const preset of NAMED_PRESETS) {
  const solved = solveScene(checkScene(preset.scene));
  const { issues } = solvedPreview(solved);
  if (issues.length) flagged++;
  console.log(
    JSON.stringify({
      id: preset.id,
      issues,
      overlapMm: Math.round(solved.quality.maxDepth * 1000),
      propOverlapMm: Math.round(solved.quality.propPenetration * 1000),
      unmetContacts: solved.quality.unmetContacts,
      supportGapMm: solved.actors.map((actor) =>
        Math.round((actor.seatResidual ?? 0) * 1000),
      ),
    }),
  );
}
console.log(
  `${NAMED_PRESETS.length - flagged}/${NAMED_PRESETS.length} named presets have no base-model quality flags; ${flagged} require review.`,
);
process.exitCode = flagged ? 1 : 0;

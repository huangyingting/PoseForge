/** Report the inherited definitions' quality; schema validity alone is not success. */
import { readFileSync } from "node:fs";
import { NAMED_PRESETS, checkScene } from "../src/core/catalog.js";
import { solveScene } from "../src/core/solver.js";
import { solvedPreview } from "../src/core/posePreview.js";
import { buildHumanTemplate, featureRelief } from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";
import { withHair } from "../src/core/hair.js";
import { refineSurfaceContacts } from "../src/core/surfaceContacts.js";

const rendered = process.argv.includes("--rendered");
const presetOption = process.argv.indexOf("--preset");
const requested = presetOption < 0 ? null : process.argv[presetOption + 1];
if (presetOption >= 0 && (!requested || requested.startsWith("--")))
  throw new Error("--preset needs a built-in named preset ID.");
const presets = requested
  ? NAMED_PRESETS.filter((preset) => preset.id === requested)
  : NAMED_PRESETS;
if (!presets.length) throw new Error(`Unknown named preset: ${requested}`);
const raw = new Map(),
  dressed = new Map();
function template(actor) {
  const { bodyType, build, bust, wearing, outfit, hair } = actor.spec;
  const type = bodyType === "male" ? "male" : "female";
  if (!raw.has(type))
    raw.set(
      type,
      buildHumanTemplate(
        readFileSync(
          new URL(`../assets/models/realistic-${type}.glb`, import.meta.url),
        ),
      ),
    );
  const key = JSON.stringify([bodyType, build, bust, wearing, outfit, hair]);
  if (!dressed.has(key)) {
    const body = featureRelief(raw.get(type), {
      bodyType,
      build: build ?? 1,
      bust,
    });
    dressed.set(
      key,
      withHair(withGarments(body, { bodyType, wearing, colour: outfit }), {
        bodyType,
        style: hair,
      }),
    );
  }
  return dressed.get(key);
}

function report(solved) {
  return {
    issues: solvedPreview(solved).issues,
    overlapMm: Math.round(solved.quality.maxDepth * 1000),
    propOverlapMm: Math.round(solved.quality.propPenetration * 1000),
    unmetContacts: solved.quality.unmetContacts,
    ...(solved.quality.figureSurfaces
      ? {
          intersectingFigures: solved.quality.figureSurfaces
            .filter((pair) => pair.intersects === true)
            .map((pair) => [pair.fromActor, pair.toActor]),
          unavailableFigureChecks: solved.quality.figureSurfaces.filter(
            (pair) => pair.intersects === null,
          ).length,
        }
      : {}),
    supportGapMm: solved.actors.map((actor) =>
      Math.round((actor.seatResidual ?? 0) * 1000),
    ),
  };
}

let flagged = 0;
for (const preset of presets) {
  const solved = solveScene(checkScene(preset.scene));
  const baseModel = report(solved);
  if (rendered) refineSurfaceContacts(solved, solved.actors.map(template));
  const result = report(solved);
  if (result.issues.length) flagged++;
  console.log(
    JSON.stringify({
      id: preset.id,
      ...result,
      ...(rendered
        ? {
            baseModel,
            contacts: solved.quality.contactDetail.map((contact) => ({
              from: `${contact.fromActor}:${contact.from}.${contact.fromSide ?? ""}`,
              to: `${contact.toActor}:${contact.to}.${contact.toSide ?? ""}`,
              basis: contact.basis,
              targetMm:
                contact.targetDistance == null
                  ? null
                  : Math.round(contact.targetDistance * 1000),
              surfaceMm:
                contact.surfaceGap == null
                  ? null
                  : Math.round(contact.surfaceGap * 1000),
              intersects: contact.intersects,
              reason: contact.reason,
            })),
          }
        : {}),
    }),
  );
}
console.log(
  `${presets.length - flagged}/${presets.length} named presets have no ${rendered ? "rendered-contact" : "base-model"} quality flags; ${flagged} require review.`,
);
process.exitCode = flagged ? 1 : 0;

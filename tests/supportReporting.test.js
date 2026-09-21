import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_PRESETS, checkScene } from "../src/core/catalog.js";
import { resolveLandmark } from "../src/core/landmarks.js";
import { supportPlaneFor } from "../src/core/poseLibrary.js";
import { solveScene } from "../src/core/solver.js";
import { solvedPreview } from "../src/core/posePreview.js";

function supportGap(actor, surface) {
  return Math.max(
    0,
    ...actor.posture.supports.map((support) => {
      const bones = resolveLandmark(support.landmark, support.side).bones;
      const volumes = actor.volumes.filter((volume) =>
        bones.includes(volume.bone),
      );
      assert.ok(volumes.length, "fixture must have geometry for every support");
      const bottom = Math.min(
        ...volumes.flatMap((volume) => [
          volume.a[1] - volume.ra,
          volume.b[1] - volume.rb,
        ]),
      );
      return Math.abs(bottom - supportPlaneFor(support, surface));
    }),
  );
}

test("all catalog support readouts describe the returned rig and each support's own plane", () => {
  for (const preset of BUILTIN_PRESETS) {
    const solved = solveScene(checkScene(preset.scene));
    for (const actor of solved.actors) {
      if (actor.carried || actor.mountedOn != null) {
        assert.equal(actor.supportBasis, "partner", preset.id);
        assert.equal(actor.seatResidual, null, preset.id);
      } else if (actor.posture.supports.length) {
        assert.equal(actor.supportBasis, "surface", preset.id);
        const gap = supportGap(actor, solved.surface),
          expected = gap > 0.002 ? gap : 0;
        assert.ok(
          Math.abs(actor.seatResidual - expected) < 1e-9,
          `${preset.id}: ${actor.seatResidual} != ${expected}`,
        );
      } else {
        assert.equal(actor.supportBasis, "none", preset.id);
        assert.equal(actor.seatResidual, null, preset.id);
      }
    }
  }
});

test("guided lying-pair feedback follows final support geometry rather than the last clamp amount", () => {
  // Keep this procedural regression independent of calibrated catalog data.
  const solved = solveScene(checkScene({
    actors: [
      { bodyType: "female", posture: "side_lying", wearing: ["top", "shorts"] },
      { bodyType: "male", posture: "side_lying", wearing: ["top", "shorts"] },
    ],
    support: { surface: "bed" },
    relationship: { arrangement: "face_to_face" },
    contacts: [],
  }));
  assert.equal(solved.actors[1].spec.jointMode, "guided");
  const gaps = solved.actors.map((actor) => supportGap(actor, solved.surface));
  assert.equal(
    solvedPreview(solved).issues.includes("Support gap"),
    gaps.some((gap) => gap > 0.02),
  );
});

test("partner support is not mislabeled as a surface gap or as zero-distance surface contact", () => {
  const preset = BUILTIN_PRESETS.find(
    (entry) => entry.id === "builtin.named.sixty_nine",
  );
  const solved = solveScene(checkScene(preset.scene));
  assert.equal(solved.actors[1].carried, true);
  assert.equal(solved.actors[1].supportBasis, "partner");
  assert.equal(solved.actors[1].seatResidual, null);
  assert.ok(
    solved.quality.unmetContacts > 0,
    "unmet partner contacts must remain visible",
  );
  assert.ok(solvedPreview(solved).issues.includes("Unresolved contacts"));
});

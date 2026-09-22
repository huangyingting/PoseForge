import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_PRESETS, checkScene } from "../src/core/catalog.js";
import { resolveLandmark } from "../src/core/landmarks.js";
import { supportPlaneFor } from "../src/core/poseLibrary.js";
import { solveScene, measureSceneSafety } from "../src/core/solver.js";
import { captureSolvedPose } from "../src/core/placement.js";
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
  const solved = solveScene(
    checkScene({
      actors: [
        {
          bodyType: "female",
          posture: "side_lying",
          wearing: ["top", "shorts"],
        },
        { bodyType: "male", posture: "side_lying", wearing: ["top", "shorts"] },
      ],
      support: { surface: "bed" },
      relationship: { arrangement: "face_to_face" },
      contacts: [],
    }),
  );
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
  // Exercise an intentionally unresolved fixed variation, rather than requiring
  // the bundled head-to-toe recipe to keep its old contact defect forever.
  const scene = checkScene(preset.scene);
  for (const actor of scene.actors) {
    actor.jointMode = "fixed";
    actor.placement.mode = "fixed";
  }
  scene.actors[1].placement.position[0] += 2;
  const solved = solveScene(scene);
  assert.equal(solved.actors[1].carried, true);
  assert.equal(solved.actors[1].supportBasis, "partner");
  assert.equal(solved.actors[1].seatResidual, null);
  assert.deepEqual(
    solved.actors[1].pose.root.position,
    scene.actors[1].placement.position,
  );
  assert.ok(
    solved.quality.unmetContacts > 0,
    "unmet partner contacts must remain visible",
  );
  assert.ok(solvedPreview(solved).issues.includes("Unresolved contacts"));
});

test("seated balance includes the real chair or bench top alongside the floor", () => {
  for (const surface of ["chair", "bench"]) {
    const scene = checkScene({
      actors: [
        { bodyType: "male", posture: "seated", wearing: ["top", "shorts"] },
      ],
      support: { surface },
    });
    const solved = solveScene(scene),
      before = structuredClone(solved.actors[0].pose);
    assert.deepEqual(
      solved.quality.balance[0],
      {
        actor: "actor0",
        supported: true,
        offset: 0,
        note: null,
      },
      surface,
    );
    assert.equal(solved.actors[0].supportBasis, "surface");
    assert.equal(solved.actors[0].seatResidual, 0);
    assert.deepEqual(
      measureSceneSafety(solved).balance,
      solved.quality.balance,
    );
    assert.deepEqual(
      solved.actors[0].pose,
      before,
      "measuring balance must not move the rig",
    );
  }
});

test("a seat does not support figures floating above it, buried below it or outside its footprint", () => {
  const source = checkScene({
    actors: [
      { bodyType: "male", posture: "seated", wearing: ["top", "shorts"] },
    ],
    support: { surface: "chair" },
  });
  const captured = captureSolvedPose(solveScene(source).actors[0]);
  for (const [axis, distance, note] of [
    [1, 0.2, "no measured surface support"],
    [1, -3, "no measured surface support"],
    [0, 1, null],
  ]) {
    const scene = structuredClone(source);
    Object.assign(scene.actors[0], structuredClone(captured));
    scene.actors[0].placement.position[axis] += distance;
    const solved = solveScene(scene),
      balance = solved.quality.balance[0];
    assert.equal(balance.supported, false, `${axis}:${distance}`);
    assert.equal(balance.note, note);
    if (axis === 0)
      assert.ok(
        balance.offset > 0.05,
        "floor contact cannot replace the missing seat",
      );
    else assert.equal(balance.offset, null);
    assert.deepEqual(
      measureSceneSafety(solved).balance,
      solved.quality.balance,
    );
  }
});

test("expected partner support is distinguished from an unmeasured surface without certifying balance", () => {
  const solved = solveScene(
    checkScene({
      actors: [
        { bodyType: "male", posture: "seated", wearing: ["top", "shorts"] },
        {
          bodyType: "female",
          posture: "seated_straddle",
          wearing: ["top", "shorts"],
          placement: { position: [0, 2, 0], rotation: [0, 180, 0] },
        },
      ],
      support: { surface: "chair" },
      relationship: { arrangement: "straddle_lap" },
    }),
  );
  assert.equal(solved.actors[1].supportBasis, "partner");
  assert.deepEqual(solved.quality.balance[1], {
    actor: solved.actors[1].id,
    supported: false,
    offset: null,
    note: "supported by partner",
  });
});

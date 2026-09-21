import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  NAMED_PRESETS,
  checkScene,
  serializeCatalog,
  parseCatalog,
} from "../src/core/catalog.js";
import { createActor, refresh, solveScene } from "../src/core/solver.js";
import {
  isFixedPlacement,
  checkPlacement,
  rootFromPlacement,
  captureSolvedPose,
} from "../src/core/placement.js";
import { buildHumanTemplate, featureRelief } from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";
import { withHair } from "../src/core/hair.js";
import {
  refineSurfaceContacts,
  surfaceContactSteps,
  createSurfaceContactQuery,
} from "../src/core/surfaceContacts.js";
import { solvedPreview } from "../src/core/posePreview.js";

const preset = () =>
  structuredClone(
    NAMED_PRESETS.find((p) => p.id === "builtin.named.chair_straddle"),
  );
const cache = new Map();
function template(actor) {
  const spec = actor.spec,
    key = JSON.stringify([
      spec.bodyType,
      spec.build,
      spec.bust,
      spec.wearing,
      spec.outfit,
      spec.hair,
    ]);
  if (!cache.has(key))
    cache.set(
      key,
      withHair(
        withGarments(
          featureRelief(
            buildHumanTemplate(
              readFileSync(
                new URL(
                  `../assets/models/realistic-${spec.bodyType}.glb`,
                  import.meta.url,
                ),
              ),
            ),
            spec,
          ),
          {
            bodyType: spec.bodyType,
            wearing: spec.wearing,
            colour: spec.outfit,
          },
        ),
        { bodyType: spec.bodyType, style: spec.hair },
      ),
    );
  return cache.get(key);
}
function prepare(scene = preset().scene) {
  const solved = solveScene(checkScene(scene));
  return { solved, bodies: solved.actors.map(template) };
}
const poses = (s) => structuredClone(s.actors.map((a) => a.pose));

test("guided placement is portable while omitted mode keeps fixed legacy semantics", () => {
  const placement = { position: [0.2, 1, -0.1], rotation: [0, 30, 0] };
  assert.equal(isFixedPlacement(placement), true);
  assert.equal(isFixedPlacement({ ...placement, mode: "fixed" }), true);
  assert.equal(isFixedPlacement({ ...placement, mode: "guided" }), false);
  assert.deepEqual(checkPlacement({ ...placement, mode: "guided" }), {
    ...placement,
    mode: "guided",
  });
  for (const mode of [null, "automatic", "unknown", false])
    assert.throws(() => checkPlacement({ ...placement, mode }));
  const actor = createActor(
    {
      posture: "standing",
      mobility: 0.7,
      placement: { ...placement, mode: "guided" },
    },
    0,
  );
  assert.deepEqual(actor.pose.root, rootFromPlacement(placement));
  actor.pose.root.position[0] += 0.3;
  refresh(actor);
  assert.equal(actor.pose.root.position[0], 0.5);
  assert.equal(actor.mobility, 0.7);
  actor.spec.placement.mode = "fixed";
  refresh(actor);
  assert.deepEqual(actor.pose.root, rootFromPlacement(placement));
  assert.equal(actor.mobility, 0);
  actor.spec.placement.mode = "guided";
  refresh(actor);
  assert.equal(actor.mobility, 0.7);
  const item = preset();
  assert.deepEqual(parseCatalog(serializeCatalog([item])), [item]);
});

test("the guided stock pose passes coarse solving and is adopted only after complete rendered verification", () => {
  const scene = preset().scene,
    original = structuredClone(scene),
    { solved, bodies } = prepare(scene);
  assert.deepEqual(solvedPreview(solved).issues, []);
  const before = poses(solved);
  refineSurfaceContacts(solved, bodies);
  assert.deepEqual(solvedPreview(solved).issues, []);
  assert.notDeepEqual(poses(solved), before);
  assert.equal(solved.quality.surfaceRefinement.guidedPoseSteps, 1);
  assert.equal(solved.quality.surfaceRefinement.steps, 1);
  assert.ok(
    solved.quality.adjustments.some((note) =>
      note.includes("guided starting pose"),
    ),
  );
  assert.ok(
    solved.quality.contactDetail.every(
      (c) => c.basis === "rendered" && !c.intersects && c.surfaceGap <= 0.004,
    ),
  );
  assert.ok(solved.quality.figureSurfaces.every((p) => p.intersects === false));
  assert.ok(solved.quality.propSurfaces.every((p) => p.intersects === false));
  assert.ok(solved.quality.floorSurfaces.every((p) => p.penetration === 0));
  assert.ok(solved.actors[0].seatResidual <= 0.004);
  assert.equal(solved.actors[1].seatResidual, null);
  assert.deepEqual(scene, original);
});

test("unmet hinted contacts reject the proposal without changing the completed coarse pose", () => {
  const scene = preset().scene;
  scene.actors[1].placement.position[0] += 2;
  const { solved, bodies } = prepare(scene),
    before = poses(solved);
  refineSurfaceContacts(solved, bodies, { maxSteps: 1 });
  assert.deepEqual(poses(solved), before);
  assert.equal(solved.quality.surfaceRefinement.guidedPoseSteps, 1);
  assert.ok(
    !solved.quality.adjustments.some((note) =>
      note.includes("guided starting pose"),
    ),
  );
});

test("missing or incomplete geometry cannot certify a guided whole-layout proposal", () => {
  for (const missing of ["one", "all"]) {
    const { solved, bodies } = prepare(),
      before = poses(solved);
    refineSurfaceContacts(
      solved,
      missing === "all" ? [null, null] : [bodies[0], null],
      { maxSteps: 1 },
    );
    assert.deepEqual(poses(solved), before);
    assert.ok(
      solvedPreview(solved).issues.includes("Surface check unavailable"),
    );
    assert.ok(
      !solved.quality.adjustments.some((note) =>
        note.includes("guided starting pose"),
      ),
    );
  }
});

test("a fixed companion and zero mobility remain authoritative during guided proposals", () => {
  const scene = preset().scene;
  delete scene.actors[1].placement.mode;
  scene.actors[1].jointMode = "fixed";
  const { solved, bodies } = prepare(scene),
    fixed = structuredClone(solved.actors[1].pose);
  refineSurfaceContacts(solved, bodies, { maxSteps: 1 });
  assert.deepEqual(solved.actors[1].pose, fixed);
  const zero = prepare(),
    before = poses(zero.solved);
  zero.solved.actors.forEach((actor) => {
    actor.mobility = 0;
  });
  refineSurfaceContacts(zero.solved, zero.bodies, {
    maxSteps: 1,
    maxPasses: 0,
    maxBodySteps: 0,
    maxSeatingSteps: 0,
    maxKneelingSteps: 0,
    maxForearmSteps: 0,
    maxLevelSeatingSteps: 0,
  });
  assert.deepEqual(poses(zero.solved), before);
  assert.equal(zero.solved.quality.surfaceRefinement.guidedPoseSteps, 0);
});

test("a new complete obstacle blocks a guided pose even when its contacts and supports fit", () => {
  const { solved, bodies } = prepare(),
    query = createSurfaceContactQuery(solved.actors, bodies);
  const obstacle = {
    kind: "guide obstacle",
    center: [0, 0.49, 0.1],
    size: [0.26, 0.06, 0.26],
  };
  obstacle.box = {
    min: obstacle.center.map((n, i) => n - obstacle.size[i] / 2),
    max: obstacle.center.map((n, i) => n + obstacle.size[i] / 2),
  };
  assert.equal(query.prop(0, obstacle).intersects, false);
  solved.props.push(obstacle);
  const before = poses(solved);
  refineSurfaceContacts(solved, bodies, { maxSteps: 1 });
  assert.deepEqual(poses(solved), before);
  assert.ok(
    !solved.quality.adjustments.some((note) =>
      note.includes("guided starting pose"),
    ),
  );
});

test("guided-pose budgets and cancellation do not publish or retain a tentative pose", () => {
  for (const options of [
    { maxSteps: 0 },
    {
      maxGuidedPoseSteps: 0,
      maxPasses: 0,
      maxBodySteps: 0,
      maxSeatingSteps: 0,
      maxKneelingSteps: 0,
      maxForearmSteps: 0,
      maxLevelSeatingSteps: 0,
    },
  ]) {
    const { solved, bodies } = prepare(),
      before = poses(solved);
    refineSurfaceContacts(solved, bodies, options);
    assert.deepEqual(poses(solved), before);
    assert.equal(solved.quality.surfaceRefinement.guidedPoseSteps, 0);
  }
  const { solved, bodies } = prepare(),
    before = poses(solved),
    quality = structuredClone(solved.quality);
  const iterator = surfaceContactSteps(solved, bodies);
  assert.equal(iterator.next().done, false);
  const proposal = iterator.next();
  assert.equal(proposal.done, false);
  assert.equal(proposal.value.guidedPoseSteps, 1);
  assert.notDeepEqual(poses(solved), before);
  iterator.return();
  assert.deepEqual(poses(solved), before);
  assert.deepEqual(solved.quality, quality);
});

test("capturing an accepted guide freezes an ordinary pose without losing rendered clearance", () => {
  const scene = preset().scene,
    { solved, bodies } = prepare(scene);
  refineSurfaceContacts(solved, bodies);
  const before = solved.actors.map((actor) =>
    actor.evaluated.positions.map((p) => p.slice()),
  );
  scene.actors.forEach((actor, i) =>
    Object.assign(actor, captureSolvedPose(solved.actors[i])),
  );
  assert.ok(
    scene.actors.every(
      (actor) =>
        isFixedPlacement(actor.placement) && actor.jointMode === "fixed",
    ),
  );
  const restored = solveScene(checkScene(JSON.parse(JSON.stringify(scene))));
  refineSurfaceContacts(restored, bodies);
  assert.deepEqual(solvedPreview(restored).issues, []);
  assert.equal(restored.quality.surfaceRefinement.guidedPoseSteps, 0);
  restored.actors.forEach((actor, i) =>
    actor.evaluated.positions.forEach((p, j) =>
      p.forEach((n, k) => assert.ok(Math.abs(n - before[i][j][k]) < 1e-7)),
    ),
  );
});

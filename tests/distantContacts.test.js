import assert from "node:assert/strict";
import test from "node:test";
import { checkScene } from "../src/core/catalog.js";
import {
  measureContactTargets,
  refresh,
  solveScene,
} from "../src/core/solver.js";
import { solvedPreview } from "../src/core/posePreview.js";

// This authored, clothed side-lying pose exposed a retreat beyond one stature
// during correction. Its contacts must remain constraints, however far away.
function distantScene(pinned = false) {
  const scene = {
    support: { surface: "bed" },
    relationship: { arrangement: "face_to_face" },
    actors: ["female", "male"].map((bodyType) => ({
      bodyType,
      posture: "side_lying",
      wearing: ["top", "shorts"],
    })),
    contacts: [],
  };
  scene.actors.forEach((actor, index) => {
    const under = index === 0 ? "r" : "l",
      over = index === 0 ? "l" : "r";
    if (pinned) actor.mobility = 0;
    actor.joints = {
      [`shoulder_${under}`]: { flexion: 120, abduction: -10 },
      [`elbow_${under}`]: { flexion: 135 },
      [`shoulder_${over}`]: { flexion: 0, abduction: -10, rotation: -75 },
      [`elbow_${over}`]: { flexion: 90 },
      hip_l: { flexion: 0, abduction: 0 },
      hip_r: { flexion: 0, abduction: 0 },
      knee_l: { flexion: 8 },
      knee_r: { flexion: 8 },
    };
  });
  return checkScene(scene);
}

test("declared body contact measurements remain available beyond collision-search range", () => {
  const scene = distantScene(),
    before = structuredClone(scene);
  const solved = solveScene(scene, { iterations: 0 });
  assert.equal(solved.contacts.length, 2);
  assert.equal(solved.quality.contactDetail.length, 2);
  const measured = measureContactTargets(solved);
  assert.ok(measured.every(Number.isFinite));
  solved.quality.contactDetail.forEach((report, index) =>
    assert.equal(report.distance, measured[index]),
  );
  assert.equal(solved.quality.unmetContacts, 2);
  assert.ok(solvedPreview(solved).issues.includes("Unresolved contacts"));
  assert.deepEqual(scene, before);
  solved.actors[1].pose.root.position[0] += 3;
  refresh(solved.actors[1]);
  const poses = structuredClone(solved.actors.map((actor) => actor.pose));
  const distant = measureContactTargets(solved);
  assert.ok(
    distant.every((value) => Number.isFinite(value) && value > 1.7),
    `${distant}`,
  );
  assert.deepEqual(
    solved.actors.map((actor) => actor.pose),
    poses,
    "measurement must not move the rigs",
  );
});

test("pinned figures keep their placement and report unresolved body contacts", () => {
  const scene = distantScene(true),
    initial = solveScene(scene, { iterations: 0 });
  const solved = solveScene(scene);
  assert.equal(solved.quality.contactDetail.length, solved.contacts.length);
  assert.equal(solved.quality.unmetContacts, 2);
  assert.ok(
    solved.quality.contactDetail.every(
      (contact) => Number.isFinite(contact.distance) && contact.distance > 0.06,
    ),
  );
  solved.actors.forEach((actor, i) => {
    for (const axis of [0, 2])
      assert.ok(
        Math.abs(
          actor.pose.root.position[axis] -
            initial.actors[i].pose.root.position[axis],
        ) < 1e-8,
      );
  });
});

test("a mobile pair can approach a distant target instead of declaring an empty success", () => {
  const scene = distantScene(),
    initial = solveScene(scene, { iterations: 0 });
  const solved = solveScene(scene);
  assert.equal(solved.quality.contactDetail.length, 2);
  assert.ok(
    solved.quality.contactDetail.every((contact) =>
      Number.isFinite(contact.distance),
    ),
  );
  assert.ok(
    Math.max(...measureContactTargets(solved)) <
      Math.max(...measureContactTargets(initial)) - 0.1,
  );
  assert.ok(solved.quality.convergence.length > 1);
});

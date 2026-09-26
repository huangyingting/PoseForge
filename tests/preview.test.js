import test from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_PRESETS, checkScene } from "../src/core/catalog.js";
import { solveScene } from "../src/core/solver.js";
import {
  previewKey,
  solvedPreview,
  projectPreview,
} from "../src/core/posePreview.js";
import { createPreviewService } from "../src/app/previewService.js";

const scene = () => structuredClone(BUILTIN_PRESETS[0].scene);
const preview = (basis = "base") =>
  solvedPreview(solveScene(checkScene(scene())), basis);

test("all catalog scenes produce finite shared-space previews with bounded projected geometry", () => {
  for (const preset of BUILTIN_PRESETS) {
    const solved = solveScene(checkScene(preset.scene));
    const data = solvedPreview(solved),
      result = projectPreview(data);
    assert.equal(data.actors.length, preset.scene.actors.length);
    result.actors.forEach((actor) => {
      for (const p of [...Object.values(actor.points), actor.head]) {
        assert.ok(p.every(Number.isFinite), preset.id);
        assert.ok(
          p[0] >= 8 && p[0] <= 152 && p[1] >= 12 && p[1] <= 116,
          `${preset.id}: ${p}`,
        );
      }
    });
    assert.deepEqual(
      data.actors[0].points.pelvis,
      solved.actors[0].evaluated.positions[0].map(
        (n) => Math.round(n * 10000) / 10000,
      ),
    );
  }
});

test("pose, arrangement, relative height and facing survive projection; failures are not called clean", () => {
  const spec = scene();
  spec.actors[0].stature = 1.4;
  spec.actors[1].stature = 2.1;
  const data = solvedPreview(solveScene(checkScene(spec)));
  const layout = projectPreview(data);
  assert.notDeepEqual(
    layout.actors[0].points.pelvis,
    layout.actors[1].points.pelvis,
  );
  const heights = layout.actors.map((a) =>
    Math.hypot(a.head[0] - a.points.pelvis[0], a.head[1] - a.points.pelvis[1]),
  );
  assert.ok(heights[1] > heights[0] * 1.25);
  const forward = BUILTIN_PRESETS.find((p) => p.id === "builtin.named.cowgirl");
  const reverse = BUILTIN_PRESETS.find(
    (p) => p.id === "builtin.named.reverse_cowgirl",
  );
  assert.notDeepEqual(
    solvedPreview(solveScene(checkScene(forward.scene))).actors[1].face,
    solvedPreview(solveScene(checkScene(reverse.scene))).actors[1].face,
  );
  // Use a deliberately impossible fixed-figure target, not a catalog defect
  // that should eventually be repaired by the placement solver.
  const impossible = scene();
  impossible.actors.forEach((actor) => {
    actor.posture = "standing";
    actor.mobility = 0;
  });
  impossible.relationship = {
    arrangement: "side_by_side",
    contactMode: "custom",
  };
  impossible.contacts = [
    { from: "head", to: "foot.l", fromActor: 0, toActor: 1, strength: 1 },
  ];
  const notes = solvedPreview(solveScene(checkScene(impossible))).issues;
  assert.ok(notes.includes("Unresolved contacts"));
});

test("preview keys ignore labels/camera/metadata, normalize defaults and still distinguish pose changes", () => {
  const a = scene(),
    b = checkScene(a);
  b.title = "New title";
  b.description = "Different text";
  b.camera = { view: "side" };
  b.actors[0].label = "New name";
  assert.equal(previewKey(a), previewKey(b));
  b.actors[0].stature = 1.9;
  assert.notEqual(previewKey(a), previewKey(b));
});

test("catalog quality distinguishes whole-figure crossings and unavailable surface checks", () => {
  const solved = solveScene(checkScene(scene()));
  solved.quality.figureSurfaces = [
    { fromActor: 0, toActor: 1, intersects: true },
  ];
  assert.ok(solvedPreview(solved).issues.includes("Surface overlap"));
  solved.quality.figureSurfaces[0].intersects = null;
  assert.ok(solvedPreview(solved).issues.includes("Surface check unavailable"));
  assert.ok(!solvedPreview(solved).issues.includes("Surface overlap"));
  solved.quality.figureSurfaces[0].intersects = false;
  assert.ok(
    !solvedPreview(solved).issues.includes("Surface check unavailable"),
  );
});

function worker() {
  return {
    sent: [],
    terminated: false,
    postMessage(message) {
      this.sent.push(message);
    },
    terminate() {
      this.terminated = true;
    },
    reply(request, data) {
      this.onmessage({ data: { ...request, ...data } });
    },
  };
}
test("preview queue drops stale subscriptions and a late base result cannot replace a refined preview", () => {
  const w = worker(),
    service = createPreviewService({ workerFactory: () => w });
  try {
    const results = [],
      first = scene(),
      other = scene();
    other.actors[0].stature = 1.9;
    const stop = service.subscribe(first, (result) => results.push(result));
    const orphan = service.subscribe(other, () =>
      assert.fail("unsubscribed callback fired"),
    );
    orphan();
    assert.equal(w.sent.length, 1);
    service.remember(first, preview("refined"));
    w.reply(w.sent[0], { preview: preview() });
    assert.equal(results.length, 1);
    assert.equal(results[0].preview.basis, "refined");
    assert.equal(w.sent.length, 1);
    stop();
  } finally {
    service.dispose();
  }
  assert.equal(w.terminated, true);
});

test("worker failure is contained and live viewport previews still work afterward", () => {
  const w = worker(),
    service = createPreviewService({ workerFactory: () => w }),
    results = [];
  try {
    service.subscribe(scene(), (result) => results.push(result));
    w.onerror({ preventDefault() {} });
    assert.equal(results.at(-1).error, true);
    service.remember(scene(), preview("refined"));
    assert.equal(results.at(-1).preview.basis, "refined");
  } finally {
    service.dispose();
  }
});

test("cache eviction cannot let an in-flight base solve downgrade its final pose", () => {
  const w = worker(),
    service = createPreviewService({ workerFactory: () => w, capacity: 1 }),
    results = [];
  try {
    const first = scene(),
      other = scene();
    other.actors[0].stature = 1.9;
    service.subscribe(first, (result) => results.push(result));
    service.remember(first, preview("refined"));
    service.remember(other, preview("refined"));
    w.reply(w.sent[0], { preview: preview() });
    assert.equal(results.length, 1);
    assert.equal(results[0].preview.basis, "refined");
  } finally {
    service.dispose();
  }
});

test("a hung or crashed preview worker costs one scene, not the library", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const workers = [],
    service = createPreviewService({
      workerFactory: () => {
        workers.push(worker());
        return workers.at(-1);
      },
      timeout: 10,
    }),
    hung = scene(),
    next = scene(),
    results = { hung: [], next: [] };
  next.actors[0].stature = 1.9;
  try {
    service.subscribe(hung, (result) => results.hung.push(result));
    service.subscribe(next, (result) => results.next.push(result));
    assert.equal(workers[0].sent.length, 1);
    t.mock.timers.tick(10);
    assert.equal(workers[0].terminated, true);
    assert.deepEqual(results.hung, [{ error: true }]);
    assert.deepEqual(results.next, []);
    // The replacement takes the rest of the queue.
    assert.equal(workers.length, 2);
    assert.equal(workers[1].sent.length, 1);
    workers[1].reply(workers[1].sent[0], { preview: preview() });
    assert.equal(results.next.at(-1).preview.basis, "base");
    // A late answer from the terminated worker is ignored.
    workers[0].reply(workers[0].sent[0], { preview: preview() });
    assert.deepEqual(results.hung, [{ error: true }]);
    // The scene that hung is not re-queued every time its card reappears.
    const again = [];
    service.subscribe(hung, (result) => again.push(result));
    assert.deepEqual(again, [{ error: true }]);
    assert.equal(workers[1].sent.length, 1);
  } finally {
    service.dispose();
  }
});

test("a preview worker that keeps crashing turns previews off", () => {
  const workers = [],
    service = createPreviewService({
      workerFactory: () => {
        workers.push(worker());
        return workers.at(-1);
      },
      maxRestarts: 2,
    }),
    results = [];
  try {
    const scenes = [1.5, 1.6, 1.7, 1.8, 1.9].map((stature) => {
      const value = scene();
      value.actors[0].stature = stature;
      return value;
    });
    scenes.forEach((value, index) =>
      service.subscribe(value, (result) => results.push([index, result])),
    );
    for (let i = 0; i < 3; i++) workers.at(-1).onerror({ preventDefault() {} });
    assert.equal(workers.length, 3);
    assert.ok(workers.every((w) => w.terminated));
    // Every scene still waiting is told, once, and nothing else is posted.
    assert.deepEqual(
      results.map(([index, result]) => [index, result.error]),
      [0, 1, 2, 3, 4].map((index) => [index, true]),
    );
    const late = [];
    service.subscribe(scene(), (result) => late.push(result));
    assert.deepEqual(late, [{ error: true }]);
  } finally {
    service.dispose();
  }
});

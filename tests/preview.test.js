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
  const notes = solvedPreview(
    solveScene(
      checkScene(
        BUILTIN_PRESETS.find((p) => p.id === "builtin.named.chair_straddle")
          .scene,
      ),
    ),
  ).issues;
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

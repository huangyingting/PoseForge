import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  artisticJointSignature,
  checkArtisticStudies,
  artisticPreset,
} from "../src/core/artisticStudies.js";
import { createPositionService } from "../src/app/positionService.js";
import { buildArtisticStudies } from "../scripts/build-artistic-studies.mjs";
import { serializeCatalog, parseCatalog } from "../src/core/catalog.js";
import { solveScene } from "../src/core/solver.js";
import { volumesBounds } from "../src/core/body.js";
import { POSEABLE_BONES, CHANNELS } from "../src/core/skeleton.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const indexBytes = read("public/catalog/sexposes-v1.json");
const entries = JSON.parse(indexBytes).entries;
const bytes = read("public/catalog/artistic-studies-v1.json");
const manifest = JSON.parse(read("src/data/artistic-manifest.json"));
const pack = JSON.parse(bytes);
const studies = checkArtisticStudies(pack, manifest, entries);
const hash = (v) => createHash("sha256").update(v).digest("hex");

test("1283 ready-to-view artistic compositions reconcile every source and all 2567 participants", () => {
  assert.equal(bytes.length, manifest.bytes);
  assert.equal(hash(bytes), manifest.sha256);
  assert.equal(studies.size, 1283);
  assert.equal(
    new Set(pack.studies.map((p) => artisticJointSignature(p.scene))).size,
    1283,
  );
  assert.equal(
    pack.studies.reduce((n, p) => n + p.scene.actors.length, 0),
    2567,
  );
  for (const entry of entries) {
    const preset = artisticPreset(entry, studies);
    assert.equal(preset.source.annotationHash, entry.annotationHash);
    assert.equal(preset.scene.actors.length, entry.figures);
    assert.ok(preset.description.includes("Artistic interpretation"));
    const restored = parseCatalog(serializeCatalog([preset]))[0];
    assert.equal(restored.status, undefined);
    assert.deepEqual(restored.scene, preset.scene);
  }
});

test("cosmetic, placement, actor-order and numerical-noise changes do not inflate geometry counts", () => {
  const scene = structuredClone(pack.studies[0].scene),
    signature = artisticJointSignature(scene);
  scene.title = "A new name";
  scene.camera.view = "front";
  scene.actors.reverse();
  for (const a of scene.actors) {
    a.outfit = "clay";
    a.bodyType = "male";
    a.placement.position[0] += 1;
    a.joints.head.rotation = 20;
  }
  assert.equal(artisticJointSignature(scene), signature);
  const bad = structuredClone(pack);
  const pair = bad.studies.findIndex(
    (p, i) => i > 0 && p.scene.actors.length === scene.actors.length,
  );
  bad.studies[pair].scene = scene;
  assert.throws(
    () => checkArtisticStudies(bad, manifest, entries),
    /distinct joint geometry/,
  );
});

test("every baked study remains finite, clothed and separate through the existing solver", () => {
  let maxPenetration = 0,
    maxSupportGap = 0,
    flagged = 0;
  for (const p of pack.studies) {
    const result = solveScene(p.scene);
    const bounds = result.actors
      .map((a, i) => {
        assert.ok(a.evaluated.positions.flat().every(Number.isFinite));
        assert.deepEqual(
          a.pose.root.position,
          p.scene.actors[i].placement.position,
        );
        assert.equal(a.supportBasis, "surface");
        assert.ok(
          a.spec.wearing.includes("top") && a.spec.wearing.includes("shorts"),
        );
        maxSupportGap = Math.max(maxSupportGap, a.seatResidual ?? 0);
        return volumesBounds(a.volumes);
      })
      .sort((a, b) => a.min[0] - b.min[0]);
    for (let i = 1; i < bounds.length; i++)
      assert.ok(bounds[i].min[0] - bounds[i - 1].max[0] >= 0.599, p.sourceId);
    for (const b of bounds) assert.ok(b.min[1] >= 0.0039, p.sourceId);
    maxPenetration = Math.max(maxPenetration, result.quality.maxDepth);
    if (
      result.quality.maxDepth > 0.022 ||
      result.actors.some((a) => (a.seatResidual ?? 0) > 0.04)
    )
      flagged++;
    assert.equal(result.quality.unmetContacts, 0);
  }
  console.log(
    JSON.stringify({
      artisticCoarseDiagnostics: { maxPenetration, maxSupportGap, flagged },
    }),
  );
});

test("distinct compositions differ by substantial joint angles even after optimal actor matching", () => {
  const vectors = [],
    lookup = new Map();
  const compositions = pack.studies.map((p) =>
    p.scene.actors.map((a) => {
      const v = POSEABLE_BONES.filter(
        ({ name }) => !["head", "neck"].includes(name),
      ).flatMap(({ name }) => CHANNELS.map((c) => a.joints[name][c]));
      const key = JSON.stringify(v);
      if (!lookup.has(key)) {
        lookup.set(key, vectors.length);
        vectors.push(v);
      }
      return lookup.get(key);
    }),
  );
  const distances = vectors.map((a) =>
    vectors.map((b) => Math.max(...a.map((n, i) => Math.abs(n - b[i])))),
  );
  const permutations = (values) =>
    values.length < 2
      ? [values]
      : values.flatMap((v, i) =>
          permutations(values.filter((_, j) => i !== j)).map((p) => [v, ...p]),
        );
  let minimum = Infinity;
  for (let i = 0; i < compositions.length; i++)
    for (let j = 0; j < i; j++) {
      const a = compositions[i],
        b = compositions[j];
      if (a.length !== b.length) continue;
      const distance = Math.min(
        ...permutations(b).map((order) =>
          Math.max(...a.map((v, k) => distances[v][order[k]])),
        ),
      );
      minimum = Math.min(minimum, distance);
    }
  assert.ok(
    minimum >= 19.9,
    `Minimum joint difference is only ${minimum} degrees.`,
  );
  console.log(
    JSON.stringify({
      artisticUniqueness: {
        individualJointVectors: vectors.length,
        minimumCompositionDifferenceDegrees: minimum,
      },
    }),
  );
});

test("malformed, incomplete, unclothed, stale or duplicate artistic records reject the entire pack", () => {
  for (const mutate of [
    (p) => p.studies.pop(),
    (p) => {
      p.studies[0].sourceId = "unknown";
    },
    (p) => {
      p.studies[0].annotationHash = "0".repeat(64);
    },
    (p) => {
      p.studies[0].scene.actors[0].wearing = [];
    },
    (p) => {
      p.studies[0].scene.actors.pop();
    },
    (p) => {
      p.studies[0].scene.relationship.contactMode = "automatic";
    },
    (p) => {
      p.studies[0].motifs = [];
    },
  ]) {
    const copy = structuredClone(pack);
    mutate(copy);
    assert.throws(() => checkArtisticStudies(copy, manifest, entries));
  }
});

test("artistic scenes load automatically through a shared lazy retryable verified service", async () => {
  const requests = [];
  let fail = true;
  const service = createPositionService({
    base: "/app/",
    digest: hash,
    fetcher: async (url) => {
      requests.push(url);
      if (url.endsWith("artistic-studies-v1.json")) {
        if (fail) {
          fail = false;
          return new Response("retry", { status: 503 });
        }
        return new Response(bytes);
      }
      if (url.endsWith("sexposes-v1.json")) return new Response(indexBytes);
      throw new Error("The legacy approximation pack must not be needed.");
    },
  });
  assert.equal(requests.length, 0);
  await assert.rejects(service.variant(entries[0], "artistic"), /503/);
  const [a, b] = await Promise.all([
    service.variant(entries[0], "artistic"),
    service.variant(entries[1], "artistic"),
  ]);
  assert.ok(a.tags.includes("artistic"));
  assert.notEqual(a.source.recordId, b.source.recordId);
  assert.equal(requests.length, 3);
  a.scene.actors[0].joints.head.rotation = 999;
  assert.notEqual(
    (await service.variant(entries[0], "artistic")).scene.actors[0].joints.head.rotation,
    999,
  );
});

test("the committed content rebuilds deterministically without source imagery or sibling data", () => {
  const approximate = new Map(
    JSON.parse(read("public/catalog/generated-studies-v1.json")).scenes.map(
      (p) => [p.key, p.scene],
    ),
  );
  const result = buildArtisticStudies(entries, approximate);
  assert.equal(result.data, bytes.toString());
  assert.deepEqual(result.manifest, manifest);
});

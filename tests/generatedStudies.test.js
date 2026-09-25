import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  checkGeneratedStudies,
  generatedPosition,
  GENERATED_STUDY_NOTES,
} from "../src/core/generatedStudies.js";
import { checkSourceCatalog } from "../src/core/sourceCatalog.js";
import {
  createPositionService,
  sourceManifest as manifest,
} from "../src/app/positionService.js";
import { createGeneratedStudyBuilder } from "../scripts/generated-posture-scenes.mjs";
import {
  checkScene,
  parseCatalog,
  serializeCatalog,
} from "../src/core/catalog.js";
import { solveScene } from "../src/core/solver.js";

const indexBytes = readFileSync(
  new URL("../public/catalog/sexposes-v1.json", import.meta.url),
);
const previewBytes = readFileSync(
  new URL("../public/catalog/generated-studies-v1.json", import.meta.url),
);
const entries = checkSourceCatalog(JSON.parse(indexBytes), manifest);
const pack = JSON.parse(previewBytes);
const scenes = checkGeneratedStudies(pack, manifest.generated, entries);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("all 1283 sources map to complete generated studies without dropping participants", () => {
  assert.equal(hash(previewBytes), manifest.generated.sha256);
  assert.equal(previewBytes.length, manifest.generated.bytes);
  assert.equal(scenes.size, 203);
  let figures = 0;
  for (const entry of entries) {
    const preset = generatedPosition(entry, scenes);
    const restored = parseCatalog(serializeCatalog([preset]))[0];
    assert.equal(restored.scene.actors.length, entry.figures);
    assert.equal(restored.source.recordId, entry.sourceId);
    assert.equal(restored.status, undefined);
    assert.ok(preset.inputWarnings.length >= 3);
    assert.ok(preset.description.includes("Participants are separate"));
    assert.equal(
      preset.scene.description,
      "",
      "diagnostic prose must not become a parser command",
    );
    assert.deepEqual(restored.scene, checkScene(preset.scene));
    figures += preset.scene.actors.length;
  }
  assert.equal(figures, 2567);
});

test("every distinct preview has finite complete rigs and separated figures with preserved fixed placement", () => {
  for (const [key, scene] of scenes) {
    const result = solveScene(scene);
    const boxes = result.actors.map((actor, i) => {
      assert.ok(actor.evaluated.positions.flat().every(Number.isFinite), key);
      assert.deepEqual(
        actor.pose.root.position,
        scene.actors[i].placement.position,
        key,
      );
      assert.equal(actor.spec.jointMode, "fixed");
      assert.ok(
        actor.spec.wearing.includes("top") &&
          actor.spec.wearing.includes("shorts"),
      );
      return {
        min: Math.min(
          ...actor.volumes.flatMap((v) => [v.a[0] - v.ra, v.b[0] - v.rb]),
        ),
        max: Math.max(
          ...actor.volumes.flatMap((v) => [v.a[0] + v.ra, v.b[0] + v.rb]),
        ),
      };
    });
    for (let i = 1; i < boxes.length; i++)
      assert.ok(boxes[i].min - boxes[i - 1].max >= 0.49, key);
    assert.equal(result.quality.unmetContacts, 0);
    assert.equal(scene.contacts.length, 0);
  }
});

test("generation is deterministic, includes all figures and reports deferred or unavailable annotation detail", () => {
  const build = createGeneratedStudyBuilder();
  const annotation = {
    image_id: "example",
    participants: [
      { gender: "female", posture: "standing", arms: ["arms_overhead"] },
      { gender: "male", posture: "kneeling", arms: ["unread_hint"] },
      { gender: "unspecified", posture: "supine", legs: ["knees_bent"] },
    ],
    relationship: { contacts: ["not-copied"], arrangement: "not-copied" },
  };
  const result = build(annotation);
  assert.deepEqual(result, build(annotation));
  assert.equal(result.scene.actors.length, 3);
  assert.ok(result.notes.includes("unspecified-body-type"));
  assert.ok(result.notes.includes("unread-limb-detail"));
  assert.ok(
    result.notes.every((code) => Object.hasOwn(GENERATED_STUDY_NOTES, code)),
  );
  assert.ok(!JSON.stringify(result).includes("not-copied"));
  assert.throws(
    () =>
      build({ ...annotation, participants: [{ posture: "not_a_posture" }] }),
    /No posture mapping/,
  );
});

test("preview validation rejects missing mappings, invented keys, wrong counts, clothing removal and automatic contacts", () => {
  for (const mutate of [
    (p) => p.scenes.pop(),
    (p) => {
      p.scenes[1].key = p.scenes[0].key;
    },
    (p) => {
      p.scenes[0].scene.actors[0].wearing = [];
    },
    (p) => {
      p.scenes[0].scene.relationship.contactMode = "automatic";
    },
    (p) => {
      p.scenes[0].scene.actors[0].jointMode = "guided";
    },
  ]) {
    const copy = structuredClone(pack);
    mutate(copy);
    assert.throws(() =>
      checkGeneratedStudies(copy, manifest.generated, entries),
    );
  }
  assert.throws(
    () =>
      checkGeneratedStudies(pack, manifest.generated, [
        { ...entries[0], generatedKey: "0".repeat(64) },
      ]),
    /missing/,
  );
  const first = generatedPosition(entries[0], scenes);
  first.scene.actors[0].joints.hip_l.flexion = 999;
  assert.notEqual(
    generatedPosition(entries[0], scenes).scene.actors[0].joints.hip_l.flexion,
    999,
  );
});

test("shared preview service loads only on demand, retries and retains independent source identity", async () => {
  const requests = [];
  let fail = true;
  const service = createPositionService({
    base: "/app/",
    digest: hash,
    fetcher: async (url) => {
      requests.push(url);
      if (url.endsWith("generated-studies-v1.json")) {
        if (fail) {
          fail = false;
          return new Response("unavailable", { status: 503 });
        }
        return new Response(previewBytes);
      }
      return new Response(indexBytes);
    },
  });
  assert.equal(requests.length, 0);
  const list = await service.sources();
  assert.equal(requests.length, 1);
  await assert.rejects(service.variant(list[0], "generated"), /503/);
  const [a, b] = await Promise.all([
    service.variant(list[0], "generated"),
    service.variant(list[1], "generated"),
  ]);
  assert.equal(requests.length, 3);
  assert.notEqual(a.source.recordId, b.source.recordId);
  assert.equal((await service.source(list[0].sourceId)).sourceId, list[0].sourceId);
  await assert.rejects(service.source("missing"), /not found/);
  assert.ok(requests.every((url) => url.startsWith("/app/catalog/")));
});

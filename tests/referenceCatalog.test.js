import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildReferenceCatalog } from "../scripts/build-reference-catalog.mjs";
import {
  checkReferences,
  queryReferences,
  catalogPage,
} from "../src/core/referenceCatalog.js";
import {
  createReferenceLoader,
  referenceManifest as manifest,
} from "../src/app/referenceLoader.js";
import {
  BUILTIN_PRESETS,
  checkPreset,
  serializeCatalog,
  parseCatalog,
  searchCatalog,
} from "../src/core/catalog.js";

const bytes = readFileSync(
  new URL("../public/catalog/sexposes-v1.json", import.meta.url),
);
const pack = JSON.parse(bytes);
const hash = (data) => createHash("sha256").update(data).digest("hex");
const row = (id = "img-0001") => ({
  image_id: id,
  source_sha256: "1".repeat(64),
  normalized_sha256: "2".repeat(64),
  image_path: "/private/not-for-export.png",
  visual_annotation: {
    image_id: id,
    description_en: "private caption",
    participants: [
      { id: "a", gender: "female", posture: "standing", arms: ["relaxed"] },
    ],
    relationship: {
      support_surface: "floor",
      contacts: ["private-contact-label"],
    },
  },
});

test("committed reference snapshot reconciles all counts, hashes and allowlisted fields", () => {
  const entries = checkReferences(pack, manifest);
  assert.equal(entries.length, 1283);
  assert.equal(hash(bytes), manifest.dataSha256);
  assert.equal(bytes.length, manifest.bytes);
  assert.deepEqual(manifest.figures, { 1: 12, 2: 1258, 3: 13 });
  assert.equal(manifest.variants, 379);
  assert.equal(Object.keys(manifest.families).length, 22);
  assert.equal(
    entries.every((e) => e.status === "reference-only"),
    true,
  );
  assert.equal(Object.isFrozen(entries[0]), true);
});

test("offline importer preserves source identity and deterministic groups without publishing raw material", () => {
  const first = row(),
    second = row("img-0002");
  const text = [first, second].map(JSON.stringify).join("\n");
  const output = buildReferenceCatalog(text);
  assert.equal(output.manifest.records, 2);
  assert.equal(output.manifest.variants, 1);
  assert.equal(output.manifest.uniqueImages, 1);
  assert.equal(
    output.data,
    buildReferenceCatalog([second, first].map(JSON.stringify).join("\n")).data,
  );
  assert.equal(output.data, buildReferenceCatalog(text).data);
  assert.ok(!/private|image_path|description_en|contacts/.test(output.data));
  second.visual_annotation.participants[0].arms = ["raised"];
  const changed = buildReferenceCatalog(
    [first, second].map(JSON.stringify).join("\n"),
  );
  assert.equal(changed.manifest.variants, 2);
  assert.equal(changed.entries[1].id, output.entries[1].id);
});

test("malformed inputs and duplicate IDs fail the whole reference import", () => {
  assert.throws(() => buildReferenceCatalog(""), /No reference/);
  assert.throws(() => buildReferenceCatalog("{"));
  assert.throws(
    () => buildReferenceCatalog([row(), row()].map(JSON.stringify).join("\n")),
    /Duplicate/,
  );
  for (const mutate of [
    (r) => {
      r.visual_annotation = null;
    },
    (r) => {
      r.visual_annotation.image_id = "https://private.example/?token=secret";
    },
    (r) => {
      r.visual_annotation.participants = [];
    },
    (r) => {
      r.source_sha256 = "missing";
    },
    (r) => {
      r.visual_annotation.participants[0].posture = null;
    },
  ]) {
    const r = row();
    mutate(r);
    assert.throws(() => buildReferenceCatalog(JSON.stringify(r)));
  }
});

test("all pages expose every reference exactly once and clamp invalid page requests", () => {
  const ids = [];
  for (let i = 0; i < Math.ceil(pack.entries.length / 24); i++) {
    const page = catalogPage(pack.entries, i);
    assert.ok(page.entries.length <= 24);
    ids.push(...page.entries.map((e) => e.id));
  }
  assert.deepEqual(
    ids,
    pack.entries.map((e) => e.id),
  );
  assert.equal(catalogPage(pack.entries, 999).page, 53);
  assert.equal(catalogPage(pack.entries, -2).page, 0);
  assert.equal(catalogPage([], NaN).pages, 1);
  assert.throws(() => catalogPage([], 0, 0));
});

test("source search, family, status and annotation grouping compose without claiming unique positions", () => {
  assert.equal(queryReferences(pack.entries, { query: "IMG-0001" }).length, 1);
  for (const [family, count] of Object.entries(manifest.families))
    assert.equal(queryReferences(pack.entries, { family }).length, count);
  assert.equal(
    queryReferences(pack.entries, { group: true }).length,
    manifest.variants,
  );
  assert.equal(
    queryReferences(pack.entries, { group: true }).reduce(
      (n, e) => n + e.members.length,
      0,
    ),
    1283,
  );
  assert.equal(
    queryReferences(pack.entries, { status: "verified-3d" }).length,
    0,
  );
  assert.equal(
    queryReferences(pack.entries, { status: "needs-adjustment" }).length,
    0,
  );
  assert.ok(
    queryReferences(pack.entries, { query: "2 figures floor" }).every(
      (e) => e.figures === 2 && e.surface === "Floor",
    ),
  );
});

test("metadata validation rejects count drift, duplicate IDs and forged support status", () => {
  for (const mutate of [
    (p) => p.entries.pop(),
    (p) => {
      p.entries[1] = p.entries[0];
    },
    (p) => {
      p.entries[0].status = "verified-3d";
    },
    (p) => {
      p.entries[0].url = "https://example.com";
    },
    (p) => {
      p.entries[0].postures[0] = "uncontrolled";
    },
  ]) {
    const p = structuredClone(pack);
    mutate(p);
    assert.throws(() => checkReferences(p, manifest));
  }
});

test("reference loader is lazy, shares requests, retries failure and verifies bytes", async () => {
  let requests = 0;
  const load = createReferenceLoader({
    base: "/nested/",
    fetcher: async (url) => {
      assert.equal(url, "/nested/catalog/sexposes-v1.json");
      requests++;
      if (requests === 1) return new Response("failed", { status: 503 });
      return new Response(bytes);
    },
    digest: hash,
  });
  assert.equal(requests, 0);
  await assert.rejects(load(), /503/);
  const [a, b] = await Promise.all([load(), load()]);
  assert.equal(requests, 2);
  assert.equal(a, b);
  assert.equal(a.length, 1283);
  for (const data of [
    bytes.subarray(0, -1),
    Buffer.concat([bytes, Buffer.from(" ")]),
    Buffer.from(bytes.toString().replace("img-0001", "img-0000")),
  ]) {
    const bad = createReferenceLoader({
      fetcher: async () => new Response(data),
      digest: hash,
    });
    await assert.rejects(bad(), /incomplete|size|integrity/);
  }
});

test("source metadata survives preset transfers but verification claims do not", () => {
  const source = {
    dataset: "SexPoses",
    recordId: pack.entries[0].sourceId,
    annotationHash: pack.entries[0].annotationHash,
  };
  const entry = { ...BUILTIN_PRESETS[1], source, status: "verified-3d" };
  const [restored] = parseCatalog(serializeCatalog([entry]));
  assert.deepEqual(restored.source, source);
  assert.equal(restored.status, undefined);
  assert.equal(searchCatalog([restored], { query: source.recordId }).length, 1);
  assert.throws(
    () =>
      checkPreset({
        ...entry,
        source: { ...source, annotationHash: "forged" },
      }),
    /source reference/,
  );
  assert.throws(
    () =>
      checkPreset({ ...entry, source: { ...source, recordId: ["img-0001"] } }),
    /source reference/,
  );
});

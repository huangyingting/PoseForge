import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { referencePreset } from "../src/core/referencePreviews.js";
import { parseCatalog, serializeCatalog } from "../src/core/catalog.js";
import { queryReferences } from "../src/core/referenceCatalog.js";
import {
  checkReferenceStudy,
  isReferenceStudy,
  parseReferenceStudies,
  prepareReferenceStudies,
  referenceStudyId,
  referenceStudyMatches,
  serializeReferenceStudies,
} from "../src/core/referenceStudies.js";
import { createLibrary } from "../src/app/libraryStore.js";
import { createPersistentLibrary } from "../src/app/persistentLibrary.js";

const entries = JSON.parse(
  readFileSync(new URL("../public/catalog/sexposes-v1.json", import.meta.url)),
).entries;
const scenes = new Map(
  JSON.parse(
    readFileSync(
      new URL("../public/catalog/reference-previews-v1.json", import.meta.url),
    ),
  ).scenes.map(({ key, scene }) => [key, scene]),
);
const preset = (entry = entries[0]) => referencePreset(entry, scenes);
function disk() {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
}
function database() {
  let data = null;
  return {
    fail: false,
    writes: 0,
    read: async () => data,
    async write(revision, text) {
      if (this.fail) throw new Error("quota");
      if ((data?.revision ?? null) !== revision) throw new Error("another tab");
      this.writes++;
      return (data = { revision: (revision ?? 0) + 1, text });
    },
    close() {},
  };
}

test("all 1283 source records support independent authored studies and a portable round trip", async () => {
  const db = database();
  const library = await createPersistentLibrary(disk(), { backend: db });
  const inputs = entries.map(preset);
  const result = await library.saveReferenceStudies(inputs, entries);
  assert.equal(result.written.length, 1283);
  assert.equal(result.skipped, 0);
  assert.equal(db.writes, 1, "one durable commit for the entire batch");
  const exported = serializeReferenceStudies(library.saved());
  const roundtrip = parseReferenceStudies(exported, entries);
  assert.equal(new Set(roundtrip.map((p) => p.id)).size, 1283);
  assert.equal(
    roundtrip.reduce((sum, p) => sum + p.scene.actors.length, 0),
    2567,
  );
  assert.ok(roundtrip.every((p, i) => referenceStudyMatches(p, entries[i])));
  assert.ok(
    roundtrip.every(
      (p) => p.status === undefined && p.scene.description === "",
    ),
  );
  const reloaded = await createPersistentLibrary(disk(), { backend: db });
  assert.equal(reloaded.saved().length, 1283);
  assert.deepEqual(
    reloaded.get(referenceStudyId(entries[0].sourceId)),
    roundtrip[0],
  );
});

test("keep-existing is default, explicit replacements are scoped and failed writes preserve the old study", async () => {
  const db = database();
  const library = await createPersistentLibrary(disk(), { backend: db });
  const first = preset(),
    second = preset(entries[1]);
  const { written } = await library.saveReferenceStudies(
    [first, second],
    entries,
  );
  await library.favorite(written[0].id);
  const edited = { ...first, title: "Independent edit" };
  edited.scene = structuredClone(first.scene);
  edited.scene.actors[0].joints.elbow_l.flexion = 90;
  const kept = await library.saveReferenceStudies([edited], entries);
  assert.equal(kept.skipped, 1);
  assert.equal(library.get(written[0].id).title, first.title);
  db.fail = true;
  await assert.rejects(
    library.saveReferenceStudies([edited], entries, { replace: true }),
    /quota/,
  );
  assert.equal(library.get(written[0].id).title, first.title);
  db.fail = false;
  await library.saveReferenceStudies([edited], entries, { replace: true });
  assert.equal(library.saved().length, 2);
  assert.equal(library.get(written[0].id).title, edited.title);
  assert.deepEqual(library.get(written[1].id), written[1]);
  assert.deepEqual(library.favorites(), [written[0].id]);
  await library.remove(written[0].id);
  assert.equal(library.get(written[0].id), undefined);
});

test("invalid records reject an entire batch without partial saves or silent participant loss", () => {
  const library = createLibrary(disk());
  library.saveReferenceStudies([preset()], entries);
  const before = library.raw();
  for (const mutate of [
    (p) => {
      p.source.recordId = "unknown";
    },
    (p) => {
      p.source.annotationHash = "0".repeat(64);
    },
    (p) => {
      delete p.source;
    },
    (p) => {
      p.scene.actors.pop();
    },
    (p) => {
      p.scene.actors[0].wearing = [];
    },
    (p) => {
      p.scene.actors[0].jointMode = "guided";
    },
    (p) => {
      delete p.scene.actors[0].joints.elbow_l;
    },
    (p) => {
      p.scene.actors[0].placement.mode = "guided";
    },
    (p) => {
      p.scene.relationship.contactMode = "automatic";
    },
    (p) => {
      p.scene.support.surface = "bed";
    },
    (p) => {
      p.scene.actors[1].placement.position[0] =
        p.scene.actors[0].placement.position[0];
    },
  ]) {
    const invalid = preset(entries[2]);
    mutate(invalid);
    assert.throws(() =>
      library.saveReferenceStudies([preset(entries[1]), invalid], entries, {
        replace: true,
      }),
    );
    assert.equal(library.raw(), before);
  }
  assert.throws(
    () => library.saveReferenceStudies([preset(), preset()], entries),
    /Duplicate/,
  );
  assert.throws(() => library.saveReferenceStudies([], entries), /Provide/);
  assert.equal(library.raw(), before);
});

test("reserved studies stay validated through general updates, storage reload and explicit source binding", () => {
  const storage = disk();
  const library = createLibrary(storage, () => "user.copy");
  const study = library.saveReferenceStudies([preset()], entries).written[0];
  const bad = structuredClone(study);
  bad.scene.actors[0].wearing = [];
  assert.throws(() => library.save(bad, study.id), /top and shorts/);
  const incomplete = structuredClone(study);
  incomplete.scene.actors.pop();
  assert.throws(() => library.save(incomplete, study.id), /figure count/);
  const stale = structuredClone(study);
  stale.source.annotationHash = "0".repeat(64);
  assert.throws(() => library.save(stale, study.id), /source fingerprint/);
  assert.equal(createLibrary(storage).error, "");
  const copy = library.save(study);
  assert.equal(isReferenceStudy(copy), false);
  assert.equal(referenceStudyMatches(copy, entries[0]), false);
  assert.equal(
    parseCatalog(serializeReferenceStudies(library.saved())).length,
    1,
  );
  const other = createLibrary(disk(), () => "user.imported");
  const imported = other.import(serializeCatalog([study]));
  assert.equal(isReferenceStudy(imported[0]), false);
  const bound = prepareReferenceStudies(imported, entries);
  assert.equal(bound[0].id, study.id);
  assert.equal(referenceStudyMatches(bound[0], entries[0]), true);
  assert.throws(
    () => checkReferenceStudy({ ...study, id: "user.unbound" }),
    /source-linked/,
  );
});

test("authored studies remain individually reachable when grouping matching annotations", () => {
  const counts = new Map();
  for (const e of entries)
    counts.set(e.variant, (counts.get(e.variant) ?? 0) + 1);
  const variant = [...counts].find(([, n]) => n > 2)[0];
  const same = entries.filter((e) => e.variant === variant);
  assert.ok(same.length > 1);
  const values = same.map((e, i) =>
    i < 2 ? { ...e, status: "authored-3d" } : e,
  );
  const grouped = queryReferences(values, { group: true });
  for (const entry of values.slice(0, 2))
    assert.deepEqual(grouped.find((e) => e.id === entry.id).members, [
      entry.sourceId,
    ]);
  assert.equal(queryReferences(values, { status: "authored-3d" }).length, 2);
});

test("strict portable parsing rejects duplicate sources, oversized packs and unsupported payloads", () => {
  assert.throws(() => parseReferenceStudies("not JSON", entries), /valid JSON/);
  assert.throws(
    () =>
      parseReferenceStudies(
        JSON.stringify({ format: "other", version: 1, presets: [] }),
        entries,
      ),
    /catalog/,
  );
  assert.throws(
    () => parseReferenceStudies(" ".repeat(32_000_001), entries),
    /32 MB/,
  );
  const p = preset();
  assert.throws(
    () =>
      parseReferenceStudies(
        serializeCatalog([p, { ...p, id: "different.id" }]),
        entries,
      ),
    /Duplicate source/,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import images from "../src/data/dataset-images.json" with { type: "json" };
import { currentId, currentPreset, imageOfPosition, positionOfImage } from "../src/core/datasetImages.js";
import { BUILTIN_PRESETS, parseCatalog } from "../src/core/catalog.js";
import { migrateLibraryData } from "../src/app/libraryMigrations.js";

const CATALOG = new URL("../public/catalog/", import.meta.url);
const sources = JSON.parse(readFileSync(new URL("sexposes-v1.json", CATALOG))).entries;
const studies = JSON.parse(readFileSync(new URL("interaction-studies-v1.json", CATALOG))).studies;
const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

test("every position is named after its title, and every dataset image names one position", () => {
  const titles = new Map(studies.map((study) => [study.sourceId, study.title]));
  const positions = Object.values(images.positions);
  assert.equal(new Set(positions).size, positions.length);
  assert.deepEqual(new Set(positions), new Set(sources.map((e) => e.sourceId)));
  for (const entry of sources) {
    assert.equal(entry.id, `source.sexposes.${entry.sourceId}`);
    assert.match(entry.sourceId, /^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    assert.doesNotMatch(entry.sourceId, /^\d+$/, "a bare number reads as an index");
    // "69" and "68" are spelled out; everything else is its title.
    const expected = { 69: "sixty-nine", 68: "sixty-eight" }[slug(titles.get(entry.sourceId))];
    assert.equal(entry.sourceId, expected ?? slug(titles.get(entry.sourceId)), entry.sourceId);
    assert.equal(positionOfImage(imageOfPosition(entry.sourceId)), entry.sourceId);
  }
});

test("nothing shipped names a position by its dataset image", () => {
  for (const file of readdirSync(CATALOG))
    assert.doesNotMatch(readFileSync(new URL(file, CATALOG), "utf8"), /img-\d/, file);
  for (const preset of BUILTIN_PRESETS) assert.doesNotMatch(JSON.stringify(preset), /img-\d/, preset.id);
});

test("old IDs are renamed and everything else passes through untouched", () => {
  assert.equal(currentId("builtin.position.img-0001"), "builtin.position.kneeling-missionary");
  assert.equal(currentId("builtin.artistic.img-0002"), "builtin.artistic.gimlet");
  assert.equal(currentId("builtin.generated.img-0003"), "builtin.generated.sixty-nine");
  assert.equal(currentId("user.position.sexposes.img-0001"), "user.position.sexposes.kneeling-missionary");
  for (const id of [
    "builtin.position.kneeling-missionary",
    "builtin.named.sixty_nine",
    "builtin.position.img-9999",
    "builtin.position.constructor",
    "builtin.position.__proto__",
    "user.study-1",
    "",
  ])
    assert.equal(currentId(id), id);
  for (const value of [undefined, null, 42]) assert.equal(currentId(value), value);
  const unchanged = { id: "user.a", tags: ["x"], source: { recordId: "gimlet" } };
  assert.equal(currentPreset(unchanged), unchanged);
  assert.equal(currentPreset(null), null);
});

test("a library saved before the rename loads under the new names without losing a record", () => {
  const annotationHash = sources[0].annotationHash;
  const study = (id, recordId, extra = {}) => ({
    ...structuredClone(BUILTIN_PRESETS[0]),
    id,
    source: { dataset: "SexPoses", recordId, annotationHash },
    ...extra,
  });
  const data = migrateLibraryData({
    version: 1,
    saved: [
      study("user.study-1", "img-0001", { tags: ["img-0001", "mine"] }),
      study("user.position.sexposes.img-0002", "img-0002"),
      // Written by the oldest format, and renamed twice over.
      study("user.reference.sexposes.img-0003", "img-0003"),
      // The same override under both names: the newer, already renamed, stays.
      study("user.position.sexposes.img-0004", "img-0004", { title: "older" }),
      study("user.position.sexposes.coffee-table", "coffee-table", { title: "newer" }),
    ],
    favorites: ["builtin.position.img-0001", "builtin.position.kneeling-missionary", "builtin.named.lotus"],
  });
  assert.deepEqual(
    data.saved.map((p) => [p.id, p.source.recordId]),
    [
      ["user.study-1", "kneeling-missionary"],
      ["user.position.sexposes.gimlet", "gimlet"],
      ["user.position.sexposes.sixty-nine", "sixty-nine"],
      ["user.position.sexposes.coffee-table", "coffee-table"],
    ],
  );
  assert.deepEqual(data.saved[0].tags, ["kneeling-missionary", "mine"]);
  assert.equal(data.saved[3].title, "newer");
  assert.deepEqual(data.favorites, ["builtin.position.kneeling-missionary", "builtin.named.lotus"]);
  assert.doesNotMatch(JSON.stringify(data), /img-\d/);
});

test("a pack exported before the rename imports under the new names", () => {
  const preset = {
    ...structuredClone(BUILTIN_PRESETS[0]),
    id: "user.study-1",
    tags: ["img-0002"],
    source: { dataset: "SexPoses", recordId: "img-0002", annotationHash: sources[1].annotationHash },
  };
  const [imported] = parseCatalog(JSON.stringify({ format: "poseforge.catalog", version: 1, presets: [preset] }));
  assert.equal(imported.source.recordId, "gimlet");
  assert.deepEqual(imported.tags, ["gimlet"]);

  // A name longer than a tag may be is left to the source record.
  const long = sources.find((e) => e.sourceId === "coital-alignment-technique-legs-straight");
  const [renamed] = parseCatalog(
    JSON.stringify({
      format: "poseforge.catalog",
      version: 1,
      presets: [
        {
          ...preset,
          tags: ["img-0149", "mine"],
          source: { dataset: "SexPoses", recordId: "img-0149", annotationHash: long.annotationHash },
        },
      ],
    }),
  );
  assert.equal(renamed.source.recordId, long.sourceId);
  assert.deepEqual(renamed.tags, ["mine"]);
});

test("every position's name fits a preset ID, even as a saved override", () => {
  for (const entry of sources)
    for (const prefix of ["builtin.position.", "builtin.artistic.", "user.position.sexposes."])
      assert.ok((prefix + entry.sourceId).length <= 100, entry.sourceId);
});

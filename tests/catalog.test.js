import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_PRESETS,
  STUDIO_PRESETS,
  NAMED_PRESETS,
  checkPreset,
  checkScene,
  parseCatalog,
  serializeCatalog,
  searchCatalog,
  MAX_PACK_BYTES,
  MAX_PRESETS,
} from "../src/core/catalog.js";
import { fourFigureLibrary } from "./fixtures/fourFigureLibrary.js";
import { solveScene } from "../src/core/solver.js";
import { createLibrary, LIBRARY_KEY } from "../src/app/libraryStore.js";
import { ARCHETYPES } from "../src/nlp/archetypes.js";
import { parseDescription } from "../src/nlp/parser.js";

const example = () => structuredClone(BUILTIN_PRESETS[0]);
function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}
let seq = 0;
const ids = () => `user.test-${++seq}`;

test("reference studies retain their geometry gate: grounded supports and resolved partner contacts", () => {
  for (const preset of STUDIO_PRESETS) {
    const checked = checkPreset(preset);
    const result = solveScene(checked.scene);
    assert.ok(result.quality.maxDepth < 0.02, `${preset.id} overlaps`);
    assert.equal(result.quality.unmetContacts, 0, preset.id);
    for (const actor of result.actors) {
      assert.ok(actor.seatResidual < 0.02, `${preset.id} floats`);
      assert.ok(
        actor.evaluated.positions.flat().every(Number.isFinite),
        preset.id,
      );
    }
  }
});

test("a portable pack retains joint, figure, contact and camera edits", () => {
  const preset = example();
  Object.assign(preset.scene.actors[0], {
    skinTone: "#9d7152",
    stature: 1.8,
    build: 1.2,
    joints: { elbow_l: { flexion: 70 } },
    hands: { l: "relaxed", r: "relaxed" },
  });
  preset.scene.camera.view = "side";
  preset.scene.contacts = [
    {
      fromActor: "female",
      toActor: "male",
      from: "hand.l",
      to: "hand.r",
      strength: 0.45,
      type: "touch",
    },
  ];
  const canonical = checkPreset(preset);
  assert.equal(canonical.scene.contacts.length, 1);
  assert.deepEqual(parseCatalog(serializeCatalog([preset])), [canonical]);
});

test("imports reject unknown versions, duplicate IDs, unsafe keys and unreasonable input", () => {
  const pack = JSON.parse(serializeCatalog([example()]));
  assert.throws(() => parseCatalog("{bad"), /valid JSON/);
  assert.throws(
    () => parseCatalog(JSON.stringify({ ...pack, version: 2 })),
    /version 1/,
  );
  assert.throws(
    () =>
      parseCatalog(
        JSON.stringify({ ...pack, presets: [example(), example()] }),
      ),
    /duplicate/,
  );
  assert.throws(() => parseCatalog(" ".repeat(MAX_PACK_BYTES + 1)), /32 MB/);
  assert.throws(() => checkPreset(JSON.parse('{"__proto__":{}}')), /Unsafe/);
  assert.throws(
    () => checkPreset({ ...example(), figures: 2 }),
    /not part of the position contract/,
  );
  assert.throws(
    () =>
      checkPreset({
        ...example(),
        position: {
          type: "custom",
          name: "Example",
          variant: "studio",
          participants: [],
        },
      }),
    /unsupported field/,
  );
});

test("a malformed contact type rejects the complete pack without modifying saved data", () => {
  const store = storage(),
    library = createLibrary(store, ids);
  library.save(example());
  const before = library.saved(),
    stored = store.getItem(LIBRARY_KEY);
  const pack = JSON.parse(serializeCatalog([example()]));
  const invalid = example();
  invalid.id = "example.invalid-type";
  invalid.scene.contacts = [
    {
      fromActor: 0,
      toActor: 1,
      from: "hand.l",
      to: "hand.r",
      type: { toString: "invalid" },
    },
  ];
  pack.presets.push(invalid);
  assert.throws(() => library.import(JSON.stringify(pack)), /Contact type/);
  assert.deepEqual(library.saved(), before);
  assert.equal(store.getItem(LIBRARY_KEY), stored);
});

test("a full four-figure library exports as a re-importable pack without losing precision", () => {
  const entries = fourFigureLibrary();
  const text = serializeCatalog(entries);
  assert.ok(new TextEncoder().encode(text).length <= MAX_PACK_BYTES);
  const restored = parseCatalog(text);
  assert.equal(restored.length, 200);
  assert.ok(restored.every((p) => p.scene.actors.length === 4));
  assert.deepEqual(restored[199], checkPreset(entries[199]));
});

test("large packs use compact JSON when needed and preserve all 5000 allowed entries", () => {
  const large = fourFigureLibrary(2500);
  const compact = serializeCatalog(large);
  assert.ok(!compact.includes("\n"));
  assert.ok(Buffer.byteLength(compact) <= MAX_PACK_BYTES);
  assert.equal(parseCatalog(compact).length, 2500);
  const entries = Array.from({ length: MAX_PRESETS }, (_, i) => ({
    ...example(),
    id: `scale.${i}`,
  }));
  assert.equal(parseCatalog(serializeCatalog(entries)).length, MAX_PRESETS);
});

test("serialization rejects empty, duplicate, excessive and truly oversized packs", () => {
  assert.throws(() => serializeCatalog([]), /1–5000/);
  assert.throws(
    () => serializeCatalog(Array(MAX_PRESETS + 1).fill(example())),
    /1–5000/,
  );
  assert.throws(() => serializeCatalog([example(), example()]), /duplicate/);
  assert.throws(() => serializeCatalog(fourFigureLibrary(2200, 3000)), /32 MB/);
  assert.match(
    serializeCatalog([example()]),
    /\n  "format"/,
    "small packs should retain readable formatting",
  );
});

test("invalid scenes fail at import instead of silently becoming different poses", () => {
  const invalid = [
    (scene) => (scene.actors[0].posture = "unknown"),
    (scene) => (scene.actors[0].stature = "tall"),
    (scene) => (scene.actors[0].build = NaN),
    (scene) => (scene.actors[0].skinTone = "url(https://example.com)"),
    (scene) => (scene.actors[0].wearing = {}),
    (scene) => (scene.actors[0].hands = 12),
    (scene) => (scene.actors[0].hands = "toString"),
    (scene) => (scene.actors[0].hair = "constructor"),
    (scene) => (scene.actors[0].model = "constructor"),
    (scene) => (scene.actors[0].model = "elf"),
    (scene) => (scene.actors[0].feet = { wrongSide: "flat" }),
    (scene) => (scene.actors[0].joints = { missing: { flexion: 10 } }),
    (scene) => (scene.actors[1].id = scene.actors[0].id),
    (scene) => (scene.relationship.yaw = "sideways"),
    (scene) => (scene.support.surface = "unknown"),
    (scene) => (scene.contacts = [null]),
    (scene) =>
      (scene.contacts = [{ from: "hand", to: "hand", fromActor: 0.5 }]),
  ];
  for (const mutate of invalid) {
    const scene = example().scene;
    mutate(scene);
    assert.throws(() => checkScene(scene));
  }
});

test("search composes text, category, saved scope and favorites", () => {
  const custom = {
    ...example(),
    id: "user.sample",
    category: "Favorites of mine",
  };
  const all = [...BUILTIN_PRESETS, custom];
  assert.equal(searchCatalog(all, { query: "STANDING pair" }).length, 6);
  assert.equal(searchCatalog(all, { scope: "saved" }).length, 1);
  assert.equal(
    searchCatalog(all, { scope: "named" }).length,
    ARCHETYPES.length,
  );
  assert.equal(searchCatalog(all, { category: "Seated" }).length, 5);
  assert.equal(
    searchCatalog(all, { scope: "favorites", favorites: [custom.id] })[0].id,
    custom.id,
  );
  assert.equal(searchCatalog(all, { query: "no such study" }).length, 0);
});

test("every existing named definition has a clothed, portable catalog entry preserving its parser contract", () => {
  assert.equal(NAMED_PRESETS.length, ARCHETYPES.length);
  assert.equal(
    new Set(BUILTIN_PRESETS.map((p) => p.id)).size,
    BUILTIN_PRESETS.length,
  );
  for (const definition of ARCHETYPES) {
    const entry = NAMED_PRESETS.find(
      (p) => p.id === `builtin.named.${definition.id}`,
    );
    assert.ok(entry, definition.id);
    const parsed = parseDescription(definition.phrases[0]).scene;
    assert.deepEqual(entry.scene.support, parsed.support, definition.id);
    assert.deepEqual(
      entry.scene.relationship,
      parsed.relationship,
      definition.id,
    );
    assert.deepEqual(
      entry.scene.contacts,
      JSON.parse(JSON.stringify(parsed.contacts)),
      definition.id,
    );
    assert.deepEqual(
      entry.scene.actors.map((a) => [a.bodyType, a.posture]),
      parsed.actors.map((a) => [a.bodyType, a.posture]),
      definition.id,
    );
    assert.ok(
      entry.scene.actors.every(
        (a) => a.wearing.includes("top") && a.wearing.includes("shorts"),
      ),
    );
    for (const alias of definition.phrases)
      assert.ok(
        searchCatalog(NAMED_PRESETS, { query: alias }).some(
          (p) => p.id === entry.id,
        ),
        alias,
      );
    assert.deepEqual(parseCatalog(serializeCatalog([entry])), [
      checkPreset(entry),
    ]);
  }
});

test("saved edits, favorites, duplicates and deletion survive a reload without mutating built-ins", () => {
  const disk = storage(),
    library = createLibrary(disk, ids);
  const saved = library.save(example());
  library.favorite(saved.id);
  library.save({ ...saved, title: "My edited study" }, saved.id);
  const reloaded = createLibrary(disk, ids);
  assert.equal(reloaded.saved()[0].title, "My edited study");
  assert.deepEqual(reloaded.favorites(), [saved.id]);
  const copy = reloaded.save(saved);
  assert.notEqual(copy.id, saved.id);
  reloaded.remove(saved.id);
  assert.equal(reloaded.saved().length, 1);
  assert.deepEqual(reloaded.favorites(), []);
  assert.throws(() => reloaded.remove(BUILTIN_PRESETS[0].id), /Built-in/);
  assert.throws(() => reloaded.save(saved, BUILTIN_PRESETS[0].id), /own saved/);
  const detached = reloaded.all();
  detached[0].scene.actors[0].build = 99;
  assert.notEqual(reloaded.all()[0].scene.actors[0].build, 99);
});

test("imports are atomic and allocate new IDs even when re-importing a library", () => {
  const library = createLibrary(storage(), ids);
  const original = library.save(example());
  const text = library.export();
  const added = library.import(text);
  assert.notEqual(added[0].id, original.id);
  const badPack = JSON.parse(text);
  badPack.presets.push({ ...example(), id: "bad", scene: {} });
  assert.throws(() => library.import(JSON.stringify(badPack)));
  assert.equal(library.saved().length, 2);
});

test("failed writes and corrupt storage do not overwrite persisted presets", () => {
  const disk = storage(),
    library = createLibrary(disk, ids);
  library.save(example());
  const before = disk.getItem(LIBRARY_KEY);
  disk.setItem = () => {
    throw new Error("quota");
  };
  assert.throws(() => library.save(example()), /Could not save/);
  assert.equal(library.saved().length, 1);
  assert.equal(disk.getItem(LIBRARY_KEY), before);
  const corrupt = storage();
  corrupt.setItem(LIBRARY_KEY, "broken");
  const recovered = createLibrary(corrupt, ids);
  assert.ok(recovered.error);
  assert.throws(() => recovered.save(example()), /could not be read/);
  assert.equal(corrupt.getItem(LIBRARY_KEY), "broken");
});

test("repeated ID collisions never overwrite an existing saved study", () => {
  const library = createLibrary(storage(), () => "user.same");
  library.save(example());
  assert.throws(() => library.save(example()), /unique preset ID/);
  assert.equal(library.saved().length, 1);
});

test("search finds a position by its ID, whole or in part", () => {
  const sourced = (recordId) => ({
    ...example(),
    id: `user.${recordId}`,
    source: { dataset: "SexPoses", recordId, annotationHash: "a".repeat(64) },
  });
  const all = ["zodiac", "viennese-oyster", "dancer-ii", "kneeling-missionary", "prison-guard"].map(sourced);
  const ids = (query) => searchCatalog(all, { query }).map((p) => p.source.recordId);
  assert.deepEqual(ids("viennese-oyster"), ["viennese-oyster"]);
  assert.deepEqual(ids("OYSTER"), ["viennese-oyster"]);
  assert.deepEqual(ids("dancer-i"), ["dancer-ii"]);
  // The dataset's image IDs are not how positions are named any more.
  assert.deepEqual(ids("img-0042"), []);
  // A name inside other names still lists its own position first.
  const nested = ["deep-squat", "squat-ii", "squat", "frog-squat"].map(sourced);
  assert.deepEqual(
    searchCatalog(nested, { query: "Squat" }).map((p) => p.source.recordId),
    ["squat", "deep-squat", "squat-ii", "frog-squat"],
  );
});

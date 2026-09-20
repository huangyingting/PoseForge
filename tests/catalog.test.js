import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILTIN_PRESETS,
  checkPreset,
  checkScene,
  parseCatalog,
  serializeCatalog,
  searchCatalog,
} from "../src/core/catalog.js";
import { solveScene } from "../src/core/solver.js";
import { createLibrary, LIBRARY_KEY } from "../src/app/libraryStore.js";

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

test("every bundled study solves with finite geometry, grounded supports and no unresolved partner contacts", () => {
  for (const preset of BUILTIN_PRESETS) {
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
  assert.throws(() => parseCatalog(" ".repeat(2_000_001)), /2 MB/);
  assert.throws(() => checkPreset(JSON.parse('{"__proto__":{}}')), /Unsafe/);
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
  assert.equal(searchCatalog(all, { query: "STANDING pair" }).length, 3);
  assert.equal(searchCatalog(all, { scope: "saved" }).length, 1);
  assert.equal(searchCatalog(all, { category: "Seated" }).length, 3);
  assert.equal(
    searchCatalog(all, { scope: "favorites", favorites: [custom.id] })[0].id,
    custom.id,
  );
  assert.equal(searchCatalog(all, { query: "no such study" }).length, 0);
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

import test from "node:test";
import assert from "node:assert/strict";
import { createLibrary, LIBRARY_KEY } from "../src/app/libraryStore.js";
import {
  createPersistentLibrary,
  MIGRATION_KEY,
} from "../src/app/persistentLibrary.js";
import { BUILTIN_PRESETS, serializeCatalog } from "../src/core/catalog.js";

function storage() {
  const values = new Map();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
}
function backend() {
  let snapshot = null;
  return {
    read: async () => snapshot,
    fail: false,
    async write(revision, text) {
      if (this.fail) throw new Error("storage quota");
      if ((snapshot?.revision ?? null) !== revision)
        throw new Error("changed in another tab");
      snapshot = { revision: (revision ?? 0) + 1, text };
      return snapshot;
    },
    close() {},
  };
}
let sequence = 0;
const idFactory = () => `user.persist-${++sequence}`;
const example = () => structuredClone(BUILTIN_PRESETS[1]);

test("legacy library migrates durably with favorites and retains original backup", async () => {
  const disk = storage(),
    db = backend(),
    legacy = createLibrary(disk, idFactory);
  const saved = legacy.save(example());
  legacy.favorite(saved.id);
  const before = disk.getItem(LIBRARY_KEY);
  const library = await createPersistentLibrary(disk, {
    backend: db,
    idFactory,
  });
  assert.equal(library.mode, "IndexedDB");
  assert.deepEqual(library.saved(), legacy.saved());
  assert.deepEqual(library.favorites(), [saved.id]);
  assert.equal(disk.getItem(LIBRARY_KEY), before);
  assert.equal(disk.getItem(MIGRATION_KEY), "1");
  await library.save({ ...saved, title: "updated" }, saved.id);
  const reloaded = await createPersistentLibrary(disk, {
    backend: db,
    idFactory,
  });
  assert.equal(reloaded.saved()[0].title, "updated");
  assert.equal(disk.getItem(LIBRARY_KEY), before);
});

test("serialized writes and failed transactions do not publish or lose saved work", async () => {
  const db = backend(),
    library = await createPersistentLibrary(storage(), {
      backend: db,
      idFactory,
    });
  const results = await Promise.all([
    library.save(example()),
    library.save(example()),
  ]);
  assert.equal(library.saved().length, 2);
  assert.notEqual(results[0].id, results[1].id);
  const before = await db.read();
  db.fail = true;
  await assert.rejects(library.remove(results[0].id), /quota/);
  await assert.rejects(library.favorite(results[0].id), /quota/);
  assert.deepEqual(await db.read(), before);
  assert.equal(library.saved().length, 2);
  assert.deepEqual(library.favorites(), []);
  db.fail = false;
  await library.remove(results[0].id);
  assert.equal(library.saved().length, 1);
});

test("concurrent tabs reject stale writes rather than overwriting another library", async () => {
  const disk = storage(),
    db = backend();
  const a = await createPersistentLibrary(disk, { backend: db, idFactory });
  const b = await createPersistentLibrary(disk, { backend: db, idFactory });
  await a.save(example());
  await assert.rejects(b.save(example()), /another tab/);
  assert.equal(b.saved().length, 0);
  assert.equal(
    (await createPersistentLibrary(disk, { backend: db })).saved().length,
    1,
  );
});

test("corrupt legacy data remains recoverable until an explicit transactional reset", async () => {
  const disk = storage(),
    db = backend();
  disk.setItem(LIBRARY_KEY, "broken");
  const library = await createPersistentLibrary(disk, {
    backend: db,
    idFactory,
  });
  assert.ok(library.error);
  await assert.rejects(library.save(example()), /could not be read/);
  assert.equal(await db.read(), null);
  assert.equal(library.raw(), "broken");
  await library.reset();
  await library.save(example());
  assert.equal(library.saved().length, 1);
  assert.equal(disk.getItem(LIBRARY_KEY), "broken");
  assert.equal(
    (await createPersistentLibrary(disk, { backend: db })).error,
    "",
  );
});

test("a 1283-entry import is atomic and its lightweight index cannot mutate stored geometry", async () => {
  const db = backend(),
    library = await createPersistentLibrary(storage(), {
      backend: db,
      idFactory,
    });
  const entries = Array.from({ length: 1283 }, (_, i) => ({
    ...example(),
    id: `input.${i}`,
  }));
  const added = await library.import(serializeCatalog(entries));
  assert.equal(added.length, 1283);
  assert.ok(
    library
      .index()
      .every(
        (p) => p.id.startsWith("builtin.") || p.status === "needs-adjustment",
      ),
  );
  const index = library.index();
  index[0].scene.actors[0].posture = "bad";
  assert.notEqual(library.get(index[0].id).scene.actors[0].posture, "bad");
  assert.equal(library.index()[0].scene.actors[0].joints, undefined);
  entries[1000].scene = {};
  await assert.rejects(
    library.import(
      JSON.stringify({
        format: "poseforge.catalog",
        version: 1,
        presets: entries,
      }),
    ),
  );
  assert.equal(library.saved().length, 1283);
});

test("storage fallback is labeled and a previously migrated library is never replaced", async () => {
  const open = async () => {
      throw new Error("blocked");
    },
    disk = storage();
  const fallback = await createPersistentLibrary(disk, { open, idFactory });
  assert.equal(fallback.mode, "localStorage fallback");
  await fallback.save(example());
  disk.setItem(MIGRATION_KEY, "1");
  const locked = await createPersistentLibrary(disk, { open, idFactory });
  assert.equal(locked.mode, "unavailable");
  assert.throws(() => locked.save(example()), /migrated library/);
  assert.equal(locked.index().length, BUILTIN_PRESETS.length);
  assert.equal(locked.saved().length, 0);
});

test("failed migration preserves the old data and can be retried without a blank studio", async () => {
  const disk = storage(),
    db = backend();
  createLibrary(disk, idFactory).save(example());
  db.fail = true;
  const library = await createPersistentLibrary(disk, {
    backend: db,
    idFactory,
  });
  assert.match(library.notice, /migration/);
  assert.equal(library.saved().length, 1);
  db.fail = false;
  await library.save(example());
  assert.equal(library.saved().length, 2);
  const bad = await createPersistentLibrary(disk, {
    backend: {
      read: async () => {
        throw new Error("blocked");
      },
      close() {},
    },
  });
  assert.match(bad.error, /could not be read/);
  assert.equal(bad.index().length, BUILTIN_PRESETS.length);
});

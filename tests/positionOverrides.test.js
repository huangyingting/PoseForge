import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkInteractionStudies,
  interactionPositions,
} from "../src/core/interactionStudies.js";
import {
  checkPositionOverride,
  isPositionOverride,
  parsePositionOverrides,
  positionOverrideId,
  positionOverrideMatches,
  preparePositionOverrides,
  serializePositionOverrides,
} from "../src/core/positionOverrides.js";
import { checkFixedPositionScene } from "../src/core/positionContract.js";
import { serializeCatalog } from "../src/core/catalog.js";
import {
  createLibrary,
  registerPositions,
} from "../src/app/libraryStore.js";
import { createPersistentLibrary } from "../src/app/persistentLibrary.js";

const entries = JSON.parse(
  readFileSync(new URL("../public/catalog/sexposes-v1.json", import.meta.url)),
).entries;
const interactionPack = JSON.parse(
  readFileSync(
    new URL("../public/catalog/interaction-studies-v1.json", import.meta.url),
  ),
);
const interactionManifest = JSON.parse(
  readFileSync(
    new URL("../src/data/interaction-manifest.json", import.meta.url),
  ),
);
const studies = checkInteractionStudies(
  interactionPack,
  interactionManifest,
  entries,
);
const positions = interactionPositions(studies, entries);

const override = (position = positions[0]) => ({
  ...structuredClone(position),
  id: positionOverrideId(position.source.recordId),
  title: `${position.title} · custom`,
  category: "Position overrides",
  position: { ...position.position, variant: "override" },
});

function disk(initial = null) {
  const values = new Map(initial ? [["poseforge.library.v1", initial]] : []);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
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

test("all source positions support one portable full-interaction override", async () => {
  registerPositions(positions);
  try {
    const db = database();
    const library = await createPersistentLibrary(disk(), { backend: db });
    const result = await library.savePositionOverrides(positions.map(override));
    assert.equal(result.written.length, 1283);
    assert.equal(result.skipped, 0);
    assert.equal(db.writes, 1);
    const exported = serializePositionOverrides(library.saved());
    const roundtrip = parsePositionOverrides(exported, positions);
    assert.equal(new Set(roundtrip.map((preset) => preset.id)).size, 1283);
    assert.ok(
      roundtrip.every((preset, index) =>
        positionOverrideMatches(preset, positions[index]),
      ),
    );
    assert.ok(
      roundtrip.every((preset) => {
        checkFixedPositionScene(preset.scene);
        return preset.scene.description === "";
      }),
    );
    const reloaded = await createPersistentLibrary(disk(), { backend: db });
    assert.equal(reloaded.saved().length, 1283);
    assert.deepEqual(
      reloaded.resolve(positions[0].id),
      roundtrip[0],
    );
  } finally {
    registerPositions([]);
  }
});

test("replacement is explicit and failed durable writes preserve the prior override", async () => {
  registerPositions(positions);
  try {
    const db = database();
    const library = await createPersistentLibrary(disk(), { backend: db });
    const first = override();
    await library.savePositionOverrides([first]);
    const edited = structuredClone(first);
    edited.title = "Independent edit";
    edited.scene.actors[0].joints.elbow_l.flexion = 90;
    const kept = await library.savePositionOverrides([edited]);
    assert.equal(kept.skipped, 1);
    assert.equal(library.resolve(positions[0].id).title, first.title);
    db.fail = true;
    await assert.rejects(
      library.savePositionOverrides([edited], { replace: true }),
      /quota/,
    );
    assert.equal(library.resolve(positions[0].id).title, first.title);
    db.fail = false;
    await library.savePositionOverrides([edited], { replace: true });
    assert.equal(library.resolve(positions[0].id).title, edited.title);
  } finally {
    registerPositions([]);
  }
});

test("an existing override can be replaced while the built-in position pack is unavailable", () => {
  const storage = disk();
  registerPositions(positions);
  const initial = createLibrary(storage);
  const first = override();
  initial.savePositionOverrides([first]);

  registerPositions([]);
  const reloaded = createLibrary(storage);
  const edited = structuredClone(first);
  edited.title = "Offline replacement";
  const result = reloaded.savePositionOverrides([edited], { replace: true });

  assert.equal(result.written.length, 1);
  assert.equal(reloaded.get(edited.id).title, edited.title);
});

test("override validation rejects stale sources, participant loss and disconnected interactions atomically", () => {
  registerPositions(positions);
  try {
    const library = createLibrary(disk());
    library.savePositionOverrides([override()]);
    const before = library.raw();
    for (const mutate of [
      (preset) => {
        preset.source.recordId = "unknown";
      },
      (preset) => {
        preset.source.annotationHash = "0".repeat(64);
      },
      (preset) => {
        preset.scene.actors.pop();
      },
      (preset) => {
        preset.scene.actors[0].wearing = [];
      },
      (preset) => {
        preset.scene.actors[0].jointMode = "guided";
      },
      (preset) => {
        preset.scene.contacts = [];
      },
    ]) {
      const invalid = override(positions[2]);
      mutate(invalid);
      assert.throws(() =>
        library.savePositionOverrides(
          [override(positions[1]), invalid],
          { replace: true },
        ),
      );
      assert.equal(library.raw(), before);
    }
    assert.throws(
      () => library.savePositionOverrides([override(), override()]),
      /Duplicate/,
    );
  } finally {
    registerPositions([]);
  }
});

test("four-participant positions use the same actor and contact graph contract", () => {
  const base = structuredClone(positions.find((position) => position.scene.actors.length === 3));
  const fourth = structuredClone(base.scene.actors[2]);
  fourth.id = "actor-four";
  fourth.label = "Figure D";
  fourth.placement.position[0] += 0.2;
  base.scene.actors.push(fourth);
  base.scene.contacts.push({
    fromActor: 2,
    toActor: 3,
    from: "hand.r",
    to: "forearm.l",
    strength: 1,
    type: "rest",
  });
  const input = {
    ...base,
    id: positionOverrideId(base.source.recordId),
    position: { ...base.position, variant: "override" },
  };
  const expected = structuredClone(base);
  const checked = checkPositionOverride(input, expected);
  assert.equal(checked.scene.actors.length, 4);
  checkFixedPositionScene(checked.scene);
});

test("legacy override IDs migrate once at the storage boundary", () => {
  const current = override();
  const legacy = {
    ...current,
    id: `user.reference.sexposes.${current.source.recordId}`,
  };
  delete legacy.position;
  const storage = disk(
    JSON.stringify({
      version: 1,
      saved: [legacy],
      favorites: [legacy.id],
    }),
  );
  const library = createLibrary(storage);
  assert.equal(library.error, "");
  assert.equal(library.saved()[0].id, current.id);
  assert.deepEqual(library.favorites(), [current.id]);
  assert.equal(isPositionOverride(library.saved()[0]), true);
});

test("portable presets need explicit binding before they become overrides", () => {
  const imported = {
    ...override(),
    id: "user.imported",
    position: { ...positions[0].position, variant: "studio" },
  };
  assert.equal(isPositionOverride(imported), false);
  const [bound] = preparePositionOverrides(
    JSON.parse(serializeCatalog([imported])).presets,
    positions,
  );
  assert.equal(bound.id, positionOverrideId(positions[0].source.recordId));
  assert.equal(positionOverrideMatches(bound, positions[0]), true);
});

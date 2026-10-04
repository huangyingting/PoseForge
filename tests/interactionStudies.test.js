import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  checkInteractionStudies,
  interactionPreset,
  isInteractionPosition,
  TEMPLATE_LABELS,
} from "../src/core/interactionStudies.js";
import { createPositionService } from "../src/app/positionService.js";
import { composeStudy } from "../scripts/build-interaction-studies.mjs";
import { TEMPLATES } from "../scripts/interaction-templates.mjs";
import { mirrorSpec } from "../scripts/interaction-composer.mjs";
import { serializeCatalog, parseCatalog } from "../src/core/catalog.js";
import { solveScene } from "../src/core/solver.js";
import { palmAims, palmNormal } from "../src/core/palmPose.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const indexBytes = read("public/catalog/sexposes-v1.json");
const entries = JSON.parse(indexBytes).entries;
const bytes = read("public/catalog/interaction-studies-v1.json");
const manifest = JSON.parse(read("src/data/interaction-manifest.json"));
const classifications = JSON.parse(read("scripts/data/interaction-classifications.json"));
const names = JSON.parse(read("scripts/data/position-names.json"));
const pack = JSON.parse(bytes);
const studies = checkInteractionStudies(pack, manifest, entries);
const hash = (v) => createHash("sha256").update(v).digest("hex");

test("every source reference has a verified, clothed 3D interaction with its participants together", () => {
  assert.equal(bytes.length, manifest.bytes);
  assert.equal(hash(bytes), manifest.sha256);
  assert.equal(studies.size, 1283);
  assert.equal(classifications.length, 1283);
  let pairs = 0;
  for (const entry of entries) {
    const preset = interactionPreset(entry, studies);
    assert.ok(isInteractionPosition(preset));
    assert.equal(preset.source.annotationHash, entry.annotationHash);
    const { scene } = preset;
    if (scene.actors.length < 2) continue;
    pairs += 1;
    // Together, not an arrangement of separate studies: declared contacts link the participants.
    assert.equal(scene.relationship.contactMode, "custom");
    assert.ok(
      scene.contacts.some((c) => c.fromActor !== c.toActor),
      `${entry.sourceId} has no contact between participants`,
    );
    const restored = parseCatalog(serializeCatalog([preset]))[0];
    assert.deepEqual(restored.scene, preset.scene);
  }
  assert.ok(pairs > 1200);
  assert.equal(
    manifest.participants,
    pack.studies.reduce((n, s) => n + s.scene.actors.length, 0),
  );
});

test("the template labels shown in the app match the composer templates", () => {
  for (const [id, template] of Object.entries(TEMPLATES))
    assert.equal(TEMPLATE_LABELS[id], template.label, id);
  for (const record of pack.studies)
    assert.ok(TEMPLATE_LABELS[record.template === "group_three" ? record.base : record.template]);
});

test("most interactions pass their placement and contact checks, and unmet ones are disclosed", () => {
  assert.equal(manifest.passedChecks, pack.studies.filter((s) => s.checks.passed).length);
  assert.ok(manifest.passedChecks / manifest.records > 0.8, `${manifest.passedChecks} passed`);
  const failing = pack.studies.find((s) => !s.checks.passed);
  if (failing) {
    const entry = entries.find((e) => e.sourceId === failing.sourceId);
    const preset = interactionPreset(entry, studies);
    assert.ok(preset.inputWarnings.some((w) => w.includes("checks are unmet")));
  }
});

test("baked scenes solve to their fixed placements with finite geometry", () => {
  for (const record of pack.studies.filter((_, i) => i % 40 === 0)) {
    const result = solveScene(record.scene);
    result.actors.forEach((actor, i) => {
      assert.ok(actor.evaluated.positions.flat().every(Number.isFinite));
      assert.deepEqual(actor.pose.root.position, record.scene.actors[i].placement.position);
    });
  }
});

test("the offline composer reproduces the committed scenes", () => {
  const byId = new Map(classifications.map((c) => [c.id, c]));
  for (const id of ["kneeling-missionary", "pearly-gates", "wrapped-saint", "juicy-ass"]) {
    const record = pack.studies.find((s) => s.sourceId === id);
    const study = composeStudy(byId.get(id));
    assert.deepEqual(study.scene.actors, record.scene.actors, id);
    assert.equal(study.passed, record.checks.passed, id);
  }
});

test("baked hands face what they lean on, hold or lie on", () => {
  const facing = (solved, { actor, side, aim }) =>
    palmNormal(solved.actors[actor], side).reduce((sum, v, i) => sum + v * aim[i], 0) > Math.cos((30 * Math.PI) / 180);
  let turned = 0;
  let hands = 0;
  for (const record of pack.studies.filter((_, i) => i % 20 === 0)) {
    const solved = solveScene(record.scene);
    for (const aim of palmAims(solved)) {
      hands += 1;
      if (facing(solved, aim)) turned += 1;
    }
  }
  assert.ok(turned / hands > 0.95, `${turned} of ${hands} hands face what they are on`);
  // Lying on the forearms, the palms are flat on the bed, not turned up.
  const turtle = solveScene(pack.studies.find((s) => s.sourceId === "turtle").scene);
  for (const aim of palmAims(turtle).filter((a) => a.kind === "forearm")) assert.ok(facing(turtle, aim), `turtle ${aim.side}`);
});

test("mirroring a pose twice is exact and swaps left and right", () => {
  const spec = structuredClone(pack.studies[0].scene.actors[0]);
  spec.joints.hip_l.flexion = 40;
  spec.joints.hip_r.flexion = 10;
  const mirrored = mirrorSpec(spec);
  assert.equal(mirrored.joints.hip_r.flexion, 40);
  assert.equal(mirrored.joints.hip_l.flexion, 10);
  const back = mirrorSpec(mirrored);
  for (const bone of Object.keys(spec.joints))
    for (const channel of Object.keys(spec.joints[bone]))
      assert.ok(Math.abs(back.joints[bone][channel] - spec.joints[bone][channel]) < 1e-9);
});

test("malformed, stale, unclothed or free-floating interaction records reject the pack", () => {
  for (const mutate of [
    (p) => p.studies.pop(),
    (p) => {
      p.studies[0].annotationHash = "0".repeat(64);
    },
    (p) => {
      p.studies[0].template = "unknown";
    },
    (p) => {
      p.studies[0].scene.actors[0].wearing = [];
    },
    (p) => {
      p.studies[0].scene.actors[0].jointMode = "guided";
    },
    (p) => {
      p.studies[1].sourceId = p.studies[0].sourceId;
    },
    (p) => {
      p.studies[1].title = p.studies[0].title.toUpperCase();
    },
    (p) => {
      p.studies[0].title = " ";
    },
    (p) => {
      p.studies[0].aliases = [""];
    },
    (p) => {
      const pair = p.studies.find((s) => s.scene.actors.length > 1);
      pair.scene.contacts = [];
    },
  ]) {
    const copy = structuredClone(pack);
    mutate(copy);
    assert.throws(() => checkInteractionStudies(copy, manifest, entries));
  }
});

test("interaction scenes load lazily through the shared verified service", async () => {
  const requests = [];
  const service = createPositionService({
    base: "/app/",
    digest: hash,
    fetcher: async (url) => {
      requests.push(url);
      if (url.endsWith("interaction-studies-v1.json")) return new Response(bytes);
      if (url.endsWith("sexposes-v1.json")) return new Response(indexBytes);
      throw new Error("Other packs are not needed.");
    },
  });
  assert.equal(requests.length, 0);
  const [a, b] = await Promise.all([
    service.variant(entries[0]),
    service.variant(entries[1]),
  ]);
  assert.ok(a.tags.includes("interaction"));
  assert.notEqual(a.source.recordId, b.source.recordId);
  const unified = await service.positions();
  assert.equal(unified.length, 1283);
  assert.equal(unified[0].scene.actors.length, entries[0].figures);
  assert.ok(unified[0].position.name);
  assert.equal(requests.length, 2);
});

test("every interaction is a named, playable library position that can be listed, searched and favorited", async () => {
  const { interactionPositions } = await import("../src/core/interactionStudies.js");
  const { isBuiltInPosition } = await import("../src/core/positionContract.js");
  const { createLibrary, registerPositions } = await import("../src/app/libraryStore.js");
  const { checkPreset, searchCatalog } = await import("../src/core/catalog.js");
  const positions = interactionPositions(studies);
  assert.equal(positions.length, 1283);
  assert.equal(new Set(positions.map((p) => p.title)).size, 1283);
  // Every reference has a specific template, so the catch-all
  // "Other interactions" category is left empty.
  assert.equal(
    new Set(positions.map((p) => p.category)).size,
    9,
  );
  for (const p of positions) {
    assert.ok(isBuiltInPosition(p));
    // Positions carry their own names, not source IDs.
    assert.equal(p.title, names[p.source.recordId].name);
    assert.doesNotMatch(p.title, /img-?\d/i);
    assert.equal(p.scene.title, p.title);
    for (const alias of names[p.source.recordId].aliases ?? []) assert.ok(p.tags.includes(alias));
    assert.ok(p.description.includes(p.position.name));
    assert.equal(p.position.variant, "interaction");
    for (const duplicate of [
      "figures",
      "surface",
      "positionName",
      "positionCategory",
      "reference",
    ])
      assert.equal(
        Object.hasOwn(p, duplicate),
        false,
        `${p.id} duplicates ${duplicate}`,
      );
    assert.deepEqual(checkPreset(p).scene, p.scene);
  }
  const memory = new Map();
  const storage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) };
  registerPositions(positions);
  try {
    const library = createLibrary(storage);
    const index = library.index();
    const listed = index.filter((p) => p.status === "interaction-3d");
    assert.equal(listed.length, 1283);
    assert.equal(searchCatalog(index, { scope: "named" }).filter((p) => isBuiltInPosition(p)).length, 1283);
    assert.ok(searchCatalog(index, { query: "reverse cowgirl" }).length >= 61);
    assert.equal(searchCatalog(index, { query: "kneeling-missionary" }).filter(isBuiltInPosition).length, 1);
    assert.deepEqual(
      searchCatalog(index, { query: names["over-the-top"].aliases[0] }).filter(isBuiltInPosition).map((p) => p.source.recordId),
      ["over-the-top"],
    );
    const one = library.get(positions[0].id);
    assert.equal(one.scene.actors.length, positions[0].scene.actors.length);
    one.scene.actors[0].joints.head.rotation = 999;
    assert.notEqual(library.get(positions[0].id).scene.actors[0].joints.head.rotation, 999);
    library.favorite(positions[0].id);
    assert.deepEqual(createLibrary(storage).favorites(), [positions[0].id]);
    assert.throws(() => library.remove(positions[0].id), /Built-in/);
  } finally {
    registerPositions([]);
  }
});

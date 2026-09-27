import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createTemplateCache } from "../src/workers/templateCache.js";
import { DEFAULT_BUST, buildBodyVolumes } from "../src/core/body.js";
import { Skeleton } from "../src/core/skeleton.js";
import { buildHumanTemplate, featureRelief } from "../src/core/humanMesh.js";
import { withGarments } from "../src/core/garments.js";
import { withHair, DEFAULT_HAIR } from "../src/core/hair.js";
import { modelFiles } from "../src/core/bodyModels.js";

function mockCache(options = {}, scanned = async (bodyType) => ({ bodyType })) {
  const calls = { bodies: [], templates: [] };
  const get = createTemplateCache(scanned, {
    relieve: (scan, body) => {
      calls.bodies.push(body);
      return Object.freeze({ scan, body: Object.freeze(body) });
    },
    dress: (shape, appearance) => {
      calls.templates.push(appearance);
      return { shape, appearance };
    },
    addHair: (template, hair) => ({ ...template, hair }),
    ...options,
  });
  return { get, calls };
}

test("concurrent default/explicit requests share one body and one template promise", async () => {
  const { get, calls } = mockCache();
  const first = get({ bodyType: "female", wearing: ["top", "shorts"] });
  const equivalent = get({
    bodyType: "female",
    bust: 1,
    build: 1,
    hair: "medium",
    wearing: ["shorts", "top", "top"],
    outfit: "black",
    stature: 1.85,
  });
  assert.equal(first, equivalent);
  const [a, b] = await Promise.all([first, equivalent]);
  assert.equal(a, b);
  assert.equal(calls.bodies.length, 1);
  assert.equal(calls.templates.length, 1);
});

test("outfit, hair and clothing changes retain the shaped body without conflating appearances", async () => {
  const { get, calls } = mockCache();
  const source = {
    bodyType: "male",
    wearing: ["top", "shorts"],
    outfit: "sage",
  };
  const a = await get({ ...source, bust: 0 });
  const b = await get({ ...source, outfit: "navy" });
  const c = await get({ ...source, hair: "bob" });
  const d = await get({ ...source, wearing: ["top"] });
  assert.equal(calls.bodies.length, 1);
  assert.equal(calls.templates.length, 4);
  for (const value of [b, c, d]) {
    assert.notEqual(value, a);
    assert.equal(value.shape, a.shape);
  }
  assert.equal(b.appearance.colour, "navy");
  assert.equal(c.hair.style, "bob");
  assert.deepEqual(d.appearance.wearing, ["top"]);
  assert.equal(
    await get({ ...source, stature: 1.55, joints: {}, label: "renamed" }),
    a,
  );
});

test("each body model is its own scan and its own shaped body", async () => {
  const asked = [];
  const { get, calls } = mockCache({}, async (bodyType, model) => {
    asked.push([bodyType, model]);
    return { bodyType, model };
  });
  const standard = await get({ bodyType: "female" });
  const european = await get({ bodyType: "female", model: "european" });
  const same = await get({ bodyType: "female", model: "asian", outfit: "black" });
  assert.equal(same, standard, "the default named outright is the default");
  assert.notEqual(european.shape, standard.shape);
  assert.equal(european.shape.scan.model, "european");
  assert.deepEqual(asked, [
    ["female", "asian"],
    ["female", "european"],
  ]);
  assert.equal(calls.bodies.length, 2);
});

test("different bodies retain their own shape and both cache tiers are bounded", async () => {
  const { get, calls } = mockCache({ bodyCapacity: 2, templateCapacity: 1 });
  const a = await get({ bodyType: "female", outfit: "red" });
  await get({ bodyType: "male" });
  const recolored = await get({ bodyType: "female", outfit: "navy" });
  assert.equal(recolored.shape, a.shape);
  assert.equal(calls.bodies.length, 2);
  await get({ bodyType: "female", build: 1.1 });
  const rebuilt = await get({ bodyType: "female", outfit: "red" });
  assert.notEqual(rebuilt.shape, a.shape, "the evicted body must rebuild");
  assert.equal(calls.bodies.length, 4);
  await get({ bodyType: "female", bust: 0.8 });
  assert.equal(calls.bodies.length, 5);
  for (const option of [
    { bodyCapacity: 0 },
    { templateCapacity: 0 },
    { bodyCapacity: 1.5 },
  ])
    assert.throws(() => mockCache(option), /positive integers/);
});

test("pending requests snapshot appearance instead of caching later caller mutations", async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const { get } = mockCache({}, () => pending);
  const source = {
    bodyType: "female",
    build: 1,
    wearing: ["top"],
    outfit: "sage",
    hair: "medium",
  };
  const first = get(source);
  source.build = 1.2;
  source.wearing.push("shorts");
  source.outfit = "navy";
  source.hair = "bob";
  resolve({ model: "scan" });
  const template = await first;
  assert.equal(template.shape.body.build, 1);
  assert.deepEqual(template.appearance.wearing, ["top"]);
  assert.equal(template.appearance.colour, "sage");
  assert.equal(template.hair.style, "medium");
});

test("missing scans remain unavailable and rejected builds remain explicit", async () => {
  const { get, calls } = mockCache({}, async () => null);
  assert.equal(await get({ bodyType: "male" }), null);
  assert.equal(await get({ bodyType: "male", outfit: "red" }), null);
  assert.equal(calls.bodies.length, 0);
  assert.equal(calls.templates.length, 0);
  const broken = mockCache({
    relieve: () => {
      throw new Error("shape failure");
    },
  });
  const result = broken.get({ bodyType: "female" });
  await assert.rejects(result, /shape failure/);
  assert.equal(broken.get({ bodyType: "female" }), result);
});

test("a scan that was missing is asked for again, and a recovered one is kept", async () => {
  let available = false,
    requests = 0;
  const { get, calls } = mockCache({}, async (bodyType) => {
    requests++;
    return available ? { bodyType } : null;
  });
  assert.equal(await get({ bodyType: "male" }), null);
  // Let the cache observe the null before asking again.
  await new Promise((resolve) => setImmediate(resolve));
  available = true;
  const recovered = await get({ bodyType: "male" });
  assert.equal(recovered.shape.scan.bodyType, "male");
  assert.equal(await get({ bodyType: "male" }), recovered);
  assert.equal(requests, 2);
  assert.equal(calls.bodies.length, 1);
});

const digest = (template) => {
  const hash = createHash("sha256");
  for (const mesh of template.submeshes) {
    hash.update(
      JSON.stringify([
        mesh.name,
        mesh.colour,
        mesh.primary,
        mesh.hair,
        mesh.garment,
      ]),
    );
    for (const key of [
      "positions",
      "normals",
      "uvs",
      "indices",
      "joints",
      "weights",
    ])
      if (mesh[key])
        hash.update(
          Buffer.from(
            mesh[key].buffer,
            mesh[key].byteOffset,
            mesh[key].byteLength,
          ),
        );
  }
  return hash.digest("hex");
};

test("normalized cache defaults preserve real dressed geometry for every body type", async () => {
  for (const bodyType of ["female", "male", "neutral"]) {
    const scan = buildHumanTemplate(
      readFileSync(
        new URL(
          `../assets/models/realistic-${modelFiles(bodyType).mesh}.glb`,
          import.meta.url,
        ),
      ),
    );
    const sourceDigest = digest(scan),
      spec = { bodyType, wearing: ["top", "shorts"], outfit: "sage" };
    const legacy = withHair(
      withGarments(featureRelief(scan, { bodyType, build: 1 }), {
        bodyType,
        wearing: spec.wearing,
        colour: spec.outfit,
      }),
      { bodyType },
    );
    const get = createTemplateCache(async () => scan);
    const cached = await get({
      ...spec,
      bust: DEFAULT_BUST[bodyType],
      hair: DEFAULT_HAIR[bodyType],
    });
    assert.equal(digest(cached), digest(legacy), bodyType);
    assert.equal(digest(scan), sourceDigest, "source scans remain immutable");
    const skeleton = new Skeleton({ bodyType });
    assert.deepEqual(
      buildBodyVolumes(skeleton),
      buildBodyVolumes(skeleton, { bust: DEFAULT_BUST[bodyType] }),
    );
  }
});

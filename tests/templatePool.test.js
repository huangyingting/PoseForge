import assert from "node:assert/strict";
import test from "node:test";
import { createTemplatePool, revived } from "../src/workers/templatePool.js";

// A helper that answers when told to, and remembers what it was sent.
function fakeHelper() {
  const helper = {
    sent: [],
    terminated: false,
    postMessage(message) {
      helper.sent.push(message);
    },
    terminate() {
      helper.terminated = true;
    },
    reply(index, template, warnings = null) {
      helper.onmessage({ data: { id: helper.sent[index].id, template, warnings } });
    },
  };
  return helper;
}

// The body worker's own cache, answering when told to.
function fakeLocal() {
  const asked = [];
  const local = (spec) => {
    const found = asked.find(({ spec: seen }) => ["bodyType", "outfit", "build"].every((key) => seen[key] === spec[key]));
    if (found) return found.promise;
    let resolve;
    const promise = new Promise((done) => (resolve = done));
    asked.push({ spec: structuredClone(spec), promise, resolve });
    return promise;
  };
  return { local, asked };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a pair's second body is shaped by a helper while the first is shaped here", async () => {
  const { local, asked } = fakeLocal();
  const helpers = [];
  const warnings = [];
  const get = createTemplatePool(local, {
    helpers: 2,
    spawn: () => (helpers.push(fakeHelper()), helpers.at(-1)),
    warned: (spec, said) => warnings.push([spec.bodyType, said]),
  });
  assert.equal(helpers.length, 1, "the first helper starts before it is needed");
  const female = get({ bodyType: "female" });
  const male = get({ bodyType: "male", outfit: "navy", wearing: ["top"] });
  assert.deepEqual(asked.map(({ spec }) => spec.bodyType), ["female"]);
  assert.deepEqual(helpers[0].sent.map(({ spec }) => spec), [{ bodyType: "male", outfit: "navy", wearing: ["top"] }]);
  assert.equal(helpers.length, 1, "a second helper waits until two threads are busy");

  asked[0].resolve("female template");
  helpers[0].reply(0, "male template", ["hair lost"]);
  assert.deepEqual(await Promise.all([female, male]), ["female template", "male template"]);
  assert.deepEqual(warnings, [["male", ["hair lost"]]]);

  // The same template again is the copy already here; another outfit on the
  // same body goes back to the thread that shaped it.
  assert.equal(get({ bodyType: "male", outfit: "navy", wearing: ["top"] }), male);
  get({ bodyType: "male", outfit: "sage" });
  assert.equal(helpers[0].sent.length, 2);
  assert.equal(asked.length, 1);
});

test("a third body starts a second helper, and no more than the limit", async () => {
  const { local } = fakeLocal();
  const helpers = [];
  const get = createTemplatePool(local, { helpers: 2, spawn: () => (helpers.push(fakeHelper()), helpers.at(-1)) });
  get({ bodyType: "female" });
  get({ bodyType: "male" });
  get({ bodyType: "neutral" });
  get({ bodyType: "female", build: 1.2 });
  assert.equal(helpers.length, 2);
  assert.deepEqual(helpers.map((helper) => helper.sent.map(({ spec }) => spec.bodyType)), [["male"], ["neutral"]]);
});

test("a helper that fails hands what it held back to this thread, and is not asked again", async () => {
  const { local, asked } = fakeLocal();
  const helper = fakeHelper();
  const get = createTemplatePool(local, { helpers: 1, spawn: () => helper });
  get({ bodyType: "female" });
  const male = get({ bodyType: "male" });
  let prevented = false;
  helper.onerror({ preventDefault: () => (prevented = true) });
  assert.ok(prevented && helper.terminated);
  assert.deepEqual(asked.map(({ spec }) => spec.bodyType), ["female", "male"]);
  asked[1].resolve("male here");
  assert.equal(await male, "male here");
  get({ bodyType: "male", outfit: "red" });
  get({ bodyType: "neutral" });
  assert.equal(helper.sent.length, 1);
  assert.deepEqual(asked.map(({ spec }) => spec.bodyType), ["female", "male", "male", "neutral"]);
});

test("without helpers everything is shaped here", async () => {
  const { local, asked } = fakeLocal();
  let spawned = 0;
  const none = createTemplatePool(local, { helpers: 0, spawn: () => (spawned += 1, fakeHelper()) });
  none({ bodyType: "female" });
  none({ bodyType: "male" });
  assert.equal(spawned, 0);
  const unavailable = createTemplatePool(local, { helpers: 2, spawn: () => null });
  unavailable({ bodyType: "neutral" });
  unavailable({ bodyType: "female", build: 1.1 });
  assert.deepEqual(asked.map(({ spec }) => spec.bodyType), ["female", "male", "neutral", "female"]);
});

test("a helper's missing scan is asked for again, and its failures stay explicit", async () => {
  const { local } = fakeLocal();
  const helper = fakeHelper();
  const get = createTemplatePool(local, { helpers: 1, spawn: () => helper });
  get({ bodyType: "female" });
  const spec = { bodyType: "male", wearing: ["top"] };
  const missing = get(spec);
  spec.wearing.push("shorts");
  assert.deepEqual(helper.sent[0].spec.wearing, ["top"], "the helper is sent the spec as it was asked for");
  helper.reply(0, null);
  assert.equal(await missing, null);
  await settle();
  const again = get({ bodyType: "male", wearing: ["top"] });
  assert.notEqual(again, missing);
  helper.onmessage({ data: { id: helper.sent[1].id, error: { message: "shape failure", stack: "Error: shape failure\n    at helper" } } });
  await assert.rejects(again, (error) => error.message === "shape failure" && /at helper/.test(error.stack));
  assert.equal(get({ bodyType: "male", wearing: ["top"] }), again);
});

test("a helper's template comes back with the same numbers, shared as they were", () => {
  const matrix = [1.5, 0, -0, 2];
  const positions = new Float32Array([1, 2, 3]);
  const sent = structuredClone({ joints: [{ rest: matrix, again: matrix, order: [3, 1] }], positions, byName: new Map([["hip", { offset: [0.25, 1] }]]) });
  const arrived = sent.positions;
  const template = revived(sent);
  assert.deepEqual(template, { joints: [{ rest: matrix, again: matrix, order: [3, 1] }], positions, byName: new Map([["hip", { offset: [0.25, 1] }]]) });
  assert.equal(template.joints[0].rest, template.joints[0].again);
  assert.equal(template.positions, arrived, "typed arrays are kept as they came");
  assert.ok(Object.is(template.joints[0].rest[2], -0));
});

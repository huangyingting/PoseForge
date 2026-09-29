import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createPositionClient } from "../src/app/positionClient.js";
import { createPositionService } from "../src/app/positionService.js";
import { checkPositions, createLibrary, registerPositions } from "../src/app/libraryStore.js";
import { localizePreset } from "../src/i18n/presets.js";
import { createTranslator } from "../src/i18n/translator.js";
import zh from "../src/i18n/zh.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const packs = (url) => new Response(read(`public${new URL(url, "http://page/").pathname}`));
// The service as the page ran it, before there was a worker.
const onThePage = () => createPositionService({ base: "/", fetcher: async (url) => packs(url) });

// The worker's own module, run here, with a structured clone between it and
// the client as there is between threads.
const page = { worker: null };
globalThis.self = { postMessage: (message) => page.worker.onmessage({ data: structuredClone(message) }) };
async function positionWorker(instance) {
  await import(`../src/workers/positionWorker.js?${instance}`);
  const receive = globalThis.self.onmessage;
  const worker = {
    posted: [],
    postMessage(message) {
      worker.posted.push(message);
      page.worker = worker;
      receive({ data: structuredClone(message) });
    },
    terminate() {},
  };
  return worker;
}

// A worker that answers when told to.
function fakeWorker() {
  const worker = {
    posted: [],
    terminated: false,
    postMessage: (message) => worker.posted.push(message),
    terminate: () => (worker.terminated = true),
    reply: (index, data) => worker.onmessage({ data: { id: worker.posted[index].id, ...data } }),
  };
  return worker;
}

test("the worker lists every position as the page would have registered it, in the page's language", async () => {
  const fetch = globalThis.fetch;
  globalThis.fetch = async (url) => packs(url);
  try {
    const listed = await onThePage().positions();
    const inEnglish = await positionWorker("en");
    const english = createPositionClient({ spawn: () => inEnglish, base: "http://page/", language: "en" });
    const registered = await english.positions();
    assert.equal(registered.length, 1283);
    assert.deepEqual(registered, checkPositions(listed));
    const library = createLibrary({ getItem: () => null, setItem() {}, removeItem() {} });
    registerPositions(registered, { checked: true });
    const stock = library.all();
    assert.equal(stock.filter((preset) => preset.source).length, 1283);
    registerPositions(listed);
    assert.deepEqual(stock, library.all(), "the library is the same as if it had checked them itself");

    const tr = createTranslator(zh);
    const inChinese = await positionWorker("zh");
    const chinese = createPositionClient({ spawn: () => inChinese, base: "http://page/", language: "zh" });
    const translated = await chinese.positions();
    assert.match(translated[0].category, /\p{Script=Han}/u);
    assert.deepEqual(translated, checkPositions(listed.map((preset) => localizePreset(preset, tr))));
    const [entry] = await chinese.sources();
    assert.deepEqual(await chinese.variant(entry, "interaction"), localizePreset(await onThePage().variant(entry, "interaction"), tr));
  } finally {
    globalThis.fetch = fetch;
    registerPositions([]);
  }
});

test("the worker is asked where the packs are, and its failures are failures here", async () => {
  const worker = fakeWorker();
  const client = createPositionClient({ spawn: () => worker, base: "https://host/app/", language: "zh", local: () => assert.fail("asked here") });
  const failed = client.positions();
  const entry = client.source("kneeling-missionary");
  assert.deepEqual(worker.posted.map(({ base, language, method, args }) => [base, language, method, args]), [
    ["https://host/app/", "zh", "positions", []],
    ["https://host/app/", "zh", "source", ["kneeling-missionary"]],
  ]);
  worker.reply(0, { error: "Catalog download failed its integrity check." });
  await assert.rejects(failed, { message: "Catalog download failed its integrity check." });
  worker.reply(1, { value: { sourceId: "kneeling-missionary" } });
  assert.deepEqual(await entry, { sourceId: "kneeling-missionary" });

  // The index is shared, as the service's is, until it fails.
  const sources = client.sources();
  assert.equal(client.sources(), sources);
  worker.reply(2, { error: "Catalog download timed out." });
  await assert.rejects(sources, /timed out/);
  const again = client.sources();
  assert.notEqual(again, sources);
  worker.reply(3, { value: [] });
  assert.deepEqual(await again, []);
});

test("a worker that fails hands what it held to the service here, and is not asked again", async () => {
  const worker = fakeWorker();
  const asked = [];
  const local = {
    sources: async () => (asked.push("sources"), ["entry"]),
    source: async (sourceId) => (asked.push("source"), { sourceId }),
    variant: async (entry, variant) => (asked.push("variant"), { variant }),
    positions: async () => (asked.push("positions"), []),
  };
  let made = 0;
  const client = createPositionClient({ spawn: () => worker, local: () => ((made += 1), local), base: "http://page/" });
  const listed = client.positions();
  const variant = client.variant({ sourceId: "a" }, "artistic", "A");
  let prevented = false;
  worker.onerror({ preventDefault: () => (prevented = true) });
  assert.ok(prevented && worker.terminated);
  assert.deepEqual(await listed, []);
  assert.deepEqual(await variant, { variant: "artistic" });
  assert.deepEqual(await client.sources(), ["entry"]);
  assert.equal(worker.posted.length, 2);
  assert.deepEqual(asked, ["positions", "variant", "sources"]);
  assert.equal(made, 1);

  // Without a worker at all, the same.
  const alone = createPositionClient({ spawn: () => null, local: () => local });
  assert.deepEqual(await alone.source("b"), { sourceId: "b" });
  const refused = createPositionClient({ spawn: () => { throw new Error("no workers"); }, local: () => local });
  assert.deepEqual(await refused.positions(), []);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { chooseLanguage, language, translator } from "../src/i18n/index.js";
import { createTranslator } from "../src/i18n/translator.js";
import { describe, label, localizePreset } from "../src/i18n/presets.js";
import zh from "../src/i18n/zh.js";
import { BUILTIN_PRESETS } from "../src/core/catalog.js";
import { checkSourceCatalog } from "../src/core/sourceCatalog.js";
import {
  checkInteractionStudies,
  interactionPositions,
} from "../src/core/interactionStudies.js";
import { checkArtisticStudies, artisticPreset } from "../src/core/artisticStudies.js";
import { checkGeneratedStudies, generatedPosition } from "../src/core/generatedStudies.js";
import { GARMENT_COLOURS, GARMENT_LABELS } from "../src/core/garments.js";
import { BODY_MODELS } from "../src/core/bodyModels.js";
import { POSITION_STATUS_LABELS } from "../src/core/positionContract.js";
import { ARRANGEMENT_NAMES, POSTURE_NAMES, SURFACE_NAMES } from "../src/core/poseLibrary.js";
import { CHANNELS, POSEABLE_BONES } from "../src/core/skeleton.js";
import { HAIR_STYLES } from "../src/core/hair.js";
import { HAND_SHAPE_NAMES } from "../src/core/handPose.js";
import { FOOT_SHAPE_NAMES } from "../src/core/footPose.js";
import { BODY_TYPES } from "../src/core/scene.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const json = (path) => JSON.parse(read(path));
const tr = createTranslator(zh);
// Latin words left in a translation. Numerals, "3D", "V" and the like are
// part of the Chinese too.
const english = (text) =>
  typeof text === "string" &&
  /[A-Za-z]{2,}/.test(text.replace(/\b(3D|[IVX]+|XXX|SHA-256|PNG|SVG|JSON|IndexedDB|localStorage|PoseForge|SexPoses|Ctrl|Shift|MB|WebGL|XYZ|ID)\b/g, ""));

test("a first visit follows the browser, and a kept choice wins", () => {
  assert.equal(chooseLanguage(null, "zh-CN"), "zh");
  assert.equal(chooseLanguage(null, "zh-TW"), "zh");
  assert.equal(chooseLanguage(null, "en-GB"), "en");
  assert.equal(chooseLanguage(null, undefined), "en");
  assert.equal(chooseLanguage("en", "zh-CN"), "en");
  assert.equal(chooseLanguage("zh", "en-US"), "zh");
  assert.equal(chooseLanguage("fr", "fr-FR"), "en");
  // Outside a page - a worker, or Node - the studio writes English.
  assert.equal(language, "en");
  assert.equal(translator.t("Save preset"), "Save preset");
});

test("English is its own dictionary, with placeholders and senses", () => {
  const en = createTranslator();
  assert.equal(en.t("Ready · {count} figures", { count: 3 }), "Ready · 3 figures");
  assert.equal(en.t("clothing|Top"), "Top");
  assert.equal(en.t("contact|Rest"), "Rest");
  assert.equal(en.term("side_lying"), "side lying");
  assert.equal(en.name("Anvil (Legs on Shoulders) II"), "Anvil (Legs on Shoulders) II");
  assert.equal(en.message("Body overlap"), "Body overlap");
  assert.equal(en.list(["a", "b"]), "a, b");
});

test("Chinese translates words, names, notes and the senses of one word", () => {
  assert.equal(tr.t("Ready · {count} figures", { count: 3 }), "就绪 · 3 个人物");
  assert.equal(tr.t("Top"), "俯视");
  assert.equal(tr.t("clothing|Top"), "上衣");
  assert.equal(tr.t("contact|Surface"), "贴合");
  assert.equal(tr.t("Surface"), "支撑面");
  assert.equal(tr.t("A string nobody wrote down"), "A string nobody wrote down");
  assert.equal(tr.term("side_lying"), "侧卧");
  assert.equal(tr.term("hip_l"), "左髋");
  assert.equal(tr.list(["跪姿", "坐姿"]), "跪姿、坐姿");
  assert.equal(tr.name("Missionary"), "传教士式");
  assert.equal(tr.name("Missionary (Legs on Shoulders, Bed) II"), "传教士式（腿架肩上，床） II");
  assert.equal(tr.name("Missionary · Artistic interpretation"), "传教士式 · 艺术诠释");
  assert.equal(tr.name("Nobody's position"), "Nobody's position");
  assert.equal(tr.message("Body overlap"), "身体重叠");
  assert.equal(
    tr.message("伴侣 A: the rendered figure extends 34 mm below the floor."),
    "伴侣 A：渲染后的人物低于地面 34 毫米。",
  );
  assert.equal(tr.message("hand.left to hips: 23mm between rendered surfaces."), "左手与臀部：渲染表面相距 23 毫米。");
  assert.equal(tr.message("Figure 2: stature must be 1.4–2.1."), "人物 2：身高必须在 1.4–2.1 之间。");
  // An archetype's label is one of the studio's own words.
  assert.equal(tr.message("one partner astride the other, facing away"), "一方跨坐在另一方身上，背对对方");
  // A note nobody translated stays whole, subject and all.
  assert.equal(tr.message("伴侣 A: something new happened."), "伴侣 A: something new happened.");
});

// Every t("...") the studio writes.
function studioKeys() {
  const keys = new Set();
  for (const dir of ["src/app", "src/i18n"])
    for (const file of readdirSync(new URL(dir, root)))
      if (file.endsWith(".js") && file !== "zh.js")
        for (const match of read(`${dir}/${file}`).matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g))
          keys.add(JSON.parse(`"${match[1]}"`));
  return [...keys];
}

test("every word the studio writes has a Chinese translation", () => {
  const keys = studioKeys();
  assert.ok(keys.length > 300, `found ${keys.length} keys`);
  assert.deepEqual(keys.filter((key) => !Object.hasOwn(zh.ui, key)), []);
  const untranslated = keys.filter((key) => english(zh.ui[key].replace(/\{\w+\}/g, "")));
  assert.deepEqual(untranslated.map((key) => zh.ui[key]), []);
});

test("every text and label in the page's markup has a Chinese translation", () => {
  const html = read("index.html")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "");
  const words = (text) =>
    text
      .replace(/&amp;/g, "&")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const found = new Set();
  for (const [, text] of html.matchAll(/>([^<]+)</g)) found.add(words(text));
  for (const [, text] of html.matchAll(/\b(?:aria-label|title|placeholder)="([^"]*)"/g)) found.add(words(text));
  found.add(words(/<title>([^<]*)</.exec(read("index.html"))[1]));
  found.add(words(/name="description"\s+content="([^"]*)"/.exec(read("index.html"))[1]));
  // Letters and symbols that are not words: the logo's, the switch's own name.
  const missing = [...found].filter((text) => /[A-Za-z]{2,}/.test(text) && text !== "PoseForge" && !Object.hasOwn(zh.ui, text));
  assert.deepEqual(missing, []);
});

test("every vocabulary value the pickers and notes show has a Chinese term", () => {
  const values = [
    ...POSTURE_NAMES,
    ...ARRANGEMENT_NAMES,
    ...SURFACE_NAMES,
    ...POSEABLE_BONES.map((bone) => bone.name),
    ...CHANNELS,
    ...Object.keys(HAIR_STYLES),
    ...Object.keys(GARMENT_COLOURS),
    ...HAND_SHAPE_NAMES,
    ...FOOT_SHAPE_NAMES,
    ...BODY_TYPES,
  ];
  assert.deepEqual(values.filter((value) => !Object.hasOwn(zh.terms, value)), []);
  const labels = [
    ...Object.values(GARMENT_LABELS).map((garment) => `clothing|${garment}`),
    ...Object.values(BODY_MODELS).map((model) => model.label),
    ...Object.values(POSITION_STATUS_LABELS),
  ];
  assert.deepEqual(labels.filter((text) => !Object.hasOwn(zh.ui, text)), []);
});

test("the starter studies read in Chinese, and keep what the parser and links need", () => {
  for (const preset of BUILTIN_PRESETS) {
    const local = localizePreset(preset, tr);
    for (const text of [local.title, local.description, local.category, ...local.scene.actors.map((a) => a.label)])
      assert.ok(!english(text), `${preset.id}: ${text}`);
    assert.equal(local.id, preset.id);
    assert.deepEqual(local.tags, preset.tags);
    assert.equal(local.scene.description, preset.scene.description);
  }
  // English leaves a preset as it was.
  assert.equal(localizePreset(BUILTIN_PRESETS[0], createTranslator()), BUILTIN_PRESETS[0]);
});

test("all 1283 positions, and their artistic and generated versions, read in Chinese", () => {
  const entries = checkSourceCatalog(json("public/catalog/sexposes-v1.json"), json("src/data/source-manifest.json"));
  const studies = checkInteractionStudies(
    json("public/catalog/interaction-studies-v1.json"),
    json("src/data/interaction-manifest.json"),
    entries,
  );
  const positions = interactionPositions(studies, entries);
  assert.equal(positions.length, 1283);
  const artistic = checkArtisticStudies(
    json("public/catalog/artistic-studies-v1.json"),
    json("src/data/artistic-manifest.json"),
    entries,
  );
  const generated = checkGeneratedStudies(
    json("public/catalog/generated-studies-v1.json"),
    json("src/data/source-manifest.json").generated,
    entries,
  );
  const byId = new Map(positions.map((position) => [position.source.recordId, position]));
  const everything = [
    ...positions,
    ...entries.map((entry) => artisticPreset(entry, artistic, byId.get(entry.sourceId)?.title)),
    ...entries.map((entry) => generatedPosition(entry, generated, byId.get(entry.sourceId)?.title)),
  ];
  const left = new Set();
  for (const preset of everything) {
    const local = localizePreset(preset, tr);
    const texts = [
      local.title,
      local.description,
      local.category,
      local.position?.name,
      local.scene.title,
      ...local.scene.actors.map((actor) => actor.label),
      ...(local.inputWarnings ?? []),
    ];
    for (const text of texts) if (english(text)) left.add(text);
    assert.equal(local.id, preset.id);
    assert.equal(local.scene.description, preset.scene.description);
  }
  assert.deepEqual([...left].slice(0, 10), []);
});

test("an interaction's description is rebuilt from its parts", () => {
  const text =
    "Missionary: Face to face, one partner above. Also known as Scissors, Face to Face. 2 clothed figures in reclining and kneeling positions on a bed. Approximate template-based 3D interpretation of its source image.";
  assert.equal(
    describe(text, tr),
    "传教士式：面对面，一方在上。又称剪刀式、面对面。2 位着装人物，呈躺姿、跪姿，在床上。基于模板、取材自源图像的近似 3D 诠释。",
  );
  assert.equal(label("Partner B", tr), "伴侣 B");
  assert.equal(label("Figure A · Right high", tr), "人物 A · 右高举");
  assert.equal(label("Alex", tr), "Alex");
});

/**
 * Bake 3D interaction studies offline: every SexPoses reference, classified by
 * eye into an interaction template (scripts/data/interaction-classifications.json),
 * is composed with fixed placements, fixed joints and declared contacts, then
 * measured and checked. Usage: node scripts/build-interaction-studies.mjs [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { planFor, TEMPLATES } from "./interaction-templates.mjs";
import { compose, measure, sceneFor, evaluate } from "./interaction-composer.mjs";
import { checkScene } from "../src/core/catalog.js";
import { checkInteractionStudies, INTERACTION_SEMANTICS, templateLabel } from "../src/core/interactionStudies.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const OUTFITS = ["sage", "navy", "clay"];
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places || 0;

/** Classification fields that decide the composed scene; the image id and confidence do not. */
const planKey = ({ id, confidence, ...rest }) => JSON.stringify(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b)));

/** Compose one classification into a checked, rounded scene. */
export function composeStudy(cls) {
  const plan = planFor(cls);
  const specs = compose(plan);
  const letters = new Map(Object.entries(plan.roles ?? { a: 0 }).map(([role, index]) => [index, role.toUpperCase()]));
  if (plan.thirdIndex != null) letters.set(plan.thirdIndex, "C");
  const actors = specs.map((spec, i) => {
    const { prefer, soloSurface, override, tilt, ...clean } = spec;
    const joints = Object.fromEntries(
      Object.entries(clean.joints).map(([bone, channels]) => [bone, Object.fromEntries(Object.entries(channels).map(([k, v]) => [k, round(v, 2)]))])
    );
    return {
      ...clean,
      id: `partner-${i + 1}`,
      label: `Partner ${letters.get(i) ?? String.fromCharCode(65 + i)}`,
      outfit: OUTFITS[i % OUTFITS.length],
      wearing: ["top", "shorts"],
      joints,
      placement: {
        ...clean.placement,
        position: clean.placement.position.map((v) => round(v, 4)),
        rotation: clean.placement.rotation.map((v) => round(v, 3)),
      },
    };
  });
  // Fixed joints already carry the limb shapes; drop any descriptive limb phrase the scene reader cannot parse.
  for (const actor of actors)
    for (const key of ["arms", "legs", "trunk"]) {
      if (actor[key] == null) continue;
      const probe = sceneFor(plan, actors).issues.some((issue) => issue.message.includes(`"${actor[key]}"`) && issue.message.startsWith(actor.id));
      if (probe) delete actor[key];
    }
  const { scene } = sceneFor(plan, actors);
  checkScene(JSON.parse(JSON.stringify(scene)));
  const result = evaluate(plan, measure(scene));
  return { scene: JSON.parse(JSON.stringify(scene)), surface: plan.surface, passed: result.pass, failures: result.failures };
}

function runWorkers(jobs) {
  const threads = Math.max(1, Math.min(4, availableParallelism()));
  const results = new Array(jobs.length);
  let next = 0;
  return new Promise((done, fail) => {
    let live = 0;
    const start = () => {
      if (next >= jobs.length) {
        if (!live) done(results);
        return;
      }
      live += 1;
      const worker = new Worker(fileURLToPath(import.meta.url));
      const feed = () => {
        if (next >= jobs.length) return worker.postMessage(null);
        const index = next++;
        worker.postMessage({ index, cls: jobs[index] });
      };
      worker.on("message", ({ index, value, error }) => {
        if (error) return fail(new Error(`${jobs[index].id}: ${error}`));
        results[index] = value;
        feed();
      });
      worker.on("error", fail);
      worker.on("exit", () => {
        live -= 1;
        if (!live && next >= jobs.length) done(results);
      });
      feed();
    };
    for (let i = 0; i < threads; i++) start();
  });
}

export async function buildInteractionStudies(entries, classifications) {
  const byId = new Map(classifications.map((c) => [c.id, c]));
  const unique = new Map();
  for (const entry of entries) {
    const cls = byId.get(entry.sourceId);
    if (!cls) throw new Error(`No interaction classification for ${entry.sourceId}.`);
    if (!TEMPLATES[cls.template] && cls.template !== "solo" && cls.template !== "group_three")
      throw new Error(`${entry.sourceId}: unknown template ${cls.template}.`);
    const key = planKey(cls);
    if (!unique.has(key)) unique.set(key, cls);
  }
  const keys = [...unique.keys()];
  const composed = await runWorkers(keys.map((k) => unique.get(k)));
  const scenes = new Map(keys.map((k, i) => [k, composed[i]]));
  const studies = entries.map((entry) => {
    const cls = byId.get(entry.sourceId);
    const study = scenes.get(planKey(cls));
    const label = templateLabel(cls.template === "group_three" ? cls.base : cls.template);
    const participants = study.scene.actors.length;
    const title = `Interaction ${entry.sourceId.replace(/^img-/, "")} · ${label}`.slice(0, 80);
    return {
      sourceId: entry.sourceId,
      annotationHash: entry.annotationHash,
      template: cls.template,
      ...(cls.template === "group_three" ? { base: cls.base } : {}),
      title,
      classificationConfidence: cls.confidence ?? null,
      surface: study.surface,
      checks: { passed: study.passed, failures: study.failures },
      ...(participants !== entry.figures ? { note: `Classified with ${participants} participants; the annotation lists ${entry.figures}.` } : {}),
      scene: { ...structuredClone(study.scene), title, description: "" },
    };
  });
  const pack = { format: "poseforge.interaction-studies", version: 1, studies };
  checkInteractionStudies(pack, { records: entries.length }, entries);
  const data = JSON.stringify(pack) + "\n";
  const perTemplate = {};
  for (const s of studies) {
    const t = (perTemplate[s.template] ??= { records: 0, passed: 0 });
    t.records += 1;
    if (s.checks.passed) t.passed += 1;
  }
  const manifest = {
    format: "poseforge.interaction-manifest",
    version: 1,
    file: "catalog/interaction-studies-v1.json",
    bytes: Buffer.byteLength(data),
    sha256: hash(data),
    records: studies.length,
    distinctScenes: scenes.size,
    participants: studies.reduce((n, s) => n + s.scene.actors.length, 0),
    passedChecks: studies.filter((s) => s.checks.passed).length,
    templates: Object.fromEntries(Object.entries(perTemplate).sort(([a], [b]) => a.localeCompare(b))),
    semantics: INTERACTION_SEMANTICS,
  };
  return { data, manifest, pack };
}

if (!isMainThread) {
  parentPort.on("message", (job) => {
    if (!job) return process.exit(0);
    try {
      parentPort.postMessage({ index: job.index, value: composeStudy(job.cls) });
    } catch (error) {
      parentPort.postMessage({ index: job.index, error: error.message });
    }
  });
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const entries = JSON.parse(readFileSync(resolve(root, "public/catalog/sexposes-v1.json"))).entries;
  const classifications = JSON.parse(readFileSync(resolve(root, "scripts/data/interaction-classifications.json")));
  const { data, manifest } = await buildInteractionStudies(entries, classifications);
  for (const [path, text] of [
    [resolve(root, "public", manifest.file), data],
    [resolve(root, "src/data/interaction-manifest.json"), JSON.stringify(manifest, null, 2) + "\n"],
  ]) {
    if (process.argv.includes("--check")) {
      if (readFileSync(path, "utf8") !== text) throw new Error(`Artifact differs: ${path}`);
    } else writeFileSync(path, text);
  }
  console.log(JSON.stringify({ ...manifest, templates: undefined }, null, 2));
}

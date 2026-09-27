/**
 * The architectural invariants.
 *
 * These are not about behaviour, they are about shape: rules that no single
 * module can violate visibly but that the whole system depends on. A unit test
 * is the only place they can be written down where breaking them costs
 * something.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every `.js` file under `dir`, recursively. */
function sources(dir) {
  const found = [];
  const walk = (at) => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".js") || entry.endsWith(".mjs")) found.push(path);
    }
  };
  walk(join(root, dir));
  return found;
}

/** Bare module specifiers - the things that must come from node_modules. */
function packageImports(source) {
  // Strip comments first, so prose like "adapted from ..." cannot be read as a
  // module specifier. Only used for import detection, so mangling a URL inside
  // a string literal costs nothing.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  const found = new Set();
  // `from "x"` is the reliable signal and survives the multi-line import form
  // that this codebase uses for three.js. The lookbehind is what keeps it from
  // firing inside a string: the filler-word list in lexicon.js contains the
  // literal `"from", "so"`, where an unguarded pattern reads the gap between
  // the two strings as a module named ", ".
  const clauses = /(?<![\w"'])from\s*["']([^"']+)["']/g;
  // Plus the side-effect form, which has no `from` at all.
  const bare = /^\s*import\s*["']([^"']+)["']/gm;

  for (const pattern of [clauses, bare]) {
    pattern.lastIndex = 0;
    for (let m = pattern.exec(code); m; m = pattern.exec(code)) {
      const specifier = m[1];
      // Relative and absolute paths are our own files; everything else is a
      // package, including node: builtins, which are fine in scripts and tests.
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
      if (specifier.startsWith("node:")) continue;
      found.add(specifier);
    }
  }
  return found;
}

test("the import scanner can actually see an import", () => {
  // The two rules below are only worth anything if this does not silently find
  // nothing. It missed three.js once already, by assuming every import fits on
  // one line - which made the confinement rule pass vacuously.
  const seen = packageImports(readFileSync(join(root, "src/render/renderer.js"), "utf8"));
  assert.deepEqual([...seen], ["three"], "the scanner cannot see the multi-line three.js import");
  assert.deepEqual(
    [...packageImports(`import { a } from "./local.js";\nimport b from "node:fs";`)],
    [],
    "local and builtin imports must not be reported as packages"
  );
  assert.deepEqual([...packageImports(`export const X = { side: "l" };`)], []);
  assert.deepEqual([...packageImports(`import "sideeffect";`)], ["sideeffect"]);
  // The exact shape that fooled an earlier version of this scanner.
  assert.deepEqual([...packageImports(`const FILLER = ["by", "for", "from", "so"];`)], []);
  assert.deepEqual([...packageImports(`const parts = line.split(", ");`)], []);
});

test("the geometric core depends on nothing", () => {
  // The entire geometry pipeline has to run headless in plain node. That is
  // what makes `scripts/validate-*.mjs` possible and what lets the CLI render
  // without a GPU - the moment a core module reaches for THREE.Vector3, the
  // validators stop being runnable and the system loses its only objective
  // check that the geometry is right.
  const free = [
    ...sources("src/core"),
    ...sources("src/nlp"),
    ...sources("scripts"),
    join(root, "src/render/meshBuilder.js"),
  ];
  assert.ok(free.length > 15, `only found ${free.length} files to check`);

  for (const file of free) {
    const imports = packageImports(readFileSync(file, "utf8"));
    assert.deepEqual(
      [...imports],
      [],
      `${relative(root, file)} imports ${[...imports].join(", ")}; this zone must stay dependency-free`
    );
  }
});

test("three.js is confined to the drawing layer", () => {
  // Not a style rule: anything that imports three cannot be exercised by the
  // validators or the headless renderer, so the boundary is also the boundary
  // of what is mechanically checkable.
  const allowed = new Set([
    "src/render/renderer.js",
    "src/render/props.js",
    "src/render/room.js",
    "src/render/exporters.js",
  ]);
  for (const file of [...sources("src")]) {
    const path = relative(root, file).split("\\").join("/");
    if (!packageImports(readFileSync(file, "utf8")).has("three")) continue;
    assert.ok(allowed.has(path), `${path} imports three.js but is not part of the drawing layer`);
  }
});

test("the core never reaches for the browser", () => {
  // `document`, `window` and `self` in a core module mean it cannot be tested,
  // validated, or run in the CLI. The worker is exempt - it *is* browser code.
  const globals = /\b(document|window|localStorage|navigator)\s*\./g;
  for (const file of [...sources("src/core"), ...sources("src/nlp")]) {
    const source = readFileSync(file, "utf8");
    const hit = globals.exec(source);
    globals.lastIndex = 0;
    assert.equal(hit, null, `${relative(root, file)} touches ${hit?.[1]}, so it cannot run headless`);
  }
});

test("the runtime has no reference-era modules, APIs or URL routes", () => {
  const forbidden =
    /\b(createReference|ReferenceStudies|referenceStudy|referenceLoader|referenceCatalog|referencePreviews)\b|[?&]reference=|[?&]preview=/;
  for (const file of sources("src")) {
    const source = readFileSync(file, "utf8");
    assert.equal(
      forbidden.exec(source),
      null,
      `${relative(root, file)} still exposes a reference-era runtime path`,
    );
    forbidden.lastIndex = 0;
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NAMED_PRESETS, checkScene } from "../src/core/catalog.js";
import { solveScene } from "../src/core/solver.js";
import { solvedPreview } from "../src/core/posePreview.js";

const script = fileURLToPath(
  new URL("../scripts/validate-named-presets.mjs", import.meta.url),
);
const run = (...args) =>
  spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("the named audit selects one entry and its exit status matches the quality verdict", () => {
  const clean = run("--preset", "builtin.named.chair_straddle");
  assert.equal(clean.status, 0, clean.stderr);
  const lines = clean.stdout.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).id, "builtin.named.chair_straddle");
  assert.match(
    lines[1],
    /^1\/1 named presets have no base-model quality flags/,
  );

  const preset = NAMED_PRESETS.find(
    (entry) => entry.id === "builtin.named.side_by_side_facing",
  );
  const issues = solvedPreview(solveScene(checkScene(preset.scene))).issues;
  const result = run("--preset", preset.id);
  assert.equal(result.status, issues.length ? 1 : 0);
  assert.deepEqual(
    JSON.parse(result.stdout.trim().split("\n")[0]).issues,
    issues,
  );
});

test("an invalid audit selection cannot silently pass an empty set", () => {
  for (const args of [
    ["--preset"],
    ["--preset", "--rendered"],
    ["--preset", "unknown"],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--preset needs|Unknown named preset/);
    assert.equal(result.stdout, "");
  }
});

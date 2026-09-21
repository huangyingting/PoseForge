import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NAMED_PRESETS } from "../src/core/catalog.js";

test("CLI scene and preset renders honor saved views and an explicit view wins", () => {
  const directory = mkdtempSync(join(tmpdir(), "poseforge-camera-test-"));
  const script = fileURLToPath(new URL("../scripts/render-cli.mjs", import.meta.url));
  const preset = NAMED_PRESETS.find((entry) => entry.id === "builtin.named.side_by_side_facing");
  const sceneFile = join(directory, "scene.json"), out = join(directory, "render.png");
  writeFileSync(sceneFile, JSON.stringify(preset.scene));
  const render = (...args) => {
    const result = spawnSync(process.execPath, [
      script, ...args, "--width", "96", "--height", "96", "--aa", "1", "--out", out, "--quiet",
    ], { encoding: "utf8", timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const bytes = readFileSync(out);
    assert.ok(bytes.length > 500);
    return bytes;
  };
  try {
    const top = render("--preset", preset.id, "--view", "top");
    assert.deepEqual(render("--preset", preset.id), top);
    assert.deepEqual(render("--scene", sceneFile), top);
    const front = render("--scene", sceneFile, "--view", "front");
    assert.notDeepEqual(front, top);
    assert.deepEqual(render("--preset", preset.id, "--view", "front"), front);
    // Raw diagnostic scenes are tolerant input; malformed saved cameras must
    // not turn a previously renderable scene into a type error.
    writeFileSync(sceneFile, JSON.stringify({
      ...preset.scene, camera: { view: 42 },
    }));
    assert.deepEqual(
      render("--scene", sceneFile),
      render("--preset", preset.id, "--view", "three_quarter"),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

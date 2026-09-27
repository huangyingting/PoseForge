/**
 * Regenerate the scanned bodies in assets/models from scripts/models/bodies.json.
 *
 *   node scripts/models/make-bodies.mjs [name ...] [--out dir] [--atlas px]
 *
 * Each body is built by MakeHuman Community 1.3 (makehuman_body.py, run as a
 * plugin under a private MakeHuman home so the user's own settings are never
 * touched), converted to GLB by Blender (fbx_to_glb.py), and written as
 * realistic-<name>.glb beside skin-<name>.png, the diffuse photograph of the
 * MakeHuman skin the spec names (a body with `atlasOf` wears that body's
 * instead, as the neutral ones wear the female skins). The GLB is then parsed
 * the way the app parses it, so a file that would not load is caught here
 * rather than in a browser.
 *
 * Every body of a type shares that type's height, muscle, weight and
 * proportions; a variant changes only the ethnic or age macro and the skin.
 * The `modifiers` some of them carry move the breasts, and only so far as puts
 * the painted areola where the collision field's bust is (the field is fitted
 * to the default female; see `bust` in src/core/body.js). They were found by
 * sampling each skin through the mesh's UVs on the rest pose, and a body whose
 * macros change will need them found again.
 *
 * Needs MakeHuman (MAKEHUMAN, default /usr/share/makehuman-community) and a
 * Python for it with PyQt5, PyOpenGL and numpy<2 (MAKEHUMAN_PYTHON, default
 * ~/.cache/poseforge-models/mh-venv/bin/python), xvfb-run, Blender 4
 * (BLENDER, default blender), and ImageMagick's `convert` when --atlas asks
 * for a size other than the photograph's own 2048px.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHumanTemplate } from "../../src/core/humanMesh.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const [, value] = args.splice(at, 2);
  return value;
};
const out = resolve(option("out", join(here, "../../assets/models")));
const atlas = Number(option("atlas", 2048));
const MAKEHUMAN = process.env.MAKEHUMAN ?? "/usr/share/makehuman-community";
const PYTHON = process.env.MAKEHUMAN_PYTHON ?? join(homedir(), ".cache/poseforge-models/mh-venv/bin/python");
const BLENDER = process.env.BLENDER ?? "blender";

const bodies = JSON.parse(readFileSync(join(here, "bodies.json"), "utf8"));
const names = args.length ? args : Object.keys(bodies);
for (const name of names) if (!bodies[name]) throw new Error(`no body "${name}" in bodies.json`);

// A MakeHuman home of our own: it loads user plugins only when its settings
// name them, and it writes those settings back on exit.
const work = mkdtempSync(join(tmpdir(), "poseforge-bodies-"));
const home = join(work, "makehuman", "v1py3");
mkdirSync(join(home, "plugins"), { recursive: true });
copyFileSync(join(here, "makehuman_body.py"), join(home, "plugins", "9_poseforge_body.py"));
const settings = {
  version: "1.3.0",
  _versionSentinel: "B26472743DC5DCE1721ADB5A91AAECAA",
  activeUserPlugins: ["9_poseforge_body"],
};

const run = (command, argv, options, what) => {
  const result = spawnSync(command, argv, { encoding: "utf8", maxBuffer: 1 << 28, ...options });
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result;
};

try {
  for (const name of names) {
    const body = bodies[name];
    const fbx = join(work, `${name}.fbx`);
    const glb = join(out, `realistic-${name}.glb`);
    writeFileSync(join(home, "settings.ini"), JSON.stringify(settings));

    const made = run(
      "xvfb-run",
      ["-a", PYTHON, "makehuman.py", "--noshaders"],
      {
        cwd: MAKEHUMAN,
        timeout: 300_000,
        env: { ...process.env, MH_HOME_LOCATION: work, POSEFORGE_BODY: JSON.stringify(body), POSEFORGE_OUTPUT: fbx },
      },
      `MakeHuman (${name})`,
    );
    if (!existsSync(fbx)) throw new Error(`MakeHuman wrote no FBX for ${name}:\n${made.stdout?.slice(-4000)}${made.stderr?.slice(-4000)}`);

    const converted = run(
      BLENDER,
      ["--background", "--factory-startup", "--python", join(here, "fbx_to_glb.py"), "--", fbx, glb, name],
      { timeout: 300_000 },
      `Blender (${name})`,
    );
    if (converted.status !== 0 || /Traceback/.test(converted.stdout + converted.stderr) || !existsSync(glb))
      throw new Error(`Blender could not convert ${name}:\n${converted.stdout.slice(-4000)}${converted.stderr.slice(-4000)}`);

    // The skin's diffuse photograph, named by its .mhmat - unless the body
    // wears another body's (`atlasOf`), when there is nothing to write.
    const material = readFileSync(join(MAKEHUMAN, "data/skins", body.skin, `${body.skin}.mhmat`), "utf8");
    const texture = resolve(join(MAKEHUMAN, "data/skins", body.skin), material.match(/^diffuseTexture\s+(\S+)/m)[1]);
    const skin = join(out, `skin-${name}.png`);
    if (body.atlasOf) {
      if (bodies[body.atlasOf]?.skin !== body.skin) throw new Error(`${name} wears ${body.atlasOf}'s atlas but names another skin`);
    } else if (atlas === 2048) copyFileSync(texture, skin);
    else {
      const resized = run(
        "convert",
        [texture, "-resize", `${atlas}x${atlas}`, "-strip", "-interlace", "none", "-depth", "8", `PNG24:${skin}`],
        {},
        `convert (${name})`,
      );
      if (resized.status !== 0) throw new Error(`convert could not resize ${texture}:\n${resized.stderr}`);
    }

    const bytes = readFileSync(glb);
    const template = buildHumanTemplate(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const triangles = template.submeshes.reduce((sum, part) => sum + part.indices.length / 3, 0);
    console.log(
      `${name}: ${(bytes.length / 2 ** 20).toFixed(2)} MiB, ${template.submeshes.length} parts, ` +
        `${triangles} triangles, ${template.joints.length} joints; skin ${body.atlasOf ? `of ${body.atlasOf}` : body.skin}`,
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

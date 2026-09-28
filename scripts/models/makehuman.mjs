/**
 * What make-hair.mjs and make-faces.mjs share: running the plugin in
 * MakeHuman against one body, finding the transform from MakeHuman's
 * coordinates to the template's, and splitting a proxy's vertices the way the
 * cards are split.
 *
 * Needs what make-bodies.mjs needs to run MakeHuman.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHumanTemplate } from "../../src/core/humanMesh.js";

const here = fileURLToPath(new URL(".", import.meta.url));
export const models = resolve(join(here, "../../assets/models"));
export const MAKEHUMAN = process.env.MAKEHUMAN ?? "/usr/share/makehuman-community";
const PYTHON = process.env.MAKEHUMAN_PYTHON ?? join(homedir(), ".cache/poseforge-models/mh-venv/bin/python");

export const bodies = JSON.parse(readFileSync(join(here, "bodies.json"), "utf8"));

export const run = (command, argv, options, what) => {
  const result = spawnSync(command, argv, { encoding: "utf8", maxBuffer: 1 << 28, ...options });
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result;
};

/**
 * Build one body in MakeHuman, under a MakeHuman home of its own in `work`,
 * with the plugin installed and `env` set, and read back the JSON it wrote to
 * `output`.
 */
export function fit(name, work, env, output) {
  const home = join(work, "makehuman", "v1py3");
  mkdirSync(join(home, "plugins"), { recursive: true });
  copyFileSync(join(here, "makehuman_body.py"), join(home, "plugins", "9_poseforge_body.py"));
  writeFileSync(
    join(home, "settings.ini"),
    JSON.stringify({ version: "1.3.0", _versionSentinel: "B26472743DC5DCE1721ADB5A91AAECAA", activeUserPlugins: ["9_poseforge_body"] }),
  );
  const made = run(
    "xvfb-run",
    ["-a", PYTHON, "makehuman.py", "--noshaders"],
    {
      cwd: MAKEHUMAN,
      timeout: 300_000,
      env: { ...process.env, MH_HOME_LOCATION: work, POSEFORGE_BODY: JSON.stringify(bodies[name]), ...env },
    },
    `MakeHuman (${name})`,
  );
  if (!existsSync(output)) throw new Error(`MakeHuman wrote nothing for ${name}:\n${made.stdout?.slice(-4000)}${made.stderr?.slice(-4000)}`);
  return JSON.parse(readFileSync(output, "utf8"));
}

/** A body's GLB, parsed as the app parses it. */
export function template(file) {
  const bytes = readFileSync(join(models, `realistic-${file}.glb`));
  return buildHumanTemplate(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/**
 * MakeHuman's coordinates to the template's, found from the body's visible
 * vertices (`points`, as the plugin writes them) and checked against the GLB
 * it was exported as.
 */
export function calibrate(name, points) {
  let low = Infinity;
  let high = -Infinity;
  for (const p of points) {
    low = Math.min(low, p[1]);
    high = Math.max(high, p[1]);
  }
  const height = high - low;
  const toTemplate = ([x, y, z]) => [x / height, (y - low) / height, z / height];

  const glb = template(name);
  const body = glb.submeshes.find((submesh) => submesh.primary).positions;
  // Every fortieth MakeHuman vertex against every GLB one: a few hundred
  // points spread over the whole body, which is plenty to catch a wrong scale,
  // a flipped axis or a different body, at a cost of seconds.
  let worst = 0;
  for (let i = 0; i < points.length; i += 40) {
    const [x, y, z] = toTemplate(points[i]);
    let best = Infinity;
    for (let v = 0; v < body.length; v += 3) {
      const d = (body[v] - x) ** 2 + (body[v + 1] - y) ** 2 + (body[v + 2] - z) ** 2;
      if (d < best) best = d;
    }
    worst = Math.max(worst, Math.sqrt(best));
  }
  // A micron on a 1.7m body. The two agree to a tenth of that when they are
  // the same body, and differ by millimetres when they are not.
  if (worst > 6e-7) throw new Error(`${name}: MakeHuman's body is up to ${(worst * 1720).toFixed(3)}mm from realistic-${name}.glb; regenerate the GLB first`);
  return { toTemplate, height, worst, template: glb };
}

/**
 * A proxy's quads as triangles, over its vertices split wherever one carries
 * two UVs: `split[v]` is the proxy vertex the card's vertex `v` is a copy of.
 */
export function corners(trim) {
  const at = new Map();
  const split = [];
  const uvs = [];
  const corner = (vertex, uv) => {
    const key = vertex * 65536 + uv;
    if (!at.has(key)) {
      at.set(key, split.length);
      split.push(vertex);
      const [u, v] = trim.uvs[uv];
      // MakeHuman's v runs up the image; the atlases' - and so the renderers' - down it.
      uvs.push(u, 1 - v);
    }
    return at.get(key);
  };
  const triangles = [];
  trim.faces.forEach((face, f) => {
    const c = face.map((vertex, k) => corner(vertex, trim.faceUVs[f][k]));
    if (c[0] !== c[1] && c[1] !== c[2] && c[0] !== c[2]) triangles.push(c[0], c[1], c[2]);
    if (c[0] !== c[2] && c[2] !== c[3] && c[0] !== c[3]) triangles.push(c[0], c[2], c[3]);
  });
  return { split, uvs, triangles };
}

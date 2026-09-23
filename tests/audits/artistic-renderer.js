import { createRenderer } from "/src/render/renderer.js";
import { solveScene } from "/src/core/solver.js";
import { buildHumanTemplate, skinHumanMesh } from "/src/core/humanMesh.js";
import { createTemplateCache } from "/src/workers/templateCache.js";

const pack = await (await fetch("/catalog/artistic-studies-v1.json")).json();
const scans = new Map();
const templates = createTemplateCache((bodyType) => {
  const type = bodyType === "male" ? "male" : "female";
  if (!scans.has(type))
    scans.set(
      type,
      fetch(`/assets/models/realistic-${type}.glb`)
        .then((r) => r.arrayBuffer())
        .then(buildHumanTemplate),
    );
  return scans.get(type);
});
const canvas = document.querySelector("canvas");
const view = createRenderer(canvas, {
  shadows: false,
  onChange: () => view.render(),
});
view.resize(256, 192);
globalThis.renderArtisticStudy = async (index) => {
  const record = pack.studies[index],
    result = solveScene(record.scene);
  const meshes = await Promise.all(
    result.actors.map(async (a) => {
      const template = await templates(a.spec);
      const parts = skinHumanMesh(
        template,
        a.skeleton,
        a.evaluated,
        undefined,
        a.hands,
        a.hang,
      );
      return {
        id: a.id,
        bodyType: a.skeleton.bodyType,
        parts,
        source: "scanned",
        triangles: parts.reduce((n, p) => n + p.indices.length / 3, 0),
      };
    }),
  );
  const finite = meshes.every((m) =>
    m.parts.every(
      (p) =>
        p.positions.every(Number.isFinite) && p.normals.every(Number.isFinite),
    ),
  );
  const clothed = meshes.every((m) =>
    ["top", "shorts"].every((name) =>
      m.parts.some((p) => p.garment && p.name === name),
    ),
  );
  if (!finite || !clothed) throw new Error(`Invalid mesh: ${record.sourceId}`);
  view.setScene({ meshes, props: result.props });
  view.frame();
  view.setView("three_quarter");
  view.render();
  const sample = document.createElement("canvas");
  sample.width = sample.height = 64;
  const ctx = sample.getContext("2d");
  ctx.drawImage(canvas, 0, 0, 64, 64);
  const pixels = ctx.getImageData(0, 0, 64, 64).data;
  let coloured = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (
      Math.max(...pixels.slice(i, i + 3)) -
        Math.min(...pixels.slice(i, i + 3)) >
        25 &&
      pixels[i + 3] > 200
    )
      coloured++;
  if (coloured < 12)
    throw new Error(
      `No visible posed figures: ${record.sourceId} (${coloured})`,
    );
  document.querySelector("h1").textContent = record.title;
  return {
    sourceId: record.sourceId,
    figures: meshes.length,
    finite,
    clothed,
    colouredPixels: coloured,
    triangles: meshes.map((m) => m.triangles),
    maxProxyPenetration: result.quality.maxDepth,
    maxProxySupportGap: Math.max(
      ...result.actors.map((a) => a.seatResidual ?? 0),
    ),
  };
};
globalThis.artisticAuditReady = true;

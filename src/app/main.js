/**
 * The application.
 *
 * Four pieces with one thread of control between them: the panel collects a
 * sentence, the worker turns it into triangles, the viewport draws them, and
 * the exporters take the picture off to a file.
 *
 * The rule that keeps this honest is that there is exactly one way in. Typing a
 * description and dragging a slider both end up posting to the same worker and
 * coming back through the same handler, so the override controls cannot reach a
 * state the text could not, and what is on screen is always the result of a
 * full solve rather than a patch applied to a previous one.
 */

import { createRenderer, SKIN } from "../render/renderer.js";
import { exportPNG, exportSVG, download } from "../render/exporters.js";
import { buildPanel } from "./ui.js";

const canvas = document.getElementById("viewport");
const panelRoot = document.getElementById("panel");
const statusBar = document.getElementById("status");

const view = createRenderer(canvas);
const worker = new Worker(new URL("../workers/bodyWorker.js", import.meta.url), {
  type: "module",
});

/** Monotonic request id. A reply that is not the newest is stale and dropped. */
let request = 0;
let lastScene = null;
let lastStage = null;

const status = (text, busy = false) => {
  statusBar.textContent = text;
  statusBar.classList.toggle("busy", busy);
};

function solve(payload) {
  request += 1;
  status("solving…", true);
  worker.postMessage({ id: request, ...payload });
}

const panel = buildPanel(panelRoot, {
  onText: (text) => solve({ text }),
  onScene: (scene) => solve({ scene }),
  onExport: (kind, options) => exportImage(kind, options),
  onView: (name) => {
    if (name === "frame") view.frame();
    else view.setView(name);
    draw();
  },
});

/* ------------------------------------------------------------------ */
/* Worker replies                                                      */
/* ------------------------------------------------------------------ */

worker.onmessage = ({ data }) => {
  if (data.id !== request) return; // a newer request is already in flight
  if (data.stage === "error") {
    status(`failed: ${data.error.split("\n")[0]}`);
    panel.setNotes([{ level: "error", message: data.error.split("\n")[0] }]);
    return;
  }

  const firstScene = lastScene === null;
  lastScene = data.scene;
  lastStage = data.stage;

  view.setScene({ meshes: data.meshes, props: data.props });
  // The camera only re-frames when the scene is genuinely new. Refining the
  // draft into the final mesh moves the bounds by a few millimetres, and
  // re-framing on that makes the picture twitch every time a refinement lands.
  if (data.stage === "draft") view.frame();
  if (firstScene) view.setView("three_quarter");
  draw();

  panel.setInterpretation(data.interpretation);
  panel.setScene(data.scene, SKIN.map((c) => `#${c.toString(16).padStart(6, "0")}`));
  panel.setNotes(collectNotes(data));
  panel.setExportEnabled(true);

  const triangles = data.meshes.reduce((sum, mesh) => sum + mesh.triangles, 0);
  const source = data.meshes[0]?.source ?? "field";
  status(
    `${data.stage === "draft" ? "draft" : "final"} · ${source} · ` +
      `${(triangles / 1000).toFixed(1)}k tris · ` +
      `${Math.round(data.timings.parse)}ms solve · ${Math.round(data.timings.mesh)}ms mesh`,
    data.stage === "draft"
  );
};

/**
 * Everything the user ought to know about this scene, in one list.
 *
 * Parse warnings and geometry warnings are different kinds of problem and get
 * fixed differently - one by rewording, one by moving a slider - but the user
 * does not care about that distinction until they know there is a problem at
 * all. Splitting them across two places means the one they are not looking at
 * gets missed.
 */
function collectNotes(data) {
  const notes = [];
  for (const message of data.warnings) notes.push({ level: "warning", message });
  for (const message of data.quality.warnings) notes.push({ level: "warning", message });

  const depth = data.quality.maxDepth;
  if (depth > 0.045) {
    notes.push({
      level: "error",
      message: `bodies overlap by ${Math.round(depth * 1000)}mm — the pose did not resolve`,
    });
  }
  for (const actor of data.actors) {
    if (actor.seatResidual > 0.02) {
      notes.push({
        level: "warning",
        message: `${actor.label} floats ${Math.round(actor.seatResidual * 1000)}mm above the surface`,
      });
    }
  }
  return notes;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

let pending = false;

/**
 * Draw once, on the next frame.
 *
 * There is no animation loop. Nothing in the scene moves on its own, so a
 * continuous loop would spend a laptop's battery redrawing an identical
 * picture sixty times a second. Redrawing on demand and coalescing several
 * demands into one frame costs nothing when idle.
 */
function draw() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    view.render();
  });
}

function fit() {
  // The canvas's own box, not its parent's. The stage is padded - the canvas
  // is a plate floating inside it with a shadow, not a fill - so the parent's
  // rect is the padding wider and taller than the thing being drawn into, and
  // sizing the drawing buffer from it stretches every render by the padding.
  const rect = canvas.getBoundingClientRect();
  view.resize(Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height)));
  draw();
}

new ResizeObserver(fit).observe(canvas);
fit();

/* ------------------------------------------------------------------ */
/* Camera input                                                        */
/* ------------------------------------------------------------------ */

let dragging = null;

canvas.addEventListener("pointerdown", (event) => {
  dragging = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - dragging.x;
  const dy = event.clientY - dragging.y;
  dragging = { x: event.clientX, y: event.clientY };
  view.orbit(-dx * 0.006, -dy * 0.006);
  draw();
});

for (const type of ["pointerup", "pointercancel"]) {
  canvas.addEventListener(type, (event) => {
    dragging = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  });
}

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    view.dolly(Math.exp(event.deltaY * 0.0012));
    draw();
  },
  { passive: false }
);

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/** A filename from the description, so a folder of exports stays readable. */
function filename(extension) {
  const base =
    (lastScene?.description || "pose")
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "pose";
  return `${base}.${extension}`;
}

async function exportImage(kind, options) {
  // Exporting the draft would hand the user a deliberately coarse mesh as a
  // finished picture. The refinement is already on its way, so the honest
  // answer is to say so and let them press it again.
  if (lastStage === "draft") {
    status("still refining — try the export again in a moment");
    return;
  }
  try {
    if (kind === "png") {
      status(`rendering ${options.scale}x…`, true);
      const blob = await exportPNG(view, options);
      download(blob, filename("png"));
      status(`saved ${blob ? Math.round(blob.size / 1024) : 0} kB PNG`);
    } else {
      status("tracing outlines…", true);
      const svg = exportSVG(view, { width: canvas.clientWidth * 2, ...options });
      download(svg, filename("svg"), "image/svg+xml");
      status(`saved ${Math.round(svg.length / 1024)} kB SVG`);
    }
  } catch (error) {
    status(`export failed: ${error.message}`);
  }
  draw();
}

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

panel.setExportEnabled(false);

// A description in the URL makes a pose shareable as a link, which is the only
// form of saving this needs: the scene is a pure function of the sentence.
const initial =
  new URLSearchParams(location.search).get("q") ||
  "she is lying on her back on the bed, he is kneeling between her legs";
panel.setText(initial);
solve({ text: initial });

import { createRenderer, SKIN } from "../render/renderer.js";
import { exportPNG, exportSVG, download } from "../render/exporters.js";
import { parseDescription } from "../nlp/parser.js";
import {
  BUILTIN_PRESETS,
  checkScene,
  serializeCatalog,
} from "../core/catalog.js";
import { buildPanel } from "./ui.js";
import { createLibrary, DRAFT_KEY } from "./libraryStore.js";
import { buildStudio, toast, showRegion, openExport } from "./studioUI.js";

const $ = (id) => document.getElementById(id);
const clone = (value) => JSON.parse(JSON.stringify(value));
const canvas = $("viewport");
let storage;
try {
  storage = localStorage;
} catch {
  storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("Browser storage is unavailable.");
    },
    removeItem: () => {},
  };
}
const library = createLibrary(storage);
let view;
let pendingDraw = false;
function draw() {
  if (pendingDraw || !view) return;
  pendingDraw = true;
  requestAnimationFrame(() => {
    pendingDraw = false;
    view?.render();
  });
}
try {
  view = createRenderer(canvas, { onChange: draw });
} catch {
  $("viewport-error").hidden = false;
  $("viewport-error").textContent =
    "3D preview is unavailable. Enable WebGL or try another browser. You can still edit and save presets.";
}
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  $("viewport-error").hidden = false;
  $("viewport-error").textContent =
    "The 3D connection was interrupted. Reload to restore the preview; your latest scene is saved in this browser.";
});
canvas.addEventListener("webglcontextrestored", () => {
  $("viewport-error").hidden = true;
  draw();
});

const worker = new Worker(
  new URL("../workers/bodyWorker.js", import.meta.url),
  { type: "module" },
);
let request = 0;
let ready = false;
let current = null;
let shouldFrame = true;
let past = [];
let future = [];
let storageWarned = false;
let exporting = false;

function status(message, busy = false) {
  $("status").textContent = message;
  $("status").classList.toggle("busy", busy);
  $("loading").hidden = !busy;
  if (busy) $("loading").textContent = message;
}
const historyButtons = () => {
  $("undo").disabled = !past.length;
  $("redo").disabled = !future.length;
  document.querySelectorAll("[data-history]").forEach((node) => {
    node.disabled = !(node.dataset.history === "undo"
      ? past.length
      : future.length);
  });
};
function remember() {
  if (current) past.push(clone(current));
  if (past.length > 50) past.shift();
  future = [];
  historyButtons();
}
function persist() {
  if (!current) return;
  try {
    storage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, current }));
  } catch {
    if (!storageWarned) {
      toast(
        "Autosave is unavailable. Download an editable preset to keep your scene.",
      );
      storageWarned = true;
    }
  }
}
function heading() {
  $("scene-title").textContent = current.title;
  $("scene-title").title = current.title;
  $("scene-description").textContent =
    current.description || "Your scene. Your point of view.";
  $("scene-badge").textContent = current.dirty
    ? "Unsaved changes"
    : current.id?.startsWith("user.")
      ? "My preset"
      : "Built-in study";
}
function solve(scene, { frame = false } = {}) {
  request += 1;
  ready = false;
  shouldFrame = frame;
  $("save-preset").disabled = true;
  $("open-export").disabled = true;
  $("panel").setAttribute("aria-busy", "true");
  status("Shaping your study…", true);
  worker.postMessage({ id: request, scene });
}
function apply(next, { history = true, frame = false } = {}) {
  if (history) remember();
  current = clone(next);
  heading();
  panel.setText(current.scene.description ?? "");
  panel.setInterpretation([]);
  panel.setScene(
    current.scene,
    SKIN.map((color) => `#${color.toString(16).padStart(6, "0")}`),
  );
  studio.setSelected(current.id);
  persist();
  solve(current.scene, { frame });
}
function selectPreset(preset, options = {}) {
  apply({ ...preset, dirty: false }, { frame: true, ...options });
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("preset", preset.id);
  history.replaceState(null, "", url);
  showRegion("studio");
}
function edit(scene) {
  const next = { ...current, scene, dirty: true };
  apply(next);
  const url = new URL(location.href);
  url.search = "";
  history.replaceState(null, "", url);
}
function textScene(text) {
  const parsed = parseDescription(text);
  for (const actor of parsed.scene.actors) {
    if (!actor.wearing?.length) actor.wearing = ["top", "shorts"];
  }
  apply(
    {
      id: null,
      title: "Custom study",
      description: text,
      category: "My studies",
      tags: [],
      scene: parsed.scene,
      dirty: true,
    },
    { frame: true },
  );
  panel.setInterpretation(parsed.interpretation);
  const url = new URL(location.href);
  url.search = "";
  history.replaceState(null, "", url);
}

const panel = buildPanel($("panel"), {
  onScene: edit,
  onText: textScene,
  onHistory: travel,
});
const studio = buildStudio(library, {
  select: selectPreset,
  newStudy() {
    apply(
      {
        id: null,
        title: "Untitled study",
        description: "",
        category: "My studies",
        tags: [],
        dirty: true,
        scene: {
          actors: [
            {
              id: "figure-a",
              label: "Figure A",
              bodyType: "female",
              posture: "standing",
              wearing: ["top", "shorts"],
              outfit: "sage",
            },
          ],
          support: { surface: "floor" },
          relationship: { contactMode: "custom" },
          contacts: [],
          camera: { view: "three_quarter" },
        },
      },
      { frame: true },
    );
    const url = new URL(location.href);
    url.search = "";
    history.replaceState(null, "", url);
    showRegion("studio");
  },
  saved(preset) {
    current = { ...preset, dirty: false };
    heading();
    persist();
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("preset", preset.id);
    history.replaceState(null, "", url);
  },
  deleted(id) {
    if (current.id === id) {
      current.id = null;
      current.dirty = true;
      heading();
      persist();
      const url = new URL(location.href);
      url.search = "";
      history.replaceState(null, "", url);
    }
  },
});

function collectNotes(data) {
  const notes = [...data.warnings, ...data.quality.warnings].map((message) => ({
    level: "warning",
    message,
  }));
  if (data.quality.maxDepth > 0.045)
    notes.push({
      level: "error",
      message: `Figures overlap by ${Math.round(data.quality.maxDepth * 1000)} mm. Try another arrangement or adjust the pose.`,
    });
  for (const actor of data.actors)
    if (actor.seatResidual > 0.02)
      notes.push({
        level: "warning",
        message: `${actor.label} has a ${Math.round(actor.seatResidual * 1000)} mm support gap.`,
      });
  return notes;
}
function workerFailure(message) {
  ready = false;
  $("panel").setAttribute("aria-busy", "false");
  status("This pose could not be rendered. Choose a preset to try again.");
  panel.setNotes([{ level: "error", message }]);
  toast(message);
}
worker.onerror = (event) =>
  workerFailure(
    event.message ||
      "The pose worker stopped unexpectedly. Reload to restart it.",
  );
worker.onmessage = ({ data }) => {
  if (data.id !== request) return;
  if (data.stage === "error") return workerFailure(data.error.split("\n")[0]);
  current.scene = clone({
    ...data.scene,
    camera: current.scene.camera ?? data.scene.camera,
  });
  view?.setScene({ meshes: data.meshes, props: data.props });
  if (shouldFrame) {
    view?.frame();
    setView(current.scene.camera?.view ?? "three_quarter");
    shouldFrame = false;
  }
  draw();
  panel.setScene(
    current.scene,
    SKIN.map((color) => `#${color.toString(16).padStart(6, "0")}`),
  );
  const notes = collectNotes(data);
  panel.setNotes(notes);
  panel.setContactReport(data.quality.contactDetail ?? []);
  ready = data.stage === "final";
  $("save-preset").disabled = !ready;
  $("open-export").disabled = !ready;
  $("panel").setAttribute("aria-busy", String(!ready));
  status(
    ready
      ? `Ready · ${data.scene.actors.length} ${data.scene.actors.length === 1 ? "figure" : "figures"}${notes.length ? ` · ${notes.length} pose notes` : ""}`
      : "Adding the finishing touches…",
    !ready,
  );
  persist();
};

function setView(name) {
  view?.setView(name);
  draw();
  document.querySelectorAll("[data-view]").forEach((node) => {
    const active = node.dataset.view === name;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", String(active));
  });
}
document.querySelectorAll("[data-view]").forEach(
  (node) =>
    (node.onclick = () => {
      setView(node.dataset.view);
      if (current) {
        remember();
        current.scene.camera = { view: node.dataset.view };
        current.dirty = true;
        heading();
        persist();
        const url = new URL(location.href);
        url.search = "";
        history.replaceState(null, "", url);
      }
    }),
);
$("fit-view").onclick = () => {
  view?.frame();
  draw();
};
$("material").onchange = () => {
  view?.setDisplayMode($("material").value);
  draw();
};
$("save-preset").onclick = () => {
  if (ready) studio.openSave(clone(current));
};
$("open-export").onclick = () => {
  if (ready) openExport(exportImage);
};
document
  .querySelectorAll("[data-region]")
  .forEach((node) => (node.onclick = () => showRegion(node.dataset.region)));

function travel(direction) {
  const source = direction === "undo" ? past : future;
  const target = direction === "undo" ? future : past;
  if (!source.length) return;
  target.push(clone(current));
  const previous = source.pop();
  apply(previous, { history: false, frame: true });
  historyButtons();
  const url = new URL(location.href);
  url.search = "";
  history.replaceState(null, "", url);
}
$("undo").onclick = () => travel("undo");
$("redo").onclick = () => travel("redo");
document.addEventListener("keydown", (event) => {
  if (
    document.querySelector("dialog[open]") ||
    /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)
  )
    return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    travel(event.shiftKey ? "redo" : "undo");
  }
});
let dragging = null;
canvas.addEventListener("pointerdown", (event) => {
  dragging = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  view?.orbit(
    -(event.clientX - dragging.x) * 0.006,
    -(event.clientY - dragging.y) * 0.006,
  );
  dragging = { x: event.clientX, y: event.clientY };
  draw();
});
for (const type of ["pointerup", "pointercancel"])
  canvas.addEventListener(type, (event) => {
    dragging = null;
    if (canvas.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
  });
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    view?.dolly(Math.exp(event.deltaY * 0.0012));
    draw();
  },
  { passive: false },
);
canvas.addEventListener("keydown", (event) => {
  const keys = {
    ArrowLeft: [-0.12, 0],
    ArrowRight: [0.12, 0],
    ArrowUp: [0, -0.12],
    ArrowDown: [0, 0.12],
  };
  if (keys[event.key]) {
    event.preventDefault();
    view?.orbit(...keys[event.key]);
  } else if (["+", "="].includes(event.key)) view?.dolly(0.9);
  else if (event.key === "-") view?.dolly(1.1);
  else if (event.key.toLowerCase() === "f") view?.frame();
  else return;
  draw();
});
let lastAspect = 0;
new ResizeObserver(() => {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  view?.resize(Math.round(rect.width), Math.round(rect.height));
  const aspect = rect.width / rect.height;
  if (Math.abs(lastAspect - aspect) > 0.15) view?.frame();
  lastAspect = aspect;
  draw();
}).observe(canvas);

async function exportImage(kind, options = {}) {
  if (!ready || exporting || !current) return;
  exporting = true;
  const name =
    current.title
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿]+/g, "-")
      .replace(/^-|-$/g, "") || "poseforge-study";
  try {
    if (kind === "json") {
      download(
        serializeCatalog([
          { ...clone(current), id: current.id ?? "user.snapshot" },
        ]),
        `${name}.json`,
        "application/json",
      );
    } else {
      if (!view || !$("viewport-error").hidden)
        throw new Error("A working 3D preview is needed to export an image.");
      // A mobile user can open export from the inspector; restore the stage's dimensions first.
      showRegion("studio");
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      status("Preparing your export…", true);
      if (kind === "png")
        download(await exportPNG(view, options), `${name}.png`);
      else
        download(
          exportSVG(view, { width: canvas.clientWidth * 2, ...options }),
          `${name}.svg`,
          "image/svg+xml",
        );
    }
    toast("Your study was downloaded.");
  } catch (e) {
    toast(`Export failed: ${e.message}`);
  } finally {
    exporting = false;
    status("Ready");
    draw();
  }
}

const params = new URLSearchParams(location.search);
let restored = null;
try {
  const draft = JSON.parse(storage.getItem(DRAFT_KEY) ?? "null");
  if (draft?.version === 1 && draft.current) {
    restored = { ...draft.current, scene: checkScene(draft.current.scene) };
    if (typeof restored.title !== "string") restored = null;
  }
} catch {
  toast(
    "The last workspace could not be restored. Your saved library is still available.",
  );
}
if (params.has("q")) textScene(params.get("q"));
else if (params.has("preset")) {
  const preset = library.all().find((p) => p.id === params.get("preset"));
  if (!preset)
    toast("That preset is not in this browser. Opening a starter study.");
  selectPreset(preset ?? BUILTIN_PRESETS[0], { history: false });
} else if (restored) apply(restored, { history: false, frame: true });
else selectPreset(BUILTIN_PRESETS[0], { history: false });

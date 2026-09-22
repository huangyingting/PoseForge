import { createRenderer, SKIN } from "../render/renderer.js";
import { exportPNG, exportSVG, download } from "../render/exporters.js";
import { parseDescription } from "../nlp/parser.js";
import {
  BUILTIN_PRESETS,
  checkScene,
  checkSource,
  serializeCatalog,
} from "../core/catalog.js";
import { buildPanel } from "./ui.js";
import { DRAFT_KEY } from "./libraryStore.js";
import { createPersistentLibrary } from "./persistentLibrary.js";
import { buildStudio, toast, showRegion, openExport } from "./studioUI.js";
import { bindCameraInput } from "./cameraInput.js";
import { bindWorkspaceLayout } from "./workspaceLayout.js";
import { createReferenceService } from "./referenceLoader.js";

const $ = (id) => document.getElementById(id);
const clone = (value) => JSON.parse(JSON.stringify(value));
const canvas = $("viewport");
const workspace = bindWorkspaceLayout($("app"), $("focus-view"));
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
const library = await createPersistentLibrary(storage);
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
  delete $("viewport-error").dataset.referenceMissing;
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
let referenceRequest = 0;
const references = createReferenceService();

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
  $("scene-description").title = $("scene-description").textContent;
  $("scene-badge").textContent = current.dirty
    ? "Unsaved changes"
    : current.id?.startsWith("user.")
      ? "My preset"
      : current.id?.startsWith("reference.")
        ? "Approximate 3D"
        : "Built-in study";
  let source = $("scene-source");
  if (!source) {
    source = document.createElement("p");
    source.id = "scene-source";
    source.className = "source-note";
    $("scene-description").after(source);
  }
  source.hidden = !current.source;
  source.textContent = current.source
    ? `Source: SexPoses ${current.source.recordId} · independently authored study, not a verified reconstruction`
    : "";
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
function cancelReferenceLoad() {
  referenceRequest += 1;
  studio.setReferenceLoading(null);
}
function apply(next, { history = true, frame = false } = {}) {
  cancelReferenceLoad();
  if ($("viewport-error").dataset.referenceMissing) {
    delete $("viewport-error").dataset.referenceMissing;
    if (view) $("viewport-error").hidden = true;
  }
  if (history) remember();
  current = clone(next);
  heading();
  panel.setText(current.scene.description ?? "");
  panel.setInterpretation([]);
  panel.setNotes([{ level: "pending", message: "Checking this pose…" }]);
  $("show-notes").hidden = true;
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
  if (preset.id?.startsWith("reference.") && preset.source)
    url.searchParams.set("reference", preset.source.recordId);
  else url.searchParams.set("preset", preset.id);
  history.replaceState(null, "", url);
  showRegion("studio");
}
async function selectReference(value, options = {}) {
  const token = ++referenceRequest;
  studio.setReferenceLoading(
    typeof value === "string" ? `reference.sexposes.${value}` : value.id,
  );
  try {
    const entry =
      typeof value === "string" ? await references.find(value) : value;
    const preset = await references.preset(entry);
    if (token !== referenceRequest) return false;
    selectPreset(preset, options);
    if (matchMedia("(max-width: 900px)").matches) canvas.focus();
    return true;
  } catch (error) {
    if (token === referenceRequest)
      toast(
        `3D preview unavailable: ${error.message} Your current study was kept. Select the reference to retry.`,
      );
    return false;
  } finally {
    if (token === referenceRequest) studio.setReferenceLoading(null);
  }
}
function edit(scene) {
  const next = { ...current, scene, dirty: true, inputWarnings: [] };
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
      inputWarnings: parsed.warnings,
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
const studio = buildStudio(
  library,
  {
    select: selectPreset,
    previewReference: selectReference,
    associate(source) {
      if (!current) return;
      cancelReferenceLoad();
      remember();
      current = { ...current, source, dirty: true };
      heading();
      persist();
    },
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
      cancelReferenceLoad();
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
        cancelReferenceLoad();
        current.id = null;
        current.dirty = true;
        heading();
        persist();
        const url = new URL(location.href);
        url.search = "";
        history.replaceState(null, "", url);
      }
    },
  },
  references,
);

function collectNotes(data) {
  const inputWarnings = Array.isArray(current?.inputWarnings)
    ? current.inputWarnings.filter((message) => typeof message === "string")
    : [];
  const notes = [
    ...inputWarnings,
    ...data.warnings,
    ...data.quality.warnings,
  ].map((message) => ({
    level: "warning",
    message,
  }));
  notes.push(
    ...(data.quality.adjustments ?? []).map((message) => ({
      level: "info",
      message,
    })),
  );
  if (data.quality.maxDepth > 0.022)
    notes.push({
      level: data.quality.maxDepth > 0.045 ? "error" : "warning",
      message: `The body model reports ${Math.round(data.quality.maxDepth * 1000)} mm of unresolved overlap. Check the arrangement or adjust the figures.`,
    });
  if (data.quality.propPenetration > 0.022)
    notes.push({
      level: "warning",
      message: `The body model overlaps its support by ${Math.round(data.quality.propPenetration * 1000)} mm.`,
    });
  for (const actor of data.actors)
    if (actor.seatResidual > 0.02) {
      const kind =
        actor.supportMeasurement === "rendered" &&
        actor.supportPenetration >= actor.seatResidual - 1e-9
          ? "support penetration"
          : "support gap";
      notes.push({
        level: "warning",
        message: `${actor.label} has a ${Math.round(actor.seatResidual * 1000)} mm ${actor.supportMeasurement ? `${actor.supportMeasurement} ` : ""}${kind}.`,
      });
    }
  return notes;
}
function workerFailure(message) {
  ready = false;
  panel.setSolvedActors([], { complete: false });
  $("show-notes").hidden = false;
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
  if (
    current.id?.startsWith("reference.") &&
    data.meshes.some((mesh) => mesh.source !== "scanned")
  ) {
    const message =
      "Clothed 3D reference preview unavailable because a body model could not load. Reload to retry.";
    if (view) {
      $("viewport-error").textContent = message;
      $("viewport-error").dataset.referenceMissing = "true";
      $("viewport-error").hidden = false;
    }
    return workerFailure(message);
  }
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
  panel.setSolvedActors(data.actors, { complete: data.stage === "final" });
  $("show-notes").hidden = !notes.length && !data.preview?.issues.length;
  panel.setNotes(notes);
  panel.setContactReport(data.quality.contactDetail ?? []);
  if (data.preview) studio.setPreview(current.scene, data.preview);
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
        cancelReferenceLoad();
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
const cameraChanged = (kind) => {
  if (kind === "orbit")
    document.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.remove("active");
      button.setAttribute("aria-pressed", "false");
    });
};
for (const [id, factor] of [
  ["zoom-in", 0.85],
  ["zoom-out", 1 / 0.85],
])
  $(id).onclick = () => {
    view?.dolly(factor);
    draw();
  };
$("show-notes").onclick = () => {
  showRegion("edit");
  panel.showNotes();
};
$("material").onchange = () => {
  view?.setDisplayMode($("material").value);
  draw();
};
$("save-preset").onclick = () => {
  if (ready) {
    cancelReferenceLoad();
    studio.openSave(clone(current));
  }
};
$("open-export").onclick = () => {
  if (ready) {
    cancelReferenceLoad();
    openExport(exportImage);
  }
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
    /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) ||
    event.target.isContentEditable
  )
    return;
  if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    workspace.setFocus(false);
    studio.focusSearch();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    travel(event.shiftKey ? "redo" : "undo");
  }
});
const removeCameraInput = bindCameraInput(canvas, {
  orbit: (x, y) => view?.orbit(x, y),
  zoom: (factor) => view?.dolly(factor),
  frame: () => view?.frame(),
  draw,
  changed: cameraChanged,
});
document.querySelector(".skip-link").onclick = (event) => {
  event.preventDefault();
  showRegion("studio");
  canvas.focus();
};
window.addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    removeCameraInput();
    workspace.dispose();
    studio.dispose();
    library.close();
    worker.terminate();
    view?.dispose();
  }
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
    if (restored.source != null) restored.source = checkSource(restored.source);
    if (typeof restored.title !== "string") restored = null;
  }
} catch {
  toast(
    "The last workspace could not be restored. Your saved library is still available.",
  );
}
if (params.has("q")) textScene(params.get("q"));
else if (params.has("reference")) {
  apply(restored ?? { ...BUILTIN_PRESETS[0], dirty: false }, {
    history: false,
    frame: true,
  });
  await selectReference(params.get("reference"), { history: false });
} else if (params.has("preset")) {
  const preset = library.get(params.get("preset"));
  if (!preset)
    toast("That preset is not in this browser. Opening a starter study.");
  selectPreset(preset ?? BUILTIN_PRESETS[0], { history: false });
} else if (restored) apply(restored, { history: false, frame: true });
else selectPreset(BUILTIN_PRESETS[0], { history: false });

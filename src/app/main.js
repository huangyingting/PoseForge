import "@fontsource-variable/manrope";
import { createRenderer, SKIN } from "../render/renderer.js";
import { SETTINGS } from "../render/room.js";
import { exportPNG, exportSVG, download } from "../render/exporters.js";
import { parseDescription } from "../nlp/parser.js";
import {
  checkScene,
  checkSource,
  serializeCatalog,
} from "../core/catalog.js";
import { buildPanel } from "./ui.js";
import { DRAFT_KEY, STARTERS, registerPositions } from "./libraryStore.js";
import { createPersistentLibrary } from "./persistentLibrary.js";
import { buildStudio, toast, showRegion, openExport } from "./studioUI.js";
import { bindCameraInput } from "./cameraInput.js";
import { createCameraTour } from "./cameraTour.js";
import { bindWorkspaceLayout } from "./workspaceLayout.js";
import { createPositionService } from "./positionService.js";
import {
  isPositionOverride,
  positionOverrideId,
} from "../core/positionOverrides.js";
import {
  isBuiltInPosition,
  isPositionVariant,
  positionId,
  positionSourceId,
} from "../core/positionContract.js";
import { captureSolvedPose } from "../core/placement.js";
import { currentId, currentPreset } from "../core/datasetImages.js";
import { isArtisticPosition } from "../core/artisticStudies.js";
import { isInteractionPosition } from "../core/interactionStudies.js";
import {
  language,
  localizeDocument,
  message,
  setLanguage,
  t,
} from "../i18n/index.js";

const $ = (id) => document.getElementById(id);
const clone = (value) => JSON.parse(JSON.stringify(value));
localizeDocument();
// The switch names the language it switches to, in that language.
$("language").textContent = language === "zh" ? "EN" : "中文";
$("language").lang = language === "zh" ? "en" : "zh-CN";
$("language").title =
  language === "zh" ? t("Switch to English") : t("Switch to Chinese");
$("language").onclick = () => setLanguage(language === "zh" ? "en" : "zh");
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
const workspace = bindWorkspaceLayout($("app"), storage);
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
  $("viewport-error").textContent = t(
    "3D preview is unavailable. Enable WebGL or try another browser. You can still edit and save presets.",
  );
}
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  delete $("viewport-error").dataset.positionMissing;
  $("viewport-error").hidden = false;
  $("viewport-error").textContent = t(
    "The 3D connection was interrupted. Reload to restore the preview; your latest scene is saved in this browser.",
  );
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
let completedActors = null;
let current = null;
let shouldFrame = true;
let past = [];
let future = [];
let storageWarned = false;
let exporting = false;
let positionRequest = 0;
let shouldTour = false;
const positions = createPositionService();

// A position that loads is toured once round, unless the reader has asked
// for less motion or turned tours off; either way the choice is theirs.
const TOUR_KEY = "poseforge.tour.v1";
let tourOnLoad = (() => {
  try {
    const saved = storage.getItem(TOUR_KEY);
    if (saved === "on" || saved === "off") return saved === "on";
  } catch {
    // An unavailable store falls back to the default.
  }
  return !matchMedia("(prefers-reduced-motion: reduce)").matches;
})();
const tour = createCameraTour({
  read: () => view.getOrbit(),
  write: (orbit) => view.setOrbit(orbit),
  draw: () => view?.render(),
  done: () => delete canvas.dataset.touring,
});
function playTour() {
  if (!view) return;
  tour.play();
  canvas.dataset.touring = "true";
}
const stopTour = () => tour.stop();
function showTourSetting() {
  $("camera-tour").setAttribute("aria-pressed", String(tourOnLoad));
}
showTourSetting();
$("camera-tour").onclick = () => {
  tourOnLoad = !tourOnLoad;
  showTourSetting();
  try {
    storage.setItem(TOUR_KEY, tourOnLoad ? "on" : "off");
  } catch {
    // A preference; an unavailable store keeps it for this visit.
  }
  if (!tourOnLoad) stopTour();
  else if (current) playTour();
};

function status(message, busy = false) {
  $("status").textContent = message;
  $("status").classList.toggle("busy", busy);
  $("loading").hidden = !busy;
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
        t("Autosave is unavailable. Download an editable preset to keep your scene."),
      );
      storageWarned = true;
    }
  }
}
function heading() {
  $("scene-title").textContent = current.title;
  $("scene-title").title = current.title;
  $("scene-description").textContent =
    current.description || t("Your scene. Your point of view.");
  $("scene-description").title = $("scene-description").textContent;
  $("scene-badge").textContent = current.dirty
    ? t("Unsaved changes")
    : isPositionOverride(current)
      ? t("Authored · unreviewed")
      : current.id?.startsWith("user.")
        ? t("My preset")
        : isInteractionPosition(current)
          ? t("Interaction 3D")
          : isArtisticPosition(current)
            ? t("Artistic 3D")
            : isPositionVariant(current, "generated")
              ? t("Approximate 3D")
            : t("Built-in study");
  let source = $("scene-source");
  if (!source) {
    source = document.createElement("p");
    source.id = "scene-source";
    source.className = "source-note";
    $("scene-description").after(source);
  }
  source.hidden = !current.source;
  source.textContent = current.source
    ? t("Source: SexPoses {record} · {kind}, not a verified reconstruction", {
        record: current.source.recordId,
        kind: isInteractionPosition(current)
          ? t("approximate interaction")
          : isArtisticPosition(current)
            ? t("artistic interpretation")
            : current.position?.variant === "generated"
              ? t("generated approximation")
              : t("independent study"),
      })
    : "";
  $("position-actions").hidden = !current.source;
}
function solve(scene, { frame = false, tour: tourAfter = false } = {}) {
  request += 1;
  ready = false;
  completedActors = null;
  shouldFrame = frame;
  shouldTour = frame && tourAfter;
  stopTour();
  $("save-preset").disabled = true;
  $("open-export").disabled = true;
  $("position-save").disabled = true;
  $("panel").setAttribute("aria-busy", "true");
  status(t("Shaping your study…"), true);
  worker.postMessage({ id: request, scene });
}
function cancelPositionLoad() {
  positionRequest += 1;
  studio.setPositionLoading(null);
}
function apply(
  next,
  { history = true, frame = false, tour = false, selectedId } = {},
) {
  cancelPositionLoad();
  if ($("viewport-error").dataset.positionMissing) {
    delete $("viewport-error").dataset.positionMissing;
    if (view) $("viewport-error").hidden = true;
  }
  if (history) remember();
  current = clone(next);
  heading();
  panel.setText(current.scene.description ?? "");
  panel.setInterpretation([]);
  panel.setNotes([{ level: "pending", message: t("Checking this pose…") }]);
  $("show-notes").hidden = true;
  panel.setScene(
    current.scene,
    SKIN.map((color) => `#${color.toString(16).padStart(6, "0")}`),
  );
  studio.setSelected(
    selectedId ??
      (current.source && current.position?.variant !== "studio"
        ? positionId(current.source.recordId)
        : current.id),
  );
  persist();
  solve(current.scene, { frame, tour });
}
function selectPreset(preset, options = {}) {
  apply(
    { ...preset, dirty: false },
    {
      frame: true,
      tour: true,
      ...options,
      selectedId: options.catalogId ?? preset.id,
    },
  );
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("preset", options.catalogId ?? preset.id);
  if (options.variant === "generated" || options.variant === "artistic")
    url.searchParams.set("variant", options.variant);
  history.replaceState(null, "", url);
  showRegion("studio");
  if (matchMedia("(max-width: 900px)").matches) canvas.focus();
}
async function selectPosition(value, options = {}) {
  const token = ++positionRequest;
  const sourceId = typeof value === "string" ? value : value.sourceId;
  const catalogId = positionId(sourceId);
  // Only the alternates are separate scenes; anything else, including an
  // unrecognised URL value, is the canonical card and its override.
  const variant = ["artistic", "generated"].includes(options.variant)
    ? options.variant
    : undefined;
  options = { ...options, variant };
  studio.setPositionLoading(catalogId);
  try {
    if (!variant) {
      const override = library.get(positionOverrideId(sourceId));
      if (isPositionOverride(override)) {
        if (token !== positionRequest) return false;
        selectPreset(override, { ...options, catalogId });
        return true;
      }
    }
    const entry =
      typeof value === "string" ? await positions.source(value) : value;
    if (token !== positionRequest) return false;
    await loadPositions();
    if (token !== positionRequest) return false;
    const preset = variant
      ? await positions.variant(entry, variant, library.get(catalogId)?.title)
      : library.resolve(catalogId);
    if (!preset) throw new Error(t("Position is not available."));
    selectPreset(preset, { ...options, catalogId });
    if (matchMedia("(max-width: 900px)").matches) canvas.focus();
    return true;
  } catch (error) {
    if (token === positionRequest)
      toast(
        t("3D position unavailable: {reason} Your current study was kept. Select the position to retry.", {
          reason: message(error.message),
        }),
      );
    return false;
  } finally {
    if (token === positionRequest) studio.setPositionLoading(null);
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
      title: t("Custom study"),
      description: text,
      category: t("My studies"),
      tags: [],
      position: {
        type: "custom",
        name: t("Custom study"),
        variant: "studio",
      },
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
let positionsReady = null;
/** Download the built-in positions once; a failure can be retried. */
function loadPositions() {
  positionsReady ??= positions
    .positions()
    .then((list) => {
      registerPositions(list);
      studio?.refresh();
      return list.length;
    })
    .catch((error) => {
      positionsReady = null;
      throw error;
    });
  return positionsReady;
}
const studio = buildStudio(
  library,
  {
    select: selectPreset,
    loadPositions,
    openPosition: selectPosition,
    associate(source) {
      if (!current) return;
      cancelPositionLoad();
      remember();
      current = { ...current, source, dirty: true };
      heading();
      persist();
    },
    newStudy() {
      apply(
        {
          id: null,
          title: t("Untitled study"),
          description: "",
          category: t("My studies"),
          tags: [],
          position: {
            type: "custom",
            name: t("Untitled study"),
            variant: "studio",
          },
          dirty: true,
          scene: {
            actors: [
              {
                id: "figure-a",
                label: t("Figure {letter}", { letter: "A" }),
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
      workspace.open("inspector");
    },
    saved(preset) {
      cancelPositionLoad();
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
        cancelPositionLoad();
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
  positions,
);

function collectNotes(data) {
  const inputWarnings = Array.isArray(current?.inputWarnings)
    ? current.inputWarnings.filter((message) => typeof message === "string")
    : [];
  const notes = [
    ...(isPositionOverride(current)
      ? [
          t("Locally authored position override. Unreviewed; not a verified reconstruction."),
        ]
      : []),
    ...inputWarnings,
    ...data.warnings,
    ...data.quality.warnings,
  ].map((text) => ({
    level: "warning",
    message: message(text),
  }));
  notes.push(
    ...(data.quality.adjustments ?? []).map((text) => ({
      level: "info",
      message: message(text),
    })),
  );
  if (data.quality.maxDepth > 0.022)
    notes.push({
      level: data.quality.maxDepth > 0.045 ? "error" : "warning",
      message: t(
        "The body model reports {depth} mm of unresolved overlap. Check the arrangement or adjust the figures.",
        { depth: Math.round(data.quality.maxDepth * 1000) },
      ),
    });
  if (data.quality.propPenetration > 0.022)
    notes.push({
      level: "warning",
      message: t("The body model overlaps its support by {depth} mm.", {
        depth: Math.round(data.quality.propPenetration * 1000),
      }),
    });
  for (const actor of data.actors)
    if (actor.seatResidual > 0.02) {
      const penetration =
        actor.supportMeasurement === "rendered" &&
        actor.supportPenetration >= actor.seatResidual - 1e-9;
      const values = {
        figure: actor.label,
        size: Math.round(actor.seatResidual * 1000),
      };
      notes.push({
        level: "warning",
        message: penetration
          ? t("{figure} has a {size} mm rendered support penetration.", values)
          : actor.supportMeasurement === "rendered"
            ? t("{figure} has a {size} mm rendered support gap.", values)
            : actor.supportMeasurement === "body-model"
              ? t("{figure} has a {size} mm body-model support gap.", values)
              : t("{figure} has a {size} mm support gap.", values),
      });
    }
  return notes;
}
function workerFailure(reason) {
  const text = message(reason);
  ready = false;
  completedActors = null;
  $("position-save").disabled = true;
  panel.setSolvedActors([], { complete: false });
  $("show-notes").hidden = false;
  $("panel").setAttribute("aria-busy", "false");
  status(t("This pose could not be rendered. Choose a preset to try again."));
  panel.setNotes([{ level: "error", message: text }]);
  toast(text);
}
worker.onerror = (event) =>
  workerFailure(
    event.message ||
      t("The pose worker stopped unexpectedly. Reload to restart it."),
  );
worker.onmessage = ({ data }) => {
  if (data.id !== request) return;
  if (data.stage === "error") return workerFailure(data.error.split("\n")[0]);
  if (
    current.source &&
    data.meshes.some((mesh) => mesh.source !== "scanned")
  ) {
    const reason = t(
      "Clothed 3D position unavailable because a body model could not load. Reload to retry.",
    );
    if (view) {
      $("viewport-error").textContent = reason;
      $("viewport-error").dataset.positionMissing = "true";
      $("viewport-error").hidden = false;
    }
    return workerFailure(reason);
  }
  current.scene = clone({
    ...data.scene,
    camera: current.scene.camera ?? data.scene.camera,
  });
  view?.setScene({ meshes: data.meshes, props: data.props, shell: data.shell });
  if (shouldFrame) {
    view?.frame();
    setView(current.scene.camera?.view ?? "three_quarter");
    shouldFrame = false;
    if (shouldTour && tourOnLoad) playTour();
    shouldTour = false;
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
  completedActors = ready ? data.actors : null;
  $("save-preset").disabled = !ready;
  $("open-export").disabled = !ready;
  $("position-save").disabled = !ready;
  $("panel").setAttribute("aria-busy", String(!ready));
  status(
    ready
      ? [
          data.scene.actors.length === 1
            ? t("Ready · 1 figure")
            : t("Ready · {count} figures", { count: data.scene.actors.length }),
          ...(notes.length ? [t("{count} pose notes", { count: notes.length })] : []),
        ].join(" · ")
      : t("Adding the finishing touches…"),
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
      stopTour();
      setView(node.dataset.view);
      if (current) {
        cancelPositionLoad();
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
  stopTour();
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
    stopTour();
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
// Where the scene is: a room, or the plain studio backdrop. One choice for
// every scene, kept in this browser rather than in the presets.
const SETTING_KEY = "poseforge.setting.v1";
const SETTING_NAMES = {
  bedroom: t("setting|Bedroom"),
  living: t("setting|Living room"),
  studio: t("setting|Studio"),
};
$("setting").replaceChildren(
  ...SETTINGS.map((name) => new Option(SETTING_NAMES[name], name)),
);
$("setting").value = (() => {
  try {
    const saved = storage.getItem(SETTING_KEY);
    if (SETTINGS.includes(saved)) return saved;
  } catch {
    // An unavailable store falls back to the default.
  }
  return SETTINGS[0];
})();
view?.setSetting($("setting").value);
$("setting").onchange = () => {
  view?.setSetting($("setting").value);
  try {
    storage.setItem(SETTING_KEY, $("setting").value);
  } catch {
    // The room still changes for this visit.
  }
  draw();
};
$("save-preset").onclick = () => {
  if (ready) {
    cancelPositionLoad();
    studio.openSave(clone(current));
  }
};
$("position-edit").onclick = () => {
  cancelPositionLoad();
  showRegion("edit");
  panel.showFigures();
};
$("position-save").onclick = async () => {
  if (!ready || !current.source || !completedActors) return;
  cancelPositionLoad();
  const token = positionRequest;
  const snapshot = clone(current);
  try {
    snapshot.scene.actors = snapshot.scene.actors.map((actor) => ({
      ...actor,
      ...captureSolvedPose(
        completedActors.find((value) => value.id === actor.id),
      ),
    }));
    let base =
      library.get(positionId(snapshot.source.recordId)) ??
      library.get(positionOverrideId(snapshot.source.recordId));
    if (!base) {
      await loadPositions();
      base = library.get(positionId(snapshot.source.recordId));
    }
    if (!base) throw new Error(t("The source position is unavailable."));
    if (token !== positionRequest) return;
    studio.openPositionSave(snapshot, base, (preset) => {
      if (token === positionRequest)
        selectPreset(preset, {
          catalogId: positionId(snapshot.source.recordId),
        });
      else studio.refresh();
    });
  } catch (error) {
    if (token === positionRequest)
      toast(t("Position override not saved: {reason}", { reason: message(error.message) }));
  }
};
$("open-export").onclick = () => {
  if (ready) {
    stopTour();
    cancelPositionLoad();
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
    studio.focusSearch();
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === "z" || (key === "y" && !event.shiftKey)) {
      event.preventDefault();
      travel(key === "y" || event.shiftKey ? "redo" : "undo");
    }
  }
});
// Taking hold of the camera takes it over from a tour.
for (const type of ["pointerdown", "wheel", "keydown"])
  canvas.addEventListener(type, stopTour, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopTour();
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
    stopTour();
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
  if (Math.abs(lastAspect - aspect) > 0.15) {
    stopTour();
    view?.frame();
  }
  lastAspect = aspect;
  draw();
}).observe(canvas);

async function exportImage(kind, options = {}) {
  if (!ready || exporting || !current) return;
  exporting = true;
  const EXPORTING = t("Preparing your export…");
  const previousStatus = $("status").textContent;
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
        throw new Error(t("A working 3D preview is needed to export an image."));
      // A mobile user can open export from the inspector; restore the stage's dimensions first.
      showRegion("studio");
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      status(EXPORTING, true);
      if (kind === "png")
        download(await exportPNG(view, options), `${name}.png`);
      else
        download(
          exportSVG(view, { width: canvas.clientWidth * 2, ...options }),
          `${name}.svg`,
          "image/svg+xml",
        );
    }
    toast(t("Your study was downloaded."));
  } catch (e) {
    toast(t("Export failed: {reason}", { reason: message(e.message) }));
  } finally {
    exporting = false;
    // Put back the solve's own summary - unless a new solve has started while
    // the image was encoding, in which case its progress is the true status.
    if ($("status").textContent === EXPORTING) status(previousStatus);
    draw();
  }
}

const params = new URLSearchParams(location.search);
let restored = null;
try {
  const draft = JSON.parse(storage.getItem(DRAFT_KEY) ?? "null");
  if (draft?.version === 1 && draft.current) {
    const current = currentPreset(draft.current);
    restored = { ...current, scene: checkScene(current.scene) };
    if (restored.source != null) restored.source = checkSource(restored.source);
    if (typeof restored.title !== "string") restored = null;
  }
} catch {
  toast(
    t("The last workspace could not be restored. Your saved library is still available."),
  );
}
if (params.has("q")) textScene(params.get("q"));
else if (params.has("preset")) {
  const id = currentId(params.get("preset"));
  const sourceId = positionSourceId(id);
  if (sourceId) {
    apply(restored ?? STARTERS[0], { history: false, frame: true });
    await selectPosition(sourceId, {
      history: false,
      variant: params.get("variant"),
    });
  } else {
    const preset = library.resolve(id);
    if (!preset)
      toast(t("That preset is not in this browser. Opening a starter study."));
    selectPreset(preset ?? STARTERS[0], { history: false });
  }
} else if (restored)
  apply(restored, { history: false, frame: true, tour: true });
else selectPreset(STARTERS[0], { history: false });

/**
 * Layout-only state: the canvas fills the window and the library and inspector
 * are drawers layered over its edges. Opening or closing a drawer never
 * changes the current scene.
 */
import { t } from "../i18n/index.js";

export const LAYOUT_KEY = "poseforge.layout.v1";
const DRAWERS = { library: "library", inspector: "panel" };
const REGION_DRAWER = { library: "library", edit: "inspector" };
const desktop = matchMedia("(min-width: 901px)");
let active;

function readLayout(storage) {
  try {
    const saved = JSON.parse(storage.getItem(LAYOUT_KEY) ?? "null");
    return {
      library: typeof saved?.library === "boolean" ? saved.library : true,
      inspector:
        typeof saved?.inspector === "boolean" ? saved.inspector : false,
    };
  } catch {
    return { library: true, inspector: false };
  }
}

/** Small screens show one region at a time; desktop opens its drawer. */
export function showRegion(region) {
  document.getElementById("app").dataset.mobile = region;
  document.querySelectorAll("[data-region]").forEach((node) => {
    const current = node.dataset.region === region;
    node.classList.toggle("active", current);
    node.setAttribute("aria-pressed", String(current));
  });
  // Keep the desktop drawers in step so a resize shows the same place.
  if (REGION_DRAWER[region]) active?.open(REGION_DRAWER[region]);
}

export function bindWorkspaceLayout(root, storage) {
  const state = readLayout(storage);
  const toggles = [...root.querySelectorAll("[data-drawer]")];
  function apply(name) {
    const open = state[name];
    const drawer = document.getElementById(DRAWERS[name]);
    const toggle = toggles.find((node) => node.dataset.drawer === name);
    // Move focus before removing a drawer from the accessibility tree.
    if (!open && desktop.matches && drawer?.contains(document.activeElement))
      toggle?.focus();
    root.dataset[name] = open ? "open" : "closed";
    if (!toggle) return;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.title =
      name === "library"
        ? open ? t("Hide library") : t("Show library")
        : open ? t("Hide editor") : t("Show editor");
  }
  function set(name, open) {
    if (!(name in DRAWERS) || state[name] === open) return;
    state[name] = open;
    apply(name);
    try {
      storage.setItem(LAYOUT_KEY, JSON.stringify(state));
    } catch {
      // Layout is a preference; an unavailable store keeps it per session.
    }
  }
  const click = (event) => {
    const name = event.currentTarget.dataset.drawer;
    set(name, !state[name]);
  };
  // The toggles are hidden on small screens, where the region tabs take over.
  const rehome = () =>
    root.querySelector('.mobile-nav [aria-pressed="true"]')?.focus();
  const resize = () => {
    if (!desktop.matches && toggles.includes(document.activeElement)) rehome();
  };
  // Browsers may drop focus from a hidden toggle before reporting the change.
  const blur = (event) => {
    if (!event.relatedTarget && !desktop.matches) rehome();
  };
  for (const name of Object.keys(DRAWERS)) apply(name);
  toggles.forEach((node) => {
    node.addEventListener("click", click);
    node.addEventListener("blur", blur);
  });
  desktop.addEventListener("change", resize);
  const controller = {
    open: (name) => set(name, true),
    close: (name) => set(name, false),
    dispose() {
      toggles.forEach((node) => {
        node.removeEventListener("click", click);
        node.removeEventListener("blur", blur);
      });
      desktop.removeEventListener("change", resize);
      if (active === controller) active = undefined;
    },
  };
  active = controller;
  return controller;
}

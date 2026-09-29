import { searchCatalog, MAX_PACK_BYTES } from "../core/catalog.js";
import { authoredPreview, poseDiagram } from "./diagram.js";
import { createPreviewService } from "./previewService.js";
import { download } from "../render/exporters.js";
import { newId } from "./ids.js";
import { showRegion } from "./workspaceLayout.js";
import { positionCount } from "./libraryStore.js";
import { CATALOG_PAGE_SIZE, catalogPage } from "../core/sourceCatalog.js";
import {
  POSITION_STATUS_LABELS,
  isBuiltInPosition,
} from "../core/positionContract.js";
import {
  createPositionService,
  sourceManifest,
} from "./positionService.js";
import {
  isPositionOverride,
  positionOverrideId,
  positionOverrideMatches,
  checkPositionOverride,
  parsePositionOverrides,
  serializePositionOverrides,
} from "../core/positionOverrides.js";
import { language, message, number, t, term } from "../i18n/index.js";

const collator = new Intl.Collator(language === "zh" ? "zh-CN" : "en");

export const element = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const button = (text, action, className = "action") =>
  element("button", {
    type: "button",
    textContent: text,
    className,
    onclick: action,
  });
let toastTimer;
export function toast(message) {
  const node = document.getElementById("toast");
  clearTimeout(toastTimer);
  node.textContent = message;
  node.hidden = false;
  toastTimer = setTimeout(() => {
    node.hidden = true;
  }, 5500);
}

export { showRegion };

/** Dialogs use native focus containment, Escape, and restoration to the opener. */
function dialog(title) {
  const node = element("dialog");
  const heading = element("h2", {
    textContent: title,
    id: newId("dialog"),
  });
  node.setAttribute("aria-labelledby", heading.id);
  const close = button("×", () => node.close(), "icon-button");
  close.setAttribute("aria-label", t("Close dialog"));
  node.append(element("div", { className: "dialog-head" }, [heading, close]));
  document.body.append(node);
  node.addEventListener("close", () => node.remove());
  return node;
}

function field(
  label,
  value,
  { multiline = false, maxLength = 80, required = false } = {},
) {
  const id = newId("field");
  const input = element(multiline ? "textarea" : "input", {
    id,
    value,
    maxLength,
    required,
  });
  const wrapper = element("div", { className: "field" }, [
    element("label", { htmlFor: id, textContent: label }),
    input,
  ]);
  return { wrapper, input };
}

export function buildStudio(
  library,
  handlers,
  positionService = createPositionService(),
) {
  const root = document.getElementById("library");
  const previews = createPreviewService();
  let previewCleanups = [];
  const starts = new Map();
  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              if (entry.isIntersecting) {
                observer.unobserve(entry.target);
                starts.get(entry.target)?.();
                starts.delete(entry.target);
              }
          },
          { root, rootMargin: "160px" },
        );
  let selected = "";
  let scope = "positions";
  let page = 0;
  let listedIds = [];
  let sourceEntries = null;
  let positionsError = "";
  let loadingPositions = false;
  let disposed = false;
  const loadSourceEntries = positionService.sources;
  let loadingPosition = null;
  // The cards `refresh` last listed, and the library's revision it listed.
  let listed = { revision: null, cards: [] };
  // Each card's drawing of its pose as authored, while the library lists the
  // same: drawing them was most of what a page of cards cost to list again.
  let diagrams = { revision: null, drawn: new Map() };
  function authoredDiagram(preset) {
    if (diagrams.revision !== listed.revision)
      diagrams = { revision: listed.revision, drawn: new Map() };
    if (!diagrams.drawn.has(preset.id))
      diagrams.drawn.set(preset.id, poseDiagram(authoredPreview(preset.scene)));
    return diagrams.drawn.get(preset.id).cloneNode(true);
  }
  const count = element("span");
  count.setAttribute("aria-live", "polite");
  const search = element("input", {
    type: "search",
    placeholder: t("Find your next pose…"),
    id: "catalog-search",
    maxLength: 200,
  });
  search.setAttribute("aria-keyshortcuts", "/");
  const clearSearch = button(
    "×",
    () => {
      search.value = "";
      page = 0;
      refresh();
      search.focus();
    },
    "clear-search",
  );
  clearSearch.setAttribute("aria-label", t("Clear search"));
  clearSearch.hidden = true;
  const scopes = element("div", { className: "library-scopes" });
  for (const [value, label] of [
    ["positions", t("Positions")],
    ["saved", t("Saved")],
    ["favorites", t("Favorites")],
  ]) {
    const node = button(
      label,
      () => {
        scope = value;
        search.value = "";
        page = 0;
        category.value = "all";
        supportStatus.value = "all";
        refresh();
        list.scrollTop = 0;
      },
      value === scope ? "active" : "",
    );
    node.dataset.scope = value;
    scopes.append(node);
  }
  const category = element("select", { id: "catalog-category" });
  const categoryLabel = element("label", {
    htmlFor: category.id,
    textContent: t("Category"),
  });
  const supportStatus = element("select", { id: "catalog-status" }, [
    element("option", { value: "all", textContent: t("All statuses") }),
    ...Object.entries(POSITION_STATUS_LABELS).map(([value, textContent]) =>
      element("option", { value, textContent: t(textContent) }),
    ),
  ]);
  const filters = element(
    "div",
    { id: "catalog-filters", className: "catalog-filters", hidden: true },
    [
      element("div", { className: "category-field" }, [
        categoryLabel,
        category,
      ]),
      element("div", { className: "category-field" }, [
        element("label", {
          htmlFor: supportStatus.id,
          textContent: t("Support status"),
        }),
        supportStatus,
      ]),
    ],
  );
  const filterToggle = button(
    t("Filters"),
    () => setFiltersOpen(filters.hidden),
    "filter-toggle",
  );
  filterToggle.setAttribute("aria-expanded", "false");
  filterToggle.setAttribute("aria-controls", filters.id);
  const resetFilters = button(
    t("Reset filters"),
    () => {
      category.value = "all";
      supportStatus.value = "all";
      page = 0;
      refresh();
      filterToggle.focus();
    },
    "text-button reset-filters",
  );
  function setFiltersOpen(open) {
    filters.hidden = !open;
    filterToggle.setAttribute("aria-expanded", String(open));
  }
  filters.onkeydown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setFiltersOpen(false);
    filterToggle.focus();
  };
  const newStudy = button(
    t("+ New"),
    () => handlers.newStudy(),
    "action small new-study",
  );
  newStudy.setAttribute("aria-label", t("+ New study"));
  const info = button(
    "ⓘ",
    () => {
      const modal = dialog(t("About the library"));
      modal.append(
        element("p", {
          textContent: t("{records} source-linked 3D positions plus {presets} studio presets.", {
            records: number(sourceManifest.records),
            presets: library.index().filter((p) => p.status === "verified-3d").length,
          }),
        }),
        element("p", {
          textContent: t(
            "Positions and source records are one catalog. Browse broad categories, then choose a related named position. Every source-linked card opens a ready-to-view clothed 3D interaction; its details retain provenance plus the artistic and generated alternatives. These are approximate template-based interpretations, not measured reconstructions or physical certification.",
          ),
        }),
        element("p", {
          textContent: t(
            "Saved in this browser using {storage}. Up to 5,000 presets / 32 MB. Export JSON for a portable backup; this is not cloud storage.",
            { storage: t(library.mode ?? "local storage") },
          ),
        }),
        element("p", {
          textContent: t(
            "Tip: press / to search the library, Ctrl/⌘ Z to undo an edit and Ctrl/⌘ Shift Z or Ctrl Y to redo it. On desktop, the Library and Edit buttons in the top bar show or hide their panels so the 3D scene can use the whole window.",
          ),
        }),
      );
      modal.showModal();
    },
    "library-info icon-button",
  );
  info.setAttribute("aria-label", t("About this library"));
  info.title = t("Catalog counts, storage and shortcuts");
  const filterBar = element(
    "div",
    { className: "library-filter-bar", hidden: true },
    [element("span", { textContent: t("Filtered results") }), resetFilters],
  );
  const searchBox = element("div", { className: "search-box" }, [
    element("label", {
      htmlFor: search.id,
      className: "sr-only",
      textContent: t("Search presets"),
    }),
    search,
    clearSearch,
  ]);
  const positionBrowser = element("details", {
    className: "position-browser",
  });
  positionBrowser.append(
    element("summary", { textContent: t("Browse position categories") }),
    element("div", { className: "position-browser-body" }),
  );
  const top = element("div", { className: "library-top" }, [
    element("div", { className: "library-title" }, [
      element("h2", { textContent: t("Library") }),
      count,
      newStudy,
    ]),
    element("div", { className: "library-search-row" }, [
      searchBox,
      filterToggle,
    ]),
    scopes,
    positionBrowser,
    filterBar,
    filters,
  ]);
  const list = element("div", { className: "catalog-list" });
  const pageLabel = element("span", { id: "catalog-page" });
  pageLabel.setAttribute("aria-live", "polite");
  const turnPage = (delta) => {
    page += delta;
    refresh();
    list.scrollTop = 0;
  };
  const previous = button("‹", () => turnPage(-1), "icon-button");
  previous.setAttribute("aria-label", t("Previous"));
  previous.title = t("Previous page");
  const next = button("›", () => turnPage(1), "icon-button");
  next.setAttribute("aria-label", t("Next"));
  next.title = t("Next page");
  const pagination = element(
    "nav",
    { className: "catalog-pagination", hidden: true },
    [previous, pageLabel, next],
  );
  pagination.setAttribute("aria-label", t("Catalog pages"));
  const file = element("input", {
    id: "catalog-file",
    type: "file",
    accept: ".json,application/json",
    hidden: true,
  });
  const exportSavedLibrary = () => {
    if (!library.saved().length)
      return toast(t("Save your first preset to export a library."));
    try {
      download(
        library.export(),
        "poseforge-library.json",
        "application/json",
      );
      toast(t("Your saved library was downloaded."));
    } catch (error) {
      toast(t("Export failed: {reason}", { reason: message(error.message) }));
    }
  };
  const libraryTools = button(
    t("Library tools"),
    openLibraryTools,
    "text-button",
  );
  root.append(
    top,
    list,
    element("div", { className: "library-bottom" }, [
      libraryTools,
      pagination,
      info,
      element("p", {
        id: "library-storage",
        className: "sr-only",
        textContent: t("Saved in this browser · {storage}", {
          storage: t(library.mode ?? "local storage"),
        }),
      }),
      file,
    ]),
  );
  if (library.notice)
    root.insertBefore(
      element("p", {
        className: "storage-notice",
        textContent: message(library.notice),
      }),
      list,
    );
  if (library.error) {
    const recovery = element("div", { className: "recovery" }, [
      element("p", { textContent: message(library.error) }),
      button(
        t("Download stored data"),
        () => {
          try {
            download(
              library.raw(),
              "poseforge-recovery.json",
              "application/json",
            );
          } catch (e) {
            toast(message(e.message));
          }
        },
        "text-button",
      ),
      button(
        t("Reset saved library"),
        () => {
          confirmAction(
            t("Reset saved library?"),
            t("This removes the unreadable data from this browser. Download it first if you need a recovery copy."),
            async () => {
              await library.reset();
              recovery.remove();
              refresh();
              toast(t("The saved library was reset."));
            },
          );
        },
        "text-button danger",
      ),
    ]);
    root.insertBefore(recovery, list);
  }
  file.onchange = async () => {
    const chosen = file.files[0];
    if (!chosen) return;
    try {
      if (chosen.size > MAX_PACK_BYTES)
        throw new Error(t("Catalog files must be no larger than 32 MB."));
      file.disabled = true;
      const text = await chosen.text();
      // Overrides in a library backup are checked against their built-in
      // positions. A studies-only file does not need them, so a failed
      // download here is left for the import itself to report if it matters.
      if (!positionCount() && handlers.loadPositions)
        await handlers.loadPositions().catch(() => {});
      const added = await library.import(text);
      const overrides = added.filter(isPositionOverride).length;
      scope = "saved";
      page = 0;
      supportStatus.value = "all";
      search.value = "";
      category.value = "all";
      refresh();
      toast(
        overrides
          ? t("Imported {count} presets, including {overrides} position overrides. Existing presets were kept.", {
              count: added.length,
              overrides,
            })
          : added.length === 1
            ? t("Imported 1 preset. Existing presets were kept.")
            : t("Imported {count} presets. Existing presets were kept.", { count: added.length }),
      );
    } catch (e) {
      toast(t("Import failed: {reason}", { reason: message(e.message) }));
    } finally {
      file.value = "";
      file.disabled = false;
    }
  };
  search.oninput =
    category.onchange =
    supportStatus.onchange =
      () => {
        page = 0;
        refresh();
        list.scrollTop = 0;
      };

  function refresh() {
    const focusedPreset = document.activeElement?.dataset.preset;
    previewCleanups.forEach((cleanup) => cleanup());
    previewCleanups = [];
    observer?.disconnect();
    starts.clear();
    root.dataset.collection = "positions";
    listed = { revision: library.revision(), cards: [] };
    const all = library.index();
    categoryLabel.textContent = t("Category");
    search.placeholder =
      scope === "positions" ? t("Search positions…") : t("Search presets…");
    search.title =
      scope === "positions"
        ? t("Search by position name, category or surface · /")
        : t("Search presets · /");
    document.querySelector(`label[for="${search.id}"]`).textContent =
      scope === "positions" ? t("Search positions") : t("Search presets");
    const oldCategory = category.value || "all";
    category.replaceChildren(
      element("option", {
        value: "all",
        textContent: t("All categories"),
      }),
      ...[
        ...new Set(all.map((p) => p.category)),
      ]
        .sort(collator.compare)
        .map((name) => element("option", { value: name, textContent: name })),
    );
    category.value = [...category.options].some((o) => o.value === oldCategory)
      ? oldCategory
      : "all";
    clearSearch.hidden = !search.value;
    const activeFilters =
      Number(category.value !== "all") +
      Number(supportStatus.value !== "all");
    filterToggle.textContent = activeFilters
      ? t("Filters ({count})", { count: activeFilters })
      : t("Filters");
    filterToggle.setAttribute("aria-label", filterToggle.textContent);
    resetFilters.hidden = activeFilters === 0;
    filterBar.hidden = activeFilters === 0;
    scopes.querySelectorAll("button").forEach((node) => {
      const active = scope === node.dataset.scope;
      node.classList.toggle("active", active);
      node.setAttribute("aria-pressed", String(active));
    });
    list.replaceChildren();
    pagination.hidden = true;
    const favorites = library.favorites();
    const filtered = searchCatalog(all, {
      query: search.value,
      category: category.value,
      scope,
      favorites,
    }).filter(
      (p) => supportStatus.value === "all" || p.status === supportStatus.value,
    );
    listedIds = filtered.map((p) => p.id);
    const total = number(filtered.length);
    count.textContent =
      scope === "positions"
        ? filtered.length === 1
          ? t("1 position")
          : t("{count} positions", { count: total })
        : filtered.length === 1
          ? t("1 study")
          : t("{count} studies", { count: total });
    if (
      handlers.loadPositions &&
      !positionCount() &&
      scope === "positions"
    ) {
      const status = element("div", { className: "positions-status" }, [
        element("p", {
          textContent: positionsError
            ? t("The 3D positions could not load: {reason}", { reason: message(positionsError) })
            : t("Loading {count} 3D positions…", { count: number(sourceManifest.records) }),
        }),
      ]);
      if (positionsError)
        status.append(
          button(t("Retry positions"), () => {
            positionsError = "";
            refresh();
          }),
        );
      else if (!loadingPositions) {
        loadingPositions = true;
        handlers
          .loadPositions()
          .catch((error) => {
            positionsError = error.message;
          })
          .finally(() => {
            loadingPositions = false;
            if (!disposed) refresh();
          });
      }
      list.append(status);
    }
    renderPositionBrowser(all);
    const paged = updatePages(filtered);
    for (const entry of paged.entries) {
      const preset = library.get(entry.id);
      const playable = library.resolve(entry.id);
      const authored = isPositionOverride(playable) ? playable : null;
      const status = authored ? "authored-3d" : entry.status;
      const isSelected = Boolean(
        playable.id === selected ||
        preset.id === selected,
      );
      const choose = button(
        "",
        () => handlers.select(playable, { catalogId: preset.id }),
        "preset-select",
      );
      choose.dataset.preset = preset.id;
      if (preset.source) choose.dataset.source = preset.source.recordId;
      choose.setAttribute("aria-label", t("Load {title}", { title: preset.title }));
      choose.title = preset.title;
      choose.setAttribute("aria-pressed", String(isSelected));
      choose.setAttribute(
        "aria-busy",
        String(Boolean(
          preset.source &&
            loadingPosition === preset.id,
        )),
      );
      const picture = element(
        "span",
        { className: "preset-preview", title: t("Authored pose preview") },
        [authoredDiagram(preset)],
      );
      const previewNote = element("span", {
        className: "preset-note",
        id: newId("preview-note"),
        textContent: "",
      });
      choose.setAttribute("aria-describedby", previewNote.id);
      choose.append(
        picture,
        element("span", { className: "preset-info" }, [
          element("span", {
            className: "preset-name",
            textContent: preset.title,
          }),
          element("span", { className: "preset-line" }, [
            element("span", {
              className: "preset-meta",
              textContent: [
                ...(isBuiltInPosition(preset) ? [preset.position.name] : []),
                preset.scene.actors.length === 1
                  ? t("Solo")
                  : t("{count} figures", { count: preset.scene.actors.length }),
                preset.scene.support?.surface
                  ? term(
                      preset.scene.support.surface,
                      preset.scene.support.surface
                        .replace(/_/g, " ")
                        .replace(/^\w/, (letter) => letter.toUpperCase()),
                    )
                  : preset.category,
              ].join(" · "),
            }),
            element("span", {
              className: `support-badge ${status}`,
              textContent: t(POSITION_STATUS_LABELS[status]),
              title:
                status === "authored-3d"
                  ? t("Your locally authored override for this source. It is unreviewed.")
                  : status === "interaction-3d"
                  ? t("Approximate 3D interaction composed from a template; not a measured reconstruction.")
                  : status === "verified-3d"
                  ? t("Audited stock configuration only; edits need their own checks.")
                  : t("This personal preset has not been individually certified. Inspect Pose checks; adjustment may be needed."),
            }),
          ]),
          element("span", {
            className: "preset-description",
            textContent: preset.description,
          }),
          previewNote,
        ]),
      );
      const favorite = button(
        favorites.includes(preset.id) ? "★" : "☆",
        async () => {
          try {
            await library.favorite(preset.id);
            refresh();
            list.querySelector(`[data-favorite="${preset.id}"]`)?.focus();
          } catch (e) {
            toast(message(e.message));
          }
        },
        "favorite",
      );
      favorite.dataset.favorite = preset.id;
      favorite.setAttribute("aria-label", t("Favorite {title}", { title: preset.title }));
      favorite.setAttribute(
        "aria-pressed",
        String(favorites.includes(preset.id)),
      );
      const details = preset.source
        ? button(
            "•••",
            () => openPositionDetails(preset),
            "position-details icon-button",
          )
        : null;
      if (details)
        details.setAttribute(
          "aria-label",
          t("Position details {record}", { record: preset.source.recordId }),
        );
      const card = element(
        "article",
        {
          className: `preset-card${isSelected ? " selected" : ""}`,
        },
        [choose, favorite, ...(details ? [details] : [])],
      );
      list.append(card);
      const start = () =>
        previewCleanups.push(
          previews.subscribe(playable.scene, (result) => {
            if (result.preview) {
              try {
                picture.replaceChildren(poseDiagram(result.preview));
                picture.title = t("Solved pose diagram");
                previewNote.textContent = result.preview.issues.length
                  ? t("Pose notes")
                  : "";
                previewNote.title = result.preview.issues.map(message).join(" · ");
                previewNote.classList.toggle(
                  "warning",
                  result.preview.issues.length > 0,
                );
                return;
              } catch {
                /* Diagram failure must not break the studio. */
              }
            }
            if (picture.querySelector("svg")?.dataset.basis === "refined")
              return;
            previewNote.textContent = t("Preview unavailable");
            previewNote.classList.remove("warning");
            picture.title = t("Authored poses only. Load this preset to inspect it.");
          }),
        );
      if (isSelected) start();
      else if (observer) {
        starts.set(choose, start);
        observer.observe(choose);
      } else start();
      listed.cards.push({
        card,
        choose,
        ids: [preset.id, playable.id],
        busy: preset.source ? preset.id : null,
      });
    }
    if (!filtered.length)
      list.append(
        element("div", { className: "empty-state" }, [
          element("h3", {
            textContent:
              scope === "saved"
                ? t("Your collection starts here")
                : t("A little room for discovery"),
          }),
          element("p", {
            textContent:
              search.value || category.value !== "all"
                ? t("Try another search or choose all categories.")
                : scope === "favorites"
                  ? t("Tap a star on a study to keep it here.")
                  : t("Adjust a study, then choose Save preset."),
          }),
          button(
            t("Explore all studies"),
            () => {
              scope = "positions";
              page = 0;
              supportStatus.value = "all";
              search.value = "";
              category.value = "all";
              refresh();
            },
            "text-button",
          ),
        ]),
      );
    if (focusedPreset)
      list
        .querySelector(`[data-preset="${focusedPreset}"]`)
        ?.focus({ preventScroll: true });
  }

  /**
   * Show the selection, and the position loading, on the cards already
   * listed: drawing the page of them again for it held every click on a card
   * for a third of a second. They are drawn again only if the library has
   * changed since.
   */
  function mark() {
    if (listed.revision !== library.revision()) return refresh();
    for (const { card, choose, ids, busy } of listed.cards) {
      const isSelected = ids.includes(selected);
      card.classList.toggle("selected", isSelected);
      choose.setAttribute("aria-pressed", String(isSelected));
      choose.setAttribute(
        "aria-busy",
        String(Boolean(busy) && busy === loadingPosition),
      );
      // A selected card's diagram is started whether or not it is in view.
      if (isSelected && starts.has(choose)) {
        observer.unobserve(choose);
        starts.get(choose)();
        starts.delete(choose);
      }
    }
  }

  function renderPositionBrowser(entries) {
    positionBrowser.hidden = scope !== "positions" || !positionCount();
    if (positionBrowser.hidden) return;
    const body = positionBrowser.querySelector(".position-browser-body");
    const groups = new Map();
    for (const entry of entries.filter(isBuiltInPosition)) {
      const categoryName = entry.category;
      const positionName = entry.position.name;
      if (!groups.has(categoryName)) groups.set(categoryName, new Map());
      const names = groups.get(categoryName);
      names.set(positionName, (names.get(positionName) ?? 0) + 1);
    }
    body.replaceChildren(
      ...[...groups]
        .sort(([a], [b]) => collator.compare(a, b))
        .map(([categoryName, names]) => {
          const total = [...names.values()].reduce((sum, value) => sum + value, 0);
          const section = element("details", {
            className: "position-category",
            open: category.value === categoryName,
          });
          section.append(
            element("summary", {}, [
              element("span", { textContent: categoryName }),
              element("small", {
                textContent: t("{count} positions", { count: number(total) }),
              }),
            ]),
            element(
              "div",
              { className: "position-types" },
              [...names]
                .sort(([a], [b]) => collator.compare(a, b))
                .map(([name, totalForName]) =>
                  button(
                    `${name} · ${totalForName}`,
                    () => {
                      category.value = categoryName;
                      search.value = name;
                      page = 0;
                      positionBrowser.open = false;
                      refresh();
                      list.focus({ preventScroll: true });
                    },
                    "position-type",
                  ),
                ),
            ),
          );
          return section;
        }),
    );
  }

  function updatePages(entries) {
    const result = catalogPage(entries, page);
    page = result.page;
    pagination.hidden = result.pages === 1;
    pageLabel.textContent = `${page + 1} / ${result.pages}`;
    previous.disabled = page === 0;
    next.disabled = page + 1 === result.pages;
    return result;
  }

  async function openPositionDetails(preset) {
    try {
      sourceEntries ??= await loadSourceEntries();
      const entry = sourceEntries.find(
        (candidate) => candidate.sourceId === preset.source.recordId,
      );
      if (!entry) throw new Error(t("Source metadata was not found."));
      openPositionDetailsSheet(entry, preset);
    } catch (error) {
      toast(t("Position details unavailable: {reason}", { reason: message(error.message) }));
    }
  }

  function openPositionDetailsSheet(entry, preset = null) {
    const modal = dialog(preset?.title ?? t("Position {record}", { record: entry.sourceId }));
    const peers = sourceEntries.filter((e) => e.variant === entry.variant);
    const summary = [
      entry.figures === 1 ? t("1 figure") : t("{count} figures", { count: entry.figures }),
      entry.family
        .split(" + ")
        .map((part) => term(part.toLowerCase(), part))
        .join(" + "),
      term(entry.surface.toLowerCase(), entry.surface),
    ].join(" · ");
    modal.append(
      element("p", {
        className: "support-badge",
        textContent: authoredIndex().has(entry.sourceId)
          ? t("Authored · unreviewed · not a verified reconstruction")
          : t("Interaction 3D · approximate composition, not a verified reconstruction"),
      }),
      element("p", {
        className: "position-detail-lead",
        textContent: preset?.description ?? summary,
      }),
      element("p", {
        textContent: t("{summary} · Source {record}", { summary, record: entry.sourceId }),
      }),
      element("p", {
        textContent: t(
          "{count} records share this structured annotation. This is not proof of anatomically identical positions.",
          { count: peers.length },
        ),
      }),
      element("p", {
        textContent: t(
          "This ready-to-view 3D interaction places the clothed participants together, with their contacts, following an interaction template chosen by visually classifying the source image. Poses are approximate, not measured source coordinates or physical certification. The artistic interpretation and the generated approximation remain available below.",
        ),
      }),
    );
    const details = element("details", {}, [
      element("summary", { textContent: t("Provenance and matching records") }),
    ]);
    details.append(
      element("p", {
        className: "position-hash",
        textContent: t("Annotation SHA-256: {hash}", { hash: entry.annotationHash }),
      }),
      element("p", {
        className: "position-hash",
        textContent: t("Variant: {variant}", { variant: entry.variant }),
      }),
      element("p", {
        className: "position-hash",
        textContent: t("Image SHA-256: {hash}", { hash: entry.imageHash }),
      }),
      element("p", {
        className: "position-hash",
        textContent: peers.map((p) => p.sourceId).join(", "),
      }),
    );
    modal.append(
      details,
      button(
        t("Open 3D interaction"),
        () => {
          modal.close();
          handlers.openPosition(entry);
        },
        "action primary",
      ),
      button(t("Open artistic interpretation"), () => {
        modal.close();
        handlers.openPosition(entry, { variant: "artistic" });
      }),
      button(t("Open generated approximation"), () => {
        modal.close();
        handlers.openPosition(entry, { variant: "generated" });
      }),
      button(t("Associate current study with this source"), () => {
        handlers.associate({
          dataset: "SexPoses",
          recordId: entry.sourceId,
          annotationHash: entry.annotationHash,
        });
        modal.close();
        toast(
          t("Source linked. Save your study to keep the association; this does not verify a reconstruction."),
        );
      }),
    );
    modal.showModal();
  }

  function authoredIndex() {
    const saved = new Map(
      library
        .index()
        .filter(isPositionOverride)
        .map((preset) => [preset.source.recordId, preset]),
    );
    return new Map(
      library
        .index()
        .filter(isBuiltInPosition)
        .filter((position) =>
          positionOverrideMatches(
            saved.get(position.source.recordId),
            position,
          ),
        )
        .map((position) => [
          position.source.recordId,
          saved.get(position.source.recordId),
        ]),
    );
  }

  function openPositionSave(snapshot, position, onSaved) {
    const checked = checkPositionOverride(
      {
        ...snapshot,
        id: positionOverrideId(position.source.recordId),
        position: {
          ...position.position,
          variant: "override",
        },
      },
      position,
    );
    const existing = library.get(checked.id);
    const modal = dialog(t("Save position override"));
    const title = field(t("Study name"), snapshot.title, { required: true });
    const replace = element("input", {
      type: "checkbox",
      id: newId("replace-study"),
    });
    const error = element("p", { className: "dialog-error", role: "alert" });
    const form = element("form", {}, [
      element("p", {
        textContent: t(
          "{record} · {figures}. Saves this complete interaction as the active version of the position. This local override is unreviewed.",
          {
            record: position.source.recordId,
            figures:
              position.scene.actors.length === 1
                ? t("1 figure")
                : t("{count} figures", { count: position.scene.actors.length }),
          },
        ),
      }),
      title.wrapper,
      ...(existing
        ? [
            element(
              "label",
              { htmlFor: replace.id, className: "position-group" },
              [
                replace,
                document.createTextNode(
                  t("Replace the existing override for this position"),
                ),
              ],
            ),
          ]
        : []),
      error,
      element("div", { className: "buttons" }, [
        button(t("Cancel"), () => modal.close()),
        element("button", {
          type: "submit",
          className: "action primary",
          textContent: t("Save override"),
        }),
      ]),
    ]);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (form.dataset.saving) return;
      if (existing && !replace.checked) {
        error.textContent = t("Confirm replacement to update the existing study.");
        return;
      }
      form.dataset.saving = "true";
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const result = await library.savePositionOverrides(
          [
            {
              ...checked,
              title: title.input.value,
              category: t("Position overrides"),
              description: t(
                "Locally authored clothed position override. Unreviewed; not a verified reconstruction.",
              ),
              scene: { ...checked.scene, title: title.input.value },
            },
          ],
          { replace: replace.checked },
        );
        if (!result.written.length)
          throw new Error(
            t("An existing study was kept. Reopen this dialog to confirm replacement."),
          );
        onSaved(result.written[0]);
        modal.close();
        toast(
          t("Position override saved for {record}. It remains unreviewed.", {
            record: position.source.recordId,
          }),
        );
      } catch (e) {
        error.textContent = message(e.message);
      } finally {
        delete form.dataset.saving;
        submit.disabled = false;
      }
    };
    modal.append(form);
    modal.showModal();
    title.input.focus();
  }

  async function openLibraryTools() {
    const modal = dialog(t("Library tools"));
    const summary = element("p", { textContent: t("Loading position catalog…") });
    const error = element("p", { className: "dialog-error", role: "alert" });
    modal.append(
      element("section", { className: "tool-section" }, [
        element("h3", { textContent: t("Saved presets") }),
        element("p", {
          textContent: t(
            "Import presets into this browser or export all saved presets as one portable PoseForge library.",
          ),
        }),
        element("div", { className: "buttons" }, [
          button(t("Import presets"), () => {
            modal.close();
            file.click();
          }),
          button(t("Export saved presets"), exportSavedLibrary),
        ]),
      ]),
      element("section", { className: "tool-section" }, [
        element("h3", { textContent: t("Position overrides") }),
        summary,
      ]),
      error,
    );
    modal.showModal();
    try {
      if (!positionCount() && handlers.loadPositions)
        await handlers.loadPositions();
      sourceEntries = await loadSourceEntries();
      if (!modal.isConnected) return;
      const updateCount = () => {
        summary.textContent = t(
          "{count} / {total} source-linked positions have local overrides. Overrides are unreviewed and replace the built-in scene when selected.",
          { count: number(authoredIndex().size), total: number(sourceEntries.length) },
        );
      };
      updateCount();
      const input = element("input", {
        type: "file",
        id: newId("position-import"),
        accept: ".json,application/json",
      });
      const review = element("div");
      modal.append(
        element("p", {
          textContent: t(
            "Import source-linked position overrides. Every override must retain its position ID and annotation hash, all participants, fixed joints and placements, clothing, and a connected interaction graph. The complete batch is checked before anything is saved.",
          ),
        }),
        button(t("Export position overrides"), () => {
          try {
            const presets = [...authoredIndex().values()].map((p) =>
              library.get(p.id),
            );
            if (!presets.length)
              throw new Error(t("No position overrides to export yet."));
            download(
              serializePositionOverrides(presets),
              "poseforge-position-overrides.json",
              "application/json",
            );
          } catch (e) {
            error.textContent = message(e.message);
          }
        }),
        element("div", { className: "field" }, [
          element("label", {
            htmlFor: input.id,
            textContent: t("Import position overrides (JSON)"),
          }),
          input,
        ]),
        review,
      );
      let revision = 0;
      input.onchange = async () => {
        const chosen = input.files[0];
        const token = ++revision;
        review.replaceChildren();
        error.textContent = "";
        if (!chosen) return;
        try {
          if (chosen.size > MAX_PACK_BYTES)
            throw new Error(t("Catalog files must be no larger than 32 MB."));
          const text = await chosen.text();
          if (token !== revision || !modal.isConnected) return;
          const sourcePositions = library
            .index()
            .filter(isBuiltInPosition);
          const studies = parsePositionOverrides(text, sourcePositions);
          const conflicts = studies.filter((p) => library.get(p.id)).length;
          const replace = element("input", {
            type: "checkbox",
            id: newId("replace-batch"),
          });
          const apply = button(
            t("Import overrides"),
            async () => {
              apply.disabled = true;
              input.disabled = true;
              replace.disabled = true;
              try {
                const result = await library.savePositionOverrides(
                  studies,
                  { replace: replace.checked },
                );
                review.replaceChildren(
                  element("p", {
                    role: "status",
                    textContent: t("Saved {written} studies; kept {skipped} existing studies.", {
                      written: result.written.length,
                      skipped: result.skipped,
                    }),
                  }),
                );
                updateCount();
                refresh();
                input.value = "";
              } catch (e) {
                error.textContent = message(e.message);
                apply.disabled = false;
              } finally {
                input.disabled = false;
                replace.disabled = false;
              }
            },
            "action primary",
          );
          review.append(
            element("p", {
              textContent: t(
                "{valid} valid studies · {fresh} new · {conflicts} already authored. Existing studies are kept unless replacement is selected.",
                { valid: studies.length, fresh: studies.length - conflicts, conflicts },
              ),
            }),
          );
          if (conflicts)
            review.append(
              element(
                "label",
                { htmlFor: replace.id, className: "position-group" },
                [
                  replace,
                  document.createTextNode(
                    t("Replace {count} existing position overrides", { count: conflicts }),
                  ),
                ],
              ),
            );
          review.append(apply);
        } catch (e) {
          error.textContent = t("Import failed: {reason} Nothing was saved.", {
            reason: message(e.message),
          });
        }
      };
    } catch (e) {
      error.textContent = message(e.message);
    }
  }

  function openSave(snapshot) {
    const saved =
      snapshot.id?.startsWith("user.") &&
      library.saved().some((p) => p.id === snapshot.id);
    const modal = dialog(saved ? t("Keep shaping your study") : t("Save your study"));
    const form = element("form");
    const title = field(t("Preset name"), snapshot.title, { required: true });
    const description = field(t("Description"), snapshot.description ?? "", {
      multiline: true,
      maxLength: 500,
    });
    const categoryField = field(t("Category"), snapshot.category ?? t("My studies"), {
      maxLength: 40,
      required: true,
    });
    const tags = field(
      t("Tags (separate with commas)"),
      (snapshot.tags ?? []).join(", "),
      { maxLength: 380 },
    );
    const error = element("p", { className: "dialog-error" });
    error.setAttribute("role", "alert");
    const actions = element("div", { className: "buttons" });
    if (saved)
      actions.append(
        button(
          t("Delete preset"),
          () => {
            confirmAction(
              t("Delete this preset?"),
              t(
                "“{title}” will be removed from this browser's library. Your current scene will remain in the studio.",
                { title: snapshot.title },
              ),
              async () => {
                await library.remove(snapshot.id);
                handlers.deleted(snapshot.id);
                refresh();
                modal.close();
                toast(t("Preset deleted. The current scene is still available."));
              },
            );
          },
          "text-button danger",
        ),
      );
    actions.append(button(t("Cancel"), () => modal.close()));
    if (saved)
      actions.append(
        element("button", {
          type: "submit",
          name: "mode",
          value: "copy",
          className: "action",
          textContent: t("Save a copy"),
        }),
      );
    actions.append(
      element("button", {
        type: "submit",
        name: "mode",
        value: saved ? "update" : "copy",
        className: "action primary",
        textContent: saved ? t("Update preset") : t("Save preset"),
      }),
    );
    form.append(
      element("p", {
        textContent: t(
          "Save this scene, including figure details and joint adjustments. Download JSON to take it with you.",
        ),
      }),
      title.wrapper,
      description.wrapper,
      categoryField.wrapper,
      tags.wrapper,
      error,
      actions,
    );
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (form.dataset.saving) return;
      form.dataset.saving = "true";
      const submitter = event.submitter;
      if (submitter) submitter.disabled = true;
      try {
        const next = await library.save(
          {
            ...snapshot,
            title: title.input.value,
            description: description.input.value,
            category: categoryField.input.value,
            tags: tags.input.value
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            scene: {
              ...snapshot.scene,
              title: title.input.value,
            },
          },
          submitter?.value === "update" ? snapshot.id : null,
        );
        selected = next.id;
        handlers.saved(next);
        scope = "saved";
        page = 0;
        supportStatus.value = "all";
        search.value = "";
        category.value = "all";
        refresh();
        modal.close();
        toast(t("Preset saved to your library."));
      } catch (e) {
        error.textContent = message(e.message);
      } finally {
        delete form.dataset.saving;
        if (submitter) submitter.disabled = false;
      }
    };
    modal.append(form);
    modal.showModal();
    title.input.focus();
  }
  refresh();
  return {
    refresh,
    openSave,
    openPositionSave,
    setPositionLoading(id) {
      loadingPosition = id;
      mark();
    },
    focusSearch() {
      showRegion("library");
      search.focus();
      search.select();
    },
    setPreview(scene, preview) {
      previews.remember(scene, preview);
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      starts.clear();
      previewCleanups.forEach((cleanup) => cleanup());
      previews.dispose();
    },
    setSelected(id) {
      const changed = selected !== id;
      selected = id;
      mark();
      // A card chosen from the list is already in view, and the reader's search
      // and page are theirs to keep - an edit re-selects the same card too. Only
      // a selection made from elsewhere (a link, an undo, the details sheet) is
      // brought into view: on its page if the current filter lists it, and by
      // narrowing the search to its ID only if the filter does not.
      if (
        changed &&
        !list.querySelector(".preset-card.selected") &&
        (isBuiltInPosition({ id }) || isPositionOverride({ id }))
      ) {
        const index = listedIds.indexOf(id);
        if (index >= 0) page = Math.floor(index / CATALOG_PAGE_SIZE);
        else {
          if (scope !== "positions") {
            scope = "positions";
            category.value = "all";
            supportStatus.value = "all";
          }
          search.value = id.split(".").at(-1);
          page = 0;
        }
        refresh();
      }
      if (changed)
        list
          .querySelector(".preset-card.selected")
          ?.scrollIntoView({ block: "nearest" });
    },
  };
}

export function confirmAction(title, text, action) {
  const modal = dialog(title);
  const error = element("p", { className: "dialog-error" });
  error.setAttribute("role", "alert");
  modal.append(
    element("p", { textContent: text }),
    error,
    element("div", { className: "buttons" }, [
      button(t("Cancel"), () => modal.close()),
      button(
        t("Confirm"),
        async (event) => {
          const control = event.currentTarget;
          control.disabled = true;
          try {
            await action();
            modal.close();
          } catch (e) {
            error.textContent = message(e.message);
          } finally {
            control.disabled = false;
          }
        },
        "action primary",
      ),
    ]),
  );
  modal.showModal();
}

export function openExport(onExport) {
  const modal = dialog(t("Take your study with you"));
  modal.append(
    element("p", {
      textContent: t("A picture for your next project, or an editable preset for another day."),
    }),
  );
  const scale = element(
    "select",
    { id: "export-scale" },
    [1, 2, 4].map((value) =>
      element("option", {
        value: String(value),
        textContent: t("{scale}× resolution", { scale: value }),
        selected: value === 2,
      }),
    ),
  );
  modal.append(
    element("div", { className: "field" }, [
      element("label", { htmlFor: scale.id, textContent: t("PNG image scale") }),
      scale,
    ]),
  );
  const choices = element("div", { className: "export-choices" });
  for (const [kind, name, detail, options] of [
    [
      "png",
      t("PNG image"),
      t("High resolution · with the room or backdrop"),
      { scale: 2 },
    ],
    [
      "png",
      t("Transparent PNG"),
      t("A clean cut-out, without the room or ground"),
      { scale: 2, transparent: true, ground: false },
    ],
    ["svg", t("SVG line art"), t("Editable vector outlines"), {}],
    [
      "json",
      t("Editable preset"),
      t("Portable JSON · includes figure and joint settings"),
      {},
    ],
  ]) {
    const node = button(
      name,
      () => {
        modal.close();
        onExport(kind, { ...options, scale: Number(scale.value) });
      },
      "action",
    );
    node.append(element("small", { textContent: detail }));
    choices.append(node);
  }
  modal.append(choices);
  modal.showModal();
}

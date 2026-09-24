import { searchCatalog, MAX_PACK_BYTES } from "../core/catalog.js";
import { authoredPreview, poseDiagram } from "./diagram.js";
import { createPreviewService } from "./previewService.js";
import { download } from "../render/exporters.js";
import { newId } from "./ids.js";
import { positionCount } from "./libraryStore.js";
import { catalogPage, STATUS_LABELS } from "../core/referenceCatalog.js";
import {
  createPositionService,
  referenceManifest,
} from "./referenceLoader.js";
import {
  isReferenceStudy,
  referenceStudyId,
  referenceStudyMatches,
  checkReferenceStudy,
  parseReferenceStudies,
  serializeReferenceStudies,
} from "../core/referenceStudies.js";

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

export function showRegion(region) {
  document.getElementById("app").dataset.mobile = region;
  document.querySelectorAll("[data-region]").forEach((node) => {
    const active = node.dataset.region === region;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", String(active));
  });
}

/** Dialogs use native focus containment, Escape, and restoration to the opener. */
function dialog(title) {
  const node = element("dialog");
  const heading = element("h2", {
    textContent: title,
    id: newId("dialog"),
  });
  node.setAttribute("aria-labelledby", heading.id);
  const close = button("×", () => node.close(), "icon-button");
  close.setAttribute("aria-label", "Close dialog");
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
  let sourceEntries = null;
  let positionsError = "";
  let loadingPositions = false;
  let disposed = false;
  const loadSourceEntries = positionService.entries;
  let loadingReference = null;
  const count = element("span");
  count.setAttribute("aria-live", "polite");
  const search = element("input", {
    type: "search",
    placeholder: "Find your next pose…",
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
  clearSearch.setAttribute("aria-label", "Clear search");
  clearSearch.hidden = true;
  const scopes = element("div", { className: "library-scopes" });
  for (const [value, label] of [
    ["positions", "Positions"],
    ["saved", "Saved"],
    ["favorites", "Favorites"],
  ]) {
    const node = button(
      label,
      () => {
        scope = value;
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
    textContent: "Category",
  });
  const supportStatus = element("select", { id: "catalog-status" }, [
    element("option", { value: "all", textContent: "All statuses" }),
    ...Object.entries(STATUS_LABELS).map(([value, textContent]) =>
      element("option", { value, textContent }),
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
          textContent: "Support status",
        }),
        supportStatus,
      ]),
    ],
  );
  const filterToggle = button(
    "Filters",
    () => setFiltersOpen(filters.hidden),
    "filter-toggle",
  );
  filterToggle.setAttribute("aria-expanded", "false");
  filterToggle.setAttribute("aria-controls", filters.id);
  const resetFilters = button(
    "Reset filters",
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
    "+ New",
    () => handlers.newStudy(),
    "action small new-study",
  );
  newStudy.setAttribute("aria-label", "+ New study");
  const info = button(
    "ⓘ",
    () => {
      const modal = dialog("About the library");
      modal.append(
        element("p", {
          textContent: `${referenceManifest.records.toLocaleString("en")} source-linked 3D positions plus ${library.index().filter((p) => p.status === "verified-3d").length} studio presets.`,
        }),
        element("p", {
          textContent:
            "Positions and source references are one catalog. Browse broad categories, then choose a related named position. Every source-linked card opens a ready-to-view clothed 3D interaction; its details retain provenance plus the earlier artistic and generated alternatives. These are approximate template-based interpretations, not measured reconstructions or physical certification.",
        }),
        element("p", {
          textContent: `Saved in this browser using ${library.mode ?? "local storage"}. Up to 5,000 presets / 32 MB. Export JSON for a portable backup; this is not cloud storage.`,
        }),
        element("p", {
          textContent:
            "Tip: press / to search the library. Use Focus on desktop for more canvas space; Escape restores the sidebars.",
        }),
      );
      modal.showModal();
    },
    "library-info icon-button",
  );
  info.setAttribute("aria-label", "About this library");
  info.title = "Catalog counts, storage and shortcuts";
  const filterBar = element(
    "div",
    { className: "library-filter-bar", hidden: true },
    [element("span", { textContent: "Filtered results" }), resetFilters],
  );
  const searchBox = element("div", { className: "search-box" }, [
    element("label", {
      htmlFor: search.id,
      className: "sr-only",
      textContent: "Search presets",
    }),
    search,
    clearSearch,
  ]);
  const positionBrowser = element("details", {
    className: "position-browser",
  });
  positionBrowser.append(
    element("summary", { textContent: "Browse position categories" }),
    element("div", { className: "position-browser-body" }),
  );
  const top = element("div", { className: "library-top" }, [
    element("div", { className: "library-title" }, [
      element("h2", { textContent: "Library" }),
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
  const previous = button("Previous", () => turnPage(-1), "text-button");
  const next = button("Next", () => turnPage(1), "text-button");
  const pagination = element(
    "nav",
    { className: "catalog-pagination", hidden: true },
    [previous, pageLabel, next],
  );
  pagination.setAttribute("aria-label", "Catalog pages");
  const file = element("input", {
    id: "catalog-file",
    type: "file",
    accept: ".json,application/json",
    hidden: true,
  });
  const exportSavedLibrary = () => {
    if (!library.saved().length)
      return toast("Save your first preset to export a library.");
    try {
      download(
        library.export(),
        "poseforge-library.json",
        "application/json",
      );
      toast("Your saved library was downloaded.");
    } catch (error) {
      toast(`Export failed: ${error.message}`);
    }
  };
  const libraryTools = button(
    "Library tools",
    openLibraryTools,
    "text-button",
  );
  root.append(
    top,
    list,
    pagination,
    element("div", { className: "library-bottom" }, [
      element("div", { className: "buttons" }, [libraryTools, info]),
      element("p", {
        id: "library-storage",
        className: "sr-only",
        textContent: `Saved in this browser · ${library.mode ?? "local storage"}`,
      }),
      file,
    ]),
  );
  if (library.notice)
    root.insertBefore(
      element("p", {
        className: "storage-notice",
        textContent: library.notice,
      }),
      list,
    );
  if (library.error) {
    const recovery = element("div", { className: "recovery" }, [
      element("p", { textContent: library.error }),
      button(
        "Download stored data",
        () => {
          try {
            download(
              library.raw(),
              "poseforge-recovery.json",
              "application/json",
            );
          } catch (e) {
            toast(e.message);
          }
        },
        "text-button",
      ),
      button(
        "Reset saved library",
        () => {
          confirmAction(
            "Reset saved library?",
            "This removes the unreadable data from this browser. Download it first if you need a recovery copy.",
            async () => {
              await library.reset();
              recovery.remove();
              refresh();
              toast("The saved library was reset.");
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
        throw new Error("Catalog files must be no larger than 32 MB.");
      file.disabled = true;
      const added = await library.import(await chosen.text());
      scope = "saved";
      page = 0;
      supportStatus.value = "all";
      search.value = "";
      category.value = "all";
      refresh();
      toast(
        `Imported ${added.length} preset${added.length === 1 ? "" : "s"}. Existing presets were kept.`,
      );
    } catch (e) {
      toast(`Import failed: ${e.message}`);
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
    const all = library.index();
    categoryLabel.textContent = "Category";
    search.placeholder =
      scope === "positions" ? "Search positions or source ID…" : "Search presets…";
    search.title =
      scope === "positions"
        ? "Search by position name, category, surface or IMG ID · /"
        : "Search presets · /";
    document.querySelector(`label[for="${search.id}"]`).textContent =
      scope === "positions" ? "Search positions" : "Search presets";
    const oldCategory = category.value || "all";
    category.replaceChildren(
      element("option", {
        value: "all",
        textContent: "All categories",
      }),
      ...[
        ...new Set(all.map((p) => p.category)),
      ]
        .sort()
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
      ? `Filters (${activeFilters})`
      : "Filters";
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
    const itemLabel =
      scope === "positions"
        ? filtered.length === 1
          ? "position"
          : "positions"
        : filtered.length === 1
          ? "study"
          : "studies";
    count.textContent = `${filtered.length.toLocaleString("en")} ${itemLabel}`;
    if (
      handlers.loadPositions &&
      !positionCount() &&
      scope === "positions"
    ) {
      const status = element("div", { className: "positions-status" }, [
        element("p", {
          textContent: positionsError
            ? `The 3D positions could not load: ${positionsError}`
            : "Loading 1,283 3D positions…",
        }),
      ]);
      if (positionsError)
        status.append(
          button("Retry positions", () => {
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
      const authored =
        preset.source &&
        library.get(referenceStudyId(preset.source.recordId));
      const playable = isReferenceStudy(authored) ? authored : preset;
      const status = isReferenceStudy(authored) ? "authored-3d" : entry.status;
      const isSelected = Boolean(
        playable.id === selected ||
        (preset.source &&
          (selected === `reference.sexposes.${preset.source.recordId}` ||
            selected === referenceStudyId(preset.source.recordId))),
      );
      const choose = button(
        "",
        () => handlers.select(playable),
        "preset-select",
      );
      choose.dataset.preset = preset.id;
      if (preset.source) choose.dataset.source = preset.source.recordId;
      choose.setAttribute("aria-label", `Load ${preset.title}`);
      choose.title = preset.title;
      choose.setAttribute("aria-pressed", String(isSelected));
      choose.setAttribute(
        "aria-busy",
        String(Boolean(
          preset.source &&
            loadingReference === `reference.sexposes.${preset.source.recordId}`,
        )),
      );
      const picture = element(
        "span",
        { className: "preset-preview", title: "Authored pose preview" },
        [poseDiagram(authoredPreview(preset.scene))],
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
          element("span", {
            className: "preset-meta",
            textContent: `${preset.scene.actors.length === 1 ? "Solo" : `${preset.scene.actors.length} figures`} · ${preset.surface ?? preset.category}`,
          }),
          element("span", {
            className: "preset-description",
            textContent: preset.description,
          }),
          previewNote,
          element("span", {
            className: `support-badge ${status}`,
            textContent: STATUS_LABELS[status],
            title:
              status === "authored-3d"
                ? "Your locally authored override for this source. It is unreviewed."
                : status === "interaction-3d"
                ? "Approximate 3D interaction composed from a template; not a measured reconstruction."
                : status === "verified-3d"
                ? "Audited stock configuration only; edits need their own checks."
                : "This personal preset has not been individually certified. Inspect Pose checks; adjustment may be needed.",
          }),
          ...(preset.source && !preset.positionName
            ? [
                element("span", {
                  className: "source-note",
                  textContent: `Source ${preset.source.recordId}`,
                }),
              ]
            : []),
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
            toast(e.message);
          }
        },
        "favorite",
      );
      favorite.dataset.favorite = preset.id;
      favorite.setAttribute("aria-label", `Favorite ${preset.title}`);
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
          `Position details ${preset.source.recordId}`,
        );
      list.append(
        element(
          "article",
          {
            className: `preset-card${isSelected ? " selected" : ""}`,
          },
          [choose, favorite, ...(details ? [details] : [])],
        ),
      );
      const start = () =>
        previewCleanups.push(
          previews.subscribe(playable.scene, (result) => {
            if (result.preview) {
              try {
                picture.replaceChildren(poseDiagram(result.preview));
                picture.title = "Solved pose diagram";
                previewNote.textContent = result.preview.issues.length
                  ? "Pose notes"
                  : "";
                previewNote.title = result.preview.issues.join(" · ");
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
            previewNote.textContent = "Preview unavailable";
            previewNote.classList.remove("warning");
            picture.title =
              "Authored poses only. Load this preset to inspect it.";
          }),
        );
      if (isSelected) start();
      else if (observer) {
        starts.set(choose, start);
        observer.observe(choose);
      } else start();
    }
    if (!filtered.length)
      list.append(
        element("div", { className: "empty-state" }, [
          element("h3", {
            textContent:
              scope === "saved"
                ? "Your collection starts here"
                : "A little room for discovery",
          }),
          element("p", {
            textContent:
              search.value || category.value !== "all"
                ? "Try another search or choose all categories."
                : scope === "favorites"
                  ? "Tap a star on a study to keep it here."
                  : "Adjust a study, then choose Save preset.",
          }),
          button(
            "Explore all studies",
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

  function renderPositionBrowser(entries) {
    positionBrowser.hidden = scope !== "positions" || !positionCount();
    if (positionBrowser.hidden) return;
    const body = positionBrowser.querySelector(".position-browser-body");
    const groups = new Map();
    for (const entry of entries.filter((item) => item.positionName)) {
      const categoryName = entry.positionCategory ?? entry.category;
      const positionName = entry.positionName ?? entry.title;
      if (!groups.has(categoryName)) groups.set(categoryName, new Map());
      const names = groups.get(categoryName);
      names.set(positionName, (names.get(positionName) ?? 0) + 1);
    }
    body.replaceChildren(
      ...[...groups]
        .sort(([a], [b]) => a.localeCompare(b))
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
                textContent: `${total.toLocaleString("en")} positions`,
              }),
            ]),
            element(
              "div",
              { className: "position-types" },
              [...names]
                .sort(([a], [b]) => a.localeCompare(b))
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
      if (!entry) throw new Error("Source metadata was not found.");
      openReference(entry, preset);
    } catch (error) {
      toast(`Position details unavailable: ${error.message}`);
    }
  }

  function openReference(entry, preset = null) {
    const modal = dialog(preset?.positionName ?? `Position ${entry.sourceId}`);
    const peers = sourceEntries.filter((e) => e.variant === entry.variant);
    modal.append(
      element("p", {
        className: "support-badge",
        textContent: authoredIndex().has(entry.sourceId)
          ? "Authored · unreviewed · not a verified reconstruction"
          : "Interaction 3D · approximate composition, not a verified reconstruction",
      }),
      element("p", {
        className: "position-detail-lead",
        textContent:
          preset?.description ??
          `${entry.figures} figures · ${entry.family} · ${entry.surface}`,
      }),
      element("p", {
        textContent: `${entry.figures} figures · ${entry.family} · ${entry.surface} · Source ${entry.sourceId}`,
      }),
      element("p", {
        textContent: `${peers.length} records share this structured annotation. This is not proof of anatomically identical positions.`,
      }),
      element("p", {
        textContent:
          "This ready-to-view 3D interaction places the clothed participants together, with their contacts, following an interaction template chosen by visually classifying the source image. Poses are approximate, not measured source coordinates or physical certification. The artistic interpretation and the generated approximation remain available below.",
      }),
    );
    const details = element("details", {}, [
      element("summary", { textContent: "Provenance and matching records" }),
    ]);
    details.append(
      element("p", {
        className: "reference-hash",
        textContent: `Annotation SHA-256: ${entry.annotationHash}`,
      }),
      element("p", {
        className: "reference-hash",
        textContent: `Variant: ${entry.variant}`,
      }),
      element("p", {
        className: "reference-hash",
        textContent: `Image SHA-256: ${entry.imageHash}`,
      }),
      element("p", {
        className: "reference-hash",
        textContent: peers.map((p) => p.sourceId).join(", "),
      }),
    );
    modal.append(
      details,
      button(
        "Open 3D interaction",
        () => {
          modal.close();
          handlers.previewReference(entry);
        },
        "action primary",
      ),
      button("Open artistic interpretation", () => {
        modal.close();
        handlers.previewReference(entry, { preview: "artistic" });
      }),
      button("Open generated approximation", () => {
        modal.close();
        handlers.previewReference(entry, { preview: "generated" });
      }),
      button("Associate current study with this source", () => {
        handlers.associate({
          dataset: "SexPoses",
          recordId: entry.sourceId,
          annotationHash: entry.annotationHash,
        });
        modal.close();
        toast(
          "Source linked. Save your study to keep the association; this does not verify a reconstruction.",
        );
      }),
    );
    modal.showModal();
  }

  function authoredIndex() {
    const saved = new Map(
      library
        .index()
        .filter(isReferenceStudy)
        .map((p) => [p.id, p]),
    );
    return new Map(
      (sourceEntries ?? [])
        .filter((entry) =>
          referenceStudyMatches(
            saved.get(referenceStudyId(entry.sourceId)),
            entry,
          ),
        )
        .map((entry) => [
          entry.sourceId,
          saved.get(referenceStudyId(entry.sourceId)),
        ]),
    );
  }

  function openReferenceSave(snapshot, entry, onSaved) {
    const checked = checkReferenceStudy(
      { ...snapshot, id: referenceStudyId(entry.sourceId) },
      entry,
    );
    const existing = library.get(checked.id);
    const modal = dialog("Save position override");
    const title = field("Study name", snapshot.title, { required: true });
    const replace = element("input", {
      type: "checkbox",
      id: newId("replace-study"),
    });
    const error = element("p", { className: "dialog-error", role: "alert" });
    const form = element("form", {}, [
      element("p", {
        textContent: `${entry.sourceId} · ${entry.figures} figures. Saves these joint angles and placements as the active version of this position. This local override is unreviewed.`,
      }),
      title.wrapper,
      ...(existing
        ? [
            element(
              "label",
              { htmlFor: replace.id, className: "reference-group" },
              [
                replace,
                document.createTextNode(
                  "Replace the existing override for this position",
                ),
              ],
            ),
          ]
        : []),
      error,
      element("div", { className: "buttons" }, [
        button("Cancel", () => modal.close()),
        element("button", {
          type: "submit",
          className: "action primary",
          textContent: "Save override",
        }),
      ]),
    ]);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (form.dataset.saving) return;
      if (existing && !replace.checked) {
        error.textContent = "Confirm replacement to update the existing study.";
        return;
      }
      form.dataset.saving = "true";
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const result = await library.saveReferenceStudies(
          [
            {
              ...checked,
              title: title.input.value,
              category: "Position overrides",
              description:
                "Locally authored clothed position override. Unreviewed; not a verified reconstruction.",
              scene: { ...checked.scene, title: title.input.value },
            },
          ],
          [entry],
          { replace: replace.checked },
        );
        if (!result.written.length)
          throw new Error(
            "An existing study was kept. Reopen this dialog to confirm replacement.",
          );
        onSaved(result.written[0]);
        modal.close();
        toast(
          `Position override saved for ${entry.sourceId}. It remains unreviewed.`,
        );
      } catch (e) {
        error.textContent = e.message;
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
    const modal = dialog("Library tools");
    const message = element("p", { textContent: "Loading position catalog…" });
    const error = element("p", { className: "dialog-error", role: "alert" });
    modal.append(
      element("section", { className: "tool-section" }, [
        element("h3", { textContent: "Saved presets" }),
        element("p", {
          textContent:
            "Import presets into this browser or export all saved presets as one portable PoseForge library.",
        }),
        element("div", { className: "buttons" }, [
          button("Import presets", () => {
            modal.close();
            file.click();
          }),
          button("Export saved presets", exportSavedLibrary),
        ]),
      ]),
      element("section", { className: "tool-section" }, [
        element("h3", { textContent: "Position overrides" }),
        message,
      ]),
      error,
    );
    modal.showModal();
    try {
      sourceEntries = await loadSourceEntries();
      if (!modal.isConnected) return;
      const updateCount = () => {
        message.textContent = `${authoredIndex().size.toLocaleString("en")} / ${sourceEntries.length.toLocaleString("en")} source-linked positions have local overrides. Overrides are unreviewed and replace the built-in scene when selected.`;
      };
      updateCount();
      const input = element("input", {
        type: "file",
        id: newId("reference-import"),
        accept: ".json,application/json",
      });
      const review = element("div");
      modal.append(
        element("p", {
          textContent:
            "Import source-linked position overrides. Every override must retain its source ID and annotation hash, all participants, fixed joints and placements, clothing, and a neutral floor. The complete batch is checked before anything is saved.",
        }),
        button("Export position overrides", () => {
          try {
            const presets = [...authoredIndex().values()].map((p) =>
              library.get(p.id),
            );
            if (!presets.length)
              throw new Error("No position overrides to export yet.");
            download(
              serializeReferenceStudies(presets),
              "poseforge-position-overrides.json",
              "application/json",
            );
          } catch (e) {
            error.textContent = e.message;
          }
        }),
        element("div", { className: "field" }, [
          element("label", {
            htmlFor: input.id,
            textContent: "Import position overrides (JSON)",
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
            throw new Error("Catalog files must be no larger than 32 MB.");
          const text = await chosen.text();
          if (token !== revision || !modal.isConnected) return;
          const studies = parseReferenceStudies(text, sourceEntries);
          const conflicts = studies.filter((p) => library.get(p.id)).length;
          const replace = element("input", {
            type: "checkbox",
            id: newId("replace-batch"),
          });
          const apply = button(
            "Import overrides",
            async () => {
              apply.disabled = true;
              input.disabled = true;
              replace.disabled = true;
              try {
                const result = await library.saveReferenceStudies(
                  studies,
                  sourceEntries,
                  { replace: replace.checked },
                );
                review.replaceChildren(
                  element("p", {
                    role: "status",
                    textContent: `Saved ${result.written.length} studies; kept ${result.skipped} existing studies.`,
                  }),
                );
                updateCount();
                refresh();
                input.value = "";
              } catch (e) {
                error.textContent = e.message;
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
              textContent: `${studies.length} valid studies · ${studies.length - conflicts} new · ${conflicts} already authored. Existing studies are kept unless replacement is selected.`,
            }),
          );
          if (conflicts)
            review.append(
              element(
                "label",
                { htmlFor: replace.id, className: "reference-group" },
                [
                  replace,
                  document.createTextNode(
                    `Replace ${conflicts} existing position overrides`,
                  ),
                ],
              ),
            );
          review.append(apply);
        } catch (e) {
          error.textContent = `Import failed: ${e.message} Nothing was saved.`;
        }
      };
    } catch (e) {
      error.textContent = e.message;
    }
  }

  function openSave(snapshot) {
    const saved =
      snapshot.id?.startsWith("user.") &&
      library.saved().some((p) => p.id === snapshot.id);
    const modal = dialog(saved ? "Keep shaping your study" : "Save your study");
    const form = element("form");
    const title = field("Preset name", snapshot.title, { required: true });
    const description = field("Description", snapshot.description ?? "", {
      multiline: true,
      maxLength: 500,
    });
    const categoryField = field("Category", snapshot.category ?? "My studies", {
      maxLength: 40,
      required: true,
    });
    const tags = field(
      "Tags (separate with commas)",
      (snapshot.tags ?? []).join(", "),
      { maxLength: 380 },
    );
    const error = element("p", { className: "dialog-error" });
    error.setAttribute("role", "alert");
    const actions = element("div", { className: "buttons" });
    if (saved)
      actions.append(
        button(
          "Delete preset",
          () => {
            confirmAction(
              "Delete this preset?",
              `“${snapshot.title}” will be removed from this browser's library. Your current scene will remain in the studio.`,
              async () => {
                await library.remove(snapshot.id);
                handlers.deleted(snapshot.id);
                refresh();
                modal.close();
                toast("Preset deleted. The current scene is still available.");
              },
            );
          },
          "text-button danger",
        ),
      );
    actions.append(button("Cancel", () => modal.close()));
    if (saved)
      actions.append(
        element("button", {
          type: "submit",
          name: "mode",
          value: "copy",
          className: "action",
          textContent: "Save a copy",
        }),
      );
    actions.append(
      element("button", {
        type: "submit",
        name: "mode",
        value: saved ? "update" : "copy",
        className: "action primary",
        textContent: saved ? "Update preset" : "Save preset",
      }),
    );
    form.append(
      element("p", {
        textContent:
          "Save this scene, including figure details and joint adjustments. Download JSON to take it with you.",
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
        toast("Preset saved to your library.");
      } catch (e) {
        error.textContent = e.message;
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
    openReferenceSave,
    setReferenceLoading(id) {
      loadingReference = id;
      refresh();
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
      if (id?.startsWith("reference.") || isReferenceStudy({ id })) {
        if (scope !== "positions") {
          scope = "positions";
          category.value = "all";
          supportStatus.value = "all";
        }
        search.value = id.split(".").at(-1);
        page = 0;
      }
      refresh();
      if (changed)
        list
          .querySelector(".preset-card.selected")
          ?.scrollIntoView({ block: "nearest" });
    },
  };
}

export function confirmAction(title, message, action) {
  const modal = dialog(title);
  const error = element("p", { className: "dialog-error" });
  error.setAttribute("role", "alert");
  modal.append(
    element("p", { textContent: message }),
    error,
    element("div", { className: "buttons" }, [
      button("Cancel", () => modal.close()),
      button(
        "Confirm",
        async (event) => {
          const control = event.currentTarget;
          control.disabled = true;
          try {
            await action();
            modal.close();
          } catch (e) {
            error.textContent = e.message;
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
  const modal = dialog("Take your study with you");
  modal.append(
    element("p", {
      textContent:
        "A picture for your next project, or an editable preset for another day.",
    }),
  );
  const scale = element(
    "select",
    { id: "export-scale" },
    [1, 2, 4].map((value) =>
      element("option", {
        value: String(value),
        textContent: `${value}× resolution`,
        selected: value === 2,
      }),
    ),
  );
  modal.append(
    element("div", { className: "field" }, [
      element("label", { htmlFor: scale.id, textContent: "PNG image scale" }),
      scale,
    ]),
  );
  const choices = element("div", { className: "export-choices" });
  for (const [kind, name, detail, options] of [
    [
      "png",
      "PNG image",
      "High resolution · with the studio background",
      { scale: 2 },
    ],
    [
      "png",
      "Transparent PNG",
      "A clean cut-out, without the ground",
      { scale: 2, transparent: true, ground: false },
    ],
    ["svg", "SVG line art", "Editable vector outlines", {}],
    [
      "json",
      "Editable preset",
      "Portable JSON · includes figure and joint settings",
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

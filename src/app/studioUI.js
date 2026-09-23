import { searchCatalog, MAX_PACK_BYTES } from "../core/catalog.js";
import { authoredPreview, poseDiagram } from "./diagram.js";
import { createPreviewService } from "./previewService.js";
import { download } from "../render/exporters.js";
import { newId } from "./ids.js";
import {
  catalogPage,
  queryReferences,
  STATUS_LABELS,
} from "../core/referenceCatalog.js";
import {
  createReferenceService,
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
  referenceService = createReferenceService(),
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
  let scope = "all";
  let page = 0;
  let references = null;
  let referenceError = "";
  let loadingReferences = false;
  let disposed = false;
  const loadReferences = referenceService.entries;
  let loadingReference = null;
  let revealReference = false;
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
    ["all", "All"],
    ["named", "Positions"],
    ["saved", "Saved"],
    ["favorites", "Favorites"],
    ["references", "References"],
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
  const group = element("input", { id: "catalog-group", type: "checkbox" });
  const groupField = element(
    "label",
    { className: "reference-group", htmlFor: group.id, hidden: true },
    [group, document.createTextNode("Group matching annotations")],
  );
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
      groupField,
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
      group.checked = false;
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
          textContent: `${library.index().filter((p) => p.status === "verified-3d").length} verified stock 3D presets · ${referenceManifest.records.toLocaleString("en")} source references.`,
        }),
        element("p", {
          textContent:
            "Every reference includes a ready-to-view artistic 3D composition with separate clothed figures. All 1,283 compositions have distinct joint geometry, but are not source reconstructions or verified physical poses. No editing or import is required.",
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
  const exportLibrary = button(
    "Export library ↗",
    () => {
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
    },
    "text-button",
  );
  const referenceTools = button(
    "Reference studies",
    openReferenceTools,
    "text-button",
  );
  const importLibrary = button(
    "+ Import presets",
    () => file.click(),
    "text-button",
  );
  const referenceProgress = element("p", {
    className: "reference-study-summary",
    hidden: true,
  });
  referenceProgress.setAttribute("aria-live", "polite");
  top.append(referenceProgress);
  root.append(
    top,
    list,
    pagination,
    element("div", { className: "library-bottom" }, [
      element("div", { className: "buttons" }, [
        referenceTools,
        importLibrary,
        exportLibrary,
        info,
      ]),
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
    group.onchange =
      () => {
        page = 0;
        refresh();
        list.scrollTop = 0;
      };

  function refresh() {
    const focusedPreset = document.activeElement?.dataset.preset;
    const focusedReference = document.activeElement?.dataset.reference;
    previewCleanups.forEach((cleanup) => cleanup());
    previewCleanups = [];
    observer?.disconnect();
    starts.clear();
    const isReferences = scope === "references";
    referenceTools.hidden = !isReferences;
    importLibrary.hidden = isReferences;
    exportLibrary.hidden = isReferences;
    referenceProgress.hidden = !isReferences || !references;
    root.dataset.collection = isReferences ? "references" : "presets";
    const all = library.index();
    categoryLabel.textContent = isReferences ? "Family" : "Category";
    groupField.hidden = !isReferences;
    search.placeholder = isReferences
      ? "Search references…"
      : "Search presets…";
    search.title = isReferences
      ? "Search by source ID, family, surface or figure count · /"
      : "Search presets · /";
    document.querySelector(`label[for="${search.id}"]`).textContent =
      isReferences ? "Search references" : "Search presets";
    const oldCategory = category.value || "all";
    category.replaceChildren(
      element("option", {
        value: "all",
        textContent: isReferences ? "All families" : "All categories",
      }),
      ...[
        ...new Set(
          isReferences
            ? Object.keys(referenceManifest.families)
            : all.map((p) => p.category),
        ),
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
      Number(supportStatus.value !== "all") +
      Number(isReferences && group.checked);
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
    if (isReferences) {
      renderReferences();
      if (focusedReference)
        list
          .querySelector(`[data-reference="${focusedReference}"]`)
          ?.focus({ preventScroll: true });
      return;
    }
    const favorites = library.favorites();
    const filtered = searchCatalog(all, {
      query: search.value,
      category: category.value,
      scope,
      favorites,
    }).filter(
      (p) => supportStatus.value === "all" || p.status === supportStatus.value,
    );
    count.textContent = `${filtered.length} studies`;
    const paged = updatePages(filtered);
    for (const entry of paged.entries) {
      const preset = library.get(entry.id);
      const choose = button("", () => handlers.select(preset), "preset-select");
      choose.dataset.preset = preset.id;
      choose.setAttribute("aria-label", `Load ${preset.title}`);
      choose.title = preset.title;
      choose.setAttribute("aria-pressed", String(preset.id === selected));
      const picture = element(
        "span",
        { className: "preset-preview", title: "Authored pose preview" },
        [poseDiagram(authoredPreview(preset.scene))],
      );
      const previewNote = element("span", {
        className: "preset-note",
        id: newId("preview-note"),
        textContent: "Preparing preview…",
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
            textContent: `${preset.scene.actors.length === 1 ? "Solo" : `${preset.scene.actors.length} figures`} · ${preset.category}`,
          }),
          previewNote,
          element("span", {
            className: `support-badge ${entry.status}`,
            textContent: STATUS_LABELS[entry.status],
            title:
              entry.status === "verified-3d"
                ? "Audited stock configuration only; edits need their own checks."
                : "This personal preset has not been individually certified. Inspect Pose checks; adjustment may be needed.",
          }),
          ...(preset.source
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
      list.append(
        element(
          "article",
          {
            className: `preset-card${preset.id === selected ? " selected" : ""}`,
          },
          [choose, favorite],
        ),
      );
      const start = () =>
        previewCleanups.push(
          previews.subscribe(preset.scene, (result) => {
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
      if (preset.id === selected) start();
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
              scope = "all";
              page = 0;
              supportStatus.value = "all";
              search.value = "";
              category.value = "all";
              group.checked = false;
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

  function updatePages(entries) {
    const result = catalogPage(entries, page);
    page = result.page;
    pagination.hidden = result.pages === 1;
    pageLabel.textContent = `${page + 1} / ${result.pages}`;
    previous.disabled = page === 0;
    next.disabled = page + 1 === result.pages;
    return result;
  }

  function renderReferences() {
    count.textContent = `${referenceManifest.records.toLocaleString("en")} references`;
    if (!references) {
      const message = element("div", { className: "empty-state" }, [
        element("p", {
          textContent:
            referenceError ||
            "Loading the source index. The studio remains available…",
        }),
      ]);
      list.append(message);
      if (referenceError)
        message.append(
          button("Retry references", () => {
            referenceError = "";
            refresh();
          }),
        );
      else if (!loadingReferences) {
        loadingReferences = true;
        loadReferences()
          .then((entries) => {
            references = entries;
          })
          .catch((error) => {
            referenceError = error.message;
          })
          .finally(() => {
            loadingReferences = false;
            if (!disposed && scope === "references") refresh();
          });
      }
      return;
    }
    const authored = authoredIndex();
    referenceProgress.hidden = false;
    referenceProgress.textContent = `${references.length.toLocaleString("en")} artistic · ${authored.size.toLocaleString("en")} personal`;
    referenceProgress.title =
      "Built-in artistic interpretations are ready to view. Personal studies override them and remain unreviewed.";
    const filtered = queryReferences(
      references.map((entry) =>
        authored.has(entry.sourceId)
          ? { ...entry, status: "authored-3d" }
          : { ...entry, status: "artistic-3d" },
      ),
      {
        query: search.value,
        family: category.value,
        status: supportStatus.value,
        group: group.checked,
      },
    );
    if (revealReference) {
      const index = filtered.findIndex((entry) => referenceSelected(entry));
      if (index >= 0) page = Math.floor(index / 24);
      revealReference = false;
    }
    count.textContent = `${filtered.length.toLocaleString("en")} ${group.checked ? "groups" : "references"}`;
    const paged = updatePages(filtered);
    if (!filtered.length)
      list.append(
        element("p", {
          className: "empty-state",
          textContent:
            "No matching references. These are artistic 3D posture studies, not verified 3D presets.",
        }),
      );
    for (const entry of paged.entries) {
      const choose = button(
        "",
        () => handlers.previewReference(entry),
        "reference-select",
      );
      choose.dataset.reference = entry.id;
      choose.setAttribute("aria-label", `Preview reference ${entry.sourceId}`);
      choose.setAttribute("aria-pressed", String(referenceSelected(entry)));
      choose.setAttribute("aria-busy", String(loadingReference === entry.id));
      choose.append(
        element("span", {
          className: "reference-mark",
          textContent: "3D",
          ariaHidden: "true",
        }),
        element("span", { className: "reference-info" }, [
          element("span", { className: "reference-line" }, [
            element("strong", { textContent: entry.sourceId }),
            element("span", {
              className: "support-badge",
              textContent:
                loadingReference === entry.id
                  ? "Loading 3D…"
                  : STATUS_LABELS[entry.status],
            }),
          ]),
          element("span", {
            className: "reference-family",
            textContent: entry.family,
          }),
          element("small", {
            textContent: `${entry.figures} figures · ${entry.surface}${entry.members ? ` · ${entry.members.length} matching records` : ""}`,
          }),
        ]),
      );
      const details = button(
        "ⓘ",
        () => openReference(entry),
        "reference-details icon-button",
      );
      details.setAttribute("aria-label", `Reference details ${entry.sourceId}`);
      list.append(
        element(
          "article",
          {
            className: `reference-card${referenceSelected(entry) ? " selected" : ""}`,
          },
          [choose, details],
        ),
      );
    }
  }

  function openReference(entry) {
    const modal = dialog(`Reference ${entry.sourceId}`);
    const peers = references.filter((e) => e.variant === entry.variant);
    modal.append(
      element("p", {
        className: "support-badge",
        textContent: authoredIndex().has(entry.sourceId)
          ? "Authored · unreviewed · not a verified reconstruction"
          : "Artistic 3D · original interpretation, not a verified reconstruction",
      }),
      element("p", {
        textContent: `${entry.figures} figures · ${entry.family} · ${entry.surface}`,
      }),
      element("p", {
        textContent: `Source: SexPoses / ${referenceManifest.sourceFile} / ${entry.sourceId}`,
      }),
      element("p", {
        textContent: `${peers.length} records share this structured annotation. This is not proof of anatomically identical positions.`,
      }),
      element("p", {
        textContent:
          "This ready-to-view artistic composition uses a designed gesture palette and broad posture families, not measured source coordinates. Clothed participants are separate on a neutral floor. Original interactions are not reconstructed. The earlier generated approximation remains available below.",
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
        "Open 3D preview",
        () => {
          modal.close();
          handlers.previewReference(entry);
        },
        "action primary",
      ),
      button("Open generated approximation", () => {
        modal.close();
        handlers.previewReference(entry, { generated: true });
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

  function referenceSelected(entry) {
    return (
      selected === entry.id || selected === referenceStudyId(entry.sourceId)
    );
  }

  function authoredIndex() {
    const saved = new Map(
      library
        .index()
        .filter(isReferenceStudy)
        .map((p) => [p.id, p]),
    );
    return new Map(
      (references ?? [])
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
    const modal = dialog("Save reference study");
    const title = field("Study name", snapshot.title, { required: true });
    const replace = element("input", {
      type: "checkbox",
      id: newId("replace-study"),
    });
    const error = element("p", { className: "dialog-error", role: "alert" });
    const form = element("form", {}, [
      element("p", {
        textContent: `${entry.sourceId} · ${entry.figures} figures. Saves the completed joint angles and placements as this reference's active study. This is unreviewed, not a verified reconstruction.`,
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
                  "Replace the existing authored study for this reference",
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
          textContent: "Save study",
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
              category: "Reference studies",
              description:
                "Locally authored, separate clothed posture study. Unreviewed; not a verified reconstruction.",
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
          `Authored study saved for ${entry.sourceId}. It remains unreviewed.`,
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

  async function openReferenceTools() {
    const modal = dialog("Reference studies");
    const message = element("p", { textContent: "Loading reference index…" });
    const error = element("p", { className: "dialog-error", role: "alert" });
    modal.append(message, error);
    modal.showModal();
    try {
      references = await loadReferences();
      if (!modal.isConnected) return;
      const updateCount = () => {
        message.textContent = `${authoredIndex().size.toLocaleString("en")} / ${references.length.toLocaleString("en")} references have authored studies in this browser. All are unreviewed. Export JSON for backup or transfer.`;
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
            "Import source-linked PoseForge catalog JSON. Each study must include the matching source ID and annotation hash, all participants, fixed joints/placements, clothing, a neutral floor and separate figures. The entire batch is checked before anything is saved.",
        }),
        button("Export authored studies", () => {
          try {
            const presets = [...authoredIndex().values()].map((p) =>
              library.get(p.id),
            );
            if (!presets.length)
              throw new Error("No authored reference studies to export yet.");
            download(
              serializeReferenceStudies(presets),
              "poseforge-reference-studies.json",
              "application/json",
            );
          } catch (e) {
            error.textContent = e.message;
          }
        }),
        element("div", { className: "field" }, [
          element("label", {
            htmlFor: input.id,
            textContent: "Import reference studies (JSON)",
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
          const studies = parseReferenceStudies(text, references);
          const conflicts = studies.filter((p) => library.get(p.id)).length;
          const replace = element("input", {
            type: "checkbox",
            id: newId("replace-batch"),
          });
          const apply = button(
            "Import studies",
            async () => {
              apply.disabled = true;
              input.disabled = true;
              replace.disabled = true;
              try {
                const result = await library.saveReferenceStudies(
                  studies,
                  references,
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
                    `Replace ${conflicts} existing authored studies`,
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
      if (scope === "references") refresh();
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
        if (scope !== "references") {
          scope = "references";
          search.value = "";
          category.value = "all";
          supportStatus.value = "all";
          group.checked = false;
        }
        revealReference = changed;
      }
      refresh();
      if (changed)
        list
          .querySelector(".preset-card.selected, .reference-card.selected")
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

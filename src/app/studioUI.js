import { searchCatalog, MAX_PACK_BYTES } from "../core/catalog.js";
import { authoredPreview, poseDiagram } from "./diagram.js";
import { createPreviewService } from "./previewService.js";
import { download } from "../render/exporters.js";
import { newId } from "./ids.js";

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

export function buildStudio(library, handlers) {
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
  const count = element("span");
  const search = element("input", {
    type: "search",
    placeholder: "Find your next pose…",
    id: "catalog-search",
  });
  const scopes = element("div", { className: "library-scopes" });
  for (const [value, label] of [
    ["all", "All"],
    ["named", "Positions"],
    ["saved", "Saved"],
    ["favorites", "Favorites"],
  ]) {
    const node = button(
      label,
      () => {
        scope = value;
        refresh();
        list.scrollTop = 0;
      },
      value === scope ? "active" : "",
    );
    node.dataset.scope = value;
    scopes.append(node);
  }
  const category = element("select", { id: "catalog-category" });
  const top = element("div", { className: "library-top" }, [
    element("span", { className: "eyebrow", textContent: "A PLACE TO BEGIN" }),
    element("div", { className: "library-title" }, [
      element("h2", { textContent: "The pose library" }),
      count,
    ]),
    button("+ New study", () => handlers.newStudy(), "action full new-study"),
    element("div", { className: "search-box" }, [
      element("label", {
        htmlFor: search.id,
        className: "sr-only",
        textContent: "Search presets",
      }),
      search,
    ]),
    scopes,
    element("div", { className: "category-field" }, [
      element("label", { htmlFor: category.id, textContent: "Category" }),
      category,
    ]),
  ]);
  const list = element("div", { className: "catalog-list" });
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
        download(library.export(), "poseforge-library.json", "application/json");
        toast("Your saved library was downloaded.");
      } catch (error) {
        toast(`Export failed: ${error.message}`);
      }
    },
    "text-button",
  );
  root.append(
    top,
    list,
    element("div", { className: "library-bottom" }, [
      element("div", { className: "buttons" }, [
        button("+ Import presets", () => file.click(), "text-button"),
        exportLibrary,
      ]),
      element("p", { textContent: "Make it yours. Saved in this browser." }),
      file,
    ]),
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
            () => {
              library.reset();
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
        throw new Error("Catalog files must be smaller than 2 MB.");
      const added = library.import(await chosen.text());
      scope = "saved";
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
    }
  };
  search.oninput = category.onchange = () => {
    refresh();
    list.scrollTop = 0;
  };

  function refresh() {
    const focusedPreset = document.activeElement?.dataset.preset;
    previewCleanups.forEach((cleanup) => cleanup());
    previewCleanups = [];
    observer?.disconnect();
    starts.clear();
    const all = library.all();
    const oldCategory = category.value || "all";
    category.replaceChildren(
      element("option", { value: "all", textContent: "All categories" }),
      ...[...new Set(all.map((p) => p.category))]
        .sort()
        .map((name) => element("option", { value: name, textContent: name })),
    );
    category.value = [...category.options].some((o) => o.value === oldCategory)
      ? oldCategory
      : "all";
    scopes.querySelectorAll("button").forEach((node) => {
      const active = scope === node.dataset.scope;
      node.classList.toggle("active", active);
      node.setAttribute("aria-pressed", String(active));
    });
    const favorites = library.favorites();
    const filtered = searchCatalog(all, {
      query: search.value,
      category: category.value,
      scope,
      favorites,
    });
    count.textContent = `${filtered.length} studies`;
    list.replaceChildren();
    for (const preset of filtered) {
      const choose = button("", () => handlers.select(preset), "preset-select");
      choose.dataset.preset = preset.id;
      choose.setAttribute("aria-label", `Load ${preset.title}`);
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
        ]),
      );
      const favorite = button(
        favorites.includes(preset.id) ? "★" : "☆",
        () => {
          try {
            library.favorite(preset.id);
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
              () => {
                library.remove(snapshot.id);
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
    form.onsubmit = (event) => {
      event.preventDefault();
      try {
        const next = library.save(
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
          event.submitter?.value === "update" ? snapshot.id : null,
        );
        selected = next.id;
        handlers.saved(next);
        scope = "saved";
        search.value = "";
        category.value = "all";
        refresh();
        modal.close();
        toast("Preset saved to your library.");
      } catch (e) {
        error.textContent = e.message;
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
    setPreview(scene, preview) {
      previews.remember(scene, preview);
    },
    dispose() {
      observer?.disconnect();
      starts.clear();
      previewCleanups.forEach((cleanup) => cleanup());
      previews.dispose();
    },
    setSelected(id) {
      const changed = selected !== id;
      selected = id;
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
        () => {
          try {
            action();
            modal.close();
          } catch (e) {
            error.textContent = e.message;
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

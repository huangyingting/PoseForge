/**
 * The control panel.
 *
 * The one idea worth defending here is the interpretation trace. A text-driven
 * tool that silently produces the wrong picture is worse than useless, because
 * the user has no way to tell a sentence the system misread from a sentence it
 * read correctly and then rendered badly - and those need completely different
 * fixes. So every field the parser set is listed next to the phrase that set
 * it, and every phrase it could not place is listed too.
 *
 * The overrides exist for the same reason. Once the trace says "arrangement <-
 * behind", disagreeing with that should be one click, not a rephrasing puzzle.
 * They write into the scene and re-solve, which is the same path the text takes,
 * so an override cannot produce a scene that typing could not have produced.
 */

import {
  ARRANGEMENT_NAMES,
  POSTURE_NAMES,
  SURFACE_NAMES,
  resolveArrangement,
} from "../core/poseLibrary.js";

const EXAMPLES = [
  "missionary on the bed",
  "he kneels behind her while she is on all fours, hands on her hips",
  "a slim woman sitting on his lap, arms around his neck",
  "spooning on the bed",
  "he is carrying her against the wall",
  "a tall man standing behind a short woman bent over the table",
  "她仰卧在床上，他跪在她身后",
  "两人侧躺，面对面在床上",
];

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
};

const section = (title, body) => el("section", {}, [el("h2", { textContent: title }), body]);

/** A labelled <select>. */
function picker(label, options, { blank = null } = {}) {
  const select = el("select");
  if (blank !== null) select.append(el("option", { value: "", textContent: blank }));
  for (const option of options) {
    select.append(
      el("option", { value: option, textContent: option.replace(/_/g, " ") })
    );
  }
  const field = el("div", { className: "field" }, [
    el("label", { textContent: label }),
    select,
  ]);
  return { field, select };
}

/** A labelled slider that shows its own value. */
function slider(label, { min, max, step, format }) {
  const input = el("input", { type: "range", min, max, step });
  const readout = el("span", { className: "value" });
  const field = el("div", { className: "field" }, [
    el("label", { textContent: label }),
    el("div", {}, [input, readout]),
  ]);
  const sync = () => (readout.textContent = format(Number(input.value)));
  input.addEventListener("input", sync);
  return { field, input, sync };
}

/**
 * Build the panel.
 *
 * @param {HTMLElement} root
 * @param {{onText: Function, onScene: Function, onExport: Function, onView: Function}} handlers
 */
export function buildPanel(root, handlers) {
  root.replaceChildren();
  root.append(
    el("h1", { textContent: "PoseForge" }),
    el("p", {
      className: "tagline",
      textContent: "Describe two people. One field decides both the surface and the collisions.",
    })
  );

  /* ---- description ---- */
  const input = el("textarea", {
    placeholder: "e.g. she is lying on her back on the bed, he is kneeling between her legs",
    spellcheck: false,
  });
  const examples = el("div", { className: "examples" });
  for (const example of EXAMPLES) {
    examples.append(
      el("button", {
        className: "chip",
        type: "button",
        textContent: example.length > 34 ? `${example.slice(0, 32)}…` : example,
        title: example,
        onclick: () => {
          input.value = example;
          handlers.onText(example);
        },
      })
    );
  }
  root.append(section("Description", el("div", {}, [input, examples])));

  // Typing re-solves, but not on every keystroke: a full pass is a fifth of a
  // second and firing one per character queues work faster than it retires.
  // Waiting for a pause in typing is both cheaper and what the user means -
  // half a word is rarely a sentence they want rendered.
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => handlers.onText(input.value), 260);
  });

  /* ---- interpretation ---- */
  const trace = el("ul", { className: "trace" });
  const traceEmpty = el("p", { className: "empty", textContent: "Nothing read yet." });
  root.append(section("How it was read", el("div", {}, [traceEmpty, trace])));

  /* ---- notes ---- */
  const notes = el("ul", { className: "notes" });
  root.append(section("Notes", notes));

  /* ---- overrides ---- */
  const arrangement = picker("Arrangement", ARRANGEMENT_NAMES, { blank: "— none —" });
  const surface = picker("Surface", SURFACE_NAMES);
  const facing = picker("Facing", ["as written", "toward", "away"]);
  const actorHost = el("div");
  const overrides = el("div", {}, [
    arrangement.field,
    surface.field,
    facing.field,
    actorHost,
  ]);
  root.append(section("Override", overrides));

  /* ---- export ---- */
  const buttons = el("div", { className: "buttons" });
  const exportButtons = [
    ["PNG 1×", () => handlers.onExport("png", { scale: 1 })],
    ["PNG 2×", () => handlers.onExport("png", { scale: 2 })],
    ["PNG 4×", () => handlers.onExport("png", { scale: 4 })],
    ["PNG cut-out", () => handlers.onExport("png", { scale: 2, transparent: true })],
    ["SVG line art", () => handlers.onExport("svg", {})],
  ].map(([label, action]) => {
    const button = el("button", { className: "action", type: "button", textContent: label });
    button.addEventListener("click", action);
    buttons.append(button);
    return button;
  });
  root.append(section("Export", buttons));

  /* ---- view ---- */
  const view = el("div", { className: "buttons" }, [
    el("button", {
      className: "action",
      type: "button",
      textContent: "Reframe",
      onclick: () => handlers.onView("frame"),
    }),
    el("button", {
      className: "action",
      type: "button",
      textContent: "Front",
      onclick: () => handlers.onView("front"),
    }),
    el("button", {
      className: "action",
      type: "button",
      textContent: "Side",
      onclick: () => handlers.onView("side"),
    }),
    el("button", {
      className: "action",
      type: "button",
      textContent: "Top",
      onclick: () => handlers.onView("top"),
    }),
  ]);
  root.append(section("View", view));

  /* ---- wiring ---- */

  // The scene the overrides edit. Replaced wholesale every time a parse comes
  // back, so an override always starts from what is actually on screen.
  let scene = null;
  // Set while the controls are being filled in from a new scene. Without it,
  // programmatically setting a <select>'s value would look like a user edit and
  // kick off another solve, which would refill the controls, and so on.
  let syncing = false;

  const emit = () => {
    if (syncing || !scene) return;
    handlers.onScene(structuredClone(scene));
  };

  arrangement.select.addEventListener("change", () => {
    const value = arrangement.select.value;
    scene.relationship = value ? { ...scene.relationship, arrangement: value } : {};
    emit();
  });
  surface.select.addEventListener("change", () => {
    scene.support = { ...scene.support, surface: surface.select.value };
    emit();
  });
  /**
   * The arrangement's own idea of facing each other, in degrees.
   *
   * "Toward" is not 180. It is a half turn away from whichever way the
   * arrangement already points, and arrangements disagree: turning to face a
   * standing partner is half a turn, turning to face one lying on their back is
   * none at all. Hard-coding the number makes this control say "away" for
   * cowgirl and "toward" for reverse cowgirl, which is the wrong way round.
   */
  const defaultYaw = () => resolveArrangement(scene.relationship?.arrangement)?.yaw ?? 180;

  facing.select.addEventListener("change", () => {
    const value = facing.select.value;
    const base = defaultYaw();
    const yaw = value === "toward" ? base : value === "away" ? (base + 180) % 360 : undefined;
    scene.relationship = { ...scene.relationship };
    if (yaw == null) delete scene.relationship.yaw;
    else scene.relationship.yaw = yaw;
    emit();
  });

  /** Per-actor controls, rebuilt when the number of people changes. */
  const actorControls = [];
  function buildActorCards(count, swatches) {
    actorHost.replaceChildren();
    actorControls.length = 0;
    for (let index = 0; index < count; index += 1) {
      const posture = picker("Posture", POSTURE_NAMES);
      const stature = slider("Height", {
        min: 1.45,
        max: 2.0,
        step: 0.01,
        format: (v) => `${Math.round(v * 100)} cm`,
      });
      const build = slider("Build", {
        min: 0.82,
        max: 1.28,
        step: 0.01,
        format: (v) => (v < 0.94 ? "slim" : v > 1.08 ? "heavy" : "average"),
      });
      const title = el("h3", {}, [
        el("span", {
          className: "swatch",
          style: `background:${swatches[index] ?? "#ccc"}`,
        }),
        el("span", { textContent: `Partner ${String.fromCharCode(65 + index)}` }),
      ]);
      actorHost.append(
        el("div", { className: "actor-card" }, [title, posture.field, stature.field, build.field])
      );

      posture.select.addEventListener("change", () => {
        scene.actors[index].posture = posture.select.value;
        emit();
      });
      for (const [control, key] of [
        [stature, "stature"],
        [build, "build"],
      ]) {
        // `change` rather than `input`: a slider drag fires a hundred times and
        // each one is a full solve. The readout still follows the thumb live.
        control.input.addEventListener("change", () => {
          scene.actors[index][key] = Number(control.input.value);
          emit();
        });
      }

      actorControls.push({ posture, stature, build, title: title.lastChild });
    }
  }

  return {
    /** Put text in the box without triggering a re-solve. */
    setText(text) {
      input.value = text;
    },

    /** Show the parser's reasoning. */
    setInterpretation(entries) {
      trace.replaceChildren();
      traceEmpty.hidden = entries.length > 0;
      for (const entry of entries) {
        const value = Array.isArray(entry.value)
          ? entry.value.join(", ")
          : typeof entry.value === "object" && entry.value !== null
            ? JSON.stringify(entry.value)
            : String(entry.value);
        trace.append(
          el("li", {}, [
            el("span", { className: "phrase", textContent: entry.phrase ?? "(default)" }),
            el("span", { className: "arrow", textContent: "→" }),
            el("span", {
              className: "effect",
              textContent: `${entry.field} = ${value}${entry.note ? ` (${entry.note})` : ""}`,
            }),
          ])
        );
      }
    },

    /** Show warnings, errors, and the all-clear. */
    setNotes(entries) {
      notes.replaceChildren();
      if (entries.length === 0) {
        notes.append(el("li", { className: "ok", textContent: "No problems reported." }));
        return;
      }
      for (const entry of entries) {
        notes.append(
          el("li", { className: entry.level ?? "warning", textContent: entry.message })
        );
      }
    },

    /** Point the override controls at a new scene. */
    setScene(next, swatches) {
      scene = structuredClone(next);
      syncing = true;
      if (actorControls.length !== scene.actors.length) {
        buildActorCards(scene.actors.length, swatches);
      }
      arrangement.select.value = scene.relationship?.arrangement ?? "";
      surface.select.value = scene.support?.surface ?? "floor";
      const yaw = scene.relationship?.yaw;
      facing.select.value =
        yaw == null ? "as written" : yaw === defaultYaw() ? "toward" : "away";
      scene.actors.forEach((actor, index) => {
        const control = actorControls[index];
        if (!control) return;
        control.posture.select.value = actor.posture ?? "standing";
        control.stature.input.value = actor.stature ?? 1.72;
        control.build.input.value = actor.build ?? 1;
        control.stature.sync();
        control.build.sync();
        control.title.textContent = actor.label ?? `Partner ${String.fromCharCode(65 + index)}`;
      });
      syncing = false;
    },

    /** Export is meaningless until there is something on screen. */
    setExportEnabled(enabled) {
      for (const button of exportButtons) button.disabled = !enabled;
    },
  };
}

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
  resolvePosture,
} from "../core/poseLibrary.js";
import { CHANNELS, POSEABLE_BONES, ROM } from "../core/skeleton.js";
import { HAIR_STYLES } from "../core/hair.js";
import { GARMENT_COLOURS, GARMENT_NAMES } from "../core/garments.js";
import { HAND_SHAPE_NAMES } from "../core/handPose.js";
import { FOOT_SHAPE_NAMES } from "../core/footPose.js";

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
  // `--fill` is how far along the track the value sits, and the stylesheet
  // paints the track with it. A range input has no styleable "filled" part in
  // WebKit - Gecko's `::-moz-range-progress` has no counterpart - so the only
  // way to have the track read as a level rather than as a rail is to hand the
  // fraction to CSS from here, on every change, including the programmatic
  // ones that `sync` exists for.
  const sync = () => {
    const value = Number(input.value);
    readout.textContent = format(value);
    const span = Number(max) - Number(min) || 1;
    input.style.setProperty("--fill", `${(((value - Number(min)) / span) * 100).toFixed(2)}%`);
  };
  input.addEventListener("input", sync);
  sync();
  return { field, input, sync };
}

/**
 * A labelled row of checkboxes.
 *
 * Clothing is the one control here that is genuinely a set rather than a
 * choice - a bra and briefs are not alternatives - and a multiple <select> hides
 * that behind a scroll box nobody discovers.
 */
function toggles(label, options) {
  const boxes = new Map();
  const row = el("div", { className: "toggles" });
  for (const option of options) {
    const input = el("input", { type: "checkbox" });
    boxes.set(option, input);
    row.append(
      el("label", { className: "toggle" }, [input, el("span", { textContent: option })])
    );
  }
  const field = el("div", { className: "field" }, [el("label", { textContent: label }), row]);
  return {
    field,
    boxes,
    value: () => [...boxes].filter(([, box]) => box.checked).map(([name]) => name),
  };
}

/**
 * A collapsible group inside an actor card.
 *
 * Every actor now carries three pages of controls and only one of them - the
 * posture - is touched in the common case. Folded away they cost a line each;
 * laid out flat they push the export buttons off the bottom of the panel.
 */
function group(title) {
  const summary = el("summary", { textContent: title });
  const body = el("div", { className: "group-body" });
  return { details: el("details", {}, [summary, body]), body, summary };
}

/** One side of a paired control, read back from a `string | {l, r}` spec. */
const sideOf = (value, side) => (typeof value === "string" ? value : (value?.[side] ?? ""));

/**
 * Two sides back into the spec shape.
 *
 * The same shape going out as came in: one name when both sides agree, so a
 * scene edited in the panel reads the way a person would have written it, and
 * nothing at all when neither side was asked for, so the inference downstream -
 * `handShapes` reading the contacts, the posture setting its own ankles - is
 * left alone rather than overruled with a blank.
 */
function bothSides(left, right) {
  if (!left && !right) return undefined;
  if (left === right) return left;
  return { ...(left ? { l: left } : {}), ...(right ? { r: right } : {}) };
}

/**
 * Build the panel.
 *
 * @param {HTMLElement} root
 * @param {{onText: Function, onScene: Function, onExport: Function, onView: Function}} handlers
 */
export function buildPanel(root, handlers) {
  root.replaceChildren();
  // The brand block is its own element rather than two loose children of the
  // panel so the stylesheet can pin it: the panel scrolls, and a title that
  // scrolls away takes the only thing identifying the application with it.
  root.append(
    el("header", { className: "brand" }, [
      el("h1", { textContent: "PoseForge" }),
      el("p", {
        className: "tagline",
        textContent: "Describe two people. One field decides both the surface and the collisions.",
      }),
    ])
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
  ].map(([label, action], index) => {
    // One of the five is the primary, and it is the 2x rather than the first:
    // five identical buttons in a row leave a first-time visitor reading all
    // five before picking, and 2x is the one almost everyone wants - 1x is a
    // viewport-sized screenshot and 4x takes long enough to look broken.
    const button = el("button", {
      className: index === 1 ? "action primary" : "action",
      type: "button",
      textContent: label,
    });
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

  /** Which ROM entry each adjustable bone reads its range from. */
  const BONE_KIND = new Map(POSEABLE_BONES.map((entry) => [entry.name, entry.kind]));

  /**
   * The angle a bone sits at before anyone touches it.
   *
   * `joints` on a validated scene holds only what was *asked* for - the limb
   * phrases, the foot shapes, and anything written out by name. The rest of the
   * pose lives in the posture archetype and never appears there, so a slider
   * parked at zero would snap a kneeling figure's knee from 92 degrees to
   * straight the moment it was nudged a single degree. Reading the archetype
   * underneath makes the first drag continuous, and makes "reset" mean "back to
   * the posture" instead of "straighten".
   *
   * What it cannot show is the solver's own corrections - the IK that puts a
   * hand on a hip, the push-out that stops two people sharing a volume. Those
   * are quaternions laid over the whole chain at solve time and have no angles
   * to read back. So these controls state an intent and the solver still has
   * the last word, which is the same bargain the posture itself gets.
   */
  const baseline = (index, bone, channel) => {
    const actor = scene?.actors?.[index];
    const written = actor?.joints?.[bone]?.[channel];
    if (written != null) return written;
    return resolvePosture(actor?.posture)?.joints?.[bone]?.[channel] ?? 0;
  };

  /** The bone picker and its three sliders, for one actor. */
  function jointEditor(index) {
    const bone = picker(
      "Joint",
      POSEABLE_BONES.map((entry) => entry.name)
    );
    const channels = CHANNELS.map((channel) => ({
      channel,
      control: slider(`${channel[0].toUpperCase()}${channel.slice(1)}`, {
        min: -180,
        max: 180,
        step: 1,
        format: (value) => `${Math.round(value)}°`,
      }),
    }));
    const adjusted = el("p", { className: "hint" });
    const reset = el("button", { className: "action small", type: "button", textContent: "Reset joint" });
    const resetAll = el("button", { className: "action small", type: "button", textContent: "Reset all" });

    /** Point the sliders at whatever the chosen bone is doing now. */
    const load = () => {
      const range = ROM[BONE_KIND.get(bone.select.value)];
      if (!range) return;
      for (const { channel, control } of channels) {
        const [low, high] = range[channel];
        control.input.min = low;
        control.input.max = high;
        // A channel with no travel is not a control. Both of the toe's are
        // 0..0, and a slider that cannot move but still looks like one reads as
        // broken rather than as "this joint is a hinge".
        control.input.disabled = low === high;
        control.input.value = baseline(index, bone.select.value, channel);
        control.sync();
      }
      const names = Object.keys(scene?.actors?.[index]?.joints ?? {});
      adjusted.textContent = names.length
        ? `Set away from the posture: ${names.join(", ")}`
        : "Nothing set; the posture decides every joint.";
    };

    bone.select.addEventListener("change", load);
    for (const { channel, control } of channels) {
      // `change` rather than `input`, as with height and build: one drag is a
      // hundred events and each one is a full solve.
      control.input.addEventListener("change", () => {
        const actor = scene.actors[index];
        actor.joints = { ...actor.joints };
        actor.joints[bone.select.value] = {
          ...actor.joints[bone.select.value],
          [channel]: Number(control.input.value),
        };
        emit();
      });
    }
    reset.addEventListener("click", () => {
      const actor = scene.actors[index];
      if (!actor.joints?.[bone.select.value]) return;
      actor.joints = { ...actor.joints };
      delete actor.joints[bone.select.value];
      emit();
    });
    resetAll.addEventListener("click", () => {
      // Deleting the whole table rather than zeroing it: re-validating rebuilds
      // whatever the *description* implies - the limb phrases, the foot shapes -
      // so this returns the figure to the sentence rather than to a T-pose.
      const actor = scene.actors[index];
      if (!actor.joints) return;
      delete actor.joints;
      emit();
    });

    const body = el("div", {}, [
      bone.field,
      ...channels.map(({ control }) => control.field),
      el("div", { className: "buttons" }, [reset, resetAll]),
      adjusted,
    ]);
    return { body, load };
  }

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

      const hair = picker("Hair", Object.keys(HAIR_STYLES), { blank: "— for the body —" });
      const wearing = toggles("Wearing", GARMENT_NAMES);
      const outfit = picker("Colour", Object.keys(GARMENT_COLOURS), { blank: "— black —" });
      const look = group("Appearance");
      look.body.append(hair.field, wearing.field, outfit.field);

      const handL = picker("Left hand", HAND_SHAPE_NAMES, { blank: "— from the pose —" });
      const handR = picker("Right hand", HAND_SHAPE_NAMES, { blank: "— from the pose —" });
      const footL = picker("Left foot", FOOT_SHAPE_NAMES, { blank: "— from the posture —" });
      const footR = picker("Right foot", FOOT_SHAPE_NAMES, { blank: "— from the posture —" });
      const ends = group("Hands & feet");
      ends.body.append(handL.field, handR.field, footL.field, footR.field);

      const joints = jointEditor(index);
      const bones = group("Joints");
      bones.body.append(joints.body);

      const title = el("h3", {}, [
        el("span", {
          className: "swatch",
          style: `background:${swatches[index] ?? "#ccc"}`,
        }),
        el("span", { textContent: `Partner ${String.fromCharCode(65 + index)}` }),
      ]);
      actorHost.append(
        el("div", { className: "actor-card" }, [
          title,
          posture.field,
          stature.field,
          build.field,
          look.details,
          ends.details,
          bones.details,
        ])
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
      // Empty is not a value: it means "you decide", so it is written as absent
      // rather than as a blank the validator would have to reject.
      for (const [control, key] of [
        [hair, "hair"],
        [outfit, "outfit"],
      ]) {
        control.select.addEventListener("change", () => {
          scene.actors[index][key] = control.select.value || undefined;
          emit();
        });
      }
      for (const box of wearing.boxes.values()) {
        box.addEventListener("change", () => {
          scene.actors[index].wearing = wearing.value();
          emit();
        });
      }
      for (const [left, right, key] of [
        [handL, handR, "hands"],
        [footL, footR, "feet"],
      ]) {
        for (const control of [left, right]) {
          control.select.addEventListener("change", () => {
            scene.actors[index][key] = bothSides(left.select.value, right.select.value);
            emit();
          });
        }
      }

      actorControls.push({
        posture,
        stature,
        build,
        hair,
        wearing,
        outfit,
        handL,
        handR,
        footL,
        footR,
        joints,
        summary: bones.summary,
        title: title.lastChild,
      });
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
        control.hair.select.value = actor.hair ?? "";
        control.outfit.select.value = actor.outfit ?? "";
        const worn = actor.wearing ?? [];
        for (const [name, box] of control.wearing.boxes) box.checked = worn.includes(name);
        control.handL.select.value = sideOf(actor.hands, "l");
        control.handR.select.value = sideOf(actor.hands, "r");
        control.footL.select.value = sideOf(actor.feet, "l");
        control.footR.select.value = sideOf(actor.feet, "r");
        // After the scene is in place: the sliders read their range and their
        // value out of it.
        control.joints.load();
        const set = Object.keys(actor.joints ?? {}).length;
        control.summary.textContent = set ? `Joints (${set} set)` : "Joints";
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

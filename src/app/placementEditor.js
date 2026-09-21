import {
  captureSolvedPose,
  placementFromRoot,
  PLACEMENT_POSITION_LIMIT,
  isFixedPlacement,
} from "../core/placement.js";
import { newId } from "./ids.js";

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** Authored placement values stay separate from the last completed rig. */
export function createPlacementEditor(getActor, changed) {
  let solved = null,
    solvedPlacement = null,
    captured = null,
    feedbackKind = null;
  const fixed = el("input", { type: "checkbox" });
  const capture = el("button", {
    type: "button",
    className: "action small",
    textContent: "Capture solved pose",
    disabled: true,
  });
  const guide = el("button", {
    type: "button",
    className: "action small",
    textContent: "Use solved pose as guide",
    disabled: true,
  });
  const reset = el("button", {
    type: "button",
    className: "action small",
    textContent: "Reset placement",
    disabled: true,
  });
  const hint = el("p", {
    className: "hint",
    textContent:
      "World position and XYZ rotation. Authored placement sets the initial position and facing. Fixed placement stays there; guided placement may adjust. Capture fixes all joint angles too; a solved-pose guide leaves them guided. Reset placement to use the arrangement again, and reset joints separately. Contacts and support are still checked. Use Fit view if needed.",
  });
  const feedback = el("p", { className: "hint" });
  feedback.setAttribute("role", "alert");
  const output = el("output", { className: "hint solved-placement" });
  output.setAttribute("aria-label", "Solved placement");
  output.setAttribute("aria-live", "off");
  const fields = [];
  for (const [key, label, limit] of [
    ["position", "Position", PLACEMENT_POSITION_LIMIT],
    ["rotation", "Rotation", 180],
  ])
    for (const [axis, name] of ["X", "Y", "Z"].entries()) {
      const input = el("input", {
        id: newId("placement"),
        type: "number",
        min: -limit,
        max: limit,
        step: "any",
        required: true,
        inputMode: "decimal",
      });
      const title = `${label} ${name} (${key === "position" ? "m" : "degrees"})`;
      const field = el("div", { className: "field" }, [
        el("label", { htmlFor: input.id, textContent: title }),
        input,
      ]);
      fields.push({ key, axis, input, field });
      input.addEventListener("change", () => {
        const actor = getActor();
        if (!actor?.placement) return;
        if (!input.checkValidity() || !Number.isFinite(Number(input.value))) {
          feedback.textContent = `${title} must be a number from -${limit} to ${limit}.`;
          feedbackKind = "input";
          input.reportValidity();
          return;
        }
        feedback.textContent = "";
        feedbackKind = null;
        const next = structuredClone(actor.placement);
        // Preserve the full precision of all untouched components.
        next[key][axis] = Number(input.value);
        actor.placement = next;
        changed();
      });
    }
  function load() {
    const placement = getActor()?.placement;
    fixed.checked = isFixedPlacement(placement);
    fixed.disabled = !placement && !solvedPlacement;
    capture.disabled = !captured;
    guide.disabled = !captured;
    reset.disabled = !placement;
    for (const { key, axis, input } of fields) {
      input.disabled = !placement;
      if (document.activeElement !== input) {
        const value = (placement ?? solvedPlacement)?.[key]?.[axis];
        input.value =
          value == null
            ? ""
            : placement
              ? String(value)
              : value.toFixed(key === "position" ? 3 : 1);
      }
    }
    if (
      feedbackKind === "input" &&
      fields.every(({ input }) => input.disabled || input.checkValidity())
    ) {
      feedback.textContent = "";
      feedbackKind = null;
    }
    if (solvedPlacement) {
      output.textContent = `Solved: position ${solvedPlacement.position.map((value) => value.toFixed(3)).join(", ")} m · rotation ${solvedPlacement.rotation.map((value) => `${value.toFixed(1)}°`).join(", ")}`;
      output.dataset.position = JSON.stringify(solvedPlacement.position);
      output.dataset.rotation = JSON.stringify(solvedPlacement.rotation);
    } else {
      output.textContent = "No completed placement available yet.";
      delete output.dataset.position;
      delete output.dataset.rotation;
    }
  }
  fixed.addEventListener("change", () => {
    const actor = getActor();
    if (!actor) return;
    if (fixed.checked) {
      if (!solvedPlacement) {
        load();
        return;
      }
      actor.placement = structuredClone(solvedPlacement);
    } else delete actor.placement;
    feedback.textContent = "";
    feedbackKind = null;
    changed();
  });
  capture.addEventListener("click", () => {
    if (!captured || !getActor()) return;
    Object.assign(getActor(), structuredClone(captured));
    feedback.textContent = "";
    feedbackKind = null;
    changed();
  });
  guide.addEventListener("click", () => {
    if (!captured || !getActor()) return;
    const pose = structuredClone(captured);
    pose.placement.mode = "guided";
    pose.jointMode = "guided";
    Object.assign(getActor(), pose);
    feedback.textContent = "";
    feedbackKind = null;
    changed();
  });
  reset.addEventListener("click", () => {
    if (!getActor()?.placement) return;
    delete getActor().placement;
    feedback.textContent = "";
    feedbackKind = null;
    changed();
  });
  const body = el("div", {}, [
    el("label", { className: "toggle" }, [
      fixed,
      el("span", { textContent: "Keep placement" }),
    ]),
    hint,
    ...fields.map(({ field }) => field),
    output,
    el("div", { className: "buttons" }, [capture, guide, reset]),
    feedback,
  ]);
  return {
    body,
    load,
    setSolved(actor, complete = true) {
      solved = complete ? actor : null;
      solvedPlacement = null;
      captured = null;
      if (solved?.root) {
        try {
          solvedPlacement = placementFromRoot(solved.root);
          captured = captureSolvedPose(solved);
          if (feedbackKind === "capture") {
            feedback.textContent = "";
            feedbackKind = null;
          }
        } catch (error) {
          feedback.textContent = error.message;
          feedbackKind = "capture";
        }
      } else if (feedbackKind === "capture") {
        feedback.textContent = "";
        feedbackKind = null;
      }
      load();
    },
  };
}

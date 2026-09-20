import { newId } from "./ids.js";

const POINTS = [
  ["hand.l", "Left hand"],
  ["hand.r", "Right hand"],
  ["forearm.l", "Left forearm"],
  ["forearm.r", "Right forearm"],
  ["elbow.l", "Left elbow"],
  ["elbow.r", "Right elbow"],
  ["shoulder.l", "Left shoulder"],
  ["shoulder.r", "Right shoulder"],
  ["upperArm.l", "Left upper arm"],
  ["upperArm.r", "Right upper arm"],
  ["back", "Back"],
  ["upperBack", "Upper back"],
  ["waist", "Waist"],
  ["head", "Head"],
  ["knee.l", "Left knee"],
  ["knee.r", "Right knee"],
  ["foot.l", "Left foot"],
  ["foot.r", "Right foot"],
];
const names = new Map(POINTS);
const node = (tag, props = {}, children = []) => {
  const element = Object.assign(document.createElement(tag), props);
  element.append(...children);
  return element;
};
const labelOf = (point, side) =>
  names.get(`${point}${side ? `.${side}` : ""}`) ?? names.get(point) ?? point;
const actorIndex = (value, scene) =>
  typeof value === "number"
    ? value
    : scene.actors.findIndex((actor) => actor.id === value);
function selectField(label, values) {
  const select = node("select", { id: newId("contact-control") });
  const setOptions = (options) =>
    select.replaceChildren(
      ...options.map(([value, text]) =>
        node("option", { value: String(value), textContent: text }),
      ),
    );
  setOptions(values);
  return {
    select,
    setOptions,
    field: node("div", { className: "field" }, [
      node("label", { htmlFor: select.id, textContent: label }),
      select,
    ]),
  };
}
function verdict(report) {
  if (!report || !Number.isFinite(report.distance))
    return [
      report ? "Measurement unavailable" : "Waiting for the pose",
      report ? "warning" : "pending",
    ];
  if (report.basis === "rendered") {
    const gap = `${(report.surfaceGap * 1000).toFixed(report.surfaceGap < 0.01 ? 1 : 0)} mm surface gap`;
    if (report.limbIntersects)
      return ["Contact limbs intersect · adjust the pose", "warning"];
    if (report.intersects)
      return ["Surfaces intersect · adjust the pose", "warning"];
    if (report.strength === 0) return [`No pull · ${gap}`, "pending"];
    if (report.surfaceGap <= report.tolerance)
      return [`Close contact · ${gap}`, "ok"];
    if (report.reason === "load_bearing")
      return [`Supporting limb · ${gap}`, "warning"];
    if (report.unreachable) return [`Out of reach · ${gap}`, "warning"];
    if (report.blocked) return [`Movement limited · ${gap}`, "warning"];
    return [gap, "warning"];
  }
  const error = `${Math.round(report.distance * 1000)} mm from target`;
  if (report.strength === 0) return [`No pull · ${error}`, "pending"];
  return [
    `Estimated target · ${error}`,
    report.distance > 0.06 ? "warning" : "pending",
  ];
}

/** A scene-data editor; only the solver supplies contact result measurements. */
export function createContactEditor(onChange) {
  let scene = null;
  let rows = [];
  let actorSignature = "";
  const mode = selectField("Contact behavior", [
    ["automatic", "Arrangement + my contacts"],
    ["custom", "My contacts only"],
  ]);
  const help = node("p", { className: "hint" });
  const defaults = node("ul", { className: "contact-defaults" });
  const host = node("div", { className: "contact-list" });
  const empty = node("p", {
    className: "hint",
    textContent:
      "No custom contacts yet. Add one to guide a hand or another body part.",
  });
  const add = node("button", {
    type: "button",
    className: "action full",
    textContent: "+ Add contact",
  });
  const root = node(
    "section",
    { className: "contact-editor", id: "contact-editor" },
    [
      node("h2", { textContent: "Partner contacts" }),
      node("p", {
        className: "hint",
        textContent:
          "Choose which parts should meet. Results measure visible surfaces when available; body-model estimates are labeled.",
      }),
      mode.field,
      help,
      defaults,
      empty,
      host,
      add,
    ],
  );
  function update(change) {
    if (!scene) return;
    const next = structuredClone(scene);
    change(next);
    onChange(next);
  }
  mode.select.onchange = () =>
    update((next) => {
      next.relationship = {
        ...next.relationship,
        contactMode: mode.select.value,
      };
    });
  add.onclick = () => {
    if (scene.actors.length < 2 || (scene.contacts?.length ?? 0) >= 32) return;
    update((next) => {
      next.contacts = [
        ...(next.contacts ?? []),
        {
          fromActor: 0,
          toActor: 1,
          from: "hand.r",
          to: "hand.l",
          strength: 1,
          type: "rest",
        },
      ];
    });
    rows.at(-1)?.fromPoint.select.focus();
  };

  function buildRows() {
    rows = [];
    host.replaceChildren();
    for (const [index] of (scene.contacts ?? []).entries()) {
      const fromActor = selectField("Moving figure", []);
      const toActor = selectField("Target figure", []);
      const fromPoint = selectField("Body part", POINTS);
      const toPoint = selectField("Target body part", POINTS);
      const strength = node("input", {
        type: "range",
        min: 0,
        max: 1,
        step: 0.05,
        id: newId("contact-strength"),
      });
      const readout = node("output", { htmlFor: strength.id });
      const result = node("p", {
        className: "contact-result pending",
        textContent: "Waiting for the pose",
      });
      result.setAttribute("role", "status");
      const remove = node("button", {
        type: "button",
        className: "text-button danger",
        textContent: "Remove contact",
      });
      remove.setAttribute("aria-label", `Remove contact ${index + 1}`);
      remove.onclick = () => {
        update((next) => next.contacts.splice(index, 1));
        (
          rows[Math.min(index, rows.length - 1)]?.fromActor.select ?? add
        ).focus();
      };
      const group = node("fieldset", { className: "contact-card" }, [
        node("legend", { textContent: `Contact ${index + 1}` }),
        fromActor.field,
        fromPoint.field,
        node("div", {
          className: "contact-direction",
          textContent: "↓ reaches toward",
        }),
        toActor.field,
        toPoint.field,
        node("div", { className: "field" }, [
          node("label", { htmlFor: strength.id, textContent: "Pull strength" }),
          node("div", { className: "contact-strength" }, [strength, readout]),
        ]),
        result,
        remove,
      ]);
      for (const [picker, key] of [
        [fromPoint, "from"],
        [toPoint, "to"],
      ])
        picker.select.onchange = () =>
          update((next) => {
            next.contacts[index][key] = picker.select.value;
          });
      fromActor.select.onchange = () =>
        update((next) => {
          const contact = next.contacts[index];
          const oldFrom = actorIndex(contact.fromActor, next);
          contact.fromActor = Number(fromActor.select.value);
          if (actorIndex(contact.toActor, next) === contact.fromActor)
            contact.toActor = oldFrom;
        });
      toActor.select.onchange = () =>
        update((next) => {
          next.contacts[index].toActor = Number(toActor.select.value);
        });
      const showStrength = () => {
        readout.textContent = `${Math.round(Number(strength.value) * 100)}%`;
      };
      strength.oninput = showStrength;
      strength.onchange = () =>
        update((next) => {
          next.contacts[index].strength = Number(strength.value);
        });
      rows.push({
        fromActor,
        toActor,
        fromPoint,
        toPoint,
        strength,
        showStrength,
        result,
      });
      host.append(group);
    }
  }
  return {
    root,
    setScene(next) {
      scene = structuredClone(next);
      mode.select.value = scene.relationship?.contactMode ?? "automatic";
      mode.select.disabled = scene.actors.length < 2;
      add.disabled =
        scene.actors.length < 2 || (scene.contacts?.length ?? 0) >= 32;
      empty.hidden = !!scene.contacts?.length;
      help.textContent =
        scene.actors.length < 2
          ? "Add a second figure in Figures to make a partner contact."
          : mode.select.value === "custom"
            ? "Only the contacts below influence the pose. An empty list keeps the figures independent."
            : "The arrangement supplies its own contacts. Your contacts below are added to them.";
      defaults.hidden =
        mode.select.value === "custom" || scene.actors.length < 2;
      defaults.replaceChildren();
      const signature = scene.actors
        .map((actor) => `${actor.id}\n${actor.label}`)
        .join("|");
      const rebuild = rows.length !== (scene.contacts?.length ?? 0);
      if (rebuild) buildRows();
      for (const [index, row] of rows.entries()) {
        const contact = scene.contacts[index];
        if (rebuild || signature !== actorSignature) {
          const options = scene.actors.map((actor, i) => [
            i,
            `${actor.label || "Figure"} (${i + 1})`,
          ]);
          row.fromActor.setOptions(options);
          row.toActor.setOptions(options);
        }
        row.fromActor.select.value = actorIndex(contact.fromActor ?? 0, scene);
        row.toActor.select.value = actorIndex(contact.toActor ?? 1, scene);
        for (const option of row.toActor.select.options)
          option.disabled = option.value === row.fromActor.select.value;
        for (const [picker, key] of [
          [row.fromPoint, "from"],
          [row.toPoint, "to"],
        ]) {
          // Keep imported engine landmarks visible even when they are not one
          // of the studio's common gesture choices.
          if (
            ![...picker.select.options].some(
              (option) => option.value === contact[key],
            )
          )
            picker.select.append(
              node("option", {
                value: contact[key],
                textContent: contact[key],
              }),
            );
          picker.select.value = contact[key];
        }
        row.strength.value = contact.strength ?? 0.7;
        row.showStrength();
        row.result.textContent = "Updating the pose…";
        row.result.className = "contact-result pending";
        delete row.result.dataset.measurement;
        delete row.result.dataset.gap;
      }
      actorSignature = signature;
    },
    setReport(reports) {
      const authored = new Map(
        reports
          .filter((report) => report.source === "custom")
          .map((report) => [report.sourceIndex, report]),
      );
      rows.forEach((row, index) => {
        const report = authored.get(index);
        const [message, state] = report
          ? verdict(report)
          : ["No result for this contact", "warning"];
        row.result.textContent = message;
        row.result.className = `contact-result ${state}`;
        row.result.dataset.measurement = report?.basis ?? "body-model";
        if (report?.surfaceGap != null)
          row.result.dataset.gap = String(report.surfaceGap);
      });
      defaults.replaceChildren();
      for (const report of reports.filter(
        (report) => report.source === "arrangement",
      )) {
        const from = scene.actors[report.fromActor]?.label ?? "Figure";
        const to = scene.actors[report.toActor]?.label ?? "Figure";
        const [message, state] = verdict(report);
        defaults.append(
          node("li", {}, [
            node("span", {
              textContent: `${from} · ${labelOf(report.from, report.fromSide)} → ${to} · ${labelOf(report.to, report.toSide)}`,
            }),
            node("span", {
              className: `contact-result ${state}`,
              textContent: message,
            }),
          ]),
        );
      }
    },
  };
}

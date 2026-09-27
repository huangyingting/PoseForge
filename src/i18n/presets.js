/**
 * A preset as a reader of another language sees it: its name, category and
 * description translated, its figures' labels too. IDs, tags and the scene's
 * own description - what the parser reads - stay as they were, so a search in
 * English and a link from before still find it.
 */
import { translator } from "./index.js";
import { ARTISTIC_NOTE } from "../core/artisticStudies.js";

// The sentence interactionPositions writes, read back into its parts.
const INTERACTION =
  /^(.+?): (.+?)\.(?: Also known as (.+?)\.)? (\d+) clothed figures? in (.+?) positions (.+)\. Approximate template-based 3D interpretation of its source image\.$/;
// "Figure A", or an artistic study's "Figure A · Right high".
const LABEL = /^(Partner|Figure) ([A-Z0-9]+)(?: · (.+))?$/;

export function describe(text, tr = translator) {
  if (typeof text !== "string" || !text) return text;
  const interaction = INTERACTION.exec(text);
  if (interaction) {
    const [, name, label, aliases, figures, postures, surface] = interaction;
    const values = {
      name: tr.t(name),
      label: tr.t(label),
      aliases: aliases && tr.list(aliases.split(", ").map(tr.name)),
      figures,
      postures: tr.list(postures.split(" and ").map((posture) => tr.term(posture))),
      surface: tr.t(surface),
    };
    return aliases
      ? tr.t(
          "{name}: {label}. Also known as {aliases}. {figures} clothed figures in {postures} positions {surface}. Approximate template-based 3D interpretation of its source image.",
          values,
        )
      : tr.t(
          "{name}: {label}. {figures} clothed figures in {postures} positions {surface}. Approximate template-based 3D interpretation of its source image.",
          values,
        );
  }
  if (text.startsWith(ARTISTIC_NOTE)) {
    const motif = text.slice(ARTISTIC_NOTE.length).trim();
    return [
      tr.t(ARTISTIC_NOTE),
      motif &&
        tr.t("Study: {motif}", {
          motif: motif
            .split(" / ")
            .map((part) => tr.t(part))
            .join(" / "),
        }),
    ]
      .filter(Boolean)
      .join(" ");
  }
  return tr.t(text);
}

export function label(text, tr = translator) {
  const match = LABEL.exec(text ?? "");
  if (!match) return text;
  const [, kind, letter, motif] = match;
  const name = kind === "Partner" ? tr.t("Partner {letter}", { letter }) : tr.t("Figure {letter}", { letter });
  return motif ? `${name} · ${tr.t(motif)}` : name;
}

const title = (text, tr) => {
  if (typeof text !== "string") return text;
  const named = tr.name(text);
  return named === text ? tr.t(text) : named;
};

export function localizePreset(preset, tr = translator) {
  if (tr.locale === "en" || !preset?.scene) return preset;
  return {
    ...preset,
    title: title(preset.title, tr),
    description: describe(preset.description, tr),
    category: tr.t(preset.category),
    ...(preset.position
      ? { position: { ...preset.position, name: tr.t(preset.position.name) } }
      : {}),
    scene: {
      ...preset.scene,
      ...(preset.scene.title != null ? { title: title(preset.scene.title, tr) } : {}),
      actors: preset.scene.actors.map((actor) => ({
        ...actor,
        label: label(actor.label, tr),
      })),
    },
    ...(Array.isArray(preset.inputWarnings)
      ? { inputWarnings: preset.inputWarnings.map(tr.message) }
      : {}),
  };
}

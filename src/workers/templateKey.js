import { DEFAULT_BUST } from "../core/body.js";
import { bodyModel } from "../core/bodyModels.js";
import { BODY_PRESETS } from "../core/skeleton.js";
import { DEFAULT_HAIR } from "../core/hair.js";
import { DEFAULT_EXPRESSION, EXPRESSIONS } from "../core/expressions.js";

/** Effective body shape; stature and posed angles are applied later by the rig. */
export function humanBodyOptions({ bodyType = "neutral", model, bust, build } = {}) {
  const chest = (BODY_PRESETS[bodyType] ?? BODY_PRESETS.neutral).chest;
  return { bodyType, model: bodyModel(model), bust: bust ?? DEFAULT_BUST[chest], build: build ?? 1 };
}

export function humanBodyKey(spec) {
  const { bodyType, model, bust, build } = humanBodyOptions(spec);
  return JSON.stringify([bodyType, model, bust, build]);
}

/** The expression a template is drawn with; anything unknown is the default. */
export const humanExpression = ({ expression } = {}) => (Object.hasOwn(EXPRESSIONS, expression) ? expression : DEFAULT_EXPRESSION);

/** Identity of a drawable template, independent of pose, skin tone and metadata. */
export function humanTemplateKey(spec = {}) {
  const { bodyType, model, bust, build } = humanBodyOptions(spec);
  return JSON.stringify([
    bodyType,
    model,
    bust,
    build,
    spec.hair ?? DEFAULT_HAIR[bodyType] ?? "short",
    [...new Set(spec.wearing ?? [])].sort(),
    spec.outfit ?? "black",
    humanExpression(spec),
  ]);
}

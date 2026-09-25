/** Source-linked local position replacements; never a verification badge. */
import { checkPreset, parseCatalog, serializeCatalog } from "./catalog.js";
import {
  checkFixedPositionScene,
  isPositionOverride,
  positionOverrideId,
} from "./positionContract.js";

export { isPositionOverride, positionOverrideId };

export function positionOverrideMatches(preset, position) {
  return Boolean(
    isPositionOverride(preset) &&
    position?.source &&
    preset.id === positionOverrideId(position.source.recordId) &&
    preset.source?.dataset === "SexPoses" &&
    preset.source.recordId === position.source.recordId &&
    preset.source.annotationHash === position.source.annotationHash &&
    preset.scene.actors.length === position.scene.actors.length,
  );
}

export function checkPositionOverride(input, position) {
  const preset = checkPreset(input);
  if (
    !preset.source ||
    preset.id !== positionOverrideId(preset.source.recordId) ||
    preset.position?.variant !== "override"
  )
    throw new Error("A position override needs its own source-linked ID.");
  if (position && !positionOverrideMatches(preset, position))
    throw new Error(
      `${preset.source.recordId}: source fingerprint or participant count does not match.`,
    );
  if (position)
    preset.position = {
      ...position.position,
      variant: "override",
    };
  checkFixedPositionScene(preset.scene);
  preset.scene.description = "";
  return preset;
}

/** Validate every row before a storage transaction may begin. */
export function preparePositionOverrides(presets, positions) {
  const sources = new Map(
    positions
      .filter((position) => position.source)
      .map((position) => [position.source.recordId, position]),
  );
  const seen = new Set();
  return presets.map((input) => {
    const id = input.source?.recordId;
    const position = sources.get(id);
    if (!position)
      throw new Error(`Unknown source position: ${id ?? "missing source"}.`);
    if (seen.has(id)) throw new Error(`Duplicate source position: ${id}.`);
    seen.add(id);
    return checkPositionOverride(
      {
        ...input,
        id: positionOverrideId(id),
        position: {
          ...position.position,
          variant: "override",
        },
      },
      position,
    );
  });
}

export const parsePositionOverrides = (text, positions) =>
  preparePositionOverrides(parseCatalog(text), positions);

export function serializePositionOverrides(presets) {
  return serializeCatalog(
    presets
      .filter(isPositionOverride)
      .map((preset) => checkPositionOverride(preset)),
  );
}

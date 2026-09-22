import { NAMED_PRESETS } from "../../src/core/catalog.js";

/** Valid, full-precision custom scenes near the documented library capacity. */
export function fourFigureLibrary(count = 200, descriptionLength = 0) {
  const base = structuredClone(
    NAMED_PRESETS.find((p) => p.id === "builtin.named.sixty_nine"),
  );
  base.title = "Four-figure capacity study";
  base.description =
    "An editable four-figure scene used to check portable library limits.";
  base.scene.actors.push(...structuredClone(base.scene.actors));
  base.scene.actors.forEach((actor, i) => {
    actor.id = `figure-${i}`;
    if (i > 1) actor.placement.position[0] = i === 2 ? 3 : -3;
  });
  if (descriptionLength)
    base.scene.description = "汉".repeat(descriptionLength);
  return Array.from({ length: count }, (_, i) => ({
    ...structuredClone(base),
    id: `user.capacity-${i}`,
    title: `Capacity study ${i + 1}`,
  }));
}

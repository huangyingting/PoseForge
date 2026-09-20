/** UUIDs also work on a local-network HTTP preview, where randomUUID is absent. */
export function newId(prefix = "user") {
  const uuid =
    globalThis.crypto.randomUUID?.() ??
    Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  return `${prefix}.${uuid}`;
}

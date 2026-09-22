import { checkReferences } from "../core/referenceCatalog.js";
import manifest from "../data/reference-manifest.json" with { type: "json" };
export { manifest as referenceManifest };

/** Lazy, retryable and shared. A failed fetch never publishes a partial index. */
export function createReferenceLoader({
  fetcher = globalThis.fetch,
  base = import.meta.env?.BASE_URL ?? "/",
  digest = async (bytes) =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join(""),
} = {}) {
  let pending = null;
  return () => {
    if (pending) return pending;
    pending = (async () => {
      const response = await fetcher(`${base}${manifest.file}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok)
        throw new Error(`Reference download failed (${response.status}).`);
      const reader = response.body?.getReader();
      const chunks = [];
      let size = 0;
      if (!reader) throw new Error("Reference download is unavailable.");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > manifest.bytes) {
          await reader.cancel();
          throw new Error("Reference download exceeds its declared size.");
        }
        chunks.push(value);
      }
      if (size !== manifest.bytes)
        throw new Error("Reference download is incomplete.");
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      if ((await digest(bytes)) !== manifest.dataSha256)
        throw new Error("Reference download failed its integrity check.");
      return checkReferences(
        JSON.parse(new TextDecoder().decode(bytes)),
        manifest,
      );
    })().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

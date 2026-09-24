import { checkReferences } from "../core/referenceCatalog.js";
import {
  checkReferencePreviews,
  referencePreset,
} from "../core/referencePreviews.js";
import manifest from "../data/reference-manifest.json" with { type: "json" };
import artisticManifest from "../data/artistic-manifest.json" with { type: "json" };
import {
  checkArtisticStudies,
  artisticPreset,
} from "../core/artisticStudies.js";
export { manifest as referenceManifest };
import interactionManifest from "../data/interaction-manifest.json" with { type: "json" };
import {
  checkInteractionStudies,
  interactionPreset,
} from "../core/interactionStudies.js";
export { artisticManifest, interactionManifest };

/** Lazy, retryable and shared. A failed fetch never publishes a partial index. */
function verifiedLoader(
  descriptor,
  validate,
  {
    fetcher = globalThis.fetch,
    base = import.meta.env?.BASE_URL ?? "/",
    digest = async (bytes) =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join(""),
  } = {},
) {
  let pending = null;
  return () => {
    if (pending) return pending;
    pending = (async () => {
      if (
        !Number.isInteger(descriptor.bytes) ||
        descriptor.bytes < 1 ||
        descriptor.bytes > 32_000_000
      )
        throw new Error("Invalid reference download size.");
      const response = await fetcher(`${base}${descriptor.file}`, {
        signal: AbortSignal.timeout(15_000),
        cache: "no-cache",
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
        if (size > descriptor.bytes) {
          await reader.cancel();
          throw new Error("Reference download exceeds its declared size.");
        }
        chunks.push(value);
      }
      if (size !== descriptor.bytes)
        throw new Error("Reference download is incomplete.");
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      if ((await digest(bytes)) !== descriptor.dataSha256)
        throw new Error("Reference download failed its integrity check.");
      return validate(JSON.parse(new TextDecoder().decode(bytes)));
    })().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

export function createReferenceLoader(options = {}) {
  return verifiedLoader(
    manifest,
    (pack) => checkReferences(pack, manifest),
    options,
  );
}

/** One shared lazy index and one deduplicated scene pack; no source images. */
export function createReferenceService(options = {}) {
  const entries = createReferenceLoader(options);
  const scenes = verifiedLoader(
    { ...manifest.previews, dataSha256: manifest.previews.sha256 },
    async (pack) =>
      checkReferencePreviews(pack, manifest.previews, await entries()),
    options,
  );
  const artistic = verifiedLoader(
    { ...artisticManifest, dataSha256: artisticManifest.sha256 },
    async (pack) =>
      checkArtisticStudies(pack, artisticManifest, await entries()),
    options,
  );
  const interaction = verifiedLoader(
    { ...interactionManifest, dataSha256: interactionManifest.sha256 },
    async (pack) =>
      checkInteractionStudies(pack, interactionManifest, await entries()),
    options,
  );
  return {
    entries,
    async find(sourceId) {
      const entry = (await entries()).find(
        (value) => value.sourceId === sourceId,
      );
      if (!entry) throw new Error("Source reference not found.");
      return entry;
    },
    async preset(entry) {
      return referencePreset(entry, await scenes());
    },
    async artistic(entry) {
      return artisticPreset(entry, await artistic());
    },
    async interaction(entry) {
      return interactionPreset(entry, await interaction());
    },
  };
}

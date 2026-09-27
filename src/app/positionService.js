import { checkSourceCatalog } from "../core/sourceCatalog.js";
import {
  checkGeneratedStudies,
  generatedPosition,
} from "../core/generatedStudies.js";
import manifest from "../data/source-manifest.json" with { type: "json" };
import artisticManifest from "../data/artistic-manifest.json" with { type: "json" };
import {
  checkArtisticStudies,
  artisticPreset,
} from "../core/artisticStudies.js";
export { manifest as sourceManifest };
import interactionManifest from "../data/interaction-manifest.json" with { type: "json" };
import {
  checkInteractionStudies,
  interactionPreset,
  interactionPositions,
} from "../core/interactionStudies.js";
export { artisticManifest, interactionManifest };
import { localizePreset } from "../i18n/presets.js";

/**
 * Fetch a pack of known size, giving up only when it stops arriving.
 *
 * The timeout is an idle one, re-armed by every chunk: the interaction pack is
 * several megabytes, and a fixed deadline for the whole body fails a slow but
 * healthy connection part way through while protecting against nothing a
 * stalled one would not trip anyway.
 */
async function download(url, declared, fetcher, idleTimeout) {
  const controller = new AbortController();
  let reader = null;
  let timer = 0;
  const idle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort();
      // A pending read on a body the signal does not reach still has to end.
      reader?.cancel().catch(() => {});
    }, idleTimeout);
  };
  try {
    idle();
    const response = await fetcher(url, {
      signal: controller.signal,
      cache: "no-cache",
    });
    if (!response.ok)
      throw new Error(`Catalog download failed (${response.status}).`);
    reader = response.body?.getReader() ?? null;
    if (!reader) throw new Error("Catalog download is unavailable.");
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) break;
      idle();
      if (done) break;
      size += value.length;
      if (size > declared) {
        await reader.cancel();
        throw new Error("Catalog download exceeds its declared size.");
      }
      chunks.push(value);
    }
    if (controller.signal.aborted) throw new Error("Catalog download timed out.");
    if (size !== declared) throw new Error("Catalog download is incomplete.");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Catalog download timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Lazy, retryable and shared. A failed fetch never publishes a partial index. */
function verifiedLoader(
  descriptor,
  validate,
  {
    fetcher = globalThis.fetch,
    base = import.meta.env?.BASE_URL ?? "/",
    idleTimeout = 15_000,
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
        throw new Error("Invalid catalog download size.");
      const bytes = await download(
        `${base}${descriptor.file}`,
        descriptor.bytes,
        fetcher,
        idleTimeout,
      );
      if ((await digest(bytes)) !== descriptor.dataSha256)
        throw new Error("Catalog download failed its integrity check.");
      return validate(JSON.parse(new TextDecoder().decode(bytes)));
    })().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

export function createSourceCatalogLoader(options = {}) {
  return verifiedLoader(
    manifest,
    (pack) => checkSourceCatalog(pack, manifest),
    options,
  );
}

/** One shared lazy index and one deduplicated scene pack; no source images. */
export function createPositionService(options = {}) {
  const entries = createSourceCatalogLoader(options);
  const scenes = verifiedLoader(
    { ...manifest.generated, dataSha256: manifest.generated.sha256 },
    async (pack) =>
      checkGeneratedStudies(pack, manifest.generated, await entries()),
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
    sources: entries,
    async source(sourceId) {
      const entry = (await entries()).find(
        (value) => value.sourceId === sourceId,
      );
      if (!entry) throw new Error("Position source not found.");
      return entry;
    },
    /**
     * The alternates carry the position's name, not its source ID. The caller
     * already holds it from the library, so naming them never costs a download.
     */
    async variant(entry, variant = "interaction", name = null) {
      if (variant === "interaction")
        return localizePreset(interactionPreset(entry, await interaction()));
      if (variant === "artistic")
        return localizePreset(artisticPreset(entry, await artistic(), name));
      if (variant === "generated")
        return localizePreset(generatedPosition(entry, await scenes(), name));
      throw new Error(`Unknown position variant: ${variant}.`);
    },
    /** Unified source metadata and 3D scenes as playable library positions. */
    async positions() {
      const [index, studies] = await Promise.all([entries(), interaction()]);
      return interactionPositions(studies, index).map((preset) => localizePreset(preset));
    },
  };
}

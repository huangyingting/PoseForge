# Source-linked reference catalog and large personal libraries

## Scope and truthfulness

Expand discovery to every record in the local SexPoses annotation snapshot while
keeping references distinct from authored 3D presets. The input currently has
1,283 records; this is not a claim of 1,283 unique or verified positions. Existing
23 bundled presets and their geometry contracts remain unchanged. This iteration
does not generate explicit imagery, copy source photographs, or reconstruct
sexual activity. Reference cards contain neutral metadata, not pose thumbnails.

## Data contract

- Reproducible offline importer, explicit input path, no network access. Fail on
  duplicate/missing IDs or malformed records; never silently drop a record.
- Allowlist source record ID, participant count, broad posture/support families,
  annotation and image fingerprints. Do not ship image paths, URLs, free-form
  descriptions, intimate contact labels, or the raw source corpus.
- Stable IDs derive from source identity, not array position. Exact annotation
  fingerprints group identical structured descriptions; image fingerprints group
  identical source images. Neither grouping asserts anatomical equivalence.
- Commit a small provenance manifest and a separately fetched metadata catalog.
  Include source/input hash, generated-data hash, counts and grouping semantics.
  A clean clone must browse without the sibling repository.
- All imported references are `reference-only`. The existing immutable built-in
  registry is `verified-3d` for its audited stock configuration. Saved/imported
  scenes are `needs-adjustment` (not individually certified). User JSON cannot
  confer verification. Source links survive save/export/import as provenance,
  never as a quality endorsement.

## Discovery and responsiveness

- Keep All/Positions/Saved/Favorites for playable presets; add a prominent
  References collection with its separate count and explanation.
- Reference IDs, broad posture families, surface families and figure counts are
  searchable. Family/status filtering and an optional annotation-variant grouping
  compose. Details show source identity, fingerprints, group count, support status
  and an explicit statement that no corresponding 3D preset has been authored.
- Reference metadata loads only when requested, with bounded payload validation,
  retryable errors and no partial catalog on failure. No reference request should
  block startup, editing, or saved presets.
- Both collections render at most 24 cards per page. Search/filter changes reset
  pagination; page changes cancel off-page preview subscriptions. Existing
  on-demand worker previews remain limited to visible preset cards.
- Reference selection must not change the active 3D scene. Users may associate
  an independently authored non-graphic study with a source ID; this does not
  claim a reconstruction or certification of that reference.

## Persistent personal library

- Raise interchange limits to 5,000 presets / 32 MB, preserving version 1 JSON,
  strict scene validation, unique IDs, atomic import and compact export fallback.
- Use IndexedDB for saved libraries, retaining localStorage for small workspace
  drafts and as a clearly labeled fallback if IndexedDB cannot open.
- Migrate valid legacy data transactionally, retain the old data as recovery
  backup, and never replace corrupt input without explicit reset. Serialize
  mutations; reject conflicting cross-tab writes instead of losing work.
- Report success only after durable commit. Persistence/quota failures retain
  the previous library. JSON remains portable backup; no server account or cloud
  persistence is added.

## Acceptance inventory

1. Reconcile all source IDs, participant counts, stable IDs, fingerprints, family
   totals and duplicate groups; regenerate byte-identically.
2. Unit tests cover importer rejection/sanitization, loaded-data integrity,
   search/group/filter/page boundaries, source metadata round trips, status
   anti-spoofing, large packs and transaction failure/conflict behavior.
3. Browser tests cover every reference page, family/search/group/status filters,
   dialog keyboard focus, request failure/retry, unchanged active scene, and no
   eager reference downloads or reference pose solves.
4. Browser tests cover migration, a >1,000-entry full-scene import/export/reload,
   bounded card count, saved edits/favorites/delete, failed writes, malformed
   imports and storage fallback. Check 1440/390/320 px and Axe accessibility.
5. Run full unit suite, production build, dependency audit and relevant existing
   browser regressions. Do not rerun or reinterpret the previous geometry audit
   as new evidence for source references; geometry is unchanged.
6. Record exact results and remaining limitations, inspect intended diff and
   delivery state. Do not claim 1,000+ verified 3D layouts or a hosted deployment.

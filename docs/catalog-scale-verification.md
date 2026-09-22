# Catalog scale verification

This report records the metadata-catalog milestone. The later
[3D reference iteration](reference-3d-verification.md) supersedes its
metadata-only card behavior with approximate, separate posture previews.

**Final result:** 423/423 unit tests and 22 distinct browser scenarios passed.
The production build, dependency audit (zero vulnerabilities), formatting and
whitespace checks passed. The final source-metadata/storage unit pass repeated
29 focused tests; the final browser pass repeated seven new flows and added the
real two-tab case, with eight passes and no failures, retries or skips.

## Delivered scope

The reference-catalog expansion indexes **1,283/1,283** records from the supplied
SexPoses annotation snapshot: 12 single-figure, 1,258 two-figure and 13 three-figure
records. All source IDs are retained, with 22 broad family combinations, 379
structured-pose annotation groups and 1,283 distinct normalized-image hashes.
Groups are annotation comparisons, not a count of unique anatomical positions.

This is a metadata catalog, not 1,283 new 3D reconstructions. The existing
**23 authored stock presets** retain their previous audit status. Imported
references are labeled **Reference only**. Personal presets are labeled
**Needs adjustment**, meaning not individually certified; JSON cannot confer a
verification badge. Reference photographs, raw prose, image paths and intimate
contact labels are not included in the generated catalog.

The 532,507-byte metadata snapshot is committed independently of the sibling
repository. Opening References fetches it lazily, verifies its size/hash/schema,
and provides retry on failure without blocking the studio. Both collections
render at most 24 cards per page. Reference inspection does not change the active
scene or request pose solves. Source links can be attached to independently
authored studies and survive saved-preset/JSON round trips.

Personal libraries now support up to **5,000 presets and 32,000,000 bytes**,
whichever limit is reached first. IndexedDB transactions replace the former
localStorage capacity bottleneck. Legacy libraries migrate without deleting the
original backup. Mutations are serialized, failures retain the previous state,
and stale cross-tab writes reject with reload guidance. A labeled legacy fallback
is available before migration; known migrated libraries are protected from
replacement when their database is unavailable.

## Evidence inventory

The [machine-readable ledger](audit-catalog-scale/results.json) records exact
counts, every browser scenario, source hashes, the test environment and limits.
Inspected screenshots show the [desktop catalog](audit-catalog-scale/reference-desktop.png),
[mobile catalog](audit-catalog-scale/reference-mobile.png), and
[320-pixel layout](audit-catalog-scale/reference-narrow.png).

- Deterministic regeneration reconciles every source ID and matches both
  committed artifacts byte-for-byte. The manifest contains the source and
  generated-data SHA-256 hashes and all family/participant counts.
- Unit checks cover allowlisting, stable IDs, grouping, query/page boundaries,
  malformed inputs, tampered downloads, shared lazy requests and retries,
  provenance preservation, verification anti-spoofing, transactional migration,
  storage failure, conflicts, fallback and corrupted-data recovery.
- Capacity checks exercise the 5,000-entry boundary, compact fallback for 2,500
  full four-figure scenes, and count/byte rejection without partial writes.
  The 1,283-entry browser transfer is 21,108,335 bytes as readable JSON; the
  2,500-entry unit fixture uses 17,632,837 bytes of compact JSON.
- Browser coverage walks all 54 reference pages, reconciles all 1,283 IDs, visits
  every family, checks grouping/status/search and native-dialog keyboard focus,
  and confirms the active scene and worker request count remain unchanged.
- Desktop/mobile checks at 1440, 390 and 320 pixels cover overflow, reachable
  pagination, accessible labels and Axe WCAG 2 A/AA and 2.1 AA checks.
- Browser persistence coverage includes legacy migration, a 1,283-entry
  four-figure import/export/reload with exact data hashes, bounded card counts,
  favorites, oversized imports, injected transaction failure/retry, fallback,
  and a real two-tab conflict.
- Existing studio regressions cover save/update/copy/delete, history, drafts,
  editable imports, camera/export, collection filters and unavailable WebGL.

The regression browser batch passed 21 cases; the final focused batch passed
eight, with seven overlapping cases, for 22 distinct successful scenarios.
An initial test-fixture path typo was corrected before the successful batches.
No geometry tolerances were relaxed. Tests asserting the previous 200-entry /
2 MB contract were updated for the requested capacity increase and pagination.

## Boundaries

The solver, calibrated layouts, models and renderer are unchanged. The previous
geometry audit remains the evidence for the 23 stock configurations; this
iteration does not recertify every rendered configuration or add a new full
geometry audit over the source corpus. The broader diagnostic limitations in
the [studio baseline](studio-completion-audit.md) still apply.

Family classification is deliberately broad and may use **Other**. Annotation
groups omit participant ID/body-type fields and do not establish semantic or
geometric uniqueness. Source associations are user-authored provenance, not a
claim that a saved study reproduces its source.

Persistence remains browser-local and subject to device quota, eviction and
private-session behavior. JSON is the portable backup; no cloud account or
hosted deployment is added. Physical-device and assistive-technology
certification are not claimed. Cold 3D startup retains the baseline's costs.

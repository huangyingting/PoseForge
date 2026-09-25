# 3D reference posture previews

This report records the generated-preview milestone. The later
[position override workflow](position-overrides.md) adds local per-source studies and
bulk import/export without changing this generated preview pack.

## Delivered behavior and boundaries

All **1,283 reference records** have a directly selectable clothed 3D posture
study. The mapping retains **2,567 participants**: 12 single-person records,
1,258 two-person records and 13 three-person records. The records share **203
distinct generated scenes** after deduplication. Neither the source-record count
nor the original 379 annotation groups is a count of unique reconstructed poses.

Participants are deliberately displayed separately. Postures and limb/trunk
hints become canonical rig angles; original relative facing, relationship,
furniture and intimate-contact details are not reconstructed. A neutral floor
replaces source supports. This is a non-graphic posture-preview feature, not a
new library of verified sexual interactions or physically stable compositions.
The original 23 stock presets retain their earlier verification status.

The metadata index is 767,139 bytes, and the deduplicated preview pack is 655,258
bytes. Both are committed, lazy-loaded, byte/hash/schema checked and independent
of the sibling source checkout at runtime. No original image asset is copied or
requested. The existing licensed model and clothing assets remain in use.

The source annotation mapper reports the following limitations, without copying
raw source prose into the application:

- All records carry approximate-angle, separate-participant and assumed-floor notes.
- All records have some limb/trunk detail deferred to their base posture or support.
- Three records contain inferred angles clamped to the rig's limits.
- Six records have some unread limb/trunk detail.
- Ninety-three records contain an unspecified body choice, represented by the
  existing neutral model; that model shares a scan with the female model.

Clicking a card now loads the preview; its separate information button opens
provenance. `?reference=<source-id>` supports direct links and reload. Camera,
orbit, zoom, Focus, editing, capture, save and image/scene export remain available.
Saved copies retain source identity and approximation captions without gaining
a verification badge. Diagnostic prose is not used as a text-parser command.

Failure paths retain the previous study, expose retry, and reject late selections
after newer edits/saves. Missing scanned models cannot silently substitute an
unclothed collision field for a clothed reference preview.

## Evidence inventory

**Final results:** all **1,283 source mappings** reconcile to **203/203 rendered
scenes**, retaining all **2,567 participants**. The **45 targeted unit tests**
and **36 distinct browser scenarios** passed with no failures or skips.
Production builds, byte-for-byte source regeneration, formatting and whitespace
checks passed. The dependency audit reported **zero vulnerabilities**.

The [machine-readable ledger](audit-reference-3d/results.json) records the final
application/test hashes, coverage reconciliation, diagnostics and each browser
scenario. The [per-scene evidence](audit-reference-3d/rendered-scenes.json)
records all 203 distinct geometries and 407 rendered actors. Inspected screenshots
show the [three-person desktop preview](audit-reference-3d/three-person-preview.png)
and [mobile preview](audit-reference-3d/mobile-reference-3d.png).

The geometry sweep passed 9/9 scenarios, including four batches that cover all
distinct scenes. The final UI regression passed 32/32 scenarios; five overlap
with the sweep, giving 36 distinct scenarios, not 41. Later interaction-only
refinements were covered by that final UI run; the generated geometry was
unchanged. A final 13/13 core reference unit repeat also passed. The complete
historical 423-test unit suite was not rerun for this iteration.

- Every source ID maps to a complete scene with the same participant count;
  all scenes pass the existing strict portable-scene schema and JSON round trip.
- Every distinct scene has finite complete rigs, fixed placements/joints, top
  and shorts garments, no partner contacts and at least 0.49 m measured coarse
  separation between adjacent figure bounds (the generator targets 0.5 m).
- Browser batches render every distinct scene with real scanned meshes,
  finite positions/normals, both garment parts and non-background canvas pixels.
  Source IDs/scene keys reconcile to the complete source index.
- Browser flows cover solo/group previews, source URLs, camera/zoom, mobile and
  accessibility, saved copies, PNG/JSON export, failed download/retry, stale
  requests, keyboard focus and missing model failure.
- Relevant existing catalog, compact UI, library and studio regressions remain
  separate from this new renderability gate. Geometry notes are not suppressed.

## Limits of the evidence

Finite rendered meshes and visible pixels establish renderability, not exact
matching to the original references or collision-free anatomy. Source-specific
geometric calibration has not been performed. **21 distinct scenes**, representing
**129 source records**, exceed coarse penetration or support-gap thresholds.
The worst reported proxy penetration is **0.068669 m** (about 69 mm); the worst
proxy support gap is **0.528662 m** (about 529 mm). **33 actors** across the distinct
scenes retain partner-support expectations despite the omitted original supports.
These are coarse pose measurements, not precise mesh-intersection measurements.
The studio retains geometry notes alongside approximation notes; the other
scenes are not thereby certified physically sound. Balance is not force
simulation and garments are not cloth simulation.

Software-Chrome and mobile viewport/touch emulation do not constitute physical-
device or assistive-technology certification. Libraries remain browser-local.
No cloud service, new dependency or hosted deployment is added.

# Studio completion audit

This is the completed 23-preset studio baseline. The subsequent
[large-catalog iteration](catalog-scale-verification.md) adds a separate source
reference index and supersedes this report's 200-preset / 2 MB storage limits.
The measurements below remain evidence for the baseline, not a claim that the
new references have been reconstructed or verified as additional 3D presets.

This audit covers the original three-part objective: improved male/female
presentation, a modern usable studio, and a complete extensible preset system.
The requested studio scope is implemented and the current-source checks below
are complete. A clean stock catalog is one gate, not the sole completion claim.

**Final verification:** 407/407 unit tests, 62/62 browser scenarios, 23/23
rendered-clear catalog entries, seven contact fixtures, a successful production
build and zero reported dependency vulnerabilities. The
[machine-readable ledger](audit-2026-09-22/results.json) records every browser
case, catalog result, source hash and diagnostic limit. Git synchronization is
checked separately in the final delivery handoff.

## Coverage inventory

The enumerated browser inventory contains 62 scenarios in 26 files, including
new direct rendering checks for all three body choices, six hair styles, eight
garment colors, eleven hand shapes and six foot shapes. The catalog contains
23 stable IDs (11 reference studies and 12 named definitions). The fifteen garment
definitions (bra, lace bra, bikini top, top, briefs, lace thong, bikini bottom,
swim briefs, boxer briefs, jockstrap, shorts, stockings, garter belt, harness
and the wrist and ankle cuffs) are each built alone on the female model, and
all but the three cupped ones on the male, by the real-geometry suite, which
checks their finish, weights and that each comes in one piece (two stockings,
four cuffs); the outfit, top, bottom and extras pickers are checked in the
browser, and the shared studio top/shorts outfit on all three body choices. These
are enumerated registries, not counts inferred from screenshots.

| Contract | Authoritative implementation and verification | Final evidence |
| --- | --- | --- |
| Male/female figures, clothing, hair, skin tone and materials | Licensed model assets; `humanMesh`, `garments`, `hair`, renderer; real-geometry tests and figure/appearance browser flows | Passed: all three appearance registries, both braced-hand flows, geometry tests and inspected renders |
| Desktop/mobile workspace, accessible controls and keyboard focus | Studio/inspector/layout code, reduced-motion rules; studio, collections, authoring, placement and joints browser flows at 1440/390/320 px with Axe | Passed: no tested page overflow or Axe violations; native dialogs and focus flows verified |
| Catalog and extensibility | `STUDIO_PRESETS`, `ARCHETYPES`, immutable combined registry, version-1 scene format; all 23 IDs, aliases, applicability rules and JSON round trips | Passed: complete registry reconciliation, immutable built-ins and editable independent copies |
| Every bundled pose works | Complete rendered catalog audit, independent calibrated coarse gates, exact contacts/supports, full figure/furniture/floor checks and explicit missing-model results | Passed: 23/23 rendered, 12/12 named; no unavailable checks; proxy limits retained below |
| Authoring without source edits | Figure properties, names, contacts/types/strength, fixed/guided joint channels and placement; history, capture/reset, edit and export tests | Passed: all authoring, joints, placement, guide/reset and capture scenarios |
| Personal library | Search/category/collection/favorite filters; create/save/update/copy/delete/reload; import atomicity, fresh IDs, quotas/corrupt storage and workspace draft tests | Passed: full CRUD, recovery and draft flows, plus a 200-preset four-figure transfer |
| Preview representation | Shared solved coordinates, props and facing; worker queue/cache/stale-result/recovery tests and actual selected/saved preview browser checks | Passed: complete catalog loading, cache consistency and failure recovery |
| Camera and visual output | Named views, orbit, wheel, keyboard, trusted pinch/cancel, fit and zoom; natural/clay materials and late texture redraw | Passed: desktop/material, trusted touch/cancel and delayed-atlas redraw without another solve |
| Portable exports and CLI | Real opaque/transparent PNG pixels, SVG and re-importable JSON; saved camera defaults, explicit CLI view precedence and captured geometry replay | Passed: decoded downloads, all pose replay checks and seven CLI camera renders |
| Honest failure and cancellation | Unread text, invalid imports, missing models, failed WebGL, support/contact/furniture availability, rapid requests and bounded/cancelled refinement | Passed: fault-injection and cancellation tests; no falsely clear unavailable geometry |
| Responsive editing work | Body/template cache identity, bounded promises, immutable source geometry and before/after browser timing without stale clothing colors | Passed: cache concurrency/purity/eviction tests and live timing/color regression |
| Static and dependency integrity | Complete unit suite, production build, dependency audit, architecture tests and schema/registry checks | Passed: 407 units, build and architecture gates; npm audit reports zero vulnerabilities |
| Delivery | Intended-file/secret/whitespace review, private `main` push and local/tracking/live SHA comparison | Release verification recorded in the final handoff; no hosted deployment requested |

## Visual evidence

Inspected production-build output is retained for the
[desktop studio](audit-2026-09-22/studio-desktop.png),
[mobile studio](audit-2026-09-22/studio-mobile.png), and
[mobile figure editor](audit-2026-09-22/studio-mobile-editor.png).
All three use generated test studies, not a user's saved library or browser state.

## Audit fixes

- An additional delayed-texture test closed the last code-inspection-only
  evidence gap. The original 61 definitions were byte-for-byte unchanged, as
  verified by recomputing their prior hash with only the new test excluded;
  the application runtime hash was unchanged throughout all 62 scenarios.
- Scene-readiness checks use a shared bounded 60-second wait. Two cold-load
  attempts exceeded the old 30-second wait; a separate probe completed the
  cold processing stages totaled about 31.7 seconds and its warm edit completed
  in 22.3 seconds under the
  observed host load. Geometry tolerances, non-readiness assertions and cache-
  work requirements are unchanged. This is not an instant-startup claim.
- Split body shaping from dressed-template caching, with bounds of eight body
  shapes and 24 dressed templates. Equivalent defaults and height changes reuse
  geometry; real shape, clothing and color changes remain distinct. Real-mesh
  hashes match the previous construction for all three body choices.
- Reject malformed contact types atomically and keep valid custom text tags.
  Tolerant raw-scene validation reports its repair; prototype-like custom names
  use the ordinary hand-shape fallback without inherited-property lookup.
- Keep large library exports re-importable: use readable JSON when it fits,
  compact JSON when needed, and clear failure feedback beyond the unchanged
  2 MB cap. A 200-preset, four-figure browser round trip preserves scene data.

## Interpretation and boundaries

- The frozen-source unit run passes 407/407 tests. The complete rendered catalog
  is 23/23 clear (12/12 named), with no unavailable checks; all seven contact
  fixtures pass. The coarse catalog remains 22/23 because of the documented
  sofa proxy discrepancy.
- Broader diagnostics are not silently treated as green: the synthetic coarse
  sweep is 134/159 sound, with 98 unmet targets explicitly reported. The text
  suite parses 34/34 cases and has 31/34 coarse-geometry successes, exactly the
  same findings as the previous commit. One custom composition retains a 61 mm
  proxy overlap; two reclining-preset aliases retain 31 mm proxy hand penetration
  against the mattress plane while their complete rendered checks pass.
- The separate external annotation corpus reports 1,075/1,258 generated two-person
  scenes sound. It is diagnostic reference data outside the shipped 23-entry
  catalog, not a claim that those generated scenes have been calibrated.
- Posture diagnostics report a 30 mm worst proxy support gap and 2 mm worst
  self-penetration within their declared tolerances. Meshes remain closed and
  outward, with 5.43 mm worst sampled SDF surface error; skin-feature checks pass.
- The named positions use clothed, non-graphic figures and retain their original
  roles, contacts and supported variants. Arbitrary conflicting custom scenes
  may remain unresolved and must show their measurements rather than pass falsely.
- Rendered geometry and coarse proxies are separate. The sofa's documented
  coarse proxy overlap is not a rendered collision; neither balance estimate is
  a force or physical-stability simulation.
- Neutral has its own scan (MakeHuman's gender-0.5 body) wearing the female skin; fitted garments are not cloth simulation.
- Storage is browser-local, with JSON as backup and transfer. No cloud account,
  database, external OAuth identity or hosted deployment was requested.
- Software-Chrome desktop and mobile viewport/touch emulation are available.
  Physical-device and assistive-technology certification are not claimed.
- Historical experiments and superseded counts in `studio-verification.md` do
  not substitute for this final inventory's current-source results.

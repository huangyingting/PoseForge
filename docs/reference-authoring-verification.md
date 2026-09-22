# Reference authoring verification

**Result:** 51/51 targeted unit tests and 38 distinct browser scenarios passed.
The final production build, formatting and whitespace checks passed. The
dependency audit reported zero vulnerabilities. This implements an authoring
and import workflow; **no new source-accurate authored pose collection is
shipped**. A fresh library still has zero authored studies.

The [machine-readable ledger](audit-reference-authoring/results.json) contains
the final application/test hashes, source fingerprints, each browser scenario,
batch outcomes, scale reconciliation and compact-layout measurements. Inspected
screenshots show the [desktop authored study](audit-reference-authoring/authored-desktop.png),
[mobile preview](audit-reference-authoring/authored-mobile.png) and
[mobile import review](audit-reference-authoring/authored-mobile-import.png).

## Coverage

- The full-size unit and browser imports retained **1,283 unique source IDs**
  and **2,567 participants**. Export reconciled every source ID, and reload
  retained the independent reference bindings. The exported preset array was
  4,652,262 bytes, within the existing 32 MB library limit. These tests adopted
  existing generated scenes as fixtures to establish capacity, not unique or
  newly authored geometry.
- Editing, fixed-pose capture, naming, confirmed replacement, camera controls,
  source URLs and reload work. The browser round trip retained an explicitly
  edited 60-degree elbow angle and source fingerprint. Deleting a local study
  restores the generated fallback without deleting source data.
- Reference cards show authored coverage and **Authored · unreviewed**; the
  filter finds saved bindings. Grouping keeps authored records individually
  reachable. The generated fallback can be opened without deletion, including
  on reload with `preview=generated`.
- Imports preview new/existing counts and keep existing studies by default.
  Explicit replacement changes only matching source bindings. Duplicate or
  unknown IDs, stale fingerprints, wrong participant counts, invalid geometry
  contracts and oversized files reject the whole batch. A simulated real
  IndexedDB write failure preserves the prior library and permits retry.
- Unit tests cover ordinary-update source/count protection, immutable returned
  copies, non-binding ordinary imports, quota failure and transactional rollback.
  Existing library regressions cover migration, cross-tab conflicts and fallback.
- Late generated downloads cannot replace a saved study. A completed save whose
  dialog was closed cannot replace a newer stage selection; the saved study
  remains accessible afterward.
- Mobile authoring, file review, keyboard selection, focus restoration and
  automated accessibility checks pass. The 320 × 700 library retains four fully
  visible reference cards, 390 × 844 retains five, and 1440 × 844 retains six.
  The measured stock-study desktop canvas remains 862 × 640.703125 pixels.

## Runs and fixes

The broad regression run passed 35/36 cases. Its sole failure caught the added
footer controls wrapping at 320 pixels and reducing visible cards to three.
The References footer now exposes reference-specific transfers; ordinary
import/export remain in the other collections. All six compact-layout scenarios
and five authoring scenarios then passed in an 11/11 focused run.

Final hardening protects reserved-study source/count fields during ordinary
updates and guards save completion against newer selections. All six final
authoring scenarios and all 51 targeted units passed after those changes.
The ledger counts each browser scenario once using its latest result, yielding
38 distinct passes across the batches. There were no skips or flaky retries.

## Boundaries

The generated index and 203-scene pack, models, solver, renderer and workers are
unchanged. Their previous full rendering sweep is historical evidence, not a
new sweep in this iteration. The full historical unit suite was not rerun.

Saved/imported studies remain clothed individual postures with no partner
contacts, fixed joints/placements and a neutral floor. The 0.25 m separation
rule is measured along world X using coarse posed body bounds without intimate
anatomy. It does not certify precise mesh separation, self-collision, support,
balance or clothing fit. Existing pose diagnostics remain visible.

An authored binding is not a claim of unique geometry, fidelity to a reference,
independent review or verified physical validity. All saved data is browser-local;
export JSON for backup and transfer. Physical-device and assistive-technology
certification are not claimed. No cloud service, original reference imagery,
new dependency or hosted deployment is added.

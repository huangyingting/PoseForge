# Studio verification — 2026-09-22

This records the current studio implementation and its limits. Bundled entries
use clothed reference figures, and the catalog preserves the existing named
definitions as data. The full figure/UI/catalog verification is recorded in the
[completion audit](studio-completion-audit.md), including current-source coverage
and explicit limits. Loading a preset alone is not proof that its constraints
were met.

## Evidence

| Requirement | Current evidence |
| --- | --- |
| Male and female figure presentation | Licensed meshes retained; tops/shorts, softer skin and lighting, skin-tone control, natural/clay modes, and shadow-catching ground. Desktop and mobile renders inspected. A contrasting-skin diagnostic confirmed skin was peeking through opaque garments; the corrected rendering removes those artifacts. |
| Clothing follows poses | Geometry tests skin studio outfits onto both body types in standing, seated and kneeling poses, check finite bounded vertices, retained garment meshes and covered anatomy. Opaque garments hide fully covered skin faces while retaining exposed head/lower-leg geometry and preserving the original cached template. Existing garment weight and hem tests also pass. |
| Braced hands | Finger and thumb rotations now cancel the models' native rest curl against their measured palm plane. Both models and both hands retain joint origins, phalanx lengths and finite skinning through asymmetric posed wrists. Drawn thumbs extend about 3.6 mm beyond the palm instead of 43–49 mm; the other hand shapes and unselected hand remain unchanged. The later kneeling-pair recipe also retains downward-facing palms and forward-pointing fingers. |
| Responsive studio | Browser checks at 1440×1000, 390×844 and 320-pixel width; library, studio and inspector remain reachable. Named positions have a direct collection filter. Long text does not cause page overflow; zoom buttons stay reachable on narrow screens. |
| Keyboard and accessibility | Native dialogs, labeled inputs, keyboard camera controls, focus retained after loading cards, and visible focus. Axe WCAG 2 A/AA and 2.1 AA checks return no violations on desktop, mobile, figure inspector and save dialog. This is an automated audit, not an accessibility certification. |
| Extensible catalog | 23 entries: eleven reference studies plus all twelve existing named definitions. Original aliases, postures, facing, surfaces and contacts are preserved. All/Positions/Saved/Favorites, categories, search, CRUD, reload and import/export work. Built-ins remain immutable. |
| Previews | Off-main-thread diagrams show solved shared coordinates, relative heights, facing and props. Selected/saved poses reuse refined viewport snapshots. Stale replies, unsubscribed cards, cache eviction and preview-worker failure are covered. |
| Camera input | Trusted Chrome touch events verify pinch zoom, cancellation and return to one-pointer orbit. Zoom buttons, wheel and keyboard controls work; third-touch and near-zero-distance transitions are unit tested. Browser page-zoom modifiers are not intercepted. |
| Contact authoring | Figure/body-part pickers, contact type, strength, add/remove and visible-surface feedback exercised on desktop and mobile. Rest/Surface/Grip/Support are editable and imported custom kinds stay visible. Types survive undo/redo, save/reload and export; an unresolved type edit retains its measured warning. Figure names survive reload and export. Removing a figure remaps surviving contacts. Custom-only mode excludes arrangement contacts from initial alignment and iterative solving; existing scenes preserve automatic behavior. |
| Endpoint direction | Body-first/limb-second constraints use the limb endpoint internally in coarse IK and rendered refinement, while retaining authored actors, sides, strengths, source indices and report order. Reversed standing hand/back constraints match the forward coarse pose and pass complete rendered contact checks. Fixed channels, load-bearing limbs, missing models, zero pull, shared budgets and cancellation are covered. The editor now labels first/second endpoints neutrally rather than promising which figure moves. |
| Coarse snapshot selection | Supporting-hand IK retains its self-bulk limit and a per-limb partner-overlap ceiling. The existing 22 mm body-overlap gate is the first snapshot selection criterion, with the original aggregate score retained within each class. The returned pose still reports unavoidable fixed-body collisions. A direct 159-case comparison with `2ebcf21` improves geometrically sound cases from 127 to 134 with no newly flagged cases; tracked unmet targets rise from 94 to 98 and remain explicit. |
| Visible contact accuracy | Exact triangle-region distances replace the old unlabeled target residual. Seven dressed-model fixtures finish within 4 mm, including both body orders, same-type pairs, kneeling, varied proportions and authored wrist angles. Complete affected limbs are checked for crossings. Ground heights and pinned placement are preserved, and unrelated/self/prop collisions cannot be hidden by a lower aggregate score. |
| Full scene fidelity | JSON round trips preserve figure properties, joint overrides, hand shapes, contacts and named camera view. Browser reload tests preserve edited height and joints, and the latest unsaved workspace. |
| Precise joint authoring | Optional fixed mode retains specified channels through seating, contact/collision solving, surface refinement and cancellation, while unedited channels remain free. The editor shows actual solved values and clears stale values while pending. The browser flow verifies fixed values, history, saved reload, JSON export and narrow-screen accessibility. Guided mode remains the default. |
| Reproducible placement | Optional fixed world placement, per-figure solved-pose capture and atomic whole-layout capture are implemented. Position and XYZ rotation survive solving and serialization while unedited joints can remain guided. Captured recumbent figures retain their support side. Fully fixed hand constraints skip futile trials without hiding unmet contacts. Capturing and reloading the refined standing scene preserves joint positions within 1e-7 m and retains its clear rendered audit. |
| Guided starting poses | Optional `placement.mode: "guided"` seeds roots without pinning them; omitted mode retains fixed legacy behavior. A one-candidate rendered proposal must pass all declared contacts/supports, whole-figure/furniture/floor clearance, self checks and rendered balance. Fixed companions, zero mobility, invalid hints, missing geometry, budgets, cancellation and capture-to-fixed are tested. Browser controls preserve the requested guide separately from the solved transform through fixed-mode switching, history, save/reload/export and reset, including a 320 px Axe check. |
| Safe persistence and imports | Unit tests cover invalid versions, malformed JSON, unsafe keys, unknown scene choices, invalid landmark sides, duplicate IDs, quota errors and corrupt storage. A failed import does not partially add a pack. Re-importing creates fresh IDs. Browser recovery and invalid-import flows pass. |
| Preset geometry | All 23 entries validate structurally and pass the complete rendered catalog audit, with no unavailable checks. All eleven clothed reference studies and all twelve named layouts are rendered-clear. The base-model total is 22/23, with all 12/12 named entries clear; only the existing sofa proxy support-overlap flag remains, and its complete rendered result is clear. No previously clear base or rendered entry becomes flagged. |
| Calibrated stock layouts | Shared recipes supply catalog/text aliases with clothed fixed poses or validated guided hints. The lying-facing and cuddle bed/floor recipes retain their two/three contacts, pass the base-model gate and remain unchanged by refinement. The chair-supported pair has independently fitted chair/bench variants. The seated embrace has verified floor/bed variants retaining all five original contacts. Both guided pairs retain primary seat/foot supports within 4 mm and explicit partner support; their coarse defaults and rendered results pass. Conflicting body, pose, contact, coverage and surface settings bypass calibration; portable JSON retains the selected ordinary pose/hints. |
| Standing carry | Fixed floor/bed recipes preserve standing/lifted roles and all five contacts, including the original body-to-hand support direction. Contacts are approximately 2.4–3.7 mm, both carrier feet are approximately 2.0–3.0 mm from their plane, and complete figures/furniture/floor are clear. Both representations pass without refinement movement. Captured geometry is retained within 1e-7 m; absent meshes remain uncertified. |
| Table-supported pair | The fixed primary has chest/hips on the finite table top and feet on the floor; the standing partner has a validated guided start and two floor supports. All six supports are approximately 1.8–2.0 mm and all three original partner contacts approximately 1.5–2.5 mm. Complete figures/table/floor are clear, both representations pass, capture retains the geometry within 1e-7 m, and missing partner/all geometry remains uncertified. |
| Hands-and-knees pair | Both guided floor/bed defaults pass the independent coarse gate and existing whole-layout rendered adoption. Original postures/body types, four primary and two partner supports, and all three original contacts are retained. Six rendered supports are approximately 2 mm, three contacts approximately 2.5 mm, and complete figures/furniture/floor remain clear. Both palms face down. Capture replays geometry within 1e-7 m; missing either model preserves the coarse pose and remains uncertified. The final primary's raw 24.5 mm coarse knee discrepancy remains separately reported, not hidden or used as the rendered support distance. |
| Face-to-face reclining pair | A guided supine primary and fixed forearms-and-knees partner retain their original body types, one contact and surface/partner support ownership. Floor/bed defaults pass coarse and rendered checks. The primary's back/pelvis/head supports are 0.7–2.0 mm; the original contact is about 2.5 mm. Additional measurements verify both partner knees and forearms near 2 mm and relaxed feet close to the finite support plane. Complete figures/furniture/floor are clear. Fixed captures replay within 1e-7 m; missing either model preserves the coarse result without certification. |
| Seated-over-reclining pair | Independent forward/reversed bed/floor recipes retain the original body/posture roles, three arrangement contacts and surface/partner ownership. Two explicit custom hand-to-knee supports hold the partner's knees above the plane, with upward-facing palms; the feet remain approximately 3 mm from the plane. All five contacts and the primary's back/pelvis/head supports measure within 4 mm. Both guided defaults pass coarse and rendered gates, with complete figure/furniture/floor clearance. Fixed capture replays within 1e-7 m; absent models remain uncertified. The final raw primary body-model support residual remains approximately 61 mm and is not confused with the measured rendered support. |
| Hand-supported regions | Positive hand-support links resolve before mounted placement, so explicitly held regions are not first IK-seated on the mattress. Other supports, unmounted figures, ordinary or zero-strength contacts, fixed settings and global floor protection retain their contracts. Both endpoint orders retain authored reports while driving the free hand. A direct comparison against `7d88df7` leaves all 159 existing corpus poses and quality reports identical. |
| Opposed head-to-toe pair | Both guided floor/bed starts preserve the original supine/prone body roles, longitudinal reversal, two 0.8-strength contacts and surface/partner ownership. Contact gaps are approximately 3.0/2.8 mm; primary supports are 0.9–3.6 mm; all hands and feet are 2.4–3.0 mm from the actual finite plane. Complete figures/furniture/floor are clear and both default representations pass. Actual head direction and palm frames, fixed capture within 1e-7 m, and missing primary/partner/all models are tested. The final primary raw coarse residual of 26.6 mm remains separately reported. |
| Body-supported placement | Adaptive clearance reduces the seated-pair base support target from 523.7 mm to 3.4 mm. Chair cases pass across all four male/female pairings; bench and stature/build variations have measured support-plane regression tests. A 96-case comparison against `969f4f8` has 12 newly clean cases, no newly flagged cases and 78 unchanged results. Dressed contact failures remain separately reported. |
| Surface-intersection escape | Bidirectional bounded IK trials clear both hand/arm intersections in the seated-support fixture, ending at approximately 2.3 mm and 1.8 mm. The supporting figure, both roots and lower-body joints stay unchanged; individual collision pairs and aggregate residuals cannot worsen. The lap target remains unresolved. |
| Hand-to-body geometry | Coordinated free-arm reaches clear both standing-embrace hand/arm intersections at approximately 2.2 mm. The complete arms are checked against the entire target figure, including colored auxiliary meshes. The isolated limb stage preserves roots, lower-body joints and the target figure; its remaining body gap is handled separately. Regression tests retain this phase boundary. |
| Supported standing contacts | A bounded stance/torso correction closes the stock standing pair's remaining body gap, with all four gaps within 4 mm and no figure/figure surface crossing. The target figure stays fixed, wrist frames and foot height/orientation are preserved, and balance/self/prop/per-pair guards pass. Tests cover a translated/rotated custom-ID copy, fixed trunk channels, pinned/explicit end joints, third-figure collisions, missing geometry, budgets and cancellation. |
| Whole-figure diagnostics | Every rendered figure pair is audited, even without declared contacts. Crossings and unavailable checks are distinct in pose notes, catalog labels and the named CLI audit. Complete drawn geometry includes unowned auxiliary triangles. Missing/nonfinite geometry cannot certify clearance or reconcile a proxy overlap. Self/prop/support checks remain separately reported. |
| Persistent contact constraints | Body-region targets stay measurable beyond the former one-stature collision-search margin. A distant authored pair can approach instead of becoming an empty success; pinned figures remain pinned with unresolved contacts reported. Movement caps, overlap guards and saturated scoring are unchanged. |
| Final support reporting | Each declared region is now measured on drawn triangles against its floor or finite furniture top. Regional gaps and penetration are distinct; off-edge, clipped-edge and unavailable cases are covered. A fresh coarse residual is retained separately. Partner/none support remains null, never a fictitious zero. Fixed rigs do not move during measurement. |
| Coarse balance estimates | Chair and bench tops contribute alongside the floor within their finite footprints. Floating, buried and off-chair fixtures remain unsupported; expected partner support remains distinct from absent surface contact. This is still a centre-of-mass/contact-bounds estimate, not a stability simulation. |
| Rendered balance estimates | Measured support regions and nearby feet provide separate horizontal bounds clipped to finite furniture and a 30 mm proximity band. A tall kneeling regression retains visible support when the coarse knee capsules fall outside their band. The coarse estimate is preserved, and unavailable geometry cannot authorize a correction. Neither estimate certifies force balance. |
| Seated grounding | Bounded root/leg corrections bring both stock seated figures to approximately 2 mm visible seat/sole gaps. Tests cover both body types at 1.55/1.90 m with builds 0.9/1.1 on chair and bench, fixed settings, close partner contacts, obstacles, visible attachments, cumulative bounds, budgets, capture/reload and cancellation. |
| Kneeling grounding | Generic knee/shin correction brings the low kneel to approximately 1 mm and both paired kneeling supports to approximately 2 mm, preserving the pair's hand contact. Sixteen body/proportion/posture/floor-or-bed variations meet visible supports within 4 mm. Fixed settings, contacted wrists, cumulative motion bounds, missing meshes and cancellation are covered. |
| Complete floor clearance | Every drawn figure is checked against the studio floor, including unclaimed hands and other parts. Penetration beyond the existing 20 mm support-quality threshold and unavailable geometry remain visible. This exposed a 24 mm hand/floor crossing in the floor-rest study; the forearm correction now clears it while closing the 100 mm support gap. Accepted support candidates retain the stricter whole-figure nonpenetration guard. |
| Forearm-supported grounding | The floor-rest reference meets its visible pelvis/forearm supports within approximately 2 mm with complete floor clearance. Twelve male/female proportion/surface cases finish within 4 mm on floor and bed, with no self/prop overlap flags. Lower-body and trunk joints, root heading and horizontal position remain unchanged. Fixed arm channels, positive arm contacts, obstacles, bounded work, capture/reload and cancellation are covered. |
| Shared-plane seated grounding | The sofa recline meets its visible seat/foot supports within 4 mm and clears the complete backrest. Eighteen male/female proportion/floor/bed/sofa cases meet the same 4 mm target within eight candidates. Foot frames and trunk/head/hand-tip/toe-tip angles are retained; optional free-arm compensation prevents hands crossing the surface during lowering. A translated heading, quarter-turned sofa, fixed settings, close hand contact, obstacles, capture and cancellation are covered. |
| Complete furniture clearance | Every drawn figure/box pair is checked, including visible auxiliary triangles and interior vertices. Missing or orientation-unverified surfaces cannot certify clearance. Verified coarse prop exceptions retain their raw depths and counts; actual crossings and unavailable checks appear in the UI/CLI. |
| Anatomical region selection | Lap queries now include declared thigh-owned surfaces while retaining the original radius and regional weight threshold. Synthetic patches verify both sides, pose/stature/heading changes and exclusion of distant knee surfaces, unrelated bones and small weight tails. The seated lap gap is now measured at 107.5 mm, not reported as fixed. |
| Description feedback | Unread text warnings survive worker rendering and draft reload. Catalog captions no longer overwrite the original text command. Pending poses do not retain stale quality notes. |
| Exports | Real PNG, transparent PNG, SVG and JSON downloaded. PNG pixels decoded: opaque image content present; background corner alpha is 255 for standard PNG and 0 for transparent PNG. JSON is re-importable. |
| Runtime | Every new preset rendered in a production build without page errors, console errors or failed requests in the normal-path browser test. Missing WebGL leaves the editor usable. An intentionally failed model download produces an estimated contact, and its warning does not leak into a healthy model. Rapid preset changes publish only the final scene; cancellation restores discarded rigs. |
| CLI interoperability | The CLI renders built-in IDs and exported catalog files using the same surface-refinement pass. Clothed examples rendered successfully at 640×480 and 320×480. A seven-render PNG regression confirms saved-camera defaults, explicit view precedence and malformed stored-camera fallback for raw diagnostic scenes. Lighting/framing remain separate implementations. |

## Commands and results

The final product audit passes **407/407 unit tests**, **62/62 browser scenarios**
across 20 isolated batches, **23/23 rendered catalog entries**, and **7/7 contact
fixtures**. Production builds pass and `npm audit` reports zero vulnerabilities.
The browser ledger has no missing or unexpected cases and is tied to runtime
and verification-source hashes; full details and screenshots are linked from
the completion audit. This is full current browser coverage, not an aggregation
of the older targeted runs below.

The final additional case holds the skin atlas until after the pose is complete,
then verifies an idle-viewport pixel change without another worker solve. Its
addition did not change the original 61 test definitions or application runtime;
the ledger records the hash-continuity proof.

The audit also fixed repeated body-shape preparation on equivalent appearance
requests, malformed contact-type imports/inherited-property lookup, and formatted
library exports that exceeded their own 2 MB import limit. A 200-preset,
four-figure library now round-trips without losing precision; genuinely oversized
exports report an error and retain saved data. Cold work can exceed 30 seconds
on the shared software-rendering host, so scene-readiness waits are bounded at
60 seconds while geometry checks and other assertions retain their limits.

## Prior iteration results

- The final production-build `catalog-camera.spec.js` regression passes
  **4/4 scenarios** (3.7 minutes), covering all twelve named entries, warning
  navigation with a deliberately unresolved imported scene, preview failure
  recovery, refined-preview persistence and mobile camera/overflow behavior.
  Combined with the new layout batch, **6/6 targeted browser scenarios pass**.
  The production build succeeds and the last-run marker is `passed` with no
  failed tests. This is not a fresh full-browser-suite claim.
- The new production-build `head-to-toe-layout.spec.js` passes **2/2 browser
  scenarios** (3.0 minutes): original contact/support measurements on bed/floor,
  guided policies, saved reload/export, exact fixed capture/update/reload, and
  explicit height/facing/unsupported-surface fallback. Both final screenshots
  were inspected. Normal-path page/console/request errors are empty.
- The final complete `npm test` rerun passes **392/392 tests** (390.9 seconds),
  including all ten new layout checks, the deliberately unresolved partner-
  support fixture and every existing calibrated layout, support/contact,
  clothing, parser, catalog, persistence, preview and CLI regression.
- The complete head-to-toe catalog audit reports **23/23 rendered-clear**,
  including **12/12 named layouts**, with **no unavailable checks**, exit 0.
  Its retained base results are **22/23 catalog-clear** and **12/12 named-clear**.
  Only the existing sofa reference's coarse support-overlap flag remains; its
  complete rendered supports, furniture and floor are clear. All **7/7 contact
  fixtures** also pass on the final recipe, exit 0. No solver, contact-region,
  furniture, support-ownership or tolerance changes were made this iteration.
- The focused head-to-toe layout run passes **10/10 tests** (27.4 seconds),
  covering all aliases, pure data application, floor/bed translation, explicit
  edits, both independent geometry gates, original contact/role ownership,
  actual opposed heads, resting/bracing palm frames, near-plane hands/feet,
  exact fixed replay and unavailable primary/partner/all models.
- The first full unit run passed 391/392 tests and exposed a legacy reporting
  fixture that required the bundled head-to-toe preset to keep unresolved
  contacts. The fixture now deliberately pins and separates the partner by
  2 m, retaining the same null partner-support contract and explicit unresolved-
  contact assertions. It no longer depends on a stock geometry defect.

### Earlier verified iterations

- The final all-named-entry production-browser regression passes **1/1
  scenario** (2.1 minutes), covering all twelve named definitions, refined
  catalog previews, support feedback, search and explicit warning navigation.
  Combined with the two new-layout batches and contact-authoring batch,
  **9/9 targeted browser scenarios pass**. The production build succeeds,
  and the last-run marker is `passed` with no failed tests. No public
  deployment was performed; the private repository has no Actions workflows.
- The final authoring browser selection passes **4/4 scenarios** (3.8 minutes):
  the original clear gesture's names/targets/history/save/export, contact-type
  history and persistence with truthful unresolved measurements, mobile
  add/swap/remove and Grip selection, and imported custom type preservation in
  body-first contact rows. The mobile flows pass Axe and no-overflow checks;
  the 320 px imported-kind screenshot was inspected. These are completed
  production-build runs, not a new full-browser-suite claim.
- The final production-build `straddle-pair-layouts.spec.js` selections pass
  **2/2 forward scenarios** (2.8 minutes) and **2/2 reverse scenarios**
  (2.7 minutes). Both verify bed/floor geometry, guided policies, visible
  support-type rows, saved reload, JSON export, fixed capture/update/reload and
  explicit height/opposite-facing/unsupported-surface fallback. The reverse
  persistence flow also passes 320 px overflow and Axe checks. Normal-path
  page/console/request errors are empty. Forward bed/floor, reverse bed and
  mobile contact screenshots were inspected; forward and reversed figures
  face distinctly. Both surface variants have separate measured checks.
- The complete final `node scripts/validate-named-presets.mjs --catalog --rendered`
  audit reports **22/23 rendered-clear**, including **11/12 named layouts**,
  and **21/23 base-model clear**, including **11/12 named layouts**. No checks
  are unavailable and no previously clear entry becomes flagged. The head-to-toe
  layout retains its two unresolved contacts, primary support gap and mattress
  crossing, so the audit correctly exits 1. The sofa reference remains a coarse
  support-overlap case with a clear rendered result. All **7/7 contact fixtures**
  pass, exit 0. A final differential check against `7d88df7` gives **159/159
  identical coarse poses and quality reports**, with no changes.
- The seated-over-reclining iteration passes the complete `npm test` run:
  **382/382 tests** (415.1 seconds), including 29 added regressions: seven
  generic support-ownership tests and 22 forward/reversed layout checks. The
  latter extend the calibrated-layout suite to 91 tests within this full run.
  Both surface variants pass coarse and rendered gates, retain all three
  original contacts plus two explicit editable knee supports, and replay fixed
  captures within 1e-7 m. Tests measure palm-up hands, feet near the finite
  plane, the primary's three supports and actual opposing facing directions.
  Reversed held-knee endpoints remain valid in coarse and rendered solving;
  unilateral support, ordinary links, fixed settings, rolling postures and
  missing primary/partner/all models keep their existing contracts.
- Early new assertions incorrectly assumed a horizontal forward gaze and an
  explicit zero yaw for default-facing parser output. The measured forward
  face points diagonally downward toward the reclining head; heading is now
  checked separately from pitch. Default yaw is resolved from the arrangement,
  and the reverse-facing variation uses the parser's supported `facing him`
  phrase. No contact, support, collision or furniture threshold was relaxed.
- The first browser batch exposed a test-only assumption that the worker's
  public quality summary includes contact kind. It does not; type persistence
  is checked through the labeled editor and exported scene instead. The
  initial batch is not counted as a completed pass.
- The reverse tall-body variation twice exceeded the default 30-second browser
  readiness wait. A separate production-browser timing probe completed in
  **30.7 seconds**: approximately 1.3 seconds coarse solving, 14.0 seconds model
  rebuilding, 10.9 seconds rendered refinement and 4.3 seconds final meshing.
  The stock layout and persistence checks passed with the original readiness
  limit. Only this explicit tall-body fallback gets a bounded 60-second wait;
  geometry checks are unchanged. This software-Chrome latency remains a real
  limitation, not a claim that body edits are instant.
- Editing the helping-hand example from Rest to Support changes its inferred
  hand shape and leaves a measured 35 mm gap. The UI correctly reports
  `Movement limited`; the authoring test now keeps the original example's
  clear save/reload assertions and separately checks that type history and
  persistence retain the edited scene's measured warning. A type picker is
  not a guarantee that every new constraint can be satisfied.

- The face-to-face reclining iteration adds ten layout regressions. The focused
  `node --test tests/presetLayouts.test.js` run passes **69/69 tests**
  (94.6 seconds). Both floor and bed keep the original supine/forearms-and-knees
  roles and one contact, with a guided primary and fixed partner. In addition to
  the three declared primary supports, direct rendered queries verify both
  partner knees and forearms within 4 mm and relaxed feet within 12 mm of the
  shared finite support plane, without changing partner ownership. Forearms are
  level, faces oppose one another and both heads point in the same longitudinal
  direction. Complete figures, furniture and floor are clear. Capture preserves
  geometry within 1e-7 m without guided adoption; missing primary/partner/all
  models on both surfaces preserve the coarse pose with unavailable checks.
- The first focused run exposed a no-op test variation that changed an already
  supine actor to supine, plus a real finite-mattress detail: the partner's feet
  overhung the foot end, leaving a 17 mm clipped-region measurement. The test
  now chooses a different posture, and a 70 mm shared longitudinal translation
  brings the feet over the mattress. The complete rerun above passes with the
  original furniture, contact regions and quality limits unchanged.
- The complete rendered catalog audit on the final centered recipe reports
  **20/23 clear**, including **9/12 named layouts**, with **19/23 base-model
  clear** and **9/12 named base-model clear**. No unavailable checks or newly
  flagged entries occur. The remaining cowgirl, reverse-cowgirl and head-to-toe
  layouts keep the audit's exit status at 1. All seven contact fixtures pass
  again on the final code, exit 0.
- The complete `npm test` run on the centered reclining-pair recipe passes
  **353/353 tests** (351.2 seconds), including all ten new layout regressions
  and every previously calibrated layout, support/contact, clothing, parser,
  persistence, preview and CLI check.
- The standalone production-build browser selection
  `tests/browser/reclining-pair-layout.spec.js` passes **2/2 scenarios**
  (2.1 minutes). It verifies the floor/bed contact and primary support distances,
  unchanged partner ownership, mixed placement, saved reload/export, fixed
  capture/update/reload and explicit height/facing/unsupported-surface fallbacks.
  Fresh floor and bed screenshots were inspected. Normal-path browser
  page/console/request errors are empty. The production build passed and the
  last-run marker reports no failed tests.
- The final production-build regression batch
  `tests/browser/catalog-camera.spec.js tests/browser/guided-placement.spec.js`
  passes **5/5 scenarios** (4.0 minutes), exit 0. Together with the new layout's
  completed batch, **7/7 targeted browser scenarios pass**. All twelve named
  entries, preview recovery and saved previews, mobile camera controls, and
  guided/fixed placement history, reload, export and mobile reset pass on the
  final code. Browser batches ran separately from geometry jobs; the last-run
  marker is `passed` with no failed tests. This is not a new full-browser-suite
  claim.

- The hands-and-knees iteration adds ten layout regressions. The focused
  `node --test tests/presetLayouts.test.js` run passes **59/59 tests**
  (84.5 seconds), preserving every original contact, support and figure role.
  Floor/bed defaults pass the existing coarse gate, then adopt the authored
  guide only after complete rendered validation. Tests directly measure the
  coarse default supports before adoption and retain the different raw coarse
  residual after adoption. No solver, contact-region, furniture or quality
  tolerance changes are needed. Both palms face down; all six supports are
  approximately 2 mm and the three contacts approximately 2.5 mm. Captures retain
  geometry within 1e-7 m without a guide, and missing primary/partner/all models
  on both surfaces preserve the coarse pose with explicit unavailable checks.
- An initial focused run was interrupted and is not counted as a pass. The next
  run exposed a new test reading `bodySupportResidual` before rendered reporting
  populates it; it was corrected to call `measureBodySupportResidual` directly.
  The complete 59-test rerun above passed without weakening the coarse gate.
- At the hands-and-knees milestone, `node scripts/validate-named-presets.mjs --catalog --rendered` reports
  **19/23 clear**, including **8/12 named layouts**. The retained base results
  are **18/23 clear**, also **8/12 named**. No previously clear entry became
  flagged, and no figure, support, floor or furniture check is unavailable.
  The four remaining rendered failures keep the audit's exit status at 1.
  All seven contact fixtures pass on the new recipe, exit 0.
- The complete `npm test` run on the kneeling-pair recipe passes **343/343 tests**
  (336.7 seconds), including the new ten layout regressions, every previously
  calibrated layout and the existing solver, support/contact, clothing, parser,
  persistence, preview and CLI checks.
- The standalone production-build browser selection
  `tests/browser/kneeling-pair-layout.spec.js` passes **2/2 scenarios**
  (2.3 minutes). It verifies floor/bed support and contact measurements, guided
  defaults, saved reload/export, exact fixed capture/reload, and explicit
  height/facing/other-surface fallbacks. Fresh floor and bed screenshots were
  inspected. Normal-path page/console/request errors are empty, the production
  build passes and the last-run marker reports no failed tests.
- The initial combined browser command ended with signal 143 after eight
  scenarios passed, before the ninth finished; it is not a completed-suite pass.
  Its preview server remained alive and caused an immediate port-conflict
  rejection of the first retry. The owned preview process was then stopped and
  confirmed terminal. Browser checks were split into shorter unchanged-code
  batches with the original timeouts; the two-scenario result above is complete.
- The subsequent production-build batch
  `tests/browser/catalog-camera.spec.js tests/browser/hand-shapes.spec.js tests/browser/guided-placement.spec.js`
  passes **7/7 scenarios** (5.3 minutes), exit 0. Together with the completed
  kneeling-pair batch, **9/9 targeted browser scenarios pass**. All twelve named
  entries, preview recovery/cache behavior, saved previews, mobile camera and
  guided-placement controls, and both hand-shape save/export flows pass on the
  final code. The last-run marker is `passed` with no failed tests. These are
  completed targeted batches, not a new full-browser-suite claim.

- The brace-hand correction adds six geometric regressions in
  `tests/handPose.test.js`. All **6/6 pass**, checking both models, mirrored
  hands, transformed/asymmetric arm frames, unchanged local joint translations
  and lengths, non-mutating posing, the other named hand shapes, and actual
  drawn palm/thumb/finger extents. The initial plane tests failed on both
  models before the correction. Diagnostic clothed full-figure and hand-close
  renders were inspected. At that milestone, a palm-down solo candidate had four
  approximately 2 mm rendered supports, but its coarse knee residual remained
  approximately 25 mm and the paired candidates had unresolved hand crossings.
  Those initial candidates were not added to the built-in catalog; the later
  guided hands-and-knees iteration above completes the pair.
- The complete rendered catalog audit on the brace correction retains
  **18/23 clear**, including **7/12 named layouts**. The same five entries
  remain flagged, with no newly flagged or unavailable checks. The base-model
  result is still **17/23 clear**. All seven contact fixtures pass, exit 0.
- `npm test` on the brace correction passes **333/333 tests** (318.7 seconds),
  including all six new geometric regressions and the existing calibrated
  layout, support/contact, clothing, persistence and CLI checks.
- The production-build selection
  `tests/browser/hand-shapes.spec.js tests/browser/catalog-camera.spec.js`
  passes **6/6 scenarios** (4.4 minutes), run without concurrent geometry jobs.
  Both models change their drawn geometry when bracing, retain the same mesh
  signature through saved reload and one-sided edits, and export the intended
  hand shape. All twelve named entries, preview recovery, saved previews and
  mobile camera controls pass again. Normal-path browser errors and failed
  requests are empty. The first run passed all four existing scenarios but
  failed the two new export assertions: the editor deliberately serializes
  identical sides as `"brace"`, not a two-sided object. The assertion was
  corrected to the existing public format; the full six-scenario rerun passed
  without application changes. The production build and last-run marker pass.
  This is a targeted browser run, not a new full-suite claim.

- The table-layout iteration adds eight layout regressions. The focused
  `node --test tests/presetLayouts.test.js` run passes **49/49 tests**
  (53.7 seconds), retaining the original coarse gate. The primary chest and
  hips contact the finite table top, and all four feet contact the floor at
  approximately 1.8–2.0 mm. Three original partner contacts finish at
  approximately 1.5–2.5 mm with complete figure, table and floor clearance.
  Primary fixed placement is retained while the partner uses a validated guide;
  capture replays the completed geometry within 1e-7 m. Missing partner/all
  models preserve the coarse pose and remain uncertified.
- The new production-build table browser selection passed **2/2 scenarios**
  (2.3 minutes), covering mixed placement, six support measurements, three
  contacts, save/reload/export, capture-to-fixed, saved update/reload, and
  explicit height/facing/other-surface fallbacks. No core solver or tolerance
  changes are part of this iteration.
- All seven `node scripts/validate-surface-contacts.mjs` fixtures pass again
  on the final table-layout code, exit 0.
- The table-layout iteration's final production-build browser selection
  `tests/browser/catalog-camera.spec.js tests/browser/table-support-layout.spec.js tests/browser/chair-lap-layout.spec.js tests/browser/seated-embrace-layout.spec.js tests/browser/standing-carry-layout.spec.js tests/browser/preset-layouts.spec.js tests/browser/guided-placement.spec.js tests/browser/placement.spec.js`
  passes **17/17 scenarios** (16.7 minutes), exit 0, run separately from the
  geometry jobs. All named entries, preview recovery/cache behavior, mobile
  camera input, fixed/guided placement, capture and every calibrated layout
  pass their browser checks. The new table flow retains six supports, three
  contacts and mixed modes through saved reload/export, then captures and
  replays a fully fixed layout. Height/facing/other-surface fallbacks stay
  explicit. The final table screenshot was inspected, and normal-path browser
  errors/failed requests remain empty. The last-run marker reports `passed`
  with no failed tests; the production build passed as part of this run.
  This is a targeted selection, not a new full-browser-suite claim.

- Standing-carry/contact-direction diagnostics retain all five contacts at
  approximately 2.4–3.7 mm and both carrier foot supports at approximately
  2.0–3.0 mm on floor and bed. Complete figures, furniture and floor are clear,
  the carrier's rendered balance estimate is supported, and the carried figure
  retains partner support. Both coarse and rendered checks pass as ordinary
  fixed data; no guided-pose fallback or tolerance change is required.
- The initial three-browser selection for body-first authoring and the carry
  layout passed **3/3 scenarios** (3.3 minutes). It covered original endpoint
  order through save/reload/export and a 320 px Axe check, plus floor/bed carry
  geometry, fixed capture and explicit-edit fallbacks. This preceded the later
  coarse collision/selection safeguards; final-code browser results follow below.
- The unchanged 159-case scene sweep was compared with the solver at
  `2ebcf21e96b8f09c49fa28b9b7796d9ba00240d6`. An initial endpoint-only trial
  introduced three newly flagged carrying combinations and was rejected.
  The final support-arm/snapshot safeguards produce **134/159 sound, 25 flagged**,
  versus **127/159 sound, 32 flagged** at the baseline, with **no newly flagged
  cases**. Worst penetration remains **63.2 mm**. The validator's tracked unmet
  count rises from **94 to 98**; blocked/unreachable targets are separately
  reported. This is a geometry regression comparison, not an all-scenes pass.
- All seven contact fixtures pass on the final standing-carry/contact-direction
  code, using `node scripts/validate-surface-contacts.mjs`, exit 0.
- The standing-carry/contact-direction production-build browser selection
  `tests/browser/authoring.spec.js tests/browser/catalog-camera.spec.js tests/browser/standing-carry-layout.spec.js tests/browser/chair-lap-layout.spec.js tests/browser/seated-embrace-layout.spec.js tests/browser/preset-layouts.spec.js tests/browser/guided-placement.spec.js`
  passes **19/19 scenarios** (16.6 minutes), exit 0, run without concurrent
  geometry jobs and with the original timeouts. It covers contact editing,
  original endpoint order, history, import validation, missing-model recovery,
  cancellation, all twelve named entries, preview/cache behavior, mobile camera,
  guided placement and every calibrated layout. Carry floor/bed geometry,
  save/reload/export, fixed capture and explicit variations pass with no normal-
  path page/console/request errors. Fresh carry floor/bed and 320/390 px contact
  editor screenshots were inspected; the mobile Axe and overflow checks pass.
  `test-results/.last-run.json` reports `passed` with no failed tests. The
  production build passed as part of this run. This is a targeted selection,
  not a new full-browser-suite claim.

- At the table-layout milestone, `npm test`: **327 passed** (340.8 seconds), including
  calibrated stock-layout
  parity/fallback, bed/floor dressed-mesh checks and CLI camera precedence, plus
  the original parser, geometry and
  architecture tests, catalog/storage tests, contact-authoring tests, clothing
  checks, triangle/surface-refinement checks and per-preset CLI selection,
  quality-dependent exit status and invalid/empty input.
- The chair-layout/guided-placement iteration adds eight layout/availability
  regressions and eight guided-placement regressions. Both chair and bench
  retain the original three contacts within 4 mm, ground the primary seat/feet,
  and clear complete figures/furniture/floor without changing regions or
  tolerances. The fixed-pose pilot failed the existing base-model gate and was
  not delivered as a fixed default. Guided starting poses preserve that gate:
  the coarse solve can adjust its approximation, and the authored pose is adopted
  only after complete drawn-geometry validation. Fixed legacy scenes remain fixed.
- The chair-layout iteration's first final-code full unit run ended with signal
  termination (exit 143)
  before its summary and is not counted as a pass. Its process was confirmed
  terminal before the unchanged-code standalone rerun passed all 292 tests.
- The production-build selection
  `tests/browser/chair-lap-layout.spec.js tests/browser/guided-placement.spec.js`
  passed **3/3 scenarios** (2.7 minutes). It checks chair/bench saving, reload and
  editable JSON; explicit taller/away/unsupported-surface fallback; guided/fixed
  behavior, history and reset; and a 320 px accessibility audit. Fresh chair,
  bench and mobile-guide screenshots were inspected.
- The chair-layout/guided-placement runtime subsequently passed the complete
  production-build browser suite: **34/34 scenarios** (24.7 minutes), exit 0.
  At completion, `test-results/.last-run.json` reported `passed` with no failed
  tests. This run
  includes the new chair/bench and guided-placement flows, all library and
  authoring flows, desktop/mobile/save-dialog accessibility, and corrupt-storage
  and blocked-WebGL recovery. It did not clear the then-outstanding eight geometry
  failures in the separate rendered catalog audit.
- The seated-embrace iteration adds nine layout regressions; its focused
  `node --test tests/presetLayouts.test.js` run passes **32/32 tests**. The floor
  and translated bed defaults each pass coarse solving and full rendered
  validation with all five contacts at approximately 1.8–2.5 mm, primary
  supports at approximately 1.8–2.0 mm, no figure/furniture/floor crossings and
  a supported rendered balance estimate. Capture/reload retains joint positions
  within 1e-7 m. Missing meshes preserve the coarse pose and remain uncertified.
  No solver stage, contact region or quality tolerance changes in this iteration.
  All seven `node scripts/validate-surface-contacts.mjs` fixtures pass again.
- The first new browser flow used an internal refinement counter not included
  in the worker's public summary and failed in the test harness. The assertion
  now checks the published guided-pose adjustment; the exact work counter remains
  covered by unit tests. The explicit-edit fallback scenario passed in that run.
  A later broader attempt hit 30-second readiness timeouts while unit and
  catalog geometry jobs ran concurrently; it was interrupted (exit 130) after
  three failures and is not passing evidence. The unchanged browser selection
  was rerun separately after those jobs finished, with the original timeouts.
- The seated-embrace production-build browser selection
  `tests/browser/seated-embrace-layout.spec.js tests/browser/chair-lap-layout.spec.js tests/browser/preset-layouts.spec.js tests/browser/catalog-camera.spec.js tests/browser/placement.spec.js`
  passes **12/12 scenarios** (11.5 minutes), exit 0. It covers all twelve named
  entries, preview failure/cache recovery, mobile camera controls, fixed placement
  and capture, all calibrated layouts and explicit-edit fallbacks. The new
  seated-embrace flow verifies floor/bed support and five close contacts,
  guided save/reload/export, then capture-to-fixed and saved update/reload/export.
  Both new floor and bed screenshots were inspected. The final last-run marker
  reports `passed` with no failed tests. This is a targeted selection, not a new
  full-browser-suite claim. The production build passed as part of this run.
- The shared-plane seating iteration adds ten regressions and checks eighteen
  body/proportion/surface variations. Both sofa body types clear the seat and
  backrest while retaining foot frames. A compensating wrist-frame candidate
  resolves below-surface hands in floor/bed and tall-male cases; fixed arm
  channels remain authoritative. Deduplicating effective retained-pitch/forward
  candidates lets the tall female sofa case meet 4 mm within the same eight-step
  phase budget. Translation/rotation, finite furniture, close partner contact,
  independent movement bounds, capture/reload and cancellation are covered.
  The clothed diagnostic sofa render was inspected. No preset data, furniture
  dimensions or quality tolerance was changed.
- The shared-plane seating production-build browser selection
  `tests/browser/level-seated-supports.spec.js tests/browser/reclining-supports.spec.js tests/browser/seated-supports.spec.js tests/browser/kneeling-supports.spec.js tests/browser/placement.spec.js tests/browser/catalog-camera.spec.js tests/browser/studio.spec.js:284`
  passes **13/13 scenarios** (10.5 minutes), using the Chrome path below. The new
  sofa flow checks both body types, a bed edit and return to sofa, capture,
  save/reload and JSON export with no page/console/request errors. Both fresh
  sofa screenshots were inspected. The reference-study scenario now requires
  all eleven references to have no warning/error pose notes after rendering;
  it also checks camera/material controls and desktop overflow. Named entries,
  preview recovery/cache behavior, touch camera, placement and earlier support
  flows pass in the same run. This is a targeted selection, not a new full-suite
  claim. The production build and all seven contact fixtures pass again.
- The forearm-support iteration adds nine regressions, including the twelve
  body/proportion/floor-or-bed cases and a translated/rotated reference. The
  stock floor-rest pose closes its approximately 100 mm support gap to 2 mm and
  clears its unclaimed hands. Initial trials that grounded the pelvis while
  pushing forearms below the floor or introducing self-overlap were rejected.
  Retaining accepted lateral hand clearance allows the tallest female case to
  meet the same 4 mm target within the unchanged eight-candidate budget. Fixed
  channels, positive arm contacts, complete obstacles, missing meshes, portable
  capture and cancellation retain their guards. The integrated clothed CLI render
  was inspected; no preset data or contact/support tolerance was changed.
- The forearm-support production-build browser selection
  `tests/browser/catalog-camera.spec.js tests/browser/kneeling-supports.spec.js tests/browser/placement.spec.js tests/browser/reclining-supports.spec.js tests/browser/seated-supports.spec.js`,
  using the same Chrome path below, passes **11/11 scenarios** (8.4 minutes).
  The new flow checks the male floor reference, female body edit, bed surface
  edit, capture, save/reload and JSON export, with no page/console/request errors
  and no warning/error pose notes. Both fresh recline screenshots were inspected.
  Every named entry, preview recovery/cache behavior, mobile camera/placement,
  and both seated/kneeling flows also pass. This is a targeted run; the complete
  29-scenario result below preceded the forearm phase. The production build and
  all seven contact fixtures pass again.
- The kneeling-grounding iteration adds nine correction/balance/floor tests and
  two rendered-contact-bound tests. All sixteen body/proportion/posture/surface
  variations finish within 4 mm of their declared supports. The low and paired
  clothed diagnostic renders were inspected. Fixed contacted wrists and
  placement remain authoritative; cancellation restores accepted intermediate
  changes. No preset data, contact threshold or support threshold was changed.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:browser`:
  **29/29 passed** in the complete production-build run (20.9 minutes) after
  kneeling grounding, rendered balance and whole-floor diagnostics were
  integrated. The two new kneeling flows verify measured support and contact
  clearance, correction feedback, capture, save/reload and JSON export with no
  warning/error notes or page/console errors. Both fresh kneeling screenshots
  were inspected, along with the 320 px placement screenshot. All existing
  authoring, catalog, camera, placement, seated/calibrated-layout, import/export,
  mobile, accessibility and recovery scenarios passed in the same run. The
  production build and all seven contact fixtures pass again.
- The seated-grounding iteration adds ten seated-support tests and five complete
  furniture-surface tests. Both stock seated references pass; the eight varied
  body/dimension/surface cases also finish within 4 mm of their visible supports.
  The two stock clothed 640×720 CLI renders were inspected. No preset data or
  contact tolerance was changed to obtain the correction.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:browser`:
  **27/27 passed** in the complete production-build run (19.2 minutes) after
  seated grounding and furniture clearance were integrated. The two new seated
  flows verify visible support/prop metrics, correction feedback, pose capture,
  saved reload and JSON export with no warning/error notes. Both new browser
  screenshots were inspected. The preceding authoring, named catalog, camera,
  placement, calibrated-layout, import/export, mobile, accessibility and recovery
  scenarios all passed in the same run. The production build and seven contact
  fixtures pass again.
- The rendered-support iteration adds three coarse balance regressions, seven
  drawn-support regressions and an explicit whole-catalog CLI scope check.
  Tests cover finite furniture tops and clipped edges, off-edge distance,
  penetration (including one of multiple candidate tops), unavailable/nonfinite
  data, repeated measurement and cancellation. A fixed clothed seat fixture
  distinguishes its visible gap from an apparently grounded coarse model.
  Both calibrated bed/floor recipes now require every declared drawn support
  region to be available, without penetration, and within the existing 20 mm
  limit; their minimum-surface, contact and clearance gates remain unchanged.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:browser`:
  **25/25 passed** in the full production-build run (17.5 minutes) after the
  rendered-support changes. The catalog scenario checks displayed support gaps
  and penetration against the final worker metadata, including null partner
  support. Both corrected bed/floor flows, missing-model recovery, fixed
  authoring/history/save/reload/export, mobile interaction and accessibility
  pass. Fresh screenshots of both calibrated layouts on bed and floor were
  inspected. The production build and all seven contact fixtures pass again.
- At the table-layout milestone, `node scripts/validate-named-presets.mjs --catalog --rendered`: **18/23 clear;
  5 require review**, with no unavailable figure, support, floor or furniture checks. Its retained base
  results are **17/23 clear**. The named subset is **7/12 base-model clear** and
  **7/12 rendered clear**. The command exits 1 for the unresolved entries.
  All eleven reference studies are now rendered-clear. Their original unit gate
  did not check prop overlap or drawn support. The reclined study's base report
  still includes 41 mm of prop overlap; rendered refinement now closes its former
  98 mm support gap and clears the complete backrest. Raw proxy disagreements
  remain separately available rather than being mistaken for visible crossings.
- The cuddle recipe adds seven instances of the shared stock-layout
  regressions. Every calibrated alias shares catalog geometry, requested
  variations bypass the recipe, and real bed/floor meshes retain their original
  contacts and clearance. Base-model checks now run before rendered refinement
  for both recipes. The initial 220-test pass preceded the final coarse-model
  adjustments; its complete 134.7-second rerun verified that iteration's data.
- The final cuddle iteration's production-build browser selection
  `tests/browser/catalog-camera.spec.js tests/browser/placement.spec.js tests/browser/preset-layouts.spec.js`
  passes **8/8 scenarios** (7.2 minutes). It covers every named entry, preview
  recovery/cache behavior, mobile camera interaction, capture/edit/history/save/
  reload/export, and both calibrated card/floor flows with taller/away fallback.
  The new cuddle has three non-warning contacts in the browser. Its bed/floor
  screenshots and a final clothed three-quarter CLI render were inspected.
  This is a targeted run; the 24-scenario full run below preceded the cuddle
  recipe. The final production build and seven contact fixtures pass again.
- The lying-facing calibrated-layout browser flow passes: card loading and literal floor
  input have two non-warning contacts, active top view and the fixed-placement
  hint. Taller and facing-away requests retain their settings without stock
  placement locks. Both bed and floor screenshots were inspected, with clothed
  figures fully framed. The CLI camera regression also compares actual
  PNG outputs rather than checking only argument parsing.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:browser`:
  **24/24 passed** in the full production-build run (16.4 minutes) after the
  first lying-facing layout was integrated, before the cuddle recipe. This
  includes all prior authoring, camera,
  placement, persistence, export, mobile/accessibility and recovery scenarios,
  plus the new calibrated-layout flow. The production build passed as part of
  this run. Older split-run results below describe their respective iterations.
- The placement/capture iteration adds **eight regressions** and passes all
  **204 tests** (111.5 seconds). All catalog rigs can be captured as valid
  authoring data; this does not certify their existing geometry. Seven rendered
  contact fixtures pass again, and the complete rendered named audit remains
  **1/12 clear**, with the same eleven layouts still requiring calibration.
- The initial two placement browser scenarios passed (1.7 minutes), covering
  whole-layout capture, pending-state controls, history, save/reload/export,
  numeric edits, invalid-input feedback, support warnings, automatic reset and
  a 320 px Axe check. Desktop and narrow-screen screenshots were inspected.
- The expanded 23-scenario browser run initially passed **22** and failed the
  fixed-joint scenario: the new placement output reused the joint output's CSS
  class, so the synchronous pending-angle query selected the placement message.
  Placement now has its own semantic class with the same shared styling. The
  test assertion and timeouts were not weakened. The two new placement scenarios
  passed in that broad run, including precise numeric input and capture at 320 px.
- After separating the readout classes, the production-build rerun of
  `tests/browser/joints.spec.js tests/browser/placement.spec.js` passed **3/3**
  (3.7 minutes). Combined with the 22 successes in the broad run, all **23 distinct
  browser scenarios** have passed. This is split-run evidence, not a claim that
  the initial full run was green. The final mobile placement screenshot was
  inspected with fixed controls enabled.
- The distant-contact and support-report iteration adds **six regressions** and
  passes all **196 tests** (105.1 seconds). The updated support/CLI assertions
  also pass in a separate six-test run.
- Its production-build browser selection
  `every existing named|contact targets, figure names|rapid preset changes|fixed edited channels`
  passes **4/4 scenarios** (6.3 minutes). The catalog test observes public worker
  support metadata, checks that displayed surface-gap warnings match it, and
  verifies null residuals / absent floor-gap warnings for partner-assigned
  figures. Authoring/history, fixed angles and rapid switching also pass.
  This is a targeted run; the 21-scenario result below belongs to the preceding
  whole-figure/standing-body iteration.
- The whole-figure/standing-body iteration adds **11 regressions** and passes
  all **190 tests** (99.8 seconds), including the rendered CLI's successful
  stock standing result. All seven existing contact fixtures pass again with
  an added requirement that every rendered figure pair is available and clear.
- After the hand-to-body changes and query optimizations, the complete
  **179-test run passed** (33.1 seconds), including eight new regressions. The
  focused surface/region/triangle suite passed all **29 tests**. The seven
  dressed contact fixtures passed again.
- An all-named-presets browser check initially timed out at the unchanged
  30-second readiness limit on the second named entry, both in the combined
  targeted run and in isolation. A Node CPU profile identified unnecessary exact
  whole-limb nearest-distance calculations. Separating crossing-only checks from
  the lazy proxy-facing query reduced that fixture's measured refinement time
  from **12.2 seconds to 5.2 seconds**, with identical contact results and the
  same 32 candidates. Neither the collision coverage nor the browser timeout
  was relaxed.
- The next browser run cleared that entry but exposed a later timeout at lotus.
  Its profile showed repeated full-figure hierarchy builds during free-arm
  trials. Immutable whole-scope refits reduced the measured Node refinement
  time from **21.5 seconds to 9.2 seconds**, again with identical reported
  contacts and the same 32 candidates. Tests compare refits with rebuilt trees
  and cover moved geometry, changed indices, missing/restored triangles and
  preservation of previous queries. An attempted safety-check reordering did
  not improve the measured time and was not retained.
- After both performance fixes, the production-build browser selection
  `every existing named|rapid preset changes|fixed edited channels` passed
  **3/3 scenarios** (4.5 minutes). The all-twelve catalog scenario passed in
  2.3 minutes with its original readiness timeout and no page, console or
  request failures. The precise-joint flow passed in 1.8 minutes, including
  history, save/reload, export and narrow-screen accessibility. That iteration
  used a targeted three-scenario gate; the subsequent complete run is below.
- `npm run build`: **passed**; also rebuilt by the browser test configuration.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:browser`:
  **21 passed** in the complete production-build run after whole-figure
  diagnostics and standing-body refinement (13.6 minutes). The all-named-entry
  scenario now also requires four non-warning standing contacts and the stance
  adjustment note, and captures the clothed standing viewport. That screenshot
  and the independent CLI render were inspected. The earlier precise-authoring
  full-suite run also passed all 21 scenarios (12.9 minutes).
- After the body-supported placement and intersection-escape changes,
  `npm run test:browser -- tests/browser/catalog-camera.spec.js tests/browser/authoring.spec.js`
  with the same Chrome path: **8 passed**, with one cold-start readiness timeout
  while CPU-heavy validators were running concurrently. The timed-out authoring
  scenario then passed in isolation (1.1 minutes) with the same 30-second
  readiness limit and no application changes: **9 distinct targeted scenarios
  passed**, including every named definition, authoring/export/history,
  refined-preview retention and trusted touch. The timeout is retained here,
  not counted as a successful complete-suite run.
- After the lap-region ownership correction, the production-build browser
  scenario `every existing named definition loads and renders` passed again
  (2.3 minutes), loading all twelve entries and checking discoverable quality
  notes with no normal-path page/console/request errors.
- The precise-joint authoring browser scenario passed (2.2 minutes), including
  stale-readout clearing, actual solved-angle checks, undo/redo, fixed/guided
  transitions, save/reload/export and a 320 px Axe audit. An initial missing
  accessible label was caught by the new test and corrected before this pass.
- `node scripts/validate-surface-contacts.mjs`: **7/7 passed**; each fixture
  requires a final gap at most 4 mm and clear affected limbs. Raw coarse-model
  overlap and verified contact counts are printed separately.
- `node scripts/validate-scenes.mjs`, compared with commit `969f4f8`: both report
  **127/159 sound**, the same **32 flagged cases**, and **63 mm worst penetration**.
  Reported unmet targets drop from 95 to 93 (blocked/unreachable targets are
  tracked separately). This is a base-solver regression comparison, not a passing
  all-scenes gate.
- A direct comparison with `c82a3e1` again reports **127/159 sound**, the same
  **32 flagged cases** and **63 mm worst penetration**. Unmet targets now count
  **94 rather than 93** because distant measurements remain present. Neither
  result is an all-scenes pass; the missing-target correction is not a tolerance
  change or a claim that those layouts are solved.
- The supported-placement comparison covers three primary postures (`seated`,
  `seated_reclined`, `reclined`), two secondary postures (`seated_straddle`,
  `kneeling_straddle`), four surfaces (floor/chair/bench/sofa), and all four
  male/female body-type pairings. It compares overlap, support gap and unresolved
  targets with the parent commit, not just the intended chair fixture.
- `node scripts/validate-named-presets.mjs`: **5/12 without base-model flags;
  7 require review**. `node scripts/validate-named-presets.mjs --rendered`:
  **3/12 without rendered-contact flags; 9 require review**. Both full audits
  ran again after the final side-lying cuddle data was integrated. A rendered
  rerun that ended with signal termination (exit 143) was discarded; the
  subsequent standalone run completed all twelve entries and produced this
  count. These audit commands still exit 1 for the remaining flagged entries.
  It uses the same dressed-template construction and refinement as the viewport,
  and prints base targets, surface gaps and intersection flags separately.
- After the lap-region correction, individual rendered audits for
  `builtin.named.chair_straddle` and `builtin.named.lotus` both still returned
  nonzero. Their lap-region gaps are approximately 108 mm and 24 mm respectively;
  the chair case's hand contacts remain clear at approximately 2 mm.
- At the preceding hand-only iteration, the individual rendered audit for
  `builtin.named.standing_embrace` exited 1: the two hand gaps were
  approximately 2.2 mm without crossings, chest was about 1 mm, and the pelvic
  gap remained about 10 mm. In the new whole-body iteration it exits 0, with
  all four gaps within the 4 mm threshold, no figure crossing and no unavailable
  check. A new clothed 640×640 CLI render was inspected.
- `git diff --check`: **passed**.

The browser runner uses installed Chrome and software WebGL (SwiftShader).
Mobile viewport sizes are emulated, not physical-device testing. Screenshots
and downloaded test files are generated under ignored `test-results/`; they
are not shipped as application assets. No external font or image service is
required by the new interface.

## Boundaries

The existing solver still reports unresolved arbitrary combinations. This
iteration does not make all combinations physically accurate, replace the
licensed face meshes, or introduce cloth simulation. The neutral body still
uses an existing scan. Garments are fitted surface layers. Model-download and
WebGL failures are exercised separately from normal rendering.

Contact readouts now distinguish visible-region gaps from estimated body-model
targets. See [surface-contacts.md](surface-contacts.md) for the algorithm, measured
before/after cases and retained diagnostics. The 4 mm threshold describes close
surface proximity, not a physical simulation or a guarantee about every part of
an arbitrary scene. Unsupported or conflicting constraints remain reportable.

Saved presets and favorites are browser-local. JSON is the backup and transfer
mechanism; there is no cloud account or cross-device synchronization. Free
camera orbit/zoom are temporary; named views are saved. Scene history lasts
for the current tab session and does not reverse library deletion.

No public hosting deployment was requested or performed. Repository delivery
and the production build are distinct from a hosted deployment.

## Completed scope and diagnostic history

The current complete rendered catalog audit passes all 23 entries, including
all twelve named layouts and eleven reference studies, with complete available
support/contact and figure/furniture/floor checks at the existing thresholds.
The final requirement-by-requirement figure/UI/catalog audit and complete browser
inventory are now verified in the completion audit. The broader uncalibrated
diagnostics and hardware-dependent cold-rendering latency remain explicit limits;
they are not silently counted as resolved scenes or instantaneous edits.

The seated female/male gaps of 78/108 mm are now corrected to approximately 2 mm.
The low-kneel gap of 27 mm is now approximately 1 mm; the paired-kneel maximum
of 23 mm is now approximately 2 mm, with foot frames and contacted hands retained.
The floor-rest study's approximately 100 mm support gap is now approximately
2 mm, and its previously unclaimed 24 mm hand/floor crossing is cleared. Its
undeclared elevated feet retain their lower-body pose. The separate sofa phase
now closes its former 98 mm seat gap to below 4 mm and clears the backrest while
retaining foot frames. Its raw coarse prop/balance estimates remain separately
reported. The older comparisons below retain their original measurement scope.

Catalog integration, solved-pair diagrams and touch zoom are implemented and
verified. The inherited named-preset target, overlap and support gaps have now
been resolved for their stock layouts. The history below records why earlier
partial contact measurements were not sufficient evidence.
The calibrated chair-supported layout now has approximately 2 mm seat/foot
supports and 2–3 mm partner contacts, with no complete-figure crossing. Its
independent bench variant also clears the furniture. The earlier automatic
layout no longer started above the supporting figure's head and had a 3.4 mm
base support target, but its corrected rendered-region query still measured a
107.5 mm lap gap after the two hand/arm intersections were cleared. Clothed
640×640 renders before and after hand refinement were inspected in the placement
iteration. The later triangle trace found why the broader 15 mm diagnostic was
misleading: its source was a mid-thigh/shorts-edge triangle admitted by only
3–4% pelvis skin weight. It was not a pelvic support point. Lap target ownership
now includes the adjacent thigh bones within the original radius; the source
pelvis and the regional weight threshold are unchanged. This changes the
measurement from 200 mm to 107.5 mm, not the pose itself. The later calibration
changes the actual pose while retaining that same regional definition.

In the placement iteration, only the chair case changed its base joint pose
among the twelve named entries; the later lap-region correction does not move
the figures.
The placement iteration reduced its then-measured lap-region gap from about
790 mm to 200 mm and its hand gaps from about 256 mm to under 4 mm. The new
rendered audit expands coverage; it does not imply twelve newly broken presets.

The floor-seated embrace now retains all five contacts within approximately
1.8–2.5 mm, with primary seat/foot supports within approximately 1.8–2.0 mm.
Its original 127 mm support gap and four intersecting hand contacts are resolved
by the calibrated pose, not by changing support ownership or contact regions.
The floor and bed guided defaults both pass coarse and rendered validation.

The standing carry now has five approximately 2.4–3.7 mm contacts, two measured
2.0–3.0 mm foot supports and complete figure clearance. Its fixed floor/bed
layouts pass both representations while preserving the original support direction.

The table-supported pair now keeps the original four primary supports and two
partner foot supports at approximately 1.8–2.0 mm, with three approximately
1.5–2.5 mm partner contacts. Both figures and the complete table remain clear.
Its fixed primary and guided partner pass both the coarse and rendered gates.

The hands-and-knees pair now retains palm-down braced hands, all six declared
supports at approximately 2 mm and all three contacts at approximately 2.5 mm.
Both figures use validated guided starting poses on floor and bed. The coarse
default and rendered final checks pass independently; the final raw coarse
knee discrepancy remains visible as diagnostic data. Complete figure, mattress
and floor checks pass, and captured poses replay without guided adoption.

The face-to-face reclining pair now has a guided supine primary and fixed
forearm-supported partner, retaining the original single contact and support
ownership. Both floor/bed defaults pass the coarse and rendered gates, and the
complete figures clear the unchanged finite mattress. Three primary supports
measure 0.7–2.0 mm, the body contact approximately 2.5 mm, and independent queries
also verify the partner's grounded knees and level forearms. Missing models
cannot certify the layout; fixed capture retains the complete geometry.

The forward and reversed seated-over-reclining pair now retain their original
roles, facing and three contacts while adding two explicit hand-to-knee supports.
Both independent guided recipes pass the coarse and rendered gates on bed/floor;
their five gaps are within 4 mm, supporting palms point upward, and the partner's
feet stay near the plane. The new support-ownership handling does not change any
of the existing 159 corpus poses or quality reports.

The current named audit reports no base-model flags for spooning, lotus, chair
straddle, lying-facing, standing embrace, standing carry, the table pair,
hands-and-knees pair, face-to-face reclining pair, cowgirl, reverse cowgirl or
head-to-toe. All twelve also pass the dressed-mesh and whole-figure audit.
The head-to-toe definition now retains its original two contacts at approximately
3.0/2.8 mm, primary supports at 0.9–3.6 mm, and all hands/feet at 2.4–3.0 mm on
the finite floor/bed plane. A 450 mm shared translation prevents clipped-edge
foot measurements from standing in for actual mattress support. Both guided
defaults pass; the final raw primary coarse residual remains 26.6 mm, and fixed
capture preserves the geometry. The partner keeps its original null surface
residual; its former 489 mm report was a stale clamp displacement, not a
measured partner gap. Unlike that earlier reporting correction, the new recipe
changes the pose and passes the complete checks. This is not a claim that every
arbitrary combination of poses, builds and surfaces is satisfiable.

### Historical calibration findings

The following findings describe earlier stages and rejected trials; they do
not replace the current 23/23 rendered catalog result above.

Side-lying calibration trials exposed both reporting defects. Mirroring defaults
alone moved the figures farther apart, and arm/leg variants that looked better
to the body model still had rendered crossings or support mismatches. In-memory
ground-recovery changes produced mixed named-preset results. None of these pose
or grounding experiments was substituted into the catalog or solver.

A diagnostic that restricted all base-model pelvic contacts to the pelvis bone
was not retained: it displaced one inherited layout by over a metre and worsened
other support gaps. Base contact-region refinement needs pose-level regression
checks, not a global replacement of the current neighborhood rule.

Later seated-support trials showed why precise authoring was needed: guided IK
could turn a requested 65-degree hip abduction into approximately 38 degrees.
Fixed mode now makes such trial poses reproducible. Some fixed-angle trials
brought the measured support gap below 2 mm, but still had other visible
intersections or unmet hand contacts. None was substituted into the bundled
catalog, and no collision/contact threshold was relaxed. At that stage,
full-body clearance and reliable supported placement were still unfinished.

The standing-pair experiment is now integrated behind support, authoring and
complete figure-clearance checks. In the stock case, a 6.7 mm root movement plus
a small stance/torso correction clears the pre-existing toe crossing and brings
all four contact gaps within 4 mm. It does not change any bundled preset data.
The final figure audit also reports crossings outside declared contact regions
elsewhere; local close contacts no longer imply whole-figure clearance.

A six-case comparison isolates the body stage after free-arm refinement. No
individual or aggregate collision violation worsened, and no new figure crossing
was introduced. The non-stock variants still require calibration:

| Standing pair | Unmet contacts before body stage | After | Body correction accepted |
| --- | ---: | ---: | --- |
| Stock female/male | 1 | 0 | Yes |
| Reversed body types | 4 | 4 | No |
| Female pair | 2 | 2 | No |
| Male pair | 3 | 3 | No |
| Heights 1.55 / 1.90 m | 2 | 2 | No |
| Builds 0.9 / 1.1 | 3 | 3 | No |

The height-varied case also retains an unsupported balance estimate; the body
stage does not hide or fix that finding. This is one verified stock-preset
improvement and broader diagnostics, not a claim that arbitrary body variants
or every named preset are now solved.

Fixed placement and atomic pose capture now make calibrated layouts reproducible
as scene data rather than relying on another automatic placement pass. See
[placement.md](placement.md) for editing, capture, reset and interchange details.
No built-in pose definition changed in that authoring iteration; eleven rendered
named layouts still required calibration and verification at that point.

The subsequent lying-facing calibration now supplies fixed placement and full
joint channels through a shared stock recipe. Its original postures, facing,
contacts, tolerances and anatomical regions are unchanged. The two rendered
contact gaps round to 3 mm and 2 mm, with no figure crossing or unavailable check.
Its then-reported coarse support residuals round to 10 mm and 8 mm; these are within the 20 mm gate,
not zero. Real bed and floor mesh tests verify both support planes, and no
refinement step changes the fixed rig. Alias parity, recipe purity, appearance
preservation, explicit camera precedence, portable round trips and variation
fallback are covered. Ten rendered named layouts still required calibration at
that point; compatible stock data is not a solution for arbitrary body variants.

The original same-direction side-lying cuddle calibration used the same data path.
Its three original contact constraints and all aliases were preserved. That
iteration's bed/floor regressions measured torso gaps of approximately 1.70 mm and 1.74 mm,
and an open-hand gap of 1.52 mm, with clear complete figures and zero reported
rendered-reconciled body/self/prop overlap. Its coarse support residuals were approximately
9.7 mm and 18.8 mm; lowest dressed surfaces are approximately 2.45 mm and 1.38 mm
above the plane. Both balance estimates are supported. The pose is fixed and
unchanged by refinement, including its captured upper-arm angles and open hand.

The first surface-clear candidate was not accepted as final: its base model
reported a 27 mm lower-thigh overlap and a 64 mm hand-target residual. Reducing
the hip bend, opening the upper hand and adjusting its shoulder/wrist channels
bring that base overlap estimate to 16 mm (within the existing 22 mm gate) and
the hand target to 54 mm (within the existing base target tolerance). The final
drawn surfaces remain clear. Both calibrated recipes now have a base-model
regression assertion as well as their stricter rendered-contact checks. No
contact, anatomical region or tolerance changed to obtain either result.
At that calibration milestone, nine rendered named layouts remained unresolved.

The following seated calibration exposed a measurement blind spot. A diagnostic
trial closed its three partner contacts and cleared the figures, but the drawn
seated region remained about 93 mm above the chair despite a near-zero coarse
support residual. It was not added to the catalog. The new regional rendered
support measurement reports approximately 107 mm for the unchanged stock chair
case and preserves its body-model estimate separately. Coarse pelvic components
had been counted as seat supports even when they did not represent the visible
clothed seat contact. Actual seat and foot calibration remains unfinished.

The stronger support check also exposed a roughly 22 mm shoulder gap in the
lying-facing recipe and a roughly 37 mm hip/thigh gap in the cuddle recipe.
The fixed poses were adjusted without changing thresholds: the lying-facing
lower shoulder was lowered, and the cuddle's second figure was tilted/lowered,
its lower arm adjusted and its upper hand recaptured. Both bed/floor recipes
again pass their base and rendered gates, including every declared support,
full-figure clearance, unchanged refinement and the original minimum-surface
checks. This is a measured support correction, not a claim that all catalog
furniture contact or arbitrary body variations are solved.

The corrected lying-facing contacts remain approximately 2.6 mm and 2.4 mm;
its maximum drawn support gaps are approximately 18 mm and 15 mm. The corrected
cuddle contacts are approximately 2.5 mm, 1.5 mm and 3.9 mm; its maximum drawn
support gaps are approximately 16 mm and 14 mm. The respective lowest dressed
surfaces remain within 4 mm of their planes, and no regional support penetration
or unavailable check is admitted by these recipe regressions.

Render-aware seated grounding now corrects the two single seated references
without changing their catalog definitions. The pelvis follows the measured seat
target and leg IK preserves the foot frames with small vertical sole corrections.
The shorter male variant initially lay beyond the chair edge; using the measured
source/target points permits a bounded move back onto the finite seat instead of
mistaking the diagonal gap for a vertical displacement. All eight tested
height/build/surface variations pass without a preset-ID special case.

The corrected stock seat/sole gaps round to 2 mm. Raw prop overlap estimates are
approximately 77 mm for the male and 68 mm for the female, retained separately;
the complete visible figure/box checks are clear and permit reconciliation of
those proxy errors. Missing geometry, interior vertices, crossed surfaces and
unverified orientation cannot grant that exception. A floating obstacle and an
attachment that would fall below the floor reject the correction, and an
already-close partner contact cannot be moved away to improve seating.
These safeguards mean the unresolved partner-supported chair layout is not
silently repositioned by the single-seated correction.

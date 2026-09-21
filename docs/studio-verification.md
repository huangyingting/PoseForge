# Studio verification — 2026-09-21

This records the current studio implementation and its limits. Bundled entries
use clothed reference figures, and the catalog preserves the existing named
definitions as data. The full goal remains open while their geometry issues
remain unresolved; loading a preset is not proof that its constraints were met.

## Evidence

| Requirement | Current evidence |
| --- | --- |
| Male and female figure presentation | Licensed meshes retained; tops/shorts, softer skin and lighting, skin-tone control, natural/clay modes, and shadow-catching ground. Desktop and mobile renders inspected. A contrasting-skin diagnostic confirmed skin was peeking through opaque garments; the corrected rendering removes those artifacts. |
| Clothing follows poses | Geometry tests skin studio outfits onto both body types in standing, seated and kneeling poses, check finite bounded vertices, retained garment meshes and covered anatomy. Opaque garments hide fully covered skin faces while retaining exposed head/lower-leg geometry and preserving the original cached template. Existing garment weight and hem tests also pass. |
| Responsive studio | Browser checks at 1440×1000, 390×844 and 320-pixel width; library, studio and inspector remain reachable. Named positions have a direct collection filter. Long text does not cause page overflow; zoom buttons stay reachable on narrow screens. |
| Keyboard and accessibility | Native dialogs, labeled inputs, keyboard camera controls, focus retained after loading cards, and visible focus. Axe WCAG 2 A/AA and 2.1 AA checks return no violations on desktop, mobile, figure inspector and save dialog. This is an automated audit, not an accessibility certification. |
| Extensible catalog | 23 entries: eleven reference studies plus all twelve existing named definitions. Original aliases, postures, facing, surfaces and contacts are preserved. All/Positions/Saved/Favorites, categories, search, CRUD, reload and import/export work. Built-ins remain immutable. |
| Previews | Off-main-thread diagrams show solved shared coordinates, relative heights, facing and props. Selected/saved poses reuse refined viewport snapshots. Stale replies, unsubscribed cards, cache eviction and preview-worker failure are covered. |
| Camera input | Trusted Chrome touch events verify pinch zoom, cancellation and return to one-pointer orbit. Zoom buttons, wheel and keyboard controls work; third-touch and near-zero-distance transitions are unit tested. Browser page-zoom modifiers are not intercepted. |
| Contact authoring | Figure/body-part pickers, strength, add/remove and visible-surface feedback exercised on desktop and mobile. Figure names survive reload and export. Removing a figure remaps surviving contacts. Custom-only mode excludes arrangement contacts from initial alignment and iterative solving; existing scenes preserve automatic behavior. |
| Visible contact accuracy | Exact triangle-region distances replace the old unlabeled target residual. Seven dressed-model fixtures finish within 4 mm, including both body orders, same-type pairs, kneeling, varied proportions and authored wrist angles. Complete affected limbs are checked for crossings. Ground heights and pinned placement are preserved, and unrelated/self/prop collisions cannot be hidden by a lower aggregate score. |
| Full scene fidelity | JSON round trips preserve figure properties, joint overrides, hand shapes, contacts and named camera view. Browser reload tests preserve edited height and joints, and the latest unsaved workspace. |
| Precise joint authoring | Optional fixed mode retains specified channels through seating, contact/collision solving, surface refinement and cancellation, while unedited channels remain free. The editor shows actual solved values and clears stale values while pending. The browser flow verifies fixed values, history, saved reload, JSON export and narrow-screen accessibility. Guided mode remains the default. |
| Safe persistence and imports | Unit tests cover invalid versions, malformed JSON, unsafe keys, unknown scene choices, invalid landmark sides, duplicate IDs, quota errors and corrupt storage. A failed import does not partially add a pack. Re-importing creates fresh IDs. Browser recovery and invalid-import flows pass. |
| Preset geometry | All 23 entries validate structurally and render. The original eleven reference-study geometry checks still pass. The named-position audit flags 9/12 at the base-model level and 12/12 in the dressed-mesh contact audit. These receive pose notes rather than a claim of physical correctness. |
| Body-supported placement | Adaptive clearance reduces the seated-pair base support target from 523.7 mm to 3.4 mm. Chair cases pass across all four male/female pairings; bench and stature/build variations have measured support-plane regression tests. A 96-case comparison against `969f4f8` has 12 newly clean cases, no newly flagged cases and 78 unchanged results. Dressed contact failures remain separately reported. |
| Surface-intersection escape | Bidirectional bounded IK trials clear both hand/arm intersections in the seated-support fixture, ending at approximately 2.3 mm and 1.8 mm. The supporting figure, both roots and lower-body joints stay unchanged; individual collision pairs and aggregate residuals cannot worsen. The lap target remains unresolved. |
| Hand-to-body geometry | Coordinated free-arm reaches clear both standing-embrace hand/arm intersections at approximately 2.2 mm. The complete arms are checked against the entire target figure, including colored auxiliary meshes. Regression tests cover distant crossings, both contact directions, explicit angles, fixed channels, bounded work and cancellation. Roots, lower-body joints and the target figure remain unchanged; the separate body gap is still flagged. |
| Anatomical region selection | Lap queries now include declared thigh-owned surfaces while retaining the original radius and regional weight threshold. Synthetic patches verify both sides, pose/stature/heading changes and exclusion of distant knee surfaces, unrelated bones and small weight tails. The seated lap gap is now measured at 107.5 mm, not reported as fixed. |
| Description feedback | Unread text warnings survive worker rendering and draft reload. Catalog captions no longer overwrite the original text command. Pending poses do not retain stale quality notes. |
| Exports | Real PNG, transparent PNG, SVG and JSON downloaded. PNG pixels decoded: opaque image content present; background corner alpha is 255 for standard PNG and 0 for transparent PNG. JSON is re-importable. |
| Runtime | Every new preset rendered in a production build without page errors, console errors or failed requests in the normal-path browser test. Missing WebGL leaves the editor usable. An intentionally failed model download produces an estimated contact, and its warning does not leak into a healthy model. Rapid preset changes publish only the final scene; cancellation restores discarded rigs. |
| CLI interoperability | The CLI renders built-in IDs and exported catalog files using the same surface-refinement pass. Clothed examples rendered successfully at 640×480 and 320×480. Lighting/framing remain separate implementations. |

## Commands and results

- `npm test`: **179 passed**, including the original parser, geometry and
  architecture tests, catalog/storage tests, contact-authoring tests, clothing
  checks, triangle/surface-refinement checks and per-preset CLI selection,
  quality-dependent exit status and invalid/empty input.
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
  history, save/reload, export and narrow-screen accessibility. The complete
  21-scenario result below belongs to the preceding precise-authoring iteration;
  this latest run is the targeted three-scenario gate, not a new full-suite run.
- `npm run build`: **passed**; also rebuilt by the browser test configuration.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:browser`:
  **21 passed** in the complete production-build run after precise-joint
  authoring was added (12.9 minutes).
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
- The supported-placement comparison covers three primary postures (`seated`,
  `seated_reclined`, `reclined`), two secondary postures (`seated_straddle`,
  `kneeling_straddle`), four surfaces (floor/chair/bench/sofa), and all four
  male/female body-type pairings. It compares overlap, support gap and unresolved
  targets with the parent commit, not just the intended chair fixture.
- `node scripts/validate-named-presets.mjs`: **3/12 without base-model flags;
  9 require review**. `node scripts/validate-named-presets.mjs --rendered`:
  **0/12 without rendered-contact flags; 12 require review**. The complete
  rendered audit ran again after the hand-to-body and query-performance changes.
  It uses the same dressed-template construction and refinement as the viewport,
  and prints base targets, surface gaps and intersection flags separately.
- After the lap-region correction, individual rendered audits for
  `builtin.named.chair_straddle` and `builtin.named.lotus` both correctly remain
  nonzero. Their lap-region gaps are approximately 108 mm and 24 mm respectively;
  the chair case's hand contacts remain clear at approximately 2 mm.
- After coordinated hand-to-body refinement, the individual rendered audit for
  `builtin.named.standing_embrace` still exits 1 honestly: the two hand gaps are
  approximately 2.2 mm without crossings, chest is about 1 mm, and the pelvic
  gap remains about 10 mm. A clothed 640×640 CLI render was inspected.
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

## Remaining goal audit

Catalog integration, solved-pair diagrams and touch zoom are now implemented and
verified. Named-preset geometry remains the main unfinished requirement. The
inherited flags include unreachable contact targets, overlap and support gaps.
The chair-supported layout no longer starts above the supporting figure's head.
Its base support target is 3.4 mm away. The two hand/arm intersections initially
created by bringing the figures together are now cleared by surface refinement,
but the corrected rendered-region query still reports a 107.5 mm lap gap. Clothed
640×640 renders before and after hand refinement were inspected in the placement
iteration. The later triangle trace found why the broader 15 mm diagnostic was
misleading: its source was a mid-thigh/shorts-edge triangle admitted by only
3–4% pelvis skin weight. It was not a pelvic support point. Lap target ownership
now includes the adjacent thigh bones within the original radius; the source
pelvis and the regional weight threshold are unchanged. This changes the
measurement from 200 mm to 107.5 mm, not the pose itself.

In the placement iteration, only the chair case changed its base joint pose
among the twelve named entries; the later lap-region correction does not move
the figures.
The placement iteration reduced its then-measured lap-region gap from about
790 mm to 200 mm and its hand gaps from about 256 mm to under 4 mm. The new
rendered audit expands coverage; it does not imply twelve newly broken presets.

The current named audit reports no base-model flags for lotus, chair straddle
and standing embrace; all twelve definitions remain flagged by the dressed-mesh
contact pass. The head-to-toe definition also retains its roughly 489 mm support
gap. Next work needs both accurate anatomical regions and collision-safe contact
refinement, not only the base solver. This is not a claim that every arbitrary
combination of poses, builds and surfaces is satisfiable.

A diagnostic that restricted all base-model pelvic contacts to the pelvis bone
was not retained: it displaced one inherited layout by over a metre and worsened
other support gaps. Base contact-region refinement needs pose-level regression
checks, not a global replacement of the current neighborhood rule.

Later seated-support trials showed why precise authoring was needed: guided IK
could turn a requested 65-degree hip abduction into approximately 38 degrees.
Fixed mode now makes such trial poses reproducible. Some fixed-angle trials
brought the measured support gap below 2 mm, but still had other visible
intersections or unmet hand contacts. None was substituted into the bundled
catalog, and no collision/contact threshold was relaxed. Full-body clearance
and reliable supported placement remain unfinished work.

The later standing-hand improvement does not yet include a universal final
figure/figure triangle audit. An independent whole-figure query detects a toe
crossing after the hands are clear. A coupled root/torso/stance experiment found
candidates with all four local gaps under 3 mm and no figure/figure triangle
crossings, but that experiment has not been integrated or accepted as production
behavior. End-frame/support preservation, authored constraints, bounded search
and whole-scene regressions are still required before adopting it.

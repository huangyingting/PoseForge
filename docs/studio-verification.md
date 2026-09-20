# Studio verification — 2026-09-20

The delivered work is a non-graphic reference studio, figure-presentation
improvements, and an extensible scene catalog. It does not implement explicit
sexual imagery or simulated sexual activity. The original broader goal is not
marked complete on the strength of this narrower verification.

## Evidence

| Requirement | Current evidence |
| --- | --- |
| Male and female figure presentation | Licensed meshes retained; tops/shorts, softer skin and lighting, skin-tone control, natural/clay modes, and shadow-catching ground. Desktop and mobile renders inspected. A contrasting-skin diagnostic confirmed skin was peeking through opaque garments; the corrected rendering removes those artifacts. |
| Clothing follows poses | Geometry tests skin studio outfits onto both body types in standing, seated and kneeling poses, check finite bounded vertices, retained garment meshes and covered anatomy. Opaque garments hide fully covered skin faces while retaining exposed head/lower-leg geometry and preserving the original cached template. Existing garment weight and hem tests also pass. |
| Responsive studio | Browser checks at 1440×1000, 390×844 and 320-pixel width; library, studio and inspector remain reachable. Long unbroken names and descriptions do not cause page overflow or hide camera controls. |
| Keyboard and accessibility | Native dialogs, labeled inputs, keyboard camera controls, focus retained after loading cards, and visible focus. Axe WCAG 2 A/AA and 2.1 AA checks return no violations on desktop, mobile, figure inspector and save dialog. This is an automated audit, not an accessibility certification. |
| Extensible catalog | Eleven data-driven presets; search/category/saved/favorite filters and a blank-study entry point. Save, rename/update, duplicate, delete, reload, import and export exercised in the browser. Built-ins remain immutable. |
| Contact authoring | Figure/body-part pickers, strength, add/remove and visible-surface feedback exercised on desktop and mobile. Figure names survive reload and export. Removing a figure remaps surviving contacts. Custom-only mode excludes arrangement contacts from initial alignment and iterative solving; existing scenes preserve automatic behavior. |
| Visible contact accuracy | Exact triangle-region distances replace the old unlabeled target residual. Seven dressed-model fixtures finish within 4 mm, including both body orders, same-type pairs, kneeling, varied proportions and authored wrist angles. Complete affected limbs are checked for crossings. Ground heights and pinned placement are preserved, and unrelated/self/prop collisions cannot be hidden by a lower aggregate score. |
| Full scene fidelity | JSON round trips preserve figure properties, joint overrides, hand shapes, contacts and named camera view. Browser reload tests preserve edited height and joints, and the latest unsaved workspace. |
| Safe persistence and imports | Unit tests cover invalid versions, malformed JSON, unsafe keys, unknown scene choices, invalid landmark sides, duplicate IDs, quota errors and corrupt storage. A failed import does not partially add a pack. Re-importing creates fresh IDs. Browser recovery and invalid-import flows pass. |
| Built-in geometry | All eleven presets validate and render. The base-model fixture check has zero inter-actor residual depth and unresolved partner contacts, with a largest support gap of approximately 2.2 mm. Helping-hand refinement reduces its actual triangle-region gap from 16.7 mm to 3.7 mm; the former 2 mm value was a different body-model target error. |
| Exports | Real PNG, transparent PNG, SVG and JSON downloaded. PNG pixels decoded: opaque image content present; background corner alpha is 255 for standard PNG and 0 for transparent PNG. JSON is re-importable. |
| Runtime | Every new preset rendered in a production build without page errors, console errors or failed requests in the normal-path browser test. Missing WebGL leaves the editor usable. An intentionally failed model download produces an estimated contact, and its warning does not leak into a healthy model. Rapid preset changes publish only the final scene; cancellation restores discarded rigs. |
| CLI interoperability | The CLI renders built-in IDs and exported catalog files using the same surface-refinement pass. Clothed examples rendered successfully at 640×480 and 320×480. Lighting/framing remain separate implementations. |

## Commands and results

- `npm test`: **146 passed**, including the original parser, geometry and
  architecture tests, catalog/storage tests, contact-authoring tests, clothing
  checks and triangle/surface-refinement checks.
- `npm run build`: **passed**; also rebuilt by the browser test configuration.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:browser`:
  **14 passed** in the complete production-build run (7.1 minutes).
- After the final connected-limb intersection/caching refinement,
  `node --test tests/surfaceContacts.test.js tests/meshDistance.test.js`:
  **15 passed**; `npm run test:browser -- tests/browser/authoring.spec.js`
  with the same Chrome path: **5 passed** in a fresh production build.
- `node scripts/validate-surface-contacts.mjs`: **7/7 passed**; each fixture
  requires a final gap at most 4 mm and clear affected limbs. Raw coarse-model
  overlap and verified contact counts are printed separately.
- `node scripts/validate-scenes.mjs --all`, compared with commit `8d79937` in
  an isolated checkout: both report **127/159 sound**, **32 flagged**, and
  **63 mm worst penetration**. Every case retains its penetration/count/flag
  measurements. Corrected final-pose target reporting changes four cases (three
  added misses, one removed), for 95 reported misses versus 93 previously.
  This is a base-solver regression comparison, not a passing all-scenes gate.
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

The interface catalog currently contains eleven reference studies, while the
existing parser has twelve separate named archetype definitions. Their catalog
integration and preset-by-preset verification remain to be audited. Current card
diagrams show authored joint intent before contact solving; representing the
solved pair arrangement would make those previews more informative. Mobile
camera zoom also needs a touch-specific interaction audit; the current viewport
handles single-pointer orbit, wheel zoom and keyboard zoom.

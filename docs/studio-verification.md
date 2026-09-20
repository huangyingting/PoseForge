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
| Contact authoring | Figure/body-part pickers, strength, add/remove and solver target feedback exercised on desktop and mobile. Figure names survive reload and export. Removing a figure remaps surviving contacts. Custom-only mode excludes arrangement contacts from initial alignment and iterative solving; existing scenes preserve automatic behavior. |
| Full scene fidelity | JSON round trips preserve figure properties, joint overrides, hand shapes, contacts and named camera view. Browser reload tests preserve edited height and joints, and the latest unsaved workspace. |
| Safe persistence and imports | Unit tests cover invalid versions, malformed JSON, unsafe keys, unknown scene choices, invalid landmark sides, duplicate IDs, quota errors and corrupt storage. A failed import does not partially add a pack. Re-importing creates fresh IDs. Browser recovery and invalid-import flows pass. |
| Built-in geometry | All eleven presets validated and solved. Measured inter-actor residual depth: 0; unresolved partner contacts: 0; largest support gap: approximately 2.2 mm. The new helping-hand study has a 2.04 mm solver target error. This covers authored defaults and solver geometry, not exact contact between scanned surfaces. |
| Exports | Real PNG, transparent PNG, SVG and JSON downloaded. PNG pixels decoded: opaque image content present; background corner alpha is 255 for standard PNG and 0 for transparent PNG. JSON is re-importable. |
| Runtime | Every new preset rendered in a production build without page errors, console errors or failed requests in the normal-path browser test. Missing WebGL leaves the editor and library usable; that recovery path is exercised separately. |

## Commands and results

- `npm test`: **131 passed**, including the original parser, geometry and
  architecture tests, catalog/storage tests, contact-authoring tests and clothing checks.
- `npm run build`: **passed**; also rebuilt by the browser test configuration.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:browser`:
  **12 passed** in the complete production-build run (5.7 minutes).
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
uses an existing scan. Garments are fitted surface layers. The inherited
model-download fallback was not separately failure-injected in this run.

Contact readouts measure the solver's requested target point. They do not measure
the gap between rendered mesh triangles. A separate headless check of the
helping-hand study found approximately 18.8 mm between the nearest sampled
hand and forearm skin vertices, despite a 2.04 mm solver target error. Vertex
sampling is not an exact triangle-distance measurement. This remains an accuracy
follow-up: investigate the contact solver's palm offset and its collision-proxy
surface before claiming exact visible touch. Relevant code is `solveContactIK`
in `src/core/solver.js` and the retargeted surface in `src/core/humanMesh.js`.

Saved presets and favorites are browser-local. JSON is the backup and transfer
mechanism; there is no cloud account or cross-device synchronization. Free
camera orbit/zoom are temporary; named views are saved. Scene history lasts
for the current tab session and does not reverse library deletion.

No public hosting deployment was requested or performed. Repository delivery
and the production build are distinct from a hosted deployment.

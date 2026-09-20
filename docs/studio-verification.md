# Studio verification — 2026-09-20

The delivered work is a non-graphic reference studio, figure-presentation
improvements, and an extensible scene catalog. It does not implement explicit
sexual imagery or simulated sexual activity. The original broader goal is not
marked complete on the strength of this narrower verification.

## Evidence

| Requirement | Current evidence |
| --- | --- |
| Male and female figure presentation | Licensed meshes retained; new tops/shorts, softer skin and lighting, skin-tone control, natural/clay modes, and shadow-catching ground. Desktop and mobile renders inspected. |
| Clothing follows poses | Geometry tests skin studio outfits onto both body types in standing, seated and kneeling poses, check finite bounded vertices, retained garment meshes and covered anatomy. Existing garment weight and hem tests also pass. |
| Responsive studio | Browser checks at 1440×1000, 390×844 and 320-pixel width; library, studio and inspector remain reachable. Long unbroken names and descriptions do not cause page overflow or hide camera controls. |
| Keyboard and accessibility | Native dialogs, labeled inputs, keyboard camera controls, focus retained after loading cards, and visible focus. Axe WCAG 2 A/AA and 2.1 AA checks return no violations on desktop, mobile, figure inspector and save dialog. This is an automated audit, not an accessibility certification. |
| Extensible catalog | Ten data-driven presets; search/category/saved/favorite filters. Save, rename/update, duplicate, delete, reload, import and export exercised in the browser. Built-ins remain immutable. |
| Full scene fidelity | JSON round trips preserve figure properties, joint overrides, hand shapes, contacts and named camera view. Browser reload tests preserve edited height and joints, and the latest unsaved workspace. |
| Safe persistence and imports | Unit tests cover invalid versions, malformed JSON, unsafe keys, unknown scene choices, duplicate IDs, quota errors and corrupt storage. A failed import does not partially add a pack. Re-importing creates fresh IDs. Browser recovery and invalid-import flows pass. |
| Built-in geometry | All ten presets validated and solved. Measured inter-actor residual depth: 0; unresolved partner contacts: 0; largest support gap: approximately 2.2 mm. This covers their authored defaults only. |
| Exports | Real PNG, transparent PNG, SVG and JSON downloaded. PNG pixels decoded: opaque image content present; background corner alpha is 255 for standard PNG and 0 for transparent PNG. JSON is re-importable. |
| Runtime | Every new preset rendered in a production build without page errors, console errors or failed requests in the normal-path browser test. Missing WebGL leaves the editor and library usable; that recovery path is exercised separately. |

## Commands and results

- `npm test`: **125 passed**, including the original parser, geometry and
  architecture tests, catalog/storage tests and new clothing checks.
- `npm run build`: **passed**; also rebuilt by the browser test configuration.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:browser`:
  **8 passed** in the full production-build run.
- After the final focus and long-metadata layout changes,
  `npm run test:browser -- --grep 'long metadata|accessibility' --output=test-results/final-checks`
  with the same Chrome path: **2 passed**. This adds one new scenario and
  repeats accessibility, for **9 distinct passing browser scenarios**.
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

Saved presets and favorites are browser-local. JSON is the backup and transfer
mechanism; there is no cloud account or cross-device synchronization. Free
camera orbit/zoom are temporary; named views are saved. Scene history lasts
for the current tab session and does not reverse library deletion.

No public hosting deployment was requested or performed. Repository delivery
and the production build are distinct from a hosted deployment.

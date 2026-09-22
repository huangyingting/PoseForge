# Compact studio UI verification

This report records the compact-layout milestone. The later
[3D reference iteration](reference-3d-verification.md) adds selectable approximate
posture previews to the reference cards and repeats relevant UI regressions.

**Final results:** 42/42 relevant unit tests and 36/36 browser scenarios passed.
Production builds, formatting, whitespace and dependency checks passed, with
zero reported dependency vulnerabilities. The 30-case regression batch and final
six-case focused batch have no failed, skipped or flaky cases.

The [machine-readable ledger](audit-compact-ui/results.json) records every
browser scenario, exact measurements, environment, source hashes and limits.
Inspected screenshots show the [desktop workspace](audit-compact-ui/desktop.png),
[mobile library](audit-compact-ui/mobile-library.png),
[narrow library](audit-compact-ui/narrow-library.png),
[mobile studio](audit-compact-ui/mobile-studio.png),
[mobile editor](audit-compact-ui/mobile-editor.png), and
[desktop focus view](audit-compact-ui/focus-view.png).

## Changes

- A 56-pixel app toolbar, smaller scene heading and tighter camera controls
  return space to the canvas. Desktop Focus hides both sidebars without editing
  scene data; Escape restores them. Focus is cleared at the mobile breakpoint.
- Library presets and references use compact horizontal rows. Search, all five
  collections and entry quality labels stay visible. Filters opens the less-used
  controls; active filters remain counted while closed, and Reset clears them.
- The search clear control preserves focus. `/` reveals/focuses search outside
  inputs and dialogs and exits desktop focus mode. Typing is not intercepted.
- Catalog counts and local-storage explanation move into a keyboard-accessible
  library information dialog. Import/export and paging remain directly available.
- Inspector tabs stay visible while scrolling. Spacing and description chrome
  are reduced; Contact help holds explanatory prose, not controls or warnings.
- The one-panel mobile workspace now applies through 900 pixels, with a bottom
  navigation bar, safe-area support and scrollable short-height layouts.

## Measured space improvement

The before/after checks use the same stock standing study and source-reference
collection. Counts mean complete cards visible inside the scrollable list, not
the total DOM count. The card bound remains 24 per page.

| Viewport | Reference list height before → after | Complete reference cards before → after |
| --- | --- | --- |
| 1440 × 844 | 182.5 → 576 px | 2 → 7 |
| 1024 × 768 | 112.5 → 465 px | 0 → 5 |
| 390 × 844 | 209 → 496 px | 2 → 6 |
| 320 × 700 | 34 → 352 px | 0 → 4 |

At 1440 × 844 the normal desktop canvas grows from 812 × 515.3125 pixels to
862 × 640.703125 pixels: approximately **32% more canvas area**, before activating
Focus. The compact library's default control area falls from 455 to 132 pixels
at that desktop size and from 415.5 to 152 pixels at 320 × 700.

The intermediate 768 × 1024 tablet view exposes eight complete reference rows.
At 844 × 390, the library and stage scroll internally so filters, pagination
and camera controls remain reachable rather than extending behind navigation.

## Verification inventory

The gate inventory and sanitized test results are recorded in the ledger above.

- New browser coverage checks measured density, filter disclosure/count/reset,
  search clear and focus restoration, `/`, Escape and dialog boundaries, no
  scene solve caused by Focus, breakpoint transitions and short landscape views.
- Automated accessibility checks cover desktop, mobile, the open filter panel,
  library information dialog and figure editor. Enlarged 16-pixel control text
  and reduced-motion mode retain reachable controls without horizontal overflow.
- Existing browser flows verify saved edits/history, source associations, all
  source-reference pages/families, named presets and previews, contact authoring,
  camera/pinch, real PNG/SVG/JSON exports and failure recovery.
- Relevant unit coverage includes architecture, camera input, catalog validation,
  source index, persistent library and preview queue/caching.
- The focused checks caught a decorative arrow leaking into the Filters
  accessible name. Its explicit accessible label now matches its visible action
  and active count; the corrected focused run passes without retries.
- A final keyboard probe found a focused field could sit behind the sticky tabs
  when advanced groups were open. Inspector scroll padding now brings focused
  fields below the header; the added browser case verifies desktop and both
  mobile widths. All six compact UI cases were repeated after that fix.

## Boundaries

This iteration changes presentation and layout controls, not the catalog,
storage contract, model assets, renderer or solver. The 1,283 reference records
are still metadata, not new verified 3D reconstructions. The earlier geometry
and storage audits remain historical evidence; this is not a new full geometry
audit or a physical-device/assistive-technology certification. No new dependency,
external font, image-generation asset, cloud service or hosted deployment is added.

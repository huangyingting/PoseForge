# Compact, approachable studio UI

> **Superseded layout note:** the desktop Focus view described here was later
> replaced by a full-window canvas with remembered **Library** and **Edit**
> drawers. This plan is kept as historical evidence.

## Intent

Make browsing and editing feel like a focused workspace. Keep the current calm
green palette, existing scene behavior and all authoring/export tools. Reduce
decoration and repeated explanations rather than shrinking essential labels or
touch targets. This is a UI iteration: no new imagery, catalog data, geometry,
storage schema or solver changes.

## Layout and interaction

- Replace the tall branded header with a 56-pixel toolbar. Keep save/export and
  history prominent. Compact the scene heading and camera toolbar to enlarge
  the actual canvas, not merely its surrounding panel.
- Use a compact library title with an inline New study action. Keep search and
  all five collection buttons immediately available. Put category/family, status
  and annotation grouping in a labeled Filters disclosure, closed initially.
  Show an active-filter count and Reset filters when needed. Provide Clear search
  and a `/` shortcut outside inputs/dialogs; opening search reveals the library.
- Default to short horizontal preset rows with a small diagram, readable name,
  concise metadata, visible quality status and a separate favorite button.
  References use equally compact metadata rows, retaining their Reference only
  label and source identity. Keep the 24-card page bound and lazy preview work.
- Keep transfer actions and pagination visible in a slimmer library footer.
  Explain stock-vs-reference counts and browser storage in an accessible library
  information dialog instead of repeating long text above every collection.
- Tighten inspector spacing, use a persistent Scene/Figures tab header, and
  shorten descriptive chrome. Keep essential controls visible. Move explanatory
  contact prose into Contact help; never collapse or hide warnings/results.
- Add a desktop Focus view toggle to hide both sidebars and enlarge the canvas.
  It does not edit the scene. Escape restores the workspace; search exits focus.
  Narrow screens use the existing Library / Studio / Edit navigation, with
  comfortable touch targets and a responsive toolbar. Small-height layouts must
  scroll appropriately without stranding camera controls, filters or pagination.

## Contracts to preserve

All presets, references, source associations, favorites, paging, saved edits,
history, dialogs, downloads and camera controls continue to work. Collection
names and accessible control labels remain stable. Filters persist while hidden
and stay visibly indicated. Reset must clear all active filter state and return
to page one. Native dialogs retain focus containment and restoration. Keyboard
shortcuts must not hijack typing or an open dialog. Focus mode must not strand
hidden keyboard focus and must recover on a mobile breakpoint change.

The UI must continue to distinguish 1,283 metadata references from 23 authored
stock 3D presets. Neither denser presentation nor information disclosure may
imply additional verified poses. No external fonts or new packages are needed.

## Verification

1. Capture before/after DOM measurements and screenshots at desktop, tablet,
   390-pixel mobile and 320-pixel narrow widths. Compare usable list/canvas area
   and fully visible card counts. Test a short landscape viewport as well.
2. Browser tests cover filter disclosure/count/reset, clearing/search shortcuts,
   keyboard focus, favorites and saved presets, all reference pages, source
   details, Focus view and responsive transitions, and reachable camera tools.
3. Run Axe, check horizontal and vertical layout boundaries, and collect runtime
   errors. Check increased text/long names and reduced motion. Inspect screenshots
   as well as measured overflow; do not equate the two.
4. Run relevant existing studio/catalog/authoring browser regressions, appropriate
   unit tests, production build, formatting and whitespace checks. The underlying
   solver and storage are unchanged, so do not claim a new geometry audit.
5. Record exact verification and limitations. Commit the intended UI iteration
   to main and verify private remote synchronization; no hosting deployment.

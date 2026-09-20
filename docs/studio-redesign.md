# PoseForge studio redesign

## Product contract

Make a usable reference studio around the existing pose engine. The work has
three parts: better clothed figure presentation, a calm responsive workspace,
and a catalog that a user can extend without changing source code. New bundled
examples and visual verification use non-graphic standing, seated, and floor
studies. This work does not author explicit sexual imagery or activity.

The existing solver vocabulary stays available in the scene editor. A preset
stores a complete scene, not a sentence that may parse differently later.
Geometry limitations must remain visible; a successfully loaded preset is not
automatically a geometrically correct pose.

## Workspace

- Warm white surfaces, dark ink, a restrained teal accent, generous spacing.
- Persistent header: identity, undo/redo, save, export.
- Left library: search, category filters, built-in / saved / favorite scopes,
  compact schematic preview cards, and JSON import/export.
- Center: largest available 3D stage, scene identity, camera controls and status.
- Right inspector: Scene and Figures tabs, with advanced controls collapsed.
- Narrow screens: Library / Studio / Edit navigation, one useful region at a
  time. All actions remain reachable without horizontal page scrolling.
- Native labeled controls, visible focus, keyboard camera controls, native
  dialogs, reduced motion, truthful loading and error states.

## Preset contract, version 1

An interchange file is `{format: "poseforge.catalog", version: 1, presets: []}`.
Each entry has an `id`, `title`, `description`, `category`, `tags`, and a full
`scene`. Scene fields use the existing engine contract. Optional `camera` uses
one of the studio's named views. Stable IDs connect selection and favorites;
user IDs are generated independently of titles. Built-ins are immutable.

The data layer is dependency-free and browser-independent. Imports validate
the complete pack before mutation, reject unsupported versions, invalid scene
fields, duplicate IDs, excessive data and unsafe object keys. Unknown scene
choices are reported rather than silently converted into another pose.
Imported entries receive fresh user IDs to avoid overwriting saved work.

Users can save a new preset, update a selected saved preset, duplicate a built-in,
edit metadata, delete with confirmation, favorite, search, reload, and download
portable JSON. Storage failures keep the last persisted library intact and give
an actionable message. A versioned workspace draft restores the current scene;
an explicit URL query or preset selection takes priority over the draft.

## Figure and render work

Reuse the licensed scanned meshes and articulated hands and feet. Add a studio
outfit (top and shorts), body type and skin-tone controls, balanced neutral
lighting, and natural / clay materials. Keep appearance independent of body
type. Ensure late texture loading redraws the on-demand renderer. Preserve the
camera during refinement and figure adjustments; fit new compositions with
the viewport aspect ratio accounted for. Exports use the final visible scene.

## Acceptance evidence

1. Unit tests cover catalog validation, import atomicity, ID collisions,
   storage failure, immutable built-ins, search and round-trip scene fidelity.
2. Every new built-in scene is solved and checked for finite geometry and
   residual body intersections; issues are not hidden by the UI.
3. Existing geometry/parser/architecture tests and production build pass.
4. Browser checks exercise selection, all library filters, body type and
   appearance edits, history, save/update/duplicate/delete, reload, valid and
   invalid import, JSON/PNG/SVG export, camera, desktop and mobile layouts.
5. Screenshots are inspected for male and female figures, studio layout and
   mobile usability. Browser errors and failed resources are checked.
6. Record exact verification and remaining limits before delivery. Do not
   claim the broader explicit-content objective complete on this basis.

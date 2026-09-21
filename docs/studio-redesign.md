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

## Authoring follow-through

The first delivery exposes joint overrides, but partner contacts still require
hand-edited JSON. Add a Scene contact editor with figure and landmark pickers,
strength, add/remove actions, and the measured result of each request. A user
must be able to choose whether arrangement contacts are included. In custom-only
mode, arrangement contacts must not influence either initial alignment or the
iterative solve. Existing scenes keep their current behavior unless they opt in.

Figure names should be editable and remain stable in contact controls. Contacts
must survive preset save/update, history, import/export and reload. Removing a
figure must remove only its contacts and remap surviving references. Invalid
landmark sides must be rejected at import rather than silently ignored by the
solver. Clear feedback should distinguish a measured gap, an unreachable target,
and a target blocked by the bodies.

Add a blank-study entry point with no implicit partner contacts. Verify authoring
with ordinary clothed standing gestures. Also inspect the fitted studio garments
at close range and correct any reproducible rendering defects found; do not call
surface fitting a cloth simulation.

## Visible-contact accuracy

The solver's target residual is not a measurement between the scanned surfaces.
Add an exact triangle-distance query over the posed, visible mesh regions and a
bounded refinement pass for free limb contacts. Use the same dressed templates
as rendering. A correction moves the existing rig through IK, a free wrist, or a
small mobility-controlled step along the floor. It must not move vertices
independently of the skeleton, lift a load-bearing limb, or worsen unresolved
collisions. Keep the best accepted pose and measure the final pose again.

The coarse limb volumes can overlap while the actual limbs remain separate.
For the declared limb pair only, allow a coarse overlap to be superseded by a
check of the complete visible limbs: their triangles must not cross, and their
nearest surfaces must face outward toward each other. Keep the raw proxy
diagnostic separately. Missing geometry never authorizes an exception. Self,
furniture and unrelated-body collisions remain checked, including newly
appearing collision pairs; a lower overall maximum cannot hide a new collision.

The browser and CLI should use this shared, dependency-free pass when scanned
templates are available. Missing templates, unsupported regions, unreachable
targets and intersecting surfaces must be reported honestly. Show a rendered
surface gap when one is measured, and label a body-model target as an approximation
otherwise. Neither a small target error nor missing measurements prove visible
contact. Preserve the original target residual as a separate diagnostic.

Verify the triangle query on known geometry (including edge intersections and
degenerate triangles), then check actual male/female meshes, clothing, safe
standing gestures, body proportions, grounded limbs and missing-model behavior.
Measure before and after gaps and collision residuals. Run the existing tests
and browser authoring/export flows; inspect final renders and document remaining
accuracy limits rather than weakening the checks to fit the implementation.

## Catalog coverage, previews and touch input

The existing twelve named definitions in `src/nlp/archetypes.js` are part of
the product's vocabulary and should be discoverable in the library. Adapt those
definitions directly into versioned presets, preserving their postures, relative
facing, surfaces and contacts. Use clothed studio appearances and the existing
labels/aliases. Keep one source of truth; adding a named definition must not
require a second hand-maintained scene. Audit their geometry and expose unresolved
constraints rather than calling every load a successful physical solution.

Catalog diagrams should project one solved scene: figures share a scale and
coordinate system, so arrangement, facing, contacts and support props are visible.
Compute these joint diagrams off the main thread. Cache by scene intent, ignore
stale results and unsubscribe removed cards. Reuse the viewport's final pose for
selected/saved scenes. If preview generation is unavailable, provide a labeled
authored-pose fallback without blocking the library or viewport.

Add two-pointer pinch zoom and accessible zoom-in/out buttons. One pointer
orbits; two pointers zoom. Switching between one and two pointers, cancellation,
lost capture and a third touch must not make the camera jump. Preserve wheel and
keyboard behavior and browser page zoom outside the canvas. Verify 320/390-pixel
layouts, actual browser touch events, all camera controls, named-preset migration,
and the preview lifecycle.

## Body-supported placement

The seated-pair audit exposed a placement error before contact iteration: after
aligning a support target, vertical-only torso clearance can raise an upright
figure above the other figure's head. Lowering that final pose causes overlap;
unconditionally choosing horizontal clearance instead regresses floor studies.

For a mounted figure without ground supports, compare the existing inferred
vertical retreat with a retreat along the arrangement's horizontal approach.
Choose the shorter collision-cleared seed only when the whole-body contact
residual does not worsen, preserving explicit clearance rules and the existing
path for ground-supported figures. Keep the same torso
compression allowance and limb/collision solve; do not change quality thresholds,
hide contacts, or change the authored postures to make a result pass.

Regressions must cover chair and bench support, body-type order, varied stature,
and floor cases that already worked. Compare the broad scene sweep and named
audit against the current commit, retain the reference-study and visible-contact
gates, and inspect the resulting clothed seated composition.

When contact triangles already intersect, their normal defines an axis but not
a guaranteed escape direction for the moving limb. Try both signs, with bounded
increasing offsets, while retaining every existing collision, support, authored
joint and new-intersection check. A successful escape must finish with separated
complete limb meshes and a measured contact gap, not merely a lower overlap score.
At this stage the lap-region definition is left unchanged pending independent
validation of its anatomical coverage, described below.

## Anatomical lap-region coverage

The rendered lap region must include the pelvis and the adjacent upper-thigh
surfaces. The current mesh query reads only the landmark's primary bone, even
though the landmark contract already supports multiple surface bones for feet.
Declare the lap's thigh ownership in that same data contract and make the mesh
query honor it. Keep the existing spatial radius and regional skin-weight
threshold; do not expand the source pelvis or accept an entire limb as a region.

Verify with synthetic skinned patches on the existing rig: proximal thigh
patches are included, distant knee patches and unrelated-bone patches are not,
and tiny pelvis weights cannot turn a mid-thigh surface into pelvic contact.
Check posed/scaled rigs, unchanged source geometry, existing contact fixtures
and the actual clothed seated pair. The broad 15 mm diagnostic was a thigh-edge
contact admitted by a small pelvis-weight influence; it is not evidence that
the requested pelvic support is already close.

## Precise joint authoring

Joint controls currently supply hints that the solver may change. During seated
layout authoring, a requested hip abduction of 65 degrees was returned near 38
degrees, so saving the requested angles alone does not make that pose reproducible.
Add an explicit per-figure `jointMode`: `guided` retains today's behavior;
`fixed` preserves only the angle channels present in the scene's `joints` table.
Unspecified channels, other joints and figure placement may still adjust. All
angles remain subject to the existing range-of-motion validation.

Expose **Keep edited angles** inside the joint editor, with a clear warning that
fixed values can leave contacts or supports unresolved. Also show the selected
joint's actual solved angles from the worker, separately from the requested
sliders. Clear stale solved values while a new scene is pending. Save/import,
draft reload, previews and undo/redo must preserve the mode. Existing presets
remain guided unless their data explicitly chooses otherwise.

Enforce fixed channels at every rig refresh so seating, IK, collision correction,
surface refinement and restored snapshots cannot silently overwrite them. Test
both preserved and free channels, invalid imports, default compatibility,
rendered refinement/cancellation, and the browser editor's actual solved values.
This is authoring control, not a claim that fixed constraints always admit a
collision-free solution. The unresolved named-preset geometry gate stays open.

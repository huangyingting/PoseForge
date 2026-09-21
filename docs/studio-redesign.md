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

## Collision-aware hand-to-body contact placement

Standing-pair trials exposed a local placement trap: moving a wrist or turning
it alone cannot always free a hand whose arm approaches through the target body.
A bounded fallback should combine free forearm rotation, wrist orientation and
an IK reach toward a nearby point in the existing named torso region. Candidate
frames come from the target landmark and the moving shoulder, not preset IDs.
After a valid candidate, small corrections should retain its elbow bend plane.

For a limb-to-body contact, verify the complete limb against the complete other
figure, not only the small named patch. A coarse overlap may be superseded only
when those rendered surfaces are clear and outward-facing. Preserve raw proxy
diagnostics and retain the existing self, furniture and unrelated-pair guards.
No contact is complete until its measured gap is at most 4 mm with no crossing.

Keep the search inside the existing candidate budget and yield between trials.
Do not overwrite explicit wrist settings or forearm-twist settings; fixed
channels still apply at every refresh. Verify real dressed standing contacts,
authored constraints, cancellation, the existing gesture fixtures and browser
flows. A remaining body-to-body gap is still a failed constraint, not permission
to remove it or weaken the acceptance gate.

Performance is part of this contract. Whole-limb guards use a crossing-only
hierarchy traversal; exact nearest points and facing are computed lazily only
for real proxy overlaps that may qualify for reconciliation. A clear crossing
query does not claim a distance, facing orientation or permission to suppress a
proxy overlap. This retains the same triangle crossing test and geometry
coverage without paying for unrelated nearest-distance searches per candidate.
Whole-scope triangle sets have stable topology during posing. Refit their bounds
and vertex coordinates instead of sorting a new hierarchy for every candidate.
Return a new tree identity so query caches cannot reuse stale measurements;
rebuild if topology changes or geometry becomes unavailable. Validate against
fresh trees, including large moves and missing triangles restored later.

## Supported whole-body contact refinement

Local contact success is not whole-figure clearance. Run a final rendered
figure/figure crossing audit over every pair, independent of declared contacts.
Use every drawn triangle, including auxiliary parts without a recognized core
bone. Missing geometry is unknown, never a verified clear pair. Expose crossings
in pose notes, catalog quality labels and the command-line audit. Keep raw
body-model diagnostics; reconcile an overlap only with complete clear geometry
and outward-facing nearest surfaces. Self and furniture checks remain separate.

For upright, mobile, two-foot-supported figures on the floor, a small lower-body
gap may require a coordinated stance and torso correction. Probe bounded root
translations toward the existing lower contact, counter-rotate the lower spine
around an already-close upper contact, and preserve wrist world frames through
IK. Small outward/back steps may clear overlapping toes; ankles retain their
world height and orientation, with only a bounded root drop if reach requires it.
Derive candidates from geometry and support declarations, not a preset ID.

Accept only an improved contact score with complete, available figure clearance,
no worsened local contact, self/furniture/per-pair violation or balance, and
preserved end frames. Respect pinned placement, explicit wrist/ankle angles and
fixed channels. Use the existing candidate budget, yield between trials and
restore the entire original rig on cancellation. Retain a zero-body-trial option
for diagnostic isolation of the free-limb phase. Validate the clothed stock
standing scene, other body types/proportions, authored constraints, multi-figure
collisions, cancellation, missing geometry and browser responsiveness.

## Preserve distant contact constraints

Pose calibration exposed a solver blind spot: the body-contact distance query
used one average stature as a collision-search margin. If placement or a later
correction put a pair farther apart, a valid declared contact returned no measurement,
disappeared from scoring/reporting and could trigger a false settled state.

Contact measurement must be independent of broad-phase collision proximity.
Measure the closest declared body regions at any finite separation, keeping
the existing movement cap, overlap guards, mobility constraints and saturated
score. This lets a movable pair approach from a poor initial placement and keeps
a pinned distant pair explicitly unresolved. Verify final report/target
consistency, zero-iteration placement, scene intent and pose-level regressions
before using calibration candidates that previously lost their contacts.

## Final support readouts

The floor-clamp displacement is transient correction data, not the final gap
between every declared support and its plane. Recompute support residuals from
the returned rig for guided as well as fixed figures. Measure each support
against its own plane (for example, chair seat versus floor), retaining the
existing 2 mm numerical floor and 20 mm visible-warning threshold.

Record whether support is expected from the surface, another figure, or is not
declared. Partner-supported figures do not receive a fictitious zero or a stale
floor-gap measurement: their surface residual is null and their declared partner
contacts remain the relevant checks. Publish that distinction through the worker
and audit output without moving the pose or changing preset intent.

## Reproducible figure placement

Add optional actor `placement: { position: [x,y,z], rotation: [x,y,z] }` to the
version-1 scene format. Position is in world metres within -10..10 on each axis;
rotation is intrinsic XYZ Euler degrees within -180..180. Its presence fixes the
root transform. Absence retains the existing automatic arrangement and seating.
Validate complete vectors and reject unknown placement keys at import; malformed
interactive data receives an explicit warning instead of silently becoming a
different fixed transform.

Enforce placement on every rig refresh and assign zero root mobility while it is
active. Joint guidance remains independent. Preserve the transform through
arrangement, seating, collision/contact solving, refinement and cancellation.
Fixed roots cannot be granted collision exceptions or pretend to satisfy support
planes. Bound computational work when an entire affected limb and its root are
fixed, reporting the unresolved constraint rather than testing identical poses.

Add a collapsed Placement group per figure: Keep placement captures the final
solved root; six labelled number fields edit its position and rotation; disabling
it returns to automatic placement. Capture solved pose also stores the actual
joint channels in fixed mode, making a calibrated layout reproducible without
manually copying every joint. Capture is unavailable while a solve is pending.
Capture current layout applies the same operation to every figure atomically,
so other figures cannot move between separate per-figure capture operations.
Show actual placement separately from authored values, and preserve unedited
precision when changing one component. Existing fit-view controls remain useful
when a figure is deliberately placed outside the current camera frame.

Verify quaternion/Euler round trips, strict imports and defaults, pinned roots
and freely solving joints, truthful support/contact findings, bounded fixed-pose
refinement, cancellation, preview keys, history and scene JSON. Exercise capture,
editing, automatic reset, save/reload/export and narrow-screen accessibility in
the real browser. This is authoring capability for preset calibration, not proof
that all existing named geometry is already corrected.

## Calibrated reference layouts

Use the authoring representation itself for verified stock layouts: fixed world
placement, fixed adjustable channels, declared body dimensions, natural hand
shapes and studio clothing. Do not remove contact constraints, enlarge anatomical
regions or relax quality thresholds to qualify a layout.

The first calibrated case is the non-graphic clothed lying-facing pair. Keep its
stable preset ID, aliases, actor postures, arrangement and two body contacts. A
shared data recipe must be used by both catalog construction and literal named
text input, so loading a card and typing its name do not create different rigs.
Bed and floor differ only by a common vertical translation from the recipe's
reference plane; verify both. Prefer a top view for this low, overlapping layout
so both figures are visible, and let explicit camera choices keep precedence.

Recipes apply only to matching stock roles, dimensions, outfit coverage,
arrangement/facing and contacts. Explicit joint/limb/placement edits, changed body
dimensions/types, different coverage or unsupported surfaces use procedural
posing instead, with that choice in the interpretation trace. Never overwrite a
user's requested variation with a fixed stock transform. Saved scene data remains
self-contained and editable, without a dependency on a runtime recipe ID.

Fixed layouts need a visible Composition hint directing users to Placement in
Figures when an arrangement/facing change cannot move locked figures. CLI scene
and preset rendering should honor a saved named camera view unless `--view`
overrides it. Verify aliases, stock/parser equivalence, conditional fallback,
round trips, real clothed surfaces, rendered support-plane clearance, preview
quality and actual browser loading before promoting the calibrated data.

### Same-direction side-lying reference

Extend the calibrated-layout path to the clothed side-lying cuddle only after
verifying its original three contacts: chest to upper back, pelvis to buttocks,
and the upper hand to waist. Keep its same-direction arrangement and side-lying
postures. Author the resting arms and curled legs with fixed placement, then
capture a collision-free reaching hand if procedural refinement can provide it.
Do not discard the hand constraint or widen any target region to certify it.

Require the same full-figure, self/prop, balance, support-plane and contact gates
as the lying-facing recipe, including bed/floor translation and unchanged
refinement. Reuse the stock-layout application and variation rules; verify all
literal aliases, editable round trips, and actual clothed browser output. Treat
an experimental pose as diagnostic data until it passes those gates.

Require the base-model gate too. The first surface-clear cuddle candidate still
had a coarse lower-thigh overlap and a hand-target miss. A smaller hip bend and
an open upper hand with adjusted shoulder/wrist channels resolve those without
changing target definitions or thresholds. Keep this base check in every
calibrated bed/floor regression so a future visually clear pose does not silently
degrade the fallback representation.

### Seated partner-support reference

Calibrate the clothed chair-supported pair with its original seated/astride
postures and three contact constraints intact. Start from measured fixed rigs;
check the supported pelvis against the declared lap region, both hands against
their shoulder targets, complete figure clearance, and furniture/self collisions.
Keep the primary figure's seat and feet supported. Partner support must remain
explicit, with a null surface residual for the carried figure rather than a
fictitious floor gap or a false zero-distance surface claim.

Only publish a recipe after both coarse and dressed-mesh checks pass and renders
show a plausible seated relationship. Limit any stock recipe to the furniture
and dimensions actually verified; a vertical translation alone is not sufficient
when seat height changes the primary figure's foot contact with the floor.
Retain automatic fallback for unsupported surfaces and user-authored variations.

The seated balance diagnostic also needs its actual support surface. For each
coarse contact sample, use the furniture top under its horizontal footprint (or
the ground), and require proximity rather than counting deeply buried samples.
This is a report correction, not a pose adjustment or a physical stability
simulation. Independently test chair/bench contact, elevated and off-furniture
figures, and the distinction between expected partner support and no measured
surface support. Keep the current centre-of-mass/bounds estimate explicit.

The chair trial revealed a separate rendered-support gap: a coarse residual
near zero coexisted with roughly 93 mm between the drawn seat region and chair.
Final rendered reports must therefore measure each declared support on the
drawn mesh, retain the coarse residual separately, and distinguish unavailable
geometry. Furniture tops have finite footprints; floor supports use their own
plane. Include penetration and off-edge cases rather than calling an intersecting
or absent region a zero-distance success. Do not promote the trial chair pose
until visible seat/foot support passes as well as partner contact and clearance.

### Render-aware seated grounding

Use the drawn support measurements to propose bounded seated corrections, rather
than lowering a root against the coarse pelvic field alone. A candidate lowers
the seat region and solves both legs toward their existing foot frames, with
small vertical corrections for sole contact. Keep authored placement/fixed leg
channels authoritative. Reject candidates that worsen partner contacts,
self/body collisions, furniture penetration, support gaps or measured balance.
The initial acceptance cases are the single seated reference figures; the same
support contract should work independently of preset IDs and dimensions.

Before reconciling a coarse furniture overlap, verify the complete drawn figure
against the actual box, including interior vertices and all visible auxiliary
parts. A missing, crossing, contained or orientation-unverified surface cannot
grant clearance. Preserve raw proxy prop depths alongside rendered verdicts,
and audit every figure/prop pair rather than only declared support patches.
Keep work bounded/yielding and restore poses and reports on cancellation.

Some shorter figures start just beyond the chair edge. Permit a measured
horizontal seat correction toward the finite top, with a 25 mm inward margin,
only within a cumulative 180 mm horizontal and 160 mm vertical root bound.
Feet retain their original horizontal positions and orientations. Their starting
sole distance must be within 60 mm; targets add 2 mm of clearance. Off-edge
distances must not be mistaken for vertical gaps; use the measured source/target
points for that correction.

### Remaining reference grounding

Measure the reclining and kneeling reference support regions before choosing a
correction. For kneeling, consider bounded root/leg adjustments from both knee
or shin measurements, retaining foot frames and any already-close hand contact.
For a floor recline, the buttocks and supporting forearms must all meet the floor;
one low foot cannot certify the torso. Keep the visible floor, complete furniture,
self/partner clearance, fixed-channel and cancellation gates. Do not change a
pose's declared supports or thresholds just to remove its warning.

The sofa case additionally needs to clear the backrest and honor its declared
surface planes. A successful single-reference correction must not move another
figure away from a requested contact. Keep measurements available for every
rejected or out-of-budget case and verify actual clothed renders.

Retain the coarse balance result, but use a separately labeled rendered-contact
bounds estimate when complete support regions are available. A taller kneeling
trial exposed why: after actual knees reached the floor, the coarse capsules
fell outside their 30 mm contact band and incorrectly lost the support. Use the
same skeletal centre-of-mass estimate with measured regional contact bounds,
including nearby feet, without increasing a collision or support tolerance.
The estimate is still not a force or stability simulation.

A rejected floor-recline trial also showed why the final audit must inspect
whole-figure floor clearance: its named forearm supports were above the floor
while an unclaimed hand crossed below it. Report full-mesh minimum height and
unknown geometry independently of the support set, using the existing 20 mm
support-quality tolerance for the studio floor. Candidates still require the
stricter nonpenetrating whole-figure floor guard before they can be accepted.

#### Forearm-supported recline correction

The floor-rest study needs a coordinated pelvis/arm correction: its visible
pelvis is about 100 mm above the floor, while forearms are only about 12 mm
above it and an unclaimed hand already extends about 24 mm below it. Lowering
the complete rig cannot satisfy that support set. Explore a bounded pelvis
translation with arm IK retaining nearby wrist locations, followed by limited
wrist orientation corrections to clear the complete hands. Feet are not
declared supports in this study and must not be forced down from their elevated
position as if it were a seated-foot contract.

Measure both forearms, the pelvis and the whole figure after every candidate.
Do not accept a close forearm while fingertips remain below the surface, or
trade the floor crossing for self/partner/furniture overlap. Any implementation
must retain the existing contact/support thresholds, declared supports, fixed
placement and authored-channel rules, shared work budget and cancellation
behavior. Test both body types, proportion/surface variations and portable
capture before promoting a corrected reference.

The implemented candidate pass uses measured gaps independently for each arm,
with small outward wrist offsets and anatomical wrist flexion trials. It retains
already-accepted lateral hand clearance: the tall female floor trial previously
spent its last candidates retrying narrower positions that reintroduced
self-overlap. Retaining the clearance brings all twelve tested body/proportion/
floor-or-bed combinations within 4 mm without increasing the eight-candidate or
shared 32-step budgets. The original floor-rest study now measures approximately
2 mm at its supports with the whole figure above the floor. Translation/heading,
fixed authoring, positive arm contacts, obstacles, capture and cancellation have
explicit regression coverage. The separate sofa/backrest work follows below.

#### Same-plane seated supports and backrest clearance

The sofa reference has its seat and both feet assigned to the cushion plane.
Its soles already measure about 2 mm from that plane, but the seat is about
98 mm above it and the torso intersects the backrest. A previous pelvis drop
with forward translation retained the feet but did not clear the backrest.
Investigate bounded forward/pitch adjustments together with visible-seat
grounding and leg IK that retains the foot frames. Do not reinterpret the sofa's
declared feet as floor supports or change its furniture geometry to hide the
crossing.

Use support measurements and local figure axes rather than a preset ID.
Require complete furniture, floor, self and partner clearance; preserve fixed
placement/channels and close contacts. Any accepted correction must remain
within cumulative translation/orientation bounds and the shared candidate
budget, restore poses on cancellation, and survive capture/reload. Compare
both body types, sizes and relevant surfaces, including the existing seated
chair/bench cases, before delivery.

The diagnostic male/female trials support a shared-plane seating phase with
cumulative limits of 160 mm vertical movement, 180 mm forward movement, and
30 degrees of pitch toward—but never beyond—upright. Retain the original foot
frames with only their existing near-plane height correction, and leave the
trunk/head joint angles unchanged. Keep an accepted pitch/forward offset across
subsequent gap-closing passes rather than undoing its backrest clearance.
Use at most eight candidates within the existing shared 32-step budget.

The wider floor/bed and tall-male trials exposed a free-hand clearance limit:
lowering the seat could leave a hand below the supporting plane. A compensating
candidate retains the current wrist frames during vertical lowering; it does
not anchor hands behind the figure throughout a large forward move. This keeps
the trunk/head joints unchanged while allowing required free arm channels to
adjust within a cumulative 60-degree per-channel limit. Fixed arm channels
block that compensating candidate, and all complete-surface guards remain in
force. Foot frames and the original translation/pitch budgets are unchanged.

Deduplicate effective candidates after retaining/clamping pitch and forward
offsets. Otherwise several different input tuples become the same pose after
an accepted adjustment, wasting the limited budget on repeated failures.

## Remaining paired seated support

The current chair-supported pair has two distinct gaps: the supporting figure
is about 107 mm above the drawn chair seat, and the partner's pelvis is about
108 mm from the drawn lap region. Both hand-to-shoulder contacts are already
within about 2 mm, but complete figure surfaces still cross. Earlier wider-leg
trials approached the lap while leaving thigh crossings and the chair gap.

Establish a visibly grounded supporting pose, then measure the partner's root,
pelvic orientation and leg clearance against it. Explore coordinated placement
and limb adjustments while keeping the original body types, posture roles,
facing, chair surface and all three contacts. Do not expand anatomical regions,
change declared support assignments, relax tolerances or certify local contact
while another part of either figure crosses. Use the public root/joint format
for reproducible trials. A candidate must pass complete figure/furniture/floor,
self-collision, support and contact checks before integration, and any automated
correction must honor fixed settings, work bounds and cancellation.

The successful diagnostic uses an authored stock composition in the public
root/joint format, with the original contact contract intact. Integrate it via
the existing calibrated-layout applicability rules, not by overwriting explicit
body, posture, facing, contact or joint requests. The dressed geometry clears
the chair even though the coarse body proxy reports estimated overlap; keep
that discrepancy available and require missing geometry to remain uncertified.

Chair and bench have different seat heights but the same foot-floor plane, so
a uniform whole-scene height translation cannot validate both. If a bench
variant is supplied, store its independently verified actor poses and reference
height as a per-surface layout variant. Continue using the existing simple
translation path for layouts whose supported planes move together.

The fully fixed fitted pair does not meet the earlier coarse-fallback gate;
do not publish it as a universally valid fixed default. Add an optional guided
placement mode: omitted mode remains fixed for backward compatibility, while a
guided placement seeds the solve without pinning the root. Joint hints remain
guided too. The coarse solver can adjust its approximation, and a single
whole-layout rendered proposal may restore the authored hints only after full
contact/support/figure/furniture/floor/self and rendered-balance validation.
Missing geometry, fixed settings, zero mobility, budgets and cancellation must
not be bypassed. Both the coarse default and rendered result must pass before
the new calibrated entry is delivered. Expose guided starting placement clearly
in the editor, with capture-to-fixed and reset actions.

## Floor-supported seated embrace

The remaining floor-seated pair passes the coarse-model gate but fails its drawn
geometry audit: the supporting seat is approximately 127 mm above the floor,
the two complete figures cross, and all five declared contacts are unresolved.
The partner support assignment is intentional and must not become a fictitious
floor support. Preserve both body types, seated posture roles, floor surface,
opposing facing, the original support contact, two shoulder contacts and two
upper-back contacts.

First establish a rendered-grounded supporting figure with both feet retained
on the floor. Then fit a clothed, non-graphic seated embrace around that stable
pose using the public placement/joint representation. Check complete figures,
floor, self-collision, declared supports, all five contacts and rendered balance;
do not expand contact regions or relax tolerances. A reproducible candidate may
use the existing guided-layout mechanism only if its coarse default also stays
clear. Explicit edits must retain the standard calibration fallback rules.
Supported alternate surfaces require their own measured evidence. Capture,
save/reload, exported JSON and browser rendering must retain any accepted result.

Independent floor-leg trials grounded the primary but introduced thigh crossings
in the pair and were rejected. A rigid reorientation of the verified bench pair
retained its three contacts and complete clearance while bringing the primary
seat and both feet onto the floor. Its initial balance estimate remained outside
the support bounds. Small torso changes and separately fitted arm reaches added
both upper-back contacts while restoring the measured balance estimate; wrist
and gaze adjustments were also checked against complete geometry.

The final guided floor and translated bed scenes pass both the coarse default
and rendered gates. Their five contacts measure approximately 1.8–2.5 mm and
the primary supports approximately 1.8–2.0 mm. Integrate this as portable layout
data through the existing applicability and guided-candidate validation paths.
No new solver stage, support assignment, contact region, or tolerance is needed.

## Standing carry and contact endpoint direction

The standing-carry audit retains its standing/lifted roles and five contacts,
but reports a roughly 57 mm rendered chest gap, crossed hand regions, and about
6 mm of primary foot/floor penetration. Its two supporting contacts are written
from the carried figure's buttocks to the carrier's hands. Rendered refinement
currently rejects those body-first contacts as having no free source limb even
though the opposite endpoint is an arm.

The coarse contact loop also sends a body-first/hand-second constraint to whole-
body translation rather than arm IK. Use the same internal limb-first orientation
there and in its final target measurements, while returning the authored contact
descriptor. Equivalent hand/body and body/hand inputs should produce the same
coarse pose without changing which contacts affect initial arrangement alignment.

Allow the existing bounded limb pass to operate from the limb endpoint when the
authored first endpoint is not a limb. This is an internal working orientation,
not a rewrite of scene intent: original actors, region names, sides, strength,
source indices and report order must remain intact. Retain the existing choice
for limb-first contacts, all fixed/load-bearing guards, collision checks, shared
work budgets and cancellation. Check reversed standing hand/back contacts and
unavailable geometry before relying on the change for a carried composition.

Then fit the clothed carried pair with both primary feet on the floor, all five
original contacts within 4 mm, complete figure/furniture/floor clearance, self
checks and the existing rendered balance estimate. Partner support must remain
distinct from a floor support. Any portable calibration must also pass its coarse
default and preserve the standard explicit-edit fallback, capture and save/reload
contracts. Do not enlarge contact regions or change tolerances to pass the pose.

The contact editor must describe endpoints neutrally as first/second figure and
body part, with a "meets" relationship. "Moving figure" and "reaches toward"
would incorrectly promise which endpoint can move. Preserve stored order and
verify the same order through UI selection, saved reload, export and mobile
accessibility for a body-first hand contact.

The successful diagnostic starts from a verified standing pair, lifts the free
legs into the carried posture, then fits the supporting hands and shoulder grips.
Several higher placements and palm-orientation trials introduced torso/arm
crossings or self-collisions and were rejected. The selected clothed composition
retains complete clearance, approximately 2.4–3.7 mm contacts and 2.0–3.0 mm foot
supports, with a supported carrier balance estimate. Hand shape and gaze were
inspected in the rendered pose. Both the floor and uniformly translated bed
versions pass as ordinary fixed data, so this layout needs no guided fallback.

The initial endpoint change produced three newly flagged combinations in the
unchanged 159-case coarse scene sweep. Do not deliver that regression. Supporting
arm IK now retains a per-limb partner-overlap ceiling as well as the existing
self-bulk ceiling. Snapshot inspection also found a returned 38 mm overlap even
though that run had reached 13 mm, and a self-crossing result despite an earlier
clear iterate. Use the existing 22 mm body-overlap gate as the first snapshot
selection criterion; retain the original aggregate score within each class.
Keep reporting collisions when every candidate is outside the gate.

Compared directly with `2ebcf21`, the revised sweep is 134/159 geometrically sound
versus 127/159, with no newly flagged cases and the same 63 mm worst residual.
Its tracked unmet targets rise from 94 to 98; blocked/unreachable targets remain
separately reported. This improves geometry selection without certifying every
requested contact or making the remaining 25 synthetic cases sound.

## Table-supported pair

The current table layout has an approximately 188 mm rendered support gap for
the bent figure, 3/6 mm foot/floor penetrations, an 87 mm body-contact gap and
one roughly 80 mm hand gap. Complete figure surfaces cross despite a clear
coarse overlap estimate. The posture declares chest and hips on the table top
and both feet on the floor; hands are not declared supports. Preserve those
roles, the table geometry, original body types, same-direction facing and all
three partner contacts.

Fit the primary trunk to both finite tabletop support regions while keeping
feet grounded and complete legs/arms clear of the table. Then fit the standing
partner and hand contacts without losing those supports. Do not substitute hand
supports, enlarge regions, relax tolerances or certify local contacts while
another part crosses. Portable fixed data or existing validated guided hints
must pass both coarse and rendered gates. Explicit edits keep the standard
calibration fallback. Alternate surfaces require independent support evidence;
a table-height shift cannot also move feet that remain on the floor.

The support trace shows that the initial 188 mm hip gap is mostly horizontal:
the hip region is outside the back edge, while the chest is only about 21 mm
above the top. Moving the trunk forward, retaining grounded foot frames and
fitting the arms closes the original four supports. Full-mesh checks reject
the first solutions because the shorts/upper thighs, then an elbow, enter the
table. A rearward primary stance and a clear elbow route resolve those crossings;
the partner's wider stance keeps the legs and feet separate.

The resulting clothed composition retains approximately 1.5–2.5 mm partner
contacts and 1.8–2.0 mm surface supports. Both-fixed data still fails the coarse
gate, and both-guided data loses a coarse support. A fixed primary plus guided
partner passes both representations through the existing whole-layout validation
path. Keep that mixed policy explicit in the editor and portable data; do not
waive the coarse gate or publish an unavailable rendered check as clearance.
No solver, region, furniture dimension or quality tolerance changes are needed.

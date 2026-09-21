# Contact measurements that match the visible figure

The collision field and the scanned surface are different representations. In
the original helping-hand study, the body-model target error was about 2 mm,
but the nearest sampled hand/forearm vertices were about 19 mm apart. Measuring
triangle interiors gives a more accurate initial surface gap of 16.7 mm.

`src/core/meshDistance.js` computes triangle distance using face projection,
edge/edge minima and crossing tests. A bounding-volume hierarchy skips distant
triangle pairs. Tests cover interior minima, millimeter-sized edges, crossings,
coincident orientations, degeneracy and empty input.

`src/core/surfaceContacts.js` selects anatomical regions using the same skin
weights, posed vertices and dressed triangle indices as the renderer. Entire
connected limbs are checked as well: a clear hand/forearm target must not conceal
an intersection with the nearby wrist or hand.

For a limb-to-body contact, that complete limb is checked against the complete
target figure, including colored auxiliary geometry. The regional query still
uses its anatomical ownership and radius. Synthetic patches verify that a clear
local contact cannot hide a distant crossing, in either contact direction.

Default surface ownership comes from the landmark's complete `bones` list, not
only its primary bone; specialized limb and torso rules remain in place. A foot
includes its toe segment, and a lap includes the pelvis and adjacent thigh bones.
The lap keeps the existing 0.11-stature spatial radius and
35% regional weight threshold, so this does not admit distant knee surfaces or
expand the source pelvic region. Synthetic skinned-patch tests verify both sides,
different poses/scales/headings, unrelated bones and small weight influences.

Whole-group collision coverage deliberately includes tiny skin-weight tails;
named contact regions do not. In the seated-pair diagnostic, a broad whole-group
query found 15 mm between a thigh-edge triangle with only 3–4% pelvis influence
and the other thigh. That is not a pelvic support contact. Correcting only the
lap target's ownership changes the actual regional measurement from 200 mm to
about 108 mm, still a failing target in that automatic pose, without moving either
figure. The later calibrated chair/bench composition retains this same regional
definition and brings its actual support contact within 4 mm.

## Refinement contract

An explicitly guided starting placement may propose its root and authored joint
hints before iterative refinement. This is one candidate in the shared work
budget, not a preset-ID shortcut. It must satisfy every positive rendered contact
within 4 mm, every declared surface support within 4 mm without penetration,
complete figure/prop/floor clearance, existing self-collision checks and rendered
support balance. All relevant geometry must be available. Fixed actors and zero
mobility are retained, rejected trials restore the coarse result, and cancellation
restores an accepted tentative trial too. `maxGuidedPoseSteps: 0` disables this
proposal; `surfaceRefinement.guidedPoseSteps` records its work. The existing
fixed-layout semantics and subsequent bounded refinements are unchanged.

The pass starts from the base solver's pose. It tries bounded IK adjustments,
small free-wrist turns, and limited horizontal steps for mobile standing or
kneeling figures on the floor. Authored wrist angles and pinned placement are
respected. Supporting limbs are not lifted; furniture-supported figures do not
slide off their props. The pose with an improved total contact score is retained.

For an existing triangle crossing, a normal supplies an axis, not a guaranteed
signed escape direction for the moving limb. Refinement tries both signs with
increasing offsets, bounded at 96 mm before contact-weight blending. This is a
candidate search, not permission to move through another body: every accepted
candidate must pass the same per-pair, aggregate and new-intersection guards.

A hand approaching a torso can need a coordinated change rather than an isolated
wrist turn. Free hand-to-torso trials combine forearm twist, wrist orientation
and an IK reach toward a nearby, anatomically framed point in the same target
region. Subsequent small corrections retain the current elbow bend direction.
Explicit wrist settings or forearm rotation disable these compound trials;
fixed channels are still enforced by every refresh. Each candidate uses one
step of the shared budget and yields for cancellation, restoring rejected rigs.

A coarse capsule can report overlap even when visible surfaces are separate.
During free-limb refinement, a discrepancy is reconciled for the declared limb
pair after checking complete visible limbs and outward-facing clearance. The
whole-body stage and final report can also use a complete figure/figure check,
including all drawn auxiliary triangles without anatomical bone ownership.
Raw proxy depths remain in `quality.proxyMaxDepth`/`proxyTotalDepth`; the count
of reconciled contacts is `verifiedProxyContacts`. Missing geometry cannot grant
an exception. Self-collisions and unrelated body pairs remain guarded. Furniture
proxy reconciliation has a separate complete-figure/box check, described below.
The guard compares individual unresolved collision pairs as well as aggregate
depths, so a smaller maximum cannot hide a newly introduced collision elsewhere.

Whole-limb checks use an exact crossing-only traversal when distance is not
needed. Clear results contain no distance or orientation claim. A real proxy
overlap still triggers the full nearest-pair/facing query before it can be
reconciled; missing geometry still grants no exception. Unit tests verify both
query modes agree about crossings and that distant clear limbs do not perform
unnecessary exact-distance searches.

Whole-scope hierarchies are refitted to each new pose without re-sorting their
unchanged triangle sets. The trees and their query identities remain immutable:
old measurements cannot become new-pose evidence. Changed indices or missing /
nonfinite triangles force a rebuild, including when previously missing geometry
returns. Regional trees are still rebuilt because their spatial membership can
change with the pose. Tests compare refits with fresh exact and crossing-only
queries after large moves, while preserving the old tree and its measurements.

The normal budget is eight passes and 32 candidate steps. The worker consumes a
generator and yields between contact updates, allowing newer requests to cancel
stale work. Cancellation restores the canceled job's original rig. The CLI uses
the same implementation synchronously. Neither path deforms rendered vertices
independently of the skeleton or modifies cached templates.

After free-limb refinement, mobile upright figures supported by both feet on the
floor can try a coordinated lower-body correction. A nearby pelvic contact and
an already-close torso contact define the move and counter-rotation. The source
root moves at most 28 mm horizontally per trial and 40 mm across the body phase.
Outward/back foot-step components of 20–35 mm can clear toes; total foot travel
is capped at 70 mm, with a root drop capped at 20 mm if needed for reach. Wrist world positions
and ankle/wrist orientations are retained to within 0.5 mm / 0.0005 per matrix
component. Feet keep their height. Explicit wrist/ankle settings disable these
trials, and fixed channels are enforced through every IK refresh.

These standing-body trials consume the same 32-step budget, with at most 12
body trials by default (`maxBodySteps: 0` isolates the preceding limb phase).
They must improve contact error without worsening an already-close contact,
self/prop/per-pair violations or the existing balance estimate. Every rendered
figure pair must be available and clear before accepting a whole-body candidate.
Cancellation also restores accepted intermediate body changes. The UI explains
an automatic stance adjustment separately from geometry warnings.

### Seated supports

Figures with a seat and two foot supports on a higher surface can use the drawn
support measurements for bounded grounding. The pelvis follows the measured
seat target while two-bone IK retains both foot frames, including orientation,
with small vertical corrections to put the soles near the floor. A nearby
off-edge seat region can move toward its measured top edge with a 25 mm inward
margin; its horizontal distance is not misread as a vertical gap.

Corrections are limited to 160 mm vertically and 180 mm horizontally from the
starting root. Feet must start within 60 mm of their support plane; target soles
include 2 mm of clearance. Up to eight seating candidates use the existing
shared 32-step budget, after hand/standing refinement. The pass respects fixed
placement, zero mobility and fixed leg
channels. It preserves close partner contacts, checks every figure/prop pair,
rejects new self/body violations and below-floor visible auxiliary parts, and
retains the balance estimate. Cancellation restores accepted intermediate poses
without publishing their diagnostics. Capture/save/reload can preserve the
result as an ordinary fixed pose.
`maxSeatingSteps: 0` disables this phase for a diagnostic comparison.

### Kneeling supports

The next bounded phase handles paired knee or shin supports. It retains foot
orientation and horizontal placement, using the same 60 mm sole-distance
eligibility limit and 2 mm target clearance, and holds the world frames of hands
involved in contacts. Small vertical/forward
root candidates can ground a low kneel without pushing the heels into the body.
No preset ID is involved. Cumulative root limits are 60 mm vertically and 40 mm
horizontally; up to eight candidates use the shared 32-step budget. Set
`maxKneelingSteps: 0` to isolate the preceding phases.

Fixed placement, zero mobility and fixed channels in the required leg/contacted
arm chains block this adjustment. Accepted candidates must improve support,
retain contacts, clear complete figures/furniture and the floor, and not worsen
self/body collisions or balance. Cancellation restores all actors, including
earlier hand adjustments, without publishing partial reports.

### Forearm-supported reclines

The next phase handles a pelvis and two forearm supports sharing a plane. It
lowers the pelvis toward its measured support, uses arm IK with an outward elbow
direction, and adjusts free wrists so fingers do not extend below the surface.
Only the arm joints and root height can change; lower-body/trunk joints, root
heading and horizontal position remain unchanged. Undeclared elevated feet are
not forced onto the surface.

Cumulative root-height change is limited to 160 mm, wrist displacement to 60 mm,
and each wrist-angle change to 60 degrees within anatomical limits. At most eight
candidates consume the shared 32-step budget. Accepted lateral hand clearance
is retained across passes rather than retrying a narrower, colliding position.
`maxForearmSteps: 0` disables this phase, and `surfaceRefinement.forearmSteps`
reports its work.

Fixed placement, zero mobility, fixed required arm channels, missing support
geometry, and positive partner contacts on either supporting arm block the
correction. The common support-stage guards still require improved support,
complete figure/furniture/floor clearance, retained contacts, and no worsened
individual or aggregate collisions or rendered balance. Capture and cancellation
use the same rules as the other support phases. This is a bounded geometric
correction, not a force or joint-load simulation.

### Shared-plane seated supports

Seat/foot support sets on one plane use a separate bounded phase. A damped seat
correction retains both foot frames while trying small forward offsets and pitch
toward upright. This handles cushion-supported feet without reinterpreting them
as floor supports. Root movement remains within the existing 160 mm vertical and
180 mm horizontal seating limits. Pitch is at most 30 degrees toward upright,
never beyond it; sideways root movement, yaw and roll are not introduced.

When vertical lowering needs hand clearance, a compensating candidate retains
the current wrist frames. Fixed arm channels block that candidate, while fixed
leg channels, fixed placement or zero mobility block the phase. Trunk/head and
hand/toe-tip joint angles remain unchanged; free arm changes are capped at 60
degrees per channel from the phase's initial pose. The complete floor, furniture,
figure, contact and collision guards remain authoritative.

Accepted pitch/forward offsets persist across passes. Equivalent candidates
after that retention/clamping are tried only once, avoiding repeated failures
within the eight-candidate phase limit and shared 32-step budget. Use
`maxLevelSeatingSteps: 0` for a diagnostic comparison;
`surfaceRefinement.levelSeatingSteps` reports its work. Capture/reload and
cancellation use the same representation and restoration rules as other phases.
Coarse prop/balance disagreements remain available beside the measured results.

`quality.propSurfaces` audits every complete figure against each furniture box.
Crossing triangles and interior vertices are overlaps. Missing geometry and
unverified orientation—including a box enclosed by a shell—cannot certify
clearance. A coarse prop collision is reconciled only after a complete,
outward-facing clear result. `proxyPropPenetration` and `verifiedPropContacts`
retain the raw discrepancy and reconciliation count. Actual furniture crossings
and unavailable checks remain visible in previews, UI notes and CLI reports.
This does not replace self-collision checks or silently relocate authored rigs.

`jointMode: "fixed"` is enforced by the shared rig refresh during every trial and
rollback. Specified channels remain exact through refinement and cancellation;
unmodified channels can still participate in a correction. A fixed arm may leave
an unreachable or movement-limited target, which remains reported normally.

## Readouts

`basis: "rendered"` means `surfaceGap` is the distance between the selected
visible regions. `targetDistance` is the separate body-model target residual.
Crossings of either the requested regions or their connected limbs are flagged.
**Close contact** means a gap of at most 4 mm; it is not a physical simulation or
a guarantee about every triangle in the complete scene.

`basis: "body-model"` means no visible-region measurement is available. The UI
says **Estimated target** and never presents that value as a measured surface
contact. Supporting limbs, limited reach and unresolved movement receive their
own feedback. All reports are remeasured on the final returned pose.

Body-model region distances do not use the collision detector's finite proximity
cutoff: distant declared targets must remain in scoring and reporting. The
per-step movement bounds and collision allowances remain unchanged.

An actor's `supportBasis` is `surface`, `partner`, or `none`. For surface support,
the base solve's `seatResidual` is the maximum coarse declared-plane error with
its existing 2 mm numerical floor. After rendered refinement, `supportMeasurement`
identifies `rendered` or `body-model`: a complete visible measurement replaces
`seatResidual`, while `bodySupportResidual` preserves a fresh coarse measurement
of the same final rig. Missing geometry keeps the coarse estimate, marks support
availability explicitly and cannot certify support. For partner/none support,
these surface residuals remain null, not a zero-distance surface contact.
Partner contact reports still determine whether the requested placement was reached.

`quality.supportSurfaces` contains each declared support region's measurement.
The region ownership/radius rules are unchanged. The floor uses the lowest
drawn regional point relative to its plane. Furniture checks clip triangles to
the finite top footprint, including points along clipped edges; an entirely
off-edge region uses its distance to the nearest top edge. Penetration is retained
instead of treating a triangle crossing as zero-distance success. The existing
20 mm support-quality limit applies, with penetration distinguished from gaps in
previews, worker metadata, UI notes and the CLI. These checks report geometry;
they do not move the rig, simulate furniture deformation or certify stability.

The coarse balance estimate now includes finite raised furniture tops alongside
the ground and excludes deeply buried samples. It still estimates centre of mass
against contact bounds, not a full support polygon or partner-load simulation.
Expected partner support and absent surface contact remain distinct.

`quality.renderedBalance` is a separate estimate from declared support regions
and nearby feet, clipped to finite furniture and the same 30 mm proximity band.
It uses the existing skeletal centre of mass with these measured contact bounds.
Support-correction guards use it when available; `quality.balance` retains the
coarse result. This avoids losing a genuine knee support solely because its
coarse capsule falls outside that band. Neither estimate certifies force balance.

`quality.floorSurfaces` independently reports each complete drawn figure's
minimum height and penetration below the studio floor, including parts not named
as supports. Penetration beyond the existing 20 mm support-quality threshold and
unavailable geometry are flagged. Raised bed/sofa planes remain separate from
the studio floor; support candidates retain their stricter whole-figure floor
guard before acceptance.

`quality.figureSurfaces` is a separate final audit of every pair, including pairs
with no declared contact. Its `intersects` value is `true`, `false`, or `null`
when geometry is unavailable. Crossings and unknown checks appear in viewport
notes, catalog quality labels and the named-preset CLI audit. This is a triangle
surface check, not a replacement for self-collision, furniture, support or solid
containment checks; raw body-model diagnostics remain available.

## Measured cases

`node scripts/validate-surface-contacts.mjs` checks real dressed model geometry.
All seven fixtures must reach the 4 mm threshold without newly unresolved
collisions, affected-limb crossings or any figure/figure surface crossings.

| Fixture | Initial visible gap | Final visible gap |
| --- | ---: | ---: |
| Female → male | 16.7 mm | 3.7 mm |
| Male → female | 29.7 mm | 2.9 mm |
| Female pair | 27.7 mm | 2.1 mm |
| Male pair | 19.3 mm | 2.3 mm |
| Kneeling pair | 25.5 mm | 3.1 mm |
| Different height/build | Surfaces intersected | 2.1 mm |
| Authored wrist angle | 16.7 mm | 3.7 mm |

An additional seated-support regression starts with both hands crossing the
target arms. Both finish clear, approximately 2.3 mm and 1.8 mm from their
targets, within the normal 32-candidate budget. The supporting figure, both
roots and lower-body joints remain unchanged, and no unresolved collision pair
worsens. The separate lap-region target still fails; resolving the hands does
not make the whole preset pass.

The dressed standing-embrace regression starts with both hands/arms crossing the
target. Its limb-only stage finishes near 2.2 mm on both sides but leaves a 10 mm
pelvic gap and a toe crossing. The coordinated body stage then moves the source
root approximately 6.7 mm and finishes with all four gaps within 4 mm, no rendered
figure crossing, unchanged wrist frames and supported feet. The target figure
does not move. A translated and rotated custom-ID copy also passes; fixed trunk
channels, pinned placement, explicit end joints, third-figure collisions,
missing meshes, budget limits and cancellation have separate regression checks.

A six-case body-stage comparison found no newly worsened violations. Only the
stock proportions became fully solved. Reversed body types, same-type pairs,
different heights and different builds retained their prior geometry findings
without an accepted body correction. These remain calibration work, not evidence
that every variant is now solved.

These are specified fixtures, not proof that arbitrary conflicting contacts can
all be satisfied. Region boundaries depend on skin weights; self, prop and
balance checks still use the body model. The pass does not simulate soft tissue,
cloth, grasp forces or general full-body motion planning.

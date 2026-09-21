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
about 108 mm, still a failing target, without moving either figure.

## Refinement contract

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
an exception. Self-collisions, props and unrelated body pairs remain guarded.
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

These trials consume the same 32-step budget, with at most 12 body trials by
default (`maxBodySteps: 0` isolates the preceding limb phase). They must improve
contact error without worsening an already-close contact, self/prop/per-pair
violations or the existing balance estimate. Every rendered figure pair must be
available and clear before accepting a whole-body candidate. Cancellation also
restores accepted intermediate body changes. The UI explains an automatic stance
adjustment separately from geometry warnings.

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
`seatResidual` is the final maximum declared-plane error, with the existing 2 mm
numerical floor. For the other bases it is null: it is not a zero-distance surface
contact. Partner contact reports still determine whether the requested placement
was reached. The worker and CLI preserve this distinction.

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

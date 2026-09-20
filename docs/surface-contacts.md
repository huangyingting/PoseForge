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

A coarse capsule can report overlap even when the visible limbs are separate.
Such a discrepancy is reconciled only for the declared limb pair, after checking
the complete visible limbs for triangle crossings and outward-facing clearance.
Raw proxy depths remain in `quality.proxyMaxDepth`/`proxyTotalDepth`; the count
of reconciled contacts is `verifiedProxyContacts`. Missing geometry cannot grant
an exception. Self-collisions, props and unrelated body pairs remain guarded.
The guard compares individual unresolved collision pairs as well as aggregate
depths, so a smaller maximum cannot hide a newly introduced collision elsewhere.

The normal budget is eight passes and 32 candidate steps. The worker consumes a
generator and yields between contact updates, allowing newer requests to cancel
stale work. Cancellation restores the canceled job's original rig. The CLI uses
the same implementation synchronously. Neither path deforms rendered vertices
independently of the skeleton or modifies cached templates.

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

## Measured cases

`node scripts/validate-surface-contacts.mjs` checks real dressed model geometry.
All seven fixtures must reach the 4 mm threshold without newly unresolved
collisions or intersections of the affected limbs.

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

These are specified fixtures, not proof that arbitrary conflicting contacts can
all be satisfied. Region boundaries depend on skin weights, and collision
assessment outside the refined limb pair still uses the body model. The pass
does not simulate soft tissue, cloth, grasp forces or full-body motion planning.

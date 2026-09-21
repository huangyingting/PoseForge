# Fixed placement and pose capture

Automatic placement remains the default. Existing scenes do not need new fields.
The optional controls in **Figures → Placement** are for deliberate layouts that
must not move when the solver runs again.

Calibrated catalog entries may start with fixed placement and joint channels.
The Composition hint shows when roots are fixed and where to release them.
The lying-facing and side-lying cuddle references are currently calibrated for
stock body dimensions on bed and floor; changing a loaded fixed scene does not
reapply that recipe or certify the changed geometry.

- **Keep placement** captures the figure's completed world position and rotation.
  Joints remain guided unless their angle settings are fixed separately.
- **Capture solved pose** also stores all adjustable joint channels in fixed
  mode and preserves the current hand shapes.
- **Capture current layout**, above the figure cards, captures every figure in
  one operation. Use it to keep a complete calibrated scene without another
  figure moving between separate captures.

Capture controls are unavailable while a solve is pending. The solved-placement
readout clears while pending so an old transform cannot be mistaken for the new
result. Edited placement values remain visible and editable.

## Coordinates and storage

Position is measured in world metres; the rig root is near the pelvis, not the
feet. Rotation uses intrinsic XYZ Euler degrees. Fixed placement takes priority
over the arrangement's position and facing. Other figures that remain automatic
can still adjust.

Position components must be finite numbers within -10..10, and rotation components
within -180..180. All three components of both vectors are required. Number fields
accept precise values, and editing one component preserves all untouched values.
The readout is rounded for display; scene JSON retains the stored precision.
Equivalent Euler triples can represent the same orientation when capturing a
quaternion-based rig.

The optional actor field in the current version-1 scene format is:

```json
{
  "placement": {
    "position": [0.3, 0.9, -0.2],
    "rotation": [0, 25, 0]
  }
}
```

These example coordinates are a transform, not a guarantee of grounded support.
Capture a completed pose to obtain coordinates appropriate for its body and
posture. Unknown placement keys, missing components and invalid numbers are
rejected by catalog import. Use a current build when sharing fixed layouts;
older builds may not honor the new optional placement field.

## Returning to automatic behavior

Uncheck **Keep placement** to let the arrangement and solver position the figure
again. This does not remove joint overrides. Use **Keep edited angles** or
**Reset all** in Joints to release or remove those separately. Hand-shape choices
are independent and can be returned to “from the pose.”

Placement is included in undo/redo, saved presets, workspace drafts, JSON import
and export, and preview identity. The existing Fit view control frames figures
that have deliberately been moved outside the current camera view.

## What capture does not certify

Fixed figures can still intersect, float or have unreachable contacts. These
conditions remain in the quality reports; locking a pose grants no collision or
support exception. The rendered refinement pass skips futile candidates when
both the relevant joints and root are fixed, and labels the remaining hand
constraint **Fixed pose**. This is an authoring tool, not a physics simulation
or proof that every bundled layout is already correct.

Final support notes identify rendered gaps or penetration when mesh measurements
are available. These check each declared support region against the floor or
finite furniture top, not just the lowest vertex of the entire figure. A hand
near the floor does not establish that the seated region meets its chair.
The coarse estimate remains available separately; missing mesh data is labeled
as an estimate, and expected partner support has no surface-gap measurement.

An automatic seated figure may be lowered/repositioned against the drawn seat
while leg IK keeps its foot frames. **Capture solved pose** or **Capture current
layout** can keep that result. Once placement or relevant leg channels are fixed,
the seated correction will not overrule them. Missing meshes cannot grant a
furniture-clearance exception, even for a previously captured correct layout;
their remaining coarse estimates and unavailable checks stay visible.

The same authoring rules apply to knee/shin grounding. Foot frames and contacted
hands are retained during accepted automatic corrections; fixing the relevant
leg or contacted-arm channels prevents them from being changed. Whole-figure
floor checks also cover unclaimed hands or other parts, not only the declared
support regions.

Forearm-supported reclines can also receive a bounded automatic correction before
capture. It moves the pelvis vertically and adjusts free arms/wrists while
retaining lower-body and trunk joints. Fixed placement or required arm channels
block this phase, as do positive partner contacts on the supporting arms. Capture
stores the resulting root and joint pose using the same portable representation;
it does not replace the pose's declared supports or hand shapes.

When seat and feet share one plane, automatic seating can include a bounded
forward move and pitch toward upright while preserving foot frames. Free wrists
may be retained during lowering to prevent below-surface hands. Trunk/head and
hand/toe-tip angles stay unchanged; fixed arms block that compensation, and fixed
legs or placement block the shared-plane phase. Capture stores the resulting
pitch and limb adjustments, so save/reload does not solve them a different way.

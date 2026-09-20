# The solver

`src/core/solver.js`. Takes a validated scene spec and produces posed bodies
whose declared contacts are closed and whose volumes do not interpenetrate —
two goals that actively fight each other.

This document describes the base body-model solver. Scanned rendering adds the
[visible-contact pass](surface-contacts.md) after this solve. That pass measures
the actual posed triangles and retains coarse-model diagnostics separately.

## Postures are angles plus a support set

A posture in `src/core/poseLibrary.js` is:

```js
{
  label, joints: { hip_l: {flexion, abduction, rotation}, … },
  supports: [ { landmark: "foot", side: "l" }, … ],   // what bears weight
  spineDir, faceDir,                                  // unit, orthogonal
  rootHeight,                                         // fraction of stature
}
```

The **support set** is the load-bearing idea. Authoring joint angles alone
means every posture must be tuned per surface height; authoring what touches the
ground means the seating routine can work it out.

Joint angles are clamped to each joint's range of motion on the way in. A test
asserts that `clampAngles` returns every authored posture's angles *unchanged* —
i.e. the catalogue never asks for a joint position a human cannot reach.

## Two heights per surface

This is the single most load-bearing detail in the whole solver:

```js
surface = { height, ground, props }
```

- `height` — where a **trunk** rests (the bed top, the table top)
- `ground` — where **feet and knees** go

They are equal for surfaces you get on top of (floor, bed, sofa). They differ
for surfaces you stand beside: a table has `height = 0.75`, `ground = 0`.

```js
const BULK_SUPPORTS = new Set(["upperBack","buttocks","head","chest","hips","shoulders"]);
supportPlaneFor(support, surface) =
  BULK_SUPPORTS.has(support.landmark) ? surface.height : surface.ground;
```

Collapsing the two into a single `y` is what makes a figure bent over a table
stand *on the tabletop*. That is why the solve result publishes both and has no
`y` field at all.

## Seating

The invariant is **not** "drop until something touches". It is:

> the declared supports are the lowest thing on the body, and all of them touch.

Once that holds, a single translation puts them on the surface and nothing else
can be underground.

```
repeat up to `passes` (6):
  drive limb supports onto their planes with IK
  raise any limb hanging below its support plane
  re-seat: translate by max(plane(s) - lowestY(s)) over all supports s
```

The maximum, not the minimum — a support already resting where it belongs must
not be dragged under to bring another one up.

It iterates because the two stages interact: dropping a knee onto the floor
moves the pelvis, which moves every other support. The pay-off is that only the
*support set* has to be authored correctly; the joint angles are allowed to be
approximate.

`supportLowestY` uses the lowest **sphere** of a volume, not the lowest axis
point, or every foot sinks by one radius.

> `seatOnSurface` throws if handed anything but a `{height, ground}` object.
> It used to accept a bare number; a stale caller passing `0` read
> `surface.ground` as `undefined` and quietly poisoned every vertex with NaN,
> which surfaced much later as a blank canvas. Failing at the call is cheaper.

## Arrangements

An arrangement positions the second actor relative to the first:

```js
{ label, offset: [x,y,z],   // fractions of stature
  yaw,                      // degrees, the arrangement's own default facing
  contacts: [ { from, to, strength } ],
  clear:   { axis, measure },   // declared clearance
  turn:    "vertical",
  carried: true, mounted: true }
```

**Declaration beats inference.** Rather than have the solver deduce that a
partner lying full length along another is held by that person and not by the
mattress, the arrangement says `carried: true`. Same for `mounted`, `clear` and
`turn`.

### Reconciliation

An arrangement is written for two upright partners. What it means on the ground
depends on the postures it is being asked to arrange, so
`reconcileArrangement(requested, primaryPosture, secondaryPosture)` adjusts it:

- A recumbent primary with a raised secondary becomes `mounted`, with
  `reconciledFrom` recording what it was, the z offset pulled in but keeping its
  sign, and the yaw untouched.
- A **face-down** primary has its contacts remapped through
  `FACE_DOWN_EQUIVALENT`. Contacts are written front-to-front because that is
  what an arrangement normally means; lie the lower partner on their front and
  their front is against the bed. Without the remap the solver spends itself
  chasing a chest 400mm away through a mattress, and pays for the attempt in
  real interpenetration somewhere else.
- `canBeCarried(posture)` overrides a `carried` declaration that is nonsense for
  the posture it was handed — someone on hands and knees over their partner is
  carrying themselves, and taking away their seating leaves them hanging
  wherever the contacts happen to stop.

### Yaw is relative

`relationship.yaw` overrides the arrangement's own default rather than being an
absolute world angle. "The same thing but facing the other way" is one number,
so it belongs as an override rather than as `straddle_supine_reversed` sitting
next to `straddle_supine` in the catalogue. See [language.md](language.md) for
why this matters to the parser.

### Body-supported clearance

An inferred vertical clearance is only a starting choice. A figure supported by
an upright seated partner can be in front of that partner's torso, not above
their head. Aligning the support landmarks and then retreating only upward can
leave the figure almost a metre above the initial alignment.

For a mounted, non-carried figure with no ground supports and no explicit
clearance rule, placement tries the vertical and horizontal approach directions.
It accepts the horizontal seed only when it clears the same torso-overlap limit,
requires less retreat, and does not worsen the weighted whole-body contact
residual. Free hand targets do not vote. Missing measurements do not count as
zero error. Explicit clearance rules, ground-supported figures and custom-only
scenes without placement contacts retain their original path.

Contact residual matters as much as distance: the shortest retreat alone can
replace an already seated floor support with a thigh overlap. Regression tests
cover that case, chair/bench support, body-type order and varied proportions.
This improves the base placement; it does not prove that the dressed meshes
meet their surface targets. Run the rendered-contact audit separately.

## The annealed loop

45 iterations by default. Each one:

```
4a. contacts     — pull declared contacts closed
                   limb landmarks → two-bone IK; everything else → whole-body slide
4b. ground       — re-seat everyone
4c. detect       — body/body and body/prop contacts; score the state
4d. straddle     — a supporting limb in the way swings out
4e. rigid        — whole actors translate + rotate for overlaps no joint can fix
4f. articulated  — limb overlaps bend limbs
4g. footprints   — actors whose supports want the same floor patch step apart
```

with `relaxation = 1 - iteration/(iterations·1.6)` scaling every correction, and
every step clamped to `maxStep` (50mm linear, 0.12 rad angular).

Three decisions in here are worth calling out.

**It is annealed, not run to a fixed point.** The two halves pull against each
other by nature — closing a contact creates overlap, resolving overlap opens the
contact. A plain loop returns whatever the last iteration happened to leave,
which can easily be worse than a state already passed through. So every
iteration is scored and **the best one seen is kept**:

```js
score = sceneScore(penetrationReport(bodyContacts), contactReports, propContacts)
if (score < bestScore) best = actors.map(snapshotActor)
```

**The ground pass runs before scoring, not after.** The contact stage slides
whole actors along contact normals, and a normal pointing downward puts a knee
through the floor on the way to closing a contact. Seating *before* the snapshot
is what makes the snapshot trustworthy — seat afterwards and the best-scoring
state can be a mid-iteration one that was never re-seated, i.e. a scene that
measures well and has somebody's shins buried in the carpet.

**Termination needs both halves.** An empty penetration report on its own is
also what two people standing a metre apart produce:

```js
done = bodyContacts.length === 0
    && propContacts.length === 0
    && !contactReports.some(e => !e.unreachable && !e.blocked && e.distance > 0.012)
```

A contact the bodies physically block is not *pending* — it is already as close
as it will ever get, and waiting on it would just burn iterations.

**Footprints go last** because they answer a question nothing else can ask: two
actors whose supports want the same patch of floor are not interpenetrating
anywhere, so no contact and no collision reports them.

## IK

`src/core/ik.js`. Two-bone analytic, not iterative.

- **Pole hints.** A two-bone chain has a whole circle of solutions for any
  reachable target; the pole is the only thing that chooses among them. The pole
  is a **direction**, not a point. `defaultPole` puts knees forward and elbows
  back — without it, arms bend through the ribcage.
- **Honest failure.** An out-of-reach target reports `unreachable: true`,
  `ok: false`, the true residual, and leaves the limb stretched toward the
  target. It does not silently lengthen a bone. A too-close target clamps
  without producing NaN.
- **Weight blends.** `weight: 0` leaves the pose untouched and reports the
  *unsolved* error; `0.5` lands halfway.
- `solveAim` turns the head without moving the pelvis.

## Saying what it could not do

Every contact left further than 60mm apart produces a warning naming the contact
and the reason:

```
chest to chest is out of reach in these postures, left 91mm apart
hand.left to hip is as close as the bodies allow, left 42mm apart
head to pelvis could not be closed, left 55mm apart
```

The verdicts (`unreachable`, `blocked`) come from watching the solver try, which
a single final measurement cannot see — so when the best-scoring state is
restored at the end, the distances are re-measured on the restored state but the
verdicts are carried across from the iterate being restored.

This matters because the render is exactly as confident-looking whether or not
the description fitted together. Naming the failure is what lets the webapp tell
a user their description does not work, rather than showing them a wrong answer
with no caveat.

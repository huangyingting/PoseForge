# Geometry: the signed distance field

Everything in this system is downstream of one function:

```js
bodyDistance(point, volumes) → signed distance to the body surface
```

Negative inside, positive outside, zero on the surface. The renderer meshes its
zero level set, the collision system queries it, the ambient occlusion samples
it. There is no separate "collision mesh" and no separate "render mesh".

## Why round cones

A body is 31 **round cones** — the convex hull of two spheres, i.e. a capsule
whose two end radii may differ. `buildBodyVolumes` in `src/core/body.js` sizes
them from anthropometric fractions of stature.

Round cones were chosen over the alternatives for one reason: **their exact
distance field is closed-form and cheap.**

| primitive | exact SDF? | fits a limb? |
|---|---|---|
| sphere | yes | no — needs dozens per limb |
| ellipsoid | **no** — only an iterative or bounded approximation | roughly |
| box | yes | no |
| **round cone** | **yes** | yes — a tapering limb segment is exactly this shape |
| triangle mesh | no (needs a BVH + winding number) | yes |

`../SexPoses` uses ellipsoids for collision. An ellipsoid has no closed-form
exact distance — the honest options are a Newton iteration or a bound, and a
*bound* is what breaks sphere tracing: if the reported distance is smaller than
the true distance the marcher takes too many steps, and if it is ever larger the
surface gets punched through.

## The exactness claim, measured

`roundConeDistance` returns a true Euclidean distance, not a bound. That is what
licenses:

- **sphere tracing** stepping the full reported distance,
- the mesher's **one-step vertex relaxation** (`p -= d · ∇d` lands on the surface),
- treating narrow-phase results as exact contact depths.

It is verified rather than asserted. `tests/collision.test.js` takes a probe
point, evaluates `d`, steps `d` along the field's own normalised gradient, and
re-evaluates:

```
capsule (ra == rb)         |d| after one step ≈ 1e-17
taper   (0.05 → 0.16)      |d| after one step ≈ 1e-17
degenerate sphere (a == b) |d| after one step ≈ 1e-17
```

A merely-bounding field would undershoot and land short.

The implementation follows the standard analytic form: the surface is the convex
hull of two spheres, so the closest feature is either one of the two sphere caps
or the tangent cone band between them, and the three branches in the code are
exactly those three cases.

## Smooth union

Volumes are combined with a polynomial smooth minimum:

```js
smoothMin(d1, d2, k):
  h = clamp(0.5 + 0.5·(d2 - d1)/k, 0, 1)
  return d2·(1-h) + d1·h - k·h·(1-h)
```

`k` is per-volume (`volume.blend`), so a wrist can join tightly where a shoulder
joins softly. This is what removes the visible seams at every joint that the
reference system has, where separate meshes simply interpenetrate.

Two consequences worth knowing:

**The fold is sequential and order-dependent.** `bodyDistance` folds pairwise in
list order. Two different orderings differ by at most the blend tolerance, but
they do differ — `bodyDistance` is not currently order-independent, which is a
known rough edge.

**Smooth union inflates.** Where primitives overlap, the blend bulges the
surface outward, so a torso authored to its exact target cross-section measures
wider than the target once rendered. Primitives are therefore authored slightly
under size:

```js
BLEND_SHRINK = 0.97   // torso sections
LIMB_SHRINK  = 0.96   // limbs, which mostly meet end-to-end rather than broadside
```

These are calibrated against `scripts/measure-body.mjs`, which measures the
*rendered field* rather than the primitives. They sit close to 1 deliberately:
inflation accumulates with the number of overlapping primitives — five meet at
the hip — so generous blending there costs centimetres of silhouette.

**A blend radius must be small against the feature it blends.** `smoothMin`'s
`k` does not soften a form when it approaches that form's own radius — it
dissolves it. A breast authored as a 0.040 H sphere with a 0.03 H blend is `k`
at three quarters of `r`, and the female figure came out with flat pectorals.
Cutting the blend to roughly a third of the radius keeps the join soft and the
shape present. The same mistake, made again on the genital geometry and the
hands, produced the same result both times.

That bug also hid another one. The oversized bust blend had been inflating the
surface at shoulder level as a side effect, so the chest depth *looked* close to
the anthropometric target while actually being authored 20mm short — for **both**
body types, not just the one with the blend. Fixing the blend exposed it. A
measurement propped up by an unrelated defect is worth more suspicion than a
measurement that is simply wrong.

## The torso trick

A torso is not round. But every primitive has to stay circular in
cross-section, or the exact-distance property is lost.

The resolution: build the torso from horizontal capsule **slabs** stacked along
the spine. A capsule spanning the body's width has a *stadium* cross-section —
breadth = 2·(halfWidth + radius), depth = 2·radius — and smooth-unioning a stack
of them yields the elliptical section a real torso has, while every primitive
individually stays circular and exact.

The useful side effect is that sections are authored as **breadth and depth**,
the same terms anthropometric tables use, so they can be checked directly
against a measurement of the rendered surface instead of tuned by eye.

## Flattened parts: three rails

The same constraint bites harder on a hand, a foot or a skull. A round cone is
circular across its axis, so one of them cannot be a flattened shape at all: it
has two numbers, length and radius, where a paddle needs three.

Rails give the third. Run several cones down the length of the part, spread
across its width: the rail axis carries **length**, the spread between rails
carries **breadth**, and the radius carries **thickness**. Stacking flattened
pills down the part instead — the obvious first attempt — renders as a string
of visibly separate pads, because consecutive pills only meet near a point and
the blend has nothing to work with there.

There are **three** rails, not two, and the reason is arithmetic. With two,
breadth = separation + 2r, while overlapping at all demands separation ≤ 2r, so
breadth can never exceed 4r. A 0.044 H hand is then stuck at 0.022 H thick, and
pushed to that ceiling the rails meet in a razor-thin lens. A thin sharply
curved sheet is the one shape dual contouring samples badly — it cost inverted
triangles at 20mm and nearly doubled the worst surface error. A middle rail
lifts the ceiling to 6r, which buys deep overlaps at the true breadth *and* the
true thickness together.

The skull uses the same idea rotated: a capsule spanning **z** is circular in x
and y, so 2r sets the breadth across the head while the span sets the depth
independently. Head breadth is 0.089 H, length front to back 0.114 H and height
0.130 H — three numbers a sphere can satisfy at most one of, which is most of
why a ball on a neck reads as an egg on a stick.

### Which local axis carries the breadth is not a free choice

It has to match the rig's joint axes, and getting it wrong is invisible until
something bears weight. The wrist's `flexion` channel rotates about the bone's
local **x**, so x must be the axis through the knuckles for flexion to bend the
palm towards the forearm. Built the other way round — breadth along z — flexion
becomes sideways deviation instead, and *no* combination of joint angles can
lay the palm flat: `all_fours` rendered with both hands standing on edge like a
chop, thumbs out sideways. The foot follows the same convention, breadth across
x, which is what makes ankle flexion plantarflex rather than waggle.

### A flat sole

Pairing each cone end's `y` with its `r` so that `y − r` is the same constant at
both ends makes the sole genuinely planar, because a round cone interpolates
centre and radius linearly — so `y − r` holds that constant the whole length
rather than scalloping between the ends. The constant is `−P.ankleHeight`,
which is what makes a standing figure stand rather than hover or sink.

## The two documented approximations

Not everything in `body.js` is exact, and the inexact parts are deliberate.

| function | what it does | exact when | worst error on a taper |
|---|---|---|---|
| `closestOnVolume` | closest surface point + outward normal, used to place hands on partners | `ra === rb` | **5.1mm inside** |
| `capsuleContact` witness points | where two volumes touch | `ra === rb` | **0.3mm inside** |

Both treat a round cone as a capsule whose radius varies linearly along the
axis, which is not quite the true surface of a taper. Both were measured, not
estimated.

The important property is the **sign**: both err *inside* the drawn surface. A
hand placed on a contact point therefore touches, or presses very slightly in —
never floats. The opposite error would be visible as a gap. Both are also far
below the solver's 10mm default compression allowance, so neither is
distinguishable in a finished contact.

`tests/collision.test.js` pins both, with a per-shape tolerance that is `1e-9`
when the radii match and the measured value when they do not — so a change that
makes the approximation worse fails, and the known residue does not.

## Normals

`bodyNormal` is the central-difference gradient of `bodyDistance`, normalised,
with `h = 1e-3`. Because the field is exact and smooth, this is the true surface
normal — meshed normals are not interpolated from triangle faces, so they stay
correct through the smooth-union blend regions where face normals would visibly
facet.

## Self-overlap is anatomy, not error

Body primitives are *authored* to overlap where they meet: the two thighs meet
across the pelvis, the deltoid sinks into the ribcage, the forearm folds into
the upper arm. Smooth-union turns that overlap into the surface we want.

Reporting it as penetration would be reporting the body's own anatomy as an
error, so each volume carries a precomputed `selfIgnore` set — every other
volume within `AUTHORED_OVERLAP_JOINTS = 2` joints on the skeleton. Everything
beyond that radius collides for real, which is why a hand cannot pass through
its own chest.

The set is precomputed at build time, so the narrow-phase inner loop pays only a
hash lookup.

# Meshing

`src/render/meshBuilder.js`. Turns the signed distance field into triangles.
No dependencies — it runs in plain Node, which is why `scripts/validate-mesh.mjs`
can measure it and `scripts/render-cli.mjs` can draw it without a browser.

## Why dual contouring

Marching cubes emits vertices on grid **edges**; dual contouring emits one
vertex per **cell**, positioned where the surface actually is. For a body that
matters because marching cubes cannot represent a feature thinner than a cell
without staircasing, and fingers, noses and the crease where two bodies meet are
all thin features.

The cost is that dual contouring is easier to get wrong: the usual
cell-by-cell formulation lets neighbouring cells disagree about whether to emit
a face between them, and the result is a mesh with holes.

## Stitching from edges, not cells

The fix is to invert the loop. Instead of asking each cell "which faces do I
emit?", ask each **sign-changing grid edge** "which quad surrounds me?":

```
for every grid edge (x, y and z directions):
    if the field changes sign across it:
        emit a quad from the 4 cells that share that edge
        wind it by the direction of the sign change
```

An edge either crosses or it does not. Neighbouring cells cannot disagree,
because they are no longer the ones deciding. The mesh is therefore **watertight
and consistently wound by construction** rather than by a cleanup pass.

That is a testable claim, and `tests/mesh.test.js` tests it rather than trusting
it:

- every directed edge appears **exactly once**, and its reverse is present
  (zero duplicates, zero boundary edges)
- **V − E + F = 2 × components** — checked for a sphere, for two separate blobs
  (χ = 4), and for a limb joined to a torso (χ = 2)
- signed volume is positive and within 2% of the analytic sphere, converging on
  refinement — which is what proves the winding is *outward* rather than merely
  consistent

Because the surface is already known to be closed, `E` is computed exactly as
`3F/2` rather than by enumeration.

## Vertex relaxation

The cell vertex is placed at the centroid of the cell's edge crossings. Each
crossing is a linear guess at where a curved surface crosses, so the centroid
sits slightly *inside*.

One Newton step fixes it:

```js
d = bodyDistance(p)
p -= bodyNormal(p) · clamp(d, -step, step) · relax
```

The step length is just `d`, with no line search, **because the field is an
exact distance** — this is the concrete pay-off of the exactness property from
[geometry.md](geometry.md). With a merely-bounding field this step would
undershoot and need iteration.

Measured at 12mm on a standing female:

| | worst vertex offset | mean error | build |
|---|---|---|---|
| `relax: 0` | 0.72mm | 0.49mm | 152ms |
| `relax: 1` | 0.00mm | 0.21mm | 284ms |

It more than halves the error, and it is **not cheap — about 86% on top of the
build**. That cost is the main reason meshing runs in a Worker rather than on
the main thread. It is still the right trade: getting the same accuracy by
refining the grid instead would cost far more than 86%, since field sampling
scales with the cube of resolution.

## Resolution

`node scripts/validate-mesh.mjs`, standing female:

| resolution | vertices | triangles | build | mean error | worst |
|---|---|---|---|---|---|
| 20mm | 5,338 | 10,676 | 147ms | 0.59mm | 8.18mm |
| **12mm** (default) | 14,919 | 29,836 | 334ms | 0.21mm | 2.85mm |
| 8mm | 33,586 | 67,168 | 695ms | 0.09mm | 1.05mm |

Across all 18 postures at 12mm: worst surface error 2.51mm, every mesh closed
and outward-facing.

At coarse resolutions a handful of triangles can pinch — one edge shared by two
sheets of surface that happened to pass through the same cell. This is the
documented cost of one vertex per cell. The validator gates it on a *rate*
(0.02% of edges) rather than on zero, so a change that makes it materially worse
fails while the known residue does not.

## Sampling the field efficiently

A body is ~31 primitives, but no point is near more than a handful. The naive
loop spends its whole time proving that an ankle is far from an ear.

`sampleField` bins primitives into 8³ blocks by their padded bounds first. The
inner loop then evaluates ~5 round cones instead of 31, and blocks no primitive
reaches are skipped outright rather than sampled and discarded.

The subsets keep volumes in their **original order**, because `bodyDistance`
folds its smooth minimum sequentially and the result depends on that order.
Culling never changes the answer beyond the blend tolerance it is derived from:
a primitive outside the padded block cannot influence the fold.

## Normals

From the field gradient, not from averaged face normals.

Averaging approximates the surface the *triangles* happen to form; the gradient
is the surface the *body* actually has. The difference shows exactly where
triangle density is lowest and averaging looks worst — the smooth-union blend
seams at shoulders and hips.

A test checks that normals are unit-length, radial on a sphere, and agree with
the triangle winding.

## Ambient occlusion

Five field evaluations per vertex, no rays, no acceleration structure, no second
pass:

```js
for s in 1..5:
    reach = s · step · 1.6
    occlusion += weight · max(0, reach - bodyDistance(p + normal·reach))
    weight *= 0.62
```

March out along the normal and compare how far the surface *should* be with how
far it actually is. The gap measures how much of the body is folded back over
that point.

Because it reads the same field as everything else, the contact shadow where two
bodies meet appears **exactly where the solver put the contact**. That crease is
most of what makes a pair of figures read as touching rather than as two
separate renders composited together — and it is unavailable to the reference
system, whose collision proxy and drawn geometry are different shapes.

Measured: 1.000 on a lone sphere, 0.117 in a crease, always within [0, 1],
`null` when `ao: false`.

## Edge cases

- An empty volume list returns an empty mesh, not a throw.
- Every index is in range; no degenerate triangles; no NaN.
- Reported `bounds` always contain the mesh.

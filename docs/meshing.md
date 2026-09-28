# Meshing

`src/render/meshBuilder.js`. Turns the signed distance field into triangles.
No dependencies — it runs in plain Node, which is why `scripts/validate-mesh.mjs`
can measure it and `scripts/render-cli.mjs` can draw it without a browser.

The field is the collider and the source of the shading, but it is not what the
viewport draws — see [The drawn body](#the-drawn-body) at the end.

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
| 20mm | 5,681 | 11,364 | 199ms | 0.59mm | 10.29mm |
| **12mm** (default) | 15,792 | 31,580 | 471ms | 0.22mm | 2.79mm |
| 8mm | 35,548 | 71,092 | 1070ms | 0.10mm | 1.22mm |

Across all 18 postures at 12mm: worst surface error 3.82mm, every mesh closed
and outward-facing.

Error tracks the **smallest feature on the body**, not the quality of the
mesher. A triangle's centroid sags off a curved surface by roughly
`edge^2 / 8r`, so whatever is sharpest sets the worst number. Hands, feet and
genital geometry carry radii of 12-25mm against a 12mm cell; before they
existed nothing on the body was tighter than a wrist at ~35mm, which is the
whole of the difference between the 2.51mm this table used to report and the
3.82mm it reports now. Halving the cell to 8mm takes it to 1.22mm.

The thumb is a worked example. Built at a 12mm tip radius it alone drove the
12mm worst error from 3.02mm to 4.37mm. Rebuilt blunter, at 16mm, it reads
better *and* measures 2.79mm - below the no-thumb figure, because the thicker
cone also fills the crevice where the thumb meets the palm. Shrinking the blend
radius to match these small features was tried first and made things worse: a
small `k` leaves sharp concave creases between the rails that make up a hand,
and a crease is high curvature too.

At coarse resolutions a handful of triangles can pinch — one edge shared by two
sheets of surface that happened to pass through the same cell. This is the
documented cost of one vertex per cell. The validator gates it on a *rate*
(0.02% of edges) rather than on zero, so a change that makes it materially worse
fails while the known residue does not.

## Sampling the field efficiently

A body is ~48 primitives, but no point is near more than a handful. The naive
loop spends its whole time proving that an ankle is far from an ear.

`sampleField` bins primitives into 8³ blocks by their padded bounds first. The
inner loop then evaluates a handful of round cones rather than all, and blocks no primitive
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

Five field evaluations per vertex plus one at the vertex itself, no rays, no
second pass:

```js
base = bodyDistance(p)
for s in 1..5:
    reach = s · step · 1.6
    free  = (bodyDistance(p + normal·reach) - base) / reach
    occlusion += weight · clamp(1 - free, 0, 1)
    weight *= 0.62
shade = 1 - strength · (1 - e^(-gain · occlusion / total))
```

March out along the normal and compare how far the surface *should* be with how
far it actually is. The gap measures how much of the body is folded back over
that point.

Two details carry more weight than they look:

**The samples are measured against the field's value at the vertex**, not
against zero. That costs one more evaluation and buys the ability to shade a
surface that is not the field's own — the scanned body sits a centimetre or two
inside the field down the outside of an arm, and reading the raw distance there
makes every sample look buried, painting a hard black stripe the length of the
limb. Taking the difference cancels the offset, so what is measured is
curvature and nearby geometry instead of which side of the field a vertex is on.

**The sum is shaped by `1 - e^-gain`** rather than used linearly. A linear scale
is both too weak and unbounded: a right-angled crease only blocks a third of the
normal's reach and has to read much darker than a third to look like a crease,
and the scanned mesh has folds tight enough — under a breast, the groin, between
the thighs — to run any linear scale past its range, where it clamps and turns
each of them into a flat black hole with a hard edge.

Because it reads the same field as everything else, the contact shadow where two
bodies meet appears **exactly where the solver put the contact**. That crease is
most of what makes a pair of figures read as touching rather than as two
separate renders composited together — and it is unavailable to the reference
system, whose collision proxy and drawn geometry are different shapes.

`fieldOcclusion` bins the volumes the same way `sampleField` does, through
`binVolumes`, because its callers walk a list of arbitrary points rather than a
grid. The padding is what makes it safe: a caller samples up to `reach` from the
point it looks up, so a volume is filed under every cell its bounds reach once
grown by *both* its blend radius and that reach. Measured against the uncalled
loop over a posed scanned body: 4× faster, mean shade difference 1.7e-6, worst
9.4e-3 — inside the blend tolerance the culling is derived from.

Measured: 1.000 on a lone sphere, 0.117 in a crease, always within [0, 1],
`null` when `ao: false`.

## The drawn body

The field is not what the viewport draws. `src/core/humanMesh.js` loads a
scanned human model, binds it to the same skeleton the volumes are built from,
and skins it per pose; the field stays underneath as the collider and as the
source of the occlusion above. Making the mesh's joints coincide with *our*
joint positions is what keeps the two in agreement — there is no second rig and
no retargeting step to drift.

Three things had to be corrected before it looked like a person rather than a
mannequin, and two of them turned out to affect every render rather than just
the head:

**The export is flat-shaded.** 46,658 vertices over 13,380 distinct positions,
and at 99.6% of those positions the copies disagree — by 25° on average, up to
166°. The exporter splits every vertex, so boundary-edge detection also reports
46,646 boundary edges on a closed mesh. `smoothNormals` welds on quantised
position first, then averages the incident faces weighted by area, skipping any
face more than 70° from the vertex's own normal so a genuine hard edge survives.

**The colours were sRGB used as linear reflectance.** The shading pipeline is
linear-light, so an authored `0.86` was about a third too high, worst in the
darkest channel — which crushes hue and pushes everything into the tonemap
shoulder. One `toLinear` pass over the authored albedos fixes it.

**The eyes.** The models *do* ship eyeballs, in a proxy submesh; what did not
survive the export is their texture, so every vertex carried one flat dark iris
brown and each eye read as a dark slit. `splitEyes` fits a sphere to each globe
by least squares, takes the gaze axis from the fitted centre to the cap
centroid, and cuts the mesh into a white, an iris and a pupil by angle from that
axis — assigning each triangle to the narrowest zone all three of its corners
reach, so the limbus lands on an edge rather than cutting across faces. The
limbus angle is not guessed: the iris is modelled as a dish, 2.4mm deep at the
pole, and 18° is where it crosses back through the fitted sphere. It measures
identical on both eyes of both models. The dish's normals are replaced with the
fitted sphere's radial normal, because under a flat colour, with no texture to
refract, they read as mottled facets rather than as an iris.

The eyes also carry their own baked occlusion rather than the field's, since the
field has no eye socket in it to shade them with.

## Finer than the scan

The scans are cut for a body at rest, and sparingly where it is smooth: across
a shoulder, a breast or a buttock the edges run past two centimetres and up to
nearly six. Shading hides that, because the normals are interpolated, but the
outline cannot, and nor can the shadow's edge. Close up, a kneecap drawn
against the floor is a run of straight chords with a corner between each.
Posing makes it worse by bending edges that were straight in the scan.

So the final pass splits them (`src/core/tessellate.js`). Each posed edge is
held against the curve its ends' normals say it follows, the PN-triangle cubic
(Vlachos et al., 2001). Where the curve's midpoint stands more than 0.2 mm off
the chord, the edge is split there and the triangles either side into two,
three or four, and the halves are tried again once. 0.2 mm is a tenth of a
pixel with the pair framed, and about half of one at the closest the camera
comes.

- **The edge in space decides.** Both triangles on an edge split alike, so
  nothing cracks. A UV seam draws one edge twice, from two sets of vertex
  copies. The copies are matched by where they are in the scan, and they share
  one midpoint, each with its own UV.
- **Creases are followed along their line.** The sole of a foot meeting its
  side, the lips, a garment's face meeting its hem wall: the midpoint follows
  the line the two sides meet in, square to both normals.
- **Skin under cloth is left alone.** Each garment was cut from the skin's
  chords, and a stocking stands barely a millimetre off them. Rounding the skin
  there would push it through. The cloth over it is rounded instead, where it
  bulges and never into a hollow, which is also what cloth does.
- **It is drawing only.** The solver, the contacts and the occlusion all work
  on the scan's own vertices. A new vertex takes the mean of its ends' normals,
  UVs, trim and occlusion, so only the shape between the old vertices changes.

On kneeling missionary the pair goes from 132,232 triangles to 222,820:

| part | scan | drawn |
|---|---|---|
| female skin | 21,900 | 48,772 |
| male skin | 21,736 | 53,002 |
| clothing, per piece | 12,336–31,423 | 21,356–38,361 |

Cutting them takes about a quarter of a second for the first scene and a
tenth after, done while the helpers shade, and the final pass comes back about
a quarter of a second later on four cores. The draft is not split. Clearance from cloth to skin is unchanged for the bra, the tops and
most of the briefs. Over the legs, stockings stand at least 0.6 mm off the
skin where they stood 0.8. Two vertices at a man's toes dip 0.1 mm into it.
Where the pose already presses a thigh into the briefs, the rounder cloth runs
up to 1.5 mm further in, on the same few vertices.

## Faster, to the same numbers

None of this changes what is computed. The final meshes for a pose hash the
same before and after, position for position, normal for normal and shade for
shade; `tests/bodyField.test.js` and `tests/meshDistance.test.js` pin the
parts.

- **The field is bound once.** `bodyField(volumes)` works out each round
  cone's own terms - its axis, its length, its taper - once, into one flat
  array, and leaves the per-point loop only what depends on the point. Term
  for term and in the same order it is `roundConeDistance` and `smoothMin`, so
  it is `bodyDistance` to the last bit. Meshing, the occlusion and the feature
  relief each ask a fixed set of volumes for millions of points.
- **The relief spreads only where it has reached.** Of `relaxDisplacement`'s
  hundred passes over the skin, most averaged zeros into zeros. It now sweeps
  the displaced vertices and the ring round them, a ring further each pass, in
  the same order the whole sweep went.
- **The contact tree sorts flat arrays.** `buildTriangleTree` splits each node
  with a stable merge sort of the centres, which is the order `Array.sort` gave
  them, ties and all, so it is the same tree without a comparator call for
  every pair.
- **The occlusion is shared out.** It is the slowest thing the final pass does,
  and each vertex reads only its own position and normal and the volumes, so
  `src/workers/occlusionPool.js` cuts the vertices into runs of 16,384 and has
  helper workers shade them - the cores less two, from one to six, so two on
  four cores - and puts back exactly what one thread would have written. Each
  helper holds the run it is on and the next, so it goes straight on while the
  body worker is busy, and a scene given up for a newer one stops soon. Without
  nested workers the runs are shaded in the body worker.
- **The shadow map is drawn when it changes.** The key light's map is 2048px
  square and holds every triangle of both figures, and it is the same from any
  camera. An orbit or a tour redraws the figures but not the map. It is drawn
  again after a new scene or framing, a texture arriving (hair cards and lace
  cast through their cut-outs), or a wall coming or going with what stands
  against it. Exports that hide the room redraw it before and after.

Measured on kneeling missionary and spooning, on four cores:

| step | before | after |
|---|---|---|
| building the dressed templates, first load | 6.6 s | 4.3 s |
| rendered-surface contact steps | 1.3–2.2 s | 0.5–1.0 s |
| final-pass occlusion | 2.4–2.7 s | 1.1–1.3 s, across the helpers |

The cached shadow map draws the same pixels as redrawing it every frame, and
an orbit frame takes about 9% less under software GL.

## Edge cases

- An empty volume list returns an empty mesh, not a throw.
- Every index is in range; no degenerate triangles; no NaN.
- Reported `bounds` always contain the mesh.

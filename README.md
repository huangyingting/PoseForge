# PoseForge

Type a sentence describing how two people are positioned. Get a correct 3D render
of it, and a 2D image you can export.

```
npm install
npm run dev          # webapp on :5173
npm test             # 108 tests
node scripts/render-cli.mjs "she is bent over the table, he stands behind her"
```

The pipeline is one direction, end to end:

```
  text  ──▶  scene spec  ──▶  posed skeletons  ──▶  contact solve  ──▶  SDF  ──▶  mesh  ──▶  PNG / SVG
  parser      scene.js         poseLibrary         collision.js      body.js   meshBuilder  exporters
```

---

## What this is, and what it replaces

`../SexPoses` renders human poses in 3D too. This is a rebuild aimed at three
things it could not do: read a description, collide bodies properly, and draw a
surface rather than a pile of primitives.

| | `../SexPoses` | here |
|---|---|---|
| **Input** | pick one of 9 authored poses | free text, English or Chinese |
| **Body geometry** | separate three.js sphere and capsule meshes | one signed distance field over 31 round cones |
| **Collision proxy** | 3 ellipsoids per body (torso, hips, head), unrelated to what is drawn | the drawn surface itself |
| **What can collide** | limb endpoints and 1–2 samples along each limb, against those 3 ellipsoids | every volume against every volume, including torsos |
| **Surface** | primitives interpenetrating at the joints | watertight manifold isosurface, no visible seams |
| **Ambient occlusion** | none | sampled from the same field |
| **Export** | canvas PNG, `SVGRenderer` | PNG and SVG from the browser, plus a headless CLI renderer |
| **Verification** | none | 108 unit tests + 4 validators that measure geometry |

The central design decision is the one in the third and fourth rows. In the
reference system, the thing you see and the thing that collides are two
different approximations of a body, so a hand can rest visibly inside a thigh
while the solver believes it is a clear 60mm away — the thigh is not in the
collision set at all. Here there is one surface. If two bodies overlap on
screen, the solver saw that overlap; if the solver says a hand touches a hip,
it touches the hip you can see.

---

## The unified field

A body is 31 **round cones** — a cone with a sphere at each end, the exact
shape a limb segment wants — sized from anthropometric fractions of stature.
`roundConeDistance` in `src/core/body.js` is an *exact* signed distance, not a
bound, which is what makes the whole architecture affordable:

- **Rendering**: sphere tracing can step the full distance without overshooting.
- **Meshing**: one Newton step along the gradient puts a vertex on the surface.
- **Collision**: the narrow phase is the field, so contacts are exact.
- **AO**: occlusion is the same field sampled over a hemisphere.

That exactness is measured, not asserted. `tests/collision.test.js` takes a
probe point, steps `d` down the field's own gradient, and checks where it
lands — `1e-17` from the surface for a capsule, a 0.05→0.16 taper, and a
degenerate sphere.

Bodies are the smooth union (`smoothMin`) of their cones, so shoulders and hips
blend instead of creasing. The blend radius is per-volume, so a wrist joins
tightly where a shoulder joins softly.

### Two deliberate approximations

Both are documented, measured and pinned by tests, and both err in the same
direction — *inside* the drawn surface, so a hand placed on a contact point
touches rather than floats:

| | exact when | worst error on a taper |
|---|---|---|
| `closestOnVolume` | `ra === rb` | 5.1mm inside |
| `capsuleContact` witness points | `ra === rb` | 0.3mm inside |

Both are well under the 10mm default compression allowance the solver works
with, so neither is visible in a contact.

---

## Collision

`src/core/collision.js`. Broad phase bins volumes by padded bounds; narrow phase
is capsule/capsule and capsule/box against the field. What makes it more than a
push-apart loop:

- **Soft tissue compresses.** Flesh is allowed to overlap by a budget that
  depends on what is touching: a declared contact ("her hands on his chest") may
  overlap 22mm because hands press in; the same overlap between two shins is a
  defect. `COMPRESSION` carries a separate budget for declared contacts (22mm),
  soft volumes (18mm) and everything else (10mm).
- **Corrections carry torque.** `rigidCorrection` returns a linear *and* angular
  response, symmetric between the two bodies, so pushing a pelvis out of a thigh
  rotates the body rather than sliding it through the floor.
- **Self-collision is selective.** `selfIgnore` exempts pairs that are supposed
  to touch — adjacent bones, a hand against its own forearm — so the solver does
  not spend its budget fighting the rig's own anatomy.
- **Contacts are declared, not guessed.** An unmet contact is reported rather
  than silently dropped, and the CLI and webapp both print the count.

---

## Meshing

`src/render/meshBuilder.js`. Dual contouring, with one change that matters:
**faces are stitched from edges, not from cells.** Every sign-changing grid edge
emits a quad from the four cells around it, which makes the result watertight
and consistently wound *by construction* rather than by cleanup.

That claim is a test, not a comment. `tests/mesh.test.js` checks that every
directed edge appears exactly once with its reverse present, and that
V − E + F = 2 per connected component — for a sphere, for two separate blobs, and
for a limb joined to a torso.

Measured on a standing female (`node scripts/validate-mesh.mjs`):

| resolution | vertices | triangles | build | mean error | worst |
|---|---|---|---|---|---|
| 20mm | 5,338 | 10,676 | 147ms | 0.59mm | 8.18mm |
| 12mm *(default)* | 14,919 | 29,836 | 334ms | 0.21mm | 2.85mm |
| 8mm | 33,586 | 67,168 | 695ms | 0.09mm | 1.05mm |

Vertex relaxation — one Newton step onto the true surface — is what buys the
accuracy: at 12mm it more than halves mean error, from 0.49mm to 0.21mm. It is
not free — it costs about 86% on top of the build (152ms → 284ms), which is the
main reason meshing runs in a Web Worker rather than on the main thread. Across
all 18 postures at 12mm the worst surface error is 2.51mm and every mesh is
closed and outward-facing.

Meshing runs off the main thread, so typing never blocks the viewport.

---

## Reading the text

`src/nlp/`. A 565-phrase lexicon plus 12 archetypes ("missionary", "cowgirl",
"spooning") over a catalogue of 18 postures, 10 arrangements and 6 surfaces.
233 of those phrases are Chinese; `她跪在他身后` parses without spaces.

The rules that do the real work:

- **Longest phrase wins.** "on her back" is a posture; "back" is a body part.
  "on the bed" is a surface; "bed" is a noun. Longest-first matching over a
  claimed-span bitmap is the whole disambiguation strategy.
- **A turn is relative.** "Facing away" is half a turn from *that arrangement's*
  own default, which differs per arrangement — turning to face a standing
  partner is 180°, turning to face one lying on their back is 0°. Reading it as
  a fixed 180 makes reverse cowgirl mean forwards.
- **Modifiers attach to the nearest person in either direction.** English puts
  the adjective first ("a tall man"), but not always ("he is tall").
- **Declaration beats inference.** Arrangements carry explicit `clear`, `turn`,
  `carried` and `mounted` flags rather than having the solver work them out.
- **Nothing throws.** Every input — `""`, `null`, `12345`, 5000 characters of
  `a` — produces a scene the solver accepts. The webapp parses on every
  keystroke, so half-typed words are the common case.
- **Guesses are labelled.** Anything the parser filled in appears in
  `interpretation` with the phrase that caused it, or a note saying it was
  assumed. Anything it could not read appears in `warnings`.

---

## Solving

`src/core/solver.js`. Postures are authored as joint angles plus a **support
set** — the parts that bear weight. Seating is not "drop until something
touches" but "the declared supports are the lowest thing on the body, and all of
them touch", which is what lets a kneeling figure's trailing feet be lifted
rather than driven through the floor.

Surfaces carry **two heights**: `height` is the prop top where a trunk rests,
`ground` is where feet and knees go. They are equal for things you get on top of
(floor, bed, sofa) and differ for things you stand beside (chair, table, bench) —
which is how someone bent over a table has their chest at 750mm and their feet
at 0.

IK is two-bone analytic with a pole hint, so elbows and knees bend the right
way instead of wherever the seeding lands them. Out-of-reach targets report
`unreachable` with an honest residual rather than silently stretching a limb.

---

## Verification

```
npm test                        # 108 tests across 8 files
node scripts/validate-text.mjs      # 34/34 parsed as expected, 34/34 geometrically sound
node scripts/validate-scenes.mjs    # 126/156 sound, worst penetration 91mm, 8s
node scripts/validate-postures.mjs  # all postures within tolerance, worst support gap 13mm
node scripts/validate-mesh.mjs      # all meshes closed and outward, worst error 2.51mm
```

The validators are the part worth trusting. They pose real bodies and measure
geometry — support gaps, penetration depth, unmet contacts, surface error,
Euler characteristic — rather than checking that functions return values.

**Known residuals.** `validate-scenes` reports 30 of 156 scene variants as not
fully sound: residual penetration peaks at 91mm in `rear_alignment`, 55mm in
`face_to_face` and 42mm in `head_to_toe`, and the `head_to_toe` pair leaves its
head↔pelvis contacts unclosed. These are reported, not hidden — every unmet
contact appears in the solve result and is printed by both the CLI and the app.

---

## Output

The webapp exports **PNG** (`exportPNG`, with scale, transparency and
ground-plane options) and **SVG** (`exportSVG`, a vector silhouette with
outlines). `scripts/render-cli.mjs` does the same headless — a software
rasteriser with a z-buffer, shadow map and zlib PNG encoder, no GPU and no
browser:

```
node scripts/render-cli.mjs "missionary on the bed"
node scripts/render-cli.mjs "spooning" --view top --out top.png
node scripts/render-cli.mjs "cowgirl" --svg
```

It is deliberately a *second* implementation of the shading rather than shared
code, because a second implementation is what catches geometry being in the
wrong place — figures facing backwards, a body inside the mattress. A render
takes about 1.5s.

---

## Layout

```
src/core/      math, skeleton, IK, body field, collision, pose catalogue, solver
src/nlp/       lexicon, archetypes, parser
src/render/    mesh builder, WebGL renderer, props, exporters
src/workers/   meshing off the main thread
src/app/       webapp: panel, viewport, export
scripts/       headless renderer and the four validators
tests/         node:test, no framework
docs/          design documentation
```

`src/core/`, `src/nlp/`, `src/render/meshBuilder.js` and `scripts/` have **no
dependencies at all** — not even three.js. Everything geometric runs in plain
Node, which is why the validators exist and why the CLI can render without a
browser. three.js appears only in `src/render/renderer.js`, `props.js`,
`exporters.js` and the app. `tests/architecture.test.js` enforces the boundary.

---

## Design documentation

`docs/` carries the reasoning, the measurements, and the things that were tried
and rejected:

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | pipeline, module map, and the three invariants everything rests on |
| [docs/geometry.md](docs/geometry.md) | the SDF: round cones, exactness, smooth union, the two documented approximations |
| [docs/collision.md](docs/collision.md) | broad/narrow phase, compression budgets, translation *and* torque |
| [docs/solver.md](docs/solver.md) | support sets, two-height surfaces, arrangements, the annealed loop |
| [docs/meshing.md](docs/meshing.md) | dual contouring from edges, relaxation, field-sampled AO |
| [docs/language.md](docs/language.md) | lexicon, scanner, attachment rules, why a turn is relative |
| [docs/validation.md](docs/validation.md) | what the tests and validators measure, and the known residuals |

## Scope

Figures are rendered as **unclothed mannequins**: anthropometric proportions,
smooth surfaces, no genital or facial detail. `buildBodyVolumes` takes a `bust`
parameter and nothing else anatomical. The reference system models explicit
anatomy (`createAdultAnatomy` in `../SexPoses/src/fullBodyRig.js`); this one
deliberately does not, because none of it is load-bearing for the problem the
system solves — which is whether two bodies are positioned correctly relative to
each other.

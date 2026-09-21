# PoseForge

PoseForge includes a responsive pose studio with 23 catalog entries: eleven
clothed reference studies and the twelve existing named position definitions.
The **Positions** collection makes those definitions searchable by their original
English and Chinese aliases. Solved joint diagrams show the figures together,
including their support props; pose notes identify unresolved geometry.

Figure/contact editing, favorites, saved presets, undo/redo and JSON import/export
let you build a personal library. The viewport supports drag/keyboard orbit,
pinch/wheel/button zoom, natural and clay materials, and PNG/SVG export.

The joint editor shows both requested and solved angles. **Keep edited angles**
preserves specified channels when authoring precise poses; unedited channels and
placement remain adjustable, and conflicting constraints stay visible as notes.

Start from **New study**, name your figures, and use **Scene → Partner contacts**
to author gestures with figure/body-part pickers and measured target feedback.
Choose **My contacts only** to build a composition without the arrangement's
default contacts. **A helping hand** is a working example you can edit and save.

**Start here:** [studio design](docs/studio-redesign.md) ·
[catalog and extension guide](docs/catalog.md) ·
[importable example](examples/reference-study.json).

```sh
npm ci
npm run dev
npm test
node scripts/validate-surface-contacts.mjs
# Existing named definitions still have geometry issues; this audit reports them:
node scripts/validate-named-presets.mjs
node scripts/validate-named-presets.mjs --rendered
node scripts/validate-named-presets.mjs --catalog --rendered
npm run build
npx playwright install chromium
npm run test:browser
```

For an installed Chrome, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when running
the browser suite. Tests cover real library/editor/export flows at desktop and
mobile sizes. Saved studies live in this browser; download JSON for a backup.
New bundled studies are non-graphic references. The existing engine documentation
below includes its broader vocabulary and historical measurements; those are
not claims that every composition is geometrically valid.

Type a sentence describing how figures are positioned to get a 3D pose preview
and a 2D image you can export. Pose checks report unresolved constraints.

```
npm install
npm run dev          # webapp on :5173
npm test             # 276 tests
node scripts/render-cli.mjs "a woman seated on a chair wearing clothes"
```

The pipeline is one direction, end to end:

```
  text  ──▶  scene spec  ──▶  posed skeletons  ──▶  contact solve  ──▶  SDF  ──▶  mesh  ──▶  PNG / SVG
  parser      scene.js         poseLibrary         collision.js      body.js   meshBuilder  exporters
```

---

## What this is, and what it replaces

This section records the original SDF engine design. The current studio also
uses skinned human meshes and clothing, with separate coarse and rendered
contact/support measurements. See [studio verification](docs/studio-verification.md)
for current coverage and outstanding geometry issues.

`../SexPoses` renders human poses in 3D too. This is a rebuild aimed at three
things it could not do: read a description, collide bodies properly, and draw a
surface rather than a pile of primitives.

| | `../SexPoses` | here |
|---|---|---|
| **Input** | pick one of 9 authored poses | free text, English or Chinese |
| **Body geometry** | separate three.js sphere and capsule meshes | one signed distance field over ~48 round cones |
| **Collision proxy** | 3 ellipsoids per body (torso, hips, head), unrelated to what is drawn | the drawn surface itself |
| **What can collide** | limb endpoints and 1–2 samples along each limb, against those 3 ellipsoids | every volume against every volume, including torsos |
| **Surface** | primitives interpenetrating at the joints | watertight manifold isosurface, no visible seams |
| **Ambient occlusion** | none | sampled from the same field |
| **Export** | canvas PNG, `SVGRenderer` | PNG and SVG from the browser, plus a headless CLI renderer |
| **Initial engine verification** | none | 108 unit tests + 4 validators; see the current studio report for later coverage |

The central design decision is the one in the third and fourth rows. In the
reference system, the thing you see and the thing that collides are two
different approximations of a body, so a hand can rest visibly inside a thigh
while the solver believes it is a clear 60mm away — the thigh is not in the
collision set at all. The SDF path derives its surface from that collision field.
The later skinned-mesh path requires its separate rendered measurements;
a small coarse target error is not proof of visible contact or grounded support.

---

## The unified field

A body is 47–49 **round cones** — a cone with a sphere at each end, the exact
shape a limb segment wants — sized from anthropometric fractions of stature.
The count varies with body type, because the bust and the genital geometry are
per-type. `roundConeDistance` in `src/core/body.js` is an *exact* signed
distance, not a bound, which is what makes the whole architecture affordable:

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
| 20mm | 5,681 | 11,364 | 199ms | 0.59mm | 10.29mm |
| 12mm *(default)* | 15,792 | 31,580 | 471ms | 0.22mm | 2.79mm |
| 8mm | 35,548 | 71,092 | 1070ms | 0.10mm | 1.22mm |

Vertex relaxation — one Newton step onto the true surface — is what buys the
accuracy: at 12mm it more than halves mean error, from 0.49mm to 0.22mm. It is
not free — it costs about 86% on top of the build, which is the main reason
meshing runs in a Web Worker rather than on the main thread. Across all 18
postures at 12mm the worst surface error is 3.82mm and every mesh is closed and
outward-facing.

**Error tracks the smallest feature, not the mesher.** A triangle's centroid
sags off a curved surface by roughly `edge² / 8r`, so the sharpest thing on the
body sets the worst number. Hands, feet and genital geometry have radii of
12–25mm against a 12mm cell, where the old handless, heelless body had nothing
tighter than a wrist — which is the whole of the difference between the 2.51mm
this used to report and the 3.82mm it reports now. Halving the cell to 8mm
takes it to 1.22mm. It is resolution-limited detail rather than a defect, and
it stays well inside the solver's 10mm compression budget either way.

At 20mm a few triangles do come out inverted, because features that size are
below the cell. The per-posture pass at 12mm gates on that and is clean.

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

See [studio verification](docs/studio-verification.md) for current results,
browser coverage, and the remaining acceptance gaps.

```
npm test                                  # units, catalog and geometry regressions
npm run test:browser                       # production-build interaction checks
node scripts/validate-surface-contacts.mjs  # clothed visible-surface contact fixtures
node scripts/validate-named-presets.mjs     # inherited named-preset quality gate
node scripts/validate-named-presets.mjs --rendered # dressed-mesh contact gate
node scripts/validate-named-presets.mjs --catalog --rendered # every catalog entry, including drawn supports
node scripts/validate-text.mjs             # parser and geometry corpus
node scripts/validate-scenes.mjs           # base-model scene sweep
node scripts/validate-postures.mjs         # single-figure support constraints
node scripts/validate-mesh.mjs             # topology and surface accuracy
```

The validators are the part worth trusting. They pose real bodies and measure
geometry — support gaps, penetration depth, unmet contacts, surface error,
Euler characteristic — rather than checking that functions return values.

**Known residuals.** The recorded base-model scene sweep reports 32 of 159
variants as not fully sound, with a worst residual penetration of 63mm. The
current base-model named-preset gate flags 7 of 12 definitions. The rendered
named audit flags 9 of 12, and the complete rendered catalog audit flags 9 of
23 entries. All eleven clothed reference studies now pass that rendered audit,
including the sofa recline's seat/foot and backrest checks. Furniture
clearance is checked against the complete drawn figure before reconciling a
coarse-model overlap; whole-figure floor
checks also cover parts outside the declared support regions.
Rendered support checks retain coarse estimates separately and distinguish
gaps, penetration and missing geometry. These quality gates remain open despite
passing structural and browser checks; the CLI and app report the unresolved
constraints.

The historical single-posture model audit's worst support gap was 30mm, in `inverted`: the skull reaches the rig's own
`headTop` now that it is a head rather than a ball, so in a shoulder stand the
head touches the floor first and the shoulders sit above it. That is the
posture being right, not the seating being wrong.

Kneeling postures cannot lay the instep flat on the floor. Doing so needs about
90° of plantarflexion — a shin flat on the ground and a foot in line with it —
and the ankle's range of motion is 45°, which is already at the clinical limit.
The feet trail at an angle instead, which is what a tucked-toe kneel looks like.

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

The SVG path does hidden-line removal against a depth pass, and both halves of
that — the packing into bytes and the unpacking back out — are written here
rather than borrowed from three's `MeshDepthMaterial`. Reading three's packed
depth means depending on its *internals*: the layout has changed at least once,
which byte is the most significant is now the opposite of what it was, and when
it changes nothing throws. The depth unpacks to a number near zero, every line
tests as hidden behind something at the lens, and the export is a valid SVG
containing no lines at all. Owning the packing also lets the stored value be
distance in metres, which is the unit the visibility test compares in.

Silhouette detection welds vertices on position first, for the same reason the
normals do: the scanned model is exported flat-shaded, so keyed by index every
edge has exactly one triangle, reads as a hole in the surface, and the line art
comes out as the whole wireframe — 50,244 segments where the drawing has 3,134.

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

There are **two surfaces**, and keeping them apart is the whole design.

The one that *collides* is the distance field: around forty-eight round cones
per body, with anthropometric proportions, hands with thumbs, feet with heels
and a flat sole, and genital geometry appropriate to the body type. It is
exact, cheap to query from any direction, and it is what every contact,
penetration depth and seat height in this system is measured against.

The one that is *drawn* is a scanned human mesh — about 27k triangles, skinned
to the same skeleton the field is built from, so the two move together by
construction. It carries what a field of round cones cannot: a face with a
nose, lips, ears and brows, separate fingers, and eyes split into a white, an
iris and a pupil. It is the mesh that makes the picture read as a person; it is
never asked a geometric question. If it fails to load the viewport falls back
to drawing the field and says so.

`buildBodyVolumes` takes `bust` and `anatomy`. `anatomy` is **on by default**,
and that is a deliberate reversal: this system exists to judge how two bodies
fit together, and leaving the anatomy out moves the contacted surface by a
couple of centimetres exactly where the judgement matters. Every piece of it is
marked `soft`, so the narrow phase gives it the 18mm compression budget rather
than the 10mm default. A caller that only wants proportions can pass
`anatomy: false`.

The reference system models the same thing (`createAdultAnatomy` in
`../SexPoses/src/fullBodyRig.js`), but as separate meshes that nothing collides
against. Here it is part of the one field, so it is drawn and collided
identically — which is the whole argument of this rebuild applied to the part
of the body the problem is actually about.

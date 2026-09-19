# Validation

Two layers, with different jobs.

```
npm test                            108 tests across 8 files — units and invariants
node scripts/validate-text.mjs      does the vocabulary read sentences correctly?
node scripts/validate-postures.mjs  does a single body sit on things properly?
node scripts/validate-scenes.mjs    do two bodies fit together?
node scripts/validate-mesh.mjs      is the surface correct geometry?
```

The validators are the part worth trusting. They pose real bodies and **measure
geometry** — support gaps, penetration depth, unmet contacts, surface error,
Euler characteristic — rather than checking that functions return values. They
exist because `src/core/` has no dependencies and runs headless.

## Unit tests

`node --test "tests/**/*.test.js"`. No framework, no mocking library.

| file | n | what it pins |
|---|---|---|
| `math.test.js` | 14 | vectors, quaternions, matrices, segment closest points |
| `skeleton.test.js` | 9 | rig completeness, stature scaling, symmetry, range-of-motion clamping, that posing a joint moves descendants and not ancestors |
| `ik.test.js` | 10 | sub-millimetre accuracy on reachable targets, honest `unreachable` reporting, pole hints changing the solution, weight blending |
| `collision.test.js` | 23 | narrow phase, compression budgets, contact bookkeeping, **SDF exactness** |
| `mesh.test.js` | 10 | manifoldness, Euler characteristic, outward winding, relaxation, normals, AO |
| `parser.test.js` | 18 | the scanning machinery, attachment rules, purity, the whitespace regression |
| `poseLibrary.test.js` | 20 | catalogue completeness, two-height surfaces, arrangement reconciliation, scene repair |
| `architecture.test.js` | 4 | the dependency-free core, three.js confinement, no browser globals |

### The two that measure rather than assert

Most of the suite checks behaviour. Two tests check *architectural claims* that
would otherwise be prose:

**The SDF is genuinely exact** (`collision.test.js`). Step `d` along the field's
own gradient from an outside probe and land at `1e-17` — for a capsule, a
0.05→0.16 taper, and a degenerate sphere. This is what licenses cheap sphere
tracing and one-step vertex relaxation. Writing this test is also what forced
`closestOnVolume` and `capsuleContact`'s capsule approximations to be
**measured** (5.1mm and 0.3mm inside on a taper) rather than assumed exact.

**The mesh is watertight** (`mesh.test.js`). Zero duplicate directed edges, zero
unpaired edges, V − E + F = 2 per connected component. Not "looks closed" — the
actual topological invariant.

### `architecture.test.js` and vacuous passes

The dependency guard scans imports with a regex, which is exactly the kind of
check that can pass by finding nothing at all. It did, twice, during writing:

1. The first pattern read `export const X = { side: "l" }` as importing a
   package named `l`.
2. The second missed three.js entirely, because `renderer.js` uses the
   multi-line `import {\n … \n} from "three"` form — so the confinement rule
   passed **vacuously**.
3. The third matched the word `from` *inside a string literal* — the filler-word
   list in `lexicon.js` contains `"from", "so"`, and the gap between those two
   strings read as a module named `", "`.

So the file opens with a test asserting the scanner can actually see the
multi-line three.js import, plus the three shapes that fooled it. A guard whose
own sensitivity is untested is not a guard.

## Validators

### `validate-text.mjs`

A 34-description corpus, each with an expected reading. Checks both that the
text is parsed as intended *and* that the resulting scene solves to sound
geometry — a description can parse perfectly and still describe something
impossible.

```
34/34 parsed as expected, 34/34 geometrically sound
```

### `validate-postures.mjs`

Every posture on every surface, alone. Measures the gap between each declared
support and the plane it wants, plus self-penetration.

```
worst support gap 13mm   worst self-penetration 2mm
all postures within tolerance
```

This is the validator that catches a two-height mistake: `bent_over_support` on
a `table` must report `chest = 0mm` against 750mm and `foot = 2mm` against 0.

### `validate-scenes.mjs`

156 scene variants — every arrangement against a spread of posture pairs,
surfaces and body types.

```
126/156 sound   worst penetration 91mm   unmet contacts 91 (all reported)   8.2s
```

### `validate-mesh.mjs`

A resolution sweep plus every posture at 12mm. Checks manifoldness, winding,
and surface error against the field the mesh came from.

```
worst surface error 2.51mm
all meshes closed and outward
```

Pinches are gated on a rate (0.02% of edges) rather than zero, because one
vertex per cell means two sheets of surface passing through the same cell
occasionally share an edge. That is a documented cost, not a regression.

## Known residuals

Stated plainly because the validators report them and hiding them would defeat
the point.

| | |
|---|---|
| 30 of 156 scene variants not fully sound | worst residual penetration: `rear_alignment` 91mm, `face_to_face` 55mm, `head_to_toe` 42mm |
| `head_to_toe` head↔pelvis contacts | never close |
| `bodyDistance` is order-dependent | two orderings differ by at most the blend tolerance, but they do differ |
| pinched edges at coarse resolution | ~2 per 50,000 edges at 12–20mm, none at 8mm |

Every unmet contact appears in the solve result with a reason and a residual
gap, and both the CLI and the webapp print the count. None of these is silent.

## What is not covered

Honest gaps:

- **No visual regression testing.** `render-cli.mjs` produces deterministic
  PNGs, so golden-image comparison is possible and not yet done.
- **No performance regression gate.** Build times are printed by
  `validate-mesh.mjs` but nothing fails if they double.
- **The WebGL renderer is untested.** It needs a GPU, so it sits outside the
  headless boundary by construction. `render-cli.mjs` is a deliberate *second*
  implementation of the shading rather than shared code — a second
  implementation is what catches geometry being in the wrong place (figures
  facing backwards, a body inside the mattress), and that is the part worth
  checking. A picture that is merely similar is enough for that.
- **No property-based testing.** Inputs are hand-chosen; a fuzzer over the
  parser and the solver would likely find things.

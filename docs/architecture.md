# Architecture

## The pipeline

One direction, no loops between stages, no stage reaching backwards:

```
  "she is bent over the table, he stands behind her"
        │
        ▼
  ┌───────────────┐   src/nlp/parser.js
  │    parse      │   lexicon + archetypes → scene spec
  └───────────────┘   also: warnings[], interpretation[]
        │
        ▼  { actors:[{posture,bodyType,stature,build}], relationship:{arrangement,yaw},
        │     support:{surface}, contacts:[{from,to,fromActor,toActor}] }
        │
  ┌───────────────┐   src/core/scene.js
  │   validate    │   repair anything unrenderable, report every repair
  └───────────────┘
        │
        ▼
  ┌───────────────┐   src/core/skeleton.js  + poseLibrary.js
  │  build rigs   │   25 bones, anthropometric, scaled by stature/build
  │  apply pose   │   posture → joint angles, clamped to range of motion
  └───────────────┘
        │
        ▼
  ┌───────────────┐   src/core/body.js
  │   volumes     │   ~48 round cones per body, posed into world space
  └───────────────┘
        │
        ▼
  ┌───────────────┐   src/core/solver.js
  │    solve      │   seat → arrange → anneal(contacts ⇄ collisions) → keep best
  └───────────────┘   also: warnings[] for anything it could not do
        │
        ▼
  ┌───────────────┐   src/render/meshBuilder.js   (in a Worker)
  │     mesh      │   sample field → dual contour → relax → normals → AO
  └───────────────┘
        │
        ├──────────────▶  src/render/renderer.js   WebGL viewport
        │                 src/render/exporters.js  PNG / SVG
        └──────────────▶  scripts/render-cli.mjs   software rasteriser, no GPU
```

## Module map

```
src/core/          no dependencies, runs in plain Node
  math.js          vectors, quaternions, matrices, segment/segment closest points
  skeleton.js      25-bone rig, anthropometric scaling, range-of-motion clamping
  landmarks.js     "chest", "hand.left" → bone + offset
  ik.js            two-bone analytic IK with pole hints, aim, blending
  body.js          round cones, the SDF, smooth union, normals
  collision.js     broad/narrow phase, compression budgets, rigid correction
  poseLibrary.js   18 postures, 10 arrangements, 6 surfaces
  scene.js         scene validation and repair
  solver.js        seating, arrangement, the annealed contact loop

src/nlp/           no dependencies
  lexicon.js       565 phrases (233 Chinese) → postures, parts, surfaces, …
  archetypes.js    12 named positions with their own phrasings
  parser.js        scanner, subject attachment, scene assembly

src/render/
  meshBuilder.js   no dependencies — dual contouring, relaxation, AO
  renderer.js      three.js — viewport, lighting, custom skin material
  props.js         three.js — beds, tables, chairs
  exporters.js     three.js — PNG and SVG

src/workers/
  bodyWorker.js    parse + solve + mesh off the main thread

src/app/
  main.js          one thread of control: panel → worker → viewport → export
  ui.js            description box, override controls, interpretation readout

scripts/           no dependencies
  render-cli.mjs   software rasteriser: z-buffer, shadow map, zlib PNG
  validate-*.mjs   four validators that measure geometry
  measure-body.mjs anthropometric check of the rendered surface

tests/             node:test, no framework, 104 tests
```

## Three invariants

Everything else is a consequence of these.

### 1. One surface

The rendered surface, the collision geometry and the AO source are the same
function — `bodyDistance` in `src/core/body.js`. Not three representations kept
in sync; one representation, read three ways.

This is the single largest departure from `../SexPoses`, where the body is drawn
as separate three.js sphere and capsule meshes while collision runs against
three ellipsoids that are not drawn at all. There, a hand can rest visibly
inside a thigh while the solver believes it is 60mm clear, because the thigh is
not in the collision set. Here that state is unrepresentable.

The cost is that the field must be cheap enough to evaluate in a mesher's inner
loop and exact enough to trust in a narrow phase. Round cones are chosen because
they are both. See [geometry.md](geometry.md).

### 2. The core has no dependencies

`src/core/`, `src/nlp/`, `src/render/meshBuilder.js` and `scripts/` import
nothing — not even three.js. three.js appears only in `src/render/renderer.js`,
`props.js`, `exporters.js` and the app.

This is not aesthetic. It is what makes the validators possible: the entire
geometric pipeline runs headless in Node, so correctness can be *measured* in CI
rather than eyeballed in a browser. `scripts/render-cli.mjs` renders a scene to
PNG with no GPU and no DOM for the same reason.

A guard test enforces it, and the rule is worth defending — the moment a core
module imports `THREE.Vector3`, the validators stop being runnable and the
system loses its only objective check.

### 3. Nothing throws on bad input

The webapp parses on every keystroke, so half-typed words and empty boxes are
the common case rather than the edge case, and an exception is a blank screen.

- `parseDescription` accepts `""`, `null`, `12345`, 5000 characters of `a`, pure
  punctuation — and always returns a scene the solver accepts.
- `validateScene` returns the same shape for `null`, `42`, `"a scene"`, `{}`.
- Anything repaired is reported in `warnings`, with a "did you mean" suggestion
  where one exists.

The corollary is the rule that matters more: **a guess is always labelled**.
Every field the parser filled in appears in `interpretation` with the phrase
that caused it, or a note saying it was assumed. The solver likewise warns about
every contact it could not close, with the reason (`out of reach`, `as close as
the bodies allow`, `could not be closed`) and the residual gap. A render is just
as confident-looking whether or not the description fitted together, so the
caveat has to be in the data, not in the picture.

## Data contracts

### Scene spec

What the parser produces and the solver consumes. Every field is optional except
`actors`; `validateScene` fills and repairs the rest.

```js
{
  actors: [
    { id, posture, bodyType: "female"|"male"|"neutral", stature, build, bust }
  ],
  relationship: { arrangement, yaw },   // yaw overrides the arrangement default
  support:      { surface },            // "floor"|"bed"|"sofa"|"chair"|"table"|"bench"
  contacts: [
    { from, fromSide, fromActor, to, toSide, toActor, strength }
  ],
}
```

### Solve result

```js
{
  actors:   [ { id, posture, skeleton, pose, evaluated, volumes } ],
  surface:  { height, ground, props },  // two heights; see solver.md
  contacts: [ { contact, distance, unreachable, blocked } ],
  penetration: { maxDepth, count },
  warnings: [ "chest to chest could not be closed, left 55mm apart", … ],
  camera:   { … },
}
```

There is deliberately no single `y` on the surface. `height` is where a trunk
rests, `ground` is where feet go, and collapsing them is the bug that puts a
figure bent over a table standing on the tabletop.

### Mesh

```js
{ positions: Float32Array,  // xyz
  normals:   Float32Array,  // unit, from the field gradient
  indices:   Uint32Array,   // triangles, outward-wound
  occlusion: Float32Array | null,   // per vertex, [0,1], null when ao:false
  bounds:    [ [minx,miny,minz], [maxx,maxy,maxz] ],
  resolution: number }
```

## Threading

Parse, solve and mesh all run in `src/workers/bodyWorker.js`. The main thread
only ever draws and exports.

There is exactly one way into the worker. Typing a description and dragging an
override slider both post the same message shape and come back through the same
handler, so the override controls cannot reach a state the text could not
express, and what is on screen is always the result of a full solve rather than
a patch applied to a previous one.

Replies carry a monotonic request id; anything that is not the newest is stale
and dropped. This matters because meshing takes ~300ms at the default
resolution, which is slower than a fast typist.

# Architecture

## The pipeline

Scene input flows through validation, the body-model solve, visible-contact
refinement and rendering. Refinement re-skins the rig internally to measure the
same triangles that the renderer will draw.

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
  │  build rigs   │   articulated, anthropometric, scaled by stature/build
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
  ┌───────────────┐   src/core/surfaceContacts.js + meshDistance.js
  │ refine contact│   dressed triangles → measured gaps → constrained rig edits
  └───────────────┘   skipped/estimated when geometry is unavailable
        │
        ▼
  ┌───────────────┐   src/core/humanMesh.js      (in a Worker)
  │     skin      │   scanned body → bound to the same rig → posed, ~27k tris
  └───────────────┘   src/render/meshBuilder.js  field → AO for those vertices
        │             (and the field's own isosurface, if the model won't load)
        │
        ├──────────────▶  src/render/renderer.js   WebGL viewport
        │                 src/render/exporters.js  PNG / SVG
        └──────────────▶  scripts/render-cli.mjs   software rasteriser, no GPU
```

## Module map

```
src/core/          no dependencies, runs in plain Node
  math.js          vectors, quaternions, matrices, segment/segment closest points
  skeleton.js      articulated rig, anthropometric scaling, range-of-motion clamping
  landmarks.js     "chest", "hand.left" → bone + offset
  ik.js            two-bone analytic IK with pole hints, aim, blending
  body.js          round cones, the SDF, smooth union, normals
  collision.js     broad/narrow phase, compression budgets, rigid correction
  gltf.js          GLB container, accessors, node transforms
  humanMesh.js     scanned body: bind to the rig, skin, smooth, split the eyes
  meshDistance.js  triangle distance and bounding-volume hierarchy
  surfaceContacts.js  visible-region queries, constrained refinement, cancellation
  catalog.js       portable presets and strict interchange validation
  poseLibrary.js   authored postures, arrangements and support surfaces
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
  bodyWorker.js    validate + solve + refine + mesh off the main thread

src/app/
  main.js          one thread of control: panel → worker → viewport → export
  ui.js            description box, override controls, interpretation readout
  contactEditor.js figure/landmark contact editing and measured feedback
  studioUI.js      library, filters, dialogs and export choices
  libraryStore.js  atomic browser persistence for saved presets/favorites
  diagram.js       schematic joint previews

scripts/           no dependencies
  render-cli.mjs   software rasteriser: z-buffer, shadow map, zlib PNG
  validate-*.mjs   geometry validators, including scanned-surface contact checks
  measure-body.mjs anthropometric check of the rendered surface

tests/             node:test geometry/data checks; browser/ uses Playwright and Axe
```

## Three invariants

Everything else is a consequence of these.

### 1. Distinguish the body model from the visible surface

`bodyDistance` supplies the base collision model, field-based AO and the SDF
fallback mesh. In that rendering mode one field serves all three purposes.
Scanned figures share the rig, but their surfaces can differ from the field;
limb thickness is one measured example. A small body-model target residual is
therefore not evidence that the visible surfaces meet.

`surfaceContacts.js` measures posed, dressed triangle regions, adjusts free
limbs and rechecks the final pose. At declared limb contacts, complete rendered
limbs can resolve a coarse-model overlap only when their triangles do not cross
and the closest surfaces face outward. Raw proxy diagnostics remain available.
Self, furniture and unrelated-body collisions are not exempted. Missing models
produce an explicitly labeled estimate. See [surface-contacts.md](surface-contacts.md).

### 2. The core has no dependencies

`src/core/`, `src/nlp/`, `src/render/meshBuilder.js` and `scripts/` import
nothing — not even three.js. three.js appears only in `src/render/renderer.js`,
`props.js` and `exporters.js`.

This is not aesthetic. It is what makes the validators possible: the entire
geometric pipeline runs headless in Node, so correctness can be *measured* in CI
rather than eyeballed in a browser. `scripts/render-cli.mjs` renders a scene to
PNG with no GPU and no DOM for the same reason.

A guard test enforces it, and the rule is worth defending — the moment a core
module imports `THREE.Vector3`, the validators stop being runnable and the
system loses its only objective check.

### 3. Tolerant descriptions, strict interchange

Descriptions are applied explicitly, but incomplete or ambiguous text still
needs a useful result and an explanation of any assumptions.

- `parseDescription` accepts `""`, `null`, `12345`, 5000 characters of `a`, pure
  punctuation — and always returns a scene the solver accepts.
- `validateScene` returns the same shape for `null`, `42`, `"a scene"`, `{}`.
- Anything repaired is reported in `warnings`, with a "did you mean" suggestion
  where one exists.

Catalog imports use `checkScene` and `parseCatalog` instead: unknown versions,
unsafe data and invalid scene choices reject the complete pack before a storage
write. UI error handling preserves the existing library and scene.

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
    { id, label, posture, bodyType: "female"|"male"|"neutral", stature, build, bust,
      wearing, outfit, skinTone, joints, hands, feet, mobility }
  ],
  relationship: { arrangement, yaw, contactMode: "automatic"|"custom" },
  support:      { surface },            // "floor"|"bed"|"sofa"|"chair"|"table"|"bench"
  contacts: [
    { from: "hand.r", fromActor, to: "forearm.l", toActor, strength, type }
  ],
}
```

### Solve result

```js
{
  actors:   [ { id, posture, skeleton, pose, evaluated, volumes } ],
  surface:  { height, ground, props },  // two heights; see solver.md
  contacts: [ { from, fromSide, fromActor, to, toSide, toActor, strength, source } ],
  quality: {
    maxDepth, count, warnings, unmetContacts,
    contactDetail: [{ from, to, distance, unreachable, blocked }]
  },
  camera:   { … },
}
```

There is deliberately no single `y` on the surface. `height` is where a trunk
rests, `ground` is where feet go, and collapsing them is the bug that puts a
figure bent over a table standing on the tabletop.

After visible refinement, `quality` also includes raw `proxyMaxDepth`, the number
of `verifiedProxyContacts`, and per-contact `basis`, `surfaceGap`,
`targetDistance`, `intersects` and `limbIntersects`. The body-model target error
and rendered-region gap have different meanings and must not share an unlabeled
readout.

### Field mesh

```js
{ positions: Float32Array,  // xyz
  normals:   Float32Array,  // unit, from the field gradient
  indices:   Uint32Array,   // triangles, outward-wound
  occlusion: Float32Array | null,   // per vertex, [0,1], null when ao:false
  bounds:    [ [minx,miny,minz], [maxx,maxy,maxz] ],
  resolution: number }
```

## Threading

The UI can parse descriptions and draw lightweight joint diagrams. Rig solving,
scanned-surface refinement and mesh construction run in `bodyWorker.js`; the main
thread owns interaction, the library, history, drawing and export.

Selecting a preset, applying a description and editing a control all post a
scene request through the same handler. Descriptions are one authoring path;
structured controls and JSON expose additional fields. Every accepted edit
receives a complete validated solve rather than patching the previous mesh.

Replies carry a monotonic request id; anything that is not the newest is stale
and dropped.

The worker loads the required templates and runs incremental contact refinement.
The generator yields between contact updates so a newer request can cancel it;
cancellation restores the old job's rig and publishes no partial measurements.
It then answers **twice**: a posed draft without field occlusion, followed by the
same corrected pose with occlusion. Scanned figures keep the same triangles;
the SDF fallback also refines mesh resolution. The worker yields between replies.
Timings separate model loading, surface refinement and mesh work. Both the CLI
and worker call the same refinement implementation.

Each actor comes back as **parts**, not as one buffer, because a body is
several materials — the skin, and the white, iris and pupil of each eye. A
figure that fell back to the field arrives as a single primary part, so both
paths draw through the same code:

```js
{ id: string,
  source: "scanned" | "field 12mm",
  triangles: number,
  parts: [{ name, primary, colour, positions, normals, indices, occlusion }] }
```

`positions` and `normals` are skinned fresh per request and are transferred.
`indices` and the eyes' baked `occlusion` belong to the cached template and are
the same arrays every time, so they are **copied** before transfer — giving them
away would detach the template and every later pose would come back empty.

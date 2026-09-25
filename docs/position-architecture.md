# Position architecture

PoseForge has one position protocol across built-ins, source-linked
interactions, alternate variants, personal presets and local overrides. This
document is the authoritative boundary guide for that subsystem.

## Design goals

The position system follows five rules:

1. One portable preset envelope represents every playable scene.
2. Scene data is normalized: each fact has one owner and is not duplicated.
3. Core validation is independent of the browser, renderer and persistence.
4. Source downloads, local storage and UI state are separate responsibilities.
5. One interaction graph supports one to four participants without pair-specific
   schemas.

## Canonical preset contract

`src/core/catalog.js` validates the portable `poseforge.catalog` envelope. A
position preset has this shape. The scene arrays are abbreviated here, so this
illustration is not itself an importable preset:

```json
{
  "id": "builtin.position.img-0001",
  "title": "Position title",
  "description": "Participant arrangement and support",
  "category": "Face-to-face",
  "tags": ["bed", "img-0001"],
  "position": {
    "type": "missionary",
    "name": "Missionary",
    "variant": "interaction"
  },
  "source": {
    "dataset": "SexPoses",
    "recordId": "img-0001",
    "annotationHash": "..."
  },
  "scene": {
    "actors": [],
    "contacts": [],
    "support": { "surface": "bed" },
    "relationship": {},
    "camera": { "view": "three_quarter" }
  }
}
```

The normalized ownership rules are:

| Fact | Sole owner |
|---|---|
| Participants and participant count | `scene.actors` |
| Interaction edges | `scene.contacts` |
| Support surface | `scene.support.surface` |
| Source identity and fingerprint | `preset.source` |
| Position taxonomy and variant | `preset.position` |
| Display identity and discovery text | preset envelope |

Obsolete duplicate fields such as `figures`, `surface`, `positionName`,
`positionCategory` and `reference` are rejected at the portable boundary.

## Participant and contact model

`src/core/positionContract.js` owns the shared participant rules.

- A scene contains between one and four actors.
- Actor IDs are unique and are the stable endpoints of authored contacts.
- Fixed source-linked scenes require complete fixed joint data and placement.
- Every actor remains clothed.
- Every multi-person interaction or override must form one connected undirected
  graph through `scene.contacts`.
- Generated and artistic alternatives intentionally use the separate-position
  validator because they are not connected interaction reconstructions.

Contacts identify both endpoints with `fromActor` and `toActor`; body landmarks,
strength and contact type remain ordinary contact attributes. Three- and
four-person positions use the same list and graph as two-person positions.

## IDs and variants

| Kind | ID / URL | `position.variant` | Behavior |
|---|---|---|---|
| Canonical source position | `builtin.position.<source-id>` | `interaction` | Connected bundled interaction shown by the main card |
| Local active override | `user.position.sexposes.<source-id>` | `override` | Replaces playback for the canonical card without creating another card |
| Artistic alternative | `builtin.artistic.<source-id>` | `artistic` | Original separate-participant composition |
| Generated alternative | `builtin.generated.<source-id>` | `generated` | Shared separate-participant approximation |
| Personal preset | generated `user.*` ID | `studio` | Independent saved study |

Canonical links use `?preset=builtin.position.<source-id>`. Alternate views add
`&variant=artistic` or `&variant=generated`. Favorites remain keyed to the
canonical card ID even when an override supplies the playable scene.

## Module boundaries

| Module | Owns | Must not own |
|---|---|---|
| `src/core/catalog.js` | Portable preset and scene envelope | Fetching, storage, DOM |
| `src/core/positionContract.js` | Variants, participant limits, fixed scenes, contact graph | Catalog downloads or UI |
| `src/core/sourceCatalog.js` | Immutable source metadata validation, grouping and search | Playable scenes |
| `src/core/interactionStudies.js` | Canonical connected interaction scenes | Persistence or rendering |
| `src/core/artisticStudies.js` | Artistic separate-participant alternatives | Canonical card identity |
| `src/core/generatedStudies.js` | Generated separate-participant alternatives | Canonical card identity |
| `src/core/positionOverrides.js` | Override validation and portable transfer | IndexedDB transactions |
| `src/app/positionService.js` | Lazy, retryable, hash/size/schema-verified downloads | Local saved state |
| `src/app/libraryStore.js` | Stock registration, saved data, favorites and override resolution | Network access |
| `src/app/persistentLibrary.js` | Durable serial transactions and conflict handling | Domain interpretation |
| `src/app/libraryMigrations.js` | One-way persisted-data normalization | Runtime aliases |
| `src/app/studioUI.js` | Catalog presentation and domain-operation dispatch | Domain record validation |
| `src/app/main.js` | Application orchestration, selection cancellation and URL state | New domain schemas |

Dependency direction is intentionally one way:

```text
source files -> core validators/builders -> position service -> library/application -> UI
                         |
                         +-> renderer/worker consumes validated scenes
```

The core has no browser or renderer dependency. The service does not own local
storage. The library does not fetch. The UI does not define or repair domain
records.

## Loading and selection lifecycle

1. The application starts with a usable stock or restored scene.
2. `positionService.sources()` loads immutable source metadata.
3. `positionService.positions()` loads and validates the interaction pack, then
   registers canonical built-ins with the library.
4. Selecting a card resolves its canonical ID through the library. A compatible
   local override wins; otherwise the bundled interaction is used.
5. Artistic and generated packs load only when their detail action is selected.
6. A monotonically increasing request token prevents late downloads from
   replacing a newer selection, edit or save.
7. Download failures publish an explicit retry state and preserve the current
   scene.

The verified loader checks declared byte length, SHA-256 and schema before
publishing a pack. A failed request is not cached as success and can be retried.

## Overrides and persistence

An override is a complete source-linked interaction, not a detached posture
study. It must preserve the source record ID, annotation fingerprint,
participant count and connected contact graph. Imports validate the entire
batch before a transaction begins.

Built-in positions are never written to local storage. Personal presets,
favorites and overrides are committed through the persistent library. Existing
overrides can still be replaced while the built-in pack is temporarily
unavailable; the saved validated override supplies the compatibility baseline.

`src/app/libraryMigrations.js` is the only compatibility boundary. It converts
older `user.reference.sexposes.*` records and favorite IDs to
`user.position.sexposes.*`. No old runtime service, API, route or UI collection
remains.

## Extending the system

To add a new position variant:

1. Add the variant to `POSITION_VARIANTS`.
2. Implement a focused validator/builder in `src/core`.
3. Add a verified lazy loader in `positionService.js`.
4. Keep canonical card identity separate from alternate playable IDs.
5. Add contract, retry, cancellation, URL and browser coverage.

To add a four-person source position:

1. Provide four uniquely identified actors with fixed placements and complete
   joint channels.
2. Add contacts whose undirected graph reaches all four actors.
3. Keep provenance, taxonomy and support in their canonical fields.
4. Pass `checkPreset` and `checkFixedPositionScene`.
5. Verify editor, worker, renderer, import/export and persistence behavior.

Raising the four-participant safety limit requires changing the shared scene
limit in `scene.js`, then measuring solver, renderer, editor, worker-message and
portable-pack capacity at the new bound.

## Verification

The architecture is enforced by tests rather than documentation alone:

```sh
npm test
npx playwright test \
  tests/browser/position-overrides.spec.js \
  tests/browser/position-scale.spec.js \
  tests/browser/position-variants.spec.js \
  tests/browser/positions.spec.js
npm run build
node scripts/build-source-catalog.mjs \
  /path/to/annotated-pose-dataset/annotations.jsonl --check
git diff --check
```

`tests/architecture.test.js` also rejects reference-era runtime module names,
APIs and URL routes.

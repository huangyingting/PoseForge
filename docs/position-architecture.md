# Position architecture

PoseForge has one position protocol across built-ins, source-linked
interactions, alternate views, saved presets and local overrides.

## Canonical contracts

- `src/core/catalog.js` owns the portable preset envelope: identity, title,
  category, tags, provenance, position taxonomy and a validated scene.
- `src/core/positionContract.js` owns position variants, participant limits,
  fixed-pose requirements and the participant contact graph.
- `scene.actors` is the only participant list. It supports one to four people.
- `scene.contacts` is the interaction graph. Every participant in a multi-person
  interaction or override must be connected to that graph.
- `scene.support.surface` is the only support-surface value.
- `preset.source` is the only source-provenance object.
- `preset.position` contains only taxonomy and variant metadata. It does not
  duplicate participant counts, postures, surfaces or source fields.

## Module boundaries

| Module | Scope |
|---|---|
| `sourceCatalog.js` | Validate/search immutable source metadata; no scenes or UI |
| `generatedStudies.js` | Validate separate generated posture alternatives |
| `artisticStudies.js` | Validate separate artistic alternatives |
| `interactionStudies.js` | Validate/build canonical connected interactions |
| `positionOverrides.js` | Validate source-linked local interaction replacements |
| `positionService.js` | Lazy verified downloads; expose sources, positions and variants |
| `libraryStore.js` | Stock registration, saved data, favorites and override resolution |
| `libraryMigrations.js` | One-way persisted-data normalization only |
| `studioUI.js` | Render catalog state and dispatch domain operations |

The core has no browser or renderer dependency. The service does not own local
storage. The library does not fetch. The UI does not validate domain records.

## Extending participant counts

New positions use the same arrays and contact graph for one, two, three or four
participants. No pair-specific position object is introduced. To add a
four-person source position:

1. Provide four uniquely identified actors with fixed placements and complete
   joint channels.
2. Add contacts whose undirected actor graph reaches all four actors.
3. Keep source provenance and position taxonomy in their existing fields.
4. Pass `checkPreset` and `checkFixedPositionScene`.

Raising the current four-participant safety limit requires changing the scene
limit in `scene.js`, then validating solver, renderer, editor and
portable-pack capacity at the new bound.

## Compatibility

Current URLs use `?preset=builtin.position.<source-id>` and optional
`&variant=artistic|generated`. Current overrides use
`user.position.sexposes.<source-id>`. Older stored override IDs are handled only
by `libraryMigrations.js`; no legacy runtime service or UI route remains.

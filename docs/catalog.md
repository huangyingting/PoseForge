# Building a pose library

## References and verified presets are separate

**References** browses all 1,283 records in the committed SexPoses annotation
snapshot. It is a metadata-only catalog: source photos, raw descriptions,
intimate contact labels and private file paths are not shipped. The normal
**All / Positions / Saved / Favorites** collections contain playable 3D presets.
There are still 23 authored stock presets; indexing a reference does not add a
corresponding verified 3D layout.

Search references by source ID (for example `img-0001`), broad posture family,
support surface or figure count. A standalone digit from 1 to 4 means the number
of figures. **Family**, **Support status**, and **Group matching annotations**
compose with search. The snapshot has 22 broad family combinations and 379
structured-annotation groups. Matching annotations are not proof of identical
anatomy, and different annotations are not proof of distinct positions. All
1,283 source IDs remain reachable without grouping.

The group fingerprint includes the ordered participants' structured pose fields
and the full relationship annotation. Participant `id` and `gender` fields,
captions and tags are excluded; relationship strings and list order are retained.
It does not resolve synonyms or compare solved geometry. The separate annotation
fingerprint covers the complete original annotation for provenance.

Both catalogs show at most 24 cards per page. **Previous / Next** preserves
filters; changing a filter starts at page one. Reference metadata is downloaded
only when References is opened. Failed or incomplete downloads show a retry
button and leave the studio and personal library available.

Opening a reference shows provenance and matching IDs without changing the
active 3D scene. **Associate current study with this source** links your current
independently authored study to the source record; save it to persist the link.
Source IDs and annotation fingerprints survive preset export and import.
Association does not generate a reconstruction or confer verification.

Support labels mean:

- **Reference only**: indexed source record, no authored 3D preset attached.
- **Needs adjustment**: personal/imported preset, not individually certified;
  inspect Pose checks to determine whether adjustment is actually needed.
- **Verified 3D preset**: one of the audited immutable stock configurations.
  Edited copies require their own checks. JSON cannot import a verification badge.

The checked-in manifest is `src/data/reference-manifest.json`; metadata lives in
`public/catalog/sexposes-v1.json`. Source IDs, annotation hashes and manifest
hashes permit offline reconciliation without redistributing source imagery.
A fresh clone does not need the sibling SexPoses checkout. To regenerate from
an explicitly supplied annotation file, or verify byte-for-byte reproducibility:

```sh
node scripts/build-reference-catalog.mjs /path/to/annotations.jsonl
node scripts/build-reference-catalog.mjs /path/to/annotations.jsonl --check
```

The importer rejects missing/duplicate IDs and malformed records rather than
silently dropping them. It performs no network requests. Broad neutral families
are a discovery aid, not an engine vocabulary mapping or geometry certification.

## Author and save a 3D preset

Choose an entry in **All** or browse the existing named definitions in **Positions**.
Use **Figures** to change body type, height,
build, clothing, hands, feet and individual joints, then choose **Save preset**.
Give it a name, category and optional comma-separated tags. Categories do not
need to exist first. Saved studies appear in **Saved**; the star button
adds any study to **Favorites**. Search matches names, descriptions, tags,
categories and posture names together.

The catalog combines eleven reference studies and twelve definitions adapted
directly from `src/nlp/archetypes.js`, with clothed studio appearances. Original
aliases remain searchable. All bundled entries pass the current complete
rendered audit; edited variations can still have unresolved constraints.
**Pose notes** badges and the viewport's **Pose checks** shortcut make those
visible. Loading successfully does not mean every physical constraint was satisfied.

**Side by side facing** and **Spooning** use calibrated clothed reference
layouts. Loading a card or typing one of its aliases (including `lying face to
face`, `侧躺面对面`, `spooning` and `侧卧后抱`) gives the same fixed placement and
joint angles, with a top camera view. Adding `on the floor` translates that
reference to the floor. The side-lying cuddle retains its three torso/hand
contacts and its same-direction arrangement. Explicit
body-size, posture, limb, facing, contact or clothing variations use automatic
posing instead; the interpretation trace explains when the stock layout was
skipped. That fallback is not a guarantee that every variation is physically
resolved.

**Chair straddle** uses a calibrated clothed starting pose for chair and bench,
with a side camera view and all three original pelvis/hand contacts retained.
The two surfaces have independently fitted actor poses: seat heights differ
while the supporting feet stay on the floor. Built-in recipes can declare
`surfaceVariants` with their own actors and reference height; saved/exported
presets still contain only the selected ordinary scene.

This entry uses guided placement and joint hints. Its coarse solve remains valid,
and the authored pose is used for the drawn models only after complete geometry
checks pass. Capture the completed layout to keep it fixed. Explicit body,
posture, limb, facing, contact and clothing changes bypass stock calibration;
unsupported surfaces stay automatic. Missing meshes remain labeled as estimates,
not certified clearance.

**Cowgirl** and **Reverse cowgirl** have independently calibrated clothed
bed/floor layouts. Both retain the supine primary and kneeling-straddle partner,
the original pelvis support and two hand-to-chest contacts. Two additional,
editable **Support** contacts place the primary's palms beneath the partner's
knees; the side mapping differs with facing. Both actors use guided starts.
Their support/clearance checks must pass before the rendered pose is adopted;
capturing the layout saves an exact fixed pose. Aliases and JSON include the
same explicit knee supports. Body, pose, opposite-facing and unsupported-surface
requests bypass the stock fit and may need further adjustment.

**Sixty nine** retains the original clothed supine/prone figures and their two
opposed head/pelvis contacts, with a side view and independently checked bed and
floor placement. Both figures use guided starts. The lower figure's back,
pelvis and head keep surface support; the partner keeps its original
partner-support assignment. The hands and feet are also measured against the
finite supporting plane. Save/export keeps the complete ordinary scene, and
Capture current layout freezes the accepted result. Explicit body, facing,
posture, contact, clothing or unsupported-surface changes bypass calibration;
missing models do not certify clearance.

**Lotus**, also available as `seated embrace`, uses a calibrated clothed floor
layout with all five original contacts: lap support, both hands on shoulders,
and both hands on the upper back. Seat and foot supports share one plane, so
the verified bed version uses the same scene translated to the mattress top.
Both use guided placement and joint hints with a side camera view. The primary
has measured surface support; the partner retains its explicit partner-support
assignment rather than a fabricated floor residual. The same explicit-edit,
missing-geometry and capture rules above apply.

**Standing carry** has a calibrated clothed floor/bed layout with fixed placement
and joint angles. It retains the standing/lifted posture roles and all five
contacts, including the two supports written from the carried figure to the
carrier's hands. Both carrier feet meet their surface; the carried figure keeps
partner support with no floor residual. These fixed defaults pass both coarse
and rendered checks without refinement movement. Body, pose, facing, contact,
clothing or unsupported-surface variations retain the standard automatic fallback.

**Bent over table** uses mixed placement: the supported figure keeps its fitted
root and joints, while the standing partner uses a validated guided start. The
primary chest and hips rest on the finite table top; all four feet stay on the
floor. All three original partner contacts are retained. The recipe supports
the table only; other surfaces keep their own automatic scene rather than
translating feet along with a tabletop. Both coarse and rendered checks pass.
Capture the completed layout to freeze both figures. Explicit variations and
missing geometry retain the same fallback and availability rules as other recipes.

The single seated references now use render-aware grounding: the visible seat
region and soles are brought toward their supporting surfaces while the feet's
horizontal placement and orientation are retained. This also applies to matching
custom seated scenes within the motion/joint limits, without a preset-ID check.
An information note explains an accepted adjustment. Fixed placement or leg
channels remain authoritative, and conflicting contacts or furniture block an
unsafe correction. Capturing the result makes it portable as normal scene data.

Knee/shin-supported figures also have a bounded rendered-support correction.
The low and paired kneeling references use it to meet the surface while keeping
contacted hands in place. Fixed placement, fixed required joint channels, missing
geometry or conflicting contacts can prevent correction; those results remain
measured and reported rather than silently replacing the requested pose.

The **Floor study** also uses a generic pelvis/forearm support correction, with
bounded arm and wrist adjustments and a complete-hand floor check. It retains
the existing lower-body pose rather than assigning new foot supports. Both body
types and tested floor/bed proportions are covered; fixed arm channels or
partner contacts on the supporting arms prevent free wrist reshaping.

The **Slow afternoon** reference uses shared-plane seating to ground the seat
while keeping its feet on the sofa cushion and clearing the backrest. The same
support contract works on tested floor and bed variants. Pitch/forward changes
and optional free-arm compensation are bounded; fixed placement and required
channels remain authoritative. Capturing the corrected pose stores ordinary
root/joint data, not a special-case catalog override.

Once loaded, a fixed layout remains editable and is not silently reapplied.
The Composition hint points to **Figures → Placement** to release fixed roots;
**Joints → Keep edited angles** controls joint locking separately. Changing a
fixed scene's support surface in the editor does not reposition its roots:
adjust placement, unlock it, or apply a fresh description for that surface.

Diagrams use shared world coordinates from a solve, including props, relative
height, facing and contact placement. They are prepared in a separate worker as
cards enter view. A selected scene supplies its final refined pose, which also
warms the preview for a saved copy. Worker failure leaves an explicitly labeled
authored-pose fallback; it does not prevent opening or editing the scene.

On the canvas, drag one pointer to orbit or pinch two fingers to zoom. Zoom buttons,
named views and **Fit figures** are also available on narrow screens. Arrow keys
orbit, plus/minus zoom and F fits the scene when the canvas is focused. Camera
gestures do not change the pose. Browser page zoom remains available.

Opening **Save preset** on one of your studies lets you rename it, update its
current scene, save an independent copy, or delete it with confirmation.
Built-ins cannot be overwritten or deleted. Undo and redo restore scene edits
within the current session. They do not undo library deletion; export a backup
before deleting valuable studies.

A catalog caption is separate from the description used as a text command.
Editing a saved caption does not overwrite that command. Unread input warnings
remain visible through rendering and a draft reload; applying text replaces the
pose intent, while structured figure/contact controls edit the scene directly.

Your library and current workspace are stored in this browser. They are not
an account or a cloud backup. **Export library** downloads all saved studies;
**Export → Editable preset** downloads the current scene, including unsaved
changes. **Import presets** adds a valid pack without replacing existing work.
Re-importing assigns new IDs and makes independent copies. Your favorites are
local preferences and are not included in exported packs.

Libraries now use IndexedDB for capacity beyond localStorage. Valid legacy
libraries are copied transactionally; the original localStorage data is retained
as a recovery backup and is not the active library after migration. Writes are
serialized and success is shown only after durable commit. A concurrent-tab
conflict asks you to reload instead of overwriting newer saved data. Workspace
drafts still use localStorage. JSON remains the portable backup.

If IndexedDB cannot open, a new/unmigrated library can use an explicitly labeled
legacy fallback with browser-dependent quota. A known migrated library is locked
against replacement while its database is inaccessible. Corrupt data is not
overwritten without explicit reset. Browser persistence is not cloud backup or
a guarantee against user clearing, private-session expiry, or browser eviction.

Library exports retain readable formatting when it fits the 32 MB import limit,
and use compact JSON when formatting alone would exceed it. If the data itself
is larger than 32 MB, export individual presets or a smaller library; the studio
reports the limit without deleting saved work or downloading an unreadable pack.

## Author a partner gesture without JSON

Choose **New study** for one clothed figure with no automatic contacts, or load
**A helping hand** to explore a working two-figure example. **Figures** lets you
name each figure, choose postures and adjust appearance. Add a second figure
before opening **Scene → Partner contacts**.

**Add contact** creates a first-figure/body-part pair and a second-figure/body-part
pair. Choose both endpoints explicitly, then adjust **Pull strength** if needed.
**Contact type** offers Rest, Surface, Grip and Support; imported custom kinds
remain visible. A Support link with nonzero strength lets a hand hold a mounted
figure's declared supporting region (such as a knee or forearm) instead of
seating that region on the mattress. Either endpoint order works. Other regions,
ordinary rest/grip links, zero-strength links and unmounted figures retain their
normal surface support. The type travels through history, save and JSON export.
Imported custom types must be non-empty text of at most 80 characters. Malformed
types reject the entire pack before any saved data changes.
Changing the first figure to the current second figure swaps the figure roles so a
contact never accidentally points back to the same person. Removing a figure
removes contacts involving it and preserves the remaining references.

These fields describe which parts should meet, not a promise that only the first
figure moves. A body-to-hand request can adjust the second figure's free hand,
just as the equivalent hand-to-body request does. The stored endpoint order,
sides and row feedback remain unchanged. Placement and joint controls still
determine which roots and angles are held fixed.

**Arrangement + my contacts** includes the arrangement's existing contacts,
shown above your editable list. **My contacts only** suppresses those defaults
from both the initial alignment and the solve. An empty custom list means no
partner-contact constraints. These settings travel with saved presets and JSON.

Each row reports the measured gap between the visible body-part regions when
the models are available. **Close contact** means within 4 mm. Intersecting
surfaces are flagged separately. Other rows show the remaining gap and whether
reach or supporting limbs limited the adjustment. If a model or measurement is
unavailable, the row says **Estimated target** instead of claiming a visible
contact. A strength of zero applies no pull. Delete a row to remove its constraint entirely.
Joint limits, support and collision checks still apply. Review **Pose checks**
when the status reports notes.

The renderer may make a small adjustment to a free wrist or move a standing or
kneeling figure a few centimeters along the floor to achieve an authored contact.
Explicit wrist overrides and pinned figures are respected. Supporting limbs
retain their height. The collision check uses the rendered limbs to resolve
coarse-model discrepancies at the declared contact, while retaining the raw
diagnostic and checks for other body parts and furniture.

## Keep precise joint edits

Open **Figures → Joints** to edit angle channels. The sliders show the requested
values; **Solved** shows the selected joint's actual rig angles after the worker
finishes. While a new scene is pending, stale solved values are cleared.

By default, edits are **guided** hints: seating, contacts and collision handling
can change them. Enable **Keep edited angles** to use **fixed** mode for that
figure. Only channels present in `joints` are held; unedited channels, other joints
and whole-figure placement remain free. For example,
`"jointMode": "fixed", "joints": {"elbow_l": {"flexion": 60}}` holds that flexion
but does not freeze the elbow's other channels or the figure's location.

Turning the option off returns to guided behavior without deleting the edits.
Reset controls remove explicit overrides; values derived from named limb or foot
shapes may still apply. Fixed mode cannot make conflicting constraints possible:
review contact and support warnings if a pose does not fit. The mode survives
save, JSON export/import, draft reload and scene history. Use the current app/CLI
for fixed-joint presets; older releases treated joint values only as hints.

## Use saved presets from the command line

The headless renderer accepts both raw scene JSON and exported catalog files:

```sh
node scripts/render-cli.mjs --scene examples/reference-study.json --out study.png
node scripts/render-cli.mjs --preset builtin.helping-hand --out gesture.png
node scripts/render-cli.mjs --scene my-library.json --preset user.MY-ID --out custom.png
```

A catalog without `--preset` renders its first entry. An unknown ID is an error.
The browser and CLI share surface-contact refinement, so exported scene settings
receive the same geometry corrections in both. Lighting and framing differ
between the two renderers. `--body sdf` keeps the original body-model diagnostic.

## Interchange format

The bundled [reference-study.json](../examples/reference-study.json) is a
working starter. All dimensions are in meters and joint angles are degrees.

```json
{
  "format": "poseforge.catalog",
  "version": 1,
  "presets": [{
    "id": "example.standing",
    "title": "Standing reference",
    "description": "An upright clothed figure for a gesture study.",
    "category": "My studies",
    "tags": ["standing", "reference"],
    "scene": {
      "actors": [{
        "id": "figure-a",
        "label": "Figure A",
        "bodyType": "female",
        "posture": "standing",
        "stature": 1.72,
        "build": 1,
        "wearing": ["top", "shorts"],
        "outfit": "sage",
        "skinTone": "#e8c9a4",
        "joints": {"elbow_l": {"flexion": 45}}
      }],
      "support": {"surface": "floor"},
      "relationship": {"contactMode": "custom"},
      "contacts": [],
      "camera": {"view": "three_quarter"}
    }
  }]
}
```

| Field | Contract |
| --- | --- |
| `format`, `version` | Exactly `poseforge.catalog` and `1`; unsupported versions fail before importing |
| `presets` | 1–5,000 entries; maximum file size 32 MB (32,000,000 bytes) |
| `id` | Unique within a pack; 1–100 letters, numbers, dots, underscores or dashes; starts with a letter or number |
| `title`, `description` | Required name up to 80 characters; optional description up to 500 |
| `category`, `tags` | Required category up to 40 characters; at most 12 tags, each up to 32 |
| `source` | Optional `{dataset: "SexPoses", recordId, annotationHash}` provenance; never a quality endorsement |
| `scene.actors` | 1–4 actors with distinct IDs and known postures |
| `bodyType` | `female`, `male`, or `neutral`; neutral currently uses the female scan with neutral proportions |
| `stature`, `build` | 1.4–2.1 meters; 0.8–1.3 build multiplier |
| `skinTone` | Six-digit hex color, independent of body type |
| `wearing`, `outfit` | Known garment names and a named fabric color from `garments.js` |
| `joints` | Bone names → `flexion`, `abduction`, `rotation`; angles must fit the rig's joint limits |
| `jointMode` | `guided` (default) allows solver adjustments; `fixed` preserves the channels specified in `joints`, not the entire figure |
| `hands`, `feet` | A named shape for both sides, or `{ "l": "…", "r": "…" }` |
| `camera.view` | `three_quarter`, `front`, `side`, `top`; free orbit and zoom are temporary viewport settings |
| `relationship.contactMode` | `automatic` (the default) adds arrangement contacts; `custom` uses only `scene.contacts`, including an empty list |
| `contacts` | Optional existing engine contact definitions, at most 32; invalid people or landmarks are rejected |

Available posture, arrangement and surface names come from
`src/core/poseLibrary.js`. Joint names and limits come from `skeleton.js`.
Hand and foot shapes come from `handPose.js` and `footPose.js`. The import
boundary in `src/core/catalog.js` validates the entire pack before any storage
write. The tolerant natural-language parser remains a separate input path.

## Extending the application

Add reference data to `STUDIO_PRESETS` in `src/core/catalog.js`, or add a named
definition to `src/nlp/archetypes.js`. `presetFromArchetype` adapts the latter
without reparsing its display title; the combined immutable `BUILTIN_PRESETS`
feeds the UI and CLI. Each catalog entry stores a complete scene. Run `npm test`
for schema/parity/regression checks and the geometry validators for pose quality.
The named-position audit is a separate acceptance gate; all twelve stock named
layouts currently pass both representations. Run `node scripts/validate-named-presets.mjs` for
base-model constraints and add `--rendered` for dressed-mesh contact gaps and
intersections. The latter preserves base results alongside surface measurements;
passing the base gate alone is not sufficient. Add `--preset <built-in-id>` to
audit a single definition or resume an interrupted long audit. Invalid or empty
selections fail instead of reporting success for zero cases.
Add `--catalog` to include the eleven reference studies as well as the named
entries. Rendered reports include actual support-region gaps, penetration and
measurement availability; the separate base result retains the coarse estimate.

Calibrated named layouts are data in `src/nlp/presetLayouts.js` or dedicated
layout modules beside it, referenced by their archetype's optional `layout`
field. Define the body dimensions,
coverage, full joint channels, placement, supported surfaces and reference-plane
height. The shared applicability check runs during both catalog construction and
text parsing; variations keep their own procedural scene. The result is normal
portable scene data, not a saved recipe ID. Verify real dressed geometry and
fallback behavior before extending the supported cases. Do not weaken contact
or clearance thresholds to certify a stock recipe.

The CLI renderer honors the scene's saved `camera.view`. Pass `--view front`
(or another named/vector view) to override it for a particular render.
Raw diagnostic scenes with unrecognized stored camera values use the
three-quarter view; strict catalog imports still require valid named views.

Adding a new underlying posture or arrangement is an engine extension: author
its joint and support/contact contract in the pose library and verify it with
the geometry validators. Merely naming a new posture in an imported JSON file
does not create a new solver rule. Users can create pose variations through
joint overrides and authored contacts without extending the engine.

## Limits

The original contact solver's limitations still apply to arbitrary scenes.
Open **Scene → Pose checks** when the status reports notes. The bundled studies
are measured separately; this is not a claim that every combination of every
posture, body size and arrangement is geometrically correct. A model-loading
failure falls back to the existing collision-field representation and reports
the loss of scanned detail. A WebGL failure still permits preset editing and
JSON export, but image export requires a working preview.

Library writes are atomic. If browser storage is full or unavailable, the
interface reports the error and offers JSON as the portable path. Unreadable
saved data is preserved until the user explicitly resets it; download the
recovery data first if needed.

# Building a pose library

Choose an entry in **All** or browse the existing named definitions in **Positions**.
Use **Figures** to change body type, height,
build, clothing, hands, feet and individual joints, then choose **Save preset**.
Give it a name, category and optional comma-separated tags. Categories do not
need to exist first. Saved studies appear in **Saved**; the star button
adds any study to **Favorites**. Search matches names, descriptions, tags,
categories and posture names together.

The catalog combines eleven reference studies and twelve definitions adapted
directly from `src/nlp/archetypes.js`, with clothed studio appearances. Original
aliases remain searchable. Some inherited definitions have unresolved geometry;
**Pose notes** badges and the viewport's **Pose checks** shortcut make that visible.
Loading successfully does not mean every physical constraint was satisfied.

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

## Author a partner gesture without JSON

Choose **New study** for one clothed figure with no automatic contacts, or load
**A helping hand** to explore a working two-figure example. **Figures** lets you
name each figure, choose postures and adjust appearance. Add a second figure
before opening **Scene → Partner contacts**.

**Add contact** creates a moving-figure/body-part pair and a target-figure/body-part
pair. Choose the two sides explicitly, then adjust **Pull strength** if needed.
Changing the moving figure to the current target swaps the figure roles so a
contact never accidentally points back to the same person. Removing a figure
removes contacts involving it and preserves the remaining references.

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
| `presets` | 1–200 entries; maximum file size 2 MB |
| `id` | Unique within a pack; 1–100 letters, numbers, dots, underscores or dashes; starts with a letter or number |
| `title`, `description` | Required name up to 80 characters; optional description up to 500 |
| `category`, `tags` | Required category up to 40 characters; at most 12 tags, each up to 32 |
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
The named-position audit is a separate acceptance gate and currently reports
unresolved inherited cases. Run `node scripts/validate-named-presets.mjs` for
base-model constraints and add `--rendered` for dressed-mesh contact gaps and
intersections. The latter preserves base results alongside surface measurements;
passing the base gate alone is not sufficient. Add `--preset <built-in-id>` to
audit a single definition or resume an interrupted long audit. Invalid or empty
selections fail instead of reporting success for zero cases.
Add `--catalog` to include the eleven reference studies as well as the named
entries. Rendered reports include actual support-region gaps, penetration and
measurement availability; the separate base result retains the coarse estimate.

Calibrated named layouts live in `src/nlp/presetLayouts.js` and are referenced
by their archetype's optional `layout` field. Define the body dimensions,
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

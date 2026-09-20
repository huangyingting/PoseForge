# Building a pose library

Choose a study in **Explore**, use **Figures** to change body type, height,
build, clothing, hands, feet and individual joints, then choose **Save preset**.
Give it a name, category and optional comma-separated tags. Categories do not
need to exist first. Saved studies appear in **My presets**; the star button
adds any study to **Favorites**. Search matches names, descriptions, tags,
categories and posture names together.

Opening **Save preset** on one of your studies lets you rename it, update its
current scene, save an independent copy, or delete it with confirmation.
Built-ins cannot be overwritten or deleted. Undo and redo restore scene edits
within the current session. They do not undo library deletion; export a backup
before deleting valuable studies.

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

Each row reports the solver's distance from the requested target point. **On
target** means within 12 mm; other rows show the remaining distance and whether
reach or body interference limited movement. This is a measured target error,
not an assurance that every visible surface is in exact physical contact. A
strength of zero applies no pull. Delete a row to remove its constraint entirely.
Joint limits, support and collision checks still apply. Review **Pose checks**
when the status reports notes.

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

Add bundled preset data to `BUILTIN_PRESETS` in `src/core/catalog.js`; no UI
branch is needed. Each entry stores a complete scene, so it does not rely on
future parser behavior. The cards derive schematic diagrams from the same rig
and joint data, before placement and contact solving. The 3D viewport is the
authoritative solved representation. Run `npm test` to validate new presets'
geometry as well as their schema.

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

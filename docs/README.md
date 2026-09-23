# Design documentation

The [artistic collection](artistic-collection.md) is the current ready-to-view
content delivery: 1,283 distinct, clothed compositions with no import required.
Its [plan](artistic-collection-plan.md) distinguishes original interpretation
from source reconstruction and defines the geometry/render coverage gates.
The [verification report](artistic-collection-verification.md) records all 1,283
direct renders, full-worker palette coverage and application regression checks.

Start with the [studio redesign](studio-redesign.md) for the current interface
contract and [catalog guide](catalog.md) for saving, importing and authoring
portable presets. [Verification evidence](studio-verification.md) records the
historical studio checks and limitations. The [catalog scale plan](catalog-scale-plan.md)
and [catalog scale verification](catalog-scale-verification.md) cover the later
1,283-record reference index and larger persistent libraries. The documents below
describe the underlying geometry engine.

The later [compact UI plan](compact-ui-plan.md) and
[UI verification](compact-ui-verification.md) cover the tighter layout,
filter disclosure, denser rows, keyboard search and desktop focus mode.

The [3D reference plan](reference-3d-plan.md) and
[verification](reference-3d-verification.md) cover interactive posture previews
for every source record, with separate clothed figures and explicit approximation
notes. Original source interactions are not reconstructed.

The [reference authoring plan](reference-authoring-plan.md) and
[workflow guide](reference-authoring.md) describe independently saved reference
studies, coverage status and validated bulk import/export. Authored does not mean
verified, accurate to the source, or geometrically unique.
The [authoring verification report](reference-authoring-verification.md) records
the full-size import/export checks, browser evidence and remaining limitations.

The 23 authored presets passed the previous complete rendered audit. The new
reference index does not certify additional 3D poses; it labels all imported
references separately from authored presets.

These describe *why* the system is built the way it is. The code carries the
"what" in its own comments; these carry the reasoning, the measurements, and the
things that were tried and rejected.

Read in this order:

| | |
|---|---|
| [architecture.md](architecture.md) | The pipeline end to end, the module map, and the three invariants everything else rests on |
| [geometry.md](geometry.md) | The signed distance field: round cones, exactness, smooth union, and the two documented approximations |
| [collision.md](collision.md) | Broad and narrow phase, compression budgets, and how a penetration becomes a pose change |
| [solver.md](solver.md) | Postures, support sets, two-height surfaces, arrangements, and the annealed contact loop |
| [surface-contacts.md](surface-contacts.md) | Visible triangle gaps, guarded corrections, and the distinction between mesh contact and a body-model target |
| [meshing.md](meshing.md) | Dual contouring stitched from edges, vertex relaxation, field-sampled AO |
| [language.md](language.md) | Lexicon, archetypes, the scanner, and why a turn is relative |
| [validation.md](validation.md) | What the 104 tests and 4 validators actually measure, and the known residuals |

## The one-paragraph version

A body model is a collection of round cones whose smooth union supplies the
base collision field and AO. Scanned figures share its rig but have a distinct
visible surface. Scene data produces poses and support constraints; the base
solver arranges the figures, then visible-contact refinement measures dressed
triangles and adjusts free limbs without hiding unrelated collisions. The
viewport and CLI draw the resulting geometry, with an SDF fallback when models
are unavailable. Measurements say whether they concern the visible surface or
the approximate body-model target.

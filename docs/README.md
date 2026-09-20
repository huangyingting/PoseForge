# Design documentation

Start with the [studio redesign](studio-redesign.md) for the current interface
contract and [catalog guide](catalog.md) for saving, importing and authoring
portable presets. [Verification evidence](studio-verification.md) records the
current checks and limitations. The documents below describe the underlying geometry engine.

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
| [meshing.md](meshing.md) | Dual contouring stitched from edges, vertex relaxation, field-sampled AO |
| [language.md](language.md) | Lexicon, archetypes, the scanner, and why a turn is relative |
| [validation.md](validation.md) | What the 104 tests and 4 validators actually measure, and the known residuals |

## The one-paragraph version

A body is ~48 round cones. Their smooth union is a signed distance field. That
one field is the rendered surface, the collision geometry and the ambient
occlusion source — not three approximations of each other, the same function.
Text is parsed into a scene spec; postures supply joint angles and a support
set; an annealed loop pulls declared contacts closed while pushing penetrations
apart; the field is meshed by dual contouring into a watertight surface and
drawn, or exported as PNG or SVG.

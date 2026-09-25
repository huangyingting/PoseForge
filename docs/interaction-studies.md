# 3D interaction studies

Every one of the 1,283 SexPoses source records opens as a **3D interaction**:
the clothed participants are placed together, in contact, in the arrangement the
source image shows. The earlier artistic interpretation and generated approximation
remain available from each position's **•••** details (**Open artistic
interpretation** / **Open generated approximation**) and through
`?preset=builtin.position.img-0001&variant=artistic|generated`.

## Library positions

Every scene is also registered as a read-only built-in library preset
(`builtin.position.<img-id>`), listed in the unified **Positions** catalog once
the pack has loaded (a loading row with **Retry positions** is shown meanwhile).
Titles are `<position name> · <surface> · <IMG-ID>` and descriptions state the
actual classified arrangement, participants and surface. Ten broad categories
expand to their related named positions and counts. Tags include the template,
category, name, surface and source ID, so search works by name ("reverse
cowgirl"), category ("partner on top") or ID ("img-0042"). Positions can be
favorited and opened with `?preset=builtin.position.img-0042`.
They cannot be deleted and are never written to local storage.

These are **approximations composed from templates**, not measured
reconstructions: the source images give no 3D coordinates, so each is read by eye
and rebuilt from a small vocabulary of interaction templates. Checks are geometric
(distance, overlap, floor), not physical certification.

## How a study is made

1. **Classification** — each source image was viewed and assigned one interaction
   template plus variant fields (surface, bodies, leg shape, lean, hand placement,
   third-person placement). The pixels were the primary evidence; source titles and
   annotation text were hints only. The result is
   `scripts/data/interaction-classifications.json` (no image data).
2. **Composition** — `scripts/interaction-templates.mjs` turns a classification into
   a plan: postures and joint shapes per partner, the support surface, placement
   moves, a fitting objective (e.g. B's groin to A's groin), hand/leg contacts to close
   by IK, declared contacts and semantic checks. `scripts/interaction-composer.mjs`
   solves each figure, places it, searches candidate postures and placements against
   penetration, floor and furniture costs, then closes limb contacts.
3. **Evaluation** — each scene is measured: required landmark distances, facing
   and orientation checks, body/prop overlap and floor clearance. Failures are kept
   with the record and shown in the app as a warning; nothing is hidden.
4. **Baking** — `node scripts/build-interaction-studies.mjs` composes all records
   (722 distinct scenes after de-duplicating identical classifications,
   in 4 worker threads, about 4 minutes) into
   `public/catalog/interaction-studies-v1.json` with a SHA-256/size manifest in
   `src/data/interaction-manifest.json`. `--check` verifies the committed files
   reproduce exactly.

Every figure wears a top and shorts, uses fixed joints and a fixed placement, and
every multi-person scene has a connected contact graph across all participants;
the loader rejects the whole pack otherwise. The shared contract supports one
to four participants, so four-person positions can use the same actor/contact
model without a new subsystem.

## Coverage

2,549 participants: 1,238 pairs, 14 three-person scenes and 31 solo
figures. 1,170 of 1,283 records pass all of their checks. 35
records were classified with a different participant count than their annotation;
the app notes this.

| Template | Records | Pass all checks |
|---|---:|---:|
| `cowgirl` | 64 | 59 |
| `doggy` | 35 | 34 |
| `doggy_low` | 46 | 46 |
| `edge_missionary` | 55 | 48 |
| `edge_seated_facing` | 31 | 22 |
| `facesitting` | 28 | 21 |
| `furniture_rear` | 82 | 76 |
| `group_three` | 14 | 10 |
| `kneeling_missionary` | 74 | 74 |
| `kneeling_rear_upright` | 9 | 9 |
| `lap_facing` | 99 | 96 |
| `lap_reverse` | 65 | 65 |
| `missionary` | 72 | 62 |
| `oral_on_a` | 53 | 41 |
| `oral_on_b_kneeling` | 30 | 18 |
| `oral_on_b_lying` | 11 | 10 |
| `other_pair` | 7 | 6 |
| `prone_on_top` | 21 | 13 |
| `prone_rear` | 53 | 47 |
| `reclined_facing` | 27 | 25 |
| `reverse_cowgirl` | 61 | 61 |
| `scissors` | 32 | 24 |
| `side_facing` | 24 | 21 |
| `sixty_nine` | 34 | 29 |
| `solo` | 31 | 31 |
| `spooning` | 28 | 28 |
| `squat_cowgirl` | 4 | 2 |
| `standing_bent_over` | 17 | 17 |
| `standing_carry` | 34 | 34 |
| `standing_facing` | 20 | 20 |
| `standing_rear` | 10 | 9 |
| `supported_inversion` | 79 | 79 |
| `wheelbarrow` | 33 | 33 |

Typical remaining shortfalls are a few centimetres of extra gap in oral and
seated-edge scenes, hands that could not reach without passing through the floor
(those reaches are dropped), and small overlaps in interlaced legs.

## Templates

Face-to-face, lying down
- `missionary` — A lies on back; B lies/leans over A face to face, supported on forearms or hands, between A's legs, B's legs extended behind.
- `kneeling_missionary` — A lies on back; B KNEELS upright (or sits back on heels) between A's thighs, torso fairly upright; A's hips may rest on B's thighs.
- `edge_missionary` — A lies on back at the EDGE of a bed/table/sofa/desk; B STANDS (or kneels on the floor) at the edge between A's legs.
- `prone_on_top` — A lies on back; B lies flat, chest-to-chest, on top of A with legs extended along A's legs (woman-on-top lying flat, or man lying flat on top with legs together).
- `cowgirl` — A lies on back (or reclines on elbows); B KNEELS astride A's pelvis FACING A's face.
- `squat_cowgirl` — as cowgirl, but B SQUATS with feet flat beside A's hips (knees up).
- `reverse_cowgirl` — A lies on back; B kneels or squats astride A's pelvis FACING A's FEET.
- `sixty_nine` — head-to-toe: one partner on top of or beside the other, reversed, each head at the other's pelvis. A = the lower partner.
- `side_facing` — both lie on their sides facing each other.
- `spooning` — both lie on their sides facing the same way; B behind A.
- `scissors` — bodies cross at an angle (perpendicular / X / T shape), legs interlaced; A lies on back or side, B lies on side across.

Rear, kneeling / lying
- `doggy` — A on hands and knees (arms straight); B kneels upright behind A.
- `doggy_low` — A on knees with chest/shoulders lowered to forearms or the surface, hips up; B kneels (or squats) behind.
- `prone_rear` — A lies flat face down (legs straight or slightly apart); B lies/leans over A's back from behind, on hands or forearms.
- `kneeling_rear_upright` — A kneels UPRIGHT (torso vertical); B kneels upright right behind A, chest to back.
- `wheelbarrow` — A supports the upper body on hands/forearms on the floor, torso roughly horizontal, legs held up at B's waist; B stands or kneels behind holding A's legs/thighs.

Rear, standing
- `standing_rear` — both stand; A upright or slightly leaning; B stands right behind A.
- `standing_bent_over` — A stands bending forward at the hips (hands on knees, on the floor, or on a wall) with nothing large supporting the torso; B stands behind.
- `furniture_rear` — A's torso lies/leans on furniture (bed, table, sofa arm, chair back) with feet on the floor or knees on the furniture edge; B stands (or kneels) behind.

Seated
- `lap_facing` — B sits (floor, chair, sofa, bed); A sits astride B's lap FACING B (lotus, chair straddle). Includes B sitting leaning back slightly.
- `lap_reverse` — B sits; A sits on B's lap FACING AWAY from B (A's back to B's chest).
- `reclined_facing` — both sit leaning back on their hands/elbows, facing each other, legs interlaced or A's legs over B's (crab, seesaw).
- `edge_seated_facing` — A sits on the edge of a table/counter/bed/chair; B stands (or kneels) in front between A's legs, face to face.

Standing, lifted, inverted
- `standing_facing` — both stand face to face (embrace), possibly A with one leg lifted/held.
- `standing_carry` — B stands and holds A fully off the ground; A's legs wrap around B or are held under the thighs; face to face.
- `supported_inversion` — A is upside down or steeply inverted (shoulders/upper back/hands on floor or bed, hips high, legs up); B kneels or stands at A's hips holding them.

Oral / manual (head at pelvis)
- `oral_on_a` — A lies on back (or reclines/sits back) with legs apart; B lies prone or kneels with head at A's pelvis.
- `oral_on_b_kneeling` — B stands or sits; A kneels (or crouches) in front of B with head at B's pelvis.
- `oral_on_b_lying` — B lies on back; A lies or kneels between/beside B's legs with head at B's pelvis.
- `facesitting` — B lies on back; A kneels or squats astride B's HEAD (either facing direction).

Other
- `solo` — one person only (set `solo_posture`).
- `group_three` — three people. Set `base` to the template the main pair follows, and `third` = {"posture": standing|kneeling|seated|supine|side_lying|all_fours, "place": beside|at_head|behind|in_front}. A and B refer to the main pair.
- `other_pair` — two people and truly none of the above fits (use sparingly; describe briefly in `notes`).

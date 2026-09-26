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
Each position is titled with its own name from
`scripts/data/position-names.json` (the source sites' titles for the image,
normalised; names shared by several images are told apart by an alternative
title, the support, the leg shape or a numeral, so all 1,283 are unique).
The build stores it as the record `title` and any other titles as `aliases`.
Descriptions start with the template type and state the actual classified
arrangement, participants and surface. Broad categories (nine are in use)
expand to their template types and counts. Tags include the template, category, type, aliases,
surface and source ID, so search works by name ("golden arch"), type ("reverse
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
   third-person placement), notes naming a variant of the template, and pose
   details for each partner (see [Telling positions apart](#telling-positions-apart)).
   The pixels were the primary evidence; source titles and
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
   (1,283 distinct scenes: no two records share a classification,
   in 4 worker threads, about 8 minutes) into
   `public/catalog/interaction-studies-v1.json` with a SHA-256/size manifest in
   `src/data/interaction-manifest.json`. `--check` verifies the committed files
   reproduce exactly.

Every figure wears a top and shorts, uses fixed joints and a fixed placement, and
every multi-person scene has a connected contact graph across all participants;
the loader rejects the whole pack otherwise. The shared contract supports one
to four participants, so four-person positions can use the same actor/contact
model without a new subsystem.

## Coverage

2,544 participants: 1,241 pairs, 10 three-person scenes and 32 solo
figures. All 1,283 records pass all of their checks. 40
records were classified with a different participant count than their annotation;
the app notes this.

| Template | Records | Pass all checks |
|---|---:|---:|
| `cowgirl` | 56 | 56 |
| `doggy` | 31 | 31 |
| `doggy_low` | 45 | 45 |
| `edge_head_oral` | 10 | 10 |
| `edge_missionary` | 41 | 41 |
| `edge_seated_facing` | 26 | 26 |
| `facesitting` | 22 | 22 |
| `furniture_rear` | 65 | 65 |
| `group_three` | 10 | 10 |
| `kneeling_missionary` | 111 | 111 |
| `kneeling_rear_upright` | 15 | 15 |
| `lap_facing` | 95 | 95 |
| `lap_reverse` | 78 | 78 |
| `missionary` | 62 | 62 |
| `oral_on_a` | 40 | 40 |
| `oral_on_b_kneeling` | 31 | 31 |
| `oral_on_b_lying` | 8 | 8 |
| `prone_on_top` | 13 | 13 |
| `prone_rear` | 62 | 62 |
| `rear_oral` | 16 | 16 |
| `reclined_facing` | 29 | 29 |
| `reverse_cowgirl` | 61 | 61 |
| `scissors` | 32 | 32 |
| `side_facing` | 7 | 7 |
| `sixty_nine` | 42 | 42 |
| `solo` | 32 | 32 |
| `spooning` | 31 | 31 |
| `squat_cowgirl` | 15 | 15 |
| `standing_bent_over` | 25 | 25 |
| `standing_carry` | 18 | 18 |
| `standing_facing` | 29 | 29 |
| `standing_rear` | 14 | 14 |
| `supine_stack` | 12 | 12 |
| `supported_inversion` | 67 | 67 |
| `wheelbarrow` | 32 | 32 |

Passing the checks means the declared contacts close, the figures are clear of
each other and the furniture, and every figure rests on the floor, a surface or
a partner. It does not mean the scene matches its reference in every detail.
Each record was also compared with its source image by eye. The remaining
simplifications are mostly a lean or arch shallower than drawn, a raised or held
leg shown lower, and props drawn as the nearest one the pack models (a pillow
stack, bolster or tall ramp as the wedge cushion or dropped). A second piece of
furniture that only a foot or a hand rests on, such as the chair beside a table,
is left out.

## Telling positions apart

Many source images share a template and its variant fields, and would compose
to the same scene from those alone. Each record also carries what its own image
shows beyond them, and the build rejects none of it silently:

- **Notes** choose a variant of a template where the image shows one, for
  example `lying at edge` (oral on a sofa: lying back along it, the hips at its
  edge, rather than sitting), `lying flat` / `feet up` (oral: the partner prone
  between the legs, the legs long or the feet in the air), `kneel` and
  `hands on bed|sofa|bench` (wheelbarrow: the partner kneels closer, and A's
  hands are on the ledge the note names), `reversed` (head to foot, on the side
  or face down), `squat` (squatting over a partner lying face down),
  `partner crouched` (piledriver), `squat on` / `kneel upright` (on a low table
  or seat), `kneel on seat` (astride a seated partner face to face, kneeling
  up on the seat either side of the thighs), `side saddle` with `feet on the
  floor` (on a sofa: sitting across the hips of a partner lying along it,
  facing out with the feet down, and `legs crossed` for one leg over the
  other) and `lying on top` (a 69 at full length).
- **Hands**: `b_hands` (`hips`, `legs`, `shoulders`, `embrace`, `behind`,
  `surface`) becomes hand contacts closed by IK, or for `behind` the arms
  braced back on the hands, where the template leaves B's hands free. A
  template that fixes the hands keeps them there: on the floor, or holding a
  wheelbarrow's legs up. Astride a partner lying down, `hips` leaves the hands
  as posed.
- **Pose details**: `a_pose`, `b_pose` and `c_pose` list named details
  (`DETAILS` in `scripts/interaction-templates.mjs`, 72 in use across 878
  records). They cover the arms (`arms_overhead`, `arms_behind_head`,
  `arms_forearms`, `arm_head_l`, …), the head (`head_back`, `head_forward`,
  `head_turn_l`), the trunk (`arch`, `curl`, `twist_l`) and the legs
  (`legs_straight`, `legs_wide`, `knees_up`, `knees_to_chest`, `knee_up_l`,
  `leg_up_r`, `foot_planted_l`, …). `_l`/`_r` name the figure's own side. `turn_l`/`turn_r` turn a partner 30° before it is
  fitted. An unknown name stops the build.

A detail is a joint target in the body's own terms. Where the same words mean
another shape for a figure lying, kneeling, sitting or bent forward
(`IN_POSTURE`), that shape is used. Arms raised by someone on their back lie on
the floor above the head. A knee brought up from kneeling sets that foot flat in
front. A leg raised while bent forward goes out behind and to the side, as far
as the hip allows. The composer lays details on limb by limb, each only as far
as the floor and furniture allow (`applyDetails` in
`scripts/interaction-composer.mjs`). A limb that reaches its partner is still
placed by that reach, so an arm detail on a hand that holds on does nothing.
Every detail a record lists was checked to change its scene, by composing the
record without it.

`scripts/scene-distance.mjs` measures how different two scenes look, in the
bodies' own terms: the major joints of each figure (the spine and the neck each
counted as one bend), where each partner is and how they are turned relative to
the first, and how the first lies against gravity. Where the scene stands, which
way it faces, body type and outfit do not count. A difference of 20° at a joint,
15 cm between partners, 20° of turn or tilt, or 15 cm of height is the least
that reads at a glance. A different support or number of people never matches.
`tests/sceneDistance.test.js` requires every pair of the 1,283 built positions
to differ by at least that much, and they all do.

That is a guarantee that no two positions look alike, not that every one is
exact. Some sources are themselves nearly the same picture: the same render on
two sites, or a series drawn with the same figures. Those records are told
apart by the slight difference each image does show, such as a knee raised, the head
turned or an arm placed, which is often smaller in the source than the least
visible difference drawn here.

## Props

Besides the floor, bed, sofa, chair, table and bench, three props are modeled
in their own shape rather than as a box (see
[the solver notes](solver.md#shaped-props)):

| Surface | Prop | Records |
|---|---|---:|
| `ball` | a 65 cm exercise ball | 27 |
| `car_seat` | a car's back seat, cushion and raked backrest | 13 |
| `wedge` | a 60 cm wedge cushion, 18 cm at its tall end | 10 |

What remains approximate: a figure bridged back over the ball keeps its arms at
the ball's sides rather than reaching the floor; the car seat stands alone, with
no door or roof, so a figure lying along it can have its head past the end of
the seat, and a partner the source shows kneeling in the footwell kneels on the
floor beside it; the wedge is lower than some of the ramps drawn, so a figure
lying back up it rests only the head and shoulders on it.

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
- `rear_oral` — one partner's head at the other's hips from behind.
- `edge_head_oral` — A lies on back with the head over the edge of a bed/table; B stands at A's head.
- `supine_stack` — both face up, one lying back on top of the other (grouped with partner on top).

Other
- `solo` — one person only (set `solo_posture`).
- `group_three` — three people. Set `base` to the template the main pair follows, and `third` = {"posture": standing|kneeling|seated|supine|side_lying|all_fours, "place": beside|at_head|behind|in_front}. A and B refer to the main pair.
- `other_pair` — two people and truly none of the above fits (use sparingly; describe briefly in `notes`).

# 3D interaction studies

Every one of the 1,283 SexPoses source records opens as a **3D interaction**:
the clothed participants are placed together, in contact, in the arrangement the
source image shows. The earlier artistic interpretation and generated approximation
remain available from each position's **•••** details (**Open artistic
interpretation** / **Open generated approximation**) and through
`?preset=builtin.position.kneeling-missionary&variant=artistic|generated`.

## Library positions

Every scene is also registered as a read-only built-in library preset
(`builtin.position.<name>`, the position's title in lower case with dashes),
listed in the unified **Positions** catalog once
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
cowgirl"), category ("partner on top") or ID ("zodiac"). Positions can be
favorited and opened with `?preset=builtin.position.zodiac`.
They cannot be deleted and are never written to local storage.

These are **approximations composed from templates**, not measured
reconstructions: the source images give no 3D coordinates, so each is read by eye
and rebuilt from a small vocabulary of interaction templates. Checks are geometric
(distance, overlap, floor) plus a static weight balance, not physical
certification.

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
   penetration, floor and furniture costs, then closes limb contacts. A figure
   the fit leaves in the air (fitted to a partner by its contacts, with nothing
   under it) is let down onto what is under it, or tipped onto it, whole
   (`settleWeight`): alone, or with its partners where they all hang together,
   and only so far as that takes no one further into a partner, the furniture
   or the floor and keeps the plan's distance, level and facing checks. Still
   in the air after the nearest moves, it is tried again from tipped 15 degrees
   each way, forward, back and to either side.
3. **Evaluation** — each scene is measured: required landmark distances, facing
   and orientation checks, body/prop overlap and floor clearance, and whether
   every figure is held up (`src/core/stability.js`). The weights are followed
   down to the ground: a body that lies or bears on the floor, furniture or a
   partner can be pushed up there (and the partner pushed down), and a hand that
   holds on, or is held, can push or pull, but by no more than half a body's
   weight. A figure fails if more than a tenth of its weight is carried by
   nothing, or its centre of mass is more than 8 cm from where what carries it
   would balance it: a woman lifted by a single hand at the hip, or lying back on
   nothing in front of a chair, hangs in the air. The ground is the floor, under
   every scene: a bed's or a sofa's ground is its top, which holds only what is
   over the furniture itself, so a foot beside the bed half a metre up, or a head
   in front of the sofa at the height of its seat, is held by nothing. A body
   lies on a partner only on top of them, the contact within 45 degrees of
   level: hips against the front of a standing partner's thighs hold nothing up.
   A hand and its wrist are one grip, not two. A hand closes round a limb or the
   neck and holds it either way; a trunk or a head it only lifts from beneath,
   presses on from above, or squeezes at the side, by half as much. A head and
   neck pressed to a partner lean on them with no more than 0.15 of the body's
   weight, so a face buried in a partner's hips does not hold a figure up. And a
   figure lying on a partner is held up by them, all its places together, by no
   more than its weight and that of anyone else on it, so a body is not squeezed
   level in the air between a partner's forearm over a thigh and hip under it.
   Only up and down is followed, so a figure leaning on a wall or into a
   standing partner is judged a little harshly. Failures are kept with the record and shown in the app as a warning;
   nothing is hidden.
4. **Baking** — `node scripts/build-interaction-studies.mjs` composes all records
   (1,283 distinct scenes: no two records share a classification,
   in 4 worker threads, about half an hour) into
   `public/catalog/interaction-studies-v1.json` with a SHA-256/size manifest in
   `src/data/interaction-manifest.json`. `--check` verifies the committed files
   reproduce exactly.

Every figure wears a top and shorts, plus anything its record adds (`a_wear` /
`b_wear`, below), uses fixed joints and a fixed placement, and
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
| `cowgirl` | 61 | 61 |
| `doggy` | 30 | 30 |
| `doggy_low` | 45 | 45 |
| `edge_head_oral` | 10 | 10 |
| `edge_missionary` | 41 | 41 |
| `edge_seated_facing` | 27 | 27 |
| `facesitting` | 22 | 22 |
| `furniture_rear` | 66 | 66 |
| `group_three` | 10 | 10 |
| `kneeling_missionary` | 111 | 111 |
| `kneeling_rear_upright` | 15 | 15 |
| `lap_facing` | 96 | 96 |
| `lap_reverse` | 77 | 77 |
| `missionary` | 62 | 62 |
| `oral_on_a` | 40 | 40 |
| `oral_on_b_kneeling` | 31 | 31 |
| `oral_on_b_lying` | 9 | 9 |
| `prone_on_top` | 14 | 14 |
| `prone_rear` | 61 | 61 |
| `rear_oral` | 17 | 17 |
| `reclined_facing` | 29 | 29 |
| `reverse_cowgirl` | 57 | 57 |
| `scissors` | 32 | 32 |
| `side_facing` | 4 | 4 |
| `sixty_nine` | 41 | 41 |
| `solo` | 32 | 32 |
| `spooning` | 33 | 33 |
| `squat_cowgirl` | 14 | 14 |
| `standing_bent_over` | 23 | 23 |
| `standing_carry` | 17 | 17 |
| `standing_facing` | 29 | 29 |
| `standing_rear` | 14 | 14 |
| `supine_stack` | 12 | 12 |
| `supported_inversion` | 69 | 69 |
| `wheelbarrow` | 32 | 32 |

Passing the checks means the declared contacts close, the figures are clear of
each other and the furniture, and every figure rests on the floor, a surface or
a partner, held up and held level by what it rests on, holds or is held by. It
does not mean the scene matches its reference in every detail.
Each record was also compared with its source image by eye. The remaining
simplifications are mostly a lean or arch shallower than drawn and a raised or
held leg shown lower, where the joint ranges stop them (a spine bends back 36°
in all, a hip flexes to 135°), and a few props drawn as the nearest one the
pack models (see [Props](#props)). A second piece of furniture in the picture
is in the scene where something rests on it: the chair drawn up to a table
(`table_chair`), the wall a partner braces against (`wall`) and the footstool a
wheelbarrow's hands rest on (`ottoman`).

### Records read without a usable picture

Two sources give nothing to read the pose from, so their records were composed
from what the position is called and carry a low `confidence` to say so:

- `lie-back-oral` "Lie Back Oral" (confidence 0.2): the image is blank. Read from the
  name as oral on a partner lying flat on the back (`lying flat`), the knees
  bent and open and the hands behind the head, the other partner lying face
  down between the legs. The arms are what tell it from `grounded-feedbag`, which it
  otherwise matches.
- `reverse-oral` (confidence 0.3): the picture does not match its annotation, and
  had been classified as a 69. Read from the picture's own title, "Reverse
  Oral Sex Position", as `rear_oral`: A low on the forearms and knees, the
  chest down and one leg stretched back, and B low behind with the face at A's
  buttocks.

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
  other) and `lying on top` (a 69 at full length). Notes also place a second
  piece of furniture: `hands on wall`, `hands on ottoman`, and `kneel on table,
  partner seated on chair` with the `table_chair` surface; and on a sofa,
  `head on floor` (lying back off its edge) and `kneeling beside` (kneeling on
  the floor alongside a partner lying on it).
- **Clothes**: `a_wear` and `b_wear` add garments to a role's studio top and
  shorts. The only one used is `cuffs`, a strap above each wrist and ankle, on
  the seven figures the pictures show restrained (`bend-over-boyfriend-shower`, `0389`, `0681`,
  `0730`, `0822`, `0945` for A and `standing-oral-iii` for B). A name `garments.js` does not
  know stops the build.
- **Leg shape**: `a_legs` shapes A's legs where the template leaves them open.
  Where the template's own shape already is the recorded one (a partner lying
  flat under a rider is `straight`, a piledriver's legs are `raised`, a carry
  holds them `wrapped`) or a prop fixes them (car, sling, the table and chair),
  changing `a_legs` changes nothing, by design. Where it differed from the
  picture it is honoured: on a kneeling partner's lap facing away the knees go
  wide or together, carried facing away they are held wide or drawn together,
  a wheelbarrow's legs on a chair are straight to the ankles or bent over its
  edge, under a partner in a plank the knees come up, and a partner giving
  oral with the knees drawn up together curls on the side.
- **Lean**: `lean` (`forward`, `back`, `upright`) is the trunk of whichever
  partner the template leaves free. Sitting on the edge of a table, bed or
  sofa facing the partner (`edge_seated_facing`), it is A's: `back` tips A back
  onto the hands, `forward` leans A in. Slouched on a chair, it is the partner's
  in front. On top face to face (`missionary`, `prone_on_top`), `upright`
  raises B's chest off A on the hands, the back a little arched. From behind,
  over furniture or low on the floor (`furniture_rear`, `doggy_low`), and at
  hips raised high (`supported_inversion`), it is B's. A
  partner leaning forward is tried leant in, then only bowed at the shoulders,
  then upright, and keeps the first the bodies and furniture allow (`leanIn`).
  Spooning already leans the pair together, so only `back` shows there; tied
  to a pole, `forward` is the head bowed, the chest being in the partner's
  way. Where the pose fixes the trunk, the recorded lean changes nothing, by
  design: low from behind facing away (`reverse-doggy`), bent over a car seat
  (`shotgun-tucked-groundhog`, `0447`), perched on a stool (`high-chair`), over the ball
  (`punishment`), kneeling up on a bed face to face with a partner standing
  (`kneeling`), and in the backbends and bridges (`cradle-knees-open`, `0128`, `0156`,
  `0645`, `0699`, `0724`, `0732`, `0765`, `0791`, `0961`, `1032`, `1157`).
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
as the hip allows. Legs straight on the hands and knees are on the hands and
toes, sloping down to the floor. Arms overhead, down on the forearms, stretch
out forward along the floor in a V: the chest is too low to raise them. On the
feet or the knees (`STANCE`), legs apart is a stance and wide a little wider,
not the splits: spread as far as lying down, one foot or both knees would come
up off the floor. A figure already crouched or spread by its own joints is taken
a visible step further (`FURTHER`), and one kneeling astride a partner's legs
has its knees apart already. The composer lays details on limb by limb, each
only as far as the floor and furniture allow (`applyDetails` in
`scripts/interaction-composer.mjs`). A detail or shape laid over a figure on
its feet or knees can lift some of them off the floor: it is set back down on
them (`restOnSupports`), lowered if all came up, however far, or tipped about
those still down, the shins folding up behind knees that come down. One lifted
further than a hand's breadth while the others stay down was raised on purpose
and stays up. Knees set apart for a partner to kneel between keep the shins
straight back behind them, not turned in under the partner. A limb that reaches
its partner is still placed by that reach, so an arm detail on a hand that
holds on does nothing.
Every detail a record lists was checked to change its scene, by composing the
record without it.

From behind, the partner in front is down on its knees and hands, forearms or
chest, and the one behind kneels or stands with its knees or feet on the floor,
not held up at the hips. Both kneeling, the hips are level and meet a little
further apart than from above. Low on the forearms facing away
(`reverse-doggy`), A's knees go wide and B kneels between them; behind a
partner folded down on the knees (`child-s-pose`), B bows less, over the hips
rather than into them; kneeling up behind arms raised behind the head
(`hot-seat-floor`), B may lean back a little to clear them. Behind a partner
lying face down over the ball with the knees bent (`jockey`), B is up on the
toes astride A's legs. Squatting astride over a partner on all fours, B has
the feet down outside A's knees, and a squat deepened by a detail (`leo`)
starts shallower and wider so they stay there. Head to toe on the hands and
knees (`sixty_nine`), B's knees are down either side of A's head, not borne on
A alone; where they come down beside A's shoulders, too close for A's hands to
reach B's thighs, A's arms lie along its sides instead. Upside down in front of
a seated partner (`bermuda-triangle`, `shocker`, `new-69-on-the-chair`,
`sitting-69`), A is held by B's hands at the waist, the thighs over B's
shoulders and the shins up behind B's head, A's hands on B's shins and the head
free between B's knees, or on the floor in front of B sitting there, the
headstand braced on B's knees. B sits flat, the seat down and the legs out, not
perched on the heels with A's head under the hips.

The hands that hold nothing are placed last, after every contact is closed.
First each hand that holds something has its contact checked as the viewer
measures it (`nameContacts`). A reach puts the palm on the nearest flesh it gets
to, which may be the thigh under the hip it was sent to. A hand that is off the
part its contact names, and on one a hand rests on (`REST_ON`), has its contact
renamed for that part, so it is shaped and turned for what it is on. A hand
still further than `UNMET` from what it names lets go of it (`dropUnmet`) and is
placed like any free hand, instead of closing its fist on air a forearm's
length off a hip. The last contact between the figures is kept, and so is one
the scene's checks fail without.

A hand that the record puts down on what the figure is on (`b_hands` `surface`
or `behind`, the `arms_planted` and `arms_braced_behind` details, or a
template's planted arm shape) is planted by `plantHands`. So is a hand the
posture is drawn leaning on (`hands` among its supports) when `leansOn` finds it
on nothing, with no floor, furniture or partner within `ON_IT` of its palm.
Rings of points around the place in front of, beside or behind the shoulder are
tried in turn. A point counts if the floor or a furniture top is under it, the
arm reaches it without locking straight (`STRAIGHT`), and it is clear of both
bodies. The palm is laid on that point facing down, with the fingers running
away from the body. A palm on the floor or a seat is held `PALM_OVER` over it,
and higher by `PALM_TILT` for each unit of its tilt off flat (`palmOver`): a
tilted palm's lower edge, or the tip of its little finger, went a centimetre
into the floor. A hand the posture already stands on, on the floor or a seat
but lower over it than that, is put down again where it is, that high. Where
the figure is over its partner and the floor is out of reach, the palm goes on
the partner under the shoulder instead, as a `rest` contact.

A figure the fit leaves held up by nothing - bent over at a partner's hips with
its face in them and nothing under its chest, or held out level in front of a
standing partner by its legs round their waist - is then held up with the hands
(`holdUp`). For each figure that falls short of held, the free hands are tried
where they would hold it: its own on the top of a partner, round a partner's
limb, or on the floor or the furniture under and in front of the shoulder
(`HOLD_RINGS`); a partner's round a limb of it or under it. A partner's hand
the template already puts on the figure, at its thighs, say, may be moved to
hold it elsewhere on it, under its belly. Each is put there by IK with the palm
turned onto it, and the hand that leaves everyone least short of held is kept,
then the next, up to `HOLD_HANDS`, while any figure is short of held or held
only just (`SPARE`). A hand on a partner becomes a `grip` contact round a limb,
or a `rest` on the trunk. The arm goes no further into anyone or the furniture
than it was, nor under the floor, nor from under a partner's hand on it, and
the holds are kept only where the scene meets every other check it met without
them, else one at a time.

Any other free hand, and a posture's hand that could not be planted, is laid
by `restFreeHands` on the nearest thing it can lie on. That may be the partner
(as a `rest` contact), the top of its own thigh or knee, the outer side of its
trunk, the furniture or the floor. Only a hand the picture holds up stays up:
one the record raises (`RAISED_DETAILS`, collected by `withRaised`: arms
overhead, on the straps, `arm_up_*`, or behind the head, where the hand lies on
the back of the head), one whose template arm shape holds it up (`RAISED_ARMS`:
over the head, on the straps), or one more than `HELD_UP` over the shoulder of
a figure that stands, sits or kneels.
Such a hand moves at most `REST_REACH` when the record draws its arm, and
`PARTNER_REACH` when it does not. Every other hand goes wherever its arm
reaches; a figure upside down holds nothing up. A hand flat on a wall, or on
the side of the furniture, is braced on it and stays there. A hand is not laid
on a partner's arm that holds something (`busy`): that arm is turned to face
what it holds, which would leave the hand on its edge. An arm put round or out
towards the partner (`arms_around`, or the `arms_forward` and `arm_forward_*`
details) goes on to the partner first. A figure lying down, its trunk nearer
level than upright (`lying`), or lying back half up with its chest to the
ceiling (`reclined`), does not hold an arm up over nothing. The arm swings
down about the shoulder on to the floor or the furniture under it, out to the
side and towards the feet if it was raised over the shoulder. A hand held out
past the edge of the furniture is drawn back on to its top. The hand lies on
its palm, or else on its back.

A place on the partner counts only if it is within the region its contact name
is measured on (`region` in `surfaceContacts.js`), so the contact reads the
same gap when the scene is viewed. A palm laid on the floor or a seat is held
as high as its tilt needs (`palmOver`), and a place is as far from the hand as
that puts it. The arm is kept only when it goes no further into anyone than it
was, or than `TOUCH_SLACK` for a hand laid on a body (the partner's or its
own), lies no lower than the floor, and the scene still meets its checks. A
hand whose knuckles or thumb the reach puts into the floor is put down again
that much higher. Each place is tried again with the elbow out to the side,
and a fallen hand with the elbow up, before the next place is tried. Up to
`REST_TRIES` places on a partner and as many elsewhere are tried, the nearest
first; one the arm cannot reach is not counted. Otherwise the hand stays where
the pose put it.

Some hands are left as the pose put them. A tied figure's hands (`bound`: one
in `cuffs`, or tied by its template to a pole or hogtied) are neither planted
nor laid anywhere. An arm a partner's hand holds or lies on (`onArm`) is put
down by `plantHands` or `restFreeHands` only where it takes that hand with it:
each such hand, measured as the viewer measures it (`armHeld`), may end no
more than a centimetre further off the arm than it was, or than `HAND_ON`. A
supine figure's arm with the partner's hand on its upper arm is still laid on
the bed; one that would leave the partner's grip a hand's breadth off it is
not. Turning the palms to what they touch (`facePalms`) does not take the arm
from under a partner's hand either. An arm shape from the template that puts the hands somewhere of
its own (`PLACED_ARMS`: on the forearms, round the partner, over the head) is
not planted, unless the record's details draw over that arm. B's hands on the
surface do not plant an arm that B's details draw another way, such as put
forward or behind the head. A posture that leans on its hands does not plant an
arm that the record's details draw, such as forearms down. These shapes are
what tell such pictures apart from their neighbours.

The viewer draws a free hand by what is under it. A relaxed hand whose palm
faces down within `RESTING` (9 cm) of the floor or the furniture under its
middle is drawn flat, as a brace (`restingHands` in `palmPose.js`). The
scan's thumb hangs under a relaxed palm, and a relaxed hand five centimetres up
had its thumb as far into the floor. A palm put down tilted is held as high as
its tilt needs (`palmOver`), up to eight centimetres, and curled there its
fingertips went into the floor.

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

Besides the floor, bed, sofa, chair, table and bench, four props are modeled
in their own shape rather than as a box (see
[the solver notes](solver.md#shaped-props)):

| Surface | Prop | Records |
|---|---|---:|
| `ball` | a 65 cm exercise ball | 28 |
| `car_seat` | a car's back seat, cushion and raked backrest, inside its cabin | 14 |
| `wedge` | a 60 cm wedge cushion, 18 cm at its tall end | 9 |
| `ramp` | a 75 cm positioning ramp, 38 cm at its tall end | 1 |

The rest are plain boxes, for the furniture and gear the pictures show:

| Surface | Prop | Records |
|---|---|---:|
| `ottoman` | a 42 cm footstool | 1 |
| `wall` | a wall, its face 35 cm behind the scene's origin | 1 |
| `table_chair` | a 75 cm table with a chair drawn up to it | 3 |
| `swing` | a sex swing: a seat strap 75 cm up, a strap from each end to a bar at 2.1 m | 2 |
| `swing_low` | the same swing let down to 33 cm, over a partner lying under it | 1 |
| `sling` | a padded sheet 80 cm up, hung by a chain from each corner | 2 |
| `pole` | a floor-to-ceiling pole, 20 cm behind the origin | 1 |
| `stairs` | a flight of 18 cm steps, 28 cm deep | 2 |
| `pillows` | three bed pillows stacked 45 cm high | 1 |
| `pillow` | one pillow on the floor, under the hips | 1 |
| `spreader_bar` | a 1.16 m bar hung on a chain at 1.47 m, the wrists held up and apart | 1 |

A strap, chain, pole or bar is held or leant on, not sat on, so the scene's
seat height stays at the swing's seat, the sling's sheet or the floor. In the
swing a partner sits hanging back in the seat, the hands up on its straps,
facing a partner standing (`flying-missionary`) or kneeling in front of them for oral
(`airborne-oral`); let down low, a rider kneels up astride in it over a partner
lying on the floor (`swinging-cowgirl`). In the sling a figure lies face up with the
legs up either side of the chains (`wide-open`), or face down along it with a
partner standing at its end (`doggy-in-space`). At the stairs a partner kneels on
the floor facing up them, the hands on the third step, the other kneeling
behind (`stairway-to-heaven`, `stairway-to-heaven-ii`); at the pole a partner stands with the back to
it, the arms tied back round it, facing a partner standing in close
(`pole-bondage`); at the spreader bar a figure kneels up with the wrists at its
ends (`vertical-x-bondage`). Over the pillow stack a partner kneels with the chest on it
(`magic-mountain-bench-knees-open`), on the pillow a figure on the forearms and knees has the hips on
it (`bed-humping`), and up the ramp a partner lies back with the head at its
tall end, the other kneeling between the legs (`sloped-admission`).

The car seat sits inside a `shell`: the roof, both doors, the rear glass and
the backs of the front seats. Nothing rests on it, but every body is fitted and
checked against it like any other prop, so no head comes up through the roof
and no knee or foot goes through a door. The app draws it see-through, and the
line-art and depth exports leave it out. Inside it the car poses are the ones
the roof allows: kneeling up on the seat, B's back is rounded and the head
bowed; on a lap, B slides down the seat against its rake and A bows over; a
partner lying across the seat has the head against the door; and a partner
receiving oral lies back across the seat with the legs raised (`oral-pleasures`),
the other crouched on the seat at the hips, tipped forward on the knees with
the feet up behind against the far door, since shins laid flat on the seat
would go through it.

What remains approximate:

- **Arches and raised legs** are as deep as the joint ranges allow and no
  deeper: the three spine joints bend back 36° in all and a hip flexes to 135°,
  so a steep backbend, a lean far back or a leg held high is shallower or lower
  than drawn. A figure bridged back over the ball keeps its hands at the ball's
  sides rather than reaching the floor for the same reason: with the hips on
  the ball, the spine and shoulders cannot bend far enough back.
- **The car** is a large SUV's cabin with the front seats slid all the way
  forward, sized to the SUV the pictures show and roomier than a small car's.
  The pictures of a reclined driver's or passenger's front seat are drawn on
  the back seat of the same cabin, which is the only seat modeled.
- **The wedge and ramp**: the wedge is lower than some of the blocks drawn, so
  a figure lying back up it rests only the head and shoulders on it; the one
  lain back up a tall ramp (`sloped-admission`) is on the ramp. The two lying face down
  over a tall block with a partner kneeling behind (`over-the-wedge`, `double-mount-penetration`)
  stay on the wedge: over the ramp's 38 cm the knees no longer reach the floor
  and the partner cannot kneel in behind the feet. A bolster (`speed-bump-ii`) is
  drawn as the wedge, and a tall wedge stood on end (`ramp-it-up`) is left out,
  the figure bent over on the floor.
- **Hung gear** is boxes: a strap or chain hangs straight down and cannot
  slant to a hand, so the hands hold it where it hangs; the low swing's seat is
  a strip under the hips alone, so the thighs come forward off it clear of the
  straps. Props do not move or bend, so none is worn: a spreader bar between
  the ankles (`carnal-clutch`) is drawn as the cuffs alone, and a swing lain on in
  a 69 (`sex-swing-69`) is left out, the pair lying on the floor.
- **Placement**: against the pole the partner stands in contact rather than a
  step away, and on the stairs `stairway-to-heaven-ii`'s partner kneels on the floor at
  their foot rather than on a lower step.

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

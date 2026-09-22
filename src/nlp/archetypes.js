/**
 * Whole descriptions that have a name.
 *
 * Most of what people type is compositional - a posture each, a word for how
 * they are arranged - and the parser builds that up piece by piece. But a
 * handful of configurations have names of their own, and those names carry more
 * information than their parts: "cowgirl" fixes both postures, the arrangement,
 * where the hands go and which way each person faces, none of which is
 * recoverable from the word itself.
 *
 * An archetype is therefore a complete scene skeleton, matched before anything
 * else and then *overridden* by whatever else the description says. "cowgirl,
 * but she's facing away" should get the archetype and then turn her around, not
 * throw the archetype away because of the qualifier. The parser handles that by
 * treating archetype values as defaults that later matches replace.
 *
 * `actors[0]` is the primary - the partner the other is placed relative to.
 * That is the solver's convention and getting it backwards is the difference
 * between someone lying on a bed and someone lying under a floor.
 */

/**
 * @typedef {object} Archetype
 * @property {string} id
 * @property {string[]} phrases what to look for, matched like any other lexicon entry
 * @property {string} label how to describe the result back to the user
 * @property {string} surface
 * @property {string} arrangement
 * @property {number} [yaw] absolute override for the secondary's facing
 * @property {"toward"|"away"} [facing] the secondary's facing relative to the
 *           arrangement's own default, which is the form to prefer
 * @property {Array<{posture:string, bodyType?:string}>} actors
 * @property {Array<object>} [contacts]
 * @property {object} [layout] Calibrated stock scene data and matching bounds.
 */

import { SIDE_FACING_LAYOUT, SPOONING_LAYOUT } from "./presetLayouts.js";
import { CHAIR_LAP_LAYOUT } from "./chairLapLayout.js";
import { SEATED_EMBRACE_LAYOUT } from "./seatedEmbraceLayout.js";
import { STANDING_CARRY_LAYOUT } from "./standingCarryLayout.js";
import { TABLE_SUPPORT_LAYOUT } from "./tableSupportLayout.js";
import { KNEELING_PAIR_LAYOUT } from "./kneelingPairLayout.js";
import { RECLINING_PAIR_LAYOUT } from "./recliningPairLayout.js";
import { STRADDLE_PAIR_LAYOUT, REVERSE_STRADDLE_PAIR_LAYOUT } from "./straddlePairLayouts.js";
import { HEAD_TO_TOE_LAYOUT } from "./headToToeLayout.js";

/** @type {Archetype[]} */
export const ARCHETYPES = [
  {
    id: "missionary",
    layout: RECLINING_PAIR_LAYOUT,
    phrases: ["missionary", "missionary position", "传教士", "传教士体位", "正常体位", "男上女下"],
    label: "one partner lying on their back, the other above them, face to face",
    surface: "bed",
    arrangement: "over_supine",
    // Propped on the forearms, not lying flat. A flat partner has their arms
    // pinned at their sides and nothing to hold their weight off the other
    // person, and the solver has to resolve that as 130mm of compression
    // through both ribcages. On the forearms it settles at a third of that and
    // the arms end up where the pose actually puts them, with no hand contacts
    // needed to drag them there.
    actors: [
      { posture: "supine", bodyType: "female" },
      { posture: "forearms_and_knees", bodyType: "male" },
    ],
  },
  {
    id: "cowgirl",
    layout: STRADDLE_PAIR_LAYOUT,
    phrases: ["cowgirl", "woman on top", "女上", "女上位", "骑乘位"],
    label: "one partner astride the other, who is lying on their back",
    surface: "bed",
    arrangement: "straddle_supine",
    actors: [
      { posture: "supine", bodyType: "male" },
      { posture: "kneeling_straddle", bodyType: "female" },
    ],
    contacts: [
      { from: "hand.l", to: "knee.r", fromActor: 0, toActor: 1, type: "support", strength: 0.7 },
      { from: "hand.r", to: "knee.l", fromActor: 0, toActor: 1, type: "support", strength: 0.7 },
    ],
  },
  {
    id: "reverse_cowgirl",
    layout: REVERSE_STRADDLE_PAIR_LAYOUT,
    phrases: ["reverse cowgirl", "facing away on top", "背对女上", "反向骑乘"],
    label: "one partner astride the other, facing away",
    surface: "bed",
    arrangement: "straddle_supine",
    // The same arrangement, turned around - which is what the name says, and is
    // worth expressing as the half turn it is rather than as a bare number of
    // degrees. The degrees would have to be revisited every time the
    // arrangement's own default moved; "away" would not.
    facing: "away",
    actors: [
      { posture: "supine", bodyType: "male" },
      { posture: "kneeling_straddle", bodyType: "female" },
    ],
    contacts: [
      { from: "hand.l", to: "knee.l", fromActor: 0, toActor: 1, type: "support", strength: 0.7 },
      { from: "hand.r", to: "knee.r", fromActor: 0, toActor: 1, type: "support", strength: 0.7 },
    ],
  },
  {
    id: "doggy_style",
    layout: KNEELING_PAIR_LAYOUT,
    phrases: ["doggy style", "doggy", "从后面跪姿", "后入式", "狗爬式"],
    label: "one partner on hands and knees, the other kneeling behind",
    surface: "bed",
    arrangement: "rear_alignment",
    actors: [
      { posture: "all_fours", bodyType: "female" },
      { posture: "kneeling", bodyType: "male" },
    ],
  },
  {
    id: "spooning",
    layout: SPOONING_LAYOUT,
    phrases: ["spooning", "spoons position", "侧卧后抱", "汤匙式"],
    label: "both on their sides, one curled behind the other",
    surface: "bed",
    arrangement: "spooning",
    actors: [
      { posture: "side_lying", bodyType: "female" },
      { posture: "side_lying", bodyType: "male" },
    ],
  },
  {
    id: "lotus",
    layout: SEATED_EMBRACE_LAYOUT,
    phrases: ["lotus position", "lotus", "seated embrace", "莲花式", "观音坐莲", "面对面坐姿"],
    label: "one partner seated, the other in their lap facing them",
    surface: "floor",
    arrangement: "straddle_lap",
    actors: [
      { posture: "seated", bodyType: "male" },
      { posture: "seated_straddle", bodyType: "female" },
    ],
    contacts: [
      { from: "hand.left", to: "upperBack", fromActor: 0, toActor: 1, strength: 0.6 },
      { from: "hand.right", to: "upperBack", fromActor: 0, toActor: 1, strength: 0.6 },
    ],
  },
  {
    id: "chair_straddle",
    phrases: ["on his lap in a chair", "lap dance", "straddling a chair", "椅上跨坐"],
    label: "one partner seated on a chair, the other straddling their lap",
    surface: "chair",
    layout: CHAIR_LAP_LAYOUT,
    arrangement: "straddle_lap",
    actors: [
      { posture: "seated", bodyType: "male" },
      { posture: "seated_straddle", bodyType: "female" },
    ],
  },
  {
    id: "bent_over_table",
    layout: TABLE_SUPPORT_LAYOUT,
    phrases: [
      "bent over the table", "bent over a desk", "over the edge of the bed",
      "俯身桌上", "趴在桌上", "扶桌后入",
    ],
    label: "one partner bent over a surface, the other standing behind",
    surface: "table",
    arrangement: "behind_bent_over",
    actors: [
      { posture: "bent_over_support", bodyType: "female" },
      { posture: "standing", bodyType: "male" },
    ],
  },
  {
    id: "standing_carry",
    layout: STANDING_CARRY_LAYOUT,
    phrases: [
      "standing carry", "carried against the wall", "picked up and held",
      "站立抱起", "壁咚抱起", "抱起来",
    ],
    label: "one partner standing, carrying the other",
    surface: "floor",
    arrangement: "supported_lift",
    actors: [
      { posture: "standing", bodyType: "male" },
      { posture: "lifted", bodyType: "female" },
    ],
  },
  {
    id: "sixty_nine",
    layout: HEAD_TO_TOE_LAYOUT,
    phrases: ["sixty nine", "69 position", "69式", "头尾相对姿势"],
    label: "lying head to toe in opposite directions",
    surface: "bed",
    arrangement: "head_to_toe",
    actors: [
      { posture: "supine", bodyType: "female" },
      { posture: "prone", bodyType: "male" },
    ],
  },
  {
    id: "side_by_side_facing",
    layout: SIDE_FACING_LAYOUT,
    phrases: ["lying face to face", "facing each other in bed", "侧躺面对面"],
    label: "both lying on their sides, facing each other",
    surface: "bed",
    arrangement: "face_to_face",
    actors: [
      { posture: "side_lying", bodyType: "female" },
      { posture: "side_lying", bodyType: "male" },
    ],
  },
  {
    id: "standing_embrace",
    phrases: ["standing embrace", "standing facing each other", "hugging", "拥抱", "站立相拥"],
    label: "both standing, facing and holding each other",
    surface: "floor",
    arrangement: "face_to_face",
    actors: [
      { posture: "standing", bodyType: "female" },
      { posture: "standing", bodyType: "male" },
    ],
    contacts: [
      { from: "hand.left", to: "back", fromActor: 1, toActor: 0, strength: 0.7 },
      { from: "hand.right", to: "back", fromActor: 1, toActor: 0, strength: 0.7 },
    ],
  },
];

/** Lexicon-shaped entries, so archetypes match through the same scanner. */
export const ARCHETYPE_ENTRIES = ARCHETYPES.flatMap((archetype) =>
  archetype.phrases.map((phrase) => ({ phrase, kind: "archetype", value: archetype.id }))
);

export const ARCHETYPES_BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));

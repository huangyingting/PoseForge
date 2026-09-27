/**
 * Reading the long tail of pose vocabulary.
 *
 * The reference corpus does not use a closed set of names. Its 1283 annotations
 * spend 191 different words on posture, 150 on arrangement and 78 on what the
 * pair is resting on, and almost all of the long tail is *built* rather than
 * chosen: `seated_reclined_against_partner`, `prone_or_low_all_fours`,
 * `bed_sofa_chair_table_or_vehicle_seat`. Hand-written aliases cover the head of
 * that distribution and never reach the tail - the explicit tables in
 * `poseLibrary.js` got posture to 58% and arrangement to 48%, and every new
 * source of descriptions would start the job over.
 *
 * So names are read instead of looked up. A name is split into tokens, the
 * tokens vote for the postures they are evidence of, and the highest total
 * wins. That handles the tail without enumerating it, and it handles words the
 * corpus never used - which matters more, because the thing on the other end of
 * this is a person typing a sentence.
 *
 * Two things fall out of the design and are worth stating.
 *
 * **Alternation is a choice, not a blend.** `standing_or_kneeling` is an
 * annotator saying they could not tell from the photograph, with their best
 * guess first. Averaging the two gives a crouch, which is neither. So `_or_`
 * splits into candidates tried in order, and the first that gets any votes is
 * the answer.
 *
 * **Votes are cumulative down a family.** `supine` is evidence for `supine` and
 * weaker evidence for `supine_legs_raised`; `legs_raised` is evidence for the
 * latter only. That way the compound name out-scores its own parts -
 * `supine_legs_high` reads as the raised-legs posture - while the bare word
 * still reads as itself.
 *
 * These are the *fallback*. The explicit tables still run first and still win,
 * because a hand-written mapping encodes a judgement that no amount of token
 * counting can reconstruct.
 */

/** Lower-case, and treat spaces, hyphens and underscores as the same gap. */
export function normaliseName(name) {
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/[\s\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Split an ambiguous name into the readings it offers, best first.
 *
 * Only `_or_` splits. `_and_` does not: `table_and_floor` is one scene with two
 * heights in it, not two candidate scenes, and the surface resolver wants to
 * see both tokens.
 */
export function alternatives(name) {
  const parts = name.split("_or_").filter(Boolean);
  return parts.length ? parts : [name];
}

/**
 * Match `phrases` against a token run, longest first, without overlap.
 *
 * Longest-first is what keeps `bent_over` from also scoring as `bent`, which
 * would double-count the same two words and let a qualifier outweigh the
 * posture it qualifies.
 */
export function tally(tokens, phrases, maxPhrase = 3) {
  const votes = new Map();
  let matched = 0;
  let index = 0;
  while (index < tokens.length) {
    let hit = null;
    for (let span = Math.min(maxPhrase, tokens.length - index); span >= 1; span -= 1) {
      const key = tokens.slice(index, index + span).join("_");
      if (phrases[key]) {
        hit = { span, weights: phrases[key] };
        break;
      }
    }
    if (!hit) {
      index += 1;
      continue;
    }
    for (const [target, weight] of Object.entries(hit.weights)) {
      votes.set(target, (votes.get(target) ?? 0) + weight);
    }
    matched += 1;
    index += hit.span;
  }
  return { votes, matched };
}

/** Highest total, ties broken by `order` so the same name always reads the same way. */
export function winner(votes, order) {
  let best = null;
  for (const [target, score] of votes) {
    const rank = order.indexOf(target);
    if (!best || score > best.score || (score === best.score && rank < best.rank)) {
      best = { target, score, rank: rank < 0 ? order.length : rank };
    }
  }
  return best;
}

/**
 * Posture evidence.
 *
 * Each phrase lists what it is evidence *of*, and by how much. Weights are on
 * one scale throughout: 10 means "this word names the posture", 5-7 means "this
 * word is part of the posture's name", 2-4 means "this word leans that way".
 */
const POSTURE_VOTES = {
  supine: { supine: 10, supine_legs_raised: 6, bridge: 3 },
  on_back: { supine: 10, supine_legs_raised: 6 },
  face_up: { supine: 9, supine_legs_raised: 4 },
  lying: { supine: 4, side_lying: 2, prone: 2 },
  lie: { supine: 4, side_lying: 2, prone: 2 },
  reclining: { reclined: 10, seated_reclined: 7, supine: 3 },
  reclined: { reclined: 10, seated_reclined: 7, supine: 3 },
  recline: { reclined: 10, seated_reclined: 7 },
  semi_supine: { reclined: 9 },

  prone: { prone: 10, forearms_and_knees: 3 },
  face_down: { prone: 9 },
  curled: { side_lying: 5, prone: 2 },

  side_lying: { side_lying: 12 },
  side_prone: { prone: 8, side_lying: 5 },
  side: { side_lying: 6 },
  spooning: { side_lying: 9 },

  seated: { seated: 10, seated_reclined: 7, seated_straddle: 6, seated_floor: 5 },
  seat: { seated: 8, seated_floor: 4 },
  sitting: { seated: 10, seated_reclined: 7, seated_straddle: 6, seated_floor: 5 },
  sits: { seated: 10, seated_straddle: 6 },
  cross_legged: { seated_floor: 9 },
  // "on the floor" is only evidence about a *seated* figure - everyone else in
  // the corpus is on the floor too, and it says nothing about them. It has to
  // outweigh `seated`'s own vote for the chair, or `seated_on_floor` puts
  // somebody on the floor onto a chair 460mm above it.
  floor: { seated_floor: 6 },

  kneeling: { kneeling: 10, kneeling_low: 6, kneeling_straddle: 7, all_fours: 3 },
  kneel: { kneeling: 10, kneeling_low: 6, kneeling_straddle: 7 },
  kneels: { kneeling: 10, kneeling_straddle: 7 },
  knees: { kneeling: 6, all_fours: 3 },
  half_kneeling: { kneeling: 8 },
  low: { kneeling_low: 6, forearms_and_knees: 3, prone: 2 },
  deeply_flexed: { kneeling_low: 4 },

  all_fours: { all_fours: 12, forearms_and_knees: 4 },
  hands_and_knees: { all_fours: 12 },
  forearms: { forearms_and_knees: 9, all_fours: 2 },
  plank: { all_fours: 6, prone: 3 },

  standing: { standing: 10, standing_bent_forward: 6 },
  stand: { standing: 10, standing_bent_forward: 6 },
  stands: { standing: 10 },
  upright: { standing: 6, kneeling: 3, seated: 2 },
  one_leg_raised: { standing: 5 },
  one_leg_stand: { standing: 8 },
  // Being behind someone is faint evidence of being on your feet - it is what
  // `behind_chair_partner` means, where every other word describes the partner
  // rather than the subject. Weak enough that any posture word overrides it.
  behind: { standing: 4 },

  squat: { squatting: 11, kneeling_low: 4 },
  squatting: { squatting: 11, kneeling_low: 4 },
  crouch: { squatting: 9, kneeling_low: 4 },
  crouching: { squatting: 9, kneeling_low: 4 },
  deep_squat: { squatting: 13 },
  half_squat: { squatting: 11 },

  bent: { standing_bent_forward: 5, bent_over_support: 5 },
  bent_forward: { standing_bent_forward: 8, bent_over_support: 4 },
  bent_over: { bent_over_support: 6, standing_bent_forward: 5 },
  forward_lean: { standing_bent_forward: 5, bent_over_support: 3 },
  lean: { standing_bent_forward: 4, bent_over_support: 3 },
  leaning: { standing_bent_forward: 4, bent_over_support: 3 },
  // Furniture is only evidence for the bent-over posture next to a word that
  // says someone is bent or leaning. On its own it names where the scene is.
  furniture: { bent_over_support: 4 },
  table: { bent_over_support: 4 },
  bed: { bent_over_support: 2 },
  chair: { bent_over_support: 3, seated: 4 },
  sofa: { seated_reclined: 3 },
  wheelchair: { seated: 6 },

  legs_raised: { supine_legs_raised: 9, lifted: 2 },
  legs_high: { supine_legs_raised: 9 },
  legs_open: { supine_legs_raised: 6, kneeling_straddle: 2 },
  legs_up: { supine_legs_raised: 8 },
  folded: { supine_legs_raised: 5, inverted: 3 },

  straddle: { seated_straddle: 10, kneeling_straddle: 7 },
  straddling: { seated_straddle: 10, kneeling_straddle: 7 },
  straddles: { seated_straddle: 10, kneeling_straddle: 7 },
  lap: { seated_straddle: 8 },
  top: { kneeling_straddle: 5, prone: 2 },

  inverted: { inverted: 12 },
  inversion: { inverted: 12 },
  handstand: { inverted: 11 },
  shoulder_stand: { inverted: 11 },

  bridge: { bridge: 11 },
  bridging: { bridge: 11 },

  lifted: { lifted: 10 },
  lift: { lifted: 10 },
  lifting: { lifted: 8 },
  carried: { lifted: 10 },
  carry: { lifted: 9 },
  held: { lifted: 7 },
  suspended: { lifted: 9, inverted: 2 },
  harness: { lifted: 6 },

  // The partner doing the holding. Nothing in the word says which posture they
  // hold it from, and the corpus splits about evenly between standing and
  // kneeling, so this only breaks a tie - any real posture word outvotes it.
  supporting: { standing: 5, kneeling: 4 },
  supporter: { standing: 5, kneeling: 4 },
  supported: { standing: 3, kneeling: 2 },
  support: { standing: 3, kneeling: 2 },

  // Lying across the partner rather than along them. It says the trunk is
  // horizontal and rolled, which is what side-lying is.
  crosswise: { side_lying: 5, prone: 2 },
  across: { side_lying: 4 },
  opposed: { side_lying: 3 },
  exercise_ball: { reclined: 5 },
};

/**
 * What is holding the figure up, when a caller knows it separately.
 *
 * A posture name describes a shape; this describes what touches the ground,
 * and there are pairs of postures in the library that are the same shape and
 * differ only in that. `kneeling_all_fours` is the corpus's name for a figure
 * down on all fours, and it is also the corpus's name for one down on her
 * forearms - what separates them is that the annotator wrote `forearms` rather
 * than `hands` in a different field. The same word carries more here than it
 * does inside a posture name, because here it is a direct statement about
 * weight rather than a loose part of a label.
 *
 * Only the discriminating words appear. `knees`, `feet`, `back` and `seat` are
 * among the commonest supports in the corpus and none of them says anything
 * the posture name has not already said, so none of them votes.
 *
 * Two rules keep this from running away, and both were put in after measuring.
 * A phrase with `or` in it is the annotator hedging - `feet_or_hands`,
 * `knees_feet_or_hands` - and votes for nothing at all, because "one of these
 * is taking the weight" is not evidence about which. And a support may only
 * promote a posture the *name* already put in contention; without that,
 * `forearms` turned every `seated_bent_forward` into a figure on all fours.
 *
 * With both rules in, this moves 40 of the corpus's 2567 postures, and 39 of
 * those are moves it was built to make: `kneeling_close` supported on the
 * shins becomes `kneeling_low`, `low_kneeling_over_partner` with the hands
 * down becomes `all_fours`, `kneeling_all_fours` on the forearms becomes
 * `forearms_and_knees`. The fortieth turns a reverse straddle into all fours
 * on the strength of one `hands`, and softening that word far enough to save
 * it also loses the ten that are right.
 */
const SUPPORT_VOTES = {
  // The forearm cases. These are the ones this table exists for.
  forearms: { forearms_and_knees: 24 },
  elbows: { forearms_and_knees: 20 },

  // A planted hand is weight on the arm, which `kneeling` does not have and
  // `all_fours` does. A hand on the *partner* is not weight on the floor and
  // is matched first, as the longer phrase, so it never reaches this.
  hands: { all_fours: 12 },
  hand: { all_fours: 10 },
  hands_on_partner: {},
  hands_on_floor: { all_fours: 18 },

  // Kneeling sat back on the shins rather than up on the knees.
  shins: { kneeling_low: 20 },
  shins_and_feet: { kneeling_low: 20 },
  heels: { kneeling_low: 14, squatting: 6 },

  // Weight through the shoulders means the figure is upside down on them.
  shoulders: { inverted: 12, bridge: 10 },
  shoulders_and_head: { inverted: 20 },
  head_and_shoulders: { inverted: 20 },

  // Weight through the trunk's side or front says which way it is rolled,
  // which several of the lying postures differ only in.
  side_torso: { side_lying: 14 },
  front_torso: { prone: 12 },
};

/** A hedged support says which parts *might* be bearing weight, which is not
 *  evidence about the posture. `alternatives` treats `_or_` as a choice to try;
 *  here the honest reading is that the annotator did not know. */
const isHedged = (phrase) => /(^|_)or(_|$)/.test(phrase);

/**
 * Add a support reading's votes to a name's, without letting the support
 * invent a posture the name never raised.
 */
function addSupportVotes(votes, support) {
  const list = (Array.isArray(support) ? support : [support]).filter(Boolean);
  for (const phrase of list) {
    const normalised = normaliseName(phrase);
    if (!normalised || isHedged(normalised)) continue;
    for (const [target, weight] of tally(normalised.split("_"), SUPPORT_VOTES).votes) {
      if (!votes.has(target)) continue;
      votes.set(target, votes.get(target) + weight);
    }
  }
  return votes;
}

/**
 * Tie-break order, and the order a bare reading falls back through.
 *
 * Earlier is preferred. The ordering is by how ordinary the posture is, so a
 * name that genuinely does not distinguish two readings gets the commoner one.
 */
const POSTURE_ORDER = [
  "standing",
  "seated",
  "supine",
  "kneeling",
  "all_fours",
  "side_lying",
  "prone",
  "reclined",
  "seated_reclined",
  "kneeling_straddle",
  "seated_straddle",
  "supine_legs_raised",
  "kneeling_low",
  "forearms_and_knees",
  "standing_bent_forward",
  "bent_over_support",
  "seated_floor",
  "squatting",
  "bridge",
  "inverted",
  "lifted",
];

/**
 * Read a posture name compositionally.
 *
 * `support` is optional and names what is holding the figure up - a phrase or
 * a list of them. It only ever refines: it adds votes to the name's own tally
 * rather than replacing it, so a clear posture name still wins and the support
 * decides between readings the name left level. See SUPPORT_VOTES.
 *
 * `prior` is optional and is the answer the caller already has from somewhere
 * more authoritative than a token vote: `{ target, weight }`. A canonical
 * posture name is worth much more than an alias, because an alias is one
 * reading of somebody's paraphrase and the canonical name is the thing itself.
 *
 * @returns {string|null} a base posture id, or null if the name said nothing
 */
export function readPostureName(name, support = null, prior = null) {
  for (const candidate of alternatives(normaliseName(name))) {
    const { votes } = tally(candidate.split("_"), POSTURE_VOTES);
    if (prior) votes.set(prior.target, (votes.get(prior.target) ?? 0) + prior.weight);
    const best = winner(support ? addSupportVotes(votes, support) : votes, POSTURE_ORDER);
    if (best) return best.target;
  }
  return null;
}

/** Arrangement evidence, same scale as the posture votes. */
const ARRANGEMENT_VOTES = {
  rear: { rear_alignment: 10, behind_bent_over: 4, spooning: 3 },
  behind: { rear_alignment: 10, behind_bent_over: 4, spooning: 3 },
  from_behind: { rear_alignment: 10 },
  back_to_chest: { rear_alignment: 8, spooning: 4, straddle_lap: 4 },
  back_to_front: { rear_alignment: 8, spooning: 4 },

  face_to_face: { face_to_face: 10 },
  facing: { face_to_face: 8 },
  front_facing: { face_to_face: 9 },
  front: { face_to_face: 8 },
  embrace: { face_to_face: 5 },

  straddle: { straddle_lap: 8, straddle_supine: 6 },
  straddling: { straddle_lap: 8, straddle_supine: 6 },
  lap: { straddle_lap: 8 },
  seated: { straddle_lap: 5 },
  sitting: { straddle_lap: 5 },
  chair: { straddle_lap: 4 },
  sofa: { straddle_lap: 3 },

  supine: { over_supine: 5, straddle_supine: 4 },
  reclining: { over_supine: 5, straddle_supine: 4 },
  reclined: { over_supine: 5, straddle_supine: 4 },
  over: { over_supine: 7, straddle_supine: 3 },
  above: { over_supine: 7, straddle_supine: 3 },
  on_top: { over_supine: 6, straddle_supine: 5 },
  top: { over_supine: 6, straddle_supine: 4 },
  under: { over_supine: 6 },
  below: { over_supine: 6 },
  between: { over_supine: 4 },
  kneeling: { over_supine: 4, rear_alignment: 2 },
  prone: { rear_alignment: 3, over_supine: 2 },
  raised: { over_supine: 3 },
  leg: { over_supine: 2 },
  legs: { over_supine: 2 },
  overlap: { over_supine: 4 },

  side_lying: { spooning: 8, side_by_side: 3 },
  spooning: { spooning: 10 },
  entangled: { spooning: 6 },
  intertwined: { spooning: 6 },
  side_by_side: { side_by_side: 7, spooning: 5 },
  parallel: { side_by_side: 6 },
  beside: { side_by_side: 5 },
  crosswise: { over_supine: 3, side_by_side: 3 },

  bent: { behind_bent_over: 6 },
  bent_over: { behind_bent_over: 8 },

  inverted: { supported_lift: 9 },
  inversion: { supported_lift: 9 },
  suspended: { supported_lift: 11 },
  lift: { supported_lift: 10 },
  lifted: { supported_lift: 10 },
  carry: { supported_lift: 10 },
  held: { supported_lift: 10 },
  acrobatic: { supported_lift: 6 },
  support: { supported_lift: 6 },
  supported: { supported_lift: 6 },
  supporting: { supported_lift: 8 },
  bridge: { supported_lift: 5 },

  head_near_pelvis: { head_to_toe: 11 },
  head_to_hip: { head_to_toe: 11 },
  head_to_toe: { head_to_toe: 12 },
  opposed: { head_to_toe: 7 },

  // Somebody standing or kneeling at the edge of the thing the other is lying
  // on. It says they are on opposite sides of that edge, which is the only
  // thing face-to-face means here.
  edge: { face_to_face: 3 },
  furniture: { face_to_face: 3 },
  hips: { over_supine: 3 },
  hip: { over_supine: 3 },
  pelvis: { over_supine: 3 },
  across: { over_supine: 4 },
};

const ARRANGEMENT_ORDER = [
  "face_to_face",
  "rear_alignment",
  "over_supine",
  "straddle_lap",
  "straddle_supine",
  "spooning",
  "side_by_side",
  "behind_bent_over",
  "supported_lift",
  "head_to_toe",
];

/**
 * Names that describe a scene with no pairing in it at all.
 *
 * These have to be told apart from names we simply could not read. "One person,
 * flexed" is a complete description that happens to have no arrangement in it,
 * and answering `face_to_face` for it would invent a partner.
 */
const SOLO_MARKERS = ["single_person", "solo", "one_person"];
const GROUP_MARKERS = ["three_person", "group", "four_person"];

/**
 * Read an arrangement name compositionally.
 *
 * @returns {{id:string, yawFlip:boolean}|{solo:true}|{group:true}|null}
 *   `yawFlip` marks the readings that say the pair face the same way when the
 *   arrangement's own default has them facing each other - reverse cowgirl and
 *   every back-to-chest sit. It is a half turn applied to the arrangement's
 *   yaw rather than an absolute heading, for the same reason `facing away` is:
 *   the default differs per arrangement.
 */
export function readArrangementName(name) {
  const normalised = normaliseName(name);
  if (SOLO_MARKERS.some((marker) => normalised.startsWith(marker))) return { solo: true };
  if (GROUP_MARKERS.some((marker) => normalised.startsWith(marker))) return { group: true };

  const yawFlip = /(^|_)(reverse|away)(_|$)/.test(normalised) || normalised.includes("back_to_chest");
  for (const candidate of alternatives(normalised)) {
    const { votes } = tally(candidate.split("_"), ARRANGEMENT_VOTES);
    const best = winner(votes, ARRANGEMENT_ORDER);
    if (best) return { id: best.target, yawFlip };
  }
  return null;
}

/**
 * Surface evidence - first token wins, not a vote.
 *
 * Surfaces compose differently from postures. `table_and_floor` is not a blend
 * or an alternation, it is a scene with a table in it that also has a floor,
 * and which of the two the annotator wrote first is which one the pose is
 * about: somebody bent over a table stands on the floor, and somebody on the
 * floor beside a sofa is on the floor. So this scans left to right and takes
 * the first word it recognises.
 */
const SURFACE_WORDS = {
  floor: "floor",
  ground: "floor",
  mat: "floor",
  rug: "floor",
  // A rig, straps or a harness is no one support the library has, so a pose
  // suspended from one is solved against the floor and the rigging is simply
  // absent. Saying "floor" here is honest about that: the height is right, the
  // rigging is not drawn. A sling, a swing, a pole or a spreader bar named as
  // such is a prop of its own.
  suspension: "floor",
  suspension_rig: "floor",
  straps: "floor",
  harness: "floor",
  wall: "floor",
  post: "floor",
  sling: "sling",
  swing: "swing",
  sex_swing: "swing",
  pole: "pole",
  spreader_bar: "spreader_bar",
  spreader: "spreader_bar",

  bed: "bed",
  mattress: "bed",
  inflatable_mattress: "bed",
  futon: "bed",

  sofa: "sofa",
  couch: "sofa",
  chaise: "sofa",
  settee: "sofa",
  furniture: "sofa",

  chair: "chair",
  armchair: "chair",
  office_chair: "chair",
  desk_chair: "chair",
  wheelchair: "chair",
  stool: "chair",
  seat: "chair",
  vehicle_seat: "car_seat",
  car_seat: "car_seat",
  back_seat: "car_seat",
  backseat: "car_seat",
  car: "car_seat",
  vehicle: "car_seat",
  saddle: "chair",

  table: "table",
  desk: "table",
  counter: "table",
  worktop: "table",
  appliance: "table",

  bench: "bench",
  ball: "ball",
  exercise_ball: "ball",
  gym_ball: "ball",
  wedge: "wedge",
  ramp: "ramp",
  ottoman: "ottoman",
  footstool: "ottoman",
  pouf: "ottoman",
  cushion: "bench",
  platform: "bench",
  block: "bench",
  step: "bench",
  stairs: "stairs",
  stair: "stairs",
  staircase: "stairs",
  steps: "stairs",
  pillow: "pillow",
  pillows: "pillows",
  pillow_stack: "pillows",
  stacked_pillows: "pillows",
  box: "bench",
  ledge: "bench",
  edge: "bench",
  pool: "bench",
  raised_surface: "bench",
};

// Plurals read the same as the singular. "Two chairs" is still a chair as far
// as anything downstream is concerned - the library has one prop per surface -
// and dropping the word entirely would put the pair on the floor.
for (const [word, surface] of Object.entries({ ...SURFACE_WORDS })) {
  const plural = word.endsWith("s") ? null : `${word}s`;
  if (plural && !SURFACE_WORDS[plural]) SURFACE_WORDS[plural] = surface;
}

/**
 * Read a surface name compositionally.
 * @returns {string|null} a base surface id, or null if nothing was recognised
 */
export function readSurfaceName(name) {
  const tokens = normaliseName(name).split("_");
  let index = 0;
  while (index < tokens.length) {
    let hit = null;
    for (let span = Math.min(2, tokens.length - index); span >= 1; span -= 1) {
      const key = tokens.slice(index, index + span).join("_");
      if (SURFACE_WORDS[key]) {
        hit = SURFACE_WORDS[key];
        break;
      }
    }
    if (hit) return hit;
    index += 1;
  }
  return null;
}

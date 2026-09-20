/**
 * What the arms, legs and trunk are doing, on top of the posture.
 *
 * A posture fixes the whole body, limbs included, because it has to: it is the
 * thing that gets seated on a surface, and you cannot seat a figure whose arms
 * are unspecified. But that made every arm and leg in the library a property of
 * the posture and nothing else - `supine` with the arms overhead and `supine`
 * with the arms at the sides rendered as the same picture, which is most of
 * what is wrong with a figure that is otherwise correctly placed.
 *
 * The reference corpus separates them, and by a lot: 227 different arm phrases,
 * 133 leg phrases and 79 torso orientations across its 1283 annotations,
 * against 21 postures. So this is a second, thinner layer - a handful of
 * *shapes*, read out of that vocabulary the same way `vocabulary.js` reads
 * posture names, and emitted as per-bone overrides that the solver already
 * knows how to apply over an archetype.
 *
 * Three things about the design are worth stating, because each of them is a
 * decision that could have gone the other way.
 *
 * **Most of the corpus's limb phrases mean "whatever the posture does".** The
 * commonest leg label is `knees_bent`, 873 times, and on a kneeling figure that
 * is not new information - the knees are already bent, at the angle that puts
 * them on the floor. The commonest arm label, 180 times, is
 * `arms_supporting_or_touching_partner`, which is an annotator saying the arms
 * were doing something in the partner's direction and declining to say what. So
 * `defer` is a first-class reading here and it wins a lot of the time. Inventing
 * an angle for those would be worse than leaving them alone, because the
 * posture's own angle is at least known to put the limb where it belongs.
 *
 * **Overrides are per-channel, not per-bone.** `legs_apart` sets abduction and
 * says nothing about flexion, so a standing figure spreads their feet and a
 * supine one opens their thighs, each keeping the flexion their posture chose.
 * This is what lets one shape mean the same thing in twenty postures. The
 * solver's merge is already per-channel (`{...posture, ...override}` per bone),
 * so nothing downstream had to change.
 *
 * **A shape is skipped when the posture has no room for it.** Two cases, one
 * rule. `legs_extended_or_bent` reads as "extended", which is right for a
 * figure lying down and would drop a kneeling one through the floor - so each
 * limb shape says whether it is safe on a weight-bearing limb, and the
 * posture's own `supports` list says which limbs those are. A trunk lean means
 * nothing on a figure who is already horizontal, or who already leans that way
 * - so each trunk shape says which way it bends, and the posture's own axes say
 * whether it is upright and which way it is going. Either way the posture's
 * angle survives, because it is the one known to work, and the phrase is
 * reported as deferred rather than silently lost.
 */

import { alternatives, normaliseName, tally, winner } from "./vocabulary.js";

/** Mirror a limb shape onto both sides. Abduction is already side-symmetric. */
function both(joint, angles) {
  return { [`${joint}_l`]: angles, [`${joint}_r`]: angles };
}

/** One side only, for the shapes that name a single limb. */
function one(joint, angles) {
  return { [`${joint}_l`]: angles };
}

/** The same flexion at each of the three vertebrae, as the posture library does. */
function spineChain(flexion) {
  return {
    spine01: { flexion },
    spine02: { flexion },
    spine03: { flexion },
  };
}

/**
 * A hand bearing weight, in the idiom `all_fours` established: the forearm
 * rolls so the wrist hinge lies across the body, then the wrist extends so the
 * palm lies flat. Roll alone leaves the palm standing on its edge.
 */
const PLANTED_HAND = { elbowRotation: -75, wrist: 75 };

/**
 * Arm shapes.
 *
 * Angles are shoulder flexion (toward the face), shoulder abduction (out from
 * the body), elbow flexion. Only the channels a shape actually means are
 * listed; everything else stays as the posture left it.
 */
export const ARM_POSES = {
  arms_sides: {
    label: "arms down at the sides",
    weightSafe: false,
    joints: {
      ...both("shoulder", { flexion: 4, abduction: 9 }),
      ...both("elbow", { flexion: 12 }),
    },
  },

  arms_overhead: {
    label: "arms up beside the head",
    weightSafe: false,
    // Bent, not straight. In the corpus this is almost always `arms_near_head`
    // on somebody lying down, which is the relaxed shape with the elbows out
    // and the hands near the ears - not the reaching-for-the-ceiling one, which
    // is `arms_straps` below.
    joints: {
      ...both("shoulder", { flexion: 148, abduction: 22 }),
      ...both("elbow", { flexion: 92 }),
    },
  },

  arms_forward: {
    label: "arms reaching forward",
    weightSafe: false,
    joints: {
      ...both("shoulder", { flexion: 78, abduction: 10 }),
      ...both("elbow", { flexion: 22 }),
    },
  },

  arms_out: {
    label: "arms out to the sides",
    weightSafe: false,
    joints: {
      ...both("shoulder", { flexion: 6, abduction: 82 }),
      ...both("elbow", { flexion: 10 }),
    },
  },

  arms_braced_behind: {
    label: "arms braced behind, hands planted",
    weightSafe: false,
    // A compromise between two heights this layer cannot tell apart. Bracing
    // behind you means putting the hand on whatever you are sitting on, and
    // that is the floor for a floor-sitter and a seat 460mm up for a chair
    // one. With the shoulder near its extension limit and the elbow straight
    // the hand swings past both and ends up below the seat; bending the elbow
    // keeps it near hip height, which is the right neighbourhood either way.
    joints: {
      ...both("shoulder", { flexion: -26, abduction: 26 }),
      ...both("elbow", { flexion: 34, rotation: PLANTED_HAND.elbowRotation }),
      ...both("wrist", { flexion: PLANTED_HAND.wrist }),
    },
  },

  arms_planted: {
    label: "hands planted on the surface",
    weightSafe: false,
    joints: {
      ...both("shoulder", { flexion: 74, abduction: 14 }),
      ...both("elbow", { flexion: 8, rotation: PLANTED_HAND.elbowRotation }),
      ...both("wrist", { flexion: PLANTED_HAND.wrist }),
    },
  },

  arms_forearms: {
    label: "weight on the forearms",
    weightSafe: false,
    joints: {
      ...both("shoulder", { flexion: 88, abduction: 14 }),
      ...both("elbow", { flexion: 84 }),
      ...both("wrist", { flexion: 10 }),
    },
  },

  arms_around: {
    label: "arms around the partner",
    weightSafe: false,
    // Forward and in, with the elbows well bent. An embrace is not a reach: the
    // upper arm only comes up to chest height and it is the forearm that does
    // the wrapping, which is why the elbow angle here is larger than the
    // shoulder one.
    joints: {
      ...both("shoulder", { flexion: 62, abduction: 34 }),
      ...both("elbow", { flexion: 88 }),
    },
  },

  arms_on_hips: {
    label: "hands at the hips or waist",
    weightSafe: false,
    joints: {
      ...both("shoulder", { flexion: 22, abduction: 30 }),
      ...both("elbow", { flexion: 74 }),
    },
  },

  arms_on_thighs: {
    label: "hands on the thighs or legs",
    weightSafe: false,
    joints: {
      ...both("shoulder", { flexion: 46, abduction: 16 }),
      ...both("elbow", { flexion: 52 }),
    },
  },

  arms_partner_hips: {
    label: "hands on the partner's hips or waist",
    weightSafe: false,
    // Reaching *out* rather than resting on yourself, which is the distinction
    // this shape exists to make. "Hands on the hips" and "hands on the partner's
    // hips" differ by one word and by a whole arm: the first is akimbo, elbows
    // out; the second is a man kneeling behind a woman with his arms forward and
    // a little down, because her hips are in front of him at about his own hip
    // height. 122 uses in the corpus were reading as the akimbo one.
    joints: {
      ...both("shoulder", { flexion: 38, abduction: 16 }),
      ...both("elbow", { flexion: 28 }),
    },
  },

  arms_folded: {
    label: "arms folded across the chest",
    weightSafe: false,
    joints: {
      ...both("shoulder", { flexion: 32, abduction: 6 }),
      ...both("elbow", { flexion: 122 }),
    },
  },

  arms_straps: {
    label: "arms up, holding straps or restrained",
    weightSafe: false,
    joints: {
      ...both("shoulder", { flexion: 158, abduction: 18 }),
      ...both("elbow", { flexion: 24 }),
    },
  },

  arms_on_prop: {
    label: "hands resting on furniture",
    weightSafe: false,
    // Lower and straighter than `arms_planted`, because the thing being leaned
    // on is at hip or waist height rather than on the floor.
    joints: {
      ...both("shoulder", { flexion: 56, abduction: 12 }),
      ...both("elbow", { flexion: 18 }),
    },
  },
};

/**
 * Leg shapes.
 *
 * Hip flexion is measured against the pelvis, not the world, so the same number
 * means "along the trunk" whether the figure is standing or lying down. That is
 * what makes these portable across postures.
 */
export const LEG_POSES = {
  legs_extended: {
    label: "legs straight out",
    weightSafe: false,
    joints: {
      ...both("hip", { flexion: 5 }),
      ...both("knee", { flexion: 4 }),
    },
  },

  legs_apart: {
    label: "legs apart, thighs open",
    // Abduction only, and safe on a leg that is holding the body up: spreading
    // the feet slides them sideways along the floor rather than lifting them,
    // so the support survives and the seating pass closes what is left.
    weightSafe: true,
    joints: both("hip", { abduction: 42 }),
  },

  legs_feet_apart: {
    label: "feet a little apart",
    weightSafe: true,
    joints: both("hip", { abduction: 15 }),
  },

  legs_together: {
    label: "legs together",
    weightSafe: true,
    joints: both("hip", { abduction: 2 }),
  },

  legs_crossed: {
    label: "legs crossed or overlapping",
    // Adduction past the midline is what "intertwined" and "overlapping" have
    // in common, and it is all they have in common - where the knees end up
    // depends entirely on whose legs are overlapping whose. So this stops at
    // the one channel it can be sure of.
    weightSafe: true,
    joints: both("hip", { abduction: -14 }),
  },

  legs_raised: {
    label: "legs raised",
    weightSafe: false,
    joints: {
      ...both("hip", { flexion: 100, abduction: 18 }),
      ...both("knee", { flexion: 30 }),
    },
  },

  legs_raised_high: {
    label: "legs raised high, close to vertical",
    weightSafe: false,
    joints: {
      ...both("hip", { flexion: 120, abduction: 10 }),
      ...both("knee", { flexion: 6 }),
    },
  },

  legs_folded: {
    label: "knees drawn up to the chest",
    weightSafe: false,
    joints: {
      ...both("hip", { flexion: 122, abduction: 22 }),
      ...both("knee", { flexion: 128 }),
    },
  },

  legs_deep: {
    label: "knees deeply bent",
    weightSafe: false,
    joints: {
      ...both("hip", { flexion: 108 }),
      ...both("knee", { flexion: 132 }),
    },
  },

  legs_wrapped: {
    label: "legs wrapped around the partner",
    weightSafe: false,
    // Open and bent, not raised. Wrapping your legs round somebody puts the
    // thighs out to the sides of their hips and the shins in behind them, so
    // the abduction matters more than the flexion - at low abduction the same
    // angles read as a squat in mid-air.
    joints: {
      ...both("hip", { flexion: 74, abduction: 46 }),
      ...both("knee", { flexion: 96 }),
      ...both("ankle", { flexion: 12 }),
    },
  },

  legs_one_raised: {
    label: "one leg raised",
    weightSafe: false,
    // The left, arbitrarily. Nothing in the corpus says which leg, and the two
    // readings are mirror images, so the only property worth having is that the
    // same description always produces the same picture.
    joints: {
      ...one("hip", { flexion: 96, abduction: 26 }),
      ...one("knee", { flexion: 78 }),
    },
  },

  legs_one_extended: {
    label: "one leg extended",
    weightSafe: false,
    joints: {
      ...one("hip", { flexion: 6 }),
      ...one("knee", { flexion: 4 }),
    },
  },
};

/**
 * Trunk shapes.
 *
 * How far over the upper body is, which the posture on its own does not say.
 * Every kneeling figure in the library kneels bolt upright, and almost every
 * kneeling figure in the reference photographs is leaning well forward over
 * their partner - the corpus records that separately, in 2567 annotations of
 * `torso_orientation`, and it is the single most visible thing the renderer
 * was throwing away.
 *
 * These bend the spine rather than hinging at the hip, because in this
 * skeleton the hip rotates the *leg* relative to the pelvis and there is no
 * joint between the pelvis and the ground. Spreading the bend over three
 * vertebrae gets the head and shoulders to the right place; a real forward lean
 * would take more of it at the hip and less along the back, and at these angles
 * the difference does not show.
 *
 * Negative flexion is forward, towards the face. This is not a declaration but
 * a measurement: driving the three vertebrae to +20 and reading the chest
 * against the posture's own `faceDir` moves it *away* from the face in every
 * upright posture in the library. The spine's range in `skeleton.js` was
 * written the other way round and had to be corrected before the deepest fold
 * here could reach the angle it names.
 */
export const TRUNK_POSES = {
  trunk_forward_leaning: {
    label: "leaning forward, about 15 degrees off upright",
    direction: 1,
    // The neck goes the other way throughout. Bending the trunk forward carries
    // the head down with it, and a person leaning over someone is looking at
    // them, so the neck gives back roughly half of what the chest took - not
    // all of it, or the figure leans forward while staring at the ceiling.
    joints: { ...spineChain(-14), neck: { flexion: 20 }, head: { flexion: 10 } },
  },
  trunk_forward_lowered: {
    label: "leaning well forward, chest lowered, about 30 degrees",
    direction: 1,
    joints: { ...spineChain(-26), neck: { flexion: 36 }, head: { flexion: 18 } },
  },
  trunk_forward_fold: {
    label: "folded forward over the partner, about 35 degrees",
    direction: 1,
    joints: { ...spineChain(-32), neck: { flexion: 44 }, head: { flexion: 22 } },
  },
  trunk_backward_leaning: {
    label: "leaning back, about 15 degrees off upright",
    direction: -1,
    joints: { ...spineChain(13), neck: { flexion: -18 }, head: { flexion: -9 } },
  },
};

/**
 * Arm evidence.
 *
 * Same scale as the posture votes: 10-12 means "this phrase names the shape",
 * 6-9 means "this phrase is part of its name", 2-5 means "this leans that way".
 * `defer` competes as an outcome like any other, and phrases that describe an
 * arm's *purpose* rather than its shape - supporting, bracing, near the partner
 * - vote for it, because that is exactly what they fail to pin down.
 */
const ARM_VOTES = {
  near_sides: { arms_sides: 11 },
  at_sides: { arms_sides: 11 },
  sides: { arms_sides: 7 },
  down: { arms_sides: 6 },
  hanging: { arms_sides: 8 },
  relaxed: { arms_sides: 6 },
  lowered: { arms_sides: 6 },

  near_head: { arms_overhead: 11 },
  overhead: { arms_overhead: 12 },
  above_head: { arms_overhead: 12 },
  behind_head: { arms_overhead: 11 },
  head: { arms_overhead: 5 },
  up: { arms_overhead: 4, arms_straps: 3 },

  reaching_forward: { arms_forward: 12 },
  in_front: { arms_forward: 10 },
  planted_in_front: { arms_forward: 10 },
  forward: { arms_forward: 8 },
  reaching: { arms_forward: 6 },
  front: { arms_forward: 5 },

  out_to_sides: { arms_out: 13 },
  extended_outward: { arms_out: 12 },
  extended_out: { arms_out: 12 },
  outward: { arms_out: 9 },
  out: { arms_out: 7 },
  spread: { arms_out: 8 },
  extended: { arms_out: 5 },

  braced_behind: { arms_braced_behind: 13 },
  planted_behind: { arms_braced_behind: 13 },
  supporting_behind: { arms_braced_behind: 12 },
  behind: { arms_braced_behind: 7 },

  hands_planted: { arms_planted: 12 },
  planted: { arms_planted: 9 },
  // "Hands down" on somebody holding themselves up over a partner means down
  // *on the floor*, not down at the sides - and the corpus only ever says it of
  // a figure whose support list names the hands. `down` on its own keeps voting
  // for the sides, because "arms down" still means hanging.
  hands_down: { arms_planted: 11 },
  forearms_down: { arms_forearms: 12 },
  on_floor: { arms_planted: 10, arms_forearms: 3 },
  on_ground: { arms_planted: 10 },
  on_surface: { arms_planted: 10 },
  braced_on_support: { arms_planted: 11 },
  on_support: { arms_planted: 8 },
  on_mat: { arms_planted: 9 },

  forearms_on_floor: { arms_forearms: 13 },
  forearms_bent: { arms_forearms: 11 },
  on_forearms: { arms_forearms: 11 },
  forearms: { arms_forearms: 6 },

  around_partner: { arms_around: 13 },
  around_neck: { arms_around: 13 },
  around_shoulders: { arms_around: 13 },
  around_waist: { arms_around: 12 },
  around_torso: { arms_around: 12 },
  around_back: { arms_around: 11 },
  around_upper_body: { arms_around: 12 },
  wrapped_around: { arms_around: 13 },
  wrapped: { arms_around: 10 },
  around: { arms_around: 8 },
  embracing: { arms_around: 11 },
  embrace: { arms_around: 11 },
  hugging: { arms_around: 11 },

  on_hips: { arms_on_hips: 12 },
  near_hips: { arms_on_hips: 11 },
  at_hips: { arms_on_hips: 12 },
  on_waist: { arms_on_hips: 11 },
  holding_hips: { arms_on_hips: 12 },
  // The word `partner` is what turns a hand resting on your own hip into an arm
  // reaching out to somebody else's, and these have to beat the bare `hips` and
  // `legs` tokens below, which cannot tell whose they are. Spelled out at three
  // tokens as well as two because the matcher takes the longest phrase it can
  // from the left: with only `partner_hips` here, `hands_near_partner_hips`
  // matches `near_partner` first - which votes to defer - and never reaches it.
  near_partner_hips: { arms_partner_hips: 13 },
  at_partner_hips: { arms_partner_hips: 13 },
  on_partner_hips: { arms_partner_hips: 13 },
  near_partner_waist: { arms_partner_hips: 13 },
  on_partner_waist: { arms_partner_hips: 13 },
  near_partner_legs: { arms_partner_hips: 13 },
  on_partner_legs: { arms_partner_hips: 13 },
  near_partner_thighs: { arms_partner_hips: 13 },
  on_partner_thighs: { arms_partner_hips: 13 },
  near_partner_torso: { arms_partner_hips: 12 },
  on_partner_torso: { arms_partner_hips: 12 },
  partner_hips: { arms_partner_hips: 13 },
  partner_waist: { arms_partner_hips: 13 },
  partner_torso: { arms_partner_hips: 12 },
  partner_thighs: { arms_partner_hips: 13 },
  partner_legs: { arms_partner_hips: 13 },
  partner_hip: { arms_partner_hips: 12 },
  // Beats `supporting`'s vote for `defer` on purpose. "Arms supporting the
  // waist" is a shape - the hands are at the partner's middle - and reading it
  // as "unknown" throws away the one piece of information in the phrase.
  hips: { arms_on_hips: 9 },
  waist: { arms_on_hips: 9 },
  hip: { arms_on_hips: 8 },

  on_thighs: { arms_on_thighs: 12 },
  near_thighs: { arms_on_thighs: 11 },
  on_legs: { arms_on_thighs: 11 },
  holding_legs: { arms_on_thighs: 12 },
  lower_legs: { arms_on_thighs: 9 },
  thighs: { arms_on_thighs: 9 },
  thigh: { arms_on_thighs: 8 },
  legs: { arms_on_thighs: 7 },

  folded: { arms_folded: 10 },
  crossed: { arms_folded: 10 },
  near_chest: { arms_folded: 6 },

  holding_straps: { arms_straps: 13 },
  straps: { arms_straps: 12 },
  restrained: { arms_straps: 10 },
  harness: { arms_straps: 9 },
  tied: { arms_straps: 10 },

  on_chair: { arms_on_prop: 12 },
  on_table: { arms_on_prop: 12 },
  on_bed: { arms_on_prop: 11 },
  on_sofa: { arms_on_prop: 11 },
  on_seat: { arms_on_prop: 11 },
  on_ottoman: { arms_on_prop: 11 },
  on_box: { arms_on_prop: 11 },
  on_desk: { arms_on_prop: 12 },
  on_counter: { arms_on_prop: 12 },
  chair: { arms_on_prop: 7 },
  table: { arms_on_prop: 7 },

  supporting_partner: { defer: 10 },
  near_partner: { defer: 9 },
  on_partner: { defer: 8 },
  near_torso: { defer: 7 },
  near_body: { defer: 7 },
  supporting: { defer: 8 },
  braced: { defer: 7 },
  touching: { defer: 7 },
  holding: { defer: 4 },
  partner: { defer: 5 },
  female: { defer: 5 },
  male: { defer: 5 },
  woman: { defer: 5 },
  man: { defer: 5 },
  partly_occluded: { defer: 12 },
  occluded: { defer: 10 },
  bent: { defer: 4 },
  visible: { defer: 2 },
};

/**
 * Tie-break order, commonest shape first, so an ambiguous phrase always reads
 * the same way rather than depending on which key was inserted first.
 */
const ARM_ORDER = [
  "defer",
  "arms_sides",
  "arms_planted",
  "arms_around",
  "arms_on_hips",
  "arms_forward",
  "arms_overhead",
  "arms_braced_behind",
  "arms_on_thighs",
  "arms_partner_hips",
  "arms_forearms",
  "arms_on_prop",
  "arms_out",
  "arms_folded",
  "arms_straps",
];

/** Leg evidence. Same scale and the same role for `defer`. */
const LEG_VOTES = {
  legs_extended: { legs_extended: 12 },
  legs_straight: { legs_extended: 12 },
  extended_down: { legs_extended: 10 },
  extended_behind: { legs_extended: 10 },
  straight: { legs_extended: 9 },
  extended: { legs_extended: 8 },

  // Span 3, so it matches before the `legs_apart` inside it. A slight gap
  // between the feet and a pair of open thighs are both "apart" and they are
  // 27 degrees apart.
  legs_apart_slightly: { legs_feet_apart: 13 },
  thighs_open: { legs_apart: 13 },
  thighs_abducted: { legs_apart: 13 },
  thighs_apart: { legs_apart: 13 },
  legs_apart: { legs_apart: 12 },
  legs_open: { legs_apart: 12 },
  abducted: { legs_apart: 11 },
  spread: { legs_apart: 11 },
  splayed: { legs_apart: 10 },
  apart: { legs_apart: 9 },
  open: { legs_apart: 9 },

  feet_apart: { legs_feet_apart: 12 },
  staggered: { legs_feet_apart: 10 },
  one_leg_forward: { legs_feet_apart: 10 },

  legs_raised: { legs_raised: 12, legs_raised_high: 4 },
  hips_flexed: { legs_raised: 10 },
  elevated: { legs_raised: 9 },
  raised: { legs_raised: 8, legs_raised_high: 3 },
  off_floor: { legs_raised: 6 },

  raised_high: { legs_raised_high: 13 },
  // Wins outright rather than tying with `legs_extended`: legs up a wall are
  // extended, but so is every other reading of "extended", and the wall is the
  // part that says where they point.
  up_wall: { legs_raised_high: 15 },
  vertical: { legs_raised_high: 11 },
  high: { legs_raised_high: 7 },
  split: { legs_raised_high: 5, legs_apart: 6 },

  knees_to_chest: { legs_folded: 13 },
  tucked: { legs_folded: 11 },
  folded: { legs_folded: 10 },

  knees_deeply_bent: { legs_deep: 13 },
  deeply_bent: { legs_deep: 12 },

  around_hips: { legs_wrapped: 13 },
  around_hip: { legs_wrapped: 12 },
  around_partner: { legs_wrapped: 13 },
  around_waist: { legs_wrapped: 12 },
  wrapped_around: { legs_wrapped: 13 },
  both_sides_of: { legs_wrapped: 11 },
  astride: { legs_wrapped: 11 },
  wrapped: { legs_wrapped: 10 },
  around: { legs_wrapped: 7 },

  intertwined: { legs_crossed: 12 },
  interlaced: { legs_crossed: 12 },
  entangled: { legs_crossed: 11 },
  overlapping: { legs_crossed: 11 },
  overlapped: { legs_crossed: 11 },
  crossed: { legs_crossed: 12 },

  one_leg_raised: { legs_one_raised: 13 },
  one_knee_raised: { legs_one_raised: 13 },
  one_leg_bent: { legs_one_raised: 9 },
  one_knee_bent: { legs_one_raised: 9 },
  one_leg_extended: { legs_one_extended: 13 },
  one_lower_leg: { legs_one_raised: 10 },
  one_leg: { legs_one_raised: 5, legs_one_extended: 4 },

  // The whole reason `defer` exists. `knees_bent` is the commonest label in the
  // corpus by a factor of five and it says nothing a posture does not already
  // say - every kneeling, seated, squatting and all-fours archetype has bent
  // knees, at the angle that puts them where they belong.
  knees_bent: { defer: 9 },
  under_body: { defer: 10 },
  weight_bearing: { defer: 11 },
  feet_on_floor: { defer: 11 },
  feet_planted: { defer: 10 },
  feet_grounded: { defer: 10 },
  slightly_bent: { defer: 9 },
  beside_partner: { defer: 8 },
  beside_hips: { defer: 8 },
  supporting: { defer: 9 },
  supported: { defer: 8 },
  grounded: { defer: 8 },
  planted: { defer: 8 },
  kneeling: { defer: 9 },
  restrained: { defer: 9 },
  partly_occluded: { defer: 12 },
  occluded: { defer: 10 },
  bent: { defer: 5 },
  visible: { defer: 2 },
};

const LEG_ORDER = [
  "defer",
  "legs_apart",
  "legs_extended",
  "legs_raised",
  "legs_wrapped",
  "legs_crossed",
  "legs_feet_apart",
  "legs_folded",
  "legs_raised_high",
  "legs_one_raised",
  "legs_deep",
  "legs_one_extended",
  "legs_together",
];

/**
 * Trunk evidence.
 *
 * Nearly every word here that is not about leaning is about the *posture* -
 * face up, prone, on the side, inverted - so it votes to defer. Those are not
 * failures to read: a supine figure's trunk orientation is the definition of
 * being supine, and there is nothing for this layer to add to it.
 */
const TRUNK_VOTES = {
  forward_lowered: { trunk_forward_lowered: 13 },
  forward_leaning: { trunk_forward_leaning: 13 },
  leaning_forward: { trunk_forward_leaning: 13 },
  forward_horizontal: { trunk_forward_fold: 13 },
  forward_fold: { trunk_forward_fold: 13 },
  deeply_flexed: { trunk_forward_fold: 11 },
  folded_forward: { trunk_forward_fold: 12 },
  lowered: { trunk_forward_lowered: 9 },
  hinged: { trunk_forward_leaning: 9 },
  leaning: { trunk_forward_leaning: 7 },
  forward: { trunk_forward_leaning: 7, trunk_forward_lowered: 3 },
  bowed: { trunk_forward_leaning: 8 },

  backward_leaning: { trunk_backward_leaning: 13 },
  leaning_back: { trunk_backward_leaning: 13 },
  reclined: { trunk_backward_leaning: 10 },
  reclining: { trunk_backward_leaning: 10 },
  backward: { trunk_backward_leaning: 9 },
  arched: { trunk_backward_leaning: 7 },

  upright_close: { defer: 12 },
  side_oriented: { defer: 12 },
  upside_down: { defer: 12 },
  face_up: { defer: 12 },
  face_down: { defer: 12 },
  unspecified: { defer: 11 },
  inverted: { defer: 11 },
  sideways: { defer: 11 },
  upright: { defer: 10 },
  supine: { defer: 11 },
  prone: { defer: 11 },
  side: { defer: 11 },
  horizontal: { defer: 8 },
  angled: { defer: 7 },
  close: { defer: 5 },
};

const TRUNK_ORDER = [
  "defer",
  "trunk_forward_leaning",
  "trunk_forward_lowered",
  "trunk_backward_leaning",
  "trunk_forward_fold",
];

/**
 * Let every phrase answer to its own plural.
 *
 * `arms_near_partners` and `arms_near_partner` are the same annotation with a
 * third person in the photograph, and without this the plural reads as nothing
 * at all. Done here rather than by listing both spellings so that adding a
 * phrase above never means remembering to add two.
 */
for (const votes of [ARM_VOTES, LEG_VOTES, TRUNK_VOTES]) {
  for (const [phrase, weights] of Object.entries({ ...votes })) {
    const plural = `${phrase}s`;
    if (!phrase.endsWith("s") && !votes[plural]) votes[plural] = weights;
  }
}

/**
 * Read one limb phrase.
 *
 * Returns the shape id, the string `"defer"` when the phrase means "as the
 * posture has it", or null when nothing matched at all. Callers treat the last
 * two the same way; they are distinguished so coverage can be measured.
 */
function readLimb(name, votes, order) {
  const normalised = normaliseName(name);
  if (!normalised) return null;
  for (const candidate of alternatives(normalised)) {
    const best = winner(tally(candidate.split("_"), votes).votes, order);
    if (best) return best.target;
  }
  return null;
}

/** @returns {string|null} an ARM_POSES key, "defer", or null. */
export const readArmsName = (name) => readLimb(name, ARM_VOTES, ARM_ORDER);

/** @returns {string|null} a LEG_POSES key, "defer", or null. */
export const readLegsName = (name) => readLimb(name, LEG_VOTES, LEG_ORDER);

/** @returns {string|null} a TRUNK_POSES key, "defer", or null. */
export const readTrunkName = (name) => readLimb(name, TRUNK_VOTES, TRUNK_ORDER);

/** Bones a posture's supports hang off, so a shape can be told not to move them. */
const LEG_BEARING = new Set(["foot", "knee", "shin", "thigh"]);
const ARM_BEARING = new Set(["hand", "forearm", "elbow", "wrist"]);

const bears = (posture, landmarks) =>
  (posture?.supports ?? []).some((support) => landmarks.has(support.landmark));

/**
 * Whether a posture's trunk is upright enough to lean, and which way it already
 * leans.
 *
 * A lean is a *deviation*, and it only means anything from something close to
 * vertical. Told that a supine figure's torso is "face up", the honest response
 * is that this is what supine means - not to bend her spine 40 degrees. And a
 * posture that already leans the way the word says has nothing to add either:
 * `seated_reclined` is reclined by construction, so reading "backward leaning"
 * as another 39 degrees would put the figure flat on her back.
 *
 * The lean is read off the posture's own axes. `spineDir` is where the trunk
 * points and `faceDir` is where the chest faces; when the trunk tips forward it
 * acquires a horizontal component in the same direction the face points, so the
 * dot product of the two horizontal parts is positive exactly when the posture
 * is already leaning forward.
 */
function trunkRoom(posture, direction) {
  const spine = posture?.spineDir;
  const face = posture?.faceDir;
  if (!spine || !face) return true;
  if (spine[1] <= 0.6) return false;
  const lean = spine[0] * face[0] + spine[2] * face[2];
  return direction > 0 ? lean < 0.15 : lean > -0.15;
}

/**
 * Compile limb phrases into per-bone overrides for one actor.
 *
 * `arms`, `legs` and `trunk` each take a phrase or a list of them, in the
 * corpus's own vocabulary or a user's. The last readable phrase wins - a list
 * is one annotator's several attempts at the same part, not several parts.
 *
 * @param {object} posture the resolved posture, for its `supports` and axes
 * @param {{arms?: string|string[], legs?: string|string[], trunk?: string|string[]}} limbs
 * @returns {{joints: object, applied: string[], deferred: string[], unread: string[]}}
 */
export function limbJoints(posture, limbs = {}) {
  const joints = {};
  const applied = [];
  const deferred = [];
  const unread = [];

  const resolve = (phrases, read, catalogue, room) => {
    const list = (Array.isArray(phrases) ? phrases : [phrases]).filter(Boolean);
    let chosen = null;
    for (const phrase of list) {
      const id = read(phrase);
      if (!id) unread.push(String(phrase));
      else if (id === "defer") deferred.push(String(phrase));
      else chosen = id;
    }
    if (!chosen) return;
    const shape = catalogue[chosen];
    // The posture has no room for this shape - the limb is holding the body up
    // and the shape would swing it somewhere else, or the trunk is already
    // lying down. The posture's own angle is the one known to work, so it
    // stays, and the phrase is reported as deferred rather than silently lost.
    if (!room(shape)) {
      deferred.push(chosen);
      return;
    }
    for (const [bone, angles] of Object.entries(shape.joints)) {
      joints[bone] = { ...joints[bone], ...angles };
    }
    applied.push(chosen);
  };

  const standsOn = (bearing) => (shape) => shape.weightSafe || !bears(posture, bearing);

  resolve(limbs.arms, readArmsName, ARM_POSES, standsOn(ARM_BEARING));
  resolve(limbs.legs, readLegsName, LEG_POSES, standsOn(LEG_BEARING));
  resolve(limbs.trunk, readTrunkName, TRUNK_POSES, (shape) =>
    trunkRoom(posture, shape.direction),
  );

  return { joints, applied, deferred, unread };
}

export const ARM_POSE_NAMES = Object.keys(ARM_POSES);
export const LEG_POSE_NAMES = Object.keys(LEG_POSES);
export const TRUNK_POSE_NAMES = Object.keys(TRUNK_POSES);

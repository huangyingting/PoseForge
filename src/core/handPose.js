/**
 * What the hands are doing.
 *
 * The rig has always had fingers - thirty joints per body, `index_01_l` through
 * `thumb_03_r` - and has never moved one of them. Every figure in every pose
 * held the scan's A-pose hand: fingers straight, slightly splayed, identical on
 * a woman gripping a partner's hip and a man taking his whole weight on his
 * palms. It is the single most visible thing a posed figure gets wrong, because
 * a hand is where a viewer looks to read what someone is *doing*.
 *
 * The shape is not guessed from the geometry. The solver already knows, because
 * the pose library declares it: a posture says which landmarks carry weight, and
 * an arrangement says what touches what and how. Those declarations come with a
 * `type` - `surface`, `support`, `grip`, `rest` - which is exactly the question
 * "what is this hand doing" already answered, in the vocabulary the reference
 * corpus uses for the same thing (`hands_or_forearms_supporting`,
 * `arms_supporting_or_touching_partner`, `hands_on_or_near_hips`). So this reads
 * those rather than inventing a second opinion.
 *
 * Angles are degrees of flexion per phalanx, proximal to distal. They are
 * applied about an axis measured off the model's own bind pose - see
 * `measureFingers` in humanMesh.js - so they mean the same thing on a rig whose
 * fingers point down the -Y axis and one whose point down +X.
 */

/**
 * The shapes a hand in this system can be in.
 *
 * `relaxed` is not "straight". An unloaded hand rests with a curl in it, and
 * the flat-fingered hand the scan ships is what makes an idle figure read as a
 * mannequin; the numbers below are a hand hanging at the side.
 *
 * `brace` is the only one that goes past straight. A palm taking body weight
 * hyperextends a few degrees at the knuckle, and without that the fingers of a
 * figure on all fours curl faintly into the floor.
 *
 * `fingers` and `thumb` are flexion in degrees per phalanx, proximal to distal.
 * A shape may name a single finger to override the common `fingers` row - that
 * is what separates `point` from a fist and `pinch` from a grip, and there is no
 * way to express either without it. A named row is taken literally: `SPREAD`
 * does not apply to it, because the reason to name a finger is that it is not
 * doing what the others are.
 *
 * `splay` scales the fan at the knuckles, `SPLAY` below. It is a multiplier and
 * not an angle so that the shape of the fan - index in, little finger out - is
 * written once.
 */
export const HAND_SHAPES = {
  relaxed: { fingers: [22, 30, 20], thumb: [14, 12, 10], splay: 0.8 },
  brace: { fingers: [-6, 2, 0], thumb: [2, 6, 0], splay: 1.15 },
  cup: { fingers: [32, 38, 24], thumb: [26, 18, 14], splay: 0.5 },
  grip: { fingers: [56, 64, 42], thumb: [34, 28, 22], splay: 0.15 },

  // A closed fist. The thumb lies across the front of the fingers rather than
  // inside them, which is both how a fist is made and the only way the thumb
  // does not end up buried in the palm mesh.
  fist: { fingers: [88, 98, 72], thumb: [40, 54, 28], splay: 0 },

  // Flat: a hand held open with the fingers together, the gesture of showing a
  // palm or laying a hand on something without weight on it.
  open: { fingers: [5, 5, 2], thumb: [8, 6, 2], splay: 0.35 },

  // The same hand with the fingers apart. Only the fan differs, which is the
  // whole reason the knuckles needed a second axis.
  spread: { fingers: [4, 3, 1], thumb: [14, 8, 2], splay: 1.5 },

  // Pointing. Everything closes except the index finger, and the thumb folds
  // over the middle finger to hold them down.
  point: {
    fingers: [86, 96, 70],
    thumb: [34, 50, 26],
    index: [3, 5, 2],
    splay: 0,
  },

  // Thumb and index meeting, the rest trailing behind them half closed. The
  // distal joints do most of the work: a pinch closes at the fingertip.
  pinch: {
    fingers: [46, 52, 30],
    thumb: [34, 22, 20],
    index: [40, 40, 24],
    splay: 0.3,
  },

  // Fingers bent at the knuckle but straight below it - reaching for something
  // round, or holding a shoulder. It is the one shape whose proximal angle is
  // larger than its distal, and that inversion is what makes it read as a hand
  // about to close rather than one already closed.
  claw: { fingers: [58, 24, 10], thumb: [30, 20, 24], splay: 0.75 },

  // A loose hold, between `cup` and `grip`: a hand round a wrist or a thigh
  // rather than clamped on it.
  hold: { fingers: [44, 50, 30], thumb: [30, 24, 18], splay: 0.25 },
};

/** Hand shape names, in the order a chooser should offer them. */
export const HAND_SHAPE_NAMES = Object.keys(HAND_SHAPES);

/**
 * Per-finger multipliers on the shape's flexion.
 *
 * A hand does not close evenly - the little finger curls furthest and the index
 * least, which is what gives a relaxed hand its fan and a grip its spiral. A
 * single angle across all four reads as a rubber glove inflating.
 */
const SPREAD = { index: 0.92, middle: 1, ring: 1.08, pinky: 1.16, thumb: 1 };

/**
 * Abduction at the knuckle, in degrees, at a `splay` of 1.
 *
 * Signed along the axis measured in `measureFingers`, which runs from the index
 * finger towards the little one - so the index goes negative to move away from
 * the middle finger and the little one goes positive to do the same. The middle
 * finger is the axis of the fan and does not move. The thumb's spread is a
 * saddle joint doing something quite different and is left to the per-shape
 * thumb row.
 */
const SPLAY = { index: -10, middle: 0, ring: 7, pinky: 15, thumb: 0 };

/** The shape a contact of this kind puts a hand into. */
const BY_CONTACT = {
  surface: "brace",
  support: "brace",
  grip: "grip",
  rest: "cup",
};

/**
 * Which shape each of an actor's hands is in.
 *
 * Weight wins over touch: a hand braced on the bed that is also listed as
 * resting on a partner is bearing load, and load is what decides whether the
 * fingers are flat. After that the strongest contact wins, so a hand that both
 * grips and rests grips.
 *
 * Whatever the actor asked for wins over all of it. The ranking below is a
 * reading of what a hand is *for* in a pose, and it is usually right, but it is
 * an inference and the user's instruction is not - someone who says the left
 * hand is open has looked at the picture and seen that it should be.
 *
 * @param {object} actor a solved actor, with `posture` and `index`
 * @param {Array<object>} [contacts] the scene's normalised contacts
 * @returns {{l: string, r: string}} shape names from `HAND_SHAPES`
 */
export function handShapes(actor, contacts = []) {
  const shapes = { l: "relaxed", r: "relaxed" };
  const rank = { relaxed: 0, cup: 1, grip: 2, brace: 3 };

  const put = (side, shape) => {
    for (const s of side ? [side] : ["l", "r"]) {
      if (rank[shape] > rank[shapes[s]]) shapes[s] = shape;
    }
  };

  // A support with no side is a posture saying "the hands hold this up" without
  // saying which - `forearms_and_knees` and its kin - so it applies to both.
  for (const support of actor.posture?.supports || []) {
    if (support.landmark === "hand" || support.landmark === "hands") put(support.side, "brace");
  }

  for (const contact of contacts) {
    for (const end of ["from", "to"]) {
      const actorOf = contact[`${end}Actor`];
      if (actorOf !== actor.index) continue;
      const landmark = contact[end];
      if (landmark !== "hand" && landmark !== "hands") continue;
      put(contact[`${end}Side`], BY_CONTACT[contact.type] ?? "cup");
    }
  }

  return { ...shapes, ...asked(actor.spec?.hands) };
}

/**
 * A `hands` instruction, as a pair of sides.
 *
 * One name means both hands. `{l, r}` names them separately, and a half-filled
 * object leaves the other hand to the inference above rather than resetting it.
 */
function asked(hands) {
  if (!hands) return {};
  if (typeof hands === "string") {
    return hands in HAND_SHAPES ? { l: hands, r: hands } : {};
  }
  const out = {};
  for (const side of ["l", "r"]) {
    if (hands[side] in HAND_SHAPES) out[side] = hands[side];
  }
  return out;
}

/**
 * Flexion in degrees for one phalanx.
 *
 * @param {string} shape a key of `HAND_SHAPES`
 * @param {string} finger `index` | `middle` | `ring` | `pinky` | `thumb`
 * @param {number} segment 1, 2 or 3, proximal to distal
 */
export function fingerFlexion(shape, finger, segment) {
  const table = HAND_SHAPES[shape] ?? HAND_SHAPES.relaxed;
  const named = table[finger];
  if (named) return named[segment - 1] ?? 0;
  const angles = finger === "thumb" ? table.thumb : table.fingers;
  return (angles[segment - 1] ?? 0) * (SPREAD[finger] ?? 1);
}

/**
 * Abduction in degrees at one knuckle. Zero below the knuckle - the joints
 * under it are hinges - which the caller enforces by only having an axis there.
 *
 * @param {string} shape a key of `HAND_SHAPES`
 * @param {string} finger `index` | `middle` | `ring` | `pinky` | `thumb`
 */
export function fingerSplay(shape, finger) {
  const table = HAND_SHAPES[shape] ?? HAND_SHAPES.relaxed;
  return (SPLAY[finger] ?? 0) * (table.splay ?? 0);
}

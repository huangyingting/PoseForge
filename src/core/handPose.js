/**
 * What the hands are doing.
 *
 * The rig has always had fingers - thirty joints per body, `index_01_l` through
 * `thumb_03_r` - and has never moved one of them. Every figure in every pose
 * held the scan's A-pose hand: a slight curl and splay, identical on
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
 * the unchanging hand the scan ships is what makes an idle figure read as a
 * mannequin; the numbers below are a hand hanging at the side.
 *
 * Every shape but `brace` is added to the scan's own hand, which is not flat:
 * both bundled rigs already bend each finger about 16 degrees at the knuckle
 * and 10 at the middle joint, and the thumb nearly 40. The rows were first
 * written as if from a flat hand, and on top of that curl a hand hanging at the
 * side came out a claw and one resting on a partner a fist, so `relaxed` and
 * `cup` are written as what is added to it: a relaxed hand ends near 22/28, a
 * cupped one resting on a body near 30/30. `grip` and `hold` keep their closed
 * rows. The stock layouts seat a gripping palm a few millimetres off a hip and
 * were measured with these fingers wrapped round it; straighter ones run into
 * the flank the layout checks for clearance.
 *
 * `brace` is a load-bearing, flat hand. The renderer measures each model's
 * palm plane and cancels its native finger/thumb curl for this shape; a small
 * numeric extension is retained below as a fallback for unmeasured rigs.
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
 * written once. Like the curl it is added to the scan's own, and the scan's
 * hand is spread already: index to little finger about 34 degrees apart at the
 * knuckles, the hand of someone about to catch a ball. A hand at rest has its
 * fingers nearly together, so the shapes that are not reaching or bearing
 * weight close the fan rather than open it - with the fan opened on top of the
 * scan's, the reaching arms of a figure on its back ended in claws.
 */
export const HAND_SHAPES = {
  relaxed: { fingers: [6, 18, 12], thumb: [4, 6, 6], splay: -0.55 },
  brace: { fingers: [-6, 2, 0], thumb: [2, 6, 0], splay: 0.4 },
  cup: { fingers: [14, 20, 12], thumb: [12, 10, 8], splay: -0.6 },
  // A grip keeps its fan open: a hand round a shoulder or a hip spreads to take
  // it, and the stock carry's hands on a partner's shoulders were measured so.
  grip: { fingers: [56, 64, 42], thumb: [34, 28, 22], splay: 0.15 },

  // A closed fist. The thumb lies across the front of the fingers rather than
  // inside them, which is both how a fist is made and the only way the thumb
  // does not end up buried in the palm mesh.
  fist: { fingers: [88, 98, 72], thumb: [40, 54, 28], splay: 0 },

  // Flat: a hand held open with the fingers together, the gesture of showing a
  // palm or laying a hand on something without weight on it.
  open: { fingers: [5, 5, 2], thumb: [8, 6, 2], splay: 0.35 },

  // Laid along a partner's body: nearly open, the fingers together and bent
  // just enough to follow the curve of a back or a flank instead of standing
  // off it or sinking into it.
  lay: { fingers: [8, 10, 6], thumb: [6, 6, 4], splay: 0 },

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
  hold: { fingers: [44, 50, 30], thumb: [30, 24, 18], splay: -0.4 },
};

/** Hand shape names, in the order a chooser should offer them. */
export const HAND_SHAPE_NAMES = Object.keys(HAND_SHAPES);

/**
 * What a resting hand becomes when it has arrived back first.
 *
 * `cup` curls the fingers round whatever the palm is on. Sometimes the only
 * reach the rendered surfaces leave is with the back of the hand against the
 * partner - a standing embrace, whose arms have to pass over hers where they
 * hang, arrives that way - and then the same curl closes on nothing and hangs
 * off her back as a claw. A hand lying on its back lets its fingers lie along
 * her. Not quite `open`: fingers held straight on a rounded back run into it.
 *
 * A grip that arrived back first is a fist beside a hip, closed on air. Some
 * arms cannot turn a palm onto what they hold - a forearm already across the
 * partner, an elbow already in the body - and laid along it the hand at least
 * reads as an arm resting there.
 */
export const BACK_FIRST = { cup: "lay", grip: "lay" };

/**
 * What a resting hand becomes when its curled fingers are in what it is on.
 *
 * `cup` closes round a back or a thigh. On a forearm the fingers reach past it
 * into the wrist and the hand beside it, and no move of the arm gets them out
 * while the palm still faces it. Held open they lie along it.
 */
export const FINGERS_IN = { cup: "open" };

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
const BY_CONTACT = new Map([
  ["surface", "brace"],
  ["support", "brace"],
  ["grip", "grip"],
  ["rest", "cup"],
]);

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
  // A hand beside a forearm that bears weight lies palm down on what the
  // forearm is on, and lies flat there: curled, its fingertips are in it.
  for (const support of actor.posture?.supports || []) {
    if (["hand", "hands", "forearm"].includes(support.landmark)) put(support.side, "brace");
  }

  for (const contact of contacts) {
    for (const end of ["from", "to"]) {
      const actorOf = contact[`${end}Actor`];
      if (actorOf !== actor.index) continue;
      const landmark = contact[end];
      if (landmark !== "hand" && landmark !== "hands") continue;
      put(contact[`${end}Side`], BY_CONTACT.get(contact.type) ?? "cup");
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
 * The shape a resting hand takes once it is known which way its palm faces.
 *
 * `facing` is the cosine between the palm's normal and the direction to what
 * the hand touches: 1 palm first, -1 back first. Past a right angle and a bit
 * the back is what is on the partner, and `BACK_FIRST` says what the fingers
 * do then. A shape the actor asked for is theirs and stays.
 *
 * @param {object} actor a solved actor, with `hands` and `spec`
 * @param {"l"|"r"} side
 * @param {number} facing
 * @returns {string|null} the shape to use instead, or null to keep the one it has
 */
export function backFirstShape(actor, side, facing) {
  if (!(facing < -0.3) || side in asked(actor.spec?.hands)) return null;
  return BACK_FIRST[actor.hands?.[side]] ?? null;
}

/**
 * The shape a resting hand takes when its fingers are in what it is on - see
 * `FINGERS_IN` - or null to keep the one it has. A shape the actor asked for
 * stays.
 */
export function fingersInShape(actor, side) {
  if (side in asked(actor.spec?.hands)) return null;
  return FINGERS_IN[actor.hands?.[side]] ?? null;
}

/**
 * Flexion in degrees for one phalanx.
 *
 * `closure` is how far the finger has closed into the shape: 1 is the shape's
 * own row, 0 the `open` hand. A hand closes on what it holds until its fingers
 * meet it, and no further - see `fitFingers` - so a grip round a thigh wider
 * than its curl stops on the skin instead of going on into it.
 *
 * @param {string} shape a key of `HAND_SHAPES`
 * @param {string} finger `index` | `middle` | `ring` | `pinky` | `thumb`
 * @param {number} segment 1, 2 or 3, proximal to distal
 * @param {number} [closure] 0 to 1
 */
export function fingerFlexion(shape, finger, segment, closure = 1) {
  const full = shapeFlexion(shape, finger, segment);
  if (!(closure < 1)) return full;
  const open = shapeFlexion("open", finger, segment);
  return open + (full - open) * Math.max(0, closure);
}

function shapeFlexion(shape, finger, segment) {
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

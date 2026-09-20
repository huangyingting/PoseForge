/**
 * What the feet are doing.
 *
 * The counterpart to `handPose.js`, and deliberately not built the same way.
 *
 * A hand's shape is *inferred*: the pose library declares what each hand is
 * holding or pressing on, that declaration answers "what is this hand doing"
 * directly, and nothing in the rig posed the fingers before `handPose.js`
 * existed - so there was a gap to fill and a reliable way to fill it.
 *
 * A foot's shape is not inferred, because there is no gap. Every posture in the
 * library already sets `ankle` and `toe` explicitly, and those angles are what
 * the support solver was validated against: a kneeling figure's instep is flat
 * on the floor at 50 degrees of plantarflexion, a squatting figure's ankle is
 * dorsiflexed 22, and both numbers are load-bearing in the literal sense. A
 * second opinion computed here would overwrite them and the figure would sink
 * into the floor or hover above it.
 *
 * So this is a vocabulary and not a policy. Nothing below applies unless an
 * actor asks for it by name, and what it then does is exactly what `arms`,
 * `legs` and `trunk` do in `limbPose.js` - it becomes ordinary joint overrides
 * laid over the posture, which the solver is free to work around.
 *
 * Signs follow the rig, which is documented at `ROM` in `skeleton.js` and is
 * the opposite of the usual anatomical convention in both joints: negative
 * flexion at the ankle is dorsiflexion, toes towards the shin, and negative
 * flexion at the toe lifts the toes off the ground.
 */

/**
 * The common shapes a foot is in.
 *
 * Six, chosen because they are what a foot is actually doing in the reference
 * photographs rather than because they subdivide the range evenly. The three
 * that matter most are the ones a posture cannot give you: a foot hanging free
 * is not the same shape as a foot standing on the floor, and a kneeling figure
 * with her toes tucked under is not the same shape as one with her insteps
 * flat, but the posture is the same posture in both cases.
 */
export const FOOT_SHAPES = {
  /** Standing on the flat of the foot. Heel and ball both down. */
  flat: { ankle: 0, toe: 0 },

  /**
   * Hanging free - lying down, or a leg raised off the floor. A foot with no
   * load on it sits in some plantarflexion rather than at right angles, and the
   * right angle is the giveaway that nobody thought about it.
   */
  relaxed: { ankle: 17, toe: 7 },

  /** Pointed, as far as the joint goes: the instep and the shin in one line. */
  pointed: { ankle: 46, toe: 22 },

  /** Pulled up towards the shin, the shape of a heel dug into a mattress. */
  flexed: { ankle: -20, toe: -14 },

  /**
   * Toes tucked under, the other way to kneel. The ankle is near neutral and
   * the work is all at the ball of the foot, which is why the toe joint needs
   * the 70 degrees of extension it has.
   */
  tucked: { ankle: 6, toe: -62 },

  /** Up on the ball of the foot, heel clear of the floor. */
  tiptoe: { ankle: 40, toe: -48 },
};

/** Foot shape names, in the order a chooser should offer them. */
export const FOOT_SHAPE_NAMES = Object.keys(FOOT_SHAPES);

/**
 * A `feet` instruction as joint overrides.
 *
 * One name means both feet; `{l, r}` names them separately, and naming only one
 * side leaves the other to the posture. An unknown name yields nothing at all
 * rather than a default, so a caller that validates first - `validateScene`
 * does - can report it instead of silently posing a foot nobody asked for.
 *
 * @param {string|{l?:string, r?:string}} [feet]
 * @returns {Object<string, {flexion:number}>} keyed by bone name
 */
export function footJoints(feet) {
  if (!feet) return {};
  const sides =
    typeof feet === "string"
      ? { l: feet, r: feet }
      : { ...(feet.l ? { l: feet.l } : {}), ...(feet.r ? { r: feet.r } : {}) };

  const joints = {};
  for (const [side, name] of Object.entries(sides)) {
    const shape = FOOT_SHAPES[name];
    if (!shape) continue;
    joints[`ankle_${side}`] = { flexion: shape.ankle };
    joints[`toe_${side}`] = { flexion: shape.toe };
  }
  return joints;
}

/** Whether every name in a `feet` instruction is one this module knows. */
export function knownFeet(feet) {
  if (!feet) return [];
  const names = typeof feet === "string" ? [feet] : [feet.l, feet.r].filter(Boolean);
  return names.filter((name) => !(name in FOOT_SHAPES));
}

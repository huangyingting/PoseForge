/**
 * Posture and arrangement library.
 *
 * A posture is deliberately not a precise set of joint angles. It declares:
 *
 *   - the orientation of the torso, as where the spine and face axes point
 *   - approximate joint angles that put the body in the right basin
 *   - which landmarks are expected to rest on the support surface
 *
 * The solver then drives the declared supports onto the surface with IK and
 * resolves collisions, so the authored angles only have to be roughly right.
 * That is what makes the library extensible: adding a posture is a few lines,
 * not an afternoon of tuning.
 *
 * Posture and arrangement names follow the vocabulary observed in the
 * annotated reference corpus, so parsed descriptions map onto them directly.
 */

import { quatNormalize, v3cross, v3dot, v3mul, v3normalize, v3sub } from "./math.js";

/**
 * Build the pelvis orientation from where the spine (+Y local) and face
 * (+Z local) should point. Reading a posture's orientation off two direction
 * vectors is far less error-prone than composing Euler angles.
 */
export function orientationFromAxes(spineDir, faceDir) {
  const y = v3normalize(spineDir);
  let z = v3sub(faceDir, v3mul(y, v3dot(faceDir, y)));
  if (z[0] === 0 && z[1] === 0 && z[2] === 0) {
    z = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    z = v3normalize(v3sub(z, v3mul(y, v3dot(z, y))));
  } else {
    z = v3normalize(z);
  }
  const x = v3cross(y, z); // left-handed-looking but correct: actor's left is +X
  return quaternionFromBasis(x, y, z);
}

/** Columns x, y, z of a rotation matrix -> quaternion. */
export function quaternionFromBasis(x, y, z) {
  const m00 = x[0];
  const m10 = x[1];
  const m20 = x[2];
  const m01 = y[0];
  const m11 = y[1];
  const m21 = y[2];
  const m02 = z[0];
  const m12 = z[1];
  const m22 = z[2];
  const trace = m00 + m11 + m22;
  let q;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return quatNormalize(q);
}

/** Mirror the abduction/rotation channels for the right side. */
function pair(joint, left, right = null) {
  const mirrored = right ?? left;
  return {
    [`${joint}_l`]: { flexion: 0, abduction: 0, rotation: 0, ...left },
    [`${joint}_r`]: { flexion: 0, abduction: 0, rotation: 0, ...mirrored },
  };
}

const arms = (shoulder, elbow, wrist = {}) => ({
  ...pair("shoulder", shoulder),
  ...pair("elbow", elbow),
  ...pair("wrist", wrist),
});

const legs = (hip, knee, ankle = {}) => ({
  ...pair("hip", hip),
  ...pair("knee", knee),
  ...pair("ankle", ankle),
});

const spine = (perVertebra, neck = {}, head = {}) => ({
  spine01: { flexion: 0, abduction: 0, rotation: 0, ...perVertebra },
  spine02: { flexion: 0, abduction: 0, rotation: 0, ...perVertebra },
  spine03: { flexion: 0, abduction: 0, rotation: 0, ...perVertebra },
  neck: { flexion: 0, abduction: 0, rotation: 0, ...neck },
  head: { flexion: 0, abduction: 0, rotation: 0, ...head },
});

/**
 * Posture catalogue.
 *
 * `supports` lists landmarks the solver should seat on the support surface.
 * `rootHeight` is a fraction of stature used as the starting guess only.
 */
export const POSTURES = {
  standing: {
    label: "standing",
    spineDir: [0, 1, 0],
    faceDir: [0, 0, 1],
    rootHeight: 0.53,
    supports: [{ landmark: "foot", side: "l" }, { landmark: "foot", side: "r" }],
    joints: {
      ...legs({ flexion: 2 }, { flexion: 5 }, { flexion: -3 }),
      ...arms({ flexion: 6, abduction: 8 }, { flexion: 14 }),
      ...spine({ flexion: 1 }),
    },
  },

  standing_bent_forward: {
    label: "standing, bent forward at the hips",
    spineDir: [0, 0.42, 0.91],
    faceDir: [0, -0.91, 0.42],
    rootHeight: 0.52,
    supports: [{ landmark: "foot", side: "l" }, { landmark: "foot", side: "r" }],
    joints: {
      ...legs({ flexion: 10 }, { flexion: 14 }, { flexion: -6 }),
      ...arms({ flexion: 42, abduction: 10 }, { flexion: 30 }),
      ...spine({ flexion: 5 }, { flexion: -22 }, { flexion: -12 }),
    },
  },

  supine: {
    label: "lying on the back",
    spineDir: [0, 0, 1],
    faceDir: [0, 1, 0],
    rootHeight: 0.075,
    supports: [{ landmark: "upperBack" }, { landmark: "buttocks" }, { landmark: "head" }],
    joints: {
      ...legs({ flexion: 6, abduction: 7 }, { flexion: 8 }, { flexion: 4 }),
      ...arms({ flexion: 4, abduction: 14 }, { flexion: 16 }),
      ...spine({ flexion: 0 }),
    },
  },

  supine_legs_raised: {
    label: "lying on the back with the legs raised",
    spineDir: [0, 0, 1],
    faceDir: [0, 1, 0],
    rootHeight: 0.075,
    supports: [{ landmark: "upperBack" }, { landmark: "buttocks" }, { landmark: "head" }],
    joints: {
      ...legs({ flexion: 92, abduction: 22 }, { flexion: 78 }, { flexion: 2 }),
      ...arms({ flexion: 8, abduction: 22 }, { flexion: 26 }),
      ...spine({ flexion: 2 }),
    },
  },

  prone: {
    label: "lying face down",
    spineDir: [0, 0, 1],
    faceDir: [0, -1, 0],
    rootHeight: 0.075,
    supports: [{ landmark: "chest" }, { landmark: "hips" }],
    joints: {
      ...legs({ flexion: -4, abduction: 8 }, { flexion: 14 }, { flexion: -18 }),
      ...arms({ flexion: 62, abduction: 26 }, { flexion: 74 }),
      ...spine({ flexion: -4 }, { flexion: 20 }, { flexion: 10 }),
    },
  },

  side_lying: {
    label: "lying on the side",
    spineDir: [0, 0, 1],
    faceDir: [1, 0, 0],
    rootHeight: 0.085,
    // The down-side shoulder, hip and thigh carry the weight. The shoulder is
    // named per-side rather than as the centred `shoulders` landmark, because
    // what touches the floor is the down-side deltoid, not a point on the
    // spine between them.
    supports: [
      { landmark: "shoulder", side: "r" },
      { landmark: "hip", side: "r" },
      { landmark: "thigh", side: "r" },
    ],
    joints: {
      // The legs are staggered rather than stacked - the underneath leg runs
      // out nearly straight and the top leg draws forward over it, which is
      // both what people do and what keeps the two from interleaving.
      ...pair("hip", { flexion: 46, abduction: 14 }, { flexion: 12, abduction: 0 }),
      ...pair("knee", { flexion: 64 }, { flexion: 22 }),
      ...pair("ankle", { flexion: -6 }),
      // The down-side arm reaches forward rather than being pinned under the
      // ribcage, which is both what people actually do and what keeps it clear
      // of the floor.
      ...pair("shoulder", { flexion: 28, abduction: 12 }, { flexion: 88, abduction: 6 }),
      ...pair("elbow", { flexion: 52 }, { flexion: 24 }),
      ...pair("wrist", {}),
      ...spine({ flexion: 2 }),
    },
  },

  seated: {
    label: "seated upright",
    surface: "chair",
    spineDir: [0, 1, 0],
    faceDir: [0, 0, 1],
    rootHeight: 0.26,
    supports: [{ landmark: "buttocks" }, { landmark: "foot", side: "l" }, { landmark: "foot", side: "r" }],
    joints: {
      ...legs({ flexion: 86, abduction: 9 }, { flexion: 88 }, { flexion: -4 }),
      ...arms({ flexion: 10, abduction: 12 }, { flexion: 26 }),
      ...spine({ flexion: 2 }),
    },
  },

  seated_reclined: {
    label: "seated, leaning back",
    surface: "sofa",
    spineDir: [0, 0.94, -0.34],
    faceDir: [0, 0.34, 0.94],
    rootHeight: 0.26,
    supports: [{ landmark: "buttocks" }, { landmark: "foot", side: "l" }, { landmark: "foot", side: "r" }],
    joints: {
      ...legs({ flexion: 72, abduction: 12 }, { flexion: 74 }, { flexion: -2 }),
      ...arms({ flexion: -18, abduction: 22 }, { flexion: 42 }),
      ...spine({ flexion: -4 }, { flexion: 14 }, { flexion: 6 }),
    },
  },

  reclined: {
    label: "reclining, propped up",
    spineDir: [0, 0.6, 0.8],
    faceDir: [0, 0.8, -0.6],
    rootHeight: 0.1,
    supports: [{ landmark: "buttocks" }, { landmark: "forearm", side: "l" }, { landmark: "forearm", side: "r" }],
    joints: {
      ...legs({ flexion: 34, abduction: 14 }, { flexion: 48 }, { flexion: 0 }),
      ...arms({ flexion: -28, abduction: 26 }, { flexion: 38 }),
      ...spine({ flexion: 3 }, { flexion: 8 }),
    },
  },

  kneeling: {
    label: "kneeling upright",
    spineDir: [0, 1, 0],
    faceDir: [0, 0, 1],
    rootHeight: 0.26,
    supports: [{ landmark: "knee", side: "l" }, { landmark: "knee", side: "r" }],
    joints: {
      ...legs({ flexion: 6, abduction: 8 }, { flexion: 104 }, { flexion: -32 }),
      ...arms({ flexion: 10, abduction: 12 }, { flexion: 24 }),
      ...spine({ flexion: 1 }),
    },
  },

  kneeling_low: {
    label: "kneeling, sitting back on the heels",
    spineDir: [0, 1, 0],
    faceDir: [0, 0, 1],
    rootHeight: 0.17,
    supports: [{ landmark: "shin", side: "l" }, { landmark: "shin", side: "r" }],
    joints: {
      ...legs({ flexion: 22, abduction: 10 }, { flexion: 138 }, { flexion: -38 }),
      ...arms({ flexion: 12, abduction: 14 }, { flexion: 30 }),
      ...spine({ flexion: 2 }),
    },
  },

  kneeling_straddle: {
    label: "kneeling with the thighs wide",
    spineDir: [0, 1, 0],
    faceDir: [0, 0, 1],
    rootHeight: 0.30,
    supports: [{ landmark: "knee", side: "l" }, { landmark: "knee", side: "r" }],
    joints: {
      ...legs({ flexion: 45, abduction: 40 }, { flexion: 118 }, { flexion: -12 }),
      ...arms({ flexion: 22, abduction: 18 }, { flexion: 44 }),
      ...spine({ flexion: 3 }),
    },
  },

  all_fours: {
    label: "on hands and knees",
    spineDir: [0, 0.12, 0.99],
    faceDir: [0, -0.99, 0.12],
    rootHeight: 0.26,
    supports: [
      { landmark: "knee", side: "l" },
      { landmark: "knee", side: "r" },
      { landmark: "hand", side: "l" },
      { landmark: "hand", side: "r" },
    ],
    joints: {
      ...legs({ flexion: 82, abduction: 10 }, { flexion: 92 }, { flexion: -16 }),
      ...arms({ flexion: 78, abduction: 12 }, { flexion: 10 }, { flexion: 22 }),
      ...spine({ flexion: -2 }, { flexion: 26 }, { flexion: 14 }),
    },
  },

  forearms_and_knees: {
    label: "on forearms and knees, chest lowered",
    spineDir: [0, -0.16, 0.99],
    faceDir: [0, -0.99, -0.16],
    rootHeight: 0.25,
    supports: [
      { landmark: "knee", side: "l" },
      { landmark: "knee", side: "r" },
      { landmark: "forearm", side: "l" },
      { landmark: "forearm", side: "r" },
    ],
    joints: {
      ...legs({ flexion: 88, abduction: 12 }, { flexion: 96 }, { flexion: -18 }),
      ...arms({ flexion: 92, abduction: 16 }, { flexion: 72 }, { flexion: 16 }),
      ...spine({ flexion: -4 }, { flexion: 34 }, { flexion: 16 }),
    },
  },

  seated_straddle: {
    label: "straddling, seated astride",
    spineDir: [0, 1, 0],
    faceDir: [0, 0, 1],
    rootHeight: 0.42,
    supports: [],
    joints: {
      ...legs({ flexion: 88, abduction: 34 }, { flexion: 108 }, { flexion: -6 }),
      ...arms({ flexion: 34, abduction: 22 }, { flexion: 62 }),
      ...spine({ flexion: 2 }),
    },
  },

  inverted: {
    label: "inverted, head lowered",
    spineDir: [0, -0.94, 0.34],
    faceDir: [0, 0.34, 0.94],
    rootHeight: 0.62,
    supports: [{ landmark: "shoulders" }, { landmark: "head" }],
    joints: {
      ...legs({ flexion: 18, abduction: 14 }, { flexion: 26 }, { flexion: 0 }),
      ...arms({ flexion: -34, abduction: 30 }, { flexion: 44 }),
      ...spine({ flexion: 2 }, { flexion: -18 }),
    },
  },

  lifted: {
    label: "lifted and supported by the partner",
    spineDir: [0, 0.97, -0.24],
    faceDir: [0, 0.24, 0.97],
    rootHeight: 0.62,
    supports: [],
    joints: {
      ...legs({ flexion: 86, abduction: 42 }, { flexion: 104 }, { flexion: -8 }),
      ...arms({ flexion: 108, abduction: 30 }, { flexion: 84 }),
      ...spine({ flexion: 2 }),
    },
  },

  bent_over_support: {
    label: "bent forward over a support",
    // A table, not a bed. The posture is a trunk on a raised surface with the
    // feet on the floor beside it, and a bed puts the floor at mattress height,
    // which makes it a person lying on a bed with their feet on the same bed -
    // that is `prone`, and it is a different pose.
    surface: "table",
    // Flat, not sloping. A trunk laid over a table at 11 degrees touches it
    // at the chest and is 90mm inside it at the small of the back.
    spineDir: [0, 0, 1],
    faceDir: [0, -1, 0],
    rootHeight: 0.46,
    // Both halves, because they are at different heights: the trunk is what the
    // support is for, and the feet are on the floor beside it. Declaring only
    // the feet leaves nothing holding the trunk up, so the posture reads as a
    // stoop in mid-air that happens to have a table nearby.
    //
    // Chest *and* hips, not chest alone. One point cannot hold an axis: with
    // only the chest named, levelling it against the feet half a metre below
    // rotates the whole trunk thirty degrees, which floats the chest and buries
    // the small of the back in the table top. Two points along the spine pin
    // the trunk flat, which is what lying over something means.
    supports: [
      { landmark: "chest" },
      { landmark: "hips" },
      { landmark: "foot", side: "l" },
      { landmark: "foot", side: "r" },
    ],
    joints: {
      // Authored for the flat trunk: with the spine along +z, hip flexion 90
      // points the thigh straight down, so 78 is down and a little back, and
      // the arms reach along the surface at 160 rather than hanging at 96.
      ...legs({ flexion: 68, abduction: 6 }, { flexion: 18 }, { flexion: -4 }),
      ...arms({ flexion: 160, abduction: 14 }, { flexion: 32 }),
      ...spine({ flexion: 2 }, { flexion: 24 }, { flexion: 12 }),
    },
  },
};

/**
 * Long-tail posture names from the reference corpus mapped onto the base set.
 * Keeping this table separate means the parser can accept the corpus
 * vocabulary verbatim without bloating the posture definitions.
 */
export const POSTURE_ALIASES = {
  supine_or_reclined: "reclined",
  reclined_seated: "seated_reclined",
  seated_on_chair: "seated",
  seated_on_partner_lap: "seated_straddle",
  seated_straddle_on_lap: "seated_straddle",
  seated_behind: "seated",
  seated_supporting: "seated",
  kneeling_over_partner: "kneeling",
  kneeling_behind: "kneeling",
  kneeling_all_fours: "all_fours",
  kneeling_face_to_face: "kneeling",
  kneeling_between_legs: "kneeling",
  standing_behind: "standing",
  standing_or_kneeling_behind: "kneeling",
  standing_seated_or_kneeling_at_edge: "kneeling",
  standing_or_kneeling_at_edge: "kneeling",
  side_lying_close: "side_lying",
  side_lying_behind: "side_lying",
  prone_lowered: "prone",
  lifted_supported: "lifted",
  supported_inversion: "inverted",
  bent_over: "standing_bent_forward",
  all_fours_forearms: "forearms_and_knees",
};

export function resolvePosture(name) {
  if (!name) return null;
  const direct = POSTURES[name];
  if (direct) return { id: name, ...direct };
  const alias = POSTURE_ALIASES[name];
  return alias ? { id: alias, ...POSTURES[alias] } : null;
}

/**
 * The same posture rolled 180 degrees about its own spine.
 *
 * Turning to face the other way is a rotation about the body's long axis, and
 * for a body lying down that axis is horizontal - so the roll puts the actor on
 * their other side. The joint angles carry over untouched, because a rigid
 * rotation does not change them; what changes is which side is underneath, and
 * therefore which landmarks end up holding the actor up.
 */
export function rollPosture(posture) {
  const flip = (side) => (side === "l" ? "r" : side === "r" ? "l" : side);
  return {
    ...posture,
    id: `${posture.id}_rolled`,
    supports: posture.supports.map((support) => ({ ...support, side: flip(support.side) })),
  };
}

/**
 * Arrangements: how a pair of actors is placed relative to one another.
 *
 * `offset` is a fraction of the primary's stature, measured pelvis to pelvis,
 * in a frame that is deliberately half body-local and half world: x is the
 * primary's left and z is the way the primary is facing, so the pair turns
 * together, but y is plain world up, because gravity does not care which way
 * anyone is facing. See `applyArrangement`, which does the transform - rotating
 * the whole vector by the primary's orientation instead turns "behind" into
 * "above" for anyone who is not standing up.
 *
 * `yaw` is the secondary's rotation relative to the primary, in degrees.
 * `contacts` are seeded constraints the solver will try to satisfy.
 */
export const ARRANGEMENTS = {
  face_to_face: {
    label: "facing each other",
    offset: [0, 0, 0.34],
    yaw: 180,
    contacts: [
      { from: "chest", to: "chest", type: "surface", strength: 0.5 },
      { from: "pelvis", to: "pelvis", type: "surface", strength: 0.8 },
    ],
  },
  rear_alignment: {
    label: "one partner behind the other",
    offset: [0, 0, -0.34],
    yaw: 0,
    contacts: [
      { from: "pelvis", to: "buttocks", type: "surface", strength: 0.9 },
      { from: "hand.l", to: "hip.l", type: "grip", strength: 0.7 },
      { from: "hand.r", to: "hip.r", type: "grip", strength: 0.7 },
    ],
  },
  spooning: {
    label: "nested on their sides, same direction",
    offset: [-0.2, 0, -0.06],
    yaw: 0,
    contacts: [
      { from: "chest", to: "upperBack", type: "surface", strength: 0.7 },
      { from: "pelvis", to: "buttocks", type: "surface", strength: 0.8 },
      { from: "hand.l", to: "waist", type: "rest", strength: 0.6 },
    ],
  },
  over_supine: {
    mounted: true,
    label: "one partner above a reclining partner",
    // A torso's depth above the partner underneath. Not a guess at how high
    // anyone kneels: the mounted clearance and the settle decide that, and
    // this only has to start them stacked rather than interleaved.
    offset: [0, 0.16, 0.02],
    // Zero, which looks wrong next to `face_to_face`'s 180 and is not.
    //
    // Yaw turns the secondary about the vertical, away from the orientation the
    // posture library lays them out in - and every posture is laid out running
    // towards +z. For two people standing that means both faces point the same
    // way, so facing each other takes half a turn. For a partner lying on their
    // back it does not: their face points at the ceiling and it is their *head*
    // that points down +z. A partner above them is face to face when their head
    // points down +z too, which is no turn at all.
    //
    // Half a turn instead gives a pair whose pelvises meet - so the contact is
    // satisfied, the collision is clean, and every numeric check passes - lying
    // head to toe. It is only wrong in the picture, which is why it survived
    // until there was one.
    yaw: 0,
    contacts: [{ from: "pelvis", to: "pelvis", type: "surface", strength: 0.9 }],
  },
  straddle_lap: {
    mounted: true,
    label: "straddling the seated partner's lap",
    offset: [0, 0.16, 0.12],
    // Upright partner underneath, so this is the standing case: half a turn.
    yaw: 180,
    contacts: [
      { from: "pelvis", to: "lap", type: "support", strength: 1 },
      { from: "hand.l", to: "shoulder.r", type: "grip", strength: 0.6 },
      { from: "hand.r", to: "shoulder.l", type: "grip", strength: 0.6 },
    ],
  },
  straddle_supine: {
    mounted: true,
    label: "astride a partner lying on their back",
    offset: [0, 0.15, -0.02],
    // Recumbent partner underneath, so no turn - see `over_supine`. Astride and
    // looking at their face is the default; reversed is the half turn.
    yaw: 0,
    contacts: [
      { from: "pelvis", to: "pelvis", type: "support", strength: 1 },
      { from: "hand.l", to: "chest", type: "rest", strength: 0.5 },
      { from: "hand.r", to: "chest", type: "rest", strength: 0.5 },
    ],
  },
  side_by_side: {
    label: "alongside one another",
    offset: [-0.34, 0, 0],
    yaw: 0,
    contacts: [{ from: "hand.l", to: "hand.r", type: "grip", strength: 0.4 }],
  },
  behind_bent_over: {
    label: "standing behind a partner bent forward",
    offset: [0, 0, -0.3],
    yaw: 0,
    contacts: [
      { from: "pelvis", to: "buttocks", type: "surface", strength: 0.9 },
      { from: "hand.l", to: "hip.l", type: "grip", strength: 0.8 },
      { from: "hand.r", to: "hip.r", type: "grip", strength: 0.8 },
    ],
  },
  supported_lift: {
    mounted: true,
    // Carried, not stacked. The two meet chest to chest and the lift is a
    // vertical *offset* within that, so the pair has to give ground
    // horizontally - backing off vertically instead would hoist the carried
    // partner up the carrier's body until their chests were a torso apart.
    // Only the torsos need to clear: the legs are wrapped on purpose.
    clear: { axis: "approach", measure: "bulk" },
    label: "one partner carried by the other",
    offset: [0, 0.22, 0.2],
    yaw: 180,
    // `from` is the secondary - the one being carried. Their weight goes onto
    // the carrier's hands, not the other way round, and their own hands go up
    // to the carrier's shoulders where they can actually reach.
    contacts: [
      { from: "chest", to: "chest", type: "surface", strength: 0.6 },
      { from: "buttocks", to: "hand.l", type: "support", strength: 1 },
      { from: "buttocks", to: "hand.r", type: "support", strength: 1 },
      { from: "hand.l", to: "shoulder.r", type: "grip", strength: 0.6 },
      { from: "hand.r", to: "shoulder.l", type: "grip", strength: 0.6 },
    ],
  },
  head_to_toe: {
    // One partner lies along the other, reversed. Both of those matter: mounted,
    // because the top partner is held up by the one underneath and not by the
    // bed, and only their torsos need to clear - the limbs run alongside each
    // other the whole length and separating those would lift the pair apart.
    mounted: true,
    // Held up by their partner rather than by the bed. Prone is prone whether
    // what is underneath is a mattress or a person, so nothing in the posture
    // can tell them apart - see `applyArrangement`.
    carried: true,
    // Reversed head to foot, not rolled onto the other side. A prone partner is
    // recumbent, so the default reading of half a turn would put them on their
    // back next to their partner instead of face down along them.
    turn: "vertical",
    label: "head to toe, opposite directions",
    offset: [0, 0.14, 0],
    yaw: 180,
    // Reversing the secondary says which way they point but nothing about where
    // they are, and an arrangement with no contacts has nothing holding the pair
    // together: the collision stage is free to slide them apart, and it does,
    // leaving two people lying side by side facing opposite ways. Each partner's
    // head meeting the other's hips is what the arrangement actually means, and
    // the pair of opposed contacts pins the length and the lateral offset at
    // once.
    contacts: [
      { from: "head", to: "pelvis", type: "surface", strength: 0.8 },
      { from: "pelvis", to: "head", type: "surface", strength: 0.8 },
    ],
  },
};

export const ARRANGEMENT_ALIASES = {
  behind: "rear_alignment",
  from_behind: "rear_alignment",
  rear: "rear_alignment",
  in_front: "face_to_face",
  facing: "face_to_face",
  on_top: "over_supine",
  astride: "straddle_supine",
  male_behind_female: "rear_alignment",
  rear_kneeling: "rear_alignment",
  rear_kneeling_alignment: "rear_alignment",
  rear_standing_bent_over: "behind_bent_over",
  rear_over_furniture: "behind_bent_over",
  rear_alignment_over_support: "behind_bent_over",
  standing_behind: "rear_alignment",
  kneeling_behind: "rear_alignment",
  rear_prone_overlap: "rear_alignment",
  front_overlap: "over_supine",
  face_to_face_over: "over_supine",
  kneeling_over_supine: "over_supine",
  upright_kneeling_between_legs: "over_supine",
  kneeling_face_to_face: "face_to_face",
  reclined_seated_face_to_face: "face_to_face",
  reclined_seated_pair: "face_to_face",
  face_to_face_side_lying: "face_to_face",
  side_lying_close: "spooning",
  seated_face_to_face_straddle: "straddle_lap",
  seated_lap_position: "straddle_lap",
  seated_lap_straddle: "straddle_lap",
  chair_lap_straddle: "straddle_lap",
  female_on_male_lap: "straddle_lap",
  face_to_face_straddle: "straddle_lap",
  seated_supporting: "straddle_lap",
  standing_embrace: "face_to_face",
  standing_supported_lift: "supported_lift",
  supported_inversion: "supported_lift",
  partners_side_by_side: "side_by_side",
};

export function resolveArrangement(name) {
  if (!name) return null;
  const direct = ARRANGEMENTS[name];
  if (direct) return { id: name, ...direct };
  const alias = ARRANGEMENT_ALIASES[name];
  return alias ? { id: alias, ...ARRANGEMENTS[alias] } : null;
}

/**
 * A posture whose spine lies along the ground rather than standing up.
 *
 * The height test is not redundant with the spine test. Someone on all fours
 * has a horizontal spine too, but they are held up on their limbs, and the
 * difference matters to anything that wants to rotate them: a body lying along
 * the floor can be rolled about its own spine and is still lying on the floor,
 * whereas rolling an all-fours body about its spine turns it upside down.
 */
export const isRecumbent = (posture) =>
  Math.abs(posture.spineDir[1]) < 0.35 && posture.rootHeight < 0.14;

/** Supports that are the trunk itself rather than something the trunk stands on. */
const BULK_SUPPORTS = new Set(["upperBack", "buttocks", "head", "chest", "hips", "shoulders"]);

/**
 * Whether a posture is one a partner could hold up.
 *
 * `carried` is written on the arrangement, because only the arrangement knows
 * that a partner lying full length along another is held by that person and not
 * by the mattress. But an arrangement is applied to whatever postures it is
 * given, and that declaration is nonsense for half of them: someone on hands and
 * knees over their partner is carrying themselves, and taking away their seating
 * because the arrangement said "carried" leaves them hanging wherever the
 * contacts happen to stop - sunk through the bed, or floating above it.
 *
 * The test is what the posture rests on. A trunk resting on something is a body
 * that could as easily be resting on a person; limbs braced against the ground
 * are load-bearing, and a person is not what they are braced against.
 */
export const canBeCarried = (posture) =>
  posture.supports.length === 0 ||
  posture.supports.every((support) => BULK_SUPPORTS.has(support.landmark));

/**
 * What a partner underneath presents upward when they are face down.
 *
 * Contacts are written front-to-front because that is what an arrangement
 * normally means. Lie the lower partner on their front and the front of them is
 * against the bed: what the partner above can actually reach is the back of the
 * same region. Without this remap the solver spends itself chasing a chest that
 * is 400mm away through a mattress, and pays for the attempt in real
 * interpenetration somewhere else.
 */
const FACE_DOWN_EQUIVALENT = {
  chest: "upperBack",
  pelvis: "buttocks",
  lap: "buttocks",
};

/**
 * Adapt an arrangement to the two postures actually being arranged.
 *
 * Arrangement offsets are stated as fractions of stature, which is enough to
 * separate two upright partners but says nothing about how much floor a posture
 * covers. Put an all-fours partner 0.34 H "in front of" someone lying down and
 * you have placed their knees on that person's shoulders - the offset is
 * measured from pelvis to pelvis, and a supine pelvis has a whole torso lying
 * ahead of it.
 *
 * When one partner is on the ground and the other is up on their limbs, "in
 * front of" and "behind" mean *over*: the raised partner straddles, hands and
 * knees on the surface either side. Who faces whom is still what the
 * arrangement asked for; the offset and which surfaces can meet are not.
 */
export function reconcileArrangement(arrangement, primaryPosture, secondaryPosture) {
  if (!arrangement || arrangement.mounted) return arrangement;
  if (!primaryPosture || !secondaryPosture) return arrangement;
  if (!isRecumbent(primaryPosture)) return arrangement;
  if (secondaryPosture.rootHeight < primaryPosture.rootHeight + 0.1) return arrangement;

  const faceDown = primaryPosture.faceDir[1] < -0.4;
  const [x, y, z] = arrangement.offset;
  return {
    ...arrangement,
    // Keep a trace of the original direction so "behind" still starts behind,
    // but small enough that the pair begins overlapping rather than end to end.
    offset: [x, y, z * 0.12],
    contacts: (arrangement.contacts || []).map((contact) =>
      faceDown && FACE_DOWN_EQUIVALENT[contact.to]
        ? { ...contact, to: FACE_DOWN_EQUIVALENT[contact.to] }
        : contact
    ),
    mounted: true,
    reconciledFrom: arrangement.id,
  };
}

/**
 * Support surfaces, as prop boxes plus the two heights a posture needs.
 *
 * Two, not one, because a surface is only sometimes the thing you are standing
 * on. A bed is: everything about the people on it - backs, knees, feet - is at
 * mattress height, and there is no floor in the picture at all. A table is not.
 * Someone bent over one has their chest at 750mm and their feet on the ground,
 * and a partner standing behind them is on the ground too.
 *
 * Collapsing the two is not a small error. It puts both of them up on the table
 * top like a pair of statues on a plinth, and - because the solver levels a
 * posture's declared supports onto one plane - it seats a chair by tipping the
 * sitter over backwards until her feet come up level with her own buttocks.
 *
 * `height` is the top of the prop, where the trunk rests. `ground` is where
 * feet and knees go. They are equal exactly when the surface is one you get on
 * top of.
 */
export const SURFACES = {
  floor: { height: 0, ground: 0, props: [] },
  bed: {
    height: 0.55,
    ground: 0.55,
    props: [{ kind: "bed", size: [2.0, 0.55, 2.0], center: [0, 0.275, 0] }],
  },
  sofa: {
    height: 0.45,
    ground: 0.45,
    props: [
      { kind: "sofa", size: [2.1, 0.45, 0.95], center: [0, 0.225, 0] },
      { kind: "sofa-back", size: [2.1, 0.55, 0.22], center: [0, 0.5, -0.58] },
    ],
  },
  chair: {
    height: 0.46,
    ground: 0,
    props: [
      { kind: "chair", size: [0.52, 0.46, 0.5], center: [0, 0.23, 0] },
      { kind: "chair-back", size: [0.52, 0.5, 0.08], center: [0, 0.68, -0.29] },
    ],
  },
  table: {
    height: 0.75,
    ground: 0,
    props: [{ kind: "table", size: [1.3, 0.75, 0.8], center: [0, 0.375, 0] }],
  },
  bench: {
    height: 0.45,
    ground: 0,
    props: [{ kind: "bench", size: [1.4, 0.45, 0.42], center: [0, 0.225, 0] }],
  },
};

/**
 * Which of the two heights a declared support is looking for.
 *
 * The trunk seeks the surface and the limbs seek the ground. That is the whole
 * rule, and it is the same distinction `canBeCarried` draws for a different
 * reason: what a body rests *on* is either the prop it is lying or sitting
 * against, or the floor its legs are braced on. On a bed the two heights are
 * the same and the rule costs nothing; on a chair it is the difference between
 * sitting and toppling over.
 */
export const supportPlaneFor = (support, surface) =>
  BULK_SUPPORTS.has(support.landmark) ? surface.height : surface.ground;

export const SURFACE_ALIASES = {
  couch: "sofa",
  "floor_or_padded_surface": "floor",
  "floor_or_bed": "bed",
  "floor_and_furniture": "floor",
  "chair_and_floor": "chair",
  "office_chair": "chair",
  "seat_or_floor": "chair",
  "bed_and_floor": "bed",
  stool: "chair",
  "exercise ball": "bench",
  exercise_ball: "bench",
  ball: "bench",
};

export function resolveSurface(name) {
  if (!name) return { id: "floor", ...SURFACES.floor };
  const direct = SURFACES[name];
  if (direct) return { id: name, ...direct };
  const alias = SURFACE_ALIASES[name];
  return alias ? { id: alias, ...SURFACES[alias] } : { id: "floor", ...SURFACES.floor };
}

/**
 * Whether a name is one this library actually knows.
 *
 * `resolveSurface` deliberately falls back to the floor rather than failing,
 * because the solver always needs a surface to stand on - but that means it
 * cannot be used to tell a recognised name from an unrecognised one. Validation
 * needs to draw that distinction to be able to say "I did not know what a
 * hammock was, so I put them on the floor".
 */
export const isKnownSurface = (name) =>
  Boolean(name) && (name in SURFACES || name in SURFACE_ALIASES);

export const POSTURE_NAMES = Object.keys(POSTURES);
export const ARRANGEMENT_NAMES = Object.keys(ARRANGEMENTS);
export const SURFACE_NAMES = Object.keys(SURFACES);

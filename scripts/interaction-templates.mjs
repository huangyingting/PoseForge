/**
 * Interaction templates: from a visual classification to a composer plan.
 *
 * Each template is one family of positions. Role `a` is the lower, receiving
 * or front partner and role `b` the other, as in docs/interaction-templates.md.
 * Variant fields (a_legs, lean, b_hands, surface) adjust the plan. The composer
 * (scripts/interaction-composer.mjs) turns a plan into fixed scene data, and
 * `checks` say what the result must satisfy to count as this template.
 */

import { ARM_POSES } from "../src/core/limbPose.js";

const both = (bone, angles) => ({ [`${bone}_l`]: { ...angles }, [`${bone}_r`]: { ...angles } });

/** Leg shapes for a partner lying on the back, as solo-pose joint targets. */
export const LEG_SHAPES = {
  open_bent: { ...both("hip", { flexion: 62, abduction: 40, rotation: 0 }), ...both("knee", { flexion: 92 }) },
  raised: { ...both("hip", { flexion: 98, abduction: 22, rotation: 0 }), ...both("knee", { flexion: 24 }) },
  on_shoulders: { ...both("hip", { flexion: 112, abduction: 12, rotation: 0 }), ...both("knee", { flexion: 10 }) },
  wrapped: { ...both("hip", { flexion: 74, abduction: 46, rotation: 0 }), ...both("knee", { flexion: 96 }), ...both("ankle", { flexion: 12 }) },
  straight: { ...both("hip", { flexion: 3, abduction: 16, rotation: 0 }), ...both("knee", { flexion: 4 }) },
  straight_apart: { ...both("hip", { flexion: 4, abduction: 40, rotation: 0 }), ...both("knee", { flexion: 4 }) },
  one_raised: {
    hip_l: { flexion: 96, abduction: 24, rotation: 0 },
    knee_l: { flexion: 22 },
    hip_r: { flexion: 6, abduction: 16, rotation: 0 },
    knee_r: { flexion: 6 },
  },
  together_bent: { ...both("hip", { flexion: 68, abduction: 6, rotation: 0 }), ...both("knee", { flexion: 104 }) },
};

// Knees set apart so a partner can kneel between them, the shins straight back
// behind them, not turned in to put the feet where the partner kneels.
const KNEES_APART = { override: { ...both("hip", { abduction: 30, rotation: 12 }) } };
// With no one kneeling between them, the feet closer in: across a car seat,
// clear of the door, or with a partner standing astride over them.
const KNEES_PARTED = { override: both("hip", { abduction: 30 }) };

const ORAL_LEGS = { straight: "straight_apart", together_bent: "open_bent" };
const SEATED_OPEN = { ...both("hip", { flexion: 80, abduction: 60, rotation: 0 }), ...both("knee", { flexion: 80 }) };
const SEATED_WRAP = { ...both("hip", { flexion: 108, abduction: 52, rotation: 0 }), ...both("knee", { flexion: 95 }) };
// Seated at an edge with the legs open either side of a partner, not round them.
const SEATED_APART = { ...both("hip", { flexion: 95, abduction: 55, rotation: 0 }), ...both("knee", { flexion: 55 }) };
// Leaning well back from the seat on straight arms, the hands planted behind.
const SEATED_BRACED_BACK = { spine01: { flexion: 15 }, spine02: { flexion: 12 }, ...both("shoulder", { flexion: -55, abduction: 18 }), ...both("elbow", { flexion: 5 }) };
// Leaning back in the seat with the legs lifted high and wide, the knees soft.
const SEATED_LEGS_UP = { ...both("hip", { flexion: 125, abduction: 40, rotation: 0 }), ...both("knee", { flexion: 25 }) };
// Sitting on the floor with the knees drawn up and apart. Below ~110° of hip
// flexion the feet land behind the knees and the figure rolls back onto its
// shoulders; the forward spine keeps the trunk over the seat.
const KNEES_UP = (abduction = 40, upright = true) => ({
  ...both("hip", { flexion: 120, abduction, rotation: 0 }),
  ...both("knee", { flexion: 110 }),
  ...(upright ? { spine01: { flexion: -10 }, spine02: { flexion: -10 }, spine03: { flexion: -10 } } : {}),
});

const TRUNK = { forward: "forward_leaning", back: "backward_leaning" };
const trunkOf = (lean) => (TRUNK[lean] ? { trunk: TRUNK[lean] } : {});
const spineBend = (flexion) => ({ spine01: { flexion }, spine02: { flexion }, spine03: { flexion } });
// Spooning, B already lies close in behind A, raised over A's shoulder: a
// forward lean is the arrangement itself, and only a lean back away shows.
const SPOON_LEAN = { back: spineBend(10) };
// A partner the record has leaning forward over A: each candidate leant in,
// then only bowed, the shoulders a little over A, then held upright, each
// dearer, where the lean would carry B into A or the hands out of reach.
const BOW = { ...spineBend(-7), neck: { flexion: 10 } };
const leanIn = (cls, list, trunk = "forward_leaning") =>
  cls.lean === "forward"
    ? [
        ...list.map((s) => ({ ...s, trunk })),
        ...list.filter((s) => !s.trunk).map((s) => ({ ...s, override: { ...s.override, ...BOW }, prefer: (s.prefer ?? 0) + 0.01 })),
        ...list.map((s) => ({ ...s, prefer: (s.prefer ?? 0) + 0.1 })),
      ]
    : list;

export const figure = (bodyType, posture, extra = {}) => ({
  bodyType: bodyType === "male" || bodyType === "female" ? bodyType : "neutral",
  posture,
  wearing: ["top", "shorts"],
  ...extra,
});

const legsOf = (cls, fallback = null) => {
  const shape = LEG_SHAPES[cls.a_legs] ?? (fallback ? LEG_SHAPES[fallback] : null);
  return shape ? { joints: structuredClone(shape) } : {};
};

const grip = (from, to, fromActor, toActor, type = "grip") => ({ from, to, fromActor, toActor, type, strength: 0.8 });
const handsTo = (fromActor, toActor, target, cross = false) =>
  ["l", "r"].map((s) => grip(`hand.${s}`, `${target}.${cross ? (s === "l" ? "r" : "l") : s}`, fromActor, toActor));
const handsToCentre = (fromActor, toActor, target) => ["l", "r"].map((s) => grip(`hand.${s}`, target, fromActor, toActor, "rest"));

/** B's hands on A by classification. `face` says whether they face each other. */
function bHands(cls, b, a, { face = true, fallback = "hips" } = {}) {
  switch (cls.b_hands ?? fallback) {
    case "hips":
      return handsTo(b, a, "hip", face);
    case "legs":
      return handsTo(b, a, "thigh", face);
    case "shoulders":
      return handsTo(b, a, "shoulder", face);
    case "embrace":
      return face ? handsToCentre(b, a, "upperBack") : handsToCentre(b, a, "abdomen");
    default:
      return [];
  }
}

/** Refinement step: move one actor so a landmark meets another's. */
const refine = (moving, from, fromActor, to, toActor, { free = ["x", "z"], keep = true, offset = [0, 0, 0], weight = 1, extra = [], start = null, floor = null, snap = true } = {}) => ({
  moving,
  free,
  keep,
  ...(floor != null ? { floor } : {}),
  ...(snap === false ? { snap } : {}),
  ...(start ? { start } : {}),
  anchors: [{ from, fromActor, to, toActor, offset, weight }, ...extra],
});
const near = (r1, l1, r2, l2, max) => ["near", r1, l1, r2, l2, max];
/** Whether the classification notes name a variant. */
const has = (cls, pattern) => pattern.test(cls.notes ?? "");
/** Whether a record's pose details place the arm on side `s` ("l" or "r"). */
const armPosed = (names, s) => (names ?? []).some((name) => DETAILS[name] && (`shoulder_${s}` in DETAILS[name] || `elbow_${s}` in DETAILS[name]));
/** Whether a record's pose details already shape the legs. */
const legPosed = (names) => (names ?? []).some((name) => DETAILS[name] && Object.keys(DETAILS[name]).some((bone) => /^(hip|knee)_/.test(bone)));

const pickSurface = (cls, allowed, fallback) => (allowed.includes(cls.surface) ? cls.surface : fallback);
const lying = (cls, fallback = "bed") => pickSurface(cls, ["floor", "bed"], cls.surface === "sofa" || cls.surface === "bench" ? "bed" : fallback);

// Seats: the front edge (z, the seat faces +z) and the seat height.
export const SEATS = {
  chair: { z: 0.25, top: 0.46 },
  sofa: { z: 0.475, top: 0.45 },
  bench: { z: 0.21, top: 0.45 },
  bed: { z: 1.0, top: 0.55 },
  table: { z: 0.4, top: 0.75 },
  // A car's back seat is the chair's depth, lower and far wider.
  car_seat: { z: 0.25, top: 0.4 },
  // An exercise ball's crest, over its centre.
  ball: { z: 0, top: 0.65 },
  ottoman: { z: 0.3, top: 0.42 },
  // The table; the chair drawn up to it faces it, its front edge at z 0.5.
  table_chair: { z: 0.4, top: 0.75 },
  // A swing's seat strap, hung at table height or let down low.
  swing: { z: 0.15, top: 0.75 },
  swing_low: { z: -0.015, top: 0.33 },
  pillows: { z: 0.25, top: 0.45 },
  // The first stair's nosing and top.
  stairs: { z: 0.2, top: 0.18 },
  pillow: { z: 0.19, top: 0.12 },
  sling: { z: 0.45, top: 0.8 },
};
// The chair at a table: its seat's front edge (it faces -z, towards the table) and height.
const TABLE_CHAIR = { z: 0.5, top: 0.46, back: 1.0 };
// A wall's face, behind the origin.
const WALL_Z = -0.35;
const surfaceTop = (surface) => SEATS[surface]?.top ?? 0;

// Propped on the forearms over a low ledge, the trunk tipped up, the back
// arched and the legs raised behind as far as the hips allow.
const OTTOMAN_FOREARMS = {
  ...both("hip", { flexion: -25, abduction: 28, rotation: 0 }),
  ...both("knee", { flexion: 70 }),
  ...both("shoulder", { flexion: 60, abduction: 12, rotation: 0 }),
  ...both("elbow", { flexion: 90 }),
  spine01: { flexion: 20 },
  spine02: { flexion: 20 },
  spine03: { flexion: 20 },
};
// Seated on a ball's crest, higher than a chair, the thighs slope down to feet on the floor.
const BALL_SEAT = { ...both("hip", { flexion: 50, abduction: 30, rotation: 0 }), ...both("knee", { flexion: 50 }) };

/** Joint targets merged channel by channel, the later winning. */
const mergeJoints = (...tables) => {
  const out = {};
  for (const table of tables) for (const [bone, angles] of Object.entries(table ?? {})) out[bone] = { ...out[bone], ...angles };
  return out;
};

/**
 * Seated at a seat's front edge facing +z: posed on the chair, then carried
 * there. On a ball, over its crest and let down until it rests on it.
 */
function seatedAt(surface, body, extra = {}, index = 0) {
  if (surface === "ball")
    return {
      spec: figure(body, "seated", { soloSurface: "chair", ...extra, override: mergeJoints(BALL_SEAT, extra.override) }),
      place: { index, seatOn: { top: 0.8, z: 0.05 }, settle: {} },
    };
  const seat = SEATS[surface] ?? SEATS.chair;
  return {
    spec: figure(body, "seated", { soloSurface: "chair", ...extra }),
    place: { index, seatOn: { top: seat.top, z: seat.z } },
  };
}

/**
 * Slouched on a seat's front edge against the backrest: lying back (supine,
 * head to -z) tipped up 40°. For a kneeling partner the hips slide off the
 * edge, the lower back on it; for a standing one they sit higher and further back.
 */
const slouchedPlace = (index, high = false, seat = SEATS.chair) => ({
  index,
  yaw: 180,
  pitch: high ? -40 : -42,
  pelvisTo: high ? [0, seat.top + 0.15, seat.z + 0.02] : [0, seat.top + 0.06, seat.z + 0.16],
});

/** Standing or kneeling in front of something, by whichever height fits best. */
function frontCandidates(body, { oral = false, lean = null } = {}) {
  const trunk = oral ? { trunk: "forward_leaning" } : trunkOf(lean === "forward" ? "forward" : null);
  const list = [
    figure(body, "standing", { ...trunk, soloSurface: "floor" }),
    // On tiptoe to reach a partner kneeling up on a bed.
    figure(body, "standing", { ...trunk, soloSurface: "floor", joints: both("ankle", { flexion: 30 }), prefer: 0.003 }),
    figure(body, "kneeling", { ...trunk, soloSurface: "floor", prefer: 0.006 }),
    figure(body, "kneeling_low", { ...trunk, soloSurface: "floor", prefer: 0.01 }),
  ];
  if (oral)
    list.push(
      figure(body, "kneeling", { override: both("hip", { flexion: 55, abduction: 8 }), tilt: 55, soloSurface: "floor", prefer: 0.004 }),
      figure(body, "kneeling", { override: both("hip", { flexion: 70, abduction: 10 }), tilt: 70, soloSurface: "floor", prefer: 0.004 }),
      figure(body, "kneeling_low", { override: both("hip", { abduction: 12 }), tilt: 40, soloSurface: "floor", prefer: 0.004 }),
      figure(body, "kneeling", { trunk: "forward_lowered", soloSurface: "floor", prefer: 0.006 }),
      figure(body, "standing_bent_forward", { soloSurface: "floor", prefer: 0.01 })
    );
  return list;
}

/** Joint targets for a grounded stance: hips and knees bent, the feet apart. */
const stance = (hip, abduction, knee) => ({ joints: { ...both("hip", { flexion: hip, abduction, rotation: 0 }), ...both("knee", { flexion: knee }) } });
/** The same stance up on the toes. */
const onToes = (hip, abduction, knee) => ({ joints: { ...stance(hip, abduction, knee).joints, ...both("ankle", { flexion: 40 }) } });

/** Standing on one leg: the other foot up on a step in front, or kicked up behind. */
const STANDING_RAISED = (cls) =>
  cls.surface && cls.surface !== "floor" ? { hip_l: { flexion: 75, abduction: 10, rotation: 0 }, knee_l: { flexion: 85 } } : { hip_l: { flexion: -10, abduction: 6, rotation: 0 }, knee_l: { flexion: 95 } };

/** Standing, then in deeper or wider (straddling) stances to meet a lower partner. */
function stanceCandidates(body, extra = {}) {
  const at = (joints, prefer) => figure(body, "standing", { soloSurface: "floor", ...extra, ...joints, prefer });
  return [
    figure(body, "standing", { soloSurface: "floor", ...extra }),
    at(stance(30, 25, 45), 0.001),
    at(stance(45, 30, 70), 0.002),
    at(stance(65, 35, 100), 0.004),
    at(stance(10, 25, 20), 0.001),
    at(stance(15, 30, 25), 0.002),
    at(stance(20, 38, 35), 0.003),
  ];
}

/** Candidates for a head brought down to a partner lying on the same surface. */
function lowHeadCandidates(body) {
  return [
    figure(body, "prone", { arms: "arms_forearms" }),
    figure(body, "forearms_and_knees", { prefer: 0.002 }),
    figure(body, "all_fours", { prefer: 0.004 }),
    figure(body, "kneeling_low", { trunk: "forward_fold", prefer: 0.004 }),
  ];
}

/** Candidates for a head brought to a standing or seated partner's hips. */
function kneelHeadCandidates(body) {
  return [
    figure(body, "kneeling", { trunk: "forward_leaning" }),
    figure(body, "kneeling", {}),
    figure(body, "kneeling_low", { trunk: "forward_leaning", prefer: 0.002 }),
    figure(body, "kneeling", { trunk: "forward_lowered", prefer: 0.002 }),
    figure(body, "all_fours", { prefer: 0.006 }),
    figure(body, "squatting", { prefer: 0.006 }),
  ];
}

function faceToFaceLying(cls, bPosture, { legs = "open_bent" } = {}) {
  const surface = lying(cls);
  // Knees drawn up together would hold the partner on top off the hips: they part around B.
  if (cls.a_legs === "together_bent") cls = { ...cls, a_legs: "open_bent" };
  // Or B lies the other way along A, head to A's feet, the legs wide past A's shoulders.
  if (has(cls, /reverse/))
    return {
      surface,
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [
        figure(cls.a_body, "supine", { joints: structuredClone(LEG_SHAPES.straight), arms: "arms_out" }),
        figure(cls.b_body, "prone", { arms: "arms_planted", override: both("hip", { abduction: 38, rotation: 0 }) }),
      ],
      place: [{ index: 1, yaw: 180 }],
      fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: surfaceTop(surface), start: [0, 0.2, 0] })],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      checks: ["aFaceUp", "bFaceDown", "bAbove", "reversed", near("b", "groin", "a", "groin", 0.2)],
    };
  // Upright, B's chest is raised off A on the hands, the back a little arched.
  const bSpec = figure(cls.b_body, bPosture, bPosture === "prone" && cls.lean === "upright" ? { arms: "arms_planted", joints: spineBend(5) } : bPosture === "prone" ? { arms: "arms_forearms" } : {});
  const aSpec = figure(cls.a_body, "supine", legsOf(cls, legs));
  const plan = {
    surface,
    mode: "solver",
    roles: { a: 0, b: 1 },
    actors: [aSpec, bSpec],
    relationship: { arrangement: "over_supine" },
    // B tips from the hips so its feet come down to the surface rather than hovering.
    fit: [
      {
        ...refine(1, "groin", 1, "groin", 0, {
          free: ["x", "y", "z"],
          keep: false,
          floor: surfaceTop(surface),
          extra: [
            { from: "chest", fromActor: 1, to: "chest", toActor: 0, weight: 0.15 },
            ...["l", "r"].map((s) => ({ from: `foot.${s}`, fromActor: 1, point: [0, surfaceTop(surface) + 0.05, 0], weight: 0.1, axes: [1] })),
          ],
        }),
        pitchRange: 30,
        pivot: "chest",
      },
    ],
    contacts: [grip("groin", "groin", 1, 0, "surface"), grip("chest", "chest", 1, 0, "surface")],
    checks: ["aFaceUp", "bFaceDown", "faceToFace", "bAbove", near("b", "groin", "a", "groin", 0.16)],
  };
  // The solver's corrections can close A's knees and splay B's legs over them,
  // which holds B's hips a hand's width up A's body. If they do, A's knees are
  // held as far apart as they were posed, and B's legs come in between them.
  const spread = Object.fromEntries(
    ["hip_l", "hip_r"].filter((bone) => aSpec.joints?.[bone]?.abduction != null).map((bone) => [bone, { abduction: aSpec.joints[bone].abduction }])
  );
  return { ...plan, retry: { ...plan, actors: [{ ...aSpec, override: spread }, { ...bSpec, override: both("hip", { abduction: 18 }) }] } };
}

// Lying under a rider facing them, the knees a little up behind the rider's back.
const KNEES_BEHIND = { ...both("hip", { flexion: 20, abduction: 8, rotation: 0 }), ...both("knee", { flexion: 45 }) };
// Or the legs raised, drawn up past the chest and wide around the rider's sides.
const LEGS_UP_AROUND = { ...both("hip", { flexion: 110, abduction: 40, rotation: 0 }), ...both("knee", { flexion: 30 }) };

function straddlePlan(cls, posture, yaw) {
  // Side saddle on a sofa: A lies along it, the hips near its front edge and
  // the head to B's right, and B sits across them facing out, the legs down
  // over the edge. Perched on A's hips, higher than the seat, B's thighs slope
  // down as on a ball to the feet on the floor, together or the right crossed
  // over the left, or one knee drawn up (a pose detail). A's near hand holds
  // B's hip, and B's hand on the surface rests on A's thigh.
  if (cls.surface === "sofa" && has(cls, /side saddle/)) {
    const perch = { ...both("hip", { flexion: 40, abduction: 6, rotation: 0 }), ...both("knee", { flexion: 30 }) };
    const crossed = has(cls, /legs crossed/) ? { hip_r: { flexion: 55, abduction: -22, rotation: 0 }, knee_r: { flexion: 55 } } : {};
    return {
      surface: "sofa",
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [
        figure(cls.a_body, "supine", { soloSurface: "floor", joints: { ...both("hip", { flexion: 0, abduction: 3, rotation: 0 }), ...both("knee", { flexion: 5 }) } }),
        figure(cls.b_body, "seated", { soloSurface: "chair", override: { ...perch, ...crossed } }),
      ],
      place: [{ index: 0, yaw: -90, rest: SEATS.sofa.top, pelvisTo: [0, null, SEATS.sofa.z - 0.1] }],
      fit: [refine(1, "buttocks", 1, "groin", 0, { free: ["y", "z"], keep: false, floor: 0, start: [0, 0.3, 0.1] })],
      limbContacts: [grip("hand.r", "hip.r", 0, 1), ...(cls.b_hands === "surface" ? [grip("hand.l", "thigh.r", 1, 0)] : [])].map((c) => ({ ...c, optional: true })),
      contacts: [grip("buttocks", "groin", 1, 0, "surface")],
      checks: ["aFaceUp", "bAbove", "bUpright", "crossed", near("b", "buttocks", "a", "groin", 0.25)],
    };
  }
  // Kneeling up astride in a swing let down over A lying on the floor, the
  // hands high on its straps, the seat under B's hips and clear above A's.
  if (cls.surface === "swing_low")
    return {
      surface: "swing_low",
      mode: "fit",
      roles: { a: 0, b: 1 },
      // A's arms start out on the floor, clear of B's knees coming down, and go to B's hips.
      actors: [figure(cls.a_body, "supine", { soloSurface: "floor", arms: "arms_out", ...legsOf(cls, "straight") }), figure(cls.b_body, posture, { soloSurface: "floor", arms: "arms_straps" })],
      place: [{ index: 0, rest: 0, pelvisTo: [0, null, 0.13] }],
      fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: 0, start: [0, 0.25, 0] })],
      limbContacts: handsTo(0, 1, "hip", true).map((c) => ({ ...c, optional: true })),
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      checks: ["aFaceUp", "bAbove", "bUpright", "straddleFacing", near("b", "groin", "a", "groin", 0.2)],
    };
  const surface = lying(cls);
  // Side saddle: sitting across the partner's hips at right angles, the knees
  // drawn up together to one side and the feet down beside the partner;
  // reversed, turned a little further round towards A's feet.
  if (has(cls, /side saddle/))
    return {
      surface,
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [
        figure(cls.a_body, "supine", { joints: structuredClone(LEG_SHAPES.straight) }),
        figure(cls.b_body, "seated_floor", { override: { ...both("hip", { flexion: 115, abduction: 8, rotation: 0 }), ...both("knee", { flexion: 115 }) } }),
      ],
      place: [{ index: 1, yaw: yaw ? 120 : 90 }],
      fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, start: [0, 0.25, 0] })],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      checks: ["aFaceUp", "bAbove", "bUpright", "crossed", near("b", "groin", "a", "groin", 0.2)],
    };
  // The splits: sitting across the partner's hips with the legs straight out
  // either side, one along the partner's body past the head and the other back
  // between the parted legs, the trunk turned to face the head.
  if (has(cls, /the splits/))
    return {
      surface,
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [
        figure(cls.a_body, "supine", { joints: structuredClone(LEG_SHAPES.straight_apart) }),
        figure(cls.b_body, "seated_floor", { ...trunkOf(cls.lean), override: { ...both("hip", { flexion: 8, abduction: 70, rotation: 0 }), ...both("knee", { flexion: 3 }), ...spineBy("rotation", 30) } }),
      ],
      place: [{ index: 1, yaw: 90 }],
      fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: surfaceTop(surface), start: [0, 0.25, 0] })],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      checks: ["aFaceUp", "bAbove", "bUpright", near("b", "groin", "a", "groin", 0.2)],
    };
  // A lies with the shoulders at the bed's edge and the head hanging back over it.
  if (surface === "bed" && has(cls, /head over edge/))
    return {
      surface,
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [
        figure(cls.a_body, "supine", { joints: structuredClone(LEG_SHAPES.straight), arms: "arms_out", override: { neck: { flexion: 45 }, head: { flexion: 25 } } }),
        figure(cls.b_body, posture, cls.lean === "back" ? { trunk: "backward_leaning" } : cls.lean === "forward" ? { trunk: "forward_leaning" } : {}),
      ],
      place: [{ index: 0, anchor: "shoulders", pelvisTo: [0, null, SEATS.bed.z + 0.01] }, ...(yaw ? [{ index: 1, yaw }] : [])],
      fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: surfaceTop(surface), start: [0, 0.2, 0] })],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      checks: ["aFaceUp", "bAbove", yaw ? "reversed" : "straddleFacing", near("b", "groin", "a", "groin", 0.2)],
    };
  // A lies along a bench; B stands astride it on the floor and squats down onto A's hips,
  // facing A or facing A's feet.
  if (cls.surface === "bench" && has(cls, /standing astride|astride the bench/)) {
    const raisedLegs = cls.a_legs === "raised";
    return {
      surface: "bench",
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [
        // Raised legs rise behind B's back, or up in front of a B facing the feet; otherwise
        // they hang off the bench's end to the floor.
        figure(cls.a_body, "supine", {
          soloSurface: "bench",
          override: raisedLegs
            ? { ...both("hip", { flexion: yaw ? 85 : 55, abduction: yaw ? 12 : 32, rotation: 0 }), ...both("knee", { flexion: 5 }) }
            : { ...both("hip", { flexion: 5, abduction: 15, rotation: 0 }), ...both("knee", { flexion: 85 }) },
        }),
        // Astride A's hips on a bench, B's legs barely reach the floor: up on the toes, or
        // squatting lower. Raised behind B's back, A's legs keep B off the hips unless B
        // squats deep; facing the feet, standing taller they push B back off them.
        [
          ...(raisedLegs ? [] : [onToes(10, 32, 20), onToes(15, 30, 30), onToes(20, 28, 35)]),
          ...(raisedLegs && !yaw ? [] : [stance(35, 35, 50), stance(50, 40, 75)]),
          stance(65, 40, 100),
          stance(80, 45, 115),
          stance(95, 50, 130),
        ].map((joints, i) => figure(cls.b_body, "standing", { soloSurface: "floor", ...joints, prefer: i * 0.002 })),
      ],
      place: [{ index: 0, yaw: 90, pelvisTo: [raisedLegs ? -0.15 : -0.45, null, 0] }, { index: 1, yaw: yaw ? -90 : 90 }],
      // The squat that brings B down to A with the feet still on the floor: too
      // deep, B sits on A with the feet hanging either side of the bench.
      fit: [
        refine(1, "groin", 1, "groin", 0, {
          free: ["x", "y", "z"],
          keep: false,
          floor: 0,
          start: [0, 0.3, 0],
          extra: raisedLegs && !yaw ? [] : ["l", "r"].map((s) => ({ from: `foot.${s}`, fromActor: 1, point: [0, 0.05, 0], weight: 0.5, axes: [1] })),
        }),
      ],
      limbContacts: yaw && raisedLegs && cls.b_hands === "legs" ? handsTo(1, 0, "shin", true).map((c) => ({ ...c, optional: true })) : [],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      // Squatting, B's pelvis tips back and its groin landmark sits a little further from A's.
      checks: ["aFaceUp", "bAbove", yaw ? "reversed" : "straddleFacing", near("b", "groin", "a", "groin", 0.25)],
    };
  }
  // Sitting on the partner's hips facing them, the legs raised in front over
  // the chest: straight up, or the knees bent with the feet down beside it.
  if (!yaw && has(cls, /seated/)) {
    const behind = cls.b_hands === "legs";
    const knees = has(cls, /knees up/);
    // Or just the one leg raised, the other folded down beside the partner.
    const oneLeg = has(cls, /one leg up/);
    const raised = { flexion: 125, abduction: 24, rotation: 0 };
    return {
      surface,
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [
        figure(cls.a_body, "supine", { joints: structuredClone(LEG_SHAPES.straight) }),
        // Lifted onto the partner, so the legs can rise from the upright seat.
        figure(cls.b_body, "seated_floor", {
          ...(cls.b_hands === "behind" ? { arms: "arms_braced_behind" } : {}),
          ...(oneLeg || cls.lean === "back" ? { trunk: "backward_leaning" } : {}),
          override: oneLeg
            ? { hip_r: raised, knee_r: { flexion: 10 }, hip_l: { flexion: 55, abduction: 45, rotation: 0 }, knee_l: { flexion: 135 } }
            : { ...both("hip", raised), ...both("knee", { flexion: knees ? 75 : 20 }) },
        }),
      ],
      fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, start: [0, 0.25, 0] })],
      limbContacts: behind ? handsTo(1, 0, "thigh", false) : [],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      checks: ["aFaceUp", "bAbove", "straddleFacing", near("b", "groin", "a", "groin", 0.2)],
    };
  }
  // Sitting up on the partner's hips facing the feet, the legs out straight either side of the partner's.
  if (yaw && has(cls, /seated/))
    return {
      surface,
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [
        figure(cls.a_body, "supine", { joints: structuredClone(LEG_SHAPES.straight) }),
        figure(cls.b_body, "seated_floor", { ...(cls.b_hands === "behind" ? { arms: "arms_braced_behind" } : {}), override: { ...both("hip", { flexion: 80, abduction: 30, rotation: 0 }), ...both("knee", { flexion: 5 }) } }),
      ],
      place: [{ index: 1, yaw }],
      fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, start: [0, 0.25, 0] })],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      checks: ["aFaceUp", "bAbove", "bUpright", "reversed", near("b", "groin", "a", "groin", 0.2)],
    };
  // Lying face down along the partner's legs, the head towards the feet.
  if (yaw && has(cls, /lying/))
    return {
      surface,
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [figure(cls.a_body, "supine", { joints: structuredClone(LEG_SHAPES.straight) }), figure(cls.b_body, "prone")],
      place: [{ index: 1, yaw }],
      fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, start: [0, 0.2, 0] })],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      checks: ["aFaceUp", "reversed", near("b", "groin", "a", "groin", 0.2)],
    };
  // On all fours facing A's feet, the knees wide either side of A's waist and
  // the hips back onto A's, which tip up from the shoulders to meet them.
  if (yaw && has(cls, /all.fours/))
    return {
      surface,
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [figure(cls.a_body, "supine", legsOf(cls, "open_bent")), figure(cls.b_body, "all_fours", { override: both("hip", { abduction: 30 }) })],
      place: [{ index: 1, yaw }],
      fit: [
        refine(1, "groin", 1, "groin", 0, { start: [0, 0.15, 0] }),
        { moving: 0, free: [], keep: false, floor: surfaceTop(surface), pitchRange: 30, pivot: "upperBack", anchors: [{ from: "groin", fromActor: 0, to: "groin", toActor: 1 }] },
      ],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      checks: ["aFaceUp", "bFaceDown", "reversed", near("b", "groin", "a", "groin", 0.2)],
    };
  // A up on the hands and feet in a reverse tabletop, the head at +z like
  // supine; B sits on the raised hips like a stool, the thighs sloping down
  // either side of A's, or folds forward over A's legs to reach the floor.
  if (has(cls, /tabletop/)) {
    const forward = cls.lean === "forward";
    const hips = both("hip", forward ? { flexion: 105, abduction: 50 } : { flexion: 60, abduction: 35 });
    const override = forward
      ? { ...hips, spine01: { flexion: -20 }, spine02: { flexion: -20 }, ...both("shoulder", { flexion: 90 }) }
      : { ...(cls.lean === "back" ? LEAN_BACK : {}), ...hips };
    return {
      surface: "floor",
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [
        figure(cls.a_body, "standing", { soloSurface: "floor", jointMode: "fixed", joints: structuredClone(TABLETOP) }),
        figure(cls.b_body, "seated", { soloSurface: "chair", override }),
      ],
      // B waits overhead while A settles onto the floor, then comes down onto the hips.
      place: [{ index: 0, pitch: -60, yaw: 180, rest: 0 }, { index: 1, yaw, pitch: forward ? 45 : 0, pelvisTo: [0, 3, 0] }],
      fit: [
        { moving: 0, free: ["y"], pitchRange: 20, pivot: "pelvis", floor: 0, anchors: [...floorAnchors(0, "hand"), ...floorAnchors(0, "foot")] },
        refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: 0, start: [0, 0.2, 0], extra: floorAnchors(1, "foot", 0.2) }),
      ],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      checks: ["aFaceUp", "bAbove", yaw ? "reversed" : "straddleFacing", near("b", "groin", "a", "groin", 0.2)],
    };
  }
  // B in a crab over A lying flat: face up on the hands and feet with the hips
  // lowered onto A's. Facing A, B's feet are by A's chest and the head past
  // A's knees; reversed, the hands come down either side of A's head.
  if (has(cls, /crab/))
    return {
      surface,
      mode: "fit",
      roles: { a: 0, b: 1 },
      actors: [
        // Reversed, the arms lie out on the floor clear of B's hands; facing, they stay in by the sides.
        figure(cls.a_body, "supine", { joints: structuredClone(LEG_SHAPES.straight), ...(yaw ? { arms: "arms_out" } : {}) }),
        figure(cls.b_body, "standing", { soloSurface: "floor", jointMode: "fixed", joints: structuredClone(CRAB) }),
      ],
      place: [{ index: 1, pitch: -45, yaw }],
      fit: [
        {
          moving: 1,
          free: ["x", "y", "z"],
          pitchRange: 20,
          pivot: "pelvis",
          floor: surfaceTop(surface),
          start: [0, 0.05, 0],
          anchors: [
            { from: "groin", fromActor: 1, to: "groin", toActor: 0, weight: 2 },
            ...floorAnchors(1, "hand", 0.5, surfaceTop(surface)),
            ...floorAnchors(1, "foot", 0.5, surfaceTop(surface)),
          ],
        },
      ],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      // Tipped back, B's groin sits on A's at an angle, its landmark a little further off than when upright.
      checks: ["aFaceUp", "bFaceUp", "bAbove", near("b", "groin", "a", "groin", 0.22)],
    };
  // Hands on the partner's legs in front means leaning towards them; behind,
  // the shoulders come down and forward to reach back beside the knees. A
  // squat's trunk leans by the spine, the flexion negative forward as seated.
  const spine = (flexion) => ({ joints: { spine01: { flexion }, spine02: { flexion }, spine03: { flexion } } });
  const trunk = cls.lean === "forward" ? (posture === "squatting" ? spine(-20) : { trunk: "forward_lowered" }) : cls.lean === "back" ? { trunk: "backward_leaning" } : yaw && cls.b_hands === "legs" ? { trunk: "forward_leaning" } : cls.b_hands === "legs" ? spine(-22) : {};
  const lean = cls.b_hands === "behind" ? { ...trunk, arms: "arms_braced_behind" } : trunk;
  // `hips` here is the hands at the rider's hips, as those images show: A
  // lying below holds them, as far as A reaches, unless a detail poses A's
  // arms or raises a leg between them. A squatting rider's knees are in the way.
  const holdHips =
    cls.b_hands === "hips" && posture !== "squatting" && !armPosed(cls.a_pose, "l") && !armPosed(cls.a_pose, "r") && !(cls.a_pose ?? []).some((name) => name.startsWith("leg_up_"))
      ? handsTo(0, 1, "hip", !yaw).map((c) => ({ ...c, optional: true }))
      : [];
  return {
    surface,
    mode: "solver",
    roles: { a: 0, b: 1 },
    // Bent knees in front of a rider facing A's feet would hold them off the
    // hips, so they lie flat. Behind a rider facing A they rise a little, as far
    // as the rider's heels allow, or raised go up either side of the rider.
    actors: [
      figure(cls.a_body, "supine", yaw ? legsOf({ a_legs: ["open_bent", "together_bent", "wrapped"].includes(cls.a_legs) ? "straight" : cls.a_legs }, "straight") : { joints: structuredClone(cls.a_legs === "raised" ? LEGS_UP_AROUND : cls.a_legs === "open_bent" || cls.a_legs === "together_bent" ? KNEES_BEHIND : LEG_SHAPES.straight) }),
      figure(cls.b_body, posture, lean),
    ],
    relationship: yaw ? { arrangement: "straddle_supine", yaw } : { arrangement: "straddle_supine" },
    limbContacts: [
      ...(cls.b_hands === "surface" || cls.b_hands === "behind" ? [] : cls.b_hands === "legs" ? handsTo(1, 0, yaw ? "knee" : "thigh", !yaw) : cls.lean === "forward" ? handsTo(1, 0, "shoulder", !yaw) : []),
      ...holdHips,
    ],
    fit: [refine(1, "groin", 1, "groin", 0)],
    contacts: [grip("groin", "groin", 1, 0, "surface")],
    checks: ["aFaceUp", "bAbove", yaw ? "reversed" : "straddleFacing", near("b", "groin", "a", "groin", 0.2)],
  };
}

/**
 * A on the back, B sitting reclined on the hands between A's legs, B's own
 * legs flat and wide around A's hips. A's legs rise in a wide V past B's
 * sides, or lean forward with the feet on B's chest and shoulders.
 */
function sittingBetweenPlan(cls, surface, onShoulders) {
  const legs = onShoulders ? { hip: { flexion: 50, abduction: 12, rotation: 0 }, knee: { flexion: 5 } } : { hip: { flexion: 95, abduction: 45, rotation: 0 }, knee: { flexion: 15 } };
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [
      figure(cls.a_body, "supine", { joints: { ...both("hip", legs.hip), ...both("knee", legs.knee) } }),
      figure(cls.b_body, "seated_reclined", { override: { ...both("hip", { flexion: 42, abduction: 45, rotation: 0 }), ...both("knee", { flexion: 10 }) } }),
    ],
    place: [{ index: 1, rest: surfaceTop(surface) }],
    fit: [refine(1, "groin", 1, "groin", 0, { start: [0, 0, -0.4] })],
    limbContacts: onShoulders ? ["l", "r"].map((s) => grip(`foot.${s}`, `shoulder.${s === "l" ? "r" : "l"}`, 0, 1, "rest")) : [],
    contacts: [grip("groin", "groin", 1, 0, "surface")],
    checks: ["aFaceUp", near("b", "groin", "a", "groin", 0.28)],
  };
}

/**
 * Standing over a partner on all fours from behind, on the same surface:
 * squatting, the feet either side of A's knees, folded right over A's back
 * when leaning forward, or only bowed to the hands on A's hips.
 */
function standingOver(cls, surface) {
  if (!has(cls, /standing over/)) return null;
  const trunk = cls.lean === "forward" ? "forward_fold" : "forward_leaning";
  // Knees bent further by a detail, from a shallower and wider squat, the feet
  // still down outside A's knees.
  const bent = (cls.b_pose ?? []).includes("legs_bent") ? [stance(30, 40, 45)] : [];
  return [...bent, stance(45, 30, 70), stance(65, 35, 100), stance(80, 40, 115)].map((joints, i) =>
    figure(cls.b_body, "standing", { soloSurface: surface, trunk, ...joints, prefer: i * 0.001 }));
}

/**
 * Kneeling behind a partner on all fours. Leaning forward with the hands down,
 * B folds over A's back with the hands round A's ribs: from a kneel the floor
 * beyond A's shoulders is out of reach without lying on A. Leaning back, the
 * hands go behind.
 */
const draped = (cls) => cls.lean === "forward" && cls.b_hands === "surface";
// Or, where A's hips are as high as B's and B's chest would fold into them,
// bowed less, over the top of them.
const kneelingBehind = (cls, lean, override = null) => {
  const spec = (extra) => figure(cls.b_body, "kneeling", { ...extra, ...(override ? { override } : {}) });
  if (draped(cls)) return ["forward_fold", "forward_lowered", "forward_leaning"].map((trunk, i) => spec({ trunk, prefer: 0.001 * i }));
  return spec({ ...trunkOf(lean), ...(cls.b_hands === "behind" ? { arms: "arms_braced_behind" } : {}) });
};
// Kneeling astride the shins of a partner whose knees are together.
const KNEES_ASTRIDE = both("hip", { abduction: 25 });
// Kneeling behind with the legs apart, B's knees go either side of A's, and
// A's come together between them: between A's spread knees there is no room to
// spread them, and they would kneel on A's shins.
const kneelsAstride = (cls) => cls.a_legs === "together_bent" || (!cls.a_legs && (cls.b_pose ?? []).some((name) => name === "legs_apart" || name === "legs_wide"));

function rearPlan(cls, surface, aSpec, bSpec, arrangement, { upright = false, drape = false, astride = false } = {}) {
  // Kneeling and standing rear-entry positions are placed directly: both face
  // +z and B is brought up behind A. Bent-over ones use the library arrangement.
  const direct = arrangement === "rear_alignment";
  // Squatting over a partner on all fours, B's hands reach A's hips if they can.
  const over = has(cls, /standing over/);
  // Kneeling astride A's shins, B's knees are apart already, and the hips lower
  // between them than between A's.
  const kneelsOver = astride && !over;
  const hands = drape
    ? handsTo(1, 0, "ribs").map((c) => ({ ...c, optional: true }))
    : cls.b_hands === "embrace"
      ? handsToCentre(1, 0, "abdomen")
      : cls.b_hands === "surface" || cls.b_hands === "behind"
        ? []
        : bHands(cls, 1, 0, { face: false }).map((c) => (over ? { ...c, optional: true } : c));
  return {
    surface,
    mode: direct ? "fit" : "solver",
    roles: { a: 0, b: 1 },
    actors: [aSpec, bSpec],
    relationship: { arrangement },
    fit: [refine(1, "groin", 1, "pelvis", 0, direct ? { start: [0, 0, -0.3] } : {})],
    limbContacts: hands,
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    // From above, B's groin meets A's buttocks higher over A's pelvis. Both on
    // their knees, the hips are level and meet a little further apart.
    checks: ["sameFacing", "bBehind", ...(upright ? ["aUpright"] : []), "bUpright", near("b", "groin", "a", "pelvis", over ? 0.27 : kneelsOver ? 0.26 : 0.25)],
    ...(kneelsOver ? { apart: ["b"] } : {}),
  };
}

/**
 * Bent forward to a wall: A faces it (-z), the trunk tipped towards level and
 * the arms out along it to the hands flat on the wall, and is walked back
 * until they meet it. B stands behind, facing the same way.
 */
function wallBentPlan(cls, legs = {}) {
  const a = figure(cls.a_body, "standing_bent_forward", {
    soloSurface: "floor",
    // The arms up past level, the forearms turned palm down and the wrists
    // bent back to put the palms flat on it.
    override: {
      ...legs,
      ...both("shoulder", { flexion: 150, abduction: 12, rotation: 0 }),
      ...both("elbow", { flexion: 15, rotation: 80 }),
      ...both("wrist", { flexion: -60, abduction: 6 }),
    },
  });
  return {
    surface: "wall",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, [{}, { joints: both("ankle", { flexion: 30 }), prefer: 0.001 }, { ...stance(12, 10, 24), prefer: 0.002 }].map((extra) => figure(cls.b_body, "standing", { soloSurface: "floor", ...extra }))],
    // B starts well back, out of A's way while A is walked to the wall.
    place: [{ index: 0, yaw: 180, rest: 0 }, { index: 1, yaw: 180, pelvisTo: [0, null, 2] }],
    fit: [
      { moving: 0, free: ["z"], anchors: ["l", "r"].map((s) => ({ from: `hand.${s}`, fromActor: 0, point: [0, 0, WALL_Z + 0.03], weight: 1, axes: [2] })) },
      refine(1, "groin", 1, "pelvis", 0, { start: [0, 0, 0.3] }),
    ],
    limbContacts: bHands(cls, 1, 0, { face: false }),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameFacing", "bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.24)],
  };
}

/** Lying or sitting at the edge of a raised surface, the partner on the floor in front. */
function edgePlan(cls, surface, aPosture, { legs, lean = null, oral = false }) {
  const legShape = LEG_SHAPES[legs] ? { joints: structuredClone(LEG_SHAPES[legs]) } : {};
  let a;
  let aPlace;
  let bYaw = 180;
  let bList = null;
  let plank = false;
  // Hands on the surface beside a seated A reach A's hips: posed, the arms
  // would hang into A's open thighs and hold B back.
  let hands = aPosture === "seated" && (cls.b_hands === "surface" || cls.b_hands === "behind") ? "hips" : cls.b_hands;
  // Slouched on a chair's or a car seat's front edge against the backrest, the
  // legs free to open, rise or wrap around a partner kneeling or squatting in front.
  const backed = surface === "chair" || surface === "car_seat";
  const reclined = backed && !oral && cls.b_hands !== "embrace";
  const seated = !reclined && (aPosture === "seated" || backed);
  if (reclined) {
    // A raised leg goes up past the partner's arm, over the shoulder; wrapped,
    // the knees bend tight to bring the heels in behind the partner's hips.
    const lift = legs === "one_raised" ? { override: { hip_l: { flexion: 100, abduction: 34, rotation: 0 } } } : legs === "wrapped" ? { override: both("knee", { flexion: 120 }) } : {};
    // The hands on the seat beside the hips: held up beside the head, slouched with the head against
    // the backrest, they are up in the air, and hung by the sides they are in the partner's way.
    a = figure(cls.a_body, "supine", { ...legShape, ...lift, soloSurface: "floor", arms: "arms_braced_behind" });
    const standingB = has(cls, /partner standing/);
    aPlace = slouchedPlace(0, standingB, SEATS[surface]);
    const squats = [stance(45, 30, 70), stance(65, 35, 100), stance(80, 40, 115)].map((joints, i) => figure(cls.b_body, "standing", { soloSurface: "floor", ...joints, prefer: (standingB ? 0 : 0.04) + i * 0.001 }));
    const inward = trunkOf(lean === "forward" ? "forward" : null);
    bList = [
      figure(cls.b_body, "kneeling", { soloSurface: "floor", ...inward, ...(standingB ? { prefer: 0.006 } : {}) }),
      figure(cls.b_body, "kneeling_low", { soloSurface: "floor", ...inward, prefer: standingB ? 0.008 : 0.003 }),
      ...squats,
    ];
  } else if (seated) {
    // In a swing A hangs back a little in the seat, the hands up on its straps.
    const swing = surface === "swing";
    const seat = seatedAt(
      surface,
      cls.a_body,
      // A solid seat base (sofa, bed, bench) leaves no room under it: the feet go forward.
      swing && !oral
        ? { override: structuredClone(legs === "open_bent" ? SEATED_APART : SEATED_WRAP), trunk: "backward_leaning", arms: "arms_straps" }
        : oral
        ? { override: { ...structuredClone(SEATED_OPEN), ...(surface === "chair" ? {} : both("knee", { flexion: 55 })), ...(legs === "raised" ? SEATED_LEGS_UP : {}), spine01: { flexion: 15 }, spine02: { flexion: 12 } }, trunk: "backward_leaning" }
        : { override: { ...structuredClone(legs === "open_bent" ? SEATED_APART : SEATED_WRAP), ...(legs === "raised" ? { ...both("hip", { flexion: 135, abduction: 28, rotation: 0 }), ...both("knee", { flexion: 5 }) } : {}), ...(lean === "back" ? SEATED_BRACED_BACK : lean === "forward" ? {} : { spine01: { flexion: 15 }, spine02: { flexion: 12 } }) }, ...(lean === "forward" ? { trunk: "forward_leaning" } : { trunk: "backward_leaning", arms: "arms_braced_behind" }) }
    );
    a = seat.spec;
    aPlace = seat.place;
    // Leaning back on the hands: tipped back from the seat, then let down onto it.
    // Leaning in, the back rounds forward over hips rolled back, so the chest
    // stays over the seat and the partner can still come in close.
    if (!oral && !swing && (lean === "back" || lean === "forward")) aPlace = { ...aPlace, pitch: lean === "back" ? -25 : -22, settle: {} };
  } else if (surface === "bench") {
    // A bench runs along x: lie along it with the hips at one end.
    a = figure(cls.a_body, "supine", { ...legShape, soloSurface: "bench" });
    aPlace = { index: 0, yaw: -90, pelvisTo: [0.64, null, 0] };
    bYaw = -90;
    // Over a low ball the hips come down off the end, the back tipped up on it, for a partner kneeling up.
    if (has(cls, /partner kneeling/)) {
      aPlace = { index: 0, yaw: -90, pitch: -25, pelvisTo: [0.76, SEATS.bench.top + 0.07, 0] };
      bList = [figure(cls.b_body, "kneeling", { soloSurface: "floor" }), figure(cls.b_body, "kneeling_low", { soloSurface: "floor", prefer: 0.004 })];
      // Reaching for the hips from below would pass the arms through the raised thighs: they hold the thighs.
      if (hands === "hips") hands = "legs";
    }
  } else {
    a = figure(cls.a_body, "supine", { ...legShape, soloSurface: surface });
    aPlace = { index: 0, yaw: 180, pelvisTo: [0, null, SEATS[surface].z - 0.06] };
    // Standing on the floor at a high edge, B folds forward from the hips, the knees soft.
    if (oral && has(cls, /partner standing/))
      bList = [0, 25, 40].map((knee, i) => figure(cls.b_body, "standing_bent_forward", { soloSurface: "floor", joints: both("knee", { flexion: knee }), prefer: i * 0.001 }));
    // For a partner kneeling on the floor the hips come down off the edge, the back tipped up on it.
    else if (!oral && surface !== "table" && has(cls, /partner kneeling/)) {
      aPlace = { index: 0, yaw: 180, pitch: -25, pelvisTo: [0, Math.max(0.52, surfaceTop(surface)), SEATS[surface].z + 0.12] };
      bList = [figure(cls.b_body, "kneeling", { soloSurface: "floor" }), figure(cls.b_body, "kneeling_low", { soloSurface: "floor", prefer: 0.004 })];
      if (hands === "hips") hands = "legs";
    }
    // Planked over the edge: B's body straight and tipped forward, the feet far back on the floor.
    else if (!oral && has(cls, /plank/)) {
      plank = true;
      bList = [35, 45, 55].map((tilt, i) => figure(cls.b_body, "standing", { soloSurface: "floor", arms: "arms_planted", tilt, prefer: i * 0.001 }));
    }
  }
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    // Seated face to face, a partner leaning in would meet the chest before the
    // hips: the seated one leans in instead.
    actors: [a, bList ?? frontCandidates(cls.b_body, { oral, lean: seated ? null : lean })],
    place: [aPlace, { index: 1, yaw: bYaw }],
    // For oral, B may tip forward from the knees to bring the head down.
    // B starts just outside, on its own side, and works in.
    fit: [{ ...refine(1, oral ? "mouth" : "groin", 1, "groin", 0, { start: bYaw === -90 ? [0.3, 0, 0] : [0, 0, 0.3] }), ...(oral ? { pitchRange: 25, pivot: "knee" } : {}) }],
    limbContacts: oral ? [] : [...bHands({ ...cls, b_hands: hands }, 1, 0, { fallback: legs === "raised" || legs === "on_shoulders" ? "legs" : "hips" }), ...(seated && lean === "forward" && !armPosed(cls.a_pose, "l") && !armPosed(cls.a_pose, "r") ? handsTo(0, 1, "shoulder", true) : [])],
    contacts: [oral ? grip("mouth", "groin", 1, 0, "surface") : grip("groin", "groin", 1, 0, "surface")],
    checks: oral
      ? ["facingInward", near("b", "mouth", "a", "groin", seated ? 0.27 : 0.2)]
      : [seated ? "aUpright" : "aFaceUp", ...(plank ? [] : ["bUpright"]), "facingInward", near("b", "groin", "a", "groin", 0.3)],
  };
}

/** Kneeling on a bed or sofa edge with the chest down, partner standing behind. */
function edgeRearPlan(cls, surface) {
  const seat = SEATS[surface];
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    // Knees apart at the front edge (or together), head towards the back; B stands between A's feet facing the same way.
    actors: [figure(cls.a_body, cls.lean === "upright" ? "all_fours" : "forearms_and_knees", { soloSurface: surface, override: both("hip", { abduction: cls.a_legs === "together_bent" ? 10 : 34, rotation: 25 }) }), frontCandidates(cls.b_body, { lean: cls.lean })],
    place: [{ index: 0, yaw: 180, alignTo: null, pelvisTo: [0, null, seat.z - (surface === "bed" ? 0.09 : 0.16)] }, { index: 1, yaw: 180 }],
    fit: [refine(1, "groin", 1, "pelvis", 0, { start: [0, 0, 0.3] })],
    limbContacts: cls.b_hands === "surface" ? [] : bHands(cls, 1, 0, { face: false }),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameHeading", "bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.28)],
  };
}

/**
 * Kneeling on the floor at the foot of a stair, bent forward from the hips
 * with the hands up on a step, the partner kneeling up behind. With the
 * hands high, A kneels up nearer upright, close in, the arms reaching up to
 * the third step; otherwise bent well over to the second. An arched back
 * lifts the chest and the arms with it, so they reach the third step too,
 * from a little further back.
 */
function stairsPlan(cls) {
  const high = has(cls, /hands high/);
  const arched = !high && (cls.a_pose ?? []).includes("arch");
  const tilt = high ? 25 : 45;
  // The palms lie flat on the tread: the forearms turn palm down, and the
  // wrists bend back as far as the arm's slope takes the hand up off it.
  const [reach, z, wrist] = high ? [72, 0.32, -35] : arched ? [68, 0.35, -30] : [82, 0.6, -40];
  const a = figure(cls.a_body, "kneeling", {
    soloSurface: "floor",
    tilt,
    override: {
      ...both("hip", { flexion: tilt, abduction: 25, rotation: 0 }),
      ...both("shoulder", { flexion: reach, abduction: 12, rotation: 0 }),
      ...both("elbow", { flexion: 10, rotation: 80 }),
      ...both("wrist", { flexion: wrist }),
    },
  });
  const bList = [figure(cls.b_body, "kneeling", { soloSurface: "floor", ...trunkOf(cls.lean) }), figure(cls.b_body, "kneeling_low", { soloSurface: "floor", prefer: 0.004 })];
  return {
    surface: "stairs",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, bList],
    // Facing up the stair (-z), the knees far enough back that the hands come
    // down on the step's tread.
    place: [{ index: 0, yaw: 180, pelvisTo: [0, null, z] }, { index: 1, yaw: 180 }],
    fit: [refine(1, "groin", 1, "pelvis", 0, { start: [0, 0, 0.3] })],
    limbContacts: bHands(cls, 1, 0, { face: false }),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameHeading", "bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.28)],
  };
}

/** Kneeling up on a chair, bench or low table facing into it, the partner on the floor behind. */
function furnitureKneelPlan(cls, surface) {
  if (surface === "bed" || surface === "sofa") return edgeRearPlan(cls, surface);
  const kneelingB = has(cls, /partner kneeling/);
  const bList = kneelingB
    ? [figure(cls.b_body, "kneeling", { soloSurface: "floor" }), figure(cls.b_body, "kneeling_low", { soloSurface: "floor", prefer: 0.004 })]
    : frontCandidates(cls.b_body, { lean: cls.lean });
  let a;
  let aPlace;
  let bYaw;
  let start;
  // The shins reach back past the edge: turned out, the feet pass either side of
  // the partner. The knees stay together if the record says so.
  const splay = { override: both("hip", { abduction: cls.a_legs === "together_bent" ? 3 : 14, rotation: 30 }) };
  if (surface === "chair") {
    // Knees on the seat, facing the backrest, the chest forward over it.
    const trunk = cls.b_hands === "embrace" ? {} : { trunk: cls.lean === "forward" ? "forward_lowered" : "forward_leaning" };
    a = figure(cls.a_body, "kneeling", { soloSurface: "floor", ...trunk, ...splay });
    aPlace = { index: 0, yaw: 180, rest: SEATS.chair.top, pelvisTo: [0, null, SEATS.chair.z - 0.14] };
    bYaw = 180;
    start = [0, 0, 0.3];
  } else {
    // A dining table is too high to kneel on and meet a standing partner; the
    // pictured tables are low ones, so a bench-height top stands in. A kneels
    // on hands and knees along it with the knees at its end.
    surface = "bench";
    // Or kneeling up on it, the back against a standing partner, or squatting on
    // it, the feet flat on the top, leaning forward to the hands unless held upright.
    if (has(cls, /squat on/)) a = figure(cls.a_body, "squatting", { soloSurface: "floor", ...(cls.lean === "forward" ? { joints: spineBy("flexion", -20) } : {}) });
    else a = figure(cls.a_body, has(cls, /kneel upright/) ? "kneeling" : cls.lean === "forward" ? "forearms_and_knees" : "all_fours", { soloSurface: "floor", ...splay });
    aPlace = { index: 0, yaw: -90, rest: SEATS.bench.top, pelvisTo: [0.62, null, 0] };
    bYaw = -90;
    start = [0.3, 0, 0];
  }
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, bList],
    place: [aPlace, { index: 1, yaw: bYaw }],
    fit: [refine(1, "groin", 1, "pelvis", 0, { start })],
    // On a chair A's hips sit level with B's: the hands hold the waist above them.
    limbContacts: cls.b_hands === "surface" ? [] : cls.b_hands === "embrace" ? handsToCentre(1, 0, "abdomen") : cls.b_hands === "hips" && surface === "chair" ? handsToCentre(1, 0, "waist") : bHands(cls, 1, 0, { face: false }),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameHeading", "bBehind", ...(kneelingB ? [] : ["bUpright"]), near("b", "groin", "a", "pelvis", 0.28)],
  };
}

/**
 * Lying face down over an edge, the legs down to the floor, partner behind.
 * The edge is a bed or sofa's front, a bench's end or, `across`, its long side,
 * or a chair's side. Draped, the chest folds down past a narrow seat.
 */
function overEdgePlan(cls, surface, { across = false, drape = false } = {}) {
  const seat = SEATS[surface];
  const side = surface === "chair" || (surface === "bench" && !across);
  const edge = surface === "chair" ? 0.26 : surface === "bench" && !across ? 0.7 : seat.z;
  const out = (d) => (side ? [d, 0, 0] : [0, 0, d]);
  const yaw = side ? -90 : 180;
  // Prone, the thighs angled down off the edge so the feet reach the floor.
  const drop = { ...both("hip", { flexion: seat.top < 0.5 ? 27 : 37, abduction: 4, rotation: 0 }), ...both("knee", { flexion: 25 }), ...both("ankle", { flexion: 45 }) };
  // One leg lifted up behind, past B's side, where B holds it.
  const lifted = cls.a_legs === "one_raised";
  if (lifted) Object.assign(drop, { hip_l: { flexion: -30, abduction: 45, rotation: 0 }, knee_l: { flexion: 35 } });
  // Over a narrow seat the chest curls down beyond it and the arms reach for the floor.
  // The body tips head-down about the hips and the thighs fold by as much to keep the feet down.
  const tip = drape ? 25 : 0;
  if (drape) Object.assign(drop, { spine01: { flexion: 12 }, spine02: { flexion: 12 }, spine03: { flexion: 12 }, ...both("shoulder", { flexion: 100, abduction: 10 }), ...both("elbow", { flexion: 30 }), ...both("hip", { flexion: 27 + tip, abduction: 4, rotation: 0 }) });
  // Draped, the hips come in over the seat so the chest reaches past its far side.
  const inset = drape ? -0.08 : 0.03;
  const kneelingB = has(cls, /partner kneeling/);
  const hands = cls.b_hands === "surface" ? [] : lifted ? [grip("hand.l", "knee.l", 1, 0), grip("hand.r", "hip.r", 1, 0)] : bHands(cls, 1, 0, { face: false });
  // B leans over A to put the hands on the furniture, or where the record has B
  // leaning forward; the hands on A's hips keep a way down to them.
  const bTrunk = cls.b_hands === "surface" ? { trunk: "forward_leaning" } : {};
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [
      figure(cls.a_body, "prone", { soloSurface: "floor", ...(drape ? {} : { arms: "arms_forearms" }), override: drop }),
      // The hips at the edge sit below a standing partner's: B bends the knees to meet them.
      leanIn(
        cls,
        kneelingB
          ? [figure(cls.b_body, "kneeling", { soloSurface: "floor" }), ...stanceCandidates(cls.b_body).map((s) => ({ ...s, prefer: (s.prefer ?? 0) + 0.004 }))]
          : [
              ...stanceCandidates(cls.b_body, bTrunk),
              // Down to a low seat's height the knees go wide, astride the partner's legs.
              ...(seat.top < 0.5 ? [figure(cls.b_body, "standing", { soloSurface: "floor", ...bTrunk, ...stance(40, 45, 70), prefer: 0.003 }), figure(cls.b_body, "standing", { soloSurface: "floor", ...bTrunk, ...stance(55, 45, 90), prefer: 0.004 })] : []),
            ],
        cls.b_hands === "surface" ? "forward_lowered" : "forward_leaning"
      ),
    ],
    // Head into the furniture, the pelvis at the edge with the trunk on the top.
    place: [{ index: 0, yaw, ...(tip ? { pitch: tip } : {}), pelvisTo: side ? [edge + inset, seat.top + 0.13, 0] : [0, seat.top + 0.13, edge + inset] }, { index: 1, yaw }],
    // Where B stands must leave the hands a way down to A: a stance that meets the hips
    // by leaning in over A's back puts them out of reach.
    fit: [refine(1, "groin", 1, "pelvis", 0, { start: out(0.3), extra: (lifted ? [] : hands).map((c) => ({ from: c.from, fromActor: 1, to: c.to, toActor: 0, weight: 0.2 })) })],
    limbContacts: hands,
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameHeading", "bBehind", near("b", "groin", "a", "pelvis", 0.3)],
  };
}

/**
 * A fit step for a figure let down onto an exercise ball: rocked on it and slid
 * along until the named hands and feet are on the floor, `rest` held down on the ball.
 */
const downOnBall = (index, limbs, rest) => ({
  moving: index,
  free: ["y", "z"],
  pitchRange: 20,
  pivot: "pelvis",
  floor: 0,
  snap: false,
  anchors: [
    ...limbs.map((from) => ({ from, fromActor: index, point: [0, 0.04, 0], weight: 0.6, axes: [1] })),
    { from: rest, fromActor: index, point: [0, SEATS.ball.top, 0], weight: 0.3, axes: [1] },
  ],
});

/**
 * Bridged over an exercise ball, the shoulders on its crest, the hips held up
 * off it level with them and the legs out to the feet on the floor, the arms
 * hanging down the ball's sides. The partner stands astride the hips bent
 * forward, facing the feet or facing A, or kneels at them for oral.
 */
function ballBridgePlan(cls, { oral = false, facing = false } = {}) {
  const a = figure(cls.a_body, "supine", {
    soloSurface: "floor",
    override: { ...both("shoulder", { flexion: -60, abduction: 15, rotation: 0 }), ...both("elbow", { flexion: 20 }), spine01: { flexion: 12 }, spine02: { flexion: 12 }, spine03: { flexion: 12 }, neck: { flexion: 30 }, ...both("hip", { flexion: -25, abduction: 4, rotation: 0 }), ...both("knee", { flexion: 0 }) },
  });
  const bList = oral
    ? frontCandidates(cls.b_body, { oral: true }).filter((spec) => spec.posture !== "standing")
    : [stance(0, 18, 5), stance(5, 22, 12), stance(10, 26, 20), stance(15, 30, 30)].map((joints, i) => figure(cls.b_body, "standing", { soloSurface: "floor", trunk: "forward_leaning", ...joints, prefer: i * 0.001 }));
  return {
    surface: "ball",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, bList],
    // Head to -z, let down onto the crest across the upper back; B starts out of the way.
    place: [{ index: 0, yaw: 180, pitch: -10, pelvisTo: [0, 1.6, 0.45], settle: {} }, { index: 1, yaw: oral || facing ? 180 : 0, pelvisTo: [0, null, 2] }],
    fit: [
      downOnBall(0, ["foot.l", "foot.r"], "upperBack"),
      oral
        ? { ...refine(1, "mouth", 1, "groin", 0, { start: [0, 0, 0.3] }), pitchRange: 25, pivot: "knee" }
        : refine(1, "groin", 1, "groin", 0, { start: [0, 0, 0.1] }),
    ],
    // Facing A, the hands go to the sides of A's chest, or nowhere in particular.
    limbContacts: oral || cls.b_hands === "surface" ? [] : facing ? (cls.b_hands === "shoulders" ? handsTo(1, 0, "ribs") : []) : handsTo(1, 0, "thigh"),
    contacts: [oral ? grip("mouth", "groin", 1, 0, "surface") : grip("groin", "groin", 1, 0, "surface")],
    checks: oral ? ["aFaceUp", "facingInward", near("b", "mouth", "a", "groin", 0.2)] : ["aFaceUp", "bUpright", near("b", "groin", "a", "groin", 0.3)],
  };
}

/**
 * Lying back over an exercise ball, the partner in front between the legs.
 * For a partner kneeling up, the hips come down off the ball's front with the
 * back up against it; for one standing, they are on its crest and the back
 * arches down the far side, the head and hands falling towards the floor.
 */
function ballBackPlan(cls, legs) {
  const kneelingB = has(cls, /partner kneeling/);
  // Or reclined against its front for a partner standing with the knees bent right down.
  const reclined = kneelingB || has(cls, /reclined/);
  const arch = reclined
    ? { spine01: { flexion: 8 }, spine02: { flexion: 8 }, spine03: { flexion: 6 } }
    : { spine01: { flexion: 14 }, spine02: { flexion: 14 }, spine03: { flexion: 12 }, neck: { flexion: 25 } };
  // Reclined, the trunk is tipped well up: raised legs go on up past the partner's
  // shoulders, and a leg left down bends to put the foot on the floor.
  const shape = structuredClone(LEG_SHAPES[legs] ?? LEG_SHAPES.raised);
  if (reclined && (legs === "raised" || legs === "on_shoulders")) Object.assign(shape, both("hip", { flexion: 135, abduction: 22, rotation: 0 }), both("knee", { flexion: 20 }));
  if (reclined && legs === "one_raised") Object.assign(shape, { hip_l: { flexion: 135, abduction: 24, rotation: 0 }, hip_r: { flexion: 62, abduction: 40, rotation: 0 }, knee_r: { flexion: 92 } });
  const a = figure(cls.a_body, "supine", { soloSurface: "floor", arms: reclined ? "arms_sides" : "arms_overhead", override: { ...shape, ...arch } });
  const bList = kneelingB
    ? [figure(cls.b_body, "kneeling", { soloSurface: "floor" }), figure(cls.b_body, "kneeling_low", { soloSurface: "floor", prefer: 0.004 })]
    : reclined
      ? [stance(45, 30, 70), stance(65, 35, 100), stance(80, 40, 115)].map((joints, i) => figure(cls.b_body, "standing", { soloSurface: "floor", ...trunkOf(cls.lean === "forward" ? "forward" : null), ...joints, prefer: i * 0.001 }))
      : stanceCandidates(cls.b_body, trunkOf(cls.lean === "forward" ? "forward" : null));
  // Reaching for the hips from below would pass the arms through the raised thighs: they hold the thighs.
  const hands = kneelingB && cls.b_hands === "hips" ? "legs" : cls.b_hands;
  return {
    surface: "ball",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, bList],
    place: [
      reclined ? { index: 0, yaw: 180, pitch: -55, pelvisTo: [0, 0.5, 0.9], settle: { along: [0, 0, -1] } } : { index: 0, yaw: 180, pelvisTo: [0, 1.5, 0.05], settle: {} },
      { index: 1, yaw: 180 },
    ],
    fit: [refine(1, "groin", 1, "groin", 0, { start: [0, 0, 0.3] })],
    limbContacts: bHands({ ...cls, b_hands: hands }, 1, 0, { fallback: legs === "raised" || legs === "on_shoulders" ? "legs" : "hips" }),
    contacts: [grip("groin", "groin", 1, 0, "surface")],
    checks: ["aFaceUp", "bUpright", "facingInward", near("b", "groin", "a", "groin", 0.3)],
  };
}

/**
 * Lying forward over an exercise ball, the hands on the floor in front and the
 * legs stretched back to the toes, the partner standing behind or astride them.
 */
function ballProneRearPlan(cls) {
  const lifted = cls.a_legs === "one_raised";
  // With the knees bent, B's come forward either side of A's legs, astride them.
  const astride = (cls.b_pose ?? []).includes("legs_bent");
  // Curled over the crest, the hips a little behind it and the chest down its front,
  // the arms reaching on down to the floor. A lifted leg goes up behind, past B's side.
  const over = {
    spine01: { flexion: -22 },
    spine02: { flexion: -22 },
    spine03: { flexion: -22 },
    neck: { flexion: 10 },
    ...both("hip", { flexion: 34, abduction: astride ? 2 : 8, rotation: 0 }),
    ...both("knee", { flexion: 5 }),
    ...both("shoulder", { flexion: 140, abduction: 15, rotation: 0 }),
    ...both("elbow", { flexion: 5 }),
    ...(lifted ? { hip_l: { flexion: -30, abduction: 45, rotation: 0 }, knee_l: { flexion: 35 } } : {}),
  };
  const hands = cls.b_hands === "surface" ? [] : lifted ? [grip("hand.l", "knee.l", 1, 0), grip("hand.r", "hip.r", 1, 0)] : bHands(cls, 1, 0, { face: false });
  return {
    surface: "ball",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [
      figure(cls.a_body, "prone", { soloSurface: "floor", override: over }),
      // Or the knees bent wide, astride the partner's legs.
      leanIn(cls, astride ? [onToes(5, 30, 10), onToes(5, 40, 10)].map((joints, i) => figure(cls.b_body, "standing", { soloSurface: "floor", ...joints, prefer: 0.001 * i })) : [...stanceCandidates(cls.b_body), figure(cls.b_body, "standing", { soloSurface: "floor", ...stance(40, 45, 70), prefer: 0.003 })]),
    ],
    // B starts well back, out of the way while A is fitted.
    place: [{ index: 0, yaw: 180, pitch: -16, pelvisTo: [0, 1.5, 0.12], settle: {} }, { index: 1, yaw: 180, pelvisTo: [0, null, 1.5] }],
    fit: [
      downOnBall(0, ["hand.l", "hand.r", "foot.r", ...(lifted ? [] : ["foot.l"])], "abdomen"),
      refine(1, "groin", 1, "pelvis", 0, { start: [0, 0, 0.3], extra: (lifted ? [] : hands).map((c) => ({ from: c.from, fromActor: 1, to: c.to, toActor: 0, weight: 0.2 })) }),
    ],
    limbContacts: hands,
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameHeading", "bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.3)],
  };
}

/**
 * Kneeling on the floor with the chest laid over a bench or chair seat in front,
 * or over an exercise ball, the partner kneeling behind.
 */
function kneelOverPlan(cls, surface = "bench") {
  const seat = SEATS[surface];
  const ball = surface === "ball";
  // Tipped forward about the hips, the thighs re-aimed down to the knees. Over a
  // ball's higher crest less far, brought in from behind until the chest meets it,
  // the arms round it and the knees wider for the partner between them.
  const tilt = ball ? 52 : 66;
  const arms = ball ? { ...both("shoulder", { flexion: 80, abduction: 25, rotation: 0 }), ...both("elbow", { flexion: 60 }) } : { ...both("shoulder", { flexion: 115, abduction: 25, rotation: 0 }), ...both("elbow", { flexion: 45 }) };
  const a = figure(cls.a_body, "kneeling", { soloSurface: "floor", tilt, override: { ...both("hip", { flexion: tilt, abduction: ball ? 30 : 18, rotation: 0 }), ...arms } });
  // B kneels up behind, bowed low over A's back when leaning forward.
  const bList =
    cls.lean === "forward"
      ? ["forward_lowered", "forward_leaning"].map((trunk, i) => figure(cls.b_body, "kneeling", { soloSurface: "floor", trunk, prefer: i * 0.002 }))
      : cls.lean === "upright"
        ? [figure(cls.b_body, "kneeling", { soloSurface: "floor" }), figure(cls.b_body, "kneeling_low", { soloSurface: "floor", prefer: 0.004 })]
        : [figure(cls.b_body, "kneeling", { soloSurface: "floor", trunk: "forward_leaning" }), figure(cls.b_body, "kneeling_low", { soloSurface: "floor", prefer: 0.004 })];
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, bList],
    place: [ball ? { index: 0, yaw: 180, pelvisTo: [0, null, 0.9], settle: { along: [0, 0, -1] } } : { index: 0, yaw: 180, pelvisTo: [0, null, seat.z + 0.22] }, { index: 1, yaw: 180 }],
    fit: [refine(1, "groin", 1, "pelvis", 0, { start: [0, 0, 0.3] })],
    limbContacts: bHands(cls, 1, 0, { face: false }),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameHeading", "bBehind", near("b", "groin", "a", "pelvis", 0.28)],
  };
}

/** Standing bent forward with the hands on a chair seat, the partner standing behind. */
function chairBentOverPlan(cls) {
  return {
    surface: "chair",
    mode: "fit",
    roles: { a: 0, b: 1 },
    // Folded a little deeper than standing bent forward, the hands come down onto the seat.
    actors: [
      figure(cls.a_body, "standing_bent_forward", { soloSurface: "floor", arms: "arms_on_prop", override: { ...both("hip", { flexion: 80 }), ...both("shoulder", { abduction: 4 }) } }),
      leanIn(cls, stanceCandidates(cls.b_body)),
    ],
    // Facing the chair with the hands just inside its front edge.
    place: [{ index: 0, yaw: 180, pelvisTo: [0, null, SEATS.chair.z + 0.44] }, { index: 1, yaw: 180 }],
    fit: [refine(1, "groin", 1, "pelvis", 0, { start: [0, 0, 0.3] })],
    limbContacts: cls.b_hands === "surface" ? [] : bHands(cls, 1, 0, { face: false }),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameHeading", "bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.26)],
  };
}

/**
 * Perched on a high seat with the back to a standing partner. A table top
 * stands in for the stool: it is the height that meets the partner's hips.
 */
function perchedRearPlan(cls) {
  const top = SEATS.table.top;
  return {
    surface: "table",
    mode: "fit",
    roles: { a: 0, b: 1 },
    // Sitting up at the table's back edge, the legs along it, facing away from B.
    actors: [figure(cls.a_body, "seated_floor", { soloSurface: "floor", trunk: "forward_leaning" }), stanceCandidates(cls.b_body)],
    place: [{ index: 0, rest: top, anchor: "buttocks", pelvisTo: [0, null, -0.4 + 0.1] }],
    fit: [refine(1, "groin", 1, "buttocks", 0, { start: [0, 0, -0.3] })],
    limbContacts: cls.b_hands === "surface" ? [] : bHands(cls, 1, 0, { face: false }),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameFacing", "bBehind", "bUpright", near("b", "groin", "a", "buttocks", 0.26)],
  };
}

// Hunched under a car's roof, the back rounded and the head bowed.
const HUNCH = { spine01: { flexion: -20 }, spine02: { flexion: -20 }, spine03: { flexion: -20 }, neck: { flexion: -25 } };

/**
 * Both kneeling across a car's back seat, A bent forward towards the far
 * door, B kneeling up behind, hunched under the roof: the seat is too shallow
 * to kneel along.
 */
function backSeatRearPlan(cls) {
  const top = SEATS.car_seat.top;
  return {
    surface: "car_seat",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [
      figure(cls.a_body, "kneeling", { soloSurface: "floor", trunk: "forward_lowered", override: both("hip", { abduction: 19 }) }),
      figure(cls.b_body, "kneeling", { soloSurface: "floor", override: { ...HUNCH, ...spineBy("flexion", -18), ...both("hip", { abduction: 2 }) } }),
    ],
    // Facing +x, the knees parted only so far as both stay on the seat, between
    // the backrest and the front edge: further apart, one hung off the edge.
    place: [{ index: 0, yaw: 90, rest: top, pelvisTo: [0.2, null, 0] }, { index: 1, yaw: 90, rest: top }],
    fit: [refine(1, "groin", 1, "pelvis", 0, { start: [-0.3, 0, 0] })],
    limbContacts: cls.b_hands === "surface" ? [] : bHands(cls, 1, 0, { face: false }),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameHeading", "bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.26)],
  };
}

/**
 * Lying back across a car's back seat, the head propped against the door at
 * +x and the legs raised in a V; B kneels up on the seat between them, sitting
 * half back on the heels and hunched under the roof, with A's hips lifted onto
 * B's thighs. Kneeling upright would put B's head through the roof, and the
 * seat is too shallow for legs parted flat across it.
 */
function carSeatLyingPlan(cls) {
  const top = SEATS.car_seat.top;
  const legs = { ...legPair(100, 30, 20), neck: { flexion: -30 } };
  return {
    surface: "car_seat",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [
      figure(cls.a_body, "supine", { soloSurface: "floor", joints: legs }),
      figure(cls.b_body, "kneeling_low", { soloSurface: "floor", override: { ...both("hip", { flexion: 30, abduction: 25 }), ...both("knee", { flexion: 120 }), ...HUNCH } }),
    ],
    // B first, facing +x a little forward of the seat's middle so the parted
    // knees clear the backrest; then A, tipped hips-up, is let down onto B,
    // the shoulders on the seat: held up at the hips alone, A would lie on air.
    place: [{ index: 1, yaw: 90, rest: top, pelvisTo: [-0.22, null, 0.1] }, { index: 0, yaw: 90, pitch: 10, rest: top, pelvisTo: [0, null, 0.06] }],
    fit: [
      {
        moving: 0,
        free: ["x", "y"],
        keep: false,
        floor: 0,
        pitchRange: 40,
        pivot: "pelvis",
        anchors: [
          { from: "groin", fromActor: 0, to: "groin", toActor: 1, offset: [0.03, 0.05, 0], weight: 4 },
          { from: "upperBack", fromActor: 0, point: [0, top + 0.1, 0], axes: [1], weight: 1 },
        ],
      },
    ],
    limbContacts: bHands(cls, 1, 0, { fallback: "legs" }),
    contacts: [grip("groin", "groin", 1, 0, "surface")],
    checks: ["aFaceUp", "facingInward", near("b", "groin", "a", "groin", 0.25)],
  };
}

/**
 * Lying back across a car's back seat as above, the head propped against the
 * door at +x and the legs raised, B crouched on the seat at the hips: tipped
 * forward on the knees, the feet up behind against the far door, since shins
 * laid flat on the seat would go through it.
 */
function carSeatOralPlan(cls) {
  const top = SEATS.car_seat.top;
  return {
    surface: "car_seat",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [
      figure(cls.a_body, "supine", { soloSurface: "floor", joints: { ...legPair(100, 30, 20), neck: { flexion: -30 } } }),
      [
        // Tipped forward from sitting on the heels, the feet coming up behind,
        // the knees no further apart than the seat is deep.
        ...[55, 40].map((tilt, i) => figure(cls.b_body, "kneeling_low", { soloSurface: "floor", trunk: "forward_fold", override: both("hip", { abduction: 12 }), tilt, prefer: i * 0.002 })),
        figure(cls.b_body, "forearms_and_knees", { soloSurface: "floor", prefer: 0.004 }),
      ],
    ],
    place: [{ index: 0, yaw: 90, pitch: 10, rest: top, pelvisTo: [0, null, 0.02] }, { index: 1, yaw: 90, rest: top, pelvisTo: [-0.5, null, 0.02] }],
    fit: [refine(1, "mouth", 1, "groin", 0, { start: [-0.2, 0, 0] })],
    limbContacts: cls.b_hands === "surface" ? [] : handsTo(1, 0, "hip", true).map((c) => ({ ...c, optional: true })),
    contacts: [grip("mouth", "groin", 1, 0, "surface")],
    checks: ["aFaceUp", near("b", "mouth", "a", "groin", 0.22)],
  };
}

/** A wedge cushion, or the taller ramp: its slope in degrees and half its length along z. */
const wedgeSlope = (cls) => (cls.surface === "ramp" ? { surface: "ramp", pitch: 27, half: 0.375 } : { surface: "wedge", pitch: 17, half: 0.3 });

/**
 * Lying back up a wedge, the head on its tall end and the hips at its foot,
 * lifted onto the thighs of the partner kneeling up between the legs.
 */
function wedgeLyingPlan(cls) {
  const legs = cls.a_legs === "straight" ? "open_bent" : cls.a_legs ?? "raised";
  const { surface, pitch, half } = wedgeSlope(cls);
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [
      figure(cls.a_body, "supine", { soloSurface: "floor", override: structuredClone(LEG_SHAPES[legs]) }),
      ["kneeling", "kneeling_low"].map((posture, i) => figure(cls.b_body, posture, { soloSurface: "floor", override: both("hip", { abduction: 6 }), prefer: i * 0.004 })),
    ],
    // Head to -z, up the slope, and let down onto it; B faces it from the feet.
    place: [{ index: 0, yaw: 180, pitch: -pitch, pelvisTo: [0, 1.2, half + 0.1], settle: {} }, { index: 1, yaw: 180, pelvisTo: [0, null, 2] }],
    fit: [
      refine(1, "groin", 1, "groin", 0, { start: [0, 0, 0.35] }),
      // Then A's hips tilt up onto B's thighs, pivoting at the shoulders.
      { moving: 0, free: [], keep: false, floor: 0, pitchRange: 24, pivot: "upperBack", anchors: [{ from: "groin", fromActor: 0, to: "groin", toActor: 1, offset: [0, 0, 0], weight: 1 }] },
    ],
    limbContacts: bHands(cls, 1, 0, { fallback: legs === "raised" || legs === "on_shoulders" ? "legs" : "hips" }),
    contacts: [grip("groin", "groin", 1, 0, "surface")],
    checks: ["aFaceUp", "bUpright", "facingInward", near("b", "groin", "a", "groin", 0.25)],
  };
}

/**
 * Face down with the hips up on a wedge's tall end, the chest down its slope
 * and the legs back to the floor, straight or down on the knees, the partner
 * kneeling up between them.
 */
function wedgeProneRearPlan(cls) {
  const straight = cls.a_legs === "straight";
  const legs = { ...both("hip", { flexion: straight ? 14 : 48, abduction: 34, rotation: 0 }), ...both("knee", { flexion: straight ? 4 : 31 }) };
  return {
    surface: "wedge",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [
      figure(cls.a_body, "prone", { soloSurface: "floor", override: legs }),
      // Leaning forward, B bows over A's back.
      ["kneeling_low", "kneeling"].map((posture, i) =>
        figure(cls.b_body, posture, { soloSurface: "floor", ...(cls.lean === "forward" ? { trunk: "forward_lowered" } : {}), override: both("hip", { abduction: 10 }), prefer: i * 0.004 })
      ),
    ],
    // Head to +z, down the slope, the hips over the tall end; B starts out of the way.
    place: [{ index: 0, pitch: 17, pelvisTo: [0, 1.2, -0.22], settle: {} }, { index: 1, pelvisTo: [0, null, -2] }],
    fit: [refine(1, "groin", 1, "buttocks", 0, { start: [0, 0, -0.3] })],
    limbContacts: cls.b_hands === "surface" ? [] : bHands(cls, 1, 0, { face: false }),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["aFaceDown", "sameHeading", "bBehind", near("b", "groin", "a", "buttocks", 0.2)],
  };
}

/** Lying face down along a table with the hips at its end, the partner standing between the legs. */
function tableProneRearPlan(cls, surface = "table") {
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [figure(cls.a_body, "prone", { soloSurface: "floor", arms: "arms_forearms", legs: "legs_apart" }), frontCandidates(cls.b_body, { lean: cls.lean })],
    place: [{ index: 0, yaw: 180, rest: SEATS[surface].top, pelvisTo: [0, null, SEATS[surface].z - 0.08] }, { index: 1, yaw: 180 }],
    fit: [refine(1, "groin", 1, "pelvis", 0, { start: [0, 0, 0.3] })],
    limbContacts: cls.b_hands === "surface" ? [] : handsTo(1, 0, "thigh"),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["aFaceDown", "sameHeading", "bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.28)],
  };
}

/** Lap positions, on the floor or on any seat (posed on a chair, then carried to the seat). */
const LAP_WRAP = {
  hip_l: { flexion: 65, abduction: 70, rotation: 0 },
  hip_r: { flexion: 65, abduction: 70, rotation: 0 },
  knee_l: { flexion: 95 },
  knee_r: { flexion: 95 },
};

// Face to face on a seat with the legs open and bent, A's feet go down to the
// floor either side of the seat instead of round B (not in a car, which has no room).
const LAP_FEET_DOWN = { ...both("hip", { flexion: -5, abduction: 35, rotation: 0 }), ...both("knee", { flexion: 20 }) };

const FLAT_LEGS = {
  hip_l: { flexion: 35, abduction: 12 },
  hip_r: { flexion: 35, abduction: 12 },
  knee_l: { flexion: 8 },
  knee_r: { flexion: 8 },
};

// On the floor A's legs wrap around B's waist instead of hanging down.
// Astride a partner sitting back on the heels, A kneels too, the knees down
// either side of B's thighs and the shins back along the floor.
const LAP_KNEEL = { ...both("hip", { flexion: 45, abduction: 40, rotation: 0 }), ...both("knee", { flexion: 140 }) };
// Kneeling up astride a partner sitting on a seat, the thighs spread and the
// shins turned out to lie along the cushion outside the partner's thighs.
const LAP_KNEEL_UP = { ...both("hip", { flexion: 28, abduction: 40, rotation: 12 }), ...both("knee", { flexion: 120 }) };
// Or wraps the legs round B's waist, the feet crossing behind the back.
const LAP_WRAP_KNEEL = { ...both("hip", { flexion: 80, abduction: 65, rotation: -40 }), ...both("knee", { flexion: 105 }) };
const LAP_WRAP_FLOOR = {
  hip_l: { flexion: 85, abduction: 72, rotation: 0 },
  hip_r: { flexion: 85, abduction: 72, rotation: 0 },
  knee_l: { flexion: 45 },
  knee_r: { flexion: 45 },
};
// Reverse on a seat: A's thighs straddle outside B's, feet down.
const LAP_ASTRIDE = {
  hip_l: { flexion: 70, abduction: 40, rotation: 0 },
  hip_r: { flexion: 70, abduction: 40, rotation: 0 },
  knee_l: { flexion: 85 },
  knee_r: { flexion: 85 },
};
// Sitting cross-legged: knees wide and folded, the shins crossing in front.
// The hips turn out as far as they go; even so the shins fold down at a slant,
// so the knees come up for the feet to reach the floor.
const CROSS_LEGGED = { ...both("hip", { flexion: 125, abduction: 60, rotation: -45 }), ...both("knee", { flexion: 150 }) };
// Raised face to face on a lap, the legs go up past the partner's shoulders.
const LAP_LEGS_UP = { ...both("hip", { flexion: 125, abduction: 20, rotation: 0 }), ...both("knee", { flexion: 10 }) };
// On a seat, over the shoulders of a partner sitting up: wider, past the chest
// and outside the arms of a partner holding the hips, not through them.
const LAP_LEGS_UP_SEAT = { ...both("hip", { flexion: 120, abduction: 46, rotation: 0 }), ...both("knee", { flexion: 10 }) };
const LEAN_BACK = { spine01: { flexion: 15 }, spine02: { flexion: 12 }, hip_l: { abduction: 4 }, hip_r: { abduction: 4 } };
// On the floor the legs part so the partner's hips come down between the thighs.
const FLOOR_OPEN = { ...LEAN_BACK, ...both("hip", { abduction: 32 }), ...both("knee", { flexion: 12 }) };
// Squatting, the knees go wide and the trunk comes up so the partner can sit close in between.
const SQUAT_OPEN = { ...LEAN_BACK, ...both("hip", { abduction: 40 }) };

/**
 * Facing away on the lap of a partner sitting on a table's edge, towards the
 * chair drawn up to it: B leans back on the hands, the feet down on the
 * chair's seat; A sits up on B's thighs, the feet on the seat too and the
 * hands on the top of the chair's back.
 */
function tableChairLapPlan(cls) {
  // Tipped back, the thighs rise a little and the knees fold down over the
  // edge, bringing the feet in onto the front of the seat; spread, they let
  // A sit down between them.
  const b = figure(cls.b_body, "seated", { soloSurface: "chair", arms: "arms_braced_behind", override: { ...LEAN_BACK, ...both("hip", { flexion: 80, abduction: 24, rotation: 0 }), ...both("knee", { flexion: 115 }) } });
  // Sitting up, the feet down on the seat's back half and the arms reaching down to the chair's back.
  const a = figure(cls.a_body, "seated", {
    soloSurface: "chair",
    override: { ...both("hip", { flexion: 85, abduction: 15, rotation: 0 }), ...both("knee", { flexion: 90 }), ...both("shoulder", { flexion: 40, abduction: 10, rotation: 0 }), ...both("elbow", { flexion: 10 }) },
  });
  const back = [0, TABLE_CHAIR.top + 0.47, TABLE_CHAIR.back];
  return {
    surface: "table_chair",
    mode: "fit",
    roles: { a: 1, b: 0 },
    actors: [b, a],
    // B sits a little back from the table's edge, leaning back on the hands.
    place: [{ index: 0, pitch: -25, seatOn: { top: SEATS.table.top, z: SEATS.table.z - 0.08 } }, { index: 1, pelvisTo: [0, 3, 0] }],
    fit: [
      refine(1, "buttocks", 1, "groin", 0, {
        free: ["x", "y", "z"],
        keep: false,
        floor: 0,
        start: [0, 0.15, 0.05],
        extra: [
          ...["l", "r"].map((s) => ({ from: `foot.${s}`, fromActor: 1, point: [0, TABLE_CHAIR.top + 0.04, 0], weight: 0.3, axes: [1] })),
          ...["l", "r"].map((s) => ({ from: `hand.${s}`, fromActor: 1, point: back, weight: 0.1, axes: [1, 2] })),
        ],
      }),
    ],
    contacts: [grip("buttocks", "groin", 1, 0, "surface")],
    checks: ["sameFacing", "aAboveOrLevel", near("a", "buttocks", "b", "groin", 0.25)],
  };
}

/**
 * On a lap in a car's back seat. Sitting up, the partner on top would put the
 * head through the roof, so B slides down the seat, tipped back against its
 * rake with the feet forward in the footwell, and A, on B's lap, bows over B -
 * right down onto B's chest when leaning forward - or, facing away and leaning
 * back, lies back on it.
 */
function carLapPlan(cls, reverse, { legsUp, liesBack, aLegsOut, hands }) {
  const seat = SEATS.car_seat;
  const bow = (spine, neck) => ({ spine01: { flexion: spine }, spine02: { flexion: spine }, spine03: { flexion: spine }, neck: { flexion: neck } });
  const b = figure(cls.b_body, "seated", {
    soloSurface: "chair",
    ...(cls.b_hands === "surface" ? { arms: "arms_braced_behind" } : {}),
    override: { ...both("hip", { flexion: 60, abduction: 20, rotation: 0 }), ...both("knee", { flexion: 70 }) },
  });
  const leansBack = cls.lean === "back" || (!reverse && legsUp && cls.lean !== "forward");
  const a = reverse
    ? figure(cls.a_body, "seated_straddle", { trunk: leansBack ? "backward_leaning" : "forward_leaning", override: { ...LAP_ASTRIDE, ...aLegsOut, ...(leansBack ? {} : bow(-10, -25)) } })
    : figure(cls.a_body, "seated_straddle", {
        ...trunkOf(leansBack ? "back" : null),
        override: { ...(legsUp ? LAP_LEGS_UP_SEAT : LAP_WRAP), ...(leansBack ? {} : cls.lean === "forward" ? bow(-15, -15) : bow(-10, -25)) },
      });
  return {
    surface: "car_seat",
    mode: "fit",
    roles: { a: 1, b: 0 },
    actors: [b, a],
    place: [{ index: 0, pitch: -35, seatOn: { top: seat.top, z: seat.z + 0.12 } }, { index: 1, ...(reverse ? {} : { yaw: 180 }), pelvisTo: [0, 3, 0] }],
    fit: [
      {
        moving: 0,
        free: ["y", "z"],
        floor: 0,
        anchors: [
          { from: "buttocks", fromActor: 0, point: [0, seat.top + 0.02, 0], weight: 1, axes: [1] },
          { from: "pelvis", fromActor: 0, point: [0, 0, 0.12], weight: 0.2, axes: [2] },
        ],
      },
      refine(1, reverse ? "buttocks" : "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: 0, start: [0, 0.15, 0.05] }),
    ],
    limbContacts: [...hands, ...(reverse || liesBack || leansBack ? [] : handsTo(1, 0, "shoulder", true))],
    contacts: [grip(reverse ? "buttocks" : "groin", "groin", 1, 0, "surface")],
    checks: [reverse ? "sameFacing" : "faceToFace", "aAboveOrLevel", near("a", reverse ? "buttocks" : "groin", "b", "groin", reverse ? 0.25 : 0.27)],
  };
}

function lapPlan(cls, reverse) {
  if (reverse && cls.surface === "table_chair") return tableChairLapPlan(cls);
  const surface = pickSurface(cls, ["floor", "chair", "sofa", "bed", "bench", "car_seat", "ball", "table"], reverse ? "chair" : "floor");
  const onFloor = surface === "floor";
  // On the floor the lower partner may sit back on the heels, squat or sit cross-legged instead of sitting flat.
  const low = onFloor ? (has(cls, /kneel/) ? "kneeling_low" : has(cls, /squat/) ? "squatting" : has(cls, /cross-legged/) ? "cross" : null) : null;
  // Leaning back describes the partner on top: the seated partner stays upright unless braced behind.
  const seat = onFloor ? (low === "kneeling_low" || low === "squatting" ? low : low === "cross" ? "seated_floor" : reverse || cls.b_hands === "behind" ? "seated_reclined" : "seated_floor") : "seated";
  const legsUp = !reverse && (cls.a_legs === "raised" || cls.a_legs === "on_shoulders");
  // Facing, A may kneel up on the seat astride B, the knees either side of B's thighs.
  const kneelsOnSeat = !reverse && !onFloor && has(cls, /kneel on seat/);
  // Facing away and leaning forward, A folds right over. Set after the solve,
  // or the solver slides A forward off the lap to balance the lean.
  const foldOver = reverse && cls.lean === "forward" ? { spine01: { flexion: -30 }, spine02: { flexion: -30 }, spine03: { flexion: -30 }, neck: { flexion: 30 } } : {};
  // Facing and lying right back across B's knees, the head hanging down behind them.
  const liesBack = !reverse && has(cls, /lying back/);
  const lieBack = liesBack ? { spine01: { flexion: 35 }, spine02: { flexion: 35 }, spine03: { flexion: 30 }, neck: { flexion: 30 } } : {};
  // Facing away on the floor, unless leaning forward, A sits up against the reclining B.
  // Sitting up, A's hands rest down on the thighs.
  const HANDS_ON_THIGHS = { ...both("shoulder", { flexion: 8, abduction: 16, rotation: 0 }), ...both("elbow", { flexion: 30 }) };
  const aTrunk = reverse ? trunkOf(onFloor && cls.lean !== "forward" ? "back" : null) : trunkOf(cls.lean === "back" || (legsUp && cls.lean !== "forward") ? "back" : null);
  // Facing away on the floor, straight legs lie out along B's, together or wide,
  // or rise up in front; on a seat, straight apart, they open out level in the splits.
  // On a kneeling partner's lap the knees come up in front, wide apart or drawn together.
  const aLegsOut =
    reverse && onFloor && (cls.a_legs === "straight" || cls.a_legs === "straight_apart") && !low
      ? legPair(60, has(cls, /splits|wide/) || cls.a_legs === "straight_apart" ? 45 : 12, 5)
      : reverse && !onFloor && cls.a_legs === "straight_apart"
        ? legPair(80, 65, 5)
        : reverse && onFloor && cls.a_legs === "raised" && !low
          ? legPair(125, 12, 5)
          : reverse && low === "kneeling_low" && cls.a_legs === "open_bent"
            ? legPair(100, 52, 100)
            : reverse && low === "kneeling_low" && cls.a_legs === "together_bent"
              ? legPair(85, 6, 115)
              : {};
  const hands = bHands(cls, 0, 1, { face: !reverse });
  const target = SEATS[surface];
  if (!reverse && has(cls, /side saddle/)) {
    // Sitting sideways across the seated partner's thighs, the legs together
    // over one side and the back held in the partner's arm.
    const seatName = onFloor ? "chair" : surface;
    const b = seatedAt(seatName, cls.b_body);
    return {
      surface: seatName,
      mode: "fit",
      roles: { a: 1, b: 0 },
      actors: [
        b.spec,
        figure(cls.a_body, "seated", { soloSurface: "chair", ...trunkOf(cls.lean === "back" ? "back" : null), override: { ...(cls.lean === "back" ? LEAN_BACK : {}), ...both("hip", { abduction: 4 }) } }),
      ],
      place: [b.place, { index: 1, yaw: 90, pelvisTo: [0, 3, 0] }],
      // The buttocks come down on the thighs a hand's width in front of the hips.
      fit: [refine(1, "buttocks", 1, "lap", 0, { free: ["x", "y", "z"], keep: false, floor: 0, offset: [0, 0.06, 0.1], start: [0, 0.15, 0] })],
      limbContacts: cls.b_hands === "embrace" ? handsToCentre(0, 1, "upperBack") : cls.b_hands === "behind" || cls.b_hands === "surface" ? [] : handsTo(0, 1, "hip"),
      contacts: [grip("buttocks", "lap", 1, 0, "surface")],
      // A's hip rests against B's belly, so the buttocks sit on the thigh a little past the lap landmark.
      checks: ["aAboveOrLevel", "crossed", near("a", "buttocks", "b", "lap", 0.24)],
    };
  }
  if (reverse && has(cls, /standing bent over/)) {
    // A stands in front of the seated partner, facing away and folded forward
    // with the knees bent, the hips back at B's lap; B's hands on A's hips.
    const seatName = onFloor ? "chair" : surface;
    const b = seatedAt(seatName, cls.b_body, { override: { ...LEAN_BACK, ...both("hip", { abduction: 40 }) } });
    return {
      surface: seatName,
      mode: "fit",
      roles: { a: 1, b: 0 },
      actors: [
        b.spec,
        // Knees bent to bring the hips down to the lap, the thighs re-aimed forward to keep the hips over the feet.
        [70, 90, 110].map((knee, i) => figure(cls.a_body, "standing_bent_forward", { soloSurface: "floor", override: { ...both("hip", { flexion: 72 + knee * 0.65 }), ...both("knee", { flexion: knee }) }, prefer: i * 0.001 })),
      ],
      place: [b.place, { index: 1, rest: 0 }],
      fit: [refine(1, "buttocks", 1, "groin", 0, { start: [0, 0, 0.3] })],
      limbContacts: cls.b_hands === "surface" || cls.b_hands === "behind" ? [] : handsTo(0, 1, "hip", false),
      contacts: [grip("buttocks", "groin", 1, 0, "surface")],
      checks: ["sameFacing", near("a", "buttocks", "b", "groin", 0.25)],
    };
  }
  if (reverse && (surface === "bed" || surface === "sofa") && has(cls, /partner lies back/)) {
    // B lies back across the bed, the knees over its edge and the feet on the
    // floor; A sits up on B's hips facing the feet, the feet down in front.
    return {
      surface,
      mode: "fit",
      roles: { a: 1, b: 0 },
      actors: [
        figure(cls.b_body, "supine", { soloSurface: surface, override: { ...both("hip", { flexion: 10, abduction: 20, rotation: 0 }), ...both("knee", { flexion: 90 }) } }),
        [[85, 90], [75, 80], [65, 70]].map(([hip, knee], i) =>
          figure(cls.a_body, "seated", { soloSurface: "chair", override: { ...both("hip", { flexion: hip, abduction: 20, rotation: 0 }), ...both("knee", { flexion: knee }) }, prefer: i * 0.001 })
        ),
      ],
      place: [{ index: 0, yaw: 180, pelvisTo: [0, null, target.z - 0.4] }],
      fit: [refine(1, "buttocks", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: 0, start: [0, 0.2, 0] })],
      limbContacts: hands,
      contacts: [grip("buttocks", "groin", 1, 0, "surface")],
      checks: ["aUpright", "bFaceUp", "reversed", near("a", "buttocks", "b", "groin", 0.25)],
    };
  }
  if (reverse && !onFloor && surface !== "ball" && has(cls, /one knee on seat/)) {
    // Facing away on the lap of a partner sitting back in the seat, the right
    // knee folded up over the seat beside B's thigh and the left foot on the
    // floor. B sits well back, the shins sloping out to the feet, to leave the
    // seat beside the thighs for A's knee.
    const b = seatedAt(surface, cls.b_body, { override: { ...LEAN_BACK, ...both("knee", { flexion: 45 }) } });
    const knee = { hip_r: { flexion: 30, abduction: 60, rotation: 0 }, knee_r: { flexion: 110 }, hip_l: { flexion: 70, abduction: 30, rotation: 0 }, knee_l: { flexion: 60 } };
    return {
      surface,
      mode: "fit",
      roles: { a: 1, b: 0 },
      actors: [b.spec, figure(cls.a_body, "seated", { soloSurface: "chair", trunk: "forward_leaning", override: { ...LAP_ASTRIDE, ...knee } })],
      place: [{ ...b.place, seatOn: { ...b.place.seatOn, z: target.z - 0.35 } }, { index: 1, pelvisTo: [0, 3, 0] }],
      fit: [refine(1, "buttocks", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: 0, start: [0, 0.15, 0.1] })],
      limbContacts: hands,
      contacts: [grip("buttocks", "groin", 1, 0, "surface")],
      checks: ["sameFacing", "aAboveOrLevel", near("a", "buttocks", "b", "groin", 0.25)],
    };
  }
  if (kneelsOnSeat && surface !== "ball") {
    // Kneeling up on the seat astride B, face to face: the thighs spread wide
    // over B's so the knees come down on the cushion either side of B's hips,
    // and the shins lie back along the seat outside B's thighs, the feet just
    // over its front edge. B sits back with the knees together at the edge,
    // the shins sloping forward to the feet set flat on the floor.
    const b = seatedAt(surface, cls.b_body, { override: { ...LEAN_BACK, ...both("hip", { abduction: 0, rotation: 0 }), ...both("knee", { flexion: 45 }), ...both("ankle", { flexion: 30 }) } });
    const back = { ...b.place, seatOn: { ...b.place.seatOn, z: target.z - 0.35 } };
    return {
      surface,
      mode: "fit",
      roles: { a: 1, b: 0 },
      actors: [
        b.spec,
        ["kneeling_low", "kneeling"].map((posture, i) => figure(cls.a_body, posture, { soloSurface: "floor", ...aTrunk, override: { ...LAP_KNEEL_UP, ...lieBack }, prefer: i * 0.002 })),
      ],
      place: [back, { index: 1, yaw: 180, rest: target.top }],
      fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: target.top, start: [0, 0.1, 0.15] })],
      limbContacts: [...hands, ...(liesBack ? [] : handsTo(1, 0, "shoulder", true))],
      contacts: [grip("groin", "groin", 1, 0, "surface")],
      checks: ["faceToFace", "aAboveOrLevel", near("a", "groin", "b", "groin", 0.27)],
    };
  }
  if (surface === "car_seat") return carLapPlan(cls, reverse, { legsUp, liesBack, aLegsOut, hands });
  return {
    surface,
    // Solved on the car seat itself; anything else is solved on a chair and carried to the seat.
    solveSurface: onFloor ? "floor" : surface === "car_seat" ? "car_seat" : "chair",
    mode: "solver",
    roles: { a: 1, b: 0 },
    // Facing: A's knees open around B's waist. Reverse: B reclines slightly so A's back clears B's chest.
    actors: [
      figure(cls.b_body, seat, {
        // Fixed, or the solver re-aims the legs to set the feet flat and tips the trunk back.
        ...(low === "cross" ? { joints: structuredClone(CROSS_LEGGED), jointMode: "fixed" } : low === "squatting" ? { override: SQUAT_OPEN } : low ? {} : reverse && onFloor ? { override: FLAT_LEGS } : { override: onFloor ? FLOOR_OPEN : surface === "ball" ? mergeJoints(LEAN_BACK, BALL_SEAT) : LEAN_BACK }),
        // Hands on the seat go behind, clear of the partner sitting in front.
        ...(!onFloor && cls.b_hands === "surface" ? { arms: "arms_braced_behind" } : {}),
      }),
      figure(cls.a_body, "seated_straddle", { ...(reverse && !aTrunk.trunk ? { trunk: "forward_leaning" } : aTrunk), ...(reverse ? { override: onFloor ? { ...foldOver, ...(aTrunk.trunk ? HANDS_ON_THIGHS : {}), ...aLegsOut } : { ...LAP_ASTRIDE, ...foldOver, ...aLegsOut } } : { override: { ...(legsUp ? (onFloor ? LAP_LEGS_UP : LAP_LEGS_UP_SEAT) : low === "kneeling_low" && cls.a_legs !== "straight_apart" ? (cls.a_legs === "wrapped" ? LAP_WRAP_KNEEL : LAP_KNEEL) : onFloor ? LAP_WRAP_FLOOR : cls.a_legs === "open_bent" && surface !== "car_seat" ? LAP_FEET_DOWN : LAP_WRAP), ...lieBack } }) }),
    ],
    relationship: reverse ? { arrangement: "straddle_lap", yaw: 0 } : { arrangement: "straddle_lap" },
    place: onFloor ? [{ index: 0, rest: 0 }] : surface === "car_seat" ? [] : surface === "ball" ? [seatedAt("ball", null).place, { index: 1, seatOn: seatedAt("ball", null).place.seatOn }] : [0, 1].map((index) => ({ index, seatOn: { top: target.top, z: target.z } })),
    fit: [refine(1, reverse ? "buttocks" : "groin", 1, reverse ? "groin" : "groin", 0, { free: ["x", "y", "z"], keep: false, floor: 0 })],
    // Face to face, A's arms go round the shoulders of an upright B.
    limbContacts: [...hands, ...(reverse || liesBack || seat === "seated_reclined" ? [] : handsTo(1, 0, "shoulder", true))],
    contacts: [grip(reverse ? "buttocks" : "groin", "groin", 1, 0, "surface")],
    checks: [reverse ? "sameFacing" : "faceToFace", "aAboveOrLevel", near("a", reverse ? "buttocks" : "groin", "b", "groin", reverse ? 0.25 : low === "cross" ? 0.29 : 0.27)],
  };
}

/** Head brought to the partner's buttocks from behind: B faces the way A faces. */
function rearOralPlan(cls) {
  const lowered = cls.lean === "forward";
  const kneelUp = (body, trunk = "forward_leaning") => [
    figure(body, "kneeling", { trunk, soloSurface: "floor" }),
    figure(body, "kneeling", { trunk: "forward_lowered", soloSurface: "floor", prefer: 0.002 }),
    figure(body, "kneeling_low", { trunk: "forward_leaning", soloSurface: "floor", prefer: 0.002 }),
  ];
  const standOver = (body) => [
    figure(body, "standing", { trunk: "forward_lowered", soloSurface: "floor" }),
    figure(body, "standing_bent_forward", { soloSurface: "floor", prefer: 0.002 }),
    // Folded further down over a low partner, the legs kept upright.
    figure(body, "standing_bent_forward", { override: both("hip", { flexion: 107, abduction: 10 }), tilt: 35, soloSurface: "floor", prefer: 0.003 }),
    figure(body, "standing_bent_forward", { override: both("hip", { flexion: 122, abduction: 12 }), tilt: 50, soloSurface: "floor", prefer: 0.003 }),
    figure(body, "squatting", { soloSurface: "floor", prefer: 0.004 }),
    figure(body, "kneeling", { trunk: "forward_leaning", soloSurface: "floor", prefer: 0.006 }),
  ];
  let surface;
  let a;
  let aPlace = null;
  let bList;
  // Which way "behind" A lies once A is placed.
  let back = [0, 0, -1];
  let bYaw = 0;
  if (has(cls, /partner inverted/)) return rearOralInvertedPlan(cls);
  if (cls.surface === "table_chair") return tableChairOralPlan(cls);
  if (has(cls, /kneel on seat/) && cls.surface !== "floor") {
    // A kneels up on the furniture, facing away from its front edge; B is on the floor behind.
    surface = pickSurface(cls, ["chair", "bench", "table", "sofa", "bed"], "chair");
    const top = surfaceTop(surface);
    if (surface === "bench") {
      a = figure(cls.a_body, "all_fours", { soloSurface: "floor" });
      aPlace = { index: 0, yaw: -90, rest: top, pelvisTo: [0.3, null, 0] };
      back = [1, 0, 0];
      bYaw = -90;
    } else {
      // On a chair A folds forward over its back, as far as the back allows.
      a =
        surface === "chair"
          ? ["forward_lowered", "forward_leaning"].map((trunk, i) => figure(cls.a_body, "kneeling", { soloSurface: "floor", trunk, prefer: i * 0.002 }))
          : figure(cls.a_body, "all_fours", { soloSurface: "floor" });
      aPlace = { index: 0, yaw: 180, rest: top, pelvisTo: [0, null, SEATS[surface].z - (surface === "chair" ? 0.14 : 0.16)] };
      back = [0, 0, 1];
      bYaw = 180;
    }
    bList = surface === "table" ? standOver(cls.b_body) : kneelUp(cls.b_body);
  } else if (has(cls, /standing bent over/)) {
    // A stands folded over the furniture's front edge, B low behind.
    surface = pickSurface(cls, ["table", "sofa", "bed", "chair", "bench"], "table");
    if (["table", "chair", "bench"].includes(surface)) {
      // The solver lays the chest on a table-height top itself, facing +z from its far side.
      a = figure(cls.a_body, "bent_over_support", { soloSurface: surface });
    } else {
      a = figure(cls.a_body, "standing_bent_forward", { soloSurface: "floor", arms: "arms_on_prop" });
      aPlace = { index: 0, yaw: 180, pelvisTo: [0, null, (SEATS[surface]?.z ?? 0.4) + 0.24] };
      back = [0, 0, 1];
      bYaw = 180;
    }
    bList = kneelUp(cls.b_body);
  } else if (has(cls, /standing/) && !has(cls, /partner standing/)) {
    surface = "floor";
    a = figure(cls.a_body, "standing", { soloSurface: "floor" });
    bList = kneelUp(cls.b_body, null);
  } else {
    surface = lying(cls, "floor");
    const standingB = has(cls, /partner standing/);
    a = has(cls, /prone/)
      ? figure(cls.a_body, "prone", { soloSurface: surface, legs: "legs_apart" })
      : figure(cls.a_body, lowered || has(cls, /ball|partner standing/) ? "forearms_and_knees" : "all_fours", { soloSurface: surface, ...KNEES_APART });
    // Lying behind a prone partner, B props the chest up and lifts the head.
    const propped = { joints: { spine01: { flexion: 12 }, spine02: { flexion: 12 }, spine03: { flexion: 12 }, neck: { flexion: 40 } } };
    bList = standingB
      ? standOver(cls.b_body)
      : has(cls, /prone/)
      ? [figure(cls.b_body, "prone", { arms: "arms_sides", soloSurface: surface, ...propped })]
      : [
          figure(cls.b_body, "kneeling_low", { trunk: "forward_fold", soloSurface: surface }),
          figure(cls.b_body, "kneeling", { trunk: "forward_lowered", soloSurface: surface, prefer: 0.002 }),
          figure(cls.b_body, "all_fours", { soloSurface: surface, prefer: 0.004 }),
          figure(cls.b_body, "forearms_and_knees", { soloSurface: surface, prefer: 0.004 }),
          figure(cls.b_body, "prone", { arms: "arms_forearms", soloSurface: surface, prefer: 0.006 }),
        ];
  }
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, bList],
    place: [...(aPlace ? [aPlace] : []), ...(bYaw ? [{ index: 1, yaw: bYaw }] : [])],
    fit: [{ ...refine(1, "mouth", 1, "buttocks", 0, { start: back.map((v) => v * 0.3) }), pitchRange: 20, pivot: "knee" }],
    // Behind a standing partner the hands hold the thighs; reaching up to the hip joints runs the arms into the buttocks.
    limbContacts: cls.b_hands === "hips" ? handsTo(1, 0, a.posture === "standing" ? "thigh" : "hip") : [],
    contacts: [grip("mouth", "buttocks", 1, 0, "surface")],
    checks: ["bBehind", near("b", "mouth", "a", "buttocks", 0.2)],
  };
}

/**
 * On all fours up on a table, the knees at its edge and the rear out over it,
 * facing away from a partner sitting on the chair drawn up to it, the head
 * at A's hips. B, seated, is slid in on the chair until the mouth meets them.
 */
function tableChairOralPlan(cls) {
  const a = figure(cls.a_body, "all_fours", { soloSurface: "floor", ...KNEES_APART });
  const b = ["forward_leaning", "forward_lowered", null].map((trunk, i) => figure(cls.b_body, "seated", { soloSurface: "chair", ...(trunk ? { trunk } : {}), prefer: i * 0.002 }));
  return {
    surface: "table_chair",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, b],
    place: [
      { index: 0, yaw: 180, pelvisTo: [0, null, SEATS.table_chair.z - 0.1], rest: SEATS.table_chair.top },
      { index: 1, yaw: 180, pelvisTo: [0, null, TABLE_CHAIR.z + 0.25] },
    ],
    fit: [refine(1, "mouth", 1, "buttocks", 0, { free: ["z"], start: [0, 0, 0.08] })],
    limbContacts: cls.b_hands === "hips" ? handsTo(1, 0, "hip") : [],
    contacts: [grip("mouth", "buttocks", 1, 0, "surface")],
    checks: ["sameFacing", "bBehind", near("b", "mouth", "a", "buttocks", 0.2)],
  };
}

/**
 * B upside down over A's raised rear: A on the forearms and knees, B's chest
 * draped over A's buttocks with the head hanging down behind them to A's groin,
 * the hands on the floor and the legs up in the air over A's back.
 */
function rearOralInvertedPlan(cls) {
  const a = figure(cls.a_body, "forearms_and_knees", { soloSurface: "floor", ...KNEES_APART });
  const curl = { flexion: -25 };
  const b = figure(cls.b_body, "standing", {
    soloSurface: "floor",
    jointMode: "fixed",
    joints: {
      // The arms reach down past the head to the floor, the head raised to A.
      ...both("shoulder", { flexion: 150, abduction: 25, rotation: 0 }),
      ...both("elbow", { flexion: 10 }),
      spine01: curl,
      spine02: curl,
      spine03: curl,
      neck: { flexion: 40 },
      ...legPair(30, 15, 90),
    },
  });
  return {
    surface: "floor",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, b],
    // Tipped forward past level while facing away from A, B ends chest down towards A's rear.
    place: [{ index: 1, yaw: 180, pitch: 115, pelvisTo: [0, 0.85, -0.1] }],
    fit: [
      {
        moving: 1,
        free: ["x", "y", "z"],
        pitchRange: 25,
        pivot: "pelvis",
        floor: 0,
        anchors: [{ from: "mouth", fromActor: 1, to: "groin", toActor: 0, weight: 2 }, ...floorAnchors(1, "hand", 0.6)],
      },
    ],
    contacts: [grip("mouth", "groin", 1, 0, "surface")],
    checks: ["bInverted", near("b", "mouth", "a", "groin", 0.22)],
  };
}

/** Lying face up with the head over an edge, the partner standing at the head. */
/**
 * Arched back over an exercise ball, the back across its crest and the head
 * hanging down its far side, the legs down to the feet planted behind it. The
 * partner stands or kneels at the head, the stance deepened to meet the mouth.
 */
function ballHeadOralPlan(cls) {
  const a = figure(cls.a_body, "supine", {
    soloSurface: "floor",
    override: { ...both("shoulder", { flexion: -60, abduction: 15, rotation: 0 }), ...both("elbow", { flexion: 20 }), spine01: { flexion: 12 }, spine02: { flexion: 12 }, spine03: { flexion: 12 }, neck: { flexion: 55 }, head: { flexion: 30 }, ...both("hip", { flexion: -25, abduction: 35, rotation: 0 }), ...both("knee", { flexion: 60 }) },
  });
  const b = [
    figure(cls.b_body, "standing", { soloSurface: "floor", trunk: "forward_leaning", ...stance(20, 30, 20) }),
    figure(cls.b_body, "standing", { soloSurface: "floor", trunk: "forward_leaning", ...stance(45, 30, 70), prefer: 0.002 }),
    figure(cls.b_body, "standing", { soloSurface: "floor", trunk: "forward_leaning", ...stance(65, 35, 100), prefer: 0.004 }),
    figure(cls.b_body, "kneeling", { soloSurface: "floor", prefer: 0.006 }),
  ];
  return {
    surface: "ball",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, b],
    // Head to -z and tipped up so the hips come down on the crest; B starts out of the way.
    place: [{ index: 0, yaw: 180, pitch: -30, pelvisTo: [0, 1.6, 0.05], settle: {} }, { index: 1, pelvisTo: [0, null, -2] }],
    fit: [downOnBall(0, ["foot.l", "foot.r"], "upperBack"), refine(1, "groin", 1, "mouth", 0, { start: [0, 0, -0.3] })],
    contacts: [grip("mouth", "groin", 0, 1, "surface")],
    checks: ["aFaceUp", "facingInward", near("a", "mouth", "b", "groin", 0.2)],
  };
}

function edgeHeadOralPlan(cls) {
  if (cls.surface === "ball") return ballHeadOralPlan(cls);
  const surface = { chair: "bench", sofa: "bench", floor: "bed" }[cls.surface] ?? pickSurface(cls, ["bed", "table", "bench"], "bed");
  const lengthwise = surface === "bench";
  const edge = lengthwise ? 0.7 : SEATS[surface].z;
  // The head tips back over the edge, down towards the partner's hips.
  const a = figure(cls.a_body, "supine", { ...legsOf(cls, "open_bent"), soloSurface: surface, override: { neck: { flexion: 45 }, head: { flexion: 25 } } });
  // Standing, then in wider and deeper grounded stances down to kneeling, to meet the lowered head.
  const b = [
    figure(cls.b_body, "standing", { soloSurface: "floor" }),
    figure(cls.b_body, "standing", { soloSurface: "floor", ...stance(45, 30, 70), prefer: 0.002 }),
    // Astride the head in a wide split, one knee bent forward and the other leg back.
    figure(cls.b_body, "standing", { soloSurface: "floor", joints: { hip_l: { flexion: 55, abduction: 35, rotation: 0 }, knee_l: { flexion: 70 }, hip_r: { flexion: -20, abduction: 40, rotation: 0 }, knee_r: { flexion: 25 } }, prefer: 0.003 }),
    figure(cls.b_body, "standing", { soloSurface: "floor", ...stance(65, 35, 100), prefer: 0.004 }),
    figure(cls.b_body, "kneeling", { soloSurface: "floor", prefer: 0.006 }),
  ];
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, b],
    place: [
      // The shoulders rest at the edge so the head hangs clear of it.
      lengthwise ? { index: 0, yaw: 90, anchor: "shoulders", pelvisTo: [edge + 0.01, null, 0] } : { index: 0, anchor: "shoulders", pelvisTo: [0, null, edge + 0.01] },
      { index: 1, yaw: lengthwise ? -90 : 180 },
    ],
    fit: [refine(1, "groin", 1, "mouth", 0, { start: lengthwise ? [0.3, 0, 0] : [0, 0, 0.3] })],
    contacts: [grip("mouth", "groin", 0, 1, "surface")],
    checks: ["aFaceUp", "facingInward", near("a", "mouth", "b", "groin", 0.2)],
  };
}

/**
 * Head at the hips of a partner who stands, kneels up or sits (B, index 0),
 * in the variant the notes name. A (index 1) is fitted to B, or B to A where
 * A sits and B stands over.
 */
function oralOnBPlan(cls) {
  const seatName = ["chair", "sofa", "bench", "bed", "car_seat", "swing"].includes(cls.surface) ? cls.surface : null;
  const seat = SEATS[seatName];
  // With a toy A's hand is at B's hips, the head kept a forearm's length back.
  const toy = has(cls, /toy/);
  const reach = toy ? "hand.r" : "mouth";
  const common = {
    mode: "fit",
    roles: { a: 1, b: 0 },
    soloSurface: ["floor", "floor"],
    limbContacts: toy ? [grip("hand.r", "groin", 1, 0)] : [],
    contacts: toy ? [] : [grip("mouth", "groin", 1, 0, "surface")],
    checks: ["facingInward", near("a", reach, "b", "groin", toy ? 0.12 : 0.18)],
    // `facingInward` reads role b as the one facing in; here that is A.
    facingRoles: { a: 0, b: 1 },
  };
  // Where the moving partner's landmark goes along the way A comes in (`dir`, from B).
  // With a toy only the ground position is set, a forearm's length out.
  const meet = (moving, from, to, dir) => {
    const step = refine(moving, from, moving, to, 1 - moving, { offset: toy ? dir.map((v) => v * 0.3) : [0, 0, 0], start: dir.map((v) => v * 0.3) });
    return [toy ? { ...step, anchors: [{ ...step.anchors[0], axes: [0, 2] }] } : step];
  };
  const fitA = (dir) => meet(1, "mouth", "groin", dir);

  if (has(cls, /backbend/)) {
    // A faces up with the back arched towards B, the feet planted away from B
    // and the head dropped back to B's hips: a wheel on the hands before a
    // kneeling partner, or standing bent back to a standing one's.
    const kneeling = has(cls, /partner kneeling/);
    return {
      ...common,
      surface: "floor",
      actors: [
        figure(cls.b_body, kneeling ? "kneeling" : "standing", { soloSurface: "floor" }),
        figure(cls.a_body, "standing", { soloSurface: "floor", jointMode: "fixed", joints: structuredClone(kneeling ? WHEEL : ARCH_STANDING) }),
      ],
      place: [{ index: 1, pitch: kneeling ? -80 : -45, pelvisTo: [0, null, 0.8] }],
      fit: [
        {
          moving: 1,
          free: ["x", "y", "z"],
          pitchRange: 20,
          pivot: "pelvis",
          floor: 0,
          anchors: [{ from: "mouth", fromActor: 1, to: "groin", toActor: 0, weight: 2 }, ...(kneeling ? floorAnchors(1, "hand") : []), ...floorAnchors(1, "foot")],
        },
      ],
      // Standing, the hands reach back to B's thighs.
      limbContacts: kneeling ? [] : handsTo(1, 0, "thigh").map((c) => ({ ...c, optional: true })),
      checks: ["aInverted", near("a", "mouth", "b", "groin", 0.22)],
    };
  }
  if (seat && seatName !== "chair" && seatName !== "bed" && has(cls, /seated beside/)) {
    // B sits back with the knees together; A sits beside with the legs
    // alongside B's, twisted towards B and folded down over B's lap.
    const b = seatedAt(seatName, cls.b_body, { override: { ...LEAN_BACK, ...both("hip", { abduction: 0 }) } });
    const bend = { flexion: -30, abduction: 15, rotation: -20 };
    return {
      ...common,
      surface: seatName,
      actors: [
        b.spec,
        figure(cls.a_body, "seated", {
          soloSurface: "chair",
          jointMode: "fixed",
          joints: { spine01: bend, spine02: bend, spine03: bend, neck: { flexion: -10, abduction: 0, rotation: 0 }, ...both("hip", { flexion: 90, abduction: 8, rotation: 0 }), ...both("knee", { flexion: 85 }) },
        }),
      ],
      place: [{ ...b.place, seatOn: { ...b.place.seatOn, x: -0.2 } }, { index: 1, seatOn: { top: seat.top, z: seat.z, x: 0.2 } }],
      fit: [{ ...refine(1, "mouth", 1, "groin", 0, { free: ["x"], offset: [0, 0.1, 0.08] }), yawRange: 25 }],
      limbContacts: [grip("hand.r", "thigh.l", 1, 0, "rest")],
      // The head lies on B's near thigh, the mouth by the groin.
      checks: ["facingInward", near("a", "mouth", "b", "groin", 0.28)],
    };
  }
  if (seat && seatName !== "chair" && has(cls, /lying on seat|kneel on seat/)) {
    // B sits back at one end of the seat; A lies or kneels along it, the head
    // resting on B's thigh by the hips, from the side.
    const onSeat = (posture, extra = {}) => figure(cls.a_body, posture, { soloSurface: "floor", ...extra });
    const car = seatName === "car_seat";
    return {
      ...common,
      surface: seatName,
      actors: [
        // On a car's low seat the legs stretch out into the footwell, close
        // enough together to clear the door, and A kneels folded up, the hips
        // back over the heels, to keep the feet off the other one.
        figure(cls.b_body, "seated", { soloSurface: "chair", override: { ...LEAN_BACK, ...both("hip", { abduction: car ? 10 : 22 }), ...(car ? both("knee", { flexion: 28 }) : {}) } }),
        has(cls, /kneel on seat/)
          ? [onSeat("all_fours", { joints: { ...both("elbow", { flexion: 120 }), ...(car ? { ...both("hip", { flexion: 120 }), ...both("knee", { flexion: 130 }) } : {}) } })]
          : [
              // The head raised, the lower legs up.
              onSeat("prone", { arms: "arms_sides", joints: { ...both("knee", { flexion: 70 }), spine01: { flexion: 8 }, spine02: { flexion: 8 }, spine03: { flexion: 8 }, neck: { flexion: 30 } } }),
            ],
      ],
      // A comes in at an angle from the back of the seat, the body clear of B's thigh.
      // A car's back seat is shorter, B sits nearer its middle.
      place: [{ index: 0, seatOn: { top: seat.top, z: seat.z, x: car ? -0.45 : -0.7 } }, { index: 1, yaw: -70, rest: seat.top }],
      fit: [{ ...refine(1, "mouth", 1, "groin", 0, { offset: [0.08, 0.14, 0.12], start: [0.25, 0, 0.1] }), yawRange: 20 }],
      // B's near hand rests on A's back; A's hands on B's thighs (in a car's
      // narrow space, on the near thigh and hip).
      limbContacts: [
        grip("hand.l", "upperBack", 0, 1, "rest"),
        ...(has(cls, /kneel on seat/) ? [grip("hand.l", "thigh.l", 1, 0, "rest"), grip("hand.r", car ? "hip.l" : "thigh.r", 1, 0, "rest")] : []),
      ],
      // Lying at seat height the head meets B's hip and thigh, just off the groin.
      checks: ["facingInward", near("a", "mouth", "b", "groin", 0.3)],
    };
  }
  if (seat && has(cls, /partner standing on seat/)) {
    // B stands up on the seat's front edge, knees bent wide; A stands on the floor in front.
    return {
      ...common,
      surface: seatName,
      actors: [figure(cls.b_body, "standing", { soloSurface: "floor", ...stance(45, 45, 70) }), [...kneelHeadCandidates(cls.a_body), ...stanceCandidates(cls.a_body)]],
      place: [{ index: 0, rest: seat.top, pelvisTo: [0, null, seat.z - 0.06] }, { index: 1, yaw: 180 }],
      fit: fitA([0, 0, 1]),
    };
  }
  if (has(cls, /seated giver/) && has(cls, /foot on chair/)) {
    // B stands facing a chair, one foot up on its seat and bowed over it, the
    // hands hooked over the top of its back; A sits on the floor between B and
    // the chair, the back to its seat and the knees drawn up, the head tipped
    // back up under B's raised thigh.
    const bow = { flexion: -15 };
    // Tipped 30 degrees toward the chair, the hips flex as much again to keep
    // the standing leg upright and the raised thigh level.
    const b = figure(cls.b_body, "standing", {
      soloSurface: "floor",
      override: {
        hip_l: { flexion: 125, abduction: 20, rotation: 0 },
        knee_l: { flexion: 95 },
        hip_r: { flexion: 45, abduction: 8, rotation: 0 },
        knee_r: { flexion: 5 },
        spine01: bow,
        spine02: bow,
        spine03: bow,
        neck: { flexion: -35 },
        ...both("shoulder", { flexion: 100, abduction: 15, rotation: 0 }),
        ...both("elbow", { flexion: 70, rotation: 85 }),
        ...both("wrist", { flexion: 50, abduction: -4 }),
      },
    });
    const a = figure(cls.a_body, "seated_floor", { soloSurface: "floor", joints: { ...KNEES_UP(38), neck: { flexion: 45 }, head: { flexion: 30 } } });
    // Just in front of the top of the chair's back, the hands draped over it.
    const top = [0, 0.97, -0.2];
    return {
      ...common,
      surface: "chair",
      actors: [b, a],
      place: [{ index: 0, yaw: 180, pitch: 30, rest: 0, pelvisTo: [0, null, 0.45] }, { index: 1, pelvisTo: [0, null, 1.5] }],
      fit: [
        {
          moving: 0,
          free: ["x", "y", "z"],
          floor: 0,
          anchors: [
            { from: "foot.l", fromActor: 0, point: [0, SEATS.chair.top + 0.05, 0], weight: 1, axes: [1, 2] },
            { from: "foot.r", fromActor: 0, point: [0, 0.05, 0], weight: 1, axes: [1] },
            ...["l", "r"].map((s) => ({ from: `hand.${s}`, fromActor: 0, point: top, weight: 0.3, axes: [1, 2] })),
          ],
        },
        refine(1, "mouth", 1, "groin", 0, { offset: [0, -0.05, 0], start: [0, 0, -0.1] }),
      ],
      // A faces away from B, the head tipped back under B's hips.
      checks: [near("a", reach, "b", "groin", 0.18)],
    };
  }
  if (has(cls, /seated giver/)) {
    // A sits, on the seat or on the floor leaning back, and B stands over, facing A.
    const onSeat = seat && seatName !== "bed";
    const back = cls.lean === "back" || cls.b_hands === "surface";
    const a = onSeat
      ? seatedAt(seatName, cls.a_body, {}, 1)
      : {
          spec: figure(cls.a_body, "seated_floor", {
            soloSurface: "floor",
            // Leaning back on the hands with the legs out under the partner
            // standing astride, or upright with the knees drawn up and apart.
            ...(back ? { arms: "arms_braced_behind" } : {}),
            joints: back && !has(cls, /knees drawn up/) ? { ...both("hip", { abduction: 22 }), ...both("knee", { flexion: 25 }) } : KNEES_UP(38),
          }),
          place: null,
        };
    return {
      ...common,
      surface: onSeat ? seatName : "floor",
      actors: [stanceCandidates(cls.b_body), a.spec],
      place: [{ index: 0, yaw: 180 }, ...(a.place ? [a.place] : [])],
      fit: meet(0, "groin", "mouth", [0, 0, 1]),
    };
  }
  if (has(cls, /partner kneeling|partner seated on floor/)) {
    // B kneels up (on the bed's edge, or sits back on the heels for a partner lying prone), or sits on the floor.
    const onBed = seatName === "bed";
    const b = has(cls, /partner seated on floor/)
      ? figure(cls.b_body, "seated_floor", { joints: KNEES_UP(45) })
      : has(cls, /prone/)
      ? figure(cls.b_body, "kneeling_low", { joints: both("hip", { abduction: 50 }) })
      : figure(cls.b_body, "kneeling");
    // On hands and knees with the elbows bent, the head comes down to a kneeling partner's hips.
    const lowered = figure(cls.a_body, "all_fours", { joints: both("elbow", { flexion: 80 }), prefer: has(cls, /all fours/) ? 0 : 0.002 });
    const low = toy
      ? // A toy is held out at arm's length: kneeling up or sitting back on the heels, leaning in.
        [
          figure(cls.a_body, "kneeling_low", { trunk: "forward_leaning", joints: { spine01: { flexion: -20 }, spine02: { flexion: -20 } } }),
          figure(cls.a_body, "kneeling_low", { trunk: "forward_fold", prefer: 0.002 }),
        ]
      : has(cls, /prone/)
      ? // Lying propped on the chest, the head up between the partner's knees.
        [figure(cls.a_body, "prone", { arms: "arms_forearms", joints: { ...both("knee", { flexion: 70 }), spine01: { flexion: 8 }, spine02: { flexion: 8 }, spine03: { flexion: 8 }, neck: { flexion: 30 } } })]
      : [lowered, ...lowHeadCandidates(cls.a_body)];
    return {
      ...common,
      // Lying down, the arms reach round the kneeling partner's thighs.
      ...(has(cls, /prone/) && !toy ? { limbContacts: [grip("hand.l", "thigh.r", 1, 0, "rest"), grip("hand.r", "thigh.l", 1, 0, "rest")] } : {}),
      surface: onBed ? "bed" : "floor",
      actors: [b, onBed ? kneelHeadCandidates(cls.a_body) : [...low, ...kneelHeadCandidates(cls.a_body).map((s) => ({ ...s, prefer: (s.prefer ?? 0) + 0.004 }))]],
      place: [...(onBed ? [{ index: 0, rest: seat.top, pelvisTo: [0, null, seat.z - 0.2] }] : []), { index: 1, yaw: 180 }],
      fit: fitA([0, 0, 1]),
    };
  }
  const arms = has(cls, /arms .*overhead/) ? { arms: "arms_overhead" } : {};
  let b;
  if (seatName === "chair") {
    // Slouched back in the chair, the buttocks on the seat and the shoulders on
    // the backrest, the legs open around A with the feet down, or stretched out
    // under A. Out on the edge with nothing behind the back, B would hang in
    // front of the chair on the feet alone.
    const legs = has(cls, /all fours/)
      ? { ...both("hip", { flexion: 12, abduction: 14, rotation: 0 }), ...both("knee", { flexion: 6 }) }
      : { ...both("hip", { flexion: 25, abduction: 40, rotation: 0 }), ...both("knee", { flexion: 65 }) };
    // The arms go up with the hands behind the head, clear of the seat.
    b = { spec: figure(cls.b_body, "supine", { joints: { ...structuredClone(legs), ...both("shoulder", { flexion: 150, abduction: 45 }), ...both("elbow", { flexion: 130 }) }, soloSurface: "floor", arms: "arms_overhead" }), place: { index: 0, yaw: 180, pitch: -50, pelvisTo: [0, SEATS.chair.top + 0.19, SEATS.chair.z - 0.06] } };
  }
  // Hung back in a swing's seat, the hands up on its straps.
  else if (seatName === "swing") b = seatedAt(seatName, cls.b_body, { override: structuredClone(SEATED_OPEN), trunk: "backward_leaning", arms: "arms_straps" });
  else if (seat) b = seatedAt(seatName, cls.b_body, { override: structuredClone(SEATED_OPEN) });
  else b = { spec: figure(cls.b_body, "standing", arms), place: null };
  const aList = has(cls, /all fours/)
    ? [...lowHeadCandidates(cls.a_body), ...kneelHeadCandidates(cls.a_body).map((s) => ({ ...s, prefer: (s.prefer ?? 0) + 0.006 }))]
    : kneelHeadCandidates(cls.a_body);
  return {
    ...common,
    surface: seatName ?? "floor",
    actors: [b.spec, aList],
    soloSurface: [seatName && seatName !== "chair" ? "chair" : "floor", "floor"],
    place: [...(b.place ? [b.place] : []), { index: 1, yaw: 180 }],
    fit: fitA([0, 0, 1]),
  };
}

const legPair = (flexion, abduction, knee) => ({ ...both("hip", { flexion, abduction, rotation: 0 }), ...both("knee", { flexion: knee }) });

// Arched back onto straight arms overhead, the head dropped back (for INVERTED below).
const ARCH = {
  ...both("shoulder", { flexion: 170, abduction: 10, rotation: 0 }),
  ...both("elbow", { flexion: 0 }),
  spine01: { flexion: 12 },
  spine02: { flexion: 12 },
  spine03: { flexion: 12 },
  neck: { flexion: 40 },
};

// Face up on straight arms and planted feet, posed standing and tipped back by
// the placement. The shoulder's 60° extension puts the arms straight down with
// the trunk rising 30° to the head: a reverse tabletop with the thighs about
// level, or a crab with the hips low and the knees drawn up either side of a
// partner lying underneath.
const FACE_UP_ON_HANDS = { ...both("shoulder", { flexion: -60, abduction: 10, rotation: 0 }), ...both("elbow", { flexion: 0 }), neck: { flexion: -15 } };
const TABLETOP = { ...FACE_UP_ON_HANDS, ...legPair(30, 20, 90) };
const CRAB = { ...FACE_UP_ON_HANDS, ...legPair(60, 35, 110) };
// A wheel as far as the joints bend: arched on the arms overhead, the thighs
// about level from the raised hips and the shins down to the planted feet.
const WHEEL = { ...ARCH, ...both("shoulder", { flexion: 170, abduction: 25, rotation: 0 }), ...legPair(-25, 25, 100) };
// Standing bent back from the knees, the hands on the partner's thighs.
const ARCH_STANDING = { ...ARCH, ...both("shoulder", { flexion: 60, abduction: 30, rotation: 0 }), ...both("elbow", { flexion: 30 }), ...legPair(-25, 20, 70) };
const floorAnchors = (actor, part, weight = 0.5, top = 0) => ["l", "r"].map((s) => ({ from: `${part}.${s}`, fromActor: actor, point: [0, top + 0.03, 0], weight, axes: [1] }));
/**
 * Upside-down shapes, posed standing with the joints held and turned over by
 * the placement. Positive spine flexion arches back and positive neck flexion
 * lifts the chin; the thighs flex towards the face.
 */
const INVERTED = {
  // On the upper back, the arms out along the floor and the chin tucked.
  shoulders: {
    body: { ...both("shoulder", { flexion: -30, abduction: 75, rotation: 0 }), ...both("elbow", { flexion: 10 }), neck: { flexion: -45 }, head: { flexion: -25 } },
    legs: {
      raised: legPair(60, 25, 10),
      straight: legPair(30, 15, 5),
      straight_apart: legPair(30, 60, 5),
      // Over a kneeling partner's shoulders, wide enough for the arms that
      // reach under them to the hips.
      on_shoulders: legPair(30, 21, 5),
      open_bent: legPair(60, 40, 90),
      wrapped: legPair(45, 45, 95),
      over: legPair(115, 20, 10),
    },
  },
  // On the head and the bent arms, the forearms flat on the floor.
  head: {
    body: { ...both("shoulder", { flexion: 140, abduction: 35, rotation: 0 }), ...both("elbow", { flexion: 120 }) },
    legs: {
      raised: legPair(15, 30, 10),
      straight: legPair(10, 15, 5),
      straight_apart: legPair(60, 65, 5),
      on_shoulders: legPair(40, 20, 5),
      open_bent: legPair(45, 40, 90),
      wrapped: legPair(70, 45, 95),
    },
  },
  // Arched back, the hips at a standing partner's: the thighs about the
  // waist or up to the shoulders.
  arch: {
    body: ARCH,
    legs: {
      raised: legPair(45, 15, 10),
      on_shoulders: legPair(45, 15, 10),
      straight: legPair(-10, 25, 5),
      straight_apart: legPair(-10, 40, 5),
      open_bent: legPair(0, 40, 90),
      wrapped: legPair(-15, 40, 95),
      one_raised: { hip_l: { flexion: 45, abduction: 15, rotation: 0 }, knee_l: { flexion: 10 }, hip_r: { flexion: -15, abduction: 30, rotation: 0 }, knee_r: { flexion: 95 } },
    },
  },
  // The same at a kneeling partner's hips, the pelvis tipped up towards them:
  // the legs up past the shoulders, out past the hips, or the feet planted either side.
  archLow: {
    body: ARCH,
    legs: {
      raised: legPair(100, 15, 10),
      on_shoulders: legPair(100, 15, 10),
      straight: legPair(10, 30, 5),
      straight_apart: legPair(10, 45, 5),
      open_bent: legPair(0, 40, 130),
      wrapped: legPair(0, 40, 130),
    },
  },
};

const invertedFigure = (body, shape, legs) =>
  figure(body, "standing", {
    soloSurface: "floor",
    jointMode: "fixed",
    joints: { ...structuredClone(INVERTED[shape].body), ...structuredClone(INVERTED[shape].legs[legs] ?? INVERTED[shape].legs.raised) },
  });

/**
 * A on the upper back with the hips raised high (a piledriver), B astride
 * A's back facing A's head, the legs raised past B's front or over A's head:
 * crouched, or kneeling with A's back against the thighs and the legs up B's
 * chest. A then tips about the shoulders to bring the hips to B's. Seated, B
 * is on the sofa edge with A's hips in the lap, A's shoulders on the floor in
 * front.
 */
function piledriverPlan(cls) {
  // A kneeling or seated partner is lower: A's back leans on their thighs, the hips tipped less far over.
  const kneeling = has(cls, /partner kneeling/);
  const low = kneeling || has(cls, /partner seated/);
  const legs = has(cls, /over (her|his) head/) ? "over" : low && /^(raised|straight)$/.test(cls.a_legs) ? "on_shoulders" : cls.a_legs;
  const a = invertedFigure(cls.a_body, "shoulders", legs);
  const tip = { ...refine(0, "groin", 0, "groin", 1), pitchRange: 30, pivot: "shoulders" };
  const common = {
    mode: "fit",
    roles: { a: 0, b: 1 },
    // B's hands on A's thighs, or where the record puts them.
    limbContacts: bHands(cls, 1, 0, { fallback: "legs" }).map((c) => ({ ...c, optional: true })),
    contacts: [grip("groin", "groin", 1, 0, "surface")],
    checks: ["aInverted", near("b", "groin", "a", "groin", 0.25)],
  };
  if (has(cls, /partner seated/)) {
    // B leans back with the knees wide, A's trunk dropping between them to the floor.
    const b = seatedAt("sofa", cls.b_body, { override: { ...LEAN_BACK, ...both("hip", { abduction: 50 }) } }, 1);
    return {
      ...common,
      surface: "sofa",
      actors: [a, b.spec],
      place: [{ index: 0, yaw: 180, pitch: -135, rest: 0 }, b.place],
      fit: [{ ...tip, free: ["z"] }],
      limbContacts: handsTo(1, 0, "hip", false).map((c) => ({ ...c, optional: true })),
    };
  }
  const surface = lying(cls, "floor");
  // Crouched astride, B sinks low over A's back on bent knees, unless A's
  // legs are split out low, which leaves the hips at a standing partner's.
  const crouched = has(cls, /crouched/) && cls.a_legs !== "straight_apart";
  // Leaning forward, B bows over A's raised hips, lower still to put the hands down.
  const b = leanIn(
    cls,
    kneeling
      ? [
          figure(cls.b_body, "kneeling", { soloSurface: surface }),
          figure(cls.b_body, "kneeling_low", { soloSurface: surface, override: both("hip", { abduction: 25 }), prefer: 0.002 }),
          figure(cls.b_body, "squatting", { soloSurface: surface, prefer: 0.003 }),
          figure(cls.b_body, "all_fours", { soloSurface: surface, override: both("hip", { abduction: 25 }), prefer: 0.004 }),
        ]
      : crouched
        ? [
            figure(cls.b_body, "standing", { soloSurface: surface, ...stance(65, 35, 100) }),
            figure(cls.b_body, "standing", { soloSurface: surface, ...stance(45, 30, 70), prefer: 0.001 }),
            figure(cls.b_body, "squatting", { soloSurface: surface, prefer: 0.002 }),
          ]
        : [...stanceCandidates(cls.b_body, { soloSurface: surface }), figure(cls.b_body, "squatting", { soloSurface: surface, prefer: 0.004 })],
    cls.b_hands === "surface" ? "forward_lowered" : "forward_leaning"
  );
  return {
    ...common,
    surface,
    actors: [a, b],
    place: [{ index: 0, pitch: kneeling ? -120 : -150, rest: surfaceTop(surface) }, { index: 1, yaw: 180 }],
    fit: kneeling
      ? [refine(1, "groin", 1, "groin", 0, { start: [0, 0, 0.25], free: ["z"] })]
      : [refine(1, "groin", 1, "groin", 0, { start: [0, 0, 0.05] }), { ...tip, free: [] }],
  };
}

/** A on the head and forearms, B standing (or kneeling, the mouth at A's hips) against A's front. */
function headstandPlan(cls) {
  const oral = has(cls, /face at/);
  const at = oral ? "mouth" : "groin";
  const b = oral
    ? kneelHeadCandidates(cls.b_body)
    : leanIn(cls, [...stanceCandidates(cls.b_body), figure(cls.b_body, "standing", { soloSurface: "floor", joints: both("ankle", { flexion: 30 }), prefer: 0.003 })]);
  return {
    surface: "floor",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [invertedFigure(cls.a_body, "head", cls.a_legs), b],
    place: [{ index: 0, pitch: 180, rest: 0 }],
    fit: [refine(1, at, 1, "groin", 0, { start: [0, 0, -0.1] })],
    limbContacts: oral ? [] : bHands(cls, 1, 0, { face: false }),
    contacts: [grip(at, "groin", 1, 0, "surface")],
    checks: ["aInverted", ...(oral ? [] : ["bUpright"]), near("b", at, "a", "groin", 0.25)],
  };
}

/**
 * A arched back from B's hips onto the hands, the head down away from B, who
 * stands or kneels up facing A's head. Level with a kneeling partner the
 * pelvis tips up towards them; a full bridge or bent knees plant the feet too.
 */
function backbendPlan(cls) {
  if (has(cls, /face at/)) return backbendOralPlan(cls);
  const standing = has(cls, /partner standing/);
  const shape = standing ? "arch" : "archLow";
  const legs = has(cls, /bridge/) ? "wrapped" : cls.a_legs;
  const planted = !standing && (legs === "wrapped" || legs === "open_bent");
  return {
    surface: "floor",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [invertedFigure(cls.a_body, shape, legs), figure(cls.b_body, standing ? "standing" : "kneeling", { soloSurface: "floor" })],
    place: [{ index: 0, pitch: standing ? -96 : -60, rest: 0 }, { index: 1, yaw: 180, pelvisTo: [0, null, 0.6] }],
    fit: [
      {
        moving: 0,
        free: ["y", "z"],
        pitchRange: 40,
        pivot: "pelvis",
        floor: 0,
        start: [0, 0, -0.1],
        anchors: [
          { from: "groin", fromActor: 0, to: "groin", toActor: 1, weight: 2 },
          ...["l", "r"].map((s) => ({ from: `hand.${s}`, fromActor: 0, point: [0, 0.03, 0], weight: 0.6, axes: [1] })),
          ...(planted ? ["l", "r"].map((s) => ({ from: `foot.${s}`, fromActor: 0, point: [0, 0.05, 0], weight: 0.3, axes: [1] })) : []),
        ],
      },
    ],
    limbContacts: bHands(cls, 1, 0),
    contacts: [grip("groin", "groin", 1, 0, "surface")],
    checks: ["aInverted", near("b", "groin", "a", "groin", 0.22)],
  };
}

/**
 * The backbend lifted to B's mouth: A upside down on the hands with the hips
 * at the face of a partner kneeling back on the heels, or sitting on the
 * sofa's edge. B's hands hold A's thighs, or where the record puts them.
 */
function backbendOralPlan(cls) {
  const seated = has(cls, /partner seated/);
  const legs = cls.a_legs === "on_shoulders" ? "hooked" : cls.a_legs === "one_raised" ? "one" : "up";
  // Tipped over, a thigh straight at the hip points at B: the knees bend
  // down behind B's shoulders, or the legs kick up past B's head, or one
  // leg goes over a shoulder with A standing on the other.
  const LEGS = {
    hooked: legPair(20, 30, 90),
    up: legPair(60, 20, 70),
    one: { hip_l: { flexion: 100, abduction: 15, rotation: 0 }, knee_l: { flexion: 60 }, hip_r: { flexion: -20, abduction: 10, rotation: 0 }, knee_r: { flexion: 10 } },
  };
  const a = figure(cls.a_body, "standing", {
    soloSurface: "floor",
    jointMode: "fixed",
    joints: { ...structuredClone(ARCH), ...LEGS[legs] },
  });
  const b = seated
    ? seatedAt("sofa", cls.b_body, { override: { ...both("hip", { abduction: 30 }), ...both("knee", { flexion: 80 }) } }, 1)
    : {
        spec: [
          // Leaning in over the knees spread wider, lower to meet a partner on the feet.
          figure(cls.b_body, "kneeling_low", { soloSurface: "floor", ...(legs === "one" ? { trunk: "forward_leaning" } : {}), override: both("hip", { abduction: legs === "one" ? 40 : 30 }) }),
          figure(cls.b_body, "kneeling", { soloSurface: "floor", trunk: "forward_leaning", prefer: 0.002 }),
        ],
        place: { index: 1, yaw: 180, pelvisTo: [0, null, 0.6] },
      };
  return {
    surface: seated ? "sofa" : "floor",
    mode: "fit",
    roles: { a: 0, b: 1 },
    actors: [a, b.spec],
    // Kneeling, B faces -z with A's head beyond; seated, B faces +z off the seat's front.
    place: [{ index: 0, ...(seated ? { yaw: 180 } : {}), pitch: legs === "one" ? -70 : -100, rest: 0, pelvisTo: [0, null, seated ? 0.9 : 0] }, b.place],
    fit: [
      {
        moving: 0,
        free: ["y", "z"],
        pitchRange: 40,
        pivot: "pelvis",
        floor: 0,
        start: [0, 0, seated ? 0.1 : -0.1],
        anchors: [
          { from: "groin", fromActor: 0, to: "mouth", toActor: 1, weight: 2 },
          ...["l", "r"].map((s) => ({ from: `hand.${s}`, fromActor: 0, point: [0, 0.03, 0], weight: legs === "one" ? 0.3 : 0.6, axes: [1] })),
          ...(legs === "one" ? [{ from: "foot.r", fromActor: 0, point: [0, 0.03, 0], weight: 0.6, axes: [1] }] : []),
        ],
      },
    ],
    // Legs kicked up put the thighs over B's head: the hands hold the waist.
    limbContacts: (legs === "up" ? handsToCentre(1, 0, "abdomen") : bHands(cls, 1, 0, { fallback: "legs" })).map((c) => ({ ...c, optional: true })),
    contacts: [grip("mouth", "groin", 1, 0, "surface")],
    checks: ["aInverted", near("b", "mouth", "a", "groin", 0.22)],
  };
}

export const TEMPLATES = {
  supine_stack: {
    label: "Both face up, one lying back on the other",
    plan(cls) {
      const surface = lying(cls, "floor");
      return {
        surface,
        mode: "fit",
        roles: { a: 1, b: 0 },
        // B lies on the surface; A lies back along B's front, pelvis on B's pelvis.
        actors: [
          figure(cls.b_body, "supine", { soloSurface: surface, override: both("hip", { abduction: 16 }) }),
          figure(cls.a_body, "supine", { ...legsOf(cls, "straight"), soloSurface: surface }),
        ],
        fit: [
          refine(1, "buttocks", 1, "groin", 0, {
            free: ["x", "y", "z"],
            keep: false,
            floor: surfaceTop(surface),
            extra: [{ from: "upperBack", fromActor: 1, to: "chest", toActor: 0, weight: 0.4 }],
          }),
        ],
        limbContacts: cls.b_hands === "legs" ? handsTo(0, 1, "thigh") : handsToCentre(0, 1, "abdomen"),
        contacts: [grip("buttocks", "groin", 1, 0, "surface")],
        checks: ["aFaceUp", "bFaceUp", "sameHeading", "aAboveOrLevel", near("a", "buttocks", "b", "groin", 0.2)],
      };
    },
  },
  rear_oral: { label: "Head at the partner's hips from behind", plan: rearOralPlan },
  edge_head_oral: { label: "Head over the edge, partner standing at the head", plan: edgeHeadOralPlan },
  missionary: { label: "Face to face, one partner above", plan: (cls) => faceToFaceLying(cls, "prone") },
  prone_on_top: { label: "Lying flat, chest to chest", plan: (cls) => faceToFaceLying(cls, "prone", { legs: "straight" }) },
  kneeling_missionary: {
    label: "Face to face, kneeling between the legs",
    plan(cls) {
      if (cls.surface === "car_seat") return carSeatLyingPlan(cls);
      if (cls.surface === "wedge" || cls.surface === "ramp") return wedgeLyingPlan(cls);
      const surface = lying(cls, "floor");
      const legs = cls.a_legs === "straight" ? "open_bent" : cls.a_legs ?? "raised";
      if (has(cls, /\bside\b/)) {
        const kneel = (lean, abduction) =>
          ["kneeling", "kneeling_low"].map((posture, i) =>
            figure(cls.b_body, posture, { ...trunkOf(lean), soloSurface: surface, override: both("hip", { abduction }), prefer: i * 0.004 }));
        // Knees drawn up together to the front: B kneels behind the thighs,
        // facing them. Legs out straight, B kneels behind the buttocks the same way.
        if (cls.a_legs === "together_bent" || cls.a_legs === "straight")
          return {
            surface,
            mode: "fit",
            roles: { a: 0, b: 1 },
            actors: [
              figure(cls.a_body, "side_lying", {
                soloSurface: surface,
                joints: cls.a_legs === "straight" ? { ...both("hip", { flexion: 15, abduction: 0, rotation: 0 }), ...both("knee", { flexion: 8 }) } : { ...both("hip", { flexion: 88, abduction: 0, rotation: 0 }), ...both("knee", { flexion: 95 }) },
              }),
              kneel(cls.lean === "forward" ? "forward" : null, 30),
            ],
            place: [{ index: 1, yaw: 90 }],
            fit: [refine(1, "groin", 1, "buttocks", 0, { start: [-0.35, 0, 0] })],
            limbContacts: handsTo(1, 0, "hip").map((c) => ({ ...c, optional: true })),
            contacts: [grip("groin", "buttocks", 1, 0, "surface")],
            checks: ["bUpright", near("b", "groin", "a", "buttocks", 0.25)],
          };
        // On one side, the lower leg straight and the upper one raised against
        // B's chest; B kneels astride the lower leg, facing A's head. With both
        // legs raised the lower one lifts too. B's hands go to the raised thigh
        // and the hip, or both to the hips.
        const upper = { hip_l: { flexion: 115, abduction: 45, rotation: 0 }, knee_l: { flexion: 12 } };
        const lower = cls.a_legs === "raised" ? { hip_r: { flexion: 90, abduction: 0, rotation: 0 }, knee_r: { flexion: 10 } } : { hip_r: { flexion: 8, abduction: 0, rotation: 0 }, knee_r: { flexion: 8 } };
        return {
          surface,
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [
            figure(cls.a_body, "side_lying", { soloSurface: surface, joints: { ...upper, ...lower } }),
            kneel(null, 18),
          ],
          fit: [refine(1, "groin", 1, "groin", 0, { start: [0, 0, -0.35] })],
          limbContacts: (cls.b_hands === "hips" ? [grip("hand.l", "hip.l", 1, 0), grip("hand.r", "waist", 1, 0)] : [grip("hand.l", "thigh.l", 1, 0), grip("hand.r", "hip.l", 1, 0)]).map((c) => ({ ...c, optional: true })),
          contacts: [grip("groin", "groin", 1, 0, "surface")],
          checks: ["bUpright", near("b", "groin", "a", "groin", 0.25)],
        };
      }
      // On the bed with the shoulders at its edge, the head hanging back over it.
      const overEdge = surface === "bed" && has(cls, /head over edge/);
      // Leaning well over A, B bends forward and may tip on from the knees, as
      // far as A's legs leave room; hands on the surface reach down to it. Legs
      // raised against B fold back towards A's chest, B's arms going wide of them.
      const forward = cls.lean === "forward";
      const legsUp = forward && (legs === "raised" || legs === "on_shoulders");
      const reach = cls.b_hands === "surface" ? { arms: "arms_forward", override: { ...both("hip", { abduction: 6 }), ...(legsUp ? both("shoulder", { abduction: 30 }) : {}) } } : { override: both("hip", { abduction: 6 }) };
      // Hips raised: A's hips come right up onto the thighs of B kneeling upright, the shoulders left on the floor.
      const hipsUp = has(cls, /hips raised/);
      // Leaning back instead, B props up on the hands planted behind.
      const back = cls.lean === "back" && cls.b_hands === "behind";
      const bList = hipsUp
        ? [figure(cls.b_body, "kneeling", { soloSurface: surface, override: both("hip", { abduction: 6 }) })]
        : back
        ? ["kneeling_low", "kneeling"].map((posture, i) => figure(cls.b_body, posture, { soloSurface: surface, trunk: "backward_leaning", arms: "arms_braced_behind", override: both("hip", { abduction: 6 }), prefer: i * 0.004 }))
        : forward
        ? [
            figure(cls.b_body, "kneeling", { soloSurface: surface, trunk: "forward_lowered", ...reach }),
            figure(cls.b_body, "kneeling", { soloSurface: surface, trunk: "forward_leaning", override: both("hip", { abduction: 6 }), prefer: 0.004 }),
            figure(cls.b_body, "kneeling_low", { soloSurface: surface, trunk: "forward_leaning", override: both("hip", { abduction: 6 }), prefer: 0.008 }),
          ]
        : ["kneeling", "kneeling_low"].map((posture, i) => figure(cls.b_body, posture, { soloSurface: surface, override: both("hip", { abduction: 6 }), prefer: i * 0.004 }));
      return {
        surface,
        mode: "fit",
        roles: { a: 0, b: 1 },
        // B kneels at A's feet facing A's head and slides in between A's knees.
        actors: [
          figure(cls.a_body, "supine", {
            soloSurface: surface,
            override: {
              ...structuredClone(LEG_SHAPES[legs]),
              ...(legsUp ? both("hip", { flexion: 125, abduction: LEG_SHAPES[legs].hip_l.abduction, rotation: 0 }) : {}),
              // Raised in a wide V, B holding them apart.
              ...(legs === "raised" && has(cls, /\bV\b/) ? both("hip", { flexion: 110, abduction: 38, rotation: 0 }) : {}),
              ...(overEdge ? { neck: { flexion: 45 }, head: { flexion: 25 } } : {}),
              // The chin tucks so the head stays clear of the floor as the hips rise.
              ...(hipsUp ? { neck: { flexion: -45 }, head: { flexion: -30 } } : {}),
            },
          }),
          bList,
        ],
        ...(overEdge ? { place: [{ index: 0, anchor: "shoulders", pelvisTo: [0, null, SEATS.bed.z + 0.01] }] } : {}),
        // Then A's hips tilt up onto B's thighs, pivoting at the shoulders.
        fit: [
          { ...refine(1, "groin", 1, "groin", 0, { start: [0, 0, -0.35] }), ...(forward ? { pitchRange: [0, 25], pivot: "knee" } : {}) },
          // (The hanging head is below the bed top; the bed itself still holds the body up.)
          { moving: 0, free: hipsUp ? ["z"] : [], keep: false, floor: overEdge ? null : surfaceTop(surface), pitchRange: hipsUp ? 50 : 24, pivot: hipsUp ? "neck" : "upperBack", anchors: [{ from: "groin", fromActor: 0, to: "groin", toActor: 1, offset: [0, 0, 0], weight: 1 }] },
        ],
        // Folded legs are in the way of an embrace: the arms go round them instead.
        limbContacts: bHands(legsUp && cls.b_hands === "embrace" ? { ...cls, b_hands: "legs" } : cls, 1, 0, { fallback: legs === "raised" || legs === "on_shoulders" ? "legs" : "hips" }),
        contacts: [grip("groin", "groin", 1, 0, "surface")],
        checks: ["aFaceUp", forward ? "bAbove" : "bUpright", "facingInward", near("b", "groin", "a", "groin", 0.25)],
      };
    },
  },
  edge_missionary: {
    label: "At the edge, partner in front between the legs",
    plan(cls) {
      if (cls.surface === "ball") return ballBackPlan(cls, cls.a_legs ?? "raised");
      const surface = pickSurface(cls, ["bed", "sofa", "table", "bench", "chair", "car_seat"], "bed");
      return edgePlan(cls, surface, "supine", { legs: cls.a_legs ?? "raised", lean: cls.lean });
    },
  },
  edge_seated_facing: {
    label: "Seated on an edge, partner in front between the legs",
    plan(cls) {
      const surface = pickSurface(cls, ["table", "bed", "sofa", "chair", "bench", "car_seat", "ball", "swing"], "table");
      // Or kneeling up at the bed's edge, face to face with a partner standing on the floor.
      if (surface === "bed" && has(cls, /kneeling on the bed/))
        return {
          surface,
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [figure(cls.a_body, "kneeling", { soloSurface: "floor" }), stanceCandidates(cls.b_body)],
          place: [{ index: 0, rest: SEATS.bed.top, pelvisTo: [0, null, SEATS.bed.z - 0.12] }, { index: 1, yaw: 180 }],
          fit: [refine(1, "groin", 1, "groin", 0, { start: [0, 0, 0.3] })],
          limbContacts: [...(cls.b_hands === "embrace" ? handsToCentre(1, 0, "back") : handsTo(1, 0, "hip", true)), ...handsTo(0, 1, "shoulder", true)],
          contacts: [grip("groin", "groin", 1, 0, "surface")],
          checks: ["faceToFace", "aUpright", "bUpright", near("b", "groin", "a", "groin", 0.2)],
        };
      return edgePlan(cls, surface, "seated", { legs: cls.a_legs ?? "wrapped", lean: cls.lean });
    },
  },
  cowgirl: { label: "Astride, facing the partner lying down", plan: (cls) => (cls.surface === "ball" ? ballBridgePlan(cls, { facing: true }) : straddlePlan(cls, "kneeling_straddle", 0)) },
  squat_cowgirl: { label: "Squatting astride, facing the partner", plan: (cls) => straddlePlan(cls, "squatting", 0) },
  reverse_cowgirl: { label: "Astride, facing the partner's feet", plan: (cls) => (cls.surface === "ball" ? ballBridgePlan(cls) : straddlePlan(cls, "kneeling_straddle", 180)) },
  sixty_nine: {
    label: "Head to toe",
    plan(cls) {
      const surface = lying(cls);
      const side = /\bside\b/.test(cls.notes ?? "");
      const both69 = { extra: [{ from: "groin", fromActor: 1, to: "mouth", toActor: 0, weight: 1 }] };
      // Both on the right side facing each other, head to toe: B turned round
      // on A's front side. The upper leg is raised and bent so the partner's
      // head lies between the thighs, the lower arm is up under the head and
      // the upper hand holds the partner's buttocks.
      const sideShape = {
        joints: {
          hip_l: { flexion: 60, abduction: 45, rotation: 0 },
          knee_l: { flexion: 90 },
          hip_r: { flexion: 0, abduction: 0, rotation: 0 },
          knee_r: { flexion: 5 },
          shoulder_r: { flexion: 148, abduction: 22 },
          elbow_r: { flexion: 92 },
        },
      };
      if (side)
        return {
          surface,
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [figure(cls.a_body, "side_lying", structuredClone(sideShape)), figure(cls.b_body, "side_lying", structuredClone(sideShape))],
          place: [{ index: 1, yaw: 180 }],
          fit: [refine(1, "mouth", 1, "groin", 0, { start: [0.2, 0, 0], ...both69 })],
          limbContacts: [grip("hand.l", "buttocks", 1, 0, "rest"), grip("hand.l", "buttocks", 0, 1, "rest")],
          contacts: [grip("mouth", "groin", 1, 0, "surface"), grip("groin", "mouth", 1, 0, "surface")],
          checks: ["reversed", "faceToFaceHorizontal", near("b", "mouth", "a", "groin", 0.25), near("a", "mouth", "b", "groin", 0.3)],
        };
      // Held upside down against a seated partner's front, face to face: B holds
      // A by the waist, A's hips up at B's face, the thighs over B's shoulders and
      // the shins up behind B's head, A's hands on B's shins and the head hanging
      // free between B's knees. A headstand on the seat's edge or in B's lap,
      // nobody holding anybody, would leave A's whole weight on the head.
      if (has(cls, /inverted/) && has(cls, /seated/)) {
        const seatName = cls.surface && cls.surface !== "floor" && SEATS[cls.surface] ? cls.surface : null;
        const wide = (cls.a_pose ?? []).includes("legs_wide");
        const holding = { ...both("hip", { flexion: 80, abduction: 35, rotation: 0 }), ...both("knee", { flexion: 50 }) };
        const b = seatName
          ? seatedAt(seatName, cls.b_body, { override: holding }, 1)
          : { spec: figure(cls.b_body, "seated_floor", { soloSurface: "floor", override: { ...legPair(97, 30, 6), ...both("shoulder", { flexion: 15, abduction: 30, rotation: 0 }), ...both("elbow", { flexion: 10 }) } }), place: { index: 1, rest: 0 } };
        return {
          surface: seatName ?? "floor",
          mode: "fit",
          roles: { a: 0, b: 1 },
          apart: wide ? ["a"] : [],
          actors: [figure(cls.a_body, "standing", { soloSurface: "floor", override: legPair(95, wide ? 42 : 30, 95) }), b.spec],
          place: [b.place, { index: 0, yaw: 0, pitch: 180, pelvisTo: [0, 1, (seatName ? SEATS[seatName].z : 0) + 0.3] }],
          fit: [{ ...refine(0, "groin", 0, "mouth", 1, { free: ["x", "y", "z"], keep: false, floor: 0, extra: [{ from: "mouth", fromActor: 0, to: "groin", toActor: 1, weight: 1 }] }), pitchRange: 35, pivot: "groin" }],
          limbContacts: [...handsTo(1, 0, "hip", false), ...handsTo(0, 1, "knee", false)],
          contacts: [grip("mouth", "groin", 1, 0, "surface"), grip("groin", "mouth", 1, 0, "surface")],
          checks: ["aInverted", near("b", "mouth", "a", "groin", 0.25), near("a", "mouth", "b", "groin", 0.35)],
        };
      }
      // Held upside down against the partner's front, face to face: B standing
      // with A lifted clear of the floor, or kneeling up with A's shoulders on the
      // floor between the knees and the hips raised to B's bowed head.
      if (has(cls, /standing|inverted/)) {
        const standing = has(cls, /standing/);
        return {
          surface: "floor",
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: standing
            ? [figure(cls.a_body, "inverted", { soloSurface: "floor", override: both("hip", { abduction: 30 }) }), figure(cls.b_body, "standing", { soloSurface: "floor" })]
            : [
                figure(cls.a_body, "inverted", { soloSurface: "floor", override: both("hip", { abduction: 20 }) }),
                [
                  figure(cls.b_body, "kneeling", { trunk: "forward_lowered", soloSurface: "floor" }),
                  figure(cls.b_body, "kneeling", { override: both("hip", { flexion: 55, abduction: 8 }), tilt: 55, soloSurface: "floor", prefer: 0.002 }),
                  figure(cls.b_body, "kneeling_low", { override: both("hip", { abduction: 12 }), tilt: 40, soloSurface: "floor", prefer: 0.004 }),
                ],
              ],
          // The inverted pose lies tipped along the floor; lifted, A hangs upright.
          // Kneeling, B has A stood a little further up on the shoulders: tipped
          // as posed, the hips and legs reach out past them and hang on B's hands.
          place: standing ? [{ index: 0, pitch: 60 }, { index: 1, yaw: 180, pelvisTo: [0, null, 0.3] }] : [{ index: 0, pitch: -15, rest: 0 }, { index: 1, yaw: 180 }],
          fit: standing
            ? [refine(0, "groin", 0, "mouth", 1, { free: ["x", "y", "z"], keep: false, extra: [{ from: "mouth", fromActor: 0, to: "groin", toActor: 1, weight: 1 }] })]
            : [{ ...refine(1, "mouth", 1, "groin", 0, { start: [0, 0, 0.3], ...both69 }), pitchRange: 25, pivot: "knee" }],
          limbContacts: standing ? handsToCentre(1, 0, "lowerBack") : handsTo(1, 0, "hip", false),
          contacts: [grip("mouth", "groin", 1, 0, "surface"), grip("groin", "mouth", 1, 0, "surface")],
          checks: ["aInverted", ...(standing ? ["aOffGround"] : []), near("b", "mouth", "a", "groin", 0.25), near("a", "mouth", "b", "groin", standing ? 0.3 : 0.45)],
        };
      }
      // B above A, head to toe: on the hands and knees, or lying full length on
      // A. The knees spread astride A's head to lower the hips, and wider round
      // A's shoulders where A's legs are up and B comes further up A; A lifts
      // the head to meet them. The spread is set before the solve so the knees
      // stay on the ground. On the hands, the elbows bend and the head drops to reach
      // down between A's thighs, and leaning forward they bend further to bring
      // the chest down along A.
      const reachDown = (abduction) => ({ ...both("hip", { flexion: 80, abduction, rotation: 15 }), ...both("knee", { flexion: 65 }), ...both("elbow", { flexion: cls.lean === "forward" ? 110 : 85, rotation: 5 }), ...both("shoulder", { flexion: 55, abduction: 38 }), neck: { flexion: -45 }, head: { flexion: -30 } });
      const onTop = has(cls, /lying on top/);
      const top = onTop
        ? figure(cls.b_body, "prone", { soloSurface: surface, arms: "arms_forearms" })
        : figure(cls.b_body, "all_fours", { joints: reachDown((cls.a_pose ?? []).includes("legs_up") ? 48 : 38), soloSurface: surface });
      // On the hands and knees, the knees come down to the surface: met mouth to
      // groin and nothing else, B can end up borne on A alone with the knees
      // hovering either side of A's head.
      const kneesDown = onTop ? [] : ["l", "r"].map((s) => ({ from: `knee.${s}`, fromActor: 1, point: [0, surfaceTop(surface) + 0.05, 0], weight: 0.5, axes: [1] }));
      const plan = {
        surface,
        mode: "fit",
        roles: { a: 0, b: 1 },
        actors: [figure(cls.a_body, "supine", { ...legsOf(cls, "open_bent"), soloSurface: surface, override: { spine03: { flexion: -12 }, neck: { flexion: -40 }, head: { flexion: -20 } } }), top],
        place: [{ index: 1, yaw: 180 }],
        fit: [{ ...refine(1, "mouth", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: surfaceTop(surface), start: [0, 0.15, 0], extra: [...both69.extra, ...kneesDown] }), pitchRange: 15 }],
        // A's hands hold B's thighs, which also keeps A's arms out from under
        // B's hands, unless the record says where A's arms go.
        limbContacts: (cls.a_pose ?? []).some((name) => name.startsWith("arms_")) ? [] : handsTo(0, 1, "thigh"),
        contacts: [grip("mouth", "groin", 1, 0, "surface"), grip("groin", "mouth", 1, 0, "surface")],
        checks: ["reversed", near("b", "mouth", "a", "groin", 0.25), near("a", "mouth", "b", "groin", 0.3)],
      };
      // Where B's knees come down beside A's shoulders, B's thighs rise straight
      // over them, too close for A's hands to reach without driving the elbows
      // into the floor: A's arms then lie along its sides, the hands resting on
      // whatever is beside them.
      return plan.limbContacts.length ? { ...plan, retry: { ...plan, limbContacts: [] } } : plan;
    },
  },
  side_facing: {
    label: "Side by side, face to face",
    plan(cls) {
      return {
        surface: lying(cls),
        mode: "fit",
        roles: { a: 0, b: 1 },
        // A's upper leg drapes over B's hip, or with no leg shape given both
        // lie straight along B's; B's legs slide between A's.
        // B is the mirror image, lying on the other side facing A.
        actors: [
          figure(cls.a_body, "side_lying", {
            soloSurface: lying(cls),
            override: {
              ...(cls.a_legs == null || cls.a_legs === "straight" ? { hip_top: { flexion: 20, abduction: 12, rotation: 0 }, knee_top: { flexion: 10 } } : { hip_top: { flexion: 80, abduction: 42, rotation: 0 }, knee_top: { flexion: 70 } }),
              hip_bottom: { flexion: 0, abduction: 0 },
              knee_bottom: { flexion: 5 },
            },
          }),
          figure(cls.b_body, "side_lying", { soloSurface: lying(cls), override: { hip_top: { flexion: 20, abduction: 0 }, knee_top: { flexion: 20 }, hip_bottom: { flexion: 0, abduction: 0 }, knee_bottom: { flexion: 5 } } }),
        ],
        place: [{ index: 0, rest: surfaceTop(lying(cls)) }, { index: 1, mirror: true, rest: surfaceTop(lying(cls)), alignTo: { from: "groin", to: "groin", actor: 0, axes: [0, 2], offset: [0.3, 0, 0] } }],
        fit: [refine(1, "groin", 1, "groin", 0, { snap: false, extra: [{ from: "chest", fromActor: 1, to: "chest", toActor: 0, weight: 0.2, offset: [0.22, 0, 0] }] })],
        limbContacts: [
          // Upper arms only: A lies on its right side and mirrored B on its left.
          cls.b_hands === "hips" ? grip("hand.r", "hip.l", 1, 0) : grip("hand.r", "upperBack", 1, 0, "rest"),
          grip("hand.l", "upperBack", 0, 1, "rest"),
        ],
        contacts: [grip("groin", "groin", 1, 0, "surface")],
        checks: ["faceToFace", near("b", "groin", "a", "groin", 0.2)],
      };
    },
  },
  spooning: {
    label: "Side by side, one behind the other",
    plan(cls) {
      // The top leg lifted high and forward, near straight, clear of B's. Or
      // both knees drawn up together in front. Knees bent by a detail come up
      // in front too, or the shin underneath folds back into B's thighs.
      const a = figure(
        cls.a_body,
        "side_lying",
        cls.a_legs === "one_raised" || cls.a_legs === "raised"
          ? { joints: { hip_l: { flexion: 60, abduction: 50, rotation: 0 }, knee_l: { flexion: 15 } } }
          : cls.a_legs === "together_bent" && !legPosed(cls.a_pose)
            ? { joints: { ...both("hip", { flexion: 65, abduction: 0, rotation: 0 }), ...both("knee", { flexion: 90 }) } }
            : cls.a_pose?.includes("legs_bent")
              ? { joints: both("hip", { flexion: 45 }) }
              : {}
      );
      // Head to foot: B is the mirror image turned round, on the other side and
      // still facing A's back, free to lie at an angle across A. The thighs
      // come down in line with the body instead of forward into A, and the arm
      // underneath stretches past the head instead of into A's legs. Its details
      // are laid on before the mirror, so `_l` is the top side for both.
      if (has(cls, /reversed/))
        return {
          surface: lying(cls),
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [a, figure(cls.b_body, "side_lying", { joints: { ...both("hip", { flexion: 10, abduction: 0, rotation: 0 }), ...both("knee", { flexion: 20 }), shoulder_r: { flexion: 160, abduction: 0, rotation: 0 }, elbow_r: { flexion: 30 } } })],
          place: [{ index: 0, rest: surfaceTop(lying(cls)) }, { index: 1, mirror: true, yaw: 180, rest: surfaceTop(lying(cls)), alignTo: { from: "groin", to: "buttocks", actor: 0, axes: [0, 2], offset: [-0.08, 0, 0] } }],
          fit: [{ ...refine(1, "groin", 1, "buttocks", 0, { snap: false }), yawRange: 25 }],
          contacts: [grip("groin", "buttocks", 1, 0, "surface")],
          checks: ["reversed", "bAtBack", near("b", "groin", "a", "buttocks", 0.18)],
        };
      return {
        surface: lying(cls),
        mode: "solver",
        roles: { a: 0, b: 1 },
        // The solver lays out the arrangement's own trunks, so a lean back goes on after.
        actors: [a, figure(cls.b_body, "side_lying", SPOON_LEAN[cls.lean] ? { details: SPOON_LEAN[cls.lean] } : {})],
        relationship: { arrangement: "spooning" },
        fit: [refine(1, "groin", 1, "buttocks", 0)],
        // The arrangement already rests B's top hand on A's waist, by the hip.
        limbContacts: cls.b_hands === "embrace" ? [grip("hand.l", "abdomen", 1, 0, "rest")] : [],
        contacts: [grip("groin", "buttocks", 1, 0, "surface")],
        checks: ["sameHeading", "bAtBack", near("b", "groin", "a", "buttocks", 0.18)],
      };
    },
  },
  scissors: {
    label: "Crossed at an angle, legs interlaced",
    plan(cls) {
      // Both on the back, heads apart, the hips together and the raised legs
      // interlaced: B's spread wider, outside A's. On a bed, A lies towards its
      // head end so both fit along it.
      if (has(cls, /opposite/))
        return {
          surface: lying(cls),
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [
            figure(cls.a_body, "supine", legsOf({ a_legs: cls.a_legs === "straight" ? "straight_apart" : cls.a_legs }, "raised")),
            figure(cls.b_body, "supine", { joints: { ...both("hip", { flexion: 85, abduction: 45, rotation: 0 }), ...both("knee", { flexion: 20 }) } }),
          ],
          place: [...(lying(cls) === "bed" ? [{ index: 0, pelvisTo: [0, null, 0.25] }] : []), { index: 1, yaw: 180 }],
          fit: [refine(1, "groin", 1, "groin", 0)],
          contacts: [grip("groin", "groin", 1, 0, "surface")],
          checks: ["aFaceUp", "bFaceUp", "reversed", near("b", "groin", "a", "groin", 0.28)],
        };
      if (has(cls, /sitting/)) return sittingBetweenPlan(cls, lying(cls), false);
      return {
        surface: lying(cls),
        mode: "fit",
        roles: { a: 0, b: 1 },
        actors: [figure(cls.a_body, "supine", legsOf(cls, "raised")), figure(cls.b_body, "side_lying")],
        place: [{ index: 1, yaw: 90 }],
        fit: [refine(1, "groin", 1, "groin", 0)],
        contacts: [grip("groin", "groin", 1, 0, "surface")],
        checks: ["crossed", near("b", "groin", "a", "groin", 0.28)],
      };
    },
  },
  doggy: {
    label: "On hands and knees, partner kneeling behind",
    plan(cls) {
      if (cls.surface === "ball") return ballProneRearPlan(cls);
      const surface = lying(cls, "floor");
      // One leg lifted out behind and to the side, past the partner's hip.
      const raised = cls.a_legs === "one_raised" ? { hip_l: { flexion: -25, abduction: 50, rotation: 0 }, knee_l: { flexion: 5 } } : {};
      // Knees together, or the partner's apart either side, the partner kneels astride A's shins.
      const together = kneelsAstride(cls);
      const over = standingOver(cls, surface);
      return rearPlan(cls, surface, figure(cls.a_body, "all_fours", { override: { ...(together ? both("hip", { abduction: 6 }) : (over ? KNEES_PARTED : KNEES_APART).override), ...raised } }), over ?? kneelingBehind(cls, cls.lean, together ? KNEES_ASTRIDE : null), "rear_alignment", { drape: draped(cls), astride: together });
    },
  },
  doggy_low: {
    label: "Chest lowered, partner kneeling behind",
    // Knees wide, which also brings the hips down to a kneeling partner's.
    plan(cls) {
      if (cls.surface === "ball") return kneelOverPlan(cls, "ball");
      if (has(cls, /chest on (bench|pillows)/)) return kneelOverPlan(cls, cls.surface === "pillows" ? "pillows" : "bench");
      const surface = lying(cls, "floor");
      // Or back to back, B on all fours facing away with the hips pushed back to A's.
      if (has(cls, /reverse/))
        return {
          surface,
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [figure(cls.a_body, "forearms_and_knees", { joints: both("hip", { abduction: 42 }) }), [[90, 8, 90, 0], [90, 16, 90, 0], [105, 40, 115, 0]].map(([flexion, abduction, knee, rotation], i) => figure(cls.b_body, "all_fours", { override: { ...both("hip", { flexion, abduction, rotation }), ...both("knee", { flexion: knee }) }, prefer: 0.001 * i }))],
          place: [{ index: 1, yaw: 180 }],
          fit: [{ ...refine(1, "groin", 1, "buttocks", 0, { start: [0, 0, -0.4], floor: surfaceTop(surface) }) }],
          contacts: [grip("groin", "buttocks", 1, 0, "surface")],
          // Back to back, B's groin sits under the far side of B's own pelvis from A.
          checks: ["aFaceDown", "bFaceDown", "reversed", near("b", "groin", "a", "buttocks", 0.3)],
        };
      // Unless the knees are together, or the partner's apart either side, and
      // the partner kneels astride the shins.
      const together = kneelsAstride(cls);
      return rearPlan(cls, surface, figure(cls.a_body, "forearms_and_knees", { joints: both("hip", { abduction: together ? 8 : 42 }) }), standingOver(cls, surface) ?? kneelingBehind(cls, cls.lean === "upright" ? null : cls.lean === "back" ? "back" : "forward", together ? KNEES_ASTRIDE : null), "rear_alignment", { drape: draped(cls), astride: together });
    },
  },
  kneeling_rear_upright: {
    label: "Both kneeling upright, chest to back",
    // Leaning forward, the chest comes down partway with B bent over it. Knees
    // together, B kneels astride A's shins. Upright, B may lean back a little
    // to clear arms raised behind A's head.
    plan(cls) {
      const together = cls.a_legs === "together_bent";
      const knees = together ? { override: both("hip", { abduction: 4 }) } : KNEES_APART;
      const b = (extra) => figure(cls.b_body, "kneeling", { ...extra, ...(together ? { override: KNEES_ASTRIDE } : {}) });
      return cls.lean === "forward"
        ? rearPlan(cls, lying(cls, "floor"), figure(cls.a_body, "kneeling", { ...knees, trunk: "forward_fold" }), b({ trunk: "forward_leaning" }), "rear_alignment")
        : rearPlan(cls, lying(cls, "floor"), figure(cls.a_body, "kneeling", knees), [b({}), b({ joints: spineBend(8), prefer: 0.001 })], "rear_alignment", { upright: true });
    },
  },
  standing_rear: {
    label: "Both standing, one behind",
    // B rises on tiptoe behind a taller partner, or softens the knees behind a shorter one.
    plan(cls) {
      // Or A squats low, hands on the knees, and B stands behind with the knees bent right down.
      if (has(cls, /squat/))
        return rearPlan(
          cls,
          "floor",
          figure(cls.a_body, "squatting", { soloSurface: "floor", joints: { spine01: { flexion: -15 }, spine02: { flexion: -15 } } }),
          stanceCandidates(cls.b_body, { trunk: "forward_leaning" }),
          "rear_alignment"
        );
      // A raised foot goes up on the bench or chair seat in front.
      const step = cls.a_legs === "one_raised" && (cls.surface === "bench" || cls.surface === "chair") ? cls.surface : null;
      const floor = step ? { soloSurface: "floor" } : {};
      const plan = rearPlan(
        cls,
        step ?? "floor",
        figure(cls.a_body, "standing", {
          ...floor,
          ...trunkOf(cls.lean === "forward" ? "forward" : null),
          // The seat is higher than a stair, so the thigh comes up past level to clear it.
          override: step ? { hip_l: { flexion: 100, abduction: 10, rotation: 0 }, knee_l: { flexion: 100 } } : cls.a_legs === "one_raised" ? STANDING_RAISED(cls) : {},
        }),
        [{}, { joints: both("ankle", { flexion: 30 }), prefer: 0.001 }, { ...stance(12, 10, 24), prefer: 0.002 }].map((extra) => figure(cls.b_body, "standing", { ...floor, ...extra })),
        "rear_alignment",
        { upright: cls.lean !== "forward" }
      );
      return step ? { ...plan, place: [{ index: 0, pelvisTo: [step === "bench" ? 0.25 : 0, null, -(SEATS[step].z + 0.17)] }] } : plan;
    },
  },
  standing_bent_over: {
    label: "Bent forward, partner standing behind",
    plan(cls) {
      // One leg lifted out behind and to the side, up past the partner's hip.
      // Or the feet planted wide apart, the partner between them.
      const raised = cls.a_legs === "one_raised" ? { override: { hip_l: { flexion: -25, abduction: 45, rotation: 0 }, knee_l: { flexion: 0 } } } : cls.a_legs === "straight_apart" ? { override: both("hip", { abduction: 26 }) } : {};
      if (has(cls, /hands on wall/)) return wallBentPlan(cls, raised.override);
      const plan = rearPlan(cls, "floor", figure(cls.a_body, "standing_bent_forward", raised), figure(cls.b_body, "standing"), "behind_bent_over");
      return { ...plan, checks: ["bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.24)] };
    },
  },
  furniture_rear: {
    label: "Leaning over furniture, partner behind",
    plan(cls) {
      if (cls.surface === "ball") return ballProneRearPlan(cls);
      if (cls.surface === "car_seat") return backSeatRearPlan(cls);
      if (cls.surface === "stairs") return stairsPlan(cls);
      // Lying face down across a sling hung at hip height, as on a table.
      if (cls.surface === "sling") return tableProneRearPlan(cls, "sling");
      const surface = pickSurface(cls, ["table", "bed", "sofa", "chair", "bench"], "table");
      // A kneels or squats on the furniture; "partner kneeling" is about B and is read by the plans below.
      if (/kneel|squat on/.test((cls.notes ?? "").replace(/partner kneeling/g, ""))) return furnitureKneelPlan(cls, surface);
      if (has(cls, /bent over edge/) && (surface === "bed" || surface === "sofa")) return overEdgePlan(cls, surface);
      if (has(cls, /lying on table/)) return tableProneRearPlan(cls);
      if (surface === "bed" || surface === "sofa") return edgeRearPlan(cls, surface);
      if (has(cls, /stool/)) return perchedRearPlan(cls);
      if (has(cls, /car seat/)) return backSeatRearPlan(cls);
      // An exercise ball: a bench across, low and narrow enough to drape over.
      if (has(cls, /ball/)) return overEdgePlan(cls, "bench", { across: true, drape: true });
      if (has(cls, /chest on seat/) && (surface === "chair" || surface === "bench")) return kneelOverPlan(cls, surface);
      if (has(cls, /draped over seat/)) return overEdgePlan(cls, surface, { drape: true });
      if (surface === "bench") return overEdgePlan(cls, surface);
      if (surface === "chair") return chairBentOverPlan(cls);
      // The solver lays the chest on the table top itself.
      const plan = rearPlan(cls, "table", figure(cls.a_body, "bent_over_support"), figure(cls.b_body, "standing", trunkOf(cls.lean === "forward" ? "forward" : null)), "behind_bent_over");
      return { ...plan, checks: ["bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.26)] };
    },
  },
  prone_rear: {
    label: "Lying face down, partner over from behind",
    plan(cls) {
      if (cls.surface === "wedge") return wedgeProneRearPlan(cls);
      const upright = cls.lean === "upright";
      // Or A props the chest up on the forearms.
      const sphinx = has(cls, /on forearms/);
      const propped = sphinx ? { spine01: { flexion: 12 }, spine02: { flexion: 12 }, spine03: { flexion: 12 }, ...both("shoulder", { flexion: 45, abduction: 14, rotation: 0 }), ...both("elbow", { flexion: 90 }) } : {};
      // One leg lifted up behind, out past B's side.
      const lifted = cls.a_legs === "one_raised" ? { hip_l: { flexion: -35, abduction: 40, rotation: 0 }, knee_l: { flexion: 40 } } : {};
      const reach = upright && cls.b_hands === "shoulders";
      // Or B squats over A's buttocks, the feet flat either side of A's hips,
      // leaning in with the hands on A's lower back.
      const squat = upright && has(cls, /squat/);
      // Head to foot: B lies over A's legs facing A's feet, the legs back over A's back.
      if (has(cls, /reversed/))
        return {
          surface: lying(cls),
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [figure(cls.a_body, "prone", { override: propped }), figure(cls.b_body, "prone", { arms: "arms_forearms" })],
          place: [{ index: 1, yaw: 180 }],
          fit: [{ ...refine(1, "groin", 1, "buttocks", 0, { free: ["x", "y", "z"], floor: surfaceTop(lying(cls)) }), pitchRange: 20, pivot: "groin" }],
          contacts: [grip("groin", "buttocks", 1, 0, "surface")],
          checks: ["aFaceDown", "reversed", "bAbove", near("b", "groin", "a", "buttocks", 0.18)],
        };
      return {
        surface: lying(cls),
        mode: "fit",
        roles: { a: 0, b: 1 },
        actors: [
          figure(cls.a_body, "prone", {
            ...(cls.a_legs === "open_bent" || cls.a_legs === "raised" ? { legs: "legs_apart" } : {}),
            override: { ...propped, ...lifted },
          }),
          // Reaching up to A's shoulders, B's trunk goes further down. Lying
          // along A, B's legs slope down from the hips onto A's.
          upright
            ? squat
              ? figure(cls.b_body, "squatting", { override: { ...both("hip", { abduction: 42 }), spine01: { flexion: -25 }, spine02: { flexion: -25 }, spine03: { flexion: -10 } } })
              : figure(cls.b_body, "kneeling_straddle", { trunk: reach ? "forward_lowered" : "forward_leaning" })
            : figure(cls.b_body, "prone", sphinx ? { arms: "arms_around" } : { arms: "arms_planted", override: both("hip", { flexion: 12 }) }),
        ],
        // Upright, B starts astride A's thighs and slides up to the buttocks.
        // Over a raised chest B's own trunk rises too; lying flat it tips level
        // with A's back instead of resting head down on it with the feet up.
        fit: [{ ...refine(1, "groin", 1, "buttocks", 0, { free: squat ? ["x", "z"] : ["x", "y", "z"], keep: upright, floor: surfaceTop(lying(cls)), ...(upright ? { start: [0, 0, -0.35] } : {}) }), ...(sphinx && !squat ? { free: ["y", "z"], pitchRange: 40, pivot: "groin" } : !upright ? { pitchRange: 25, pivot: "groin" } : {}) }],
        limbContacts: squat ? handsToCentre(1, 0, "lowerBack") : upright ? handsTo(1, 0, reach ? "shoulder" : "hip", false) : [],
        contacts: [grip("groin", "buttocks", 1, 0, "surface")],
        checks: ["aFaceDown", "sameHeading", "bAbove", near("b", "groin", "a", "buttocks", 0.18)],
      };
    },
  },
  wheelbarrow: {
    label: "Hands on the floor, legs held up",
    plan(cls) {
      // Or B sits on a bench or chair edge, or an exercise ball, A's hips held at the lap.
      const seatName = has(cls, /partner seated/) ? pickSurface(cls, ["bench", "chair", "sofa", "bed", "ball"], "bench") : null;
      const seat = seatName ? seatedAt(seatName, cls.b_body, { override: both("hip", { abduction: 30 }) }) : null;
      // Or A's hands are up on the edge of a bed, sofa, bench or ottoman in front, both facing it,
      // or A is held off the ground altogether, level, the hands on nothing. The
      // note names the ledge, whatever B stands or kneels on.
      const ledge = seat ? null : ((cls.notes ?? "").match(/hands on (bed|sofa|bench|ottoman)/)?.[1] ?? null);
      // Over a footstool, too low to reach down to straight-armed, A props up on
      // the forearms, the back arched and the legs up behind B, the knees bent.
      const forearms = ledge === "ottoman";
      // Or A's shins rest on a chair seat behind B instead of in B's hands: the
      // legs out straight to the ankles on the seat, or raised, bent at the
      // knees over its front edge with the feet up behind.
      const footrest = !seat && !ledge && has(cls, /legs on chair/);
      const kneesOver = footrest && cls.a_legs !== "straight";
      const flying = has(cls, /in the air/);
      const hand = (side) =>
        ledge
          ? { from: `hand.${side}`, fromActor: 1, point: [0, SEATS[ledge].top + 0.03, SEATS[ledge].z - 0.12], weight: 0.6, axes: [1, 2] }
          : { from: `hand.${side}`, fromActor: 1, point: [0, 0.03, 0], weight: 0.6, axes: [1] };
      const shin = (side) =>
        kneesOver
          ? { from: `knee.${side}`, fromActor: 1, point: [0, SEATS.chair.top + 0.06, SEATS.chair.z + 0.12], weight: 0.6, axes: [1, 2] }
          : { from: `ankle.${side}`, fromActor: 1, point: [0, SEATS.chair.top + 0.07, SEATS.chair.z - 0.1], weight: 0.6, axes: [1, 2] };
      return {
        surface: seatName ?? ledge ?? (footrest ? "chair" : "floor"),
        mode: "fit",
        roles: { a: 1, b: 0 },
        actors: [
          // On the floor at the ledge, not up on it: the ledge's top is not where B stands.
          seat ? seat.spec : figure(cls.b_body, /kneel/.test(cls.notes ?? "") ? "kneeling" : "standing", { soloSurface: "floor" }),
          figure(cls.a_body, "prone", {
            arms: "arms_planted",
            // Straight arms reach down and forward to the floor from the tipped trunk;
            // on the chair the legs slope down to it, bent at the hips.
            override: {
              ...both("hip", { flexion: footrest ? (kneesOver ? 45 : 30) : -8, abduction: 28, rotation: 0 }),
              ...both("knee", { flexion: kneesOver ? 95 : footrest ? 0 : 10 }),
              ...both("shoulder", { flexion: 115, abduction: 12, rotation: 0 }),
              ...both("elbow", { flexion: 5 }),
              ...(forearms ? OTTOMAN_FOREARMS : {}),
            },
          }),
        ],
        ...(seat ? { place: [seat.place] } : {}),
        // B stands back from the edge by A's reach from the hands to the hips,
        // or kneels closer, A's hips lower and the body sloping up to the edge.
        ...(ledge ? { place: [{ index: 0, yaw: 180, pelvisTo: [0, null, SEATS[ledge].z + (/kneel/.test(cls.notes ?? "") ? 0.7 : 1.05)] }, { index: 1, yaw: 180, ...(forearms ? { pitch: -20 } : {}) }] } : {}),
        ...(footrest ? { place: [{ index: 0, pelvisTo: [0, null, SEATS.chair.z + 0.32] }] } : {}),
        fit: [
          {
            moving: 1,
            free: ["x", "y", "z"],
            ...(seat || ledge || footrest ? { floor: 0 } : {}),
            pitchRange: flying ? 20 : 75,
            pivot: "pelvis",
            anchors: [{ from: "buttocks", fromActor: 1, to: "groin", toActor: 0, weight: 2 }, ...(flying ? [] : [hand("l"), hand("r")]), ...(footrest ? [shin("l"), shin("r")] : [])],
          },
        ],
        limbContacts: handsTo(0, 1, footrest ? "hip" : "thigh", false),
        contacts: [grip("groin", "buttocks", 0, 1, "surface")],
        // Across a seated lap A's pelvis rests on the thighs, a little out from the groin.
        checks: ["sameHeading", near("b", "groin", "a", "pelvis", seat ? 0.35 : 0.3)],
      };
    },
  },
  lap_facing: { label: "Astride the seated partner, face to face", plan: (cls) => lapPlan(cls, false) },
  lap_reverse: { label: "On the seated partner's lap, facing away", plan: (cls) => lapPlan(cls, true) },
  reclined_facing: {
    label: "Both reclined on their hands, face to face",
    plan(cls) {
      // Legs up on the partner's shoulders: A lies back for them to reach.
      if (cls.a_legs === "on_shoulders" || cls.a_legs === "raised") return sittingBetweenPlan(cls, lying(cls, "floor"), true);
      // The reclined pelvis tips back, so the hips flex further for the
      // buttocks to sit on the floor rather than the heels holding them up.
      const aSpec = figure(cls.a_body, "seated_reclined", { override: { ...both("hip", { flexion: 85, abduction: 50, rotation: 0 }), ...both("knee", { flexion: 70 }) } });
      // Upright, B kneels between A's open knees instead of reclining too.
      if (cls.lean === "upright")
        return {
          surface: lying(cls, "floor"),
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [aSpec, [figure(cls.b_body, "kneeling_low", { soloSurface: "floor", override: both("hip", { abduction: 20 }) }), figure(cls.b_body, "kneeling", { soloSurface: "floor", override: both("hip", { abduction: 20 }), prefer: 0.002 })]],
          place: [{ index: 0, rest: surfaceTop(lying(cls, "floor")) }, { index: 1, yaw: 180, rest: surfaceTop(lying(cls, "floor")) }],
          fit: [refine(1, "groin", 1, "groin", 0, { keep: true, start: [0, 0, 0.4] })],
          limbContacts: cls.b_hands === "hips" ? handsTo(1, 0, "thigh", true) : [],
          contacts: [grip("groin", "groin", 1, 0, "surface")],
          checks: [near("b", "groin", "a", "groin", 0.28)],
        };
      return {
        surface: lying(cls, "floor"),
        mode: "fit",
        roles: { a: 0, b: 1 },
        actors: [
          aSpec,
          // B's legs lie flat and wide, around A's hips and under A's raised knees.
          figure(cls.b_body, "seated_reclined", { override: { ...both("hip", { flexion: 42, abduction: 45, rotation: 0 }), ...both("knee", { flexion: 10 }) } }),
        ],
        place: [{ index: 0, rest: surfaceTop(lying(cls, "floor")) }, { index: 1, yaw: 180, rest: surfaceTop(lying(cls, "floor")) }],
        fit: [refine(1, "groin", 1, "groin", 0, { keep: true, start: [0, 0, 0.3] })],
        contacts: [grip("groin", "groin", 1, 0, "surface")],
        checks: ["faceToFaceHorizontal", near("b", "groin", "a", "groin", 0.28)],
      };
    },
  },
  standing_facing: {
    label: "Standing face to face",
    plan(cls) {
      const lifted = cls.a_legs === "one_raised" || cls.a_legs === "raised" || cls.a_legs === "wrapped" || cls.a_legs === "on_shoulders";
      // Or both kneeling up, face to face.
      const posture = has(cls, /both kneeling/) ? "kneeling" : "standing";
      // The raised knee comes up beside B's hip, or the straight leg up to B's
      // shoulder (as far as the hip flexes). It is an override: a standing
      // figure's legs bear its weight, so the solver refuses a raised-leg preset.
      const raised =
        cls.a_legs === "on_shoulders"
          ? { hip_l: { flexion: 135, abduction: 35, rotation: 0 }, knee_l: { flexion: 0 } }
          : { hip_l: { flexion: 90, abduction: 40, rotation: 0 }, knee_l: { flexion: 90 } };
      // Leaning back, A arches in B's arms with the head let go.
      const DIP = { spine01: { flexion: 12 }, spine02: { flexion: 12 }, spine03: { flexion: 12 }, neck: { flexion: 30 } };
      const hands = cls.b_hands === "embrace" || !cls.b_hands ? handsToCentre(1, 0, "back") : cls.b_hands === "surface" ? [] : handsTo(1, 0, cls.b_hands === "legs" ? "thigh" : cls.b_hands === "shoulders" ? "shoulder" : "hip", true);
      // The raised foot rests up on a bench or chair beside them, A side-on to
      // it: the knee bent up onto a step, or the leg out almost straight along
      // a bench to the foot.
      if (cls.a_legs === "one_raised" && posture === "standing" && (cls.surface === "bench" || cls.surface === "chair"))
        return {
          surface: cls.surface,
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [
            figure(cls.a_body, "standing", {
              soloSurface: "floor",
              // The arms come out a little from the sides to let B in close: hanging
              // straight, the hands - as broad front to back as a hand is - stand
              // in the way of B's thighs. Not much further, or the upper arms are
              // in the way of B's hands reaching for A's shoulders.
              override: { ...both("shoulder", { abduction: 16 }), ...(has(cls, /leg along/) ? { hip_l: { flexion: 35, abduction: 55, rotation: 0 }, knee_l: { flexion: 10 } } : { hip_l: { flexion: 95, abduction: 60, rotation: 0 }, knee_l: { flexion: 95 } }) },
            }),
            figure(cls.b_body, "standing", { soloSurface: "floor" }),
          ],
          place: [{ index: 0, yaw: -90, pelvisTo: [0.3, null, SEATS[cls.surface].z - 0.72] }, { index: 1, yaw: 90, pelvisTo: [0, null, SEATS[cls.surface].z - 0.72] }],
          fit: [refine(1, "groin", 1, "groin", 0)],
          limbContacts: hands,
          contacts: [grip("groin", "groin", 1, 0, "surface")],
          checks: ["faceToFace", "aUpright", "bUpright", near("b", "groin", "a", "groin", 0.18)],
        };
      // Tied standing with the back to a pole, the arms back round it. Leaning
      // forward is the head bowed, the chest being in B's way; B stands in
      // close, the hands at A's hips, the back being against the pole.
      if (cls.surface === "pole")
        return {
          surface: "pole",
          mode: "fit",
          roles: { a: 0, b: 1 },
          bound: [0],
          actors: [
            figure(cls.a_body, "standing", { soloSurface: "floor", override: { ...DETAILS.arms_back, ...both("elbow", { flexion: 40 }), ...(cls.lean === "forward" ? { neck: { flexion: -25 }, head: { flexion: -15 } } : {}) } }),
            stanceCandidates(cls.b_body),
          ],
          place: [{ index: 0, pelvisTo: [0, null, 0.1], settle: { along: [0, 0, -1] } }, { index: 1, yaw: 180 }],
          fit: [refine(1, "groin", 1, "groin", 0, { start: [0, 0, 0.3] })],
          limbContacts: handsTo(1, 0, "hip", true).map((c) => ({ ...c, optional: true })),
          contacts: [grip("groin", "groin", 1, 0, "surface")],
          checks: ["faceToFace", "aUpright", "bUpright", near("b", "groin", "a", "groin", 0.18)],
        };
      // Kneeling up, one knee raised sets that foot flat on the floor beside the
      // partner (on the other side from a knee the partner raises), or the knees
      // open either side of the partner's thigh.
      const kneel =
        posture !== "kneeling" || legPosed(cls.a_pose)
          ? {}
          : cls.a_legs === "one_raised"
            ? detailFor((cls.b_pose ?? []).includes("knee_up_l") ? "knee_up_l" : "knee_up_r", "kneeling_straddle")
            : cls.a_legs === "open_bent"
              ? both("hip", { abduction: 28 })
              : {};
      // Held at the hips on one leg, A's arms come out a little from the sides
      // as they do by the bench: hanging, the forearms are where B's reach in.
      const armsOut = lifted && posture === "standing" && cls.b_hands === "hips" ? both("shoulder", { abduction: 22 }) : {};
      return {
        surface: "floor",
        mode: "solver",
        roles: { a: 0, b: 1 },
        actors: [figure(cls.a_body, posture, { override: { ...armsOut, ...(lifted && posture === "standing" ? raised : {}), ...kneel, ...(cls.lean === "back" ? DIP : {}) } }), figure(cls.b_body, posture)],
        relationship: { arrangement: "face_to_face" },
        fit: [refine(1, "groin", 1, "groin", 0)],
        limbContacts: hands,
        contacts: [grip("groin", "groin", 1, 0, "surface")],
        checks: ["faceToFace", "aUpright", "bUpright", near("b", "groin", "a", "groin", 0.18)],
      };
    },
  },
  standing_carry: {
    label: "Lifted and carried, face to face",
    plan(cls) {
      // Carried by a partner leaning forward over them, A lies back in B's arms.
      const CARRIED_BACK = { spine01: { flexion: 12 }, spine02: { flexion: 12 }, spine03: { flexion: 12 } };
      // Or held up facing away, the back to B's chest and the thighs cradled from
      // beneath; or the knees drawn up together in front, held at the hips.
      if (has(cls, /facing away/)) {
        const together = cls.a_legs === "together_bent";
        return {
          surface: "floor",
          mode: "fit",
          roles: { a: 1, b: 0 },
          actors: [
            figure(cls.b_body, "standing"),
            figure(cls.a_body, "lifted", { override: { ...both("hip", { flexion: 80, abduction: together ? 6 : 45, rotation: 0 }), ...both("shoulder", { flexion: 150, abduction: 30, rotation: 0 }), ...both("elbow", { flexion: 110 }) } }),
          ],
          fit: [{ moving: 1, free: ["x", "y", "z"], pitchRange: 20, pivot: "pelvis", anchors: [{ from: "buttocks", fromActor: 1, to: "groin", toActor: 0, weight: 2 }] }],
          limbContacts: handsTo(0, 1, together ? "hip" : "knee", false),
          contacts: [grip("groin", "buttocks", 0, 1, "surface")],
          checks: ["sameHeading", "bUpright", "aOffGround", near("b", "groin", "a", "pelvis", 0.25)],
        };
      }
      // B carries A's weight on the hands under the buttocks, unless the hands
      // are on A's hips or round A's back; leaning forward over A, or back
      // under A's weight.
      return {
        surface: "floor",
        mode: "solver",
        roles: { a: 1, b: 0 },
        actors: [figure(cls.b_body, "standing", trunkOf(cls.lean)), figure(cls.a_body, "lifted", cls.lean === "forward" ? { override: CARRIED_BACK } : {})],
        relationship: { arrangement: "supported_lift" },
        fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false })],
        ...(cls.b_hands === "hips" || cls.b_hands === "embrace" ? { limbContacts: bHands(cls, 0, 1) } : {}),
        contacts: [grip("groin", "groin", 1, 0, "surface"), grip("chest", "chest", 1, 0, "surface")],
        checks: ["faceToFace", "bUpright", "aOffGround", near("a", "groin", "b", "groin", 0.2)],
      };
    },
  },
  supported_inversion: {
    label: "Hips raised high, partner at the hips",
    plan(cls) {
      if (has(cls, /backbend|bridge/)) return backbendPlan(cls);
      if (has(cls, /headstand|upside down/)) return headstandPlan(cls);
      if (has(cls, /shoulder stand|piledriver/)) return piledriverPlan(cls);
      return {
        surface: lying(cls, "floor"),
        mode: "fit",
        roles: { a: 0, b: 1 },
        // B comes in from beyond A's raised hips, between A's lifted legs, facing A's head.
        actors: [
          figure(cls.a_body, "inverted", { override: both("hip", { abduction: 38 }) }),
          frontCandidates(cls.b_body, { lean: cls.lean }).map((s) => ({ ...s, soloSurface: undefined })),
        ],
        fit: [refine(1, "groin", 1, "groin", 0, { start: [0, 0, -0.4] })],
        limbContacts: handsTo(1, 0, "hip", false),
        contacts: [grip("groin", "groin", 1, 0, "surface")],
        checks: ["aInverted", near("b", "groin", "a", "groin", 0.25)],
      };
    },
  },
  oral_on_a: {
    label: "Head at the reclining partner's hips",
    plan(cls) {
      if (cls.surface === "ball") return ballBridgePlan(cls, { oral: true });
      const surface = pickSurface(cls, ["floor", "bed", "sofa", "table", "chair", "bench", "car_seat"], "bed");
      // Or sitting up on the bed's edge, the partner kneeling on the floor.
      const bedEdge = surface === "bed" && has(cls, /seated on edge/);
      // Lying back across a car's back seat, the partner crouched on it at the hips.
      if (surface === "car_seat") return carSeatOralPlan(cls);
      if (surface === "table" || surface === "chair" || surface === "bench" || surface === "sofa" || bedEdge)
        // A bench is sat on too when A leans back on the hands rather than lying along it,
        // and a sofa lain back along unless noted, the hips at its edge.
        return edgePlan(cls, surface, surface === "chair" || (surface === "sofa" && !has(cls, /lying at edge/)) || bedEdge || (surface === "bench" && cls.lean === "back") ? "seated" : "supine", { legs: cls.a_legs ?? "open_bent", oral: true });
      // Held upside down against a standing partner, the hips at the face.
      if (has(cls, /inverted/) && has(cls, /standing/))
        return {
          surface: "floor",
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [figure(cls.a_body, "inverted", { soloSurface: "floor", override: both("hip", { abduction: 30 }) }), figure(cls.b_body, "standing", { soloSurface: "floor" })],
          place: [{ index: 0, pitch: 60 }, { index: 1, yaw: 180, pelvisTo: [0, null, 0.3] }],
          fit: [refine(0, "groin", 0, "mouth", 1, { free: ["x", "y", "z"], keep: false })],
          limbContacts: handsToCentre(1, 0, "lowerBack").map((c) => ({ ...c, optional: true })),
          contacts: [grip("mouth", "groin", 1, 0, "surface")],
          checks: ["aInverted", "aOffGround", near("b", "mouth", "a", "groin", 0.22)],
        };
      // Up on the shoulders, the hips held at the face of a partner kneeling beyond them.
      // Posed, the inversion tips back along the floor: it is stood up on the
      // shoulders, the chin tucked so the upper back takes the weight.
      if (has(cls, /inverted/))
        return {
          surface,
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [
            figure(cls.a_body, "inverted", { override: { ...both("hip", { abduction: cls.a_legs === "straight_apart" ? 38 : 4 }), neck: { flexion: 50 }, head: { flexion: 25 } } }),
            kneelHeadCandidates(cls.b_body),
          ],
          place: [{ index: 0, pitch: 55, rest: 0 }],
          fit: [{ ...refine(1, "mouth", 1, "groin", 0, { start: [0, 0, -0.3] }), pitchRange: 25, pivot: "knee" }],
          limbContacts: handsTo(1, 0, "hip", false).map((c) => ({ ...c, optional: true })),
          contacts: [grip("mouth", "groin", 1, 0, "surface")],
          checks: ["aInverted", near("b", "mouth", "a", "groin", 0.22)],
        };
      // Lying on one side, the upper leg lifted over the back of a partner low at the hips.
      if (has(cls, /on (the |one )?side/))
        return {
          surface,
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [
            figure(cls.a_body, "side_lying", { soloSurface: surface, joints: { hip_l: { flexion: 85, abduction: 45, rotation: 0 }, knee_l: { flexion: 50 }, hip_r: { flexion: 20, abduction: 0, rotation: 0 }, knee_r: { flexion: 20 } } }),
            lowHeadCandidates(cls.b_body),
          ],
          place: [{ index: 1, yaw: -90 }],
          fit: [refine(1, "mouth", 1, "groin", 0, { start: [0.3, 0, 0] })],
          contacts: [grip("mouth", "groin", 1, 0, "surface")],
          checks: [near("b", "mouth", "a", "groin", 0.22)],
        };
      // Kneeling at the side of the lying partner's hips, bent down over them.
      if (has(cls, /beside/))
        return {
          surface,
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [
            figure(cls.a_body, "supine", { ...legsOf(cls, "straight"), soloSurface: surface }),
            [
              figure(cls.b_body, "kneeling", { override: both("hip", { flexion: 55, abduction: 8 }), tilt: 55, soloSurface: surface }),
              figure(cls.b_body, "kneeling", { override: both("hip", { flexion: 70, abduction: 10 }), tilt: 70, soloSurface: surface, prefer: 0.001 }),
              figure(cls.b_body, "kneeling_low", { override: both("hip", { abduction: 12 }), tilt: 40, soloSurface: surface, prefer: 0.002 }),
              figure(cls.b_body, "kneeling", { trunk: "forward_lowered", soloSurface: surface, prefer: 0.003 }),
            ],
          ],
          place: [{ index: 1, around: { actor: 0, where: "beside", dist: 0.45, face: "groin" } }],
          fit: [{ ...refine(1, "mouth", 1, "groin", 0, { start: [0.25, 0, 0] }), pitchRange: 25, pivot: "knee" }],
          contacts: [grip("mouth", "groin", 1, 0, "surface")],
          checks: ["aFaceUp", near("b", "mouth", "a", "groin", 0.22)],
        };
      // Leaning back on the hands or a wedge, the knees up and open around a partner low at the hips.
      if (cls.lean === "back")
        return {
          surface,
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [figure(cls.a_body, "seated_reclined", { soloSurface: surface, override: { ...both("hip", { flexion: 85, abduction: 50, rotation: 0 }), ...both("knee", { flexion: 70 }) } }), lowHeadCandidates(cls.b_body)],
          place: [{ index: 1, yaw: 180 }],
          fit: [refine(1, "mouth", 1, "groin", 0, { start: [0, 0, 0.3] })],
          limbContacts: cls.b_hands === "legs" ? handsTo(1, 0, "thigh", true) : [],
          contacts: [grip("mouth", "groin", 1, 0, "surface")],
          checks: ["facingInward", near("b", "mouth", "a", "groin", 0.22)],
        };
      // Up on the shoulders for a partner standing at the hips, bent forward
      // and down over them on deep-bent knees: the hips held up at the face,
      // the head and shoulders on the floor. Standing straighter, B would hold
      // the hips too high for the shoulders to reach the floor, and A would
      // hang from B's hands.
      if (surface === "floor" && has(cls, /partner standing/))
        return {
          surface,
          mode: "fit",
          roles: { a: 0, b: 1 },
          actors: [
            figure(cls.a_body, "inverted", { override: { ...both("hip", { abduction: 20 }), neck: { flexion: 50 }, head: { flexion: 25 } } }),
            figure(cls.b_body, "standing_bent_forward", { soloSurface: "floor", override: { ...both("hip", { flexion: 137 }), ...both("knee", { flexion: 100 }) } }),
          ],
          place: [{ index: 1, rest: 0 }, { index: 0, pitch: 70, rest: 0, pelvisTo: [0, null, 0.4] }],
          fit: [
            {
              moving: 0,
              free: ["y", "z"],
              keep: false,
              floor: 0,
              pitchRange: 35,
              pivot: "groin",
              anchors: [
                { from: "groin", fromActor: 0, to: "mouth", toActor: 1, weight: 4 },
                { from: "upperBack", fromActor: 0, point: [0, 0.1, 0], axes: [1], weight: 3 },
              ],
            },
          ],
          limbContacts: handsTo(1, 0, "hip", false).map((c) => ({ ...c, optional: true })),
          contacts: [grip("mouth", "groin", 1, 0, "surface")],
          checks: ["aInverted", near("b", "mouth", "a", "groin", 0.22)],
        };
      // On the bed with the shoulders at its edge, the head hanging back over it.
      const overEdge = surface === "bed" && has(cls, /head over edge/);
      const prone = has(cls, /feet up|lying flat/);
      const aLegs = legsOf({ a_legs: ORAL_LEGS[cls.a_legs] ?? cls.a_legs }, "open_bent");
      // A partner lying flat needs the leg left down swung aside, or it lies along it.
      if (prone && cls.a_legs === "one_raised") aLegs.joints.hip_r = { flexion: 6, abduction: 44, rotation: 0 };
      return {
        surface,
        mode: "fit",
        roles: { a: 0, b: 1 },
        // Legs held together would shut the partner out; they part for the head between them.
        actors: [
          figure(cls.a_body, "supine", { ...aLegs, ...(overEdge ? { override: { neck: { flexion: 45 }, head: { flexion: 25 } } } : {}) }),
          // Or B lies flat between them on the forearms, the feet up in the air behind or the legs long.
          prone ? figure(cls.b_body, "prone", { arms: "arms_around", joints: both("knee", { flexion: has(cls, /feet up/) ? 85 : 0 }) }) : lowHeadCandidates(cls.b_body),
        ],
        ...(overEdge ? { place: [{ index: 0, anchor: "shoulders", pelvisTo: [0, null, SEATS.bed.z + 0.01] }] } : {}),
        fit: [prone ? { ...refine(1, "mouth", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: surfaceTop(surface) }), pitchRange: [0, 20], pivot: "pelvis" } : refine(1, "mouth", 1, "groin", 0)],
        // Unless braced on the surface, the arms go around the thighs to hold the
        // hips: the thigh landmark lies inside raised knees, where the arms cannot reach.
        // Lying flat, B's arms stay around the thighs as posed: the hands would
        // reach the hips only if A's hips were lifted to the face.
        limbContacts: cls.b_hands === "surface" ? [] : (prone ? [] : handsTo(1, 0, "hip", true)),
        contacts: [grip("mouth", "groin", 1, 0, "surface")],
        checks: ["aFaceUp", near("b", "mouth", "a", "groin", 0.22)],
      };
    },
  },
  oral_on_b_kneeling: { label: "Kneeling at the standing or seated partner's hips", plan: oralOnBPlan },
  oral_on_b_lying: {
    label: "Head at the hips of the partner lying down",
    plan(cls) {
      // B holds a plank on straight arms and the toes over A, who lies beneath the hips.
      if (has(cls, /plank/))
        return {
          surface: "floor",
          mode: "fit",
          roles: { a: 1, b: 0 },
          actors: [
            figure(cls.b_body, "prone", {
              soloSurface: "floor",
              arms: "arms_planted",
              override: {
                ...both("hip", { flexion: 0, abduction: 20, rotation: 0 }),
                ...both("knee", { flexion: 0 }),
                ...both("shoulder", { flexion: 80, abduction: 10, rotation: 0 }),
                ...both("elbow", { flexion: 5 }),
              },
            }),
            // Legs flat and together, the toes planted either side of them; or
            // the knees drawn up and apart, B's legs running out between them.
            figure(cls.a_body, "supine", {
              joints: cls.a_legs === "open_bent" ? structuredClone(LEG_SHAPES.open_bent) : { ...both("hip", { flexion: 3, abduction: 3, rotation: 0 }), ...both("knee", { flexion: 4 }) },
              soloSurface: "floor",
            }),
          ],
          fit: [
            {
              moving: 0,
              free: ["x", "y", "z"],
              pitchRange: 40,
              floor: 0,
              pivot: "pelvis",
              anchors: [
                { from: "groin", fromActor: 0, to: "mouth", toActor: 1, offset: [0, 0.08, 0], weight: 2 },
                ...["hand.l", "hand.r", "foot.l", "foot.r"].map((from) => ({ from, fromActor: 0, point: [0, 0.07, 0], weight: 0.6, axes: [1] })),
              ],
            },
          ],
          contacts: [grip("mouth", "groin", 1, 0, "surface")],
          checks: ["aFaceUp", near("a", "mouth", "b", "groin", 0.22)],
        };
      // A arched face up over B lying flat, the hips high on the planted feet
      // beyond B's knees and the head hanging down to B's hips between the hands.
      if (has(cls, /bridge|wheel/))
        return {
          surface: "floor",
          mode: "fit",
          roles: { a: 1, b: 0 },
          actors: [
            figure(cls.b_body, "supine", { joints: structuredClone(LEG_SHAPES.straight) }),
            figure(cls.a_body, "standing", { soloSurface: "floor", jointMode: "fixed", joints: { ...structuredClone(WHEEL) } }),
          ],
          place: [{ index: 1, pitch: -80, yaw: 180, pelvisTo: [0, 3, 0] }],
          fit: [
            {
              moving: 1,
              free: ["x", "y", "z"],
              pitchRange: 15,
              pivot: "pelvis",
              floor: 0,
              anchors: [{ from: "mouth", fromActor: 1, to: "groin", toActor: 0, weight: 2 }, ...floorAnchors(1, "hand"), ...floorAnchors(1, "foot")],
            },
          ],
          contacts: [grip("mouth", "groin", 1, 0, "surface")],
          checks: ["aInverted", near("a", "mouth", "b", "groin", 0.22)],
        };
      // B lies along a sofa, the hips near its front edge; A kneels up on the
      // floor in front of it, bent at the hips over B's from the side.
      if (cls.surface === "sofa" && has(cls, /kneeling beside/))
        return {
          surface: "sofa",
          mode: "fit",
          roles: { a: 1, b: 0 },
          actors: [
            figure(cls.b_body, "supine", { soloSurface: "floor", joints: { ...both("hip", { flexion: 3, abduction: 4, rotation: 0 }), ...both("knee", { flexion: 4 }) } }),
            figure(cls.a_body, "kneeling", { soloSurface: "floor", trunk: "forward_leaning", override: both("hip", { flexion: 35, abduction: 10 }) }),
          ],
          // Bent at the hips and tipped forward as far, the thighs stay upright.
          place: [
            { index: 0, yaw: -90, rest: SEATS.sofa.top, pelvisTo: [0, null, 0.36] },
            { index: 1, yaw: 180, pitch: 35, pelvisTo: [0, null, 0.9], rest: 0 },
          ],
          fit: [refine(1, "mouth", 1, "groin", 0, { offset: [0, 0.06, 0], start: [0, 0, 0.1] })],
          limbContacts: handsTo(1, 0, "hip", true).map((c) => ({ ...c, optional: true })),
          contacts: [grip("mouth", "groin", 1, 0, "surface")],
          checks: [near("a", "mouth", "b", "groin", 0.22)],
        };
      // B lies back off a sofa's front edge, the feet up on the seat and the
      // shoulders and head down on the floor; A sits on the edge beside B's
      // knees, twisted round and folded down over B's hips.
      if (cls.surface === "sofa" && has(cls, /head on floor/)) {
        const bend = { flexion: -30, abduction: 15, rotation: -20 };
        return {
          surface: "sofa",
          mode: "fit",
          roles: { a: 1, b: 0 },
          actors: [
            figure(cls.b_body, "supine", { soloSurface: "floor", jointMode: "fixed", joints: legPair(20, 15, 100) }),
            figure(cls.a_body, "seated", {
              soloSurface: "chair",
              jointMode: "fixed",
              joints: { spine01: bend, spine02: bend, spine03: bend, neck: { flexion: -10, abduction: 0, rotation: 0 }, ...both("hip", { flexion: 90, abduction: 8, rotation: 0 }), ...both("knee", { flexion: 85 }) },
            }),
          ],
          // Tipped head down with the buttocks on the edge.
          place: [
            { index: 0, pitch: 25, pelvisTo: [0, 0.52, SEATS.sofa.z + 0.145] },
            { index: 1, seatOn: { top: SEATS.sofa.top, z: SEATS.sofa.z, x: 0.3 } },
          ],
          fit: [{ ...refine(1, "mouth", 1, "groin", 0, { free: ["x"], offset: [0, 0.1, 0.05] }), yawRange: 25 }],
          contacts: [grip("mouth", "groin", 1, 0, "surface")],
          checks: [near("a", "mouth", "b", "groin", 0.25)],
        };
      }
      // Both on their sides, face to face and the same way up: A lies lower
      // down with the head resting at B's hips under B's raised top knee, the
      // knees bent back and the lower arm folded in to the chest. B's lower leg
      // folds back out of A's way. A is the mirror image, on the other side,
      // its top hand on B's hip.
      if (has(cls, /on side/)) {
        const surface = lying(cls);
        return {
          surface,
          mode: "fit",
          roles: { a: 1, b: 0 },
          actors: [
            figure(cls.b_body, "side_lying", { soloSurface: surface, override: { hip_top: { flexion: 70, abduction: 45, rotation: 0 }, knee_top: { flexion: 95 }, hip_bottom: { flexion: -20, abduction: 0 }, knee_bottom: { flexion: 100 } } }),
            figure(cls.a_body, "side_lying", { soloSurface: surface, override: { ...both("hip", { flexion: 10, abduction: 0, rotation: 0 }), ...both("knee", { flexion: 100 }), shoulder_r: { flexion: 20, abduction: 0, rotation: 0 }, elbow_r: { flexion: 140 } } }),
          ],
          place: [{ index: 0, rest: surfaceTop(surface) }, { index: 1, mirror: true, rest: surfaceTop(surface), alignTo: { from: "mouth", to: "groin", actor: 0, axes: [0, 2], offset: [0.2, 0, 0] } }],
          fit: [refine(1, "mouth", 1, "groin", 0, { snap: false })],
          limbContacts: cls.b_hands === "surface" ? [] : [grip("hand.r", "hip.l", 1, 0, "rest")],
          contacts: [grip("mouth", "groin", 1, 0, "surface")],
          checks: ["sameHeading", near("a", "mouth", "b", "groin", 0.22)],
        };
      }
      return {
        surface: lying(cls),
        mode: "fit",
        roles: { a: 1, b: 0 },
        // Knees up and apart leave room for the partner's head and shoulders between them.
        // Or A lies flat between them, the feet up in the air behind; or, the
        // knees drawn up together, curled on one side with the head in B's lap.
        actors: [
          figure(cls.b_body, "supine", legsOf({}, "open_bent")),
          has(cls, /feet up/)
            ? figure(cls.a_body, "prone", { arms: "arms_forearms", joints: both("knee", { flexion: 85 }) })
            : cls.a_legs === "together_bent"
              ? figure(cls.a_body, "side_lying", { soloSurface: lying(cls), override: { ...both("hip", { flexion: 75, abduction: 0, rotation: 0 }), ...both("knee", { flexion: 115 }) } })
              : lowHeadCandidates(cls.a_body),
        ],
        fit: [refine(1, "mouth", 1, "groin", 0)],
        limbContacts: cls.b_hands === "surface" ? [] : handsTo(1, 0, "thigh", true),
        contacts: [grip("mouth", "groin", 1, 0, "surface")],
        checks: ["facingInward", near("a", "mouth", "b", "groin", 0.22)],
        facingRoles: { a: 0, b: 1 },
      };
    },
  },
  facesitting: {
    label: "Kneeling astride the partner's head",
    plan(cls) {
      // Folded down past the head with the chest to the floor, A faces away from B's body.
      const chestDown = has(cls, /chest to floor/);
      // Or on all fours over the face, the arms straight.
      const fours = chestDown || has(cls, /all.fours/);
      const facingBody = !fours && !has(cls, /facing away/) && (cls.lean === "forward" || /revers|toward.*(feet|body)/.test(cls.notes ?? ""));
      // B's hands up on A's thighs where they reach them.
      const hands = handsTo(0, 1, "thigh", !facingBody).map((c) => ({ ...c, optional: true }));
      // Standing on the floor at the edge, back to it, astride the head of a
      // partner lying along the surface with the head just over the edge.
      if (has(cls, /standing/) && cls.surface !== "floor") {
        const surface = lying(cls);
        // Feet wide enough apart for the thighs to pass either side of the head.
        const astride = [[5, 30, 10], [10, 35, 20], [15, 40, 30], [25, 40, 45]].map(([hip, abduction, knee], i) =>
          figure(cls.a_body, "standing", { soloSurface: "floor", ...stance(hip, abduction, knee), prefer: i * 0.001 }));
        return {
          surface,
          mode: "fit",
          roles: { a: 1, b: 0 },
          // The head tips back a little, down to the hips of a partner standing wide.
          actors: [figure(cls.b_body, "supine", { soloSurface: surface, override: { neck: { flexion: 25 }, head: { flexion: 10 } } }), astride],
          place: [{ index: 0, anchor: "shoulders", pelvisTo: [0, null, SEATS[surface].z - 0.04] }],
          fit: [refine(1, "groin", 1, "mouth", 0, { start: [0, 0, 0.15] })],
          limbContacts: handsTo(0, 1, "thigh", true).map((c) => ({ ...c, optional: true })),
          contacts: [grip("groin", "mouth", 1, 0, "surface")],
          checks: ["bFaceUp", "aUpright", near("a", "groin", "b", "mouth", 0.23)],
        };
      }
      return {
        surface: lying(cls),
        mode: "fit",
        roles: { a: 1, b: 0 },
        // Knees spread wide lower A's hips down to B's face.
        actors: [
          figure(cls.b_body, "supine", { soloSurface: lying(cls) }),
          fours
            ? // On all fours with the knees wide and the elbows bent, the chest low.
              [figure(cls.a_body, "all_fours", { ...(chestDown ? { joints: both("elbow", { flexion: 120 }) } : {}), override: both("hip", { abduction: 45 }), soloSurface: lying(cls) })]
            : [
                figure(cls.a_body, "kneeling_straddle", { ...trunkOf(cls.lean), override: both("hip", { abduction: 45 }), soloSurface: lying(cls) }),
                figure(cls.a_body, "kneeling_low", { ...trunkOf(cls.lean), override: both("hip", { abduction: 40 }), soloSurface: lying(cls), prefer: 0.003 }),
              ],
        ],
        place: facingBody ? [{ index: 1, yaw: 180 }] : [],
        fit: [refine(1, "groin", 1, "mouth", 0, { free: ["x", "y", "z"], keep: false, floor: surfaceTop(lying(cls)) })],
        limbContacts: hands,
        contacts: [grip("groin", "mouth", 1, 0, "surface")],
        checks: ["bFaceUp", fours ? "aFaceDown" : "aUpright", near("a", "groin", "b", "mouth", 0.23)],
      };
    },
  },
};
TEMPLATES.other_pair = { label: "Close pair", plan: (cls) => TEMPLATES.side_facing.plan(cls) };

const SOLO = {
  standing: "standing",
  standing_bent_forward: "standing_bent_forward",
  kneeling: "kneeling",
  kneeling_low: "kneeling_low",
  seated: "seated",
  supine: "supine",
  supine_legs_raised: "supine_legs_raised",
  side_lying: "side_lying",
  all_fours: "all_fours",
  prone: "prone",
  squatting: "squatting",
};

const THIRD = {
  standing: "standing",
  kneeling: "kneeling",
  seated: "seated_floor",
  supine: "supine",
  side_lying: "side_lying",
  all_fours: "all_fours",
};

/** A third partner placed around the main pair, with one contact to it. */
function withThird(plan, cls) {
  const third = cls.third ?? { posture: "kneeling", place: "beside" };
  const where = third.place ?? "beside";
  const posture = THIRD[third.posture] ?? "kneeling";
  const index = plan.actors.length;
  const aIndex = plan.roles.a;
  const bIndex = plan.roles.b;
  const body = cls.c_body ?? "neutral";
  let anchor;
  let contact;
  let around;
  if (where === "at_head" || where === "in_front") {
    // The third partner's hips at the front partner's head.
    around = { actor: aIndex, where, dist: 0.35, face: "head", anchor: "groin" };
    anchor = refine(index, "groin", index, "mouth", aIndex, { weight: 0.6 });
    contact = grip("mouth", "groin", aIndex, index, "surface");
  } else if (where === "behind") {
    around = { actor: bIndex, where: "behind", dist: 0.35, face: "pelvis", anchor: "chest" };
    anchor = refine(index, "chest", index, "upperBack", bIndex, { weight: 0.4 });
    contact = grip("chest", "upperBack", index, bIndex, "surface");
  } else if (where === "beneath") {
    // Lying under the front partner's chest, head the same way, holding on.
    around = { actor: aIndex, where, face: "head", anchor: "chest" };
    anchor = refine(index, "chest", index, "chest", aIndex, { weight: 0.4 });
    contact = grip("hand.l", "shoulder", index, aIndex);
  } else {
    around = { actor: aIndex, where: "beside", dist: 0.55, face: "chest", anchor: "pelvis" };
    anchor = refine(index, "hand.l", index, "shoulder", aIndex, { weight: 0.3 });
    contact = grip("hand.l", "shoulder", index, aIndex);
  }
  const thirdSpec = figure(body, posture, {
    soloSurface: plan.soloSurface?.[aIndex] ?? plan.surface,
    // Beneath, the legs part around the front partner's knees and the arms come up to them.
    ...(where === "beneath" ? { arms: "arms_around", joints: structuredClone(LEG_SHAPES.straight_apart) } : {}),
  });
  const fit = { ...anchor };
  return {
    ...plan,
    mode: plan.mode,
    actors: [...plan.actors, thirdSpec],
    thirdIndex: index,
    thirdPlace: { index, around },
    thirdFit: fit,
    limbContacts: [...(plan.limbContacts ?? []), ...(contact.type === "grip" ? [contact] : [])],
    contacts: [...(plan.contacts ?? []), ...(contact.type === "grip" ? [] : [contact])],
  };
}

/**
 * Details of one figure read off its source image, beyond what the template
 * decides: where a free arm is, how the head is turned, one knee drawn up.
 * Each is a joint target in the body's own terms, laid over the composed pose
 * after the figure is posed and before it is fitted to its partner, as far as
 * the floor and furniture allow (see `applyDetails` in interaction-composer.mjs);
 * a limb that reaches its partner is still placed by that reach. `_l`/`_r`
 * name one side.
 */
const sided = (make) => ({ l: make("l"), r: make("r") });
const SIDED = {
  arm_up: (s) => ({ [`shoulder_${s}`]: { flexion: 150, abduction: 20, rotation: 0 }, [`elbow_${s}`]: { flexion: 40 } }),
  arm_out: (s) => ({ [`shoulder_${s}`]: { flexion: 10, abduction: 80, rotation: 0 }, [`elbow_${s}`]: { flexion: 12 } }),
  arm_forward: (s) => ({ [`shoulder_${s}`]: { flexion: 80, abduction: 10, rotation: 0 }, [`elbow_${s}`]: { flexion: 20 } }),
  arm_down: (s) => ({ [`shoulder_${s}`]: { flexion: 4, abduction: 10, rotation: 0 }, [`elbow_${s}`]: { flexion: 12 } }),
  arm_back: (s) => ({ [`shoulder_${s}`]: { flexion: -45, abduction: 15, rotation: 0 }, [`elbow_${s}`]: { flexion: 20 } }),
  arm_bent: (s) => ({ [`shoulder_${s}`]: { flexion: 40, abduction: 15, rotation: 0 }, [`elbow_${s}`]: { flexion: 125 } }),
  arm_head: (s) => ({ [`shoulder_${s}`]: { flexion: 150, abduction: 60, rotation: 0 }, [`elbow_${s}`]: { flexion: 140 } }),
  head_turn: (s) => ({ neck: { rotation: s === "l" ? 45 : -45 }, head: { rotation: s === "l" ? 20 : -20 } }),
  head_tilt: (s) => ({ neck: { abduction: s === "l" ? 25 : -25 } }),
  twist: (s) => ({ spine01: { rotation: s === "l" ? 12 : -12 }, spine02: { rotation: s === "l" ? 12 : -12 }, spine03: { rotation: s === "l" ? 12 : -12 } }),
  side_bend: (s) => ({ spine01: { abduction: s === "l" ? 10 : -10 }, spine02: { abduction: s === "l" ? 10 : -10 }, spine03: { abduction: s === "l" ? 10 : -10 } }),
  knee_up: (s) => ({ [`hip_${s}`]: { flexion: 95, rotation: 0 }, [`knee_${s}`]: { flexion: 105 } }),
  knee_out: (s) => ({ [`hip_${s}`]: { flexion: 60, abduction: 60, rotation: 0 }, [`knee_${s}`]: { flexion: 100 } }),
  leg_up: (s) => ({ [`hip_${s}`]: { flexion: 100, rotation: 0 }, [`knee_${s}`]: { flexion: 10 } }),
  leg_straight: (s) => ({ [`hip_${s}`]: { flexion: 5, rotation: 0 }, [`knee_${s}`]: { flexion: 4 } }),
  leg_bent: (s) => ({ [`knee_${s}`]: { flexion: 95 } }),
  leg_out: (s) => ({ [`hip_${s}`]: { abduction: 55 } }),
  leg_back: (s) => ({ [`hip_${s}`]: { flexion: -20, rotation: 0 }, [`knee_${s}`]: { flexion: 10 } }),
  // Lying on the back, the knee up and the foot flat.
  foot_planted: (s) => ({ [`hip_${s}`]: { flexion: 55, abduction: 20, rotation: 0 }, [`knee_${s}`]: { flexion: 100 } }),
  // Both legs swung over to one side.
  legs_to: (s) => ({ [`hip_${s}`]: { abduction: 45 }, [`hip_${s === "l" ? "r" : "l"}`]: { abduction: -15 } }),
  // Lying on the front, the knee drawn out to the side and the foot up.
  frog: (s) => ({ [`hip_${s}`]: { abduction: 60, rotation: -45 }, [`knee_${s}`]: { flexion: 100 } }),
};
const spineBy = (channel, value) => ({ spine01: { [channel]: value }, spine02: { [channel]: value }, spine03: { [channel]: value } });
export const DETAILS = {
  ...Object.fromEntries(Object.entries(ARM_POSES).map(([name, shape]) => [name, shape.joints])),
  arms_behind_head: { ...both("shoulder", { flexion: 150, abduction: 60, rotation: 0 }), ...both("elbow", { flexion: 140 }) },
  arms_back: { ...both("shoulder", { flexion: -45, abduction: 15, rotation: 0 }), ...both("elbow", { flexion: 20 }) },
  arms_bent: { ...both("shoulder", { flexion: 40, abduction: 15, rotation: 0 }), ...both("elbow", { flexion: 125 }) },
  // Chin up, the head tipped back; or chin down, lifting the head of someone lying on their back.
  head_back: { neck: { flexion: 30 }, head: { flexion: 15 } },
  head_forward: { neck: { flexion: -30 }, head: { flexion: -15 } },
  arch: { ...spineBy("flexion", 10), neck: { flexion: 20 } },
  curl: spineBy("flexion", -18),
  legs_together: both("hip", { abduction: 2 }),
  legs_apart: both("hip", { abduction: 42 }),
  legs_wide: both("hip", { abduction: 62 }),
  legs_straight: { ...both("hip", { flexion: 5, rotation: 0 }), ...both("knee", { flexion: 4 }) },
  legs_bent: both("knee", { flexion: 95 }),
  knees_up: { ...both("hip", { flexion: 95, rotation: 0 }), ...both("knee", { flexion: 105 }) },
  legs_up: { ...both("hip", { flexion: 100, rotation: 0 }), ...both("knee", { flexion: 10 }) },
  legs_crossed: both("hip", { abduction: -14 }),
  // Lying on the back: folded back towards the head, knees to the chest, or raised in a wide V.
  legs_folded: { ...both("hip", { flexion: 132, abduction: 20, rotation: 0 }), ...both("knee", { flexion: 15 }) },
  knees_to_chest: { ...both("hip", { flexion: 125, abduction: 25, rotation: 0 }), ...both("knee", { flexion: 125 }) },
  legs_v: { ...both("hip", { flexion: 100, abduction: 50, rotation: 0 }), ...both("knee", { flexion: 6 }) },
  // Lying on the front: both legs raised behind.
  legs_back: { ...both("hip", { flexion: -40, rotation: 0 }), ...both("knee", { flexion: 10 }) },
  // Round a partner between the legs: the knees bent and the feet turned in behind them.
  legs_wrapped: { ...both("hip", { abduction: 40, rotation: -70 }), ...both("knee", { flexion: 90 }) },
  // Sitting: the legs out straight in front.
  legs_forward: { ...both("hip", { flexion: 85, abduction: 25, rotation: 0 }), ...both("knee", { flexion: 5 }) },
  ...Object.fromEntries(Object.entries(SIDED).flatMap(([name, make]) => Object.entries(sided(make)).map(([side, joints]) => [`${name}_${side}`, joints]))),
};

/**
 * The same details for a figure lying down, kneeling, sitting or bent forward,
 * where the body's own terms would swing a limb through the floor or the
 * partner: arms raised by someone on their back lie on the floor above the
 * head, on the front they reach out along it, a knee brought up from kneeling
 * sets the foot flat in front, and a leg raised while bent forward goes out
 * behind. Each pair of limbs is also offered one at a time.
 */
const oneSide = (table, s) => Object.fromEntries(Object.entries(table).filter(([bone]) => bone.endsWith(`_${s}`)));
const arms = (both_, one, shoulder, elbow) => {
  const table = { ...both("shoulder", shoulder), ...both("elbow", elbow) };
  return { [both_]: table, [`${one}_l`]: oneSide(table, "l"), [`${one}_r`]: oneSide(table, "r") };
};
const legs = (both_, one, hip, knee) => {
  const table = { ...both("hip", hip), ...both("knee", knee) };
  return { [both_]: table, [`${one}_l`]: oneSide(table, "l"), [`${one}_r`]: oneSide(table, "r") };
};
// Up from kneeling onto one foot, flat on the floor in front; astride, out to the side of the partner.
const halfKneel = sided((s) => ({ [`hip_${s}`]: { flexion: 90, rotation: 0 }, [`knee_${s}`]: { flexion: 100 }, [`ankle_${s}`]: { flexion: -20 } }));
const lunge = sided((s) => ({ [`hip_${s}`]: { flexion: 112, abduction: 30, rotation: 0 }, [`knee_${s}`]: { flexion: 100 }, [`ankle_${s}`]: { flexion: -10 } }));
const IN_POSTURE = {
  supine: {
    ...arms("arms_overhead", "arm_up", { flexion: 170, abduction: 20, rotation: 60 }, { flexion: 40 }),
    ...arms("arms_behind_head", "arm_head", { flexion: 150, abduction: 70, rotation: 60 }, { flexion: 130 }),
  },
  prone: {
    ...arms("arms_overhead", "arm_up", { flexion: 170, abduction: 30, rotation: 0 }, { flexion: 10 }),
    ...arms("arms_sides", "arm_down", { flexion: 0, abduction: 12, rotation: 0 }, { flexion: 5 }),
  },
  kneeling: { knee_up_l: halfKneel.l, knee_up_r: halfKneel.r },
  // On the hands with the legs straight is on the hands and toes, the legs
  // sloping down to the floor, not held out level behind with nothing under them.
  all_fours: { legs_straight: { ...both("hip", { flexion: 25, rotation: 0 }), ...both("knee", { flexion: 4 }) } },
  // Down on the forearms, the chest is too low for arms raised overhead: they
  // stretch out forward along the floor in a V instead.
  forearms_and_knees: {
    ...arms("arms_overhead", "arm_up", { flexion: 170, abduction: 60, rotation: 0 }, { flexion: 0 }),
    // Bent further at the knees than the posture's own, the feet come up off the floor behind.
    legs_bent: both("knee", { flexion: 105 }),
  },
  kneeling_straddle: { knee_up_l: lunge.l, knee_up_r: lunge.r },
  // Sitting on the floor the knees come up past the hips, or the shins would go into it.
  seated_floor: legs("knees_up", "knee_up", { flexion: 130, abduction: 30, rotation: 0 }, { flexion: 120 }),
  // Bent forward, a leg raised goes out behind and to the side as far as the hip
  // allows, not forward and down under the chest.
  standing_bent_forward: legs("legs_up", "leg_up", { flexion: -25, abduction: 70, rotation: 0 }, { flexion: 5 }),
};
IN_POSTURE.supine_legs_raised = IN_POSTURE.supine;
IN_POSTURE.seated_reclined = IN_POSTURE.seated_floor;

// On the feet, legs apart are a stance, not the splits: spread as wide as
// lying down, one foot comes off the floor and the figure stands on the other
// alone. On the knees, the thighs swing up as they part, and the knees with
// them, off the floor.
const stanceApart = (apart, wide) => ({ legs_apart: both("hip", { abduction: apart }), legs_wide: both("hip", { abduction: wide }) });
const kneesApart = stanceApart(20, 30);

/** The legs' details for a figure on its feet or knees (see `stanceDetail`). */
const STANCE = {
  // Standing with the knees bent is bent at the hips and ankles as well, the
  // feet flat under the body: bent at the knees alone the shins swing up
  // behind, and the figure kneels on nothing.
  standing: { legs_bent: { ...both("hip", { flexion: 30, rotation: 0 }), ...both("knee", { flexion: 55 }), ...both("ankle", { flexion: -25 }) }, ...stanceApart(20, 30) },
  squatting: stanceApart(28, 36),
  standing_bent_forward: stanceApart(20, 30),
  kneeling: kneesApart,
  kneeling_low: kneesApart,
  all_fours: kneesApart,
  forearms_and_knees: kneesApart,
};

/** A detail's joint targets for a figure in the given posture. */
export const detailFor = (name, posture) => IN_POSTURE[posture]?.[name] ?? DETAILS[name];

// How much further a leg detail takes a figure already crouched or spread by
// its own joints: a little more than shows at a glance (`VISIBLE.joint` in scene-distance.mjs).
const FURTHER = 25;

/**
 * A leg detail for a figure on its feet or knees, or nothing for one the detail
 * does not stand on. A figure already crouched or spread by its own hip joints
 * is taken further: crouched deeper at the hips, knees and ankles together, so
 * the feet stay flat under it, or spread wider.
 */
function stanceDetail(name, spec) {
  const detail = STANCE[spec.posture]?.[name];
  const own = { ...spec.joints, ...spec.override };
  if (!detail || !own.hip_l) return detail;
  const further = (bone, channel, by) => {
    const value = (own[bone]?.[channel] ?? 0) + by;
    return by > 0 ? Math.max(detail[bone][channel], value) : Math.min(detail[bone][channel], value);
  };
  return Object.fromEntries(
    ["l", "r"].flatMap((s) =>
      name === "legs_bent"
        ? [
            [`hip_${s}`, { flexion: further(`hip_${s}`, "flexion", FURTHER), rotation: 0 }],
            [`knee_${s}`, { flexion: further(`knee_${s}`, "flexion", 35) }],
            // Up on the toes, the heels stay up.
            ...((own[`ankle_${s}`]?.flexion ?? 0) > 0 ? [] : [[`ankle_${s}`, { flexion: further(`ankle_${s}`, "flexion", -15) }]]),
          ]
        : [[`hip_${s}`, { abduction: further(`hip_${s}`, "abduction", FURTHER) }]],
    ),
  );
}

/** How far a partner is turned from where the template put them, by name. */
export const TURNS = { turn_l: 30, turn_r: -30 };

/** Lay a record's `a_pose`/`b_pose`/`c_pose` details over its plan. */
function withDetails(plan, cls) {
  const roles = { ...(plan.roles ?? { a: 0 }), ...(plan.thirdIndex != null ? { c: plan.thirdIndex } : {}) };
  let out = plan;
  for (const [role, index] of Object.entries(roles)) {
    const names = cls[`${role}_pose`];
    if (!names?.length) continue;
    let yaw = 0;
    for (const name of names) {
      if (TURNS[name] != null) yaw += TURNS[name];
      else if (!DETAILS[name]) throw new Error(`${cls.id}: unknown ${role}_pose detail ${name}`);
    }
    // Turned over, a figure posed standing has its feet in the air.
    const onFeet = !(out.place ?? []).some((move) => move.index === index && Math.abs(move.pitch ?? 0) >= 90);
    // Kneeling astride a partner's legs, the legs are as far apart as the detail asks already.
    const apart = (plan.apart ?? []).includes(role);
    const detail = (spec) => {
      const stances = names.map((name) => (apart && (name === "legs_apart" || name === "legs_wide") ? {} : onFeet ? stanceDetail(name, spec) : null));
      return { ...spec, details: mergeJoints(spec.details, ...names.map((name, k) => (TURNS[name] == null ? (stances[k] ?? detailFor(name, spec.posture)) : null))) };
    };
    const actors = out.actors.slice();
    actors[index] = Array.isArray(actors[index]) ? actors[index].map(detail) : detail(actors[index]);
    out = { ...out, actors };
    if (yaw) {
      if (index === plan.thirdIndex) out = { ...out, thirdPlace: { ...out.thirdPlace, yaw } };
      else {
        // Turned before it is fitted, about its own root, so the fit still brings it to its partner.
        const place = out.place ?? [];
        const last = place.map((move) => move.index).lastIndexOf(index);
        out = { ...out, place: [...place.slice(0, last + 1), { index, yaw }, ...place.slice(last + 1)] };
      }
    }
  }
  return out;
}

/**
 * The hands a record puts down on what the figure is on: B's, where it says
 * B's hands are on the surface or braced behind - but not an arm B's details
 * draw some other way, put forward, round the partner, behind the head - and
 * any role's whose arm details plant them. The composer puts them there
 * (`plantHands`).
 */
const PLANTED_DETAILS = { arms_planted: "down", arms_braced_behind: "behind" };
const PLANTED_HANDS = { surface: "down", behind: "behind" };
const rolesOf = (plan) => ({ ...(plan.roles ?? { a: 0, ...(plan.actors.length > 1 ? { b: 1 } : {}) }), ...(plan.thirdIndex != null ? { c: plan.thirdIndex } : {}) });
function withPlants(plan, cls) {
  const roles = rolesOf(plan);
  const plant = [];
  const drawn = (cls.b_pose ?? []).filter((name) => !PLANTED_DETAILS[name]);
  const sides = ["l", "r"].filter((side) => !armPosed(drawn, side));
  if (PLANTED_HANDS[cls.b_hands] && roles.b != null && sides.length) plant.push({ index: roles.b, where: PLANTED_HANDS[cls.b_hands], ...(sides.length === 1 ? { side: sides[0] } : {}) });
  for (const [role, index] of Object.entries(roles))
    for (const name of cls[`${role}_pose`] ?? []) if (PLANTED_DETAILS[name] && !plant.some((p) => p.index === index)) plant.push({ index, where: PLANTED_DETAILS[name] });
  return plant.length ? { ...plan, plant } : plan;
}

/**
 * The hands a record reaches towards the partner with: arms put forward or
 * round them. A hand the reach leaves short of the partner is laid on them
 * (`restFreeHands`), not left in the air where the arm was put.
 */
const REACHING_DETAILS = { arms_forward: null, arms_around: null, arm_forward_l: "l", arm_forward_r: "r" };
function withReaches(plan, cls) {
  const reach = [];
  for (const [role, index] of Object.entries(rolesOf(plan)))
    for (const name of cls[`${role}_pose`] ?? []) if (name in REACHING_DETAILS) reach.push({ index, ...(REACHING_DETAILS[name] ? { side: REACHING_DETAILS[name] } : {}) });
  return reach.length ? { ...plan, reach } : plan;
}

/**
 * The hands a record holds up: over the head, behind it, on the straps. Every
 * other free hand the pose leaves in the air is laid on whatever it reaches
 * (`restFreeHands`); these stay up - those behind the head (`head`) on the
 * back of it.
 */
const RAISED_DETAILS = {
  arms_overhead: {}, arms_behind_head: { head: true }, arms_straps: {},
  arm_up_l: { side: "l" }, arm_up_r: { side: "r" }, arm_head_l: { side: "l", head: true }, arm_head_r: { side: "r", head: true },
};
function withRaised(plan, cls) {
  const raised = [];
  for (const [role, index] of Object.entries(rolesOf(plan)))
    for (const name of cls[`${role}_pose`] ?? []) if (name in RAISED_DETAILS) raised.push({ index, ...RAISED_DETAILS[name] });
  return raised.length ? { ...plan, raised } : plan;
}

/**
 * The figures whose hands are tied - in cuffs, or as the template ties them
 * (`bound`) - which stay where the arms were put: nothing puts them down or
 * lays them on anything.
 */
function withBound(plan, cls) {
  const bound = new Set(plan.bound ?? []);
  for (const [role, index] of Object.entries(rolesOf(plan))) if ((cls[`${role}_wear`] ?? []).includes("cuffs")) bound.add(index);
  return bound.size ? { ...plan, bound: [...bound] } : plan;
}

/**
 * Plan for any classification record, including solo and three-person scenes,
 * with its details laid on. A plan may carry a `retry`: the same scene laid out
 * another way, for when the first fails its checks.
 */
export function planFor(cls) {
  const plan = basePlan(cls);
  const laid = (p) => withBound(withRaised(withReaches(withPlants(withDetails(p, cls), cls), cls), cls), cls);
  return plan.retry ? { ...laid(plan), retry: laid(plan.retry) } : laid(plan);
}

function basePlan(cls) {
  if (cls.template === "solo") {
    const posture = SOLO[cls.solo_posture] ?? "standing";
    // Sitting on the floor itself, the knees up in front.
    if (posture === "seated" && cls.surface === "floor")
      return { surface: "floor", mode: "fit", roles: { a: 0 }, actors: [figure(cls.a_body, "seated_floor", { joints: KNEES_UP(45) })], fit: [], contacts: [], checks: [] };
    // At a desk, on the chair drawn up to the table and facing it.
    if (posture === "seated" && cls.surface === "table_chair")
      return { surface: "table_chair", mode: "fit", roles: { a: 0 }, actors: [figure(cls.a_body, "seated", { soloSurface: "chair", override: both("knee", { flexion: 75 }) })], place: [{ index: 0, yaw: 180, pelvisTo: [0, null, TABLE_CHAIR.z + 0.25] }], fit: [], contacts: [], checks: [] };
    if (posture === "seated") {
      const surface = pickSurface(cls, ["chair", "sofa", "bench", "bed", "table"], "chair");
      // Astride the chair the wrong way round, facing its back, the knees out past its sides.
      if (surface === "chair" && has(cls, /facing its back/)) {
        const override = { ...both("hip", { flexion: 80, abduction: 50, rotation: 0 }), ...both("knee", { flexion: 95 }) };
        return { surface, mode: "fit", roles: { a: 0 }, actors: [figure(cls.a_body, "seated", { soloSurface: "chair", override })], place: [{ index: 0, yaw: 180, pelvisTo: [0, null, 0.02] }], fit: [], contacts: [], checks: [] };
      }
      const seat = seatedAt(surface, cls.a_body);
      return { surface, mode: "fit", roles: { a: 0 }, actors: [seat.spec], place: [seat.place], fit: [], contacts: [], checks: [] };
    }
    // Hogtied: face down, the knees bent to bring the feet up over the
    // buttocks and the arms back along the body to the ankles.
    if (posture === "prone" && has(cls, /hogtie/)) {
      const joints = { ...both("shoulder", { flexion: -30, abduction: 4 }), ...both("elbow", { flexion: 10 }), ...both("hip", { flexion: -5, abduction: 10, rotation: 0 }), ...both("knee", { flexion: 135 }) };
      return { surface: lying(cls, "floor"), mode: "fit", roles: { a: 0 }, bound: [0], actors: [figure(cls.a_body, posture, { joints })], fit: [], contacts: [], checks: [] };
    }
    // Curled up on the side, the knees drawn up to the chest.
    if (posture === "side_lying" && has(cls, /curled/)) {
      const joints = { ...both("hip", { flexion: 95, abduction: 4, rotation: 0 }), ...both("knee", { flexion: 115 }) };
      return { surface: lying(cls, "floor"), mode: "fit", roles: { a: 0 }, actors: [figure(cls.a_body, posture, { joints })], fit: [], contacts: [], checks: [] };
    }
    // Spread-eagle: flat on the back, the arms and legs out wide.
    if (posture === "supine" && has(cls, /spread/))
      return { surface: lying(cls, "floor"), mode: "fit", roles: { a: 0 }, actors: [figure(cls.a_body, posture, { arms: "arms_out", joints: structuredClone(LEG_SHAPES.straight_apart) })], fit: [], contacts: [], checks: [] };
    // Face down, the chest up on the forearms and one knee drawn up to the side.
    if (posture === "prone" && has(cls, /on forearms/)) {
      const override = {
        spine01: { flexion: 12 },
        spine02: { flexion: 12 },
        spine03: { flexion: 12 },
        ...both("shoulder", { flexion: 45, abduction: 14, rotation: 0 }),
        ...both("elbow", { flexion: 90 }),
        ...(has(cls, /knee drawn up/) ? { hip_l: { flexion: 15, abduction: 70, rotation: -90 }, knee_l: { flexion: 95 } } : {}),
      };
      // The hips up on a pillow, let down onto it with the elbows and knees on the floor.
      if (cls.surface === "pillow")
        return {
          surface: "pillow",
          mode: "fit",
          roles: { a: 0 },
          actors: [figure(cls.a_body, posture, { soloSurface: "floor", override })],
          place: [{ index: 0, pelvisTo: [0, 0.4, 0] }],
          fit: [{ moving: 0, free: ["y"], pitchRange: 15, pivot: "pelvis", floor: 0, snap: false, anchors: [...floorAnchors(0, "elbow", 0.5), ...floorAnchors(0, "knee", 0.5), { from: "groin", fromActor: 0, point: [0, SEATS.pillow.top, 0], weight: 0.5, axes: [1] }] }],
          contacts: [],
          checks: [],
        };
      return { surface: lying(cls, "floor"), mode: "fit", roles: { a: 0 }, actors: [figure(cls.a_body, posture, { override })], fit: [], contacts: [], checks: [] };
    }
    // Face up in a sling, the hips at its lower end and the legs up either side
    // of the chains, the arms up past the head.
    if (cls.surface === "sling")
      return {
        surface: "sling",
        mode: "fit",
        roles: { a: 0 },
        actors: [figure(cls.a_body, posture, { soloSurface: "floor", override: { ...both("hip", { flexion: 115, abduction: 40, rotation: 0 }), ...both("knee", { flexion: 35 }) } })],
        place: [{ index: 0, rest: SEATS.sling.top, pelvisTo: [0, null, -0.28] }],
        fit: [],
        contacts: [],
        checks: [],
      };
    // Kneeling up with the arms up and apart, the wrists at the ends of a
    // spreader bar hung above.
    if (cls.surface === "spreader_bar")
      return {
        surface: "spreader_bar",
        mode: "fit",
        roles: { a: 0 },
        actors: [figure(cls.a_body, posture, { override: { ...both("shoulder", { flexion: 165, abduction: 40, rotation: 0 }), ...both("elbow", { flexion: 5 }) } })],
        fit: [],
        contacts: [],
        checks: [],
      };
    // Lying back with the hips up against an exercise ball, the shoulders and
    // head on the floor beyond it, one leg stretched up over the ball and the
    // other bent, the foot down past its side. One hand is behind the head,
    // the other arm out along the floor.
    if (posture === "supine" && has(cls, /ball/))
      return {
        surface: "ball",
        mode: "fit",
        roles: { a: 0 },
        actors: [
          figure(cls.a_body, "supine", {
            soloSurface: "floor",
            override: {
              hip_l: { flexion: 70, abduction: 10, rotation: 0 },
              knee_l: { flexion: 15 },
              hip_r: { flexion: 45, abduction: 25, rotation: 0 },
              knee_r: { flexion: 100 },
              shoulder_l: { flexion: 110, abduction: 70, rotation: 0 },
              elbow_l: { flexion: 140 },
              shoulder_r: { flexion: -60, abduction: 35, rotation: 0 },
              elbow_r: { flexion: 10 },
            },
          }),
        ],
        place: [{ index: 0, pitch: 0, pelvisTo: [0, 0.8, 0.35] }],
        fit: [
          {
            moving: 0,
            free: ["y", "z"],
            pitchRange: 45,
            pivot: "pelvis",
            floor: 0,
            snap: false,
            anchors: [
              { from: "upperBack", fromActor: 0, point: [0, 0.03, 0], weight: 0.6, axes: [1] },
              { from: "buttocks", fromActor: 0, point: [0, 0.38, 0.3], weight: 1.2, axes: [1, 2] },
            ],
          },
        ],
        contacts: [],
        checks: [],
      };
    // Or the wrists held up overhead, by a bar or strap.
    const arms = has(cls, /arms up/) ? { arms: "arms_overhead" } : {};
    return { surface: lying(cls, "floor"), mode: "fit", roles: { a: 0 }, actors: [figure(cls.a_body, posture, arms)], fit: [], contacts: [], checks: [] };
  }
  if (cls.template === "group_three") {
    const base = TEMPLATES[cls.base] ?? TEMPLATES.side_facing;
    return withThird(base.plan({ ...cls, template: cls.base }), cls);
  }
  return (TEMPLATES[cls.template] ?? TEMPLATES.other_pair).plan(cls);
}

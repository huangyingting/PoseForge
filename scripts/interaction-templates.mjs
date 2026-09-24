/**
 * Interaction templates: from a visual classification to a composer plan.
 *
 * Each template is one family of positions. Role `a` is the lower, receiving
 * or front partner and role `b` the other, as in docs/interaction-templates.md.
 * Variant fields (a_legs, lean, b_hands, surface) adjust the plan. The composer
 * (scripts/interaction-composer.mjs) turns a plan into fixed scene data, and
 * `checks` say what the result must satisfy to count as this template.
 */

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

// Knees set apart so a partner can kneel between them.
const KNEES_APART = { override: { ...both("hip", { abduction: 30 }) } };

const ORAL_LEGS = { straight: "straight_apart", together_bent: "open_bent" };
const SEATED_OPEN = { ...both("hip", { flexion: 80, abduction: 60, rotation: 0 }), ...both("knee", { flexion: 80 }) };
const SEATED_WRAP = { ...both("hip", { flexion: 108, abduction: 52, rotation: 0 }), ...both("knee", { flexion: 95 }) };

const TRUNK = { forward: "forward_leaning", back: "backward_leaning" };
const trunkOf = (lean) => (TRUNK[lean] ? { trunk: TRUNK[lean] } : {});

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

const pickSurface = (cls, allowed, fallback) => (allowed.includes(cls.surface) ? cls.surface : fallback);
const lying = (cls, fallback = "bed") => pickSurface(cls, ["floor", "bed"], cls.surface === "sofa" || cls.surface === "bench" ? "bed" : fallback);

// Seats: the front edge (z, the seat faces +z) and the seat height.
export const SEATS = {
  chair: { z: 0.25, top: 0.46 },
  sofa: { z: 0.475, top: 0.45 },
  bench: { z: 0.21, top: 0.45 },
  bed: { z: 1.0, top: 0.55 },
  table: { z: 0.4, top: 0.75 },
};
const surfaceTop = (surface) => SEATS[surface]?.top ?? 0;

/** Seated at a seat's front edge facing +z: posed on the chair, then carried there. */
function seatedAt(surface, body, extra = {}, index = 0) {
  const seat = SEATS[surface] ?? SEATS.chair;
  return {
    spec: figure(body, "seated", { soloSurface: "chair", ...extra }),
    place: { index, seatOn: { top: seat.top, z: seat.z } },
  };
}

/** Standing or kneeling in front of something, by whichever height fits best. */
function frontCandidates(body, { oral = false, lean = null } = {}) {
  const trunk = oral ? { trunk: "forward_leaning" } : trunkOf(lean === "forward" ? "forward" : null);
  const list = [
    figure(body, "standing", { ...trunk, soloSurface: "floor" }),
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
  const bSpec = figure(cls.b_body, bPosture, bPosture === "prone" && cls.lean === "upright" ? { arms: "arms_planted" } : bPosture === "prone" ? { arms: "arms_forearms" } : {});
  return {
    surface,
    mode: "solver",
    roles: { a: 0, b: 1 },
    actors: [figure(cls.a_body, "supine", legsOf(cls, legs)), bSpec],
    relationship: { arrangement: "over_supine" },
    fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, extra: [{ from: "chest", fromActor: 1, to: "chest", toActor: 0, weight: 0.15 }] })],
    contacts: [grip("groin", "groin", 1, 0, "surface"), grip("chest", "chest", 1, 0, "surface")],
    checks: ["aFaceUp", "bFaceDown", "faceToFace", "bAbove", near("b", "groin", "a", "groin", 0.16)],
  };
}

function straddlePlan(cls, posture, yaw) {
  const surface = lying(cls);
  // Hands on the partner's legs in front means leaning towards them.
  const lean = cls.lean === "forward" ? { trunk: "forward_lowered" } : cls.lean === "back" ? { trunk: "backward_leaning" } : yaw && cls.b_hands === "legs" ? { trunk: "forward_leaning" } : {};
  return {
    surface,
    mode: "solver",
    roles: { a: 0, b: 1 },
    // Bent knees in front of the rider would hold them off the hips, so they lie flat.
    actors: [figure(cls.a_body, "supine", yaw ? legsOf({ a_legs: ["open_bent", "together_bent", "wrapped"].includes(cls.a_legs) ? "straight" : cls.a_legs }, "straight") : { joints: structuredClone(LEG_SHAPES.straight) }), figure(cls.b_body, posture, lean)],
    relationship: yaw ? { arrangement: "straddle_supine", yaw } : { arrangement: "straddle_supine" },
    limbContacts: cls.b_hands === "surface" || cls.b_hands === "behind" ? [] : cls.b_hands === "legs" ? handsTo(1, 0, yaw ? "knee" : "thigh", !yaw) : cls.lean === "forward" ? handsTo(1, 0, "shoulder", !yaw) : [],
    fit: [refine(1, "groin", 1, "groin", 0)],
    contacts: [grip("groin", "groin", 1, 0, "surface")],
    checks: ["aFaceUp", "bAbove", yaw ? "reversed" : "straddleFacing", near("b", "groin", "a", "groin", 0.2)],
  };
}

function rearPlan(cls, surface, aSpec, bSpec, arrangement, { upright = false } = {}) {
  // Kneeling and standing rear-entry positions are placed directly: both face
  // +z and B is brought up behind A. Bent-over ones use the library arrangement.
  const direct = arrangement === "rear_alignment";
  return {
    surface,
    mode: direct ? "fit" : "solver",
    roles: { a: 0, b: 1 },
    actors: [aSpec, bSpec],
    relationship: { arrangement },
    fit: [refine(1, "groin", 1, "pelvis", 0, direct ? { start: [0, 0, -0.3] } : {})],
    limbContacts: cls.b_hands === "embrace" ? handsToCentre(1, 0, "abdomen") : cls.b_hands === "surface" || cls.b_hands === "behind" ? [] : bHands(cls, 1, 0, { face: false }),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameFacing", "bBehind", ...(upright ? ["aUpright"] : []), "bUpright", near("b", "groin", "a", "pelvis", 0.24)],
  };
}

/** Lying or sitting at the edge of a raised surface, the partner on the floor in front. */
function edgePlan(cls, surface, aPosture, { legs, lean = null, oral = false }) {
  const legShape = LEG_SHAPES[legs] ? { joints: structuredClone(LEG_SHAPES[legs]) } : {};
  let a;
  let aPlace;
  let bYaw = 180;
  const seated = aPosture === "seated" || surface === "chair";
  if (seated) {
    const seat = seatedAt(
      surface,
      cls.a_body,
      // A solid seat base (sofa, bed, bench) leaves no room under it: the feet go forward.
      oral
        ? { override: { ...structuredClone(SEATED_OPEN), ...(surface === "chair" ? {} : both("knee", { flexion: 55 })), spine01: { flexion: 15 }, spine02: { flexion: 12 } }, trunk: "backward_leaning" } 
        : { override: { ...structuredClone(SEATED_WRAP), spine01: { flexion: 15 }, spine02: { flexion: 12 } }, trunk: "backward_leaning", arms: "arms_braced_behind" }
    );
    a = seat.spec;
    aPlace = seat.place;
  } else if (surface === "bench") {
    // A bench runs along x: lie along it with the hips at one end.
    a = figure(cls.a_body, "supine", { ...legShape, soloSurface: "bench" });
    aPlace = { index: 0, yaw: -90, pelvisTo: [0.64, null, 0] };
    bYaw = -90;
  } else {
    a = figure(cls.a_body, "supine", { ...legShape, soloSurface: surface });
    aPlace = { index: 0, yaw: 180, pelvisTo: [0, null, SEATS[surface].z - 0.06] };
  }
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    // Seated face to face, a partner leaning in would meet the chest before the hips.
    actors: [a, frontCandidates(cls.b_body, { oral, lean: seated ? null : lean })],
    place: [aPlace, { index: 1, yaw: bYaw }],
    // For oral, B may tip forward from the knees to bring the head down.
    // B starts just outside, on its own side, and works in.
    fit: [{ ...refine(1, oral ? "mouth" : "groin", 1, "groin", 0, { start: bYaw === -90 ? [0.3, 0, 0] : [0, 0, 0.3] }), ...(oral ? { pitchRange: 25, pivot: "knee" } : {}) }],
    limbContacts: oral ? [] : bHands(cls, 1, 0, { fallback: legs === "raised" || legs === "on_shoulders" ? "legs" : "hips" }),
    contacts: [oral ? grip("mouth", "groin", 1, 0, "surface") : grip("groin", "groin", 1, 0, "surface")],
    checks: oral
      ? ["facingInward", near("b", "mouth", "a", "groin", seated ? 0.27 : 0.2)]
      : [seated ? "aUpright" : "aFaceUp", "bUpright", "facingInward", near("b", "groin", "a", "groin", 0.3)],
  };
}

/** Kneeling on a bed or sofa edge with the chest down, partner standing behind. */
function edgeRearPlan(cls, surface) {
  const seat = SEATS[surface];
  return {
    surface,
    mode: "fit",
    roles: { a: 0, b: 1 },
    // Knees apart at the front edge, head towards the back; B stands between A's feet facing the same way.
    actors: [figure(cls.a_body, cls.lean === "upright" ? "all_fours" : "forearms_and_knees", { soloSurface: surface, override: both("hip", { abduction: 34 }) }), frontCandidates(cls.b_body, { lean: cls.lean })],
    place: [{ index: 0, yaw: 180, alignTo: null, pelvisTo: [0, null, seat.z - (surface === "bed" ? 0.09 : 0.16)] }, { index: 1, yaw: 180 }],
    fit: [refine(1, "groin", 1, "pelvis", 0, { start: [0, 0, 0.3] })],
    limbContacts: cls.b_hands === "surface" ? [] : bHands(cls, 1, 0, { face: false }),
    contacts: [grip("groin", "buttocks", 1, 0, "surface")],
    checks: ["sameHeading", "bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.28)],
  };
}

/** Lap positions, on the floor or on any seat (posed on a chair, then carried to the seat). */
const LAP_WRAP = {
  hip_l: { flexion: 65, abduction: 70, rotation: 0 },
  hip_r: { flexion: 65, abduction: 70, rotation: 0 },
  knee_l: { flexion: 95 },
  knee_r: { flexion: 95 },
};

const FLAT_LEGS = {
  hip_l: { flexion: 35, abduction: 12 },
  hip_r: { flexion: 35, abduction: 12 },
  knee_l: { flexion: 8 },
  knee_r: { flexion: 8 },
};

// On the floor A's legs wrap around B's waist instead of hanging down.
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
const LEAN_BACK = { spine01: { flexion: 15 }, spine02: { flexion: 12 }, hip_l: { abduction: 4 }, hip_r: { abduction: 4 } };

function lapPlan(cls, reverse) {
  const surface = pickSurface(cls, ["floor", "chair", "sofa", "bed", "bench"], reverse ? "chair" : "floor");
  const onFloor = surface === "floor";
  const seat = onFloor ? (reverse || cls.lean === "back" || cls.b_hands === "behind" ? "seated_reclined" : "seated_floor") : "seated";
  const aTrunk = reverse ? trunkOf(cls.lean === "forward" ? "forward" : null) : trunkOf(cls.lean === "back" ? "back" : null);
  const hands = cls.b_hands === "behind" || cls.b_hands === "surface" ? [] : cls.b_hands === "embrace" ? handsToCentre(0, 1, reverse ? "abdomen" : "upperBack") : handsTo(0, 1, "hip", !reverse);
  const target = SEATS[surface];
  return {
    surface,
    solveSurface: onFloor ? "floor" : "chair",
    mode: "solver",
    roles: { a: 1, b: 0 },
    // Facing: A's knees open around B's waist. Reverse: B reclines slightly so A's back clears B's chest.
    actors: [
      figure(cls.b_body, seat, reverse && onFloor ? { override: FLAT_LEGS } : { override: LEAN_BACK }),
      figure(cls.a_body, "seated_straddle", { ...(reverse && !aTrunk.trunk ? { trunk: "forward_leaning" } : aTrunk), ...(reverse ? (onFloor ? {} : { override: LAP_ASTRIDE }) : { override: onFloor ? LAP_WRAP_FLOOR : LAP_WRAP }) }),
    ],
    relationship: reverse ? { arrangement: "straddle_lap", yaw: 0 } : { arrangement: "straddle_lap" },
    place: onFloor ? [{ index: 0, rest: 0 }] : [0, 1].map((index) => ({ index, seatOn: { top: target.top, z: target.z } })),
    fit: [refine(1, reverse ? "buttocks" : "groin", 1, reverse ? "groin" : "groin", 0, { free: ["x", "y", "z"], keep: false, floor: 0 })],
    limbContacts: hands,
    contacts: [grip(reverse ? "buttocks" : "groin", "groin", 1, 0, "surface")],
    checks: [reverse ? "sameFacing" : "faceToFace", "aAboveOrLevel", near("a", reverse ? "buttocks" : "groin", "b", "groin", reverse ? 0.25 : 0.27)],
  };
}

export const TEMPLATES = {
  missionary: { label: "Face to face, one partner above", plan: (cls) => faceToFaceLying(cls, "prone") },
  prone_on_top: { label: "Lying flat, chest to chest", plan: (cls) => faceToFaceLying(cls, "prone", { legs: "straight" }) },
  kneeling_missionary: {
    label: "Face to face, kneeling between the legs",
    plan(cls) {
      const surface = lying(cls, "floor");
      const legs = cls.a_legs === "straight" ? "open_bent" : cls.a_legs ?? "raised";
      return {
        surface,
        mode: "fit",
        roles: { a: 0, b: 1 },
        // B kneels at A's feet facing A's head and slides in between A's knees.
        actors: [
          figure(cls.a_body, "supine", { soloSurface: surface, override: structuredClone(LEG_SHAPES[legs]) }),
          ["kneeling", "kneeling_low"].map((posture, i) =>
            figure(cls.b_body, posture, { ...trunkOf(cls.lean === "forward" ? "forward" : null), soloSurface: surface, override: both("hip", { abduction: 6 }), prefer: i * 0.004 })
          ),
        ],
        // Then A's hips tilt up onto B's thighs, pivoting at the shoulders.
        fit: [
          refine(1, "groin", 1, "groin", 0, { start: [0, 0, -0.35] }),
          { moving: 0, free: [], keep: false, floor: surfaceTop(surface), pitchRange: 24, pivot: "upperBack", anchors: [{ from: "groin", fromActor: 0, to: "groin", toActor: 1, offset: [0, 0, 0], weight: 1 }] },
        ],
        limbContacts: bHands(cls, 1, 0, { fallback: legs === "raised" || legs === "on_shoulders" ? "legs" : "hips" }),
        contacts: [grip("groin", "groin", 1, 0, "surface")],
        checks: ["aFaceUp", "bUpright", "facingInward", near("b", "groin", "a", "groin", 0.25)],
      };
    },
  },
  edge_missionary: {
    label: "At the edge, partner in front between the legs",
    plan(cls) {
      const surface = pickSurface(cls, ["bed", "sofa", "table", "bench", "chair"], "bed");
      return edgePlan(cls, surface, "supine", { legs: cls.a_legs ?? "raised", lean: cls.lean });
    },
  },
  edge_seated_facing: {
    label: "Seated on an edge, partner in front between the legs",
    plan(cls) {
      const surface = pickSurface(cls, ["table", "bed", "sofa", "chair", "bench"], "table");
      return edgePlan(cls, surface, "seated", { legs: cls.a_legs ?? "wrapped", lean: cls.lean });
    },
  },
  cowgirl: { label: "Astride, facing the partner lying down", plan: (cls) => straddlePlan(cls, "kneeling_straddle", 0) },
  squat_cowgirl: { label: "Squatting astride, facing the partner", plan: (cls) => straddlePlan(cls, "squatting", 0) },
  reverse_cowgirl: { label: "Astride, facing the partner's feet", plan: (cls) => straddlePlan(cls, "kneeling_straddle", 180) },
  sixty_nine: {
    label: "Head to toe",
    plan(cls) {
      const surface = lying(cls);
      const side = /side/.test(cls.notes ?? "");
      const both69 = { extra: [{ from: "groin", fromActor: 1, to: "mouth", toActor: 0, weight: 1 }] };
      if (side)
        return {
          surface,
          mode: "solver",
          roles: { a: 0, b: 1 },
          actors: [figure(cls.a_body, "side_lying"), figure(cls.b_body, "side_lying")],
          relationship: { arrangement: "head_to_toe" },
          fit: [refine(1, "mouth", 1, "groin", 0, { free: ["x", "y", "z"], keep: true, ...both69 })],
          contacts: [grip("mouth", "groin", 1, 0, "surface"), grip("groin", "mouth", 1, 0, "surface")],
          checks: ["reversed", near("b", "mouth", "a", "groin", 0.25), near("a", "mouth", "b", "groin", 0.3)],
        };
      // B on hands or forearms and knees above A, head to toe, knees astride A's head.
      const wide = { override: both("hip", { abduction: 32 }), soloSurface: surface };
      return {
        surface,
        mode: "fit",
        roles: { a: 0, b: 1 },
        actors: [
          figure(cls.a_body, "supine", { ...legsOf(cls, "open_bent"), soloSurface: surface }),
          [
            figure(cls.b_body, "forearms_and_knees", wide),
            figure(cls.b_body, "all_fours", { ...wide, prefer: cls.lean === "upright" ? -0.002 : 0.002 }),
            figure(cls.b_body, "prone", { soloSurface: surface, arms: "arms_forearms", prefer: 0.003 }),
          ],
        ],
        place: [{ index: 1, yaw: 180 }],
        fit: [{ ...refine(1, "mouth", 1, "groin", 0, { free: ["x", "y", "z"], keep: false, floor: surfaceTop(surface), ...both69 }), pitchRange: 15 }],
        contacts: [grip("mouth", "groin", 1, 0, "surface"), grip("groin", "mouth", 1, 0, "surface")],
        checks: ["reversed", near("b", "mouth", "a", "groin", 0.25), near("a", "mouth", "b", "groin", 0.3)],
      };
    },
  },
  side_facing: {
    label: "Side by side, face to face",
    plan(cls) {
      return {
        surface: lying(cls),
        mode: "fit",
        roles: { a: 0, b: 1 },
        // A's upper leg drapes over B's hip; B's legs slide between A's.
        // B is the mirror image, lying on the other side facing A.
        actors: [
          figure(cls.a_body, "side_lying", { soloSurface: lying(cls), override: { hip_top: { flexion: 80, abduction: 42, rotation: 0 }, knee_top: { flexion: 70 }, hip_bottom: { flexion: 0, abduction: 0 }, knee_bottom: { flexion: 5 } } }),
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
      return {
        surface: lying(cls),
        mode: "solver",
        roles: { a: 0, b: 1 },
        actors: [figure(cls.a_body, "side_lying", cls.a_legs === "one_raised" || cls.a_legs === "raised" ? { legs: "legs_one_raised" } : {}), figure(cls.b_body, "side_lying")],
        relationship: { arrangement: "spooning" },
        fit: [refine(1, "groin", 1, "buttocks", 0)],
        limbContacts: cls.b_hands === "embrace" ? [grip("hand.l", "abdomen", 1, 0, "rest")] : [],
        contacts: [grip("groin", "buttocks", 1, 0, "surface")],
        checks: ["sameHeading", "bAtBack", near("b", "groin", "a", "buttocks", 0.18)],
      };
    },
  },
  scissors: {
    label: "Crossed at an angle, legs interlaced",
    plan(cls) {
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
    plan: (cls) => rearPlan(cls, lying(cls, "floor"), figure(cls.a_body, "all_fours", KNEES_APART), figure(cls.b_body, "kneeling", trunkOf(cls.lean === "forward" ? "forward" : null)), "rear_alignment"),
  },
  doggy_low: {
    label: "Chest lowered, partner kneeling behind",
    plan: (cls) => rearPlan(cls, lying(cls, "floor"), figure(cls.a_body, "forearms_and_knees", KNEES_APART), figure(cls.b_body, "kneeling", trunkOf(cls.lean === "upright" ? null : "forward")), "rear_alignment"),
  },
  kneeling_rear_upright: {
    label: "Both kneeling upright, chest to back",
    plan: (cls) => rearPlan(cls, lying(cls, "floor"), figure(cls.a_body, "kneeling", KNEES_APART), figure(cls.b_body, "kneeling"), "rear_alignment", { upright: true }),
  },
  standing_rear: {
    label: "Both standing, one behind",
    plan: (cls) => rearPlan(cls, "floor", figure(cls.a_body, "standing", trunkOf(cls.lean === "forward" ? "forward" : null)), figure(cls.b_body, "standing"), "rear_alignment", { upright: cls.lean !== "forward" }),
  },
  standing_bent_over: {
    label: "Bent forward, partner standing behind",
    plan(cls) {
      const plan = rearPlan(cls, "floor", figure(cls.a_body, "standing_bent_forward"), figure(cls.b_body, "standing"), "behind_bent_over");
      return { ...plan, checks: ["bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.24)] };
    },
  },
  furniture_rear: {
    label: "Leaning over furniture, partner behind",
    plan(cls) {
      const surface = pickSurface(cls, ["table", "bed", "sofa", "chair", "bench"], "table");
      if (surface === "bed" || surface === "sofa") return edgeRearPlan(cls, surface);
      const plan = rearPlan(
        cls,
        surface,
        figure(cls.a_body, surface === "table" ? "bent_over_support" : "standing_bent_forward", surface === "table" ? {} : { arms: "arms_on_prop" }),
        figure(cls.b_body, "standing"),
        "behind_bent_over"
      );
      return { ...plan, checks: ["bBehind", "bUpright", near("b", "groin", "a", "pelvis", 0.26)] };
    },
  },
  prone_rear: {
    label: "Lying face down, partner over from behind",
    plan(cls) {
      const upright = cls.lean === "upright";
      return {
        surface: lying(cls),
        mode: "fit",
        roles: { a: 0, b: 1 },
        actors: [
          figure(cls.a_body, "prone", cls.a_legs === "open_bent" || cls.a_legs === "raised" ? { legs: "legs_apart" } : {}),
          upright ? figure(cls.b_body, "kneeling_straddle", { trunk: "forward_leaning" }) : figure(cls.b_body, "prone", { arms: "arms_planted" }),
        ],
        fit: [refine(1, "groin", 1, "buttocks", 0, { free: ["x", "y", "z"], keep: upright })],
        limbContacts: upright ? handsTo(1, 0, "hip", false) : [],
        contacts: [grip("groin", "buttocks", 1, 0, "surface")],
        checks: ["aFaceDown", "sameHeading", "bAbove", near("b", "groin", "a", "buttocks", 0.18)],
      };
    },
  },
  wheelbarrow: {
    label: "Hands on the floor, legs held up",
    plan(cls) {
      return {
        surface: "floor",
        mode: "fit",
        roles: { a: 1, b: 0 },
        actors: [
          figure(cls.b_body, /kneel/.test(cls.notes ?? "") ? "kneeling" : "standing"),
          figure(cls.a_body, "prone", {
            arms: "arms_planted",
            // Straight arms reach down and forward to the floor from the tipped trunk.
            override: {
              ...both("hip", { flexion: -8, abduction: 28, rotation: 0 }),
              ...both("knee", { flexion: 10 }),
              ...both("shoulder", { flexion: 115, abduction: 12, rotation: 0 }),
              ...both("elbow", { flexion: 5 }),
            },
          }),
        ],
        fit: [
          {
            moving: 1,
            free: ["x", "y", "z"],
            pitchRange: 75,
            pivot: "pelvis",
            anchors: [
              { from: "buttocks", fromActor: 1, to: "groin", toActor: 0, weight: 2 },
              { from: "hand.l", fromActor: 1, point: [0, 0.03, 0], weight: 0.6, axes: [1] },
              { from: "hand.r", fromActor: 1, point: [0, 0.03, 0], weight: 0.6, axes: [1] },
            ],
          },
        ],
        limbContacts: handsTo(0, 1, "thigh", false),
        contacts: [grip("groin", "buttocks", 0, 1, "surface")],
        checks: ["sameHeading", near("b", "groin", "a", "pelvis", 0.3)],
      };
    },
  },
  lap_facing: { label: "Astride the seated partner, face to face", plan: (cls) => lapPlan(cls, false) },
  lap_reverse: { label: "On the seated partner's lap, facing away", plan: (cls) => lapPlan(cls, true) },
  reclined_facing: {
    label: "Both reclined on their hands, face to face",
    plan(cls) {
      return {
        surface: lying(cls, "floor"),
        mode: "fit",
        roles: { a: 0, b: 1 },
        actors: [
          figure(cls.a_body, "seated_reclined", { override: { ...both("hip", { flexion: 70, abduction: 58, rotation: 0 }), ...both("knee", { flexion: 80 }) } }),
          // B's legs lie flat and wide, around A's hips and under A's raised knees.
          figure(cls.b_body, "seated_reclined", { override: { ...both("hip", { flexion: 28, abduction: 45, rotation: 0 }), ...both("knee", { flexion: 10 }) } }),
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
      const lifted = cls.a_legs === "one_raised" || cls.a_legs === "raised" || cls.a_legs === "wrapped";
      return {
        surface: "floor",
        mode: "solver",
        roles: { a: 0, b: 1 },
        actors: [figure(cls.a_body, "standing", lifted ? { legs: "legs_one_raised" } : {}), figure(cls.b_body, "standing")],
        relationship: { arrangement: "face_to_face" },
        fit: [refine(1, "groin", 1, "groin", 0)],
        limbContacts: cls.b_hands === "embrace" || !cls.b_hands ? handsToCentre(1, 0, "back") : cls.b_hands === "surface" ? [] : handsTo(1, 0, cls.b_hands === "legs" ? "thigh" : cls.b_hands === "shoulders" ? "shoulder" : "hip", true),
        contacts: [grip("groin", "groin", 1, 0, "surface")],
        checks: ["faceToFace", "aUpright", "bUpright", near("b", "groin", "a", "groin", 0.18)],
      };
    },
  },
  standing_carry: {
    label: "Lifted and carried, face to face",
    plan(cls) {
      return {
        surface: "floor",
        mode: "solver",
        roles: { a: 1, b: 0 },
        actors: [figure(cls.b_body, "standing"), figure(cls.a_body, "lifted")],
        relationship: { arrangement: "supported_lift" },
        fit: [refine(1, "groin", 1, "groin", 0, { free: ["x", "y", "z"], keep: false })],
        contacts: [grip("groin", "groin", 1, 0, "surface"), grip("chest", "chest", 1, 0, "surface")],
        checks: ["faceToFace", "bUpright", "aOffGround", near("a", "groin", "b", "groin", 0.2)],
      };
    },
  },
  supported_inversion: {
    label: "Hips raised high, partner at the hips",
    plan(cls) {
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
      const surface = pickSurface(cls, ["floor", "bed", "sofa", "table", "chair", "bench"], "bed");
      if (surface === "table" || surface === "chair" || surface === "bench" || surface === "sofa")
        return edgePlan(cls, surface, surface === "chair" || surface === "sofa" ? "seated" : "supine", { legs: cls.a_legs ?? "open_bent", oral: true });
      return {
        surface,
        mode: "fit",
        roles: { a: 0, b: 1 },
        // Legs held together would shut the partner out; they part for the head between them.
        actors: [figure(cls.a_body, "supine", legsOf({ a_legs: ORAL_LEGS[cls.a_legs] ?? cls.a_legs }, "open_bent")), lowHeadCandidates(cls.b_body)],
        fit: [refine(1, "mouth", 1, "groin", 0)],
        // Unless braced on the surface, the arms go around the thighs.
        limbContacts: cls.b_hands === "surface" ? [] : handsTo(1, 0, cls.b_hands === "hips" ? "hip" : "thigh", true),
        contacts: [grip("mouth", "groin", 1, 0, "surface")],
        checks: ["aFaceUp", "facingInward", near("b", "mouth", "a", "groin", 0.22)],
      };
    },
  },
  oral_on_b_kneeling: {
    label: "Kneeling at the standing or seated partner's hips",
    plan(cls) {
      const seatName = cls.surface === "chair" || cls.surface === "sofa" || cls.surface === "bench" || cls.surface === "bed" ? cls.surface : null;
      const b = seatName ? seatedAt(seatName, cls.b_body, { override: structuredClone(SEATED_OPEN) }) : { spec: figure(cls.b_body, "standing"), place: null };
      return {
        surface: seatName ?? "floor",
        mode: "fit",
        roles: { a: 1, b: 0 },
        actors: [b.spec, kneelHeadCandidates(cls.a_body)],
        soloSurface: [seatName ? "chair" : "floor", "floor"],
        place: [...(b.place ? [b.place] : []), { index: 1, yaw: 180 }],
        fit: [refine(1, "mouth", 1, "groin", 0)],
        contacts: [grip("mouth", "groin", 1, 0, "surface")],
        checks: ["facingInward", near("a", "mouth", "b", "groin", 0.18)],
        // `facingInward` reads role b as the one facing in; here that is the kneeling partner.
        facingRoles: { a: 0, b: 1 },
      };
    },
  },
  oral_on_b_lying: {
    label: "Head at the hips of the partner lying down",
    plan(cls) {
      return {
        surface: lying(cls),
        mode: "fit",
        roles: { a: 1, b: 0 },
        // Knees up and apart leave room for the partner's head and shoulders between them.
        actors: [figure(cls.b_body, "supine", legsOf({}, "open_bent")), lowHeadCandidates(cls.a_body)],
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
      const facingBody = cls.lean === "forward" || /revers|toward.*(feet|body)/.test(cls.notes ?? "");
      return {
        surface: lying(cls),
        mode: "fit",
        roles: { a: 1, b: 0 },
        // Knees spread wide lower A's hips down to B's face.
        actors: [
          figure(cls.b_body, "supine", { soloSurface: lying(cls) }),
          [
            figure(cls.a_body, "kneeling_straddle", { ...trunkOf(cls.lean), override: both("hip", { abduction: 45 }), soloSurface: lying(cls) }),
            figure(cls.a_body, "kneeling_low", { ...trunkOf(cls.lean), override: both("hip", { abduction: 40 }), soloSurface: lying(cls), prefer: 0.003 }),
          ],
        ],
        place: facingBody ? [{ index: 1, yaw: 180 }] : [],
        fit: [refine(1, "groin", 1, "mouth", 0, { free: ["x", "y", "z"], keep: false, floor: surfaceTop(lying(cls)) })],
        contacts: [grip("groin", "mouth", 1, 0, "surface")],
        checks: ["bFaceUp", "aUpright", near("a", "groin", "b", "mouth", 0.23)],
      };
    },
  },
};
TEMPLATES.other_pair = { label: "Close pair", plan: (cls) => TEMPLATES.side_facing.plan(cls) };

const SOLO = {
  standing: "standing",
  kneeling: "kneeling",
  seated: "seated",
  supine: "supine",
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
  } else {
    around = { actor: aIndex, where: "beside", dist: 0.55, face: "chest", anchor: "pelvis" };
    anchor = refine(index, "hand.l", index, "shoulder", aIndex, { weight: 0.3 });
    contact = grip("hand.l", "shoulder", index, aIndex);
  }
  const thirdSpec = figure(body, posture, { soloSurface: plan.soloSurface?.[aIndex] ?? plan.surface });
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

/** Plan for any classification record, including solo and three-person scenes. */
export function planFor(cls) {
  if (cls.template === "solo") {
    const posture = SOLO[cls.solo_posture] ?? "standing";
    if (posture === "seated") {
      const surface = pickSurface(cls, ["chair", "sofa", "bench", "bed", "table"], "chair");
      const seat = seatedAt(surface, cls.a_body);
      return { surface, mode: "fit", roles: { a: 0 }, actors: [seat.spec], place: [seat.place], fit: [], contacts: [], checks: [] };
    }
    return { surface: lying(cls, "floor"), mode: "fit", roles: { a: 0 }, actors: [figure(cls.a_body, posture)], fit: [], contacts: [], checks: [] };
  }
  if (cls.template === "group_three") {
    const base = TEMPLATES[cls.base] ?? TEMPLATES.side_facing;
    return withThird(base.plan({ ...cls, template: cls.base }), cls);
  }
  return (TEMPLATES[cls.template] ?? TEMPLATES.other_pair).plan(cls);
}

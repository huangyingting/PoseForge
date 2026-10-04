/**
 * Which way a palm faces, and turning it to face what the hand is on.
 *
 * `handShapes` decides what the fingers do from what a hand is declared to be
 * doing, and nothing decided which way the hand itself was turned. The arm
 * that put a palm on the floor or on a partner's hip was solved for where the
 * hand goes, by shoulder and elbow, and the wrist and the forearm's twist kept
 * whatever angle they started with - so a figure on all fours stood on the
 * edges of its hands, one propped on its forearms held its palms up to the
 * ceiling, and a hand gripping a hip gripped the air beside it, with the
 * fingers closing on nothing.
 *
 * Every hand that bears weight or touches something has a direction its palm
 * should face: down onto what carries it, or into the body it is on. This
 * turns the forearm's twist and the wrist - the two joints that orient a hand
 * without carrying it anywhere - until it does, and when the shoulder and
 * elbow are free, brings the palm back to the point it was on, since turning
 * a wrist swings the palm about it.
 */
import { LIMB_CHAINS, solveTwoBoneIK } from "./ik.js";
import { landmarkPoint, landmarkSurface, resolveLandmark } from "./landmarks.js";
import { quatRotate, v3add, v3dot, v3len, v3normalize, v3sub } from "./math.js";
import { propTopAt } from "./propShapes.js";
import { evaluatePose } from "./skeleton.js";

/** The palm faces along the hand bone's x axis on the right and against it on the left. */
const SIGN = { l: -1, r: 1 };

/**
 * The palm and the line of the fingers as each body model draws them, in the
 * right hand bone's own axes; the left mirrors x. The drawn hand is not quite
 * square to its bone - the palm leans three or four degrees towards the wrist
 * and the heel of the thumb - and a palm squared on the bone's axis stood
 * that much on its edge. Measured on the knuckles of the posed scans; the
 * other scans of each body differ from these by two degrees or less.
 */
const DRAWN = {
  female: { palm: [0.9986, 0.0447, -0.0297], along: [0.0477, -0.9932, 0.106] },
  male: { palm: [0.9977, 0.0662, -0.0127], along: [0.0669, -0.995, 0.0745] },
  neutral: { palm: [0.9981, 0.0567, -0.0228], along: [0.0585, -0.9944, 0.0885] },
};
function drawn(skeleton, side) {
  const { palm, along } = DRAWN[skeleton.bodyType] ?? DRAWN.neutral;
  return { palm: [palm[0] * SIGN[side], palm[1], palm[2]], along: [along[0] * SIGN[side], along[1], along[2]] };
}
const DEG = 180 / Math.PI;

/** A palm this close to its aim is left as it was authored. */
const TOLERANCE = 25;

/**
 * Closer, for a palm that carries weight - leant on, or under what it holds
 * up: tilted by more than this it stands on its heel or its edge.
 */
const CARRYING = 8;

/**
 * What a hand pointing its fingers into what it faces costs, on top of the
 * palm's own angle: a palm can face the floor with the fingers driven into it,
 * and only a hand laid along the floor is laid flat.
 */
const PITCH = 1.5;

/** Arm re-solves and turns tried for each swivel before it is scored. */
const PASSES = 10;

/** A hand whose underside is this close to the bed, the floor or a seat is lying on it. */
const LYING = 0.04;

const DOWN = [0, -1, 0];

/** The channels a turn may use: the forearm's twist and the wrist. */
const CHANNELS = [
  { bone: "elbow", channel: "rotation" },
  { bone: "wrist", channel: "flexion" },
  { bone: "wrist", channel: "abduction" },
  { bone: "wrist", channel: "rotation" },
];

const rotate = (m, v) => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
];

/** World-space normal of a hand's palm, as it is drawn. */
export function palmNormal(actor, side) {
  const m = actor.evaluated.matrices[actor.skeleton.boneIndex(`hand_${side}`)];
  return v3normalize(rotate(m, drawn(actor.skeleton, side).palm));
}

/** World-space direction the fingers run, from the wrist towards the knuckles. */
export function fingerDirection(actor, side) {
  const m = actor.evaluated.matrices[actor.skeleton.boneIndex(`hand_${side}`)];
  return v3normalize(rotate(m, drawn(actor.skeleton, side).along));
}

const isHand = (landmark) => landmark?.base === "hand" || landmark?.base === "hands";

/** The height of whatever is under a point: the ground, or the top of a prop at or below it. */
function surfaceUnder(surface, props, [x, y, z]) {
  let under = surface.ground;
  for (const prop of props ?? []) {
    const top = propTopAt(prop, x, z);
    if (top != null && top <= y + 0.02) under = Math.max(under, top);
  }
  return under;
}

/**
 * Where each hand's palm should face, from what the scene says it is doing.
 *
 * A hand a posture stands on faces down. One that touches a body faces into
 * that body's surface where it is. A hand on a forearm that bears weight - a
 * figure propped on its elbows - lies palm down beside it. A hand doing none of
 * these that has come to lie on the bed, the floor or a seat lies on its palm
 * or its back, whichever it is nearer - not on its edge with its fingers in
 * the air - when `solved` says where those are. Other hands are free and have
 * no aim.
 *
 * `hold`, when given, is the side of the hand that stays where it is when the
 * hand is turned: the underside of one lying on the bed, whichever way up it
 * ends.
 *
 * @returns {Array<{actor:number, side:"l"|"r", aim:number[], kind:string, fingers:number[]|null, hold:number[]|null}>}
 */
export function palmAims(solved) {
  const aims = new Map();
  const put = (actor, side, aim, kind, rank, fingers = null, hold = null) => {
    const key = `${actor}.${side}`;
    if ((aims.get(key)?.rank ?? -1) >= rank) return;
    aims.set(key, { actor, side, aim, kind, rank, fingers, hold });
  };
  // Level, and only when there is a direction to speak of.
  const level = (v) => (Math.hypot(v[0], v[2]) > 1e-3 ? v3normalize([v[0], 0, v[2]]) : null);
  solved.actors.forEach((actor, index) => {
    const { skeleton, evaluated } = actor;
    const at = (bone) => evaluated.positions[skeleton.boneIndex(bone)];
    for (const support of actor.posture?.supports ?? []) {
      const sides = support.side ? [support.side] : ["l", "r"];
      // A hand that is leant on spreads its fingers away from the body, and one
      // beside a forearm on the bed carries on the line of the forearm.
      if (support.landmark === "hand" || support.landmark === "hands")
        for (const side of sides) put(index, side, [0, -1, 0], "support", 3, level(v3sub(at(`hand_${side}`), at("pelvis"))));
      else if (support.landmark === "forearm")
        for (const side of sides) put(index, side, [0, -1, 0], "forearm", 0, level(v3sub(at(`wrist_${side}`), at(`elbow_${side}`))));
    }
  });
  for (const contact of solved.contacts ?? []) {
    if (!(contact.strength > 0)) continue;
    for (const [end, other] of [["from", "to"], ["to", "from"]]) {
      const landmark = resolveLandmark(contact[end], contact[`${end}Side`]);
      if (!isHand(landmark) || !landmark.side) continue;
      const target = resolveLandmark(contact[other], contact[`${other}Side`]);
      if (!target || isHand(target)) continue;
      const actor = solved.actors[contact[`${end}Actor`]];
      const body = solved.actors[contact[`${other}Actor`]];
      if (!actor || !body) continue;
      const point = landmarkPoint(actor, "hand", landmark.side);
      const surface = landmarkSurface(body, contact[other], point, { defaultSide: contact[`${other}Side`] });
      if (!surface) continue;
      const rank = contact.type === "support" || contact.type === "surface" ? 2 : 1;
      // A hand under what it holds up carries it on a level palm, whatever the
      // curve of the knee or the hip it is under: tilted to that curve it is a
      // hand propping it from the side.
      const aim = surface.normal.map((v) => -v);
      put(contact[`${end}Actor`], landmark.side, contact.type === "support" && aim[1] > 0.5 ? [0, 1, 0] : aim, contact.type ?? "contact", rank);
    }
  }
  if (solved.surface)
    solved.actors.forEach((actor, index) => {
      for (const side of ["l", "r"]) {
        if (aims.has(`${index}.${side}`)) continue;
        const point = landmarkPoint(actor, "hand", side);
        const underside = point[1] - handFace(actor, side, DOWN);
        if (underside - surfaceUnder(solved.surface, solved.props, point) > LYING) continue;
        put(index, side, palmNormal(actor, side)[1] > 0 ? [0, 1, 0] : DOWN, "lying", 0, null, DOWN);
      }
    });
  return [...aims.values()].map(({ rank, ...aim }) => aim);
}

/**
 * Turn one hand's palm towards `aim`.
 *
 * The least turn that faces it: a wrist far from neutral and a forearm twisted
 * far from where it was both cost a little, so of the many ways to face a palm
 * down the one taken is the one a person would. `fingers`, when given, is the
 * way the fingers would rather run - away from the body for a hand it leans on
 * - and breaks the tie between the turns that face the palm equally well.
 * `free(bone, channel)` says which channels may move; a fixed one keeps its
 * value. Returns the angle in degrees the palm ends from its aim, or null when
 * nothing could be turned.
 */
export function turnPalm(actor, side, aim, { free = () => true, fingers = null, lead = 0.15, twist = null, sweep = true } = {}) {
  const { skeleton, pose, evaluated } = actor;
  const live = CHANNELS.filter(({ bone, channel }) => free(`${bone}_${side}`, channel));
  if (!live.length) return null;
  const elbowBone = `elbow_${side}`,
    wristBone = `wrist_${side}`;
  const start = { elbow: { ...pose.joints[elbowBone] }, wrist: { ...pose.joints[wristBone] } };
  twist ??= start.elbow.rotation ?? 0;
  // The elbow's parent does not move, so a trial needs only the two local
  // rotations below it applied to the hand's own axes - no skeleton to evaluate.
  const parent = evaluated.matrices[skeleton.boneIndex(`shoulder_${side}`)];
  const hand = skeleton.quaternionFromAngles(`hand_${side}`, pose.joints[`hand_${side}`] ?? {});
  const { palm, along } = drawn(skeleton, side);
  const palm0 = quatRotate(hand, palm),
    along0 = quatRotate(hand, along);
  const wristPart = (w) => {
    const q = skeleton.quaternionFromAngles(wristBone, w);
    return {
      palm: quatRotate(q, palm0),
      along: quatRotate(q, along0),
      strain: 0.1 * ((w.flexion / 80) ** 2 + (w.abduction / 30) ** 2 + (w.rotation / 15) ** 2),
    };
  };
  const costOf = (elbowQ, elbowRotation, part) => {
    const along = rotate(parent, quatRotate(elbowQ, part.along));
    const pitch = v3dot(along, aim);
    let c = 1 - v3dot(rotate(parent, quatRotate(elbowQ, part.palm)), aim) + part.strain;
    c += PITCH * pitch * pitch + 0.06 * ((elbowRotation - twist) / 90) ** 2;
    if (fingers) c -= lead * v3dot(along, fingers);
    return c;
  };
  const cost = (values) =>
    costOf(skeleton.quaternionFromAngles(elbowBone, values.elbow), values.elbow.rotation, wristPart(values.wrist));
  const clampTo = (values) => ({
    elbow: skeleton.clampAngles(elbowBone, values.elbow),
    wrist: skeleton.clampAngles(wristBone, values.wrist),
  });
  let best = clampTo(start);
  let bestCost = cost(best);
  // A coarse sweep of the whole range, then a finer search about the best.
  const values = (bone, channel) => {
    const current = best[bone][channel];
    if (!live.some((c) => c.bone === bone && c.channel === channel)) return [current];
    const [min, max] = skeleton.bone(`${bone}_${side}`).rom[channel];
    const out = [];
    for (let v = min; v <= max + 1e-9; v += 15) out.push(v);
    return out;
  };
  if (sweep) {
    const wrists = [];
    for (const flexion of values("wrist", "flexion"))
      for (const abduction of values("wrist", "abduction")) {
        const w = { ...best.wrist, flexion, abduction };
        wrists.push({ w, part: wristPart(w) });
      }
    for (const rotation of values("elbow", "rotation")) {
      const e = { ...best.elbow, rotation };
      const q = skeleton.quaternionFromAngles(elbowBone, e);
      for (const { w, part } of wrists) {
        const c = costOf(q, rotation, part);
        if (c < bestCost) [best, bestCost] = [{ elbow: e, wrist: w }, c];
      }
    }
  }
  for (let step = sweep ? 7.5 : 3.75; step > 0.5; step /= 2) {
    for (let improved = true; improved; ) {
      improved = false;
      for (const { bone, channel } of live) {
        for (const delta of [-step, step]) {
          const trial = clampTo({ ...best, [bone]: { ...best[bone], [channel]: best[bone][channel] + delta } });
          const c = cost(trial);
          if (c < bestCost - 1e-9) [best, bestCost, improved] = [trial, c, true];
        }
      }
    }
  }
  pose.joints[`elbow_${side}`] = best.elbow;
  pose.joints[`wrist_${side}`] = best.wrist;
  actor.evaluated = evaluatePose(skeleton, pose);
  return Math.acos(Math.max(-1, Math.min(1, v3dot(palmNormal(actor, side), aim)))) * DEG;
}

/** How far a hand reaches past its palm point along `dir`: where its face is. */
function handFace(actor, side, dir) {
  const bone = `hand_${side}`;
  const m = actor.evaluated.matrices[actor.skeleton.boneIndex(bone)];
  const point = landmarkPoint(actor, "hand", side);
  let face = -Infinity;
  for (const volume of actor.localVolumes ?? [])
    if (volume.bone === bone)
      for (const [p, r] of [[volume.a, volume.ra], [volume.b, volume.rb]]) {
        const at = v3add(rotate(m, p), [m[12], m[13], m[14]]);
        face = Math.max(face, v3dot(v3sub(at, point), dir) + r);
      }
  return Number.isFinite(face) ? face : 0;
}

/** Swivels of the elbow about the shoulder-wrist line tried for each hand, in degrees. */
const SWIVELS = [0, -35, 35, -70, 70];

/**
 * How deep a turned arm may go into anything past what flesh gives, when it
 * was clear before: less than the scene's own check lets through.
 */
const CLEAR = 0.004;

/**
 * How much of the way back onto what it was on a turned hand is brought, and
 * how far short of that it is held. All of it, unless that puts its fingers or
 * its elbow into the body: a palm laid on a back that curves away under it, or
 * arms round a partner already against their sides. Then it stops short, the
 * palm a centimetre or two off, and the pass over the drawn bodies closes the
 * rest. Last, brought all the way and held a few millimetres off: a hand laid
 * flat on a thigh or a flank that curves away under it has its fingertips in
 * it by about that much, and turned where it is it swings them in further.
 */
const REACHES = [
  [1, 0],
  [0.5, 0],
  [0, 0],
  [1, 0.004],
  [1, 0.008],
  [1, 0.012],
];

/** How far off what it was on a hand turned where it is may come to lie. */
const SLIDE = 0.015;

/**
 * Turn every aimed palm that is more than `TOLERANCE` from its aim.
 *
 * `free(actor, bone, channel)` says which channels may move. With the
 * shoulder and elbow free the arm is re-solved after each turn to keep the
 * hand on what it was on - its face, not its middle, since a hand turned from
 * its edge to its palm is thinner across - and turned again, since moving the
 * arm moves what the turn was measured against. The elbow may also swing out
 * or in about the line from shoulder to wrist: a wrist bends only so far, and
 * a hand laid flat on the floor under a straight arm needs the forearm leant
 * over it to get there. `depth(actor, side)`, when given, says how deep that
 * arm is in its own trunk, a partner or the furniture as it now stands; a turn
 * that takes it deeper than it was, or than `CLEAR`, is not made - a swung
 * elbow that lays the palm flat is no use buried in a partner's hip. Mutates
 * the actors' poses and `evaluated`; the caller refreshes anything derived
 * from them. Returns the hands turned, each with the `inset` its middle was
 * brought nearer what it is on.
 */
export function turnPalms(solved, { free = () => true, aims = palmAims(solved), depth = null } = {}) {
  const turned = [];
  for (const { actor: index, side, aim, kind, fingers, hold = null } of aims) {
    const actor = solved.actors[index];
    const before = Math.acos(Math.max(-1, Math.min(1, v3dot(palmNormal(actor, side), aim)))) * DEG;
    if (before <= (kind === "support" ? CARRYING : TOLERANCE)) continue;
    // The side of the hand kept on what it was on: the palm, unless the aim says otherwise.
    const keep = hold ?? aim;
    const may = (bone, channel) => free(actor, bone, channel);
    const chain = side === "l" ? LIMB_CHAINS.armL : LIMB_CHAINS.armR;
    // A forearm that bears weight stays where it lies: only its twist and the
    // wrist turn the hand beside it.
    const movable =
      kind !== "forearm" && ["flexion", "abduction", "rotation"].every((c) => may(chain.root, c)) && may(chain.mid, "flexion");
    const { skeleton } = actor;
    const snapshot = () => ({
      root: { ...actor.pose.joints[chain.root] },
      mid: { ...actor.pose.joints[chain.mid] },
      end: { ...actor.pose.joints[chain.end] },
    });
    const restore = (s) => {
      actor.pose.joints[chain.root] = { ...s.root };
      actor.pose.joints[chain.mid] = { ...s.mid };
      actor.pose.joints[chain.end] = { ...s.end };
      actor.evaluated = evaluatePose(skeleton, actor.pose);
    };
    const saved = snapshot();
    const twist = saved.mid.rotation ?? 0;
    const allowed = depth ? Math.max(depth(index, side), CLEAR) : Infinity;
    const at = (bone) => actor.evaluated.positions[skeleton.boneIndex(bone)];
    const point = landmarkPoint(actor, "hand", side);
    const face = handFace(actor, side, keep);
    const shoulder = at(chain.root);
    const axis = v3normalize(v3sub(at(chain.end), shoulder));
    const bend = v3sub(at(chain.mid), v3add(shoulder, axis.map((v) => v * v3dot(v3sub(at(chain.mid), shoulder), axis))));
    let best = null;
    let turnedOnce = false;
    swivels: for (const swivel of movable && v3len(bend) > 1e-4 ? SWIVELS : [0]) {
      // The pole the elbow bends towards, swung about the shoulder-wrist line.
      const t = (swivel * Math.PI) / 180;
      const u = v3normalize(bend),
        w = [axis[1] * u[2] - axis[2] * u[1], axis[2] * u[0] - axis[0] * u[2], axis[0] * u[1] - axis[1] * u[0]];
      const pole = movable ? v3add(u.map((v) => v * Math.cos(t)), w.map((v) => v * Math.sin(t))) : null;
      for (const [reach, lift] of movable && depth ? REACHES : [[1, 0]]) {
        if (turnedOnce) restore(saved);
        turnedOnce = true;
        // Back onto what the hand was on, measured to the face it now presents.
        const target = () => v3add(point, keep.map((v) => v * (reach * (face - handFace(actor, side, keep)) - lift)));
        let after = null,
          miss = 0;
        for (let pass = 0; pass < PASSES; pass += 1) {
          if (pole && (pass > 0 || swivel !== 0 || reach !== 1 || lift > 0)) {
            const wrist = at(chain.end);
            const step = v3sub(target(), landmarkPoint(actor, "hand", side));
            actor.evaluated = solveTwoBoneIK(skeleton, actor.pose, chain, v3add(wrist, step), { evaluated: actor.evaluated, pole }).evaluated;
          }
          after = turnPalm(actor, side, aim, { free: may, fingers, twist, sweep: pass === 0 });
          if (after == null || !movable) break;
          miss = v3len(v3sub(target(), landmarkPoint(actor, "hand", side)));
          if (miss < 0.002) break;
        }
        if (after == null) break swivels;
        if (depth && depth(index, side) > allowed + 1e-4) continue;
        // A degree of palm for each millimetre off the spot, or short of it,
        // and the elbow kept where it was unless swinging it buys a flatter hand.
        const short = (1 - reach) * Math.abs(face - handFace(actor, side, keep)) + lift;
        const score = after + (miss + short) * 1000 + 8 * (swivel / 70) ** 2;
        if (!best || score < best.score) best = { score, after, joints: snapshot() };
        break;
      }
    }
    // Arms round a partner with theirs over them have nowhere to go: brought
    // back to the spot, the elbow goes into the partner's arm, and held off it
    // the hand goes into the back. Turned where it is, the palm finds the back
    // a little nearer the middle of it than the edge of the hand did, which
    // is still the back.
    if (!best && movable && depth) {
      restore(saved);
      const after = turnPalm(actor, side, aim, { free: may, fingers, twist });
      const off = v3dot(v3sub(v3add(landmarkPoint(actor, "hand", side), keep.map((v) => v * handFace(actor, side, keep))), v3add(point, keep.map((v) => v * face))), keep);
      if (after != null && Math.abs(off) <= SLIDE && depth(index, side) <= allowed + 1e-4)
        best = { score: after, after, joints: snapshot() };
    }
    // A turn that cannot do better than the hand already did is not made.
    if (!best || best.after > before - 10) {
      restore(saved);
      continue;
    }
    restore(best.joints);
    // How much nearer what it is on the hand's middle now sits: a palm laid on
    // a shoulder is thinner across than the edge that was on it.
    const inset = movable ? v3dot(v3sub(landmarkPoint(actor, "hand", side), point), keep) : 0;
    turned.push({ actor: index, side, kind, before, after: best.after, inset });
  }
  return turned;
}

/**
 * The one shape read off the geometry rather than the declarations: a free
 * hand that has come to lie palm down on the bed, the floor or a seat. Hung
 * in the air a relaxed hand curls; laid on something the same curl drives
 * the fingertips into it, so it lies flat instead. Flat is `brace`, the one
 * shape fitted to the palm's plane rather than added to the scan's own curl:
 * `lay` is a few degrees on top of that curl and still puts the fingertips
 * four centimetres under a palm resting on the sheet. A shape the actor asked
 * for is theirs and stays.
 *
 * @param {object} actor a solved actor
 * @param {{l:string, r:string}} hands the declared shapes, from `handShapes`
 * @param {{ground:number}} surface
 * @param {Array<object>} props
 */
export function restingHands(actor, hands, surface, props = []) {
  const asked = actor.spec?.hands;
  const out = { ...hands };
  for (const side of ["l", "r"]) {
    if (hands[side] !== "relaxed" || (typeof asked === "string" ? asked : asked?.[side])) continue;
    if (palmNormal(actor, side)[1] > -0.6) continue;
    const point = landmarkPoint(actor, "hand", side);
    if (point[1] - surfaceUnder(surface, props, point) < 0.05) out[side] = "brace";
  }
  return out;
}

/**
 * Offline composer for two- and three-person interaction studies.
 *
 * A template says which posture each partner holds, how the pair is related
 * (either through a library arrangement that the solver places, or through
 * landmark anchors that are fitted here) and which hand/limb contacts close the
 * interaction. The composer returns fixed, portable scene data: every actor has
 * a fixed world placement and a complete joint table, so the viewer replays the
 * same geometry without re-deriving it.
 */
import { validateScene } from "../src/core/scene.js";
import {
  solveScene,
  createActor,
  refresh,
  measureContactTargets,
  armDepth,
} from "../src/core/solver.js";
import { captureSolvedPose, placementFromRoot } from "../src/core/placement.js";
import { turnPalm, turnPalms, palmNormal } from "../src/core/palmPose.js";
import { bodyDistance, bodyNormal, gravityHang, poseVolumes } from "../src/core/body.js";
import { landmarkPoint, landmarkSurface } from "../src/core/landmarks.js";
import { detectContacts, detectPropContacts, penetrationReport, contactKey } from "../src/core/collision.js";
import { resolveLandmark } from "../src/core/landmarks.js";
import { resolveSurface } from "../src/core/poseLibrary.js";
import { propDistance, propTopAt, withBounds } from "../src/core/propShapes.js";
import { LIMB_CHAINS, solveTwoBoneIK } from "../src/core/ik.js";
import { region } from "../src/core/surfaceContacts.js";
import { quatFromAxisAngle, quatMultiply, quatNormalize, quatRotate } from "../src/core/math.js";
import { checkScene } from "../src/core/catalog.js";
import { bearings, hanging, stability } from "../src/core/stability.js";
import { supportProps } from "../src/core/supports.js";

const DEG = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** The way `a` runs over the floor, or nothing when it runs straight up or down. */
const level = (a) => (Math.hypot(a[0], a[2]) > 1e-3 ? unit([a[0], 0, a[2]]) : [0, 0, 0]);

export function propsFor(surfaceName) {
  const surface = resolveSurface(surfaceName);
  return {
    surface,
    // A car's shell holds nobody up, so the solver ignores it, but a body has
    // to stay inside it; here it counts like any other prop.
    props: [...(surface.props || []), ...(surface.shell || [])].map(withBounds),
  };
}

/**
 * Overrides replace joint channels after a solve, with the root unchanged.
 * `_top`/`_bottom` name the upper or lower side of a figure lying on its side.
 */
function applyOverride(fixed, solvedActor, override) {
  if (!override) return fixed;
  const upper = landmarkPoint(solvedActor, "hip", "l")[1] >= landmarkPoint(solvedActor, "hip", "r")[1] ? "l" : "r";
  const lower = upper === "l" ? "r" : "l";
  for (const [key, angles] of Object.entries(override)) {
    const bone = key.replace(/_top$/, `_${upper}`).replace(/_bottom$/, `_${lower}`);
    fixed.joints[bone] = { ...fixed.joints[bone], ...angles };
  }
  return fixed;
}

const CHAINS = [
  ["trunk", /^spine/],
  ["head", /^(neck|head)$/],
  ["arm.l", /^(clavicle|shoulder|elbow|wrist)_l$/],
  ["arm.r", /^(clavicle|shoulder|elbow|wrist)_r$/],
  ["leg.l", /^(hip|knee|ankle|toe)_l$/],
  ["leg.r", /^(hip|knee|ankle|toe)_r$/],
];

/**
 * Pose details (see `withDetails` in interaction-templates.mjs) laid over a
 * fixed pose chain by chain, each only as far as the support allows: a limb
 * turns towards its detail until it would go into the floor or the furniture
 * any deeper than it already was. An arm raised by someone lying on their
 * back comes to rest on the floor above the head instead of passing through it.
 */
function applyDetails(fixed, details, props) {
  if (!details) return fixed;
  const depth = (spec) => {
    const actor = liveActor(spec, 0);
    const prop = detectPropContacts([{ id: "detail", volumes: actor.volumes }], props).reduce((max, c) => Math.max(max, c.depth), 0);
    return { low: lowest(actor), prop };
  };
  let out = fixed;
  for (const [, pattern] of CHAINS) {
    const bones = Object.keys(details).filter((bone) => pattern.test(bone));
    if (!bones.length) continue;
    const before = depth(out);
    // No lower than a hair into the floor, or than the pose already went.
    const floor = Math.min(before.low, -0.02);
    const deepest = Math.max(before.prop, 0.02);
    const at = (t) => {
      const joints = { ...out.joints };
      for (const bone of bones) {
        const from = out.joints[bone] ?? {};
        joints[bone] = { ...from };
        for (const [channel, value] of Object.entries(details[bone])) joints[bone][channel] = (from[channel] ?? 0) + t * (value - (from[channel] ?? 0));
      }
      return { ...out, joints };
    };
    const fits = (spec) => {
      const d = depth(spec);
      return d.low >= floor && d.prop <= deepest;
    };
    // Backed off a tenth at a time, since the way to a detail may pass through the floor
    // when the detail itself does not, then narrowed to the last tenth.
    let good = 1;
    while (good > 0 && !fits(at(good))) good = Math.round((good - 0.1) * 10) / 10;
    let bad = Math.min(1, good + 0.1);
    for (let i = 0; good < 1 && i < 5; i += 1) {
      const mid = (good + bad) / 2;
      if (fits(at(mid))) good = mid;
      else bad = mid;
    }
    out = at(good);
  }
  return out;
}

/** How high each of a figure's declared supports is: a knee brought up off the floor is, though the foot below it is down. */
const supportHeights = (actor) => actor.posture.supports.map(({ landmark, side }) => landmarkPoint(actor, landmark, side ?? null)[1]);

const LEG = /^(hip|knee|ankle|toe|foot)_[lr]$/;
const LIMB = /^(hip|knee|ankle|toe|foot|shoulder|elbow|wrist|hand)_[lr]$/;
const supportBones = (actor) => actor.posture.supports.map(({ landmark, side }) => resolveLandmark(landmark, side ?? null)?.bone ?? "");

/**
 * A figure on its feet or knees set back down on them after the joints laid
 * over its solved pose lifted them: lowered where they all came up together, as
 * the hips sink between knees spread from kneeling, and tipped about the
 * supports that stayed down where only some did, as the hips come down between
 * knees spread on the hands and knees. A foot or knee lifted further than a
 * hand's breadth while the rest stay down was raised on purpose and stays up,
 * and nothing goes lower than the figure went before.
 */
function restOnSupports(spec, before) {
  const bones = supportBones(before);
  if (!bones.length || !bones.every((bone) => LIMB.test(bone)) || !bones.some((bone) => LEG.test(bone))) return spec;
  const was = supportHeights(before);
  const floor = lowest(before);
  let out = spec;
  let closest = null;
  for (let pass = 0; pass <= 4; pass += 1) {
    const actor = liveActor(out, 0);
    const lift = supportHeights(actor).map((y, i) => y - was[i]);
    const hovering = lift.every((up) => up >= 0.005);
    const raised = lift.map((up, i) => LEG.test(bones[i]) && up >= 0.005 && (up <= 0.15 || hovering));
    if (!raised.some(Boolean)) break;
    // Each pass brings them nearer the floor, or the last is undone and that is as near as they come.
    const worst = Math.max(...lift.filter((_, i) => raised[i]));
    if (pass > 0 && worst >= closest.worst - 0.001) return closest.out;
    closest = { out, worst };
    if (pass === 4) break;
    const down = lift.map((up) => up < 0.005);
    if (!down.some(Boolean)) {
      const least = Math.min(...lift.filter((_, i) => raised[i]));
      out = moveSpec(out, { translate: [0, Math.max(-least, floor - lowest(actor)), 0] });
      continue;
    }
    // About the line through the supports still down, square to the way to the rest.
    const centre = (which) => {
      const points = actor.posture.supports.filter((_, i) => which[i]).map(({ landmark, side }) => landmarkPoint(actor, landmark, side ?? null));
      return points.reduce((sum, p) => add(sum, p), [0, 0, 0]).map((v) => v / points.length);
    };
    const pivot = centre(down);
    const away = sub(centre(raised), pivot);
    const reach = Math.hypot(away[0], away[2]);
    if (reach < 0.1) break;
    const drop = lift.filter((_, i) => raised[i]).reduce((sum, up, _, all) => sum + up / all.length, 0);
    let tipped = moveSpec(out, { pitch: Math.atan2(drop, reach) / DEG, pitchAxis: [away[2] / reach, 0, -away[0] / reach], pivot });
    // The shins behind the knees come down further than the knees: folded up off the floor.
    for (const s of ["l", "r"]) {
      const shin = new RegExp(`^(ankle|toe|foot)_${s}$`);
      for (let bend = 0; bend < 12; bend += 1) {
        if (lowest({ volumes: liveActor(tipped, 0).volumes.filter((v) => shin.test(v.bone)) }) >= floor) break;
        const knee = tipped.joints[`knee_${s}`] ?? {};
        tipped = { ...tipped, joints: { ...tipped.joints, [`knee_${s}`]: { ...knee, flexion: (knee.flexion ?? 0) + 5 } } };
      }
    }
    const deeper = floor - lowest(liveActor(tipped, 0));
    out = deeper > 0 ? moveSpec(tipped, { translate: [0, deeper, 0] }) : tipped;
  }
  return out;
}

/** Solve one figure on its own and return a fixed spec. */
function soloFixed(input, surface, props = propsFor(surface).props) {
  const { override, tilt, details, ...spec } = input;
  const { scene } = validateScene({
    actors: [spec],
    support: { surface },
    relationship: { contactMode: "custom" },
    contacts: [],
  });
  const solved = solveScene(scene, { palms: false });
  const solo = { ...scene.actors[0], ...captureSolvedPose(solved.actors[0]) };
  const fixed = applyDetails(applyOverride(structuredClone(solo), solved.actors[0], override), details, props);
  if (!tilt) return override || details ? restOnSupports(fixed, liveActor(solo, 0)) : fixed;
  // Tip the body forward about its pelvis (the override re-aims the thighs), then rest it back down.
  const before = lowest(solved.actors[0]);
  const h = bodyHeading(liveActor(fixed, 0));
  const tipped = moveSpec(fixed, { pitch: tilt, pitchAxis: [h[2], 0, -h[0]] });
  return moveSpec(tipped, { translate: [0, before - lowest(liveActor(tipped, 0)), 0] });
}

function liveActor(spec, index) {
  return refresh(createActor(structuredClone(spec), index));
}

function rootOf(spec) {
  return createActor(structuredClone(spec), 0).pose.root;
}

/** Rigidly move a fixed spec: yaw (deg) about its root, then translate. */
export function moveSpec(spec, { yaw = 0, pitch = 0, roll = 0, translate = [0, 0, 0], pivot = null, pitchAxis = [1, 0, 0] } = {}) {
  const root = rootOf(spec);
  let q = root.quaternion;
  let p = root.position;
  const centre = pivot ?? p;
  let rotation = [0, 0, 0, 1];
  if (pitch) rotation = quatMultiply(quatFromAxisAngle(pitchAxis, pitch * DEG), rotation);
  if (roll) rotation = quatMultiply(quatFromAxisAngle([0, 0, 1], roll * DEG), rotation);
  if (yaw) rotation = quatMultiply(quatFromAxisAngle([0, 1, 0], yaw * DEG), rotation);
  q = quatNormalize(quatMultiply(rotation, q));
  p = add(centre, quatRotate(rotation, sub(p, centre)));
  p = add(p, translate);
  return { ...spec, placement: placementFromRoot({ position: p, quaternion: q }) };
}

function lowest(actor) {
  let min = Infinity;
  for (const v of actor.volumes) min = Math.min(min, v.a[1] - v.ra, v.b[1] - v.rb);
  return min;
}

/** Penetration between different bodies and against props, as a scalar cost. */
function penetration(actors, props, declared, ignore = null, { armSlack = 0 } = {}) {
  const bodies = actors.map((a, i) => ({ id: a.id, volumes: ignore?.[i]?.size ? a.volumes.filter((v) => !ignore[i].has(v.bone)) : a.volumes }));
  // Embracing arms press into each other through clothing; allow them a little slack.
  const contacts = detectContacts(bodies, { declared, selfCollision: false }).map((c) =>
    armSlack && /^arm/.test(c.groupA) && /^arm/.test(c.groupB) ? { ...c, depth: Math.max(0, c.depth - armSlack) } : c
  );
  const report = penetrationReport(contacts);
  const propContacts = detectPropContacts(bodies, props);
  let propMax = 0;
  let propTotal = 0;
  for (const c of propContacts) {
    propMax = Math.max(propMax, c.depth);
    propTotal += c.depth;
  }
  return { body: report.maxDepth, bodyTotal: report.totalDepth, prop: propMax, propTotal };
}

function declaredKeys(actors, contacts) {
  const keys = new Set();
  for (const c of contacts) {
    const a = resolveLandmark(c.from, c.fromSide)?.bone;
    const b = resolveLandmark(c.to, c.toSide)?.bone;
    if (!a || !b) continue;
    keys.add(contactKey(actors[c.fromActor].id, a, actors[c.toActor].id, b));
  }
  return keys;
}

/**
 * Fit the moving actor's rigid placement so its anchors meet their targets
 * without the bodies passing through each other or the props.
 *
 * The walk goes down from steps of 16 cm, or from `walk.first`. Each round
 * takes the first step that lowers the cost, or with `walk.steepest` tries them
 * all and takes the one that lowers it most. Each is a different way down the
 * same slope: a long first step can lift a partner clear for a little less
 * cost, onto a ledge with no way back down to the closer placement below, and
 * a walk that finds a way out of one dead end can walk into another.
 */
function fitPlacement(specs, moving, anchors, props, { free = ["x", "z"], yawRange = 0, pitchRange = 0, pivotPoint = null, floorY = null, keep = false, clear = 0, ignore = null, walk = {} } = {}) {
  const { steepest = false, first = 0.16 } = walk;
  const others = specs.map((s, i) => (i === moving ? null : liveActor(s, i)));
  const base = specs[moving];
  const declared = new Set();
  const params = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const baseActor = liveActor(base, moving);
  const rest = lowest(baseActor);
  const pivot = pivotPoint ? landmarkPoint(baseActor, pivotPoint) : null;
  const lateral = sub(landmarkPoint(baseActor, "hip", "r"), landmarkPoint(baseActor, "hip", "l"));
  const pitchAxis = unit([lateral[0], 0, lateral[2]]);
  const evaluate = (p) => {
    const spec = moveSpec(base, { yaw: p.yaw, pitch: p.pitch, pivot, pitchAxis, translate: [p.x, p.y, p.z] });
    const actor = liveActor(spec, moving);
    const all = specs.map((_, i) => (i === moving ? actor : others[i]));
    if (!declared.size) for (const k of declaredKeys(all, anchors.filter((a) => !a.point))) declared.add(k);
    let cost = 0;
    for (const anchor of anchors) {
      const from = landmarkPoint(all[anchor.fromActor], anchor.from, anchor.fromSide ?? null);
      const to = anchor.point ?? landmarkPoint(all[anchor.toActor], anchor.to, anchor.toSide ?? null);
      const target = add(to, anchor.offset ?? [0, 0, 0]);
      const d = sub(from, target);
      const w = anchor.weight ?? 1;
      if (anchor.axes) cost += w * anchor.axes.reduce((s, ax) => s + d[ax] * d[ax], 0);
      else cost += w * dot(d, d);
    }
    const pen = penetration(all, props, declared, ignore);
    cost += 60 * (pen.body + clear) ** 2 * (pen.body > 0 ? 1 : 0) + 8 * pen.bodyTotal ** 2 + 80 * pen.prop ** 2 + 4 * pen.propTotal ** 2;
    if (keep) cost += 200 * (lowest(actor) - rest) ** 2;
    if (floorY != null) {
      const low = lowest(actor) - floorY;
      if (low < 0) cost += 200 * low * low;
    }
    return { cost, spec, pen };
  };
  let best = evaluate(params);
  // A pitch range is ± degrees, or [min, max] to let the actor tip one way only.
  const [pitchMin, pitchMax] = Array.isArray(pitchRange) ? pitchRange : [-pitchRange, pitchRange];
  const keys = [...free, ...(yawRange ? ["yaw"] : []), ...(pitchMin || pitchMax ? ["pitch"] : [])];
  for (const step of [0.16, 0.08, 0.04, 0.02, 0.01, 0.005].filter((s) => s <= first)) {
    let improved = true;
    let rounds = 0;
    while (improved && rounds < 30) {
      improved = false;
      rounds += 1;
      let move = null;
      for (const key of keys) {
        const delta = key === "yaw" || key === "pitch" ? step * 60 : step;
        for (const sign of [1, -1]) {
          const trial = { ...params, [key]: params[key] + sign * delta };
          if (key === "yaw" && Math.abs(trial.yaw) > yawRange) continue;
          if (key === "pitch" && (trial.pitch < pitchMin || trial.pitch > pitchMax)) continue;
          const result = evaluate(trial);
          if (result.cost >= (move ?? best).cost - 1e-9) continue;
          move = { ...result, trial };
          if (steepest) continue;
          best = move;
          Object.assign(params, trial);
          improved = true;
          move = null;
        }
      }
      if (move) {
        best = move;
        Object.assign(params, move.trial);
        improved = true;
      }
    }
  }
  return { spec: best.spec, cost: best.cost, params };
}

const ARM_BONES = ["clavicle", "shoulder", "elbow", "wrist"];
const LEG_BONES = ["hip", "knee", "ankle", "toe"];

/** Joint table minus the chains the IK stage may still move. */
function freeChains(spec, chains) {
  const joints = structuredClone(spec.joints);
  for (const chain of chains) {
    const [limb, side] = chain.split(".");
    for (const bone of limb === "arm" ? ARM_BONES : LEG_BONES) delete joints[`${bone}_${side}`];
  }
  return { ...spec, joints, jointMode: "fixed" };
}

function chainOf(landmark, side) {
  const arm = ["hand", "forearm", "elbow", "upperArm"];
  const leg = ["foot", "ankle", "shin", "knee", "thigh"];
  const [name, s] = landmark.split(".");
  const which = s ?? side;
  if (!which) return null;
  if (arm.includes(name)) return `arm.${which}`;
  if (leg.includes(name)) return `leg.${which}`;
  return null;
}

/** A body's heading on the ground plane: towards the head, or the chest when upright. */
export function bodyHeading(actor) {
  const pelvis = landmarkPoint(actor, "pelvis");
  const toHead = sub(landmarkPoint(actor, "head"), pelvis);
  if (Math.hypot(toHead[0], toHead[2]) > 0.3) return unit([toHead[0], 0, toHead[2]]);
  const front = sub(landmarkPoint(actor, "chest"), landmarkPoint(actor, "upperBack"));
  return unit([front[0], 0, front[2]]);
}

/**
 * Mirror a fixed spec across the x = 0 plane. The rig gives both sides the
 * same angles for a symmetric pose, so limb joints just swap sides, while the
 * spine, neck and head change the sign of their sideways bend and twist.
 */
export function mirrorSpec(spec) {
  const root = rootOf(spec);
  const q = root.quaternion;
  const joints = {};
  for (const [bone, channels] of Object.entries(spec.joints)) {
    const side = bone.match(/_(l|r)$/)?.[1];
    if (side) joints[`${bone.slice(0, -2)}_${side === "l" ? "r" : "l"}`] = { ...channels };
    else joints[bone] = { ...channels, abduction: -(channels.abduction ?? 0), rotation: -(channels.rotation ?? 0) };
  }
  const hands = spec.hands ? { l: spec.hands.r, r: spec.hands.l } : spec.hands;
  return {
    ...spec,
    joints,
    ...(hands ? { hands } : {}),
    placement: placementFromRoot({ position: [-root.position[0], root.position[1], root.position[2]], quaternion: [q[0], -q[1], -q[2], q[3]] }),
  };
}

/** The chest's facing on the ground plane, or null when it points mostly up or down. */
function frontFlat(actor) {
  const f = sub(landmarkPoint(actor, "chest"), landmarkPoint(actor, "upperBack"));
  const l = Math.hypot(f[0], f[2]);
  return l > 0.5 * len(f) ? [f[0] / l, 0, f[2] / l] : null;
}

/** Apply one rigid placement step to a fixed spec. */
function applyPlace(spec, index, move, specs, props) {
  let out = move.mirror ? mirrorSpec(spec) : spec;
  if (move.around) {
    // Stand off from another actor (at its head, in front, beside or behind),
    // then turn to face the named landmark on it. Beneath lies under its chest.
    const { actor, where, dist = 0.5, face = "pelvis", anchor = "pelvis" } = move.around;
    const other = liveActor(specs[actor], actor);
    const h = bodyHeading(other);
    const otherFront = frontFlat(other);
    const lateral = otherFront && Math.abs(dot(otherFront, h)) < 0.5 ? otherFront : [h[2], 0, -h[0]];
    const refName = where === "at_head" || where === "in_front" ? "head" : where === "beneath" ? "chest" : "pelvis";
    const ref = landmarkPoint(other, refName);
    const dir = where === "at_head" || where === "in_front" ? h : where === "behind" ? h.map((v) => -v) : where === "beneath" ? [0, 0, 0] : lateral;
    const target = add(ref, dir.map((v) => v * dist));
    const self = liveActor(out, index);
    const front = frontFlat(self) ?? bodyHeading(self);
    const look = sub(landmarkPoint(other, face), target);
    const want = Math.atan2(look[0], look[2]);
    const have = Math.atan2(front[0], front[2]);
    out = moveSpec(out, { yaw: (want - have) / DEG });
    const at = landmarkPoint(liveActor(out, index), anchor);
    out = moveSpec(out, { translate: [target[0] - at[0], 0, target[2] - at[2]] });
  }
  if (move.yaw || move.pitch || move.roll) out = moveSpec(out, { yaw: move.yaw, pitch: move.pitch, roll: move.roll });
  if (move.seatOn) {
    // Posed on the chair: carry the chair's seat front edge (z 0.25, y 0.46) to this seat's.
    out = moveSpec(out, { translate: [move.seatOn.x ?? 0, move.seatOn.top - 0.46, move.seatOn.z - 0.25] });
  }
  if (move.pelvisTo) {
    const at = landmarkPoint(liveActor(out, index), move.anchor ?? "pelvis");
    const to = move.pelvisTo.map((v, k) => (v == null ? at[k] : v));
    out = moveSpec(out, { translate: sub(to, at) });
  }
  if (move.rest != null) {
    const low = lowest(liveActor(out, index));
    out = moveSpec(out, { translate: [0, move.rest - low, 0] });
  }
  if (move.alignTo) {
    // Put a landmark of this actor at a landmark of another, on the given axes.
    const { from, to, actor, axes = [0, 1, 2], offset = [0, 0, 0] } = move.alignTo;
    const a = landmarkPoint(liveActor(out, index), from);
    const b = add(landmarkPoint(liveActor(specs[actor], actor), to), offset);
    const d = sub(b, a).map((v, k) => (axes.includes(k) ? v : 0));
    out = moveSpec(out, { translate: d });
  }
  if (move.settle) {
    // Moved on (down, unless it says otherwise) until it just meets the furniture
    // or the floor, or backed off until it is clear of them: a ball or a wedge
    // has no one seat height to rest at.
    const { along = [0, -1, 0], floor = 0 } = move.settle;
    // A figure posed resting on the floor may start a hair into it; that is not something to back away from.
    const limit = Math.min(floor, lowest(liveActor(out, index))) - 1e-4;
    const clear = (s) => {
      const actor = liveActor(moveSpec(out, { translate: along.map((v) => v * s) }), index);
      return lowest(actor) >= limit && !detectPropContacts([{ id: "settle", volumes: actor.volumes }], props).length;
    };
    // Stepped to the first change, which a ball narrower than the move could pass right through.
    const start = clear(0);
    const step = start ? 0.02 : -0.02;
    let s = 0;
    while (clear(s + step) === start) {
      s += step;
      if (Math.abs(s) > 2) throw new Error(`settle: actor ${index} ${start ? "meets nothing" : "cannot get clear"} along [${along}]`);
    }
    let [good, bad] = start ? [s, s + step] : [s + step, s];
    for (let i = 0; i < 12; i += 1) {
      const mid = (bad + good) / 2;
      if (clear(mid)) good = mid;
      else bad = mid;
    }
    out = moveSpec(out, { translate: along.map((v) => v * good) });
  }
  return out;
}

function runFit(specs, step, props, walk = {}) {
  const first = step.anchors[0];
  const all = specs.map((s, i) => liveActor(s, i));
  const from = landmarkPoint(all[first.fromActor], first.from, first.fromSide ?? null);
  const to = add(add(first.point ?? landmarkPoint(all[first.toActor], first.to, first.toSide ?? null), first.offset ?? [0, 0, 0]), step.start ?? [0, 0, 0]);
  const shift = sub(to, from).map((v, k) => (step.free.includes("xyz"[k]) ? v : 0));
  const start = specs.slice();
  if (step.snap !== false) start[step.moving] = moveSpec(specs[step.moving], { translate: first.fromActor === step.moving ? shift : shift.map((v) => -v) });
  return fitPlacement(start, step.moving, step.anchors, props, {
    free: step.free,
    yawRange: step.yawRange ?? 0,
    pitchRange: step.pitchRange ?? 0,
    pivotPoint: step.pivot ?? null,
    floorY: step.floor ?? null,
    keep: step.keep ?? false,
    ignore: step.ignore ?? null,
    walk,
  });
}

/**
 * Compose a scene from a template plan.
 *
 * plan = {
 *   surface, actors: [spec | [candidate specs]],  // scene order, primary first
 *   mode: "solver" | "fit",
 *   relationship, contacts,                      // solver mode
 *   soloSurface: [name...],                      // fit mode: where each is posed alone
 *   place: [{ index, yaw, pitch, pelvisTo, rest, alignTo, settle }], // initial rigid moves
 *   fit: [{ moving, anchors, free, yawRange, pitchRange (± or [min, max]), pivot, floor }],
 *   limbContacts: [...],                         // closed by IK afterwards; `optional` ones may fall short
 * }
 *
 * An actor given as an array is a list of candidates; the one whose fit costs
 * least is kept (for instance standing or kneeling in front of a bed edge).
 * `walk` says how each placement is fitted (see fitPlacement).
 */
export function compose(input, walk = {}) {
  const hasThird = input.thirdIndex != null;
  const plan = hasThird ? { ...input, actors: input.actors.slice(0, input.thirdIndex) } : input;
  const { props } = propsFor(plan.surface);
  let specs;
  const chosen = [];
  // Limbs that IK will move onto the partner later do not block the placement.
  const ignore = input.actors.map(() => new Set());
  for (const c of input.limbContacts ?? []) {
    const chain = chainOf(c.from, c.fromSide);
    if (!chain) continue;
    const [limb, side] = chain.split(".");
    for (const bone of limb === "arm" ? ["shoulder", "elbow", "wrist", "hand"] : ["knee", "ankle", "toe"]) ignore[c.fromActor].add(`${bone}_${side}`);
  }
  const withIgnore = (step) => ({ ignore, ...step });
  if (plan.mode === "solver") {
    const { scene } = validateScene({
      actors: plan.actors.map(({ soloSurface, prefer, override, tilt, details, ...spec }) => spec),
      support: { surface: plan.solveSurface ?? plan.surface },
      relationship: plan.relationship,
      contacts: plan.contacts ?? [],
    });
    const solved = solveScene(scene, { palms: false });
    specs = scene.actors.map((a, i) =>
      applyDetails(applyOverride({ ...a, ...captureSolvedPose(solved.actors[i]) }, solved.actors[i], plan.actors[i].override), plan.actors[i].details, props)
    );
    for (const move of plan.place ?? []) specs[move.index] = applyPlace(specs[move.index], move.index, move, specs, props);
    // Refine from where the solver put them; snapping would start inside the partner.
    for (const step of plan.fit ?? []) specs[step.moving] = runFit(specs, withIgnore({ snap: false, ...step }), props, walk).spec;
  } else {
    const options = plan.actors.map((entry, i) =>
      (Array.isArray(entry) ? entry : [entry]).map((spec) => {
        const surface = spec.soloSurface ?? plan.soloSurface?.[i] ?? plan.surface;
        const { soloSurface, prefer, ...clean } = spec;
        return { ...soloFixed(clean, surface), prefer: prefer ?? 0 };
      })
    );
    specs = options.map((list) => list[0]);
    const placeFor = (index) => (plan.place ?? []).filter((m) => m.index === index);
    // Place fixed actors first (those with no candidates).
    for (let i = 0; i < specs.length; i += 1) for (const move of placeFor(i)) specs[i] = applyPlace(specs[i], i, move, specs, props);
    for (const step of plan.fit ?? []) {
      let best = null;
      for (const [k, candidate] of options[step.moving].entries()) {
        const trial = specs.slice();
        trial[step.moving] = candidate;
        for (const move of placeFor(step.moving)) trial[step.moving] = applyPlace(trial[step.moving], step.moving, move, trial, props);
        const fitted = runFit(trial, withIgnore(step), props, walk);
        const cost = fitted.cost + (candidate.prefer ?? 0);
        if (!best || cost < best.cost) best = { ...fitted, cost, k };
      }
      specs[step.moving] = best.spec;
      chosen[step.moving] = best.k;
    }
  }

  if (hasThird) {
    const spec = input.actors[input.thirdIndex];
    const { soloSurface, prefer, ...clean } = spec;
    let third = soloFixed(clean, soloSurface ?? plan.surface);
    const trial = [...specs, third];
    trial[input.thirdIndex] = applyPlace(third, input.thirdIndex, input.thirdPlace, trial, props);
    const step = { ...input.thirdFit, anchors: input.thirdFit.anchors.map((a) => ({ ...a })) };
    trial[input.thirdIndex] = fitPlacement(trial, input.thirdIndex, step.anchors, props, { free: step.free, keep: step.keep, walk }).spec;
    specs = trial;
  }

  // Close hand and leg contacts by IK with every placement held fixed.
  const limbContacts = input.limbContacts ?? [];
  if (limbContacts.length) {
    const chains = specs.map(() => new Set());
    for (const c of limbContacts) {
      const chain = chainOf(c.from, c.fromSide);
      if (chain) chains[c.fromActor].add(chain);
    }
    const { scene } = validateScene({
      actors: specs.map((s, i) => freeChains(s, [...chains[i]])),
      support: { surface: plan.surface },
      relationship: { arrangement: plan.relationship?.arrangement ?? "face_to_face", contactMode: "custom" },
      contacts: limbContacts,
    });
    const solved = solveScene(scene, { palms: false });
    const before = specs;
    specs = scene.actors.map((a, i) => ({ ...a, ...captureSolvedPose(solved.actors[i]) }));
    // A reach that would have to pass through the floor or furniture is not made: that limb
    // keeps its posed shape and the contact is dropped from the plan. So is an `optional`
    // reach that falls short of its target.
    const kept = [];
    const reached = measureContactTargets(solved);
    for (const [k, { optional, ...c }] of limbContacts.entries()) {
      const chain = chainOf(c.from, c.fromSide);
      if (!chain) {
        kept.push(c);
        continue;
      }
      const [limb, side] = chain.split(".");
      const bones = (limb === "arm" ? ARM_BONES : LEG_BONES).map((b) => `${b}_${side}`);
      const reach = [...bones, `${limb === "arm" ? "hand" : "foot"}_${side}`];
      const low = Math.min(...solved.actors[c.fromActor].volumes.filter((v) => reach.includes(v.bone)).map((v) => Math.min(v.a[1] - v.ra, v.b[1] - v.rb)));
      const intoProp = detectPropContacts([{ id: "reach", volumes: solved.actors[c.fromActor].volumes.filter((v) => reach.includes(v.bone)) }], props).some((p) => p.depth > 0.03);
      const short = optional && reached[k] != null && reached[k] > 0.08;
      if (low >= -0.02 && !intoProp && !short) {
        kept.push(c);
        continue;
      }
      // Only if the posed limb is itself clear of the partner.
      const reverted = structuredClone(specs[c.fromActor]);
      for (const bone of bones) reverted.joints[bone] = structuredClone(before[c.fromActor].joints[bone]);
      const limbVolumes = liveActor(reverted, c.fromActor).volumes.filter((v) => reach.includes(v.bone));
      const others = specs.map((spec, i) => (i === c.fromActor ? null : { id: `p${i}`, volumes: liveActor(spec, i).volumes })).filter(Boolean);
      const clash = detectContacts([{ id: "limb", volumes: limbVolumes }, ...others], { selfCollision: false }).some((x) => x.depth > 0.03 && (x.bodyA === 0 || x.bodyB === 0));
      if (clash) {
        kept.push(c);
        continue;
      }
      specs[c.fromActor] = reverted;
    }
    input.limbContacts = kept;
  }
  specs = settleWeight(specs, input, props);
  const checked = (candidate) =>
    evaluate(input, measure(sceneFor(input, candidate.map(({ prefer, soloSurface, override, tilt, details, ...spec }) => spec)).scene)).pass;
  for (const key of ["contacts", "limbContacts"]) if (input[key]) input[key] = nameContacts(specs, input[key]);
  dropUnmet(input, specs, checked);
  const failing = (candidate) =>
    evaluate(input, measure(sceneFor(input, candidate.map(({ prefer, soloSurface, override, tilt, details, ...spec }) => spec)).scene)).failures;
  const planted = plantHands(input, specs, chosen, plan.surface, checked);
  const holding = holdUp(input, planted.specs, plan.surface, failing, planted.planted);
  specs = restFreeHands(input, holding.specs, chosen, plan.surface, checked, { ...planted, planted: holding.planted });
  specs = facePalms(specs, plan.surface, [...(input.contacts ?? []), ...(input.limbContacts ?? [])], checked);
  // Hands are left to the viewer to read from the final contacts and postures;
  // a shape captured mid-composition belongs to contacts that may since have been dropped.
  return specs.map((spec) => {
    const { prefer, soloSurface, hands, ...clean } = spec;
    return clean;
  });
}

/**
 * How far short of held up and held level a figure may fall and still look
 * held: a tenth of its weight carried by nothing, or its centre of mass eight
 * centimetres past where what carries it would balance it (see `stability`).
 */
export const UNHELD = { lift: 0.1, tip: 0.08 };

/** A figure's shortfall against what may go unheld: over one, it hangs in the air. */
const shortfall = ({ lift, tip }) => Math.max(lift / UNHELD.lift, tip / UNHELD.tip);

/** Each figure's shortfall, and how far it hangs above what is under it, with the cushions and wedges the viewer will put under it. */
function shortfalls(actors, surface, props) {
  const solved = { actors, surface, props };
  const all = [...props, ...supportProps(solved)];
  const forces = bearings(solved, all);
  return { short: stability(solved, all, forces).map(shortfall), gap: hanging(solved, all, forces) };
}

/**
 * Let figures left hanging in the air down onto what is under them.
 *
 * Placing a figure by its contacts with a partner says nothing of what holds
 * it up: kneeling up behind a partner it can be fitted to their back with its
 * knees a hand's breadth off the bed, and a pair fitted to each other can come
 * out standing a foot above the floor. Each figure that falls short of being
 * held is moved as a whole - down, up a little, or tipped forward, back or to a
 * side - to where everyone is held best, so long as that takes no one further
 * into a partner, the furniture or the floor. It is moved alone or with
 * everyone, whichever holds them better: a pair all in the air comes down
 * together. Where the nearest moves leave it in the air, it is tried again
 * from tipped as far as it may go each way: bent over a partner's back with
 * its hands on nothing, the nearest moves led it the wrong way round.
 */
function settleWeight(specs, plan, props) {
  const { surface } = solveScene(sceneFor(plan, specs.map(({ prefer, soloSurface, override, tilt, details, ...spec }) => spec)).scene);
  const first = specs.map((s, i) => liveActor(s, i));
  const declared = declaredKeys(first, [...(plan.contacts ?? []), ...(plan.limbContacts ?? [])]);
  // How far past what the plan checks each figure is (see `evaluate`): landmarks
  // too far apart, hips on the wrong level, a body tipped off the way it faces or
  // turned from the way its partner does, or a carried one let down onto the floor.
  const roles = plan.roles ?? { a: 0, b: 1 };
  const at = (actors, role, name) => landmarkPoint(actors[roles[role]], name);
  const pelvis = (actors, role) => at(actors, role, "pelvis")[1];
  const front = (actors, role) => unit(sub(at(actors, role, "chest"), at(actors, role, "upperBack")))[1];
  const up = (actors, role) => unit(sub(at(actors, role, "neck"), at(actors, role, "pelvis")))[1];
  const hd = (actors, role) => heading(actors[roles[role]], { pelvis: at(actors, role, "pelvis"), front: unit(sub(at(actors, role, "chest"), at(actors, role, "upperBack"))) });
  const faces = (actors, role) => (Math.abs(front(actors, role)) > 0.7 ? hd(actors, role) : horizontal(sub(at(actors, role, "chest"), at(actors, role, "upperBack"))));
  const posed = {
    aAboveOrLevel: (actors) => pelvis(actors, "b") - 0.05 - pelvis(actors, "a"),
    bAbove: (actors) => pelvis(actors, "a") + 0.02 - pelvis(actors, "b"),
    aFaceUp: (actors) => 0.45 - front(actors, "a"),
    bFaceUp: (actors) => 0.45 - front(actors, "b"),
    aFaceDown: (actors) => front(actors, "a") + 0.45,
    bFaceDown: (actors) => front(actors, "b") + 0.45,
    aUpright: (actors) => 0.55 - up(actors, "a"),
    bUpright: (actors) => 0.55 - up(actors, "b"),
    aOffGround: (actors) => 0.12 - lowest(actors[roles.a]),
    sameFacing: (actors) => 0.5 - dot(faces(actors, "a"), faces(actors, "b")),
    sameHeading: (actors) => 0.5 - dot(hd(actors, "a"), hd(actors, "b")),
    straddleFacing: (actors) => 0.5 - dot(hd(actors, "a"), hd(actors, "b")),
    reversed: (actors) => dot(hd(actors, "a"), hd(actors, "b")) + 0.5,
    bBehind: (actors) => dot(hd(actors, "a"), sub(at(actors, "b", "pelvis"), at(actors, "a", "pelvis"))) - 0.02,
  };
  const checks = roles.b == null || specs.length < 2 ? [] : (plan.checks ?? []).flatMap((check) =>
    Array.isArray(check)
      ? [(actors) => len(sub(at(actors, check[1], check[2]), at(actors, check[3], check[4]))) - check[5]]
      : posed[check] ? [posed[check]] : []
  );
  const state = (list, actors) => {
    const { short, gap } = shortfalls(actors, surface, props);
    // A figure wholly in the air is as short of held at any height: how far it has to come down counts too.
    const cost = short.reduce((sum, s, i) => sum + s * s + (s > 1 ? (gap[i] / 0.1) ** 2 : 0), 0);
    return { list, actors, short, gap, cost, pen: penetration(actors, props, declared), low: Math.min(...actors.map(lowest)), past: checks.map((past) => past(actors)) };
  };
  const start = state(specs, first);
  if (!start.short.some((s) => s > 1)) return specs;
  // No further into a partner, the furniture or the floor than at the start, or than a scene that passes may be,
  // and no further past what the plan checks.
  const allowed = (trial) =>
    trial.pen.body <= Math.max(start.pen.body, 0.035) + 1e-6 &&
    trial.pen.prop <= Math.max(start.pen.prop, 0.025) + 1e-6 &&
    trial.low >= Math.min(start.low, -0.015) - 1e-6 &&
    trial.past.every((past, k) => past <= Math.max(start.past[k], -0.005) + 1e-6);
  let here = start;
  for (let round = 0; round < 3 && here.short.some((s) => s > 1); round += 1) {
    const groups = [...here.short.flatMap((s, i) => (s > 1 ? [[i]] : [])), here.list.map((_, i) => i)];
    let best = here;
    for (const group of groups) {
      const found = settleGroup(here, group, state, allowed);
      if (found.cost < best.cost - 1e-6) best = found;
    }
    if (best === here) break;
    here = best;
  }
  return here.list;
}

/** Move the actors in `group` together, a step at a time, to where the scene falls least short of held. */
function settleGroup(from, group, state, allowed) {
  const lead = from.actors[group[0]];
  const pivot = landmarkPoint(lead, "pelvis");
  const ahead = bodyHeading(lead);
  const across = [ahead[2], 0, -ahead[0]];
  const params = { y: 0, pitch: 0, roll: 0 };
  const at = (p) => {
    const list = from.list.map((spec, i) => {
      if (!group.includes(i)) return spec;
      const tipped = moveSpec(moveSpec(spec, { pitch: p.pitch, pitchAxis: across, pivot }), { pitch: p.roll, pitchAxis: ahead, pivot });
      return moveSpec(tipped, { translate: [0, p.y, 0] });
    });
    return state(list, list.map((spec, i) => (group.includes(i) ? liveActor(spec, i) : from.actors[i])));
  };
  let best = from;
  const inRange = (p) => p.y >= -0.4 && p.y <= 0.05 && Math.abs(p.pitch) <= 15 && Math.abs(p.roll) <= 15;
  // In the air, it first drops straight down onto what is under it: tipped
  // first, its lowest point comes down sooner, but it lands on that alone.
  const drop = Math.min(...group.map((i) => from.gap[i]));
  if (drop > 0) {
    const trial = { y: -Math.min(drop, 0.4), pitch: 0, roll: 0 };
    const result = at(trial);
    if (allowed(result) && result.cost < best.cost - 1e-6) {
      best = result;
      Object.assign(params, trial);
    }
  }
  const dropped = { ...params };
  const descend = (params, best) => {
    // Straight moves first, all the way down to the finest step; only then down
    // and tipped at once, for a figure whose knees come down only as its feet come
    // up out of the floor. Taken any sooner, a coarse diagonal step can lead off
    // to somewhere worse than straight moves would have reached.
    for (const diagonal of [false, true]) {
      for (const step of [0.04, 0.02, 0.01, 0.005]) {
        // A step of four centimetres down goes with one of six degrees round.
        const delta = { y: step, pitch: step * 150, roll: step * 150 };
        const single = ["y", "pitch", "roll"].flatMap((key) => [-1, 1].map((sign) => ({ [key]: sign * delta[key] })));
        const paired = ["pitch", "roll"].flatMap((key) => [-1, 1].flatMap((sign) => [-1, 1].map((down) => ({ y: down * delta.y, [key]: sign * delta[key] }))));
        for (let round = 0; round < 10; round += 1) {
          let move = null;
          for (const moves of diagonal ? [single, paired] : [single]) {
            for (const change of moves) {
              const trial = { ...params };
              for (const [key, value] of Object.entries(change)) trial[key] += value;
              if (!inRange(trial)) continue;
              const result = at(trial);
              if (!allowed(result) || result.cost >= (move ?? { result: best }).result.cost - 1e-6) continue;
              move = { result, trial };
            }
            if (move) break;
          }
          if (!move) break;
          best = move.result;
          Object.assign(params, move.trial);
        }
      }
      if (!best.short.some((s) => s > 1)) break;
    }
    return best;
  };
  best = descend(params, best);
  // Still in the air, it may be held better tipped the other way than the nearest moves lead it.
  if (best.short.some((s) => s > 1))
    for (const start of [{ pitch: 15 }, { pitch: -15 }, { roll: 15 }, { roll: -15 }]) {
      const trial = { ...dropped, ...start };
      const result = at(trial);
      if (!allowed(result)) continue;
      const found = descend(trial, result);
      if (found.cost < best.cost - 1e-6) best = found;
    }
  return best;
}

/**
 * Turn every hand that leans on something, touches a body or lies on the bed
 * to face it - see `turnPalms` - with the whole arm free, since the composed
 * joints are all fixed and the viewer would otherwise keep whatever twist the
 * arm was solved with. Again from where that leaves them, while it turns any:
 * a hand turned part of the way often goes further from there, and one turned
 * can free the arm beside it.
 *
 * Each turn may leave the hand's middle up to a palm's width from where it
 * was, and from where that leaves it the next goes as far again: a hand held
 * four centimetres from a partner's thigh came out of three passes eight away
 * and no longer on it. A turn that takes a hand further from what it holds
 * than it was at first, past what a palm laid on it sits off it, or that
 * leaves a contact it was on unmet, is not kept - nor one that takes the arm
 * from under a partner's hand on it (`onArm`) as far; nor is one that costs the
 * scene a check it met, which `checked(specs)` says.
 */
function facePalms(specs, surface, contacts, checked = () => true) {
  let first = null;
  // Whether the scene met its checks before any hand was turned, asked only once a turn costs it one.
  const start = specs;
  let held = null;
  // How much nearer what it holds each kept hand's middle was brought, all passes together.
  const insets = new Map();
  for (let pass = 0; pass < 3; pass++) {
    const { scene } = validateScene({
      actors: specs.map(({ prefer, soloSurface, override, tilt, details, ...spec }) => spec),
      support: { surface },
      relationship: { contactMode: "custom" },
      contacts,
    });
    const solved = solveScene(scene, { palms: false });
    first ??= measureContactTargets(solved);
    // Whether the hand at a contact has come off it: further from it than it
    // was at first, past what a palm laid on it sits off it, or off it as the
    // viewer measures it where it was on. A palm turned flat onto what it
    // holds sits nearer it than the edge or the fingers that were on it, by the
    // `inset` it was turned through, and is measured there as well as where
    // its middle is: measured only from its middle, a hand laid flat on a thigh
    // read as three centimetres off it, and was put back on its edge. The
    // viewer measures from its middle, and a palm brought flat a hand's length
    // up a hip it gripped by its fingers is on the waist.
    const away = (i, plain, flat) => {
      const near = [plain, flat].filter((d) => d != null);
      return (near.length > 0 && Math.min(...near) > Math.max(first[i] ?? 0, HAND_ON) + 0.01) || (plain > UNMET && !(first[i] > UNMET));
    };
    // Measured on the bodies as they now stand, not as their `volumes` last
    // saw them: a partner's arm turned before this hand moves the shoulder it
    // holds, and measured on the shoulder as it was, a grip was turned onto it
    // and then found eight centimetres off it.
    const holds = (actor, side, inset) => {
      const body = solved.actors[actor];
      const stale = solved.actors.map((a) => a.volumes);
      for (const a of solved.actors)
        a.volumes = poseVolumes(a.skeleton, a.evaluated, a.localVolumes, a.index, gravityHang(a.skeleton, a.evaluated, a.localVolumes));
      const plain = measureContactTargets(solved);
      (body.palmInset ??= {})[side] = (insets.get(`${actor}.${side}`) ?? 0) + inset;
      const flat = measureContactTargets(solved);
      delete body.palmInset[side];
      solved.actors.forEach((a, k) => (a.volumes = stale[k]));
      return !solved.contacts.some((contact, i) => (holdsWith(contact, actor, side) || onArm(contact, actor, side)) && away(i, plain[i], flat[i]));
    };
    const turned = turnPalms(solved, { depth: armDepth(solved.actors, solved.props, solved.surface.ground), holds, thorough: true });
    if (!turned.length) break;
    // The turned arm is written into the solved figure's own joints before it
    // is refreshed to be measured: refreshing a fixed figure puts back the
    // joints it was given, and every turn was undone before it was kept.
    const arms = turned.map(({ actor, side }) => {
      const body = solved.actors[actor];
      const arm = Object.fromEntries(ARM_BONES.map((bone) => [`${bone}_${side}`, { ...body.pose.joints[`${bone}_${side}`] }]));
      body.spec = { ...body.spec, joints: { ...body.spec.joints, ...arm } };
      return arm;
    });
    for (const index of new Set(turned.map((turn) => turn.actor))) refresh(solved.actors[index]);
    // Each hand measured again with every turn made: one turned can move what
    // another holds.
    const plain = measureContactTargets(solved);
    for (const [key, inset] of insets) {
      const [actor, side] = key.split(".");
      (solved.actors[actor].palmInset ??= {})[side] = inset;
    }
    for (const { actor, side, inset } of turned) (solved.actors[actor].palmInset ??= {})[side] = (insets.get(`${actor}.${side}`) ?? 0) + inset;
    const flat = measureContactTargets(solved);
    const on = [];
    for (const [k, { actor, side }] of turned.entries())
      if (!solved.contacts.some((contact, i) => (holdsWith(contact, actor, side) || onArm(contact, actor, side)) && away(i, plain[i], flat[i]))) on.push({ actor, side, arm: arms[k] });
    const wearing = (base, turns) => {
      const out = base.slice();
      for (const { actor, arm } of turns) out[actor] = { ...out[actor], joints: { ...out[actor].joints, ...arm } };
      return out;
    };
    // A scene that met its checks still meets them: a hand laid flat a hand's
    // breadth from the groin it is by, or an elbow swung into the partner past
    // what the scene allows, is put back, and the turns beside it are tried
    // one at a time.
    let kept = on;
    if (on.length && !checked(wearing(specs, on)) && (held ??= checked(start))) {
      kept = [];
      for (const turn of on) if (checked(wearing(specs, [...kept, turn]))) kept.push(turn);
    }
    for (const { actor, side } of kept) insets.set(`${actor}.${side}`, solved.actors[actor].palmInset[side]);
    specs = wearing(specs, kept);
    if (!kept.length) break;
  }
  return specs;
}

/** How far a free hand held up as drawn is moved to lie on what is beside it; any further and it stays up. */
const REST_REACH = 0.15;
/** How far, for an arm its source picture did not place (no arm detail). */
const PARTNER_REACH = 0.25;
/** Nearer than this to where it would lie, a hand is on it already and is not moved. */
const REST_SLACK = 0.02;
/** How far above a floor or a seat the middle of a palm lying on it is. */
const PALM_OVER = 0.03;
/** And how much higher, for each unit of its tilt off flat (the sine), a palm put down on one is held. */
const PALM_TILT = 0.05;

/**
 * How high over the floor or the seat it is put down on the middle of a palm
 * is held, tilted as it is off `aim`: a palm a few degrees off flat has its
 * little finger's edge or its thumb that much lower, and at `PALM_OVER` they
 * were a centimetre into the floor.
 */
function palmOver(body, side, aim) {
  const facing = Math.min(1, Math.abs(dot(palmNormal(body, side), aim)));
  return PALM_OVER + PALM_TILT * Math.sqrt(1 - facing ** 2);
}
/** How far an arm laid on or put down beside a partner may be into them: flesh pressed on flesh. */
const TOUCH_SLACK = 0.025;
/** What of a partner a free hand may come to rest on: not the head, the neck, the hands or the feet. */
const REST_ON = [
  "hip.l", "hip.r", "buttocks", "waist", "lowerBack", "abdomen", "back", "ribs.l", "ribs.r", "chest", "upperBack",
  "shoulder.l", "shoulder.r", "upperArm.l", "upperArm.r", "forearm.l", "forearm.r",
  "thigh.l", "thigh.r", "knee.l", "knee.r", "shin.l", "shin.r",
];
/** What of its own body: the trunk and the legs above the ankle. */
const OWN_REST = new Set(["pelvis", "spine01", "spine02", "spine03", "hip_l", "hip_r", "knee_l", "knee_r"]);

/** Whether `contact` names the hand on `side` of actor `actor` at either end, however the hand is written. */
function handIn(contact, actor, side) {
  return ["from", "to"].some((end) => {
    if (contact[`${end}Actor`] !== actor) return false;
    const [base, word] = contact[end].split(".");
    const at = { left: "l", right: "r" }[word] ?? word ?? contact[`${end}Side`];
    return (base === "hand" || base === "hands") && (at == null || at === side);
  });
}

/** Parts of an arm that moving the arm takes with it. */
const ARM_PARTS = new Set(["upperArm", "elbow", "forearm", "wrist", "hand", "hands"]);

/** Whether `contact` is something of another figure's on the arm on `side` of actor `actor`: a partner's hand on its forearm. */
function onArm(contact, actor, side) {
  if (contact.toActor !== actor || contact.fromActor === actor) return false;
  const [base, word] = contact.to.split(".");
  const at = { left: "l", right: "r" }[word] ?? word ?? contact.toSide;
  return ARM_PARTS.has(base) && (at == null || at === side);
}

/**
 * How far off the arm on `side` of `actors[index]` each partner's hand on it
 * (`onArm`) is, as the viewer measures it: an arm is moved only as far as
 * leaves them on it.
 */
function armHeld(actors, index, side, contacts) {
  return contacts
    .filter((contact) => onArm(contact, index, side))
    .map((contact) => {
      const from = actors[contact.fromActor];
      const point = from && landmarkPoint(from, contact.from, contact.fromSide);
      if (!point) return Infinity;
      const name = contact.toSide && !contact.to.includes(".") ? `${contact.to}.${contact.toSide}` : contact.to;
      const surface = landmarkSurface(actors[index], name, point, { offset: from.skeleton.stature * 0.018 });
      return surface && onRegion(actors[index], name, surface.point) ? len(sub(surface.point, point)) : Infinity;
    });
}
/** Whether a partner's hand on an arm moved is off it where it was on it (`armHeld`, before and after). */
const letGo = (before, after) => after.some((off, k) => off > Math.max(before[k], HAND_ON) + 0.01);

/** Nearer than this to the floor, the furniture or a partner, the middle of a palm is on it. */
const ON_IT = 0.06;

/**
 * Whether the figure's posture leans on the hand or forearm on `side`, and the
 * hand is on something to lean on. A posture that is drawn bent forward on its
 * hands, but held upright enough that they are a forearm off the floor, does
 * not: they are free hands, braced on nothing.
 */
function leansOn(actors, index, side, props, floor) {
  const actor = actors[index];
  const supports = actor.posture.supports.filter((s) => ["hand", "hands", "forearm"].includes(s.landmark) && (!s.side || s.side === side));
  if (!supports.length) return false;
  if (supports.some((s) => s.landmark === "forearm")) return true;
  const hand = landmarkPoint(actor, "hand", side);
  const gaps = [
    hand[1] - floor,
    ...props.map((prop) => propDistance(prop, hand).distance),
    ...actors.filter((_, k) => k !== index).map((other) => bodyDistance(hand, other.volumes)),
  ];
  return Math.min(...gaps) < ON_IT;
}

/** Whether the hand on `side` of actor `index`, or its forearm, is down on the floor or the furniture. */
function armDown(actor, side, props, floor) {
  return ["hand", "forearm"].some((name) => {
    const point = landmarkPoint(actor, name, side);
    return Math.min(point[1] - floor, ...props.map((prop) => propDistance(prop, point).distance)) < ON_IT;
  });
}

/** How far one arm is into the partners, its own body, the furniture, and how low it goes. */
function armClash(actors, index, side, props) {
  const actor = actors[index];
  const arm = new Set(ARM_BONES.concat("hand").map((bone) => `${bone}_${side}`));
  const volumes = actor.volumes.filter((v) => arm.has(v.bone));
  // Below the shoulder: the upper arm meets the chest at the armpit whatever the arm does.
  const lower = volumes.filter((v) => v.bone !== `shoulder_${side}`);
  const deepest = (a, b) => Math.max(0, ...detectContacts([{ id: "arm", volumes: a }, { id: "other", volumes: b }], { selfCollision: false }).map((c) => c.depth));
  return {
    partner: Math.max(0, ...actors.filter((_, k) => k !== index).map((other) => deepest(volumes, other.volumes))),
    own: deepest(lower, actor.volumes.filter((v) => !arm.has(v.bone))),
    prop: Math.max(0, ...detectPropContacts([{ id: "arm", volumes }], props).map((c) => c.depth)),
    low: lowest({ volumes }),
  };
}

/**
 * Whether `point` is on what a contact on `name` - "shoulder.l", "waist" - is
 * measured against when the scene is drawn: near the landmark, not only
 * anywhere on a bone beside it, where a hand put on the shoulder by the upper
 * arm's far end is drawn a forearm's length off it.
 */
function onRegion(partner, name, point) {
  const [base, side] = name.split(".");
  const measured = region(partner, base, side);
  return !!measured && len(sub(point, measured.anchor)) <= 0.8 * measured.radius;
}

/**
 * Each hand's contact named for the part of the partner the hand is on. A
 * contact says where a hand was sent - "hip" - and the reach puts the palm on
 * the nearest flesh it gets to, which may be the thigh under the hip, or the
 * forearm a partner holds up across the way; measured as the scene is drawn,
 * against the part it names, it is then a hand's breadth or more off it, and
 * the hand is shaped for a part it is not on. So a hand that is off the part
 * its contact names, and on one of those a hand rests on (`REST_ON`), has its
 * contact renamed for that one.
 */
function nameContacts(specs, contacts) {
  const actors = specs.map((spec, k) => liveActor(spec, k));
  return contacts.map((contact) => {
    const [base, word] = contact.from.split(".");
    const side = { left: "l", right: "r" }[word] ?? word ?? contact.fromSide;
    const actor = actors[contact.fromActor];
    const partner = actors[contact.toActor];
    if (base !== "hand" || !side || !actor || !partner || actor === partner) return contact;
    const hand = landmarkPoint(actor, "hand", side);
    const offset = actor.skeleton.stature * 0.018;
    const off = (name) => {
      const surface = landmarkSurface(partner, name, hand, { offset });
      return surface && onRegion(partner, name, surface.point) ? len(sub(surface.point, hand)) : Infinity;
    };
    const now = off(contact.toSide && !contact.to.includes(".") ? `${contact.to}.${contact.toSide}` : contact.to);
    if (now <= HAND_ON) return contact;
    const best = REST_ON.map((name) => ({ name, off: off(name) })).sort((a, b) => a.off - b.off)[0];
    if (!(best.off <= ON_IT && best.off < now - 0.02)) return contact;
    const { toSide, ...named } = contact;
    return { ...named, to: best.name };
  });
}

/**
 * Leave out each hand's contact the composition could not make: the hand
 * further from what it names than `UNMET`. Kept, the hand is shaped round a
 * hip a forearm's length off it, a fist closed on air; left out, the hand is
 * free, and laid on what it is beside like any other.
 * Not the last contact between the figures, nor any the scene's checks then
 * fail without (`checked`).
 */
function dropUnmet(input, specs, checked) {
  const all = [...(input.contacts ?? []), ...(input.limbContacts ?? [])];
  const { scene } = sceneFor(input, specs.map(({ prefer, soloSurface, override, tilt, details, ...spec }) => spec));
  if (!all.length || scene.contacts.length !== all.length) return;
  const distances = measureContactTargets(solveScene(scene));
  const unmet = new Set(all.filter((contact, k) => distances[k] > UNMET && /^hands?$/.test(contact.from.split(".")[0])));
  if (!unmet.size || !all.some((contact) => !unmet.has(contact) && contact.fromActor !== contact.toActor)) return;
  const was = { contacts: input.contacts, limbContacts: input.limbContacts };
  const passed = checked(specs);
  for (const key of ["contacts", "limbContacts"]) if (input[key]) input[key] = input[key].filter((contact) => !unmet.has(contact));
  if (passed && !checked(specs)) Object.assign(input, was);
}

/** Of an arm's full length, how far from its shoulder a hand is put: a little short of locked. */
const STRAIGHT = 0.97;

/** Where an arm's shoulder is, and how far from it the middle of its palm is with the arm straight. */
function armSpan(actor, side) {
  const chain = side === "l" ? LIMB_CHAINS.armL : LIMB_CHAINS.armR;
  const at = (bone) => actor.evaluated.positions[actor.skeleton.boneIndex(bone)];
  const shoulder = at(chain.root);
  const length = len(sub(at(chain.mid), shoulder)) + len(sub(at(chain.end), at(chain.mid))) + len(sub(landmarkPoint(actor, "hand", side), at(chain.end)));
  return { shoulder, length };
}

/** Whether a figure lies rather than stands, sits or kneels: its trunk nearer level than upright. */
function lying(actor) {
  return Math.abs(unit(sub(landmarkPoint(actor, "neck"), landmarkPoint(actor, "pelvis")))[1]) < 0.5;
}

/** Whether a figure is upside down: its head well under its hips. */
function inverted(actor) {
  return unit(sub(landmarkPoint(actor, "neck"), landmarkPoint(actor, "pelvis")))[1] < -0.5;
}

/** Whether a figure lies back half up, its chest to the ceiling: on the pillows, on a partner's thighs. */
function reclined(actor) {
  const up = unit(sub(landmarkPoint(actor, "neck"), landmarkPoint(actor, "pelvis")))[1];
  return up > 0 && up < 0.7 && unit(sub(landmarkPoint(actor, "chest"), landmarkPoint(actor, "upperBack")))[1] > 0.5;
}

/**
 * Where a free hand would lie: on the partner, on its own trunk, thigh or
 * knee, on the furniture or on the floor, nearest first - none when nothing is
 * within `reach` (`PARTNER_REACH`, unless the source drew the arm somewhere),
 * and only the nearest when the hand is on it already; on a partner, not on
 * a part `busy(partner, name)` says is in use. With `fall`, for a figure lying
 * down, what is under the hand counts however far down it is: an arm held up
 * off the bed by nothing falls on to it.
 */
function restFor(actors, index, side, props, floor, reach, { fall = false, busy = () => false } = {}) {
  const actor = actors[index];
  const hand = landmarkPoint(actor, "hand", side);
  const offset = actor.skeleton.stature * 0.018;
  const options = [];
  const { shoulder, length } = armSpan(actor, side);
  // No straighter than an arm is put, unless it is already.
  const span = Math.max(STRAIGHT * length, len(sub(hand, shoulder)));
  const reaches = (point) => len(sub(point, shoulder)) <= span;
  actors.forEach((partner, k) => {
    if (k === index) return;
    for (const name of REST_ON) {
      if (busy(k, name)) continue;
      let surface = landmarkSurface(partner, name, hand, { offset });
      // Beyond the arm, the same part where the arm, pointed at it, does reach.
      if (surface && !reaches(surface.point)) surface = landmarkSurface(partner, name, add(shoulder, unit(sub(surface.point, shoulder)).map((v) => v * span)), { offset });
      if (surface && reaches(surface.point) && onRegion(partner, name, surface.point)) options.push({ target: surface.point, contact: { from: `hand.${side}`, to: name, fromActor: index, toActor: k, type: "rest", strength: 0.8 } });
    }
  });
  // On its own body only where it would lie on it, not hang under it, and on
  // the outside of it, not between the legs.
  const own = actor.volumes.filter((v) => OWN_REST.has(v.bone));
  const d = bodyDistance(hand, own);
  const n = bodyNormal(hand, own);
  const outward = unit(sub(shoulder, actor.evaluated.positions[actor.skeleton.boneIndex(`shoulder_${side === "l" ? "r" : "l"}`)]));
  if (n[1] > 0.5 || (n[1] > -0.3 && dot(n, outward) > 0.3)) options.push({ target: add(hand, n.map((v) => v * (offset - d))), aim: n.map((v) => -v), own: true });
  // Or on the top of its own thigh or knee, on that side, as a hand with nothing else to lie on is put.
  for (const name of [`thigh.${side}`, `knee.${side}`]) {
    const surface = landmarkSurface(actor, name, add(landmarkPoint(actor, name), [0, 0.3, 0]), { offset });
    if (surface && surface.normal[1] >= 0.5 && /^(hip|knee)_/.test(surface.volume.bone)) options.push({ target: surface.point, aim: surface.normal.map((v) => -v), own: true });
  }
  for (const prop of props) {
    const { distance, normal } = propDistance(prop, hand);
    if (normal[1] > 0.5) options.push({ target: add(hand, normal.map((v) => v * (PALM_OVER - distance))), aim: normal.map((v) => -v) });
  }
  options.push({ target: [hand[0], floor + PALM_OVER, hand[2]], aim: [0, -1, 0], fall });
  // Or swung down about the shoulder, as far out as it is, on to the floor or
  // the furniture under it - an arm held up over the shoulder out to its side
  // and towards its feet, as a lying figure's arm falls.
  const out = level(sub(hand, shoulder));
  const arm = len(sub(hand, shoulder));
  const ways = fall && out.some(Boolean) ? [{ way: out, at: hand }] : [];
  if (fall && hand[1] - shoulder[1] > arm / 2) {
    const way = level(add(outward, level(sub(landmarkPoint(actor, "pelvis"), landmarkPoint(actor, "neck"))).map((v) => v * 0.7)));
    ways.push({ way, at: add(shoulder, way.map((v) => v * arm)), swing: true });
    // On its side, out to the side is up: the arm falls in front of the chest.
    const front = level(sub(landmarkPoint(actor, "chest"), landmarkPoint(actor, "upperBack")));
    if (Math.abs(outward[1]) > 0.5 && front.some(Boolean)) ways.push({ way: front, at: add(shoulder, front.map((v) => v * arm)), swing: true });
  }
  for (const { way, at, swing } of ways)
    for (const top of [floor, ...props.map((prop) => propTopAt(prop, at[0], at[2]))]) {
      const drop = top == null ? NaN : top + PALM_OVER - shoulder[1];
      if (!(top + PALM_OVER < hand[1] && Math.abs(drop) < arm)) continue;
      const target = add(shoulder, [way[0] * Math.sqrt(arm ** 2 - drop ** 2), drop, way[2] * Math.sqrt(arm ** 2 - drop ** 2)]);
      // On the top it was measured off, not over an edge of it.
      if (top !== floor && !props.some((prop) => Math.abs((propTopAt(prop, target[0], target[2]) ?? Infinity) - top) < 0.02)) continue;
      options.push({ target, aim: [0, -1, 0], fall, swing });
    }
  // Or, held out past the edge of the furniture, drawn back on to its top.
  if (fall && out.some(Boolean))
    for (const prop of props) {
      if (propTopAt(prop, hand[0], hand[2]) != null) continue;
      const back = [0.05, 0.1, 0.15, 0.2].find((step) => propTopAt(prop, hand[0] - out[0] * step, hand[2] - out[2] * step) != null);
      const top = back && propTopAt(prop, hand[0] - out[0] * (back + 0.04), hand[2] - out[2] * (back + 0.04));
      if (top != null && top + PALM_OVER < hand[1]) options.push({ target: [hand[0] - out[0] * (back + 0.04), top + PALM_OVER, hand[2] - out[2] * (back + 0.04)], aim: [0, -1, 0], fall });
    }
  // A palm laid on the floor or a seat lies as high over it as its tilt needs (`palmOver`): lower, it is not on it but in it.
  const near = options
    .map((option) => ({ ...option, move: len(sub(option.aim && !option.own ? add(option.target, [0, palmOver(actor, side, option.aim) - PALM_OVER, 0]) : option.target, hand)) }))
    .filter((option) => (option.move <= reach || option.swing || (fall && option.target[1] < hand[1] && Math.hypot(option.target[0] - hand[0], option.target[2] - hand[2]) <= reach)) && reaches(option.target))
    .sort((a, b) => a.move - b.move);
  if (near.length && near[0].move < REST_SLACK) return near[0].contact ? [near[0]] : [];
  return near;
}

/** Arm shapes put round the partner, whose hands go on to them where they fall short. */
const REACHING_ARMS = new Set(["arms_around"]);
/** Arm shapes that hold the hands up: over the head, on the straps. */
const RAISED_ARMS = new Set(["arms_overhead", "arms_straps"]);
/** Higher than this over its shoulder, the hand of a figure that is not lying down is held up as drawn. */
const HELD_UP = 0.25;

/** How many places on a partner, and how many elsewhere, a free hand is tried on, the nearest first, before it is left where it is. */
const REST_TRIES = 4;

/**
 * Lay each free hand on what is beside it. A hand that holds nothing and that
 * its posture does not lean on was left wherever its arm was posed: a hand's
 * breadth over the bed, off a partner's thigh, in the side it hangs by, which
 * reads as a hand held stiffly in the air, or as one in the body. Its arm is
 * bent until it lies on the nearest it reaches of the partner, the top of its
 * own thigh or knee, its own trunk, the furniture or the floor, as a hand at
 * rest does. One laid on a partner rests there as a `rest` contact, so the
 * viewer cups it and the palm is turned onto them like any other hand that
 * touches; one laid on anything else has its palm turned onto it here.
 *
 * Only a hand the picture holds up stays up: one the record raises
 * (`input.raised`, `RAISED_ARMS`), or one higher than `HELD_UP` over the
 * shoulder of a figure that stands, sits or kneels. It goes only on what is
 * within `REST_REACH` of it - `PARTNER_REACH`, for an arm the source did not
 * draw anywhere in particular - and one drawn behind the head lies on the back
 * of it. A figure upside down holds nothing up. A hand flat on a wall, or on
 * the side of the furniture, is braced on it, and stays there; one is not laid
 * on a partner's arm that holds something (`busy`), which is turned to face
 * what it holds and would leave the hand on its edge. An arm put round or out
 * towards the partner (`reaching`) goes on to them first. A figure lying down
 * (`lying`), or lying back half up (`reclined`), has an arm held up over
 * nothing fall: swung down about the shoulder on to the floor or the furniture
 * under it - out to the side and towards the feet if it was up over the
 * shoulder - or drawn back on to the top it is held out past, the hand on its
 * palm, or else on its back.
 *
 * A reach that takes the arm into the partner, its own body or the furniture
 * further than it already was - past `TOUCH_SLACK`, for a hand laid on a body -
 * or under the floor, is not made, nor one the scene's checks will not have
 * (`checked`). A hand whose knuckles or thumb a reach puts into the floor is
 * put down again that much higher. Each place is tried again with the elbow
 * out to the side, as an arm laid on something bends, and a fallen hand with
 * it up; then the next nearest is tried, up to `REST_TRIES` on a partner and as
 * many elsewhere that the arm reaches. A hand `plantHands` put down stays
 * down; one it was to put down and could not reaches as far as an arm the
 * source did not draw. A tied figure's (`bound`) stay where they are, and an
 * arm a partner's hand holds or has been laid on (`onArm`) goes only where it
 * takes their hand with it (`armHeld`).
 */
function restFreeHands(input, specs, chosen, surfaceName, checked, { sought = new Set(), planted = new Set() } = {}) {
  const { props } = propsFor(surfaceName);
  // The floor, beside a bed or a sofa as under a chair: their ground is their top.
  const floor = 0;
  const held = [...(input.contacts ?? []), ...(input.limbContacts ?? [])];
  const specOf = (index) => {
    const entry = input.actors[index];
    return Array.isArray(entry) ? entry[chosen[index] ?? 0] : entry;
  };
  const drawn = (index, side) => Object.keys(specOf(index)?.details ?? {}).some((bone) => bone === `shoulder_${side}` || bone === `elbow_${side}`);
  const reaching = (index, side) => REACHING_ARMS.has(specOf(index)?.arms) || (input.reach ?? []).some((reach) => reach.index === index && (!reach.side || reach.side === side));
  const raised = (index, side) => (RAISED_ARMS.has(specOf(index)?.arms) && !drawn(index, side)) || (input.raised ?? []).some((up) => up.index === index && (!up.side || up.side === side));
  const behindHead = (index, side) => (input.raised ?? []).some((up) => up.head && up.index === index && (!up.side || up.side === side));
  const wearing = (base, rests) => {
    const out = base.slice();
    for (const { actor, arm } of rests) out[actor] = { ...out[actor], joints: { ...out[actor].joints, ...arm } };
    return out;
  };
  let out = specs;
  const rests = [];
  const bound = new Set(input.bound ?? []);
  for (let index = 0; index < specs.length; index += 1)
    for (const side of ["l", "r"]) {
      const on = [...held, ...rests.map((rest) => rest.contact).filter(Boolean)];
      if (bound.has(index) || planted.has(`${index}.${side}`) || on.some((contact) => handIn(contact, index, side))) continue;
      const actors = out.map((spec, k) => liveActor(spec, k));
      const actor = actors[index];
      // The hands of partners that hold the arm, or were laid on it, as far off it as they are.
      const holding = armHeld(actors, index, side, on);
      if (leansOn(actors, index, side, props, floor)) continue;
      // Nor is one flat on a wall, or on the side of the furniture: braced on it.
      const hand = landmarkPoint(actor, "hand", side);
      const braced = (prop) => {
        const { distance, normal } = propDistance(prop, hand);
        return distance < ON_IT && Math.abs(normal[1]) <= 0.5 && dot(palmNormal(actor, side), normal) < -0.5;
      };
      if (props.some(braced)) continue;
      // Lying down, or lying back half up, an arm held up over nothing falls.
      const flat = lying(actor) || reclined(actor);
      // A hand held up as drawn - over the head, or well over the shoulder of a figure that stands, sits or kneels -
      // only goes on what is beside it; any other, and any of a figure upside down, goes on whatever its arm reaches.
      const up = !flat && !inverted(actor) && (raised(index, side) || hand[1] - landmarkPoint(actor, "shoulder", side)[1] > HELD_UP);
      const reach = !up ? Infinity : drawn(index, side) && !sought.has(`${index}.${side}`) ? REST_REACH : PARTNER_REACH;
      // Not on a partner's arm that holds something: the arm is turned to face what it holds, and the hand on it is left on its edge.
      const busy = (k, name) => /^(upperArm|forearm)\./.test(name) && on.some((contact) => handIn(contact, k, name.split(".")[1]));
      let options = restFor(actors, index, side, props, floor, reach, { fall: flat, busy });
      // An arm put out towards the partner goes on to them first.
      if (reaching(index, side) && !sought.has(`${index}.${side}`)) {
        const onto = restFor(actors, index, side, props, floor, Infinity, { busy }).filter((option) => option.contact);
        if (onto.length) options = up ? onto : [...onto, ...options.filter((option) => !option.contact)];
      }
      // A hand drawn behind the head lies on the back of it.
      if (behindHead(index, side)) {
        const surface = landmarkSurface(actor, "head", hand, { offset: actor.skeleton.stature * 0.018 });
        if (surface) options = [{ target: surface.point, aim: surface.normal.map((v) => -v), own: true, move: len(sub(surface.point, hand)) }, ...options];
      }
      if (options.length && options[0].move < REST_SLACK) {
        rests.push({ actor: index, arm: {}, contact: options[0].contact });
        continue;
      }
      const chain = side === "l" ? LIMB_CHAINS.armL : LIMB_CHAINS.armR;
      const { skeleton } = actor;
      const was = armClash(actors, index, side, props);
      // The nearest a hand can lie on: one an arm cannot reach, or reaches only through something, gives way to the next.
      const tried = [];
      // Those it does reach, on a partner and off one, and how many: one it does not is no try.
      const reached = { on: [], off: [] };
      // A lying figure's hand fallen on to the floor or the bed lies on its palm, or else on its back;
      // each is tried again with the elbow out to the side, and up off the floor.
      const outward = unit(sub(landmarkPoint(actor, "shoulder", side), landmarkPoint(actor, "shoulder", side === "l" ? "r" : "l")));
      const queue = options.flatMap((option) => (option.fall ? [option, { ...option, aim: [0, 1, 0] }, { ...option, elbow: outward }, { ...option, elbow: [0, 1, 0] }] : [option, { ...option, elbow: outward }]));
      for (let q = 0; q < queue.length; q += 1) {
        const rest = queue[q];
        const again = tried.some((target) => len(sub(target, rest.target)) < 0.02);
        if (again && !rest.fall && !rest.elbow && !rest.lifted) continue;
        const kind = rest.contact ? "on" : "off";
        if (!again && reached[kind].length >= REST_TRIES) continue;
        if (!again && tried.length >= 4 * REST_TRIES) break;
        if (!again) tried.push(rest.target);
        const pose = { root: actor.pose.root, joints: structuredClone(actor.pose.joints) };
        const body = { skeleton, pose, evaluated: actor.evaluated, localVolumes: actor.localVolumes };
        // Laid on anything but a partner - whose contact turns it at view - the palm is turned onto it here.
        const turn = !rest.contact && rest.aim;
        const fingers = turn && level(sub(rest.target, landmarkPoint(actor, "pelvis")));
        // On the floor or a seat, as high as the palm's tilt takes its edge.
        const goal = () => (turn && !rest.own ? add(rest.target, [0, palmOver(body, side, rest.aim) - PALM_OVER, 0]) : rest.target);
        // The wrist is what the chain ends at; the palm's middle is a little past it, and turns with the arm.
        for (let pass = 0; pass < 4; pass += 1) {
          const at = (bone) => body.evaluated.positions[skeleton.boneIndex(bone)];
          const hand = landmarkPoint(body, "hand", side);
          const pole = rest.elbow ?? sub(at(chain.mid), add(at(chain.root), at(chain.end)).map((v) => v / 2));
          body.evaluated = solveTwoBoneIK(skeleton, pose, chain, add(goal(), sub(at(chain.end), hand)), { pole, evaluated: body.evaluated }).evaluated;
          if (turn && pass < 3) turnPalm(body, side, rest.aim, { fingers, sweep: pass === 0 });
        }
        const arm = { [chain.root]: pose.joints[chain.root], [chain.mid]: pose.joints[chain.mid], ...(turn ? { [chain.end]: pose.joints[chain.end] } : {}) };
        const moved = wearing(out, [{ actor: index, arm }]);
        const after = moved.map((spec, k) => (k === index ? liveActor(spec, k) : actors[k]));
        if (len(sub(landmarkPoint(after[index], "hand", side), goal())) > 0.03) continue;
        if (!reached[kind].some((target) => len(sub(target, rest.target)) < 0.02)) reached[kind].push(rest.target);
        const now = armClash(after, index, side, props);
        if (rest.fall && dot(palmNormal(after[index], side), rest.aim) < 0.8) continue;
        if (letGo(holding, armHeld(after, index, side, on))) continue;
        // A hand laid on its own body presses on it as on a partner's.
        if (now.partner > Math.max(was.partner, rest.contact ? TOUCH_SLACK : 0.015) || now.own > Math.max(was.own, rest.own ? TOUCH_SLACK : 0.015) || now.prop > Math.max(was.prop, 0.01)) continue;
        if (now.low < Math.min(was.low, floor - 0.005)) {
          // A hand put down on the floor whose knuckles or thumb go into it is put down again that much higher.
          if (!rest.lifted && rest.target[1] - floor < PALM_OVER + 0.01) queue.splice(q + 1, 0, { ...rest, target: add(rest.target, [0, floor + 0.005 - now.low, 0]), lifted: true });
          continue;
        }
        out = moved;
        rests.push({ actor: index, arm, contact: rest.contact });
        break;
      }
    }
  if (!rests.length) return specs;
  // A scene that met its checks still meets them, or the hands are laid one at a time.
  let kept = rests;
  if (!checked(out) && checked(specs)) {
    kept = [];
    for (const rest of rests) if (checked(wearing(specs, [...kept, rest]))) kept.push(rest);
  }
  input.limbContacts = [...(input.limbContacts ?? []), ...kept.filter((rest) => rest.contact).map((rest) => rest.contact)];
  return wearing(specs, kept);
}

/** Arm shapes whose hands are on what the figure is on, and where: in front of or under it, or behind it. */
const PLANTED_ARMS = { arms_planted: "down", arms_on_prop: "down", arms_braced_behind: "behind" };
/** Arm shapes that put the hands somewhere of their own, which are not put down: on the forearms, round the partner, over the head. */
const PLACED_ARMS = new Set(["arms_forearms", "arms_around", "arms_overhead"]);
/** How far from where a planted hand would rather be it may go to find somewhere it reaches and fits. */
const PLANT_RINGS = [0, 0.06, 0.12, 0.18, 0.26, 0.34];

/**
 * Put down on the bed, the floor or the seat the hands the source picture
 * puts there. A record whose partner props themselves on their hands, or
 * leans back on them, says so - `plan.plant`, and the arm shapes that say it
 * (`PLANTED_ARMS`) - but the shape is a set of angles, and a set of angles
 * puts a hand where it puts it: of the hands the library said were planted,
 * five in six hung in the air, a hand's length or more over the floor, with
 * the brace's spread fingers on nothing.
 *
 * So the arm is bent and swung, by IK, until the middle of the palm is on the
 * highest thing under the shoulder it can reach - or, braced behind, the one
 * nearest the hips - beside the shoulder (in front of it for a figure upright,
 * under it for one face down), or behind the hips, or as near there as it
 * reaches without the arm going into the partner, its own body or the
 * furniture; and the palm is turned flat onto it, the fingers away from the
 * body. Where what the figure is on is out of its reach - a figure kneeling
 * up over a partner who lies on the bed - the palm goes on the partner under
 * the shoulder instead, on the top of them, as a `rest` contact. A palm on the
 * floor or a seat is held as far over it as its tilt needs (`palmOver`).
 *
 * A hand its posture already stands on, or that holds something, is left
 * alone - but one stood on the floor or a seat lower over it than that is put
 * down again where it is, that high. Also left alone are a hand with nowhere
 * it reaches, one the scene's checks will not have put down (`checked`), a
 * tied figure's (`bound`), an arm the template draws somewhere of its own
 * (`PLACED_ARMS`) and the record's details do not draw over, and, where it is
 * only the posture that leans on the hands, an arm the record's details draw.
 * An arm a partner's hand holds or was put down on (`onArm`) is put down only
 * where it takes their hand with it (`armHeld`).
 * Returns the specs and the hands put down, or that should have been.
 */
function plantHands(input, specs, chosen, surfaceName, checked) {
  const { surface, props } = propsFor(surfaceName);
  const floor = 0;
  // What can be leant on: the furniture, not a car's shell.
  const tops = (surface.props ?? []).map(withBounds);
  const held = [...(input.contacts ?? []), ...(input.limbContacts ?? [])];
  const specOf = (index) => {
    const entry = input.actors[index];
    return Array.isArray(entry) ? entry[chosen[index] ?? 0] : entry;
  };
  const wanted = new Map();
  const bound = new Set(input.bound ?? []);
  // The record's details draw an arm over the shape the template gave it.
  const drawn = (index, side) => Object.keys(specOf(index)?.details ?? {}).some((bone) => bone === `shoulder_${side}` || bone === `elbow_${side}`);
  // An arm the template draws somewhere of its own - on the forearms, round the partner, over the head - keeps it.
  const placed = (index, side) => PLACED_ARMS.has(specOf(index)?.arms) && !drawn(index, side);
  for (const { index, side, where } of input.plant ?? []) for (const s of side ? [side] : ["l", "r"]) if (!placed(index, s)) wanted.set(`${index}.${s}`, { index, side: s, where });
  // And the hands a posture is drawn leaning on, where they are on nothing, but for an arm the record draws another way.
  const posed = specs.map((spec, k) => liveActor(spec, k));
  // What a hand stood on the floor or a seat is on, where it is lower over it than a palm laid there.
  const sunk = (actor, side) => {
    const hand = landmarkPoint(actor, "hand", side);
    const top = Math.max(floor, ...tops.map((prop) => propTopAt(prop, hand[0], hand[2]) ?? -Infinity).filter((t) => t <= hand[1]));
    return hand[1] - top < palmOver(actor, side, [0, -1, 0]) - 0.01 ? top : null;
  };
  specs.forEach((_, index) => {
    const where = PLANTED_ARMS[specOf(index)?.arms];
    for (const side of ["l", "r"]) {
      if (wanted.has(`${index}.${side}`)) continue;
      const supports = posed[index].posture.supports.filter((s) => !s.side || s.side === side).map((s) => s.landmark);
      const leans = supports.includes("hand") || supports.includes("hands");
      if (where) wanted.set(`${index}.${side}`, { index, side, where });
      else if (!placed(index, side) && !drawn(index, side) && leans && !leansOn(posed, index, side, props, floor))
        wanted.set(`${index}.${side}`, { index, side, where: "down" });
      // One it does lean on, or on the forearm beside it, too low: put down again where it is.
      else if ((leans || supports.includes("forearm")) && sunk(posed[index], side) != null) wanted.set(`${index}.${side}`, { index, side, where: "lift" });
    }
  });
  const wearing = (base, plants) => {
    const out = base.slice();
    for (const { actor, arm } of plants) out[actor] = { ...out[actor], joints: { ...out[actor].joints, ...arm } };
    return out;
  };
  let out = specs;
  const plants = [];
  const sought = new Set();
  for (const { index, side, where } of wanted.values()) {
    if (index >= specs.length || bound.has(index) || held.some((contact) => handIn(contact, index, side))) continue;
    const actors = out.map((spec, k) => liveActor(spec, k));
    const actor = actors[index];
    // The hands of partners that hold the arm, or were put down on it, as far off it as they are.
    const holders = [...held, ...plants.map((plant) => plant.contact).filter(Boolean)];
    const holding = armHeld(actors, index, side, holders);
    // A hand on something already is only put down again higher.
    const on = where === "lift" || leansOn(actors, index, side, props, floor);
    const lift = on ? sunk(actor, side) : null;
    if (on && lift == null) continue;
    if (!on) sought.add(`${index}.${side}`);
    const chain = side === "l" ? LIMB_CHAINS.armL : LIMB_CHAINS.armR;
    const { skeleton } = actor;
    const at = (bone, evaluated = actor.evaluated) => evaluated.positions[skeleton.boneIndex(bone)];
    const { shoulder, length } = armSpan(actor, side);
    const front = level(sub(landmarkPoint(actor, "chest"), landmarkPoint(actor, "upperBack")));
    const outward = level(sub(shoulder, at(`shoulder_${side === "l" ? "r" : "l"}`)));
    const pelvis = landmarkPoint(actor, "pelvis");
    const base = add(add(shoulder, front.map((v) => v * (where === "behind" ? -0.22 : 0.12))), outward.map((v) => v * 0.1));
    const limit = where === "behind" ? pelvis[1] + 0.15 : shoulder[1] - 0.1;
    const under = (x, z) => {
      let top = floor <= limit ? floor : null;
      for (const prop of tops) {
        const t = propTopAt(prop, x, z);
        if (t != null && t <= limit && (top == null || t > top)) top = t;
      }
      return top;
    };
    const trunk = actor.volumes.filter((v) => !/^(clavicle|shoulder|elbow|wrist|hand)_/.test(v.bone));
    const offset = skeleton.stature * 0.018;
    const reaches = (target) => {
      const reach = len(sub(target, shoulder));
      return reach <= STRAIGHT * length && reach >= 0.45 * length;
    };
    const clear = (target, skip) => bodyDistance(target, trunk) >= 0.04 && actors.every((other, k) => k === index || k === skip || bodyDistance(target, other.volumes) >= 0.04);
    const down = [];
    const onto = [];
    if (lift != null) {
      const hand = landmarkPoint(actor, "hand", side);
      down.push({ target: [hand[0], lift + PALM_OVER, hand[2]], aim: [0, -1, 0] });
    }
    for (const r of lift != null ? [] : PLANT_RINGS)
      for (let k = 0; k < (r ? 8 : 1); k += 1) {
        const x = base[0] + r * Math.cos((k * Math.PI) / 4);
        const z = base[2] + r * Math.sin((k * Math.PI) / 4);
        const top = under(x, z);
        const target = top == null ? null : [x, top + PALM_OVER, z];
        if (target && reaches(target) && clear(target)) down.push({ target, aim: [0, -1, 0] });
        // Or the partner under the shoulder, where what the figure is on is beyond its reach.
        actors.forEach((partner, p) => {
          if (p === index) return;
          let y = limit;
          let d = bodyDistance([x, y, z], partner.volumes);
          if (d <= 0) return;
          while (d > 0.002 && y > (top ?? 0)) {
            y -= Math.max(d * 0.9, 0.004);
            d = bodyDistance([x, y, z], partner.volumes);
          }
          if (d > 0.002 || bodyNormal([x, y, z], partner.volumes)[1] < 0.5) return;
          const touch = [x, y, z];
          let best = null;
          for (const name of REST_ON) {
            const surface = landmarkSurface(partner, name, touch, { offset });
            if (!surface || surface.normal[1] < 0.5) continue;
            // Of the names the place answers to - a thigh's top is the hip's too - the one it is nearest the middle of.
            const off = len(sub(surface.point, touch));
            const score = off + 0.1 * len(sub(surface.point, surface.anchor));
            if (off <= offset + 0.03 && onRegion(partner, name, surface.point) && (!best || score < best.score)) best = { ...surface, name, score };
          }
          if (!best || !reaches(best.point) || !clear(best.point, p)) return;
          onto.push({ target: best.point, aim: best.normal.map((v) => -v), contact: { from: `hand.${side}`, to: best.name, fromActor: index, toActor: p, type: "rest", strength: 0.8 } });
        });
      }
    const was = armClash(actors, index, side, props);
    for (const { target, aim, contact } of [...down, ...onto]) {
      const pose = { root: actor.pose.root, joints: structuredClone(actor.pose.joints) };
      const body = { skeleton, pose, evaluated: actor.evaluated, localVolumes: actor.localVolumes };
      // The fingers run away from the body, as a hand leant on spreads them.
      const fingers = level(sub(target, pelvis));
      // On the floor or a seat, as high as the palm's tilt takes its edge.
      const goal = () => (contact ? target : add(target, [0, palmOver(body, side, aim) - PALM_OVER, 0]));
      for (let pass = 0; pass < 4; pass += 1) {
        const hand = landmarkPoint(body, "hand", side);
        const pole = sub(at(chain.mid, body.evaluated), add(at(chain.root, body.evaluated), at(chain.end, body.evaluated)).map((v) => v / 2));
        body.evaluated = solveTwoBoneIK(skeleton, pose, chain, add(goal(), sub(at(chain.end, body.evaluated), hand)), { pole, evaluated: body.evaluated }).evaluated;
        if (pass < 3) turnPalm(body, side, aim, { fingers, sweep: pass === 0 });
      }
      if (len(sub(landmarkPoint(body, "hand", side), goal())) > 0.03 || dot(palmNormal(body, side), aim) < 0.8) continue;
      const arm = Object.fromEntries([chain.root, chain.mid, chain.end].map((bone) => [bone, pose.joints[bone]]));
      const moved = wearing(out, [{ actor: index, arm }]);
      const after = moved.map((spec, k) => (k === index ? liveActor(spec, k) : actors[k]));
      const now = armClash(after, index, side, props);
      if (now.partner > Math.max(was.partner, TOUCH_SLACK) || now.own > Math.max(was.own, 0.015) || now.prop > Math.max(was.prop, 0.01)) continue;
      if (now.low < Math.min(was.low, floor - 0.005)) continue;
      if (letGo(holding, armHeld(after, index, side, holders))) continue;
      out = moved;
      plants.push({ actor: index, side, arm, contact });
      break;
    }
  }
  if (!plants.length) return { specs, sought, planted: new Set() };
  // A scene that met its checks still meets them, or the hands are put down one at a time.
  let kept = plants;
  if (!checked(out) && checked(specs)) {
    kept = [];
    for (const plant of plants) if (checked(wearing(specs, [...kept, plant]))) kept.push(plant);
  }
  input.limbContacts = [...(input.limbContacts ?? []), ...kept.filter((plant) => plant.contact).map((plant) => plant.contact)];
  return { specs: wearing(specs, kept), sought, planted: new Set(kept.map((plant) => `${plant.actor}.${plant.side}`)) };
}

/** How many hands, at most, are put to holding up figures nothing else holds up. */
const HOLD_HANDS = 4;
/** Held only just, a figure is held by another hand where one helps: falling half as short as it may, it holds the pose with some to spare. */
const SPARE = 0.5;
/** How far from under its shoulder a hand put down to hold its own figure up may go. */
const HOLD_RINGS = [0, 0.08, 0.16, 0.24];
/** What of a body a hand closes round, rather than lies on: a limb. */
const ROUND_PART = /^(thigh|knee|shin|upperArm|forearm)\./;

/**
 * Hold up with the hands a figure nothing else holds up. Fitted by its
 * contacts with a partner, a figure can come out bent over at the partner's
 * hips with its face buried in them and nothing under its chest, or held out
 * level by a partner's hips against its own, while the hands that would hold
 * it - its own, put down on the floor or on the partner, or the partner's,
 * round its thighs or under its hips - hang at the sides or lie on its own
 * thighs. Nobody holds a pose like that: they would fall.
 *
 * So, for each figure that falls short of held (`stability`), the free hands
 * are tried where they would hold it: its own on the top of a partner, round a
 * partner's limb, or on the floor or the furniture under and in front of the
 * shoulder; a partner's on it, round a limb of it or under it. Each is put
 * there by IK as a hand laid on anything is, the palm turned onto it, and the
 * hand whose hold leaves everyone least short of held is kept; then the next,
 * up to `HOLD_HANDS`, while any figure is short or held only just (`SPARE`). A
 * hand on a partner holds them as a `grip` contact, round a limb, or a `rest`,
 * on the trunk.
 *
 * A hand that holds something already, that a posture leans on and is down on
 * the floor or furniture (the record may draw the arm up off it), that
 * `plantHands` put down, or a tied figure's, is not moved - but for a
 * partner's the template puts on the figure, at its thighs, say, which may
 * hold it elsewhere on it, under its belly, and lets go where it was; nor is an
 * arm moved further into a partner, its own body or the furniture than it was,
 * under the floor, or from under a partner's hand on it (`armHeld`). The holds
 * are kept only so long as they cost the scene no check but how well it is
 * held, which `failing(specs)` lists - or, failing that, those that cost it
 * none one at a time. Returns the specs and the hands put down or holding.
 */
function holdUp(input, specs, surfaceName, failing, planted = new Set()) {
  const { surface: shape, props } = propsFor(surfaceName);
  const floor = 0;
  const tops = (shape.props ?? []).map(withBounds);
  const clean = (list) => list.map(({ prefer, soloSurface, override, tilt, details, ...spec }) => spec);
  const { surface } = solveScene(sceneFor(input, clean(specs)).scene);
  const assess = (actors) => {
    const { short } = shortfalls(actors, surface, props);
    return { short, cost: short.reduce((sum, s) => sum + s * s, 0) };
  };
  let actors = specs.map((spec, k) => liveActor(spec, k));
  let state = assess(actors);
  if (!state.short.some((s) => s > 1)) return { specs, planted };
  const bound = new Set(input.bound ?? []);
  const held = [...(input.contacts ?? []), ...(input.limbContacts ?? [])];
  const limbs = new Set(input.limbContacts ?? []);
  const wearing = (base, holds) => {
    const out = base.slice();
    for (const { actor, arm } of holds) out[actor] = { ...out[actor], joints: { ...out[actor].joints, ...arm } };
    return out;
  };
  let out = specs;
  const holds = [];
  for (let round = 0; round < HOLD_HANDS && state.short.some((s) => s > SPARE); round += 1) {
    const weak = state.short.flatMap((s, i) => (s > SPARE ? [i] : []));
    let best = null;
    for (let index = 0; index < out.length; index += 1)
      for (const side of ["l", "r"]) {
        const key = `${index}.${side}`;
        if (bound.has(index) || planted.has(key) || holds.some((hold) => hold.key === key)) continue;
        const on = [...held.filter((contact) => !holds.some((hold) => hold.replaces === contact)), ...holds.map((hold) => hold.contact).filter(Boolean)];
        const mine = on.filter((contact) => handIn(contact, index, side));
        // A hand the template puts on a figure nothing holds up may hold it elsewhere, where it holds it up.
        const moving = mine.length === 1 && limbs.has(mine[0]) && mine[0].fromActor === index && mine[0].toActor !== index && /^hands?\b/.test(mine[0].from) && weak.includes(mine[0].toActor) ? mine[0] : null;
        // A posture's hand it leans on stays, unless the record has drawn the arm up off the floor.
        if ((mine.length && !moving) || (leansOn(actors, index, side, props, floor) && armDown(actors[index], side, props, floor))) continue;
        const actor = actors[index];
        const own = weak.includes(index) && !moving;
        if (!own && !weak.some((k) => k !== index)) continue;
        const holding = armHeld(actors, index, side, on.filter((contact) => contact !== moving));
        const chain = side === "l" ? LIMB_CHAINS.armL : LIMB_CHAINS.armR;
        const { skeleton } = actor;
        const at = (bone, evaluated = actor.evaluated) => evaluated.positions[skeleton.boneIndex(bone)];
        const { shoulder, length } = armSpan(actor, side);
        const reaches = (target) => {
          const reach = len(sub(target, shoulder));
          return reach <= STRAIGHT * length && reach >= 0.45 * length;
        };
        const hand = landmarkPoint(actor, "hand", side);
        const offset = skeleton.stature * 0.018;
        const targets = [];
        const fresh = (target) => !targets.some((other) => len(sub(other.target, target)) < 0.03);
        // On a partner: its own hand on the top of them or round a limb, a partner's on it anywhere it reaches.
        actors.forEach((other, k) => {
          if (k === index || (!own && !weak.includes(k)) || (moving && k !== moving.toActor)) return;
          for (const name of REST_ON)
            for (const probe of [hand, shoulder]) {
              const surf = landmarkSurface(other, name, probe, { offset });
              if (!surf || !onRegion(other, name, surf.point) || !reaches(surf.point) || !fresh(surf.point)) continue;
              if (own && surf.normal[1] < 0.5 && !ROUND_PART.test(name)) continue;
              targets.push({ target: surf.point, aim: surf.normal.map((v) => -v), contact: { from: `hand.${side}`, to: name, fromActor: index, toActor: k, type: ROUND_PART.test(name) ? "grip" : "rest", strength: 0.8 } });
            }
        });
        // Its own, put down on what is under the shoulder, a little in front of it and out to its side.
        if (own) {
          const front = level(sub(landmarkPoint(actor, "chest"), landmarkPoint(actor, "upperBack")));
          const outward = level(sub(shoulder, at(`shoulder_${side === "l" ? "r" : "l"}`)));
          const base = add(add(shoulder, front.map((v) => v * 0.12)), outward.map((v) => v * 0.1));
          const trunk = actor.volumes.filter((v) => !/^(clavicle|shoulder|elbow|wrist|hand)_/.test(v.bone));
          for (const r of HOLD_RINGS)
            for (let k = 0; k < (r ? 8 : 1); k += 1) {
              const x = base[0] + r * Math.cos((k * Math.PI) / 4);
              const z = base[2] + r * Math.sin((k * Math.PI) / 4);
              let top = floor;
              for (const prop of tops) {
                const t = propTopAt(prop, x, z);
                if (t != null && t <= shoulder[1] - 0.1 && t > top) top = t;
              }
              const target = [x, top + PALM_OVER, z];
              if (reaches(target) && fresh(target) && bodyDistance(target, trunk) >= 0.04 && actors.every((other, j) => j === index || bodyDistance(target, other.volumes) >= 0.04))
                targets.push({ target, aim: [0, -1, 0] });
            }
        }
        const was = armClash(actors, index, side, props);
        const outward = unit(sub(shoulder, at(`shoulder_${side === "l" ? "r" : "l"}`)));
        for (const { target, aim, contact } of targets)
          for (const elbow of [null, outward]) {
            const pose = { root: actor.pose.root, joints: structuredClone(actor.pose.joints) };
            const body = { skeleton, pose, evaluated: actor.evaluated, localVolumes: actor.localVolumes };
            const fingers = level(sub(target, landmarkPoint(actor, "pelvis")));
            // On the floor or a seat, as high as the palm's tilt takes its edge.
            const goal = () => (contact ? target : add(target, [0, palmOver(body, side, aim) - PALM_OVER, 0]));
            for (let pass = 0; pass < 4; pass += 1) {
              const tip = landmarkPoint(body, "hand", side);
              const pole = elbow ?? sub(at(chain.mid, body.evaluated), add(at(chain.root, body.evaluated), at(chain.end, body.evaluated)).map((v) => v / 2));
              body.evaluated = solveTwoBoneIK(skeleton, pose, chain, add(goal(), sub(at(chain.end, body.evaluated), tip)), { pole, evaluated: body.evaluated }).evaluated;
              if (pass < 3) turnPalm(body, side, aim, { fingers, sweep: pass === 0 });
            }
            if (len(sub(landmarkPoint(body, "hand", side), goal())) > 0.03 || dot(palmNormal(body, side), aim) < 0.7) continue;
            const arm = Object.fromEntries([chain.root, chain.mid, chain.end].map((bone) => [bone, pose.joints[bone]]));
            const moved = wearing(out, [{ actor: index, arm }]);
            const after = moved.map((spec, k) => (k === index ? liveActor(spec, k) : actors[k]));
            const now = armClash(after, index, side, props);
            if (now.partner > Math.max(was.partner, TOUCH_SLACK) || now.own > Math.max(was.own, 0.015) || now.prop > Math.max(was.prop, 0.01)) continue;
            if (now.low < Math.min(was.low, floor - 0.005)) continue;
            if (letGo(holding, armHeld(after, index, side, on.filter((other) => other !== moving)))) continue;
            const result = assess(after);
            if (result.cost < (best?.state.cost ?? state.cost - 0.05)) best = { state: result, specs: moved, actors: after, hold: { key, actor: index, arm, contact, replaces: moving } };
          }
      }
    if (!best) break;
    out = best.specs;
    actors = best.actors;
    state = best.state;
    holds.push(best.hold);
  }
  if (!holds.length) return { specs, planted };
  // The holds cost the scene no check but how well it is held, or they are kept one at a time.
  const others = (list) => list.filter((failure) => !/unheld/.test(failure)).map((failure) => failure.replace(/\d+/g, "#"));
  const contacts = input.limbContacts ?? [];
  const wear = (kept) => [...contacts.filter((contact) => !kept.some((hold) => hold.replaces === contact)), ...kept.filter((hold) => hold.contact).map((hold) => hold.contact)];
  const failures = (kept) => {
    input.limbContacts = wear(kept);
    return failing(wearing(specs, kept));
  };
  const before = others(failures([]));
  const fine = (kept) => others(failures(kept)).every((failure) => before.includes(failure));
  let kept = holds;
  if (!fine(holds)) {
    kept = [];
    for (const hold of holds) if (fine([...kept, hold])) kept.push(hold);
  }
  input.limbContacts = wear(kept);
  return { specs: wearing(specs, kept), planted: new Set([...planted, ...kept.filter((hold) => !hold.contact).map((hold) => hold.key)]) };
}

/** Whether `contact` is held by the hand on `side` of the actor at `actor`, at either end. */
function holdsWith(contact, actor, side) {
  const by = (end) =>
    contact[`${end}Actor`] === actor && (contact[end] === "hand" || contact[end] === "hands") && (contact[`${end}Side`] ?? side) === side;
  return by("from") || by("to");
}

/** How far from its contact's target a hand laid on it sits: a palm's thickness inside the target's standoff. */
const HAND_ON = 0.03;

/** How far from its target a contact may be, measured as the viewer measures it, before it is unmet. */
const UNMET = 0.08;

/** Measure the final fixed scene exactly as the viewer will solve it. */
export function measure(scene) {
  const solved = solveScene(scene);
  const { props } = propsFor(scene.support.surface);
  const declared = declaredKeys(solved.actors, scene.contacts ?? []);
  const pen = penetration(solved.actors, props, declared, null, { armSlack: 0.025 });
  const distances = measureContactTargets(solved);
  const frames = solved.actors.map((actor) => {
    const p = (n) => landmarkPoint(actor, n);
    const pelvis = p("pelvis");
    const up = unit(sub(p("neck"), pelvis));
    const front = unit(sub(p("chest"), p("upperBack")));
    return { pelvis, up, front, head: p("head"), chest: p("chest"), lowest: lowest(actor) };
  });
  const held = stability(solved, [...solved.props, ...supportProps(solved)]);
  return { solved, pen, distances, frames, held };
}

/** The portable scene for a plan: fixed actors, the surface and every declared contact. */
export function sceneFor(plan, specs) {
  const { scene, issues } = validateScene({
    actors: specs,
    support: { surface: plan.surface },
    relationship: { contactMode: "custom" },
    contacts: [...(plan.contacts ?? []), ...(plan.limbContacts ?? [])],
  });
  return { scene, issues };
}

export { checkScene };

const horizontal = (v) => unit([v[0], 0, v[2]]);

/** Which way a body is pointed on the ground plane: towards the head, or the chest when upright. */
function heading(actor, frame) {
  const toHead = sub(landmarkPoint(actor, "head"), frame.pelvis);
  const flat = Math.hypot(toHead[0], toHead[2]);
  return flat > 0.3 ? horizontal(toHead) : horizontal(frame.front);
}

/**
 * Semantic checks: does the scene read as the template says? Each check is a
 * name or ["near", role, landmark, role, landmark, metres]. Roles are "a"/"b".
 */
export function evaluate(plan, m, { maxBody = 0.045, maxProp = 0.035 } = {}) {
  const roles = plan.roles ?? { a: 0, b: 1 };
  const actors = m.solved.actors;
  const fr = (role) => m.frames[roles[role]];
  const act = (role) => actors[roles[role]];
  const failures = [];
  const two = roles.b != null && actors.length > 1;
  const hd = (role) => heading(act(role), fr(role));
  // Where a body faces: its chest, or its head direction when lying face up or down.
  const faces = (role) => (Math.abs(fr(role).front[1]) > 0.7 ? hd(role) : horizontal(fr(role).front));
  const tests = {
    aFaceUp: () => fr("a").front[1] > 0.45,
    bFaceUp: () => fr("b").front[1] > 0.45,
    aFaceDown: () => fr("a").front[1] < -0.45,
    bFaceDown: () => fr("b").front[1] < -0.45,
    aUpright: () => fr("a").up[1] > 0.55,
    bUpright: () => fr("b").up[1] > 0.55,
    aInverted: () => fr("a").head[1] < fr("a").pelvis[1],
    bInverted: () => fr("b").head[1] < fr("b").pelvis[1],
    aOffGround: () => fr("a").lowest > 0.12,
    bAbove: () => fr("b").pelvis[1] > fr("a").pelvis[1] + 0.02,
    aAboveOrLevel: () => fr("a").pelvis[1] > fr("b").pelvis[1] - 0.05,
    faceToFace: () =>
      dot(fr("a").front, sub(fr("b").chest, fr("a").chest)) > 0 && dot(fr("b").front, sub(fr("a").chest, fr("b").chest)) > 0,
    faceToFaceHorizontal: () =>
      dot(horizontal(fr("a").front), sub(fr("b").pelvis, fr("a").pelvis)) > 0 &&
      dot(horizontal(fr("b").front), sub(fr("a").pelvis, fr("b").pelvis)) > 0,
    facingInward: () => {
      const f = plan.facingRoles ?? roles;
      const inner = m.frames[f.b];
      // A face-down or face-up body faces where its head points.
      const dir = Math.abs(inner.front[1]) > 0.7 ? heading(actors[f.b], inner) : horizontal(inner.front);
      return dot(dir, sub(m.frames[f.a].pelvis, inner.pelvis)) > 0;
    },
    sameFacing: () => dot(faces("a"), faces("b")) > 0.5,
    sameHeading: () => dot(hd("a"), hd("b")) > 0.5,
    reversed: () => dot(hd("a"), hd("b")) < -0.5,
    straddleFacing: () => dot(hd("a"), hd("b")) > 0.5,
    crossed: () => Math.abs(dot(hd("a"), hd("b"))) < 0.8,
    bBehind: () => dot(hd("a"), sub(fr("b").pelvis, fr("a").pelvis)) < 0.02,
    bAtBack: () => dot(horizontal(fr("a").front), sub(fr("b").pelvis, fr("a").pelvis)) < 0,
  };
  if (two) {
    for (const check of plan.checks ?? []) {
      if (Array.isArray(check)) {
        const [, r1, l1, r2, l2, max] = check;
        const d = len(sub(landmarkPoint(act(r1), l1), landmarkPoint(act(r2), l2)));
        if (!(d <= max)) failures.push(`${r1}.${l1}-${r2}.${l2} ${Math.round(d * 1000)}mm > ${Math.round(max * 1000)}`);
      } else if (tests[check] && !tests[check]()) failures.push(check);
    }
  }
  if (m.pen.body > maxBody) failures.push(`body overlap ${Math.round(m.pen.body * 1000)}mm`);
  if (m.pen.prop > maxProp) failures.push(`prop overlap ${Math.round(m.pen.prop * 1000)}mm`);
  m.frames.forEach((f, i) => {
    if (f.lowest < -0.03) failures.push(`actor ${i} below floor`);
  });
  m.held.forEach(({ lift, tip }, i) => {
    if (shortfall({ lift, tip }) > 1) failures.push(`actor ${i} unheld (${Math.round(lift * 100)}% of its weight, ${Math.round(tip * 1000)}mm off balance)`);
  });
  const reach = m.distances.map((d) => (d == null ? null : d));
  const unmet = reach.filter((d) => d != null && d > UNMET).length;
  if (unmet > Math.max(1, Math.floor(reach.length / 2))) failures.push(`${unmet} contacts unmet`);
  return { pass: failures.length === 0, failures };
}

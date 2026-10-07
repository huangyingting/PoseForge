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
  const fixed = applyDetails(applyOverride({ ...scene.actors[0], ...captureSolvedPose(solved.actors[0]) }, solved.actors[0], override), details, props);
  if (!tilt) return fixed;
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
  const checked = (candidate) =>
    evaluate(input, measure(sceneFor(input, candidate.map(({ prefer, soloSurface, override, tilt, details, ...spec }) => spec)).scene)).pass;
  const planted = plantHands(input, specs, chosen, plan.surface, checked);
  specs = restFreeHands(input, planted.specs, chosen, plan.surface, checked, planted);
  specs = facePalms(specs, plan.surface, [...(input.contacts ?? []), ...(input.limbContacts ?? [])], checked);
  // Hands are left to the viewer to read from the final contacts and postures;
  // a shape captured mid-composition belongs to contacts that may since have been dropped.
  return specs.map((spec) => {
    const { prefer, soloSurface, hands, ...clean } = spec;
    return clean;
  });
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
 * leaves a contact it was on unmet, is not kept; nor is one that costs the
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
      return !solved.contacts.some((contact, i) => holdsWith(contact, actor, side) && away(i, plain[i], flat[i]));
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
      if (!solved.contacts.some((contact, i) => holdsWith(contact, actor, side) && away(i, plain[i], flat[i]))) on.push({ actor, side, arm: arms[k] });
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

/** How far a free hand is moved to lie on what is beside it; any further and it stays where the pose put it. */
const REST_REACH = 0.15;
/** How far, for an arm its source picture did not place (no arm detail). */
const PARTNER_REACH = 0.25;
/** Nearer than this to where it would lie, a hand is on it already and is not moved. */
const REST_SLACK = 0.02;
/** How far above a floor or a seat the middle of a palm lying on it is. */
const PALM_OVER = 0.03;
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
    floor == null ? Infinity : hand[1] - floor,
    ...props.map((prop) => propDistance(prop, hand).distance),
    ...actors.filter((_, k) => k !== index).map((other) => bodyDistance(hand, other.volumes)),
  ];
  return Math.min(...gaps) < ON_IT;
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

/**
 * Where a free hand would lie: on the partner, on its own trunk, thigh or
 * knee, on the furniture or on the floor, nearest first - none when nothing is
 * within `reach` (`PARTNER_REACH`, unless the source drew the arm somewhere),
 * and only the nearest when the hand is on it already. With `fall`, for a
 * figure lying down, what is under the hand counts however far down it is: an
 * arm held up off the bed by nothing falls on to it.
 */
function restFor(actors, index, side, props, floor, reach, { fall = false } = {}) {
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
  if (n[1] > 0.5 || (n[1] > -0.3 && dot(n, outward) > 0.3)) options.push({ target: add(hand, n.map((v) => v * (offset - d))), aim: n.map((v) => -v) });
  // Or on the top of its own thigh or knee, on that side, as a hand with nothing else to lie on is put.
  for (const name of [`thigh.${side}`, `knee.${side}`]) {
    const surface = landmarkSurface(actor, name, add(landmarkPoint(actor, name), [0, 0.3, 0]), { offset });
    if (surface && surface.normal[1] >= 0.5 && /^(hip|knee)_/.test(surface.volume.bone)) options.push({ target: surface.point, aim: surface.normal.map((v) => -v) });
  }
  for (const prop of props) {
    const { distance, normal } = propDistance(prop, hand);
    if (normal[1] > 0.5) options.push({ target: add(hand, normal.map((v) => v * (PALM_OVER - distance))), aim: normal.map((v) => -v) });
  }
  if (floor != null) options.push({ target: [hand[0], floor + PALM_OVER, hand[2]], aim: [0, -1, 0], fall });
  // Or swung down about the shoulder, as far out as it is, on to the floor or
  // the furniture under it - an arm held up over the shoulder out to its side
  // and towards its feet, as a lying figure's arm falls.
  const out = level(sub(hand, shoulder));
  const arm = len(sub(hand, shoulder));
  const ways = fall && out.some(Boolean) ? [{ way: out, at: hand }] : [];
  if (fall && hand[1] - shoulder[1] > arm / 2) {
    const way = level(add(outward, level(sub(landmarkPoint(actor, "pelvis"), landmarkPoint(actor, "neck"))).map((v) => v * 0.7)));
    ways.push({ way, at: add(shoulder, way.map((v) => v * arm)), swing: true });
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
  const near = options
    .map((option) => ({ ...option, move: len(sub(option.target, hand)) }))
    .filter((option) => (option.move <= reach || option.swing || (fall && option.target[1] < hand[1] && Math.hypot(option.target[0] - hand[0], option.target[2] - hand[2]) <= reach)) && reaches(option.target))
    .sort((a, b) => a.move - b.move);
  if (near.length && near[0].move < REST_SLACK) return near[0].contact ? [near[0]] : [];
  return near;
}

/** Arm shapes put round the partner, whose hands go on to them where they fall short. */
const REACHING_ARMS = new Set(["arms_around"]);

/** How many of the places a free hand would lie are tried, the nearest first, before it is left where it is. */
const REST_TRIES = 4;

/**
 * Lay each free hand on what is beside it. A hand that holds nothing and that
 * its posture does not lean on was left wherever its arm was posed: a hand's
 * breadth over the bed, off a partner's thigh, in the side it hangs by, which
 * reads as a hand held stiffly in the air, or as one in the body. Within
 * `REST_REACH` of the partner, the top of its own thigh or knee, its own
 * trunk, the furniture or the floor - `PARTNER_REACH`, for an arm the source
 * did not draw anywhere in particular - its arm is bent until it lies on the
 * nearest of them it reaches, as a hand at rest does. One laid on a partner
 * rests there as a `rest` contact, so the viewer cups it and the palm is
 * turned onto them like any other hand that touches; one laid on anything
 * else has its palm turned onto it here. A figure lying down (`lying`) has an
 * arm held up over nothing fall: swung down about the shoulder on to the floor
 * or the furniture under it - out to the side and towards the feet if it was
 * up over the shoulder - or drawn back on to the top it is held out past, the
 * hand on its palm, or else on its back.
 *
 * A reach that takes the arm into the partner, the body it is on or the
 * furniture further than it already was, or under the floor, is not made, nor
 * one the scene's checks will not have (`checked`). One on the partner, or
 * fallen, is tried again with the elbow out to the side, as an arm laid on
 * something bends; then the next nearest is tried, up to `REST_TRIES` of
 * them. A hand `plantHands` put down stays
 * down; one it was to put down and could not reaches as far as an arm the
 * source did not draw. A tied figure's (`bound`) stay where they are.
 */
function restFreeHands(input, specs, chosen, surfaceName, checked, { sought = new Set(), planted = new Set() } = {}) {
  const { surface, props } = propsFor(surfaceName);
  // Off the furniture a raised surface's ground is not a floor anything can lie on.
  const floor = surface.ground <= 1e-3 ? surface.ground : null;
  const held = [...(input.contacts ?? []), ...(input.limbContacts ?? [])];
  const specOf = (index) => {
    const entry = input.actors[index];
    return Array.isArray(entry) ? entry[chosen[index] ?? 0] : entry;
  };
  const drawn = (index, side) => Object.keys(specOf(index)?.details ?? {}).some((bone) => bone === `shoulder_${side}` || bone === `elbow_${side}`);
  const reaching = (index, side) => REACHING_ARMS.has(specOf(index)?.arms) || (input.reach ?? []).some((reach) => reach.index === index && (!reach.side || reach.side === side));
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
      if (bound.has(index) || planted.has(`${index}.${side}`) || held.some((contact) => handIn(contact, index, side))) continue;
      const actors = out.map((spec, k) => liveActor(spec, k));
      const actor = actors[index];
      if (leansOn(actors, index, side, props, floor)) continue;
      let options = restFor(actors, index, side, props, floor, drawn(index, side) && !sought.has(`${index}.${side}`) ? REST_REACH : PARTNER_REACH, { fall: lying(actor) });
      // An arm put out towards the partner and short of them goes on to them, as far as an arm the source did not place.
      if (reaching(index, side) && !sought.has(`${index}.${side}`)) {
        const onto = restFor(actors, index, side, props, floor, PARTNER_REACH).filter((option) => option.contact);
        if (onto.length) options = onto;
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
      // A lying figure's hand fallen on to the floor or the bed lies on its palm, or else on its back;
      // that and a hand laid on the partner are tried again with the elbow out to the side.
      const outward = unit(sub(landmarkPoint(actor, "shoulder", side), landmarkPoint(actor, "shoulder", side === "l" ? "r" : "l")));
      for (const rest of options.flatMap((option) => (option.fall ? [option, { ...option, aim: [0, 1, 0] }, { ...option, elbow: outward }] : option.contact ? [option, { ...option, elbow: outward }] : [option]))) {
        const again = tried.some((target) => len(sub(target, rest.target)) < 0.02);
        if (again && !rest.fall && !rest.elbow) continue;
        if (!again && tried.length >= REST_TRIES) break;
        if (!again) tried.push(rest.target);
        const pose = { root: actor.pose.root, joints: structuredClone(actor.pose.joints) };
        const body = { skeleton, pose, evaluated: actor.evaluated, localVolumes: actor.localVolumes };
        // Laid on anything but a partner - whose contact turns it at view - the palm is turned onto it here.
        const turn = !rest.contact && rest.aim;
        const fingers = turn && level(sub(rest.target, landmarkPoint(actor, "pelvis")));
        // The wrist is what the chain ends at; the palm's middle is a little past it, and turns with the arm.
        for (let pass = 0; pass < 4; pass += 1) {
          const at = (bone) => body.evaluated.positions[skeleton.boneIndex(bone)];
          const hand = landmarkPoint(body, "hand", side);
          const pole = rest.elbow ?? sub(at(chain.mid), add(at(chain.root), at(chain.end)).map((v) => v / 2));
          body.evaluated = solveTwoBoneIK(skeleton, pose, chain, add(rest.target, sub(at(chain.end), hand)), { pole, evaluated: body.evaluated }).evaluated;
          if (turn && pass < 3) turnPalm(body, side, rest.aim, { fingers, sweep: pass === 0 });
        }
        const arm = { [chain.root]: pose.joints[chain.root], [chain.mid]: pose.joints[chain.mid], ...(turn ? { [chain.end]: pose.joints[chain.end] } : {}) };
        const moved = wearing(out, [{ actor: index, arm }]);
        const after = moved.map((spec, k) => (k === index ? liveActor(spec, k) : actors[k]));
        if (len(sub(landmarkPoint(after[index], "hand", side), rest.target)) > 0.03) continue;
        const now = armClash(after, index, side, props);
        if (rest.fall && dot(palmNormal(after[index], side), rest.aim) < 0.8) continue;
        if (now.partner > Math.max(was.partner, rest.contact ? TOUCH_SLACK : 0.015) || now.own > Math.max(was.own, 0.015) || now.prop > Math.max(was.prop, 0.01)) continue;
        // A hand fallen flat on the floor may sink its thumb a little into it.
        if (floor != null && now.low < Math.min(was.low, floor - (rest.fall ? 0.01 : 0.005))) continue;
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
 * the shoulder instead, on the top of them, as a `rest` contact. A hand its
 * posture already stands on, or that holds something, is
 * left alone; so is one with nowhere it reaches, and one the scene's checks
 * will not have it put down (`checked`). So are a tied figure's (`bound`), an
 * arm the template draws somewhere of its own (`PLACED_ARMS`) and the record's
 * details do not draw over, and, where it is only the posture that leans on
 * the hands, an arm the record's details draw.
 * Returns the specs and the hands put down, or that should have been.
 */
function plantHands(input, specs, chosen, surfaceName, checked) {
  const { surface, props } = propsFor(surfaceName);
  const floor = surface.ground <= 1e-3 ? surface.ground : null;
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
  specs.forEach((_, index) => {
    const where = PLANTED_ARMS[specOf(index)?.arms];
    for (const side of ["l", "r"]) {
      if (wanted.has(`${index}.${side}`)) continue;
      if (where) wanted.set(`${index}.${side}`, { index, side, where });
      else if (!placed(index, side) && !drawn(index, side) && posed[index].posture.supports.some((s) => ["hand", "hands"].includes(s.landmark) && (!s.side || s.side === side)) && !leansOn(posed, index, side, props, floor))
        wanted.set(`${index}.${side}`, { index, side, where: "down" });
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
    if (leansOn(actors, index, side, props, floor)) continue;
    sought.add(`${index}.${side}`);
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
      let top = floor != null && floor <= limit ? floor : null;
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
    for (const r of PLANT_RINGS)
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
      for (let pass = 0; pass < 4; pass += 1) {
        const hand = landmarkPoint(body, "hand", side);
        const pole = sub(at(chain.mid, body.evaluated), add(at(chain.root, body.evaluated), at(chain.end, body.evaluated)).map((v) => v / 2));
        body.evaluated = solveTwoBoneIK(skeleton, pose, chain, add(target, sub(at(chain.end, body.evaluated), hand)), { pole, evaluated: body.evaluated }).evaluated;
        if (pass < 3) turnPalm(body, side, aim, { fingers, sweep: pass === 0 });
      }
      if (len(sub(landmarkPoint(body, "hand", side), target)) > 0.03 || dot(palmNormal(body, side), aim) < 0.8) continue;
      const arm = Object.fromEntries([chain.root, chain.mid, chain.end].map((bone) => [bone, pose.joints[bone]]));
      const moved = wearing(out, [{ actor: index, arm }]);
      const after = moved.map((spec, k) => (k === index ? liveActor(spec, k) : actors[k]));
      const now = armClash(after, index, side, props);
      if (now.partner > Math.max(was.partner, TOUCH_SLACK) || now.own > Math.max(was.own, 0.015) || now.prop > Math.max(was.prop, 0.01)) continue;
      if (floor != null && now.low < Math.min(was.low, floor - 0.005)) continue;
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
  return { solved, pen, distances, frames };
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
  const reach = m.distances.map((d) => (d == null ? null : d));
  const unmet = reach.filter((d) => d != null && d > UNMET).length;
  if (unmet > Math.max(1, Math.floor(reach.length / 2))) failures.push(`${unmet} contacts unmet`);
  return { pass: failures.length === 0, failures };
}

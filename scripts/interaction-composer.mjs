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
import { turnPalms } from "../src/core/palmPose.js";
import { landmarkPoint } from "../src/core/landmarks.js";
import { detectContacts, detectPropContacts, penetrationReport, contactKey } from "../src/core/collision.js";
import { resolveLandmark } from "../src/core/landmarks.js";
import { resolveSurface } from "../src/core/poseLibrary.js";
import { withBounds } from "../src/core/propShapes.js";
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
  specs = facePalms(specs, plan.surface, [...(input.contacts ?? []), ...(input.limbContacts ?? [])]);
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
 * than it was at first, past what a palm laid on it sits off it, is not kept.
 */
function facePalms(specs, surface, contacts) {
  let first = null;
  for (let pass = 0; pass < 3; pass++) {
    const { scene } = validateScene({
      actors: specs.map(({ prefer, soloSurface, override, tilt, details, ...spec }) => spec),
      support: { surface },
      relationship: { contactMode: "custom" },
      contacts,
    });
    const solved = solveScene(scene, { palms: false });
    first ??= measureContactTargets(solved);
    const turned = turnPalms(solved, { depth: armDepth(solved.actors, solved.props, solved.surface.ground) });
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
    const now = measureContactTargets(solved);
    const out = specs.slice();
    let kept = 0;
    for (const [k, { actor, side }] of turned.entries()) {
      const holds = (contact, end) =>
        contact[`${end}Actor`] === actor && (contact[end] === "hand" || contact[end] === "hands") && (contact[`${end}Side`] ?? side) === side;
      const off = solved.contacts.some(
        (contact, i) => (holds(contact, "from") || holds(contact, "to")) && now[i] > Math.max(first[i] ?? 0, HAND_ON) + 0.01
      );
      if (off) continue;
      out[actor] = { ...out[actor], joints: { ...out[actor].joints, ...arms[k] } };
      kept += 1;
    }
    specs = out;
    if (!kept) break;
  }
  return specs;
}

/** How far from its contact's target a hand laid on it sits: a palm's thickness inside the target's standoff. */
const HAND_ON = 0.03;

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
  const unmet = reach.filter((d) => d != null && d > 0.08).length;
  if (unmet > Math.max(1, Math.floor(reach.length / 2))) failures.push(`${unmet} contacts unmet`);
  return { pass: failures.length === 0, failures };
}

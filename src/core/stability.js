/**
 * Whether the figures in a solved scene could hold the pose: whether what each
 * one rests on, holds on to or is held by can carry its weight, and the weight
 * of whoever rests on it, without it tipping over.
 *
 * A pose can meet every contact it declares and still be one nobody could
 * hold: a figure leaning back on hands that stop short of the floor, a trunk
 * held out level by a partner's hands at the thighs and nothing under the
 * chest, a rider astride a partner whose shoulders hang in the air behind. Each
 * looks wrong at once - the figure hangs in the air - and none is caught by
 * measuring distances between landmarks.
 *
 * So the weights are followed down to the ground. Every place a body bears on
 * the floor or furniture can push it up; every place it lies on a partner can
 * push it up and the partner down by as much; a hand that holds a partner, or is
 * held, can push or pull, but only so hard - about half a body's weight. Each
 * figure must then be held up by what touches it, and held level:
 * the forces must add up to its weight and turn it neither way about its centre
 * of mass. The forces that do this best are found, and what they cannot do is
 * the figure's shortfall: the part of its weight nothing carries, and how far
 * its centre of mass would have to move for what does carry it to balance it.
 *
 * The floor is under every scene, at nought. A bed's or a sofa's ground is the
 * top of it, where a figure on it kneels or lies; beside it, below that top, is
 * only the air down to the floor, and a foot, a hand or a head held there is
 * held by nothing. Taken for the floor, that ground stood a man at the
 * bedside on air half a metre up and rested a woman's head on nothing in
 * front of a sofa, and both were counted held.
 *
 * Lying on a partner is lying on top of them, the contact facing up within
 * 45 degrees of level: skin on skin holds no steeper slope. Taken up to 63
 * degrees, a woman upside down on her shoulders was held up by her hips leaning
 * on the front of a standing partner's thighs, and a woman on her hands in a
 * wheelbarrow by hers against his, while his arms hung at his sides.
 *
 * A hand holds a limb, or the neck, whichever way it is pulled: it closes round
 * it. A trunk or a head it cannot close round, and only presses on from above,
 * lifts from beneath, or holds at the side by how hard it squeezes - half what
 * it holds a limb by. Laid on a partner's back, a hand does not hold them up.
 *
 * And a head pressed to a partner - a face at their hips, a cheek on a thigh -
 * leans on them with no more than about its own weight. Kneeling bent over at a
 * partner's hips with the face buried in them and the hands at the sides, a
 * figure was held up by its face.
 *
 * Nor is a figure held up by a partner it lies on by more than it weighs, with
 * whoever else may be on it: no more than its weight presses it down on them.
 * Held without that, a body caught between two of a partner's - a thigh under
 * his forearm and over his hip - could be squeezed level in the air, pressed
 * down at one by three times its weight and up at the other a hand's breadth
 * away: a woman held out straight in front of a standing partner, her legs
 * round his waist and her hands on nothing, was counted held.
 *
 * Only the up and down of the forces is followed. Leaning on a wall, or two
 * figures leaning into each other standing, is held by sideways forces this
 * leaves out, and comes out a little worse than it is.
 */
import { centreOfMass } from "./solver.js";
import { restingOn, spheres } from "./supports.js";

// What counts as touching, as the solver's balance measures it.
const CONTACT = 0.03;
// How far into a mattress or cushion a body may sink and still be lying on it, not under it.
const SINK = 0.1;
// Lying on something rather than against it: the contact faces this far up (see above).
const ON_TOP = 0.7;
const HAND = /^(wrist|hand)_/;
// What one hand can carry, push or pull, as a share of a body's weight.
const GRIP = 0.5;
// What a hand closes round: a limb or the neck. Not the trunk or the head.
const ROUND = /^(shoulder|elbow|wrist|hand|hip|knee|ankle|toe)_|^neck$/;
// What a hand at the side of a trunk or a head holds it by, squeezing.
const SIDE_GRIP = 0.25;
// What a head, with its neck, leans on partners with, as a share of its body's weight.
const HEAD = 0.15;
// Each body's weight against a woman's: what a hand that carries one has to bear.
const WEIGHT = { female: 1, male: 1.25, neutral: 1.1 };
// Under every scene, whatever its surface: furniture stands on it (see above).
const FLOOR = { ground: 0 };
// The length that turns a moment into the same units as a weight, so that ten
// centimetres of tipping counts as much as half the weight unheld.
const LEVER = 0.2;

/** The two pairs of points furthest apart across x and across z, which bound what a group of them holds up. */
function extremes(points) {
  if (points.length <= 2) return points;
  const pick = new Set();
  for (const k of [0, 1]) {
    let lo = points[0];
    let hi = points[0];
    for (const p of points) {
      if (p[k] < lo[k]) lo = p;
      if (p[k] > hi[k]) hi = p;
    }
    pick.add(lo).add(hi);
  }
  return [...pick];
}

/** The head, and the neck it is held on. */
const HEADS = /^(head|neck)$/;

/** The one grip a hand makes, wrist and all. */
const grip = (bone) => bone.replace(/^wrist_/, "hand_");

const mean = (points) => [0, 1].map((k) => points.reduce((sum, p) => sum + p[k], 0) / points.length);

/** A volume's bounding sphere, as `[x, y, z, r]`. */
function bound({ a, b, ra, rb }) {
  const half = Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2) / 2;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, half + Math.max(ra, rb)];
}

/** Whether two spheres `[x, y, z, r]` come within `gap` of each other. */
function within(p, q, gap) {
  const reach = p[3] + q[3] + gap;
  return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 <= reach * reach;
}

/**
 * Every place a weight can pass, as `{ on, from, at, kind }`: on actor `on`
 * from actor `from` (or the ground, -1), at a point on the ground plane. A
 * `bear` pushes `on` up and `from` down; a `grip` either way, the hand being
 * `on`'s. A grip says too whether the hand closes `round` what it holds, and how
 * far `over` it the hand is, from -1 under it to 1 on top; a bear on a partner,
 * whether it is `on`'s `head` or neck that bears.
 */
export function bearings(solved, props = solved.props) {
  const { actors } = solved;
  const all = actors.map((actor, index) => spheres(actor, index));
  const byVolume = all.map((list, i) => {
    const out = actors[i].volumes.map(() => []);
    for (const s of list) out[s.volume].push(s);
    return out;
  });
  const groups = new Map();
  const add = (key, entry, point, over = 0, held = "") => {
    if (!groups.has(key)) groups.set(key, { ...entry, points: [], over: [], round: false });
    const group = groups.get(key);
    group.points.push(point);
    group.over.push(over);
    if (ROUND.test(held)) group.round = true;
  };
  all.forEach((list, i) => {
    for (const s of list) {
      const y = s.c[1] - s.r;
      if (y - restingOn(FLOOR, props, s.c[0], s.c[2], y + SINK) < CONTACT)
        add(`${i}|ground|${s.bone}`, { on: i, from: -1, kind: "bear" }, [s.c[0], s.c[2]]);
    }
  });
  const bounds = actors.map((actor) => actor.volumes.map(bound));
  for (let i = 0; i < all.length; i += 1)
    for (let j = i + 1; j < all.length; j += 1)
      for (const [u, p] of bounds[i].entries())
        for (const [v, q] of bounds[j].entries()) {
          // Only volumes whose bounds come within touching are looked into.
          if (!within(p, q, CONTACT)) continue;
          for (const s of byVolume[i][u])
            for (const t of byVolume[j][v]) {
              const reach = s.r + t.r + CONTACT;
              const d2 = (s.c[0] - t.c[0]) ** 2 + (s.c[1] - t.c[1]) ** 2 + (s.c[2] - t.c[2]) ** 2;
              if (d2 > reach * reach || d2 < 1e-12) continue;
              const d = Math.sqrt(d2);
              const w = s.r / (s.r + t.r);
              const point = [s.c[0] + (t.c[0] - s.c[0]) * w, s.c[2] + (t.c[2] - s.c[2]) * w];
              const up = (s.c[1] - t.c[1]) / d;
              // A hand holds whatever it is on, and is held by the hand it is in;
              // the wrist is the same hand, not a second grip as strong.
              if (HAND.test(s.bone)) add(`${i}|${j}|${grip(s.bone)}`, { on: i, from: j, kind: "grip" }, point, up, t.bone);
              else if (HAND.test(t.bone)) add(`${j}|${i}|${grip(t.bone)}`, { on: j, from: i, kind: "grip" }, point, -up, s.bone);
              else if (up > ON_TOP) add(`${i}|${j}|${s.bone}`, { on: i, from: j, kind: "bear", head: HEADS.test(s.bone) }, point);
              else if (up < -ON_TOP) add(`${j}|${i}|${t.bone}`, { on: j, from: i, kind: "bear", head: HEADS.test(t.bone) }, point);
            }
        }
  const out = [];
  for (const { points, over, round, ...entry } of groups.values()) {
    // A hand is one grip, however much of it touches; a body lying on
    // something bears along the whole of what touches.
    if (entry.kind === "grip") out.push({ ...entry, round, over: over.reduce((sum, v) => sum + v, 0) / over.length, at: mean(points) });
    else for (const at of extremes(points)) out.push({ ...entry, at });
  }
  return out;
}

/**
 * How far each figure hangs above the floor or furniture under it, in metres,
 * with whoever it touches: nothing if any of them is on it. Where figures are
 * wholly in the air their shortfall is the same however high they are, and
 * this is how far they have to come down.
 */
export function hanging(solved, props = solved.props, forces = bearings(solved, props)) {
  const { actors } = solved;
  const gaps = actors.map((actor, index) => {
    let gap = Infinity;
    for (const s of spheres(actor, index)) {
      const y = s.c[1] - s.r;
      gap = Math.min(gap, y - restingOn(FLOOR, props, s.c[0], s.c[2], y + SINK));
    }
    return Math.max(0, gap);
  });
  // Figures that touch hang together, as low as the lowest of them.
  const group = actors.map((_, i) => i);
  const root = (i) => (group[i] === i ? i : (group[i] = root(group[i])));
  for (const { on, from } of forces) if (from >= 0) group[root(on)] = root(from);
  return gaps.map((_, i) => Math.min(...gaps.filter((__, j) => root(j) === root(i))));
}

/** How hard a force may push `on` up (positive) or down, `on` weighing `weight` and its head on a partner in `heads` places. */
function range(force, weight, heads) {
  if (force.kind === "bear") return [0, force.head ? (HEAD * weight) / heads : Infinity];
  if (force.round) return [-GRIP, GRIP];
  // Pressed on a trunk from above the hand pushes it down and is held up by it;
  // from beneath it lifts it.
  if (force.over > ON_TOP) return [0, GRIP];
  if (force.over < -ON_TOP) return [-GRIP, 0];
  return [-SIDE_GRIP, SIDE_GRIP];
}

/**
 * How far short each figure falls of being held up and held level, as
 * `{ lift, tip }`: the share of its weight nothing carries, and how far in
 * metres its centre of mass is from where what carries it would balance it.
 */
export function stability(solved, props = solved.props, forces = bearings(solved, props)) {
  const { actors } = solved;
  const weight = actors.map((actor) => WEIGHT[actor.bodyType] ?? 1);
  const centre = actors.map((actor) => centreOfMass(actor));
  // Three rows a figure: its weight held, and its moments about the two level axes.
  const rows = actors.length * 3;
  const columns = forces.map(({ on, from, at }) => {
    const column = new Float64Array(rows);
    for (const [actor, sign] of [[on, 1], [from, -1]]) {
      if (actor < 0) continue;
      const w = weight[actor];
      column[actor * 3] += sign / w;
      column[actor * 3 + 1] += (sign * (at[0] - centre[actor][0])) / w / LEVER;
      column[actor * 3 + 2] += (sign * (at[1] - centre[actor][2])) / w / LEVER;
    }
    return column;
  });
  const target = new Float64Array(rows);
  actors.forEach((_, i) => (target[i * 3] = 1));
  // A head shares what it may lean on partners with between every place it touches them.
  const heads = actors.map((_, i) => forces.filter((force) => force.head && force.on === i).length);
  const [lo, hi] = [0, 1].map((end) => forces.map((force) => range(force, weight[force.on], heads[force.on])[end]));
  // And a figure lying on a partner shares, between every place it lies on them, its weight and that of whoever else may be on it.
  const pair = forces.map(({ kind, on, from }) => (kind === "bear" && from >= 0 ? on * actors.length + from : -1));
  const most = forces.map(({ from }) => weight.reduce((sum, w, k) => (k === from ? sum : sum + w), 0));
  const borne = new Float64Array(actors.length * actors.length);
  // Least squares within the bounds, one force at a time.
  const f = new Float64Array(forces.length);
  const residual = Float64Array.from(target, (v) => -v);
  const norms = columns.map((column) => column.reduce((sum, v) => sum + v * v, 0));
  for (let sweep = 0; sweep < 400; sweep += 1) {
    let moved = 0;
    for (let k = 0; k < forces.length; k += 1) {
      if (!norms[k]) continue;
      const column = columns[k];
      let g = 0;
      for (let r = 0; r < rows; r += 1) g += column[r] * residual[r];
      const top = pair[k] < 0 ? hi[k] : Math.min(hi[k], most[k] - borne[pair[k]] + f[k]);
      const next = Math.min(top, Math.max(lo[k], f[k] - g / norms[k]));
      const step = next - f[k];
      if (!step) continue;
      f[k] = next;
      if (pair[k] >= 0) borne[pair[k]] += step;
      for (let r = 0; r < rows; r += 1) residual[r] += column[r] * step;
      moved = Math.max(moved, Math.abs(step));
    }
    if (moved < 1e-7) break;
  }
  return actors.map((_, i) => ({
    lift: Math.abs(residual[i * 3]),
    tip: Math.hypot(residual[i * 3 + 1], residual[i * 3 + 2]) * LEVER,
  }));
}

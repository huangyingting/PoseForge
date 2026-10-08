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
 * held, can push or pull either way, but only so hard - about half a body's
 * weight. Each figure must then be held up by what touches it, and held level:
 * the forces must add up to its weight and turn it neither way about its centre
 * of mass. The forces that do this best are found, and what they cannot do is
 * the figure's shortfall: the part of its weight nothing carries, and how far
 * its centre of mass would have to move for what does carry it to balance it.
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
// Lying on something rather than against it: the contact faces this far up.
const ON_TOP = 0.45;
const HAND = /^(wrist|hand)_/;
// What one hand can carry, push or pull, as a share of a body's weight.
const GRIP = 0.5;
// Each body's weight against a woman's: what a hand that carries one has to bear.
const WEIGHT = { female: 1, male: 1.25, neutral: 1.1 };
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
 * `bear` pushes `on` up and `from` down; a `grip` either way.
 */
export function bearings(solved, props = solved.props) {
  const { actors, surface } = solved;
  const all = actors.map((actor, index) => spheres(actor, index));
  const byVolume = all.map((list, i) => {
    const out = actors[i].volumes.map(() => []);
    for (const s of list) out[s.volume].push(s);
    return out;
  });
  const groups = new Map();
  const add = (key, entry, point) => {
    if (!groups.has(key)) groups.set(key, { ...entry, points: [] });
    groups.get(key).points.push(point);
  };
  all.forEach((list, i) => {
    for (const s of list) {
      const y = s.c[1] - s.r;
      if (y - restingOn(surface, props, s.c[0], s.c[2], y + SINK) < CONTACT)
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
              // A hand holds whatever it is on, and is held by the hand it is in.
              if (HAND.test(s.bone)) add(`${i}|${j}|${s.bone}`, { on: i, from: j, kind: "grip" }, point);
              else if (HAND.test(t.bone)) add(`${j}|${i}|${t.bone}`, { on: j, from: i, kind: "grip" }, point);
              else if (up > ON_TOP) add(`${i}|${j}|${s.bone}`, { on: i, from: j, kind: "bear" }, point);
              else if (up < -ON_TOP) add(`${j}|${i}|${t.bone}`, { on: j, from: i, kind: "bear" }, point);
            }
        }
  const out = [];
  for (const { points, ...entry } of groups.values()) {
    // A hand is one grip, however much of it touches; a body lying on
    // something bears along the whole of what touches.
    if (entry.kind === "grip") out.push({ ...entry, at: mean(points) });
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
  const { actors, surface } = solved;
  const gaps = actors.map((actor, index) => {
    let gap = Infinity;
    for (const s of spheres(actor, index)) {
      const y = s.c[1] - s.r;
      gap = Math.min(gap, y - restingOn(surface, props, s.c[0], s.c[2], y + SINK));
    }
    return Math.max(0, gap);
  });
  // Figures that touch hang together, as low as the lowest of them.
  const group = actors.map((_, i) => i);
  const root = (i) => (group[i] === i ? i : (group[i] = root(group[i])));
  for (const { on, from } of forces) if (from >= 0) group[root(on)] = root(from);
  return gaps.map((_, i) => Math.min(...gaps.filter((__, j) => root(j) === root(i))));
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
  const lo = forces.map(({ kind }) => (kind === "grip" ? -GRIP : 0));
  const hi = forces.map(({ kind }) => (kind === "grip" ? GRIP : Infinity));
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
      const next = Math.min(hi[k], Math.max(lo[k], f[k] - g / norms[k]));
      const step = next - f[k];
      if (!step) continue;
      f[k] = next;
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

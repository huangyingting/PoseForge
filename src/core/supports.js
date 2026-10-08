/**
 * Supports: the cushion under a figure sitting on air, and the wedge behind
 * one leaning back on nothing.
 *
 * A posture keeps the surface it was authored on. Seated and leaning back is a
 * figure on a sofa, and a template that puts it on the floor - the partner
 * sitting back with a lover on the lap - keeps the shape and loses the sofa:
 * the buttocks hang a hand's breadth off the boards, the back leans on air and
 * the centre of mass is most of a metre behind the heels, which are all that
 * touches anything. Moving the figure is the solver's business, and would
 * unmake the fit it found. What is missing is the furniture, so this brings
 * it: a floor cushion up to the buttocks and a wedge up to the back, each built
 * to the body as solved, touching it and clear of everything else.
 *
 * Nothing here moves a figure, and nothing is added where the body is already
 * held - by the surface, by a partner underneath, or in a partner's arms. Its
 * own hands put down behind it hold its back up, and spare it the wedge, but
 * do not seat it: the buttocks still get their cushion.
 */
import { closestPointsBetweenSegments } from "./math.js";
import { BULK_SUPPORTS } from "./poseLibrary.js";
import { propBox, propTopAt } from "./propShapes.js";
import { centreOfMass } from "./solver.js";

// What counts as touching, as the solver's balance measures it.
const CONTACT = 0.03;
// A centre of mass this near its support is leaning, not falling.
const SLACK = 0.05;
// A seat gap worth a cushion. Higher than this the figure is being held up.
const LIFT = [0.025, 0.3];
// The cushion's footprint, square so it suits any heading.
const SEAT = 0.44;
// How far a cushion gives under the body on it.
const SINK = 0.008;
// Half the widest backrest, and the narrowest one worth leaning on.
const REACH = 0.3;
const NARROWEST = 0.3;
// The trunk a backrest is built against: the neck and head lie on it or not as they please.
const BACK = new Set(["pelvis", "spine01", "spine02", "spine03"]);
// The arms, which brace a figure sitting back but do not seat it.
const ARMS = /^(shoulder|elbow|wrist|hand)_/;

/** Each volume as a row of spheres, close enough to stand for its capsule. */
export function spheres(actor, index) {
  const out = [];
  for (const [v, volume] of actor.volumes.entries()) {
    const { a, b } = volume;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(length / 0.025));
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      out.push({
        actor: index,
        volume: v,
        bone: volume.bone,
        c: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
        r: volume.ra + (volume.rb - volume.ra) * t,
      });
    }
  }
  return out;
}

/** Where a body at height `y` over (x, z) would come to rest: the floor, or the highest top below it. */
export function restingOn(surface, props, x, z, y = Infinity) {
  let top = surface.ground ?? 0;
  for (const prop of props) {
    const h = propTopAt(prop, x, z);
    if (h != null && h <= y + CONTACT) top = Math.max(top, h);
  }
  return top;
}

/**
 * Plan positions where the actor bears on the surface, or on a partner
 * underneath - leaving out its own arms when `arms` is false.
 */
function bearing(index, actors, surface, props, arms = true) {
  const actor = actors[index];
  const volumes = arms ? actor.volumes : actor.volumes.filter((volume) => !ARMS.test(volume.bone));
  const points = [];
  for (const volume of volumes)
    for (const [p, r] of [[volume.a, volume.ra], [volume.b, volume.rb]])
      if (Math.abs(p[1] - r - restingOn(surface, props, p[0], p[2], p[1] - r)) < CONTACT) points.push([p[0], p[2]]);
  actors.forEach((partner, j) => {
    if (j === index) return;
    for (const v of volumes)
      for (const w of partner.volumes) {
        const c = closestPointsBetweenSegments(v.a, v.b, w.a, w.b);
        const d = Math.sqrt(c.distanceSq);
        const ra = v.ra + (v.rb - v.ra) * c.s,
          rb = w.ra + (w.rb - w.ra) * c.t;
        if (d > 1e-6 && d - ra - rb < CONTACT && (c.c1[1] - c.c2[1]) / d > 0.45) points.push([c.c1[0], c.c1[2]]);
      }
  });
  return points;
}

/** How far the centre of mass lies outside the bounds of what bears it, and on which side. */
function overhang(points, com) {
  if (!points.length) return { by: Infinity, side: [0, 0] };
  let [minX, maxX, minZ, maxZ] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const dx = com[0] < minX ? com[0] - minX : com[0] > maxX ? com[0] - maxX : 0;
  const dz = com[2] < minZ ? com[2] - minZ : com[2] > maxZ ? com[2] - maxZ : 0;
  return { by: Math.max(Math.abs(dx), Math.abs(dz)), side: [dx, dz] };
}

/** The lowest body surface over a plan rectangle, from spheres above `floor`. */
function ceilingOver(all, [x0, x1, z0, z1], floor) {
  let ceiling = Infinity;
  for (const { c, r } of all) {
    if (c[1] + r <= floor) continue;
    const dx = Math.max(x0 - c[0], 0, c[0] - x1),
      dz = Math.max(z0 - c[2], 0, c[2] - z1);
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) ceiling = Math.min(ceiling, c[1] - Math.sqrt(r * r - d2));
  }
  return ceiling;
}

/** Whether anything already stands in a plan rectangle between two heights. */
const occupied = (props, [x0, x1, z0, z1], y0, y1) =>
  props.some((prop) => {
    const { min, max } = propBox(prop);
    return min[0] < x1 && max[0] > x0 && min[2] < z1 && max[2] > z0 && min[1] < y1 && max[1] > y0 + 0.005;
  });

/** Is the ground level across a plan rectangle, at `base`? */
const level = (surface, props, [x0, x1, z0, z1], base, y) =>
  [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, (z0 + z1) / 2]].every(
    ([x, z]) => Math.abs(restingOn(surface, props, x, z, y) - base) < 0.005,
  );

/**
 * A cushion under buttocks that hang over the surface. Its top is the lowest
 * body over its footprint, so whatever it holds up, it holds up the pelvis
 * first - or it is not made.
 */
function seatFor(index, all, surface, props) {
  const pelvis = all.filter((s) => s.actor === index && s.bone === "pelvis");
  if (!pelvis.length) return null;
  const bottom = Math.min(...pelvis.map((s) => s.c[1] - s.r));
  const low = pelvis.filter((s) => s.c[1] - s.r < bottom + 0.01);
  const cx = low.reduce((sum, s) => sum + s.c[0], 0) / low.length,
    cz = low.reduce((sum, s) => sum + s.c[2], 0) / low.length;
  const rect = [cx - SEAT / 2, cx + SEAT / 2, cz - SEAT / 2, cz + SEAT / 2];
  const base = restingOn(surface, props, cx, cz, bottom);
  const gap = bottom - base;
  if (gap < LIFT[0] || gap > LIFT[1]) return null;
  if (!level(surface, props, rect, base, bottom) || occupied(props, rect, base, bottom)) return null;
  const ceiling = ceilingOver(all, rect, base);
  if (ceiling < bottom - 0.01) return null;
  const top = ceiling + SINK;
  return { kind: "cushion", size: [SEAT, top - base, SEAT], center: [cx, (base + top) / 2, cz] };
}

/** The signed distance from a (z, y) point to a convex polygon, positive outside. */
function outside(polygon, u, v) {
  let worst = -Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const [a, b] = [polygon[i], polygon[(i + 1) % polygon.length]];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    worst = Math.max(worst, ((u - a[0]) * (b[1] - a[1]) - (v - a[1]) * (b[0] - a[0])) / length);
  }
  return worst;
}

/**
 * A wedge behind a trunk leaning back along z: its sloped face on the line
 * that touches the back from behind, rising to the shoulder blades, and as
 * wide as the arms and anything else behind the back allow.
 */
function backrestFor(index, actor, all, surface, props, seat) {
  const at = (name) => actor.evaluated.positions[actor.skeleton.boneIndex(name)];
  const [pelvis, chest] = [at("pelvis"), at("spine03")];
  const [dx, dy, dz] = [0, 1, 2].map((k) => chest[k] - pelvis[k]);
  // Reclined at least 20 degrees, and across the prism's run along x.
  if (Math.hypot(dx, dz) < Math.sin((20 * Math.PI) / 180) * Math.hypot(dx, dy, dz)) return null;
  if (Math.abs(dx) > Math.tan((15 * Math.PI) / 180) * Math.abs(dz)) return null;
  const s = Math.sign(dz);
  // Behind the cushion, where there is one, and against the back that is behind it.
  const edge = seat ? seat.center[2] + (s * seat.size[2]) / 2 : null;
  const back = all.filter(
    (sphere) => sphere.actor === index && BACK.has(sphere.bone) && (edge == null || s * (sphere.c[2] - edge) >= 0),
  );
  if (!back.length) return null;
  // The slope that lies along most of that back: tried either side of the
  // spine's own line, each set to touch the back where it stands out most.
  const lean = Math.atan2(dy, dz);
  let best = null;
  for (let step = -25; step <= 25; step += 1) {
    const angle = lean + (step * Math.PI) / 180;
    const d = [Math.cos(angle), Math.sin(angle)];
    if (d[1] < 0.2 || Math.sign(d[0]) !== s) continue;
    // Out of the back, and down.
    const n = -d[0] < 0 ? [d[1], -d[0]] : [-d[1], d[0]];
    const reach = back.map((sphere) => sphere.c[2] * n[0] + sphere.c[1] * n[1] + sphere.r);
    const touch = Math.max(...reach);
    const lying = reach.filter((value) => touch - value < 0.01).length;
    if (!best || lying > best.lying || (lying === best.lying && Math.abs(step) < Math.abs(best.step))) best = { step, d, n, touch, lying };
  }
  if (!best) return null;
  const { d, n } = best;
  // A back, not a chest: a face-down trunk off the floor is held up by its arms.
  const facing = actor.evaluated.matrices[actor.skeleton.boneIndex("spine03")].slice(8, 11);
  if (facing[2] * n[0] + facing[1] * n[1] > -0.5) return null;
  const touch = best.touch - SINK;
  const along = touch - (chest[2] * n[0] + chest[1] * n[1]);
  const top = [chest[2] + along * n[0], chest[1] + along * n[1]];
  const base = restingOn(surface, props, pelvis[0], top[0], top[1]);
  if (top[1] - base < 0.15) return null;
  let front = top[0] - (d[0] * (top[1] - base)) / d[1];
  if (edge != null) front = s < 0 ? Math.min(front, edge) : Math.max(front, edge);
  if (Math.abs(front - top[0]) < 0.1 || Math.abs(front - top[0]) > 1) return null;
  const rise = top[1] + ((front - top[0]) * d[1]) / d[0];
  // A reading wedge carries on back past the shoulders; a thinner one is made
  // only where something - a hand behind, the head let back - is in the way.
  for (const depth of [0.16, 0.08, 0]) {
    const tail = top[0] + s * depth;
    const profile = [
      [front, base],
      ...(rise > base + 0.01 ? [[front, Math.min(rise, top[1])]] : []),
      top,
      ...(depth ? [[tail, top[1]]] : []),
      [tail, base],
    ];
    const wedge = fitted(index, all, surface, props, profile, pelvis[0], base);
    if (wedge) return wedge;
  }
  return null;
}

/** A backrest of this profile, as wide about `middle` as the bodies round it allow, or null. */
function fitted(index, all, surface, props, profile, middle, base) {
  // Counter-clockwise in (z, y), as the shape wants it.
  const area = profile.reduce((sum, [u, v], i) => {
    const [u2, v2] = profile[(i + 1) % profile.length];
    return sum + u * v2 - u2 * v;
  }, 0);
  if (area < 0) profile.reverse();
  let [lo, hi] = [middle - REACH, middle + REACH];
  for (const sphere of all) {
    if (sphere.actor === index && BACK.has(sphere.bone)) continue;
    const gap = outside(profile, sphere.c[2], sphere.c[1]);
    if (gap >= sphere.r) continue;
    const half = Math.sqrt(sphere.r * sphere.r - Math.max(gap, 0) ** 2);
    const [a, b] = [sphere.c[0] - half, sphere.c[0] + half];
    if (b <= lo || a >= hi) continue;
    if (a <= middle && b >= middle) return null;
    if (b < middle) lo = b;
    else hi = a;
  }
  if (hi - lo < NARROWEST) return null;
  const zs = profile.map(([u]) => u),
    ys = profile.map(([, v]) => v);
  const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
  const height = Math.max(...ys);
  const rect = [lo, hi, z0, z1];
  if (!level(surface, props, rect, base, base + 0.01) || occupied(props, rect, base, height)) return null;
  const centre = [(lo + hi) / 2, (base + height) / 2, (z0 + z1) / 2];
  return {
    kind: "backrest",
    shape: "prism",
    size: [hi - lo, height - base, z1 - z0],
    center: centre,
    profile: profile.map(([u, v]) => [u - centre[2], v - centre[1]]),
  };
}

/**
 * The cushions and backrests a solved scene is missing, as props to draw with
 * the rest. A figure gets them when its trunk is meant to rest on something,
 * its centre of mass is off what bears it, and what is under it is empty.
 */
export function supportProps(solved) {
  const { actors, surface } = solved;
  const props = [...solved.props];
  const all = actors.flatMap((actor, index) => spheres(actor, index));
  const added = [];
  actors.forEach((actor, index) => {
    if (actor.carried || actor.mountedOn != null) return;
    if (!actor.posture?.supports?.some((support) => BULK_SUPPORTS.has(support.landmark))) return;
    const com = centreOfMass(actor);
    // Hands put down behind a figure sitting back hold it off the floor, but
    // it is seated by what its body and legs rest on: buttocks hanging over
    // the boards are given a cushion all the same, and a back the hands
    // already hold up is not given a wedge.
    if (overhang(bearing(index, actors, surface, props, false), com).by <= SLACK) return;
    const seat = seatFor(index, all, surface, props);
    if (seat) props.push(seat), added.push(seat);
    const still = overhang(bearing(index, actors, surface, props), com);
    if (still.by <= SLACK) return;
    const backrest = backrestFor(index, actor, all, surface, props, seat);
    if (backrest) props.push(backrest), added.push(backrest);
  });
  return added;
}

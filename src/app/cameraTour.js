/**
 * A camera tour: one circuit of the figures, the way a camera on a dolly track
 * goes round a subject, that begins and ends on the view the scene was framed
 * in, so a tour that runs to the end leaves nothing moved.
 *
 * It turns at one steady rate, the whole way round, and only gathers that pace
 * at the start and gives it up at the end, so that the speed - which is what
 * the eye reads in a turning picture - never changes in the middle of it. As
 * it goes round behind the figures it rises once, a little, and comes in a
 * little, and comes back down to the framing's height as it comes back round
 * to the front: one gentle crane, not a climb and a dive and a push.
 *
 * The path is in the orbit's own terms - the turn about the point looked at,
 * the height above the horizon and the distance - relative to where the camera
 * starts, so it fits whatever the framing gave: a pair standing and a pair
 * lying down get the same circuit, each at its own scale.
 */
const DEG = Math.PI / 180;

export const TOUR_SECONDS = 24;
/** The fraction of the tour at either end spent gathering pace or losing it. */
const RAMP = 0.15;
/** How far the camera comes in, as a fraction of its distance, when it is behind the figures. */
const PUSH = 0.06;

const clamp01 = (t) => Math.min(1, Math.max(0, t));

/**
 * How far round the tour is at `t`, both 0 to 1: the distance gone at a speed
 * that rises from nothing to full over the first `RAMP`, smoothly, holds, and
 * falls back to nothing over the last.
 */
export function tourProgress(t) {
  t = clamp01(t);
  const ramp = (x) => RAMP * (x ** 3 - x ** 4 / 2);
  const gone =
    t < RAMP ? ramp(t / RAMP) : t > 1 - RAMP ? 1 - RAMP - ramp((1 - t) / RAMP) : RAMP / 2 + (t - RAMP);
  return gone / (1 - RAMP);
}

/**
 * The camera's orbit at `t` (0 to 1) of a tour from `start`.
 *
 * Its highest, behind the figures, is twelve degrees over the start but no
 * higher than forty-five; from higher than forty it is lower, since a camera
 * looking down from overhead has nowhere higher to go.
 *
 * @param {{theta: number, elevation: number, radius: number, focus?: number[]}} start radians and metres
 * @param {number} t
 */
export function tourOrbit(start, t) {
  const s = tourProgress(t);
  const rise = Math.sin(Math.PI * s) ** 2;
  const peak =
    start.elevation <= 40 * DEG ? Math.min(start.elevation + 12 * DEG, 45 * DEG) : start.elevation - 15 * DEG;
  return {
    ...start,
    theta: start.theta + 2 * Math.PI * s,
    elevation: start.elevation + (peak - start.elevation) * rise,
    radius: start.radius * (1 - PUSH * rise),
  };
}

/**
 * Plays tours on the camera, one frame at a time.
 *
 * `read` gives the camera's orbit and `write` sets it. Stopping leaves the
 * camera where the tour had got to, for whoever stopped it to carry on from.
 */
export function createCameraTour({
  read,
  write,
  draw,
  done = () => {},
  seconds = TOUR_SECONDS,
  clock = () => performance.now(),
  schedule = (step) => requestAnimationFrame(step),
  unschedule = (handle) => cancelAnimationFrame(handle),
}) {
  let start = null;
  let began = 0;
  let handle = 0;
  function finish() {
    if (handle) unschedule(handle);
    handle = 0;
    start = null;
    done();
  }
  function step() {
    handle = 0;
    const t = (clock() - began) / (seconds * 1000);
    write(tourOrbit(start, t));
    draw();
    if (t >= 1) finish();
    else handle = schedule(step);
  }
  return {
    play() {
      if (handle) unschedule(handle);
      start = read();
      began = clock();
      handle = schedule(step);
    },
    stop() {
      if (start) finish();
    },
    get playing() {
      return start !== null;
    },
  };
}

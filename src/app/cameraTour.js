/**
 * A camera tour: one slow circuit of the figures, rising over them, dipping
 * low behind and coming in closer, that begins and ends on the view the
 * scene was framed in, so a tour that runs to the end leaves nothing moved.
 *
 * The path is keyed in the orbit's own terms - the turn about the focus, the
 * height above the horizon and the distance - relative to where the camera
 * starts, so it fits whatever the framing gave: a pair standing and a pair
 * lying down get the same circuit, each at its own scale.
 */
const DEG = Math.PI / 180;

/**
 * [turn from the start in degrees, elevation in degrees, distance as a
 * fraction of the start's]. `null` is the start's own elevation, so the
 * circuit closes on it.
 */
const KEYS = [
  [0, null, 1],
  [90, 38, 0.86],
  [180, 10, 1],
  [270, 58, 0.92],
  [360, null, 1],
];
/** Never lower than this: under the horizon a lying pair is seen through the floor. */
const LOWEST = 6 * DEG;
export const TOUR_SECONDS = 16;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
/** Gathers pace from rest and comes back to rest, so neither end jerks. */
const easeInOut = (t) => (1 - Math.cos(Math.PI * t)) / 2;
const catmullRom = (p0, p1, p2, p3, f) =>
  0.5 *
  (2 * p1 +
    (p2 - p0) * f +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f +
    (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);

/**
 * The camera's orbit at `t` (0 to 1) of a tour from `start`.
 *
 * @param {{theta: number, elevation: number, radius: number}} start radians and metres
 * @param {number} t
 */
export function tourOrbit(start, t) {
  const segments = KEYS.length - 1;
  const u = easeInOut(clamp01(t)) * segments;
  const i = Math.min(segments - 1, Math.floor(u));
  const f = u - i;
  // The circuit is closed, so the keys before the first and after the last
  // are the ones either side of the start, a turn round.
  const key = (k) => {
    const lap = Math.floor(k / segments);
    const [turn, elevation, distance] = KEYS[k - lap * segments];
    return [
      turn + lap * 360,
      elevation === null ? start.elevation / DEG : elevation,
      distance,
    ];
  };
  const [a, b, c, d] = [i - 1, i, i + 1, i + 2].map(key);
  const at = (n) => catmullRom(a[n], b[n], c[n], d[n], f);
  return {
    theta: start.theta + at(0) * DEG,
    elevation:
      t >= 1
        ? start.elevation
        : Math.max(Math.min(LOWEST, start.elevation), at(1) * DEG),
    radius: start.radius * at(2),
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

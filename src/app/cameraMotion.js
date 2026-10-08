/**
 * How the camera moves when it is moved: a drag or a key that turns it, a
 * wheel or a pinch that brings it in, a button that takes it to another view.
 *
 * Nothing jumps. A turn or a zoom says where the camera is to go, and the
 * camera follows, more than half the way there in a tenth of a second and the
 * rest after: a drag feels held rather than pushed, a turn of the wheel glides in
 * rather than stepping, and a key held down turns it steadily rather than in
 * jolts. A move to another view - a view button, the fit, a position just
 * opened - is one move that sets off gently and settles gently, takes longer
 * the further it goes, goes the short way round, and changes its distance by
 * ratio, so that coming in from far off does not rush the last of it.
 *
 * For a reader who asks for less motion, everything is where it is going at once.
 *
 * Orbits are the viewport's: a turn about the point looked at, a height above
 * the horizon, a distance, and that point.
 */

/** Seconds for the camera to close all but a third of the way to where it is going. */
const FOLLOW = 0.11;

/** The turn from `a` to `b` the short way round. */
const shortWay = (turn) => turn - 2 * Math.PI * Math.round(turn / (2 * Math.PI));
const lerp = (a, b, s) => a + (b - a) * s;
/** Sets off with no jolt and comes to rest with none: velocity and acceleration are nothing at both ends. */
const smootherstep = (s) => s * s * s * (s * (s * 6 - 15) + 10);

/** The orbit `s` of the way from `from` to `to`. */
export function between(from, to, s) {
  return {
    theta: from.theta + shortWay(to.theta - from.theta) * s,
    elevation: lerp(from.elevation, to.elevation, s),
    radius: from.radius * (to.radius / from.radius) ** s,
    focus: from.focus.map((value, i) => lerp(value, to.focus[i], s)),
  };
}

/** How long a move from `from` to `to` takes: half a second for a nudge, not much over a second for a turn right round. */
export function moveSeconds(from, to) {
  const turn = Math.abs(shortWay(to.theta - from.theta)) + Math.abs(to.elevation - from.elevation);
  const zoom = Math.abs(Math.log(to.radius / from.radius));
  const pan = Math.hypot(...from.focus.map((value, i) => value - to.focus[i])) / Math.max(from.radius, to.radius);
  return Math.min(1.3, 0.5 + 0.45 * (turn + zoom + pan));
}

/**
 * @param {object} options
 * @param {() => object} options.read the camera's orbit now
 * @param {(orbit: object) => void} options.write put the camera there
 * @param {() => void} options.render draw a frame, from inside an animation frame
 * @param {() => void} [options.draw] ask for a frame, outside one
 * @param {(orbit: object) => object} [options.limit] where the camera may go
 * @param {() => boolean} [options.instant] whether to skip the motion
 */
export function createCameraMotion({
  read,
  write,
  render,
  draw = render,
  limit = (orbit) => orbit,
  instant = () => false,
  clock = () => performance.now(),
  schedule = (step) => requestAnimationFrame(step),
  unschedule = (handle) => cancelAnimationFrame(handle),
}) {
  // Following: where the camera is, its turn unwrapped, and where it is going.
  let here = null;
  let goal = null;
  // Or moving: from where, to where, since when, for how long, and what next.
  let move = null;
  let last = 0;
  let handle = 0;

  function step() {
    handle = 0;
    const now = clock();
    if (move) {
      const s = Math.min(1, (now - move.began) / (move.seconds * 1000));
      write(between(move.from, move.to, smootherstep(s)));
      render();
      if (s < 1) handle = schedule(step);
      else {
        const { then } = move;
        move = null;
        then?.();
      }
      return;
    }
    if (!goal) return;
    const k = 1 - Math.exp(-Math.min(0.1, (now - last) / 1000) / FOLLOW);
    last = now;
    here = {
      theta: lerp(here.theta, goal.theta, k),
      elevation: lerp(here.elevation, goal.elevation, k),
      radius: lerp(here.radius, goal.radius, k),
      focus: goal.focus,
    };
    const settled =
      Math.abs(goal.theta - here.theta) < 1e-4 &&
      Math.abs(goal.elevation - here.elevation) < 1e-4 &&
      Math.abs(goal.radius / here.radius - 1) < 1e-4;
    if (settled) here = goal;
    write(here);
    render();
    if (settled) here = goal = null;
    else handle = schedule(step);
  }
  function run() {
    if (!handle) handle = schedule(step);
  }
  function stop() {
    if (handle) unschedule(handle);
    handle = 0;
    here = goal = move = null;
  }
  /** Turn or zoom from where it is going already, or from where it is. */
  function follow(change) {
    if (instant()) {
      stop();
      write(limit(change(read())));
      draw();
      return;
    }
    if (move) stop();
    if (!goal) {
      here = read();
      goal = { ...here };
      last = clock();
    }
    goal = limit(change(goal));
    run();
  }

  return {
    /** Turn by `theta` about the point looked at and raise by `elevation`, in radians. */
    nudge(theta, elevation) {
      follow((orbit) => ({ ...orbit, theta: orbit.theta + theta, elevation: orbit.elevation + elevation }));
    },
    /** Take the distance by `factor`: under one comes in. */
    zoom(factor) {
      follow((orbit) => ({ ...orbit, radius: orbit.radius * factor }));
    },
    /** Move to `orbit` in one eased move, then do `then`. */
    moveTo(orbit, { seconds, then } = {}) {
      stop();
      const from = read();
      const to = limit(orbit);
      if (instant()) {
        write(to);
        draw();
        then?.();
        return;
      }
      move = { from, to, began: clock(), seconds: seconds ?? moveSeconds(from, to), then };
      run();
    },
    /** Leave the camera where it has got to. */
    stop,
    get moving() {
      return !!(move || goal);
    },
  };
}

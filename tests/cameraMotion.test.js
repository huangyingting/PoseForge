import test from "node:test";
import assert from "node:assert/strict";
import { between, createCameraMotion, moveSeconds } from "../src/app/cameraMotion.js";

const DEG = Math.PI / 180;
const START = { theta: 36.9 * DEG, elevation: 18 * DEG, radius: 4, focus: [0, 0.8, 0] };

/** A camera on a fake clock, with the frames it is asked for queued. */
function rig({ instant = false, limit } = {}) {
  let now = 0;
  const queue = [];
  const writes = [];
  let orbit = { ...START };
  let renders = 0;
  let draws = 0;
  const motion = createCameraMotion({
    read: () => ({ ...orbit }),
    write: (next) => {
      orbit = next;
      writes.push(next);
    },
    render: () => (renders += 1),
    draw: () => (draws += 1),
    limit,
    instant: () => instant,
    clock: () => now,
    schedule: (step) => queue.push(step),
    unschedule: () => queue.splice(0),
  });
  const frame = (ms = 16) => {
    now += ms;
    queue.shift()?.();
  };
  return {
    motion,
    frame,
    settle: () => {
      for (let i = 0; i < 2000 && queue.length; i += 1) frame();
    },
    get orbit() {
      return orbit;
    },
    writes,
    queue,
    counts: () => ({ renders, draws }),
  };
}

test("a turn and a zoom glide to where they were sent, and stop there", () => {
  const camera = rig();
  camera.motion.nudge(0.3, 0.1);
  camera.motion.zoom(0.5);
  camera.frame();
  // The first frame goes part of the way only.
  assert.ok(camera.orbit.theta > START.theta && camera.orbit.theta < START.theta + 0.3);
  assert.ok(camera.motion.moving);
  camera.settle();
  assert.equal(camera.motion.moving, false);
  assert.ok(Math.abs(camera.orbit.theta - (START.theta + 0.3)) < 1e-9);
  assert.ok(Math.abs(camera.orbit.elevation - (START.elevation + 0.1)) < 1e-9);
  assert.ok(Math.abs(camera.orbit.radius - 2) < 1e-9);
  // Each step nearer than the one before: no overshoot, no wobble.
  const gaps = camera.writes.map((orbit) => START.theta + 0.3 - orbit.theta);
  for (let i = 1; i < gaps.length; i += 1) assert.ok(gaps[i] <= gaps[i - 1] && gaps[i] >= 0);
});

test("a nudge while gliding adds to where it is going, and the limits hold the goal", () => {
  const camera = rig({ limit: (orbit) => ({ ...orbit, elevation: Math.min(orbit.elevation, 30 * DEG) }) });
  camera.motion.nudge(0.2, 0);
  camera.frame();
  camera.motion.nudge(0.2, 0);
  for (let i = 0; i < 10; i += 1) camera.motion.nudge(0, 0.1);
  camera.settle();
  assert.ok(Math.abs(camera.orbit.theta - (START.theta + 0.4)) < 1e-9);
  assert.ok(Math.abs(camera.orbit.elevation - 30 * DEG) < 1e-9);
});

test("the speed of a glide does not depend on the frame rate", () => {
  const at = (ms) => {
    const camera = rig();
    camera.motion.nudge(1, 0);
    for (let elapsed = 0; elapsed < 120; elapsed += ms) camera.frame(ms);
    return camera.orbit.theta;
  };
  assert.ok(Math.abs(at(8) - at(40)) < 0.01);
});

test("a move eases out and in, the short way round, and then does what follows", () => {
  const camera = rig();
  let after = 0;
  const to = { theta: START.theta - 2 * Math.PI + 0.5, elevation: 40 * DEG, radius: 8, focus: [0.4, 0.6, 0] };
  camera.motion.moveTo(to, { then: () => (after += 1) });
  camera.settle();
  assert.equal(after, 1);
  const end = camera.orbit;
  assert.ok(Math.abs(Math.sin(end.theta - to.theta)) < 1e-9 && Math.cos(end.theta - to.theta) > 0);
  assert.ok(Math.abs(end.radius - 8) < 1e-9);
  assert.deepEqual(end.focus.map((v) => +v.toFixed(9)), to.focus);
  // Never more than the turn there is the short way, and never back.
  const thetas = camera.writes.map((orbit) => orbit.theta);
  for (let i = 1; i < thetas.length; i += 1) assert.ok(thetas[i] >= thetas[i - 1] - 1e-12);
  assert.ok(thetas.at(-1) - thetas[0] < 0.6);
  // Slow at both ends, fastest in the middle.
  const steps = thetas.slice(1).map((theta, i) => theta - thetas[i]);
  const middle = Math.max(...steps);
  assert.ok(steps[0] < middle / 10 && steps.at(-1) < middle / 10);
});

test("taking hold of the camera mid-move leaves the move behind", () => {
  const camera = rig();
  let after = 0;
  camera.motion.moveTo({ ...START, theta: START.theta + 1 }, { then: () => (after += 1) });
  camera.frame();
  camera.frame(200);
  const held = camera.orbit.theta;
  camera.motion.nudge(0.1, 0);
  camera.settle();
  assert.equal(after, 0);
  assert.ok(Math.abs(camera.orbit.theta - (held + 0.1)) < 1e-9);
  camera.motion.moveTo({ ...START, theta: START.theta + 1 });
  camera.frame();
  camera.motion.stop();
  const stopped = camera.orbit;
  camera.settle();
  assert.deepEqual(camera.orbit, stopped);
  assert.equal(camera.motion.moving, false);
});

test("for a reader who asks for less motion, the camera is there at once", () => {
  const camera = rig({ instant: true });
  let after = 0;
  camera.motion.nudge(0.2, 0);
  assert.ok(Math.abs(camera.orbit.theta - (START.theta + 0.2)) < 1e-12);
  camera.motion.zoom(0.5);
  assert.ok(Math.abs(camera.orbit.radius - 2) < 1e-12);
  const to = { theta: 1, elevation: 0.5, radius: 6, focus: [0, 1, 0] };
  camera.motion.moveTo(to, { then: () => (after += 1) });
  assert.deepEqual(camera.orbit, to);
  assert.equal(after, 1);
  assert.equal(camera.queue.length, 0);
  assert.deepEqual(camera.counts(), { renders: 0, draws: 3 });
});

test("moves take longer the further they go, within reason", () => {
  const near = moveSeconds(START, { ...START, theta: START.theta + 0.05 });
  const round = moveSeconds(START, { ...START, theta: START.theta + Math.PI / 2 });
  const over = moveSeconds(START, { ...START, theta: START.theta + Math.PI, elevation: 89 * DEG, radius: 12 });
  assert.ok(near >= 0.5 && near < 0.6);
  assert.ok(round > near && round < over);
  assert.ok(over <= 1.3);
  // Halfway in distance is halfway by ratio.
  assert.ok(Math.abs(between(START, { ...START, radius: 16 }, 0.5).radius - 8) < 1e-9);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  TOUR_SECONDS,
  createCameraTour,
  tourOrbit,
} from "../src/app/cameraTour.js";

const DEG = Math.PI / 180;
// The default three-quarter view: turned 37° and 19° up.
const START = { theta: 36.9 * DEG, elevation: 18.6 * DEG, radius: 3.2 };
const position = ({ theta, elevation, radius }) => [
  radius * Math.cos(elevation) * Math.sin(theta),
  radius * Math.sin(elevation),
  radius * Math.cos(elevation) * Math.cos(theta),
];
const near = (a, b, tolerance = 1e-9) =>
  a.every((value, i) => Math.abs(value - b[i]) < tolerance);

test("a tour starts and ends on the framed view, at rest", () => {
  assert.ok(near(position(tourOrbit(START, 0)), position(START)));
  assert.ok(near(position(tourOrbit(START, 1)), position(START)));
  // Past its end it stays there.
  assert.ok(near(position(tourOrbit(START, 1.5)), position(START)));
  // Eased at both ends: the first and last hundredth move far less than one
  // from the middle.
  const step = (t) => {
    const [a, b] = [
      position(tourOrbit(START, t)),
      position(tourOrbit(START, t + 0.01)),
    ];
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  };
  assert.ok(step(0) < step(0.5) / 20);
  assert.ok(step(0.99) < step(0.5) / 20);
});

test("a tour goes the whole way round at one steady pace, rising once a little behind the figures", () => {
  const samples = Array.from({ length: 1001 }, (_, i) =>
    tourOrbit(START, i / 1000),
  );
  for (let i = 1; i < samples.length; i += 1) {
    // Always turning the same way, never doubling back or jumping.
    const turn = samples[i].theta - samples[i - 1].theta;
    assert.ok(turn >= 0 && turn < 3 * DEG, `turn ${turn / DEG}° at ${i}`);
  }
  assert.ok(Math.abs(samples.at(-1).theta - START.theta - 2 * Math.PI) < 1e-9);
  // Between the ramps it turns at one rate.
  const turns = samples.slice(160, 841).map((s, i) => samples[160 + i + 1].theta - s.theta);
  assert.ok(Math.max(...turns) - Math.min(...turns) < 1e-9, "a steady turn");
  // It rises once, no more than fifteen degrees, never below where it began,
  // highest behind the figures.
  const elevations = samples.map((s) => s.elevation / DEG);
  const top = Math.max(...elevations);
  assert.ok(top > START.elevation / DEG + 5 && top <= START.elevation / DEG + 15, `rises to ${top}°`);
  assert.ok(Math.min(...elevations) >= START.elevation / DEG - 1e-9);
  const highest = samples[elevations.indexOf(top)];
  assert.ok(Math.abs(highest.theta - START.theta - Math.PI) < 5 * DEG, "highest behind");
  let turnsBack = 0;
  for (let i = 2; i < elevations.length; i += 1)
    if (Math.sign(elevations[i] - elevations[i - 1]) * Math.sign(elevations[i - 1] - elevations[i - 2]) < 0) turnsBack += 1;
  assert.equal(turnsBack, 1, "up once and down once");
  const radii = samples.map((s) => s.radius / START.radius);
  assert.ok(Math.min(...radii) >= 0.93 && Math.min(...radii) < 0.97, "comes in a little");
  assert.ok(Math.max(...radii) <= 1, "never backs off past the framing");
  // What it looks at stays put.
  const focused = tourOrbit({ ...START, focus: [0.1, 0.8, -0.2] }, 0.4);
  assert.deepEqual(focused.focus, [0.1, 0.8, -0.2]);
});

test("a tour from overhead comes down, a little, rather than going higher", () => {
  const top = { theta: 0.8, elevation: 89.9 * DEG, radius: 3 };
  const elevations = Array.from({ length: 101 }, (_, i) => tourOrbit(top, i / 100).elevation / DEG);
  assert.ok(Math.max(...elevations) <= 89.9 + 1e-9);
  assert.ok(Math.min(...elevations) > 70);
});

test("a tour from a low front view does not start by dropping under it", () => {
  const front = { theta: 0, elevation: 3 * DEG, radius: 2 };
  const elevations = Array.from(
    { length: 101 },
    (_, i) => tourOrbit(front, i / 100).elevation,
  );
  assert.ok(Math.min(...elevations) >= 3 * DEG - 1e-12);
});

test("the player writes each frame, stops where it is told and ends where it began", () => {
  let now = 0;
  const queue = [];
  const writes = [];
  let done = 0;
  let orbit = { ...START };
  const tour = createCameraTour({
    read: () => ({ ...orbit }),
    write: (next) => {
      orbit = next;
      writes.push(next);
    },
    draw: () => {},
    done: () => (done += 1),
    clock: () => now,
    schedule: (step) => queue.push(step),
    unschedule: () => queue.splice(0),
  });
  const run = (ms) => {
    now += ms;
    queue.shift()?.();
  };
  assert.equal(tour.playing, false);
  tour.play();
  assert.equal(tour.playing, true);
  run(1000);
  run(1000);
  assert.equal(writes.length, 2);
  assert.notDeepEqual(position(orbit), position(START));
  // Stopped, it leaves the camera where it had got to and schedules nothing.
  const stoppedAt = position(orbit);
  tour.stop();
  assert.equal(tour.playing, false);
  assert.equal(done, 1);
  assert.equal(queue.length, 0);
  assert.deepEqual(position(orbit), stoppedAt);
  tour.stop();
  assert.equal(done, 1);
  // Played again from there, it runs to the end and comes back to it.
  tour.play();
  while (queue.length) run(TOUR_SECONDS * 250);
  assert.equal(tour.playing, false);
  assert.equal(done, 2);
  assert.ok(near(position(orbit), stoppedAt));
});

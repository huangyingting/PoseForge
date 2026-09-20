import test from "node:test";
import assert from "node:assert/strict";
import { createCameraGesture } from "../src/app/cameraInput.js";

test("one pointer orbits while two pointers scale without orbiting", () => {
  const orbits = [],
    zooms = [],
    gesture = createCameraGesture({
      orbit: (...args) => orbits.push(args),
      zoom: (factor) => zooms.push(factor),
    });
  gesture.down(1, 100, 100);
  gesture.move(1, 110, 105);
  assert.deepEqual(orbits, [[-0.06, -0.03]]);
  gesture.down(2, 210, 105);
  gesture.move(2, 310, 105);
  assert.deepEqual(zooms, [0.5]);
  assert.equal(orbits.length, 1);
  gesture.up(2);
  gesture.move(1, 115, 105);
  assert.deepEqual(orbits.at(-1), [-0.03, -0]);
});

test("third touches, canceled pointers, reset and near-zero spacing cannot jump the camera", () => {
  const zooms = [],
    orbits = [],
    gesture = createCameraGesture({
      orbit: (...a) => orbits.push(a),
      zoom: (n) => zooms.push(n),
    });
  gesture.down(1, 0, 0);
  gesture.down(2, 100, 0);
  gesture.down(3, 200, 0);
  gesture.move(1, -50, 0);
  gesture.move(3, 300, 0);
  assert.equal(zooms.length, 0);
  assert.equal(orbits.length, 0);
  gesture.up(3);
  gesture.move(2, 110, 0);
  assert.equal(zooms[0], 150 / 160);
  gesture.up(1);
  gesture.up(2);
  gesture.move(2, 500, 300);
  assert.equal(zooms.length, 1);
  gesture.down(5, 0, 0);
  gesture.down(6, 0, 0);
  gesture.move(6, 500, 500);
  assert.equal(zooms.length, 1);
  gesture.reset();
  assert.equal(gesture.size, 0);
});

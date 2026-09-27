import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { buildRoom, disposeRoom, roomLayout, SETTINGS, updateRoom } from "../src/render/room.js";
import { SURFACES } from "../src/core/poseLibrary.js";

const pair = { min: [-0.9, 0, -0.5], max: [0.8, 1.8, 0.45] };
const wide = { min: [-1.6, 0, -1.2], max: [1.7, 0.9, 1.4] };

/** What stands against the walls, each piece as the box it fills in the room. */
function pieces(room) {
  room.updateMatrixWorld(true);
  const found = [];
  for (const wall of room.userData.walls)
    for (const piece of wall.children.slice(2)) {
      if (!piece.isGroup && piece.material?.blending === 2) continue; // a lamp's glow on the wall
      found.push({ wall: wall.name, box: new Box3().setFromObject(piece) });
    }
  return found;
}

test("a room stands clear of the scene, and nothing in it stands in anything else", () => {
  for (const setting of ["bedroom", "living"])
    for (const [bounds, props] of [
      [pair, []],
      [wide, SURFACES.bed.props],
      [pair, SURFACES.wall.props],
    ]) {
      const layout = roomLayout(setting, bounds, props);
      const room = buildRoom(layout);
      const scene = new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max));
      for (const prop of props) scene.expandByPoint(new Vector3(...prop.center.map((c, k) => c + prop.size[k] / 2)));
      const inside = new Box3(new Vector3(-layout.half[0] - 0.01, -0.01, layout.north - 0.01), new Vector3(layout.half[0] + 0.01, 2.61, layout.half[1] + 0.01));
      const found = pieces(room);
      assert.ok(found.length >= 6, `${setting}: ${found.length} pieces`);
      for (const { wall, box } of found) {
        assert.ok(inside.containsBox(box), `${setting} ${wall}: a piece outside the room`);
        assert.ok(!box.intersectsBox(scene), `${setting} ${wall}: a piece in the scene`);
      }
      for (let i = 0; i < found.length; i += 1)
        for (let j = i + 1; j < found.length; j += 1)
          assert.ok(!found[i].box.intersectsBox(found[j].box), `${setting}: ${found[i].wall} and ${found[j].wall} pieces meet`);
      // The rug is under the figures and short of the walls.
      const { size, at } = layout.rug;
      assert.ok(Math.abs(at[0]) + size[0] / 2 <= layout.half[0] - 0.69);
      assert.ok(at[1] + size[1] / 2 <= layout.half[1] - 0.69);
      disposeRoom(room);
    }
});

test("a wall to lean on is the room's north wall", () => {
  const layout = roomLayout("bedroom", pair, SURFACES.wall.props);
  const [wall] = SURFACES.wall.props;
  assert.equal(layout.north, +(wall.center[2] - wall.size[2] / 2).toFixed(3));
  assert.equal(layout.wall, true);
});

test("a small edit keeps the room, the studio is no room at all, and a large scene gets a larger one", () => {
  const nudged = { min: [-0.93, 0, -0.52], max: [0.82, 1.8, 0.48] };
  assert.deepEqual(roomLayout("bedroom", nudged), roomLayout("bedroom", pair));
  assert.equal(roomLayout("studio", pair), null);
  assert.deepEqual(SETTINGS.at(-1), "studio");
  const small = roomLayout("living", pair);
  const large = roomLayout("living", wide);
  assert.ok(large.half[0] > small.half[0] && large.half[1] > small.half[1]);
  for (const layout of [small, large])
    assert.ok(layout.half.every((half) => half * 2 === Math.round(half * 2)), "walls in half-metre steps");
});

test("the walls between the camera and the scene are hidden, with what stands against them", () => {
  const room = buildRoom(roomLayout("bedroom", pair));
  const visible = (camera) => {
    updateRoom(room, { position: new Vector3(...camera) });
    return Object.fromEntries(room.userData.walls.map((wall) => [wall.name, wall.visible]));
  };
  // The three-quarter view, from outside the south-east corner.
  assert.deepEqual(visible([4, 2, 5]), { "wall-north": true, "wall-south": false, "wall-west": true, "wall-east": false });
  // From inside, every wall.
  assert.deepEqual(visible([0.5, 1.6, 0.5]), { "wall-north": true, "wall-south": true, "wall-west": true, "wall-east": true });
  // From behind the west wall, looking east.
  assert.deepEqual(visible([-6, 1.5, 0]), { "wall-north": true, "wall-south": true, "wall-west": false, "wall-east": true });
  disposeRoom(room);
});

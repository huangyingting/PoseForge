import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_EXPRESSION, EXPRESSIONS, EXPRESSION_NAMES, FACE_STEP, faceExpression } from "../src/core/expressions.js";
import { MOUTH_COLOURS, inMouth, withExpression, withFaces } from "../src/core/faces.js";
import { buildHumanTemplate, movedNormals } from "../src/core/humanMesh.js";
import { packCards, readCards } from "../src/core/hairCards.js";
import { BODY_MODEL_NAMES, modelFiles } from "../src/core/bodyModels.js";
import { validateScene } from "../src/core/scene.js";
import { parseDescription } from "../src/nlp/parser.js";
import { createTemplateCache } from "../src/workers/templateCache.js";

/**
 * A flat square of four quads, facing +z, with the centre vertex copied as a
 * UV seam would copy it: vertex 9 is vertex 4 again, and the two quads on the
 * right use it.
 */
function sheet() {
  const positions = [];
  for (let y = 0; y < 3; y += 1) for (let x = 0; x < 3; x += 1) positions.push(x * 0.01, y * 0.01, 0);
  positions.push(0.01, 0.01, 0);
  const at = (x, y) => (x === 1 && y === 1 ? null : y * 3 + x);
  const quads = [];
  for (let y = 0; y < 2; y += 1)
    for (let x = 0; x < 2; x += 1) {
      const centre = x === 1 ? 9 : 4;
      const [a, b, c, d] = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([i, j]) => at(i, j) ?? centre);
      quads.push(a, b, c, a, c, d);
    }
  const count = positions.length / 3;
  return {
    name: "body",
    primary: true,
    positions: Float32Array.from(positions),
    normals: Float32Array.from({ length: count * 3 }, (_, i) => (i % 3 === 2 ? 1 : 0)),
    indices: Uint32Array.from(quads),
  };
}

/** A faces file for `sheet`, whose one expression lifts the centre 2mm out of it. */
function sheetFaces({ vertices = 10, trim = 2 } = {}) {
  return readCards(
    packCards(
      { body: "sheet", step: FACE_STEP, vertices, expressions: ["smile"], trims: { brows: trim } },
      {
        "smile.body.vertices": Uint16Array.from([4, 9]),
        "smile.body": Int16Array.from([0, 0, 2000, 0, 0, 2000]),
        "smile.brows": Int16Array.from({ length: trim * 3 }, (_, i) => (i % 3 === 1 ? 500 : 0)),
      },
    ),
  );
}

const brows = () => ({ name: "brows", primary: false, trim: "brows", positions: new Float32Array(6), normals: new Float32Array(6) });

/**
 * `sheetFaces` with a mouth in it: one tooth, a triangle 5mm behind the sheet
 * that the smile lifts 1mm, the first triangle of the sheet cut open in front
 * of it, and the dark at the centre deeper in the smile.
 */
function mouthFaces() {
  return readCards(
    packCards(
      { body: "sheet", step: FACE_STEP, vertices: 10, expressions: ["smile"], trims: {}, mouth: { teeth: 3 } },
      {
        "smile.body.vertices": Uint16Array.from([4, 9]),
        "smile.body": Int16Array.from([0, 0, 2000, 0, 0, 2000]),
        "teeth.positions": Float32Array.from([0, 0, -0.005, 0.01, 0, -0.005, 0, 0.01, -0.005]),
        "teeth.indices": Uint16Array.from([0, 1, 2]),
        "smile.teeth.vertices": Uint16Array.from([0, 1, 2]),
        "smile.teeth": Int16Array.from([0, 1000, 0, 0, 1000, 0, 0, 1000, 0]),
        "body.cut": Uint32Array.from([0]),
        "rest.body.cavity.vertices": Uint16Array.from([4]),
        "rest.body.cavity": Uint8Array.from([128]),
        "rest.teeth.occlusion": Uint8Array.from([51, 102, 255]),
        "smile.body.cavity.vertices": Uint16Array.from([4, 9]),
        "smile.body.cavity": Uint8Array.from([64, 64]),
        "smile.teeth.occlusion": Uint8Array.from([0, 0, 255]),
      },
    ),
  );
}

const withHead = (submeshes) => ({ submeshes, jointByBone: new Map([["head", { index: 5 }]]) });

test("an actor wears the expression asked for, a kiss where their mouth is on a partner, and the resting face otherwise", () => {
  const actor = (spec = {}) => ({ index: 0, spec });
  const mouth = { from: "mouth", to: "neck", fromActor: 0, toActor: 1, strength: 0.7 };
  assert.equal(faceExpression(actor({ expression: "laugh" }), [mouth]), "laugh");
  assert.equal(faceExpression(actor(), [mouth]), "kiss");
  assert.equal(faceExpression(actor(), [{ ...mouth, from: "chest", to: "mouth", fromActor: 1, toActor: 0 }]), "kiss");
  assert.equal(faceExpression(actor(), [{ ...mouth, strength: 0 }]), DEFAULT_EXPRESSION);
  assert.equal(faceExpression(actor(), [{ ...mouth, fromActor: 1, toActor: 0 }]), DEFAULT_EXPRESSION);
  assert.equal(faceExpression(actor({ expression: "toString" })), DEFAULT_EXPRESSION);
  assert.equal(faceExpression({ index: 0 }), DEFAULT_EXPRESSION);
  assert.ok(EXPRESSION_NAMES.includes(DEFAULT_EXPRESSION));
  assert.deepEqual(EXPRESSIONS.neutral, {});
});

test("a template carries only the faces made for its own vertices", () => {
  const template = { submeshes: [sheet()] };
  const faces = sheetFaces();
  assert.equal(withFaces(template, faces).faces, faces);
  assert.throws(() => withFaces(template, sheetFaces({ vertices: 11 })), /for 11 vertices, the body has 10/);
});

test("an expression moves the skin and the trims on it, and turns the skin's normals only where it moved", () => {
  const template = withFaces({ submeshes: [sheet(), brows()] }, sheetFaces());
  const smiling = withExpression(template, "smile");
  assert.equal(smiling.expression, "smile");
  const [skin, trim] = smiling.submeshes;
  // Both copies of the centre move, and nothing else does.
  for (const v of [4, 9]) assert.ok(Math.abs(skin.positions[v * 3 + 2] - 0.002) < 1e-9);
  for (const v of [0, 1, 2, 3, 5, 6, 7, 8]) assert.equal(skin.positions[v * 3 + 2], 0);
  // The template it was made from is untouched: the cache shares it.
  assert.equal(template.submeshes[0].positions[4 * 3 + 2], 0);
  // A raised centre tips the normals round it outwards, the same way on both
  // sides of the seam, and leaves the centre's own pointing straight out.
  const n = (v) => [...skin.normals.slice(v * 3, v * 3 + 3)];
  assert.ok(n(3)[0] < -0.05 && n(5)[0] > 0.05, `${n(3)} ${n(5)}`);
  assert.ok(Math.abs(n(4)[0]) < 1e-6 && Math.abs(n(4)[1]) < 1e-6);
  assert.deepEqual(n(4), n(9));
  for (const v of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) assert.ok(Math.abs(Math.hypot(...n(v)) - 1) < 1e-6);
  // The brows ride up with it.
  for (const y of [1, 4]) assert.ok(Math.abs(trim.positions[y] - 0.0005) < 1e-9);
});

test("an expression the template was not made with, or a template with no faces, is left as it is", () => {
  const template = withFaces({ submeshes: [sheet(), brows()] }, sheetFaces());
  assert.equal(withExpression(template, "neutral"), template);
  assert.equal(withExpression(template, "laugh"), template);
  const bare = { submeshes: [sheet()] };
  assert.equal(withExpression(bare, "smile"), bare);
  // Trims that do not match what was baked stay where they were.
  const other = withFaces({ submeshes: [sheet(), { ...brows(), positions: new Float32Array(9) }] }, sheetFaces());
  assert.equal(withExpression(other, "smile").submeshes[1], other.submeshes[1]);
});

test("the mouth goes in on a body with a head to carry it, and only then are the lips cut open in front of it", () => {
  const faces = mouthFaces();
  const bare = withFaces({ submeshes: [sheet()] }, faces);
  assert.equal(bare.submeshes.length, 1);
  assert.deepEqual([...bare.submeshes[0].indices], [...sheet().indices]);

  const [skin, teeth, ...rest] = withFaces(withHead([sheet()]), faces).submeshes;
  assert.equal(rest.length, 0);
  assert.ok(skin.indices instanceof Uint32Array);
  assert.deepEqual([...skin.indices], [...sheet().indices.slice(3)]);
  assert.deepEqual([...skin.cavity.vertices], [4]);
  assert.deepEqual([...skin.cavity.shade], [128]);

  assert.equal(teeth.name, "teeth");
  assert.ok(teeth.mouth && !teeth.primary);
  assert.deepEqual(teeth.colour, MOUTH_COLOURS.teeth);
  assert.deepEqual([...teeth.indices], [0, 1, 2]);
  // Carried on the head, wholly.
  for (let v = 0; v < 3; v += 1) {
    assert.deepEqual([...teeth.joints.slice(v * 4, v * 4 + 4)], [5, 0, 0, 0]);
    assert.deepEqual([...teeth.weights.slice(v * 4, v * 4 + 4)], [1, 0, 0, 0]);
    assert.deepEqual([...teeth.normals.slice(v * 3, v * 3 + 3)], [0, 0, 1]);
  }
  [0.2, 0.4, 1].forEach((value, v) => assert.ok(Math.abs(teeth.occlusion[v] - value) < 1e-6));
});

test("an expression moves the mouth with the jaw, and the dark in it with the mouth", () => {
  const template = withFaces(withHead([sheet()]), mouthFaces());
  const [skin, teeth] = withExpression(template, "smile").submeshes;
  for (let v = 0; v < 3; v += 1) assert.ok(Math.abs(teeth.positions[v * 3 + 1] - template.submeshes[1].positions[v * 3 + 1] - 0.001) < 1e-9);
  assert.deepEqual([...teeth.occlusion], [0, 0, 1]);
  assert.deepEqual([...skin.cavity.vertices], [4, 9]);
  assert.deepEqual([...skin.cavity.shade], [64, 64]);
  // The cut stays cut.
  assert.equal(skin.indices, template.submeshes[0].indices);
});

test("the dark of the mouth comes out of the skin's occlusion, where there is skin to take it from", () => {
  const occlusion = Float32Array.from([1, 0.5, 0.8]);
  assert.equal(inMouth(occlusion, { vertices: [1, 2, 7], shade: Uint8Array.from([51, 255, 0]) }), occlusion);
  assert.ok(Math.abs(occlusion[0] - 1) < 1e-6 && Math.abs(occlusion[1] - 0.1) < 1e-6 && Math.abs(occlusion[2] - 0.8) < 1e-6);
  assert.equal(inMouth(occlusion, null), occlusion);
});

test("normals are the authored ones plus the turn the move made, so a shape that did not move keeps its own", () => {
  const skin = sheet();
  // Authored normals that are not the facets': the scan's are smoothed.
  skin.normals = skin.normals.map((value, i) => (i % 3 === 0 ? 0.3 : value));
  const still = movedNormals(skin, skin.positions, new Uint8Array(10).fill(1));
  for (let i = 0; i < still.length; i += 1) assert.ok(Math.abs(still[i] - skin.normals[i] / Math.hypot(0.3, 1)) < 1e-6, `${i}`);
});

test("scenes keep a known expression, drop an unknown one with a note, and the parser reads faces from words", () => {
  const checked = validateScene({ actors: [{ posture: "standing", expression: "smile" }, { posture: "standing", expression: "grin" }] });
  assert.equal(checked.scene.actors[0].expression, "smile");
  assert.equal(checked.scene.actors[1].expression, undefined);
  assert.ok(checked.issues.some((issue) => /unknown expression "grin"/.test(issue.message)));

  const faces = (text) => Object.fromEntries(parseDescription(text).scene.actors.map((a) => [a.id, a.expression]));
  assert.deepEqual(faces("a woman kissing a man, standing"), { female: "kiss", male: "kiss" });
  assert.deepEqual(faces("he is kissing her neck, she is on her back"), { male: "kiss", female: undefined });
  assert.deepEqual(faces("a smiling woman on her back, a man kneeling"), { female: "smile", male: undefined });
  assert.deepEqual(faces("她闭着眼躺着，他跪着"), { female: "closed", male: undefined });
  // Said outright, it wins over the kiss.
  assert.deepEqual(faces("a laughing woman kissing a man"), { female: "laugh", male: "kiss" });
});

test("the template cache puts the face on last, and keys it", async () => {
  const seen = [];
  const get = createTemplateCache(async (bodyType) => ({ bodyType }), {
    relieve: (scan) => scan,
    dress: (shape) => ({ ...shape }),
    addHair: (template) => ({ ...template, hair: true }),
    express: (template, expression) => {
      seen.push([template.hair, expression]);
      return { ...template, expression };
    },
  });
  assert.equal((await get({ bodyType: "female" })).expression, DEFAULT_EXPRESSION);
  assert.equal((await get({ bodyType: "female", expression: "kiss" })).expression, "kiss");
  assert.equal((await get({ bodyType: "female", expression: "grimace" })).expression, DEFAULT_EXPRESSION);
  assert.deepEqual(seen, [
    [true, DEFAULT_EXPRESSION],
    [true, "kiss"],
  ]);
});

const FACES = new URL("../assets/models/faces/", import.meta.url);
const baked = existsSync(FACES);

test("every body's faces fit its scan, and each expression moves only the face, and not far", { skip: !baked && "no faces baked" }, () => {
  const asset = (path) => readFileSync(new URL(`../assets/models/${path}`, import.meta.url));
  const cards = readCards(asset("hair/cards.bin"));
  const posed = EXPRESSION_NAMES.filter((name) => Object.keys(EXPRESSIONS[name]).length);
  for (const bodyType of ["female", "male", "neutral"])
    for (const model of BODY_MODEL_NAMES) {
      const { mesh } = modelFiles(bodyType, model);
      const faces = readCards(readFileSync(new URL(`faces-${mesh}.bin`, FACES)));
      assert.equal(faces.meta.body, mesh);
      assert.deepEqual(faces.meta.expressions, posed, mesh);
      const bytes = asset(`realistic-${mesh}.glb`);
      const scanned = buildHumanTemplate(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const template = withFaces(scanned, faces);
      const body = template.submeshes.find((submesh) => submesh.primary);
      let top = -Infinity;
      for (let v = 0; v < body.positions.length / 3; v += 1) top = Math.max(top, body.positions[v * 3 + 1]);
      for (const [trim, count] of Object.entries(faces.meta.trims)) assert.equal(count, cards.meta.trims[trim].vertices, `${mesh} ${trim}`);
      for (const name of posed) {
        const vertices = faces.arrays[`${name}.body.vertices`];
        const offsets = faces.arrays[`${name}.body`];
        assert.ok(vertices.length > 50, `${mesh} ${name} moves ${vertices.length} vertices`);
        let far = 0;
        vertices.forEach((vertex, i) => {
          // Everything that moves is on the head, or under the chin a jaw
          // drops: the top fifth of the body.
          assert.ok(body.positions[vertex * 3 + 1] > top * 0.8, `${mesh} ${name} moves vertex ${vertex}, below the head`);
          far = Math.max(far, Math.hypot(offsets[i * 3], offsets[i * 3 + 1], offsets[i * 3 + 2]) * FACE_STEP);
        });
        // Under two centimetres on a figure a unit tall, which is the chin of
        // a laugh: an expression is the face moving, not the head changing
        // shape.
        assert.ok(far < 0.011, `${mesh} ${name} moves a vertex ${(far * 1720).toFixed(1)}mm`);
      }
      // The inside of the mouth, in the mouth, and a fine body's lips cut open
      // in front of it along the row they are joined by and no more.
      const fine = mesh.endsWith("-fine");
      assert.deepEqual(Object.keys(faces.meta.mouth), fine ? ["gums", "teeth", "tongue", "lining"] : ["gums", "teeth", "tongue"], mesh);
      for (const part of template.submeshes.filter((submesh) => submesh.mouth)) {
        const count = part.positions.length / 3;
        assert.equal(part.occlusion.length, count, `${mesh} ${part.name}`);
        assert.ok(part.occlusion.every((value) => value >= 0 && value <= 1), `${mesh} ${part.name}`);
        // Between the chin and the nose: a little over a tenth of the figure
        // down from the crown.
        for (let v = 0; v < count; v += 1) {
          const y = part.positions[v * 3 + 1] / top;
          assert.ok(y > 0.86 && y < 0.92, `${mesh} ${part.name} vertex ${v} at ${y.toFixed(3)} of the height`);
        }
      }
      const cut = faces.arrays["body.cut"]?.length ?? 0;
      assert.ok(fine ? cut > 50 && cut < 300 : cut === 0, `${mesh} cuts ${cut} triangles`);
      assert.equal(body.indices.length, scanned.submeshes.find((submesh) => submesh.primary).indices.length - cut * 3, mesh);
    }
});

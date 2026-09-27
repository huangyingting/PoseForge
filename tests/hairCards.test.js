import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildHumanTemplate } from "../src/core/humanMesh.js";
import { CARD_BOX, cardSubmesh, headCentre, packCards, readCards, withCards } from "../src/core/hairCards.js";
import { DEFAULT_HAIR, FACE_TRIMS, HAIR_STYLES, withHair } from "../src/core/hair.js";
import { BODY_MODEL_NAMES, modelFiles } from "../src/core/bodyModels.js";
import { BUILTIN_PRESETS, checkScene } from "../src/core/catalog.js";
import { solveScene } from "../src/core/solver.js";
import { createSurfaceContactQuery, measureRenderedSupports } from "../src/core/surfaceContacts.js";

const asset = (path) => readFileSync(new URL(`../assets/models/${path}`, import.meta.url));
const shared = readCards(asset("hair/cards.bin"));
const bodies = new Map();
function body(mesh) {
  if (!bodies.has(mesh)) {
    const bytes = asset(`realistic-${mesh}.glb`);
    const template = buildHumanTemplate(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    bodies.set(mesh, withCards(template, shared, readCards(asset(`hair/cards-${mesh}.bin`))));
  }
  return bodies.get(mesh);
}

test("the container round-trips every array type it stores, aligned, and refuses what it did not write", () => {
  const arrays = {
    a: Uint8Array.from([1, 2, 3]),
    b: Uint16Array.from([65535, 7]),
    c: Int16Array.from([-32767, 32767, 0]),
    d: Uint32Array.from([4_000_000_000]),
    e: Float32Array.from([Math.PI]),
  };
  const bytes = packCards({ body: "x", trims: { t: 3 } }, arrays);
  assert.equal(bytes.length % 4, 0);
  const { meta, arrays: read } = readCards(bytes);
  assert.deepEqual(meta, { body: "x", trims: { t: 3 }, version: 1 });
  for (const [name, array] of Object.entries(arrays)) {
    assert.equal(read[name].constructor, array.constructor, name);
    assert.deepEqual([...read[name]], [...array], name);
    assert.equal(read[name].byteOffset % 4, 0, name);
  }
  assert.throws(() => packCards({}, { f: new Float64Array(1) }), /cannot store/);
  assert.throws(() => readCards(new Uint8Array(16)), /not a hair-card file/);
  assert.throws(() => readCards(bytes.subarray(0, 4)), /not a hair-card file/);
  const future = bytes.slice();
  const header = new TextDecoder().decode(future.subarray(8, 8 + new DataView(future.buffer).getUint32(4, true)));
  future.set(new TextEncoder().encode(header.replace('"version":1', '"version":2')), 8);
  assert.throws(() => readCards(future), /version 2, expected 1/);
});

test("every body has every trim, with the vertex count the shared topology expects", () => {
  for (const bodyType of ["female", "male", "neutral"])
    for (const model of BODY_MODEL_NAMES) {
      const { mesh } = modelFiles(bodyType, model);
      const fitted = readCards(asset(`hair/cards-${mesh}.bin`));
      assert.equal(fitted.meta.body, mesh);
      for (const [name, trim] of Object.entries(shared.meta.trims)) {
        assert.equal(fitted.meta.trims[name], trim.vertices, `${mesh} ${name}`);
        assert.equal(fitted.arrays[`${name}.positions`].length, trim.vertices * 3, `${mesh} ${name}`);
      }
    }
  const template = body("female");
  const short = readCards(packCards({ body: "broken", trims: { ...readCards(asset("hair/cards-female.bin")).meta.trims, long01: 1 } }, {}));
  assert.throws(() => withCards(template, shared, short), /1 vertices for long01/);
});

test("every style and face trim named in hair.js is one the cards carry", () => {
  for (const [style, entry] of Object.entries(HAIR_STYLES)) {
    if (!entry) continue;
    assert.ok(shared.meta.trims[entry.cards], `${style} -> ${entry.cards}`);
    assert.equal(shared.meta.trims[entry.cards].kind, "hair", style);
  }
  for (const [bodyType, { brows, lashes }] of Object.entries(FACE_TRIMS)) {
    assert.equal(shared.meta.trims[brows]?.kind, "eyebrows", bodyType);
    assert.equal(shared.meta.trims[lashes]?.kind, "eyelashes", bodyType);
  }
});

test("a card submesh is skinnable, faces out of the head, and sits on the body it was fitted to", () => {
  for (const mesh of ["female", "male-african"]) {
    const template = body(mesh);
    const centre = headCentre(template);
    const skin = template.submeshes.find((submesh) => submesh.primary).positions;
    for (const trim of Object.keys(shared.meta.trims)) {
      const part = cardSubmesh(template, trim, { name: trim, colour: [0.1, 0.1, 0.1] });
      const count = part.positions.length / 3;
      assert.equal(part.uvs.length, count * 2);
      assert.equal(part.joints.length, count * 4);
      assert.ok(part.positions.every(Number.isFinite) && part.normals.every(Number.isFinite), trim);
      assert.ok(part.uvs.every((value) => value >= 0 && value <= 1), trim);
      for (let v = 0; v < count; v += 1) {
        let total = 0;
        for (let k = 0; k < 4; k += 1) {
          total += part.weights[v * 4 + k];
          assert.ok(part.joints[v * 4 + k] < template.joints.length, trim);
        }
        assert.ok(Math.abs(total - 1) < 1e-6, `${trim} vertex ${v} weighs ${total}`);
        const length = Math.hypot(part.normals[v * 3], part.normals[v * 3 + 1], part.normals[v * 3 + 2]);
        assert.ok(Math.abs(length - 1) < 1e-5, trim);
        for (let axis = 0; axis < 3; axis += 1) {
          const p = part.positions[v * 3 + axis];
          assert.ok(p >= CARD_BOX.min[axis] && p <= CARD_BOX.max[axis], trim);
        }
      }
      // Wound to face out of the head, which is what lets a two-sided
      // renderer tell the outside of a strip from the inside.
      let outward = 0;
      for (let i = 0; i < part.indices.length; i += 3) {
        const [a, b, c] = [part.indices[i], part.indices[i + 1], part.indices[i + 2]].map((v) => part.positions.subarray(v * 3, v * 3 + 3));
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        const o = [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3 - centre[k]);
        if (n[0] * o[0] + n[1] * o[1] + n[2] * o[2] >= 0) outward += 1;
      }
      assert.equal(outward, part.indices.length / 3, `${trim} on ${mesh}`);

      // Brows lie on the skin and lashes grow off the lid: every vertex within
      // 6mm of it, or 12mm for a lash's tip, on a 1.7m figure. Fitted to some
      // other face they would float off this one by centimetres.
      const reach = { eyebrows: 0.006, eyelashes: 0.012 }[shared.meta.trims[trim].kind];
      if (reach) {
        for (let v = 0; v < count; v += 1) {
          let best = Infinity;
          for (let s = 0; s < skin.length; s += 3) {
            const d = (skin[s] - part.positions[v * 3]) ** 2 + (skin[s + 1] - part.positions[v * 3 + 1]) ** 2 + (skin[s + 2] - part.positions[v * 3 + 2]) ** 2;
            if (d < best) best = d;
          }
          assert.ok(Math.sqrt(best) * 1.7 < reach, `${trim} on ${mesh} vertex ${v} is ${(Math.sqrt(best) * 1700).toFixed(1)}mm off the skin`);
        }
      } else {
        // Hair starts on the head: its highest point is within a few
        // centimetres of the crown.
        let top = -Infinity;
        for (let v = 0; v < count; v += 1) top = Math.max(top, part.positions[v * 3 + 1]);
        assert.ok(top > 0.99 && top < 1.04, `${trim} on ${mesh} tops out at ${top}`);
      }
    }
  }
});

test("withHair puts the style's cards and the body type's brows and lashes on a template that carries cards", () => {
  const template = body("female");
  const names = (t) => t.submeshes.slice(template.submeshes.length).map((submesh) => submesh.name);
  assert.deepEqual(names(withHair(template, { bodyType: "female" })), ["brows", "lashes", `hair-${DEFAULT_HAIR.female}`]);
  assert.deepEqual(names(withHair(template, { bodyType: "male", style: "braid" })), ["brows", "lashes", "hair-braid"]);
  const bald = withHair(template, { bodyType: "female", style: "none" });
  assert.deepEqual(names(bald), ["brows", "lashes"]);
  for (const part of withHair(template, { bodyType: "female", style: "long" }).submeshes.slice(template.submeshes.length)) {
    assert.equal(part.hair, true);
    assert.ok(part.cards.gain > 0);
    assert.ok(shared.meta.trims[part.cards.texture]);
  }

  // Without cards it is the shell, and nothing on the face.
  const { cards, ...plain } = template;
  assert.equal(cards.shared, shared);
  const shell = withHair(plain, { bodyType: "female" });
  assert.deepEqual(names(shell), [`hair-${DEFAULT_HAIR.female}`]);
  assert.equal(shell.submeshes.at(-1).cards, undefined);
});

test("cards are drawn, and the shell under them is what the contact queries measure", () => {
  // Measured as solid, a bob's cards hold a supine head a centimetre off the
  // bed and a partner's short cards cross her hip, and the head-to-toe pair
  // loses its guided placement to both. So a carded figure is measured as the
  // same figure with the shell would be, to the micrometre.
  const spec = structuredClone(BUILTIN_PRESETS.find((p) => p.id === "builtin.named.sixty_nine").scene);
  const solved = solveScene(checkScene(spec));
  const dressed = (plain) =>
    solved.actors.map((actor) => {
      const { mesh } = modelFiles(actor.spec.bodyType, actor.spec.model);
      const template = body(mesh);
      const { cards, ...without } = template;
      return withHair(plain ? without : template, { bodyType: actor.spec.bodyType, style: actor.spec.hair });
    });
  const [carded, shelled] = [dressed(false), dressed(true)];
  for (const [k, template] of carded.entries()) {
    assert.ok(template.submeshes.some((part) => part.cards), "the cards are drawn");
    assert.ok(!template.submeshes.includes(template.hairShell), "the shell is not");
    assert.deepEqual(template.hairShell.positions, shelled[k].submeshes.at(-1).positions);
    assert.equal(shelled[k].hairShell, undefined);
  }
  assert.equal(withHair(body("female"), { bodyType: "female", style: "none" }).hairShell, undefined);

  const measure = (templates) => {
    const query = createSurfaceContactQuery(solved.actors, templates);
    return {
      contacts: solved.contacts.map((contact) => {
        const { distance, intersects } = query(contact) ?? {};
        return { distance, intersects };
      }),
      supports: measureRenderedSupports(solved, query).map(({ gap, penetration }) => ({ gap, penetration })),
    };
  };
  assert.deepEqual(measure(carded), measure(shelled));
});

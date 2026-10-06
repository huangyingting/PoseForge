import assert from "node:assert/strict";
import test from "node:test";
import { DRESS_CODES, dressFigures } from "../src/core/dressCodes.js";
import { CUPPED, GARMENT_COLOURS, GARMENT_NAMES, resolveWearing } from "../src/core/garments.js";
import { validateScene } from "../src/core/scene.js";

const pair = [
  { bodyType: "female", wearing: ["top", "shorts"] },
  { bodyType: "male", wearing: ["briefs", "cuffs"] },
];

test("on the beach a woman wears a bikini and a man swim briefs, and a pair is not dressed alike", () => {
  const [her, him] = dressFigures("beach", pair);
  assert.deepEqual(her, { wearing: ["bikini-top", "bikini-bottom"], outfit: "red" });
  // Cuffs are no clothes the beach would change.
  assert.deepEqual(him, { wearing: ["swim-briefs", "cuffs"], outfit: "navy" });
  const two = dressFigures("pool", [{ bodyType: "female" }, { bodyType: "female" }]);
  assert.notEqual(two[0].outfit, two[1].outfit);
  assert.deepEqual(two.map((figure) => figure.wearing), [["bikini-top", "bikini-bottom"], ["bikini-top", "bikini-bottom"]]);
});

test("at the shoot it is lingerie and boxer briefs, and a body without a bust wears no cups", () => {
  const [her, them] = dressFigures("fashion", [{ bodyType: "female" }, { bodyType: "neutral", wearing: [] }]);
  assert.deepEqual(her.wearing, ["lace-bra", "lace-thong", "stockings", "garter-belt"]);
  assert.deepEqual(them.wearing, ["boxer-briefs"]);
});

test("a setting with no dress code leaves everyone in their own clothes", () => {
  for (const code of [null, undefined, "bedroom", "studio", "hotel", "toString"])
    assert.deepEqual(dressFigures(code, pair), [null, null]);
});

test("every dress code is clothes the scene would take, one to a place, in colours there are", () => {
  for (const [code, rules] of Object.entries(DRESS_CODES))
    for (const bodyType of ["female", "male", "neutral"]) {
      const figures = Array.from({ length: 4 }, () => ({ bodyType, wearing: ["cuffs"] }));
      for (const { wearing, outfit } of dressFigures(code, figures)) {
        assert.ok(wearing.every((piece) => GARMENT_NAMES.includes(piece)), `${code} ${bodyType}: ${wearing}`);
        assert.deepEqual(resolveWearing(wearing).dropped, [], `${code} ${bodyType}`);
        assert.ok(bodyType === "female" || !wearing.some((piece) => CUPPED.has(piece)), `${code} ${bodyType}`);
        assert.ok(Object.hasOwn(GARMENT_COLOURS, outfit), `${code}: ${outfit}`);
      }
      assert.equal(rules[bodyType === "female" ? "female" : "male"].colours.length, 4);
    }
  // And the scene takes them as they are, with nothing to say about them.
  const actors = dressFigures("fashion", pair).map((dress, index) => ({ ...pair[index], ...dress }));
  const { issues } = validateScene({ actors });
  assert.deepEqual(issues.filter((issue) => /wearing|colour/.test(issue.message)), []);
});

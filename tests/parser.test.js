/**
 * The text layer.
 *
 * `scripts/validate-text.mjs` already runs a corpus of whole descriptions and
 * checks what each one is read as; that is the suite that says whether the
 * vocabulary is any good. This one tests the machinery underneath it - the
 * things a corpus cannot reach because they are about *how* a sentence is read
 * rather than which sentence it is: what happens to unreadable input, how a
 * modifier finds its subject, why a turn is relative, and what the parser
 * promises to hand the solver no matter what it was given.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { parseDescription } from "../src/nlp/parser.js";
import { LEXICON, VOCABULARY } from "../src/nlp/lexicon.js";
import { ARCHETYPES } from "../src/nlp/archetypes.js";
import {
  ARRANGEMENT_NAMES,
  POSTURE_NAMES,
  SURFACE_NAMES,
  resolveArrangement,
} from "../src/core/poseLibrary.js";
import { BODY_TYPES } from "../src/core/scene.js";

const postures = (out) => out.scene.actors.map((actor) => actor.posture);
const field = (out, name) => out.interpretation.find((entry) => entry.field === name)?.value;

test("every description produces a scene the solver can accept", () => {
  // Including the ones that are not descriptions. The webapp parses on every
  // keystroke, so half-typed words and empty boxes are the common case, not
  // the edge case, and a throw here is a blank screen.
  for (const text of [
    "",
    "   ",
    "\n\n",
    null,
    undefined,
    12345,
    "qwerty zxcvbn florble",
    "!!!???...",
    "a".repeat(5000),
    "她跪在他身后",
    "standing",
    "he kneels behind her, hands on her hips",
  ]) {
    const out = parseDescription(text);
    assert.ok(out.scene.actors.length >= 1, `${JSON.stringify(text)} produced nobody`);
    for (const actor of out.scene.actors) {
      assert.ok(POSTURE_NAMES.includes(actor.posture), `unknown posture ${actor.posture}`);
      assert.ok(BODY_TYPES.includes(actor.bodyType), `unknown body type ${actor.bodyType}`);
    }
    assert.ok(SURFACE_NAMES.includes(out.scene.support.surface), "unknown surface");
    const arrangement = out.scene.relationship?.arrangement;
    if (arrangement) assert.ok(ARRANGEMENT_NAMES.includes(arrangement), `unknown ${arrangement}`);
    assert.ok(Array.isArray(out.warnings) && Array.isArray(out.interpretation));
  }
});

test("nothing understood is said out loud rather than shown as a default", () => {
  const nothing = parseDescription("");
  assert.equal(postures(nothing).length, 1);
  assert.deepEqual(postures(nothing), ["standing"]);
  assert.ok(
    nothing.warnings.some((w) => /nothing .* recognised/.test(w)),
    `expected a warning, got ${JSON.stringify(nothing.warnings)}`
  );

  // Words that were skipped are listed, so a user can tell a word the parser
  // understood from one it silently threw away.
  const junk = parseDescription("qwerty zxcvbn florble");
  const unread = junk.warnings.find((w) => w.startsWith("did not understand"));
  assert.ok(unread, `expected an unread-words warning, got ${JSON.stringify(junk.warnings)}`);
  for (const word of ["qwerty", "zxcvbn", "florble"]) {
    assert.ok(unread.includes(word), `${word} was dropped without a word about it`);
  }

  // And a sentence that was fully understood says nothing at all.
  assert.deepEqual(parseDescription("he kneels behind her, hands on her hips").warnings, []);
});

test("filler words are not reported as unread", () => {
  // "the", "is", "a" carry no meaning here, and listing them as not understood
  // would bury the one word that actually was not.
  const out = parseDescription("the woman is standing on the floor with a man");
  assert.deepEqual(out.warnings, [], `filler was flagged: ${JSON.stringify(out.warnings)}`);
});

test("a phrase still matches across punctuation and doubled spaces", () => {
  // `normalise` flattens punctuation one character at a time so offsets stay
  // aligned with the source text, which leaves a run of spaces wherever the
  // original had a comma and a space. Matching literally would read "reverse
  // cowgirl" typed with a windows line break in it as plain cowgirl - facing
  // the opposite way, with nothing to say it had happened.
  const plain = parseDescription("reverse cowgirl");
  for (const text of ["reverse  cowgirl", "reverse\r\ncowgirl", "reverse,  cowgirl"]) {
    const out = parseDescription(text);
    assert.deepEqual(postures(out), postures(plain), `${JSON.stringify(text)} read differently`);
    assert.deepEqual(
      out.scene.relationship,
      plain.scene.relationship,
      `${JSON.stringify(text)} lost the turn`
    );
    assert.deepEqual(out.warnings, [], `${JSON.stringify(text)} warned: ${out.warnings}`);
  }
});

test("the longest phrase wins over the words inside it", () => {
  // "on her back" is a posture and "back" is a body part; "on the bed" is a
  // surface and "bed" is a noun. Longest-first matching is the whole of the
  // disambiguation strategy, so it is worth pinning that it actually happens.
  const out = parseDescription("she is lying on her back on the bed");
  assert.deepEqual(postures(out), ["supine"]);
  assert.equal(out.scene.support.surface, "bed");
  assert.ok(
    !out.matched.some((m) => m.kind === "part" && m.value === "back"),
    "'back' was read as a body part inside 'on her back'"
  );
});

test("a phrase only matches on word boundaries", () => {
  // "on" is inside "front", "hip" is inside "ship", "he" is inside "shelf".
  // Without the boundary test these fire constantly on ordinary words.
  const out = parseDescription("shelf front ships");
  assert.ok(
    !out.matched.some((m) => ["on", "hip", "he"].includes(m.phrase)),
    `matched inside a word: ${JSON.stringify(out.matched)}`
  );
});

test("a turn is measured from the arrangement's own default, not from zero", () => {
  // Arrangements disagree about which way "toward" is: turning to face a
  // standing partner is half a turn, turning to face one lying on their back
  // is none at all. Reading "facing away" as a fixed 180 makes reverse cowgirl
  // mean forwards.
  const forwards = parseDescription("cowgirl");
  const reversed = parseDescription("reverse cowgirl");
  assert.deepEqual(postures(forwards), postures(reversed), "the two differ by more than the turn");
  assert.equal(forwards.scene.relationship.arrangement, reversed.scene.relationship.arrangement);

  const base = resolveArrangement(reversed.scene.relationship.arrangement).yaw ?? 180;
  assert.equal(
    reversed.scene.relationship.yaw,
    (base + 180) % 360,
    "the reverse is not a half turn from the arrangement's own default"
  );
  // Forwards is the default, so it needs no yaw of its own at all.
  assert.equal(forwards.scene.relationship.yaw, undefined);
});

test("a modifier attaches to the nearest person, in either direction", () => {
  // English puts the adjective in front of the noun, so reading backwards only
  // gives the tall man's height to the woman. Reading forwards only loses "she
  // is tall and he is short".
  const before = parseDescription("a tall man standing behind a short woman");
  const byId = Object.fromEntries(before.scene.actors.map((a) => [a.id, a]));
  assert.ok(byId.male.stature > byId.female.stature, "the heights were swapped");

  const after = parseDescription("she is short and he is tall");
  const trailing = Object.fromEntries(after.scene.actors.map((a) => [a.id, a]));
  assert.ok(trailing.male.stature > trailing.female.stature, "a trailing modifier missed its subject");
});

test("a plural body part becomes both of them", () => {
  const out = parseDescription("he kneels behind her, hands on her hips");
  const hands = out.scene.contacts.filter((c) => c.from.startsWith("hand"));
  assert.equal(hands.length, 2, `"hands" produced ${hands.length} contact(s)`);
  assert.deepEqual(hands.map((c) => c.from).sort(), ["hand.left", "hand.right"]);
  // Both are his, resting on her - not one hand on the other.
  for (const contact of hands) {
    assert.equal(contact.fromActor, 1);
    assert.equal(contact.toActor, 0);
    assert.notEqual(contact.fromActor, contact.toActor);
  }

  // A stated side is not doubled: one hand means one hand.
  const single = parseDescription("her left hand on his chest");
  const left = single.scene.contacts.filter((c) => c.from.startsWith("hand"));
  assert.equal(left.length, 1, `"her left hand" produced ${left.length} contacts`);
  assert.equal(left[0].from, "hand.left");
});

test("a contact never has both ends on the same person", () => {
  // The solver cannot pose a body against itself, and "he kneels behind her,
  // hands on her hips" reads the hands as hers if the subject is taken from
  // the nearest preceding mention alone.
  for (const text of [
    "he kneels behind her, hands on her hips",
    "she is on her back, her hands on his shoulders",
    "standing, facing each other, her hands on his chest",
    "a woman sitting on his lap, arms around his neck",
  ]) {
    const out = parseDescription(text);
    for (const contact of out.scene.contacts) {
      assert.notEqual(
        contact.fromActor,
        contact.toActor,
        `${JSON.stringify(text)}: ${contact.from} touches ${contact.to} on the same body`
      );
      assert.ok(contact.fromActor >= 0 && contact.fromActor < out.scene.actors.length);
      assert.ok(contact.toActor >= 0 && contact.toActor < out.scene.actors.length);
    }
  }
});

test("one person stated means one person rendered", () => {
  assert.equal(parseDescription("she is standing").scene.actors.length, 1);
  assert.equal(parseDescription("kneeling").scene.actors.length, 1);
  // But anything that needs a partner brings one, even unnamed: an arrangement
  // with nobody to be arranged against is not a scene.
  assert.equal(parseDescription("she is standing behind him").scene.actors.length, 2);
  assert.equal(parseDescription("spooning").scene.actors.length, 2);
  assert.equal(parseDescription("sitting on his lap").scene.actors.length, 2);
});

test("a posture phrase that names the other person implies the arrangement too", () => {
  // Somebody sitting on someone's lap is, by saying so, straddling their lap.
  // Read as a posture alone it leaves the pair standing face to face.
  const out = parseDescription("a slim woman sitting on his lap");
  assert.equal(out.scene.relationship.arrangement, "straddle_lap");
  const woman = out.scene.actors.find((a) => a.bodyType === "female");
  assert.ok(Math.abs(woman.build - 0.85) < 1e-9, `slim read as build ${woman.build}`);
});

test("the interpretation explains every field it filled in", () => {
  const out = parseDescription("missionary on the bed");
  // Anything the parser decided has to be visible to the user, whether it came
  // from the words or from a default, or there is no way to tell a reading
  // from a guess.
  assert.equal(field(out, "archetype"), "missionary");
  assert.equal(field(out, "surface"), "bed");
  assert.ok(field(out, "arrangement"), "the arrangement was not reported");
  for (const entry of out.interpretation) {
    assert.ok(typeof entry.field === "string" && entry.field.length > 0);
    assert.ok("value" in entry && "phrase" in entry);
  }
  // A field with no phrase behind it is a guess, and must say why.
  for (const entry of out.interpretation) {
    if (entry.phrase == null && entry.field.endsWith(".posture")) {
      assert.ok(entry.note, `${entry.field} was assumed with no explanation`);
    }
  }

  // A posture nobody stated is reported as assumed, not as read.
  const guessed = parseDescription("spooning");
  const assumed = guessed.interpretation.filter((e) => e.field.endsWith(".posture"));
  assert.ok(assumed.length >= 2, "the postures were not reported");
});

test("being bent over something supplies the something", () => {
  // A posture can need a prop that the sentence never mentions. Without one the
  // figure is bent over thin air.
  const out = parseDescription("she is bent over");
  if (out.scene.actors.some((a) => a.posture === "bent_over_support")) {
    assert.notEqual(out.scene.support.surface, "floor", "bent over nothing at all");
  }
  const stated = parseDescription("she is bent over the table");
  assert.equal(stated.scene.support.surface, "table");
});

test("parsing is a pure function of the text", () => {
  // The scanner keeps a compiled matcher per lexicon entry, which is shared
  // state across calls; a regex left with a stale `lastIndex` would make the
  // second parse of the same sentence differ from the first.
  const text = "a tall man standing behind a short woman bent over the table";
  const once = parseDescription(text);
  const twice = parseDescription(text);
  assert.deepEqual(twice.scene, once.scene);
  assert.deepEqual(twice.warnings, once.warnings);
  assert.deepEqual(twice.matched, once.matched);

  // And earlier parses cannot leak into later ones.
  parseDescription("cowgirl");
  parseDescription("");
  assert.deepEqual(parseDescription(text).scene, once.scene);
});

test("the lexicon only speaks of things the pose library has", () => {
  // A vocabulary entry naming a posture that does not exist is a phrase that
  // parses cleanly and then renders as nothing.
  for (const entry of LEXICON) {
    if (entry.kind === "posture") {
      assert.ok(POSTURE_NAMES.includes(entry.value), `"${entry.phrase}" -> unknown posture ${entry.value}`);
    }
    if (entry.kind === "arrangement") {
      assert.ok(
        ARRANGEMENT_NAMES.includes(entry.value),
        `"${entry.phrase}" -> unknown arrangement ${entry.value}`
      );
    }
    if (entry.kind === "surface") {
      assert.ok(SURFACE_NAMES.includes(entry.value), `"${entry.phrase}" -> unknown surface ${entry.value}`);
    }
    assert.equal(entry.phrase, entry.phrase.toLowerCase(), `"${entry.phrase}" is not lowercase`);
    assert.equal(entry.phrase.trim(), entry.phrase, `"${entry.phrase}" has loose whitespace`);
  }
  // The UI offers `VOCABULARY` as "what it understands", so it must be the
  // same set the scanner actually looks for.
  for (const value of VOCABULARY.posture ?? []) {
    assert.ok(POSTURE_NAMES.includes(value), `the UI offers unknown posture ${value}`);
  }
});

test("every archetype names parts that exist and parses back to itself", () => {
  for (const archetype of ARCHETYPES) {
    assert.ok(archetype.actors.length >= 1, `${archetype.id} has nobody in it`);
    for (const actor of archetype.actors) {
      assert.ok(POSTURE_NAMES.includes(actor.posture), `${archetype.id}: unknown posture ${actor.posture}`);
      if (actor.bodyType) {
        assert.ok(BODY_TYPES.includes(actor.bodyType), `${archetype.id}: unknown body ${actor.bodyType}`);
      }
    }
    if (archetype.arrangement) {
      assert.ok(
        ARRANGEMENT_NAMES.includes(archetype.arrangement),
        `${archetype.id}: unknown arrangement ${archetype.arrangement}`
      );
    }
    if (archetype.surface) {
      assert.ok(SURFACE_NAMES.includes(archetype.surface), `${archetype.id}: unknown surface ${archetype.surface}`);
    }
    // Every phrase it declares has to actually reach it. The id is a slug, not
    // a phrase - "bent_over_table" is said as "bent over the table" - so what
    // matters is that the words it claims to answer to really do.
    assert.ok(archetype.phrases?.length, `${archetype.id} has no phrases`);
    for (const phrase of archetype.phrases) {
      assert.equal(
        field(parseDescription(phrase), "archetype"),
        archetype.id,
        `"${phrase}" does not reach ${archetype.id}`
      );
    }
  }
});

test("Chinese is read without needing spaces", () => {
  const out = parseDescription("她跪在他身后");
  assert.equal(out.scene.actors.length, 2);
  assert.equal(out.scene.relationship.arrangement, "rear_alignment");
  assert.deepEqual(out.warnings, [], `unread: ${JSON.stringify(out.warnings)}`);
  const byId = Object.fromEntries(out.scene.actors.map((a) => [a.id, a]));
  assert.ok(byId.female && byId.male, "the two people were not identified");
});

test("a Chinese sentence reports only the characters no phrase read", () => {
  // Chinese runs on without spaces, so one run holds words that were read and
  // words that were not; only the second kind is unread.
  for (const text of ["一个女人坐在椅子上", "两个人面对面站着", "一个女人仰卧在床上，男人在她上面"])
    assert.deepEqual(parseDescription(text).warnings, [], text);
  const out = parseDescription("一个女人坐在椅子上看书");
  assert.deepEqual(out.warnings, ['did not understand: "看书"']);
  assert.equal(out.scene.support.surface, "chair");
});

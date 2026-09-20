/**
 * Text to scene.
 *
 * This turns a description into the scene IR the solver consumes, and it does
 * it deterministically: the same sentence gives the same pose every time, on
 * every machine, with no network call and nothing to warm up. That matters more
 * than breadth of understanding. A user who types a description, sees the
 * result, and adjusts a word needs the rest of the pose to stay where it was -
 * and a model that re-imagines the whole scene on every keystroke cannot give
 * them that.
 *
 * What it gives up is everything a model would be good at: novel phrasing,
 * implication, anything requiring world knowledge. The compensation is that it
 * knows what it did not understand. Every phrase it matched is reported with the
 * decision it drove, and every content word it could not place comes back as a
 * warning. So the failure mode is "I did not know what 'hammock' meant" rather
 * than a confident render of something nobody asked for - which is the same
 * principle the solver's contact reporting is built on, applied one layer up.
 *
 * The output is designed to be *edited*. `parseDescription` returns the scene
 * plus the trace that produced it, so a UI can show which phrase set which
 * field and let the user override any one of them without retyping the sentence.
 */

import { validateScene } from "../core/scene.js";
import { resolveArrangement } from "../core/poseLibrary.js";
import { ARCHETYPES_BY_ID, ARCHETYPE_ENTRIES } from "./archetypes.js";
import { FILLER, LEXICON } from "./lexicon.js";

const CJK = /[㐀-䶿一-鿿]/;
const WORDY = /[a-z0-9]/;

/**
 * Everything the scanner looks for, longest phrase first.
 *
 * Longest-first is the whole disambiguation strategy. "on her back" is a
 * posture and "back" is a body part; "hands on the bed" is a posture and "on
 * the bed" is a surface. Matching the longest phrase that fits and consuming
 * its characters means the specific reading always wins over the general one,
 * without any entry needing to know the others exist.
 */
const ENTRIES = [...ARCHETYPE_ENTRIES, ...LEXICON]
  .sort(
    (a, b) =>
      b.phrase.length - a.phrase.length ||
      (a.kind === "archetype" ? -1 : b.kind === "archetype" ? 1 : 0)
  )
  // A multi-word phrase is matched with `\s+` between its words rather than by
  // a literal search. `normalise` flattens punctuation to spaces one character
  // at a time so that offsets keep pointing into the original text, which means
  // any run of two separators inside a phrase - a windows line break pasted
  // from a document, a stray comma, a double space - leaves two spaces where
  // the phrase has one. A literal search then misses it silently: "reverse
  // cowgirl" with a doubled space read as plain cowgirl, facing the wrong way,
  // with no warning that anything had gone wrong.
  .map((entry) => ({
    ...entry,
    matcher: /\s/.test(entry.phrase)
      ? new RegExp(entry.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "g")
      : null,
  }));

/** Every place `entry` could match in `text`, earliest first and overlapping. */
function* candidates(text, entry) {
  if (entry.matcher) {
    entry.matcher.lastIndex = 0;
    for (let m = entry.matcher.exec(text); m; m = entry.matcher.exec(text)) {
      yield [m.index, m.index + m[0].length];
      // Step on by one rather than past the match, so a span that turns out to
      // be already taken does not hide a later overlapping one.
      entry.matcher.lastIndex = m.index + 1;
    }
    return;
  }
  for (let at = text.indexOf(entry.phrase); at >= 0; at = text.indexOf(entry.phrase, at + 1)) {
    yield [at, at + entry.phrase.length];
  }
}

/**
 * Lowercase and flatten punctuation to spaces, keeping every character in
 * place so a match's offsets still point into the original text.
 */
function normalise(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9㐀-䶿一-鿿]/g, " ");
}

/** Pronouns and nouns inside an already-matched phrase, e.g. the "her" in "behind her". */
function embeddedRef(phrase) {
  if (/(^|\s)(her|hers|she|woman|girl)(\s|$)/.test(phrase) || /她|女/.test(phrase)) return "female";
  if (/(^|\s)(his|him|he|man|boy)(\s|$)/.test(phrase) || /他|男/.test(phrase)) return "male";
  return null;
}

/**
 * Find every lexicon phrase in the text, longest first, each consuming its span.
 */
function scan(text) {
  const taken = new Uint8Array(text.length);
  const matches = [];
  for (const entry of ENTRIES) {
    const { matcher, ...rest } = entry;
    // A Latin phrase has to sit on word boundaries or "on" matches inside
    // "front" and "hip" inside "ship". Chinese is written without spaces, so
    // the same test would reject every correct match.
    const bounded = !CJK.test(entry.phrase);
    for (const [at, end] of candidates(text, entry)) {
      if (bounded) {
        if (at > 0 && WORDY.test(text[at - 1])) continue;
        if (end < text.length && WORDY.test(text[end])) continue;
      }
      let free = true;
      for (let i = at; i < end; i += 1) {
        if (taken[i]) {
          free = false;
          break;
        }
      }
      if (!free) continue;
      taken.fill(1, at, end);
      matches.push({ ...rest, at, end, ref: embeddedRef(entry.phrase) });
    }
  }
  matches.sort((a, b) => a.at - b.at);
  return { matches, taken };
}

/**
 * Roughly how high off the ground a posture puts the body.
 *
 * Used only to decide who is the primary when the wording does not say. For the
 * arrangements where one partner is on the other, the one underneath is the
 * primary, and "underneath" is exactly what this orders. It is a tie-breaker,
 * not a model of anything - any phrase that states the relationship outranks it.
 */
const ELEVATION = {
  supine: 0,
  supine_legs_raised: 0,
  prone: 0,
  side_lying: 0,
  inverted: 1,
  reclined: 1,
  seated_reclined: 2,
  seated: 2,
  forearms_and_knees: 2,
  seated_straddle: 3,
  all_fours: 3,
  kneeling_low: 3,
  kneeling: 4,
  kneeling_straddle: 4,
  bent_over_support: 5,
  standing_bent_forward: 5,
  standing: 6,
  lifted: 7,
};

const MOUNTED = new Set(["over_supine", "straddle_lap", "straddle_supine", "supported_lift"]);

/**
 * What each role is doing, when an arrangement is named and a posture is not.
 *
 * "He's carrying her" states the arrangement and nothing else, but it plainly
 * does not mean two people standing up next to each other. Every arrangement
 * has a configuration it obviously implies, and defaulting to it is far closer
 * to the description than defaulting to "standing" - which is only ever right
 * by accident. Anything the text does state still wins.
 */
const ARRANGEMENT_POSTURES = {
  face_to_face: ["standing", "standing"],
  rear_alignment: ["all_fours", "kneeling"],
  spooning: ["side_lying", "side_lying"],
  over_supine: ["supine", "forearms_and_knees"],
  straddle_lap: ["seated", "seated_straddle"],
  straddle_supine: ["supine", "kneeling_straddle"],
  side_by_side: ["supine", "supine"],
  behind_bent_over: ["bent_over_support", "standing"],
  supported_lift: ["standing", "lifted"],
  head_to_toe: ["supine", "prone"],
};

const STATURE = { tall: 1.85, short: 1.62 };

/**
 * Reading a limb shape back off a contact.
 *
 * The near end says which limb is being talked about; the far end says roughly
 * where it has to get to. That is enough to pick an opening pose, and it is all
 * that should be read from it - a contact is solved properly later, so these
 * only have to land the limb in the right half of the body.
 */
const ARM_PARTS = new Set(["hand", "forearm", "upperArm", "elbow"]);
const LEG_PARTS = new Set(["thigh", "knee", "shin", "ankle", "foot"]);

/**
 * Relations that name a hand without saying "hand".
 *
 * Only the grasping verbs. "Against her back" and "on her back" elide nothing -
 * whatever is against it was named earlier in the sentence or is the whole
 * body - so reading a pair of hands into those would invent a contact.
 */
const GRASPING = new Set([
  "holding", "holds", "grips", "gripping", "cupping", "grabbing", "grabs",
  "握着", "扶着", "抓着", "捧着",
]);

const ARM_SHAPE_FOR = {
  hip: "arms_on_hips",
  buttocks: "arms_on_hips",
  waist: "arms_on_hips",
  pelvis: "arms_on_hips",
  lowerBack: "arms_on_hips",
  thigh: "arms_on_thighs",
  knee: "arms_on_thighs",
  shin: "arms_on_thighs",
  ankle: "arms_on_thighs",
  foot: "arms_on_thighs",
  lap: "arms_on_thighs",
  shoulder: "arms_around",
  neck: "arms_around",
  back: "arms_around",
  upperBack: "arms_around",
  torso: "arms_around",
  chest: "arms_around",
  abdomen: "arms_around",
  head: "arms_around",
  face: "arms_around",
};

const LEG_SHAPE_FOR = {
  hip: "legs_wrapped",
  waist: "legs_wrapped",
  pelvis: "legs_wrapped",
  buttocks: "legs_wrapped",
  torso: "legs_wrapped",
  back: "legs_wrapped",
  lowerBack: "legs_wrapped",
  shoulder: "legs_raised_high",
  neck: "legs_raised_high",
};

/**
 * Interpret a description.
 *
 * @param {string} text
 * @returns {{scene: import("../core/scene.js").Scene,
 *            interpretation: Array<{field:string, value:any, phrase:string|null, note?:string}>,
 *            warnings: string[],
 *            matched: Array<{phrase:string, kind:string, value:any}>}}
 */
export function parseDescription(text) {
  const source = String(text ?? "");
  const normalised = normalise(source);
  const { matches, taken } = scan(normalised);

  const interpretation = [];
  const warnings = [];
  const say = (field, value, phrase, note) =>
    interpretation.push({ field, value, phrase: phrase ?? null, ...(note ? { note } : {}) });

  // 1. A named pose, if there is one, supplies every field as a default.
  const archetypeMatch = matches.find((m) => m.kind === "archetype");
  const base = archetypeMatch ? ARCHETYPES_BY_ID.get(archetypeMatch.value) : null;
  if (base) say("archetype", base.id, archetypeMatch.phrase, base.label);

  // 2. Who is being talked about, in the order they are first named. A phrase
  //    like "behind her" introduces her just as much as a bare "she" does.
  const identityOrder = [];
  for (const match of matches) {
    const id = match.kind === "ref" ? match.value : match.ref;
    if (!id || id === "both" || identityOrder.includes(id)) continue;
    identityOrder.push(id);
  }

  const arrangementMatch = matches.find((m) => m.kind === "arrangement");
  // A posture phrase that names the other person describes an arrangement as
  // well as a posture: somebody sitting on someone's lap is, by saying so,
  // straddling their lap. Taking it only as a posture throws that away and
  // leaves the pair standing face to face instead.
  const impliedMatch = matches.find((m) => m.implies);
  const arrangementId =
    arrangementMatch?.value ?? base?.arrangement ?? impliedMatch?.implies ?? null;
  const pairish = Boolean(base || arrangementId || identityOrder.length > 1);
  const actorCount = pairish ? 2 : 1;
  while (identityOrder.length < actorCount) {
    // Somebody is clearly present - the arrangement needs two - but was never
    // named. Give them an identity so the rest of the pass has something to
    // attach postures to.
    identityOrder.push(identityOrder.includes("first") ? "second" : "first");
  }

  // 3. Which identity is the primary - the partner the other is placed against.
  //    Wrong here and the render is inside out: the person on the bed ends up
  //    under the floor with their partner lying on nothing.
  const slots = new Map();
  const assign = (identity, slot) => {
    if (slots.has(identity)) return;
    for (const [other, taken2] of slots) if (taken2 === slot && other !== identity) return;
    slots.set(identity, slot);
  };

  let slotReason = null;
  if (base) {
    // The archetype says which role each body type plays.
    base.actors.forEach((spec, index) => {
      if (spec.bodyType && identityOrder.includes(spec.bodyType)) assign(spec.bodyType, index);
    });
    if (slots.size) slotReason = `the roles in ${base.id}`;
  }
  if (slots.size < actorCount && arrangementMatch?.ref) {
    // "behind her" names the fixed partner; "carrying her" names the moving one.
    const role = arrangementMatch.namedRole ?? 0;
    assign(arrangementMatch.ref, role);
    slotReason = `"${arrangementMatch.phrase}"`;
  }
  if (slots.size < actorCount && impliedMatch?.ref && impliedMatch.otherRef) {
    // "sitting on his lap" says the same thing a preposition would: he is the
    // one being sat on, so he is the one the other is placed against.
    assign(impliedMatch.ref, impliedMatch.namedRole ?? 0);
    slotReason = `"${impliedMatch.phrase}"`;
  }

  // 4. Postures, attached to whoever the sentence was about at that point.
  //    A posture phrase that contains a pronoun ("on her back") is reflexive:
  //    it names its own subject, and that subject carries forward to the
  //    phrases after it.
  const postureFor = new Map();
  const explicitPosture = new Map();
  let subject = null;
  const subjectAt = [];
  for (const match of matches) {
    subjectAt.push(subject);
    if (match.kind === "ref" && match.value !== "both") subject = match.value;
    else if (match.kind === "posture" && match.ref && !match.otherRef) subject = match.ref;
  }
  matches.forEach((match, index) => {
    if (match.kind !== "posture") return;
    const owner = (match.otherRef ? null : match.ref) ?? subjectAt[index] ?? null;
    if (owner) {
      postureFor.set(owner, match);
      explicitPosture.set(owner, match);
    } else {
      // Nobody named. Fill the first identity still without one.
      const free = identityOrder.find((id) => !postureFor.has(id));
      if (free) postureFor.set(free, match);
    }
  });

  // Fall back to elevation for the mounted arrangements, where the one lower
  // down is the one underneath by definition.
  if (slots.size < actorCount && actorCount === 2 && MOUNTED.has(arrangementId)) {
    const [a, b] = identityOrder;
    const heightOf = (id) => ELEVATION[postureFor.get(id)?.value] ?? null;
    const ha = heightOf(a);
    const hb = heightOf(b);
    if (ha != null && hb != null && ha !== hb) {
      assign(ha < hb ? a : b, 0);
      slotReason = "whoever the postures put underneath";
    }
  }
  // Otherwise the order they were mentioned in - but into whatever slots are
  // still free, not into the slot matching their position. Someone named first
  // whose partner has already been pinned to slot 0 by the wording goes to slot
  // 1; dropping them for not fitting is how a person disappears from the scene.
  for (const id of identityOrder) {
    if (slots.has(id)) continue;
    const used = new Set(slots.values());
    const free = [...Array(actorCount).keys()].find((slot) => !used.has(slot));
    if (free != null) slots.set(id, free);
  }
  if (!slotReason && actorCount === 2) slotReason = "the order they were mentioned in";
  if (slotReason && actorCount === 2) {
    const ordered = [...slots.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id);
    say("order", ordered, null, `primary chosen by ${slotReason}`);
  }

  // 5. Per-person modifiers.
  //
  //    These attach to the nearest person mentioned in either direction, not to
  //    whoever the sentence was last about. English puts the adjective in front
  //    of the noun - "a tall man behind a short woman" - so reading backwards
  //    only would give the tall man's height to the woman and the short woman's
  //    to nobody. Nearest-either-way gets both that and "she is tall and he is
  //    short", where the modifier trails its subject.
  const buildFor = new Map();
  const statureFor = new Map();
  const armsFor = new Map();
  const legsFor = new Map();
  const refPositions = matches
    .map((m, index) => ({ index, at: m.at, id: m.kind === "ref" ? m.value : m.ref }))
    .filter((entry) => entry.id && entry.id !== "both");
  const nearestPerson = (match, index) => {
    let best = null;
    for (const entry of refPositions) {
      const gap =
        entry.at >= match.end ? entry.at - match.end : match.at - matches[entry.index].end;
      if (gap < 0) continue;
      if (!best || gap < best.gap) best = { id: entry.id, gap };
    }
    return best?.id ?? subjectAt[index] ?? identityOrder[0];
  };
  const MODIFIER_BINS = { build: buildFor, stature: statureFor, arms: armsFor, legs: legsFor };
  matches.forEach((match, index) => {
    const bin = MODIFIER_BINS[match.kind];
    if (!bin) return;
    const owner = nearestPerson(match, index);
    if (owner) bin.set(owner, match);
  });

  // 6. Assemble the people.
  const implied = ARRANGEMENT_POSTURES[arrangementId] ?? [];
  const defaultPosture = (slot) => base?.actors?.[slot]?.posture ?? implied[slot] ?? "standing";
  const actors = new Array(actorCount);
  for (const [identity, slot] of slots) {
    if (slot >= actorCount) continue;
    const fallback = base?.actors?.[slot] ?? {};
    const stated = postureFor.get(identity);
    const posture = stated?.value ?? defaultPosture(slot);
    const bodyType =
      identity === "female" || identity === "male" ? identity : fallback.bodyType ?? "neutral";
    const spec = { id: identity, posture, bodyType };
    const build = buildFor.get(identity);
    if (build) spec.build = build.value;
    const stature = statureFor.get(identity);
    if (stature) spec.stature = STATURE[stature.value];
    const armShape = armsFor.get(identity);
    if (armShape) spec.arms = armShape.value;
    const legShape = legsFor.get(identity);
    if (legShape) spec.legs = legShape.value;
    actors[slot] = spec;

    say(
      `${identity}.posture`,
      posture,
      stated?.phrase ?? null,
      stated ? undefined : `assumed from ${arrangementId ? `being ${arrangementId}` : "nothing stated"}`
    );
    if (build) say(`${identity}.build`, build.value, build.phrase);
    if (stature) say(`${identity}.stature`, spec.stature, stature.phrase);
    if (armShape) say(`${identity}.arms`, armShape.value, armShape.phrase);
    if (legShape) say(`${identity}.legs`, legShape.value, legShape.phrase);
  }
  for (let i = 0; i < actorCount; i += 1) {
    if (!actors[i]) {
      actors[i] = {
        id: `actor${i}`,
        posture: defaultPosture(i),
        bodyType: base?.actors?.[i]?.bodyType ?? "neutral",
      };
    }
  }

  // 7. Arrangement and facing.
  if (arrangementId) {
    say("arrangement", arrangementId, arrangementMatch?.phrase ?? archetypeMatch?.phrase ?? null);
  } else if (actorCount > 1) {
    say("arrangement", "face_to_face", null, "assumed: two people with no stated arrangement");
  }

  // "Facing away" is a half turn from whatever the arrangement already does,
  // not a fixed number of degrees. The two are the same thing only while every
  // arrangement shares one default, and they do not: turning to face a standing
  // partner is half a turn, turning to face one lying on their back is none.
  // Reading it as an absolute would make "reverse cowgirl" mean forwards.
  let yaw = base?.yaw;
  const facingMatch = matches.find((m) => m.kind === "facing");
  // An archetype can declare the turn as part of what it is - that is the whole
  // of what makes reverse cowgirl reverse - and a phrase in the sentence
  // overrides it, the same as any other archetype field.
  const turn = facingMatch?.value ?? base?.facing ?? null;
  if (turn && actorCount > 1) {
    const defaultYaw = resolveArrangement(arrangementId)?.yaw ?? 180;
    const current = yaw ?? defaultYaw;
    const turned = turn === "away" ? (defaultYaw + 180) % 360 : defaultYaw;
    if (turned !== current) {
      yaw = turned;
      say("facing", turn, facingMatch?.phrase ?? archetypeMatch?.phrase ?? null,
        `turned to ${turned} degrees`);
    }
  }

  // 8. What they are on. A posture can imply one - somebody bent over a support
  //    needs something to be bent over - but anything said outright wins.
  const surfaceMatch = matches.find((m) => m.kind === "surface");
  let surface = surfaceMatch?.value ?? base?.surface;
  if (!surface && actors.some((a) => a.posture === "bent_over_support")) {
    surface = "table";
    say("surface", surface, null, "assumed: being bent over something needs something to lean on");
  } else if (surface) {
    say("surface", surface, surfaceMatch?.phrase ?? archetypeMatch?.phrase ?? null);
  }

  // 9. Contacts: "<part> <relation> [whose] <part>".
  const contacts = [];
  const consumed = new Set();
  const slotOf = (identity) => slots.get(identity) ?? null;
  for (let i = 0; i < matches.length; i += 1) {
    const a = matches[i];
    if (a.kind !== "part") continue;
    const rel = matches[i + 1];
    if (rel?.kind !== "relation" || rel.at - a.end > 16) continue;
    let j = i + 2;
    let toIdentity = null;
    if (matches[j]?.kind === "ref" && matches[j].value !== "both") {
      toIdentity = matches[j].value;
      j += 1;
    }
    let toSide = null;
    if (matches[j]?.kind === "side") {
      toSide = matches[j].value;
      j += 1;
    }
    const b = matches[j];
    if (b?.kind !== "part" || b.at - rel.end > 30) continue;

    const fromIdentity = subjectAt[i] ?? identityOrder[0];
    let fromSlot = slotOf(fromIdentity);
    let toSlot = toIdentity ? slotOf(toIdentity) : null;
    if (toSlot == null && fromSlot != null && actorCount > 1) toSlot = fromSlot === 0 ? 1 : 0;
    if (fromSlot == null || toSlot == null) continue;
    let reassigned = false;
    if (fromSlot === toSlot) {
      // Both ends on one person. The solver cannot pose a body against itself,
      // and this is nearly always a misread subject rather than a real request:
      // in "he kneels behind her, hands on her hips" the hands are his, but the
      // nearest preceding mention is hers. The named end was said out loud and
      // the other was inferred, so the inferred one is the one to move.
      if (actorCount < 2) continue;
      fromSlot = toSlot === 0 ? 1 : 0;
      reassigned = true;
    }

    const fromSide = matches[i - 1]?.kind === "side" ? matches[i - 1].value : null;
    const contact = {
      from: fromSide ? `${a.value}.${fromSide}` : a.value,
      to: toSide ? `${b.value}.${toSide}` : b.value,
      fromActor: fromSlot,
      toActor: toSlot,
      strength: 0.7,
      type: "rest",
    };
    contacts.push(contact);
    const text2 = normalised.slice(a.at, b.end).trim();
    say(
      "contact",
      `${contact.from} to ${contact.to}`,
      text2,
      reassigned ? "read as the other partner's, since nobody touches themselves here" : undefined
    );

    // "Hands on her hips" is two hands. The plural is right there in the text
    // and rendering it as one hand resting while the other hangs loose is a
    // visibly different pose from the one described.
    if (/hands|palms|arms|shoulders|knees|feet|elbows|双手|双腿/.test(a.phrase) && !fromSide) {
      contacts[contacts.length - 1].from = `${a.value}.left`;
      contacts.push({ ...contact, from: `${a.value}.right` });
    }
    for (let k = i; k <= j; k += 1) consumed.add(k);
    i = j;
  }

  // 9a. "...holding her hips" - a grasping verb with nothing in front of it.
  //
  //     English drops the hands from these constantly: "he kneels behind her,
  //     holding her hips" has a subject, a verb and a target, and the part
  //     doing the holding is left to the reader because there is only one
  //     thing it could be. The main pattern needs a part on both ends, so
  //     these fell through it entirely and the hands stayed wherever the
  //     posture had them - which is most of what "the hands are not expressed"
  //     looked like from the outside.
  for (let i = 0; i < matches.length; i += 1) {
    if (consumed.has(i)) continue;
    const rel = matches[i];
    if (rel.kind !== "relation" || !GRASPING.has(rel.phrase)) continue;
    let j = i + 1;
    let toIdentity = null;
    if (matches[j]?.kind === "ref" && matches[j].value !== "both") {
      toIdentity = matches[j].value;
      j += 1;
    }
    const b = matches[j];
    if (b?.kind !== "part" || b.at - rel.end > 24) continue;

    const fromIdentity = subjectAt[i] ?? identityOrder[0];
    let fromSlot = slotOf(fromIdentity);
    let toSlot = toIdentity ? slotOf(toIdentity) : null;
    if (toSlot == null && fromSlot != null && actorCount > 1) toSlot = fromSlot === 0 ? 1 : 0;
    if (fromSlot == null || toSlot == null) continue;
    if (fromSlot === toSlot) {
      if (actorCount < 2) continue;
      fromSlot = toSlot === 0 ? 1 : 0;
    }
    // Both hands, always. The elided part is "his hands", not "his hand" -
    // nobody holds somebody's hips one-handed without saying so, and when they
    // do say so the main pattern has a part to match and handles it there.
    const base2 = { to: b.value, fromActor: fromSlot, toActor: toSlot, strength: 0.7, type: "rest" };
    contacts.push({ ...base2, from: "hand.left" }, { ...base2, from: "hand.right" });
    say(
      "contact",
      `hand to ${b.value}`,
      normalised.slice(rel.at, b.end).trim(),
      "the hands were left unsaid"
    );
    for (let k = i; k <= j; k += 1) consumed.add(k);
    i = j;
  }

  // 9b. The limb shape a contact implies.
  //
  //     "His hands on her hips" already says what his arms are doing, and it
  //     says it more precisely than any standalone phrase could - it names the
  //     target too. The contact is what gets solved, but the solver still needs
  //     somewhere to start from, and starting from the posture's own arms means
  //     starting with them wherever the archetype happened to leave them. So
  //     the shape is read back off the contact and used as the opening pose.
  //     Anything the sentence stated outright wins, because that was a separate
  //     clause about the same limb and it is the more specific claim.
  for (const contact of contacts) {
    const fromPart = contact.from.split(".")[0];
    const toPart = contact.to.split(".")[0];
    const spec = actors[contact.fromActor];
    if (!spec) continue;
    const limb = ARM_PARTS.has(fromPart) ? "arms" : LEG_PARTS.has(fromPart) ? "legs" : null;
    if (!limb || spec[limb]) continue;
    const shape = (limb === "arms" ? ARM_SHAPE_FOR : LEG_SHAPE_FOR)[toPart];
    if (!shape) continue;
    spec[limb] = shape;
    say(`${spec.id}.${limb}`, shape, null, `implied by ${contact.from} resting on ${contact.to}`);
  }

  // 10. What went unread. Silence here would mean the user could not tell a
  //     word that was understood from one that was skipped.
  const leftovers = [];
  const tokens = normalised.matchAll(/[a-z0-9]+|[㐀-䶿一-鿿]+/g);
  for (const token of tokens) {
    const word = token[0];
    if (taken[token.index]) continue;
    if (CJK.test(word)) {
      const unread = [...word].filter((ch) => !FILLER.has(ch)).join("");
      if (unread.length) leftovers.push(unread);
      continue;
    }
    if (word.length < 2 || FILLER.has(word)) continue;
    leftovers.push(word);
  }
  if (leftovers.length) {
    const shown = [...new Set(leftovers)].slice(0, 8);
    warnings.push(`did not understand: ${shown.map((w) => `"${w}"`).join(", ")}`);
  }
  if (!matches.length) {
    warnings.push("nothing in the description was recognised, showing a standing figure");
  }

  const draft = {
    title: source.trim().slice(0, 80) || "Untitled",
    description: source,
    support: { surface: surface || "floor" },
    relationship: arrangementId
      ? { arrangement: arrangementId, ...(yaw != null ? { yaw } : {}) }
      : {},
    actors,
    contacts: [...(base?.contacts ?? []), ...contacts],
  };

  const checked = validateScene(draft);
  for (const issue of checked.issues) warnings.push(issue.message);

  return {
    scene: checked.scene,
    interpretation,
    warnings,
    matched: matches.map((m) => ({ phrase: m.phrase, kind: m.kind, value: m.value })),
  };
}

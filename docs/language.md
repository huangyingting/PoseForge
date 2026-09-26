# Reading the description

`src/nlp/`. Turns a sentence into a scene spec. No machine learning, no
dependencies, no network — a lexicon, a scanner, and a set of attachment rules.

That choice is deliberate. The vocabulary is small and closed (21 postures, 11
arrangements, 9 surfaces), the failure mode of a statistical model here is a
confident wrong answer, and a wrong answer is indistinguishable from a right one
once it has been rendered. A lookup table can say *"I did not understand this
word"*, which is the single most useful thing this layer does.

## Shape

```
lexicon.js     735 phrases → { kind, value }
               kinds: posture(185) arrangement(97) part(116) arms(67)
                      legs(65) surface(70) ref(54) relation(36)
                      build(19) facing(13) stature(9) side(4)
               268 of those phrases are Chinese

archetypes.js  12 named positions ("missionary", "cowgirl", "spooning"),
               58 phrases between them, each expanding to
               { actors, arrangement, surface }

parser.js      normalise → scan → attach → assemble
```

## Length-preserving normalisation

```js
normalise(text)  // maps every non-alphanumeric character to exactly one space
```

One character in, one character out. Match offsets therefore keep pointing into
the **original** text, which is what lets the parser report which words it did
not understand, and where.

That invariant has a sharp edge, and it drew blood:

> A *run* of separators — a comma and a space, a Windows line break pasted from
> a document, a double space — leaves **two** spaces where the lexicon phrase
> has one. A literal `indexOf` then misses the phrase silently.
>
> `"reverse  cowgirl"` parsed as plain `cowgirl` — **facing the wrong way** —
> with only a `did not understand: "reverse"` warning to show for it.

The fix is to precompile a regex per multi-word entry with `\s+` between words
rather than searching literally:

```js
matcher: /\s/.test(phrase)
  ? new RegExp(escape(phrase).replace(/\s+/g, "\\s+"), "g")
  : null
```

Single-word entries keep the cheaper `indexOf` path. `tests/parser.test.js`
pins the regression across `"reverse  cowgirl"`, `"reverse\r\ncowgirl"` and
`"reverse,  cowgirl"`.

## Scanning

```
sort entries by phrase length, longest first (archetypes win ties)
for each entry, for each candidate span:
    reject if it straddles a word boundary   (Latin only)
    reject if any character is already claimed
    claim the span, record the match
sort matches by position
```

Three rules, each earning its place:

**Longest phrase wins.** "on her back" is a posture and "back" is a body part;
"on the bed" is a surface and "bed" is a noun. Longest-first matching over a
claimed-span bitmap *is* the entire disambiguation strategy.

**Word boundaries — but only for Latin.** Without the check, "on" fires inside
"front", "hip" inside "ship", "he" inside "shelf". With it applied to Chinese,
nothing matches at all, because Chinese is written without spaces. So the test
is skipped for CJK phrases: `她跪在他身后` parses correctly with no spaces in it.

**Candidates step by one, not past the match.** A span that turns out to be
already claimed must not hide a later overlapping one.

The compiled matchers are shared across calls, so `lastIndex` is reset on entry.
A test asserts parsing is a pure function of its input — the same text parsed
twice, and parsed after other parses, gives identical results.

## Attachment rules

**Modifiers attach to the nearest person in either direction.** English usually
puts the adjective first ("a tall man standing behind a short woman"), but not
always ("she is short and he is tall"). Scanning backwards only gives the tall
man's height to the woman; scanning forwards only loses the trailing case.

**A plural body part becomes both sides.** "hands on her hips" → two contacts,
`hand.left` and `hand.right`. A stated side is not doubled: "her left hand" is
one contact.

**A contact never has both ends on the same person.** The solver cannot pose a
body against itself, and "he kneels behind her, hands on her hips" reads the
hands as *hers* if the subject is taken from the nearest preceding mention
alone.

**A posture that names the other person implies the arrangement.** "Sitting on
his lap" is, by saying so, straddling his lap. Read as a posture alone it leaves
the pair standing face to face.

**A posture that needs a prop supplies one.** "Bent over" with no surface named
would otherwise be bent over thin air.

## A turn is relative

The rule most likely to be got wrong by a reimplementation:

> "Facing away" is half a turn from **that arrangement's own default**, not a
> fixed world angle.

Arrangements disagree about which way "toward" is. Turning to face a standing
partner is 180°; turning to face one lying on their back is 0°. Reading "facing
away" as a fixed 180 makes *reverse cowgirl* mean forwards.

So the parser emits `relationship.yaw = (arrangement.yaw + 180) % 360`, and the
forward case emits **no yaw at all** — the arrangement's default is already
right, and saying so again would be a chance to say it wrong.

## Output contract

```js
{ scene,           // always solver-acceptable
  warnings: [],    // "did not understand: qwerty, florble"
  interpretation:  // every field, with the phrase that caused it
    [ { field: "archetype", value: "missionary", phrase: "missionary" },
      { field: "actor0.posture", value: "supine", phrase: null,
        note: "assumed from the arrangement" } ],
  matched: [] }    // raw spans, for highlighting
```

Two guarantees:

**Nothing throws.** `""`, `"   "`, `null`, `12345`, `"!!!???..."`, 5000
characters of `a` — all produce a scene with a known posture, body type and
surface. The webapp parses on every keystroke, so half-typed words are the
normal case.

**Every guess is labelled.** A field with no `phrase` behind it carries a `note`
saying why it was assumed. Filler words (`the`, `is`, `a`, `from`, `so`) are
never reported as unread, because listing them would bury the one word that
actually was not understood.

## Testing strategy

Split deliberately in two:

- `scripts/validate-text.mjs` runs a **34-description corpus** end to end and
  checks what each one is read as *and* that the result is geometrically sound.
  That is the suite that says whether the vocabulary is any good.
- `tests/parser.test.js` tests the **machinery** — things a corpus cannot reach
  because they are about *how* a sentence is read rather than which sentence it
  is: unreadable input, subject attachment, purity, the whitespace regression,
  and that the lexicon only names postures, arrangements and surfaces that
  actually exist.

The second is what catches a vocabulary entry that parses cleanly and then
renders as nothing.

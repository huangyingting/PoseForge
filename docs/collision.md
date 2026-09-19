# Collision

`src/core/collision.js`. Two bodies of ~31 volumes each is ~961 pairs per frame,
plus self-collision, plus props — run 45 times per solve. It has to be cheap and
it has to be exact.

## Broad phase

Axis-aligned bounds per volume, computed from the two end spheres:

```js
volumeBounds(volume, padding):
  min[i] = min(a[i] - ra, b[i] - rb) - padding
  max[i] = max(a[i] + ra, b[i] + rb) + padding
```

Pairs whose bounds miss are rejected before any distance work. Self-pairs within
`selfIgnore` are rejected first, by hash lookup, because authored anatomical
overlap is the most common rejection of all (see [geometry.md](geometry.md)).

The loop is upper-triangular (`j` starts at `i`, `y` starts at `x+1` on the same
body), so every pair is tested once.

## Narrow phase

Two round cones: closest points between their two axis segments, then compare
the gap against the sum of the radii *at those parametric positions*.

```js
capsuleContact(A, B, margin) → null | {
  depth,      // positive = overlapping
  normal,     // unit, pointing from A to B
  pointA,     // witness on A's surface
  pointB,     // witness on B's surface
  t, s,       // parametric position along each axis
}
```

Carrying `t` and `s` is what distinguishes this from a sphere-based proxy: the
solver needs to know *where along the femur* the contact is to convert a
penetration into a joint rotation rather than just shoving an endpoint.

Boxes (props, the floor) use `capsuleBoxContact`. The floor is passed as a very
large, very thin box, so resting on a bed and resting on the ground are one code
path.

## Compression: bodies are not rigid

The failure mode that makes rigid-body posing look wrong is partners hovering a
centimetre apart. Real flesh flattens where it touches, so every contact gets an
overlap budget and only the excess is treated as penetration:

```js
COMPRESSION = {
  default:          0.010,   // 10mm — two shins, a foot on the floor
  soft:             0.018,   // 18mm — volumes flagged soft
  declaredContact:  0.022,   // 22mm — "her hands on his chest"
}

effectiveDepth = rawDepth - allowance
if (effectiveDepth <= 0) → not a contact at all
```

The three-way split is the point. A 15mm overlap between a hand and a chest is a
hand pressing in — correct, and reported as zero. The same 15mm between two
shins is a defect. Which one applies is decided by whether the pair appears in
the `declared` key set that `solveScene` builds from the arrangement's contacts
plus anything the text asked for.

Contacts keep both numbers (`depth` net of allowance, `rawDepth` gross) so
diagnostics can show what was really measured.

`contactKey` is order-independent (`"actorA:boneA|actorB:boneB"`, lexically
sorted), so a declared contact matches regardless of which side the detector
happens to visit first.

## Response: translation *and* torque

`rigidCorrection` is the part most naive solvers get wrong. Pushing a body out
of an overlap with a pure translation slides it through the floor or through the
partner it is resting on. Bodies rotate.

```js
impulse     = normal · depth · share        // share = 0.5, symmetric
translation = mean(impulse)
torque      = mean((point - centre) × impulse) · torqueScale   // 0.6
```

Properties that the tests pin:

- **Symmetric.** Each side gets `share = 0.5`, so A pushing out of B moves both
  by the same amount in opposite directions. No body is privileged.
- **Self-contacts contribute nothing.** A contact with both ends on one body
  cannot move that body; `share = 0` and it is skipped. Bending is the
  articulated stage's job.
- **Averaged, not summed.** Dividing by the number of contributing contacts
  keeps the result stable when a body is wedged between several others —
  summing makes a body in a tight pose explode.
- **Uninvolved bodies get exactly zero**, not a small numerical drift.

## What is allowed to move

Not every overlap can be fixed the same way, and `solveScene` routes them:

| overlap | stage | why |
|---|---|---|
| torso ↔ torso | rigid | no joint can fix it; the whole body must move |
| anything involving a **load-bearing** bone | rigid | you cannot lift an all-fours partner's thigh by bending their leg — their leg is what they are standing on |
| limb ↔ limb, neither load-bearing | articulated | bend the limb |
| a supporting limb in the way | straddle | swing it out |
| supports wanting the same floor patch | footprints | no overlap exists, so nothing else can even see the problem |

The load-bearing case is subtle. A load-bearing knee resting on a free arm is
one of each: the knee cannot bend out of the way, but the arm certainly can.
Handing the whole contact to the rigid stage would pin the arm there forever, so
only **bulk-against-bulk** contacts are considered finished by the rigid stage;
the rest are also offered to the articulated stage, which independently refuses
to bend a load-bearing bone.

## Ordering

Contacts come back **deepest first**. The solver relies on this: correcting the
worst overlap first converges faster and avoids spending a limited step budget
on 1mm contacts while a 90mm one persists.

## Other exports

- `penetrationReport(contacts)` → `{ maxDepth, count }`, the scalar the anneal
  scores against.
- `lowestPoint(volumes)` → the lowest point of the lowest *sphere*, not the
  lowest axis endpoint. Using the axis puts feet through the floor by a radius.
- `alignedWith(normal, reference, threshold = 0.7)` → classifies a contact
  normal as "supporting" rather than "pressing".

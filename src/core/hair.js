/**
 * Hair.
 *
 * The scans are bald. That is not a small omission on a figure meant to read as
 * a person: hair is most of a head's silhouette, and a smooth scalp under a key
 * light reads as a mannequin no matter how good the face under it is.
 *
 * Without an asset fitted to the skull it sits on, this generates a shell. The
 * shape is not sculpted by hand either -
 * a hand-placed ellipsoid fits one model and floats off the other - it is
 * *measured* off whichever scalp it is asked to sit on, and the style is a
 * handful of numbers describing what the shell does with that measurement.
 *
 * Three ideas carry the whole module.
 *
 * The first is the support function. For every direction out of the head's
 * centre, the furthest any scalp vertex reaches in that direction is the radius
 * the hair has to clear. Taking the *maximum* rather than the surface itself is
 * what makes the result look like hair: a support radius is convex, so the shell
 * bridges over the ear and across the hollow behind it instead of shrink-
 * wrapping into them, which is exactly what a head of hair does. It is also
 * cheap - one pass over the vertices, bucketed by direction - where ray-casting
 * the same grid is tens of millions of triangle tests.
 *
 * The second is that the hairline is a curve in azimuth, not a height. Hair
 * stops high at the forehead, lower at the temple, lower still behind the ear
 * and lowest at the nape, and the difference between those four is most of what
 * distinguishes a haircut from a swimming cap. Three cosine terms fit the curve
 * to within a couple of degrees everywhere, and the coefficients are solved
 * from four measured points rather than dialled in.
 *
 * The third is that the shell is closed. It is an outer surface, an inner
 * surface a millimetre off the scalp, and a rim joining the two along the free
 * edge - so the hair has thickness where it is cut and none where it grows out
 * of the skin, which is the difference between hair and a decal. The thickness
 * fades to zero along the hairline, so no rim shows there; it stays full where
 * the hair falls past the head, so the rim shows at the ends, where it should.
 *
 * Everything here is in the template's bind space, which is stature-normalised
 * with the crown at y = 1 and the face down +z. The shell is rigid to the head
 * joint: hair is attached to the scalp, so when the neck bends it all swings
 * together, and weighting it to the neck instead would shear a bob in half.
 *
 * The shell is now the fallback. A template that carries MakeHuman's own
 * hairstyles, fitted to its body (`hairCards.js`), wears those instead, as
 * cards; the shell is for one that does not.
 */

import { cardSubmesh } from "./hairCards.js";

/** Cells around the head in the measured fields, and steps down the shell. */
const AZIMUTHS = 72;
const CAP_RINGS = 20;
const FALL_RINGS = 16;

/**
 * Segments round the shell itself.
 *
 * Deliberately not `AZIMUTHS`. The two numbers were the same until the locks
 * below needed drawing, and they have nothing to do with each other: `AZIMUTHS`
 * is how finely the *scalp* is measured, and 72 cells of a bucketed maximum is
 * already more than a skull justifies, while this is how finely the *hair* is
 * drawn, and a lock has to survive Nyquist. Nothing couples them - `scalpAt`
 * and `trunkAt` are bilinear samplers, so the shell can be built at any
 * resolution it likes over fields measured at another.
 *
 * 96 buys the locks six samples per period at their fastest, which is the
 * margin the elevation ripples in `lumpiness` were cut back to when an
 * undersampled ripple turned out to shade as a crease. The cost is 33% more
 * vertices on a mesh of five thousand, against a body of ninety-five thousand
 * triangles.
 */
const SEGMENTS = 96;



/**
 * How far off the scalp the inner surface sits, as a fraction of stature.
 *
 * A millimetre and a half at 1.72m. Enough that the two surfaces never meet as
 * the head is skinned - the hair is rigid to one joint and the scalp under it is
 * blended across two, so they do not move quite together - and far too little to
 * see. Zero is not an option, and nor is anything much under a millimetre: the
 * support field is smoothed, and a smoothed maximum dips below its own samples
 * wherever the surface is steep, which over a forehead is everywhere. The first
 * build of this ran at 1mm and drew a dotted band of bare scalp along the whole
 * hairline - the one place the shell is thinnest and the skull turns fastest.
 */
const SCALP_GAP = 0.0015 / 1.72;

/**
 * The hairline, in degrees off the crown, as a function of azimuth.
 *
 * Measured off the female scan and fitted with `A + B cos f + C cos 2f +
 * D cos 3f`, f being 0 at the face and 180 at the back of the head:
 *
 *     forehead   f =   0    50 deg
 *     brow edge  f =  45    58
 *     temple     f =  90    90         (level with the top of the ear)
 *     nape       f = 180   140
 *
 * Four terms and not three because the third was flat. With `A + B cos f +
 * C cos 2f` alone the hairline fell 3 degrees between the midline and the outer
 * brow, which at this radius is 7mm over the 50mm width of a forehead - a ruled
 * horizontal line ending in a right-angled corner at the temple, and the first
 * render of this looked exactly like that. A real frontal hairline arches: it is
 * highest at the midline and 8 to 10 degrees lower where it turns down. The
 * `cos 3f` term is what buys the arch without disturbing the other three
 * measurements, and it is small - a couple of degrees - because that is all the
 * correction needed.
 *
 * The temple figure is 90 and not the 77 first fitted, and the difference is
 * the whole character of a man's haircut. 77 degrees puts the edge 20mm above
 * the top of the ear: on long hair that is hidden under the fall, but on a crop
 * there is nothing below it, and the male head came back with a bare band of
 * scalp round the side and a cap sitting on top of it like a bowl. 90 degrees
 * is the equator of the support sphere, which is the widest part of the skull
 * and the level the ear starts at - where hair actually stops.
 *
 * Expressed in degrees off the crown rather than as a height because the two
 * skulls differ by 13mm in how far back the braincase runs and by 2mm in where
 * the chin is. An angle out of the fitted centre transfers between them; a
 * height does not.
 */
const HAIRLINE = [92.5, -46.9, 2.5, 1.9];

/**
 * How wide the fringe is, in degrees of azimuth either side of the midline,
 * and how much of that is at full depth before it starts sweeping up.
 *
 * 80 degrees reaches the temple and no further. A fringe is the hair in front
 * of the parting, and where it runs out is where the hair starts going back
 * over the ear instead of forward over the face - on a head that is the corner
 * of the forehead, and on this measured hairline it is the azimuth at which
 * `HAIRLINE` has already fallen to the temple's 90 degrees.
 *
 * Flat across the middle 45% and then falling is what makes it a fringe rather
 * than a bowl. A single cosine bell peaks at the midline and is already half
 * gone by 40 degrees, which draws an arch over the brow with the corners of the
 * forehead bare - the one shape that reads as a receding hairline rather than
 * as hair. Real bangs are cut level and turn up only at the very ends.
 *
 * `SWEEP` is how much further the cut falls at the end of its span than at the
 * midline, in degrees. Seven, which is a centimetre: enough that the edge reads
 * as swept out towards the cheekbone - the curtain shape - rather than as a
 * blunt horizontal bar across the brow, and not so much that it closes over the
 * outer corner of the eye.
 *
 * `RAG` is the scissors, in degrees - a centimetre at this radius, against the
 * half centimetre `HAIRLINE` carries, because a cut edge in hair is rougher
 * than a grown one. It rides `lockProfile` and not `lockMass`: `lockMass` is
 * the broadest lock term alone, seven cycles round a head and so three across a
 * fringe, and three big cycles is a zigzag cut into a sheet rather than hair.
 * `lockProfile` adds 11 and 15 cycles to that seven, which is six or seven
 * wiggles across the same span, and that is a fringe.
 */
const FRINGE_SPAN = (80 * Math.PI) / 180;
const FRINGE_FLAT = 0.45;
const FRINGE_SWEEP = (10 * Math.PI) / 180;
const FRINGE_RAG = (1.2 * Math.PI) / 180;

/**
 * How far the tip of a fringe stands off the forehead, as a fraction of
 * stature - 9mm at 1.72m, on top of `SCALP_GAP`.
 *
 * Hair grown from the crown and combed forward does not lie on the brow, it
 * leaves the scalp at the hairline and carries on in a straight line while the
 * forehead curves away underneath it. The gap at the tip is most of a
 * centimetre, and it is what casts the shadow across the brow that makes bangs
 * read as something in front of a face. Laid flat on the skin at `SCALP_GAP`
 * the first build of this looked painted on: the forehead was dark, but the
 * darkness followed the skin's own shading exactly, because it *was* the skin's
 * own shading with a black surface a millimetre above it.
 */
const FRINGE_STANDOFF = 0.009 / 1.72;

/**
 * The shells, one per length of hair, which `HAIR_STYLES` below falls back to.
 *
 * `lift` moves the whole hairline, in degrees off the crown, and the sign is
 * the opposite of what the name suggests: the angle is measured *from the
 * crown*, so a positive `lift` is a larger angle, which is further down the
 * head, which is a lower hairline. Negative recedes it. The doc here said the
 * reverse for as long as nothing had tried to read it, and the first attempt to
 * bring the male hairline down by setting `lift` negative moved it up instead.
 *
 * It is worth knowing that `lift` cancels out of the fringe: the cut line is
 * anchored at `growsAt(0) + fringe`, and `growsAt` already carries the lift, so
 * on a fringed style `lift` moves the sides and the nape and leaves the brow
 * exactly where `fringe` put it. Tuning the two together is the whole reason
 * the male crop took four renders to move by three degrees.
 *
 * `fall` is how far the hair hangs below the hairline, as a fraction of
 * stature, and `front` is the azimuth in degrees inside which it does not hang
 * at all, because hair does not fall over a face. It is well inside the
 * fringe's span: where the fringe runs out at the corner of the forehead the
 * side hair has to have already started, or there is a notch between the two
 * with a bare temple in it. `flare` is what the fall's radius does by the time
 * it reaches the ends - slightly over one, because hair hangs a little away
 * from the neck rather than gripping it.
 *
 * `lump` modulates the thickness with a smooth function of direction. A shell of
 * constant thickness is a helmet - it was, on the first male render, a black
 * swimming cap - and what separates hair from a cap is that its surface is not
 * smooth. The values here are large, a third to a half of the thickness,
 * because the shading has to see them: at a quarter of 10mm the variation is
 * 2.5mm over a wavelength of most of a head, which is below what the specular
 * picks up.
 *
 * `fade` is how much of the way back from the hairline to the crown the
 * thickness takes to reach full, as a fraction of the hairline angle. It is the
 * other half of the cure for the swimming cap. A shell that is full thickness
 * everywhere and then drops to nothing in the last ten degrees has a clean
 * curved edge cut into a smooth dome, which is a cap; a shell that thins
 * steadily from the crown outwards is short back and sides, which is a haircut.
 * The styles with a fall get much less of it, because hair long enough to hang
 * is not tapered at the point it starts hanging from.
 *
 * `part` cuts the thickness along a narrow band at the front, which is a
 * parting.
 *
 * `locks` is how far a lock ridge stands proud of the mass, as a fraction of
 * stature, and it is the fall's half of the cure for the helmet that `lump` is
 * the cap's half of. The two are not interchangeable: `lump` varies the
 * *thickness* of a shell wrapped tight to a skull, where a few millimetres is
 * all there is room for, while `locks` displaces the free-hanging surface
 * outright, where there is nothing to collide with and hair genuinely does
 * separate into ropes a centimetre deep. The styles with no fall carry a value
 * anyway, unused, so the table reads as one shape of thing.
 *
 * `ragged` is how much the fall's length varies from lock to lock, as a
 * fraction of it. Hair is cut across and then stops being cut across within a
 * week: the ends of a real fall wander by a good inch, and a fall that ends on
 * a ruled horizontal line is the single loudest thing in a render saying this
 * was made by a machine. It is tied to the same ridge function as `locks`,
 * shifted a little, because the lock that stands proud is also the one that
 * hangs longest.
 *
 * `fringe` is how far below the midline hairline the hair is *cut*, in degrees,
 * and it is the one number here that is not a property of the shell - it is a
 * property of the haircut. Everything else asks where hair grows and what it
 * does once it is there; this asks how much of it has been combed forward over
 * a face and where the scissors then went.
 *
 * It matters more than its size suggests. The measured hairline puts the
 * forehead's edge 42 to 53 degrees off the crown, which is correct - that is
 * where hair grows from - and leaves 74mm of bare forehead between it and the
 * brow, which on a render is a third of the visible head and reads as a very
 * high hairline on everyone. Nobody wears their hair that way; the hairline is
 * where hair *starts*, not where it is seen to end.
 *
 * Read it as an absolute, not as a depth: the cut line sits at `growsAt(0) +
 * fringe`, so 26 puts the female edge at 72 degrees off the crown and 14 puts
 * the male crop at 70. Those two numbers are six degrees apart in `fringe` and
 * two degrees apart on the head, because the two styles also differ in `lift`,
 * and `lift` is inside `growsAt(0)`.
 *
 * Measured off the scan at the midline: the brow ridge is 88 degrees off the
 * crown and the nose bridge 98, so anything past about 84 is over an eye. The
 * styles here stop at 72 at the midline, and `FRINGE_SWEEP` carries the ends
 * ten degrees further, which is still short of the outer corner of the eye.
 */
const SHELLS = {
  crop: { thickness: 0.0042, lift: 6, fall: 0, front: 60, flare: 1, lump: 0.42, fade: 0.45, part: 0, locks: 0.0016, ragged: 0, fringe: 3 },
  short: { thickness: 0.0080, lift: 3, fall: 0, front: 60, flare: 1, lump: 0.45, fade: 0.50, part: 0.22, locks: 0.0040, ragged: 0, fringe: 14 },
  bob: { thickness: 0.0098, lift: -8, fall: 0.082, front: 48, flare: 1.05, lump: 0.34, fade: 0.16, part: 0.35, locks: 0.0058, ragged: 0.16, fringe: 24 },
  medium: { thickness: 0.0102, lift: -7, fall: 0.118, front: 46, flare: 1.08, lump: 0.32, fade: 0.15, part: 0.30, locks: 0.0066, ragged: 0.20, fringe: 26 },
  long: { thickness: 0.0108, lift: -8, fall: 0.150, front: 45, flare: 1.10, lump: 0.30, fade: 0.14, part: 0.40, locks: 0.0076, ragged: 0.22, fringe: 22 },
};

/**
 * The hairstyles a figure can wear.
 *
 * Each is one of MakeHuman's hairstyles, drawn as cards (see `hairCards.js`),
 * and names the shell above that stands in for it when a template has no cards
 * to draw - a body loaded without them, or a test that never asked. The shell
 * is the nearest length rather than the same haircut: it has no ponytail or
 * braid in it to give.
 */
export const HAIR_STYLES = {
  none: null,
  crop: { cards: "short02", shell: "crop" },
  short: { cards: "short01", shell: "short" },
  pixie: { cards: "short03", shell: "short" },
  undercut: { cards: "short04", shell: "short" },
  afro: { cards: "afro01", shell: "short" },
  bob: { cards: "bob02", shell: "bob" },
  medium: { cards: "bob01", shell: "medium" },
  ponytail: { cards: "ponytail01", shell: "medium" },
  braid: { cards: "braid01", shell: "long" },
  long: { cards: "long01", shell: "long" },
};

/**
 * The brows and lashes each body type wears, whatever its hairstyle - a
 * shaved head still has eyebrows. Fine and arched against heavy and straight,
 * and the lashes likewise, because at a face's scale in a render those two are
 * most of what reads as a woman's eye or a man's.
 */
export const FACE_TRIMS = {
  female: { brows: "eyebrow010", lashes: "eyelashes02" },
  male: { brows: "eyebrow009", lashes: "eyelashes01" },
  neutral: { brows: "eyebrow010", lashes: "eyelashes01" },
};

/**
 * What each body type wears unless it is told otherwise.
 *
 * Medium rather than long for the female default. `long` reaches 258mm below
 * the hairline, which is mid-back, and at that length the fall is a flat sheet
 * either side of the face for its whole drop - there is nothing for the lock
 * ridges to break up because the silhouette is a straight line. Shoulder length
 * is both the commoner haircut and the one the shell models honestly: it ends
 * where the shoulder is, so the ragged tips have something to end *against*.
 */
export const DEFAULT_HAIR = { female: "medium", male: "short", neutral: "short" };

/**
 * Hair colour.
 *
 * Not black. Black hair photographs as a very dark warm brown with a hard sheen
 * on it, and the sheen is doing nearly all the work - painted 0/0/0 a head reads
 * as a hole cut in the picture, because the only thing separating hair from
 * background is then the background. These renderers have one specular term and
 * it is deliberately soft, so the tone has to carry the rest: dark enough to
 * read as black next to skin - it is a fifteenth of the skin's albedo, so the
 * eye has no trouble - and light enough that the diffuse shading still models
 * the crown rather than leaving a silhouette with a glint on it.
 */
export const HAIR_COLOUR = [0.075, 0.062, 0.056];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, t) => {
  const x = clamp01((t - a) / (b - a || 1e-9));
  return x * x * (3 - 2 * x);
};

/** Which joint, if any, dominates a vertex. */
function dominant(submesh, v) {
  let best = -1;
  let weight = 0;
  for (let k = 0; k < 4; k += 1) {
    const w = submesh.weights[v * 4 + k];
    if (w > weight) {
      weight = w;
      best = submesh.joints[v * 4 + k];
    }
  }
  return best;
}

/**
 * Fill the holes in a directional grid, then smooth it.
 *
 * A bucketed maximum leaves gaps wherever the mesh happens to have no vertex
 * pointing that way, and a gap in a radius field is a spike in the surface built
 * from it. Dilation fills them from whatever neighbours do have a reading, which
 * is the right answer for a field that is already nearly constant over a cell;
 * the smoothing passes afterwards are not about the holes at all but about the
 * hair, which has no business following a 2mm bump in a skull.
 *
 * Wraps in azimuth and clamps in the other axis, because azimuth is a circle and
 * elevation is not.
 */
function fillAndSmooth(grid, wide, tall, passes = 3, keepMaximum = false) {
  const at = (a, b) => grid[((a % wide) + wide) % wide * tall + Math.max(0, Math.min(tall - 1, b))];
  for (let round = 0; round < 24; round += 1) {
    let holes = 0;
    const next = Float64Array.from(grid);
    for (let a = 0; a < wide; a += 1) {
      for (let b = 0; b < tall; b += 1) {
        if (grid[a * tall + b] >= 0) continue;
        let sum = 0;
        let n = 0;
        for (const [da, db] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const value = at(a + da, b + db);
          if (value >= 0) {
            sum += value;
            n += 1;
          }
        }
        if (n) next[a * tall + b] = sum / n;
        else holes += 1;
      }
    }
    grid.set(next);
    if (!holes) break;
  }
  const floor = keepMaximum ? Float64Array.from(grid) : null;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = Float64Array.from(grid);
    for (let a = 0; a < wide; a += 1) {
      for (let b = 0; b < tall; b += 1) {
        next[a * tall + b] =
          (at(a, b) * 2 + at(a - 1, b) + at(a + 1, b) + at(a, b - 1) + at(a, b + 1)) / 6;
      }
    }
    grid.set(next);
  }
  // Never below what was measured. Smoothing a maximum is not a maximum any
  // more: wherever the surface turns fast the average of a cell with its
  // neighbours lands inside the surface, and a support radius that lands inside
  // the surface is a shell with the head sticking out through it. `SCALP_GAP`
  // exists because of exactly that and is sized for the hairline, where the
  // skull's curvature is merely high; behind the ear it is savage, the smoothed
  // field dips by rather more than a millimetre and a half, and what came back
  // was a torn hole low on the back of the head with lit skin behind it.
  //
  // Flooring against the pre-smooth field costs almost nothing, because that
  // field is already a maximum dilated over a 3x3 neighbourhood rather than a
  // cell-wise one - an upper envelope, not a set of spikes - so the floor only
  // binds in the few cells where the smoothing genuinely overshot, and the
  // smoothed value stands everywhere else. Only worth doing for a field a
  // surface is built *on*: the trunk grid is a clearance the hair keeps away
  // from, where dipping a millimetre is invisible.
  if (floor) for (let i = 0; i < grid.length; i += 1) grid[i] = Math.max(grid[i], floor[i]);
  return grid;
}
/** Bilinear read of a grid that wraps in a and clamps in b. */
function sample(grid, wide, tall, a, b) {
  const a0 = Math.floor(a);
  const b0 = Math.max(0, Math.min(tall - 2, Math.floor(b)));
  const fa = a - a0;
  const fb = Math.max(0, Math.min(1, b - b0));
  const wrap = (i) => ((i % wide) + wide) % wide;
  const g = (i, j) => grid[wrap(i) * tall + Math.max(0, Math.min(tall - 1, j))];
  const top = g(a0, b0) + (g(a0 + 1, b0) - g(a0, b0)) * fa;
  const bottom = g(a0, b0 + 1) + (g(a0 + 1, b0 + 1) - g(a0, b0 + 1)) * fa;
  return top + (bottom - top) * fb;
}

/**
 * A smooth, seamless pseudo-noise on the sphere of directions.
 *
 * Sums of sines rather than a hash: it has to be continuous across the azimuth
 * wrap or the modulation draws a seam down the back of the head, and integer
 * frequencies in `f` are continuous there for free. Deterministic, so a figure
 * does not grow different hair between the viewport and the export.
 *
 * Every frequency here is slow enough to be drawn. The first version ran at
 * 4.5 and 8.5 cycles in elevation against 20 rings of mesh - the second of those
 * is one and a half rings per period, well past what the grid can carry - and
 * the result was not lumpiness but aliasing: a hard diagonal crease over the
 * temple, because an undersampled ripple does not shade as a ripple, it shades
 * as a fold. 2.2 and 3.6 give six rings per period at worst, which the mesh
 * resolves, and the azimuth terms at 3, 5 and 7 have ten times the samples they
 * need.
 */
function lumpiness(f, t) {
  return (
    Math.sin(3 * f + 1.7) * 0.5 +
    Math.sin(5 * f - 0.4) * 0.28 +
    Math.sin(7 * f + 2.3) * 0.17 +
    Math.sin(2.2 * t + 0.9) * 0.45 +
    Math.sin(3.6 * t - 1.3) * 0.22
  ) / 1.62;
}

/**
 * The lock ridges, as a signed profile round the head, peak magnitude 1.
 *
 * A function of azimuth alone, so a ridge runs straight down the fall rather
 * than wandering across it. That is the point of it: a highlight on hair is
 * broken *lengthwise*, into a band per lock, because the fibres all run the
 * same way and a lock is a cylinder lying parallel to its neighbours.
 * Modulating in both axes instead gives a dimpled surface, which is a golf
 * ball.
 *
 * Its own sines rather than `lumpiness` at a fixed elevation, which is what
 * this was first written as and which failed twice over. `lumpiness`'s two
 * elevation terms go constant when the elevation does, so a third of its range
 * became a fixed offset and the profile swung over [-0.94, +0.24] instead of
 * [-1, 1] - half the depth asked for, biased into the head. And its azimuth
 * terms were being scaled by a non-integer to reach this many ridges, which
 * breaks the one property that made a sum of sines the right choice here: only
 * whole cycles round a circle close up, and 6.6 of them leave a step down the
 * back of the head.
 *
 * 7, 11 and 15 cycles: three or four broad masses across the back of a head
 * with finer strands inside them, which is how hair actually divides, and 15 is
 * six of `SEGMENTS`' samples per period. Coprime, so the profile does not
 * repeat anywhere the eye can catch it repeating.
 */
const LOCKS = [
  [7, 1.7, 0.42],
  [11, -0.4, 0.34],
  [15, 2.3, 0.24],
];

const lockProfile = (f) =>
  LOCKS.reduce((sum, [cycles, phase, depth]) => sum + Math.sin(cycles * f + phase) * depth, 0);

/**
 * The broadest of the lock terms alone, over [-1, 1].
 *
 * For the hairline, which wanders by the section and not by the strand: fifteen
 * cycles round a head is four wiggles across a forehead, which is not a
 * hairline, it is a saw. The first term on its own is two and a bit, which is.
 * Sharing the term rather than picking new noise is what puts the lowest point
 * of the fringe under the lock that stands proudest over the crown, because on
 * a real head those are the same hair.
 */
const lockMass = (f) => Math.sin(LOCKS[0][0] * f + LOCKS[0][1]);

/**
 * Build a hair shell for a template.
 *
 * @param {object} template a template from `buildHumanTemplate`, or the one
 *                          `featureRelief` returns - either works, the head is
 *                          untouched by relief
 * @param {object} [options]
 * @param {string} [options.bodyType] picks the default style
 * @param {string} [options.style] a key of `HAIR_STYLES`
 * @param {number[]} [options.colour] sRGB 0..1
 * @returns {object|null} a submesh to append to `template.submeshes`, or null
 */
export function buildHair(template, { bodyType = "neutral", style, colour = HAIR_COLOUR } = {}) {
  const name = style ?? DEFAULT_HAIR[bodyType] ?? "short";
  const shape = SHELLS[HAIR_STYLES[name]?.shell];
  if (!shape) return null;

  const body = template.submeshes.find((submesh) => submesh.primary);
  const head = template.jointByBone.get("head");
  if (!body || !head) return null;

  const count = body.positions.length / 3;
  const isHead = new Uint8Array(count);
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let v = 0; v < count; v += 1) {
    let w = 0;
    for (let k = 0; k < 4; k += 1) {
      if (body.joints[v * 4 + k] === head.index) w += body.weights[v * 4 + k];
    }
    if (w < 0.35) continue;
    isHead[v] = 1;
    ymin = Math.min(ymin, body.positions[v * 3 + 1]);
    ymax = Math.max(ymax, body.positions[v * 3 + 1]);
  }
  if (!Number.isFinite(ymin)) return null;

  // The centre the support function is taken about. Not the centroid of the head
  // vertices - a face has a nose on it and the vertex density is far higher round
  // the eyes and mouth than over the braincase, so the centroid sits 40mm forward
  // of anything a skull would call its middle, and a support function taken from
  // there is a spiral rather than a sphere. 0.42 of the way down from the crown
  // puts it level with the top of the ear on both models, which is where a skull's
  // widest section is; z is then the mid-extent of what is above it, which
  // excludes the nose and the jaw by construction.
  const cy = ymax - 0.42 * (ymax - ymin);
  let zmin = Infinity;
  let zmax = -Infinity;
  for (let v = 0; v < count; v += 1) {
    if (!isHead[v] || body.positions[v * 3 + 1] < cy) continue;
    zmin = Math.min(zmin, body.positions[v * 3 + 2]);
    zmax = Math.max(zmax, body.positions[v * 3 + 2]);
  }
  const centre = [0, cy, (zmin + zmax) / 2];

  /* ---- the scalp, as a radius per direction ---- */

  const THETAS = 40;
  const dTheta = Math.PI / THETAS;
  const scalp = new Float64Array(AZIMUTHS * THETAS).fill(-1);
  for (let v = 0; v < count; v += 1) {
    if (!isHead[v]) continue;
    const dx = body.positions[v * 3] - centre[0];
    const dy = body.positions[v * 3 + 1] - centre[1];
    const dz = body.positions[v * 3 + 2] - centre[2];
    const r = Math.hypot(dx, dy, dz);
    if (r < 1e-6) continue;
    const ia = Math.floor(((Math.atan2(dx, dz) / (2 * Math.PI) + 1) % 1) * AZIMUTHS);
    const it = Math.min(THETAS - 1, Math.floor(Math.acos(Math.max(-1, Math.min(1, dy / r))) / dTheta));
    // Into the cell *and its neighbours*, which is a dilation folded into the
    // accumulation. Without it the field is a cell-wise maximum with no
    // relation between adjacent cells, and the smoothing that follows - which
    // the hair needs, or it inherits every 2mm bump in the skull - averages a
    // steep cell with its shallower neighbours and lands under the surface. A
    // maximum spread over a 3x3 neighbourhood is an upper envelope instead, and
    // an upper envelope survives being smoothed.
    for (let da = -1; da <= 1; da += 1) {
      for (let db = -1; db <= 1; db += 1) {
        const a = ((ia + da) % AZIMUTHS + AZIMUTHS) % AZIMUTHS;
        const b = it + db;
        if (b < 0 || b >= THETAS) continue;
        if (r > scalp[a * THETAS + b]) scalp[a * THETAS + b] = r;
      }
    }
  }
  fillAndSmooth(scalp, AZIMUTHS, THETAS, 2, true);

  /* ---- the body below, as a radius per azimuth and height ---- */

  // What the fall has to stay outside of. Head, neck, clavicles and torso, and
  // emphatically not the arms: in the A-pose the upper arm is 180mm off the
  // midline at the height a long fall reaches, so a support function that saw it
  // would fling the hair sideways onto the shoulder and out into the air.
  const skip = /arm|hand|index|middle|pinky|ring|thumb/;
  const armJoints = new Set(
    template.joints.map((joint, i) => (skip.test(joint.name ?? "") ? i : -1)).filter((i) => i >= 0)
  );
  const HEIGHTS = 48;
  const yTop = centre[1];
  const yBottom = centre[1] - 0.30;
  const trunk = new Float64Array(AZIMUTHS * HEIGHTS).fill(-1);
  for (let v = 0; v < count; v += 1) {
    const y = body.positions[v * 3 + 1];
    if (y > yTop || y < yBottom) continue;
    if (armJoints.has(dominant(body, v))) continue;
    const dx = body.positions[v * 3];
    const dz = body.positions[v * 3 + 2] - centre[2];
    const rho = Math.hypot(dx, dz);
    const ia = Math.floor(((Math.atan2(dx, dz) / (2 * Math.PI) + 1) % 1) * AZIMUTHS);
    const iy = Math.min(HEIGHTS - 1, Math.floor(((yTop - y) / (yTop - yBottom)) * HEIGHTS));
    const at = ia * HEIGHTS + iy;
    if (rho > trunk[at]) trunk[at] = rho;
  }
  fillAndSmooth(trunk, AZIMUTHS, HEIGHTS, 2);
  const trunkAt = (f, y) =>
    sample(
      trunk,
      AZIMUTHS,
      HEIGHTS,
      ((f / (2 * Math.PI) + 1) % 1) * AZIMUTHS,
      ((yTop - y) / (yTop - yBottom)) * HEIGHTS - 0.5
    );

  /* ---- the surface ---- */

  const lift = (shape.lift * Math.PI) / 180;
  const fringe = ((shape.fringe ?? 0) * Math.PI) / 180;
  const front = (shape.front * Math.PI) / 180;
  /** Where hair grows from: the measured hairline, before any comb-forward. */
  const growsAt = (f) =>
    ((HAIRLINE[0] +
      HAIRLINE[1] * Math.cos(f) +
      HAIRLINE[2] * Math.cos(2 * f) +
      HAIRLINE[3] * Math.cos(3 * f) +
      // Three degrees of wobble, because a hairline fitted from four
      // measurements is a perfect curve and nobody has one. Five millimetres at
      // this radius: a degree and a half, which is what this was, is below what
      // the eye picks out against the hard arc of a fringe. Driven by the lock
      // profile rather than by noise of its own, so the strand that hangs
      // lowest at the forehead is the one that stands proudest all the way up
      // over the crown - a hairline is where the locks start, not a separate
      // feature that happens to be near them.
      3 * lockMass(f)) *
      Math.PI) /
      180 +
    lift;
  /**
   * How much fringe there is at this azimuth.
   *
   * A fringe is *cut*, and that one word is the whole of this function. Every
   * earlier version of it added a depth to the natural hairline, so the fringe
   * inherited the hairline's shape - and the natural hairline arches, by design:
   * `HAIRLINE`'s `cos 3f` term is there precisely to lift the midline 4 degrees
   * above the outer brow, because that is what a hairline does. Add a constant
   * to it and the cut edge arches too, which drew the M this went through two
   * attempts to be rid of. It was never the wobble. A hairline that rises 4
   * degrees at the midline and falls 11 into the temple, plus 3 of `lockMass`
   * either way, is a 12-degree swing along the edge of the fringe - 20mm at this
   * radius, which is not a haircut, it is a torn sheet of paper.
   *
   * So: the cut is a line of its own, and the fringe is however far the scalp is
   * from it. `cut` is where the scissors went, anchored to the midline hairline
   * so the style number still means "how much forehead this covers"; `SWEEP`
   * lets it fall a little further at the ends, which is the curtain shape rather
   * than a blunt bowl; `RAG` is a centimetre of scissors-wobble, against the
   * half centimetre a hairline carries. `max` against the scalp is what makes
   * the corner: past the temple the natural hairline is already below the cut,
   * the fringe runs out of anything to cover, and the depth goes to zero on its
   * own without a special case.
   */
  const cut = growsAt(0) + fringe;
  const fringeAt = (f) => {
    if (fringe <= 0) return 0;
    const span = 1 - smoothstep(FRINGE_FLAT * FRINGE_SPAN, FRINGE_SPAN, Math.abs(f));
    if (span <= 0) return 0;
    const line =
      cut +
      FRINGE_SWEEP * smoothstep(0, FRINGE_SPAN, Math.abs(f)) +
      FRINGE_RAG * lockProfile(f);
    return span * Math.max(0, line - growsAt(f));
  };
  const hairlineAt = (f) => growsAt(f) + fringeAt(f);
  /**
   * How far off the scalp the shell sits at this direction, past `SCALP_GAP`.
   *
   * Zero everywhere the hair is still growing out of the skin, ramping to
   * `FRINGE_STANDOFF` at the tip of the fringe. Squared rather than smoothed so
   * it leaves the hairline flat and curves away like something unsupported,
   * which is what the underside of a fringe does.
   */
  const standoffAt = (f, t) => {
    const depth = fringeAt(f);
    if (depth <= 1e-6) return 0;
    const past = clamp01((t - growsAt(f)) / depth);
    return FRINGE_STANDOFF * past * past;
  };
  // Zero over the face, one well round the side, so hair falls everywhere except
  // where a face is. The ramp is the temple, and it is what makes the fall start
  // beside the eye rather than in a step at a fixed angle. 34 degrees of it and
  // not the 25 this had: the fall's length goes from nothing to its full drop
  // across that ramp, so the ramp *is* the front edge of the curtain, and over
  // 25 degrees it is a wall steep enough to read head-on as a cut sheet of
  // plastic standing beside the face.
  const fallAt = (f) => shape.fall * smoothstep(front, front + (34 * Math.PI) / 180, Math.abs(f));

  const scalpAt = (f, t) =>
    sample(scalp, AZIMUTHS, THETAS, ((f / (2 * Math.PI) + 1) % 1) * AZIMUTHS, t / dTheta - 0.5);

  const thicknessAt = (f, t, hairline) => {
    // Full over the crown, fading to nothing at the hairline - but only where the
    // hair ends there. Where it falls past the head the thickness has to survive
    // the boundary, or the shell pinches shut at the one place it is about to
    // need a rim.
    const holds = clamp01(fallAt(f) / (shape.fall || 1));
    const edge = smoothstep(hairline * (1 - shape.fade), hairline, t);
    let thickness = shape.thickness * (1 - edge * (1 - holds));
    // Fuller over the crown than at the hairline, always, whatever the style.
    // Hair grows out of the scalp at an angle and lies over the hair in front of
    // it, so it piles up: the depth over the top of a head is two or three times
    // what it is at the edge, and a shell of constant thickness reads as a scalp
    // that has been painted rather than a head that has hair on it. Half as much
    // again at the crown is enough to put a highlight on a dome instead of on a
    // skull, and it dies out well before the hairline, where the taper above has
    // to be free to reach zero.
    thickness *= 1 + 0.5 * (1 - smoothstep(0.15 * hairline, 0.85 * hairline, t));
    thickness *= 1 + shape.lump * lumpiness(f, t);
    // The same ridges the fall carries, arriving gradually so a lock does not
    // appear out of nowhere at the weld. On the cap they can only be a change
    // of thickness - there is a skull immediately underneath and nowhere to
    // displace to - and they are held under their nominal depth for the same
    // reason.
    //
    // They do not fade to nothing at the crown, though the first build of this
    // had them doing exactly that, on the reasoning that hair leaves a parting
    // as one sheet and is in ropes by the time it reaches the ear. True, and
    // beside the point: the crown is where the key light's band falls, so the
    // one place the ridges had been switched off was the one place their whole
    // job - breaking that band into a strand per lock - had to be done. Seven
    // tenths everywhere, full by two thirds of the way out; it was half, and at
    // half the ridges on the crown were about five millimetres deep, which is
    // under the width of the highlight they were meant to break and so the cap
    // came back carrying one smooth band across it like a visor.
    thickness +=
      shape.locks *
      lockProfile(f) *
      (0.6 + 0.4 * smoothstep(0.05 * hairline, 0.65 * hairline, t));
    if (shape.part > 0) {
      // A parting is a groove, not a gap: it is where the hair is combed away
      // from, so it is thin along a narrow band and the hair either side of it is
      // not. Only in the front half - a parting does not run down the nape.
      //
      // The outer end of the groove is the *natural* hairline, not the combed
      // hairline: with a fringe the two are thirty degrees apart, and a groove
      // run out to the combed one crosses the fringe and cuts a notch in it.
      // That notch was the single worst thing about the first fringe render -
      // it put a bright V-shaped facet in the middle of the brow, because the
      // fringe stands nine millimetres proud of the scalp there and a quarter
      // of the thickness taken out of it is a crease with two lit walls. A
      // comb-forward and a centre parting are different haircuts and the front
      // of the head can only have one of them; behind the fringe there is still
      // a scalp, and that is where the groove belongs.
      //
      // Shallower too. At 0.8 the groove read as a moulded seam rather than as
      // hair falling away from a line, and the term it multiplies is already
      // carrying the crown's half-again thickening, so 0.8 of 0.30 of 1.5 was
      // taking out more than the lock ridges were putting back.
      const band = Math.exp(-((Math.abs(f) / 0.14) ** 2));
      const scalp = growsAt(f);
      thickness *= 1 - shape.part * 0.55 * band * smoothstep(scalp, scalp * 0.35, t);
    }
    return Math.max(thickness, 0);
  };

  const positions = [];
  const indices = [];
  const push = (p) => {
    positions.push(p[0], p[1], p[2]);
    return positions.length / 3 - 1;
  };

  // Crown first, as a single pair of vertices. A ring of coincident ones would
  // give every triangle round the pole a degenerate edge and a normal to match.
  const poleR = scalpAt(0, 0);
  const poleThick = thicknessAt(0, 0, hairlineAt(0));
  const poleIn = push([centre[0], centre[1] + poleR + SCALP_GAP, centre[2]]);
  const poleOut = push([centre[0], centre[1] + poleR + SCALP_GAP + poleThick, centre[2]]);

  // The cap: rings of constant fraction-of-the-way-to-the-hairline, so ring
  // CAP_RINGS is the hairline itself however much it moves with azimuth.
  const capIn = [];
  const capOut = [];
  for (let ring = 1; ring <= CAP_RINGS; ring += 1) {
    const inner = [];
    const outer = [];
    for (let a = 0; a < SEGMENTS; a += 1) {
      const f = (a / SEGMENTS) * 2 * Math.PI;
      const signed = f > Math.PI ? f - 2 * Math.PI : f;
      const hairline = hairlineAt(signed);
      const t = hairline * (ring / CAP_RINGS);
      const r = scalpAt(signed, t) + SCALP_GAP + standoffAt(signed, t);
      const thickness = thicknessAt(signed, t, hairline);
      const dir = [Math.sin(t) * Math.sin(signed), Math.cos(t), Math.sin(t) * Math.cos(signed)];
      inner.push(push([
        centre[0] + dir[0] * r,
        centre[1] + dir[1] * r,
        centre[2] + dir[2] * r,
      ]));
      outer.push(push([
        centre[0] + dir[0] * (r + thickness),
        centre[1] + dir[1] * (r + thickness),
        centre[2] + dir[2] * (r + thickness),
      ]));
    }
    capIn.push(inner);
    capOut.push(outer);
  }

  // The fall: cylindrical about the head's own vertical axis, starting from the
  // cap's last ring so the two are welded rather than abutted. The radius is the
  // larger of what the hair would do on its own and what the neck leaves room
  // for, which is how a fall hangs clear of a nape without anyone measuring one.
  const fallIn = [];
  const fallOut = [];
  const startIn = [];
  const startOut = [];
  for (let a = 0; a < SEGMENTS; a += 1) {
    const f = (a / SEGMENTS) * 2 * Math.PI;
    const signed = f > Math.PI ? f - 2 * Math.PI : f;
    const hairline = hairlineAt(signed);
    // The same radius the cap's last ring was placed at, standoff included, or
    // the fall starts a centimetre inside the cap it is supposed to be welded
    // to. Nothing in the fringe region has any length, so this only bites where
    // the two overlap - which is exactly where a seam would show.
    const r = scalpAt(signed, hairline) + SCALP_GAP + standoffAt(signed, hairline);
    startIn.push({ rho: r * Math.sin(hairline), y: centre[1] + r * Math.cos(hairline) });
    const thickness = thicknessAt(signed, hairline, hairline);
    startOut.push(thickness);
  }
  for (let ring = 1; ring <= FALL_RINGS; ring += 1) {
    const s = ring / FALL_RINGS;
    const inner = [];
    const outer = [];
    for (let a = 0; a < SEGMENTS; a += 1) {
      const f = (a / SEGMENTS) * 2 * Math.PI;
      const signed = f > Math.PI ? f - 2 * Math.PI : f;
      const ridge = lockProfile(signed);
      // Ragged ends. The shift on the argument is a third of a lock, so the
      // longest strands sit just off the proudest ridge rather than on it -
      // exactly aligned, the tip line would trace the same curve as the
      // silhouette and the two would read as one moulded edge again.
      const length = fallAt(signed) * (1 + shape.ragged * lockProfile(signed + 0.33));
      const y = startIn[a].y - s * length;
      // Flares out over the first third and holds, which is what hair leaving a
      // scalp does; a straight cylinder from the hairline reads as a wig cap.
      const flare = 1 + (shape.flare - 1) * smoothstep(0, 0.35, s);
      const clear = Math.max(startIn[a].rho * flare, trunkAt(signed, y) + SCALP_GAP * 3);
      // Both the flare and the clearance have to be weighed by how much fall
      // there actually is at this azimuth, or they act where there is none. In
      // front of the ear the fall has zero length but the clearance does not
      // know that: the trunk grid is clamped at its top row, which is the widest
      // section of the skull, so it pushed the collapsed rings a few millimetres
      // proud of the hairline they are supposed to be welded to and drew a thin
      // lip straight across the forehead. Faded in, a ring with no length stays
      // exactly on the hairline, which is what a weld means.
      const active = clamp01(length / (shape.fall || 1));
      // And the clearance has to be capped, because rho(azimuth, height) can
      // only model hair that *wraps* what is under it, never hair that hangs
      // past it. A shoulder is 180mm off the midline against a nape's 55, so
      // uncapped the fall followed the deltoid out to the arm and the figure
      // came back wearing a hood. Capped, the fall stays a column of about the
      // width of the head and passes in front of or behind the shoulder, which
      // is what hair does - it rests on the top of a shoulder, it does not
      // sheathe it.
      // The locks ride on top of that, outward only. Inward would push the mass
      // through the neck it was just given clearance from, and it would also be
      // wrong: a lock separating from the sheet beside it comes forward, it does
      // not carve a trench into the head. They arrive over the first quarter of
      // the fall, because at the hairline the hair is still the one sheet the
      // cap welded to, and they are weighed by `active` like everything else so
      // that a ring with no length stays flat on the hairline.
      const lock =
        shape.locks * active * (ridge + 1) * 0.5 * smoothstep(0, 0.25, s);
      const rho =
        Math.min(
          startIn[a].rho + active * (clear - startIn[a].rho),
          startIn[a].rho * 1.22
        ) + lock;
      // Tapered, hard. Hair is not cut square - a strand thins along its whole
      // length and the ends of a fall are a fraction of the depth of the mass
      // at the crown - and the rim quad at the bottom is drawn from whatever is
      // left, so this number is exactly how thick the blunt edge across the
      // ends looks. At the previous 0.65 it was 7mm of squared-off wall, which
      // at head size is a slab; a quarter of that reads as hair running out.
      const thickness = startOut[a] * (1 - 0.82 * s ** 1.5);
      inner.push(push([Math.sin(signed) * rho, y, centre[2] + Math.cos(signed) * rho]));
      outer.push(push([
        Math.sin(signed) * (rho + thickness),
        y,
        centre[2] + Math.cos(signed) * (rho + thickness),
      ]));
    }
    fallIn.push(inner);
    fallOut.push(outer);
  }

  /* ---- stitching ---- */

  const quad = (a, b, c, d) => indices.push(a, b, c, a, c, d);
  // Pole fan. Outer faces out, inner faces in.
  for (let a = 0; a < SEGMENTS; a += 1) {
    const next = (a + 1) % SEGMENTS;
    indices.push(poleOut, capOut[0][a], capOut[0][next]);
    indices.push(poleIn, capIn[0][next], capIn[0][a]);
  }
  const rings = [...capIn, ...fallIn];
  const ringsOut = [...capOut, ...fallOut];
  for (let ring = 0; ring + 1 < rings.length; ring += 1) {
    for (let a = 0; a < SEGMENTS; a += 1) {
      const next = (a + 1) % SEGMENTS;
      quad(ringsOut[ring][a], ringsOut[ring + 1][a], ringsOut[ring + 1][next], ringsOut[ring][next]);
      quad(rings[ring][a], rings[ring][next], rings[ring + 1][next], rings[ring + 1][a]);
    }
  }
  // The free edge, all the way round. Degenerate wherever the thickness has
  // already faded to nothing, which is exactly where no rim should show.
  const lastIn = rings[rings.length - 1];
  const lastOut = ringsOut[ringsOut.length - 1];
  for (let a = 0; a < SEGMENTS; a += 1) {
    const next = (a + 1) % SEGMENTS;
    quad(lastIn[a], lastOut[a], lastOut[next], lastIn[next]);
  }

  return finish(name, positions, indices, colour, head.index);
}

/**
 * Turn the raw lists into a submesh: drop the slivers, take area-weighted
 * normals, bind it rigidly to the head.
 *
 * The slivers are not a defect to be chased upstream. The grid is deliberately
 * uniform - one ring per step of a parameter, everywhere, whatever the style
 * does at that azimuth - and a style that lets the hair end at the hairline
 * collapses its whole fall onto one ring. Those triangles cover no pixels, but
 * they do have undefined normals, and an undefined normal averaged into a
 * vertex is a black speck on a shiny surface.
 */
function finish(name, positions, indices, colour, jointIndex) {
  const p = Float64Array.from(positions);
  const kept = [];
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vy = p[c * 3 + 1] - p[a * 3 + 1];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (Math.hypot(nx, ny, nz) < 1e-11) continue;
    kept.push(a, b, c);
  }

  const count = p.length / 3;
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < kept.length; i += 3) {
    const [a, b, c] = [kept[i], kept[i + 1], kept[i + 2]];
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vy = p[c * 3 + 1] - p[a * 3 + 1];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[v * 3] += nx;
      normals[v * 3 + 1] += ny;
      normals[v * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < count; v += 1) {
    const length = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    normals[v * 3] /= length;
    normals[v * 3 + 1] /= length;
    normals[v * 3 + 2] /= length;
  }

  const joints = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let v = 0; v < count; v += 1) {
    joints[v * 4] = jointIndex;
    weights[v * 4] = 1;
  }

  return {
    name: `hair-${name}`,
    // A colour of its own marks it trim rather than flesh, which is what keeps
    // the skin atlas and the subsurface terms off it in both renderers.
    primary: false,
    colour,
    hair: true,
    positions: Float32Array.from(p),
    normals,
    uvs: null,
    indices: Uint32Array.from(kept),
    joints,
    weights,
  };
}

/**
 * The template with hair on it: the style's cards and the body type's brows
 * and lashes if the template carries cards (see `withCards`), the style's
 * shell otherwise, and the same template if that leaves nothing to add.
 *
 * Cards are drawn but not measured - they are strands, and where one met a
 * pillow real hair would flatten - so a template given them carries the shell
 * as well, as `hairShell`, for the contact queries to measure in their place
 * (see `surfaceContacts.js`). Nothing draws it.
 *
 * @param {object} template
 * @param {object} [options]
 * @param {string} [options.bodyType] picks the default style and the brows
 * @param {string} [options.style] a key of `HAIR_STYLES`
 * @param {number[]} [options.colour] sRGB 0..1
 */
export function withHair(template, options = {}) {
  const { bodyType = "neutral", style, colour = HAIR_COLOUR } = options;
  const parts = [];
  const shell = buildHair(template, options);
  if (template.cards) {
    const name = style ?? DEFAULT_HAIR[bodyType] ?? "short";
    const face = FACE_TRIMS[bodyType] ?? FACE_TRIMS.neutral;
    parts.push(
      cardSubmesh(template, face.brows, { name: "brows", colour }),
      cardSubmesh(template, face.lashes, { name: "lashes", colour }),
    );
    if (HAIR_STYLES[name]) parts.push(cardSubmesh(template, HAIR_STYLES[name].cards, { name: `hair-${name}`, colour }));
  } else {
    parts.push(shell);
  }
  const added = parts.filter(Boolean);
  if (!added.length) return template;
  return {
    ...template,
    submeshes: [...template.submeshes, ...added],
    ...(template.cards && shell ? { hairShell: shell } : {}),
  };
}

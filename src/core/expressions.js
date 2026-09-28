/**
 * What the face is doing.
 *
 * The scans came with one face, MakeHuman's default: eyes wide, mouth set,
 * nothing moving in it. On a figure whose body is in the middle of something
 * that face is the thing that makes it a mannequin - a person held in an
 * embrace does not look out of it with the stare of a passport photograph.
 *
 * MakeHuman has the answer and it is not ours to invent. Its default skeleton
 * carries the face bones the game-engine rig drops, and its expression library
 * is written as weights on sixty face pose units - brow down, cheek up, upper
 * lid closed, jaw drop - that bend those bones. `scripts/models/make-faces.mjs`
 * poses each body's face in each mix below, in MakeHuman, and keeps how far
 * every vertex of the skin, the brows and the lashes moved; `faces.js` lays
 * that on a template.
 *
 * The mixes are ours, in MakeHuman's units. Its own library is written for a
 * face seen alone and mostly overacts - a laugh with the jaw half open, a
 * smile pulled to one side - and a figure is seen at the size of a hand across
 * the room, where the cues that carry are the lids, the brows and the corners
 * of the mouth. So these lean on those, and open the jaw only as far as a laugh
 * or a gasp does: what shows between the lips then is MakeHuman's teeth and
 * tongue, in the dark of the mouth (see `faces.js`).
 */

/**
 * The expressions, as weights on MakeHuman's face pose units (the names in
 * `poseunits/face-poseunits.json`). Left and right are the figure's own.
 *
 * `neutral` is the scan's face untouched. `soft` is what a face at rest does
 * that the scan's does not: the lids a little lower and the corners of the
 * mouth a little up, which is the difference between someone at ease and
 * someone waiting for a shutter.
 */
export const EXPRESSIONS = {
  neutral: {},
  soft: { LeftUpperLidClosed: 0.22, RightUpperLidClosed: 0.22, MouthLeftPullUp: 0.2, MouthRightPullUp: 0.2, LeftCheekUp: 0.12, RightCheekUp: 0.12 },
  smile: {
    MouthLeftPullUp: 0.6,
    MouthRightPullUp: 0.6,
    LeftCheekUp: 0.5,
    RightCheekUp: 0.5,
    NasolabialDeepener: 0.3,
    LeftLowerLidUp: 0.22,
    RightLowerLidUp: 0.22,
  },
  laugh: {
    MouthLeftPullUp: 0.55,
    MouthRightPullUp: 0.55,
    UpperLipStretched: 0.35,
    NasolabialDeepener: 0.45,
    LeftCheekUp: 0.65,
    RightCheekUp: 0.65,
    LeftLowerLidUp: 0.35,
    RightLowerLidUp: 0.35,
    JawDropStretched: 0.25,
  },
  tender: {
    LeftUpperLidClosed: 0.4,
    RightUpperLidClosed: 0.4,
    MouthLeftPullUp: 0.3,
    MouthRightPullUp: 0.3,
    LeftInnerBrowUp: 0.2,
    RightInnerBrowUp: 0.2,
    LeftCheekUp: 0.2,
    RightCheekUp: 0.2,
  },
  shy: {
    LeftUpperLidClosed: 0.5,
    RightUpperLidClosed: 0.5,
    MouthLeftPullUp: 0.25,
    MouthRightPullUp: 0.25,
    LeftInnerBrowUp: 0.35,
    RightInnerBrowUp: 0.35,
    lowerLipBackward: 0.25,
  },
  pleasure: {
    LeftUpperLidClosed: 0.6,
    RightUpperLidClosed: 0.6,
    LeftInnerBrowUp: 0.55,
    RightInnerBrowUp: 0.55,
    JawDrop: 0.15,
    lowerLipDown: 0.25,
    MouthLeftPullUp: 0.1,
    MouthRightPullUp: 0.1,
  },
  ecstasy: {
    LeftUpperLidClosed: 1,
    RightUpperLidClosed: 1,
    LeftInnerBrowUp: 0.75,
    RightInnerBrowUp: 0.75,
    JawDrop: 0.3,
    lowerLipDown: 0.35,
    UpperLipUp: 0.2,
    NasolabialDeepener: 0.2,
  },
  kiss: { LeftUpperLidClosed: 1, RightUpperLidClosed: 1, LipsKiss: 0.5, LeftInnerBrowUp: 0.15, RightInnerBrowUp: 0.15 },
  closed: { LeftUpperLidClosed: 1, RightUpperLidClosed: 1 },
  surprise: {
    LeftUpperLidOpen: 0.5,
    RightUpperLidOpen: 0.5,
    LeftInnerBrowUp: 0.6,
    RightInnerBrowUp: 0.6,
    LeftOuterBrowUp: 0.6,
    RightOuterBrowUp: 0.6,
    JawDrop: 0.3,
  },
  focused: { LeftBrowDown: 0.4, RightBrowDown: 0.4, LeftLowerLidUp: 0.4, RightLowerLidUp: 0.4, lowerLipUp: 0.2 },
  effort: {
    LeftBrowDown: 0.5,
    RightBrowDown: 0.5,
    LeftLowerLidUp: 0.8,
    RightLowerLidUp: 0.8,
    LeftUpperLidClosed: 0.4,
    RightUpperLidClosed: 0.4,
    NoseWrinkler: 0.4,
    NasolabialDeepener: 0.5,
    UpperLipUp: 0.3,
    JawDrop: 0.08,
  },
  smirk: { MouthLeftPullUp: 0.65, MouthRightPullUp: 0.1, LeftCheekUp: 0.4, LeftLowerLidUp: 0.2, RightOuterBrowUp: 0.3, LeftBrowDown: 0.1 },
};

/** Expression names, in the order a chooser should offer them. */
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS);

/** What a face does when nothing says otherwise. */
export const DEFAULT_EXPRESSION = "soft";

/**
 * The unit the offsets are stored in, in the template's stature-normalised
 * bind space: under two microns on a 1.7m body, and the sixteen bits it is
 * stored in reach 5.6cm, which no expression here moves a vertex by.
 */
export const FACE_STEP = 1e-6;

/**
 * The expression an actor wears.
 *
 * Asked for, it is what was asked. Otherwise a figure whose mouth is on its
 * partner - kissing them, or a neck or a shoulder - has its eyes shut and its
 * lips pursed, and anyone else the resting face.
 *
 * @param {object} actor a solved actor, with `spec` and `index`
 * @param {Array<object>} [contacts] the scene's normalised contacts
 * @returns {string} a key of `EXPRESSIONS`
 */
export function faceExpression(actor, contacts = []) {
  const asked = actor.spec?.expression;
  if (Object.hasOwn(EXPRESSIONS, asked)) return asked;
  const kissing = contacts.some(
    (contact) =>
      contact.strength !== 0 &&
      ["from", "to"].some((end) => contact[`${end}Actor`] === actor.index && contact[end] === "mouth"),
  );
  return kissing ? "kiss" : DEFAULT_EXPRESSION;
}

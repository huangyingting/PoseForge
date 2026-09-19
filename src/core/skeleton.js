/**
 * Anthropometric skeleton.
 *
 * Segment lengths follow the Drillis & Contini proportions (fractions of
 * stature), so every body is internally consistent at any height. Each joint
 * declares its own anatomical axes:
 *
 *   flexion   - sagittal plane, positive moves the distal segment "forward"
 *               for the joint's own anatomy (the knee's axis is therefore
 *               mirrored relative to the hip's, which is what keeps knees from
 *               bending the wrong way)
 *   abduction - frontal plane, positive moves the segment away from the midline
 *   rotation  - about the segment's long axis, positive is internal rotation
 *
 * Angles are authored in degrees in the pose library and clamped to per-joint
 * range-of-motion limits before they ever reach the renderer.
 *
 * Rest pose: standing, arms down, facing +Z, actor's left toward +X.
 */

import {
  DEG,
  clamp,
  mat4Compose,
  mat4Multiply,
  mat4TransformPoint,
  quatFromAxisAngle,
  quatIdentity,
  quatMultiply,
  v3copy,
} from "./math.js";

/** Fractions of stature H. */
const P = {
  pelvisToSpine01: 0.06,
  spine01ToSpine02: 0.075,
  spine02ToSpine03: 0.075,
  spine03ToNeck: 0.07,
  neckToHead: 0.052,
  // chosen so pelvis(0.530) + spine + neck + head sums to exactly 1.0 H
  headHeight: 0.138,
  clavicleOffsetX: 0.02,
  clavicleOffsetY: 0.055,
  // Glenohumeral joint centre, which sits medial to and below the acromion -
  // so this is noticeably less than half the biacromial breadth.
  shoulderOffsetX: 0.099,
  shoulderOffsetY: 0.023,
  upperArm: 0.186,
  forearm: 0.146,
  hand: 0.108,
  // Half the inter-hip-joint distance. The tabulated figure is the *total*
  // separation, ~0.0955 H; this is the offset from the midline to one hip.
  hipOffsetX: 0.0478,
  thigh: 0.245,
  shank: 0.246,
  ankleHeight: 0.039,
  footLength: 0.152,
};

/** `[flexionAxis, abductionAxis, rotationAxis]` builders. `side` is +1 left, -1 right. */
const limbAxes = (side) => ({
  flexion: [-1, 0, 0],
  abduction: [0, 0, side],
  rotation: [0, -side, 0],
});

/** Knee and ankle flex the opposite way to the hip. */
const kneeAxes = (side) => ({
  flexion: [1, 0, 0],
  abduction: [0, 0, side],
  rotation: [0, -side, 0],
});

/** Midline joints: positive abduction bends toward the actor's left. */
const axialAxes = () => ({
  flexion: [-1, 0, 0],
  abduction: [0, 0, 1],
  rotation: [0, 1, 0],
});

/**
 * Range of motion in degrees, `[min, max]` per channel. Deliberately a little
 * tighter than clinical extremes so solver corrections stay plausible.
 */
const ROM = {
  spine: { flexion: [-25, 45], abduction: [-30, 30], rotation: [-35, 35] },
  neck: { flexion: [-45, 55], abduction: [-38, 38], rotation: [-70, 70] },
  head: { flexion: [-30, 30], abduction: [-20, 20], rotation: [-45, 45] },
  clavicle: { flexion: [-20, 20], abduction: [-12, 28], rotation: [-10, 10] },
  shoulder: { flexion: [-60, 170], abduction: [-35, 165], rotation: [-85, 85] },
  elbow: { flexion: [0, 148], abduction: [-5, 5], rotation: [-80, 85] },
  wrist: { flexion: [-70, 75], abduction: [-25, 35], rotation: [-15, 15] },
  hip: { flexion: [-25, 135], abduction: [-25, 70], rotation: [-45, 45] },
  knee: { flexion: [0, 150], abduction: [-4, 4], rotation: [-12, 12] },
  ankle: { flexion: [-45, 25], abduction: [-18, 18], rotation: [-20, 20] },
  toe: { flexion: [-30, 45], abduction: [0, 0], rotation: [0, 0] },
  root: { flexion: [-180, 180], abduction: [-180, 180], rotation: [-180, 180] },
};

/**
 * Bone table. `offset` is in parent space, scaled by stature at build time.
 * `kind` selects the ROM entry; `side` drives axis mirroring.
 */
function boneTable(shoulderScale, hipScale) {
  const sx = P.shoulderOffsetX * shoulderScale;
  const cx = P.clavicleOffsetX * shoulderScale;
  const hx = P.hipOffsetX * hipScale;

  const arm = (side, name) => {
    const s = side === "left" ? 1 : -1;
    return [
      {
        name: `clavicle_${name}`,
        parent: "spine03",
        offset: [s * cx, P.clavicleOffsetY, 0],
        kind: "clavicle",
        side: s,
        axes: limbAxes(s),
      },
      {
        name: `shoulder_${name}`,
        parent: `clavicle_${name}`,
        offset: [s * (sx - cx), P.shoulderOffsetY, 0],
        kind: "shoulder",
        side: s,
        axes: limbAxes(s),
      },
      {
        name: `elbow_${name}`,
        parent: `shoulder_${name}`,
        offset: [0, -P.upperArm, 0],
        kind: "elbow",
        side: s,
        axes: limbAxes(s),
      },
      {
        name: `wrist_${name}`,
        parent: `elbow_${name}`,
        offset: [0, -P.forearm, 0],
        kind: "wrist",
        side: s,
        axes: limbAxes(s),
      },
      {
        name: `hand_${name}`,
        parent: `wrist_${name}`,
        offset: [0, -P.hand * 0.55, 0],
        kind: "wrist",
        side: s,
        axes: limbAxes(s),
        tip: true,
      },
    ];
  };

  const leg = (side, name) => {
    const s = side === "left" ? 1 : -1;
    return [
      {
        name: `hip_${name}`,
        parent: "pelvis",
        // hip joint centres sit at the pelvis origin, so ankle height lands on
        // the anthropometric 0.039 H
        offset: [s * hx, 0, 0],
        kind: "hip",
        side: s,
        axes: limbAxes(s),
      },
      {
        name: `knee_${name}`,
        parent: `hip_${name}`,
        offset: [0, -P.thigh, 0],
        kind: "knee",
        side: s,
        axes: kneeAxes(s),
      },
      {
        name: `ankle_${name}`,
        parent: `knee_${name}`,
        offset: [0, -P.shank, 0],
        kind: "ankle",
        side: s,
        axes: kneeAxes(s),
      },
      {
        name: `toe_${name}`,
        parent: `ankle_${name}`,
        offset: [0, -P.ankleHeight * 0.55, P.footLength * 0.72],
        kind: "toe",
        side: s,
        axes: kneeAxes(s),
        tip: true,
      },
    ];
  };

  return [
    { name: "pelvis", parent: null, offset: [0, 0, 0], kind: "root", side: 1, axes: axialAxes() },
    { name: "spine01", parent: "pelvis", offset: [0, P.pelvisToSpine01, 0], kind: "spine", side: 1, axes: axialAxes() },
    { name: "spine02", parent: "spine01", offset: [0, P.spine01ToSpine02, 0], kind: "spine", side: 1, axes: axialAxes() },
    { name: "spine03", parent: "spine02", offset: [0, P.spine02ToSpine03, 0], kind: "spine", side: 1, axes: axialAxes() },
    { name: "neck", parent: "spine03", offset: [0, P.spine03ToNeck, 0], kind: "neck", side: 1, axes: axialAxes() },
    { name: "head", parent: "neck", offset: [0, P.neckToHead, 0], kind: "head", side: 1, axes: axialAxes() },
    { name: "headTop", parent: "head", offset: [0, P.headHeight, 0], kind: "head", side: 1, axes: axialAxes(), tip: true },
    ...arm("left", "l"),
    ...arm("right", "r"),
    ...leg("left", "l"),
    ...leg("right", "r"),
  ];
}

/**
 * Default stature and build per body preset.
 *
 * `girth` is 1 for every preset on purpose. The body's circumference tables in
 * `body.js` are already sex-specific, so a sex factor here would be counted
 * twice; `girth` exists solely to carry the user-facing `build` knob.
 */
export const BODY_PRESETS = {
  female: { stature: 1.66, shoulderScale: 0.93, hipScale: 1.07, girth: 1, chest: "female" },
  male: { stature: 1.78, shoulderScale: 1.06, hipScale: 0.95, girth: 1, chest: "male" },
  neutral: { stature: 1.72, shoulderScale: 1.0, hipScale: 1.0, girth: 1, chest: "neutral" },
};

/** Standing hip-joint height as a fraction of stature. */
export const HIP_HEIGHT_RATIO = 0.53;

export class Skeleton {
  /**
   * @param {object} options
   * @param {"female"|"male"|"neutral"} [options.bodyType]
   * @param {number} [options.stature] metres; overrides the preset
   * @param {number} [options.build] 0.8 slim .. 1.3 heavy, scales soft-tissue girth
   */
  constructor({ bodyType = "neutral", stature, build = 1 } = {}) {
    const preset = BODY_PRESETS[bodyType] || BODY_PRESETS.neutral;
    this.bodyType = bodyType;
    this.stature = stature || preset.stature;
    this.build = build;
    this.girth = preset.girth * build;
    this.chestType = preset.chest;
    this.hipHeight = this.stature * HIP_HEIGHT_RATIO;

    this.bones = [];
    this.index = new Map();
    for (const entry of boneTable(preset.shoulderScale, preset.hipScale)) {
      const bone = {
        name: entry.name,
        parent: entry.parent,
        parentIndex: entry.parent == null ? -1 : this.index.get(entry.parent),
        offset: entry.offset.map((value) => value * this.stature),
        kind: entry.kind,
        side: entry.side,
        axes: entry.axes,
        rom: ROM[entry.kind] || ROM.spine,
        tip: Boolean(entry.tip),
        children: [],
      };
      this.index.set(bone.name, this.bones.length);
      this.bones.push(bone);
    }
    for (const bone of this.bones) {
      if (bone.parentIndex >= 0) this.bones[bone.parentIndex].children.push(this.index.get(bone.name));
    }

    /** Rest length of each bone (distance to its parent). */
    for (const bone of this.bones) {
      bone.length = Math.hypot(...bone.offset);
    }
  }

  boneIndex(name) {
    const index = this.index.get(name);
    if (index === undefined) throw new Error(`Unknown bone: ${name}`);
    return index;
  }

  bone(name) {
    return this.bones[this.boneIndex(name)];
  }

  /** Rest-pose distance between two bones' origins, walking the chain. */
  segmentLength(fromName, toName) {
    let index = this.boneIndex(toName);
    const stop = this.boneIndex(fromName);
    let total = 0;
    while (index !== stop && index >= 0) {
      total += this.bones[index].length;
      index = this.bones[index].parentIndex;
    }
    return index === stop ? total : NaN;
  }

  /**
   * Number of joints between two bones in the skeleton graph.
   *
   * Bones that are one or two joints apart own volumes that are *authored* to
   * interpenetrate - the two thighs share the pelvis, the deltoid sinks into
   * the ribcage - so this is what self-collision exemption keys off, rather
   * than a hand-maintained table of group pairs.
   */
  boneDistance(aName, bName) {
    const a = this.boneIndex(aName);
    const b = this.boneIndex(bName);
    if (a === b) return 0;
    const ancestorsOfA = new Map();
    let steps = 0;
    for (let i = a; i >= 0; i = this.bones[i].parentIndex) ancestorsOfA.set(i, steps++);
    steps = 0;
    for (let i = b; i >= 0; i = this.bones[i].parentIndex) {
      if (ancestorsOfA.has(i)) return ancestorsOfA.get(i) + steps;
      steps += 1;
    }
    return Infinity;
  }

  /** Clamp an angle triple (degrees) to this joint's range of motion. */
  clampAngles(boneName, angles) {
    const { rom } = this.bone(boneName);
    return {
      flexion: clamp(angles.flexion ?? 0, rom.flexion[0], rom.flexion[1]),
      abduction: clamp(angles.abduction ?? 0, rom.abduction[0], rom.abduction[1]),
      rotation: clamp(angles.rotation ?? 0, rom.rotation[0], rom.rotation[1]),
    };
  }

  /**
   * Anatomical angles (degrees) -> local quaternion, applied as intrinsic
   * rotations flexion -> abduction -> rotation.
   */
  quaternionFromAngles(boneName, angles, { clamped = true } = {}) {
    const bone = this.bone(boneName);
    const a = clamped ? this.clampAngles(boneName, angles) : {
      flexion: angles.flexion ?? 0,
      abduction: angles.abduction ?? 0,
      rotation: angles.rotation ?? 0,
    };
    let q = quatFromAxisAngle(bone.axes.flexion, a.flexion * DEG);
    q = quatMultiply(q, quatFromAxisAngle(bone.axes.abduction, a.abduction * DEG));
    q = quatMultiply(q, quatFromAxisAngle(bone.axes.rotation, a.rotation * DEG));
    return q;
  }

  /** A pose object with every joint at its neutral angle. */
  restPose() {
    const joints = {};
    for (const bone of this.bones) {
      joints[bone.name] = { flexion: 0, abduction: 0, rotation: 0 };
    }
    return joints;
  }
}

/**
 * Evaluate world matrices for a skeleton given a pose.
 *
 * @param {Skeleton} skeleton
 * @param {object} pose `{ root: {position, quaternion}, joints: {bone: angles} }`
 * @param {object} [overrides] per-bone local quaternions that bypass the angle
 *        channels entirely; the IK and collision solvers write here.
 * @returns {{matrices: number[][], positions: number[][], quaternions: number[][]}}
 */
export function evaluatePose(skeleton, pose, overrides = null) {
  const count = skeleton.bones.length;
  const matrices = new Array(count);
  const positions = new Array(count);
  const quaternions = new Array(count);

  const rootPosition = pose.root?.position ?? [0, 0, 0];
  const rootQuaternion = pose.root?.quaternion ?? quatIdentity();
  const rootMatrix = mat4Compose(rootPosition, rootQuaternion);

  for (let i = 0; i < count; i += 1) {
    const bone = skeleton.bones[i];
    const override = overrides?.[bone.name];
    const local =
      override ??
      (bone.parentIndex < 0
        ? quatIdentity()
        : skeleton.quaternionFromAngles(bone.name, pose.joints?.[bone.name] ?? {}));
    const localMatrix = mat4Compose(bone.offset, local);
    matrices[i] =
      bone.parentIndex < 0
        ? mat4Multiply(rootMatrix, localMatrix)
        : mat4Multiply(matrices[bone.parentIndex], localMatrix);
    positions[i] = [matrices[i][12], matrices[i][13], matrices[i][14]];
    quaternions[i] = local;
  }

  return { matrices, positions, quaternions };
}

/** Convenience: world position of a named bone under a pose. */
export function bonePosition(skeleton, evaluated, name) {
  return v3copy(evaluated.positions[skeleton.boneIndex(name)]);
}

/** Transform a point given in a bone's local space into world space. */
export function boneToWorld(skeleton, evaluated, name, localPoint) {
  return mat4TransformPoint(evaluated.matrices[skeleton.boneIndex(name)], localPoint);
}

export { ROM };

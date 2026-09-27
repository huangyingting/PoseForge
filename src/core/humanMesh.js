/**
 * The photoreal body mesh, driven by our own skeleton.
 *
 * `body.js` builds a signed distance field that is exact, measurable and
 * collides correctly - and looks like a mannequin, because ~50 round cones is
 * what a mannequin is. This module is the other half: a scanned-quality human
 * mesh, skinned to the same posed skeleton, so the picture is a person while
 * the solver keeps reasoning about the field.
 *
 * The two must not drift apart. Everything here is arranged so they cannot:
 * the mesh's joints are placed at *our* joint positions rather than the
 * model's, so a hand the solver put on a hip is drawn on that hip.
 * `scripts/validate-skin.mjs` measures the remaining gap between the drawn
 * surface and the collided one and reports it as a number.
 *
 * ## Retargeting
 *
 * The bundled bodies are MakeHuman exports and their rest pose is an A-pose:
 * arms out at about 45 degrees. Ours is arms straight down. So the usual
 * retarget - take each bone's rotation away from its own rest pose and replay
 * it on the other rig - is wrong here in the one case that matters most, the
 * rest pose itself: both rigs sit at zero, the delta is identity, and the
 * figure renders in an A-pose no matter what the pose library says.
 *
 * What this does instead is align first and take deltas after. A root-to-leaf
 * pass rotates each model joint until its bone points the way ours points in
 * *our* rest pose, and stores that as the joint's bind correction. A pose then
 * composes our bone's world rotation onto that correction. At our rest pose the
 * composition is the correction alone, which is by construction arms-down.
 *
 * Joints we do not drive - the four fingers and thumb of each hand - keep their
 * local transform relative to the aligned parent, so they ride along with the
 * hand in their modelled rest curl. That is how the render gets fingers at all:
 * our rig has no finger bones and never will, because nothing in the language
 * layer can ask for one.
 */

import { nodeLocalMatrix, nodeParents, parseGLB, readAccessor } from "./gltf.js";
import { applyHang, applyHangDirection, bodyDistance, bodyNormal, buildBodyVolumes, poseVolumes, smoothMin } from "./body.js";
import {
  mat4Compose,
  mat4InvertRigid,
  mat4Multiply,
  quatFromAxisAngle,
  quatFromUnitVectors,
  v3cross,
  v3dot,
  v3len,
  v3neg,
  v3normalize,
  v3sub,
} from "./math.js";
import { fingerFlexion, fingerSplay } from "./handPose.js";
import { Skeleton, evaluatePose, HIP_HEIGHT_RATIO } from "./skeleton.js";
// The one import that crosses out of `src/core`, and it does not cross out of
// the dependency-free zone: `meshBuilder` is listed alongside the core in
// `tests/architecture.test.js` precisely because it is pure geometry over the
// core's own field. `featureRelief` needs an isosurface mesher and there is no
// reason for a second one to exist.
import { buildBodyMesh } from "../render/meshBuilder.js";

/**
 * Model joint -> our bone.
 *
 * MakeHuman's game-engine skeleton names the wrist `hand_*` because the finger
 * chains hang off it; ours calls that `wrist_*` and keeps `hand_*` for the tip
 * that marks the middle of the palm. They are the same joint under two names,
 * which is worth stating because getting it wrong puts the mesh's wrist where
 * our palm centre is and shortens every forearm by half a hand.
 */
export const JOINT_MAP = {
  pelvis: "pelvis",
  spine_01: "spine01",
  spine_02: "spine02",
  spine_03: "spine03",
  neck_01: "neck",
  head: "head",
  clavicle_l: "clavicle_l", upperarm_l: "shoulder_l", lowerarm_l: "elbow_l", hand_l: "wrist_l",
  clavicle_r: "clavicle_r", upperarm_r: "shoulder_r", lowerarm_r: "elbow_r", hand_r: "wrist_r",
  thigh_l: "hip_l", calf_l: "knee_l", foot_l: "ankle_l", ball_l: "toe_l",
  thigh_r: "hip_r", calf_r: "knee_r", foot_r: "ankle_r", ball_r: "toe_r",
};

/**
 * Which of our bones defines each bone's *direction*.
 *
 * A bone with several children has no intrinsic direction - the wrist has five
 * - so the alignment pass needs to be told which child is the bone's axis. It
 * is also what makes the pass skip the joints that should not be straightened:
 * the wrist's own child is the palm tip, which the model has no joint for, so
 * the wrist inherits the forearm's correction and keeps its modelled angle.
 */
const PRIMARY_CHILD = {
  pelvis: "spine01",
  spine01: "spine02",
  spine02: "spine03",
  spine03: "neck",
  neck: "head",
  head: "headTop",
  ...Object.fromEntries(["l", "r"].flatMap((s) => [
    [`clavicle_${s}`, `shoulder_${s}`],
    [`shoulder_${s}`, `elbow_${s}`],
    [`elbow_${s}`, `wrist_${s}`],
    [`wrist_${s}`, `hand_${s}`],
    [`hip_${s}`, `knee_${s}`],
    [`knee_${s}`, `ankle_${s}`],
    [`ankle_${s}`, `toe_${s}`],
  ])),
};

/**
 * Our axial chain, pelvis to crown, in order.
 *
 * The two rigs disagree about the spine in a way they do not disagree about the
 * limbs. Knee, ankle and hip land within 5mm of ours; every axial joint is out
 * by centimetres, because the rigs divide the same trunk differently rather
 * than because either is wrong. MakeHuman puts `spine_03` at 0.664 of stature
 * and nothing between there and the neck at 0.847; we put `spine03` at 0.740
 * and `neck` at 0.810. Placing each model joint on its namesake therefore lifts
 * the upper ribcage 131mm while dropping the neck 64mm, and the 195mm of trunk
 * caught between them has to go somewhere - it goes into the trapezius, as two
 * shoulder humps and a head sunk into them.
 *
 * So the axial joints are placed by *arc length* instead. Each model joint
 * keeps the fraction of the chain it sits at in its own rest pose, and is put
 * at that same fraction along our posed chain. The ends still land exactly
 * where our rig says - pelvis on pelvis, crown on `headTop` - so stature and
 * seating are ours, but the spacing in between is the model's and the trunk
 * keeps its shape. The chain bends with the pose, so a fraction follows a
 * curled spine rather than a straight line.
 */
const AXIS_BONES = ["pelvis", "spine01", "spine02", "spine03", "neck", "head", "headTop"];

/** Rotation-only copy of a 4x4, as a 4x4. */
const rotationOf = (m) => [m[0], m[1], m[2], 0, m[4], m[5], m[6], 0, m[8], m[9], m[10], 0, 0, 0, 0, 1];

/** `m` with its translation replaced. */
const withTranslation = (m, t) => {
  const out = m.slice();
  out[12] = t[0];
  out[13] = t[1];
  out[14] = t[2];
  return out;
};

/**
 * glTF is Y-up with -Z forward; we are Y-up with +Z forward, and these models
 * are Blender exports that never had the Z-up conversion applied, so the model
 * arrives Z-up with -Y forward. One change of basis handles it: (x, y, z)
 * becomes (x, z, -y). It is applied as `C M C^-1` rather than to positions
 * alone, so chained joint matrices keep composing.
 */
const C = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const C_INV = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
const toOurFrame = (m) => mat4Multiply(C, mat4Multiply(m, C_INV));
const pointToOurFrame = (x, y, z) => [x, z, -y];

/**
 * Strip a uniform scale from the rotation basis of a transform.
 *
 * MakeHuman's Blender export puts a 0.1 scale on the armature root, which every
 * joint inherits. It cancels against the inverse bind matrices so it never
 * shows - but it does mean the joint matrices are not rigid, and a rigid
 * inverse of a scaled matrix is silently, spectacularly wrong.
 *
 * Only the basis is scaled, not the translation. The scale sits at the root
 * with every local translation authored ten times over to match, so the world
 * translations are already in the mesh's own units and dividing them too puts
 * every joint ten times too far from the origin - which skins a figure into a
 * starburst eleven metres wide. Read it as a scale applied on the right, in
 * bind space, rather than on the left in world space.
 */
function unscale(m) {
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  if (Math.abs(sx - sy) > 1e-3 * sx || Math.abs(sx - sz) > 1e-3 * sx) {
    throw new Error(`Non-uniform joint scale in model (${sx}, ${sy}, ${sz})`);
  }
  const out = m.slice();
  for (let c = 0; c < 3; c += 1) {
    for (let r = 0; r < 3; r += 1) out[c * 4 + r] /= sx;
  }
  return out;
}

/**
 * Read a GLB body into a template: geometry normalised to unit stature, plus
 * the per-joint bind corrections that let our skeleton drive it.
 *
 * The template is independent of any one actor - stature, and therefore every
 * absolute length, is applied at skin time - so the two bundled bodies are
 * parsed once and shared by every figure in a scene.
 *
 * @param {ArrayBuffer|Uint8Array} bytes contents of a `.glb`
 * @param {object} [options]
 * @param {string[]} [options.skipMeshes] mesh names to leave out
 */
export function buildHumanTemplate(bytes, { skipMeshes = [] } = {}) {
  const gltf = parseGLB(bytes);
  const { json } = gltf;
  const skin = json.skins?.[0];
  if (!skin) throw new Error("Model has no skin");

  const parents = nodeParents(json);
  const worldCache = new Array(json.nodes.length).fill(null);
  const nodeWorld = (i) => {
    if (worldCache[i]) return worldCache[i];
    const local = nodeLocalMatrix(json.nodes[i]);
    worldCache[i] = parents[i] < 0 ? local : mat4Multiply(nodeWorld(parents[i]), local);
    return worldCache[i];
  };

  // --- geometry ---------------------------------------------------------
  // Stature is the mesh's own height, not a number from the file: it is what
  // "unit stature" has to mean for the body to stand the right height when
  // scaled, and the only mesh that counts is the body - the eyebrows are a
  // separate mesh sitting partway up the head.
  const submeshes = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [meshIndex, mesh] of json.meshes.entries()) {
    if (skipMeshes.includes(mesh.name)) continue;
    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? 4) !== 4) continue; // triangles only
      const position = readAccessor(gltf, primitive.attributes.POSITION);
      const normal = primitive.attributes.NORMAL !== undefined ? readAccessor(gltf, primitive.attributes.NORMAL) : null;
      const uv = primitive.attributes.TEXCOORD_0 !== undefined ? readAccessor(gltf, primitive.attributes.TEXCOORD_0) : null;
      const joints = readAccessor(gltf, primitive.attributes.JOINTS_0, false);
      const weights = readAccessor(gltf, primitive.attributes.WEIGHTS_0);
      const indices = readAccessor(gltf, primitive.indices);
      const count = position.length / 3;

      const positions = new Float32Array(count * 3);
      const normals = new Float32Array(count * 3);
      for (let v = 0; v < count; v += 1) {
        const p = pointToOurFrame(position[v * 3], position[v * 3 + 1], position[v * 3 + 2]);
        positions.set(p, v * 3);
        if (meshIndex === 0) {
          if (p[1] < minY) minY = p[1];
          if (p[1] > maxY) maxY = p[1];
        }
        if (normal) normals.set(pointToOurFrame(normal[v * 3], normal[v * 3 + 1], normal[v * 3 + 2]), v * 3);
      }

      const material = json.materials?.[primitive.material];
      submeshes.push({
        name: mesh.name,
        // The body is mesh 0 and everything after it is trim - on these models,
        // the eye proxy. The distinction matters at draw time: the body takes
        // the per-actor skin colour so a pair of figures can be told apart,
        // while trim keeps whatever colour it was authored with.
        primary: meshIndex === 0,
        colour: (material?.pbrMetallicRoughness?.baseColorFactor ?? [0.8, 0.8, 0.8]).slice(0, 3),
        positions,
        normals: smoothNormals(positions, normals, Uint32Array.from(indices)),
        uvs: uv ? Float32Array.from(uv) : null,
        indices: Uint32Array.from(indices),
        joints: Uint16Array.from(joints),
        weights: Float32Array.from(weights),
      });
    }
  }
  const height = maxY - minY;
  if (!(height > 0)) throw new Error("Model has no measurable height");
  for (const submesh of submeshes) {
    for (let i = 0; i < submesh.positions.length; i += 3) {
      submesh.positions[i] /= height;
      submesh.positions[i + 1] = (submesh.positions[i + 1] - minY) / height;
      submesh.positions[i + 2] /= height;
    }
  }

  // --- joints -----------------------------------------------------------
  const jointNodes = skin.joints;
  const indexOfNode = new Map(jointNodes.map((node, i) => [node, i]));
  const joints = jointNodes.map((node, i) => {
    const rest = unscale(toOurFrame(nodeWorld(node)));
    rest[12] /= height;
    rest[13] = (rest[13] - minY) / height;
    rest[14] /= height;
    let parent = parents[node];
    while (parent >= 0 && !indexOfNode.has(parent)) parent = parents[parent];
    return {
      name: json.nodes[node].name,
      index: i,
      parent: parent >= 0 ? indexOfNode.get(parent) : -1,
      bone: JOINT_MAP[json.nodes[node].name] ?? null,
      rest,
      inverseBind: mat4InvertRigid(rest),
    };
  });
  // Parents come before children in every export we read, but nothing in the
  // format promises it and the alignment pass below is order-dependent.
  const order = [...joints.keys()].sort((a, b) => depth(joints, a) - depth(joints, b));
  for (const joint of joints) {
    joint.localRest = joint.parent < 0
      ? joint.rest
      : mat4Multiply(joints[joint.parent].inverseBind, joint.rest);
  }
  measureAxis(joints);
  measureFingers(joints);
  const proxy = submeshes.findIndex((s) => !s.primary);
  if (proxy >= 0) {
    const zones = splitEyes(submeshes[proxy]);
    if (zones.length) submeshes.splice(proxy, 1, ...zones);
  }

  return { submeshes, joints, order, height, jointByBone: byBone(joints) };
}

/**
 * Smooth the per-face normals the models are exported with.
 *
 * Both bodies arrive flat-shaded. The file carries a normal per vertex, as it
 * must, but the exporter split every vertex once per face it touches and gave
 * each copy that face's own normal - 46,658 vertices over 13,380 distinct
 * positions, and at 99.6% of those positions the copies disagree, by 25 degrees
 * on average. Drawn as given, a 27,000-triangle scan of a human being shades
 * like a low-poly model: the chest and upper arms break into flat quadrilateral
 * patches an inch across, which no amount of work on the lighting can fix,
 * because the lighting is doing exactly what the normals ask.
 *
 * So the normals are rebuilt here: area-weighted average of the faces meeting
 * at each position, which is the normal the surface would have had if the
 * exporter had not thrown it away. Area weighting matters on this mesh because
 * the triangulation of its quads is uneven, and counting a sliver the same as
 * the triangle beside it pulls the average towards whichever way the diagonals
 * happened to fall.
 *
 * Faces meeting at more than `crease` are left out of each other's averages, so
 * the edges that are supposed to be sharp stay sharp: the rim of a nostril, the
 * line between the lips, the fold behind the ear. Those are places where the
 * surface genuinely doubles back on itself, and averaging across them would
 * turn a crisp opening into a smear. Everything on the body proper is far
 * inside the threshold and comes out fully smooth.
 */
function smoothNormals(positions, normals, indices, crease = Math.cos((70 * Math.PI) / 180)) {
  const count = positions.length / 3;
  const weld = new Int32Array(count);
  const seen = new Map();
  for (let v = 0; v < count; v += 1) {
    const key = `${Math.round(positions[v * 3] * 1e5)},${Math.round(positions[v * 3 + 1] * 1e5)},${Math.round(positions[v * 3 + 2] * 1e5)}`;
    let index = seen.get(key);
    if (index === undefined) {
      index = seen.size;
      seen.set(key, index);
    }
    weld[v] = index;
  }

  // Every face meeting each welded position, as a vector whose length is twice
  // the face's area - so summing a list of them is already area weighting.
  const incident = Array.from({ length: seen.size }, () => []);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    const u = [0, 1, 2].map((k) => positions[b * 3 + k] - positions[a * 3 + k]);
    const w = [0, 1, 2].map((k) => positions[c * 3 + k] - positions[a * 3 + k]);
    const face = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const area = Math.hypot(...face);
    if (!(area > 0)) continue;
    const unit = face.map((v) => v / area);
    for (const corner of [a, b, c]) incident[weld[corner]].push({ face, unit });
  }

  const out = new Float32Array(normals.length);
  for (let v = 0; v < count; v += 1) {
    // The vertex's own normal is its face's normal, and so is what decides
    // which side of a crease it is on.
    const own = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
    let x = 0, y = 0, z = 0;
    for (const { face, unit } of incident[weld[v]]) {
      if (unit[0] * own[0] + unit[1] * own[1] + unit[2] * own[2] < crease) continue;
      x += face[0];
      y += face[1];
      z += face[2];
    }
    const length = Math.hypot(x, y, z);
    if (length > 0) {
      out[v * 3] = x / length;
      out[v * 3 + 1] = y / length;
      out[v * 3 + 2] = z / length;
    } else {
      out.set(own, v * 3);
    }
  }
  return out;
}

/**
 * Give the eyes an iris, a pupil and a white.
 *
 * The models do ship eyes. What looked like a face with two dark slits for
 * sockets is a face with two eyeballs in it, because MakeHuman keeps the globes
 * in a proxy mesh - here exported under the name `high-poly` - that is textured
 * rather than coloured, and a texture is exactly what did not survive the trip
 * to glTF. Every vertex of both eyes therefore carries one flat material, and
 * that material's base colour is the dark brown of the iris the texture would
 * have painted. The whites are brown, the pupils are brown, the irises are
 * brown, and the result reads as an empty orbit.
 *
 * So there is nothing to model, only something to measure. The proxy is two
 * clusters, one either side of the midline, and each is a sphere to within
 * 0.9mm rms - 32mm across on the female model, 31mm on the male - covering the
 * front of the globe from a little behind the equator forward. Fitting that
 * sphere gives the centre; the cap only exists in front, so the direction from
 * the fitted centre to the cluster's own centroid is the direction the eye
 * looks, without having to assume it looks straight down +z. (It nearly does,
 * but only nearly: the two eyes toe outwards by about a degree and a quarter.)
 *
 * The zone boundaries are measured the same way rather than chosen. Plot each
 * vertex's distance from the fitted sphere against its angle off that axis and
 * the surface is *dished* - 2.4mm below the sphere at the pole, crossing back
 * through zero at 18 degrees - because the mesh models the iris as a recess
 * under a corneal dome, which is the usual way to fake refraction without
 * refracting anything. That crossing is the limbus, and it is at 18 degrees on
 * both eyes of both models. The pupil is the bottom of the dish, inside about
 * 6 degrees. At the fitted radius those come out as a 10mm iris and a 3.3mm
 * pupil, which is a real eye in a bright room.
 *
 * Splitting by triangle rather than colouring by vertex is what keeps this
 * inside the existing pipeline: a submesh already carries one flat colour, so
 * three submeshes carry three, and nothing downstream has to learn about eyes.
 */
const EYE_ZONES = [
  // Off-white, not white. Sclera is nearer bone than paper, and a pure white
  // ball in a face lit hard enough to model a cheek clips to a flat disc.
  { name: "eyeSclera", colour: [0.86, 0.84, 0.81], limit: Math.PI },
  // Dark brown, which is what "black eyes" are. Every human iris is brown,
  // amber, green or blue; none is black, and painting one black removes the
  // only thing that tells a viewer where someone is looking - the boundary
  // between iris and pupil. At 0.13/0.09/0.06 the two are four levels apart in
  // shadow and a dozen under the key, so the pupil still reads as a hole while
  // the iris reads black at any distance a whole figure is viewed from. The
  // 0.3/0.19/0.1 this replaced is a mid-brown European iris.
  { name: "eyeIris", colour: [0.13, 0.09, 0.06], limit: (18 * Math.PI) / 180 },
  { name: "eyePupil", colour: [0.035, 0.03, 0.028], limit: (6 * Math.PI) / 180 },
];

/**
 * The palpebral fissure these models have, as half-width and half-height in
 * stature fractions - 22mm by 11mm at the 1.72m they were built at, measured by
 * casting rays at the face and finding where the first surface hit drops from
 * the cheek to the back of the orbit. It is the aperture the lids leave, and so
 * the only thing that shades an eye. See `eyeOcclusion`.
 */
const FISSURE = [0.011 / 1.72, 0.0055 / 1.72];

function splitEyes(proxy) {
  const count = proxy.positions.length / 3;
  const eyes = [-1, 1].map((side) => fitEye(proxy, side)).filter(Boolean);
  if (eyes.length !== 2) return [];

  // Which eye a vertex belongs to, and where it sits on that eye.
  const zone = new Int32Array(count);
  const occlusion = new Float32Array(count);
  // The globe's own normals, replacing the ones in the file. Inside the limbus
  // the modelled surface is a dish, and a dish lit by a hard key and painted a
  // single flat colour is a handful of facets catching the light at different
  // angles - which is not an iris, it is a crumpled foil disc. The dish is there
  // to refract a texture that did not arrive, so with the texture gone the
  // sphere it was cut out of is the honest surface. Outside the limbus this
  // changes nothing: the proxy is already spherical to 0.9mm there.
  const normals = new Float32Array(count * 3);
  for (let v = 0; v < count; v += 1) {
    const eye = eyes[proxy.positions[v * 3] < 0 ? 0 : 1];
    const d = [0, 1, 2].map((c) => proxy.positions[v * 3 + c] - eye.centre[c]);
    const length = Math.hypot(...d) || 1;
    for (let c = 0; c < 3; c += 1) normals[v * 3 + c] = d[c] / length;
    const along = (d[0] * eye.axis[0] + d[1] * eye.axis[1] + d[2] * eye.axis[2]) / length;
    const angle = Math.acos(Math.max(-1, Math.min(1, along)));
    zone[v] = EYE_ZONES.reduce((best, z, i) => (angle <= z.limit ? i : best), 0);
    occlusion[v] = eyeOcclusion(d, eye);
  }

  return EYE_ZONES.map((definition, index) => {
    // A triangle goes to the narrowest zone all three of its corners reach, so
    // the limbus lands on an edge of the mesh rather than cutting across faces.
    const keep = [];
    for (let i = 0; i < proxy.indices.length; i += 3) {
      const z = Math.min(zone[proxy.indices[i]], zone[proxy.indices[i + 1]], zone[proxy.indices[i + 2]]);
      if (z === index) keep.push(i);
    }
    return { ...definition, ...extract(proxy, keep, normals, occlusion), primary: false };
  }).filter((part) => part.indices.length > 0);
}

/** Least-squares sphere through one side's vertices, plus the gaze axis. */
function fitEye(proxy, side) {
  const points = [];
  for (let v = 0; v < proxy.positions.length / 3; v += 1) {
    if (Math.sign(proxy.positions[v * 3]) !== side) continue;
    points.push([proxy.positions[v * 3], proxy.positions[v * 3 + 1], proxy.positions[v * 3 + 2]]);
  }
  if (points.length < 32) return null;

  const centroid = [0, 1, 2].map((c) => points.reduce((sum, p) => sum + p[c], 0) / points.length);
  // Gradient descent on the radial residual. A cap is a badly conditioned thing
  // to fit a sphere to and the closed-form algebraic fit drifts along the axis
  // on one; this converges from the centroid in well under the iterations here.
  const centre = centroid.slice();
  const meanRadius = () =>
    points.reduce((sum, p) => sum + Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]), 0) /
    points.length;
  for (let step = 0; step < 80; step += 1) {
    const r = meanRadius();
    const gradient = [0, 0, 0];
    for (const p of points) {
      const d = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
      const length = Math.hypot(...d) || 1;
      for (let c = 0; c < 3; c += 1) gradient[c] += (d[c] * (1 - r / length)) / points.length;
    }
    for (let c = 0; c < 3; c += 1) centre[c] += gradient[c] * 2;
  }

  const axis = v3normalize([0, 1, 2].map((c) => centroid[c] - centre[c]));
  return { centre, axis, radius: meanRadius() };
}

/** Copy the vertices `keep`'s triangles use into a submesh of their own. */
function extract(proxy, keep, normals, occlusion) {
  const remap = new Map();
  const indices = [];
  for (const i of keep) {
    for (let c = 0; c < 3; c += 1) {
      const v = proxy.indices[i + c];
      if (!remap.has(v)) remap.set(v, remap.size);
      indices.push(remap.get(v));
    }
  }
  const out = {
    positions: new Float32Array(remap.size * 3),
    normals: new Float32Array(remap.size * 3),
    uvs: proxy.uvs ? new Float32Array(remap.size * 2) : null,
    occlusion: new Float32Array(remap.size),
    joints: new Uint16Array(remap.size * 4),
    weights: new Float32Array(remap.size * 4),
    indices: Uint32Array.from(indices),
  };
  for (const [from, to] of remap) {
    for (let c = 0; c < 3; c += 1) {
      out.positions[to * 3 + c] = proxy.positions[from * 3 + c];
      out.normals[to * 3 + c] = normals[from * 3 + c];
    }
    for (let c = 0; c < 4; c += 1) {
      out.joints[to * 4 + c] = proxy.joints[from * 4 + c];
      out.weights[to * 4 + c] = proxy.weights[from * 4 + c];
    }
    if (out.uvs) for (let c = 0; c < 2; c += 1) out.uvs[to * 2 + c] = proxy.uvs[from * 2 + c];
    out.occlusion[to] = occlusion[from];
  }
  return out;
}

/**
 * How much of the globe the lids leave open, at a point on its surface.
 *
 * The eyes are the one part of the figure the scene's occlusion field cannot
 * shade. That field is sampled against the collision volumes, and the skull is
 * a single round cone there with no socket in it at all - so every one of these
 * vertices is deep inside solid geometry as far as it knows, and it returns
 * "fully enclosed" for the cornea and the back of the globe alike. It is not
 * wrong so much as asked the wrong question.
 *
 * What actually shades an eye is its own eyelids, and those are an aperture of
 * known size on a sphere of known size, so the exposure is how far outside that
 * ellipse the point lies. Past the rim it falls off over about a third of the
 * aperture rather than cutting, because a lid is soft and the shadow it throws
 * on the white beneath it is graded, not an edge. The corner of an eye being
 * darker than the middle is most of what stops a drawn eye looking like a bead.
 */
function eyeOcclusion(d, eye) {
  const along = d[0] * eye.axis[0] + d[1] * eye.axis[1] + d[2] * eye.axis[2];
  // Lateral and vertical displacement, taken in the head's frame rather than
  // the eye's: the fissure was measured there, and the eye's own roll about its
  // gaze axis is arbitrary - the fit does not pin it and nothing should use it.
  const lateral = d[0] - along * eye.axis[0];
  const vertical = d[1] - along * eye.axis[1];
  const t = Math.hypot(lateral / FISSURE[0], vertical / FISSURE[1]);
  const open = along <= 0 ? 0 : Math.max(0, Math.min(1, (1.3 - t) / 0.3));
  return 0.22 + 0.68 * open;
}


/**
 * Tag each axial joint with where it sits along the model's own spine.
 *
 * `t` is its fraction of the chain's arc length from pelvis to crown. `offset`
 * is what is left over once the straight chord at that fraction is subtracted -
 * the lumbar curve, mostly, which is 48mm of it and the one part of a back
 * profile anybody would notice missing.
 *
 * The crown is not a joint in the model; it is the top of the normalised mesh,
 * which is 1 by construction. Using it rather than stopping at the head joint
 * is what makes the figure come out its full stature: MakeHuman's `head` is the
 * middle of the skull and ours is its base, so ending the chain at the joint
 * would hand 51mm of skull to whichever rig's convention won.
 */
function measureAxis(joints) {
  const byBoneName = byBone(joints);
  const chain = AXIS_BONES.map((bone) => byBoneName.get(bone)).filter(Boolean);
  if (chain.length < 3) return;

  const head = chain[chain.length - 1];
  const points = chain.map((j) => [j.rest[12], j.rest[13], j.rest[14]]);
  points.push([head.rest[12], 1, head.rest[14]]);

  const arc = [0];
  for (let i = 1; i < points.length; i += 1) {
    arc.push(arc[i - 1] + distance(points[i - 1], points[i]));
  }
  const total = arc[arc.length - 1];
  if (!(total > 0)) return;

  const from = points[0];
  const to = points[points.length - 1];
  chain.forEach((joint, i) => {
    const t = arc[i] / total;
    joint.axis = { t, offset: [0, 1, 2].map((c) => points[i][c] - (from[c] + t * (to[c] - from[c]))) };
  });

  // The crown doubles as the head's tip, which is what gives the skull an axis
  // to be aligned along. Without one the head inherits the neck's correction,
  // and the neck's correction is a 22-degree pitch - MakeHuman's neck leans
  // that far forward at rest and ours stands straight, so straightening the
  // neck tips the skull back by the same amount and the figure renders with
  // its chin up.
  head.tip = points[points.length - 1];
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Finger chains, in the naming every MakeHuman-derived rig uses. */
const FINGERS = ["index", "middle", "ring", "pinky", "thumb"];

/**
 * Give every finger joint the axis it curls about, in its own rest frame.
 *
 * Measured rather than declared, because the one thing that is certain about a
 * finger rig is that its local axes are somebody else's convention. What *is*
 * stable is anatomy: a finger flexes in the plane containing its own bone and
 * perpendicular to the palm, toward the palm. Both of those are readable off
 * the bind pose - the bone from the joint to its child, the palm from the four
 * metacarpals - so the axis comes out right on a rig whose fingers run down -Y
 * and on one whose run down +X, with nothing to keep in step by hand.
 *
 * The palm normal's *sign* is taken from the thumb, which is the one landmark
 * that is on the palmar side of the hand on both hands. Deriving it from the
 * cross product alone would be right on the left hand and inverted on the
 * right, because the right rig is a mirror and mirroring flips handedness -
 * which would draw one hand curling closed and the other bending backwards.
 */
function measureFingers(joints) {
  const byName = new Map(joints.map((joint) => [joint.name, joint]));
  const at = (name) => {
    const joint = byName.get(name);
    return joint ? [joint.rest[12], joint.rest[13], joint.rest[14]] : null;
  };

  for (const side of ["l", "r"]) {
    const wrist = at(`hand_${side}`);
    const middle = at(`middle_01_${side}`);
    const index = at(`index_01_${side}`);
    const pinky = at(`pinky_01_${side}`);
    const thumb = at(`thumb_03_${side}`) ?? at(`thumb_02_${side}`);
    if (!wrist || !middle || !index || !pinky || !thumb) continue;

    const along = v3normalize(v3sub(middle, wrist));
    const across = v3normalize(v3sub(pinky, index));
    let dorsal = v3normalize(v3cross(along, across));
    if (v3dot(v3sub(thumb, wrist), dorsal) > 0) dorsal = v3neg(dorsal);

    for (const finger of FINGERS) {
      for (let segment = 1; segment <= 3; segment += 1) {
        const joint = byName.get(`${finger}_0${segment}_${side}`);
        if (!joint) continue;
        const head = at(joint.name);
        // A distal phalanx has no child to point at, so it takes the direction
        // it already runs in - from its parent to itself.
        const child = at(`${finger}_0${segment + 1}_${side}`);
        const tail = child ?? head;
        const from = child ? head : at(joints[joint.parent]?.name);
        if (!from) continue;
        const bone = v3normalize(v3sub(tail, from));
        if (!(v3len(bone) > 0.5)) continue;

        // Rotating about `axis` by a positive angle carries the bone toward the
        // palm: `axis x bone == -dorsal`.
        const axis = v3normalize(v3cross(bone, v3neg(dorsal)));
        joint.curl = [
          joint.rest[0] * axis[0] + joint.rest[1] * axis[1] + joint.rest[2] * axis[2],
          joint.rest[4] * axis[0] + joint.rest[5] * axis[1] + joint.rest[6] * axis[2],
          joint.rest[8] * axis[0] + joint.rest[9] * axis[1] + joint.rest[10] * axis[2],
        ];
        // And a second axis at the knuckle only, for the fan. Fingers spread
        // and close at the metacarpophalangeal joint and nowhere else - the
        // two joints below it are hinges - so only segment 1 gets one. By the
        // same identity as above, a positive angle about this one carries the
        // bone along `across`, which runs from the index finger to the little
        // one.
        if (segment === 1) {
          const sideways = v3normalize(v3cross(bone, across));
          joint.splay = [
            joint.rest[0] * sideways[0] + joint.rest[1] * sideways[1] + joint.rest[2] * sideways[2],
            joint.rest[4] * sideways[0] + joint.rest[5] * sideways[1] + joint.rest[6] * sideways[2],
            joint.rest[8] * sideways[0] + joint.rest[9] * sideways[1] + joint.rest[10] * sideways[2],
          ];
        }
        joint.finger = finger;
        joint.segment = segment;
        joint.side = side;
      }
    }
    measureBrace(joints, byName, side, dorsal);
  }
}

/**
 * A braced hand is flat in the model's palm frame, not a small added curl on
 * top of its rest pose. Both bundled scans already curl their fingers and
 * oppose the thumb at rest; fixed degree offsets left the thumb several
 * centimetres below the palm. Fit rotations once in bind space, root to tip,
 * retaining the spread, every joint origin and every phalanx length.
 */
function measureBrace(joints, byName, side, normal) {
  const world = new Map();
  for (const finger of FINGERS) {
    for (let segment = 1; segment <= 3; segment++) {
      const joint = byName.get(`${finger}_0${segment}_${side}`);
      if (!joint?.curl) continue;
      const parent = joints[joint.parent];
      if (!parent) continue;
      const fan = joint.splay ? fingerSplay("brace", finger) : 0;
      let local = fan
        ? mat4Multiply(joint.localRest, mat4Compose([0, 0, 0], quatFromAxisAngle(joint.splay, fan * Math.PI / 180)))
        : joint.localRest;
      const current = mat4Multiply(world.get(parent.index) ?? parent.rest, local);
      const child = byName.get(`${finger}_0${segment + 1}_${side}`);
      const restDirection = child
        ? v3sub(child.rest.slice(12, 15), joint.rest.slice(12, 15))
        : v3sub(joint.rest.slice(12, 15), parent.rest.slice(12, 15));
      const direction = mat4TransformUnit(current, mat4TransformUnit(joint.inverseBind, restDirection));
      const height = v3dot(direction, normal);
      const tangent = direction.map((value, i) => value - normal[i] * height);
      if (v3len(tangent) > 1e-8) {
        const inverse = mat4InvertRigid(current);
        const rotation = quatFromUnitVectors(
          v3normalize(mat4TransformUnit(inverse, direction)),
          v3normalize(mat4TransformUnit(inverse, tangent)),
        );
        local = mat4Multiply(local, mat4Compose([0, 0, 0], rotation));
      }
      joint.brace = local;
      world.set(joint.index, mat4Multiply(world.get(parent.index) ?? parent.rest, local));
    }
  }
}

const depth = (joints, i) => (joints[i].parent < 0 ? 0 : 1 + depth(joints, joints[i].parent));
const byBone = (joints) => new Map(joints.filter((j) => j.bone).map((j) => [j.bone, j]));

/**
 * Per-skeleton bind corrections: the rotation that carries each model joint
 * from its modelled A-pose to the direction our skeleton rests in.
 *
 * Cached on the skeleton because it depends on proportions - a shoulder scale
 * changes where the clavicle points - but not on the pose, so it is computed
 * once per body rather than once per frame.
 */
export function bindCorrections(template, skeleton) {
  const align = new Array(template.joints.length).fill(null);
  const delta = new Array(template.joints.length).fill(null);
  const identity = mat4Compose([0, 0, 0], [0, 0, 0, 1]);

  for (const i of template.order) {
    const joint = template.joints[i];
    const parentDelta = joint.parent >= 0 ? delta[joint.parent] : identity;
    const childBone = joint.bone ? PRIMARY_CHILD[joint.bone] : null;
    const childJoint = childBone ? template.jointByBone.get(childBone) : null;
    const childPoint = childJoint
      ? [childJoint.rest[12], childJoint.rest[13], childJoint.rest[14]]
      : (childBone && joint.tip) || null;

    if (!childPoint) {
      // Nothing to point at: the wrist (our palm tip has no model joint), the
      // toe (a leaf). Inheriting the parent's correction keeps the modelled
      // angle of the part relative to its parent, which for a wrist is exactly
      // right.
      delta[i] = parentDelta;
    } else {
      const modelled = v3normalize([
        childPoint[0] - joint.rest[12],
        childPoint[1] - joint.rest[13],
        childPoint[2] - joint.rest[14],
      ]);
      // Our rest pose has every local rotation at identity, so a bone's rest
      // direction is just its child's offset - no traversal needed.
      const target = v3normalize(skeleton.bone(childBone).offset);
      const from = mat4TransformUnit(parentDelta, modelled);
      delta[i] = mat4Multiply(mat4Compose([0, 0, 0], quatFromUnitVectors(from, target)), parentDelta);
    }
    align[i] = mat4Multiply(delta[i], rotationOf(joint.rest));
  }
  return align;
}

/** Rotate a unit vector by the rotation part of a 4x4. */
function mat4TransformUnit(m, d) {
  return [
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
  ];
}

/**
 * World matrix per model joint for a posed skeleton.
 *
 * Limb joints take their *position* from our skeleton outright rather than from
 * the model's own bone lengths. That is the decision that keeps the drawing and
 * the collision in the same place: MakeHuman's humerus is about 15% shorter
 * than the Drillis & Contini fraction the rig is built on, and keeping the
 * model's lengths would draw a hand several centimetres from the hand the
 * solver placed. The mesh stretches slightly across the elbow instead, which
 * linear blend skinning absorbs and nobody can see.
 *
 * Axial joints are the exception and go by arc length along the posed spine
 * instead - see `AXIS_BONES` for why joint-on-joint does not work there.
 * Rotation still comes from our bone in both cases.
 *
 * The fingers are the third case. Our rig has no finger bones and never will,
 * because nothing in the language layer can ask for one - so they are driven
 * here instead, by folding a flexion about each joint's measured curl axis into
 * the local transform it would otherwise have kept. The angles come from
 * `handPose.js`, which reads them off what the solver already knows the hand is
 * doing. A joint with no curl axis, or a hand with no shape asked for, composes
 * exactly as before.
 *
 * @param {{l: string, r: string}} [hands] shape names from `HAND_SHAPES`
 */
export function poseJoints(template, skeleton, evaluated, align, hands = REST_HANDS) {
  const H = skeleton.stature;
  const axis = axisPolyline(skeleton, evaluated);
  const world = new Array(template.joints.length);
  for (const i of template.order) {
    const joint = template.joints[i];
    if (joint.bone) {
      const m = evaluated.matrices[skeleton.boneIndex(joint.bone)];
      const rotation = rotationOf(m);
      const position = joint.axis && axis
        ? addRotated(axis.at(joint.axis.t), rotation, joint.axis.offset)
        : [m[12] / H, m[13] / H, m[14] / H];
      world[i] = withTranslation(mat4Multiply(rotation, align[i]), position);
    } else if (joint.parent >= 0) {
      world[i] = mat4Multiply(world[joint.parent], curled(joint, hands));
    } else {
      // The armature's own root node is a joint in the skin but corresponds to
      // nothing anatomical and carries no weight. Leaving it at rest keeps the
      // chain well-defined without it moving anything.
      world[i] = joint.rest;
    }
  }
  return world;
}

/** What a hand does when nobody has said otherwise. */
const REST_HANDS = { l: "relaxed", r: "relaxed" };

/**
 * A finger joint's local transform with its flexion folded in.
 *
 * The rotation goes on the *right* of the rest transform, so it acts in the
 * joint's own frame and the phalanxes below it ride along - which is what makes
 * three small rotations read as one finger closing instead of three hinges
 * shearing apart.
 */
function curled(joint, hands) {
  if (!joint.curl) return joint.localRest;
  const shape = hands?.[joint.side] ?? "relaxed";
  if (shape === "brace" && joint.brace) return joint.brace;
  const degrees = fingerFlexion(shape, joint.finger, joint.segment);
  const fan = joint.splay ? fingerSplay(shape, joint.finger) : 0;
  if (!degrees && !fan) return joint.localRest;
  let bend = mat4Compose([0, 0, 0], quatFromAxisAngle(joint.curl, (degrees * Math.PI) / 180));
  // Spread first, then curl. The other order swings an already-curled finger
  // sideways through the one beside it.
  if (fan) {
    bend = mat4Multiply(
      mat4Compose([0, 0, 0], quatFromAxisAngle(joint.splay, (fan * Math.PI) / 180)),
      bend
    );
  }
  return mat4Multiply(joint.localRest, bend);
}

/**
 * Our posed spine as a polyline in unit-stature space, with a sampler that
 * takes a fraction of its arc length and returns the point there.
 *
 * Sampling the *posed* chain rather than the rest chain is the whole point: a
 * fraction two thirds of the way up a curled spine is two thirds of the way
 * along the curl, not two thirds of the way up the room.
 */
function axisPolyline(skeleton, evaluated) {
  const H = skeleton.stature;
  const points = [];
  for (const bone of AXIS_BONES) {
    const index = skeleton.boneIndex(bone);
    if (index < 0) return null;
    const m = evaluated.matrices[index];
    points.push([m[12] / H, m[13] / H, m[14] / H]);
  }
  const arc = [0];
  for (let i = 1; i < points.length; i += 1) arc.push(arc[i - 1] + distance(points[i - 1], points[i]));
  const total = arc[arc.length - 1];
  if (!(total > 0)) return null;

  return {
    at(t) {
      const target = t * total;
      let i = 1;
      while (i < arc.length - 1 && arc[i] < target) i += 1;
      const span = arc[i] - arc[i - 1] || 1;
      const f = (target - arc[i - 1]) / span;
      return [0, 1, 2].map((c) => points[i - 1][c] + f * (points[i][c] - points[i - 1][c]));
    },
  };
}

const addRotated = (p, m, d) => [
  p[0] + m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
  p[1] + m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
  p[2] + m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
];

/**
 * Skin the template onto a posed skeleton.
 *
 * `hang` is the gravity correction from `gravityHang`, and it applies to the
 * submeshes that ask for it - which is the genital part and nothing else.
 * Passing the same object here and to `poseVolumes` is what keeps the drawn
 * shaft and the colliding one in the same place.
 *
 * @returns {Array<{name:string, colour:number[], positions:Float32Array,
 *                  normals:Float32Array, uvs:Float32Array|null, indices:Uint32Array}>}
 *          one entry per submesh, in world metres
 */
export function skinHumanMesh(template, skeleton, evaluated, align = bindCorrections(template, skeleton), hands, hang = null) {
  const world = poseJoints(template, skeleton, evaluated, align, hands);
  const H = skeleton.stature;

  // Pre-multiply each joint's skinning matrix once, rather than per vertex.
  const skinning = world.map((m, i) => mat4Multiply(m, template.joints[i].inverseBind));

  return template.submeshes.map((submesh) => {
    const count = submesh.positions.length / 3;
    const positions = new Float32Array(count * 3);
    const normals = new Float32Array(count * 3);
    const swing = hang && submesh.hang ? hang : null;
    for (let v = 0; v < count; v += 1) {
      const px = submesh.positions[v * 3];
      const py = submesh.positions[v * 3 + 1];
      const pz = submesh.positions[v * 3 + 2];
      const nx = submesh.normals[v * 3];
      const ny = submesh.normals[v * 3 + 1];
      const nz = submesh.normals[v * 3 + 2];
      let ox = 0, oy = 0, oz = 0, mx = 0, my = 0, mz = 0, total = 0;
      for (let k = 0; k < 4; k += 1) {
        const weight = submesh.weights[v * 4 + k];
        if (weight <= 0) continue;
        const m = skinning[submesh.joints[v * 4 + k]];
        if (!m) continue;
        total += weight;
        ox += weight * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
        oy += weight * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
        oz += weight * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
        mx += weight * (m[0] * nx + m[4] * ny + m[8] * nz);
        my += weight * (m[1] * nx + m[5] * ny + m[9] * nz);
        mz += weight * (m[2] * nx + m[6] * ny + m[10] * nz);
      }
      // An unweighted vertex would otherwise collapse to the origin and drag a
      // spike across the whole figure.
      if (total <= 0) {
        ox = px; oy = py; oz = pz; mx = nx; my = ny; mz = nz;
      } else if (Math.abs(total - 1) > 1e-4) {
        ox /= total; oy /= total; oz /= total;
      }
      positions[v * 3] = ox * H;
      positions[v * 3 + 1] = oy * H;
      positions[v * 3 + 2] = oz * H;
      const length = Math.hypot(mx, my, mz) || 1;
      normals[v * 3] = mx / length;
      normals[v * 3 + 1] = my / length;
      normals[v * 3 + 2] = mz / length;
      // Gravity, after the skin and in metres, because the pivot is a world
      // point and the two have to be in the same units to subtract.
      if (swing) {
        const p = applyHang(swing, [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
        positions.set(p, v * 3);
        const n = applyHangDirection(swing, [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]]);
        normals.set(n, v * 3);
      }
    }
    return { name: submesh.name, primary: submesh.primary, colour: submesh.colour, hair: submesh.hair ?? false, garment: submesh.garment ?? false, finish: submesh.finish ?? null, trim: submesh.trim ?? null, trimColour: submesh.trimColour ?? null, cards: submesh.cards ?? null, positions, normals, uvs: submesh.uvs, occlusion: submesh.occlusion ?? null, indices: submesh.indices };
  });
}

/**
 * Carry the field's secondary-sex geometry onto the drawn mesh.
 *
 * The field and the scanned body are meant to be the same person read two
 * ways, and for the frame of the body they are. For the bust and the genitals
 * they were not: `buildBodyVolumes` builds both, on every body type, and marks
 * them `feature` - but the scanned models are a smooth-crotched export with a
 * small chest, so once the viewport switched from drawing the field to drawing
 * the mesh, every one of those volumes went on colliding while none of them
 * went on being visible. The solver placed a contact against a surface the
 * picture did not have.
 *
 * There are two ways to close that and **both are needed**, because the scan
 * cooperates in one place and not the other. Which one a feature gets is
 * measured, not declared, so re-authoring a volume in `body.js` cannot leave
 * this file describing a shape that is no longer there:
 *
 *   - **Displacement**, where the surface already faces the way the feature
 *     grows. Over the chest the mesh normal agrees with the feature's outward
 *     direction on 89% of the covered vertices (100% on the male), so pushing
 *     those vertices out along their own normal turns a flat chest into a bust
 *     with the scan's own topology, shading and UVs intact.
 *
 *   - **Added geometry**, where it does not. The crotch of a scanned body is a
 *     fold that faces *down*: every covered vertex on the female model and 58%
 *     on the male have a normal pointing into the feature, not out of it. There
 *     is no displacement of that surface that produces genitals - push along the
 *     normal and the fold slides downward, push along the feature's own gradient
 *     and it tears, both of which were built and measured before this was. So
 *     the volumes are tessellated into their own skinned part instead.
 *
 * The test is `dot(mesh normal, feature normal) > 0` per vertex, decided for the
 * whole cluster on a bone by majority - unless `body.js` has already said which
 * path a cluster takes by marking a volume `part`, which the genitals do. The
 * vote is a heuristic for a question that is really anatomical, and it is only
 * honest where the answer is in doubt. On the crotch it is not: a scanned body
 * has no genitals at all, so there is no surface there to raise and the vote is
 * reading noise. It read that noise two ways in one afternoon - the crotch
 * cluster lost the vote 14-64 while an oversized mons pubis was part of it and
 * won it 14-6 once the mons left - and the second reading drove the pubic skin
 * out to the far side of the thigh field as a fan of spikes. Per-bone rather
 * than per-volume because the volumes on one bone are a single `smoothMin`
 * blend: splitting a labium from the core it merges into would draw a seam down
 * the middle of one shape.
 *
 * Displacement is applied to the **bind** mesh, so it costs nothing per pose and
 * needs no matrix inverted: skinning is affine, so displacing before it is the
 * same as displacing after it. The added part is likewise built once, in bind
 * space, and skins through the ordinary path. Everything downstream - the
 * skinning, the field occlusion, the silhouette, `validate-mesh` - then sees one
 * body and needs no knowledge that this pass ran.
 *
 * @param {object} template from `buildHumanTemplate`
 * @param {object} [options]
 * @param {"female"|"male"|"neutral"} [options.bodyType] which volumes to build
 * @param {number} [options.bust] chest fullness multiplier
 * @param {number} [options.build] soft-tissue girth
 * @returns {object} a derived template; the original is left untouched
 */
export function featureRelief(template, { bodyType = "neutral", bust, build = 1 } = {}) {
  const skeleton = new Skeleton({ bodyType, build });
  const H = skeleton.stature;
  const evaluated = evaluatePose(skeleton, {
    root: { position: [0, H * HIP_HEIGHT_RATIO, 0], quaternion: [0, 0, 0, 1] },
    joints: skeleton.restPose(),
  });
  const all = poseVolumes(skeleton, evaluated, buildBodyVolumes(skeleton, { bust }), 0);
  const features = all.filter((volume) => volume.feature);
  if (!features.length) return template;

  const index = template.submeshes.findIndex((submesh) => submesh.primary);
  if (index < 0) return template;

  // Keyed by bone *and* by kind. A cluster is the unit that the vote below
  // decides on, and "is this a bulge in the skin or an organ in front of it" is
  // not a question about a bone - it is a question about a feature. The pelvis
  // carries both answers at once: the genitals are added geometry and the mons
  // pubis is a swelling of the skin over them. Keyed by bone alone the `some`
  // test at the bottom of the loop dragged the mons into the added-geometry
  // path with them, where it tessellated as a separate dome that crossed the
  // scan on a hard curve - an egg sitting on the pelvis with a rim all round it
  // and a cavity showing underneath.
  const clusters = new Map();
  for (const volume of features) {
    const key = `${volume.bone}\u0000${volume.part ? "part" : "relief"}`;
    if (!clusters.has(key)) clusters.set(key, { bone: volume.bone, volumes: [] });
    clusters.get(key).volumes.push(volume);
  }

  // Give the surface enough triangles to hold the shape before asking it to
  // take one. See `refineRegion`: the chest of the scanned model is too coarse
  // to carry a nipple or to bend round an inframammary fold without shearing,
  // and no choice of volume in `body.js` can fix that from the other side.
  //
  // Only the clusters that will be *displaced* are worth refining, and they are
  // found the same way the main loop finds them, by skinning once and taking
  // the majority vote per cluster. The added-geometry clusters bring their own
  // tessellation and read nothing from the body mesh, so subdividing under them
  // buys no detail at all - it only costs triangles. Measured: refining every
  // feature region took the female body from 26.8k triangles to 89.5k, almost
  // all of it spent under a crotch that is not drawn from these triangles.
  //
  // One box per cluster rather than one box overall, for the same reason a
  // bounding volume is not a shape: the union of a chest box and a crotch box
  // is a box containing the whole abdomen.
  const scout = skinHumanMesh(template, skeleton, evaluated);
  const boxes = [];
  for (const { volumes: cluster } of clusters.values()) {
    if (cluster.some((volume) => volume.part)) continue;
    const near = featureReach(cluster);
    // Which vertices to refine. The box has to cover everything the
    // displacement moves, and the displacement does not stop at the cluster's
    // surface: `smoothMin` keeps adding thickness for about a blend beyond it,
    // and `relaxDisplacement` carries motion further still. So the vertices the
    // cluster *contains* - which is what the vote below wants - are the wrong
    // set here, and on a sparse patch the two are nothing alike.
    //
    // Neither the cluster nor its bounding box, then, but the set the
    // displacement will actually reach: the vertices where the field is
    // *thicker* for the cluster being in it. That is one of the two terms
    // `gain` is a smooth minimum of, so it bounds the motion from above, and it
    // costs two field evaluations instead of the two marches `gain` needs.
    //
    // Both of the obvious boxes are wrong, and they are wrong in opposite
    // directions. The volume's reach - its bounding box plus 20mm - took the
    // female body from 44k triangles to 94k, most of it spent on flank and
    // abdomen the bust never touches. A blend-shell round the cluster is far
    // too small the other way: the bust displaces 11-14mm and `relaxDisplacement`
    // carries the tail well past the point where the volume stops, so the shell
    // ended at the breast's own surface and left the whole lower pole on the
    // scan's 20-32mm triangles. Measured there before this: the surface wobbled
    // 1.0-1.5mm over an 8mm sample and the shading normal stood up to 39 degrees
    // off its own facet, which renders as concentric arcs under the breast.
    //
    // The shell stays as a floor for the sparse case. The male mons thickens
    // the field by 16mm but sits on three scanned vertices, so the thickening
    // test alone can find a box only 6mm wide and the crest came out scalloped.
    const inCluster = new Set(cluster);
    const bare = all.filter((volume) => !inCluster.has(volume));
    const shell = Math.max(...cluster.map((volume) => volume.blend));
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    let covered = 0;
    let agree = 0;
    for (let v = 0; v < scout[index].positions.length; v += 3) {
      const p = [scout[index].positions[v], scout[index].positions[v + 1], scout[index].positions[v + 2]];
      if (!near(p)) continue;
      const depth = -bodyDistance(p, cluster);
      if (depth > -shell || bodyDistance(p, bare) - bodyDistance(p, all) > RELIEF_NOTICE) {
        for (let axis = 0; axis < 3; axis += 1) {
          const c = template.submeshes[index].positions[v + axis];
          if (c < box.min[axis]) box.min[axis] = c;
          if (c > box.max[axis]) box.max[axis] = c;
        }
      }
      if (depth <= 0) continue;
      const out = bodyNormal(p, cluster);
      covered += 1;
      if (scout[index].normals[v] * out[0] + scout[index].normals[v + 1] * out[1] +
          scout[index].normals[v + 2] * out[2] > 0) agree += 1;
    }
    if (covered && agree * 2 >= covered) boxes.push(box);
  }

  let working = template;
  if (boxes.length) {
    const pad = 0.012;
    const inRegion = (p) =>
      boxes.some((box) =>
        p[0] >= box.min[0] - pad && p[0] <= box.max[0] + pad &&
        p[1] >= box.min[1] - pad && p[1] <= box.max[1] + pad &&
        p[2] >= box.min[2] - pad && p[2] <= box.max[2] + pad);
    // Bind space is normalised to unit stature, so the target is a fraction of
    // height: 0.0028 is 4.6mm on the female model, down from a 15mm mean edge.
    // Set by what the finest feature needs rather than by what looks tidy - the
    // nipple stands 10mm above the areola, and a surface sampled every 7.5mm
    // renders that as a faint swelling. Three passes, because the coarsest
    // edges in the region start at 34mm and need all three to get under target.
    const refinedBody = refineRegion(template.submeshes[index], inRegion, 0.0028, 3);
    working = {
      ...template,
      submeshes: template.submeshes.map((submesh, i) => (i === index ? refinedBody : submesh)),
    };
  }

  const body = working.submeshes[index];

  // The rest-pose skin, which is where the field is evaluated. Skinning the
  // undisplaced template is not circular: this pass reads that surface and
  // writes a new one.
  const posed = skinHumanMesh(working, skeleton, evaluated);
  const world = posed[index].positions;
  const facing = posed[index].normals;

  // Bind-space frames for the bones the features hang off. Both `poseJoints`
  // and `inverseBind` are rigid, so their product is rigid and the transpose of
  // its basis is the exact inverse rotation - no general inverse needed.
  const align = bindCorrections(working, skeleton);
  const jointWorld = poseJoints(working, skeleton, evaluated, align);

  const positions = Float32Array.from(body.positions);
  const count = body.positions.length / 3;
  // How far each vertex travels, which way, and whose bind frame the travel is
  // expressed in. All three are fixed here, from the undeformed surface.
  const cap = new Float32Array(count);
  const disp = new Float32Array(count * 3);
  const owner = new Int32Array(count).fill(-1);
  const frames = new Map();
  const added = [];
  let moved = 0;
  let worst = 0;
  let sum = 0;

  for (const { bone, volumes: cluster } of clusters.values()) {
    const joint = working.jointByBone.get(bone);
    if (!joint) continue;
    const frame = mat4Multiply(jointWorld[joint.index], joint.inverseBind);
    const near = featureReach(cluster);

    // Every drawn vertex this cluster reaches, and whether the surface there
    // faces out of the feature or into it. The `inside` test is what makes this
    // a vote about the cluster rather than about its neighbourhood: a vertex
    // the volume does not contain says nothing about whether the volume is a
    // bulge in this skin or a separate organ sitting in front of it.
    const covered = [];
    let agree = 0;
    for (let v = 0; v < world.length; v += 3) {
      const p = [world[v], world[v + 1], world[v + 2]];
      if (!near(p)) continue;
      const out = bodyNormal(p, cluster);
      const n = [facing[v], facing[v + 1], facing[v + 2]];
      const faces = n[0] * out[0] + n[1] * out[1] + n[2] * out[2];
      if (-bodyDistance(p, cluster) > 0) {
        if (faces > 0) agree += 1;
        else agree -= 1;
      }
      covered.push({ v, p, n, faces });
    }

    if (cluster.some((volume) => volume.part) || !covered.length || agree <= 0) {
      const part = anatomyPart(cluster, frame, joint.index, H, bone, Boolean(body.uvs));
      if (part) added.push(part);
      continue;
    }

    frames.set(joint.index, frame);
    // The same field with this feature taken out of it, which is what the body
    // would be here if `body.js` had never authored a bust. Every volume is a
    // distinct object out of `poseVolumes`, so identity is the whole test.
    const inCluster = new Set(cluster);
    const bare = all.filter((volume) => !inCluster.has(volume));

    for (const hit of covered) {
      // A vertex whose own surface faces *into* the feature is on the far wall
      // of something else - the opposite inner thigh, the underside of a fold -
      // and pushing it out of the feature drives it through and out the other
      // side. The majority vote above decides whether the cluster is a
      // displacement at all; this decides, vertex by vertex, which surface is
      // the one being displaced. Without it a crotch cluster tore into flying
      // sheets, because a vertex on one thigh got 30mm of travel and its
      // neighbour across the gap got 30mm the other way.
      // Which way is out, and does this vertex's own surface agree? Both from
      // the gradient of the *whole* field, never the cluster's own.
      //
      // The cluster alone is an unattached teardrop with an underside, and its
      // gradient beneath the breast points 0.68 downward - straight at that
      // underside, which is not a surface the body has. Testing the scan's
      // normal against it rejects every vertex below y=1175mm outright while
      // the band just above is pushed out 25mm, and a 25mm step with a cliff
      // for an edge is not a fold: it is an overhanging lip with a cavity
      // behind it, and it rendered as a crescent cave under the medial end of
      // the breast in every picture until this line changed. The union's
      // gradient in the same place runs along the chest wall, agrees with the
      // skin, and lets the fold close continuously.
      //
      // The vote above still uses the cluster, and should: there the question
      // is whether a volume is a bulge in this skin or a separate organ in
      // front of it, which is exactly a question about the volume alone.
      const way = bodyNormal(hit.p, all);
      const agree = Math.max(0, way[0] * hit.n[0] + way[1] * hit.n[1] + way[2] * hit.n[2]);
      if (agree <= 0) continue;

      // How much thicker the body is here *because of* the feature. This is the
      // quantity the whole pass turns on, and it is measured twice because
      // neither measurement is trustworthy on its own.
      //
      // Along the ray: the vertex's own normal leaves the full field at `full`
      // and the featureless one at `bare`, and the difference is the depth of
      // flesh the bust adds over this exact spot. Both readings start at the
      // same point and run along the same line, so the offset between the scan
      // and the field - a centimetre or two in places - cancels out of the
      // subtraction. What it cannot survive is a grazing normal: under the
      // lower pole the skin faces down and forward, so the ray skims lengthwise
      // along the underside of the breast and returns a chord. Measured on the
      // female body, 13.4mm of "added flesh" at the fold, where the true answer
      // is about a millimetre.
      //
      // Between the fields: `bodyDistance` to the bare field minus the same to
      // the full one is a perpendicular thickness and has no grazing case at
      // all - it reads 1.1mm at that fold. Its own failure is burial. A
      // distance field measures to the *nearest* surface, so for a vertex well
      // inside the body the nearest surface may have nothing to do with the
      // feature, and across the body of the breast it over-reports badly: 44.1mm
      // where the volume is authored to stand 20mm proud.
      //
      // The smaller of the two is right in every band. At the fold the field
      // difference vetoes the ray's chord; across the mass the ray vetoes the
      // field's burial and gives 20.9mm, which is the authored figure. The two
      // failure modes do not overlap because one is about direction and the
      // other about depth.
      //
      // Smoothly smaller, though, and `RELIEF_MERGE` is why. A hard `min` of
      // two smooth functions is continuous but kinked, and the kink lies along
      // the whole curve where they cross - which here is not some harmless
      // corner of the chest but the line running under the breast where the ray
      // stops passing through the mass and starts skimming it. A kink in the
      // displacement is a crease in the surface, so rounding the crossing is
      // worth the two multiplies.
      //
      // It is a small effect and worth saying so, because the obvious crease
      // under the breast is *not* this one. That one is the gradient of the
      // travel across the fold, it is much larger than any kink, and nothing
      // measured here removes it - see `RELIEF_SPREAD`.
      //
      // Either way it is a difference, so it has no rim and needs no fade: it
      // reaches zero of its own accord wherever the bust stops adding flesh,
      // which under the lower pole is exactly where the volume becomes tangent
      // to the ribs. Off the feature both terms are zero and `smoothMin` returns
      // -k/4, so the rounding costs nothing there either - it is rejected by the
      // same test that rejected a plain zero.
      const full = surfaceExit(hit.p, hit.n, all, RELIEF_LIMIT);
      if (full <= 0) continue;
      const along = full - surfaceExit(hit.p, hit.n, bare, RELIEF_LIMIT);
      const across = bodyDistance(hit.p, bare) - bodyDistance(hit.p, all);
      const gain = smoothMin(along, across, RELIEF_MERGE);
      if (gain <= 0) continue;

      // No fade over the feature's rim, and nothing to choose a rim with. The
      // fade that was here ran on `inside`, the depth into the cluster volume,
      // and cutting the displacement off at `inside = 0` is what put a ridge up
      // the medial slope of the breast: the volume's medial edge is 55mm off
      // the midline, but the `smoothMin` that joins it to the ribs keeps adding
      // thickness for some millimetres past that, and the gate chopped the
      // blend off in a straight line from the armpit to the nipple.
      const allowed = Math.min(gain, RELIEF_LIMIT);
      const v = hit.v / 3;
      if (allowed <= cap[v]) continue;

      // Which way: the gradient of the *whole* field, not of the cluster and
      // not the scan's own normal.
      //
      // The scan's normal is the obvious choice and it makes the wrong shape.
      // A chest is a barrel, so its normals point outwards and sideways, and a
      // thickness added along them piles up on the flanks - the breasts came
      // out splayed, pointing down and away, with the drawn apex nowhere near
      // the painted areola. The field's own gradient points where the volume
      // says the mass is, which is forward, and the field is the thing
      // `body.js` fitted to the scan in the first place.
      //
      // The whole field rather than the cluster alone is what keeps the lower
      // pole out of trouble. The cluster on its own is an unattached teardrop
      // with an underside, and its gradient beneath the breast points 0.68
      // downward, straight at that underside; the union's gradient there is the
      // gradient of the *blend* with the ribs, and runs along the chest wall
      // instead. Projecting onto the cluster dragged the last ring of chest
      // skin 19mm down and 16mm forward under the mass while the skin 3mm below
      // it stayed put, and the render showed an overhanging lip with a terraced
      // cavity behind it.
      // ...but leant back towards the vertex's own normal by however much the
      // two disagree, which is the only thing that keeps the fold in one piece.
      // Where the field and the scan agree about which way is out - across the
      // body of the breast, 27 to 32 degrees apart - the weight is near one and
      // the shape is the field's. In the fold they open to 62 degrees and the
      // gradient swings right round over a few millimetres, so neighbouring
      // vertices would be sent in visibly different directions; there the
      // weight falls away and the motion becomes a plain offset of the skin,
      // which cannot tear. Measured at the fold: 152 backfacing triangles a
      // side on the raw gradient, 87 once the gain was corrected as well, 2
      // with this - and none at all once `relaxDisplacement` has run.
      //
      // The alternative was to refuse the vertices where the two disagree past
      // some angle, and refusing is what makes holes. A cut in a displacement
      // field is a cut in the surface.
      const lean = [
        hit.n[0] + agree * (way[0] - hit.n[0]),
        hit.n[1] + agree * (way[1] - hit.n[1]),
        hit.n[2] + agree * (way[2] - hit.n[2]),
      ];
      const length = Math.hypot(lean[0], lean[1], lean[2]);
      if (length < 1e-6) continue;
      cap[v] = allowed;
      for (let a = 0; a < 3; a += 1) disp[v * 3 + a] = (lean[a] / length) * allowed;
      owner[v] = joint.index;
    }
  }

  // Spread the displacement into the skin around the feature before applying
  // it. See `RELIEF_RELAX`.
  if (frames.size) relaxDisplacement(disp, cap, owner, world, body.indices);

  // Put each vertex where its own `disp` says, and carry the move back into
  // bind space through the bone frame it was measured in.
  //
  // One step and no march. What was here walked the surface out along its own
  // normals half the remaining distance at a time, re-normalling after every
  // pass, and the elaborateness was entirely in service of a target that could
  // not be hit: see the note over `out` above.
  if (frames.size) {
    for (let v = 0; v < count; v += 1) {
      const travel = Math.hypot(disp[v * 3], disp[v * 3 + 1], disp[v * 3 + 2]);
      if (travel <= 1e-6) continue;
      const frame = frames.get(owner[v]);
      if (!frame) continue;
      const d = rotateIntoBind(frame, [disp[v * 3], disp[v * 3 + 1], disp[v * 3 + 2]]);
      positions[v * 3] += d[0] / H;
      positions[v * 3 + 1] += d[1] / H;
      positions[v * 3 + 2] += d[2] / H;
      moved += 1;
      sum += travel;
      if (travel > worst) worst = travel;
    }
  }

  // Rebuild the normals of the vertices that moved, and of their immediate
  // neighbours so the boundary of the displaced patch is not a crease - and of
  // nothing else.
  //
  // Re-normalling the whole submesh is what this did first, and it is wrong for
  // a reason that has nothing to do with the feature: `smoothNormals` averages
  // the faces meeting at a vertex *index*, and a UV seam is exactly a run of
  // vertices duplicated so that each copy carries a different chart. Each copy
  // is therefore joined to only the faces on its own side, so the average it
  // gets is a half-average, and the surface creases along every seam on the
  // body. Measured against the scan's own authored normals: 795 vertices that
  // this pass never moved came out more than 12 degrees off, the worst of them
  // 165 degrees, and they are the chart boundaries - down the sternum, round
  // the lips, across the face. It renders as flat quad-shaped plates on the
  // chest, which is what it was mistaken for while the bust was being blamed.
  //
  // The scan's own normals are correct and seam-aware, and a geometric normal
  // is not a replacement for one. So rebuild the *change* instead: the same
  // average taken over the displaced surface, minus the same average taken over
  // the surface as it arrived, added to the authored normal. Anything the scan
  // and the rebuild disagree about is in both terms and subtracts out - the
  // seam half-average, the crease classification, and the scan's own faceting -
  // while everything the displacement did to the surface survives, because it
  // is in `after` alone.
  //
  // The faceting is the reason this is not merely tidier. The scan carries the
  // pubis on 16mm triangles and hides them behind authored normals, so the ramp
  // there is a flat fan that reads as smooth skin. Substituting a geometric
  // normal drops that disguise and every one of those facets lights up: the
  // mons pubis rendered as a faceted fan spreading out of the lower belly, the
  // same size whether the body carried 46.5k triangles or 94k, because the
  // facets were never the sampling. Taking the difference keeps the disguise
  // over the scan's own shape and puts the mound on top of it. The same fan was
  // on the chest the whole time and was read as a bust problem; `flip.mjs` puts
  // the female body back to the scan's own 40 opposed triangles in 5 sites,
  // where rebuilding outright had erased the count by construction.
  //
  // It also makes the boundary of the pass disappear. An untouched vertex has
  // `after` equal to `before` and keeps its authored normal exactly, so there
  // is no ring to widen and no line where one rule stops and the other starts;
  // the old code had to grow the rebuilt set by one triangle to hide that edge.
  const normals = Float32Array.from(body.normals);
  if (moved) {
    const before = smoothNormals(body.positions, body.normals, body.indices, -1);
    const after = smoothNormals(positions, body.normals, body.indices, -1);
    for (let v = 0; v < count; v += 1) {
      const x = normals[v * 3] + after[v * 3] - before[v * 3];
      const y = normals[v * 3 + 1] + after[v * 3 + 1] - before[v * 3 + 1];
      const z = normals[v * 3 + 2] + after[v * 3 + 2] - before[v * 3 + 2];
      const length = Math.hypot(x, y, z);
      // A displacement that turns the surface by more than a right angle has
      // no first-order correction to apply; take the geometry and be done.
      if (!(length > 0.1)) {
        normals[v * 3] = after[v * 3];
        normals[v * 3 + 1] = after[v * 3 + 1];
        normals[v * 3 + 2] = after[v * 3 + 2];
        continue;
      }
      normals[v * 3] = x / length;
      normals[v * 3 + 1] = y / length;
      normals[v * 3 + 2] = z / length;
    }
  }

  const submeshes = working.submeshes.map((submesh, i) =>
    i === index ? { ...submesh, positions, normals } : submesh
  );

  return {
    ...working,
    submeshes: [...submeshes, ...added],
    relief: {
      moved,
      worst,
      mean: moved ? sum / moved : 0,
      added: added.length,
      refined: body.indices.length / 3 - template.submeshes[index].indices.length / 3,
    },
  };
}

/**
 * Spread a displacement field into the skin around the feature, in place.
 *
 * Everything that sets the field is a per-vertex decision, and a few of them are
 * still decisions rather than smooth functions: whether the vertex's own surface
 * faces out of the feature at all, and which of the two thickness measurements
 * wins. Each is fine in the middle of the breast and none of them is fine in the
 * inframammary fold, where the surface turns through most of a right angle over
 * a couple of centimetres. Left alone, the fold is where the last few triangles
 * come out backfacing: two a side on the female body, in the hardest place on
 * the mesh to see them and the easiest to notice once they are lit.
 *
 * Laplacian relaxation is the general answer to all of them at once. Each pass
 * replaces a fraction `RELIEF_RELAX` of every vertex's displacement with the
 * average of its neighbours', including the vertices that were handed nothing,
 * so any step in the field turns into a ramp a few millimetres wide and motion
 * bleeds a little further out with every pass. It is the displacement that is
 * smoothed, not the surface, so the scan keeps every bump it came with.
 *
 * The vectors are averaged whole rather than their magnitudes, which matters
 * precisely at the fold: the direction swings by tens of degrees over the same
 * few millimetres, so two neighbours can be asked for equal travel in visibly
 * different directions. Averaging magnitudes would call that pair smooth and
 * leave the tear in place.
 *
 * Welded by position first, because the scan is cut along every UV chart seam -
 * 46646 boundary edges on the female body, one of them straight down the
 * sternum through the middle of the region this has to smooth. Unwelded, each
 * side of a seam relaxes against its own half of the neighbourhood and the seam
 * survives as a visible ridge.
 */
function relaxDisplacement(disp, cap, owner, world, indices) {
  const count = cap.length;
  // Weld by quantised position. A tenth of a millimetre is far below the finest
  // edge here and far above the float error in two copies of one scanned vertex.
  const rep = new Int32Array(count);
  const byPosition = new Map();
  for (let v = 0; v < count; v += 1) {
    const key = `${Math.round(world[v * 3] * 1e4)},${Math.round(world[v * 3 + 1] * 1e4)},${Math.round(world[v * 3 + 2] * 1e4)}`;
    const seen = byPosition.get(key);
    if (seen == null) {
      byPosition.set(key, v);
      rep[v] = v;
    } else {
      rep[v] = seen;
      // Copies of one point are one point: the copy that was given a
      // displacement lends it to the representative, so a feature that reaches
      // a seam only through one chart still moves both sides of it.
      if (cap[v] > cap[seen]) {
        cap[seen] = cap[v];
        owner[seen] = owner[v];
        for (let a = 0; a < 3; a += 1) disp[seen * 3 + a] = disp[v * 3 + a];
      }
    }
  }

  // Neighbours of the welded graph, as a flat adjacency. Built once: the sweep
  // below runs over it `RELIEF_SPREAD` times.
  const degree = new Int32Array(count);
  const seen = new Set();
  const pairs = [];
  for (let t = 0; t < indices.length; t += 3) {
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      const a = rep[indices[t + i]];
      const b = rep[indices[t + j]];
      if (a === b) continue;
      const key = a < b ? a * count + b : b * count + a;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(a, b);
      degree[a] += 1;
      degree[b] += 1;
    }
  }
  const offset = new Int32Array(count + 1);
  for (let v = 0; v < count; v += 1) offset[v + 1] = offset[v] + degree[v];
  const neighbour = new Int32Array(pairs.length);
  const fill = Int32Array.from(offset.subarray(0, count));
  for (let e = 0; e < pairs.length; e += 2) {
    neighbour[fill[pairs[e]]++] = pairs[e + 1];
    neighbour[fill[pairs[e + 1]]++] = pairs[e];
  }

  // A vertex with no displacement of its own that picks one up from a neighbour
  // needs a bone frame to express it in, and the only sensible one is the frame
  // its donors used. Carried along with the value.
  const next = new Float32Array(disp.length);
  for (let pass = 0; pass < RELIEF_SPREAD; pass += 1) {
    for (let v = 0; v < count; v += 1) {
      if (rep[v] !== v) continue;
      const from = offset[v];
      const to = offset[v + 1];
      if (to === from) {
        for (let a = 0; a < 3; a += 1) next[v * 3 + a] = disp[v * 3 + a];
        continue;
      }
      const mean = [0, 0, 0];
      let donor = owner[v];
      let loudest = owner[v] >= 0 ? Math.hypot(disp[v * 3], disp[v * 3 + 1], disp[v * 3 + 2]) : 0;
      for (let e = from; e < to; e += 1) {
        const n = neighbour[e];
        for (let a = 0; a < 3; a += 1) mean[a] += disp[n * 3 + a];
        if (owner[n] < 0) continue;
        const loud = Math.hypot(disp[n * 3], disp[n * 3 + 1], disp[n * 3 + 2]);
        if (loud > loudest) {
          loudest = loud;
          donor = owner[n];
        }
      }
      const share = to - from;
      for (let a = 0; a < 3; a += 1) {
        next[v * 3 + a] = disp[v * 3 + a] + RELIEF_RELAX * (mean[a] / share - disp[v * 3 + a]);
      }
      if (donor >= 0) owner[v] = donor;
    }
    for (let v = 0; v < count; v += 1) {
      if (rep[v] !== v) continue;
      for (let a = 0; a < 3; a += 1) disp[v * 3 + a] = next[v * 3 + a];
    }
  }

  for (let v = 0; v < count; v += 1) {
    const r = rep[v];
    if (r !== v) {
      owner[v] = owner[r];
      for (let a = 0; a < 3; a += 1) disp[v * 3 + a] = disp[r * 3 + a];
    }
    cap[v] = Math.hypot(disp[v * 3], disp[v * 3 + 1], disp[v * 3 + 2]);
  }
}

/**
 * Split the drawn mesh finer wherever a feature is about to be displaced.
 *
 * Displacement cannot invent detail smaller than the triangles it moves, and
 * over the chest of the scanned female model the mean edge is 14.9mm with a
 * worst of 33.6mm. A nipple is about 17mm across, so it fell *entirely inside
 * one triangle*: the field had one, every render was smooth, and no amount of
 * re-authoring the volume in `body.js` could have changed that. The same
 * coarseness is what tore the inframammary fold - a 50mm push spread over two
 * vertices 30mm apart shears the triangle between them until it flips, which
 * is the black gash under the breast in every earlier picture.
 *
 * So refine first, then displace. This is red-green subdivision: mark every
 * edge that is too long and has an end inside the region, put a vertex at its
 * midpoint, and re-cut each triangle according to how many of its three edges
 * were marked. The 1-, 2- and 3-edge cases are all handled, which is what keeps
 * the result watertight - splitting only the triangles in the region and
 * leaving their neighbours alone would leave a T-junction on every boundary
 * edge, and a T-junction is a visible crack once the surface moves.
 *
 * Adaptive rather than uniform, and capped: an edge is only cut if it is longer
 * than the target, so the already-fine parts of the region cost nothing, and
 * two passes is the limit because each one can quadruple the triangles it
 * touches. Measured on the female model this takes the body from 26.8k
 * triangles to about 34k - the nipple region reaches ~4mm edges, which resolves
 * it, and the chest fold stops shearing.
 *
 * Every vertex attribute is carried to the midpoints, not just position:
 * normals and UVs interpolate, and the skinning weights are merged as a
 * four-bone set and renormalised, so a refined vertex deforms exactly as the
 * edge it came from did. Getting that wrong shows up as a limb tearing off
 * during animation rather than as anything visible here.
 */
function refineRegion(submesh, inside, target, passes = 2) {
  let positions = Array.from(submesh.positions);
  let normals = Array.from(submesh.normals);
  let uvs = submesh.uvs ? Array.from(submesh.uvs) : null;
  let occlusion = submesh.occlusion ? Array.from(submesh.occlusion) : null;
  let joints = Array.from(submesh.joints);
  let weights = Array.from(submesh.weights);
  let indices = Array.from(submesh.indices);

  const vertex = (v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
  const flagged = new Map();
  const isInside = (v) => {
    if (!flagged.has(v)) flagged.set(v, inside(vertex(v)));
    return flagged.get(v);
  };

  for (let pass = 0; pass < passes; pass += 1) {
    const midpoints = new Map();
    const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

    const split = (a, b) => {
      const k = key(a, b);
      const existing = midpoints.get(k);
      if (existing != null) return existing;
      const m = positions.length / 3;
      // Put the new vertex on the curved surface the authored normals describe,
      // not on the chord between its parents. This is the edge midpoint of the
      // PN-triangle cubic: mid - (wa*Na + wb*Nb)/8, with wa = (Pb-Pa)·Na and
      // wb = (Pa-Pb)·Nb. On a sphere it is exact to second order.
      //
      // Splitting at the plain midpoint resamples a plane and leaves it a plane,
      // so on a coarse patch the extra vertices bought sampling and no shape at
      // all: the pubis is carried on 16mm triangles and a mons pubis displaced
      // onto them came out the same faceted fan whether the body held 46.5k
      // triangles or 94k. Curving costs nothing - no extra vertices, six
      // multiplies - and gives the refined surface the curvature the scan's
      // normals say it has, which is what the silhouette and the shadow see.
      //
      // It is not what fixed that fan, though. The facets were visible because
      // displaced vertices used to have their normals replaced by geometric
      // ones; see the note over the `normals` array at the end of
      // `featureRelief` for the rest of it.
      const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
      const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
      const na = [normals[a * 3], normals[a * 3 + 1], normals[a * 3 + 2]];
      const nb = [normals[b * 3], normals[b * 3 + 1], normals[b * 3 + 2]];
      const d = [bx - ax, by - ay, bz - az];
      const wa = d[0] * na[0] + d[1] * na[1] + d[2] * na[2];
      const wb = -(d[0] * nb[0] + d[1] * nb[1] + d[2] * nb[2]);
      const mid = [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2];
      for (let axis = 0; axis < 3; axis += 1) {
        positions.push(mid[axis] - (wa * na[axis] + wb * nb[axis]) / 8);
        normals.push((na[axis] + nb[axis]) / 2);
      }
      const nl = Math.hypot(normals[m * 3], normals[m * 3 + 1], normals[m * 3 + 2]) || 1;
      for (let axis = 0; axis < 3; axis += 1) normals[m * 3 + axis] /= nl;
      if (uvs) {
        uvs.push((uvs[a * 2] + uvs[b * 2]) / 2, (uvs[a * 2 + 1] + uvs[b * 2 + 1]) / 2);
      }
      if (occlusion) occlusion.push((occlusion[a] + occlusion[b]) / 2);

      // Merge two four-bone influence sets into one. Summing by bone and
      // keeping the heaviest four is the only correct way: picking one end's
      // weights would make the midpoint of an edge that crosses a joint follow
      // whichever side won.
      const merged = new Map();
      for (const v of [a, b]) {
        for (let i = 0; i < 4; i += 1) {
          const bone = joints[v * 4 + i];
          const w = weights[v * 4 + i] / 2;
          if (w > 0) merged.set(bone, (merged.get(bone) ?? 0) + w);
        }
      }
      const top = [...merged.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
      const total = top.reduce((s, [, w]) => s + w, 0) || 1;
      for (let i = 0; i < 4; i += 1) {
        joints.push(top[i]?.[0] ?? 0);
        weights.push(top[i] ? top[i][1] / total : 0);
      }
      midpoints.set(k, m);
      return m;
    };

    const wanted = (a, b) => {
      if (!isInside(a) && !isInside(b)) return false;
      const [ax, ay, az] = vertex(a);
      const [bx, by, bz] = vertex(b);
      return Math.hypot(ax - bx, ay - by, az - bz) > target;
    };

    const next = [];
    let cut = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
      const ab = wanted(a, b) ? split(a, b) : null;
      const bc = wanted(b, c) ? split(b, c) : null;
      const ca = wanted(c, a) ? split(c, a) : null;
      const count = (ab != null) + (bc != null) + (ca != null);
      if (count) cut += 1;

      if (count === 0) next.push(a, b, c);
      else if (count === 3) next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      else if (count === 2) {
        // Two cuts take a corner off and leave a quad. Naming them by walking
        // the original winding - in, apex, out - is what keeps every new
        // triangle wound the same way as the one it came from; going round the
        // other way is a backfacing triangle, and a few hundred of those is the
        // shower of grey shards this produced when the apex was picked first.
        const [apex, m1, m2, far1, far2] =
          ca == null ? [b, ab, bc, a, c]
          : ab == null ? [c, bc, ca, b, a]
          : [a, ca, ab, c, b];
        next.push(m1, apex, m2);
        // The quad runs far1 -> m1 -> m2 -> far2. Cut it on the shorter
        // diagonal so the halves do not come out as slivers.
        const p1 = vertex(m1);
        const p2 = vertex(m2);
        const q1 = vertex(far1);
        const q2 = vertex(far2);
        const across = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
        if (across(q1, p2) < across(p1, q2)) next.push(far1, m1, m2, far1, m2, far2);
        else next.push(m1, m2, far2, m1, far2, far1);
      } else {
        const [m, p, q] = ab != null ? [ab, c, a] : bc != null ? [bc, a, b] : [ca, b, c];
        const r = ab != null ? b : bc != null ? c : a;
        next.push(m, p, q, m, r, p);
      }
    }
    indices = next;
    if (!cut) break;
  }

  return {
    ...submesh,
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: uvs ? Float32Array.from(uvs) : null,
    occlusion: occlusion ? Float32Array.from(occlusion) : submesh.occlusion,
    joints: Uint16Array.from(joints),
    weights: Float32Array.from(weights),
    indices: Uint32Array.from(indices),
  };
}


/**
 * What the relief pass is allowed to do to the drawn surface.
 *
 * `RELIEF_LIMIT` caps one vertex's travel. Nothing on a body is 200mm thick, so
 * a reading that long means the field and the scan have lost each other and the
 * case is to be abandoned rather than clamped.
 *
 * `RELIEF_RELAX` and `RELIEF_SPREAD` are the relaxation of the displacement
 * field across the surface - see `relaxDisplacement`. 0.5 is the usual Laplacian
 * weight, stable and cheap enough that the pass count can be whatever the shape
 * needs. Here it needs a hundred, which is far more than the backfacing count
 * asks for - that reaches the raw mesh's own 40 triangles in 5 sites by about
 * forty passes and stays there - and the reason is the inframammary fold.
 *
 * A fold is where `gain` changes fastest: 25mm of added flesh above it and none
 * below, over some 20mm of chest. That is a slope past vertical, and a surface
 * displaced past vertical does not make a crease, it makes an overhang. The
 * drawn body had a crescent cave under the medial end of each breast with a lip
 * of skin hanging over it - shallow enough to pass for a shadow in a full-body
 * render and unmistakable at 100mm, and quite absent from both the scan and the
 * field, so it was ours. It survives changing the direction, the gate, the union
 * blend in `body.js`, the refinement pad and the ambient occlusion, because it
 * is none of those: it is the gradient of the travel, and diffusion is the only
 * thing that touches that.
 *
 * Diffusion is also not paid for in bust size, which is the surprise. Measured
 * at the upper pole, where `validate-skin` probes, the field stands 11.0mm proud
 * and the drawn surface gains 18.0mm at eight passes, 16.2mm at forty and 14.2mm
 * at a hundred. The heavy relaxation is not flattening a correct bust - it is
 * removing an over-displacement, and every pass moves the drawn shape closer to
 * the one `body.js` actually authored. The nipple, 17mm across, still reads: it
 * is carried by the paint as much as by the 5.8mm stub.
 *
 * There is no `RELIEF_BAND` any more and nothing for one to do. It was the width
 * of a rim the displacement faded out over, needed because the quantity being
 * applied did not go to zero at the feature's edge by itself. `gain` does, so
 * the fade was only ever hiding the cut its own gating made - and it was the
 * cut, not the fade, that put a ridge from the armpit to the nipple.
 *
 * Two formulations of the travel itself are worth not repeating, both of them
 * conditions on `body.js` as much as on this file.
 *
 * Marching to the field's own surface along the scan's normal moves the chest as
 * much as the breast, because the field is not the scan and stands proud of it
 * everywhere. That is what the fade was patching over.
 *
 * Projecting onto the *cluster's* surface along the cluster's gradient tore the
 * chest inside out when the bust was a single ball 140mm across sunk deep in the
 * ribs: a front-chest vertex sat only 31mm from its *centre*, and the shortest
 * way out of a ball from near its middle points wherever the vertex happens to
 * lie - the drawn bust went from +57mm to -199mm. Refitting the volume to the
 * scan fixed that particular number but not the method, which fails again at the
 * lower pole for a reason no amount of authoring can remove: an isolated volume
 * has an underside, and the skin at the rim gets sent to it.
 */
const RELIEF_LIMIT = 0.2;
const RELIEF_RELAX = 0.5;
const RELIEF_SPREAD = 100;

// How much the field has to thicken, in metres, before the skin over it is worth
// subdividing. Half a millimetre: below that the relief is finer than the
// silhouette error the scan already carries, so refining it buys nothing, and
// the test is only ever used to grow a bounding box that is then padded.
//
// It is deliberately far under the motion it is selecting for - the bust moves
// 11-14mm - because the quantity that has to be covered is not the peak but the
// tail, and the tail is where the coarse triangles were showing.
const RELIEF_NOTICE = 0.0005;

// How wide a band of *value*, in metres, the two thickness estimates are merged
// over instead of switched between. It is a `smoothMin` k, so it only does
// anything where the ray estimate and the field estimate are within 12mm of each
// other, and it rounds their crossing by at most k/4 = 3mm.
//
// The number is set by where the two estimates are known to stand, so that the
// rounding lands between them and not on either: under the breast they run
// 12.3mm apart (13.4 against 1.1) and across the mass 23.2mm apart (20.9
// against 44.1), and 12mm leaves both of those untouched. Its effect is
// therefore confined to the curve where they cross. Do not raise it far - by
// 24mm the rounding would reach the readings across the mass, which are the
// ones `body.js` was fitted against.
const RELIEF_MERGE = 0.012;

/**
 * The rectangle of the skin atlas the drawn genitals take their texture from,
 * and how much uv a metre of them is worth. See `patchUV`.
 *
 * Both atlases lay the body out the same way, and this is the front of a thigh
 * in each: plain skin with grain and fine hair, no chart seam, no landmark, and
 * within 3 levels of 255 of the mean tone of the drawn skin around the crotch on
 * the male atlas and 3 on the female. The rectangle is bigger than the part
 * needs so the projection can be clamped into it rather than wrapped.
 *
 * `scale` is the body chart's own density - the torso spans about 0.5 uv across
 * 400mm - so the grain on the part comes out the size of the grain beside it.
 *
 * The 30 thousandths of v between this and the 0.52 it started at are the whole
 * difference between skin and a birthmark. `patchUV` sends arc 0 - the front
 * centre line of the shaft, the most looked-at strip on the whole part - to
 * `u`, and the top of the part to `v`, so the rectangle's top left corner lands
 * squarely on the front of the glans and the upper shaft. At 0.52 that corner
 * held the tail of the groin crease, and it rendered as a brown-red smudge
 * halfway up the shaft that read as a bruise. Everything here is chosen against
 * that corner first and the rest of the rectangle second; the far corner, u
 * 0.33 and v 0.71, is 4 thousandths clear of the lip chart below it and is
 * reached only by the back of the scrotum, which is inside the thighs anyway.
 */
const SKIN_PATCH = { u: 0.15, v: 0.55, width: 0.18, height: 0.16, scale: 1.25 };
/**
 * Distance from an interior point to the first surface crossing along `n`.
 * Sphere tracing, so each step is the largest one that cannot overshoot.
 * Returns 0 for a point that is already outside or that never gets out.
 */
function surfaceExit(p, n, set, limit) {
  let t = 0;
  for (let step = 0; step < 48; step += 1) {
    const d = bodyDistance([p[0] + n[0] * t, p[1] + n[1] * t, p[2] + n[2] * t], set);
    if (d > -1e-5) return t;
    t -= d;
    if (t > limit) return 0;
  }
  return t;
}

/**
 * Tessellate a cluster of feature volumes into its own skinned part.
 *
 * The extraction is `buildBodyMesh`, the same surface-net mesher the diagnostic
 * `--body sdf` render uses, run over the cluster alone at 1.5mm instead of over
 * the whole body at 12mm. Nothing here is special: it is the body's own field,
 * meshed finely, in the one place where the scanned template has nothing to say.
 *
 * It replaced a star march - rays cast from the deepest interior point over a
 * sphere of directions - and the reason is worth keeping. A star march can only
 * express a surface that is single-valued about one centre, and it samples that
 * surface uniformly in *angle*. Neither holds here. The vulva is three lobes
 * with a cleft between two of them, so rays aimed past a lobe leave through the
 * cleft and never reach it; and a labium is 45mm long and 12mm thick, so
 * adjacent grid directions from a seed inside it land 30mm apart along its axis
 * and 1mm apart across it. It rendered as a ball of spikes. Surface nets have no
 * centre and sample in space rather than in angle, so both go away.
 *
 * The blob is closed, and its back half is buried inside the body it grows out
 * of. That is left alone deliberately: clipping it would need an inside-test
 * against the *drawn mesh*, not the field, and the two disagree about the pelvis
 * by 20mm. Two intersecting opaque solids already happens wherever a scene puts
 * two actors in contact, and the depth buffer resolves it the same way here.
 *
 * It is drawn exactly where the field puts it, and there was once a `seat` that
 * shrank it first by the local gap between field and scan, on the argument that
 * a feature tessellated on a field 35mm fatter than the scan stands off the
 * drawn skin by its own height plus that gap. The argument is right and the
 * implementation was not: marching out from a seed and subtracting a constant is
 * a *radial* erosion, which is a translation only for a sphere centred on that
 * seed. On the female crotch, 35mm off a 43mm mons left an 8mm bead while 35mm
 * off the 82mm reach to the far tip of a labium left 47mm. Seating a part
 * belongs in `body.js`, where the thing being placed is one shape and not a
 * star field: put the volume where the drawn body's skin is.
 */
function anatomyPart(cluster, frame, jointIndex, H, bone, textured = false, resolution = 0.0012) {
  // No AO: this part is lit with the body it sits in, and the renderer computes
  // occlusion against the whole scene afterwards. Padding is small because the
  // cluster's bounds already carry each volume's blend.
  const mesh = buildBodyMesh(cluster, { resolution, padding: 0.004, ao: false });
  const count = mesh.positions.length / 3;
  if (!count) return null;

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const joints = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);


  for (let v = 0; v < count; v += 1) {
    const world = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
    const local = unskinPoint(frame, world, H);
    const normal = rotateIntoBind(frame, [mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]]);
    positions.set(local, v * 3);
    normals.set(normal, v * 3);
    // Rigid to the bone the cluster was authored on, and that is the whole of
    // it. Anything cleverer was tried and is worse. Per-vertex weights borrowed
    // from the skin around the part shear the cleft open on the first
    // asymmetric pose. One blended binding for the whole part is the average of
    // a pelvis and two thighs, and raising both legs rotates those ~90 degrees
    // in opposite directions: linear blend skinning collapses that average and
    // moved a vulva symmetric about x = 0 to spanning -51mm..-2mm. Translating
    // the part per pose by how far the surrounding skin moved buries it - the
    // scan's crotch is a tunnel, so the vertices that form its floor at rest
    // swing +70mm out of the way when the legs open while the *silhouette* only
    // moves +26mm, and following the vertices pulled the vulva 25mm inside the
    // body and left a hole where it had been. The pelvis is also simply where
    // the vulva is attached, so the rigid answer is the anatomical one.
    joints[v * 4] = jointIndex;
    weights[v * 4] = 1;
  }

  return {
    name: `${bone}-anatomy`,
    // Not `primary`, because it is not the scan - but `colour: null` marks it
    // skin rather than trim, which is what the renderer keys its material,
    // shadows and outline off.
    primary: false,
    colour: null,
    // Gravity applies to this submesh and to nothing else on the body. The
    // flag rides on the geometry rather than on the name because the name is
    // a label and this is a property of the thing. It is a no-op unless the
    // actor has `hang` volumes for the collider to move too - see
    // `gravityHang` - so the female crotch is unaffected by it.
    hang: true,
    positions,
    normals,
    uvs: textured ? patchUV(positions, H) : null,
    indices: mesh.indices,
    joints,
    weights,
  };
}

/**
 * A UV for the drawn genitals, projected into one clean patch of the atlas.
 *
 * The part is tessellated from the field, so it arrives with no parameterisation
 * at all, and a body whose texture stops at the crotch is worse than one that
 * has none. There is no honest unwrap to give it, because the scan's atlas has
 * no chart for a shape the scan does not have. Two things can be done about
 * that, and this is the second.
 *
 * The first was to borrow: take, for each part vertex, the UV of the nearest
 * drawn vertex, on the argument that the part then matches the body exactly
 * where the two meet. What it actually samples is MakeHuman's crotch, and
 * MakeHuman's crotch is a flat unpainted fill with a polygonal edge where the
 * hairy groin skin starts. Measured against the drawn skin within 40mm of it,
 * the borrowed tone was right to 3 parts in 255 and its variation was *lower*
 * than the skin's - which is the diagnosis, not a defence: the genitals came out
 * as one smooth featureless blob of correct colour set into skin with visible
 * grain and hair, and read as a prosthetic. Blending the borrow over the nearest
 * eight vertices, with and without a seam guard, changed nothing, because there
 * was no discontinuity to fix.
 *
 * So the part gets a real projection into `SKIN_PATCH`, which is a rectangle of
 * plain thigh - grain and fine hair, no seam, no landmark, and the same tone as
 * the crotch to within a few levels, which is what makes the join invisible
 * without borrowing anything.
 *
 * Cylindrical about the part's own hanging axis, and *mirrored*: u runs off
 * `|atan2(x, z)|`, which is continuous at the front and at the back both, so a
 * closed surface can be unwrapped without a seam and without duplicating a
 * single vertex. The cost is that the left and right halves get the same texture
 * reflected, and on a bilaterally symmetric body under a noise-grained skin that
 * is not a cost at all. `SKIN_PATCH.scale` is in uv per metre and matches the
 * density of the body chart, so the grain on the part is the size of the grain
 * beside it.
 *
 * @param {Float32Array} local bind-frame positions, stature-normalised
 * @param {number} H stature, metres
 * @returns {Float32Array} two uvs per vertex
 */
function patchUV(local, H) {
  const count = local.length / 3;
  let top = -Infinity;
  let front = -Infinity;
  let back = Infinity;
  for (let v = 0; v < count; v += 1) {
    top = Math.max(top, local[v * 3 + 1] * H);
    front = Math.max(front, local[v * 3 + 2] * H);
    back = Math.min(back, local[v * 3 + 2] * H);
  }
  // The axis is the midline - both parts are symmetric about x = 0 - at the
  // middle of the part's own depth, so it runs up the inside of the part rather
  // than grazing its front or its back.
  const axis = (front + back) / 2;
  const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
  const uvs = new Float32Array(count * 2);
  for (let v = 0; v < count; v += 1) {
    const x = local[v * 3] * H;
    const z = local[v * 3 + 2] * H - axis;
    // Arc length, not angle: the distance round the part's own girth from the
    // front midline, which is the isometric thing to use and also what tames the
    // poles. An axis has to leave a closed surface somewhere, and where it does,
    // angle alone spins the whole width of the patch around one vertex - the
    // first version drew a visible starburst on the top of the shaft. Scaling
    // the angle by the *local* radius instead of the part's largest makes the
    // texture converge to a point there rather than pinwheel around it.
    uvs[v * 2] = clamp(
      SKIN_PATCH.u + Math.abs(Math.atan2(x, z)) * Math.hypot(x, z) * SKIN_PATCH.scale,
      SKIN_PATCH.u,
      SKIN_PATCH.u + SKIN_PATCH.width
    );
    uvs[v * 2 + 1] = clamp(
      SKIN_PATCH.v + (top - local[v * 3 + 1] * H) * SKIN_PATCH.scale,
      SKIN_PATCH.v,
      SKIN_PATCH.v + SKIN_PATCH.height
    );
  }
  return uvs;
}

/** A world direction in the bone's bind frame: transpose of a rigid basis. */
function rotateIntoBind(frame, d) {
  return [
    frame[0] * d[0] + frame[1] * d[1] + frame[2] * d[2],
    frame[4] * d[0] + frame[5] * d[1] + frame[6] * d[2],
    frame[8] * d[0] + frame[9] * d[1] + frame[10] * d[2],
  ];
}

/**
 * A world point in the bone's bind frame. Bind positions are stature-normalised
 * - `skinHumanMesh` multiplies by `H` on the way out - so the metres divide out
 * here before the frame is undone.
 */
function unskinPoint(frame, p, H) {
  const x = p[0] / H - frame[12];
  const y = p[1] / H - frame[13];
  const z = p[2] / H - frame[14];
  return rotateIntoBind(frame, [x, y, z]);
}

/**
 * A cheap test for "could any feature reach here", so the relief pass walks the
 * chest and the pelvis rather than all 27,000 vertices. The padding is the
 * cap: nothing outside a feature's bounds grown by the furthest the surface
 * could be pushed can come back with a nonzero relief.
 */
function featureReach(features, pad = 0.02) {
  const boxes = features.map((volume) => {
    const r = Math.max(volume.ra, volume.rb) + volume.blend + pad;
    return [
      Math.min(volume.a[0], volume.b[0]) - r, Math.min(volume.a[1], volume.b[1]) - r,
      Math.min(volume.a[2], volume.b[2]) - r, Math.max(volume.a[0], volume.b[0]) + r,
      Math.max(volume.a[1], volume.b[1]) + r, Math.max(volume.a[2], volume.b[2]) + r,
    ];
  });
  return (p) =>
    boxes.some((b) =>
      p[0] >= b[0] && p[0] <= b[3] && p[1] >= b[1] && p[1] <= b[4] && p[2] >= b[2] && p[2] <= b[5]);
}

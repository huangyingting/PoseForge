/** Portable, explicit world placement; omitted placement keeps automatic layout. */
import { clamp, quatFromEulerXYZ, quatNormalize } from "./math.js";
import { CHANNELS, POSEABLE_BONES } from "./skeleton.js";

export const PLACEMENT_POSITION_LIMIT = 10;
const DEG = Math.PI / 180;

export function checkPlacement(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["position", "rotation"].includes(key))
  )
    throw new TypeError("Placement needs only position and rotation vectors.");
  const result = {};
  for (const [key, limit] of [
    ["position", PLACEMENT_POSITION_LIMIT],
    ["rotation", 180],
  ]) {
    if (
      !Array.isArray(value[key]) ||
      value[key].length !== 3 ||
      Array.from(value[key]).some(
        (number) =>
          typeof number !== "number" ||
          !Number.isFinite(number) ||
          Math.abs(number) > limit,
      )
    )
      throw new TypeError(
        `Placement ${key} needs three numbers from -${limit} to ${limit}.`,
      );
    result[key] = value[key].map((number) =>
      Object.is(number, -0) ? 0 : number,
    );
  }
  return result;
}

export function rootFromPlacement(value) {
  const placement = checkPlacement(value);
  return {
    position: placement.position,
    quaternion: quatFromEulerXYZ(
      ...placement.rotation.map((angle) => angle * DEG),
    ),
  };
}

/** Canonical XYZ angles, including the singular +/-90-degree Y cases. */
export function placementFromRoot(root) {
  if (
    !root ||
    !Array.isArray(root.quaternion) ||
    root.quaternion.length !== 4 ||
    root.quaternion.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(Math.hypot(...root.quaternion)) ||
    Math.hypot(...root.quaternion) < 1e-12
  )
    throw new TypeError("No finite solved placement is available.");
  const [x, y, z, w] = quatNormalize(root.quaternion);
  const r11 = 1 - 2 * (y * y + z * z),
    r12 = 2 * (x * y - z * w),
    r13 = 2 * (x * z + y * w);
  const r22 = 1 - 2 * (x * x + z * z),
    r23 = 2 * (y * z - x * w);
  const r32 = 2 * (y * z + x * w),
    r33 = 1 - 2 * (x * x + y * y);
  const middle = Math.asin(clamp(r13, -1, 1));
  const rotation =
    Math.abs(r13) < 1 - 2 * Number.EPSILON
      ? [Math.atan2(-r23, r33), middle, Math.atan2(-r12, r11)]
      : [Math.atan2(r32, r22), middle, 0];
  return checkPlacement({
    position: root.position,
    rotation: rotation.map((value) => {
      const degrees = clamp(value / DEG, -180, 180);
      return Math.abs(degrees) < 1e-10 ? 0 : degrees;
    }),
  });
}

/** Capture only public adjustable channels, never internal tip/root joints. */
export function captureSolvedPose(actor) {
  const pose = actor.pose ?? actor;
  const joints = Object.fromEntries(
    POSEABLE_BONES.map(({ name }) => [
      name,
      Object.fromEntries(
        CHANNELS.map((channel) => {
          const value = pose.joints?.[name]?.[channel];
          if (!Number.isFinite(value))
            throw new TypeError("No complete solved pose is available.");
          return [channel, value];
        }),
      ),
    ]),
  );
  return {
    placement: placementFromRoot(pose.root),
    jointMode: "fixed",
    joints,
    ...(actor.hands ? { hands: structuredClone(actor.hands) } : {}),
  };
}

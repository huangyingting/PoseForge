/**
 * The viewport.
 *
 * Skin is the hardest common material to render, and the reason is not
 * roughness or colour - it is that light goes *into* it and comes back out
 * somewhere else. A plain dielectric shader makes a body look like a painted
 * mannequin: the terminator between lit and unlit is a hard line, and thin
 * parts like fingers and ears go black where they should glow. Both of those
 * are exactly what the eye uses to judge whether it is looking at a person.
 *
 * So the skin material here wraps the diffuse term around the terminator and
 * adds a thickness-driven transmission glow, which is the cheap standing-in for
 * subsurface scattering, and it reads far better than the extra cost suggests.
 * Thickness comes free: the mesher already knows how enclosed each vertex is,
 * because it sampled the distance field along the normal to compute occlusion.
 *
 * The other half is the contact shadow. Two figures only read as touching if
 * the crease where they meet goes dark, and the AO from the field does that
 * exactly where the solver put the contact - it is the same field, so the
 * shading agrees with the geometry by construction rather than by tuning.
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { buildProps, disposeProps } from "./props.js";

/**
 * Skin tones, by actor index.
 *
 * Index rather than body type on purpose. The parser knows whether it was told
 * "woman" or "man", but it knows nothing whatever about anyone's colouring, and
 * inventing a correlation between the two would be both wrong and ugly. What
 * the render actually needs is for the two figures to be told apart where they
 * overlap, and two adjacent tones do that without claiming anything.
 */
export const SKIN = [0xe0b49a, 0xc98f74, 0xa9705a, 0x8a5540, 0xf0cdb6];

/**
 * Wrapped diffuse plus a thickness glow, patched into the standard shader.
 *
 * Patching rather than writing a material from scratch keeps every other thing
 * `MeshPhysicalMaterial` does - shadows, tone mapping, the environment - and
 * changes only the one term that is wrong for skin.
 */
function skinMaterial(colour) {
  const material = new MeshPhysicalMaterial({
    color: new Color(colour),
    roughness: 0.58,
    metalness: 0,
    // A very slight sheen stands in for the fine hair that catches grazing
    // light along a silhouette. Without it edges read as cut out.
    sheen: 0.28,
    sheenRoughness: 0.85,
    sheenColor: new Color(0xffd9c9),
    clearcoat: 0.08,
    clearcoatRoughness: 0.75,
    vertexColors: false,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.subsurface = { value: new Color(0x9e3b28) };
    shader.uniforms.wrap = { value: 0.45 };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         attribute float occlusion;
         varying float vOcclusion;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vOcclusion = occlusion;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform vec3 subsurface;
         uniform float wrap;
         varying float vOcclusion;`
      )
      // Wrap the direct lighting around the terminator. Skin lit from the side
      // stays lit a good way past 90 degrees, and reddens as it goes because
      // the light that makes it through has been filtered by blood.
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
         material.diffuseColor.rgb *= mix(1.0, vOcclusion, 0.85);`
      )
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
         {
           // Thin, unoccluded parts transmit. vOcclusion is 1 out in the open
           // and falls towards 0 in a crease, so its complement is a usable
           // stand-in for how much body is behind this point.
           float thin = smoothstep(0.35, 1.0, vOcclusion);
           float rim = 1.0 - abs(dot(normalize(vViewPosition), normal));
           reflectedLight.indirectDiffuse += subsurface * (pow(rim, 2.5) * thin * wrap * 0.35);
         }`
      );

    material.userData.shader = shader;
  };
  // Two materials that compile to the same program should share it.
  material.customProgramCacheKey = () => "poseforge-skin";
  return material;
}

/** Turn a mesher result into a three.js geometry. */
function toGeometry(mesh) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.setAttribute(
    "occlusion",
    new BufferAttribute(mesh.occlusion ?? new Float32Array(mesh.positions.length / 3).fill(1), 1)
  );
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Three-point lighting, sized to the scene.
 *
 * The key casts; the fill and rim do not. One shadow-casting light is what
 * keeps the contact shadow between two bodies readable - a second caster puts a
 * competing shadow across the same crease and the eye stops being able to tell
 * which surface is in front.
 */
function buildLights(scene) {
  const key = new DirectionalLight(0xfff1e0, 2.6);
  key.position.set(2.4, 3.4, 2.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 3;
  const cam = key.shadow.camera;
  cam.left = -2.5;
  cam.right = 2.5;
  cam.top = 2.5;
  cam.bottom = -2.5;
  cam.near = 0.4;
  cam.far = 12;
  cam.updateProjectionMatrix();
  scene.add(key);
  scene.add(key.target);

  const fill = new DirectionalLight(0xc9dcff, 0.75);
  fill.position.set(-3, 1.6, 1.4);
  scene.add(fill);

  const rim = new DirectionalLight(0xffffff, 1.5);
  rim.position.set(-1.2, 2.2, -3.2);
  scene.add(rim);

  scene.add(new HemisphereLight(0xdfe8ff, 0x6b5a4a, 0.55));
  scene.add(new AmbientLight(0xffffff, 0.12));

  return { key, fill, rim };
}

/**
 * Create a viewport bound to a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{alpha?: boolean, shadows?: boolean}} [options]
 */
export function createRenderer(canvas, { alpha = false, shadows = true } = {}) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha,
    preserveDrawingBuffer: true, // needed to read pixels back for PNG export
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;

  const scene = new Scene();
  scene.background = alpha ? null : new Color(0xf2efe9);
  const lights = buildLights(scene);

  const camera = new PerspectiveCamera(38, 1, 0.05, 60);
  camera.position.set(2.6, 1.7, 3.2);

  const bodies = new Group();
  bodies.name = "bodies";
  scene.add(bodies);
  let propGroup = null;

  const focus = new Vector3(0, 0.9, 0);

  /** Clear the figures without touching the lights or the camera. */
  function clearBodies() {
    for (const child of [...bodies.children]) {
      child.geometry.dispose();
      child.material.dispose();
      bodies.remove(child);
    }
  }

  /**
   * Replace the scene's contents.
   *
   * @param {{meshes: Array<object>, props?: Array<object>, bounds?: number[][]}} payload
   */
  function setScene({ meshes, props }) {
    clearBodies();
    if (propGroup) {
      disposeProps(propGroup);
      scene.remove(propGroup);
    }
    propGroup = buildProps(props);
    scene.add(propGroup);

    meshes.forEach((mesh, index) => {
      const body = new Mesh(toGeometry(mesh), skinMaterial(SKIN[index % SKIN.length]));
      body.castShadow = true;
      body.receiveShadow = true;
      body.name = mesh.id ?? `actor${index}`;
      bodies.add(body);
    });

    frame();
  }

  /**
   * Point the camera at whatever is there, at a distance that fits it.
   *
   * Framing from the figures' own bounds rather than from a fixed camera is
   * what makes a standing pair and a pair lying down both fill the picture. A
   * fixed camera has to be set for the largest case and then everything else
   * sits small in the middle of the frame.
   */
  function frame() {
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    bodies.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry.computeBoundingBox();
      const b = node.geometry.boundingBox;
      for (const axis of [0, 1, 2]) {
        box.min[axis] = Math.min(box.min[axis], b.min.getComponent(axis));
        box.max[axis] = Math.max(box.max[axis], b.max.getComponent(axis));
      }
    });
    if (!Number.isFinite(box.min[0])) return;

    const size = [0, 1, 2].map((axis) => box.max[axis] - box.min[axis]);
    focus.set(
      (box.min[0] + box.max[0]) / 2,
      (box.min[1] + box.max[1]) / 2,
      (box.min[2] + box.max[2]) / 2
    );
    const extent = Math.max(size[0], size[1], size[2], 0.4);
    const distance = (extent * 0.62) / Math.tan((camera.fov * Math.PI) / 360) + extent * 0.5;
    const direction = camera.position.clone().sub(focus);
    if (direction.lengthSq() < 1e-6) direction.set(1, 0.6, 1.2);
    camera.position.copy(focus).add(direction.normalize().multiplyScalar(distance));
    camera.lookAt(focus);

    lights.key.target.position.copy(focus);
    lights.key.position.copy(focus).add(new Vector3(2.4, 3.2, 2.0));
    lights.key.target.updateMatrixWorld();
  }

  /** Orbit the camera around the current focus. */
  function orbit(deltaYaw, deltaPitch) {
    const offset = camera.position.clone().sub(focus);
    const radius = offset.length();
    let theta = Math.atan2(offset.x, offset.z) + deltaYaw;
    let phi = Math.acos(Math.min(1, Math.max(-1, offset.y / radius))) + deltaPitch;
    // Stop short of straight up and straight down, where the orbit gimbals and
    // the view flips over.
    phi = Math.min(Math.PI - 0.08, Math.max(0.08, phi));
    camera.position.set(
      focus.x + radius * Math.sin(phi) * Math.sin(theta),
      focus.y + radius * Math.cos(phi),
      focus.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(focus);
  }

  /** Move the camera towards or away from the focus. */
  function dolly(factor) {
    const offset = camera.position.clone().sub(focus);
    const radius = Math.min(14, Math.max(0.5, offset.length() * factor));
    camera.position.copy(focus).add(offset.normalize().multiplyScalar(radius));
    camera.lookAt(focus);
  }

  /**
   * Named viewpoints.
   *
   * Three-quarter is the default because it is the only one of these that shows
   * depth; the orthogonal views are for checking, not for looking at. "Top"
   * especially: it is the view that makes it obvious whether two people are
   * actually aligned or merely appear to be from the front.
   */
  const VIEWS = {
    front: [0, 0.18, 1],
    side: [1, 0.18, 0],
    top: [0.001, 1, 0.001],
    three_quarter: [0.75, 0.42, 1],
  };

  function setView(name) {
    const direction = VIEWS[name] ?? VIEWS.three_quarter;
    const radius = camera.position.distanceTo(focus);
    camera.position
      .copy(focus)
      .add(new Vector3(...direction).normalize().multiplyScalar(radius));
    camera.lookAt(focus);
  }

  function resize(width, height, pixelRatio = window.devicePixelRatio || 1) {
    renderer.setPixelRatio(Math.min(pixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render() {
    renderer.render(scene, camera);
  }

  function dispose() {
    clearBodies();
    if (propGroup) disposeProps(propGroup);
    renderer.dispose();
  }

  return {
    renderer,
    scene,
    camera,
    setScene,
    frame,
    setView,
    orbit,
    dolly,
    resize,
    render,
    dispose,
    focus,
  };
}

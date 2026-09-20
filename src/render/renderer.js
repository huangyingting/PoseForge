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
  TextureLoader,
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
 *
 * The range is East Asian, which is a statement about undertone before it is
 * one about lightness. The five this replaced ran 0xe0b49a to 0x8a5540 - a pink
 * undertone, red above green above blue by a wide margin, which is northern
 * European skin. These keep the same spread of lightness and move the hue to
 * gold: green sits much closer to red (within 8-12 levels rather than 30-40)
 * and blue drops away, which is the olive cast of Fitzpatrick III-IV. Rendered
 * over the atlas the difference is clear on the chest and the forearm, which
 * are the largest flat areas a viewer reads tone from.
 *
 * Still five, still adjacent, so two figures in one picture are still told
 * apart where they overlap.
 */
export const SKIN = [0xe8c9a4, 0xd9b183, 0xc69a6a, 0xab7f53, 0xf2dcbd];

/**
 * The skin atlases, by body type.
 *
 * These ship with the scans and are the diffuse maps those meshes were made
 * for, so the UVs already in the GLB address them directly. They are nude
 * photographic skin - nipples, navel, the creases of the palm - and that is the
 * point: the figures are nude, and a flat tone over a correct silhouette is the
 * one thing that will not read as a body no matter how good the geometry is.
 *
 * Multiplied over the per-actor tone rather than replacing it, so two figures
 * in one picture still differ from each other. The atlas is close to neutral,
 * so the product keeps both the photograph's detail and the tone's identity.
 */
const SKIN_ATLAS = {
  female: new URL("../../assets/models/skin-female.png", import.meta.url),
  male: new URL("../../assets/models/skin-male.png", import.meta.url),
  neutral: new URL("../../assets/models/skin-female.png", import.meta.url),
};
const atlases = new Map();
const loader = new TextureLoader();

/**
 * The atlas for a body type, loaded once and shared.
 *
 * Failure is not fatal: three hands back a texture that is simply never
 * populated, the material keeps its flat tone, and the picture is the one this
 * renderer drew before the atlases existed.
 */
function skinAtlas(bodyType) {
  const url = String(SKIN_ATLAS[bodyType] ?? SKIN_ATLAS.neutral);
  if (!atlases.has(url)) {
    const texture = loader.load(url);
    texture.colorSpace = SRGBColorSpace;
    // The atlas is authored with the glTF convention - v down from the top
    // left - which is what the GLB's own TEXCOORD_0 expects and the opposite of
    // three's default.
    texture.flipY = false;
    texture.anisotropy = 8;
    atlases.set(url, texture);
  }
  return atlases.get(url);
}

/**
 * The per-actor tone, weakened so it can multiply a photograph.
 *
 * `SKIN` is a set of finished skin colours, chosen to be read directly. The
 * atlas is also a finished skin colour, and the product of two of those is
 * neither: 0.74 x 0.73 is 0.54, and a figure that should be light brown comes
 * out the colour of a chestnut. Lightening the tone most of the way to white
 * makes it a tint over the photograph instead of a second coat of paint, and
 * that is all it needs to be - the job the tone has in a two-figure picture is
 * to tell the two figures apart, not to describe anybody.
 */
const ATLAS_TINT = 0.65;
function tinted(colour) {
  return new Color(colour).lerp(new Color(0xffffff), ATLAS_TINT);
}

/**
 * Wrapped diffuse plus a thickness glow, patched into the standard shader.
 *
 * Patching rather than writing a material from scratch keeps every other thing
 * `MeshPhysicalMaterial` does - shadows, tone mapping, the environment - and
 * changes only the one term that is wrong for skin.
 */
function skinMaterial(colour, atlas = null) {
  const material = new MeshPhysicalMaterial({
    color: new Color(colour),
    map: atlas,
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

    carryOcclusion(shader);

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
  // Two materials that compile to the same program should share it - and a
  // textured one does not compile to the same program as an untextured one,
  // which is why the key is not a constant. The eyes and the anatomy part share
  // a body's atlas, but a figure drawn from the field has no UVs at all.
  material.customProgramCacheKey = () => (atlas ? "poseforge-skin-map" : "poseforge-skin");
  return material;
}

/**
 * The vertex occlusion attribute, plumbed through to the fragment stage.
 *
 * Both materials here want it and neither of them can get it any other way:
 * three's own `aoMap` is a texture read through a second UV set, and what the
 * mesher produces is a value per vertex.
 */
function carryOcclusion(shader) {
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
  return shader;
}

/**
 * Eyes.
 *
 * Not skin: no wrap, no subsurface, and a clearcoat standing in for the tear
 * film, which is the whole reason an eye reads as wet. The occlusion these
 * parts carry is not the field's - the field has no eye socket in it to shade
 * them with - but a baked lid shadow, so it is applied flat rather than mixed.
 */
function eyeMaterial(colour) {
  const material = new MeshPhysicalMaterial({
    color: new Color().setRGB(colour[0], colour[1], colour[2], SRGBColorSpace),
    roughness: 0.14,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  material.onBeforeCompile = (shader) => {
    carryOcclusion(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n varying float vOcclusion;")
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
         material.diffuseColor.rgb *= vOcclusion;`
      );
  };
  material.customProgramCacheKey = () => "poseforge-eye";
  return material;
}

/**
 * Hair.
 *
 * Also not skin, and not the eyes either. Hair's whole appearance is its
 * specular: at an albedo around 0.05 the diffuse term is a fifteenth of what
 * the skin beside it returns, so what tells a viewer this is hair and not a
 * hole cut in the picture is the band of reflection running across it, and a
 * reflection off a dielectric is not attenuated by albedo at all.
 *
 * `sheen` is the term that gives it: a broad retro-reflective lobe over the
 * whole surface, which is what a mass of fine fibres returns, on top of the
 * ordinary specular that draws the band. Roughness is well up from the eyes'
 * 0.14 because the band on a head of hair is a hand's width across, not a
 * point, and the clearcoat is off - hair is not wet.
 *
 * 0.42 and not the 0.34 this ran at, which is the same correction the CLI's
 * tight lobe took and for the same reason: at 0.34 the band was wide enough to
 * cover the whole front of the cap at once, so the lock ridges meant to break
 * it up were all inside it and the head came back wearing a gloss visor.
 *
 * The occlusion is the field's, mixed rather than applied flat, so hair falling
 * against a neck darkens where it touches.
 */
function hairMaterial(colour) {
  const material = new MeshPhysicalMaterial({
    color: new Color().setRGB(colour[0], colour[1], colour[2], SRGBColorSpace),
    roughness: 0.42,
    metalness: 0,
    sheen: 0.7,
    sheenRoughness: 0.5,
    sheenColor: new Color(0xbfb6ad),
  });
  material.onBeforeCompile = (shader) => {
    carryOcclusion(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n varying float vOcclusion;")
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
         material.diffuseColor.rgb *= mix(1.0, vOcclusion, 0.8);`
      );
  };
  material.customProgramCacheKey = () => "poseforge-hair";
  return material;
}

/**
 * Fabric.
 *
 * Knitted cotton, which is the honest answer for a bra and a pair of briefs and
 * is also the easiest thing in this file to get wrong, because the default for
 * an unknown coloured submesh here is `eyeMaterial` and that carries a full
 * clearcoat. Cloth under a clearcoat reads as wet, or as latex, and in black -
 * which is what the garments default to - it reads as a hole cut in the figure.
 *
 * So: rough, no clearcoat, and a small sheen. The sheen is doing real work
 * rather than decoration. Black fabric has an albedo of about 0.05, which is
 * under half what the darkest skin returns, so its diffuse shading carries
 * almost no information about its shape - a pair of briefs lit only
 * diffusely is a silhouette. The retro-reflective lobe off the nap of the
 * knit is most of what actually tells an eye that a dark garment is curved,
 * and it survives at an albedo where nothing else does.
 */
function fabricMaterial(colour) {
  const material = new MeshPhysicalMaterial({
    color: new Color().setRGB(colour[0], colour[1], colour[2], SRGBColorSpace),
    roughness: 0.86,
    metalness: 0,
    sheen: 0.55,
    sheenRoughness: 0.75,
    sheenColor: new Color(0x8e8a86),
  });
  material.onBeforeCompile = (shader) => {
    carryOcclusion(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n varying float vOcclusion;")
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
         material.diffuseColor.rgb *= mix(1.0, vOcclusion, 0.7);`
      );
  };
  material.customProgramCacheKey = () => "poseforge-fabric";
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
  // The scan brings its own; the field does not, and a body drawn from the
  // field is drawn untextured rather than drawn with somebody else's chart.
  if (mesh.uvs) geometry.setAttribute("uv", new BufferAttribute(mesh.uvs, 2));
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
      // An actor arrives as several parts because it is several materials - the
      // skin, and the white, iris and pupil of each eye. A body that came back
      // as one buffer, which is what the distance field produces, is treated as
      // a single primary part so both paths draw through the same code.
      const parts = mesh.parts ?? [{ ...mesh, primary: true }];
      const tone = SKIN[index % SKIN.length];
      for (const part of parts) {
        // Flesh takes the per-actor skin tone; trim keeps the colour it was
        // authored with. The scan's body carries a baseColorFactor of its own,
        // so "is this flesh" is `primary` *or* the absence of a colour - which
        // is what marks the anatomy `featureRelief` adds as a separate part.
        const flesh = part.primary || !part.colour;
        const atlas = flesh && part.uvs ? skinAtlas(mesh.bodyType) : null;
        const material = flesh
          ? skinMaterial(atlas ? tinted(tone) : tone, atlas)
          : part.hair
            ? hairMaterial(part.colour)
            : part.garment
              ? fabricMaterial(part.colour)
              : eyeMaterial(part.colour);
        const body = new Mesh(toGeometry(part), material);
        // Eyes sit inside a socket that is already baked into their own
        // occlusion. Letting them into the shadow map as well would shade them
        // twice, and casting from them puts an eyeball's shadow on the inside
        // of a face.
        // Eyes stay out of the shadow map; hair and cloth emphatically do
        // not. A fringe's shadow on a forehead is most of what places the hair
        // in front of the head rather than painted on it, and the same holds
        // for the shadow a band throws on the ribs under it.
        const solid = flesh || !!part.hair || !!part.garment;
        body.castShadow = solid;
        body.receiveShadow = solid;
        body.renderOrder = solid ? 0 : 1;
        // Line art traces silhouettes, and an eyeball's silhouette is its
        // equator - a circle buried inside the skull. The depth test would
        // probably hide it, but "probably hidden" is not a reason to hand the
        // tracer a contour that should never be drawn.
        body.userData.outline = solid;
        body.name = part.primary
          ? (mesh.id ?? `actor${index}`)
          : `${mesh.id ?? `actor${index}`}.${part.name}`;
        bodies.add(body);
      }
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

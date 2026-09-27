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
  AddEquation,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  OneFactor,
  PCFSoftShadowMap,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  ShaderChunk,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  ZeroFactor,
} from "three";
import { buildProps, disposeProps } from "./props.js";
import { buildRoom, disposeRoom, prepareRoom, roomLayout, SETTINGS, updateRoom, wallColour } from "./room.js";
import { modelFiles } from "../core/bodyModels.js";
import { LACE_REPEAT, LACE_SIZE, lacePattern } from "../core/lace.js";

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
const atlasUrl = (bodyType, model) => {
  // One name inside the template, so the bundler can see which files it may be
  // and ship all of them.
  const { atlas } = modelFiles(bodyType, model);
  return String(new URL(`../../assets/models/skin-${atlas}.png`, import.meta.url));
};
const atlases = new Map();
const loader = new TextureLoader();
const textureListeners = new Set();

/**
 * The atlas for a body type and model (see `core/bodyModels.js`), loaded once
 * and shared.
 *
 * Failure is not fatal: three hands back a texture that is simply never
 * populated, the material keeps its flat tone, and the picture is the one this
 * renderer drew before the atlases existed.
 */
function skinAtlas(bodyType, model) {
  const url = atlasUrl(bodyType, model);
  if (!atlases.has(url)) {
    const texture = loader.load(url, () => textureListeners.forEach(notify => notify()), undefined,
      () => textureListeners.forEach(notify => notify()));
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
 * The skin's fine relief - pores, and the crosshatch of creases they sit in -
 * as a tiling normal map, made here rather than shipped.
 *
 * The atlas is a photograph of skin colour, and colour is the half of skin
 * texture that survives flat lighting. The other half is the relief: the
 * surface is not smooth, so a highlight on it is not a smooth gradient but a
 * field of glints broken up by the pits and furrows, and that breaking up is
 * most of what a close look at a shoulder or a cheek reads as "skin" rather
 * than "wax". Without it the specular below is a clean sheen and the figure
 * looks lacquered, which is worse than no specular at all.
 *
 * Generated, because it is noise: a pit per cell of a jittered grid for the
 * pores, the edges of a coarser Voronoi pattern for the creases, all tiling
 * exactly so the repeat has no seam. Seeded, so every run draws the same skin.
 */
const DETAIL_SIZE = 256;

/**
 * Tiles of detail across the atlas. The scans' charts spread roughly a metre
 * and three quarters of body across the unit square, so 48 puts a tile at
 * about 36mm, a pore every millimetre and a crease cell every two and a half -
 * coarser than life, and deliberately, since true scale would never outlast
 * the first mip.
 */
const DETAIL_REPEAT = 48;

let detail = null;
function skinDetail() {
  if (detail) return detail;
  const n = DETAIL_SIZE;
  let seed = 0x5eed5;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const wrap = (i) => ((i % n) + n) % n;
  const height = new Float32Array(n * n);

  // Creases: low along the edges of a Voronoi pattern, where the nearest two
  // seeds are nearly as near as each other.
  const cells = 15;
  const pitch = n / cells;
  const seeds = Array.from({ length: cells * cells }, (_, i) => [((i % cells) + random()) * pitch, (Math.floor(i / cells) + random()) * pitch]);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const cx = Math.floor(x / pitch);
      const cy = Math.floor(y / pitch);
      let f1 = Infinity;
      let f2 = Infinity;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const gx = cx + dx;
          const gy = cy + dy;
          const [sx, sy] = seeds[(((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells)];
          // The seed's own copy nearest this pixel, so the pattern wraps.
          const ox = sx + (Math.floor(gx / cells) * cells * pitch) - x;
          const oy = sy + (Math.floor(gy / cells) * cells * pitch) - y;
          const d = Math.hypot(ox, oy);
          if (d < f1) [f1, f2] = [d, f1];
          else if (d < f2) f2 = d;
        }
      }
      height[y * n + x] = -0.45 * Math.exp(-((f2 - f1) ** 2) / 3);
    }
  }

  // Pores: a soft pit a texel or two across in each cell of a finer grid.
  const pores = 36;
  const step = n / pores;
  for (let py = 0; py < pores; py += 1) {
    for (let px = 0; px < pores; px += 1) {
      const x0 = (px + 0.15 + 0.7 * random()) * step;
      const y0 = (py + 0.15 + 0.7 * random()) * step;
      const radius = 0.7 + 0.7 * random();
      const depth = 0.5 + 0.5 * random();
      const reach = Math.ceil(radius * 3);
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          const x = Math.round(x0) + dx;
          const y = Math.round(y0) + dy;
          const d2 = (x - x0) ** 2 + (y - y0) ** 2;
          height[wrap(y) * n + wrap(x)] -= depth * Math.exp(-d2 / (2 * radius * radius));
        }
      }
    }
  }

  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const sx = height[y * n + wrap(x + 1)] - height[y * n + wrap(x - 1)];
      const sy = height[wrap(y + 1) * n + x] - height[wrap(y - 1) * n + x];
      const length = Math.hypot(sx, sy, 1);
      const o = (y * n + x) * 4;
      data[o] = Math.round((-sx / length * 0.5 + 0.5) * 255);
      data[o + 1] = Math.round((-sy / length * 0.5 + 0.5) * 255);
      data[o + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  detail = new DataTexture(data, n, n);
  detail.wrapS = RepeatWrapping;
  detail.wrapT = RepeatWrapping;
  detail.repeat.set(DETAIL_REPEAT, DETAIL_REPEAT);
  detail.magFilter = LinearFilter;
  detail.minFilter = LinearMipmapLinearFilter;
  detail.generateMipmaps = true;
  detail.anisotropy = 8;
  detail.needsUpdate = true;
  return detail;
}

/**
 * How far past the terminator each channel's light wraps: red furthest, since
 * red is what travels furthest under the surface before it comes back out.
 */
const SKIN_WRAP = [0.5, 0.4, 0.34];

/**
 * What the key is worth on skin where its shadow map says it is blocked, and
 * the exponents that warm the penumbra on its way there. The CLI's reasons for
 * the floor (`scripts/render-cli.mjs`, `umbra`) are this renderer's too: the
 * key stands for a window, and nothing on a body is large enough to cast a
 * true umbra from one. The warm edge is the scatter again - light entering on
 * the lit side of a shadow's edge comes out on the dark side, and red is the
 * part of it that gets there.
 */
const SKIN_UMBRA = 0.18;
const SKIN_PENUMBRA = [0.8, 1.05, 1.2];

/**
 * The two lighting chunks the skin patches, patched.
 *
 * Exported for the test that pins them to this version of three: the patch is
 * a text substitution into three's own shader source, and a substitution that
 * finds nothing fails silently - the skin would simply go back to plastic.
 *
 * `RE_Direct_Physical` gets its diffuse term wrapped, per channel. The
 * directional-light loop gets its shadow lookup gated the way the CLI's is:
 * three's shadow map, like the CLI's, holds the faces turned away from the
 * light, so the lookup on skin turned away is the surface compared with
 * itself, and the wrapped light there would be cut off in a ragged line
 * exactly where the wrap is meant to carry it. Faded out over the first
 * seventeen degrees of the lit side, it is the lookup unchanged anywhere a
 * cast shadow is legible and 1 wherever the wrap alone should be taking the
 * light out. What the floor adds is held apart and given to the diffuse term
 * only, since a highlight in a shadow is a glint that could not be there.
 */
export function skinShaderChunks() {
  const patch = (source, from, to) => {
    if (!source.includes(from)) throw new Error(`three's shader source no longer contains ${from.trim()}`);
    return source.replace(from, to);
  };
  const vec3 = (v) => `vec3(${v.map((x) => x.toFixed(3)).join(", ")})`;
  const direct = patch(
    ShaderChunk.lights_physical_pars_fragment,
    "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );",
    `vec3 wrapped = saturate( ( vec3( dot( geometryNormal, directLight.direction ) ) + skinWrap * skinKey ) / ( 1.0 + skinWrap * skinKey ) );
     reflectedLight.directDiffuse += wrapped * ( directLight.color + skinLeak ) * BRDF_Lambert( material.diffuseColor );
     skinLeak = vec3( 0.0 );
     skinKey = 0.0;`
  );
  const shadow = "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;";
  const lights = patch(
    ShaderChunk.lights_fragment_begin,
    shadow,
    `{
       float visible = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
       float gate = pow2( saturate( dot( geometryNormal, directLight.direction ) / 0.3 ) );
       visible = 1.0 - gate * ( 1.0 - visible );
       skinLeak = directLight.color * ( ${SKIN_UMBRA.toFixed(3)} * ( 1.0 - visible ) );
       skinKey = 1.0;
       directLight.color *= pow( vec3( visible ), ${vec3(SKIN_PENUMBRA)} );
     }`
  );
  return {
    pars: `uniform vec3 skinWrap;
           vec3 skinLeak = vec3( 0.0 );
           float skinKey = 0.0;
           ${direct}`,
    lights,
  };
}

/**
 * Wrapped diffuse, a warm shadow edge, fine relief and a thickness glow,
 * patched into the standard shader.
 *
 * Patching rather than writing a material from scratch keeps every other thing
 * `MeshPhysicalMaterial` does - shadows, tone mapping, the environment - and
 * changes only the terms that are wrong for skin.
 *
 * The specular is two lobes, as measured skin's is: the base layer's, broad,
 * which is the skin itself, and the clearcoat's, tighter and weaker, which is
 * the film of oil over it and what puts the small bright highlight on a
 * shoulder or the bridge of a nose. The base was at 0.68 and a coat of 0.02,
 * which is a surface with no highlight at all - chalk, or the painted
 * mannequin this is meant not to be. Both lobes take the relief, so both
 * break up the way skin's highlights do. An ior of 1.4 is skin's, and gives
 * it the 2.8% reflectance at normal incidence that is measured, not the
 * default 4%, which is glass.
 */
function skinMaterial(colour, atlas = null) {
  const relief = atlas ? skinDetail() : null;
  const material = new MeshPhysicalMaterial({
    color: new Color(colour),
    map: atlas,
    roughness: 0.52,
    metalness: 0,
    ior: 1.4,
    // The relief needs the atlas's UVs to sit on; a figure drawn from the field
    // has none, and is smooth.
    normalMap: relief,
    normalScale: new Vector2(0.3, 0.3),
    // A very slight sheen stands in for the fine hair that catches grazing
    // light along a silhouette. Without it edges read as cut out.
    sheen: 0.16,
    sheenRoughness: 0.85,
    sheenColor: new Color(0xffd9c9),
    clearcoat: 0.14,
    clearcoatRoughness: 0.34,
    clearcoatNormalMap: relief,
    clearcoatNormalScale: new Vector2(0.5, 0.5),
    vertexColors: false,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.subsurface = { value: new Color(0x9e3b28) };
    shader.uniforms.wrap = { value: 0.45 };
    shader.uniforms.skinWrap = { value: new Vector3(...SKIN_WRAP) };

    carryOcclusion(shader);

    const chunks = skinShaderChunks();
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
      .replace("#include <lights_physical_pars_fragment>", chunks.pars)
      .replace("#include <lights_fragment_begin>", chunks.lights)
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
 * The hair cards' textures, by name, loaded once and shared - every figure
 * wearing the same trim wears the same picture of it, and only the colour the
 * material multiplies it by is theirs. Grey and alpha: the grey is the strands'
 * shading, stretched so its brightest is white (the `gain` the card carries
 * undoes that), and the alpha is where there are strands at all.
 */
const cardTextures = new Map();
function cardTexture(name) {
  if (!cardTextures.has(name)) {
    const url = String(new URL(`../../assets/models/hair/${name}.png`, import.meta.url));
    const texture = loader.load(url, () => textureListeners.forEach(notify => notify()), undefined,
      () => textureListeners.forEach(notify => notify()));
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = 8;
    cardTextures.set(name, texture);
  }
  return cardTextures.get(name);
}

/**
 * Hair drawn as cards: the hair material above, over a texture of strands,
 * with the gaps between them cut out.
 *
 * Cut rather than blended. A few thousand overlapping transparent sheets would
 * have to be sorted back to front, per pixel, every frame, to blend right, and
 * unsorted they flicker as the camera turns. A cut needs no sorting, and alpha
 * to coverage turns its edge into as many steps as the canvas has samples,
 * which at a strand's width is enough to read as soft.
 *
 * The one thing a plain cut gets wrong is distance. The mipmaps average the
 * alpha down with everything else, so a strand a texel wide is at a quarter of
 * its alpha two levels down and under the cut at three: the hair thins as the
 * camera backs off, and a head across the room is bald. Scaling the alpha up
 * by the level it is read at puts back what the averaging took out, and it is
 * the standard repair for exactly this.
 *
 * Both sides, because a card is a sheet and hair is seen from behind as often
 * as in front; the cards are wound to face out of the head (see `cardSubmesh`),
 * so the side three turns the normal round for is the inside.
 */
function cardMaterial(colour, cards) {
  const material = hairMaterial(colour);
  // The cards know which way the strands run - down the texture, every trim
  // MakeHuman ships - so the highlight can do what a fibre's does and stretch
  // across them into a band, rather than sit on the crown as a round gloss.
  material.anisotropy = 0.8;
  material.anisotropyRotation = 0;
  // And most of the sheen goes. On the shell it stood in for the fibres the
  // surface did not have; the cards have them, painted, and the sheen's
  // grazing lobe - untouched by the texture's dark - frosted every strip seen
  // edge-on, which on short hair is most of the sides of the head.
  material.sheen = 0.2;
  return cutOut(material, cards, "poseforge-hair-cards");
}

/**
 * Draw colour and leave the canvas's alpha as it was.
 *
 * For anything cut with alpha to coverage. The alpha a fragment writes is what
 * sets how many of a pixel's samples it covers, so it has to be the fraction
 * and not one - and it then lands in the canvas as well, where on some
 * implementations (SwiftShader among them) the page composites through it even
 * though the context was asked for no alpha at all: every thread of a lace and
 * every strand's edge came out pale with the page behind it. Blending the
 * colour as a straight replacement and the alpha as "keep what is there" gives
 * the coverage and changes nothing else.
 */
function keepAlpha(material) {
  material.blending = CustomBlending;
  material.blendEquation = AddEquation;
  material.blendSrc = OneFactor;
  material.blendDst = ZeroFactor;
  material.blendSrcAlpha = ZeroFactor;
  material.blendDstAlpha = OneFactor;
  return material;
}

/** `material` over a card texture, cut out: shared with the clay view, where
 *  the cards are still strips of strands and not solid sheets. */
function cutOut(material, cards, key) {
  material.color.multiplyScalar(cards.gain);
  material.map = cardTexture(cards.texture);
  material.alphaTest = 0.5;
  material.alphaToCoverage = true;
  keepAlpha(material);
  material.side = DoubleSide;
  const compile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphatest_fragment>",
      `{
         vec2 texel = vMapUv * vec2(textureSize(map, 0));
         float footprint = max(dot(dFdx(texel), dFdx(texel)), dot(dFdy(texel), dFdy(texel)));
         diffuseColor.a *= 1.0 + 0.25 * max(0.0, 0.5 * log2(footprint));
       }
       #include <alphatest_fragment>`
    );
  };
  material.customProgramCacheKey = () => key;
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
 *
 * That is cotton. The other finishes (see `GARMENT_FINISHES`) change the
 * surface and, for two of them, what shows through it:
 *
 * - lycra is smoother, so its sheen narrows into a soft highlight;
 * - leather is dark and glossy, a clearcoat over a mid roughness, which is the
 *   one place here a clearcoat on cloth is right;
 * - lace is cut, per fragment, by the tile in `lace.js` laid on the body's own
 *   UVs - the same tile the command-line renderer cuts with, so the two draw
 *   the same flowers in the same places;
 * - sheer is blended, and how much of the skin comes through depends on the
 *   angle it is seen at (see `DENIER`).
 *
 * A garment's `trim` - a lace bra's band and straps, a waistband, a stocking's
 * welt - arrives as a distance per vertex and is resolved per fragment at the
 * half, so its edge lies where the garment put it and not on whichever
 * triangle edge is nearest. Trim is never cut and never sheer, and it takes
 * `trimColour` where the garment names one.
 */
function garmentMaterial(part) {
  const finish = FINISHES[part.finish] ? part.finish : "cotton";
  const { roughness, sheen, sheenRoughness, clearcoat = 0, clearcoatRoughness = 0 } = FINISHES[finish];
  const colour = new Color().setRGB(part.colour[0], part.colour[1], part.colour[2], SRGBColorSpace);
  const trim = part.trimColour
    ? new Color().setRGB(part.trimColour[0], part.trimColour[1], part.trimColour[2], SRGBColorSpace)
    : colour.clone();
  const material = new MeshPhysicalMaterial({
    color: colour,
    roughness,
    metalness: 0,
    sheen,
    sheenRoughness,
    sheenColor: new Color(0x8e8a86),
    clearcoat,
    clearcoatRoughness,
  });
  const lace = finish === "lace" && !!part.uvs;
  if (lace) {
    material.alphaMap = laceTexture();
    // Kept above zero only so three compiles the test in; the real test is
    // the replacement below.
    material.alphaTest = 0.02;
    material.alphaToCoverage = true;
    keepAlpha(material);
  }
  if (finish === "sheer") {
    material.transparent = true;
    material.depthWrite = false;
  }
  material.onBeforeCompile = (shader) => {
    carryOcclusion(shader);
    shader.uniforms.trimColour = { value: trim };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n attribute float trim;\n varying float vTrim;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n vTrim = trim;");
    let fragment = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying float vOcclusion;
         varying float vTrim;
         uniform vec3 trimColour;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         float trimmed = smoothstep(0.5 - max(fwidth(vTrim), 1e-4), 0.5 + max(fwidth(vTrim), 1e-4), vTrim);
         diffuseColor.rgb = mix(diffuseColor.rgb, trimColour, trimmed);`
      )
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
         material.diffuseColor.rgb *= mix(1.0, vOcclusion, 0.7);`
      );
    if (lace) {
      // Close up, the tile is magnified and its linear filter would smear each
      // thread's edge over several pixels, so the edge is sharpened to one.
      // Far off, a pixel covers many threads and the mip level's average is
      // the fraction of it that is thread, which alpha to coverage turns into
      // that fraction of the pixel's samples - a veil, as lace is at a
      // distance, rather than the solid sheet or bare skin a cut at a half
      // would make of it.
      fragment = fragment
        .replace(
          "#include <alphamap_fragment>",
          `{
             float thread = texture2D(alphaMap, vAlphaMapUv).g;
             vec2 texel = vAlphaMapUv * vec2(textureSize(alphaMap, 0));
             float footprint = max(dot(dFdx(texel), dFdx(texel)), dot(dFdy(texel), dFdy(texel)));
             float sharp = clamp((thread - 0.5) / max(fwidth(thread), 1e-3) + 0.5, 0.0, 1.0);
             diffuseColor.a *= max(mix(sharp, thread, smoothstep(0.5, 2.0, footprint)), trimmed);
           }`
        )
        .replace("#include <alphatest_fragment>", "if (diffuseColor.a < alphaTest) discard;");
    }
    if (finish === "sheer") {
      fragment = fragment.replace(
        "#include <lights_physical_fragment>",
        `diffuseColor.a = max(1.0 - pow(1.0 - ${DENIER.toFixed(3)}, 1.0 / max(abs(dot(normal, normalize(vViewPosition))), 0.08)), trimmed * 0.92);
         #include <lights_physical_fragment>`
      );
    }
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => `poseforge-garment-${finish}${lace ? "-cut" : ""}`;
  return material;
}

/**
 * What each finish is, as a surface. Cotton is the numbers the fabric has
 * always had; the rest are measured against it by eye, in both renderers.
 */
const FINISHES = {
  cotton: { roughness: 0.86, sheen: 0.55, sheenRoughness: 0.75 },
  lycra: { roughness: 0.5, sheen: 0.7, sheenRoughness: 0.35 },
  lace: { roughness: 0.8, sheen: 0.12, sheenRoughness: 0.6 },
  sheer: { roughness: 0.45, sheen: 0.9, sheenRoughness: 0.3 },
  leather: { roughness: 0.38, sheen: 0.2, sheenRoughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.25 },
};

/**
 * How much of what is behind a stocking it covers, seen square on. A sheer knit
 * is mostly holes face-on and mostly thread at a slant, because the slant looks
 * through more of it, so the cover rises towards the silhouette as
 * `1 - (1 - DENIER)^(1 / facing)`; the welt is knitted close and covers nearly
 * all of it. The command-line renderer blends with the same numbers.
 */
const DENIER = 0.45;

let laceTile = null;

/** The lace tile, the same in every channel since three reads alpha maps from green. */
function laceTexture() {
  if (laceTile) return laceTile;
  const pattern = lacePattern();
  const data = new Uint8Array(LACE_SIZE * LACE_SIZE * 4);
  for (let i = 0; i < pattern.length; i += 1) data.fill(pattern[i], i * 4, i * 4 + 4);
  laceTile = new DataTexture(data, LACE_SIZE, LACE_SIZE);
  laceTile.wrapS = RepeatWrapping;
  laceTile.wrapT = RepeatWrapping;
  laceTile.repeat.set(LACE_REPEAT, LACE_REPEAT);
  laceTile.magFilter = LinearFilter;
  laceTile.minFilter = LinearMipmapLinearFilter;
  laceTile.generateMipmaps = true;
  laceTile.anisotropy = 8;
  laceTile.needsUpdate = true;
  return laceTile;
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
  // Every garment's shader reads a trim, so one without any is given nothing
  // but zeros: an attribute the shader declares and the geometry lacks reads
  // whatever was last left in that slot.
  if (mesh.garment) {
    geometry.setAttribute("trim", new BufferAttribute(mesh.trim ?? new Float32Array(mesh.positions.length / 3), 1));
  }
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
  const key = new DirectionalLight(0xfff5e9, 2.1);
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

  const fill = new DirectionalLight(0xe5eeff, 1.25);
  fill.position.set(-3, 1.6, 1.4);
  scene.add(fill);

  const rim = new DirectionalLight(0xffffff, 1.1);
  rim.position.set(-1.2, 2.2, -3.2);
  scene.add(rim);

  scene.add(new HemisphereLight(0xf0f4ff, 0x9b9583, 0.85));
  scene.add(new AmbientLight(0xffffff, 0.30));

  return { key, fill, rim };
}

/**
 * Create a viewport bound to a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{alpha?: boolean, shadows?: boolean}} [options]
 */
export function createRenderer(canvas, { alpha = false, shadows = true, onChange = () => {} } = {}) {
  // The shadow map is drawn again only when what it shows can have changed:
  // see `render`. A texture arriving can, because hair cards and lace cast
  // through their cut-outs.
  let shadowsStale = true;
  const changed = () => {
    shadowsStale = true;
    onChange();
  };
  textureListeners.add(changed);
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha,
    preserveDrawingBuffer: true, // needed to read pixels back for PNG export
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  canvas.addEventListener("webglcontextrestored", () => (shadowsStale = true));

  const scene = new Scene();
  scene.background = alpha ? null : new Color(0xf1f3ef);
  const lights = buildLights(scene);

  const camera = new PerspectiveCamera(38, 1, 0.05, 60);
  camera.position.set(2.6, 1.7, 3.2);

  const bodies = new Group();
  bodies.name = "bodies";
  scene.add(bodies);
  let propGroup = null;
  let displayMode = 'natural';
  let lastPayload = null;
  let setting = "studio";
  let room = null;
  let roomKey = null;

  const focus = new Vector3(0, 0.9, 0);

  /** Clear the figures without touching the lights or the camera. */
  function clearBodies() {
    for (const child of [...bodies.children]) {
      child.geometry.dispose();
      child.material.dispose();
      bodies.remove(child);
    }
  }

  /** Everything the solver placed, figures and furniture, as one box. */
  function sceneBounds(meshes, props) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const add = (x, y, z) => {
      if (x < min[0]) min[0] = x;
      if (x > max[0]) max[0] = x;
      if (y < min[1]) min[1] = y;
      if (y > max[1]) max[1] = y;
      if (z < min[2]) min[2] = z;
      if (z > max[2]) max[2] = z;
    };
    for (const mesh of meshes) {
      for (const part of mesh.parts ?? [mesh]) {
        const p = part.positions;
        for (let i = 0; i < p.length; i += 3) add(p[i], p[i + 1], p[i + 2]);
      }
    }
    for (const prop of props ?? []) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        add(prop.center[0] + (sx * prop.size[0]) / 2, prop.center[1], prop.center[2] + (sz * prop.size[2]) / 2);
      }
    }
    if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
    return { min, max };
  }

  /** Keep the room there is when it is laid out the same, and build it when not. */
  function placeRoom(layout) {
    const key = layout ? JSON.stringify(layout) : null;
    if (key === roomKey) return;
    if (room) {
      scene.remove(room);
      disposeRoom(room);
    }
    room = layout ? buildRoom(layout) : null;
    roomKey = key;
    if (room) scene.add(room);
  }

  /**
   * Replace the scene's contents.
   *
   * @param {{meshes: Array<object>, props?: Array<object>, shell?: Array<object>, bounds?: number[][]}} payload
   */
  function setScene({ meshes, props, shell }) {
    lastPayload = { meshes, props, shell };
    shadowsStale = true;
    clearBodies();
    if (propGroup) {
      disposeProps(propGroup);
      scene.remove(propGroup);
    }
    // A car is a room of its own: its cabin in a bedroom would be neither.
    const layout = shell?.length ? null : roomLayout(setting, sceneBounds(meshes, props), props);
    placeRoom(layout);
    // The room's floor takes the shadows the studio's ground would.
    propGroup = buildProps(props, { shell, ground: !room });
    if (room) {
      // A wall to lean on is the room's own wall, so it is painted to match.
      propGroup.traverse((node) => {
        if (node.isMesh && node.name === "wall") node.material.color.set(wallColour(setting));
      });
    }
    scene.add(propGroup);

    meshes.forEach((mesh, index) => {
      // An actor arrives as several parts because it is several materials - the
      // skin, and the white, iris and pupil of each eye. A body that came back
      // as one buffer, which is what the distance field produces, is treated as
      // a single primary part so both paths draw through the same code.
      const parts = mesh.parts ?? [{ ...mesh, primary: true }];
      const tone = /^#[0-9a-f]{6}$/i.test(mesh.skinTone ?? '') ? mesh.skinTone : SKIN[index % SKIN.length];
      for (const part of parts) {
        // Flesh takes the per-actor skin tone; trim keeps the colour it was
        // authored with. The scan's body carries a baseColorFactor of its own,
        // so "is this flesh" is `primary` *or* the absence of a colour - which
        // is what marks the anatomy `featureRelief` adds as a separate part.
        const flesh = part.primary || !part.colour;
        const atlas = flesh && part.uvs && displayMode === 'natural' ? skinAtlas(mesh.bodyType, mesh.model) : null;
        const clay = () => new MeshPhysicalMaterial({ color: index % 2 ? 0x9bafa5 : 0xd2bca6, roughness: 0.78 });
        const material = displayMode === 'clay'
          ? part.cards && part.uvs ? cutOut(clay(), part.cards, "poseforge-clay-cards") : clay()
          : flesh
          ? skinMaterial(atlas ? tinted(tone) : tone, atlas)
          : part.hair
            ? part.cards && part.uvs
              ? cardMaterial(part.colour, part.cards)
              : hairMaterial(part.colour)
            : part.garment
              ? garmentMaterial(part)
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
        // Except cloth the skin shows through. The shadow map is a millimetre
        // and a half to the texel, so it cannot resolve a lace or a knit two and
        // a half millimetres off the skin, and would cast either as a solid
        // sheet - in shade, the skin under every hole of it.
        body.castShadow = solid && !(part.garment && (part.finish === "lace" || part.finish === "sheer"));
        body.receiveShadow = solid;
        // Anything cut with alpha to coverage goes after everything it is cut
        // over, because it keeps the alpha it finds (see `keepAlpha`): drawn
        // first, over a transparent export's empty clear, it would keep the
        // empty, and the skin behind would never get to fill it in.
        const cut = !!part.cards || (part.garment && part.finish === "lace");
        body.renderOrder = solid && !cut ? 0 : 1;
        // Line art traces silhouettes, and an eyeball's silhouette is its
        // equator - a circle buried inside the skull. The depth test would
        // probably hide it, but "probably hidden" is not a reason to hand the
        // tracer a contour that should never be drawn. Hair cards are out for
        // the opposite reason: every one of a few thousand strips has an edge
        // all the way round it, and traced they are a scribble over the head.
        body.userData.outline = solid && !part.cards;
        body.userData.cards = !!part.cards;
        body.name = part.primary
          ? (mesh.id ?? `actor${index}`)
          : `${mesh.id ?? `actor${index}`}.${part.name}`;
        bodies.add(body);
      }
    });

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
    const halfFov = (camera.fov * Math.PI) / 360;
    const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
    const distance = (extent * 0.60) / Math.tan(limitingFov) + extent * 0.5;
    const direction = camera.position.clone().sub(focus);
    if (direction.lengthSq() < 1e-6) direction.set(1, 0.6, 1.2);
    camera.position.copy(focus).add(direction.normalize().multiplyScalar(distance));
    camera.lookAt(focus);

    lights.key.target.position.copy(focus);
    lights.key.position.copy(focus).add(new Vector3(2.4, 3.2, 2.0));
    lights.key.target.updateMatrixWorld();
    shadowsStale = true;
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

  /** Where the camera is about the focus: its turn, height above the horizon and distance. */
  function getOrbit() {
    const offset = camera.position.clone().sub(focus);
    const radius = offset.length();
    return {
      theta: Math.atan2(offset.x, offset.z),
      elevation: Math.asin(Math.min(1, Math.max(-1, offset.y / radius))),
      radius,
    };
  }

  /** Put the camera at a turn, elevation and distance about the focus. */
  function setOrbit({ theta, elevation, radius }) {
    const flat = radius * Math.cos(elevation);
    camera.position.set(
      focus.x + flat * Math.sin(theta),
      focus.y + radius * Math.sin(elevation),
      focus.z + flat * Math.cos(theta)
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

  /**
   * Draw a frame. The key light's shadow map is two thousand pixels square and
   * holds every triangle of both figures, and it is the same map from any
   * camera: only what casts and the key light decide it. So an orbit or a tour
   * redraws the figures and not their shadows, and the map is drawn again only
   * after a new scene, a new framing, a texture, or a wall - with what stands
   * against it - coming or going.
   */
  function render() {
    if (updateRoom(room, camera)) shadowsStale = true;
    if (shadowsStale) renderer.shadowMap.needsUpdate = true;
    shadowsStale = false;
    renderer.render(scene, camera);
  }

  function dispose() {
    textureListeners.delete(changed);
    clearBodies();
    if (propGroup) disposeProps(propGroup);
    disposeRoom(room);
    renderer.dispose();
  }

  return {
    renderer,
    scene,
    camera,
    setScene,
    setDisplayMode(mode) {
      displayMode = mode === 'clay' ? 'clay' : 'natural';
      if (lastPayload) setScene(lastPayload);
    },
    /** Put the scene in a room, or back in the studio; see `room.js`. */
    setSetting(name) {
      setting = SETTINGS.includes(name) ? name : "studio";
      if (lastPayload) setScene(lastPayload);
      else (globalThis.requestIdleCallback ?? setTimeout)(() => prepareRoom(setting));
    },
    frame,
    setView,
    orbit,
    getOrbit,
    setOrbit,
    dolly,
    resize,
    render,
    /** Say the shadows need drawing again, for a caller that has hidden or shown something. */
    invalidateShadows() {
      shadowsStale = true;
      renderer.shadowMap.needsUpdate = true;
    },
    dispose,
    focus,
  };
}

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
  AddEquation,
  BackSide,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  ImageBitmapLoader,
  ImageLoader,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  NeutralToneMapping,
  OneFactor,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RepeatWrapping,
  Scene,
  ShaderChunk,
  Sphere,
  SRGBColorSpace,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  ZeroFactor,
} from "three";
import { buildProps, disposeProps } from "./props.js";
import { buildRoom, disposeRoom, roomLayout, roomReady, roomTextures, paintWall, SETTINGS, updateRoom } from "./room.js";
import { HAZE, SKY_GAIN, SUN } from "./places.js";
import { modelFiles } from "../core/bodyModels.js";
import { IRIS_UV } from "../core/humanMesh.js";
import { LACE_REPEAT, LACE_SIZE, lacePattern } from "../core/lace.js";
import { TRIM } from "../core/garments.js";
import { ROUGHNESS_SPAN } from "./fabric.js";
import { tiles } from "./tiles.js";

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
const textureListeners = new Set();

/**
 * A picture from the assets as a texture, decoded off the main thread where
 * the browser can. An <img> is decoded where WebGL first uploads it, which for
 * a pair's two 2048-square skin atlases held their first picture for most of a
 * second. Decoded as WebGL is told to take it for an sRGB texture - alpha not
 * premultiplied, colour not converted - so the pixels are the same.
 * `userData.loaded` settles with the texture once it has its picture.
 */
let bitmaps = null;
function picture(url) {
  const texture = new Texture();
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  texture.userData.loaded = new Promise((resolve) => {
    const settled = () => textureListeners.forEach(notify => notify());
    const arrived = (image) => {
      texture.image = image;
      texture.needsUpdate = true;
      settled();
      resolve(texture);
    };
    if (typeof createImageBitmap === "function") {
      bitmaps ??= new ImageBitmapLoader().setOptions({ premultiplyAlpha: "none", colorSpaceConversion: "none" });
      bitmaps.load(url, arrived, undefined, settled);
    } else new ImageLoader().load(url, arrived, undefined, settled);
  });
  return texture;
}

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
    const texture = picture(url);
    // The atlas is authored with the glTF convention - v down from the top
    // left - which is what the GLB's own TEXCOORD_0 expects and the opposite of
    // three's default.
    texture.flipY = false;
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
 * Tiles of detail across the atlas. The scans' charts spread roughly a metre
 * and three quarters of body across the unit square, so 48 puts a tile at
 * about 36mm, a pore every millimetre and a crease cell every two and a half -
 * coarser than life, and deliberately, since true scale would never outlast
 * the first mip.
 */
const DETAIL_REPEAT = 48;

const SKIN_TILE = ["skin"];
let detail = null;
/**
 * The skin's fine relief - pores, and the crosshatch of creases they sit in -
 * as a tiling normal map and how rough each point of it is, made in code
 * rather than shipped (see `figureTiles.js`).
 */
function skinDetail() {
  if (detail) return detail;
  const skin = tiles.take(...SKIN_TILE);
  detail = { normal: tile(skin.normal, skin.size, DETAIL_REPEAT), roughness: tile(skin.roughness, skin.size, DETAIL_REPEAT) };
  return detail;
}

/** A square of bytes as a tiling texture, repeated `repeat` times across the UVs. */
function tile(data, n, repeat) {
  const map = new DataTexture(data, n, n);
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.repeat.set(repeat, repeat);
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
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
    // The map holds its factor over 1.4, so that it can go above one.
    roughness: relief ? 0.56 * 1.4 : 0.56,
    roughnessMap: relief?.roughness ?? null,
    metalness: 0,
    ior: 1.4,
    // The relief needs the atlas's UVs to sit on; a figure drawn from the field
    // has none, and is smooth.
    normalMap: relief?.normal ?? null,
    normalScale: new Vector2(0.34, 0.34),
    // A very slight sheen stands in for the fine hair that catches grazing
    // light along a silhouette. Without it edges read as cut out.
    sheen: 0.12,
    sheenRoughness: 0.85,
    sheenColor: new Color(0xffd9c9),
    // Thinner than it was. With a room to reflect, a coat of 0.14 put a
    // picture of the window on every shoulder, sharp enough to read as a
    // varnish; skin's film of oil is a glint here and there, not a layer.
    clearcoat: 0.07,
    clearcoatRoughness: 0.42,
    clearcoatNormalMap: relief?.normal ?? null,
    clearcoatNormalScale: new Vector2(0.55, 0.55),
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
 *
 * Painted, where the eye came with coordinates to paint in (see `splitEyes` in
 * humanMesh.js): a flat colour per zone is a bead, and what makes an eye look
 * back at the viewer is its detail - the fibres of the iris running out from
 * the pupil, the dark ring at its rim, the white going faintly warm towards the
 * corners. With the room to reflect, the coat then puts the window in it.
 */
function eyeMaterial(colour, painted = false) {
  const material = new MeshPhysicalMaterial({
    color: painted ? new Color(0xffffff) : new Color().setRGB(colour[0], colour[1], colour[2], SRGBColorSpace),
    map: painted ? eyeTexture() : null,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
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
  material.customProgramCacheKey = () => (painted ? "poseforge-eye-map" : "poseforge-eye");
  return material;
}

/**
 * The teeth, the gums and the tongue. Wet, so glossier than skin, but in a
 * mouth: their occlusion is all the light that gets past the lips, and they
 * are out of the shadow map like the eyes, so it dims everything they return -
 * the key and the gloss as well as the sky. A tooth at the back of an open
 * mouth that caught the key would be a spark in a hole.
 */
function mouthMaterial(colour) {
  const material = new MeshPhysicalMaterial({
    color: new Color().setRGB(colour[0], colour[1], colour[2], SRGBColorSpace),
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.15,
  });
  material.onBeforeCompile = (shader) => {
    carryOcclusion(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n varying float vOcclusion;")
      .replace("#include <opaque_fragment>", "outgoingLight *= vOcclusion;\n#include <opaque_fragment>");
  };
  material.customProgramCacheKey = () => "poseforge-mouth";
  return material;
}

let eyePaint = null;
const EYE_TILE = ["eye", IRIS_UV];

/** An eye, its limbus `IRIS_UV` out (see `figureTiles.js`). */
function eyeTexture() {
  if (eyePaint) return eyePaint;
  const eye = tiles.take(...EYE_TILE);
  eyePaint = new DataTexture(eye.data, eye.size, eye.size);
  eyePaint.colorSpace = SRGBColorSpace;
  eyePaint.magFilter = LinearFilter;
  eyePaint.minFilter = LinearMipmapLinearFilter;
  eyePaint.generateMipmaps = true;
  eyePaint.anisotropy = 8;
  eyePaint.needsUpdate = true;
  return eyePaint;
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
      )
      // And the highlights with it. Hair is lit through itself - the strands
      // over a lock shade it - which one shadow map of the cards cannot see.
      // The occlusion is the nearest thing to it there is, and the side of a
      // card that is turned to the head is the other: cards face out of the
      // head (see `cardSubmesh`), so a card seen from behind is the inside of
      // the hair, under every layer above it, and should not reflect the
      // window as freely as the outside does.
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
         {
           float under = mix(1.0, vOcclusion * vOcclusion, 0.9) * (gl_FrontFacing ? 1.0 : 0.2);
           reflectedLight.indirectSpecular *= under;
           reflectedLight.directSpecular *= under;
         }`
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
    const texture = picture(String(new URL(`../../assets/models/hair/${name}.png`, import.meta.url)));
    texture.flipY = false;
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
function cardMaterial(colour, cards, strands = cardTexture(cards.texture)) {
  const material = hairMaterial(colour);
  // The strands themselves, from the grey of the picture of them: a card is
  // a flat sheet and its highlight was one smooth band down it - the room's
  // window drawn down a black mirror. Bumped, the band breaks into the
  // lock-by-lock glints hair actually has, and with the coat's reflection of
  // the room at half, what is left of it is a sheen and not a chrome.
  //
  // Isotropic, now that it is bumped. The stretched lobe this ran with was
  // there to draw the band across the strands, which the bump does from the
  // strands themselves; and the lobe's direction comes from the cards' UVs,
  // which where a trim folds under - the inside of a bob's fringe, beside the
  // cheek - are sheared to nothing, and it came out a ribbon of chrome there.
  material.anisotropy = 0;
  material.bumpMap = strands;
  material.bumpScale = 1.2;
  material.roughness = 0.55;
  material.envMapIntensity = 0.4;
  material.specularIntensity = 0.55;
  // And the sheen goes. On the shell it stood in for the fibres the surface
  // did not have; the cards have them, painted, and the sheen's grazing lobe -
  // untouched by the texture's dark, and by the occlusion - frosted every
  // strip seen edge-on, which on short hair is most of the sides of the head.
  material.sheen = 0;
  return cutOut(material, cards, "poseforge-hair-cards", strands);
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
function cutOut(material, cards, key, strands = cardTexture(cards.texture)) {
  material.color.multiplyScalar(cards.gain);
  material.map = strands;
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
  // The cloth's surface needs the body's UVs to lie on, as the lace does; a
  // garment cut from the field has none, and is smooth.
  const weave = part.uvs ? weaveOf(finish) : null;
  const material = new MeshPhysicalMaterial({
    color: weave?.heather ? colour.clone().multiplyScalar(1 / weave.heather.mean) : colour,
    roughness: weave?.roughness ? roughness * ROUGHNESS_SPAN / weave.roughness.factor : roughness,
    metalness: 0,
    sheen,
    sheenRoughness,
    sheenColor: new Color(0x8e8a86),
    clearcoat,
    clearcoatRoughness,
  });
  if (weave) {
    material.normalMap = weave.normal;
    material.normalScale = new Vector2(weave.normalScale, weave.normalScale);
    material.roughnessMap = weave.roughness?.texture ?? null;
    material.map = weave.heather?.texture ?? null;
  }
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
         diffuseColor.rgb = mix(diffuseColor.rgb, trimColour, trimmed);
         float seamShade = 1.0;`
      )
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
         material.diffuseColor.rgb *= mix(1.0, vOcclusion, 0.7) * seamShade;`
      );
    if (weave) fragment = wovenFragment(fragment, shader, weave, finish);
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
  material.customProgramCacheKey = () => `poseforge-garment-${finish}${lace ? "-cut" : ""}${weave ? "-woven" : ""}`;
  return material;
}

/**
 * The cloth's own surface, patched into the fragment shader: the finish's
 * weave, rib where it is trimmed, creases where the body folds it, and the
 * seam where a band is sewn on.
 *
 * - The weave is three's normal map, read as it would be, except that where
 *   the garment is trimmed it gives way to the rib. The trim is a collar, a
 *   hem or a waistband, and those are ribbed or doubled; a band of the same
 *   plain knit as the body of the shirt is how a garment painted on reads.
 * - The creases are a second, far coarser normal added over it, and deeper
 *   where the occlusion says the cloth is gathered - in the elbow, the armpit,
 *   the small of the back - than across the open flat of a chest.
 * - The seam is a height, worked out from the trim's own distance: a groove
 *   along the line the band is sewn on at, the band a little proud of the
 *   cloth beside it, and a row of stitching a few millimetres back from the
 *   seam. It is turned into a normal by the surface gradient, the way three
 *   bumps a surface, and faded out as the pixel grows past it so that far off
 *   it averages away rather than crawling. Steel rings on a leather harness
 *   are trim too, and have no seam and no rib.
 * - The cavity of the weave (the red of its roughness tile) darkens the
 *   diffuse, divided by its own average so the cloth is no darker for it at a
 *   distance - only uneven close to.
 */
function wovenFragment(fragment, shader, weave, finish) {
  const patch = (source, from, to) => {
    if (!source.includes(from)) throw new Error(`three's shader source no longer contains ${from.trim()}`);
    return source.replace(from, to);
  };
  const sewn = finish === "leather" ? 0 : 1;
  shader.uniforms.ribMap = { value: ribTexture() };
  shader.uniforms.foldMap = { value: foldTexture() };
  shader.uniforms.ribScale = { value: RIB_REPEAT / weave.repeat };
  shader.uniforms.foldScale = { value: FOLD_REPEAT / weave.repeat };
  shader.uniforms.foldDepth = { value: weave.folds };
  shader.uniforms.cavityMean = { value: weave.roughness?.cavity ?? 1 };
  const metres = (TRIM * FIGURE_HEIGHT).toFixed(5);
  fragment = patch(
    fragment,
    "#include <common>",
    `#include <common>
     uniform sampler2D ribMap;
     uniform sampler2D foldMap;
     uniform float ribScale;
     uniform float foldScale;
     uniform float foldDepth;
     uniform float cavityMean;`
  );
  fragment = patch(
    fragment,
    "#include <roughnessmap_fragment>",
    `#include <roughnessmap_fragment>
     #ifdef USE_ROUGHNESSMAP
       diffuseColor.rgb *= mix(1.0, texelRoughness.r / cavityMean, 1.0 - trimmed * ${sewn.toFixed(1)} * 0.5);
     #endif`
  );
  fragment = patch(
    fragment,
    "#include <normal_fragment_maps>",
    `{
       vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
       vec3 ribN = texture2D(ribMap, vNormalMapUv * ribScale).xyz * 2.0 - 1.0;
       mapN = mix(mapN, ribN, trimmed * ${sewn.toFixed(1)});
       mapN.xy *= normalScale;
       vec3 foldN = texture2D(foldMap, vNormalMapUv * foldScale).xyz * 2.0 - 1.0;
       mapN.xy += foldN.xy * foldDepth * (0.2 + 1.8 * (1.0 - vOcclusion));
       normal = normalize(tbn * mapN);
     }
     {
       // Metres into the band from the line it is sewn on at.
       float d = (vTrim - 0.5) * ${metres};
       float w = 0.0007;
       float legible = (1.0 - smoothstep(w * 0.7, w * 2.5, fwidth(d))) * ${sewn.toFixed(1)};
       float groove = exp(-pow2(d / w));
       float stitch = exp(-pow2((d + 0.0028) / (w * 0.6)));
       float h = (0.00035 * smoothstep(-w, w, d) - 0.00045 * groove - 0.0002 * stitch) * legible;
       seamShade = 1.0 - (0.3 * groove + 0.15 * stitch) * legible;
       vec3 sx = dFdx(-vViewPosition);
       vec3 sy = dFdy(-vViewPosition);
       vec3 r1 = cross(sy, normal);
       vec3 r2 = cross(normal, sx);
       float det = dot(sx, r1) * faceDirection;
       vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
       normal = normalize(abs(det) * normal - grad);
     }`
  );
  return fragment;
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
 * What each finish is woven of, and how coarse it is laid on the atlas.
 *
 * `repeat` is tiles to the unit of the body's UVs, which run at about a metre
 * and three quarters of skin to the unit: the knit's sixteen wales at 68 are a
 * loop about a millimetre and a half across, coarser than a T-shirt's and
 * deliberately so, for the reason the skin's pores are - true scale would be
 * gone by the first mip. Lycra and a stocking are finer knits than cotton, and
 * shallower. `folds` is how deep the creases go, before the occlusion deepens
 * them; `heather` is how much the colour wanders, and over what.
 */
const WEAVES = {
  cotton: { surface: "knit", repeat: 68, normalScale: 0.6, folds: 0.22, heather: "streaked", heatherRepeat: 7 },
  lycra: { surface: "knit", repeat: 120, normalScale: 0.28, folds: 0.16, heather: "streaked", heatherRepeat: 7 },
  sheer: { surface: "knit", repeat: 170, normalScale: 0.35, folds: 0.08 },
  lace: { surface: "lace", repeat: LACE_REPEAT, normalScale: 0.9, folds: 0.1 },
  leather: { surface: "grain", repeat: 56, normalScale: 0.45, folds: 0.18, heather: "blotched", heatherRepeat: 5 },
};

/** Ribs to the unit - eight to a tile, so a rib about three millimetres across - and creases. */
const RIB_REPEAT = 72;
const FOLD_REPEAT = 5.5;

/**
 * The height a figure's bind space is stored at, in metres, near enough: the
 * trim is a distance in that space and the seam is drawn in metres. A figure a
 * few centimetres off it has a seam a few percent wider, which is not visible.
 */
const FIGURE_HEIGHT = 1.7;

const weaves = new Map();
const fabricTiles = new Map();
/** A tile from `fabric.js` (see `tiles.js`), made once however many finishes use it. */
function fabricTile(name, ...args) {
  const key = `${name}${JSON.stringify(args)}`;
  if (!fabricTiles.has(key)) fabricTiles.set(key, tiles.take(name, ...args));
  return fabricTiles.get(key);
}

/** What a finish's weave is made of: its surface's tile, and its colour's wander if it has one. */
function weaveTiles(finish) {
  const spec = WEAVES[finish];
  return [[spec.surface], ...(spec.heather ? [["heather", { streaked: spec.heather === "streaked" }]] : [])];
}

/** A finish's textures, each wrapped at the finish's own repeat. */
function weaveOf(finish) {
  if (weaves.has(finish)) return weaves.get(finish);
  const spec = WEAVES[finish];
  const [surface, heather] = weaveTiles(finish).map((request) => fabricTile(...request));
  const weave = {
    repeat: spec.repeat,
    normalScale: spec.normalScale,
    folds: spec.folds,
    normal: tile(surface.normal, surface.size, spec.repeat),
    roughness: surface.roughness && {
      ...surface.roughness,
      texture: tile(surface.roughness.data, surface.size, spec.repeat),
    },
    heather: heather ? { mean: heather.mean, texture: tile(heather.map, heather.size, spec.heatherRepeat) } : null,
  };
  weaves.set(finish, weave);
  return weave;
}

/** The rib and the creases, read through the weave's own UVs at their own scale. */
const reliefs = new Map();
function reliefTexture(name) {
  if (!reliefs.has(name)) {
    const { normal, size } = fabricTile(name);
    reliefs.set(name, tile(normal, size, 1));
  }
  return reliefs.get(name);
}
const ribTexture = () => reliefTexture("rib");
const foldTexture = () => reliefTexture("fold");

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

/**
 * The box round a mesher result's points, read once for each. The room is
 * laid out round the scene's box, the geometry is culled by its sphere and the
 * camera framed on its box, and each of them read every point of every figure
 * for itself - four passes over a quarter of a million points where one does.
 */
const boxes = new WeakMap();
function boxOf(positions) {
  let box = boxes.get(positions);
  if (box) return box;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  box = new Box3(new Vector3(x0, y0, z0), new Vector3(x1, y1, z1));
  boxes.set(positions, box);
  return box;
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
  // The sphere `computeBoundingSphere` would make - centred on the box, out
  // to the farthest point - from the box already read.
  const p = mesh.positions;
  geometry.boundingBox = boxOf(p).clone();
  const center = geometry.boundingBox.getCenter(new Vector3());
  let far = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = center.x - p[i], dy = center.y - p[i + 1], dz = center.z - p[i + 2];
    far = Math.max(far, dx * dx + dy * dy + dz * dz);
  }
  geometry.boundingSphere = new Sphere(center, Math.sqrt(far));
  return geometry;
}

/**
 * Three lights, a key, a fill and a rim, and the sky's.
 *
 * The key casts; the fill and rim do not. One shadow-casting light is what
 * keeps the contact shadow between two bodies readable - a second caster puts a
 * competing shadow across the same crease and the eye stops being able to tell
 * which surface is in front. All three look at the same point, the middle of
 * the figures (see `aim`), and a setting that has no use for one turns it down
 * to nothing rather than taking it away: how many lights there are is in every
 * shader, and changing it compiles them all again.
 */
function buildLights(scene) {
  const key = new DirectionalLight(0xfff5e9, 2.1);
  key.position.set(2.4, 3.2, 2.0);
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
  cam.far = 16;
  cam.updateProjectionMatrix();
  scene.add(key);
  scene.add(key.target);

  const fill = new DirectionalLight(0xe5eeff, 1.25);
  fill.position.set(-3, 1.6, 1.4);
  fill.target = key.target;
  scene.add(fill);

  const rim = new DirectionalLight(0xffffff, 1.1);
  rim.position.set(-1.2, 2.2, -3.2);
  rim.target = key.target;
  scene.add(rim);

  // What is left of the old flat ambient. The environment below does that job
  // now, and does it with direction: a hemisphere light is the same grey from
  // every side of the sky, where a room is bright at its window and dark in
  // its corners.
  const sky = new HemisphereLight(0xf0f4ff, 0x9b9583, 0.3);
  scene.add(sky);

  return { key, fill, rim, sky };
}

/**
 * How each setting is lit, and by what.
 *
 * Each light is something that is there: in the picture, or just out of it
 * where a photographer would have put it. Its colour and strength are that
 * thing's, and it comes either `from` a direction off the figures - a softbox
 * on a stand, the sun - or from a `source` the setting has put somewhere (see
 * `sources` in `room.js` and `places.js`), a window or a lamp, so that the
 * light on the figures comes from where the picture shows its window or lamp
 * to be. A light from a source is never lower than `lift` degrees above the
 * figures: the sky through a window comes down into a room, and a key from
 * the level of the figures' own middle would light them from below their eyes.
 * A setting without the source leaves its light out.
 *
 * Then the sky's and the ground's colours and how much of them; which
 * environment (see `ENVIRONMENTS`) the scene gives back and how much of it; the
 * exposure; the background; and the haze, out of doors.
 *
 * - The studio is three softboxes: the key high to the camera's right, a fill
 *   to its left, and a rim behind to the left, all over a pale cyc.
 * - A room by day is its windows. The key is the one in the east wall, to the
 *   camera's right and out of its picture; the one in the picture, behind the
 *   figures, edges them; what fills is the room itself, the walls and floor
 *   the windows light, and the lamps are off.
 * - The hotel at night is its lamps: one on the east wall where the day's
 *   window was, the bedside lamp low on the figures' other side, and the lamp
 *   in the far corner behind them. The city through the window is too faint
 *   to light anything, and is only there in what the skin gives back.
 * - The beach and the pool are the sun - south-east, well up - and what the sun
 *   lights: the sand round the figures, or the white of the villa's wall
 *   behind the camera, and the blue of the sky in the shadows. The sun has no
 *   second sun behind it, so there is no rim.
 * - The fashion set is a big octabox high to the camera's right, a strip light
 *   behind the figures on the other side, and the white V-flat that bounces
 *   the octabox back into their shadow side, all in the dark.
 */
const DAYLIGHT = {
  sky: [0xf0f4ff, 0x9b9583, 0.3],
  environment: "room",
  intensity: 0.7,
  exposure: 0.85,
  background: 0xf1f3ef,
};
const OUTDOORS = {
  key: { colour: 0xffefd9, intensity: 2.9, from: SUN },
  rim: { intensity: 0 },
  sky: [0xbcd6f5, 0xd9c6a3, 0.5],
  environment: "beach",
  intensity: 0.8,
  exposure: 0.8,
  background: HAZE,
  fog: [16, 52],
};
const LIGHTING = {
  studio: {
    ...DAYLIGHT,
    key: { colour: 0xfff5e9, intensity: 2.1, from: [2.4, 3.2, 2.0] },
    fill: { colour: 0xe5eeff, intensity: 1.25, from: [-3, 1.6, 1.4] },
    rim: { colour: 0xffffff, intensity: 1.1, from: [-1.2, 2.2, -3.2] },
    environment: "studio",
  },
  room: {
    ...DAYLIGHT,
    key: { colour: 0xfff6ea, intensity: 2.3, source: "key", lift: 30 },
    fill: { colour: 0xf6efe6, intensity: 0.75, from: [-1.6, 1.2, 2.6] },
    rim: { colour: 0xdfe8ff, intensity: 1.1, source: "back", lift: 20 },
  },
  hotel: {
    key: { colour: 0xffc690, intensity: 1.9, source: "key", lift: 18 },
    fill: { colour: 0xffb978, intensity: 0.55, source: "bedside" },
    rim: { colour: 0xffc287, intensity: 0.8, source: "corner", lift: 18 },
    sky: [0x36405a, 0x2a2018, 0.15],
    environment: "night",
    intensity: 0.9,
    exposure: 0.95,
    background: 0x1c1e23,
  },
  beach: {
    ...OUTDOORS,
    // The sunlit sand in front of the figures, low and warm.
    fill: { colour: 0xf3dfc0, intensity: 0.5, from: [-0.8, 0.35, 2.4] },
  },
  pool: {
    ...OUTDOORS,
    fill: { colour: 0xfff0de, intensity: 0.55, source: "villa" },
    environment: "pool",
  },
  fashion: {
    key: { colour: 0xffffff, intensity: 2.6, source: "octabox" },
    fill: { colour: 0xf6f6f8, intensity: 0.5, source: "flat" },
    rim: { colour: 0xffffff, intensity: 1.9, source: "strip" },
    sky: [0xffffff, 0x3a3a3a, 0.12],
    environment: "fashion",
    intensity: 0.75,
    exposure: 0.9,
    background: 0x19191b,
  },
};

/** The lighting for a setting; any room without its own has the day rooms'. */
const lightingFor = (setting) => LIGHTING[setting] ?? LIGHTING.room;

/**
 * The light the room itself gives back, as an environment map.
 *
 * Three punctual lights put one highlight each on a surface and leave the rest
 * of it to a flat ambient, and that is most of why skin under them looks
 * lacquered and cloth looks painted: a real highlight is a picture of whatever
 * is bright round the subject - a window, a lampshade, a pale ceiling - broken
 * up by the surface it is seen in. So the scene is given something to reflect.
 * It is a room of its own, drawn once into a small cube and blurred by three's
 * PMREM for each roughness: a box with the setting's walls, floor and ceiling,
 * and in it, in the direction they are from the figures, the same things that
 * are the lights in `LIGHTING` - the windows, the lamps, the softboxes, the sun
 * - and the pale spill behind the camera that any room returns. So the
 * reflections and the shading agree about where the light comes from.
 *
 * A room's windows and lamps are where they are only for the room as it is
 * usually laid out; against a wall to lean on, the window in the picture is
 * on the west wall, and the room has its `wall` panels instead.
 *
 * Built here rather than taken from three's examples - a few boxes are all it
 * is, and the room is the one this file knows about. Colours are linear and
 * go well past one: these are the things that shine.
 */
const SUN_PANEL = new Vector3(...SUN).setLength(5.5).add(new Vector3(0, 1, 0)).toArray();
const ENVIRONMENTS = {
  room: {
    walls: [0.36, 0.33, 0.3],
    floor: [0.17, 0.11, 0.07],
    ceiling: [0.55, 0.54, 0.52],
    panels: [
      // The window behind the figures: cool daylight, a little left of middle.
      { at: [-1.2, 2.4, -5.9], size: [3, 2.4], colour: [6.8, 7.4, 8.6] },
      // The light it throws on the floor in front of it.
      { at: [-1, 0.02, -4.2], size: [2.6, 2.4], colour: [0.9, 0.9, 0.92], floor: true },
      // The key's window, on the east wall, and its light on the floor.
      { at: [5.9, 2.5, 0.9], size: [3, 2.4], colour: [8.6, 8.5, 8.2] },
      { at: [4.2, 0.02, 0.8], size: [2.4, 2.6], colour: [1, 0.98, 0.95], floor: true },
      // The room behind the camera, lit by all of that.
      { at: [1.5, 1.8, 5.9], size: [6, 2.6], colour: [1.1, 1.05, 1] },
    ],
    wall: [
      { at: [-5.9, 2.4, 2.4], size: [3, 2.4], colour: [6.8, 7.4, 8.6] },
      { at: [-4.2, 0.02, 2.2], size: [2.4, 2.6], colour: [0.9, 0.9, 0.92], floor: true },
      { at: [5.9, 2.4, 2.9], size: [3, 2.4], colour: [8.6, 8.5, 8.2] },
      { at: [4.2, 0.02, 2.6], size: [2.4, 2.6], colour: [1, 0.98, 0.95], floor: true },
      { at: [1.5, 1.8, 5.9], size: [6, 2.6], colour: [1.1, 1.05, 1] },
    ],
  },
  studio: {
    walls: [0.42, 0.43, 0.42],
    floor: [0.3, 0.31, 0.3],
    ceiling: [0.5, 0.5, 0.5],
    panels: [
      // Over the key, over the fill, behind for the rim, and one overhead.
      { at: [4.2, 4.5, 3.6], size: [2.4, 2.4], colour: [7, 6.8, 6.4], face: true },
      { at: [-5.9, 2.2, 2], size: [2.2, 2.6], colour: [3.2, 3.4, 3.8] },
      { at: [-1.5, 2.8, -5.9], size: [2.4, 2], colour: [3.6, 3.6, 3.6] },
      { at: [0, 5.9, 0], size: [3, 3], colour: [2.2, 2.2, 2.2], ceiling: true },
    ],
  },
  // Out of doors: haze all round, the sky overhead, the sun where the key
  // is, sand underfoot and the sea to the north.
  beach: {
    walls: [1.15, 1.25, 1.35],
    floor: [0.62, 0.52, 0.38],
    ceiling: [0.42, 0.62, 1.05],
    panels: [
      { at: SUN_PANEL, size: [1.6, 1.6], colour: [40, 36, 30], face: true },
      { at: [0, 0.02, -3], size: [12, 6], colour: [0.1, 0.24, 0.32], floor: true },
    ],
  },
  // The same sky over pale stone, the pool and the sea beyond it, and the
  // villa's sunlit wall behind the camera.
  pool: {
    walls: [1.15, 1.25, 1.35],
    floor: [0.72, 0.66, 0.57],
    ceiling: [0.42, 0.62, 1.05],
    panels: [
      { at: SUN_PANEL, size: [1.6, 1.6], colour: [40, 36, 30], face: true },
      { at: [0, 0.02, -3.5], size: [12, 5], colour: [0.12, 0.32, 0.4], floor: true },
      { at: [0, 2.2, 5.9], size: [10, 3.4], colour: [1.3, 1.25, 1.18] },
    ],
  },
  // A dark studio: the key's octabox, the strip behind to one side, the
  // white of the V-flat and the grey of the paper.
  fashion: {
    walls: [0.025, 0.025, 0.025],
    floor: [0.05, 0.05, 0.05],
    ceiling: [0.02, 0.02, 0.02],
    panels: [
      { at: [5.6, 3.6, 1.6], size: [2.6, 2.6], colour: [9, 9, 9], face: true },
      { at: [-5.9, 2.6, -2.4], size: [0.8, 3], colour: [6.5, 6.5, 6.8] },
      { at: [-5.9, 2, 0.5], size: [2.4, 2.6], colour: [0.6, 0.6, 0.6] },
      { at: [0, 1.6, -5.9], size: [6, 3.2], colour: [0.22, 0.21, 0.2] },
    ],
  },
  // The room after dark: the city faint through the window, the lamps and
  // the warm light each throws on the wall behind it, and the walls only what
  // the lamps put on them.
  night: {
    walls: [0.06, 0.045, 0.035],
    floor: [0.03, 0.02, 0.014],
    ceiling: [0.045, 0.038, 0.03],
    panels: [
      { at: [-1.2, 2.4, -5.9], size: [3, 2.4], colour: [0.3, 0.36, 0.55] },
      // The key's lamp on the east wall.
      { at: [5.9, 2.7, 0], size: [2.6, 2.4], colour: [0.45, 0.32, 0.18] },
      { at: [5.8, 2.9, 0], size: [0.8, 0.7], colour: [5.2, 3.5, 1.7] },
      // The lamp in the far corner, and the bedside lamp.
      { at: [5.2, 2.9, -5.9], size: [0.7, 0.6], colour: [4.2, 2.8, 1.3] },
      { at: [-5.9, 1.7, -2.2], size: [0.5, 0.45], colour: [3.6, 2.4, 1.1] },
      { at: [1.5, 1.8, 5.9], size: [6, 2.6], colour: [0.22, 0.17, 0.12] },
    ],
    wall: [
      { at: [-5.9, 2.4, 2.4], size: [3, 2.4], colour: [0.3, 0.36, 0.55] },
      { at: [5.9, 2.7, 1.9], size: [2.6, 2.4], colour: [0.45, 0.32, 0.18] },
      { at: [5.8, 2.9, 1.9], size: [0.8, 0.7], colour: [5.2, 3.5, 1.7] },
      { at: [5.9, 2.9, -1.4], size: [0.7, 0.6], colour: [4.2, 2.8, 1.3] },
      { at: [-5.9, 1.8, -1.7], size: [0.5, 0.45], colour: [3.6, 2.4, 1.1] },
      { at: [1.5, 1.8, 5.9], size: [6, 2.6], colour: [0.22, 0.17, 0.12] },
    ],
  },
};

/** The environment's own little room, lit by `panels`. */
function environmentScene(look, panels) {
  const scene = new Scene();
  const flat = (rgb) => new MeshBasicMaterial({ color: new Color().setRGB(...rgb), side: BackSide });
  // Box faces in three's order: +x, -x, +y, -y, +z, -z.
  const shell = new Mesh(new BoxGeometry(12, 6, 12), [
    flat(look.walls), flat(look.walls), flat(look.ceiling), flat(look.floor), flat(look.walls), flat(look.walls),
  ]);
  shell.position.y = 3;
  scene.add(shell);
  for (const panel of panels) {
    const plane = new Mesh(
      new PlaneGeometry(...panel.size),
      new MeshBasicMaterial({ color: new Color().setRGB(...panel.colour), side: DoubleSide })
    );
    plane.position.set(...panel.at);
    if (panel.floor) plane.rotation.x = -Math.PI / 2;
    else if (panel.ceiling) plane.rotation.x = Math.PI / 2;
    else if (panel.face) plane.lookAt(0, 1, 0);
    // Flat on whichever wall it is nearer.
    else if (Math.abs(panel.at[0]) > Math.abs(panel.at[2])) plane.rotation.y = Math.PI / 2;
    scene.add(plane);
  }
  return scene;
}

const environments = new Map();

/**
 * One of `ENVIRONMENTS`, made once per renderer and kept: a room's own when a
 * wall to lean on has moved its window, when it has one for that.
 */
function environmentFor(renderer, name, wall) {
  const look = ENVIRONMENTS[name];
  const turned = wall && !!look.wall;
  const key = `${name}${turned ? "-wall" : ""}`;
  if (!environments.has(renderer)) environments.set(renderer, new Map());
  const made = environments.get(renderer);
  if (!made.has(key)) {
    const pmrem = new PMREMGenerator(renderer);
    const scene = environmentScene(look, turned ? look.wall : look.panels);
    made.set(key, pmrem.fromScene(scene, 0.03, 0.1, 30, { position: new Vector3(0, 1, 0) }).texture);
    pmrem.dispose();
    scene.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry.dispose();
      for (const material of [node.material].flat()) material.dispose();
    });
  }
  return made.get(key);
}

/** The lens's angle across the picture's shorter side, in degrees: see `resize`. */
const LENS = 28;

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
  // Khronos' neutral curve rather than ACES. ACES bends hue on its way to
  // white - a lit cheek goes orange, a lit shoulder goes salmon - and that
  // shift is one of the first things that marks a render as a render. This
  // one keeps the hue and rolls only the brightness off, which is what a
  // photograph of skin does.
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  canvas.addEventListener("webglcontextrestored", () => (shadowsStale = true));

  const scene = new Scene();
  scene.background = alpha ? null : new Color(DAYLIGHT.background);
  scene.environmentIntensity = DAYLIGHT.intensity;
  const lights = buildLights(scene);

  const camera = new PerspectiveCamera(LENS, 1, 0.05, 60);
  camera.position.set(2.6, 1.7, 3.2);

  const bodies = new Group();
  bodies.name = "bodies";
  scene.add(bodies);
  let propGroup = null;
  let propKey = null;
  let displayMode = 'natural';
  let lastPayload = null;
  let setting = "studio";
  let room = null;
  let roomKey = null;

  const focus = new Vector3(0, 0.9, 0);
  let lit = "studio";

  /**
   * Light the scene as `name` is lit (see `LIGHTING`): "studio" for the plain
   * backdrop and for a car, whatever the setting. `wall` says a wall to lean
   * on has taken the room's north wall, and its window with it.
   */
  function light(name, wall = false) {
    lit = name;
    const look = lightingFor(name);
    for (const part of ["key", "fill", "rim"]) {
      lights[part].color.set(look[part].colour ?? 0xffffff);
      lights[part].intensity = look[part].intensity;
    }
    const { sky } = lights;
    sky.color.set(look.sky[0]);
    sky.groundColor.set(look.sky[1]);
    sky.intensity = look.sky[2];
    scene.environment = environmentFor(renderer, look.environment, wall);
    scene.environmentIntensity = look.intensity;
    renderer.toneMappingExposure = look.exposure;
    if (!alpha) scene.background = new Color(look.background);
    // The haze is the sky's own colour at the horizon (see `places.js`), and
    // only out of doors: a fog's on or off is in every shader, so it is kept
    // the one Fog while it is wanted.
    if (!look.fog) scene.fog = null;
    else {
      scene.fog ??= new Fog(new Color(HAZE).multiplyScalar(SKY_GAIN));
      [scene.fog.near, scene.fog.far] = look.fog;
    }
  }

  /**
   * Turn each light on the middle of the figures from where what makes it is
   * (see `LIGHTING`), six metres out: past the walls, so that everything the
   * key's shadow should fall from is between it and the figures. A light whose
   * source the setting does not have is turned down to nothing.
   */
  function aim() {
    const look = lightingFor(lit);
    const middle = bodyBox().getCenter(new Vector3());
    lights.key.target.position.copy(middle);
    lights.key.target.updateMatrixWorld();
    for (const part of ["key", "fill", "rim"]) {
      const { from, source, lift = 0, intensity } = look[part];
      const node = lights[part];
      const at = source && room?.userData.sources?.[source];
      if (!from && !at) {
        node.intensity = 0;
        continue;
      }
      node.intensity = intensity;
      const direction = from ? new Vector3(...from) : new Vector3(...at).sub(middle);
      const level = Math.hypot(direction.x, direction.z);
      direction.y = Math.max(direction.y, level * Math.tan((lift * Math.PI) / 180));
      node.position.copy(middle).addScaledVector(direction.normalize(), 6);
    }
    shadowsStale = true;
  }

  /** The figures' bounds, kept until the next scene; around head height in the middle when there are none. */
  let bodyBounds = null;
  function bodyBox() {
    if (bodyBounds) return bodyBounds;
    const box = new Box3();
    bodies.traverse((node) => {
      if (!node.isMesh) return;
      // Made with the geometry, which does not move after.
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      box.union(node.geometry.boundingBox);
    });
    if (box.isEmpty()) return new Box3(new Vector3(-0.3, 0, -0.3), new Vector3(0.3, 1.8, 0.3));
    return (bodyBounds = box);
  }

  /** A sample of the figures' vertices, at most so many from each part, kept until the next scene. */
  let bodyPoints = null;
  function bodySample() {
    if (bodyPoints) return bodyPoints;
    const found = [];
    bodies.traverse((node) => {
      if (!node.isMesh) return;
      const position = node.geometry.attributes.position;
      const stride = Math.max(1, Math.ceil(position.count / 1500));
      for (let i = 0; i < position.count; i += stride) found.push(position.getX(i), position.getY(i), position.getZ(i));
    });
    return (bodyPoints = found);
  }

  // The materials the last scene was drawn with, let go of only once the next
  // frame has drawn the new one. Disposing a material releases its shader, and
  // three deletes a shader the moment no material holds it - so disposing the
  // old scene before building the new one compiled every shader in the picture
  // again on every scene, including the final pass that replaces the draft's
  // identical figures seconds later: 3.2 seconds of main thread under
  // SwiftShader. Held for one more frame, the new materials find their shaders
  // still there and share them.
  const retired = new Set();
  const retire = (material) => retired.add(material);
  function releaseRetired() {
    for (const material of retired) material.dispose();
    retired.clear();
  }

  /**
   * What the first picture will be drawn with, made before it is wanted.
   *
   * The first picture used to wait on all of it. Its shaders - a score of them,
   * most of them physical materials patched here - are compiled the first time
   * they draw, which under SwiftShader held the page for 2.4 seconds after the
   * figures arrived, and the room's, eyes' and cloth's textures took 1.4 more.
   * The solve before it takes seconds and leaves the page idle, so all of it is
   * done then, a step to an idle callback: the environment, a room at the size
   * of an ordinary scene's, a bed, and one of each of a figure's materials on a
   * triangle - over empty textures where the real ones are pictures, since what
   * a shader is compiled for is whether a material has a map, not what is in it.
   * Compiled against the scene, they are the programs the first scene's own
   * materials will ask for, and they hold them until it has drawn (see
   * `retired`). A scene that arrives first simply compiles what is left.
   */
  let rehearsal = null;
  const idle = globalThis.requestIdleCallback ?? ((step) => setTimeout(step, 0));
  function rehearse() {
    releaseRehearsal((material) => material.dispose());
    const group = (rehearsal = new Group());
    const layout = roomLayout(setting, { min: [-1, 0, -1], max: [1, 1.8, 1] });
    const steps = [
      () => light(layout ? setting : "studio"),
      ...(layout ? roomTextures(setting) : []),
      () => layout && group.add(buildRoom(layout)),
      () => group.add(buildProps([{ kind: "bed", size: [1.6, 0.5, 2], center: [0, 0.25, 0] }], { ground: !layout })),
    ];
    if (displayMode === "natural") {
      const geometry = toGeometry({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
        uvs: new Float32Array(6),
        garment: true,
      });
      const blank = new Texture();
      const add = (material) => () => group.add(new Mesh(geometry, material()));
      // Each once the tiles it is made of have come, asked for now, after the room's.
      const after = (requests, step) =>
        Object.assign(step, { ready: Promise.all(requests.map((request) => tiles.prepare(...request))) });
      steps.push(
        after([SKIN_TILE], add(() => skinMaterial(tinted(SKIN[0]), blank))),
        after([EYE_TILE], add(() => eyeMaterial(null, true))),
        add(() => mouthMaterial([1, 1, 1])),
        add(() => cardMaterial([0, 0, 0], { gain: 1 }, blank)),
        after(weaveTiles("cotton"), add(() => garmentMaterial({ finish: "cotton", colour: [0, 0, 0], uvs: true }))),
        // The creases and the rib every garment's shader is given as it compiles.
        after([["rib"]], ribTexture),
        after([["fold"]], foldTexture)
      );
    }
    steps.push(() => renderer.compile(group, camera, scene));
    // A step made of tiles waits for them to be `ready`.
    const next = () => {
      if (rehearsal !== group) return;
      steps.shift()();
      if (steps.length) Promise.resolve(steps[0].ready).then(() => idle(next));
    };
    idle(next);
  }
  function releaseRehearsal(release) {
    if (!rehearsal) return;
    for (const node of rehearsal.children) {
      if (node.name === "room") disposeRoom(node, release);
      else if (node.name === "props") disposeProps(node, release);
      else release(node.material);
    }
    // The figure's materials all sit on the one triangle.
    rehearsal.children.find((node) => node.isMesh)?.geometry.dispose();
    rehearsal = null;
  }

  /** Clear the figures without touching the lights or the camera. */
  function clearBodies() {
    bodyBounds = bodyPoints = null;
    for (const child of [...bodies.children]) {
      child.geometry.dispose();
      retire(child.material);
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
        const box = boxOf(part.positions);
        if (box.isEmpty()) continue;
        add(box.min.x, box.min.y, box.min.z);
        add(box.max.x, box.max.y, box.max.z);
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
    light(layout ? setting : "studio", !!layout?.wall);
    const key = layout ? JSON.stringify(layout) : null;
    if (key === roomKey) return;
    if (room) {
      scene.remove(room);
      disposeRoom(room, retire);
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
    releaseRehearsal(retire);
    clearBodies();
    // A car is a room of its own: its cabin in a bedroom would be neither.
    const layout = shell?.length ? null : roomLayout(setting, sceneBounds(meshes, props), props);
    placeRoom(layout);
    // The props there are, when they are the same ones: a draft and the final
    // pass over it have the same, and so has an edit that moves the figures
    // and not the bed. Building them again was a fifth of what putting a scene
    // in took, before they were handed to the GPU again.
    const key = JSON.stringify([props ?? [], shell ?? [], room ? setting : null]);
    if (key !== propKey) {
      if (propGroup) {
        disposeProps(propGroup, retire);
        scene.remove(propGroup);
      }
      // The room's floor takes the shadows the studio's ground would.
      propGroup = buildProps(props, { shell, ground: !room });
      propKey = key;
      if (room) {
        // A wall to lean on is the room's own wall, so it is painted to match.
        propGroup.traverse((node) => {
          if (node.isMesh && node.name === "wall") paintWall(node, setting);
        });
      }
      scene.add(propGroup);
    }

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
              : part.mouth
                ? mouthMaterial(part.colour)
                : eyeMaterial(part.colour, !!part.eye && !!part.uvs);
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
    bodyBounds = bodyPoints = null;
    aim();
  }

  /**
   * Named viewpoints, as directions from the figures; the three-quarter view's
   * is `threeQuarter`.
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
  };

  /**
   * The three-quarter view: nearly level with a pair standing, which is where a
   * photographer stands to them, and higher over a pair lying down, which from
   * level is a row of profiles, until it looks down on them at thirty degrees.
   */
  function threeQuarter() {
    const size = bodyBox().getSize(new Vector3());
    const t = Math.min(1, Math.max(0, (size.y / Math.max(size.x, size.z, 0.1) - 0.35) / 0.95));
    const standing = t * t * (3 - 2 * t);
    return { theta: Math.atan2(0.75, 1), elevation: ((12 + 18 * (1 - standing)) * Math.PI) / 180 };
  }

  /** How much of the picture's half-width, and of the clear band's half-height, the figures fill. */
  const FILL = 0.86;
  let fitted = 4;

  /**
   * Where the camera goes to frame the figures from `name`'s direction - one of
   * `VIEWS`, or the three-quarter view, or for nothing the direction it looks
   * from now.
   *
   * Fitted to the figures themselves rather than to their box, whose corners
   * stand out past any body seen from an angle and leave it small in the middle
   * of the picture: the camera comes in until the outermost of a sample of
   * their vertices is at the edge of the picture, less a margin. Then what it
   * looks at moves across the picture until the figures are in the middle of
   * it - not the box's middle, which in perspective is not theirs - and in the
   * middle of what the page leaves clear: `insets` are the CSS pixels the page
   * covers at the picture's top and bottom, the title over it and the toolbar
   * under it. This rather than a view offset, so that the picture exported is
   * the picture on the screen.
   *
   * @param {string|null} name
   * @param {{top?: number, bottom?: number}} [insets]
   * @returns {{theta: number, elevation: number, radius: number, focus: number[]}}
   */
  function framing(name, { top = 0, bottom = 0 } = {}) {
    let direction = name ? threeQuarter() : getOrbit();
    if (VIEWS[name]) {
      const [x, y, z] = VIEWS[name];
      direction = { theta: Math.atan2(x, z), elevation: Math.atan2(y, Math.hypot(x, z)) };
    }
    const { theta, elevation } = direction;
    const back = new Vector3(Math.cos(elevation) * Math.sin(theta), Math.sin(elevation), Math.cos(elevation) * Math.cos(theta));
    // The camera's own axes, as `lookAt` makes them.
    const right = new Vector3(back.z, 0, -back.x).normalize();
    const up = new Vector3().crossVectors(back, right);
    // The clear band, in normalised device coordinates: its middle, and how
    // far the figures may reach from it up and down. A page that covers more
    // than three tenths of the picture at either edge is let cover the figures.
    const tall = canvas.clientHeight || canvas.height || 1;
    const [over, under] = [top, bottom].map((inset) => Math.min(Math.max(inset, 0), 0.3 * tall) / tall);
    const middle = under - over;
    const reachY = (1 - over - under) * FILL;
    const t = Math.tan((camera.fov * Math.PI) / 360);
    const tx = t * camera.aspect;
    const points = bodySample();
    const at = bodyBox().getCenter(new Vector3());
    const q = new Vector3();
    const fit = () => {
      let distance = 0.5;
      for (let i = 0; i < points.length; i += 3) {
        q.set(points[i] - at.x, points[i + 1] - at.y, points[i + 2] - at.z);
        const along = q.dot(back);
        const y = q.dot(up);
        const across = along + Math.abs(q.dot(right)) / (tx * FILL);
        const upright = along + y / ((y > 0 ? middle + reachY : middle - reachY) * t);
        distance = Math.max(distance, across, upright);
      }
      return distance;
    };
    let distance = fit();
    for (let pass = 0; pass < 3; pass += 1) {
      // Where the figures come in the picture from there, edge to edge.
      let [left, rightmost, low, high] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i = 0; i < points.length; i += 3) {
        q.set(points[i] - at.x, points[i + 1] - at.y, points[i + 2] - at.z);
        const depth = distance - q.dot(back);
        const x = q.dot(right) / (depth * tx);
        const y = q.dot(up) / (depth * t);
        [left, rightmost] = [Math.min(left, x), Math.max(rightmost, x)];
        [low, high] = [Math.min(low, y), Math.max(high, y)];
      }
      at.addScaledVector(right, ((left + rightmost) / 2) * distance * tx);
      at.addScaledVector(up, ((low + high) / 2 - middle) * distance * t);
      distance = fit();
    }
    fitted = distance;
    return { theta, elevation, radius: distance, focus: at.toArray() };
  }

  /**
   * A camera position made sensible: above the floor, short of straight
   * overhead, where the orbit would turn over, and between half a metre off
   * and far enough to see the figures small.
   */
  function limit({ theta, elevation, radius, focus: at = focus.toArray() }) {
    const distance = Math.min(Math.max(radius, 0.5), Math.max(14, 2 * fitted));
    const floor = Math.asin(Math.min(1, Math.max(-1, (0.12 - at[1]) / distance)));
    return { theta, elevation: Math.min(Math.max(elevation, floor), (89.9 * Math.PI) / 180), radius: distance, focus: at };
  }

  /** Where the camera is about what it looks at: its turn, its height above the horizon, its distance, and that point. */
  function getOrbit() {
    const offset = camera.position.clone().sub(focus);
    const radius = offset.length();
    return {
      theta: Math.atan2(offset.x, offset.z),
      elevation: Math.asin(Math.min(1, Math.max(-1, offset.y / radius))),
      radius,
      focus: focus.toArray(),
    };
  }

  /** Put the camera at a turn, elevation and distance about a point, within `limit`. */
  function setOrbit(orbit) {
    const { theta, elevation, radius, focus: at } = limit(orbit);
    focus.set(...at);
    const flat = radius * Math.cos(elevation);
    camera.position.set(
      focus.x + flat * Math.sin(theta),
      focus.y + radius * Math.sin(elevation),
      focus.z + flat * Math.cos(theta)
    );
    camera.lookAt(focus);
  }

  /** Frame the figures from `name`'s direction at once (see `framing`). */
  function frame(name = null, insets) {
    setOrbit(framing(name, insets));
  }

  /**
   * The lens: 28 degrees across the picture's shorter side, a short
   * telephoto's - what a photographer takes a portrait or a pair with. A wider
   * one has to come in closer to fill the picture, and close to, the near
   * shoulder grows and the far one shrinks.
   */
  function resize(width, height, pixelRatio = window.devicePixelRatio || 1) {
    renderer.setPixelRatio(Math.min(pixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const half = Math.tan((LENS * Math.PI) / 360);
    camera.fov = (Math.atan(camera.aspect >= 1 ? half : half / camera.aspect) * 360) / Math.PI;
    camera.updateProjectionMatrix();
  }

  /**
   * Draw a frame. The key light's shadow map is two thousand pixels square and
   * holds every triangle of both figures, and it is the same map from any
   * camera: only what casts and the key light decide it. So an orbit or a tour
   * redraws the figures and not their shadows, and the map is drawn again only
   * after a new scene, a texture, or a wall - with what stands against it -
   * coming or going.
   */
  function render() {
    if (updateRoom(room, camera)) shadowsStale = true;
    if (shadowsStale) renderer.shadowMap.needsUpdate = true;
    shadowsStale = false;
    renderer.render(scene, camera);
    releaseRetired();
  }

  let disposed = false;
  function dispose() {
    disposed = true;
    textureListeners.delete(changed);
    clearBodies();
    releaseRehearsal(retire);
    releaseRetired();
    if (propGroup) disposeProps(propGroup);
    disposeRoom(room);
    for (const map of environments.get(renderer)?.values() ?? []) map.dispose();
    environments.delete(renderer);
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
    /**
     * Put the scene in a room, or back in the studio; see `room.js`. The room
     * it was in stays on screen while the new one's floor, rug and picture are
     * made on the worker, and the new one is built once they are in: made
     * here, they held the page for the best part of a second.
     */
    setSetting(name) {
      setting = SETTINGS.includes(name) ? name : "studio";
      if (!lastPayload) return rehearse();
      const [chosen, payload] = [setting, lastPayload];
      roomReady(chosen).then(() => {
        // A scene set meanwhile was drawn in it already, and a room chosen since wins.
        if (setting !== chosen || lastPayload !== payload) return;
        setScene(payload);
        changed();
      });
    },
    frame,
    framing,
    limit,
    /**
     * Start fetching the skin of a scene that is still being solved, and hand
     * each atlas to the GPU as it arrives. Each is a few megabytes; asked for
     * when the figures arrived, the first picture of them was drawn without
     * it, and uploaded by the first frame to draw with it, the pair of them
     * held that frame for a fifth of a second.
     */
    expect(actors = []) {
      if (displayMode !== "natural") return;
      for (const actor of actors) {
        skinAtlas(actor.bodyType, actor.model).userData.loaded.then((atlas) =>
          idle(() => disposed || renderer.initTexture(atlas))
        );
      }
    },
    /** Frame the figures from a named view; the three-quarter view for none. */
    setView: (name) => frame(name ?? "three_quarter"),
    getOrbit,
    setOrbit,
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

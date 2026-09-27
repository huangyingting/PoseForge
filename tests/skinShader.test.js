import assert from "node:assert/strict";
import test from "node:test";
import { ShaderChunk } from "three";
import { skinShaderChunks } from "../src/render/renderer.js";

test("the skin's lighting patch still finds the lines of three's shader it replaces", () => {
  // A substitution that finds nothing leaves the source as it was, and the skin
  // goes back to hard-terminated plastic with nothing to say so.
  const { pars, lights } = skinShaderChunks();
  assert.ok(!pars.includes("reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );"));
  assert.match(pars, /uniform vec3 skinWrap;/);
  assert.match(pars, /directLight\.color \+ skinLeak/);
  assert.ok(pars.includes(ShaderChunk.lights_physical_pars_fragment.slice(0, 200)), "the rest of the chunk is kept");
  assert.ok(!lights.includes("directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap"));
  assert.match(lights, /skinLeak = directLight\.color/);
  // Still indexed the way three's loop unroller rewrites.
  assert.match(lights, /directionalShadowMap\[ i \]/);
});

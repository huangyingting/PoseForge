/**
 * Furniture.
 *
 * The solver already knows the boxes - it collides against them, and a partner
 * bent over a table is bent over *that* table, at that height. So the renderer
 * builds its geometry from the same `props` array rather than from a parallel
 * set of models, for the same reason the body mesh comes out of the collision
 * field: two descriptions of the same object drift apart, and then the figure
 * is leaning on thin air an inch above the visible surface.
 *
 * These are deliberately plain. The subject is the pair of figures, and a bed
 * with a carved headboard competes with them for attention in a render whose
 * entire purpose is to show how two bodies fit together.
 */

import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShadowMaterial,
} from "three";

const PALETTE = {
  bed: 0xe8e2d9,
  "bed-frame": 0x6d5c4a,
  sofa: 0x8d9aa6,
  "sofa-back": 0x7d8a96,
  chair: 0x9a8570,
  "chair-back": 0x9a8570,
  table: 0xb4a084,
  bench: 0xa89680,
  default: 0x9b9b9b,
};

/** Rounded-looking box: a plain box plus a slightly inset top to catch the light. */
function propMesh(prop) {
  const [w, h, d] = prop.size;
  const colour = PALETTE[prop.kind] ?? PALETTE.default;
  const material = new MeshStandardMaterial({
    color: new Color(colour),
    roughness: prop.kind.startsWith("bed") ? 0.95 : 0.78,
    metalness: 0,
  });
  const mesh = new Mesh(new BoxGeometry(w, h, d), material);
  mesh.position.set(prop.center[0], prop.center[1], prop.center[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = prop.kind;
  return mesh;
}

/**
 * The ground.
 *
 * Shadow-receiving only, with no colour of its own beyond a wash, so the
 * contact shadow under the figures is the thing that reads. That shadow is what
 * tells the eye where the floor is; a textured floor plane competes with it.
 */
function groundMesh() {
  const material = new ShadowMaterial({
    color: new Color(0x35443a),
    opacity: 0.18,
  });
  const mesh = new Mesh(new PlaneGeometry(200, 200), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = "ground";
  return mesh;
}

/**
 * Build the furniture for a solved scene.
 * @param {Array<{kind:string, size:number[], center:number[]}>} props
 * @param {{ground?: boolean}} [options]
 * @returns {Group}
 */
export function buildProps(props, { ground = true } = {}) {
  const group = new Group();
  group.name = "props";
  if (ground) group.add(groundMesh());
  for (const prop of props ?? []) group.add(propMesh(prop));
  return group;
}

/** Release the geometry and materials a prop group owns. */
export function disposeProps(group) {
  group.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    node.material.dispose();
  });
}

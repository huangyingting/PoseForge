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
 * A ball or a wedge is drawn as the shape the solver collides with, not as its
 * bounding box, for the same reason.
 *
 * These are deliberately plain. The subject is the pair of figures, and a bed
 * with a carved headboard competes with them for attention in a render whose
 * entire purpose is to show how two bodies fit together.
 */

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  ShadowMaterial,
} from "three";
import { propOutline, propShape, propTriangles } from "../core/propShapes.js";

const PALETTE = {
  bed: 0xe8e2d9,
  "bed-frame": 0x6d5c4a,
  sofa: 0x8d9aa6,
  "sofa-back": 0x7d8a96,
  chair: 0x9a8570,
  "chair-back": 0x9a8570,
  table: 0xb4a084,
  bench: 0xa89680,
  ball: 0xc9d6dc,
  wedge: 0xb9a48c,
  "car-seat": 0x5b5f66,
  "car-seat-back": 0x53575e,
  default: 0x9b9b9b,
};

/**
 * A box, or for a ball or a wedge the solver's own surface. That is built in
 * world space, so the mesh stays at the origin.
 */
function propGeometry(prop) {
  if (propShape(prop) === "box") return new BoxGeometry(...prop.size);
  const { positions, normals, indices } = propTriangles(prop);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

function propMesh(prop) {
  const colour = PALETTE[prop.kind] ?? PALETTE.default;
  const material = new MeshStandardMaterial({
    color: new Color(colour),
    roughness: prop.kind.startsWith("bed") ? 0.95 : prop.kind === "ball" ? 0.45 : 0.78,
    metalness: 0,
  });
  const mesh = new Mesh(propGeometry(prop), material);
  if (propShape(prop) === "box")
    mesh.position.set(prop.center[0], prop.center[1], prop.center[2]);
  mesh.userData.shape = propShape(prop);
  // Line art draws a prism's hard edges, which its geometry alone does not say.
  if (propShape(prop) === "prism") mesh.userData.edges = propOutline(prop);
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
 * @param {Array<{kind:string, size:number[], center:number[], shape?:string, profile?:number[][]}>} props
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

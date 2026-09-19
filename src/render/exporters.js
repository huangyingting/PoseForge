/**
 * 2D output.
 *
 * Two kinds, because "export an image" means two different things depending on
 * what the image is for.
 *
 * A PNG is the render. It goes at whatever multiple of the viewport the user
 * asks for, optionally on transparency so the figures can be dropped onto
 * something else. The only subtlety is that a bigger export is not the same
 * picture scaled up - it is a *different* render, at a different pixel ratio,
 * and the camera has to keep the same framing across that change or the export
 * will not match what was on screen when the button was pressed.
 *
 * An SVG is the drawing: outlines only, no shading, arbitrarily scalable, and
 * editable afterwards in any vector tool. That is the useful form for reference
 * art, and it cannot be got by tracing the PNG, because a raster trace follows
 * the *shading* - it will happily draw a line along the edge of a shadow. The
 * lines that belong in a figure drawing are the silhouette: the places where
 * the surface turns away from the camera. Those are a property of the geometry
 * and the viewpoint, so they are computed from the mesh directly.
 *
 * Hidden-line removal is the part that makes the difference between line art
 * and a wireframe tangle. An arm in front of a torso has to cut the torso's
 * outline, and there is no way to know that from the silhouette edges alone -
 * it needs the depth of everything else in the scene. So the exporter renders a
 * depth pass first and tests every segment against it, which also gets the
 * figures occluding each other and the furniture for free.
 */

import {
  Color,
  DoubleSide,
  MeshDepthMaterial,
  RGBADepthPacking,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
} from "three";

/**
 * Render a PNG.
 *
 * @param {object} view the object returned by `createRenderer`
 * @param {{scale?: number, transparent?: boolean, ground?: boolean}} [options]
 * @returns {Promise<Blob>}
 */
export async function exportPNG(view, { scale = 2, transparent = false, ground = true } = {}) {
  const { renderer, scene, camera } = view;
  const canvas = renderer.domElement;
  const width = Math.round(canvas.clientWidth || canvas.width);
  const height = Math.round(canvas.clientHeight || canvas.height);

  const groundMesh = scene.getObjectByName("ground");
  const groundWas = groundMesh?.visible;
  if (groundMesh) groundMesh.visible = ground && !transparent;

  const background = scene.background;
  if (transparent) scene.background = null;

  const target = new WebGLRenderTarget(width * scale, height * scale, {
    // The render target is the final image, so it carries the same colour space
    // the canvas would have. Without this the export comes out darker than the
    // viewport it was taken from, which looks like a bug in the lighting.
    colorSpace: SRGBColorSpace,
    samples: 4,
  });

  const clearAlpha = renderer.getClearAlpha();
  renderer.setClearAlpha(transparent ? 0 : 1);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);

  const pixels = new Uint8Array(target.width * target.height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);

  renderer.setRenderTarget(null);
  renderer.setClearAlpha(clearAlpha);
  scene.background = background;
  if (groundMesh) groundMesh.visible = groundWas;
  target.dispose();

  return encodePNG(pixels, target.width, target.height);
}

/** GL reads bottom-up; a canvas is top-down. */
function encodePNG(pixels, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  const stride = width * 4;
  for (let row = 0; row < height; row += 1) {
    const from = (height - 1 - row) * stride;
    image.data.set(pixels.subarray(from, from + stride), row * stride);
  }
  context.putImageData(image, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/* ------------------------------------------------------------------ */
/* Vector line art                                                     */
/* ------------------------------------------------------------------ */

const depthMaterial = new MeshDepthMaterial({
  depthPacking: RGBADepthPacking,
  side: DoubleSide,
});

/**
 * Render the scene's depth into a readable buffer.
 *
 * `MeshDepthMaterial` with RGBA packing is the standard way to get depth out of
 * WebGL as bytes: a float depth buffer cannot be read back portably, but four
 * channels of 8 bits can, and unpacking them gives back the same window-space z
 * the projection produces.
 */
function renderDepth(view, width, height) {
  const { renderer, scene, camera } = view;
  const target = new WebGLRenderTarget(width, height);
  const override = scene.overrideMaterial;
  const background = scene.background;
  scene.overrideMaterial = depthMaterial;
  scene.background = null;

  // White, not the usual black. Packed depth runs from black at the near plane
  // to white at the far one, so clearing to black would declare every empty
  // pixel to be a surface pressed against the lens, and every line in the
  // picture would test as hidden behind the background.
  const clearColour = renderer.getClearColor(new Color());
  const clearAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0xffffff, 1);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);

  const bytes = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, bytes);

  renderer.setRenderTarget(null);
  renderer.setClearColor(clearColour, clearAlpha);
  scene.overrideMaterial = override;
  scene.background = background;
  target.dispose();

  // three's packDepthToRGBA, run backwards.
  const depth = new Float32Array(width * height);
  const k = 255 / 256;
  for (let i = 0; i < depth.length; i += 1) {
    const o = i * 4;
    depth[i] =
      (k *
        (bytes[o] / 255 / 16777216 +
          bytes[o + 1] / 255 / 65536 +
          bytes[o + 2] / 255 / 256 +
          bytes[o + 3] / 255)) || 1;
  }
  return depth;
}

/**
 * Window-space z to distance along the view axis.
 *
 * Depth values are compared in metres rather than in window z, because window z
 * spends most of its range in the first few centimetres in front of the near
 * plane. A tolerance that is sane at arm's length is hundreds of times too
 * loose at the far end of the same scene, and a single bias cannot work in
 * those units.
 */
function linearise(z, near, far) {
  const ndc = z * 2 - 1;
  return (2 * near * far) / (far + near - ndc * (far - near));
}

/** Project a world point into pixels plus a linear depth. */
function project(point, camera, width, height, out) {
  out.copy(point).project(camera);
  return {
    x: (out.x * 0.5 + 0.5) * width,
    y: (1 - (out.y * 0.5 + 0.5)) * height,
    z: linearise(out.z * 0.5 + 0.5, camera.near, camera.far),
    inside: out.z > -1 && out.z < 1,
  };
}

/**
 * Silhouette and boundary edges of an indexed mesh, in world space.
 *
 * An edge is on the silhouette when the two triangles sharing it disagree about
 * whether they face the camera - that is the definition of the surface turning
 * away, and it is viewpoint-dependent, which is why it is recomputed per export
 * rather than cached with the mesh. An edge used by only one triangle is a hole
 * in the surface; drawing it is how an open mesh shows that it is open, and on
 * a closed body there are none, so it costs nothing.
 */
function silhouetteEdges(mesh, camera) {
  const geometry = mesh.geometry;
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index) return [];

  mesh.updateWorldMatrix(true, false);
  const matrix = mesh.matrixWorld;
  const count = position.count;
  const world = new Float32Array(count * 3);
  const scratch = new Vector3();
  for (let v = 0; v < count; v += 1) {
    scratch.fromBufferAttribute(position, v).applyMatrix4(matrix);
    world[v * 3] = scratch.x;
    world[v * 3 + 1] = scratch.y;
    world[v * 3 + 2] = scratch.z;
  }

  const eye = camera.position;
  const triangles = index.count / 3;
  // One integer per edge, counting how many of its adjacent triangles face the
  // camera and how many face away, packed as `front * 8 + back`. Counting both
  // rather than tracking a single sign means a non-manifold edge - three
  // triangles meeting along one seam, which a dual-contoured surface can
  // produce at a pinch - is classified on what it actually is rather than on
  // whichever triangle happened to be visited last.
  const edges = new Map();
  const ax = [0, 0, 0];
  const bx = [0, 0, 0];
  const cx = [0, 0, 0];

  for (let t = 0; t < triangles; t += 1) {
    const i0 = index.getX(t * 3);
    const i1 = index.getX(t * 3 + 1);
    const i2 = index.getX(t * 3 + 2);
    for (let k = 0; k < 3; k += 1) {
      ax[k] = world[i0 * 3 + k];
      bx[k] = world[i1 * 3 + k];
      cx[k] = world[i2 * 3 + k];
    }
    const ux = bx[0] - ax[0];
    const uy = bx[1] - ax[1];
    const uz = bx[2] - ax[2];
    const vx = cx[0] - ax[0];
    const vy = cx[1] - ax[1];
    const vz = cx[2] - ax[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const front = nx * (eye.x - ax[0]) + ny * (eye.y - ax[1]) + nz * (eye.z - ax[2]) > 0;

    const pairs = [
      [i0, i1],
      [i1, i2],
      [i2, i0],
    ];
    for (const [a, b] of pairs) {
      const key = a < b ? a * 4294967296 + b : b * 4294967296 + a;
      edges.set(key, (edges.get(key) ?? 0) + (front ? 8 : 1));
    }
  }

  const out = [];
  for (const [key, code] of edges) {
    const front = code >> 3;
    const back = code & 7;
    // A silhouette is an edge its two triangles disagree about. An edge with a
    // single triangle is a hole in the surface, and drawing it is how an open
    // mesh shows that it is open; a closed body has none, so it costs nothing.
    const draw = (front > 0 && back > 0) || front + back === 1;
    if (!draw) continue;
    const b = key % 4294967296;
    const a = (key - b) / 4294967296;
    out.push([
      [world[a * 3], world[a * 3 + 1], world[a * 3 + 2]],
      [world[b * 3], world[b * 3 + 1], world[b * 3 + 2]],
    ]);
  }
  return out;
}

/**
 * The twelve edges of a prop.
 *
 * Furniture is boxes, and a box's drawn lines are its hard edges rather than
 * its silhouette - a table read as a silhouette loses the line where the top
 * meets the leg, which is the line that makes it look like a table.
 */
function boxEdges(mesh) {
  mesh.updateWorldMatrix(true, false);
  mesh.geometry.computeBoundingBox();
  const { min, max } = mesh.geometry.boundingBox;
  const corners = [];
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z])
        corners.push(new Vector3(x, y, z).applyMatrix4(mesh.matrixWorld).toArray());

  const pairs = [
    [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3],
    [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
  ];
  return pairs.map(([a, b]) => [corners[a], corners[b]]);
}

/**
 * Cut a projected segment into the parts the depth buffer says are visible.
 *
 * Sampling rather than analytic clipping: an exact answer would mean
 * intersecting the segment with every triangle in the scene, and at the
 * resolution a line is drawn at, a sample every few pixels is indistinguishable
 * from the exact answer and several orders of magnitude cheaper.
 *
 * The comparison takes the *farthest* depth in a small neighbourhood rather
 * than the depth directly under the sample. A silhouette is by definition where
 * the surface turns away fastest, so the depth gradient across it is the
 * steepest anywhere in the picture, and half a pixel of rounding puts the
 * stored value well behind the line that produced it. Testing against the
 * nearest sample makes an object occlude its own outline - furniture comes out
 * perfect and people come out as confetti.
 */
function visibleRuns(from, to, depth, width, height, tolerance) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length)) return [];
  const steps = Math.max(2, Math.min(64, Math.ceil(length / 3)));
  const runs = [];
  let start = null;

  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = from.x + dx * t;
    const y = from.y + dy * t;
    const z = from.z + (to.z - from.z) * t;
    const px = Math.round(x);
    const py = Math.round(y);
    let visible = px >= 1 && py >= 1 && px < width - 1 && py < height - 1;
    if (visible) {
      let behind = -Infinity;
      for (let v = -1; v <= 1; v += 1) {
        for (let u = -1; u <= 1; u += 1) {
          // The buffer was read bottom-up.
          const sample = depth[(height - 1 - (py + v)) * width + px + u];
          if (sample > behind) behind = sample;
        }
      }
      visible = z <= behind + tolerance;
    }
    if (visible && start === null) start = t;
    else if (!visible && start !== null) {
      runs.push([start, t]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, 1]);

  // A mesh edge at body resolution is only a handful of pixels long, so the
  // shortest run worth keeping is well under a pixel.
  return runs
    .filter(([a, b]) => (b - a) * length > 0.4)
    .map(([a, b]) => [
      { x: from.x + dx * a, y: from.y + dy * a },
      { x: from.x + dx * b, y: from.y + dy * b },
    ]);
}

/**
 * Render the scene as vector line art.
 *
 * @param {object} view the object returned by `createRenderer`
 * @param {{width?: number, height?: number, stroke?: string, strokeWidth?: number,
 *          background?: string|null, tolerance?: number}} [options]
 * @returns {string} SVG source
 */
export function exportSVG(view, options = {}) {
  const { renderer, scene, camera } = view;
  const canvas = renderer.domElement;
  const width = Math.round(options.width ?? canvas.clientWidth ?? canvas.width);
  const height = Math.round(options.height ?? canvas.clientHeight ?? canvas.height);
  const stroke = options.stroke ?? "#1b1b1b";
  const strokeWidth = options.strokeWidth ?? 1.4;
  const tolerance = options.tolerance ?? 0.02;

  // Depth is sampled at a fixed budget rather than at the output size: the
  // lines are vectors and do not get more accurate with a bigger buffer, but a
  // 4x export would pay 16x for the readback.
  const depthWidth = Math.min(width, 1280);
  const depthHeight = Math.round((depthWidth * height) / width);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const depth = renderDepth(view, depthWidth, depthHeight);

  const scratch = new Vector3();
  const point = new Vector3();
  const paths = [];

  scene.traverse((node) => {
    if (!node.isMesh || !node.visible || node.name === "ground") return;
    const isProp = node.parent?.name === "props";
    const edges = isProp ? boxEdges(node) : silhouetteEdges(node, camera);

    for (const [a, b] of edges) {
      const pa = project(point.set(a[0], a[1], a[2]), camera, depthWidth, depthHeight, scratch);
      const pb = project(point.set(b[0], b[1], b[2]), camera, depthWidth, depthHeight, scratch);
      if (!pa.inside || !pb.inside) continue;
      for (const [s, e] of visibleRuns(pa, pb, depth, depthWidth, depthHeight, tolerance)) {
        paths.push(
          `M${fmt(s.x)} ${fmt(s.y)}L${fmt(e.x)} ${fmt(e.y)}`
        );
      }
    }
  });

  const backdrop =
    options.background === null
      ? ""
      : `<rect width="${depthWidth}" height="${depthHeight}" fill="${options.background ?? "#ffffff"}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${depthWidth} ${depthHeight}">` +
    backdrop +
    `<g fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="round">` +
    `<path d="${paths.join("")}"/>` +
    `</g></svg>`
  );
}

const fmt = (n) => (Math.round(n * 10) / 10).toString();

/** Hand a blob or a string to the browser as a download. */
export function download(data, filename, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking immediately races the download in some browsers; a tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

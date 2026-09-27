/** One helper of `occlusionPool.js`: shades the run of vertices it is sent. */
import { fieldOcclusion } from "../render/meshBuilder.js";

self.onmessage = ({ data: { positions, normals, volumes, step } }) => {
  const occlusion = fieldOcclusion(positions, normals, volumes, step);
  self.postMessage({ occlusion }, [occlusion.buffer]);
};

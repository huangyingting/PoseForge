import { validateScene } from "../core/scene.js";
import { solveScene } from "../core/solver.js";
import { solvedPreview } from "../core/posePreview.js";

self.onmessage = ({ data }) => {
  try {
    const checked = validateScene(data.scene);
    const solved = solveScene(checked.scene);
    self.postMessage({
      id: data.id,
      key: data.key,
      preview: solvedPreview(solved),
    });
  } catch (error) {
    self.postMessage({ id: data.id, key: data.key, error: error.message });
  }
};

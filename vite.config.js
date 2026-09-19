import { defineConfig } from "vite";

export default defineConfig({
  // Relative, so a build can be dropped in a subdirectory of any static host
  // without being rebuilt for that path.
  base: "./",
  build: {
    target: "es2022",
    // three is most of the bundle and changes on its own schedule; splitting it
    // out means a change to the pose library does not invalidate it in every
    // user's cache.
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("node_modules/three") ? "three" : undefined),
      },
    },
  },
  worker: { format: "es" },
});

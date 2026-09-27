import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 150_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1000 },
    // Suites read the English studio; language.spec.js covers Chinese.
    locale: "en-US",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
    screenshot: "only-on-failure",
    // Asking for less motion turns off the camera tour a loaded position
    // gets, so suites that compare the canvas see a still camera.
    // camera-tour.spec.js clears this to cover the tour.
    reducedMotion: "reduce",
    // Functional suites drive the editor directly, so both drawers start open,
    // and they compare figures against the plain studio backdrop rather than a
    // room. compact-ui.spec.js clears this to cover the first-visit layout;
    // room.spec.js covers the rooms.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:5174",
          localStorage: [
            {
              name: "poseforge.layout.v1",
              value: JSON.stringify({ library: true, inspector: true }),
            },
            { name: "poseforge.setting.v1", value: "studio" },
          ],
        },
      ],
    },
  },
  webServer: {
    command:
      "npm run build && npm run preview -- --host 127.0.0.1 --port 5174 --strictPort",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
  },
});

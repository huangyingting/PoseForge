/** Direct-render inventory, separate from full-application browser workflows. */
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const output = resolve(process.argv[2] ?? "/tmp/poseforge-artistic-render");
mkdirSync(output, { recursive: true });
const pack = JSON.parse(
  readFileSync("public/catalog/artistic-studies-v1.json"),
);
const artifactHash = () =>
  createHash("sha256")
    .update(readFileSync("public/catalog/artistic-studies-v1.json"))
    .digest("hex");
const sha256 = artifactHash();
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});
const limit = Math.min(
  Number(process.env.ARTISTIC_AUDIT_LIMIT ?? pack.studies.length),
  pack.studies.length,
);
const server = await createServer({
  configFile: false,
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const rows = [],
  errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 800, height: 650 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__artistic-audit", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><title>Artistic pose audit</title></head><body style="margin:24px;background:#f1f3ef;font:16px sans-serif"><h1>Artistic posture study</h1><p>Clothed, separate artistic interpretation; not a source reconstruction.</p><canvas style="width:512px;height:384px"></canvas><script type="module" src="/tests/audits/artistic-renderer.js"></script></body></html>',
    }),
  );
  await page.goto(`${server.resolvedUrls.local[0]}__artistic-audit`);
  await page.waitForFunction(
    () => globalThis.artisticAuditReady,
    {},
    { timeout: 60_000 },
  );
  for (let i = 0; i < limit; i++) {
    if (stopping) throw new Error("Artistic audit interrupted.");
    rows.push(
      await page.evaluate((index) => globalThis.renderArtisticStudy(index), i),
    );
    if ([0, 4, 15, 125, 500, 1282].includes(i))
      await page.screenshot({
        path: `${output}/study-${pack.studies[i].sourceId}.png`,
      });
    if ((i + 1) % 50 === 0 || i === limit - 1)
      console.log(`Rendered ${i + 1}/${limit} artistic compositions`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  if (artifactHash() !== sha256)
    throw new Error("Artistic content changed during its render audit.");
  writeFileSync(
    `${output}/rendered-scenes.json`,
    JSON.stringify(
      {
        sha256,
        renderResolution: [256, 192],
        mode: "Direct existing scanned/clothed mesh pipeline and renderer, no worker surface refinement or final occlusion.",
        browser: browser.version(),
        scenes: rows.length,
        participants: rows.reduce((n, p) => n + p.figures, 0),
        minimumColouredPixels: Math.min(...rows.map((p) => p.colouredPixels)),
        errors,
        rows,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Evidence: ${output}/rendered-scenes.json`);
} finally {
  await browser.close();
  await server.close();
}

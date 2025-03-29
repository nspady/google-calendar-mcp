#!/usr/bin/env node

import * as esbuild from "esbuild";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: [join(__dirname, "../src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  outfile: join(__dirname, "../build/index.js"),
  format: "esm",
  banner: {
    js: "#!/usr/bin/env node\n",
  },
  packages: "external", // Don't bundle node_modules
  sourcemap: true,
};

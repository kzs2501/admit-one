#!/usr/bin/env node
/**
 * The door scanner reads QR codes with ZXing's WebAssembly build where the browser has
 * no BarcodeDetector of its own (iPhone Safari, desktop Firefox, Linux). The package
 * fetches its .wasm from a CDN by default; admit-one serves its own copy instead, so
 * the content security policy stays 'self' and the scanner works offline.
 *
 * Runs after every install. The file is named by its version, so it can be cached
 * forever, and it's generated, so it isn't committed (public/vendor/ is gitignored).
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";

const { version } = JSON.parse(readFileSync("node_modules/zxing-wasm/package.json", "utf8"));
const DIR = "public/vendor";
const NAME = `zxing_reader-${version}.wasm`;

mkdirSync(DIR, { recursive: true });
for (const file of readdirSync(DIR)) {
  if (file.startsWith("zxing_reader-") && file !== NAME) rmSync(`${DIR}/${file}`);
}
copyFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", `${DIR}/${NAME}`);

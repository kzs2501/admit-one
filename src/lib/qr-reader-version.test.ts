// @vitest-environment node
/**
 * The door's WebAssembly reader is copied into public/vendor/ at install, named by the
 * installed zxing-wasm's version; the reader asks for the file named by the version
 * barcode-detector was built against. If those two ever differ, the door 404s its own
 * reader, offline and on, so zxing-wasm is a dependency of its own, pinned to match.
 */
import { existsSync, readFileSync } from "node:fs";
import { ZXING_WASM_VERSION } from "barcode-detector/ponyfill";
import { describe, expect, it } from "vitest";

const installed = (JSON.parse(readFileSync("node_modules/zxing-wasm/package.json", "utf8")) as { version: string })
  .version;

describe("the door's WebAssembly reader", () => {
  it("is the version barcode-detector asks for", () => {
    expect(installed).toBe(ZXING_WASM_VERSION);
  });

  it("is copied where the reader looks for it", () => {
    expect(existsSync(`public/vendor/zxing_reader-${ZXING_WASM_VERSION}.wasm`)).toBe(true);
  });
});

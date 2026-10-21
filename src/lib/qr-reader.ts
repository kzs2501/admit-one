/**
 * Reads the QR code in a camera frame or a photo. Where the browser has its own
 * `BarcodeDetector` (Chrome on Android and macOS), it uses that. Elsewhere (Safari,
 * Firefox, desktop Linux and Windows) it uses the same API from the `barcode-detector`
 * ponyfill, which is ZXing compiled to WebAssembly. That loads only then, and only from
 * this site: the .wasm is copied in by `scripts/copy-zxing-wasm.mjs`, so the content
 * security policy stays 'self' and the scanner works offline.
 */
import type { BarcodeDetector as BarcodeDetectorClass } from "barcode-detector/ponyfill";

export interface QrReader {
  /** The first QR code in the image, or null if there's none. */
  read: (image: ImageBitmapSource) => Promise<string | null>;
  /** The browser's own detector, or the WebAssembly one. */
  kind: "native" | "wasm";
}

type Detector = InstanceType<typeof BarcodeDetectorClass>;

const asReader = (detector: Detector, kind: QrReader["kind"]): QrReader => ({
  kind,
  read: async (image) => (await detector.detect(image))[0]?.rawValue ?? null,
});

/** The browser's own detector, if it has one that reads QR codes. */
async function nativeDetector(): Promise<Detector | null> {
  const Native = Reflect.get(globalThis, "BarcodeDetector") as typeof BarcodeDetectorClass | undefined;
  if (!Native) return null;
  try {
    return (await Native.getSupportedFormats()).includes("qr_code") ? new Native({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

async function wasmDetector(): Promise<Detector> {
  const { BarcodeDetector, prepareZXingModule, ZXING_WASM_VERSION } = await import("barcode-detector/ponyfill");
  // Fetch and compile it now, not at the first scan: a visit online leaves it ready offline.
  await prepareZXingModule({
    overrides: {
      locateFile: (path, prefix) =>
        path.endsWith(".wasm") ? `/vendor/zxing_reader-${ZXING_WASM_VERSION}.wasm` : prefix + path,
    },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats: ["qr_code"] });
}

let reader: Promise<QrReader> | null = null;

/** The reader, made once. If it can't be made, the next call tries again. */
export function getQrReader(): Promise<QrReader> {
  reader ??= (async () => {
    try {
      const native = await nativeDetector();
      return native ? asReader(native, "native") : asReader(await wasmDetector(), "wasm");
    } catch (error) {
      reader = null;
      throw error;
    }
  })();
  return reader;
}

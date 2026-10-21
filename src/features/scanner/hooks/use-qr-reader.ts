import { useEffect, useState } from "react";
import { getQrReader, type QrReader } from "@/lib/qr-reader";
import { keepForOffline } from "@/lib/service-worker";

export type QrReaderState = { kind: "loading" } | { kind: "ready"; reader: QrReader } | { kind: "failed" };

/** The QR reader, made as soon as the scanner opens, so it's ready (and cached) before the first ticket. */
export function useQrReader(): QrReaderState {
  const [state, setState] = useState<QrReaderState>({ kind: "loading" });
  useEffect(() => {
    let isCurrent = true;
    getQrReader().then(
      (reader) => {
        // The WebAssembly reader has just loaded: keep it, so the door opens offline.
        keepForOffline();
        if (isCurrent) setState({ kind: "ready", reader });
      },
      () => {
        if (isCurrent) setState({ kind: "failed" });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, []);
  return state;
}

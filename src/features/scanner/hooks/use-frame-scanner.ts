import { useEffect, useEffectEvent, type RefObject } from "react";
import type { QrReader } from "@/lib/qr-reader";

/** About five frames a second: quick at a door, easy on a phone's battery. */
const FRAME_MS = 200;
/** A code still in view isn't read twice; one that's left the frame this long and comes back is. */
const GONE_MS = 1_500;

/**
 * Reads the camera's frames while it's on, and calls `onCode` once for each code that
 * comes into view. One frame at a time: the next waits until the last has been read.
 * When `resetKey` changes (the door's event), it starts over, so a ticket still in
 * view is checked for the new event.
 */
export function useFrameScanner(
  video: RefObject<HTMLVideoElement | null>,
  reader: QrReader | null,
  onCode: (code: string) => void,
  resetKey = "",
) {
  const handleCode = useEffectEvent(onCode);
  useEffect(() => {
    if (!reader) return;
    let isActive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const lastSeen = new Map<string, number>();
    const readFrame = async () => {
      const frame = video.current;
      if (frame && frame.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          const code = await reader.read(frame);
          const now = performance.now();
          if (code && isActive) {
            const seen = lastSeen.get(code);
            lastSeen.set(code, now);
            if (seen === undefined || now - seen > GONE_MS) handleCode(code);
          }
        } catch {
          // A frame that can't be read (mid-resize, say): the next one will be.
        }
      }
      if (isActive) timer = setTimeout(() => void readFrame(), FRAME_MS);
    };
    timer = setTimeout(() => void readFrame(), FRAME_MS);
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [video, reader, resetKey]);
}

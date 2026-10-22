import { useCallback, useEffect, useRef, useState } from "react";

export type CameraState =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "on"; stream: MediaStream }
  /** The person, or the browser's settings, said no. */
  | { kind: "blocked" }
  /** No camera here, or none the page may use. */
  | { kind: "missing" }
  /** Another app has it, or it failed. */
  | { kind: "failed" }
  /** It was on, and stopped by itself: unplugged, taken by another app, or its permission withdrawn. */
  | { kind: "lost" }
  /** Off while the page is hidden; it comes back on when the page is shown. */
  | { kind: "paused" };

function stateFor(error: unknown): CameraState {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return { kind: "blocked" };
  if (name === "NotFoundError" || name === "OverconstrainedError") return { kind: "missing" };
  return { kind: "failed" };
}

/**
 * The back camera, once asked for: the page asks when someone presses start, never on
 * load, so the permission prompt comes with a reason. It's turned off while the page is
 * hidden and back on when it's shown, and stopped when the page goes, even if the
 * permission prompt was still open then.
 */
export function useCamera() {
  const [state, setState] = useState<CameraState>({ kind: "off" });
  const stream = useRef<MediaStream | null>(null);
  /** Whether the person asked for the camera (and hasn't stopped it): what to come back to. */
  const isWanted = useRef(false);
  const isMounted = useRef(false);

  const release = useCallback(() => {
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
  }, []);

  const open = useCallback(async () => {
    // Missing where the page isn't a secure context, whatever the types say.
    const devices = navigator.mediaDevices as MediaDevices | undefined;
    if (!devices) {
      setState({ kind: "missing" });
      return;
    }
    setState({ kind: "starting" });
    try {
      const media = await devices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      // Gone, stopped or hidden while the prompt was open: let go of it at once.
      if (!isMounted.current || !isWanted.current || document.hidden) {
        for (const track of media.getTracks()) track.stop();
        if (isMounted.current) setState(isWanted.current ? { kind: "paused" } : { kind: "off" });
        return;
      }
      release();
      stream.current = media;
      for (const track of media.getVideoTracks()) {
        track.addEventListener("ended", () => {
          if (stream.current !== media) return;
          release();
          isWanted.current = false;
          setState({ kind: "lost" });
        });
      }
      setState({ kind: "on", stream: media });
    } catch (error) {
      isWanted.current = false;
      if (isMounted.current) setState(stateFor(error));
    }
  }, [release]);

  const start = useCallback(async () => {
    isWanted.current = true;
    await open();
  }, [open]);

  const stop = useCallback(() => {
    isWanted.current = false;
    release();
    setState({ kind: "off" });
  }, [release]);

  useEffect(() => {
    isMounted.current = true;
    const onVisibilityChange = () => {
      if (!isWanted.current) return;
      if (document.hidden) {
        release();
        setState({ kind: "paused" });
      } else {
        void open();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      isMounted.current = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      release();
    };
  }, [open, release]);

  return { state, start, stop };
}

"use client";

import { useCallback, useRef, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { CATALOG, getEvent } from "@/core/catalog";
import type { TicketKeyring } from "@/core/ticket-token";
import { DOOR_KEYRING } from "@/lib/ticket-keys";
import { useCamera, type CameraState } from "@/features/scanner/hooks/use-camera";
import { useDoorEvent } from "@/features/scanner/hooks/use-door-event";
import { useDoorVoids, type RefundCheck } from "@/features/scanner/hooks/use-door-voids";
import { useDoor } from "@/features/scanner/hooks/use-door";
import { useFrameScanner } from "@/features/scanner/hooks/use-frame-scanner";
import { useQrReader } from "@/features/scanner/hooks/use-qr-reader";
import { formatEventTime } from "@/lib/format";
import { useIsInteractive } from "@/lib/use-is-interactive";
import { ScanResult } from "./scan-result";

const CAMERA_NOTICES: Partial<Record<CameraState["kind"], { title: string; body: string }>> = {
  blocked: {
    title: "The camera is blocked",
    body: "Allow it in the browser’s settings for this site, or scan a photo of each ticket instead.",
  },
  missing: { title: "No camera here", body: "Scan a photo of each ticket instead." },
  failed: {
    title: "The camera didn’t start",
    body: "Another app may be using it. Close that and try again, or scan a photo instead.",
  },
  lost: {
    title: "The camera stopped",
    body: "It may have been disconnected, or taken by another app. Start it again, or scan a photo instead.",
  },
};

const ticketsLetIn = (count: number) => `${String(count)} ${count === 1 ? "ticket" : "tickets"} let in`;

/**
 * The door: pick the event, point the camera at a ticket, and it says whether to let
 * them in. It checks each ticket's signature with the public key and remembers the
 * tickets it has let in, all on this device, so it works with no connection at all.
 */
export function ScannerPage({ keyring = DOOR_KEYRING }: { keyring?: TicketKeyring }) {
  const [eventSlug, setEventSlug] = useDoorEvent();
  const isInteractive = useIsInteractive();
  const event = getEvent(eventSlug);
  const refunds = useDoorVoids(eventSlug);
  const door = useDoor(eventSlug, keyring, refunds.codes);
  const camera = useCamera();
  const reader = useQrReader();
  const video = useRef<HTMLVideoElement | null>(null);

  const stream = camera.state.kind === "on" ? camera.state.stream : null;
  const attachVideo = useCallback(
    (element: HTMLVideoElement | null) => {
      video.current = element;
      if (element && stream) element.srcObject = stream;
    },
    [stream],
  );
  useFrameScanner(
    video,
    stream && reader.kind === "ready" ? reader.reader : null,
    (code) => void door.scan(code),
    eventSlug,
  );

  async function scanPhoto(change: ChangeEvent<HTMLInputElement>) {
    const file = change.target.files?.[0];
    // So choosing the same photo again still scans it.
    change.target.value = "";
    if (!file || reader.kind !== "ready") return;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      const code = await reader.reader.read(bitmap);
      if (code) await door.scan(code);
      else door.noCode();
    } catch {
      door.noCode();
    } finally {
      bitmap?.close();
    }
  }

  const notice = CAMERA_NOTICES[camera.state.kind];
  return (
    <div className="mx-auto max-w-2xl px-5 py-10 sm:px-8 sm:py-14">
      <h1 className="font-display text-3xl font-semibold tracking-tight">Door scanner</h1>
      <p className="mt-2 text-ink-2">
        Checks each ticket’s signature on this device, so it works without a connection.
      </p>

      <label className="mt-6 flex flex-col gap-1 text-sm">
        <span className="text-ink-2">Event at this door</span>
        {/* Disabled until the page is interactive: on a slow phone, a choice made on the
            bare HTML would show here while the door went on checking the first event. */}
        <select
          value={eventSlug}
          disabled={!isInteractive}
          onChange={(change) => {
            setEventSlug(change.target.value);
            door.clear();
          }}
          className="min-h-11 rounded-lg border border-line bg-card px-3"
        >
          {CATALOG.map((option) => (
            <option key={option.slug} value={option.slug}>
              {option.name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-6 space-y-5">
        {keyring.size === 0 && (
          <Notice tone="bad" title="This scanner can’t check tickets yet">
            It has no key to check signatures with. Whoever runs this site needs to set one up.
          </Notice>
        )}
        {reader.kind === "failed" && (
          <Notice tone="bad" title="This browser can’t read ticket codes">
            The code reader didn’t load. Connect once and reload, and it will be kept for offline.
          </Notice>
        )}

        {stream ? (
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
            <video
              ref={attachVideo}
              muted
              playsInline
              autoPlay
              aria-label="Camera view"
              className="size-full object-cover"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-[12%] rounded-lg border-2 border-white/80"
            />
          </div>
        ) : (
          <div className="space-y-3">
            <Button
              isBusy={camera.state.kind === "starting" || camera.state.kind === "paused"}
              onClick={() => void camera.start()}
              className="w-full sm:w-auto"
            >
              Start the camera
            </Button>
            {notice && (
              <Notice tone="warn" title={notice.title}>
                {notice.body}
              </Notice>
            )}
          </div>
        )}

        <ScanResult result={door.result} timeZone={event.timeZone} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-ink-2">Or scan a photo of a ticket</span>
            <input
              type="file"
              accept="image/*"
              disabled={reader.kind !== "ready"}
              onChange={(change) => void scanPhoto(change)}
              className="text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-line file:bg-card file:px-4 file:font-medium file:text-ink hover:file:bg-sunk"
            />
          </label>
          {stream && (
            <Button variant="secondary" onClick={camera.stop}>
              Stop the camera
            </Button>
          )}
        </div>

        <RefundStatus check={refunds.check} timeZone={event.timeZone} />

        {door.admitted !== null && (
          <p className="text-sm text-ink-2">
            {ticketsLetIn(door.admitted)} for {event.name} on this device.
          </p>
        )}
      </div>
    </div>
  );
}

/** How current the door's list of refunded tickets is, and how to bring it up to date. */
function RefundStatus({ check, timeZone }: { check: RefundCheck; timeZone: string }) {
  const at = (ms: number) => formatEventTime(new Date(ms).toISOString(), timeZone);
  switch (check.kind) {
    case "loading":
    case "unavailable":
      return null;
    case "checked":
      return <p className="text-sm text-ink-2">Refunds checked at {at(check.asOfMs)}.</p>;
    case "signed-out":
      return (
        <p className="text-sm text-ink-2">
          {check.asOfMs === null
            ? "Refunds aren’t checked on this device yet: a refunded ticket would still get in. "
            : `Refunds checked at ${at(check.asOfMs)}; sign in again to check for newer ones. `}
          {/* A full load: the sign-in page has the shop's headers, this one its own. */}
          <a href="/organiser/sign-in" className="font-medium underline underline-offset-4">
            Sign in as the event’s organiser
          </a>
          , then come back here.
        </p>
      );
  }
}

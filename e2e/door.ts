/**
 * The door scanner's test vocabulary: tickets signed the way the sandbox signs them,
 * photos of codes, and a camera feed with a ticket in front of it.
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { encode, renderSVG } from "uqr";
import { signDemoTicket } from "../src/core/demo-ticket-key";
import type { TicketClaims } from "../src/core/ticket-token";

export const STUDIO = { slug: "open-studio-ceramics", name: "Open Studio: Ceramics" };

export const ticketClaims = (overrides: Partial<TicketClaims> = {}): TicketClaims => ({
  code: "AO-DOOR-1",
  eventSlug: STUDIO.slug,
  attendeeName: "Asha Rao",
  tierName: "Two-hour session",
  seat: null,
  ...overrides,
});

/** A real ticket's signature with someone else's details on it. */
export function forgedTicket() {
  const [version, kid, , signature] = signDemoTicket(ticketClaims()).split(".");
  const payload = signDemoTicket(ticketClaims({ attendeeName: "Someone Else" })).split(".")[2];
  return [version, kid, payload, signature].join(".");
}

/** A photo of a QR code, as a PNG: drawn on a page of its own and photographed. */
export async function photoOfCode(page: Page, text: string) {
  const studio = await page.context().newPage();
  await studio.setContent(
    `<body style="margin:0;background:#fff">${renderSVG(text, { ecc: "M", border: 4, pixelSize: 6 })}</body>`,
  );
  const photo = await studio.locator("svg").screenshot();
  await studio.close();
  return { name: "ticket.png", mimeType: "image/png", buffer: photo };
}

/** Read codes with the WebAssembly reader, as Safari and Firefox do, whatever this Chromium has. */
export const withoutNativeDetector = (page: Page) =>
  page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, "BarcodeDetector");
  });

/** The ticket in front of the fake camera, and the feed Chromium plays (see playwright.config.ts). */
export const CAMERA_TICKET = ticketClaims({ code: "AO-CAMERA-1", attendeeName: "Ravi Menon" });
export const CAMERA_FEED = join(tmpdir(), "dresscircle-door-camera.y4m");

/**
 * A camera feed of one QR code on white, in YUV4MPEG2: the format Chromium's fake
 * camera plays, on a loop. One 640×480 4:2:0 frame; luma only, chroma neutral.
 */
export function writeCameraFeed(path: string, text: string) {
  const width = 640;
  const height = 480;
  const { data, size } = encode(text, { ecc: "M", border: 4 });
  const scale = Math.floor((height * 0.9) / size);
  const left = Math.floor((width - size * scale) / 2);
  const top = Math.floor((height - size * scale) / 2);
  const luma = Buffer.alloc(width * height, 235);
  data.forEach((row, y) => {
    row.forEach((isDark, x) => {
      if (!isDark) return;
      for (let dy = 0; dy < scale; dy++) {
        luma.fill(
          16,
          (top + y * scale + dy) * width + left + x * scale,
          (top + y * scale + dy) * width + left + (x + 1) * scale,
        );
      }
    });
  });
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128);
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${String(width)} H${String(height)} F10:1 Ip A1:1 C420jpeg\n`),
      Buffer.from("FRAME\n"),
      luma,
      chroma,
      chroma,
    ]),
  );
}

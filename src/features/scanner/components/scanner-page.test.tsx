import "fake-indexeddb/auto";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signDemoTicket } from "@/core/demo-ticket-key";
import type { TicketClaims } from "@/core/ticket-token";
import { ScannerPage } from "./scanner-page";

/** The reader answers whatever the "photo" holds: here, a file whose text is the code. */
vi.mock("@/lib/qr-reader", () => ({
  getQrReader: () =>
    Promise.resolve({
      kind: "wasm",
      read: (image: { text?: string }) => Promise.resolve(image.text ?? null),
    }),
}));

const claims = (code: string, eventSlug = "frontend-systems-summit"): TicketClaims => ({
  code,
  eventSlug,
  attendeeName: "Asha Rao",
  tierName: "General",
  seat: null,
});

const photoOf = (text: string) => new File([text], "ticket.png", { type: "image/png" });

beforeEach(() => {
  // Each "photo" becomes a bitmap the fake reader can read the code from.
  vi.stubGlobal("createImageBitmap", async (file: File) => ({ text: await file.text(), close: vi.fn() }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
});

async function scanPhoto(text: string) {
  const user = userEvent.setup();
  const input = await screen.findByLabelText("Or scan a photo of a ticket");
  await waitFor(() => {
    expect(input).toBeEnabled();
  });
  await user.upload(input, photoOf(text));
}

describe("the door scanner", () => {
  it("lets a ticket in once, and turns it away when it's shown again", async () => {
    render(<ScannerPage />);
    const ticket = signDemoTicket(claims("AO-PAGE-1"));
    await scanPhoto(ticket);
    const result = screen.getByRole("status");
    expect(await screen.findByText("Admitted")).toBeInTheDocument();
    expect(result).toHaveTextContent("Asha Rao");
    expect(await screen.findByText(/^1 ticket let in for Frontend Systems Summit/)).toBeInTheDocument();

    await scanPhoto(ticket);
    expect(await screen.findByText("Already scanned")).toBeInTheDocument();
    expect(result).toHaveTextContent(/First scanned at .+ on this device/);
  });

  it("turns away a ticket for another event, and a code that isn't a ticket", async () => {
    render(<ScannerPage />);
    await scanPhoto(signDemoTicket(claims("AO-PAGE-2", "monsoon-strings")));
    expect(await screen.findByText("This ticket is for Monsoon Strings.")).toBeInTheDocument();
    await scanPhoto("https://example.com");
    expect(await screen.findByText("This isn’t an admit-one ticket.")).toBeInTheDocument();
  });

  it("checks tickets for the event chosen at this door", async () => {
    render(<ScannerPage />);
    await userEvent.selectOptions(screen.getByLabelText("Event at this door"), "Monsoon Strings");
    await scanPhoto(signDemoTicket(claims("AO-PAGE-3", "monsoon-strings")));
    expect(await screen.findByText("Admitted")).toBeInTheDocument();
  });

  it("says when a photo has no code in it", async () => {
    render(<ScannerPage />);
    await scanPhoto("");
    expect(await screen.findByText("No code found")).toBeInTheDocument();
  });

  it("says it can't check tickets when it has no key, and lets nobody in", async () => {
    render(<ScannerPage keyring={new Map()} />);
    expect(screen.getByText("This scanner can’t check tickets yet")).toBeInTheDocument();
    await scanPhoto(signDemoTicket(claims("AO-PAGE-4")));
    expect(await screen.findByText("It’s signed with a key this scanner doesn’t trust.")).toBeInTheDocument();
  });

  it("explains a blocked camera, and offers the photo instead", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.reject(new DOMException("No", "NotAllowedError")) },
    });
    render(<ScannerPage />);
    await userEvent.click(screen.getByRole("button", { name: "Start the camera" }));
    expect(await screen.findByText("The camera is blocked")).toBeInTheDocument();
    expect(screen.getByLabelText("Or scan a photo of a ticket")).toBeInTheDocument();
  });
});

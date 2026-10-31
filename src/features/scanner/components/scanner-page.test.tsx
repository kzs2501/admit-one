import "fake-indexeddb/auto";
import { act, render, screen, waitFor } from "@testing-library/react";
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
  Reflect.deleteProperty(document, "hidden");
  localStorage.clear();
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
    expect(await screen.findByText("This isn’t a Dress Circle ticket.")).toBeInTheDocument();
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

  /** A camera stream whose one track can be stopped, or end by itself. */
  function fakeCamera() {
    const listeners = new Map<string, () => void>();
    const track = {
      stop: vi.fn(),
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
    };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    return { stream, track, end: () => listeners.get("ended")?.() };
  }

  function stubCamera(getUserMedia: () => Promise<unknown>) {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  }

  function setHidden(isHidden: boolean) {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("lets go of a camera that arrives after the page has gone", async () => {
    const camera = fakeCamera();
    let grant: (stream: unknown) => void = () => undefined;
    stubCamera(() => new Promise((resolve) => (grant = resolve)));
    const { unmount } = render(<ScannerPage />);
    await userEvent.click(screen.getByRole("button", { name: "Start the camera" }));
    // The permission prompt is still open when the page goes.
    unmount();
    await act(async () => {
      grant(camera.stream);
      await Promise.resolve();
    });
    expect(camera.track.stop).toHaveBeenCalled();
  });

  it("turns the camera off while the page is hidden, and back on when it's shown", async () => {
    const first = fakeCamera();
    const second = fakeCamera();
    const getUserMedia = vi.fn().mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream);
    stubCamera(getUserMedia);
    render(<ScannerPage />);
    await userEvent.click(screen.getByRole("button", { name: "Start the camera" }));
    expect(await screen.findByLabelText("Camera view")).toBeInTheDocument();
    act(() => {
      setHidden(true);
    });
    expect(first.track.stop).toHaveBeenCalled();
    act(() => {
      setHidden(false);
    });
    expect(await screen.findByLabelText("Camera view")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("says when the camera stops by itself", async () => {
    const camera = fakeCamera();
    stubCamera(() => Promise.resolve(camera.stream));
    render(<ScannerPage />);
    await userEvent.click(screen.getByRole("button", { name: "Start the camera" }));
    await screen.findByLabelText("Camera view");
    act(() => {
      camera.end();
    });
    expect(await screen.findByText("The camera stopped")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start the camera" })).toBeInTheDocument();
  });

  it("remembers the door's event on this device", async () => {
    const { unmount } = render(<ScannerPage />);
    await userEvent.selectOptions(screen.getByLabelText("Event at this door"), "Monsoon Strings");
    unmount();
    render(<ScannerPage />);
    expect(screen.getByLabelText("Event at this door")).toHaveValue("monsoon-strings");
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

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEMO_TICKET_KEY_ID, DEMO_TICKET_PUBLIC_KEY, signDemoTicket } from "@/core/demo-ticket-key";
import { ticketKeyFrom } from "@/core/ticket-token";
import { useDoor } from "./use-door";

/** The scan log, answering when the test says so. */
const log = vi.hoisted(() => {
  const waiting: { answer: (memory: unknown) => void } = {
    answer: () => {
      throw new Error("No scan is waiting for the log");
    },
  };
  return waiting;
});
vi.mock("@/lib/scan-log", () => ({
  recordScan: () =>
    new Promise((resolve) => {
      log.answer = (memory) => {
        resolve(memory);
      };
    }),
  countAdmitted: () => Promise.resolve(1),
}));

const keyring = new Map([[DEMO_TICKET_KEY_ID, ticketKeyFrom(DEMO_TICKET_PUBLIC_KEY)]]);
const ticket = signDemoTicket({
  code: "AO-SWITCH-1",
  eventSlug: "open-studio-ceramics",
  attendeeName: "Asha Rao",
  tierName: "Two-hour session",
  seat: null,
});

describe("the door, when its event changes mid-scan", () => {
  it("still shows the answer to a scan it has recorded", async () => {
    const { result, rerender } = renderHook(({ event }) => useDoor(event, keyring), {
      initialProps: { event: "open-studio-ceramics" },
    });
    let scanning: Promise<void> = Promise.resolve();
    act(() => {
      scanning = result.current.scan(ticket);
    });
    rerender({ event: "monsoon-strings" });
    await act(async () => {
      log.answer({ isFirst: true, firstScannedAt: 1_000 });
      await scanning;
    });
    await waitFor(() => {
      expect(result.current.result).toMatchObject({ kind: "admitted", claims: { code: "AO-SWITCH-1" } });
    });
  });
});

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import type { TicketClaims } from "@/core/ticket-token";
import { ScanResult } from "./scan-result";

const claims: TicketClaims = {
  code: "AO-7F3K-2Q",
  eventSlug: "monsoon-strings",
  attendeeName: "Asha Rao",
  tierName: "Stalls",
  seat: "Stalls, row D, seat 11",
};

/** The door's answer to each scan: what door staff read at arm's length, and hear. */
const meta = {
  title: "Features/Scanner/Scan result",
  component: ScanResult,
  args: { result: null, timeZone: "Asia/Kolkata" },
} satisfies Meta<typeof ScanResult>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

/** A live region with a name, so it's found, and announced, as the last scan. */
export const Admitted: Story = {
  args: { result: { kind: "admitted", claims, isRemembered: true, id: 1 } },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status", { name: "Last scan" })).toHaveTextContent(/Admitted.*Asha Rao/);
  },
};

/** A private window keeps no scan log, so the door says it can't catch a second showing. */
export const AdmittedWithoutAScanLog: Story = {
  args: {
    result: { kind: "admitted", claims: { ...claims, seat: null, tierName: "General" }, isRemembered: false, id: 1 },
  },
};

/** The time is the venue's, where the door is. */
export const AlreadyScanned: Story = {
  args: {
    result: { kind: "already-scanned", claims, firstScannedAt: Date.UTC(2026, 10, 21, 14, 12), id: 1 },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText(/First scanned at 7:42.pm on this device/)).toBeVisible();
  },
};

export const Forged: Story = {
  args: { result: { kind: "rejected", rejection: { reason: "forged" }, id: 1 } },
};

export const ForAnotherEvent: Story = {
  args: {
    result: { kind: "rejected", rejection: { reason: "other-event", eventName: "Open Studio: Ceramics" }, id: 1 },
  },
};

export const SignedWithAnUnknownKey: Story = {
  args: { result: { kind: "rejected", rejection: { reason: "unknown-key" }, id: 1 } },
};

export const NotATicket: Story = {
  args: { result: { kind: "rejected", rejection: { reason: "not-a-ticket" }, id: 1 } },
};

export const NoCodeInThePhoto: Story = {
  args: { result: { kind: "no-code", id: 1 } },
};

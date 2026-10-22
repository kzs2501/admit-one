import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";
import { attendeesFor, cardPayment, CONCERT, holdFor, orderFor, SUMMIT } from "@/contract/testing/dto-fixtures";
import { ticketsFromOrder, type WalletTicket } from "@/lib/wallet";
import { TicketCard } from "./ticket-card";

const walletTicket = (scene: typeof SUMMIT): WalletTicket => {
  const order = orderFor(
    holdFor(scene),
    { attendees: attendeesFor(1), addOns: {} },
    { status: "fulfilled", payment: cardPayment() },
  );
  const [ticket] = ticketsFromOrder(order);
  if (!ticket) throw new Error("The fixture order has no tickets");
  return ticket;
};

/** A ticket in the wallet: what the buyer reads, and the signed code the door scans. */
const meta = {
  title: "Features/Tickets/Ticket card",
  component: TicketCard,
  args: { ticket: walletTicket(SUMMIT) },
} satisfies Meta<typeof TicketCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The code is black on white in dark mode too: scanners read dark on light best. */
export const GeneralAdmission: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("img", { name: "Code to scan at the door, for Asha Rao" })).toBeVisible();
  },
};

export const WithASeat: Story = { args: { ticket: walletTicket(CONCERT) } };

/** Its order was refunded: no code to scan, and the card says why. */
export const Refunded: Story = {
  args: { ticket: { ...walletTicket(SUMMIT), isRefunded: true } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Refunded: this ticket no longer gets anyone in.")).toBeVisible();
    await expect(canvas.queryByRole("img")).toBeNull();
  },
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CONCERT, eventDtoFor, holdFor, SUMMIT } from "@/contract/testing/dto-fixtures";
import { OrderSummary } from "./order-summary";

const concert = holdFor(CONCERT);

/** Priced by the same engine the server charges by: every part of the total is listed, GST included. */
const meta = {
  title: "Features/Checkout/Order summary",
  component: OrderSummary,
  args: { event: eventDtoFor(SUMMIT.eventSlug), items: SUMMIT.items, seats: [], addOns: {} },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof OrderSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tickets: Story = {};

/** Lunch is food: GST at 5%, shown on its own line beside the tickets' 18%. */
export const WithExtras: Story = { args: { addOns: { "fss-lunch": 2, "fss-tee": 1 } } };

/** Seats are listed under their tier. */
export const ReservedSeats: Story = {
  args: { event: eventDtoFor(CONCERT.eventSlug), items: concert.items, seats: concert.seats },
};

/** Tickets of ₹500 or less carry no GST; the booking fee still does. */
export const GstExemptTickets: Story = {
  args: { event: eventDtoFor("night-market-jazz"), items: [{ tierId: "nmj-student", quantity: 2 }] },
};

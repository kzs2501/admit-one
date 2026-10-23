import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderRowDto } from "@/contract/dto";
import { DEFAULT_ORDER_BY } from "@/contract/queries";
import { OrdersTable } from "./orders-table";

const order = (i: number): OrderRowDto => ({
  id: `ord_h${String(i).padStart(5, "0")}`,
  eventSlug: "lakeside-lights",
  eventName: "Lakeside Lights Festival",
  createdAt: new Date(Date.UTC(2026, 9, 1, 10, i)).toISOString(),
  buyerName: `Buyer ${String(i)}`,
  buyerEmail: `buyer${String(i)}@example.com`,
  ticketCount: 1,
  totalMinor: 303_729,
  currency: "INR",
  status: "fulfilled",
  paymentMethod: "upi",
  refundStatus: i === 2 ? "pending" : null,
});

// jsdom has no layout: give the table's scroll area a height, so the virtualiser draws rows.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const table = (rows: readonly OrderRowDto[], onSort = vi.fn()) => (
  <OrdersTable
    isUpdating={false}
    rows={rows}
    totalSize={rows.length}
    orderBy={DEFAULT_ORDER_BY}
    onSort={onSort}
    hasNextPage={false}
    isFetchingNextPage={false}
    fetchNextPage={vi.fn()}
  />
);

function setup() {
  const onSort = vi.fn();
  render(
    <OrdersTable
      isUpdating={false}
      rows={Array.from({ length: 30 }, (_, i) => order(i + 1))}
      totalSize={9_000}
      orderBy={DEFAULT_ORDER_BY}
      onSort={onSort}
      hasNextPage={false}
      isFetchingNextPage={false}
      fetchNextPage={vi.fn()}
    />,
  );
  return { onSort, user: userEvent.setup() };
}

const rowOf = (orderId: string) => screen.getByRole("link", { name: orderId }).closest("tr");

describe("OrdersTable", () => {
  it("tells assistive tech how many rows there are, and where each drawn one sits", () => {
    setup();
    const table = screen.getByRole("table", { name: "Orders, 9,000 in all" });
    expect(table).toHaveAttribute("aria-rowcount", "9001");
    const [header, first, second] = within(table).getAllByRole("row");
    expect(header).toHaveAttribute("aria-rowindex", "1");
    expect(first).toHaveAttribute("aria-rowindex", "2");
    expect(second).toHaveTextContent("Refund pending");
  });

  it("marks only the sorted column, and asks to sort by the one clicked", async () => {
    const { onSort, user } = setup();
    expect(screen.getByRole("columnheader", { name: /Placed/ })).toHaveAttribute("aria-sort", "descending");
    expect(screen.getByRole("columnheader", { name: /Total/ })).not.toHaveAttribute("aria-sort");
    expect(within(screen.getByRole("columnheader", { name: /Event/ })).queryByRole("button")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Total" }));
    expect(onSort).toHaveBeenCalledWith("totalMinor");
  });

  it("links each order to its page", () => {
    setup();
    expect(screen.getByRole("link", { name: "ord_h00001" })).toHaveAttribute("href", "/organiser/orders/ord_h00001");
  });

  it("stays up when the focused row is filtered away", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => order(i + 1));
    const { rerender } = render(table(thirty));
    act(() => {
      screen.getByRole("link", { name: "ord_h00015" }).focus();
    });

    // A search narrows thirty rows to three: the focused one isn't among them.
    rerender(table(thirty.slice(0, 3)));
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("keeps each order on its own row when the sort changes, so focus stays with it", () => {
    const five = Array.from({ length: 5 }, (_, i) => order(i + 1));
    const { rerender } = render(table(five));
    const first = rowOf("ord_h00001");
    act(() => {
      screen.getByRole("link", { name: "ord_h00001" }).focus();
    });

    rerender(table(five.toReversed()));
    expect(rowOf("ord_h00001")).toBe(first);
    expect(screen.getByRole("link", { name: "ord_h00001" })).toHaveFocus();
  });
});

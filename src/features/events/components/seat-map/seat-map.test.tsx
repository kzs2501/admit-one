import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, NetworkError } from "@/lib/api-client";
import { SeatMap } from "./seat-map";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderHall() {
  vi.spyOn(apiClient, "getSeatAvailability").mockResolvedValue({
    eventSlug: "monsoon-strings",
    unavailableSeatIds: [],
    serverTime: new Date().toISOString(),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SeatMap slug="monsoon-strings" />
    </QueryClientProvider>,
  );
  const grid = await screen.findByRole("grid", { name: "Stalls" });
  // Availability arrives after the hall's layout: wait until a seat is offered.
  await waitFor(() => {
    expect(within(grid).getByRole("gridcell", { name: /^Row A, seat 1,/ })).not.toHaveAttribute("aria-disabled");
  });
  return {
    client,
    seat: (number: number) => within(grid).getByRole("gridcell", { name: new RegExp(`^Row A, seat ${number},`) }),
  };
}

describe("the seat map", () => {
  it("focuses a reserve that got no answer once, then leaves focus where the buyer puts it", async () => {
    vi.spyOn(apiClient, "createHold").mockRejectedValue(new NetworkError("The connection dropped."));
    const user = userEvent.setup();
    const { seat } = await renderHall();

    await user.click(seat(1));
    await user.click(screen.getByRole("button", { name: "Reserve seat" }));
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("Couldn’t reserve those seats");
    await waitFor(() => {
      expect(notice.parentElement).toHaveFocus();
    });

    // Re-rendering isn't a new failure: focus stays where the buyer moved it.
    const large = screen.getByRole("radio", { name: "large" });
    await user.click(large);
    expect(large).toHaveFocus();
    expect(screen.getByRole("alert")).toBe(notice);

    // Choosing again puts the failure behind them, as a server's refusal is.
    await user.click(seat(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says a seat was taken from a status region that was there all along", async () => {
    const user = userEvent.setup();
    const { client, seat } = await renderHall();
    const regions = screen.getAllByRole("status");

    await user.click(seat(1));
    await user.click(seat(2));
    vi.mocked(apiClient.getSeatAvailability).mockResolvedValue({
      eventSlug: "monsoon-strings",
      unavailableSeatIds: [seat(2).getAttribute("data-seat-id") ?? ""],
      serverTime: new Date().toISOString(),
    });
    await client.invalidateQueries(); // the next poll
    // Said by a region that was already there, which a screen reader is listening to.
    await waitFor(() => {
      const saying = regions.filter((region) => region.textContent.startsWith("Someone else just took a seat"));
      expect(saying).toHaveLength(1);
      expect(saying[0]).toHaveTextContent(/you chose\. .+ is gone; your other seats are still chosen\.$/);
    });
    expect(screen.getAllByRole("status")).toEqual(regions);
  });
});

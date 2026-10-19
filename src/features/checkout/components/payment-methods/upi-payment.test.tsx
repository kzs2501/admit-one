import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderDto } from "@/contract/dto";
import { apiClient, NetworkError } from "@/lib/api-client";
import { orderWithPayment, UPI_INTENT, upiPaymentDto } from "@/features/checkout/testing/fixtures";
import { UpiPayment } from "./upi-payment";

function renderUpi(order: OrderDto) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <UpiPayment holdId="hold_1" order={order} goBack={null} onExpired={vi.fn()} clockOffsetMs={0} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("UpiPayment", () => {
  it("asks for a request — and after a lost answer, asks again with the same idempotency key", async () => {
    const createPayment = vi
      .spyOn(apiClient, "createPayment")
      .mockRejectedValueOnce(new NetworkError("Couldn’t reach the server."))
      .mockRejectedValueOnce(new NetworkError("Couldn’t reach the server."));
    const user = renderUpi(orderWithPayment(null));

    await user.click(screen.getByRole("button", { name: "Pay ₹303.73 with UPI" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was requested twice");
    await user.click(screen.getByRole("button", { name: "Pay ₹303.73 with UPI" }));

    expect(createPayment).toHaveBeenCalledTimes(2);
    const [first, second] = createPayment.mock.calls;
    expect(first?.slice(0, 2)).toEqual(["ord_1", { method: "upi" }]);
    expect(second?.[2]).toBe(first?.[2]);
  });

  it("shows a waiting request: focus on it, a code to scan, the app to open, and the time left", () => {
    vi.useFakeTimers({ now: 0, toFake: ["Date", "setTimeout", "clearTimeout"] });
    renderUpi(orderWithPayment(upiPaymentDto()));

    expect(screen.getByRole("heading", { name: "Approve ₹303.73 in your UPI app" })).toHaveFocus();
    expect(screen.getByRole("img", { name: "QR code to pay ₹303.73 to admit-one with UPI" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open your UPI app" })).toHaveAttribute("href", UPI_INTENT);
    expect(screen.getByText("5:00")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(61_010); // the clock ticks just after each whole second
    });
    expect(screen.getByText("3:59")).toBeInTheDocument();
  });

  it("cancels a waiting request to pay another way", async () => {
    const cancelPayment = vi.spyOn(apiClient, "cancelPayment").mockReturnValue(new Promise(() => undefined));
    const user = renderUpi(orderWithPayment(upiPaymentDto()));
    await user.click(screen.getByRole("button", { name: "Cancel and pay another way" }));
    expect(cancelPayment).toHaveBeenCalledWith("pay_1");
  });

  it("says a request was declined, where focus is, and that nothing was taken", () => {
    const declined = upiPaymentDto({ status: "failed", failureCode: "upi_declined", nextAction: null });
    renderUpi(orderWithPayment(declined, "failed"));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("UPI payment declined");
    expect(alert).toHaveTextContent("No money was taken. Your tickets are still held.");
    expect(alert.parentElement).toHaveFocus();
  });
});

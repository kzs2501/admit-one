import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderDto } from "@/contract/dto";
import { apiClient } from "@/lib/api-client";
import type { RazorpayCheckoutOptions } from "@/lib/razorpay-checkout";
import { orderWithPayment, razorpayPaymentDto } from "@/features/checkout/testing/fixtures";
import { RazorpayPayment } from "./razorpay-payment";

function renderRazorpay(order: OrderDto) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const ui = (current: OrderDto) => (
    <QueryClientProvider client={queryClient}>
      <RazorpayPayment holdId="hold_1" order={current} goBack={null} onExpired={vi.fn()} />
    </QueryClientProvider>
  );
  const { rerender } = render(ui(order));
  return Object.assign(userEvent.setup(), { update: (next: OrderDto) => rerender(ui(next)) });
}

/** Razorpay's Checkout, stood in for: the options it was opened with, and whether it was. */
let opened: RazorpayCheckoutOptions[] = [];
beforeEach(() => {
  opened = [];
  window.Razorpay = class {
    constructor(private readonly options: RazorpayCheckoutOptions) {}
    open() {
      opened.push(this.options);
    }
  };
});
afterEach(() => {
  delete window.Razorpay;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const waiting = orderWithPayment(razorpayPaymentDto());
const result = {
  razorpay_order_id: "order_fixture",
  razorpay_payment_id: "pay_rzp_1",
  razorpay_signature: "f".repeat(64),
};

describe("RazorpayPayment", () => {
  it("asks for a checkout, then opens Razorpay's over the page, for the order and until the hold ends", async () => {
    vi.useFakeTimers({ now: 60_000, toFake: ["Date"] });
    const createPayment = vi
      .spyOn(apiClient, "createPayment")
      .mockResolvedValue({ payment: razorpayPaymentDto(), order: waiting });
    const user = renderRazorpay(orderWithPayment(null));

    await user.click(screen.getByRole("button", { name: "Pay ₹303.73 with Razorpay" }));
    expect(createPayment.mock.calls[0]?.slice(0, 2)).toEqual(["ord_1", { method: "razorpay" }]);
    await waitFor(() => {
      expect(opened).toHaveLength(1);
    });
    expect(opened[0]).toMatchObject({
      key: "rzp_test_fixture",
      order_id: "order_fixture",
      amount: 30_373,
      currency: "INR",
      timeout: 4 * 60,
    });
  });

  it("passes Checkout's signed result to the server, and doesn't cancel once paid", async () => {
    const confirm = vi.spyOn(apiClient, "confirmRazorpayPayment").mockReturnValue(new Promise(() => undefined));
    const cancel = vi.spyOn(apiClient, "cancelPayment");
    const user = renderRazorpay(waiting);
    await user.click(screen.getByRole("button", { name: "Return to Razorpay’s checkout" }));
    await waitFor(() => {
      expect(opened).toHaveLength(1);
    });

    opened[0]?.handler(result);
    opened[0]?.modal.ondismiss();
    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith("pay_1", {
        razorpayOrderId: "order_fixture",
        razorpayPaymentId: "pay_rzp_1",
        razorpaySignature: "f".repeat(64),
      });
    });
    expect(cancel).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "Confirming…" })).toBeInTheDocument();
  });

  it("cancels the payment when the buyer closes Checkout without paying", async () => {
    const cancel = vi.spyOn(apiClient, "cancelPayment").mockReturnValue(new Promise(() => undefined));
    const user = renderRazorpay(waiting);
    await user.click(screen.getByRole("button", { name: "Return to Razorpay’s checkout" }));
    await waitFor(() => {
      expect(opened).toHaveLength(1);
    });
    opened[0]?.modal.ondismiss();
    await waitFor(() => {
      expect(cancel).toHaveBeenCalledWith("pay_1");
    });
  });

  it("cancels a waiting checkout, to start again", async () => {
    const cancel = vi.spyOn(apiClient, "cancelPayment").mockReturnValue(new Promise(() => undefined));
    const user = renderRazorpay(waiting);
    await user.click(screen.getByRole("button", { name: "Cancel and start again" }));
    expect(cancel).toHaveBeenCalledWith("pay_1");
  });

  it("says so when Razorpay's checkout can't load, and can try again", async () => {
    delete window.Razorpay;
    const append = vi.spyOn(document.head, "append").mockImplementation((node) => {
      if (node instanceof HTMLScriptElement) node.dispatchEvent(new Event("error"));
    });
    const user = renderRazorpay(waiting);
    await user.click(screen.getByRole("button", { name: "Return to Razorpay’s checkout" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Razorpay’s checkout didn’t load");
    await user.click(screen.getByRole("button", { name: "Return to Razorpay’s checkout" }));
    expect(append).toHaveBeenCalledTimes(2);
  });

  it("says a checkout closed unpaid, and what test mode takes", () => {
    const closed = razorpayPaymentDto({ status: "failed", failureCode: "checkout_expired", nextAction: null });
    renderRazorpay(orderWithPayment(closed, "failed"));
    expect(screen.getByRole("alert")).toHaveTextContent("The checkout closed");
    expect(screen.getByRole("alert")).toHaveTextContent("No money was taken. Your tickets are still held.");
    const testMode = screen.getByRole("region", { name: "Razorpay’s test mode" });
    expect(testMode).toHaveTextContent("4100 2800 0000 1007");
    expect(testMode).toHaveTextContent("then Success, or Failure, on the test bank’s page");
  });
});

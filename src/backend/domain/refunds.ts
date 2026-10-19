/**
 * Refunds, as organisers ask for them. A refund is a request to the payment provider,
 * settled by its webhook — like a payment (ADR 004) — so it's `pending` until the
 * money has gone back. Only whole orders are refunded, and only fulfilled ones; when
 * the refund goes through, the order's tickets are void and back on sale.
 *
 * A refund of a taxed sale also needs a GST credit note (CGST Act §34). This sandbox
 * issues no invoices, so it issues no credit notes either.
 */
import { getEvent } from "@/core/catalog";
import { can, type Account } from "@/core/organisations";
import type { RefundReason } from "@/core/statuses";
import type { BackendContext } from "./context";
import { fail, ok, type Result } from "./errors";
import { findOrganiserOrder, type OrganiserOrder } from "./reporting";
import type { RefundRecord } from "./state";
import { enqueueRefundSucceeded } from "./webhooks";

export function requestRefund(
  context: BackendContext,
  account: Account,
  orderId: string,
  reason: RefundReason,
): Result<{ refund: RefundRecord; order: OrganiserOrder }> {
  const found = findOrganiserOrder(context, account, orderId);
  if (!found.ok) return found;
  const order = found.value;
  if (!can(account, "orders:refund", getEvent(order.eventSlug))) {
    return fail({ code: "forbidden", detail: "Your role doesn’t allow refunds." });
  }
  const existing = Object.values(context.state.refunds).find((refund) => refund.orderId === orderId);
  if (existing) {
    return fail({
      code: "invalid_state",
      detail:
        existing.status === "pending"
          ? "A refund for this order is already on its way."
          : "This order has already been refunded.",
    });
  }
  if (order.status !== "fulfilled") {
    return fail({ code: "invalid_state", detail: "Only fulfilled orders can be refunded." });
  }
  if (context.chaos().shouldFailRefunds) {
    return fail({
      code: "refund_failed",
      detail: "The payment provider couldn’t start the refund. Nothing was refunded — try again later.",
    });
  }

  const refund: RefundRecord = {
    id: context.deps.newId("re"),
    orderId,
    eventSlug: order.eventSlug,
    amountMinor: order.amounts.totalMinor,
    currency: order.amounts.currency,
    reason,
    status: "pending",
    requestedBy: account.id,
    createdAtMs: context.deps.now(),
    settledAtMs: null,
  };
  context.state.refunds[refund.id] = refund;
  enqueueRefundSucceeded(context, refund);
  context.log("payment", `${account.name} asked for a refund of ${orderId} (${refund.id}); pending.`);
  const updated = findOrganiserOrder(context, account, orderId);
  return updated.ok ? ok({ refund, order: updated.value }) : updated;
}

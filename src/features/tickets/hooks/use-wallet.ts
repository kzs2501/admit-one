import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { listTickets, markRefunded, type WalletTicket } from "@/lib/wallet";

export type WalletState =
  | { kind: "loading" }
  /** This browser won't keep anything (a private window, storage turned off). */
  | { kind: "unavailable" }
  | { kind: "ready"; tickets: WalletTicket[] };

/**
 * Which of these tickets' orders have been refunded since they were saved: asked of the
 * server while online. An order it can't answer for (offline, or another tab's sandbox)
 * is left as it was.
 */
async function refundedOrders(tickets: readonly WalletTicket[]): Promise<string[]> {
  if (!navigator.onLine) return [];
  const orderIds = [...new Set(tickets.filter((ticket) => !ticket.isRefunded).map((ticket) => ticket.orderId))];
  const answers = await Promise.allSettled(orderIds.map((orderId) => apiClient.getOrder(orderId)));
  return answers.flatMap((answer) =>
    answer.status === "fulfilled" && answer.value.status === "refunded" ? [answer.value.id] : [],
  );
}

/** The tickets on this device, read once the page is in the browser; then any refunds marked. */
export function useWallet(): WalletState {
  const [state, setState] = useState<WalletState>({ kind: "loading" });
  useEffect(() => {
    let isCurrent = true;
    // A call, not the variable: it has to be read again after each await.
    const stillCurrent = () => isCurrent;
    void (async () => {
      const tickets = await listTickets();
      if (!stillCurrent()) return;
      setState(tickets ? { kind: "ready", tickets } : { kind: "unavailable" });
      if (!tickets?.length) return;
      const refunded = await refundedOrders(tickets);
      if (!refunded.length) return;
      for (const orderId of refunded) await markRefunded(orderId);
      const updated = await listTickets();
      if (stillCurrent() && updated) setState({ kind: "ready", tickets: updated });
    })();
    return () => {
      isCurrent = false;
    };
  }, []);
  return state;
}

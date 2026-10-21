import { useEffect, useState } from "react";
import { listTickets, type WalletTicket } from "@/lib/wallet";

export type WalletState =
  | { kind: "loading" }
  /** This browser won't keep anything (a private window, storage turned off). */
  | { kind: "unavailable" }
  | { kind: "ready"; tickets: WalletTicket[] };

/** The tickets on this device, read once the page is in the browser. */
export function useWallet(): WalletState {
  const [state, setState] = useState<WalletState>({ kind: "loading" });
  useEffect(() => {
    let isCurrent = true;
    void listTickets().then((tickets) => {
      if (isCurrent) setState(tickets ? { kind: "ready", tickets } : { kind: "unavailable" });
    });
    return () => {
      isCurrent = false;
    };
  }, []);
  return state;
}

import type { Metadata } from "next";
import { WalletPage } from "@/features/tickets/components/wallet-page";

export const metadata: Metadata = { title: "Your tickets" };

export default function TicketsPage() {
  return <WalletPage />;
}

import type { Metadata } from "next";
import { ScannerPage } from "@/features/scanner/components/scanner-page";

// For door staff, not for search results.
export const metadata: Metadata = { title: "Door scanner", robots: { index: false, follow: false } };

export default function ScanPage() {
  return <ScannerPage />;
}

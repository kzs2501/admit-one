import { Suspense } from "react";
import type { Metadata } from "next";
import { OrdersPage } from "@/features/organiser/components/orders-page";

export const metadata: Metadata = { title: "Orders" };

// The filters are in the URL, which isn't known until the page is in the browser.
export default function OrganiserOrdersPage() {
  return (
    <Suspense>
      <OrdersPage />
    </Suspense>
  );
}

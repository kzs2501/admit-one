import type { Metadata } from "next";
import { OrderDetail } from "@/features/organiser/components/order-detail";

export const metadata: Metadata = { title: "Order" };

export default async function OrganiserOrderPage({ params }: PageProps<"/organiser/orders/[orderId]">) {
  return <OrderDetail orderId={(await params).orderId} />;
}

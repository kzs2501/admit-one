import type { Metadata } from "next";
import { OrderStatusView } from "@/features/orders/components/order-status-view";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default async function OrderPage({ params }: PageProps<"/orders/[orderId]">) {
  return <OrderStatusView orderId={(await params).orderId} />;
}

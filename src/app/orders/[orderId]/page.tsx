import type { Metadata } from "next";
import { OrderStatus } from "@/components/order-status";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default async function OrderPage({ params }: PageProps<"/orders/[orderId]">) {
  return <OrderStatus orderId={(await params).orderId} />;
}

import { CheckoutFlow } from "@/checkout/checkout-flow";

/**
 * The checkout lives in the layout, not the page: a layout persists while the
 * `[step]` segment changes, so moving between steps keeps the flow mounted — its
 * state, its focus handling, and its query — instead of remounting it per step.
 */
export default async function CheckoutLayout({ children, params }: LayoutProps<"/checkout/[holdId]">) {
  const { holdId } = await params;
  return (
    <>
      {children}
      <CheckoutFlow holdId={holdId} />
    </>
  );
}

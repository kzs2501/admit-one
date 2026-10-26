/**
 * Razorpay's Checkout: its script, loaded the first time a buyer pays, never before (it's
 * a third party's code, and the payment page is the only page that allows it), and the
 * little of its API the payment step uses. Checkout is Razorpay's page, in a frame of its
 * own: the card details typed there go to Razorpay, and never pass through this app.
 */
export const RAZORPAY_CHECKOUT_URL =
  process.env["NEXT_PUBLIC_RAZORPAY_CHECKOUT_URL"] ?? "https://checkout.razorpay.com/v1/checkout.js";

/** What Checkout hands back once the buyer has paid, signed by Razorpay. */
export interface RazorpayCheckoutResult {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export interface RazorpayCheckoutOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  /** Seconds until Checkout closes itself. */
  timeout: number;
  prefill: { name: string; email: string };
  theme: { color: string };
  handler: (result: RazorpayCheckoutResult) => void;
  modal: { ondismiss: () => void };
}

export interface RazorpayCheckout {
  open: () => void;
}

export type RazorpayCheckoutConstructor = new (options: RazorpayCheckoutOptions) => RazorpayCheckout;

declare global {
  interface Window {
    Razorpay?: RazorpayCheckoutConstructor;
  }
}

let loading: Promise<RazorpayCheckoutConstructor> | null = null;

/** Checkout's constructor, loading its script the first time. A load that fails can be tried again. */
export function loadRazorpayCheckout(src: string = RAZORPAY_CHECKOUT_URL): Promise<RazorpayCheckoutConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  loading ??= new Promise<RazorpayCheckoutConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error("Razorpay’s checkout loaded, but didn’t start."));
    });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("Razorpay’s checkout couldn’t load."));
    });
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

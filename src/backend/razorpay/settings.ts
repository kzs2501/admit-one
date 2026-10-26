/** What the server needs to take payment through Razorpay's test mode (`server-config.ts` reads it). */
export interface RazorpaySettings {
  /** The public half of the key pair (`rzp_test_…`): the browser's Checkout is opened with it. */
  keyId: string;
  /** The secret half: it authenticates API calls, and signs what Checkout hands back. */
  keySecret: string;
  /** Signs Razorpay's webhooks, set where the webhook is added in Razorpay's dashboard. */
  webhookSecret: string;
  /** Razorpay's API, unless tests point it at a fake. */
  apiUrl: string;
}

export const RAZORPAY_API_URL = "https://api.razorpay.com/v1";

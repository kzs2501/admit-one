/**
 * Razorpay, stood in for, for the end-to-end tests (`playwright.razorpay.config.ts`):
 * its API, which is the in-memory fake the server tests use, over HTTP; and a stand-in
 * for Checkout's script, which draws a small dialog with a button for each thing a
 * buyer can do on Razorpay's page. Nothing here reaches Razorpay.
 */
import { createServer, type IncomingMessage } from "node:http";
import { createFakeRazorpay } from "../../src/backend/razorpay/testing/fake-razorpay";

const PORT = Number(process.env["FAKE_RAZORPAY_PORT"] ?? 4191);
const APP_URL = process.env["APP_URL"] ?? "http://localhost:4183";
const razorpay = createFakeRazorpay();

/**
 * Checkout's stand-in. "Pay" is what usually happens: Razorpay takes the money and
 * hands Checkout's signed result to the page. "Pay, then lose the page" takes the money
 * and sends only the webhook, as when a tab closes at the wrong moment. "Decline" is a
 * failed attempt, after which Checkout stays open. "Close" is the buyer closing it.
 */
const CHECKOUT_SCRIPT = `(() => {
  const fake = new URL(document.currentScript.src).origin;
  window.Razorpay = class {
    constructor(options) { this.options = options; }
    open() {
      const options = this.options;
      const dialog = document.createElement("dialog");
      dialog.setAttribute("aria-label", "Razorpay Checkout (test stand-in)");
      const heading = document.createElement("p");
      heading.textContent = "Pay " + options.amount + " " + options.currency + " to " + options.name;
      dialog.append(heading);
      const pay = async (outcome, { returns, shouldSendWebhook }) => {
        const response = await fetch(fake + "/test/pay", {
          method: "POST",
          body: JSON.stringify({ orderId: options.order_id, outcome, shouldSendWebhook }),
        });
        const { result } = await response.json();
        if (outcome !== "captured") return;
        dialog.remove();
        if (returns) options.handler(result);
      };
      const button = (label, onClick) => {
        const element = document.createElement("button");
        element.type = "button";
        element.textContent = label;
        element.addEventListener("click", onClick);
        dialog.append(element);
      };
      button("Pay", () => pay("captured", { returns: true, shouldSendWebhook: false }));
      button("Pay, then lose the page", () => pay("captured", { returns: false, shouldSendWebhook: true }));
      button("Decline", () => pay("failed", { returns: false, shouldSendWebhook: true }));
      button("Close", () => { dialog.remove(); options.modal.ondismiss(); });
      document.body.append(dialog);
      dialog.showModal();
    }
  };
})();`;

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function sendWebhook(event: "payment.captured" | "payment.failed", paymentId: string) {
  const { body, headers } = razorpay.webhook(event, paymentId);
  const response = await fetch(`${APP_URL}/api/webhooks/razorpay`, { method: "POST", headers, body });
  if (!response.ok) console.error(`[fake-razorpay] The app answered ${String(response.status)} to ${event}.`);
}

createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? "/", `http://localhost:${String(PORT)}`);
    if (request.method === "GET" && url.pathname === "/v1/checkout.js") {
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      response.end(CHECKOUT_SCRIPT);
      return;
    }
    // What the stand-in does when the buyer presses a button: a plain-text body, so the
    // browser sends it without asking first (no CORS preflight).
    if (request.method === "POST" && url.pathname === "/test/pay") {
      const { orderId, outcome, shouldSendWebhook } = JSON.parse(await bodyOf(request)) as {
        orderId: string;
        outcome: "captured" | "failed";
        shouldSendWebhook: boolean;
      };
      const payment = razorpay.pay(orderId, { status: outcome });
      if (shouldSendWebhook)
        await sendWebhook(outcome === "captured" ? "payment.captured" : "payment.failed", payment.id);
      response.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": APP_URL });
      response.end(JSON.stringify({ result: razorpay.checkoutResult(payment) }));
      return;
    }
    if (url.pathname === "/health") {
      response.writeHead(200).end("ok");
      return;
    }
    // Everything else is Razorpay's API, answered by the fake.
    const body = request.method === "GET" ? undefined : await bodyOf(request);
    const reply = await razorpay.fetch(url.toString(), {
      method: request.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries(request.headers).flatMap(([name, value]) => (typeof value === "string" ? [[name, value]] : [])),
      ),
      ...(body ? { body } : {}),
    });
    response.writeHead(reply.status, { "Content-Type": "application/json" });
    response.end(await reply.text());
  })().catch((error: unknown) => {
    console.error("[fake-razorpay]", error);
    response.writeHead(500).end();
  });
}).listen(PORT, () => {
  console.log(`[fake-razorpay] Listening on ${String(PORT)}`);
});

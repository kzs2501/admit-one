import { after, type NextRequest } from "next/server";
import { isServerMode } from "@/lib/backend-mode";

/**
 * The API, in server mode: every `/api/*` request, answered by the same handlers the
 * sandbox runs in the browser, over Postgres. In the default build the sandbox's
 * service worker answers these before they leave the page, so this only says so.
 */
export const dynamic = "force-dynamic";

/** How long after a payment the simulated provider's webhook is due, plus a moment. */
const WEBHOOK_DUE_AFTER_MS = 1_600;

async function handle(request: NextRequest): Promise<Response> {
  if (!isServerMode) {
    return Response.json(
      { title: "Not found", status: 404, detail: "This build's API runs in the browser." },
      { status: 404, headers: { "Content-Type": "application/problem+json" } },
    );
  }
  // Loaded only in server mode, so the sandbox's build never touches a database.
  const { getServerApi } = await import("@/backend/server");
  const api = await getServerApi();
  const response = await api.handle(request);
  if (request.method === "POST" && request.nextUrl.pathname.endsWith("/payments") && response.ok) {
    // After the answer has gone, wait for the webhook to fall due and send it, so the
    // order page usually finds the order already fulfilled.
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, WEBHOOK_DUE_AFTER_MS));
      await api.deliverDueWebhooks();
    });
  }
  return response;
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };

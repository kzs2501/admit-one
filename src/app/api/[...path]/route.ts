import { after, type NextRequest } from "next/server";
import { PROBLEM_CATALOG, PROBLEM_CONTENT_TYPE } from "@/contract/problems";
import { isServerMode } from "@/lib/backend-mode";

/**
 * The API, in server mode: every `/api/*` request, answered by the same handlers the
 * sandbox runs in the browser, over Postgres. In the default build the sandbox's
 * service worker answers these before they leave the page, so this only says so.
 */
export const dynamic = "force-dynamic";

async function handle(request: NextRequest): Promise<Response> {
  if (!isServerMode) {
    // The sandbox's API runs in the browser's service worker. A request gets here when
    // that worker isn't answering it (the browser stopped it, and it restarted without
    // knowing the page): said as a problem the page recovers from, by starting it again.
    const { status, title } = PROBLEM_CATALOG.backend_restarting;
    return Response.json(
      {
        type: new URL("/problems/backend-restarting", request.url).href,
        title,
        status,
        detail: "The sandbox’s backend wasn’t answering in this browser. The page starts it again.",
        instance: request.url,
        code: "backend_restarting",
      },
      { status, headers: { "Content-Type": PROBLEM_CONTENT_TYPE, "Cache-Control": "no-store" } },
    );
  }
  // Loaded only in server mode, so the sandbox's build never touches a database.
  const { getServerApi } = await import("@/backend/server");
  let api: Awaited<ReturnType<typeof getServerApi>>;
  try {
    api = await getServerApi();
  } catch (error) {
    // Misconfigured, or the database is out of reach: logged, and said as a problem.
    console.error("[server] Couldn't start the server API", error);
    return Response.json(
      { title: "Busy for a moment", status: 503, detail: "The server is starting up or unwell. Try again soon." },
      { status: 503, headers: { "Content-Type": "application/problem+json", "Retry-After": "5" } },
    );
  }
  const response = await api.handle(request);
  const followUp = api.followUp(request, response);
  if (followUp) after(followUp);
  return response;
}

export { handle as DELETE, handle as GET, handle as PATCH, handle as POST, handle as PUT };

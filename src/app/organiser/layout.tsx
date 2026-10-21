import { Notice } from "@/components/ui/notice";
import { isServerMode } from "@/lib/backend-mode";

/** The organisers' dashboard runs on the browser sandbox; a server-mode build says so instead. */
export default function OrganiserLayout({ children }: LayoutProps<"/organiser">) {
  if (!isServerMode) return children;
  return (
    <div className="mx-auto max-w-lg px-5 py-16 sm:px-8">
      <Notice tone="info" title="The organisers’ dashboard is in the sandbox demo">
        This build serves the buyer’s checkout from a server, on Postgres. The dashboard, its live sales and refunds run
        in the browser sandbox, the public demo.
      </Notice>
    </div>
  );
}

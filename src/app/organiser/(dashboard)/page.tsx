import { Suspense } from "react";
import type { Metadata } from "next";
import { Overview } from "@/features/organiser/components/overview";

export const metadata: Metadata = { title: "Overview" };

// The overview reads its event from the URL, which isn't known until the page is in the browser.
export default function OrganiserOverviewPage() {
  return (
    <Suspense>
      <Overview />
    </Suspense>
  );
}

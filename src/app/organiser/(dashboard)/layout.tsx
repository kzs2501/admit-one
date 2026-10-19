import type { Metadata } from "next";
import { OrganiserShell } from "@/features/organiser/components/organiser-shell";

export const metadata: Metadata = {
  title: { default: "Organisers", template: "%s · Organisers · admit-one" },
  robots: { index: false },
};

/** Everything behind sign-in: one shell, one live stream. */
export default function OrganiserDashboardLayout({ children }: LayoutProps<"/organiser">) {
  return <OrganiserShell>{children}</OrganiserShell>;
}

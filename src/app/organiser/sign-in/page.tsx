import type { Metadata } from "next";
import { SignIn } from "@/features/organiser/components/sign-in";

export const metadata: Metadata = { title: "Organisers: sign in", robots: { index: false } };

export default function OrganiserSignInPage() {
  return <SignIn />;
}

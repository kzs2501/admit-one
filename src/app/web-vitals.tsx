"use client";

import { useReportWebVitals } from "next/web-vitals";
import { reportWebVital } from "@/lib/monitoring";

/** Reports Core Web Vitals. Its own client component, so the root layout stays a server one. */
export function WebVitals() {
  useReportWebVitals(reportWebVital);
  return null;
}

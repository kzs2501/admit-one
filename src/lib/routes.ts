/**
 * Every page's URL, in one place. With `typedRoutes` on, Next checks literal hrefs at
 * build time; dynamic ones are built here, so their casts live in exactly one file.
 */
import type { Route } from "next";
import { problemPathFor, type ProblemCode } from "@/contract/problems";

export const routes = {
  home: (): Route => "/",
  event: (slug: string) => `/events/${encodeURIComponent(slug)}` as Route,
  queue: (slug: string) => `/events/${encodeURIComponent(slug)}/queue` as Route,
  checkoutStep: (holdId: string, step: string) =>
    `/checkout/${encodeURIComponent(holdId)}/${encodeURIComponent(step)}` as Route,
  order: (orderId: string) => `/orders/${encodeURIComponent(orderId)}` as Route,
  problems: (): Route => "/problems",
  problem: (code: ProblemCode) => problemPathFor(code) as Route,
};

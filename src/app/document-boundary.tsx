"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Pages served with security headers of their own (`next.config.ts`): the door scanner
 * may use the camera and compile WebAssembly, and no other page may. Headers belong to
 * a document, and a client-side navigation keeps the document it started in, so moving
 * between one of these pages and the rest of the site has to load the page in full.
 */
const OWN_DOCUMENT_PATHS = ["/scan"];

const hasOwnDocument = (pathname: string) => OWN_DOCUMENT_PATHS.includes(pathname);

/** The path this document was loaded at: where its headers came from. */
function loadedPath() {
  const [navigation] = performance.getEntriesByType("navigation");
  return new URL(navigation?.name ?? location.href).pathname;
}

/**
 * Reloads the page when a client-side navigation crosses into or out of a page with its
 * own document. Links there are plain anchors, so this is the safety net (back and
 * forward, a link missed).
 */
export function DocumentBoundary() {
  const pathname = usePathname();
  useEffect(() => {
    if (hasOwnDocument(pathname) !== hasOwnDocument(loadedPath())) location.reload();
  }, [pathname]);
  return null;
}

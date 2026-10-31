import type { MetadataRoute } from "next";

/** Installable: it opens on your tickets, which work offline. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dress Circle",
    short_name: "Dress Circle",
    description: "Your tickets, even offline. Dress Circle is a demo box office, so nothing is charged.",
    start_url: "/tickets",
    scope: "/",
    display: "standalone",
    background_color: "#fbf8f3",
    theme_color: "#fbf8f3",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

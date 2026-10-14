import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Check every literal href against the real routes at build time.
  typedRoutes: true,
};

export default nextConfig;

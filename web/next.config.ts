import type { NextConfig } from "next";

// The website is built into plain files (the "out" folder) that GitHub Pages serves, like the old index.html.
// LOCKEDIN_BASE_PATH is only for testing a build inside a sub-folder (for example /web/out on the local test server).
const nextConfig: NextConfig = {
  output: "export",
  basePath: process.env.LOCKEDIN_BASE_PATH || "",
  images: { unoptimized: true },
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;

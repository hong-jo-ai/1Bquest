import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbopackFileSystemCacheForBuild: true,
  },
  // pdfkit reads AFM metrics + we readFileSync fonts via process.cwd() — file tracing
  // doesn't follow these, so the serverless bundle 500s with ENOENT Helvetica.afm.
  outputFileTracingIncludes: {
    "/api/cron/bysoy-daily-report": [
      "./node_modules/pdfkit/js/data/**/*",
      "./lib/fonts/**/*",
    ],
  },
};

export default nextConfig;

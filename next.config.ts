import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    turbopackFileSystemCacheForBuild: true,
  },
  // pdfkit dynamically requires AFM metric files — bundlers can't trace them.
  // serverExternalPackages 로 번들에서 제외하면 node_modules 통째로 deploy 됨.
  serverExternalPackages: ["pdfkit"],
  // 폰트는 readFileSync(process.cwd() + ...) 라 file tracing 미적용 → 명시 포함.
  outputFileTracingIncludes: {
    "/api/cron/bysoy-daily-report": ["./lib/fonts/**/*"],
  },
};

export default nextConfig;

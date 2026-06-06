import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MORI — 운영 비서",
    short_name: "MORI",
    description: "해리엇/폴바이스 1인 운영 비서",
    start_url: "/mori",
    scope: "/",
    display: "standalone",
    background_color: "#0d1320",
    theme_color: "#0d1320",
    icons: [
      {
        src: "/mori-icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/mori-icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/mori-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

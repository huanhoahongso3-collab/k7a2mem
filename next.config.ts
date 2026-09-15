import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The photo gallery is the existing plain HTML/CSS/JS app, served as-is
  // from public/kyyeu/. Rewriting "/kyyeu" to its index.html avoids
  // reimplementing that (already-working) markup as JSX.
  async rewrites() {
    return [
      { source: "/kyyeu", destination: "/kyyeu/index.html" },
      // Catch-all so folder navigation (/onedrive/k7a2/sub) is a real,
      // bookmarkable URL — it's a client-rendered SPA, so every path
      // under /onedrive serves the same shell and app.js reads the
      // folder path back out of location.pathname.
      { source: "/onedrive", destination: "/onedrive/index.html" },
      { source: "/onedrive/:path*", destination: "/onedrive/index.html" },
    ];
  },
  async headers() {
    return [
      {
        source: "/kyyeu/(app.js|styles.css|photos-data.js)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, must-revalidate" },
        ],
      },
      {
        source: "/kyyeu/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
      {
        source: "/onedrive/(app.js|styles.css)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The whole gallery UI is the existing plain HTML/CSS/JS app, served
  // as-is from public/. Rewriting "/" to it avoids reimplementing that
  // (already-working) markup as JSX — Next.js here exists only to host
  // the API route below and give Vercel a proper serverless deployment.
  async rewrites() {
    return [{ source: "/", destination: "/index.html" }];
  },
  async headers() {
    return [
      {
        source: "/(app.js|styles.css|photos-data.js)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default nextConfig;

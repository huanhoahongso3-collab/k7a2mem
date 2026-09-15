import { NextRequest, NextResponse } from "next/server";

// Proxies a Google Photos image through this route so Vercel's Edge
// Network can cache the response globally — once any visitor loads a
// given photo, every subsequent request for it (from anyone, anywhere)
// is served straight from the edge cache instead of hitting Google's CDN
// again. The `=w400`/`=w1600` size suffix is baked into the requested URL
// by the client, so each distinct size is cached as its own entry.
export const runtime = "edge";

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("u");
  if (!target || !target.startsWith("https://lh3.googleusercontent.com/")) {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  const upstream = await fetch(target, {
    // Vercel's Data Cache / Edge Network — these URLs are long-lived
    // (per the source library's own guarantee), so cache aggressively.
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") || "image/jpeg";

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "CDN-Cache-Control": "public, max-age=31536000, immutable",
      "Vercel-CDN-Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

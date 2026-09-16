import { NextRequest, NextResponse } from "next/server";
import { fetchFileResponse, decodeItemId } from "@/lib/onedrive";

// The browser has no session cookie for SharePoint, so — unlike the
// Google Photos proxy — this can't just redirect the client to the
// upstream URL; it has to actually stream the authenticated response
// through this server. Range requests are forwarded too, since videos
// need it both to seek in the full-screen viewer and to let the browser
// grab just enough of the file (via preload="metadata") to draw a
// client-side thumbnail without downloading the whole video.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const download = req.nextUrl.searchParams.get("download") === "1";
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  try {
    const range = req.headers.get("range");
    const upstream = await fetchFileResponse(id, range);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
    }

    const headers: Record<string, string> = {
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
      "Accept-Ranges": "bytes",
    };
    const len = upstream.headers.get("content-length");
    if (len) headers["Content-Length"] = len;
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) headers["Content-Range"] = contentRange;
    if (download) {
      const fileRef = decodeItemId(id);
      const name = fileRef.split("/").pop() || "file";
      headers["Content-Disposition"] = `attachment; filename="${name.replace(/"/g, "")}"`;
    }

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

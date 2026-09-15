import { NextRequest, NextResponse } from "next/server";
import { listFolder } from "@/lib/onedrive";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") || "";

  try {
    const items = await listFolder(path);
    // Folders first, then alphabetical — matches how people expect a file
    // browser to sort rather than whatever order SharePoint returns.
    items.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    return NextResponse.json({ path, items });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// Talks to a single, publicly (anonymously) shared OneDrive/SharePoint
// folder using the same unauthenticated flow a browser goes through when
// you open the share link: a plain GET to the share URL gets redirected
// to the resolved folder and, along the way, SharePoint hands back an
// anonymous "tenantanon" auth cookie — no Microsoft Graph app
// registration, no OAuth, nothing to configure beyond the share URL
// itself. That cookie is then reused for the classic SharePoint REST API
// (RenderListDataAsStream) to list folders, and for direct file URLs to
// stream content.
//
// Required env var:
//   ONEDRIVE_SHARE_URL - the public sharing link to the root folder

type Session = {
  cookie: string;
  origin: string; // e.g. https://k7a2cbh-my.sharepoint.com
  rootFolder: string; // server-relative path, e.g. /personal/xxx/Documents/K7A2
  libraryPath: string; // the document library itself, e.g. /personal/xxx/Documents
  expiresAt: number;
};

let cachedSession: Session | null = null;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function redeemShareLink(): Promise<Session> {
  const shareUrl = process.env.ONEDRIVE_SHARE_URL;
  if (!shareUrl) {
    throw new Error("OneDrive is not configured yet — missing ONEDRIVE_SHARE_URL");
  }

  // fetch()'s automatic redirect following does NOT carry Set-Cookie
  // between hops the way a browser (or curl's cookie jar) does — only the
  // final response's own headers are exposed. SharePoint sets the
  // anonymous auth cookie on an intermediate redirect, so we have to walk
  // the chain ourselves, accumulating cookies at every hop.
  const cookieJar = new Map<string, string>();
  let url = shareUrl;
  let res: Response;

  for (let i = 0; i < 10; i++) {
    res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Cookie: [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
      },
      redirect: "manual",
    });

    // getSetCookie() (Node 18.14+/undici) returns each Set-Cookie header
    // separately — iterating res.headers directly merges them into one
    // comma-joined string, which breaks on cookie values that already
    // contain commas (e.g. expiry dates).
    const setCookies =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const value of setCookies) {
      const m = value.match(/^([^=]+)=([^;]*)/);
      if (m) cookieJar.set(m[1], m[2]);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect with no Location header");
      url = new URL(loc, url).toString();
      continue;
    }
    break;
  }

  if (!cookieJar.has("FedAuth")) {
    throw new Error("Share link did not return an anonymous session cookie");
  }

  const finalUrl = new URL(url);
  // The resolved URL looks like:
  //   https://<tenant>-my.sharepoint.com/personal/<user>/_layouts/15/onedrive.aspx?id=<server-relative-path>&...
  const rootFolder = finalUrl.searchParams.get("id");
  if (!rootFolder) {
    throw new Error("Could not determine the shared folder's path");
  }

  const sharedFolder = decodeURIComponent(rootFolder);
  const libraryPath = sharedFolder.split("/").slice(0, -1).join("/"); // .../Documents

  // The OneDrive browser's own "root" can be pinned to a subfolder of the
  // shared folder (e.g. so visitors land in "k7a2_guongmatguongmau"
  // directly instead of seeing every top-level folder in the share).
  const subfolder = process.env.ONEDRIVE_ROOT_SUBFOLDER;
  const effectiveRoot = subfolder ? `${sharedFolder}/${subfolder}` : sharedFolder;

  const cookieHeader = [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const session: Session = {
    cookie: cookieHeader,
    origin: finalUrl.origin,
    rootFolder: effectiveRoot,
    libraryPath,
    expiresAt: Date.now() + 30 * 60 * 1000, // re-redeem every 30 min to be safe
  };
  cachedSession = session;
  return session;
}

async function getSession(): Promise<Session> {
  if (cachedSession && cachedSession.expiresAt > Date.now()) return cachedSession;
  return redeemShareLink();
}

export type DriveItem = {
  id: string; // base64url-encoded server-relative file path
  name: string;
  isFolder: boolean;
  isImage: boolean;
  isVideo: boolean;
  size: number;
};

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif"]);
const VIDEO_EXT = new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v", "3gp"]);

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

export function encodeItemId(serverRelativePath: string): string {
  return Buffer.from(serverRelativePath, "utf-8").toString("base64url");
}

export function decodeItemId(id: string): string {
  return Buffer.from(id, "base64url").toString("utf-8");
}

async function fetchWithSession(session: Session, path: string, init?: RequestInit) {
  const res = await fetch(session.origin + path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "User-Agent": UA,
      Cookie: session.cookie,
    },
  });
  if (res.status === 403 || res.status === 401) {
    // Cookie likely expired early — redeem once more and retry.
    cachedSession = null;
    const fresh = await getSession();
    return fetch(fresh.origin + path, {
      ...init,
      headers: { ...(init?.headers || {}), "User-Agent": UA, Cookie: fresh.cookie },
    });
  }
  return res;
}

export async function listFolder(relativePath: string): Promise<DriveItem[]> {
  const session = await getSession();
  const folderPath = relativePath ? `${session.rootFolder}/${relativePath}` : session.rootFolder;
  const libraryPath = session.libraryPath;
  const personalUser = session.libraryPath.split("/")[2];
  const basePath = `/personal/${personalUser}/_api/web/GetListUsingPath(DecodedUrl=@a1)/RenderListDataAsStream`;

  // RenderListDataAsStream caps at RowLimit (30) items per call and hands
  // back a `NextHref` cursor for the rest — a folder with more than 30
  // files silently lost everything past the first page until this loop
  // was added, which is exactly the "only the top few load" symptom.
  const rows: any[] = [];
  let nextHref: string | null = null;

  for (let page = 0; page < 200; page++) {
    // `NextHref` (e.g. "?Paged=TRUE&...&RootFolder=...") doesn't include
    // the "@a1" OData parameter reference that GetListUsingPath(DecodedUrl=@a1)
    // needs to resolve — appending it as our own query param alongside
    // NextHref's own params is required, or the call 400s.
    const a1 = "@a1=" + encodeURIComponent(`'${libraryPath}'`);
    const url = nextHref
      ? `${basePath}${nextHref}&${a1}`
      : `${basePath}?${a1}&${new URLSearchParams({ RootFolder: folderPath, TryNewExperienceSingle: "TRUE" }).toString()}`;

    const res = await fetchWithSession(session, url, { method: "POST", body: "" });
    if (!res.ok) {
      throw new Error(`Failed to list folder: ${res.status}`);
    }

    const data = (await res.json()) as { Row?: any[]; NextHref?: string };
    rows.push(...(data.Row || []));

    if (!data.NextHref) break;
    nextHref = data.NextHref;
  }

  return rows.map((row) => {
    const isFolder = row.FSObjType === "1";
    const name = row.FileLeafRef as string;
    const ext = extOf(name);
    const fileRef = row.FileRef as string;
    const size = Number(row.File_x0020_Size || row.SMTotalSize || 0);
    return {
      id: encodeItemId(fileRef),
      name,
      isFolder,
      isImage: !isFolder && IMAGE_EXT.has(ext),
      isVideo: !isFolder && VIDEO_EXT.has(ext),
      size,
    };
  });
}

export async function fetchFileResponse(id: string): Promise<Response> {
  const session = await getSession();
  const fileRef = decodeItemId(id);
  return fetchWithSession(session, fileRef);
}

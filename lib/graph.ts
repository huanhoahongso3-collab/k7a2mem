// Microsoft Graph access for a single, publicly-shared OneDrive/SharePoint
// folder, using app-only (client credentials) auth — no per-user sign-in
// flow needed since the target folder is already shared to "everyone".
//
// Required env vars (set these once the Azure app registration is ready):
//   AZURE_TENANT_ID     - Directory (tenant) ID
//   AZURE_CLIENT_ID     - Application (client) ID
//   AZURE_CLIENT_SECRET - client secret value
//   ONEDRIVE_SHARE_URL  - the public sharing link to the root folder
//
// The app registration needs the Application permission `Files.Read.All`
// with admin consent granted (see setup notes given alongside this code).

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAppToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "OneDrive is not configured yet — missing AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET"
    );
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to get Graph token: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

// Microsoft's "encoded sharing URL" format for the /shares endpoint.
// https://learn.microsoft.com/en-us/graph/api/shares-get
function encodeShareUrl(shareUrl: string): string {
  const base64 = Buffer.from(shareUrl, "utf-8").toString("base64");
  const unpadded = base64.replace(/=/g, "").replace(/\//g, "_").replace(/\+/g, "-");
  return "u!" + unpadded;
}

async function graphFetch(path: string, init?: RequestInit) {
  const token = await getAppToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { ...(init?.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Graph request failed: ${res.status} ${await res.text()}`);
  }
  return res;
}

export type DriveItem = {
  id: string;
  name: string;
  isFolder: boolean;
  isImage: boolean;
  isVideo: boolean;
  size: number;
  childCount?: number;
  downloadUrl?: string;
};

function toDriveItem(raw: any): DriveItem {
  const mimeType: string | undefined = raw.file?.mimeType;
  return {
    id: raw.id,
    name: raw.name,
    isFolder: !!raw.folder,
    isImage: !!raw.image || (!!mimeType && mimeType.startsWith("image/")),
    isVideo: !!raw.video || (!!mimeType && mimeType.startsWith("video/")),
    size: raw.size ?? 0,
    childCount: raw.folder?.childCount,
    downloadUrl: raw["@microsoft.graph.downloadUrl"],
  };
}

// Resolves the shared link once to a driveItem (root of the shared
// folder), then walks into `path` (e.g. "k7a2/sub") using that item's own
// drive + item id — the share link only grants access starting from that
// root, so every subsequent call must go through drive/{driveId}/items.
let cachedRoot: { value: any; expiresAt: number } | null = null;

async function getRootShareItem() {
  if (cachedRoot && cachedRoot.expiresAt > Date.now()) return cachedRoot.value;

  const shareUrl = process.env.ONEDRIVE_SHARE_URL;
  if (!shareUrl) {
    throw new Error("OneDrive is not configured yet — missing ONEDRIVE_SHARE_URL");
  }
  const encoded = encodeShareUrl(shareUrl);
  const res = await graphFetch(`/shares/${encoded}/driveItem?$select=id,name,parentReference`);
  const value = await res.json();
  cachedRoot = { value, expiresAt: Date.now() + 10 * 60 * 1000 };
  return value;
}

export async function listFolder(path: string): Promise<DriveItem[]> {
  const root = await getRootShareItem();
  const driveId = root.parentReference.driveId;

  let itemId = root.id;
  if (path) {
    const segments = path.split("/").filter(Boolean);
    // Resolve segment-by-segment so a mistyped/missing folder gives a
    // clear "not found" instead of Graph's own path-escaping quirks.
    let currentId = root.id;
    for (const seg of segments) {
      const res = await graphFetch(
        `/drives/${driveId}/items/${currentId}:/${encodeURIComponent(seg)}`
      );
      const item = await res.json();
      currentId = item.id;
    }
    itemId = currentId;
  }

  const res = await graphFetch(
    `/drives/${driveId}/items/${itemId}/children?$select=id,name,size,folder,file,image,video`
  );
  const data = await res.json();
  return (data.value || []).map(toDriveItem);
}

export async function getItem(driveItemId: string): Promise<DriveItem> {
  const root = await getRootShareItem();
  const driveId = root.parentReference.driveId;
  const res = await graphFetch(
    `/drives/${driveId}/items/${driveItemId}?$select=id,name,size,folder,file,image,video,@microsoft.graph.downloadUrl`
  );
  return toDriveItem(await res.json());
}

// A short-lived, pre-authenticated thumbnail image URL for a file. Used to
// redirect the browser straight to Microsoft's own thumbnail CDN instead
// of proxying image bytes through our serverless function.
export async function getThumbnailUrl(driveItemId: string): Promise<string | null> {
  const root = await getRootShareItem();
  const driveId = root.parentReference.driveId;
  const res = await graphFetch(`/drives/${driveId}/items/${driveItemId}/thumbnails/0/medium`);
  const data = await res.json();
  return data?.url ?? null;
}

(function () {
  const contentEl = document.getElementById("content");
  const loadingEl = document.getElementById("loading");
  const gridEl = document.getElementById("grid");
  const emptyEl = document.getElementById("empty");
  const breadcrumbEl = document.getElementById("breadcrumb");
  const itemCountEl = document.getElementById("item-count");
  const snackbar = document.getElementById("snackbar");

  const viewer = document.getElementById("viewer");
  const viewerImg = document.getElementById("viewer-img");
  const viewerVideo = document.getElementById("viewer-video");
  const viewerName = document.getElementById("viewer-name");
  const viewerPrev = document.getElementById("viewer-prev");
  const viewerNext = document.getElementById("viewer-next");
  const viewerDownload = document.getElementById("viewer-download");

  const BASE = "/onedrive";

  // --- Language (defaults to device setting, user choice persists) ---
  const STRINGS = {
    vi: {
      loading: "Đang tải…",
      empty: "Thư mục này trống.",
      notConfigured: "OneDrive chưa được cấu hình (thiếu thông tin xác thực).",
      loadFailed: "Không thể tải danh sách tệp — OneDrive chưa được cấu hình",
      itemCount: (n) => n + " mục",
      childCount: (n) => n + " mục",
      downloading: (name) => "Đang tải xuống " + name,
      root: "OneDrive",
      backHome: "Quay lại",
      themeToggle: "Đổi giao diện sáng/tối",
      langToggle: "Change language / Đổi ngôn ngữ",
      close: "Đóng",
      prev: "Trước",
      next: "Tiếp theo",
      download: "Tải xuống",
    },
    en: {
      loading: "Loading…",
      empty: "This folder is empty.",
      notConfigured: "OneDrive is not configured yet (missing credentials).",
      loadFailed: "Could not load file list — OneDrive is not configured",
      itemCount: (n) => n + " items",
      childCount: (n) => n + " items",
      downloading: (name) => "Downloading " + name,
      root: "OneDrive",
      backHome: "Back",
      themeToggle: "Toggle light/dark theme",
      langToggle: "Change language / Đổi ngôn ngữ",
      close: "Close",
      prev: "Previous",
      next: "Next",
      download: "Download",
    },
  };

  const langToggle = document.getElementById("lang-toggle");
  const backHome = document.getElementById("back-home");

  function detectDefaultLang() {
    return (navigator.language || "en").toLowerCase().startsWith("vi") ? "vi" : "en";
  }

  let lang = localStorage.getItem("lang") || detectDefaultLang();

  function t(key, ...args) {
    const entry = STRINGS[lang][key];
    return typeof entry === "function" ? entry(...args) : entry;
  }

  function applyLanguage() {
    document.documentElement.lang = lang;
    langToggle.textContent = lang === "vi" ? "VI" : "EN";
    langToggle.title = t("langToggle");
    backHome.title = backHome.ariaLabel = t("backHome");
    document.getElementById("theme-toggle").title = document.getElementById(
      "theme-toggle"
    ).ariaLabel = t("themeToggle");
    document.querySelector("[data-close]").ariaLabel = t("close");
    viewerPrev.ariaLabel = t("prev");
    viewerNext.ariaLabel = t("next");
    viewerDownload.querySelector("span").textContent = t("download");
    loadingEl.querySelector("p").textContent = t("loading");
    renderBreadcrumb();

    // Re-translate already-displayed dynamic text too, not just the
    // static chrome — otherwise switching language mid-browsing leaves
    // the item count / empty-state message in the old language until
    // the next navigation.
    if (!emptyEl.hidden) {
      emptyEl.querySelector("p").textContent = lastLoadHadError ? t("notConfigured") : t("empty");
    }
    if (currentItems.length > 0 && !lastLoadHadError) {
      itemCountEl.textContent = t("itemCount", currentItems.length);
    }
    gridEl.querySelectorAll(".item-card").forEach((card, i) => {
      const item = currentItems[i];
      if (item && item.isFolder && item.childCount != null) {
        card.querySelector(".item-meta").textContent = t("childCount", item.childCount);
      }
    });
  }

  langToggle.addEventListener("click", () => {
    lang = lang === "vi" ? "en" : "vi";
    localStorage.setItem("lang", lang);
    applyLanguage();
  });

  function pathFromLocation() {
    let p = location.pathname;
    if (p.startsWith(BASE)) p = p.slice(BASE.length);
    p = p.replace(/^\/+|\/+$/g, ""); // trim leading/trailing slashes
    // location.pathname keeps percent-encoding for characters like
    // spaces/brackets — decode each segment so it matches the real
    // (decoded) file/folder names returned by the list API, or a name
    // containing those characters would never resolve.
    return p
      .split("/")
      .map((seg) => {
        try {
          return decodeURIComponent(seg);
        } catch (e) {
          return seg;
        }
      })
      .join("/");
  }

  let currentPath = pathFromLocation();
  let currentItems = [];
  let mediaItems = []; // images/videos in current folder, for prev/next
  let currentMediaIndex = -1;
  let lastLoadHadError = false;

  function showSnackbar(msg) {
    snackbar.textContent = msg;
    snackbar.classList.add("show");
    clearTimeout(showSnackbar._t);
    showSnackbar._t = setTimeout(() => snackbar.classList.remove("show"), 2200);
  }

  function contentUrl(id, opts) {
    const p = new URLSearchParams({ id });
    if (opts && opts.thumb) p.set("thumb", "1");
    if (opts && opts.download) p.set("download", "1");
    return "/api/onedrive/content?" + p.toString();
  }

  const FILE_ICONS = {
    pdf: "📕", doc: "📄", docx: "📄", xls: "📊", xlsx: "📊",
    ppt: "📙", pptx: "📙", zip: "🗜️", rar: "🗜️", txt: "📄",
    mp3: "🎵", wav: "🎵",
  };

  function fileIcon(name) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    return FILE_ICONS[ext] || "📄";
  }

  // A proper Material Symbols-style folder glyph instead of the emoji —
  // reads consistently across platforms and takes the M3 primary color.
  const FOLDER_SVG =
    '<svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';

  function urlForPath(path) {
    return BASE + (path ? "/" + path.split("/").map(encodeURIComponent).join("/") : "");
  }

  function updateUrl(push) {
    const url = urlForPath(currentPath);
    if (push) history.pushState({ path: currentPath }, "", url);
    else history.replaceState({ path: currentPath }, "", url);
  }

  window.addEventListener("popstate", () => {
    currentPath = pathFromLocation();
    loadFolder();
  });

  function renderBreadcrumb() {
    breadcrumbEl.innerHTML = "";
    const segments = currentPath ? currentPath.split("/").filter(Boolean) : [];

    const rootBtn = document.createElement("button");
    rootBtn.className = "breadcrumb-item" + (segments.length === 0 ? " current" : "");
    rootBtn.textContent = t("root");
    if (segments.length > 0) rootBtn.addEventListener("click", () => navigate(""));
    breadcrumbEl.appendChild(rootBtn);

    let accum = "";
    segments.forEach((seg, i) => {
      accum += (accum ? "/" : "") + seg;
      const sep = document.createElement("span");
      sep.className = "breadcrumb-sep";
      sep.textContent = "›";
      breadcrumbEl.appendChild(sep);

      const btn = document.createElement("button");
      const isCurrent = i === segments.length - 1;
      btn.className = "breadcrumb-item" + (isCurrent ? " current" : "");
      btn.textContent = seg;
      const target = accum;
      if (!isCurrent) btn.addEventListener("click", () => navigate(target));
      breadcrumbEl.appendChild(btn);
    });
  }

  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -5% 0px" }
  );

  // Items render in batches as you scroll — a folder can have hundreds of
  // files, and firing every thumbnail request (each proxied through our
  // server) at once is what caused only the first few to ever load.
  const PAGE_SIZE = 24;
  let visibleCount = 0;

  function makeCard(item, mediaIndex) {
    const btn = document.createElement("button");
    btn.className = "item-card";

    const thumb = document.createElement("div");
    thumb.className = "item-thumb";

    if (item.isFolder) {
      thumb.innerHTML = FOLDER_SVG;
      thumb.querySelector("svg").style.color = "var(--md-primary)";
      btn.addEventListener("click", () => navigate(joinPath(currentPath, item.name)));
    } else if (item.isImage) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.addEventListener("load", () => img.classList.add("loaded"));
      img.src = contentUrl(item.id, { thumb: true });
      thumb.appendChild(img);
      btn.addEventListener("click", () => openViewer(mediaIndex));
    } else if (item.isVideo) {
      // No thumbnail source for videos in the no-API OneDrive backend —
      // an icon + play badge instead of a broken/never-loading <img>.
      thumb.innerHTML =
        '<span class="icon">🎬</span><div class="play-badge"><svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>';
      btn.addEventListener("click", () => openViewer(mediaIndex));
    } else {
      thumb.innerHTML = '<span class="icon">' + fileIcon(item.name) + "</span>";
      btn.addEventListener("click", () => downloadFile(item));
    }

    const info = document.createElement("div");
    info.className = "item-info";
    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = item.name;
    const meta = document.createElement("span");
    meta.className = "item-meta";
    // SharePoint's reported file size (File_x0020_Size / SMTotalSize) is
    // unreliable for this anonymous listing API and doesn't match the
    // real file size, so it's not shown at all rather than showing a
    // wrong number.
    meta.textContent = item.isFolder && item.childCount != null ? t("childCount", item.childCount) : "";
    info.appendChild(name);
    info.appendChild(meta);

    btn.appendChild(thumb);
    btn.appendChild(info);
    return btn;
  }

  function joinPath(base, name) {
    return base ? base + "/" + name : name;
  }

  function downloadFile(item) {
    const a = document.createElement("a");
    a.href = contentUrl(item.id, { download: true });
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showSnackbar(t("downloading", item.name));
  }

  async function navigate(path) {
    currentPath = path;
    updateUrl(true);
    await loadFolder();
  }

  // Back button steps up one folder level (like a file manager), only
  // leaving the app for "/" once already at this section's own root.
  backHome.addEventListener("click", () => {
    if (!currentPath) {
      location.href = "/";
      return;
    }
    const segments = currentPath.split("/").filter(Boolean);
    segments.pop();
    navigate(segments.join("/"));
  });

  function renderMore() {
    const next = Math.min(visibleCount + PAGE_SIZE, currentItems.length);
    let mIdx = currentItems.slice(0, visibleCount).filter((it) => it.isImage || it.isVideo).length;
    for (let i = visibleCount; i < next; i++) {
      const item = currentItems[i];
      const isMedia = item.isImage || item.isVideo;
      const card = makeCard(item, isMedia ? mIdx : -1);
      if (isMedia) mIdx++;
      gridEl.appendChild(card);
      revealObserver.observe(card);
    }
    visibleCount = next;
    sentinel.style.display = visibleCount >= currentItems.length ? "none" : "flex";
  }

  const sentinel = document.createElement("div");
  sentinel.className = "loading-state";
  sentinel.innerHTML = '<div class="loader" aria-hidden="true"></div>';
  contentEl.appendChild(sentinel);

  const loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) renderMore();
    },
    { rootMargin: "600px" }
  );
  loadMoreObserver.observe(sentinel);

  async function fetchItems(path) {
    const res = await fetch("/api/onedrive/list?path=" + encodeURIComponent(path));
    if (!res.ok) throw new Error("list failed: " + res.status);
    const data = await res.json();
    return data.items || [];
  }

  // A URL can point straight at a FILE, not just a folder — e.g.
  // /onedrive/k7a2/a.png (pasted, bookmarked, or refreshed). There's no
  // way to know that from the path alone, so the last segment is checked
  // against its parent folder's listing: if it matches a non-folder item,
  // this is a file deep link — show the containing folder and then either
  // open the viewer (images/videos) or trigger a download (everything
  // else), instead of trying to "list" a file as if it were a folder.
  async function resolveDeepLink(fullPath) {
    const segments = fullPath.split("/").filter(Boolean);
    if (segments.length === 0) return { path: fullPath, items: await fetchItems(fullPath) };

    const last = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join("/");
    const parentItems = await fetchItems(parentPath);
    const match = parentItems.find((it) => it.name === last);

    if (match && !match.isFolder) {
      return { path: parentPath, items: parentItems, fileMatch: match };
    }
    // Either it's a real folder, or an unresolved name — list it as a
    // folder either way; a genuinely missing folder just comes back empty.
    return { path: fullPath, items: await fetchItems(fullPath) };
  }

  async function loadFolder() {
    loadingEl.hidden = false;
    gridEl.hidden = true;
    emptyEl.hidden = true;
    sentinel.style.display = "none";

    lastLoadHadError = false;
    let fileMatch = null;
    try {
      const result = await resolveDeepLink(currentPath);
      currentItems = result.items;
      fileMatch = result.fileMatch || null;
      currentPath = result.path; // may have been trimmed to the parent folder
    } catch (e) {
      currentItems = [];
      lastLoadHadError = true;
      showSnackbar(t("loadFailed"));
    }

    renderBreadcrumb();
    loadingEl.hidden = true;
    gridEl.innerHTML = "";
    visibleCount = 0;
    mediaItems = currentItems.filter((it) => it.isImage || it.isVideo);
    itemCountEl.textContent = lastLoadHadError ? "" : t("itemCount", currentItems.length);

    if (currentItems.length === 0) {
      emptyEl.querySelector("p").textContent = lastLoadHadError ? t("notConfigured") : t("empty");
      emptyEl.hidden = false;
      return;
    }

    gridEl.hidden = false;
    renderMore();

    if (fileMatch) {
      if (fileMatch.isImage || fileMatch.isVideo) {
        const idx = mediaItems.findIndex((m) => m.id === fileMatch.id);
        if (idx !== -1) openViewer(idx);
      } else {
        downloadFile(fileMatch);
      }
    }
  }

  // --- Viewer ---
  function openViewer(mediaIndex) {
    currentMediaIndex = mediaIndex;
    updateViewerContent();
    viewer.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeViewer() {
    viewerVideo.pause();
    viewerVideo.src = "";
    viewer.hidden = true;
    document.body.style.overflow = "";
  }

  function updateViewerContent() {
    const item = mediaItems[currentMediaIndex];
    if (!item) return;
    viewerName.textContent = item.name;

    if (item.isVideo) {
      viewerImg.hidden = true;
      viewerVideo.hidden = false;
      viewerVideo.src = contentUrl(item.id);
    } else {
      viewerVideo.pause();
      viewerVideo.hidden = true;
      viewerImg.hidden = false;
      viewerImg.src = contentUrl(item.id);
    }
  }

  function stepMedia(delta) {
    if (mediaItems.length === 0) return;
    currentMediaIndex = (currentMediaIndex + delta + mediaItems.length) % mediaItems.length;
    updateViewerContent();
  }

  viewer.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeViewer));
  viewerPrev.addEventListener("click", () => stepMedia(-1));
  viewerNext.addEventListener("click", () => stepMedia(1));

  document.addEventListener("keydown", (e) => {
    if (viewer.hidden) return;
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowLeft") stepMedia(-1);
    if (e.key === "ArrowRight") stepMedia(1);
  });

  viewerDownload.addEventListener("click", () => {
    const item = mediaItems[currentMediaIndex];
    if (item) downloadFile(item);
  });

  // --- Theme toggle ---
  const themeToggle = document.getElementById("theme-toggle");
  const iconDark = document.getElementById("theme-icon-dark");
  const iconLight = document.getElementById("theme-icon-light");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function isDarkActive() {
    const stored = localStorage.getItem("theme");
    if (stored === "dark") return true;
    if (stored === "light") return false;
    return systemDark.matches;
  }

  function applyThemeIcon() {
    const dark = isDarkActive();
    iconDark.hidden = dark;
    iconLight.hidden = !dark;
  }

  const storedTheme = localStorage.getItem("theme");
  if (storedTheme === "dark" || storedTheme === "light") {
    document.documentElement.setAttribute("data-theme", storedTheme);
  }
  applyThemeIcon();

  themeToggle.addEventListener("click", () => {
    const next = isDarkActive() ? "light" : "dark";
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
    applyThemeIcon();
  });

  systemDark.addEventListener("change", () => {
    if (!localStorage.getItem("theme")) applyThemeIcon();
  });

  applyLanguage();
  loadFolder();
})();

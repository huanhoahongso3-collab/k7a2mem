(function () {
  const PHOTOS = window.PHOTOS || [];
  const PAGE_SIZE = 40;
  const NUM_COLUMNS = pickColumnCount();

  // Every photo has a stable ID = its original (unshuffled) position in
  // PHOTOS, shown as "#<id+1>". The grid displays photos in a shuffled
  // order, but the ID travels with the photo everywhere (tile badge,
  // viewer, search) so a specific photo can always be found again.
  const order = PHOTOS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const idToPos = new Map(order.map((id, pos) => [id, pos]));

  function pickColumnCount() {
    const w = window.innerWidth;
    if (w >= 1180) return 5;
    if (w >= 860) return 4;
    if (w >= 560) return 3;
    return 2;
  }

  const gallery = document.getElementById("gallery");
  const sentinel = document.getElementById("sentinel");
  const countEl = document.getElementById("photo-count");
  const fabTop = document.getElementById("fab-top");
  const fabBottom = document.getElementById("fab-bottom");

  const viewer = document.getElementById("viewer");
  const viewerImg = document.getElementById("viewer-img");
  const viewerPrev = document.getElementById("viewer-prev");
  const viewerNext = document.getElementById("viewer-next");
  const viewerDownload = document.getElementById("viewer-download");
  const viewerCopy = document.getElementById("viewer-copy");
  const viewerPosition = document.getElementById("viewer-position");
  const viewerId = document.getElementById("viewer-id");
  const snackbar = document.getElementById("snackbar");

  let visibleCount = 0;
  let currentIndex = -1;

  // --- Language (defaults to device setting, user choice persists) ---
  const STRINGS = {
    vi: {
      photos: (n) => n + " ảnh",
      scrollTop: "Cuộn lên đầu",
      scrollBottom: "Cuộn xuống cuối",
      close: "Đóng",
      prev: "Ảnh trước",
      next: "Ảnh tiếp theo",
      download: "Tải xuống",
      copyLink: "Sao chép liên kết",
      copied: "Đã sao chép liên kết",
      copyFailed: "Không thể sao chép liên kết",
      downloading: "Đang tải xuống",
      openedTab: "Đã mở ảnh gốc ở tab mới",
      viewPhoto: (n) => "Xem ảnh " + n,
      themeToggle: "Đổi giao diện sáng/tối",
      langToggle: "Change language / Đổi ngôn ngữ",
    },
    en: {
      photos: (n) => n + " photos",
      scrollTop: "Scroll to top",
      scrollBottom: "Scroll to bottom",
      close: "Close",
      prev: "Previous",
      next: "Next",
      download: "Download",
      copyLink: "Copy link",
      copied: "Link copied to clipboard",
      copyFailed: "Could not copy link",
      downloading: "Download started",
      openedTab: "Opened original in a new tab",
      viewPhoto: (n) => "View photo " + n,
      themeToggle: "Toggle light/dark theme",
      langToggle: "Change language / Đổi ngôn ngữ",
    },
  };

  const langToggle = document.getElementById("lang-toggle");

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
    countEl.textContent = t("photos", PHOTOS.length);
    fabTop.title = fabTop.ariaLabel = t("scrollTop");
    fabBottom.title = fabBottom.ariaLabel = t("scrollBottom");
    themeToggle.title = themeToggle.ariaLabel = t("themeToggle");
    document.querySelector("[data-close]").ariaLabel = t("close");
    viewerPrev.ariaLabel = t("prev");
    viewerNext.ariaLabel = t("next");
    viewerDownload.querySelector("span").textContent = t("download");
    viewerCopy.querySelector("span").textContent = t("copyLink");
  }

  langToggle.addEventListener("click", () => {
    lang = lang === "vi" ? "en" : "vi";
    localStorage.setItem("lang", lang);
    applyLanguage();
  });

  // --- Theme toggle (defaults to device setting, user choice persists) ---
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

  // Real (non-reflowing) masonry: each photo is appended to one column div
  // and never moves again. CSS `column-count` looked nicer but rebalances
  // ALL tiles across columns whenever the DOM child count changes, which is
  // what caused the page to visibly jump/scroll while new batches loaded.
  const columns = [];
  for (let i = 0; i < NUM_COLUMNS; i++) {
    const col = document.createElement("div");
    col.className = "gallery-col";
    gallery.appendChild(col);
    columns.push(col);
  }

  // Routed through our own /api/img proxy so Vercel's Edge Network caches
  // each size globally after the first request — direct hotlinking to
  // Google's CDN worked but had no shared cache and occasionally hit
  // transient rate limits under heavy traffic.
  function proxied(url, size) {
    return "/api/img?u=" + encodeURIComponent(url + size);
  }

  function thumbUrl(url) {
    return proxied(url, "=w400");
  }

  function fullUrl(url) {
    return proxied(url, "=w1600");
  }

  // A tile only reveals once it is BOTH decoded and scrolled into view —
  // whichever finishes second triggers the (single) reveal animation.
  // Gating on one combined signal instead of animating the container and
  // the image separately is what keeps this from flickering.
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target._inView = true;
          maybeReveal(entry.target);
          revealObserver.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.01 }
  );

  function maybeReveal(img) {
    if (img._inView && img._loaded) {
      img.classList.add("loaded");
    }
  }

  // Round-robin (even count per column) still lets columns drift apart in
  // total HEIGHT, since photos have very different aspect ratios — one
  // column can end up visually much shorter than its neighbors, showing as
  // a blank gap at the bottom of that column until more items eventually
  // load into it. Instead, every new tile goes into whichever column is
  // CURRENTLY shortest, so columns stay height-balanced continuously
  // (the standard masonry-by-JS technique), regardless of how many photos
  // are on screen.
  const columnHeights = new Array(NUM_COLUMNS).fill(0);
  const GAP = 10;

  // Tiles are created in row-major order (shortestColumn() round-robins
  // across columns for same-height images), but without this queue every
  // tile's <img> fired its request the instant it was created — on a slow
  // connection the browser just works through that pile in whatever order
  // its own heuristics pick, which can easily finish an entire column
  // before even starting the next one, leaving the others as holes. Gating
  // actual network starts through a small concurrency limit processed in
  // creation order forces row-by-row completion instead: only a handful of
  // requests are ever in flight, always the earliest not-yet-started ones,
  // so every column keeps pace together.
  const MAX_CONCURRENT_LOADS = 6;
  let activeLoads = 0;
  const loadQueue = [];

  function enqueueLoad(start) {
    loadQueue.push(start);
    pumpLoadQueue();
  }

  function pumpLoadQueue() {
    while (activeLoads < MAX_CONCURRENT_LOADS && loadQueue.length) {
      const start = loadQueue.shift();
      activeLoads++;
      start();
    }
  }

  function releaseLoadSlot() {
    activeLoads--;
    pumpLoadQueue();
  }

  function shortestColumn() {
    let idx = 0;
    for (let i = 1; i < NUM_COLUMNS; i++) {
      if (columnHeights[i] < columnHeights[idx]) idx = i;
    }
    return idx;
  }

  function makeTile(pos) {
    const id = order[pos];
    const url = PHOTOS[id];

    const btn = document.createElement("button");
    btn.className = "tile";
    btn.setAttribute("aria-label", t("viewPhoto", id + 1));
    btn.addEventListener("click", () => {
      if (btn.classList.contains("tile-failed")) {
        attempt = 0;
        btn.classList.remove("tile-failed");
        loadImage();
      } else {
        openViewer(pos);
      }
    });

    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";

    const colIdx = shortestColumn();
    const colWidth = columns[colIdx].clientWidth || 200;
    // Before the real image loads we don't know its height, so estimate
    // with a typical portrait ratio — corrected below once it actually
    // loads. Good enough to keep placement balanced as tiles stream in.
    const estimatedHeight = colWidth * 1.3;
    columnHeights[colIdx] += estimatedHeight + GAP;
    // CSS gives an unloaded <img> `height: auto`, i.e. zero visual height
    // until its request actually completes. Queued tiles (the concurrency
    // limiter above can leave many waiting their turn) would otherwise sit
    // at 0px while still counted as `estimatedHeight` tall in the
    // bookkeeping above — shortestColumn() then drifts further off from
    // reality with every batch rendered, which is what made the imbalance
    // compound the deeper you scrolled. Reserving the estimate as an
    // inline height keeps visual and bookkeeping height in sync; cleared
    // on load so the real intrinsic size (already reconciled below) takes
    // over.
    img.style.height = estimatedHeight + "px";

    let attempt = 0;
    const MAX_ATTEMPTS = 3;
    function loadImage() {
      enqueueLoad(() => {
        // Retry with the exact same URL — Google's `=w400` suffix is not a
        // normal query string, so appending a cache-busting param to it
        // (e.g. "&r=...") breaks the size directive and the request fails
        // outright. Clearing src first is enough to force a fresh request.
        if (attempt > 0) img.src = "";
        img.src = thumbUrl(url);
      });
    }

    img.addEventListener("load", () => {
      img._loaded = true;
      btn.classList.remove("tile-failed");
      img.style.height = "";
      columnHeights[colIdx] += img.offsetHeight - estimatedHeight;
      maybeReveal(img);
      releaseLoadSlot();
    });

    // Direct-hotlinked Google CDN images occasionally fail a request
    // (transient network hiccup, brief rate-limit) and browsers never
    // retry a failed <img> on their own — without this it just stays
    // blank forever. A few auto-retries with backoff recover most of
    // these; if it still fails, mark it clearly instead of leaving a
    // silent, unexplained blank hole — clicking it retries again.
    img.addEventListener("error", () => {
      releaseLoadSlot();
      attempt++;
      if (attempt < MAX_ATTEMPTS) {
        setTimeout(loadImage, 800 * attempt);
      } else {
        btn.classList.add("tile-failed");
      }
    });


    loadImage();
    btn.appendChild(img);

    const badge = document.createElement("span");
    badge.className = "tile-id";
    badge.textContent = "#" + (id + 1);
    btn.appendChild(badge);

    columns[colIdx].appendChild(btn);
    revealObserver.observe(img);
  }

  // `currentList` holds whatever sequence of `pos` values is currently
  // being displayed — the full shuffled order by default, or a filtered
  // set of matches while searching. `renderMore()` only ever renders the
  // next PAGE_SIZE items from it, so a search with 1000+ matches streams
  // in via the same infinite-scroll sentinel instead of loading every
  // thumbnail at once (which is exactly what was hammering bandwidth).
  let currentList = order.map((_, i) => i);

  function renderMore() {
    const next = Math.min(visibleCount + PAGE_SIZE, currentList.length);
    for (let i = visibleCount; i < next; i++) {
      makeTile(currentList[i]);
    }
    visibleCount = next;
    sentinel.style.display = visibleCount >= currentList.length ? "none" : "";
  }

  function clearGallery() {
    columns.forEach((col, i) => {
      col.innerHTML = "";
      columnHeights[i] = 0;
    });
    visibleCount = 0;
  }

  // --- Live search by ID (filters as you type, no submit needed) ---
  const searchForm = document.getElementById("search-form");
  const searchInput = document.getElementById("search-input");
  const searchStatus = document.getElementById("search-status");

  function runSearch(query) {
    query = query.trim();
    clearGallery();

    if (!query) {
      currentList = order.map((_, i) => i);
      searchStatus.textContent = "";
      searchStatus.classList.remove("error");
      renderMore();
      return;
    }

    const matches = order
      .filter((id) => String(id + 1).startsWith(query))
      .sort((a, b) => a - b);
    currentList = matches.map((id) => idToPos.get(id));

    if (matches.length === 0) {
      searchStatus.textContent = lang === "vi" ? "Không tìm thấy" : "No matches";
      searchStatus.classList.add("error");
    } else {
      searchStatus.textContent =
        matches.length +
        (lang === "vi" ? " ảnh khớp" : matches.length === 1 ? " match" : " matches");
      searchStatus.classList.remove("error");
    }
    renderMore();
  }

  searchInput.addEventListener("input", () => runSearch(searchInput.value));
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch(searchInput.value);
  });

  const loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) {
        renderMore();
      }
    },
    { rootMargin: "600px" }
  );
  // Observing a target fires the callback once immediately with its
  // current intersection state — since the gallery starts empty, the
  // sentinel is trivially in view, so this alone loads the first batch.
  // A second, manual `renderMore()` call right after used to race this
  // automatic first callback (both firing before the DOM had reflowed),
  // which is what was cascading into several batches loading at once
  // instead of just one.
  loadMoreObserver.observe(sentinel);

  // --- Scroll FABs ---
  fabBottom.classList.add("show");

  window.addEventListener("scroll", () => {
    if (window.scrollY > 600) {
      fabTop.classList.add("show");
    } else {
      fabTop.classList.remove("show");
    }
    const atBottom =
      window.innerHeight + window.scrollY >= document.body.scrollHeight - 40;
    if (atBottom && visibleCount >= PHOTOS.length) {
      fabBottom.classList.remove("show");
    } else {
      fabBottom.classList.add("show");
    }
  });

  fabTop.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  fabBottom.addEventListener("click", () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  });

  // --- Viewer ---
  function currentId() {
    return order[currentIndex];
  }

  let savedScrollY = 0;

  // Keeps the URL in sync with whatever photo is open (?id=<n>), so
  // refreshing the page reopens the same photo instead of losing your
  // place. Opening from the grid still returns you to that exact scroll
  // spot on close (savedScrollY below); opening via a shared/refreshed
  // URL has no such spot to return to, so closing naturally lands back
  // on the plain gallery at the top — which is the "first page" behavior.
  function setUrlId(id) {
    const url = new URL(location.href);
    url.searchParams.set("id", id + 1);
    url.searchParams.delete("search");
    history.replaceState(null, "", url);
  }

  function clearUrl() {
    const url = new URL(location.href);
    url.searchParams.delete("id");
    history.replaceState(null, "", url);
  }

  function openViewer(pos) {
    currentIndex = pos;
    savedScrollY = window.scrollY;
    updateViewerImage();
    viewer.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeViewer() {
    // Navigating with next/prev never touches the page scroll, but some
    // browsers try to scroll a now-different element into view once
    // `overflow: hidden` is lifted and focus/layout settle — pinning the
    // scroll back to exactly where it was before the viewer opened avoids
    // any such "teleport" regardless of the browser's own scroll-anchoring.
    if (document.activeElement && viewer.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    viewer.hidden = true;
    document.body.style.overflow = "";
    window.scrollTo(0, savedScrollY);
    clearUrl();
  }

  function updateViewerImage() {
    const id = currentId();
    const url = PHOTOS[id];
    viewerPosition.textContent = (currentIndex + 1) + " / " + PHOTOS.length;
    viewerId.textContent = "#" + (id + 1);
    setUrlId(id);
    resetZoom();

    // Show the (likely already-cached) thumbnail instantly so the dialog
    // never looks stuck/blank, then swap to the full-res image once it's
    // actually decoded — avoids the "slow to render" feeling on click.
    viewerImg.style.opacity = "0.4";
    viewerImg.src = thumbUrl(url);

    const fullImg = new Image();
    fullImg.onload = () => {
      if (currentId() !== id) return; // user already navigated away
      viewerImg.src = fullImg.src;
      viewerImg.style.opacity = "1";
    };
    fullImg.src = fullUrl(url);
  }

  function step(delta) {
    currentIndex = (currentIndex + delta + PHOTOS.length) % PHOTOS.length;
    updateViewerImage();
  }

  // --- Zoom & pan ---
  const ZOOM_STEP = 1.6;
  const MAX_ZOOM = 5;
  const CLICK_ZOOM = 2.5;
  const zoomLevel = document.getElementById("zoom-level");
  const zoomInBtn = document.getElementById("zoom-in");
  const zoomOutBtn = document.getElementById("zoom-out");
  const zoomResetBtn = document.getElementById("zoom-reset");

  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let dragging = false;
  let moved = false;
  let dragStartX = null;
  let dragStartY = 0;
  let panStartX = 0;
  let panStartY = 0;

  function applyTransform() {
    viewerImg.style.transition = dragging
      ? "opacity 200ms ease"
      : "opacity 200ms ease, transform 200ms cubic-bezier(0.2, 0, 0, 1)";
    viewerImg.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    viewerImg.style.cursor = zoom > 1 ? (dragging ? "grabbing" : "grab") : "zoom-in";
    zoomLevel.textContent = Math.round(zoom * 100) + "%";
    zoomOutBtn.disabled = zoom <= 1;
    zoomInBtn.disabled = zoom >= MAX_ZOOM;
  }

  function resetZoom() {
    zoom = 1;
    panX = 0;
    panY = 0;
    dragging = false;
    applyTransform();
  }

  function clampPan() {
    const maxX = (viewerImg.clientWidth * zoom - viewerImg.clientWidth) / 2 + 200;
    const maxY = (viewerImg.clientHeight * zoom - viewerImg.clientHeight) / 2 + 200;
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  }

  // Zooms toward a specific viewport point (cursor, tap, or pinch midpoint)
  // instead of always the image center — reads far more natural, since
  // whatever you're pointing at stays under your finger/cursor as it grows.
  function zoomAt(factor, clientX, clientY) {
    const prevZoom = zoom;
    zoom = Math.max(1, Math.min(MAX_ZOOM, zoom * factor));
    if (zoom === 1) {
      panX = 0;
      panY = 0;
    } else if (typeof clientX === "number") {
      const rect = viewerImg.getBoundingClientRect();
      const dx = clientX - (rect.left + rect.width / 2);
      const dy = clientY - (rect.top + rect.height / 2);
      const ratio = zoom / prevZoom - 1;
      panX -= dx * ratio;
      panY -= dy * ratio;
      clampPan();
    } else {
      clampPan();
    }
    applyTransform();
  }

  function toggleZoomAt(clientX, clientY) {
    if (zoom > 1) {
      resetZoom();
    } else {
      zoomAt(CLICK_ZOOM, clientX, clientY);
    }
  }

  zoomInBtn.addEventListener("click", () => zoomAt(ZOOM_STEP));
  zoomOutBtn.addEventListener("click", () => zoomAt(1 / ZOOM_STEP));
  zoomResetBtn.addEventListener("click", () => resetZoom());

  viewerImg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, e.clientX, e.clientY);
    },
    { passive: false }
  );

  // Desktop: a plain click toggles zoom in/out at the click point (dragging
  // to pan is distinguished by movement distance, so a click-then-drag
  // never accidentally re-triggers the toggle). `dragging` only flips to
  // true once real pan movement happens (in mousemove) — setting it
  // preemptively in mousedown left it stale-true while toggleZoomAt's own
  // resetZoom() ran on mouseup, which strips the transform transition
  // (only opacity was left animating) and made zooming back out snap
  // instantly instead of scaling down smoothly.
  let canDrag = false;

  viewerImg.addEventListener("mousedown", (e) => {
    canDrag = zoom > 1;
    dragging = false;
    moved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = panX;
    panStartY = panY;
  });

  window.addEventListener("mousemove", (e) => {
    if (dragStartX === null) return;
    if (Math.abs(e.clientX - dragStartX) > 4 || Math.abs(e.clientY - dragStartY) > 4) {
      moved = true;
    }
    if (!canDrag || !moved) return;
    if (!dragging) {
      dragging = true;
      applyTransform();
    }
    panX = panStartX + (e.clientX - dragStartX);
    panY = panStartY + (e.clientY - dragStartY);
    clampPan();
    applyTransform();
  });

  viewerImg.addEventListener("mouseup", (e) => {
    dragging = false;
    dragStartX = null;
    if (!moved) toggleZoomAt(e.clientX, e.clientY);
    else applyTransform();
  });

  // --- Touch: pinch to zoom, one-finger pan, tap to toggle zoom ---
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved = false;

  function touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  viewerImg.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 2) {
        pinchStartDist = touchDist(e.touches);
        pinchStartZoom = zoom;
      } else if (e.touches.length === 1) {
        touchMoved = false;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        panStartX = panX;
        panStartY = panY;
      }
    },
    { passive: true }
  );

  viewerImg.addEventListener(
    "touchmove",
    (e) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const dist = touchDist(e.touches);
        zoom = Math.max(1, Math.min(MAX_ZOOM, pinchStartZoom * (dist / pinchStartDist)));
        clampPan();
        applyTransform();
      } else if (e.touches.length === 1 && zoom > 1) {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) touchMoved = true;
        panX = panStartX + dx;
        panY = panStartY + dy;
        clampPan();
        applyTransform();
      }
    },
    { passive: false }
  );

  viewerImg.addEventListener("touchend", (e) => {
    if (e.touches.length === 0 && !touchMoved && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      toggleZoomAt(t.clientX, t.clientY);
    }
  });

  viewer.querySelectorAll("[data-close]").forEach((el) =>
    el.addEventListener("click", closeViewer)
  );
  viewerPrev.addEventListener("click", () => step(-1));
  viewerNext.addEventListener("click", () => step(1));

  document.addEventListener("keydown", (e) => {
    if (viewer.hidden) return;
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  function showSnackbar(msg) {
    snackbar.textContent = msg;
    snackbar.classList.add("show");
    clearTimeout(showSnackbar._t);
    showSnackbar._t = setTimeout(() => {
      snackbar.classList.remove("show");
    }, 2200);
  }

  viewerCopy.addEventListener("click", async () => {
    // Share a link back to this app at the current photo (?id=...), not
    // the raw Google-hosted image URL — so opening it lands the visitor
    // in the gallery viewer, not a bare image file.
    const shareUrl = new URL(location.href);
    shareUrl.searchParams.set("id", currentId() + 1);
    shareUrl.searchParams.delete("search");
    const url = shareUrl.toString();
    try {
      await navigator.clipboard.writeText(url);
      showSnackbar(t("copied"));
    } catch (e) {
      showSnackbar(t("copyFailed"));
    }
  });

  viewerDownload.addEventListener("click", async () => {
    const id = currentId();
    // Same-origin now (via our own proxy), so this fetch no longer depends
    // on Google's CDN sending permissive CORS headers — it always works.
    const url = proxied(PHOTOS[id], "=d");
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = "anh-" + (id + 1) + ".jpg";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      showSnackbar(t("downloading"));
    } catch (e) {
      window.open(url, "_blank", "noopener");
      showSnackbar(t("openedTab"));
    }
  });

  // --- Deep links: ?id=<n> opens that photo directly, ?search=<query>
  // runs that search on load (e.g. for sharing a link to a specific photo
  // or a specific ID range). ?id wins if both are present. Placed at the
  // very end so every function/variable it uses is already initialized.
  (function bootstrapFromUrl() {
    const params = new URLSearchParams(location.search);
    const idParam = params.get("id");
    const searchParam = params.get("search");

    if (idParam !== null) {
      const id = parseInt(idParam, 10) - 1;
      if (idToPos.has(id)) {
        openViewer(idToPos.get(id));
        return;
      }
    }
    if (searchParam !== null) {
      searchInput.value = searchParam;
      runSearch(searchParam);
    }
  })();
})();

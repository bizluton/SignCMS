/**
 * SignCMS Player — Renderer Engine
 * Handles: zones, media cycling, page transitions, BGM, announcements, HUD
 */

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
let cfg         = null;
let lastData    = null;      // last player-sync response
let logCount    = 0;

// Content state
let pages       = [];        // array of page objects from _meta
let pageIdx     = 0;
let pageTimer   = null;
let zoneEngines = {};        // { zoneId: ZoneEngine }
let bgmMeta     = null;
let bgmIdx      = 0;
let annQueue         = [];   // active announcements
let annTimer         = null;
let pinnedAnn        = null;
let pinnedTimer      = null;
let projectId        = null; // track to detect content changes
let annZoneContainers = [];  // DOM containers for announcement zones in current page

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
const $  = (id) => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}

function stripHtml(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.textContent || d.innerText || "";
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP SCREEN
// ─────────────────────────────────────────────────────────────────────────────
async function initSetup() {
  cfg = await window.player.getConfig();
  const ver = await window.player.getVersion();
  $("h-ver").textContent = ver;

  // If already configured, go straight to player state (sync will happen)
  if (cfg.deviceToken && cfg.supabaseUrl) {
    showScreen("screen-player");
    showNoContent(true);
    return;
  }
  showScreen("screen-setup");
}

$("btn-connect").addEventListener("click", async () => {
  const url   = $("cfg-url").value.trim();
  const anon  = $("cfg-anon").value.trim();
  const token = $("cfg-token").value.trim();

  if (!url || !anon || !token) {
    showSetupStatus("請填寫所有欄位", "error");
    return;
  }
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    showSetupStatus("Device Token 格式不正確（需 64 位 hex）", "error");
    return;
  }

  $("btn-connect").disabled = true;
  showSetupStatus("連線測試中…", "");

  const newCfg = { ...cfg, supabaseUrl: url, anonKey: anon, deviceToken: token };
  await window.player.saveConfig(newCfg);
  cfg = newCfg;

  const result = await window.player.forceSync();
  $("btn-connect").disabled = false;

  if (result?.ok !== false) {
    showSetupStatus("✅ 連線成功！正在進入播放模式…", "success");
    setTimeout(() => showScreen("screen-player"), 1200);
  } else {
    showSetupStatus("❌ 連線失敗，請確認 Token 是否正確", "error");
  }
});

function showSetupStatus(msg, type) {
  const el = $("setup-status");
  el.textContent = msg;
  el.className = "setup-status" + (type ? " " + type : "");
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PANEL
// ─────────────────────────────────────────────────────────────────────────────
async function openSettings() {
  const c = await window.player.getConfig();
  $("s-url").value      = c.supabaseUrl  || "";
  $("s-anon").value     = c.anonKey      || "";
  $("s-token").value    = c.deviceToken  || "";
  $("s-interval").value = c.syncInterval || 30;
  $("s-kiosk").checked  = !!c.kiosk;
  $("settings-panel").classList.add("visible");
}

function closeSettings() { $("settings-panel").classList.remove("visible"); }

$("btn-close-settings").addEventListener("click", closeSettings);
$("btn-save-settings").addEventListener("click", async () => {
  const newCfg = {
    supabaseUrl:  $("s-url").value.trim(),
    anonKey:      $("s-anon").value.trim(),
    deviceToken:  $("s-token").value.trim(),
    syncInterval: parseInt($("s-interval").value) || 30,
    kiosk:        $("s-kiosk").checked,
  };
  await window.player.saveConfig(newCfg);
  closeSettings();
  await window.player.forceSync();
});

$("btn-disconnect").addEventListener("click", async () => {
  if (!confirm("確定要清除連線設定？")) return;
  await window.player.saveConfig({ ...cfg, deviceToken: "", anonKey: "" });
  location.reload();
});

$("btn-force-sync").addEventListener("click", async () => {
  setConnDot("syncing");
  await window.player.forceSync();
  closeSettings();
});

$("btn-devtools").addEventListener("click", () => {
  // DevTools only accessible in renderer via keyboard in prod — just note
  alert("請使用 Ctrl+Shift+I 開啟 DevTools，或在設定中啟用開發者模式後重啟");
});

// ─────────────────────────────────────────────────────────────────────────────
// SYNC DATA HANDLER
// ─────────────────────────────────────────────────────────────────────────────
window.player.onSyncData((data) => {
  lastData = data;
  setConnDot("online");
  updateHud(data);

  const newProjectId = data.project?.id ?? null;

  if (!data.project) {
    // No content assigned
    if (data.screen) {
      $("standby-name").textContent = data.screen.name || "SignCMS Player";
      $("standby-info").textContent = data.channel
        ? `頻道：${data.channel.name}（尚無內容）`
        : "尚未指派頻道";
    }
    showNoContent(true);
  } else {
    showNoContent(false);
    // Re-render only if project changed
    if (newProjectId !== projectId) {
      projectId = newProjectId;
      renderProject(data);
    }
  }

  // Always refresh announcements
  updateAnnouncements(data.announcements || []);
});

window.player.onSyncError(() => {
  setConnDot("offline");
  $("h-sync").textContent = "離線";
});

window.player.onShowSettings(openSettings);
window.player.onToggleHud(() => $("hud").classList.toggle("visible"));

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT RENDERING
// ─────────────────────────────────────────────────────────────────────────────
function renderProject(data) {
  const project = data.project;
  const channel = data.channel;
  const zones   = project.zones;
  console.log("[DBG] renderProject screen:", data.screen?.org_id, "| project:", project?.id, "| zones raw:", JSON.stringify(zones)?.slice(0,500));

  // Inject orgId/teamId into any widget mediaItem params that lack them,
  // so widgets like announcement_board can query the right org without
  // requiring the ContentStudio user to manually configure it.
  const screenOrgId  = data.screen?.org_id  || "";
  const screenTeamId = data.screen?.team_id || "";
  function injectOrgIntoZones(zoneList) {
    if (!Array.isArray(zoneList)) return;
    zoneList.forEach((z) => {
      const items = z.content?.mediaItems;
      // type:"widget" zone (single widget shorthand)
      if (z.content?.type === "widget" && z.content.widgetConfig) {
        const wc = z.content.widgetConfig;
        const p  = wc.params || (wc.params = {});
        if (!p.orgId  && screenOrgId)  p.orgId  = screenOrgId;
        if (!p.teamId && screenTeamId) p.teamId = screenTeamId;
      }
      // type:"media" zone with widget items
      if (!Array.isArray(items)) return;
      items.forEach((item) => {
        if (item.type !== "widget") return;
        const wc = item.widgetConfig || (item.widgetConfig = {});
        const p  = wc.params || (wc.params = {});
        if (!p.orgId  && screenOrgId)  p.orgId  = screenOrgId;
        if (!p.teamId && screenTeamId) p.teamId = screenTeamId;
      });
    });
  }

  // Find _meta block
  const meta = Array.isArray(zones) ? zones.find((z) => z._meta === true) : null;

  if (meta?.pages?.length > 0) {
    meta.pages.forEach((pg) => injectOrgIntoZones(pg.zones));
    renderNewFormat(meta, channel);
  } else if (Array.isArray(zones)) {
    // Fallback: old flat zones format
    const flatZones = zones.filter((z) => !z._meta);
    injectOrgIntoZones(flatZones);
    renderFlatZones(flatZones, channel);
  }
}

// NEW FORMAT: multi-page with meta
function renderNewFormat(meta, channel) {
  stopAllEngines();
  pages  = meta.pages || [];
  pageIdx = 0;

  const aspect     = channel?.aspect || "16:9";
  const resolution = meta.resolution || { width: 1920, height: 1080 };
  const transition = meta.pageTransition || { mode: "auto", seconds: 10 };

  setupCanvas(aspect, resolution);

  startBgm(meta.bgm, channel?.bgm_volume);
  renderPage(pages[0]);
  schedulePageAdvance(pages, 0, transition);
}

// LEGACY FORMAT: single-page flat zones
function renderFlatZones(flatZones, channel) {
  stopAllEngines();
  pages  = [{ id: "legacy", name: "Default", zones: flatZones, overlays: [] }];
  pageIdx = 0;

  const aspect = channel?.aspect || "16:9";
  setupCanvas(aspect, { width: 1920, height: 1080 });
  renderPage(pages[0]);
}

function setupCanvas(aspect, resolution) {
  const wrap = $("canvas-wrap");
  wrap.innerHTML = "";
  resizeCanvas(aspect);

  // Store for resize handler
  wrap.dataset.aspect = aspect;

  if (!window._resizeHandler) {
    window._resizeHandler = () => {
      const a = $("canvas-wrap").dataset.aspect || "16:9";
      resizeCanvas(a);
    };
    window.addEventListener("resize", window._resizeHandler);
  }
}

function resizeCanvas(aspect) {
  const wrap   = $("canvas-wrap");
  const vw     = window.innerWidth;
  const vh     = window.innerHeight;
  const [wa, ha] = aspect.split(":").map(Number);
  const ratio  = (wa || 16) / (ha || 9);

  let w, h;
  if (vw / vh > ratio) { h = vh; w = h * ratio; }
  else                  { w = vw; h = w / ratio; }

  wrap.style.cssText = `width:${w}px;height:${h}px;position:relative;overflow:hidden;background:#000`;
  wrap.style.left    = `${(vw - w) / 2}px`;
  wrap.style.top     = `${(vh - h) / 2}px`;
}

function renderPage(page) {
  if (!page) return;
  const wrap = $("canvas-wrap");
  wrap.innerHTML = "";
  zoneEngines       = {};
  annZoneContainers = []; // reset per page

  (page.zones || []).forEach((z) => {
    const div = el("div", "zone");
    div.id    = `zone-${z.id}`;
    div.style.cssText = [
      `left:${z.x}%`, `top:${z.y}%`,
      `width:${z.w}%`, `height:${z.h}%`,
      `background:${z.content?.bgColor || "#111"}`,
    ].join(";");

    console.log("[DBG] zone", z.id, "type:", z.content?.type, "mediaItems:", z.content?.mediaItems?.length, "widgetConfig:", !!z.content?.widgetConfig, "widgetType:", z.content?.widgetConfig?.widgetType || z.content?.mediaItems?.[0]?.widgetConfig?.widgetType);
    if (z.content?.type === "media" && z.content.mediaItems?.length > 0) {
      const engine = new MediaZoneEngine(div, z.content);
      engine.start();
      zoneEngines[z.id] = engine;
    } else if (z.content?.type === "widget" && z.content.widgetConfig) {
      // Single-widget zone (ContentStudio type:"widget" shorthand)
      renderWidgetZone(div, z.content.widgetConfig, z.id);
    } else if (z.content?.type === "text") {
      renderTextZone(div, z.content);
    } else if (z.content?.type === "url") {
      renderUrlZone(div, z.content);
    } else if (z.content?.type === "clock") {
      renderClockZone(div, z.content);
    } else if (z.content?.type === "announcement") {
      renderAnnouncementZone(div, z.content);
      annZoneContainers.push({ el: div, cfg: z.content });
    }
    wrap.appendChild(div);
  });

  // After page renders, refresh announcements into zones (or hide bar if no zone)
  updateAnnouncements(annQueue);

  $("h-page").textContent = `${page.name || pageIdx + 1}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE TRANSITIONS
// ─────────────────────────────────────────────────────────────────────────────
function schedulePageAdvance(pageList, idx, transition) {
  clearTimeout(pageTimer);
  if (pageList.length <= 1) return;
  if (transition?.mode !== "auto") return;

  const secs = Math.max(3, transition.seconds || 10) * 1000;
  pageTimer  = setTimeout(() => {
    const nextIdx = (idx + 1) % pageList.length;
    pageIdx       = nextIdx;
    fadeTransition(() => {
      renderPage(pageList[nextIdx]);
      schedulePageAdvance(pageList, nextIdx, transition);
    });
  }, secs);
}

function fadeTransition(cb) {
  const wrap = $("canvas-wrap");
  wrap.style.transition = "opacity .4s ease";
  wrap.style.opacity    = "0";
  setTimeout(() => {
    cb();
    wrap.style.opacity = "1";
    setTimeout(() => wrap.style.transition = "", 420);
  }, 420);
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA ZONE ENGINE
// ─────────────────────────────────────────────────────────────────────────────
class MediaZoneEngine {
  constructor(container, content) {
    this.container = container;
    this.content   = content;           // keep reference for fitMode etc.
    this.items     = content.mediaItems || [];
    this.idx       = 0;
    this.timer     = null;
    this.elements  = [];
  }

  start() {
    if (this.items.length === 0) return;

    const wrap = el("div", "zone-media");
    this.container.appendChild(wrap);
    this._wrap = wrap;

    // Pre-create media elements for crossfade
    this.items.forEach((item, i) => {
      const elem = this._createElement(item);
      elem.dataset.idx = i;
      elem.dataset.id  = item.id;
      if (i === 0) elem.classList.add("active");
      wrap.appendChild(elem);
      this.elements.push(elem);
    });

    this._scheduleNext(0);
  }

  /** Build an iframe for a widget mediaItem.
   *  Uses srcdoc to bypass Supabase Storage's CSP (default-src 'none'; sandbox)
   *  which blocks all scripts and external resources. */
  _createWidgetFrame(item) {
    const wc = item.widgetConfig || {};
    // Collect params into plain object for window.__widgetParams injection
    const params = Object.assign({}, wc.params || {});
    if (wc.bgColor)     params.bgColor     = wc.bgColor;
    if (wc.textColor)   params.textColor   = wc.textColor;
    if (wc.accentColor) params.accentColor = wc.accentColor;
    if (wc.animation)   params.animation   = wc.animation;

    const frame = el("iframe", "media-item");
    frame.style.cssText = [
      "border:none", "position:absolute", "inset:0",
      "width:100%", "height:100%",
      `background:${wc.bgColor || "#000"}`,
    ].join(";");

    if (wc.url) {
      console.log("[DBG] widget fetch:", wc.url, JSON.stringify(params));
      fetch(wc.url)
        .then((r) => r.text())
        .then((html) => {
          // Inject <base> for relative paths + __widgetParams before widget's own script
          const inject = `<base href="${wc.url}"><script>window.__widgetParams=${JSON.stringify(params)};\x3C/script>`;
          const patched = /<head/i.test(html)
            ? html.replace(/(<head[^>]*>)/i, `$1${inject}`)
            : inject + html;
          frame.srcdoc = patched;
        })
        .catch((e) => {
          console.error("[Player] widget fetch failed:", e);
          frame.src = `${wc.url}?${new URLSearchParams(params)}`;
        });
    }
    return frame;
  }

  _createElement(item) {
    // fitMode: per-item > zone default (content.fitMode) > "cover"
    // cover-x / cover-y are ContentStudio's axis-specific cover modes → CSS cover
    const fitMap = { cover: "cover", "cover-x": "cover", "cover-y": "cover", contain: "contain", stretch: "fill", fill: "fill", fit: "contain" };
    const zoneFit = this.content?.fitMode;
    const rawFit  = item.fitMode || zoneFit || "cover";
    const cssFit  = fitMap[rawFit] || "cover";

    if (item.type === "widget") {
      const frame = this._createWidgetFrame(item);
      return frame;
    } else if (item.type === "video") {
      const v = el("video", "media-item");
      v.src        = item.url;
      v.muted      = (item.volume ?? 0) === 0;
      v.volume     = Math.min(1, (item.volume ?? 0) / 100);
      v.playsInline = true;
      v.preload    = "auto";
      v.style.objectFit = cssFit;
      v.addEventListener("ended", () => this._advance());
      return v;
    } else {
      const img = el("img", "media-item");
      img.src          = item.url;
      img.loading      = "eager";
      img.decoding     = "async";
      img.style.objectFit = cssFit;
      return img;
    }
  }

  _scheduleNext(idx) {
    const item = this.items[idx];
    if (!item) return;

    const elem = this.elements[idx];
    if (item.type === "video") {
      elem.play().catch(() => {});
      // duration governed by video ended event
    } else {
      const dwell = Math.max(1, item.duration || 7) * 1000;
      this.timer  = setTimeout(() => this._advance(), dwell);
    }

    // Log playback
    window.player.addLog({
      media_id:        item.id,
      media_name:      item.name,
      duration_seconds: item.duration || 0,
    });
    logCount++;
    $("h-logs").textContent = logCount;
  }

  _advance() {
    clearTimeout(this.timer);
    // Single item — just reschedule, no crossfade (prevents widget/image flash)
    if (this.items.length <= 1) {
      this._scheduleNext(0);
      return;
    }
    const prev    = this.idx;
    this.idx      = (this.idx + 1) % this.items.length;
    const current = this.elements[this.idx];
    const prevEl  = this.elements[prev];

    current.classList.add("active");
    prevEl.classList.remove("active");

    if (this.items[this.idx]?.type === "video") {
      current.currentTime = 0;
    }
    this._scheduleNext(this.idx);
  }

  stop() {
    clearTimeout(this.timer);
    this.elements.forEach((e) => {
      if (e.tagName === "VIDEO") { e.pause(); e.src = ""; }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXT, URL, CLOCK, ANNOUNCEMENT ZONES
// ─────────────────────────────────────────────────────────────────────────────
function renderTextZone(container, content) {
  const div  = el("div", "zone-text");
  const raw  = content.value || "";
  // Support rich text HTML (from RichTextEditor) or plain text
  div.innerHTML = raw.startsWith("<") ? raw : `<span>${raw}</span>`;
  div.style.cssText = [
    `font-size:${content.fontSize || 18}px`,
    `color:${content.textColor || "#fff"}`,
    `font-weight:${content.fontWeight || "normal"}`,
    `text-align:${content.textAlign || "center"}`,
    `line-height:${content.lineHeight || 1.4}`,
  ].join(";");
  container.appendChild(div);
}

function renderUrlZone(container, content) {
  const iframe = el("iframe");
  iframe.src   = content.value || "";
  iframe.style.cssText = "width:100%;height:100%;border:none;pointer-events:none";
  iframe.sandbox       = "allow-scripts allow-same-origin allow-forms";
  container.appendChild(iframe);
}

/** Render a type:"widget" zone (single widgetConfig, no carousel). */
function renderWidgetZone(container, wc) {
  const params = Object.assign({}, wc.params || {});
  if (wc.bgColor)     params.bgColor     = wc.bgColor;
  if (wc.textColor)   params.textColor   = wc.textColor;
  if (wc.accentColor) params.accentColor = wc.accentColor;
  if (wc.animation)   params.animation   = wc.animation;

  const frame = el("iframe");
  frame.style.cssText = `position:absolute;inset:0;width:100%;height:100%;border:none;background:${wc.bgColor || "#000"}`;
  container.appendChild(frame);

  if (wc.url) {
    fetch(wc.url)
      .then((r) => r.text())
      .then((html) => {
        const inject = `<base href="${wc.url}"><script>window.__widgetParams=${JSON.stringify(params)};\x3C/script>`;
        const patched = /<head/i.test(html)
          ? html.replace(/(<head[^>]*>)/i, `$1${inject}`)
          : inject + html;
        frame.srcdoc = patched;
      })
      .catch(() => { frame.src = `${wc.url}?${new URLSearchParams(params)}`; });
  }
}

function renderClockZone(container, content) {
  const div = el("div", "zone-text");
  div.style.cssText = `font-size:${content.fontSize || 48}px;color:${content.textColor || "#fff"};font-weight:600`;
  container.appendChild(div);
  const tick = () => {
    const now = new Date();
    div.textContent = now.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };
  tick();
  const id = setInterval(tick, 1000);
  container._clockId = id;
}

function renderAnnouncementZone(container, content) {
  // Build inline ticker structure — styled from zone content config
  const cfg       = content?.config || {};
  const textColor = cfg.textColor  || "#ffffff";
  const badgeColor= cfg.badgeColor || "#ef4444";
  const badgeText = cfg.badgeText  || "公告";
  const fontSize  = cfg.fontSize   || 15;
  const showBadge = cfg.showBadge  !== false;

  container.style.display    = "flex";
  container.style.alignItems = "center";
  container.style.overflow   = "hidden";
  container.style.background = container.style.background || "rgba(0,0,0,.85)";

  if (showBadge) {
    const badge = el("div");
    badge.className = "ann-zone-badge";
    badge.textContent = badgeText;
    badge.style.cssText = [
      `background:${badgeColor}`, `color:#fff`,
      `font-size:${Math.max(10, fontSize - 3)}px`, `font-weight:700`,
      `flex-shrink:0`, `height:100%`, `padding:0 12px`,
      `display:flex`, `align-items:center`,
      `letter-spacing:.5px`, `text-transform:uppercase`, `white-space:nowrap`,
    ].join(";");
    container.appendChild(badge);
  }

  const track = el("div");
  track.style.cssText = "flex:1;overflow:hidden;height:100%;display:flex;align-items:center";

  const ticker = el("div");
  ticker.id    = `ann-zone-ticker-${Date.now()}`;
  ticker.style.cssText = [
    `white-space:nowrap`, `font-size:${fontSize}px`,
    `color:${textColor}`, `padding-left:16px`,
    `animation:ticker linear infinite`, `animation-play-state:paused`,
  ].join(";");

  track.appendChild(ticker);
  container.appendChild(track);
  // Store ticker ref on container for later updates
  container._annTicker = ticker;
  container._annConfig = cfg;
}

// ─────────────────────────────────────────────────────────────────────────────
// BGM
// ─────────────────────────────────────────────────────────────────────────────
function startBgm(bgm, channelVolume) {
  if (!bgm?.items?.length) { stopBgm(); return; }
  bgmMeta = bgm;
  bgmIdx  = 0;
  const audio  = $("bgm-audio");
  const vol    = Math.min(1, ((bgm.audioSource === "bgm" ? bgm.volume : channelVolume) || 30) / 100);
  audio.volume = vol;
  playBgmItem(0);
}

function playBgmItem(idx) {
  const audio = $("bgm-audio");
  const item  = bgmMeta?.items?.[idx];
  if (!item) return;
  audio.src  = item.url;
  audio.loop = bgmMeta.items.length === 1;
  audio.play().catch(() => {});
  audio.onended = () => {
    const next = (idx + 1) % bgmMeta.items.length;
    playBgmItem(next);
  };
}

function stopBgm() {
  const audio = $("bgm-audio");
  audio.pause();
  audio.src = "";
}

// ─────────────────────────────────────────────────────────────────────────────
// ANNOUNCEMENTS
// ─────────────────────────────────────────────────────────────────────────────
function updateAnnouncements(list) {
  annQueue = list;

  // Pinned announcement: always show as full-screen overlay regardless of zones
  const pinned = list.find((a) => a.pinned);
  if (pinned && pinnedAnn?.id !== pinned.id) {
    showPinnedAnn(pinned);
  } else if (!pinned) {
    hidePinnedAnn();
  }

  // Ticker: ONLY render if current page has an announcement zone
  const normal = list.filter((a) => !a.pinned);

  if (annZoneContainers.length > 0) {
    // Zone-controlled mode — render inside each announcement zone, hide global bar
    $("announcement-bar").classList.remove("visible");
    if (normal.length > 0) {
      annZoneContainers.forEach(({ el: container }) => {
        renderZoneTicker(container, normal);
      });
    } else {
      // No non-pinned announcements — blank the zone ticker
      annZoneContainers.forEach(({ el: container }) => {
        if (container._annTicker) {
          container._annTicker.textContent = "";
          container._annTicker.style.animationPlayState = "paused";
        }
      });
    }
  } else {
    // No announcement zone in current project — hide global bar entirely
    $("announcement-bar").classList.remove("visible");
  }
}

/** Render announcement text into a zone's built-in ticker element */
function renderZoneTicker(container, items) {
  const ticker = container._annTicker;
  if (!ticker) return;

  const cfg      = container._annConfig || {};
  const speed    = cfg.speed || 80; // px/s

  const texts = items.map((a) => `【${a.subject}】 ${stripHtml(a.content)}`).join("　　　　");
  const full  = texts + "　　　　" + texts; // duplicate for seamless loop

  ticker.textContent = full;

  // Calculate duration from content width
  requestAnimationFrame(() => {
    const w = ticker.scrollWidth / 2 || 1000;
    const dur = Math.max(8, w / speed);
    ticker.style.animationDuration    = `${dur}s`;
    ticker.style.animationPlayState   = "running";
  });
}

function showPinnedAnn(ann) {
  clearTimeout(pinnedTimer);
  pinnedAnn = ann;

  $("ann-subj").textContent = ann.subject;
  $("ann-body").innerHTML   = ann.content || "";
  $("ann-overlay").classList.add("visible");

  const dwell = Math.max(5, ann.dwell_seconds || 10) * 1000;
  const bar   = $("ann-timer-bar");
  bar.style.width      = "100%";
  bar.style.transition = `width ${dwell / 1000}s linear`;
  setTimeout(() => bar.style.width = "0%", 50);

  pinnedTimer = setTimeout(hidePinnedAnn, dwell);
}

function hidePinnedAnn() {
  clearTimeout(pinnedTimer);
  pinnedAnn = null;
  $("ann-overlay").classList.remove("visible");
}

// ─────────────────────────────────────────────────────────────────────────────
// NO-CONTENT / STANDBY
// ─────────────────────────────────────────────────────────────────────────────
function showNoContent(show) {
  if (show) {
    stopAllEngines();
    $("no-content").classList.add("visible");
    $("canvas-wrap").innerHTML = "";
  } else {
    $("no-content").classList.remove("visible");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────────────────────────
function stopAllEngines() {
  clearTimeout(pageTimer);
  Object.values(zoneEngines).forEach((e) => e.stop?.());
  zoneEngines       = {};
  annZoneContainers = [];
  // Clear clock intervals
  document.querySelectorAll("[data-clock-id]").forEach((e) => clearInterval(e._clockId));
}

// ─────────────────────────────────────────────────────────────────────────────
// HUD
// ─────────────────────────────────────────────────────────────────────────────
function updateHud(data) {
  $("h-screen").textContent  = data.screen?.name  || "—";
  $("h-channel").textContent = data.channel?.name || "無";
  $("h-project").textContent = data.project?.name || "無";
  $("h-sync").textContent    = fmtTime(data.server_time);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION DOT
// ─────────────────────────────────────────────────────────────────────────────
function setConnDot(state) {
  const dot = $("conn-dot");
  dot.className = state;  // "online" | "offline" | "syncing"
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD SHORTCUTS (in-renderer)
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "F11") window.player.toggleFullscreen();
  if (e.key === "Escape" && $("settings-panel").classList.contains("visible")) closeSettings();
  if (e.key === "Escape" && $("ann-overlay").classList.contains("visible")) hidePinnedAnn();
  // Manual page advance with arrow keys
  if (e.key === "ArrowRight" && pages.length > 1) {
    clearTimeout(pageTimer);
    const nextIdx = (pageIdx + 1) % pages.length;
    pageIdx       = nextIdx;
    fadeTransition(() => renderPage(pages[nextIdx]));
  }
  if (e.key === "ArrowLeft" && pages.length > 1) {
    clearTimeout(pageTimer);
    const prevIdx = (pageIdx - 1 + pages.length) % pages.length;
    pageIdx       = prevIdx;
    fadeTransition(() => renderPage(pages[prevIdx]));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  const ver = await window.player.getVersion();
  $("h-ver").textContent = ver;

  cfg = await window.player.getConfig();

  // Pre-fill setup fields
  $("cfg-url").value    = cfg.supabaseUrl  || "";
  $("cfg-anon").value   = cfg.anonKey      || "";
  $("cfg-token").value  = cfg.deviceToken  || "";

  if (cfg.deviceToken && cfg.supabaseUrl) {
    showScreen("screen-player");
    showNoContent(true);
    setConnDot("syncing");
    await window.player.forceSync();
  } else {
    showScreen("screen-setup");
  }
})();

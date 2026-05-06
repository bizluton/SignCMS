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
let annQueue    = [];        // active announcements
let annTimer    = null;
let pinnedAnn   = null;
let pinnedTimer = null;
let projectId   = null;      // track to detect content changes

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

  // Find _meta block
  const meta = Array.isArray(zones) ? zones.find((z) => z._meta === true) : null;

  if (meta?.pages?.length > 0) {
    renderNewFormat(meta, channel);
  } else if (Array.isArray(zones)) {
    // Fallback: old flat zones format
    renderFlatZones(zones.filter((z) => !z._meta), channel);
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
  zoneEngines    = {};

  (page.zones || []).forEach((z) => {
    const div = el("div", "zone");
    div.id    = `zone-${z.id}`;
    div.style.cssText = [
      `left:${z.x}%`, `top:${z.y}%`,
      `width:${z.w}%`, `height:${z.h}%`,
      `background:${z.content?.bgColor || "#111"}`,
    ].join(";");

    if (z.content?.type === "media" && z.content.mediaItems?.length > 0) {
      const engine = new MediaZoneEngine(div, z.content);
      engine.start();
      zoneEngines[z.id] = engine;
    } else if (z.content?.type === "text") {
      renderTextZone(div, z.content);
    } else if (z.content?.type === "url") {
      renderUrlZone(div, z.content);
    } else if (z.content?.type === "clock") {
      renderClockZone(div, z.content);
    } else if (z.content?.type === "announcement") {
      renderAnnouncementZone(div);
    }
    wrap.appendChild(div);
  });

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
    this.items     = content.mediaItems || [];
    this.idx       = 0;
    this.timer     = null;
    this.elements  = [];
  }

  start() {
    if (this.items.length === 0) return;
    const wrap = el("div", "zone-media");
    this.container.appendChild(wrap);

    // Pre-create media elements for crossfade
    this.items.forEach((item, i) => {
      const elem = this._createElement(item);
      elem.dataset.idx   = i;
      elem.dataset.id    = item.id;
      if (i === 0) elem.classList.add("active");
      wrap.appendChild(elem);
      this.elements.push(elem);
    });

    this._scheduleNext(0);
  }

  _createElement(item) {
    if (item.type === "video") {
      const v = el("video", "media-item");
      v.src   = item.url;
      v.muted = (item.volume ?? 0) === 0;
      v.volume= Math.min(1, (item.volume ?? 0) / 100);
      v.playsInline = true;
      v.preload= "auto";
      v.addEventListener("ended", () => this._advance());
      return v;
    } else {
      const img = el("img", "media-item");
      img.src     = item.url;
      img.loading = "eager";
      img.decoding= "async";
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

function renderAnnouncementZone(container) {
  const div       = el("div", "zone-text");
  div.id          = `ann-zone-${Date.now()}`;
  div.style.cssText = "font-size:16px;color:#fbbf24;text-align:left;align-items:flex-start;overflow:hidden";
  container.appendChild(div);
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
  if (!list.length) {
    $("announcement-bar").classList.remove("visible");
    hidePinnedAnn();
    return;
  }

  // Handle pinned (full-screen overlay) first
  const pinned = list.find((a) => a.pinned);
  if (pinned && pinnedAnn?.id !== pinned.id) {
    showPinnedAnn(pinned);
  } else if (!pinned) {
    hidePinnedAnn();
  }

  // Ticker bar for non-pinned
  const normal = list.filter((a) => !a.pinned);
  if (normal.length) {
    updateTicker(normal);
  } else {
    $("announcement-bar").classList.remove("visible");
  }
}

function updateTicker(items) {
  const bar    = $("announcement-bar");
  const ticker = $("ann-ticker");
  const badge  = $("ann-badge");

  badge.textContent = "公告";
  badge.className   = "ann-badge";

  // Duplicate for seamless loop
  const texts = items.map((a) => `【${a.subject}】${stripHtml(a.content)}`).join("　　　　");
  const full  = texts + "　　　　" + texts;
  ticker.textContent = full;

  // Adjust animation speed (≈100px/s)
  const charPx   = ticker.scrollWidth / 2;
  const duration = Math.max(10, charPx / 100);
  ticker.style.animationDuration = `${duration}s`;
  ticker.style.animationPlayState = "running";

  bar.classList.add("visible");
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
  zoneEngines = {};
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

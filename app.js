/* 「今日热搜」前端逻辑 ｜ 首页三栏版（按 PRD 重建首页）
   职责：
     ① 拉数据（当前 data/hot.json 样本；接云函数时只改 DATA_URL 一行）
     ② 渲染三栏榜单（微博 / 抖音 / B站，每栏 Top 10）
     ③ 四种页面状态：加载中 / 成功 / 空 / 错误（绝不显示空白页）
     ④ 详情弹层（PRD F2）、本地收藏 + 备注（PRD F3）、手动 + 定时刷新（PRD F4）
   明确不做（PRD 3.2）：登录、支付、个性化推荐 */

// ===== 配置区（想调整榜单，改这里就够了）=====

// ① 首页展示哪些平台、按什么顺序（要和 styles.css 里的 --cols 条数保持一致）
const PLATFORM_ORDER = ["微博", "抖音", "B站"];

// ② 每个平台展示多少条（PRD F1：各 Top 10）
const TOP_N = 10;

// ③ 数据地址：阶段 2 接云函数时只改这一行
const DATA_URL = "data/hot.json";

// ④ 自动刷新间隔（PRD F4：≥10 分钟）
const AUTO_REFRESH_MINUTES = 10;

// ⑤ 收藏本地存储键（带版本号，方便以后改结构）
const STORAGE_KEY = "hot_favorites_v1";

// 默认提示条文案（更新失败时会被临时替换）
const NOTICE_DEFAULT = "当前为本地样本数据（标题、热度均为示例）；接上云函数后自动换成真实热搜。";

// ===== 运行状态 =====
let hotData = null;       // 最近一次成功拿到的数据（更新失败时继续用它展示）
let currentDetail = null; // 详情弹层当前展示的条目

// ===== 小工具 =====
const $ = (id) => document.getElementById(id);

// 转义，防止标题里的 < > 等字符破坏页面结构
function esc(s) {
  return String(s === null || s === undefined ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// 时间：ISO 字符串 → "12:30"
function fmtTime(iso) {
  const t = new Date(iso);
  if (isNaN(t)) return "--:--";
  return String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
}

// 热度：4863210 → 486.3万（只改显示，不改数据）
function fmtHeat(heat) {
  if (heat === null || heat === undefined || heat === "") return "";
  const n = Number(String(heat).replace(/,/g, ""));
  if (!isFinite(n) || n === 0) return String(heat); // 不是数字就原样显示
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(heat);
}

function nowIso() { return new Date().toISOString(); }

// ===== 收藏读写（localStorage，绝不上传服务器）=====
function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return []; // 解析失败当作空（PRD 第 7 节降级）
  }
}

function saveFavorites(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    // 隐私模式等场景：提示但不影响浏览（PRD 第 7 节）
    alert("当前浏览器环境不支持保存收藏，本次收藏不会保留。");
    return false;
  }
}

// 同一条热搜的唯一标识：平台 + 标题
function favKey(item) { return item.platform + "::" + item.title; }

function isFaved(item) { return loadFavorites().some((f) => f.id === favKey(item)); }

function toggleFav(item) {
  let list = loadFavorites();
  const key = favKey(item);
  if (list.some((f) => f.id === key)) {
    list = list.filter((f) => f.id !== key); // 取消收藏
  } else {
    list.push({
      id: key,
      platform: item.platform,
      title: item.title,
      url: item.url,
      note: "",
      saved_at: nowIso(),
    });
  }
  saveFavorites(list);
  refreshFavBadge();
  return isFaved(item);
}

function refreshFavBadge() { $("fav-count").textContent = loadFavorites().length; }

// ===== 可复用组件 1：单条热搜卡片 =====
// 一行结构：序号｜标题（超长截断）｜热度（靠右）｜收藏星标
function createItemRow(item) {
  const row = document.createElement("div");
  const faved = isFaved(item);
  row.className = "item" + (faved ? " faved" : "");
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.setAttribute("aria-label", item.platform + " 第 " + item.rank + " 位：" + item.title);

  // 热度格即使没有热度值也要占位，保证每行的"热度在右"是对齐的
  const heatHtml = item.heat
    ? '<span class="item-heat">' + esc(fmtHeat(item.heat)) + "</span>"
    : '<span class="item-heat"></span>';

  row.innerHTML =
    '<span class="item-rank' + (item.rank <= 3 ? " item-rank-top" : "") +
      (item.rank === 1 ? " item-rank-1" : "") + '">' + esc(item.rank) + "</span>" +
    '<span class="item-title">' + esc(item.title) + "</span>" +
    heatHtml +
    '<button class="item-star' + (faved ? " faved" : "") +
      '" type="button" aria-label="收藏这条热搜">★</button>';

  // 点整行 → 打开详情
  row.addEventListener("click", () => openDetail(item));
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(item); }
  });
  // 点星标 → 只收藏，不打开详情
  row.querySelector(".item-star").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFav(item);
    renderBoard();
    if (currentDetail && favKey(currentDetail) === favKey(item)) syncDetailFavBtn();
  });
  return row;
}

// ===== 可复用组件 2：整页状态视图（加载中 / 空 / 错误）=====
function renderState(kind) {
  const board = $("board");
  board.innerHTML = "";

  const box = document.createElement("div");
  box.className = "state-block state-" + kind;

  if (kind === "loading") {
    // 加载中：骨架屏占位，用户知道"在干活"，而不是白屏
    let cols = "";
    for (let i = 0; i < PLATFORM_ORDER.length; i++) {
      cols += '<div class="skeleton-col"><div class="skeleton"></div><div class="skeleton"></div>' +
              '<div class="skeleton"></div><div class="skeleton"></div></div>';
    }
    box.innerHTML =
      '<div class="state-icon">⏳</div>' +
      '<p class="state-text">正在获取最新热搜…</p>' +
      '<div class="skeleton-wrap">' + cols + "</div>";
  } else if (kind === "empty") {
    // 空：请求成功，但一条热搜都没有
    box.innerHTML =
      '<div class="state-icon">🍃</div>' +
      '<p class="state-text">今天还没有热搜数据</p>' +
      '<p class="state-sub">稍后点「刷新」再看看</p>' +
      '<button class="btn" id="state-retry" type="button">刷新试试</button>';
  } else {
    // 错误：请求失败（网络断了、服务没起等）
    box.innerHTML =
      '<div class="state-icon">⚠️</div>' +
      '<p class="state-text">数据获取失败</p>' +
      '<p class="state-sub">可能是网络问题，稍后重试即可</p>' +
      '<button class="btn btn-primary" id="state-retry" type="button">重新加载</button>';
  }

  board.appendChild(box);

  const retry = $("state-retry");
  if (retry) retry.addEventListener("click", handleRetry);
}

// 重试：若是在用 ?state= 预览，则清参回到正常加载；否则重新拉数据
function handleRetry() {
  if (new URLSearchParams(location.search).get("state")) {
    location.href = location.pathname;
    return;
  }
  loadData();
}

// ===== 渲染三栏榜单 =====
// 从数据里取出某个平台这一栏该显示的条目（按序号排序、最多 TOP_N 条）
function itemsOfPlatform(name) {
  return (hotData.items || [])
    .filter((it) => it.platform === name)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, TOP_N);
}

// 查某个平台的状态（数据里没写就默认正常）
function platformMeta(name) {
  return ((hotData && hotData.platforms) || []).find((p) => p.name === name) || { name: name, ok: true };
}

function renderBoard() {
  const board = $("board");
  board.innerHTML = "";

  PLATFORM_ORDER.forEach((name) => {
    const meta = platformMeta(name);
    const items = meta.ok === false ? [] : itemsOfPlatform(name);

    const col = document.createElement("section");
    col.className = "column";

    const head = document.createElement("div");
    head.className = "column-head";
    head.innerHTML =
      '<span class="column-name">' + esc(name) + "</span>" +
      '<span class="column-count">' + (meta.ok === false ? "暂不可用" : items.length + " 条") + "</span>";
    col.appendChild(head);

    if (meta.ok === false) {
      // 降级：只影响本栏，其余平台照常（PRD 第 7 节 / B10）
      const down = document.createElement("div");
      down.className = "column-down";
      down.textContent = "暂时无法获取，稍后自动重试";
      col.appendChild(down);
      board.appendChild(col);
      return;
    }

    const body = document.createElement("div");
    body.className = "column-body";
    items.forEach((it) => body.appendChild(createItemRow(it)));
    col.appendChild(body);
    board.appendChild(col);
  });
}

// ===== 详情弹层（PRD F2）=====
function openDetail(item) {
  currentDetail = item;
  $("detail-platform").textContent = item.platform;
  $("detail-rank").textContent = "第 " + item.rank + " 位";
  $("detail-heat").textContent = item.heat ? "热度 " + fmtHeat(item.heat) : "";
  $("detail-time").textContent = item.time ? "上榜 " + item.time : "";
  $("detail-title").textContent = item.title;
  $("detail-link").href = item.url;

  const fav = loadFavorites().find((f) => f.id === favKey(item));
  syncDetailFavBtn();
  if (fav && fav.note) {
    $("note-view").textContent = "备注：" + fav.note;
    $("note-view").classList.remove("hidden");
  } else {
    $("note-view").classList.add("hidden");
  }
  $("note-area").classList.add("hidden");

  $("detail-overlay").classList.remove("hidden");
}

function syncDetailFavBtn() {
  $("detail-fav").textContent = currentDetail && isFaved(currentDetail) ? "★ 已收藏" : "☆ 收藏";
}

function closeDetail() {
  $("detail-overlay").classList.add("hidden");
  currentDetail = null;
}

// ===== 备注编辑（≤50 字，PRD F3 / 6.2）=====
function openNoteEditor() {
  if (!currentDetail) return;
  if (!isFaved(currentDetail)) {
    // 先收藏再写备注，避免出现"有备注没收藏"的孤儿数据
    toggleFav(currentDetail);
    renderBoard();
    syncDetailFavBtn();
  }
  const fav = loadFavorites().find((f) => f.id === favKey(currentDetail));
  const input = $("note-input");
  input.value = fav ? fav.note : "";
  $("note-count").textContent = input.value.length + "/50";
  $("note-area").classList.remove("hidden");
  input.focus();
}

function saveNote() {
  if (!currentDetail) return;
  const text = $("note-input").value.trim().slice(0, 50);
  const list = loadFavorites();
  const fav = list.find((f) => f.id === favKey(currentDetail));
  if (!fav) return;
  fav.note = text;
  saveFavorites(list);
  $("note-area").classList.add("hidden");
  if (text) {
    $("note-view").textContent = "备注：" + text;
    $("note-view").classList.remove("hidden");
  } else {
    $("note-view").classList.add("hidden");
  }
  renderFavorites(); // 抽屉同步
}

// ===== 收藏抽屉（PRD F3：按收藏时间倒序）=====
function renderFavorites() {
  const list = loadFavorites().sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1));
  const ul = $("fav-list");
  ul.innerHTML = "";

  if (list.length === 0) {
    ul.innerHTML = '<li class="fav-empty">还没有收藏，去榜单里点 ★ 试试</li>';
    return;
  }

  list.forEach((f) => {
    const li = document.createElement("li");
    li.className = "fav-item";
    li.innerHTML =
      '<div class="fav-item-title">' + esc(f.title) + "</div>" +
      '<div class="fav-item-meta">' + esc(f.platform) + " · 收藏于 " + fmtTime(f.saved_at) + "</div>" +
      (f.note ? '<div class="fav-item-note">备注：' + esc(f.note) + "</div>" : "") +
      '<div class="fav-item-actions">' +
        '<a class="btn btn-sm" href="' + esc(f.url) + '" target="_blank" rel="noopener">去原文 ↗</a>' +
        '<button class="btn btn-sm" data-act="remove" type="button">取消收藏</button>' +
      "</div>";
    li.querySelector('[data-act="remove"]').addEventListener("click", () => {
      saveFavorites(loadFavorites().filter((x) => x.id !== f.id));
      refreshFavBadge();
      renderFavorites();
      renderBoard();
    });
    ul.appendChild(li);
  });
}

function openFavorites() {
  renderFavorites();
  $("fav-overlay").classList.remove("hidden");
}

function closeFavorites() { $("fav-overlay").classList.add("hidden"); }

// ===== 数据加载：串起四种页面状态 =====
function loadData() {
  // 开发调试开关：地址后加 ?state=loading|empty|error 可强制预览某种状态
  const forced = new URLSearchParams(location.search).get("state");
  if (forced === "loading" || forced === "empty" || forced === "error") {
    $("updated-at").textContent = "状态预览：" + forced;
    renderState(forced);
    return;
  }

  // ① 加载中：先给反馈，避免白屏
  $("updated-at").textContent = hotData ? "更新中…" : "正在更新…";
  renderState("loading");

  fetch(DATA_URL)
    .then((res) => res.json())
    .then((data) => {
      hotData = data;
      $("updated-at").textContent = "更新于 " + fmtTime(data.updated_at);
      setNotice(NOTICE_DEFAULT, false);
      refreshFavBadge();

      // ② 空：请求成功，但配置的三个平台一条数据都没有
      const total = PLATFORM_ORDER.reduce((n, name) => n + itemsOfPlatform(name).length, 0);
      if (total === 0) {
        renderState("empty");
        return;
      }

      // ③ 成功：渲染三栏
      renderBoard();
    })
    .catch(() => {
      // ④ 错误：有旧数据就继续展示旧数据 + 原时间戳（PRD 第 7 节：绝不显示空白页）
      if (hotData) {
        $("updated-at").textContent = "更新于 " + fmtTime(hotData.updated_at);
        setNotice("更新失败，当前显示的是上一次成功的数据；稍后可点「刷新」重试。", true);
        renderBoard();
        return;
      }
      $("updated-at").textContent = "更新失败";
      renderState("error");
    });
}

function setNotice(text, warn) {
  const el = $("notice");
  el.textContent = text;
  el.classList.toggle("notice-warn", !!warn);
}

// ===== 事件绑定 =====
$("btn-refresh").addEventListener("click", loadData);   // 手动刷新（PRD F4）
$("btn-favorites").addEventListener("click", openFavorites);
$("detail-close").addEventListener("click", closeDetail);
$("fav-close").addEventListener("click", closeFavorites);
$("detail-fav").addEventListener("click", () => {
  if (!currentDetail) return;
  toggleFav(currentDetail);
  syncDetailFavBtn();
  renderBoard();
});
$("detail-note").addEventListener("click", openNoteEditor);
$("note-save").addEventListener("click", saveNote);
$("note-input").addEventListener("input", (e) => {
  $("note-count").textContent = e.target.value.length + "/50";
});

// 点弹层外部关闭（PRD 5.2）
$("detail-overlay").addEventListener("click", (e) => {
  if (e.target === $("detail-overlay")) closeDetail();
});
$("fav-overlay").addEventListener("click", (e) => {
  if (e.target === $("fav-overlay")) closeFavorites();
});
// Esc 关闭（PRD 5.2）
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeDetail(); closeFavorites(); }
});

// ===== 启动 =====
loadData();
setInterval(loadData, AUTO_REFRESH_MINUTES * 60 * 1000); // 自动刷新（PRD F4）

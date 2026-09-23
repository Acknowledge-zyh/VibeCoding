/* 「今日热搜」前端逻辑 ｜ MVP v1（Day 8）
   职责（对齐 TECH_DESIGN 7.1 步骤⑥-⑨）：
   ⑤ 渲染四列（失败板块降级提示） ⑥ 详情弹层 / 刷新 ⑧ 收藏写 localStorage ⑨ 下次打开读回
   数据来源：阶段 1 用 data/hot.json（样本）；阶段 2 只需把 DATA_URL 换成云函数 /api/hot 地址

   Day 8 新增：
   1. 四种页面状态：加载中 / 正常 / 空数据 / 出错（PRD 5.3）
   2. 可复用组件：createItemRow(条目卡片)、renderState(状态视图)
   3. 状态预览开关：地址后加 ?state=loading|empty|error 可强制查看某种状态（仅开发调试用） */

// ===== 配置 =====
// 阶段 2 接云函数时，只改这一行（TECH_DESIGN 6.1：API_BASE 收在一处）
const DATA_URL = "data/hot.json";
const AUTO_REFRESH_MINUTES = 10;      // PRD F4：自动刷新间隔 ≥10 分钟
const STORAGE_KEY = "hot_favorites_v1"; // TECH_DESIGN 5.4：带版本号的存储键

// ===== 状态 =====
let hotData = null;      // 最近一次成功拿到的 HotResponse
let currentDetail = null; // 详情弹层当前展示的条目

// ===== 工具 =====
const $ = (id) => document.getElementById(id);

function fmtTime(iso) {
  // "2026-09-22T12:30:00+08:00" → "12:30"
  const t = new Date(iso);
  if (isNaN(t)) return "--:--";
  return String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
}

function nowIso() { return new Date().toISOString(); }

// ===== 收藏读写（localStorage，绝不回传服务器）=====
function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return []; // 解析失败视为空（对应 PRD 第 7 节本地存储异常的降级）
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

function favKey(item) {
  // 同一条热搜的唯一标识：平台 + 标题（与 TECH_DESIGN 5.5 唯一键思路一致）
  return item.platform + "::" + item.title;
}

function isFaved(item) {
  return loadFavorites().some((f) => f.id === favKey(item));
}

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

function refreshFavBadge() {
  $("fav-count").textContent = loadFavorites().length;
}

// ===== 可复用组件 1：单条热搜卡片（Day 8 抽出，以后别处也能复用）=====
// 传入一条热搜数据，返回一个可直接插入页面的元素
function createItemRow(item) {
  const row = document.createElement("div");
  const faved = isFaved(item);
  row.className = "item" + (faved ? " faved" : "");
  row.innerHTML =
    '<span class="item-rank">' + item.rank + "</span>" +
    '<span class="item-title">' + item.title + "</span>" +
    (item.heat ? '<span class="item-heat">' + item.heat + " 热</span>" : "") +
    '<button class="item-star' + (faved ? " faved" : "") + '" aria-label="收藏">★</button>';

  // 点整行 → 详情弹层
  row.addEventListener("click", () => openDetail(item));
  // 点星标 → 收藏（阻止冒泡，不打开详情）
  row.querySelector(".item-star").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFav(item);
    renderBoard(); // 重新着色 + 角标
    if (currentDetail && favKey(currentDetail) === favKey(item)) syncDetailFavBtn();
  });
  return row;
}

// ===== 可复用组件 2：整页状态视图（加载中 / 空数据 / 出错）=====
// kind: "loading" | "empty" | "error"
function renderState(kind) {
  const board = $("board");
  board.innerHTML = "";

  const box = document.createElement("div");
  box.className = "state-block state-" + kind;

  if (kind === "loading") {
    // 加载中：骨架屏占位，让用户知道在干活，而不是白屏
    box.innerHTML =
      '<div class="state-icon">⏳</div>' +
      '<p class="state-text">正在获取最新热搜…</p>' +
      '<div class="skeleton-wrap">' +
        '<div class="skeleton-col"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>' +
        '<div class="skeleton-col"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>' +
        '<div class="skeleton-col"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>' +
        '<div class="skeleton-col"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>' +
      "</div>";
  } else if (kind === "empty") {
    // 空数据：请求成功，但一条热搜都没有
    box.innerHTML =
      '<div class="state-icon">🍃</div>' +
      '<p class="state-text">今天还没有热搜数据</p>' +
      '<p class="state-sub">稍后点「刷新」再看看</p>' +
      '<button class="btn" id="state-retry">刷新试试</button>';
  } else {
    // 出错：请求失败（网络问题、服务未启动等）
    box.innerHTML =
      '<div class="state-icon">⚠️</div>' +
      '<p class="state-text">数据获取失败</p>' +
      '<p class="state-sub">可能是网络问题，稍后重试即可</p>' +
      '<button class="btn btn-primary" id="state-retry">重新加载</button>';
  }

  board.appendChild(box);

  const retry = $("state-retry");
  if (retry) retry.addEventListener("click", handleRetry);
}

// 点「重新加载 / 刷新试试」：
// 如果是用 ?state= 强制预览的，就清掉参数回到正常加载；否则重新拉数据
function handleRetry() {
  if (new URLSearchParams(location.search).get("state")) {
    location.href = location.pathname;
    return;
  }
  loadData();
}

// ===== 渲染四列 =====
function renderBoard() {
  const board = $("board");
  board.innerHTML = "";

  hotData.platforms.forEach((p) => {
    const col = document.createElement("section");
    col.className = "column";

    const head = document.createElement("div");
    head.className = "column-head";
    const items = p.ok ? hotData.items.filter((it) => it.platform === p.name) : [];
    head.innerHTML =
      '<span class="column-name">' + p.name + "</span>" +
      '<span class="column-count">' + (p.ok ? items.length + " 条" : "暂不可用") + "</span>";
    col.appendChild(head);

    if (!p.ok) {
      // 降级：只影响本板块（PRD 第 7 节 / B10）
      const down = document.createElement("div");
      down.className = "column-down";
      down.textContent = "暂时无法获取，稍后自动重试";
      col.appendChild(down);
      board.appendChild(col);
      return;
    }

    // 用可复用组件逐条渲染
    items.forEach((it) => col.appendChild(createItemRow(it)));

    board.appendChild(col);
  });
}

// ===== 详情弹层（浮层 1）=====
function openDetail(item) {
  currentDetail = item;
  $("detail-platform").textContent = item.platform;
  $("detail-rank").textContent = "第 " + item.rank + " 位";
  $("detail-heat").textContent = item.heat ? "热度 " + item.heat : "";
  $("detail-time").textContent = item.time ? "上榜 " + item.time : "";
  $("detail-title").textContent = item.title;
  $("detail-link").href = item.url;

  // 备注回显
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
  const fav = currentDetail && isFaved(currentDetail);
  $("detail-fav").textContent = fav ? "★ 已收藏" : "☆ 收藏";
}

function closeDetail() {
  $("detail-overlay").classList.add("hidden");
  currentDetail = null;
}

// ===== 备注编辑 =====
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
  const text = $("note-input").value.trim().slice(0, 50); // PRD 6.2：备注 ≤50 字
  const list = loadFavorites();
  const fav = list.find((f) => f.id === favKey(currentDetail));
  if (fav) {
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
}

// ===== 收藏抽屉（浮层 2）=====
function renderFavorites() {
  const list = loadFavorites().sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1)); // 按收藏时间倒序（PRD F3）
  const ul = $("fav-list");
  ul.innerHTML = "";

  if (list.length === 0) {
    ul.innerHTML = '<li class="fav-empty">还没有收藏，去榜单里点 ★ 试试</li>';
    return;
  }

  list.forEach((f) => {
    const li = document.createElement("li");
    li.className = "fav-item";
    const noteHtml = f.note
      ? '<div class="fav-item-note">备注：' + f.note + "</div>"
      : "";
    li.innerHTML =
      '<div class="fav-item-title">' + f.title + "</div>" +
      '<div class="fav-item-meta">' + f.platform + " · 收藏于 " + fmtTime(f.saved_at) + "</div>" +
      noteHtml +
      '<div class="fav-item-actions">' +
        '<a class="btn btn-sm" href="' + f.url + '" target="_blank" rel="noopener">去原文 ↗</a>' +
        '<button class="btn btn-sm" data-act="remove">取消收藏</button>' +
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

function closeFavorites() {
  $("fav-overlay").classList.add("hidden");
}

// ===== 数据加载与刷新（Day 8：串联四种页面状态）=====
function loadData() {
  // 开发调试开关：地址后加 ?state=loading|empty|error 可强制展示某种状态（仅供打卡/演示）
  const forced = new URLSearchParams(location.search).get("state");
  if (forced === "loading" || forced === "empty" || forced === "error") {
    $("updated-at").textContent = "状态预览：" + forced;
    renderState(forced);
    return;
  }

  // ① 加载中：先给用户一个"正在干活"的反馈，避免白屏
  $("updated-at").textContent = "正在更新…";
  renderState("loading");

  fetch(DATA_URL)
    .then((res) => res.json())
    .then((data) => {
      hotData = data;
      $("updated-at").textContent = "更新于 " + fmtTime(data.updated_at);
      refreshFavBadge();

      // ② 空数据：请求成功但没有任何条目
      if (!data.items || data.items.length === 0) {
        renderState("empty");
        return;
      }

      // ③ 正常：渲染四列
      renderBoard();
    })
    .catch(() => {
      // ④ 出错：对齐 PRD 第 7 节，绝不显示空白页，给出重试入口
      $("updated-at").textContent = "更新失败";
      renderState("error");
    });
}

// ===== 事件绑定 =====
$("btn-refresh").addEventListener("click", loadData);            // 手动刷新（PRD F4）
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
  if (e.key === "Escape") {
    closeDetail();
    closeFavorites();
  }
});

// ===== 启动 =====
loadData();
setInterval(loadData, AUTO_REFRESH_MINUTES * 60 * 1000); // 自动刷新 ≥10 分钟（PRD F4）

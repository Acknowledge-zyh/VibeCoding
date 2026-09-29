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

// ⑥ ★ Day 12：收藏"写库"的模拟耗时（毫秒）。今天收藏先存前端本地（localStorage），不接数据库；
//    这 500ms 模拟未来真实接口的网络延迟，用来验证"处理中按钮不可重复点击"。
//    阶段 2 接后端时：把 persistFavorites 里的模拟换成真实 API 调用即可，界面逻辑一行不用改。
const FAV_SAVE_DELAY_MS = 500;

// 默认提示条文案（更新失败时会被临时替换）
const NOTICE_DEFAULT = "当前为本地样本数据（标题、热度均为示例）；接上云函数后自动换成真实热搜。";

// ===== 运行状态 =====
let hotData = null;       // 最近一次成功拿到的数据（更新失败时继续用它展示）
let currentDetail = null; // 详情弹层当前展示的条目
let filterKeyword = "";   // ★ Day 12：当前筛选关键词（trim 后；空串 = 不筛选）

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

  // ★ Day10：未收藏用空心 ☆、已收藏用实心 ★——原来两态都是实心 ★ 只靠颜色区分，
  //   色盲用户无法分辨（DR-6 不能只用颜色），且"实心=未收藏"语义反直觉；
  //   aria-label 也随状态变化，读屏器能读出当前是"收藏"还是"取消收藏"
  row.innerHTML =
    '<span class="item-rank' + (item.rank <= 3 ? " item-rank-top" : "") +
      (item.rank === 1 ? " item-rank-1" : "") + '">' + esc(item.rank) + "</span>" +
    '<span class="item-title">' + esc(item.title) + "</span>" +
    heatHtml +
    '<button class="item-star' + (faved ? " faved" : "") +
      '" type="button" aria-label="' + (faved ? "取消收藏这条热搜" : "收藏这条热搜") + '">' +
      (faved ? "★" : "☆") + "</button>";

  // 点整行 → 打开详情
  row.addEventListener("click", () => openDetail(item));
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(item); }
  });
  // 点星标 → 收藏/取消收藏（★ Day 12：走状态机，处理中防连点、失败自动回退），不打开详情
  row.querySelector(".item-star").addEventListener("click", (e) => {
    e.stopPropagation();
    requestToggleFav(item, row);   // ★ 把行节点直接传进去，处理中要切它的忙碌态
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
// ★ Day 12：ignoreFilter=true 时跳过关键词筛选——「空数据」判定和「匹配 x/30」
//   的分母必须用全量数据，否则一筛选整个页面就被误判成空状态
function itemsOfPlatform(name, ignoreFilter) {
  let items = (hotData.items || [])
    .filter((it) => it.platform === name)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, TOP_N);
  if (!ignoreFilter && filterKeyword) {
    // Skill 清单：标题包含即命中，不区分大小写（关键词已在 applyFilter 里 trim 过）
    const kw = filterKeyword.toLowerCase();
    items = items.filter((it) => it.title.toLowerCase().includes(kw));
  }
  return items;
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

    if (filterKeyword && items.length === 0) {
      // ★ Day 12 筛选无结果态（Skill 三态之二）：绝不空白，文案带关键词（esc 防注入）
      const none = document.createElement("div");
      none.className = "column-down column-none";
      none.textContent = "没有匹配「" + filterKeyword + "」的结果，可清除筛选";
      col.appendChild(none);
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
let detailScrollY = 0;    // ★ Day 10：详情弹层打开前的背景滚动位置（关闭时恢复）
let copyTimer = null;     // ★ Day 11：「已复制」状态自动恢复的计时器（连续点击时先清旧的）

/* ---------- ★ Day 11：复制链接 + 可感知反馈 ----------
   乐观反馈：点击【瞬间】按钮变「✓ 已复制」（绿色）+ 底部 toast 弹出——不等剪贴板结果，
   因为反馈必须 0 延迟才可感知；剪贴板真正失败时再回退按钮并提示手动复制。
   连续快速点击不报错：每次点击先 clearTimeout 取消上一次恢复，再重新计时。 */
function copyDetailLink() {
  const btn = $("detail-copy");
  const url = currentDetail ? currentDetail.url : "";
  if (!url) return;

  // ① 即时反馈（点击后 0ms）：变绿 + toast
  btn.textContent = "✓ 已复制";
  btn.classList.add("copied");
  showToast("链接已复制，可以去粘贴啦");
  if (copyTimer) clearTimeout(copyTimer);
  copyTimer = setTimeout(resetCopyBtn, 2500);

  // ② 真正执行复制；失败时回退反馈并提示手动方案
  const fail = () => {
    btn.textContent = "⧉ 复制链接";
    btn.classList.remove("copied");
    showToast("复制失败，请长按「去原平台查看」手动复制");
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).catch(fail);
  } else {
    // 兼容兜底：老浏览器没有 clipboard API 时用隐藏输入框 + execCommand
    const tmp = document.createElement("textarea");
    tmp.value = url;
    tmp.style.position = "fixed";
    tmp.style.opacity = "0";
    document.body.appendChild(tmp);
    tmp.select();
    try { if (!document.execCommand("copy")) fail(); } catch (e) { fail(); }
    document.body.removeChild(tmp);
  }
}

function resetCopyBtn() {
  $("detail-copy").textContent = "⧉ 复制链接";
  $("detail-copy").classList.remove("copied");
}

function showToast(text, keep) {
  const t = $("toast");
  t.textContent = text;
  t.classList.remove("hidden");
  // 强制重排后再加动画类，保证连续触发时动画能重新播放
  void t.offsetWidth;
  t.classList.add("show");
  if (showToast._timer) clearTimeout(showToast._timer);
  if (!keep) {
    showToast._timer = setTimeout(() => {
      t.classList.remove("show");
      t.classList.add("hidden");
    }, 2400);
  }   // keep=true 时不自动隐藏（仅供 ?copied=1 开发预览冻结画面用）
}

function openDetail(item) {
  currentDetail = item;
  $("detail-platform").textContent = item.platform;
  $("detail-rank").textContent = "第 " + item.rank + " 位";
  $("detail-heat").textContent = item.heat ? "热度 " + fmtHeat(item.heat) : "";
  $("detail-time").textContent = item.time ? "上榜 " + item.time : "";
  $("detail-title").textContent = item.title;
  $("detail-link").href = item.url;
  resetCopyBtn();   // ★ Day 11：换一条打开时，复制按钮恢复初始态（防止残留上一次的"已复制"）

  const fav = loadFavorites().find((f) => f.id === favKey(item));
  syncDetailFavBtn();
  if (fav && fav.note) {
    $("note-view").textContent = "备注：" + fav.note;
    $("note-view").classList.remove("hidden");
  } else {
    $("note-view").classList.add("hidden");
  }
  $("note-area").classList.add("hidden");

  // ★ Day 10 修复：弹层开着时锁住背景滚动（修复前手机上滑动会穿透到背后的列表，
  //   关掉弹层后发现页面不在刚才的位置；实测弹层开着 scrollTo(1500) 真滚到了 1460）
  detailScrollY = window.scrollY;                    // 记住打开前的位置
  document.body.style.position = "fixed";
  document.body.style.top = -detailScrollY + "px";   // 用负 top 冻结在原位（iOS 上也有效）
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";

  $("detail-overlay").classList.remove("hidden");
}

/* ---------- ★ Day 12：收藏交互状态机（今天先走前端临时状态，不接数据库）----------
   按钮共 5 个状态（详情按钮看文字、卡片星标看图标，两处始终同步）：
     ① 空闲·未收藏：详情「☆ 收藏」描边灰 ｜ 卡片 ☆、白底
     ② 处理中：详情「⏳ 保存中… / ⏳ 取消中…」半透明禁用 ｜ 卡片星标 … 禁用+呼吸动画
        —— disabled + favBusy 双保险，处理期间重复点击直接忽略
     ③ 已收藏：详情「★ 已收藏」红字淡红底 ｜ 卡片 ★、淡红底纹
     ④ 再点已收藏 → 取消中 → 回到 ①，toast「已取消收藏」
     ⑤ 失败：数据一点不动，按钮回退到点击前的样子，toast 显示可理解的提示
   persistFavorites 模拟"写数据库"的 500ms 网络耗时；阶段 2 换成真实 API，其余逻辑不变。 */

let favBusy = false;   // 处理中标记：为 true 时所有收藏点击直接忽略

// 模拟"写数据库"（约 500ms）。地址栏加 ?favfail=1 可强制失败——专门用来测试失败提示（仅开发用）
function persistFavorites(list) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (new URLSearchParams(location.search).get("favfail") === "1") {
        reject(new Error("模拟保存失败（?favfail=1 开关）"));
        return;
      }
      resolve(saveFavorites(list));
    }, FAV_SAVE_DELAY_MS);
  });
}

// 收藏/取消收藏的完整流程：状态切换 → 模拟写库 → 成功三处刷新 / 失败回退
async function requestToggleFav(item, row) {
  if (favBusy) return;               // 处理期间不可重复点击
  favBusy = true;

  const willFav = !isFaved(item);    // 本次点击要变成的状态
  const detailMatches = currentDetail && favKey(currentDetail) === favKey(item);

  // ① 进入"处理中"：卡片星标 + 详情按钮（若正开着同一条）都禁用
  setStarBusy(row, true);
  if (detailMatches) setDetailFavBusy(true, willFav);

  try {
    // 先算好新列表再"写库"，中途失败时原数据一点不动
    const key = favKey(item);
    let list = loadFavorites();
    if (willFav) {
      list.push({ id: key, platform: item.platform, title: item.title, url: item.url, note: "", saved_at: nowIso() });
    } else {
      list = list.filter((f) => f.id !== key);
    }
    await persistFavorites(list);    // ★ 今天的前端临时保存（500ms 模拟网络）

    // ② 成功：榜单卡片、详情按钮、顶栏计数三处同步，toast 告诉用户生效了
    renderBoard();
    refreshFavBadge();
    if (detailMatches) syncDetailFavBtn();
    showToast(willFav ? "★ 已收藏" : "已取消收藏");
  } catch (e) {
    // ③ 失败：数据没变；renderBoard / syncDetailFavBtn 会把按钮画回点击前的样子
    renderBoard();
    if (detailMatches) syncDetailFavBtn();
    showToast("收藏保存失败，请稍后再试");
  } finally {
    favBusy = false;
  }
}

// 处理中：把这条热搜的卡片星标切成忙碌样子（恢复交给 renderBoard 按真实数据重画）
function setStarBusy(row, busy) {
  if (!row || !row.isConnected) return;   // 行已被重画就放弃（renderBoard 会按真实数据重画）
  const star = row.querySelector(".item-star");
  star.disabled = busy;
  star.setAttribute("aria-busy", busy ? "true" : "false");
  if (busy) star.textContent = "…";
}

// 处理中：详情按钮文字 + 禁用态（恢复时统一走 syncDetailFavBtn 按真实数据重画）
function setDetailFavBusy(busy, willFav) {
  const btn = $("detail-fav");
  btn.disabled = busy;
  if (busy) {
    btn.textContent = willFav ? "⏳ 保存中…" : "⏳ 取消中…";
    btn.classList.remove("faved");
  } else {
    syncDetailFavBtn();
  }
}

function syncDetailFavBtn() {
  const faved = currentDetail && isFaved(currentDetail);
  $("detail-fav").textContent = faved ? "★ 已收藏" : "☆ 收藏";
  $("detail-fav").classList.toggle("faved", !!faved);
  $("detail-fav").disabled = false;   // 同步即恢复可点（弹层重开、成功、失败回退都经过这里）
}

function closeDetail() {
  $("detail-overlay").classList.add("hidden");
  currentDetail = null;

  // ★ Day 10 修复：弹层关了就解锁背景滚动，并回到打开前的位置
  if (document.body.style.position === "fixed") {
    const y = detailScrollY;
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, y);
  }
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
    const removeBtn = li.querySelector('[data-act="remove"]');
    removeBtn.addEventListener("click", () => {
      requestRemoveFav(f, removeBtn);   // ★ Day 12 续：走状态机（处理中防连点、失败回退）
    });
    ul.appendChild(li);
  });
}

function openFavorites() {
  renderFavorites();
  $("fav-overlay").classList.remove("hidden");
}

function closeFavorites() { $("fav-overlay").classList.add("hidden"); }

/* ---------- ★ Day 12 续：抽屉「取消收藏」接入状态机 ----------
   状态：①空闲「取消收藏」→ ②处理中「⏳ 取消中…」禁用（抽屉内所有移除按钮一起禁用，
   防并行写库）→ ③成功：该条消失、榜单行回 ☆、计数 -1、toast「已取消收藏」；
   ④失败：按钮回退、列表与计数不动，toast「收藏保存失败，请稍后再试」。
   复用 requestToggleFav 的 favBusy 防连点与 persistFavorites（?favfail=1 可测失败）。 */
async function requestRemoveFav(fav, btn) {
  if (favBusy) return;               // 处理期间不可重复点击
  favBusy = true;

  const detailMatches = currentDetail && favKey(currentDetail) === fav.id;

  setDrawerBusy(btn, true);          // ① 进入"处理中"
  if (detailMatches) setDetailFavBusy(true, false);

  try {
    await persistFavorites(loadFavorites().filter((f) => f.id !== fav.id));  // 模拟"写库"

    // ② 成功：抽屉、榜单、计数、详情按钮四处同步
    renderFavorites();
    renderBoard();
    refreshFavBadge();
    if (detailMatches) syncDetailFavBtn();
    showToast("已取消收藏");
  } catch (e) {
    // ③ 失败：数据没动，抽屉不重画，只把按钮画回点击前的样子
    setDrawerBusy(btn, false);
    if (detailMatches) syncDetailFavBtn();
    showToast("收藏保存失败，请稍后再试");
  } finally {
    favBusy = false;
  }
}

// 处理中：本按钮显示进度，抽屉里所有"取消收藏"一起禁用（防同时删两条互相覆盖）
function setDrawerBusy(btn, busy) {
  if (btn) {
    btn.disabled = busy;
    btn.textContent = busy ? "⏳ 取消中…" : "取消收藏";
  }
  document.querySelectorAll('[data-act="remove"]').forEach((b) => { b.disabled = busy; });
}

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
      const total = PLATFORM_ORDER.reduce((n, name) => n + itemsOfPlatform(name, true).length, 0);
      if (total === 0) {
        renderState("empty");
        return;
      }

      // ③ 成功：渲染三栏
      renderBoard();

      // 开发调试开关：?detail=open 自动打开第一条的详情弹层（仅预览用）
      if (new URLSearchParams(location.search).get("detail") === "open") {
        openDetail(hotData.items[0]);
        // ★ Day 11 预览：?copied=1 冻结呈现"已复制"反馈态（仅开发截图/测试用，不启动计时器）
        if (new URLSearchParams(location.search).get("copied") === "1") {
          $("detail-copy").textContent = "✓ 已复制";
          $("detail-copy").classList.add("copied");
          showToast("链接已复制，可以去粘贴啦", true);
        }
      }

      // ★ Day 12 预览开关：?filter=关键词 直接进入筛选后的状态（开发截图/测试用）
      const qf = new URLSearchParams(location.search).get("filter");
      if (qf) {
        $("filter-input").value = qf;
        applyFilter();
      }
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

// ★ Day 12 筛选交互（按 skills/filter-interaction/SKILL.md 实现）
$("filter-input").addEventListener("input", applyFilter);
$("filter-clear").addEventListener("click", clearFilter);

// 筛选入口：读输入框 → 更新全局关键词 → 只重画榜单和计数（不动数据源）
function applyFilter() {
  filterKeyword = $("filter-input").value.trim();   // Skill 清单：首尾空格要 trim
  $("filter-clear").disabled = filterKeyword === ""; // 无关键词时禁用但看得见
  if (hotData) renderBoard();
  updateFilterCount();
}

// 匹配计数（aria-live，读屏可播报）：分母用全量、分子用筛选后
function updateFilterCount() {
  const el = $("filter-count");
  if (!hotData || !filterKeyword) { el.textContent = ""; return; }
  const total = PLATFORM_ORDER.reduce((n, name) => n + itemsOfPlatform(name, true).length, 0);
  const matched = PLATFORM_ORDER.reduce((n, name) => n + itemsOfPlatform(name).length, 0);
  el.textContent = "匹配 " + matched + "/" + total + " 条";
}

// 清空恢复（Skill 三态之三）：恢复列表 + 禁用清除按钮 + 焦点回输入框
function clearFilter() {
  const input = $("filter-input");
  input.value = "";
  filterKeyword = "";
  $("filter-clear").disabled = true;
  if (hotData) renderBoard();
  updateFilterCount();
  input.focus();
}
$("detail-close").addEventListener("click", closeDetail);
$("fav-close").addEventListener("click", closeFavorites);
$("detail-fav").addEventListener("click", () => {
  if (currentDetail) requestToggleFav(currentDetail);   // ★ Day 12：走状态机（处理中防连点、失败回退）
});
$("detail-note").addEventListener("click", openNoteEditor);
$("detail-copy").addEventListener("click", copyDetailLink);   // ★ Day 11：复制链接
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

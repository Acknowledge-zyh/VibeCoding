/* 「今日热搜」前端逻辑 ｜ 三个可独立访问视图 + 四种状态
   ── 视图与路由（hash 路由，不用路由库：纯静态托管无需 rewrite、刷新/分享停在原视图、前进后退天然可用、零依赖）
      #/home            首页：榜单（桌面三栏 / 手机单列）+ 关键词 & 平台筛选
      #/home/<平台名>    首页·单平台（平台筛选预置，从平台列表页点进来）
      #/platforms       平台列表页：每个平台的条数、状态与 Top3 预览
      #/detail/<编码键>  热搜详情页：可独立打开、可分享、带同平台上下条
      空 hash / 未知路径 → #/home（兜底，绝不白屏）
   ── 两个浮层保留（PRD F2/F3 不破）：条目点击一律弹层；弹层里可「打开详情页」得到可分享的 URL
   ── 四种状态（每个列表视图都有，文案各自贴合场景，DR-11 差异 ≥2 维度）：
      加载中（骨架屏）/ 加载成功 / 没有结果（含筛选无匹配 + 数据为空）/ 请求失败（有旧数据则保留旧数据）
   路线职责：① 拉数据（阶段 1 用 data/hot.json 样本；接云函数时只改 DATA_URL 一行）
            ② 路由 → 视图渲染 ③ 四种状态 ④ 详情弹层 / 详情页 / 本地收藏 + 备注 / 手动 + 定时刷新
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

// ⑥ 收藏"写库"的模拟耗时（毫秒）。今天收藏先存前端本地（localStorage），不接数据库；
//    这 500ms 模拟未来真实接口的网络延迟，用来验证"处理中按钮不可重复点击"。
//    阶段 2 接后端时：把 persistFavorites 里的模拟换成真实 API 调用即可，界面逻辑一行不用改。
const FAV_SAVE_DELAY_MS = 500;

// ⑦ 条目点击的打开方式（两种都给实现了，改这一个字就行）：
//    "overlay" = 弹层（PRD F2 默认：不跳离页面，关闭后回到原位置）
//    "page"    = 直接进「热搜详情页」视图（地址栏变成 #/detail/...，可分享）
const DETAIL_OPEN_MODE = "overlay";

// 默认提示条文案（更新失败时会被临时替换）
const NOTICE_DEFAULT = "当前为本地样本数据（标题、热度均为示例）；接上云函数后自动换成真实热搜。";

// 状态预览开关的文字（?state=loading|empty|error）
const STATE_LABEL = { loading: "加载中", empty: "没有结果", error: "请求失败" };

// ===== 运行状态 =====
let hotData = null;              // 最近一次成功拿到的数据（更新失败时继续用它展示）
let dataPhase = "loading";       // loading | ready | failed —— 驱动所有视图的四种状态
let filterKeyword = "";          // 当前筛选关键词（trim 后；空串 = 不筛选）
let filterPlatform = "";         // 当前筛选平台（空串 = 全部；取值来自 PLATFORM_ORDER）
let currentRoute = { view: "home", platform: "", key: "" };
let currentDetail = null;        // 详情弹层当前展示的条目
let currentPageItem = null;      // 详情页当前展示的条目
let prevView = "";               // 上一次渲染的视图（判断"视图真的换了"才滚顶 + 关浮层）

// ===== 小工具 =====
const $ = (id) => document.getElementById(id);

// 建节点（用 textContent 落文字，天然防注入）
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

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

// 同一条热搜的唯一标识：平台 + 标题（也是详情页 URL 里用的 key）
function favKey(item) { return item.platform + "::" + item.title; }
function sameItem(a, b) { return !!a && !!b && favKey(a) === favKey(b); }

// ===== 路由：解析 hash → { view, platform, key } =====
function decodePart(s) {
  try { return decodeURIComponent(s || ""); } catch (e) { return String(s || ""); }
}

function parseRoute() {
  let h = location.hash || "";
  h = h.indexOf("#/") === 0 ? h.slice(2) : h.replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  if (parts.length === 0) return { view: "home", platform: "", key: "" };

  if (parts[0] === "platforms") return { view: "platforms", platform: "", key: "" };
  if (parts[0] === "detail") return { view: "detail", platform: "", key: decodePart(parts.slice(1).join("/")) };
  if (parts[0] === "home") {
    const p = decodePart(parts[1] || "");
    return { view: "home", platform: PLATFORM_ORDER.indexOf(p) !== -1 ? p : "", key: "" };
  }
  return { view: "home", platform: "", key: "", unknown: true };   // 未知路径 → 兜底回首页
}

function detailHash(item) { return "#/detail/" + encodeURIComponent(favKey(item)); }

// 视图渲染总入口：三视图显隐 + 导航高亮 + 筛选条显隐 + 分发到各视图渲染函数
function renderView() {
  const route = parseRoute();
  if (route.unknown) {
    // 未知路径（手改地址、老链接）→ 归一到 #/home，让"地址栏 = 当前视图"始终成立
    history.replaceState(null, "", location.pathname + location.search + "#/home");
    route.view = "home"; route.platform = ""; route.key = "";
    delete route.unknown;
  }
  currentRoute = route;
  const viewChanged = prevView !== "" && prevView !== route.view;

  $("view-home").classList.toggle("hidden", route.view !== "home");
  $("view-platforms").classList.toggle("hidden", route.view !== "platforms");
  $("view-detail").classList.toggle("hidden", route.view !== "detail");

  // 一级导航高亮：详情页要落到具体条目，不算一级入口，所以两个导航项都不高亮
  $("nav-home").setAttribute("aria-current", route.view === "home" ? "page" : "false");
  $("nav-platforms").setAttribute("aria-current", route.view === "platforms" ? "page" : "false");

  // 筛选条：两个列表视图共用；详情页是单条数据，不显示
  const isList = route.view === "home" || route.view === "platforms";
  $("filter-bar").classList.toggle("hidden", !isList);
  $("filter-bar-platform").classList.toggle("hidden", route.view !== "home");   // 平台筛选只在首页有意义

  // 视图真的换了才：关掉两个浮层（浮层不跨视图残留）+ 回到页顶
  if (viewChanged) { closeDetail(); closeFavorites(); window.scrollTo(0, 0); }
  prevView = route.view;

  // 平台筛选以 URL 为准（#/home/微博 ↔ chips 选中态）；离开首页时清空，避免"页面说自己还在筛平台"
  filterPlatform = route.view === "home" ? (route.platform || "") : "";
  syncPlatformChips();

  if (route.view === "home") { refreshFilterUI(); renderHome(); }
  else if (route.view === "platforms") { refreshFilterUI(); renderPlatforms(); }
  else { renderDetailPage(route.key); }

  // 非当前视图的内容清掉：保证同屏只有一个状态块（也避免重复 id）
  clearInactiveViews(route.view);
}

function clearInactiveViews(active) {
  if (active !== "home") $("board").innerHTML = "";
  if (active !== "platforms") { $("platform-grid").innerHTML = ""; $("platform-summary").textContent = ""; }
  if (active !== "detail") { $("detail-page").innerHTML = ""; $("detail-crumb").innerHTML = ""; }
}

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

function isFaved(item) { return loadFavorites().some((f) => f.id === favKey(item)); }

function toggleFav(item) {
  let list = loadFavorites();
  const key = favKey(item);
  if (list.some((f) => f.id === key)) {
    list = list.filter((f) => f.id !== key); // 取消收藏
  } else {
    list.push({ id: key, platform: item.platform, title: item.title, url: item.url, note: "", saved_at: nowIso() });
  }
  saveFavorites(list);
  refreshFavBadge();
  return isFaved(item);
}

function refreshFavBadge() { $("fav-count").textContent = loadFavorites().length; }

// ===== 可复用组件 1：单条热搜卡片 =====
// 一行结构：序号｜标题（超长截断）｜热度（靠右）｜收藏星标
// 点击行为全局统一：整行 → 打开详情（弹层 / 详情页由 DETAIL_OPEN_MODE 决定）；星标 → 收藏
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

  // 未收藏用空心 ☆、已收藏用实心 ★——不能只靠颜色区分（DR-6），aria-label 也随状态变化
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
  // 点星标 → 收藏/取消收藏（走状态机，处理中防连点、失败自动回退），不打开详情
  row.querySelector(".item-star").addEventListener("click", (e) => {
    e.stopPropagation();
    requestToggleFav(item, row);   // 把行节点直接传进去，处理中要切它的忙碌态
  });
  return row;
}

// ===== 可复用组件 2：四种状态的"状态块" =====
// 每种状态都必须有：图标 + 主文案 + 说明 + 出路（可点的下一步），绝不白屏（DR-11）
const STATE_TEXT = {
  home: {
    loading: { text: "正在获取最新热搜…" },
    empty: { icon: "🍃", text: "今天还没有热搜数据", sub: "数据源暂时没有返回内容，点「刷新试试」再拉一次", actionLabel: "刷新试试" },
    error: { icon: "⚠️", text: "数据获取失败", sub: "可能是网络断了或服务没起来，点下面按钮重试", actionLabel: "重新加载" },
  },
  platforms: {
    loading: { text: "正在获取平台数据…" },
    empty: { icon: "🍃", text: "暂时没有可用的平台", sub: "数据源没有返回任何平台，点「刷新试试」再拉一次", actionLabel: "刷新试试" },
    error: { icon: "⚠️", text: "平台列表获取失败", sub: "可能是网络问题，点下面按钮重试", actionLabel: "重新加载" },
  },
  detail: {
    loading: { text: "正在获取这条热搜…" },
    empty: {
      icon: "🔍", text: "没有找到这条热搜", sub: "它可能已经下榜，或链接里的标题不完整",
      links: [{ label: "返回首页", href: "#/home" }, { label: "去平台列表", href: "#/platforms" }],
    },
    error: { icon: "⚠️", text: "详情获取失败", sub: "可能是网络问题，点下面按钮重试", actionLabel: "重新加载" },
  },
};

function makeStateBlock(kind, viewKey, extra) {
  const cfg = Object.assign({}, (STATE_TEXT[viewKey] || {})[kind], extra || {});
  const box = el("div", "state-block state-" + kind);

  if (kind === "loading") {
    // 加载中：骨架屏占位，用户知道"在干活"，而不是白屏
    box.appendChild(el("div", "state-icon", cfg.icon || "⏳"));
    box.appendChild(el("p", "state-text", cfg.text));
    const wrap = el("div", "skeleton-wrap");
    const cols = cfg.cols || PLATFORM_ORDER.length;
    const rows = cfg.rows || 4;
    for (let c = 0; c < cols; c++) {
      const col = el("div", "skeleton-col");
      for (let r = 0; r < rows; r++) col.appendChild(el("div", "skeleton"));
      wrap.appendChild(col);
    }
    box.appendChild(wrap);
    return box;
  }

  box.appendChild(el("div", "state-icon", cfg.icon || "⚠️"));
  box.appendChild(el("p", "state-text", cfg.text));
  if (cfg.sub) box.appendChild(el("p", "state-sub", cfg.sub));

  const actions = el("div", "state-actions");
  if (cfg.actionLabel) {
    const b = el("button", "btn" + (kind === "error" ? " btn-primary" : ""), cfg.actionLabel);
    b.type = "button";
    b.id = "state-retry";     // 保留这个 id：审查脚本按它判断"状态有没有出口"
    b.addEventListener("click", cfg.onAction || handleRetry);
    actions.appendChild(b);
  }
  (cfg.links || []).forEach((l) => {
    const a = el("a", "btn", l.label);
    a.href = l.href;
    actions.appendChild(a);
  });
  if (actions.children.length) box.appendChild(actions);
  return box;
}

function renderStateInto(container, kind, viewKey, extra) {
  container.innerHTML = "";
  container.appendChild(makeStateBlock(kind, viewKey, extra));
}

// 当前生效的强制预览状态（?state=loading|empty|error，仅开发/截图用）
function forcedState() {
  const s = new URLSearchParams(location.search).get("state");
  return (s === "loading" || s === "empty" || s === "error") ? s : "";
}

// 重试出口：预览态下清掉 ?state= 回到真实加载（保留当前视图与其它参数）；否则重新拉数据
function handleRetry() {
  const qs = new URLSearchParams(location.search);
  if (qs.get("state")) {
    qs.delete("state");
    const q = qs.toString();
    location.href = location.pathname + (q ? "?" + q : "") + (location.hash || "#/home");
    return;
  }
  loadData(true);
}

// ===== 数据切片（三个视图共用）=====
// 某个平台这一栏该显示的条目（按序号排序、最多 TOP_N 条）
// ignoreFilter=true 时跳过关键词筛选——"空数据"判定和"匹配 x/y"的分母必须用全量数据，
// 否则一筛选整个页面就被误判成空状态
function itemsOfPlatform(name, ignoreFilter) {
  let items = (hotData && hotData.items ? hotData.items : [])
    .filter((it) => it.platform === name)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, TOP_N);
  if (!ignoreFilter && filterKeyword) {
    const kw = filterKeyword.toLowerCase();   // 标题包含即命中，不区分大小写
    items = items.filter((it) => it.title.toLowerCase().includes(kw));
  }
  return items;
}

function platformMeta(name) {
  return ((hotData && hotData.platforms) || []).find((p) => p.name === name) || { name: name, ok: true };
}

// 当前该显示哪些平台的栏——没选平台就是全部（顺序不变）
function activePlatforms() {
  return filterPlatform ? [filterPlatform] : PLATFORM_ORDER;
}

// 把当前筛选条件说成一句人话（用于无结果提示；只用 textContent 插入，无注入风险）
function filterDesc() {
  const parts = [];
  if (filterKeyword) parts.push("关键词「" + filterKeyword + "」");
  if (filterPlatform) parts.push("平台「" + filterPlatform + "」");
  return parts.join(" + ");
}

function totalItems(ignoreFilter) {
  return PLATFORM_ORDER.reduce((n, name) => n + itemsOfPlatform(name, ignoreFilter).length, 0);
}

// ===== 视图 1／3：首页（榜单）=====
function renderHome() {
  const board = $("board");
  const forced = forcedState();
  board.classList.toggle("board--single", filterPlatform !== "");   // 单平台则收成单列居中

  // 四种状态：加载中 / 请求失败 / 没有结果（数据为空）/ 正常
  if (forced === "loading" || (!forced && dataPhase === "loading")) {
    renderStateInto(board, "loading", "home");
    return;
  }
  if (forced === "error" || (!forced && dataPhase === "failed")) {
    renderStateInto(board, "error", "home");
    return;
  }
  if (forced === "empty") {
    renderStateInto(board, "empty", "home");
    return;
  }
  if (activePlatforms().reduce((n, name) => n + itemsOfPlatform(name, true).length, 0) === 0) {
    renderStateInto(board, "empty", "home");
    return;
  }

  board.innerHTML = "";
  activePlatforms().forEach((name) => board.appendChild(buildColumn(name)));
}

// 一栏 = 一张卡片（含"平台降级"和"筛选无结果"两种栏内反馈）
function buildColumn(name) {
  const meta = platformMeta(name);
  const items = meta.ok === false ? [] : itemsOfPlatform(name);

  const col = el("section", "column");

  const head = el("div", "column-head");
  head.innerHTML =
    '<span class="column-name">' + esc(name) + "</span>" +
    '<span class="column-count">' + (meta.ok === false ? "暂不可用" : items.length + " 条") + "</span>";
  col.appendChild(head);

  if (meta.ok === false) {
    // 降级：只影响本栏，其余平台照常（PRD 第 7 节 / B10）
    col.appendChild(el("div", "column-down", "暂时无法获取，稍后自动重试"));
    return col;
  }

  if ((filterKeyword || filterPlatform) && items.length === 0) {
    // 没有结果（筛选无匹配）：绝不空白；主文案固定，副文案说明当前条件与出路
    const none = el("div", "column-down column-none");
    none.appendChild(el("p", "none-title", "没有找到相关内容"));
    none.appendChild(el("p", "none-hint", "当前条件：" + filterDesc() + "。换个关键词或平台，或点上方「清除筛选」恢复完整列表"));
    col.appendChild(none);
    return col;
  }

  const body = el("div", "column-body");
  items.forEach((it) => body.appendChild(createItemRow(it)));
  col.appendChild(body);
  return col;
}

// ===== 视图 2／3：平台列表页 =====
function renderPlatforms() {
  const grid = $("platform-grid");
  const summary = $("platform-summary");
  const forced = forcedState();

  if (forced === "loading" || (!forced && dataPhase === "loading")) {
    summary.textContent = "";
    renderStateInto(grid, "loading", "platforms", { cols: 3, rows: 3 });
    return;
  }
  if (forced === "error" || (!forced && dataPhase === "failed")) {
    summary.textContent = "";
    renderStateInto(grid, "error", "platforms");
    return;
  }
  if (forced === "empty") {
    summary.textContent = "";
    renderStateInto(grid, "empty", "platforms");
    return;
  }

  const all = totalItems(true);
  if (all === 0) {   // 没有结果之一：数据源本身没有内容
    summary.textContent = "";
    renderStateInto(grid, "empty", "platforms");
    return;
  }

  const matched = totalItems();
  // 没有结果之二：关键词把三个平台都筛没了 → 整页一个状态块，而不是三张空卡片
  if (filterKeyword && matched === 0) {
    summary.textContent = "";
    renderStateInto(grid, "empty", "platforms", {
      icon: "🔍",
      text: "没有找到相关内容",
      sub: "当前条件：" + filterDesc() + "，" + PLATFORM_ORDER.length + " 个平台都没有匹配的条目。换个关键词，或点下面按钮恢复完整列表",
      actionLabel: "清除筛选",
      onAction: clearFilter,
    });
    return;
  }

  summary.textContent = filterKeyword
    ? "匹配 " + matched + " / " + all + " 条"
    : PLATFORM_ORDER.length + " 个平台 · 共 " + all + " 条";

  grid.innerHTML = "";
  PLATFORM_ORDER.forEach((name) => grid.appendChild(buildPlatformCard(name)));
}

function buildPlatformCard(name) {
  const meta = platformMeta(name);
  const down = meta.ok === false;
  const all = down ? [] : itemsOfPlatform(name, true);
  const matched = down ? [] : itemsOfPlatform(name);
  const shown = matched.slice(0, 3);

  const card = el("section", "platform-card");

  const head = el("div", "platform-card-head");
  head.appendChild(el("h3", "platform-name", name));
  head.appendChild(el("span", "platform-badge" + (down ? " platform-badge-down" : ""), down ? "暂不可用" : "正常"));
  card.appendChild(head);

  card.appendChild(el("p", "platform-stats", down
    ? "本平台取数失败，其余平台不受影响（PRD 第 7 节）"
    : (filterKeyword ? "匹配 " + matched.length + " / 共 " + all.length + " 条" : "共 " + all.length + " 条")));

  const preview = el("div", "platform-preview");
  if (down) preview.appendChild(el("p", "platform-empty", "暂时无法获取，稍后自动重试"));
  else if (shown.length === 0) preview.appendChild(el("p", "platform-empty", "当前关键词下没有匹配的条目"));
  else shown.forEach((it) => preview.appendChild(createItemRow(it)));
  card.appendChild(preview);

  const foot = el("div", "platform-card-foot");
  const link = el("a", "btn btn-sm", "查看完整榜单 →");
  link.href = "#/home/" + encodeURIComponent(name);
  foot.appendChild(link);
  card.appendChild(foot);
  return card;
}

// ===== 视图 3／3：热搜详情页 =====
function findItemByKey(key) {
  const items = (hotData && hotData.items) || [];
  return items.find((it) => favKey(it) === key) || null;
}

function renderCrumb(crumb, item) {
  crumb.innerHTML = "";
  const add = (label, href) => {
    if (crumb.children.length) crumb.appendChild(el("span", "crumb-sep", "›"));
    if (href) {
      const a = el("a", "", label);
      a.href = href;
      crumb.appendChild(a);
    } else {
      const s = el("span", "crumb-current", label);
      s.setAttribute("aria-current", "page");
      crumb.appendChild(s);
    }
  };
  add("首页", "#/home");
  add("平台列表", "#/platforms");
  if (item) add(item.platform, "#/home/" + encodeURIComponent(item.platform));
  add("详情", null);
}

function renderDetailPage(key) {
  const box = $("detail-page");
  const crumb = $("detail-crumb");
  const forced = forcedState();
  currentPageItem = null;
  box.innerHTML = "";

  // 四种状态：加载中 / 请求失败 / 没有找到这条热搜 / 正常
  if (forced || dataPhase !== "ready") {
    let kind = "loading";
    if (forced === "empty") kind = "empty";
    else if (forced === "error" || dataPhase === "failed") kind = "error";
    renderCrumb(crumb, null);
    renderStateInto(box, kind, "detail", kind === "loading" ? { cols: 1, rows: 5 } : null);
    return;
  }

  const item = findItemByKey(key);
  if (!item) {   // 没有结果：链接失效或已下榜，给两条出路
    renderCrumb(crumb, null);
    renderStateInto(box, "empty", "detail");
    return;
  }

  currentPageItem = item;
  renderCrumb(crumb, item);
  box.appendChild(buildDetailCard(item));
  syncFavButtons();       // 收藏态以真实数据为准（含备注区回填）
}

function buildDetailCard(item) {
  const card = el("article", "detail-card");

  const meta = el("div", "detail-meta");
  meta.appendChild(el("span", "detail-platform", item.platform));
  meta.appendChild(el("span", "", "第 " + item.rank + " 位"));
  if (item.heat) meta.appendChild(el("span", "", "热度 " + fmtHeat(item.heat)));
  if (item.time) meta.appendChild(el("span", "", "上榜 " + item.time));
  card.appendChild(meta);

  card.appendChild(el("h2", "detail-title", item.title));

  const actions = el("div", "detail-actions");
  const favBtn = el("button", "btn", "☆ 收藏");
  favBtn.type = "button"; favBtn.id = "page-fav"; favBtn.setAttribute("data-act", "fav");
  const noteBtn = el("button", "btn", "✎ 写备注");
  noteBtn.type = "button"; noteBtn.id = "page-note"; noteBtn.setAttribute("data-act", "note");
  const copyBtn = el("button", "btn", "⧉ 复制链接");
  copyBtn.type = "button"; copyBtn.id = "page-copy"; copyBtn.setAttribute("data-act", "copy");
  copyBtn.setAttribute("aria-live", "polite");
  const link = el("a", "btn btn-primary", "去原平台查看 ↗");
  link.id = "page-link"; link.href = item.url; link.target = "_blank"; link.rel = "noopener";
  [favBtn, noteBtn, copyBtn, link].forEach((b) => actions.appendChild(b));
  card.appendChild(actions);

  const noteView = el("p", "note-view hidden");
  noteView.id = "page-note-view";
  card.appendChild(noteView);

  const noteArea = el("div", "note-area hidden");
  noteArea.id = "page-note-area";
  const ta = document.createElement("textarea");
  ta.id = "page-note-input"; ta.maxLength = 50; ta.placeholder = "写一句备注（最多 50 字）…";
  noteArea.appendChild(ta);
  const na = el("div", "note-actions");
  const nc = el("span", "note-count", "0/50");
  nc.id = "page-note-count";
  const save = el("button", "btn btn-primary btn-sm", "保存备注");
  save.type = "button"; save.id = "page-note-save"; save.setAttribute("data-act", "note-save");
  na.appendChild(nc); na.appendChild(save);
  noteArea.appendChild(na);
  card.appendChild(noteArea);

  // 同平台上下条：多级切换的第三层（视图 → 平台 → 具体条目）
  const pager = el("div", "detail-pager");
  pager.appendChild(pagerLink(neighborOf(item, -1), "← 上一条"));
  pager.appendChild(pagerLink(neighborOf(item, 1), "下一条 →"));
  const back = el("a", "btn btn-sm", "回榜单");
  back.href = "#/home/" + encodeURIComponent(item.platform);
  pager.appendChild(back);
  card.appendChild(pager);

  card.appendChild(el("p", "detail-hint", "这个页面可以单独分享：把地址栏链接发给别人，打开就是这一条。"));
  return card;
}

// 同平台相邻排名（rank ± 1），忽略关键词筛选，保证上下条一直可用
function neighborOf(item, delta) {
  return itemsOfPlatform(item.platform, true).find((it) => it.rank === item.rank + delta) || null;
}

function pagerLink(item, label) {
  if (!item) {
    const s = el("span", "pager-gap", label);   // 到边界了就只显示文字，不做假按钮
    s.title = "已经是这一平台的边缘了";
    return s;
  }
  const a = el("a", "btn btn-sm", label);
  a.href = detailHash(item);
  return a;
}

// ===== 详情弹层（PRD F2，保留）=====
let detailScrollY = 0;    // 弹层打开前的背景滚动位置（关闭时恢复）

/* ---------- 复制链接 + 可感知反馈（Day 11 设计，Day 13 抽成通用函数给详情页复用）----------
   乐观反馈：点击【瞬间】按钮变「✓ 已复制」（绿色）+ 底部 toast 弹出——不等剪贴板结果，
   因为反馈必须 0 延迟才可感知；剪贴板真正失败时再回退按钮并提示手动复制。
   连续快速点击不报错：每次点击先 clearTimeout 取消上一次恢复，再重新计时。 */
function copyLink(btn, url) {
  if (!btn || !url) return;
  const originalLabel = "⧉ 复制链接";

  btn.textContent = "✓ 已复制";
  btn.classList.add("copied");
  showToast("链接已复制，可以去粘贴啦");

  // 计时器挂在按钮自己身上：弹层和详情页两个按钮各算各的，连续点击先清旧的（不会互相打断）
  if (btn._copyTimer) clearTimeout(btn._copyTimer);
  btn._copyTimer = setTimeout(() => {
    btn.textContent = originalLabel;
    btn.classList.remove("copied");
  }, 2500);

  const fail = () => {
    btn.textContent = originalLabel;
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
  void t.offsetWidth;   // 强制重排后再加动画类，保证连续触发时动画能重新播放
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
  // 两种打开方式二选一，见顶部 DETAIL_OPEN_MODE
  if (DETAIL_OPEN_MODE === "page") { location.hash = detailHash(item); return; }

  currentDetail = item;
  $("detail-platform").textContent = item.platform;
  $("detail-rank").textContent = "第 " + item.rank + " 位";
  $("detail-heat").textContent = item.heat ? "热度 " + fmtHeat(item.heat) : "";
  $("detail-time").textContent = item.time ? "上榜 " + item.time : "";
  $("detail-title").textContent = item.title;
  $("detail-link").href = item.url;
  resetCopyBtn();   // 换一条打开时，复制按钮恢复初始态（防止残留上一次的"已复制"）

  const fav = loadFavorites().find((f) => f.id === favKey(item));
  syncFavButtons();
  if (fav && fav.note) {
    $("note-view").textContent = "备注：" + fav.note;
    $("note-view").classList.remove("hidden");
  } else {
    $("note-view").classList.add("hidden");
  }
  $("note-area").classList.add("hidden");

  // 弹层开着时锁住背景滚动（修复前手机上滑动会穿透到背后的列表，关掉弹层后页面不在原位置）
  detailScrollY = window.scrollY;
  document.body.style.position = "fixed";
  document.body.style.top = -detailScrollY + "px";
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";

  $("detail-overlay").classList.remove("hidden");
}

function closeDetail() {
  $("detail-overlay").classList.add("hidden");
  currentDetail = null;

  // 弹层关了就解锁背景滚动，并回到打开前的位置
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

/* ---------- 收藏交互状态机（前端临时状态，不接数据库）----------
   按钮共 5 个状态（弹层按钮、详情页按钮、卡片星标三处始终同步）：
     ① 空闲·未收藏：详情/详情页「☆ 收藏」描边灰 ｜ 卡片 ☆、白底
     ② 处理中：按钮「⏳ 保存中… / ⏳ 取消中…」半透明禁用 ｜ 卡片星标 … 禁用+呼吸动画
        —— disabled + favBusy 双保险，处理期间重复点击直接忽略
     ③ 已收藏：按钮「★ 已收藏」红字淡红底 ｜ 卡片 ★、淡红底纹
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

// 收藏/取消收藏的完整流程：状态切换 → 模拟写库 → 成功多处刷新 / 失败回退
async function requestToggleFav(item, row) {
  if (favBusy) return;               // 处理期间不可重复点击
  favBusy = true;

  const willFav = !isFaved(item);    // 本次点击要变成的状态

  setStarBusy(row, true);
  setFavButtonsBusy(item, true, willFav);

  try {
    // 先算好新列表再"写库"，中途失败时原数据一点不动
    const key = favKey(item);
    let list = loadFavorites();
    if (willFav) {
      list.push({ id: key, platform: item.platform, title: item.title, url: item.url, note: "", saved_at: nowIso() });
    } else {
      list = list.filter((f) => f.id !== key);
    }
    await persistFavorites(list);

    // 成功：榜单卡片、弹层按钮、详情页按钮、顶栏计数同步，toast 告诉用户生效了
    renderBoard();
    refreshFavBadge();
    syncFavButtons();
    showToast(willFav ? "★ 已收藏" : "已取消收藏");
  } catch (e) {
    // 失败：数据没变；renderBoard / syncFavButtons 会把按钮画回点击前的样子
    renderBoard();
    syncFavButtons();
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

// 处理中：弹层按钮 + 详情页按钮一起进忙碌态（只动"正好显示这一条"的那几个）
function setFavButtonsBusy(item, busy, willFav) {
  const label = willFav ? "⏳ 保存中…" : "⏳ 取消中…";
  const targets = [];
  if (sameItem(currentDetail, item)) targets.push($("detail-fav"));
  if (sameItem(currentPageItem, item)) targets.push($("page-fav"));
  targets.forEach((b) => {
    if (!b) return;
    b.disabled = busy;
    if (busy) { b.textContent = label; b.classList.remove("faved"); }
  });
}

// 按真实数据把三处收藏态画一致（弹层、详情页；卡片由 renderBoard 负责）
function syncFavButtons() {
  const db = $("detail-fav");
  const dFav = currentDetail ? isFaved(currentDetail) : false;
  db.textContent = dFav ? "★ 已收藏" : "☆ 收藏";
  db.classList.toggle("faved", dFav);
  db.disabled = false;

  const pb = $("page-fav");
  if (pb) {
    const pFav = currentPageItem ? isFaved(currentPageItem) : false;
    pb.textContent = pFav ? "★ 已收藏" : "☆ 收藏";
    pb.classList.toggle("faved", pFav);
    pb.disabled = false;
  }
  if (currentPageItem) syncPageNoteView();
}

// ===== 备注（≤50 字，PRD F3 / 6.2）=====
// 核心写入：两处界面（弹层 / 详情页）共用
function saveNoteText(item, text) {
  const list = loadFavorites();
  const fav = list.find((f) => f.id === favKey(item));
  if (!fav) return false;
  fav.note = text;
  saveFavorites(list);
  return true;
}

function openNoteEditor() {
  if (!currentDetail) return;
  if (!isFaved(currentDetail)) {
    // 先收藏再写备注，避免出现"有备注没收藏"的孤儿数据
    toggleFav(currentDetail);
    renderBoard();
    syncFavButtons();
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
  if (!saveNoteText(currentDetail, text)) return;
  $("note-area").classList.add("hidden");
  if (text) {
    $("note-view").textContent = "备注：" + text;
    $("note-view").classList.remove("hidden");
  } else {
    $("note-view").classList.add("hidden");
  }
  renderFavorites();   // 抽屉同步
}

// 详情页的备注：显示已有备注 + 展开编辑区（与弹层同一套数据，UI 各管各的）
function openPageNoteEditor() {
  if (!currentPageItem) return;
  if (!isFaved(currentPageItem)) {
    toggleFav(currentPageItem);
    renderBoard();
    syncFavButtons();
  }
  syncPageNoteView();
  const area = $("page-note-area");
  if (area) area.classList.remove("hidden");
  const input = $("page-note-input");
  if (input) input.focus();
}

function savePageNote() {
  if (!currentPageItem) return;
  const input = $("page-note-input");
  if (!input) return;
  const text = input.value.trim().slice(0, 50);
  if (!saveNoteText(currentPageItem, text)) return;
  const area = $("page-note-area");
  if (area) area.classList.add("hidden");
  syncPageNoteView();
  renderFavorites();
  showToast(text ? "备注已保存" : "备注已清空");
}

function syncPageNoteView() {
  const view = $("page-note-view"), btn = $("page-note");
  if (!view || !btn || !currentPageItem) return;
  const fav = loadFavorites().find((f) => f.id === favKey(currentPageItem));
  const note = fav && fav.note ? fav.note : "";
  if (note) {
    view.textContent = "备注：" + note;
    view.classList.remove("hidden");
    btn.textContent = "✎ 改备注";
  } else {
    view.textContent = "";
    view.classList.add("hidden");
    btn.textContent = "✎ 写备注";
  }
  // 编辑区开着的时候不回填，别把用户正在输入的内容覆盖掉
  const area = $("page-note-area");
  const editing = area && !area.classList.contains("hidden");
  const input = $("page-note-input");
  if (input && !editing) input.value = note;
  const count = $("page-note-count");
  if (count && !editing) count.textContent = note.length + "/50";
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
        '<a class="btn btn-sm" href="#/detail/' + encodeURIComponent(f.id) + '">详情页</a>' +
        '<button class="btn btn-sm" data-act="remove" type="button">取消收藏</button>' +
      "</div>";
    const removeBtn = li.querySelector('[data-act="remove"]');
    removeBtn.addEventListener("click", () => {
      requestRemoveFav(f, removeBtn);   // 走状态机（处理中防连点、失败回退）
    });
    ul.appendChild(li);
  });
}

function openFavorites() {
  renderFavorites();
  $("fav-overlay").classList.remove("hidden");
}

function closeFavorites() { $("fav-overlay").classList.add("hidden"); }

/* ---------- 抽屉「取消收藏」接入同一状态机 ----------
   状态：①空闲「取消收藏」→ ②处理中「⏳ 取消中…」禁用（抽屉内所有移除按钮一起禁用，
   防并行写库）→ ③成功：该条消失、榜单行回 ☆、计数 -1、toast「已取消收藏」；
   ④失败：按钮回退、列表与计数不动，toast「收藏保存失败，请稍后再试」。 */
async function requestRemoveFav(fav, btn) {
  if (favBusy) return;               // 处理期间不可重复点击
  favBusy = true;

  let favItem = null;
  if (currentDetail && favKey(currentDetail) === fav.id) favItem = currentDetail;
  if (currentPageItem && favKey(currentPageItem) === fav.id) favItem = currentPageItem;

  setDrawerBusy(btn, true);          // ① 进入"处理中"
  if (favItem) setFavButtonsBusy(favItem, true, false);

  try {
    await persistFavorites(loadFavorites().filter((f) => f.id !== fav.id));  // 模拟"写库"

    // ② 成功：抽屉、榜单、计数、详情按钮多处同步
    renderFavorites();
    renderBoard();
    refreshFavBadge();
    syncFavButtons();
    showToast("已取消收藏");
  } catch (e) {
    // ③ 失败：数据没动，抽屉不重画，只把按钮画回点击前的样子
    setDrawerBusy(btn, false);
    syncFavButtons();
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

// ===== 渲染榜单（供状态机成功后局部刷新用；不在首页就等切回首页时再画）=====
function renderBoard() {
  if (currentRoute.view === "home") renderHome();
}

// ===== 数据加载：串起四种状态 =====
function loadData(isManual) {
  const forced = forcedState();
  if (forced) {
    // 状态预览：只让视图画指定状态，不真的发请求
    $("updated-at").textContent = "状态预览：" + STATE_LABEL[forced];
    renderView();
    return;
  }

  if (hotData) { dataPhase = "ready"; $("updated-at").textContent = "更新中…"; }
  else { dataPhase = "loading"; $("updated-at").textContent = "正在更新…"; }
  renderView();

  fetch(DATA_URL)
    .then((res) => res.json())
    .then((data) => {
      hotData = data;
      dataPhase = "ready";
      $("updated-at").textContent = "更新于 " + fmtTime(data.updated_at);
      setNotice(NOTICE_DEFAULT, false);
      refreshFavBadge();
      applyPreviewSwitches();
      renderView();

      // 加载成功的可感知反馈：手动刷新才有 toast，自动刷新保持安静
      if (isManual) showToast("已更新，共 " + totalItems(true) + " 条热搜");
    })
    .catch(() => {
      // 请求失败：有旧数据就继续展示旧数据 + 原时间戳（PRD 第 7 节：绝不显示空白页）
      if (hotData) {
        dataPhase = "ready";
        $("updated-at").textContent = "更新于 " + fmtTime(hotData.updated_at);
        setNotice("更新失败，当前显示的是上一次成功的数据；稍后可点「刷新」重试。", true);
        renderView();
        return;
      }
      dataPhase = "failed";
      $("updated-at").textContent = "更新失败";
      renderView();
    });
}

function setNotice(text, warn) {
  const el2 = $("notice");
  el2.textContent = text;
  el2.classList.toggle("notice-warn", !!warn);
}

// 开发预览开关（只影响首次加载，不改数据源）：
//   ?filter=关键词  预置筛选  ｜ ?platform=平台名 预置平台并同步地址
//   ?detail=open 打开第一条详情弹层 ｜ ?copied=1 冻结"已复制"反馈态
function applyPreviewSwitches() {
  const qs = new URLSearchParams(location.search);

  const qf = qs.get("filter");
  if (qf) { $("filter-input").value = qf; filterKeyword = qf.trim(); }

  const qp = qs.get("platform");
  if (qp && PLATFORM_ORDER.indexOf(qp) !== -1) {
    filterPlatform = qp;
    syncPlatformChips();
    if (currentRoute.view === "home") {
      history.replaceState(null, "", location.pathname + location.search + "#/home/" + encodeURIComponent(qp));
    }
  }

  refreshFilterUI();

  if (qs.get("detail") === "open" && hotData && hotData.items && hotData.items.length) {
    openDetail(hotData.items[0]);
    if (qs.get("copied") === "1") {
      $("detail-copy").textContent = "✓ 已复制";
      $("detail-copy").classList.add("copied");
      showToast("链接已复制，可以去粘贴啦", true);
    }
  }
}

// ===== 筛选交互（按 skills/filter-interaction/SKILL.md 实现：三态齐全 + 平台维度）=====
function renderPlatformChips() {
  const box = $("platform-chips");
  if (!box) return;
  box.innerHTML = "";

  [{ name: "", label: "全部" }].concat(PLATFORM_ORDER.map((p) => ({ name: p, label: p }))).forEach((opt) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.platform = opt.name;
    chip.textContent = opt.label;
    chip.setAttribute("aria-pressed", filterPlatform === opt.name ? "true" : "false");
    box.appendChild(chip);
  });
}

// 同步 chips 的选中态（不重建节点，避免键盘焦点丢失）
function syncPlatformChips() {
  const chips = document.querySelectorAll("#platform-chips .chip");
  Array.prototype.forEach.call(chips, (chip) => {
    chip.setAttribute("aria-pressed", chip.dataset.platform === filterPlatform ? "true" : "false");
  });
}

// 选平台：同步地址（#/home/<平台名>）→ 让"地址栏 = 当前视图状态"这条规则对筛选也成立
function setPlatform(name) {
  filterPlatform = name;
  syncPlatformChips();
  // 只有首页带平台筛选这一层；其它视图（平台列表页）不显示 chips，也不会走到这里
  if (currentRoute.view === "home") {
    const hash = name ? "#/home/" + encodeURIComponent(name) : "#/home";
    history.replaceState(null, "", location.pathname + location.search + hash);
  }
  renderView();
}

function applyFilter() {
  filterKeyword = $("filter-input").value.trim();   // 首尾空格要 trim
  renderView();
}

// 统一刷新轻量 UI：清除按钮可用态 + 匹配计数
function refreshFilterUI() {
  $("filter-clear").disabled = filterKeyword === "" && filterPlatform === "";
  updateFilterCount();
}

// 匹配计数（aria-live，读屏可播报）：分母用「当前平台范围」的全量、分子用筛选后
function updateFilterCount() {
  const el2 = $("filter-count");
  if (!hotData || (filterKeyword === "" && filterPlatform === "")) { el2.textContent = ""; return; }
  const total = activePlatforms().reduce((n, name) => n + itemsOfPlatform(name, true).length, 0);
  const matched = activePlatforms().reduce((n, name) => n + itemsOfPlatform(name).length, 0);
  el2.textContent = "匹配 " + matched + "/" + total + " 条";
}

// 清空恢复：关键词与平台一起复位 + 焦点回输入框
// 注意：只把"平台筛选"从地址里摘掉，**不换视图**——在平台列表页点清除，仍然留在平台列表页
function clearFilter() {
  const input = $("filter-input");
  input.value = "";
  filterKeyword = "";
  filterPlatform = "";
  syncPlatformChips();
  const hash = currentRoute.view === "home" ? "#/home" : (location.hash || "#/home");
  history.replaceState(null, "", location.pathname + location.search + hash);
  renderView();
  input.focus();
}

// ===== 事件绑定 =====
function bindEvents() {
  $("btn-refresh").addEventListener("click", () => loadData(true));   // 手动刷新（PRD F4）
  $("btn-favorites").addEventListener("click", openFavorites);

  $("filter-input").addEventListener("input", applyFilter);
  $("filter-clear").addEventListener("click", clearFilter);

  // chips 事件绑定（委托，一次绑好，重建节点也不用重绑）
  $("platform-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    setPlatform(chip.dataset.platform || "");
  });

  // 弹层按钮
  $("detail-close").addEventListener("click", closeDetail);
  $("fav-close").addEventListener("click", closeFavorites);
  $("detail-fav").addEventListener("click", () => {
    if (currentDetail) requestToggleFav(currentDetail);
  });
  $("detail-note").addEventListener("click", openNoteEditor);
  $("detail-copy").addEventListener("click", () => copyLink($("detail-copy"), currentDetail ? currentDetail.url : ""));
  $("detail-page-btn").addEventListener("click", () => {
    if (currentDetail) location.hash = detailHash(currentDetail);   // 切到详情页视图；renderView 会关掉弹层
  });
  $("note-save").addEventListener("click", saveNote);
  $("note-input").addEventListener("input", (e) => {
    $("note-count").textContent = e.target.value.length + "/50";
  });

  // 详情页：内容由 JS 重建，所以用事件委托（重建节点也不用重绑）
  $("detail-page").addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]");
    if (!act || !currentPageItem) return;
    const a = act.getAttribute("data-act");
    if (a === "fav") requestToggleFav(currentPageItem, null);
    else if (a === "note") openPageNoteEditor();
    else if (a === "copy") copyLink(act, currentPageItem.url);
    else if (a === "note-save") savePageNote();
  });
  $("detail-page").addEventListener("input", (e) => {
    if (e.target.id === "page-note-input") {
      const c = $("page-note-count");
      if (c) c.textContent = e.target.value.length + "/50";
    }
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

  // 路由：地址变了就重画（前进/后退、手改地址、链接触发都走这里）
  window.addEventListener("hashchange", renderView);
}

// ===== 启动 =====
function init() {
  renderPlatformChips();

  // 空 hash / 未知路径 → 归一到 #/home（用 replace 不留历史记录，避免"后退"变成无限循环）
  const route = parseRoute();
  if (!location.hash || route.unknown) {
    history.replaceState(null, "", location.pathname + location.search + "#/home");
  }

  bindEvents();
  renderView();
  loadData();
  setInterval(loadData, AUTO_REFRESH_MINUTES * 60 * 1000);   // 自动刷新（PRD F4）
}

init();

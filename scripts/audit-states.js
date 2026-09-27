// Day 10 状态与层级审查脚本：补上 audit-design.js 没覆盖的部分
//   —— 全量文字对比度、视觉层级档数、按钮交互状态、点击区邻接间距、状态可辨性
// 用法：agent-browser eval "$(cat scripts/audit-states.js)"
// 注意：本文件内不使用 $ 与反引号，方便在 shell 里直接展开
(function () {
  // ---------- 颜色工具（与 audit-design.js 同一套 WCAG 2.1 算法）----------
  function parseAny(str) {
    if (!str) return null;
    var s = String(str).trim();
    var m = s.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(",").map(function (x) { return parseFloat(x); });
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    var h = s.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  function chan(c) { var v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function lum(c) { return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b); }
  function contrast(c1, c2) {
    var a = parseAny(c1), b = parseAny(c2);
    if (!a || !b) return null;
    var L1 = lum(a), L2 = lum(b), hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }
  // 沿祖先链找第一个不透明背景色（夹在浮层上的文字也能算对）
  function bgOf(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      var cs = getComputedStyle(node);
      var c = parseAny(cs.backgroundColor);
      if (c && c.a > 0.9) return "rgb(" + c.r + "," + c.g + "," + c.b + ")";
      // 半透明遮罩（弹层背后的 .overlay）按它与白底的混合色近似
      if (c && c.a > 0 && c.a <= 0.9) {
        var base = node.parentElement ? parseAny(bgOf(node.parentElement)) : { r: 255, g: 255, b: 255 };
        return "rgb(" + Math.round(c.r * c.a + base.r * (1 - c.a)) + "," +
               Math.round(c.g * c.a + base.g * (1 - c.a)) + "," +
               Math.round(c.b * c.a + base.b * (1 - c.a)) + ")";
      }
      node = node.parentElement;
    }
    return "rgb(255,255,255)";
  }
  function hex(c) { if (!c) return null; return "#" + [c.r, c.g, c.b].map(function (v) { return ("0" + Math.round(v).toString(16)).slice(-2); }).join(""); }
  function r1(n) { return Math.round(n * 10) / 10; }
  function pathOf(el) {
    var p = el.tagName.toLowerCase();
    if (el.id) return "#" + el.id;
    if (el.className && typeof el.className === "string") p += "." + el.className.trim().split(/\s+/).join(".");
    return p;
  }

  // ---------- 1) 全量文字对比度（DR-1）：所有可见叶子文字，阈值 4.5:1 ----------
  var bad = [];
  var tiers = {};
  Array.prototype.forEach.call(document.querySelectorAll("body *"), function (el) {
    if (el.children.length > 0) return;                     // 只看叶子节点
    var txt = (el.textContent || "").trim();
    if (!txt) return;
    var cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;             // 浮层未打开时高度为 0
    var size = parseFloat(cs.fontSize), weight = cs.fontWeight;
    var bg = bgOf(el), ratio = contrast(cs.color, bg);
    // WCAG 大文字：>=24px，或 >=18.66px 且 bold
    var isLarge = size >= 24 || (size >= 18.66 && (weight === "bold" || parseInt(weight, 10) >= 700));
    var need = isLarge ? 3 : 4.5;
    if (ratio !== null && ratio < need) {
      bad.push({ 元素: pathOf(el), 文字: txt.slice(0, 12), 字号: size, 字色: hex(parseAny(cs.color)), 背景: hex(parseAny(bg)), 对比度: ratio, 判定线: need });
    }
    var key = size + "px/" + weight;
    tiers[key] = (tiers[key] || 0) + 1;
  });

  // ---------- 2) 视觉层级档数（DR-6：≤3 档）----------
  var tierList = Object.keys(tiers).map(function (k) {
    var parts = k.split("/");
    return { 字号: parseFloat(parts[0]), 字重: parts[1], 个数: tiers[k] };
  }).sort(function (a, b) { return b.字号 - a.字号; });
  var sizes = tierList.map(function (t) { return t.字号; });
  var uniqSizes = sizes.filter(function (v, i) { return sizes.indexOf(v) === i; });
  var sizeGaps = [];
  for (var i = 1; i < uniqSizes.length; i++) sizeGaps.push(r1(uniqSizes[i - 1] - uniqSizes[i]));

  // ---------- 3) 按钮/交互状态覆盖（DR-3 + 按钮三态）----------
  function baseOf(sel) { return sel.replace(/:(hover|active|focus-visible|focus|disabled)\b/g, "").trim(); }
  var stateMap = { hover: [], active: [], focus: [], disabled: [] };
  var styleSels = [];
  for (var s = 0; s < document.styleSheets.length; s++) {
    var rs = null;
    try { rs = document.styleSheets[s].cssRules; } catch (e) { continue; }
    for (var j = 0; j < rs.length; j++) {
      if (rs[j].selectorText) styleSels.push(rs[j].selectorText);
    }
  }
  styleSels.forEach(function (sel) {
    var parts = sel.split(",");
    parts.forEach(function (one) {
      var t = one.trim();
      if (t.indexOf(":hover") >= 0) stateMap.hover.push(baseOf(t));
      if (t.indexOf(":active") >= 0) stateMap.active.push(baseOf(t));
      if (t.indexOf(":focus-visible") >= 0 || t.indexOf(":focus") >= 0) stateMap.focus.push(baseOf(t));
      if (t.indexOf(":disabled") >= 0) stateMap.disabled.push(baseOf(t));
    });
  });
  function covered(el, list) {
    return list.some(function (b) {
      if (!b) return false;
      try { return el.matches(b); } catch (e) { return false; }
    });
  }
  var buttons = document.querySelectorAll(".btn, .item-star, .modal-close, [role=button]");
  var stateReport = { 可点元素数: buttons.length, 无hover: [], 无active: [], 无focus: [] };
  Array.prototype.forEach.call(buttons, function (el) {
    var label = (el.id || el.className) + "：" + (el.textContent || "").trim().slice(0, 10);
    if (!covered(el, stateMap.hover)) stateReport.无hover.push(label);
    if (!covered(el, stateMap.active)) stateReport.无active.push(label);
    if (!covered(el, stateMap.focus)) stateReport.无focus.push(label);
  });
  stateReport.定义了disabled的选择器 = stateMap.disabled.length ? stateMap.disabled : "无（:disabled 未定义）";

  // ---------- 4) 点击区尺寸 + 相邻间距（DR-7：≥40px 且相邻 ≥8px）----------
  var small = [], tightGaps = [];
  Array.prototype.forEach.call(buttons, function (el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.height < 40 || r.width < 40) {
      small.push({ 元素: el.id || el.className, 文本: (el.textContent || "").trim().slice(0, 8), 尺寸: Math.round(r.width) + "x" + Math.round(r.height) });
    }
  });
  // 同一列表内相邻可点元素（这里看榜单条目）的间距
  var itemsCol = document.querySelectorAll(".column-body");
  Array.prototype.forEach.call(itemsCol, function (body) {
    var rows = body.querySelectorAll(".item");
    for (var k = 1; k < rows.length; k++) {
      var a = rows[k - 1].getBoundingClientRect(), b = rows[k].getBoundingClientRect();
      var gapV = r1(b.top - a.bottom);
      if (gapV < 8 && tightGaps.length < 6) tightGaps.push({ 位置: "榜单第 " + (k + 1) + " 行上方", 垂直间距: gapV });
    }
  });
  // 顶栏两个按钮的间距
  var tbtns = document.querySelectorAll(".topbar-actions .btn");
  var tbGap = null;
  if (tbtns.length > 1) tbGap = r1(tbtns[1].getBoundingClientRect().left - tbtns[0].getBoundingClientRect().right);

  // ---------- 5) 交互状态的实际观感差异（不能只靠颜色）----------
  var starDefault = document.querySelector(".item-star:not(.faved)");
  var starFaved = document.querySelector(".item-star.faved");
  var starCompare = {
    常态文字: starDefault ? starDefault.textContent : "（当前无未收藏行）",
    常态色: starDefault ? hex(parseAny(getComputedStyle(starDefault).color)) : null,
    已收藏文字: starFaved ? starFaved.textContent : "（当前无已收藏行）",
    已收藏色: starFaved ? hex(parseAny(getComputedStyle(starFaved).color)) : null,
    差异维度: "见上：文字相同则仅靠颜色区分"
  };

  // ---------- 6) 手机宽度布局 ----------
  var first = document.querySelector(".item-title");
  var firstCol = document.querySelector(".column");
  var mobile = {
    视口: innerWidth + "x" + innerHeight,
    横向溢出: document.documentElement.scrollWidth > innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    栏数: getComputedStyle(document.getElementById("board")).gridTemplateColumns,
    条目标题宽: first ? Math.round(first.getBoundingClientRect().width) : null,
    条目高: first ? Math.round(first.closest(".item").getBoundingClientRect().height) : null,
    栏宽: firstCol ? Math.round(firstCol.getBoundingClientRect().width) : null,
    标题是否被截断: first ? first.scrollHeight > first.clientHeight + 1 : null,
    顶栏高: Math.round(document.querySelector(".topbar").getBoundingClientRect().height),
    页高: document.body.scrollHeight
  };

  // ---------- 7) 状态块可辨性（DR-11）----------
  var st = document.querySelector(".state-block");
  var stateInfo = st ? {
    类名: st.className,
    图标: (st.querySelector(".state-icon") || {}).textContent,
    标题: (st.querySelector(".state-text") || {}).textContent,
    有出口: !!st.querySelector("#state-retry")
  } : "（当前为正常态，无状态块）";

  return JSON.stringify({
    "1_对比度不达标": bad.length ? bad : "无",
    "2_字号档位": tierList,
    "2_字号相邻差值": sizeGaps,
    "3_按钮状态": stateReport,
    "4_点击区不足40": small.length ? small : "无",
    "4_相邻条目垂直间距小于8": tightGaps.length ? tightGaps : "无",
    "4_顶栏按钮间距": tbGap,
    "5_收藏星标两态": starCompare,
    "6_手机布局": mobile,
    "7_状态块": stateInfo
  }, null, 1);
})()

// Day 9 前端审查脚本：把 DESIGN_RULES.md 的规则逐条量成数字
// 用法：agent-browser eval "$(cat scripts/audit-design.js)"
// 注意：本文件内不使用 $ 与反引号，方便在 shell 里直接展开
(function () {
  // ---------- 颜色对比度计算（WCAG 2.1）----------
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
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1
    };
  }
  function chan(c) {
    var v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function lum(c) { return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b); }
  function contrast(c1, c2) {
    var a = parseAny(c1), b = parseAny(c2);
    if (!a || !b) return null;
    var L1 = lum(a), L2 = lum(b), hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }
  function bgStr(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      var c = parseAny(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.9) return "rgb(" + c.r + "," + c.g + "," + c.b + ")";
      node = node.parentElement;
    }
    return "rgb(255,255,255)";
  }
  function hex(c) {
    if (!c) return null;
    return "#" + [c.r, c.g, c.b].map(function (v) {
      return ("0" + Math.round(v).toString(16)).slice(-2);
    }).join("");
  }
  function r1(n) { return Math.round(n * 10) / 10; }
  function textInfo(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var cs = getComputedStyle(el);
    var bg = bgStr(el);
    return {
      元素: sel + "（" + (el.textContent || "").trim().slice(0, 10) + "）",
      字号: parseFloat(cs.fontSize),
      字色: hex(parseAny(cs.color)),
      背景: hex(parseAny(bg)),
      对比度: contrast(cs.color, bg)
    };
  }
  function rectOf(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { left: r1(r.left), right: r1(r.right), w: Math.round(r.width), h: Math.round(r.height) };
  }
  function cssRules() {
    var out = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      var rs = null;
      try { rs = document.styleSheets[i].cssRules; } catch (e) { continue; }
      for (var j = 0; j < rs.length; j++) out.push(rs[j]);
    }
    return out;
  }
  var rules = cssRules();

  // ---------- 1) 文字对比度（DR-1）----------
  var texts = [
    ".topbar-title", ".topbar-time", ".notice", ".column-name", ".column-count",
    ".item-rank", ".item-title", ".item-heat", ".state-sub", ".state-text"
  ].map(textInfo).filter(Boolean);
  var textFail = texts.filter(function (t) { return t.对比度 < 4.5; });

  // ---------- 2) 界面元素对比度（DR-2）----------
  var ui = [];
  function uiCheck(label, sel, prop) {
    var el = document.querySelector(sel);
    if (!el) return;
    var cs = getComputedStyle(el);
    var c = prop === "bg" ? cs.backgroundColor : prop === "border" ? cs.borderTopColor : cs.color;
    ui.push({ 元素: label, 色值: hex(parseAny(c)), 背景: hex(parseAny(bgStr(el))), 对比度: contrast(c, bgStr(el)) });
  }
  uiCheck("未收藏星标", ".item-star");
  uiCheck("二级按钮描边", ".btn", "border");
  uiCheck("输入框描边", ".note-area textarea", "border");

  // ---------- 3) 交互态（DR-3）----------
  var hoverMap = {};
  var focusSels = [];
  rules.forEach(function (r) {
    if (!r.selectorText) return;
    if (r.selectorText.indexOf(":hover") >= 0 && r.style.background) hoverMap[r.selectorText] = r.style.background;
    if (r.selectorText.indexOf(":focus-visible") >= 0) {
      r.selectorText.split(",").forEach(function (s) {
        var t = s.trim();
        if (focusSels.indexOf(t) < 0) focusSels.push(t);
      });
    }
  });
  var hoverVar = hoverMap[".item:hover"] || "";
  var hoverToken = (hoverVar.match(/var\((--[a-z0-9-]+)\)/) || [])[1];
  var hoverReal = hoverToken ? getComputedStyle(document.documentElement).getPropertyValue(hoverToken).trim() : hoverVar;
  var hoverContrast = contrast(hoverReal, "#ffffff");
  var clickables = document.querySelectorAll("button, a.btn");
  var noFocus = [];
  Array.prototype.forEach.call(clickables, function (el) {
    var hit = focusSels.some(function (s) {
      // 注意：不能直接用 el.matches(s)，:focus-visible 是动态伪类，当前没聚焦就永远 false。
      // 所以先去掉伪类，判断"这个元素是否被该选择器覆盖"。
      var base = s.replace(":focus-visible", "").trim();
      if (!base) return false;
      try { return el.matches(base); } catch (e) { return false; }
    });
    if (!hit && noFocus.length < 8) noFocus.push((el.id || el.className) + "：" + (el.textContent || "").trim().slice(0, 8));
  });

  // ---------- 4) 间距刻度（DR-4）----------
  var spacingSet = {};
  var props = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
               "marginTop", "marginRight", "marginBottom", "marginLeft", "gap", "rowGap", "columnGap"];
  Array.prototype.forEach.call(document.querySelectorAll("*"), function (el) {
    var cs = getComputedStyle(el);
    props.forEach(function (p) {
      var v = parseFloat(cs[p]);
      if (!isNaN(v) && v > 0 && v <= 64) spacingSet[v] = true;   // >64 属于自动居中类布局偏移，不算"间距"
    });
  });
  var spacingValues = Object.keys(spacingSet).map(Number).sort(function (a, b) { return a - b; });
  var offGrid = spacingValues.filter(function (v) { return v % 4 !== 0; });

  // ---------- 5) 对齐（DR-5）----------
  var colName = rectOf(".column-head .column-name");
  var rank = rectOf(".item-rank");
  var star = rectOf(".item-star");
  var count = rectOf(".column-count");
  var align = {
    栏名文字左边缘: colName ? colName.left : null,
    条目序号左边缘: rank ? rank.left : null,
    左边缘差: colName && rank ? r1(rank.left - colName.left) : null,
    栏条数右边缘: count ? count.right : null,
    星标右边缘: star ? star.right : null,
    右边缘差: count && star ? r1(star.right - count.right) : null
  };

  // ---------- 6) 点击区（DR-7）----------
  var small = [];
  Array.prototype.forEach.call(clickables, function (el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.height < 40) {
      small.push({
        元素: (el.id || el.className), 文本: (el.textContent || "").trim().slice(0, 8),
        尺寸: Math.round(r.width) + "x" + Math.round(r.height)
      });
    }
  });

  // ---------- 7) 字号阶梯（DR-6）----------
  var sizeSet = {};
  Array.prototype.forEach.call(document.querySelectorAll("body *"), function (el) {
    if (!(el.textContent || "").trim()) return;
    if (el.children.length > 0) return;               // 只看叶子节点，避免继承重复计数
    var v = Math.round(parseFloat(getComputedStyle(el).fontSize));
    sizeSet[v] = (sizeSet[v] || 0) + 1;
  });
  var sizes = Object.keys(sizeSet).map(Number).sort(function (a, b) { return a - b; });
  var sizeGaps = [];
  for (var i = 1; i < sizes.length; i++) sizeGaps.push(sizes[i] - sizes[i - 1]);

  // ---------- 8) 圆角（DR-8）----------
  var radius = {};
  [".column", ".item", ".btn", ".fav-item", ".modal", ".item-star"].forEach(function (s) {
    var el = document.querySelector(s);
    if (el) radius[s] = getComputedStyle(el).borderTopLeftRadius;
  });

  return JSON.stringify({
    视口: innerWidth + "x" + innerHeight,
    横向溢出: document.documentElement.scrollWidth > innerWidth,
    页面高度: document.body.scrollHeight,
    "DR-1_文字对比度": texts,
    "DR-1_不达标": textFail.length ? textFail : "无",
    "DR-2_界面元素": ui,
    "DR-3_hover底色": hoverReal + "（" + hoverContrast + ":1）",
    "DR-3_焦点样式选择器": focusSels,
    "DR-3_可点击元素数": clickables.length,
    "DR-3_无焦点样式的": noFocus.length ? noFocus : "无",
    "DR-4_间距取值": spacingValues,
    "DR-4_不在4倍数上的": offGrid.length ? offGrid : "无",
    "DR-5_对齐": align,
    "DR-6_字号集合": sizes,
    "DR-6_相邻差值": sizeGaps,
    "DR-7_高度不足40的": small.length ? small : "无",
    "DR-8_圆角": radius
  }, null, 1);
})()

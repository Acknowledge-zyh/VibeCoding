#!/usr/bin/env node
/**
 * db-snapshot.js —— 执行 db/verify.sql 的每条查询，打印结果，并生成一张取证页
 *
 * 用法：node scripts/db-snapshot.js
 * 产出：
 *   1) 终端里逐条打印每张表/每项结构的查询结果（这就是「select 验证」）
 *   2) 打卡/db-snapshot.html —— 把这些真实结果渲染成「数据库表数据」页面，
 *      可直接打开截图取证（控制台界面需要账号登录，这份是等价的实取数据）
 *
 * verify.sql 里用 `-- @panel <英文名> | <标题>` 把文件切成若干面板，本脚本据此分组。
 */

const fs = require("fs");
const path = require("path");
const { repoRoot, readEnvId, runSql } = require("./lib/tcb");

/** 把 verify.sql 按 `-- @panel id | 标题` 切成若干面板 */
function parsePanels(text) {
  const panels = [];
  let cur = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^--\s*@panel\s+(\S+)\s*\|\s*(.+?)\s*$/);
    if (m) {
      cur = { id: m[1], title: m[2], lines: [] };
      panels.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
  }
  return panels.map((p) => ({
    id: p.id,
    title: p.title,
    sql: p.lines.filter((l) => !/^\s*--/.test(l)).join("\n").trim(),
  }));
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function main() {
  const envId = readEnvId();
  const file = path.join(repoRoot, "db", "verify.sql");
  if (!fs.existsSync(file)) {
    console.error("找不到 db/verify.sql");
    process.exit(1);
  }
  const panels = parsePanels(fs.readFileSync(file, "utf8"));
  if (!panels.length) {
    console.error("db/verify.sql 里没有找到 `-- @panel` 标记");
    process.exit(1);
  }

  console.log(`目标环境：${envId}\n`);

  const out = [];
  let failed = false;

  for (const p of panels) {
    const r = runSql(p.sql, { json: true });
    let columns = [];
    let rows = [];
    if (r.ok && r.json && r.json.data) {
      columns = r.json.data.Columns || [];
      rows = (r.json.data.Rows || []).map((s) => {
        try { return JSON.parse(s); } catch (e) { return [s]; }
      });
    } else {
      failed = true;
    }
    out.push({ id: p.id, title: p.title, sql: p.sql, columns, rows, ok: r.ok });

    console.log(`===== ${p.title} =====`);
    if (!r.ok) {
      console.log("（查询失败）\n");
      continue;
    }
    console.log(`${rows.length} 行`);
    console.log(columns.join(" | "));
    for (const row of rows) console.log(row.map((v) => (v === null ? "NULL" : v)).join(" | "));
    console.log("");
  }

  const html = render(out, envId);
  const dest = path.join(repoRoot, "打卡", "db-snapshot.html");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html, "utf8");
  console.log(`取证页已生成：${dest}`);
  console.log(`打开（默认第一项）：file:///${dest.replace(/\\/g, "/")}`);
  console.log(`指定面板：file:///${dest.replace(/\\/g, "/")}?p=trends`);

  if (failed) process.exit(1);
}

function render(panels, envId) {
  const data = JSON.stringify(panels.map((p) => ({
    id: p.id, title: p.title, sql: p.sql, columns: p.columns, rows: p.rows,
  })));
  const stamp = new Date().toLocaleString("zh-CN", { hour12: false });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>今日热搜 · 数据库表数据</title>
<style>
  :root{--bg:#f6f7f9;--panel:#fff;--line:#e3e6eb;--text:#1f2329;--dim:#6b7280;--brand:#2f6feb;--head:#f0f3f8;}
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--text);background:var(--bg)}
  header{background:#fff;border-bottom:1px solid var(--line);padding:12px 20px;display:flex;align-items:center;gap:12px}
  header h1{font-size:15px;margin:0;font-weight:600}
  .badge{font-size:12px;color:var(--dim);background:var(--head);border:1px solid var(--line);border-radius:20px;padding:2px 10px}
  .wrap{display:flex;gap:16px;padding:16px 20px;align-items:flex-start}
  aside{width:270px;flex:0 0 270px;background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
  aside .hd{padding:9px 12px;font-size:12px;color:var(--dim);border-bottom:1px solid var(--line);background:var(--head)}
  aside a{display:flex;justify-content:space-between;gap:8px;padding:10px 12px;color:var(--text);text-decoration:none;border-bottom:1px solid var(--line);font-size:13px}
  aside a:last-child{border-bottom:0}
  aside a:hover{background:#f8fafc}
  aside a.on{background:#eef4ff;color:var(--brand);font-weight:600;box-shadow:inset 3px 0 0 var(--brand)}
  aside a .n{color:var(--dim);font-weight:400;font-size:12px}
  main{flex:1;min-width:0}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:8px;overflow:hidden}
  .card .hd{padding:11px 14px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .card .hd h2{margin:0;font-size:14px;font-weight:600}
  .card .hd .cnt{font-size:12px;color:var(--dim)}
  pre.sql{margin:0;padding:9px 14px;background:#fbfcfd;border-bottom:1px solid var(--line);font:12px/1.5 Consolas,Menlo,monospace;color:#4b5563;white-space:pre-wrap}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{border-bottom:1px solid var(--line);padding:7px 12px;text-align:left;white-space:nowrap}
  th{background:var(--head);font-weight:600;font-size:12px;color:#374151;position:sticky;top:0}
  tr:last-child td{border-bottom:0}
  td.id{font-family:Consolas,Menlo,monospace;color:#6b7280;font-size:12px}
  td.null{color:#9aa1ab;font-style:italic}
  footer{padding:6px 20px 22px;color:var(--dim);font-size:12px;line-height:1.8}
  code{background:#eef1f5;padding:1px 5px;border-radius:3px;font-family:Consolas,Menlo,monospace;font-size:12px}
</style>
</head>
<body>
<header>
  <h1>「今日热搜」案例 · 数据库表数据</h1>
  <span class="badge">CloudBase PostgreSQL 17 · 环境 ${esc(envId)}</span>
  <span class="badge">导出于 ${esc(stamp)}</span>
</header>
<div class="wrap">
  <aside>
    <div class="hd">结构验证 + 两张核心表</div>
    <div id="nav"></div>
  </aside>
  <main><div class="card">
    <div class="hd"><h2 id="title"></h2><span class="cnt" id="cnt"></span></div>
    <pre class="sql" id="sql"></pre>
    <div style="overflow:auto;max-height:calc(100vh - 210px)"><table id="tbl"></table></div>
  </div></main>
</div>
<footer>
  数据来源：<code>node scripts/db-snapshot.js</code> → 逐条执行 <code>db/verify.sql</code> →
  <code>tcb db execute --json</code> 从 CloudBase 环境 ${esc(envId)} 实时取回（非手工编造）。
  控制台界面（tcb.cloud.tencent.com）需要账号登录，此页是可截图留证的等价结果。
</footer>
<script>
const DATA = ${data};
const q = new URLSearchParams(location.search);
const pid = q.get('p') || DATA[0].id;
const nav = document.getElementById('nav');
DATA.forEach(p => {
  const a = document.createElement('a');
  a.href = '?p=' + p.id;
  a.className = (p.id === pid ? 'on' : '');
  a.innerHTML = '<span>' + p.title.replace(/^表 \\d｜/, '') + '</span><span class="n">' + p.rows.length + '</span>';
  nav.appendChild(a);
});
const cur = DATA.find(p => p.id === pid) || DATA[0];
document.getElementById('title').textContent = cur.title;
document.getElementById('cnt').textContent = cur.rows.length + ' 行';
document.getElementById('sql').textContent = cur.sql;
const t = document.getElementById('tbl');
const thead = document.createElement('thead');
const tr = document.createElement('tr');
cur.columns.forEach(c => { const th = document.createElement('th'); th.textContent = c; tr.appendChild(th); });
thead.appendChild(tr); t.appendChild(thead);
const tb = document.createElement('tbody');
cur.rows.forEach(r => {
  const trr = document.createElement('tr');
  r.forEach((v, i) => {
    const td = document.createElement('td');
    if (v === null) { td.textContent = 'NULL'; td.className = 'null'; }
    else { td.textContent = v; if (cur.columns[i] === 'id') td.className = 'id'; }
    trr.appendChild(td);
  });
  tb.appendChild(trr);
});
t.appendChild(tb);
</script>
</body>
</html>`;
}

main();

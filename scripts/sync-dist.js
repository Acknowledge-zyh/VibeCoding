/* sync-dist.js — 把需要部署的静态文件同步到 dist/
   用法：node scripts/sync-dist.js
   原则（TECH_DESIGN 10.2）：只部署静态资源，绝不把 .md 文档、.env、打卡/ 传上去 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

// 需要部署的文件清单（阶段 2 加云函数后如需调整，只改这里）
const files = ["index.html", "styles.css", "app.js"];
const dirs = { "data": ["hot.json"] };

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "data"), { recursive: true });

let count = 0;
files.forEach((f) => {
  fs.copyFileSync(path.join(root, f), path.join(dist, f));
  console.log("已同步", f);
  count++;
});
Object.entries(dirs).forEach(([dir, list]) => {
  fs.mkdirSync(path.join(dist, dir), { recursive: true });
  list.forEach((f) => {
    fs.copyFileSync(path.join(root, dir, f), path.join(dist, dir, f));
    console.log("已同步", dir + "/" + f);
    count++;
  });
});
console.log("完成：dist/ 共 " + count + " 个文件，可以部署了。");

#!/usr/bin/env node
/**
 * db-apply.js —— 把 db/ 下的 SQL 文件整体应用到 CloudBase PostgreSQL
 *
 * 用法：
 *   node scripts/db-apply.js db/schema.sql
 *   node scripts/db-apply.js db/seed.sql
 *   node scripts/db-apply.js db/schema.sql db/seed.sql      # 可一次传多个，按顺序执行
 *
 * 幂等性见各 SQL 文件开头的说明（schema.sql：全部 if not exists；
 * seed.sql：先 DROP 再 CREATE 再 INSERT，结果与首次执行逐行一致）。
 * 环境 ID 从 cloudbaserc.json 读，SQL 内容原样送达（不经过 shell 拼串）。
 */

const fs = require("fs");
const path = require("path");
const { repoRoot, readEnvId, runSql, cleanOutput } = require("./lib/tcb");

function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error("用法：node scripts/db-apply.js <sql 文件> [更多 sql 文件...]");
    process.exit(1);
  }
  const envId = readEnvId();
  console.log(`目标环境：${envId}\n`);

  for (const f of files) {
    const abs = path.resolve(repoRoot, f);
    if (!fs.existsSync(abs)) {
      console.error(`✗ 文件不存在：${abs}`);
      process.exit(1);
    }
    const sql = fs.readFileSync(abs, "utf8");
    const stmtCount = sql.split(";").filter((s) => s.replace(/--[^\n]*/g, "").trim()).length;

    console.log(`===== 应用 ${path.relative(repoRoot, abs)} =====`);
    console.log(`（${Buffer.byteLength(sql, "utf8")} 字节，约 ${stmtCount} 条语句）`);

    const r = runSql(sql);
    console.log(cleanOutput(r.text));

    if (!r.ok) {
      console.error(`✗ ${path.basename(abs)} 执行未成功（退出码 ${r.status}）`);
      process.exit(1);
    }
    console.log(`✓ ${path.basename(abs)} 执行完成\n`);
  }

  console.log("全部完成。");
}

main();

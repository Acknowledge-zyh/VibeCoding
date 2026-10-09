/**
 * scripts/lib/tcb.js —— CloudBase CLI 调用封装（scripts/ 下各脚本共用）
 *
 * 为什么要有这一层：
 *   `tcb db execute --sql "<SQL>"` 要把 SQL 当命令行参数传。SQL 里带单引号、换行和中文，
 *   经由 shell 拼字符串极易被转义搞坏（Windows 的 bash 尤其明显）。
 *   这里统一用「不经过 shell 的参数数组」调用 CLI，SQL 原样送达。
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");

/** 从 cloudbaserc.json 读环境 ID（换环境只改那一处） */
function readEnvId() {
  const p = path.join(repoRoot, "cloudbaserc.json");
  if (!fs.existsSync(p)) return "";
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")).envId || "";
  } catch (e) {
    return "";
  }
}

/** 找 CloudBase CLI 入口（该入口是 JS 脚本，用 node 直接执行） */
function findTcbCli() {
  const win = process.platform === "win32";
  const exe = win ? ".cmd" : "";
  const candidates = [
    process.env.TCB_CLI,
    path.join(repoRoot, "node_modules", "@cloudbase", "cli", "bin", "tcb"),
    path.join(repoRoot, "node_modules", ".bin", "tcb" + exe),
    path.join(os.homedir(), ".workbuddy", "binaries", "node", "workspace",
              "node_modules", "@cloudbase", "cli", "bin", "tcb"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "";
}

/**
 * 执行一段 SQL。
 * @param {string} sql
 * @param {{json?: boolean}} [opts] json=true 时用 --json 取结构化结果
 * @returns {{ok:boolean, status:number, json:any|null, text:string}}
 */
function runSql(sql, opts = {}) {
  const envId = readEnvId();
  if (!envId) throw new Error("cloudbaserc.json 里没有 envId，无法确定目标环境。");
  const cli = findTcbCli();
  if (!cli) {
    throw new Error(
      "找不到 CloudBase CLI。请先安装：npm i -D @cloudbase/cli，或用环境变量 TCB_CLI 指向 tcb 入口。"
    );
  }

  const args = ["db", "execute", "-e", envId, "--sql", sql];
  if (opts.json) args.push("--json");

  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const text = ((r.stdout || "") + (r.stderr || "")).replace(/\r/g, "");
  let json = null;
  if (opts.json && r.status === 0) {
    const start = text.indexOf("{");
    if (start >= 0) {
      try {
        json = JSON.parse(text.slice(start));
      } catch (e) {
        json = null;
      }
    }
  }

  const failed = r.status !== 0 || /denied|does not exist|syntax error|ERROR:/i.test(text);
  return { ok: !failed, status: r.status, json, text };
}

/** 把 CLI 输出里的版本横幅等噪音行去掉 */
function cleanOutput(text) {
  return text
    .split("\n")
    .filter((l) => l.trim() && !/^CloudBase CLI|^Try the tcb ai/.test(l))
    .join("\n");
}

module.exports = { repoRoot, readEnvId, findTcbCli, runSql, cleanOutput };

# 运行说明（MVP v0 · Day 7）

> 本文件是 Day 7 完成标准之一：运行命令已存档。照着做，30 秒能把页面跑起来。

## 怎么启动

本项目是纯静态页面（阶段 1），本地用一个简单 HTTP 服务器即可运行。

**方式一：Python（推荐，电脑上已有）**

在项目文件夹 `C:\Users\唯我独尊\Desktop\VibeCoding` 打开终端，执行：

```
python -m http.server 8000
```

**方式二：Node.js**

```
npx serve .
```

**方式三：直接双击 `index.html`**

也能打开（因为阶段 1 数据是本地 JSON，用 `fetch` 读取时部分浏览器在 `file://` 下会拦截，
推荐优先用方式一/二）。

## 怎么验证（对应 PRD 8.1 验收标准）

1. 浏览器打开 **http://localhost:8000** → 地址栏是 localhost 开头（今日打卡截图要求）
2. **A1**：看到 4 个板块（微博 / 百度 / 知乎 / 抖音），每块 10 条，共 40 条
3. **A2**：顶栏有「今日热搜 / 更新于 HH:MM / 我的收藏 / 刷新」；
   点任意条目弹出**详情弹层**（Esc 或点外部可关闭）；
   点「我的收藏」滑出**收藏抽屉**
4. 顺手可试：点 ★ 收藏一条 → 底纹变红、角标 +1 → 关闭浏览器再打开，收藏还在（localStorage）
5. 手机效果：浏览器按 F12 打开开发者工具 → 切换手机模拟（如 iPhone SE 尺寸）→
   四列变单列、无横向滚动、弹层全屏

## 当前数据说明

- 页面显示的是 **`data/hot.json` 本地样本数据**（标题、热度均为示例，非真实榜单）
- Day 8 起接云函数后换成真实数据；届时只需改 `app.js` 顶部的 `DATA_URL` 一行

## 本期明确不做（遵守任务边界）

登录、支付、复杂缓存、数据库、React/Vite 框架——均按 PRD 3.2 与 TECH_DESIGN 第 14 章推迟。

## 部署到 CloudBase 静态托管（第 2 步，路线已定：方案 B）

**每次改完代码的固定流程**（先提交、再部署，TECH_DESIGN 10.5）：

```
node scripts/sync-dist.js     # ① 把最新静态文件同步进 dist/
git add ... && git commit ... # ② 提交（标题 Day X｜…）
git push                      # ③ 推送
# ④ 部署 dist/ → 线上验证刚改的行为
```

**首次部署（等你开通环境后做）**

1. 开通 CloudBase 环境（见下方「你的动作」），记下**环境 ID**（形如 `cloud1-xxxxx`）
2. 把环境 ID 填进 `cloudbaserc.json` 的 `envId`（换环境只改这一处）
3. 部署二选一：
   - **CLI**：`npx tcb login`（浏览器授权）→ `npx tcb hosting deploy dist -e 你的环境ID`
   - **控制台**：CloudBase 控制台 → 静态网站托管 → 文件管理 → 把 `dist/` 里的内容上传
4. 浏览器打开默认域名 → 应看到四列热搜页；手机再开一次 → 单列无横滚
5. 关掉电脑、换台设备再开一次 → 页面还在（B12 前置验证）

**你的动作（一次性的账号准备，我无法代办）**

- 登录腾讯云 https://cloud.tencent.com → 完成实名认证
- 开通云开发 CloudBase：https://tcb.cloud.tencent.com/ → 创建环境
- ⚠️ 创建环境时**数据库类型选 PostgreSQL**（本期不用，但类型事后不可改，为二期占位——TECH_DESIGN 3.3 取舍二）
- 把环境 ID 发我，我带你走完部署

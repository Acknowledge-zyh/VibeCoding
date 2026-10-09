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
2. **A1**：看到 3 个平台（微博 / 抖音 / B站），每块 10 条，共 30 条
   （Day 12 起数据源改为 3 平台样本；百度/知乎条目仍在 `data/hot.json` 里但暂不展示）
3. **A2**：顶栏有「今日热搜 / 更新于 HH:MM / 我的收藏 / 刷新」；
   点任意条目弹出**详情弹层**（Esc 或点外部可关闭）；
   点「我的收藏」滑出**收藏抽屉**
4. 顺手可试：点 ★ 收藏一条 → 底纹变红、角标 +1 → 关闭浏览器再打开，收藏还在（localStorage）
5. 手机效果：浏览器按 F12 打开开发者工具 → 切换手机模拟（如 iPhone SE 尺寸）→
   四列变单列、无横向滚动、弹层全屏

### 打不开怎么办（Day 14 真人测试实测踩过的坑）

1. **地址栏 ≠ 搜索框**：把 `http://localhost:8000` 粘贴到浏览器**最上方的地址栏**再回车。
   输进页面中间的搜索框/搜索引擎会被当成搜索词，表现就是「网页搜不到」。
2. **端口被残留服务占用（本次真凶）**：多次执行启动命令会堆出多个 `http.server` 同时占用 8000，
   连接被随机分给其中一个，表现为**时好时坏**。排查与清理：
   ```
   netstat -ano | findstr :8000        # LISTENING 后面出现多个 PID = 有重复
   taskkill /PID <PID> /F              # 逐个结束（保留一个即可），再重新启动一次
   ```
3. **手机打不开**：改用 `http://<本机局域网IP>:8000`（`ipconfig` 看 IPv4 地址）；
   仍不行多为路由器开了「AP 隔离」，属网络环境限制，不是页面问题。

## 视图与地址（Day 13 起）

页面改为 hash 路由的 3 个独立视图，地址栏始终反映当前位置，刷新/分享链接都能直达：

| 地址 | 视图 | 说明 |
| --- | --- | --- |
| `#/home`（默认） | 首页 | 四平台板块 + 关键词/平台筛选；`#/home/微博` 直达单平台 |
| `#/platforms` | 平台列表页 | 全部平台一屏总览 + 关键词筛选 |
| `#/detail/<条目>` | 热搜详情页 | 单条详情，含面包屑、收藏/备注/复制链接、上一条/下一条 |

- 列表内点条目仍弹**详情弹层**（快速查看）；弹层里点「查看完整页」进独立详情页
- 浏览器**前进/后退** = 视图切换历史；未知地址自动回到 `#/home`
- 列表四状态（加载中 / 没有结果 / 请求失败）可用预览开关查看：
  `http://localhost:8000/?state=loading#/home`、`?state=empty`、`?state=error`，
  平台与详情视图同理；收藏失败开关 `?favfail=1`

## 当前数据说明

- 页面显示的是 **`data/hot.json` 本地样本数据**（标题、热度均为示例，非真实榜单）
- Day 8 起接云函数后换成真实数据；届时只需改 `app.js` 顶部的 `DATA_URL` 一行

## 本期明确不做（遵守任务边界）

登录、支付、复杂缓存、数据库、React/Vite 框架——均按 PRD 3.2 与 TECH_DESIGN 第 14 章推迟。

## 部署到 CloudBase（公网地址）

环境：`acknowledge-d9gnqrpy89f1f7d21`（上海 ap-shanghai，体验版，到期 2027-03-22）

| 用途 | 公网地址 |
| --- | --- |
| 前端页面 | `https://acknowledge-d9gnqrpy89f1f7d21-1493626656.tcloudbaseapp.com/` |
| 健康检查接口 | `https://acknowledge-d9gnqrpy89f1f7d21.service.tcloudbase.com/api/health` |

### A. 云函数 `/api/health` —— 从创建到公网访问

1. **写代码**：`cloudfunctions/health/index.js`（**事件型**云函数 `exports.main`，返回 `{ ok, service, time }`）
2. **登录 CLI**（首次，本机已登录、凭据在 `~/.cloudbase/auth.json`）：`tcb login`
3. **部署 + 开通 HTTP 访问路径**（一条命令完成）：
   ```
   tcb fn deploy health -e acknowledge-d9gnqrpy89f1f7d21 --path /api/health --runtime Nodejs18.15 --force
   ```
   成功会打印：`Cloud function HTTP access service link: https://…service.tcloudbase.com/api/health`
4. **验证**：见 C。

### B. 前端 mock 版 —— 从构建到公网访问

> 本项目是**纯静态**原生页面（不是 React —— 见「本期明确不做」），「构建」= 把源码同步进 `dist/`。

1. **同步静态文件**：`node scripts/sync-dist.js`（把 `index.html / styles.css / app.js / data/` 复制进 `dist/`）
2. **部署到静态托管**：
   ```
   tcb hosting deploy dist -e acknowledge-d9gnqrpy89f1f7d21 --verify
   ```
3. **验证**：见 C。

### C. 部署后怎么验证

**云函数**：浏览器打开
`https://acknowledge-d9gnqrpy89f1f7d21.service.tcloudbase.com/api/health`
→ 应看到**一段 JSON**（不是网页）：

```json
{ "ok": true, "service": "hot-search-demo", "time": "2026-10-09T03:46:27.877Z" }
```

- `ok` 为 `true`：服务正常
- `time` **每次刷新都会变**：说明真的在跑云函数，不是缓存的静态文件
- 首次在浏览器打开可能先看到 CloudBase「页面访问提示」确认页，点「确定访问」即见 JSON
- 命令行等价验证：`curl https://…service.tcloudbase.com/api/health`

**前端**：浏览器打开
`https://acknowledge-d9gnqrpy89f1f7d21-1493626656.tcloudbaseapp.com/`
→ 应看到「今日热搜」首页（微博 / 抖音 / B站 三栏榜单 + 顶部筛选）；
再开 `…/#/platforms`（平台列表页）、`…/#/detail/<条目>`（详情页）应能直达。
手机连任意网络开同一地址也应能打开（单列布局）。

### D. 每次改完代码的固定流程

```
node scripts/sync-dist.js                        # ① 把最新静态文件同步进 dist/
git add ... && git commit ...                    # ② 提交（标题 Day X｜…）
git push                                         # ③ 推送
tcb hosting deploy dist -e acknowledge-d9gnqrpy89f1f7d21 --verify   # ④ 部署前端
# 改了云函数再补一步：
tcb fn deploy health -e acknowledge-d9gnqrpy89f1f7d21 --path /api/health   # ⑤ 部署函数
```

> **接口还没接**：前端页面目前仍读本地 `data/hot.json`，**没有**调用 `/api/health` 或任何接口；
> 跨域（CORS）也**尚未配置**。等接接口那天再做（见 `api-contract.md` 1.1 的跨域提醒）。

### E. 两个实测踩过的坑（别再踩）

1. `/api/health` 必须用**事件型云函数** + `--path`（**不要**加 `--httpFn`）。
   `--httpFn` 是 Web 函数（要 `scf_bootstrap` 自起端口），它建的访问路径会报
   `400 FUNCTIONS_PARAM_INVALID: FunctionType parameter is invalid`。
2. 环境默认域名不允许手工加路由（`tcb routes add` 会报 system internal domain）；
   要挂路径就用 `fn deploy --path`，要挂自定义域名才走 `routes`。

### F. 环境信息（额度 / 到期）

`tcb env list` 看环境 ID、到期日期与状态；`tcb env usage` 看额度消耗。
本环境为体验版，到期 **2027-03-22**，当前额度消耗 0.00。

### G. 接口契约

所有接口（已实现 1 个 + 占位 6 个）的路径、方法、参数、响应形状、错误返回，统一见 `api-contract.md`。

### H. 数据库（案例演示表：trends / favorites）

> ⚠️ 这两张表是**案例演示表**，只用于跑通「建表 → 灌种子 → select 验证」链路，不是生产设计。
> 同一环境里另有六级单词复习项目的三张表（`words` / `learn_records` / `review_records`），互不影响。

**两张表存什么、靠什么关联**

| 表 | 存什么 | 关联 |
| --- | --- | --- |
| `trends` | 热搜条目：某平台某天榜单上的一条（标题、热度、排名、抓取时间），**每日一份快照** | 被引用方（`id`） |
| `favorites` | 收藏：把哪条热搜收进了列表、备注是什么 | `trends_id → trends.id`（外键） |

唯一索引建在 `trends (platform, title, trend_date)` 上：同平台同一天的同一条只允许一行；
「日期」必须进索引，因为同一条新闻连着两天上榜是正常的，只有同一天才需要去重。

**执行步骤**

- 控制台方式：`tcb.cloud.tencent.com` → 进入环境 `acknowledge-d9gnqrpy89f1f7d21` →
  左侧「数据库」→ PostgreSQL 的 SQL 执行入口（不同版本叫「SQL 编辑器 / SQL 运行 / 命令行」）→
  把 `db/schema.sql` 的内容整段粘贴执行 → 再把 `db/seed.sql` 粘贴执行。
- 命令行方式（本仓库实测用的就是它，SQL 原样送达不经 shell 转义）：

```
node scripts/db-apply.js db/schema.sql    # 建表（全部 if not exists，可重复执行）
node scripts/db-apply.js db/seed.sql      # 灌种子（先 DROP 再 CREATE 再 INSERT）
```

**验证方法（select 查看插入的行）**

```
node scripts/db-snapshot.js        # 逐条执行 db/verify.sql：打印结果 + 生成 打卡/db-snapshot.html 取证页
```

或直接对库执行（控制台/CLI 均可）：

```sql
select id, title, heat, platform, "rank", trend_date, fetched_at
from trends where trend_date = current_date order by platform, "rank";   -- 预期 15 行

select f.id, f.trends_id, t.platform, t.title, f.note, f.created_at
from favorites f join trends t on t.id = f.trends_id
order by f.created_at desc;                                              -- 预期 6 行
```

实测结果（2026-10-09）：`trends` 18 行（今天 15 + 昨天 3）、`favorites` 6 行；
重复执行 `seed.sql` 三次结果逐行一致；故意插入重复行 / 不存在的 `trends_id` / `rank=0`
分别被唯一索引（23505）、外键（23503）、CHECK（23514）挡下。

**⚠️ `seed.sql` 会清空这两张表**：它按案例要求「先 DROP 再 CREATE 再 INSERT」，跑一遍就重置一遍，
只适合演示。真实项目的种子脚本应该学六级单词复习项目的写法——只删自己插入的那批（id 带 `seed-` 前缀）
加 UPSERT，不动别人的数据。

字段类型为什么这么选（text / bigint / smallint / date / timestamptz / varchar(50)…）
逐列写在 `db/schema.sql` 末尾的「字段类型选型说明」里。

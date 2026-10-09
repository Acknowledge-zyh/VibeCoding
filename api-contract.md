# api-contract.md —— 接口契约

> 本文件是前后端之间的「约定书」。写代码之前先把接口长什么样定死，后面谁改都会先来这里对一遍。
> 今天只落地 **1 个真实接口**（`GET /api/health`）；其余业务接口**只登记形状、不实现**（按计划 Day 16–20 / 第 4 周再填）。

---

## 1. 通用约定

### 1.1 基础地址

| 用途 | 地址 |
| --- | --- |
| 接口基础地址（Base URL） | `https://acknowledge-d9gnqrpy89f1f7d21.service.tcloudbase.com` |
| 前端页面地址 | `https://acknowledge-d9gnqrpy89f1f7d21-1493626656.tcloudbaseapp.com/` |
| 环境 ID | `acknowledge-d9gnqrpy89f1f7d21`（上海 ap-shanghai，体验版） |

> ⚠️ 前端页面与接口**不在同一个域名**（`…tcloudbaseapp.com` vs `…service.tcloudbase.com`），属于跨域。
> 健康检查可以用浏览器/curl 直接访问；**前端页面里 `fetch` 调接口之前必须先配 CORS —— 按计划留到后面对应天次**，今天不处理。

### 1.2 统一响应约定

所有接口一律返回同一个扁平结构，前端写一套判断即可：

**成功**

```json
{ "ok": true, "...": "该接口自己的业务字段" }
```

**失败**

```json
{ "ok": false, "error": { "code": "INVALID_PARAM", "message": "platform 不能为空" } }
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `ok` | boolean | 是 | 唯一判据：`true` = 成功，`false` = 失败 |
| `error` | object | 失败时必填 | 失败时的错误体，成功时不出现 |
| `error.code` | string | 是 | 机器可读的错误码（见 1.4） |
| `error.message` | string | 是 | 给人看的一句话说明 |

> 约定：成功时业务数据**直接挂在顶层**（如 `items` / `item` / `synced`），不再套 `data` 壳；
> 失败时只出现 `ok:false` + `error`。前端判断成败只需看 `ok`。

### 1.3 通用规则

- **请求方法**：只读用 `GET`；新增用 `POST`；局部修改用 `PATCH`；删除用 `DELETE`。
- **请求/响应体**：`Content-Type: application/json; charset=utf-8`，UTF-8 编码。
- **时间格式**：所有时间字段用 **UTC ISO 8601**（如 `2026-10-09T03:46:27.877Z`），
  不在服务端拼本地时区，由前端按用户时区展示。
- **不做分页**：当前数据量小（3 平台 × 10 条），等接真实数据源再定分页参数。
- **不改已发布字段含义**：如需变更字段，先改本文件并登记变更记录，再动代码。

### 1.4 错误码与 HTTP 状态码

| `error.code` | HTTP | 含义 | 前端建议处理 |
| --- | --- | --- | --- |
| —（`ok:true`） | 200 / 201 | 成功 | 正常渲染 |
| `INVALID_PARAM` | 400 | 参数不合法 | 提示用户检查输入 |
| `NOT_FOUND` | 404 | 资源不存在（如收藏 id 不存在） | 提示「未找到」，回到列表 |
| `UPSTREAM_FAILED` | 502 | 上游数据源获取失败 | 显示「请求失败」状态 + 重试，保留旧数据 |
| `INTERNAL_ERROR` | 500 | 服务内部错误 | 同上 |

> 说明：错误用**真实 HTTP 状态码**（400/404/500…）配合 `ok:false`。
> 网关层的非业务错误格式与上面不同，例如路径没映射到函数时会返回
> `{ "code": "FUNCTIONS_PARAM_INVALID", "message": "..." }`（注意：这种没有 `ok` 字段）。

---

## 2. `GET /api/health` —— 健康检查（✅ 已实现）

**用途**：探活。前端启动时先打一次，判断「后端通不通」；运维也可拿它做监控。
只返回服务自身状态，不碰数据库、不含业务逻辑，所以足够快、足够可信。

### 2.1 请求

| 项 | 值 |
| --- | --- |
| 方法 | `GET` |
| 路径 | `/api/health` |
| 请求参数 | 无 |
| 请求头 | 无特殊要求 |

完整地址：`https://acknowledge-d9gnqrpy89f1f7d21.service.tcloudbase.com/api/health`

### 2.2 响应字段（HTTP 200）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ok` | boolean | 固定 `true`，表示服务正常 |
| `service` | string | 服务标识，固定 `"hot-search-demo"` |
| `time` | string | 服务端当前时间，UTC ISO 8601 |

### 2.3 成功示例

请求：

```bash
curl https://acknowledge-d9gnqrpy89f1f7d21.service.tcloudbase.com/api/health
```

响应（HTTP 200，2026-10-09 实测）：

```json
{ "ok": true, "service": "hot-search-demo", "time": "2026-10-09T03:46:27.877Z" }
```

### 2.4 错误

本接口不查库、不依赖外部服务，**正常不会返回错误**。若出现错误，属于网关/部署层面：

| 场景 | 表现 |
| --- | --- |
| 函数未部署 / 路径未映射 | 网关返回 4xx + `{"code":"FUNCTIONS_..."}`（无 `ok` 字段） |

### 2.5 实现位置

| 项 | 值 |
| --- | --- |
| 代码 | `cloudfunctions/health/index.js` |
| 函数名 | `health`（**事件型**云函数，集成响应格式） |
| 部署 | `tcb fn deploy health -e <envId> --path /api/health --runtime Nodejs18.15 --force` |
| 注意 | **不要加 `--httpFn`**（那是 Web 函数，建的访问路径会报 `400 FUNCTIONS_PARAM_INVALID`） |

---

## 3. 后续接口（占位 · 未实现）

> 以下**均未实现**，只先把形状定下来，避免后面各写各的。

### 3.1 `GET /api/hot` —— 获取热搜列表

| 项 | 值 |
| --- | --- |
| 方法 | `GET` |
| 路径 | `/api/hot` |
| 请求参数 | `platform`（query，**可选**，如 `微博`；不传 = 返回全部平台） |

**响应（HTTP 200）**

```json
{
  "ok": true,
  "items": [
    { "id": "weibo-1", "platform": "微博", "rank": 1, "title": "…", "heat": 1234567, "url": "https://…", "time": "2026-10-09T00:00:00.000Z" }
  ],
  "updatedAt": "2026-10-09T03:00:00.000Z"
}
```

- `items[]`：热搜条目数组；字段沿用现有本地样本 `data/hot.json`（对齐 TECH_DESIGN.md 5.2）
- `updatedAt`：数据更新时间，UTC ISO 8601

**错误**：`502 UPSTREAM_FAILED`（上游数据源获取失败）｜`500 INTERNAL_ERROR`

### 3.2 `GET /api/favorites` —— 获取收藏列表

| 项 | 值 |
| --- | --- |
| 方法 | `GET` |
| 路径 | `/api/favorites` |
| 请求参数 | 无 |

**响应（HTTP 200）**

```json
{
  "ok": true,
  "items": [
    { "id": "fav-1", "platform": "微博", "title": "…", "note": "想跟进", "createdAt": "2026-10-09T03:10:00.000Z" }
  ]
}
```

**错误**：`500 INTERNAL_ERROR`

### 3.3 `POST /api/sync` —— 同步当日真实热搜（第 17 天实现，手动触发）

从公开热搜来源拉取当日真实热搜，写入 `trends` 表。**本课程不做定时自动同步**，只支持手动触发。

| 项 | 值 |
| --- | --- |
| 方法 | `POST` |
| 路径 | `/api/sync` |
| 请求参数（JSON body，均可选） | `source`（如 `weibo`；不传 = 默认来源）、`date`（如 `2026-10-09`；不传 = 今天） |

**响应（HTTP 200）**

```json
{ "ok": true, "synced": 30, "source": "weibo", "date": "2026-10-09" }
```

**错误**：`502 UPSTREAM_FAILED`（公开来源抓取失败）｜`400 INVALID_PARAM`（source 不支持）｜`500 INTERNAL_ERROR`

### 3.4 `POST /api/favorites` —— 新增收藏（第 4 周实现）

| 项 | 值 |
| --- | --- |
| 方法 | `POST` |
| 路径 | `/api/favorites` |
| 请求参数（JSON body） | `platform`（必填）、`title`（必填）、`note`（可选） |

**响应（HTTP 201）**

```json
{ "ok": true, "item": { "id": "fav-2", "platform": "微博", "title": "…", "note": "", "createdAt": "2026-10-09T03:20:00.000Z" } }
```

**错误**：`400 INVALID_PARAM`（platform/title 缺失）｜`500 INTERNAL_ERROR`

### 3.5 `PATCH /api/favorites/:id` —— 修改收藏备注（第 4 周实现）

| 项 | 值 |
| --- | --- |
| 方法 | `PATCH` |
| 路径 | `/api/favorites/:id` |
| 路径参数 | `id`（必填，收藏记录 id） |
| 请求参数（JSON body） | `note`（必填，新的备注文本） |

**响应（HTTP 200）**

```json
{ "ok": true, "item": { "id": "fav-2", "platform": "微博", "title": "…", "note": "改过的备注", "createdAt": "2026-10-09T03:20:00.000Z" } }
```

**错误**：`404 NOT_FOUND`（id 不存在）｜`400 INVALID_PARAM`（note 缺失）｜`500 INTERNAL_ERROR`

### 3.6 `DELETE /api/favorites/:id` —— 取消收藏（第 4 周实现）

| 项 | 值 |
| --- | --- |
| 方法 | `DELETE` |
| 路径 | `/api/favorites/:id` |
| 路径参数 | `id`（必填，收藏记录 id） |

**响应（HTTP 200）**

```json
{ "ok": true, "deleted": true }
```

**错误**：`404 NOT_FOUND`（id 不存在）｜`500 INTERNAL_ERROR`

---

## 4. 接口总览

| 方法 | 路径 | 用途 | 状态 |
| --- | --- | --- | --- |
| GET | `/api/health` | 健康检查 | ✅ 已实现 |
| GET | `/api/hot` | 获取热搜列表 | 占位 |
| GET | `/api/favorites` | 获取收藏列表 | 占位 |
| POST | `/api/sync` | 同步当日真实热搜写入 trends 表（手动触发） | 占位（Day 17） |
| POST | `/api/favorites` | 新增收藏 | 占位（第 4 周） |
| PATCH | `/api/favorites/:id` | 修改收藏备注 | 占位（第 4 周） |
| DELETE | `/api/favorites/:id` | 取消收藏 | 占位（第 4 周） |

---

## 5. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-09 | 首版（Day 15）：落地 `/api/health`，占位 `/api/hot`；当初外壳用 `{ code, message, data }` |
| 2026-10-09 | 改版：`/api/health` 响应精简为扁平 `{ ok, service, time }` 并重新部署；响应外壳统一改为 **`ok` 式**（成功 `ok:true` + 顶层业务字段，失败 `ok:false` + `error`）；登记 `/api/hot`、`/api/favorites`、`/api/sync` 全量占位 |

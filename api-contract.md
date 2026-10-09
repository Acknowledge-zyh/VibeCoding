# api-contract.md —— 接口契约（Day 15）

> 本文件是前后端之间的「约定书」。写代码之前先把接口长什么样定死，后面谁改都会先来这里对一遍。
> 今天只落地 **1 个真实接口**（`GET /api/health`），业务接口只写约定、不实现（Day 16–20 再填）。

---

## 1. 通用约定

### 1.1 基础地址

| 用途 | 地址 |
| --- | --- |
| 接口基础地址（Base URL） | `https://acknowledge-d9gnqrpy89f1f7d21.service.tcloudbase.com` |
| 前端页面地址 | `https://acknowledge-d9gnqrpy89f1f7d21-1493626656.tcloudbaseapp.com/` |
| 环境 ID | `acknowledge-d9gnqrpy89f1f7d21`（上海 ap-shanghai，体验版） |

> ⚠️ 注意：前端页面与接口**不在同一个域名**（`…tcloudbaseapp.com` vs `…service.tcloudbase.com`），
> 属于跨域。今天的健康检查可以直接用浏览器/curl 访问；
> **跨域配置（CORS）按计划留到 Day 16–20**，前端页面里 `fetch` 调接口之前必须先解决。

### 1.2 统一响应外壳

除静态资源外，所有接口一律返回同一个外壳，便于前端写一套统一处理：

```json
{
  "code": 0,
  "message": "ok",
  "data": { }
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | number | 是 | 业务码。`0` = 成功；非 0 = 失败（取值见 1.4） |
| `message` | string | 是 | 给人看的一句话结果。成功固定 `"ok"` |
| `data` | object \| null | 是 | 成功时的数据体；失败时为 `null` |

### 1.3 通用规则

- **请求方法**：只读接口一律用 `GET`，不产生副作用。
- **时间格式**：所有时间字段用 **UTC ISO 8601**（如 `2026-10-09T03:28:09.472Z`），
  不在服务端做本地时区拼接，由前端自行按用户时区展示。
- **编码**：请求与响应均为 UTF-8；响应头 `content-type: application/json; charset=utf-8`。
- **不做分页**：当前数据量小（3 平台 × 10 条），等接真实数据源再定分页参数。

### 1.4 业务码与 HTTP 状态码

| `code` | HTTP | 含义 | 前端建议处理 |
| --- | --- | --- | --- |
| `0` | 200 | 成功 | 正常渲染 |
| `1001` | 200 | 参数不合法 | 提示用户检查输入 |
| `2001` | 200 | 上游数据源获取失败 | 显示「请求失败」状态 + 重试按钮，保留旧数据 |
| `5000` | 200 | 服务内部错误 | 同上 |

> 约定：**业务失败也返回 HTTP 200**，靠 `code` 区分。这样前端只需判断 `code`，
> 不用同时处理两套错误逻辑（网络层异常除外）。

真实错误示例（HTTP 状态码非 200 的情况，由网关产生，格式与业务错不同）：

```json
{ "code": "FUNCTIONS_PARAM_INVALID", "message": "FunctionType parameter is invalid.", "requestId": "..." }
```

---

## 2. `GET /api/health` —— 健康检查（已实现 ✅）

**用途**：探活。前端启动时可先打一次，用来判断「后端到底通不通」；运维也可以拿它做监控。
不返回任何业务数据，所以它足够快、足够可信。

### 2.1 请求

| 项 | 值 |
| --- | --- |
| 方法 | `GET` |
| 路径 | `/api/health` |
| 请求参数 | 无 |
| 请求头 | 无特殊要求 |

完整地址：`https://acknowledge-d9gnqrpy89f1f7d21.service.tcloudbase.com/api/health`

### 2.2 响应 `data` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | string | 固定 `"healthy"`，表示服务正常 |
| `service` | string | 服务标识，固定 `"hot-search-api"` |
| `version` | string | 接口版本号，当前 `"0.1.0"` |
| `env` | string | 当前 CloudBase 环境 ID，便于确认打到了哪个环境 |
| `uptime` | number | 该实例已运行秒数（可判断是否刚冷启动） |
| `time` | string | 服务端当前时间，UTC ISO 8601 |

### 2.3 成功示例

请求：

```bash
curl https://acknowledge-d9gnqrpy89f1f7d21.service.tcloudbase.com/api/health
```

响应（HTTP 200，2026-10-09 实测）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "status": "healthy",
    "service": "hot-search-api",
    "version": "0.1.0",
    "env": "acknowledge-d9gnqrpy89f1f7d21",
    "uptime": 15,
    "time": "2026-10-09T03:28:09.472Z"
  }
}
```

### 2.4 状态

| 场景 | 表现 |
| --- | --- |
| 正常 | HTTP 200 + `code: 0` |
| 云函数未部署 / 路径未映射 | 网关返回 4xx + `{"code":"FUNCTIONS_..."}`（非业务码） |

### 2.5 实现位置

| 项 | 值 |
| --- | --- |
| 代码 | `cloudfunctions/health/index.js` |
| 函数名 | `health`（事件型云函数，集成响应格式） |
| 部署 | `tcb fn deploy health -e <envId> --path /api/health` |

---

## 3. 后续接口占位（Day 16–20 填，今天不实现）

先把形状约定下来，避免后面各写各的。**以下均未实现**，返回体仅为草案。

### 3.1 `GET /api/hot` —— 获取热搜榜单

| 项 | 值 |
| --- | --- |
| 请求参数 | `platform`（可选，如 `微博`；不传 = 全部平台） |
| 响应 `data.items` | 数组，每项含 `platform` / `rank` / `title` / `heat` / `time` / `url` |
| 响应 `data.updatedAt` | 数据更新时间，UTC ISO 8601 |

字段结构沿用现有本地样本 `data/hot.json`（对齐 TECH_DESIGN.md 5.2 的 `HotResponse`），
接上真实数据源后前端只需把 `DATA_URL` 从本地文件换成该接口地址。

### 3.2 明确不做（今天）

- 不接真实业务接口、不建数据库表、不配跨域 —— 按任务清单统一推迟到 Day 16–20。

---

## 4. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-10-09 | 首版：定下响应外壳与业务码，落地 `/api/health`，占位 `/api/hot` |

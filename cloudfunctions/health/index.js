// /api/health —— 健康检查云函数（Day 15）
//
// 类型：CloudBase 事件型云函数（exports.main）。
// 通过「HTTP 访问服务」把路径 /api/health 映射到这个函数，返回「集成响应」格式
// （自己决定状态码与响应头），详见 api-contract.md 第 2 节。
//
// 约定：
//   - 永远返回 HTTP 200 + 同一套 JSON 外壳 { code, message, data }
//   - 不做任何业务逻辑、不读写数据库、不依赖外部服务（所以它足够快、也足够可信）
//   - 时间用 UTC ISO 8601，避免服务端时区影响判读

const SERVICE_NAME = "hot-search-api";
const SERVICE_VERSION = "0.1.0";

exports.main = async (event = {}, context = {}) => {
  const payload = {
    code: 0,
    message: "ok",
    data: {
      status: "healthy",
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      // CloudBase 运行时会注入环境标识，取不到时降级为 unknown（不抛错）
      env: (context && context.namespace) || process.env.TENCENTCLOUD_ENV || "unknown",
      // 运行时长（秒）：冷启动后可用来判断是不是刚扩容出来的实例
      uptime: Math.round(process.uptime()),
      time: new Date().toISOString(),
    },
  };

  // HTTP 访问服务「集成响应」格式
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
};

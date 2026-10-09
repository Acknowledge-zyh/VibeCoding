// /api/health —— 健康检查云函数（今日热搜 / hot-search-demo）
//
// 类型：CloudBase 事件型云函数（exports.main）。
// 通过「HTTP 访问服务」把路径 /api/health 映射到这个函数，返回「集成响应」格式
// （自己决定状态码与响应头），详见 api-contract.md 第 2 节。
//
// 边界（刻意保持最小）：
//   - 只实现 GET /api/health，不连数据库、不写任何业务逻辑
//   - 永远返回 HTTP 200 + 同一份 JSON：{ ok, service, time }
//   - 时间用 UTC ISO 8601，交给前端按用户时区展示
//
// 部署（实测可用）：
//   tcb fn deploy health -e <envId> --path /api/health --runtime Nodejs18.15 --force
//   ⚠️ 不要加 --httpFn：那是 Web 函数，建的访问路径会报
//     400 FUNCTIONS_PARAM_INVALID: FunctionType parameter is invalid

const SERVICE_NAME = "hot-search-demo";

exports.main = async () => {
  const payload = {
    ok: true,
    service: SERVICE_NAME,
    time: new Date().toISOString(),
  };

  // HTTP 访问服务「集成响应」格式
  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
};

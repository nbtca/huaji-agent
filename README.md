# huaji-agent

基于 Flue 的 Cloudflare Worker AI Agent，与 HuaJiBot.NET 的消息适配层独立运行。

## 功能

- 文字对话、图片识别与引用追问。
- MCP 网页搜索和结构化天气查询。
- D1 群聊归档、每日总结与手动总结。
- Agnes 优先调用，限速或额度耗尽时尝试备用 Key，再切换 Workers AI。
- 签名入口、持久会话、Queue 回复与发送去重。

`总结` 默认总结昨天；支持今／昨／前 + 天／日，中间可加空格，例如 `总结今日`、`总结 昨 天`。

## 本地开发

要求 Node.js 22.19 或更新版本。

```sh
npm ci
npm run check
npm test
npm run dev
```

复制 `.dev.vars.example` 为 `.dev.vars`，配置本地测试变量。不要提交真实凭据。

## 部署

`wrangler.jsonc` 是通用模板：填写自己的 Queue、D1 和 Workflow 配置。默认目标白名单为空，定时总结关闭。

生产环境可将模板复制为 **Git 忽略的** `wrangler.local.jsonc`。存在该文件时，构建会自动使用它；也可通过 `HUAJIBOT_WRANGLER_CONFIG` 指定配置路径。

```sh
npx wrangler secret put HUAJIBOT_BRIDGE_HMAC_SECRET
npx wrangler secret put HUAJIBOT_MCP_TOKEN
npx wrangler secret put AGNES_API_KEY
# 可选备用 Key
npx wrangler secret put AGNES_API_KEY_SECONDARY
npm run deploy
```

机器人端使用相同的 HMAC Secret，并单独配置其账户范围 Queue API Token。MCP 接口需要 Bearer 鉴权。真实账户、群组和生产地址应只保存在私有配置中。

## 验证与数据

远程验收脚本从环境变量读取 Worker URL、资源 ID 和测试目标，见 `tests/remote-config.ts`。验收应使用隔离目标，并避免与机器人消费者争抢 Queue 消息。

图片只接受受支持的 HTTPS 来源，拒绝私有地址和重定向。天气数据来自 Open-Meteo 模型估计与预报，并非气象站实测。

转发和回复使用持久状态与稳定标识；平台接受消息但尚未记录回执时发生崩溃，仍可能重复发送。回滚时保留归档与回执数据，不要修改已部署迁移的历史。

项目通过单元测试、构建及真实接口验收；生产适配器的行为仍需部署者自行验证。

## 协议与开发调试

协议、JSON Schema、跨语言样例和签名向量见 [contracts/README.md](contracts/README.md)。`npm run check` 同时检查类型和协议产物是否漂移。

`npm run test:runtime` 使用独立本地 D1、Durable Object 和模拟模型，验证签名入站、重复提交、Agent 回复工具与持久回复捕获；不访问模型服务、不向群聊发送消息。此测试不验证真实模型回答质量或 QQ 最终投递。

交互调试时，在 `.dev.vars` 中设置至少 24 字符的 `HUAJIBOT_DEBUG_TOKEN` 和独立的 `HUAJIBOT_BRIDGE_HMAC_SECRET`，运行 `npm run dev:debug`，打开 `http://127.0.0.1:5173/debug`。首次运行先执行：

```sh
npx wrangler d1 migrations apply HISTORY --local --config wrangler.development.jsonc
```

调试页提供事件提交、执行状态与工具记录、按会话查看捕获回复和清空捕获区。Token 仅存于当前页面内存，回复作为纯文本呈现。捕获区保留最多 256 条、24 小时内的记录，读取/写入时清理过期数据。

开发配置强制使用独立的 `wrangler.development.jsonc`，默认模拟模型。要测试真实模型，可在私有 `.dev.vars` 中清空 `HUAJIBOT_DEBUG_MODEL` 并配置 Agnes；如需 Workers AI 回退，应在独立开发配置中补充 AI binding。真实模型会消耗额度。

生产环境默认使用 Queue，调试入口默认关闭。`capture` 需要显式开发开关和捕获绑定，调试 API 还需要独立 Bearer Token。不要把开发配置部署到生产实例。

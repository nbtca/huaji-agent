# huaji-agent

A Flue-based Cloudflare Worker AI agent that runs independently of the HuaJiBot.NET message adapter.

## Features

- Text chat, image recognition, and quoted follow-up questions.
- MCP web search and structured weather lookup.
- D1 group-chat archive, daily summaries, and manual summary commands.
- Agnes is called first; on rate limiting or quota exhaustion it tries the secondary key, then falls back to Workers AI.
- Signed ingress, persistent conversations, Queue-based replies, and send de-duplication.

The summary command defaults to yesterday. It accepts 今／昨／前 combined with 天／日, optionally separated by spaces, for example `总结今日` or `总结 昨 天`.

## Natural-language user commands

Exact commands continue to be handled by HuaJiBot.NET. When a user mentions the bot, replies to a bot message, or otherwise starts an agent conversation, the agent can map a natural-language request to a structured `run_huajibot_command` call. The current command catalog is `help`, `schedule`, `next`, `mc`, `events`, `tickets`, and `summary`.

`summary` is executed by the Worker summary Workflow. The other commands are published as `command` jobs to the shared Cloudflare Queue and executed by the bot, where group configuration, cooldowns, and administrator checks remain authoritative. Command IDs and argument shapes are allowlisted; the agent cannot execute arbitrary functions or pass raw shell text.

## Relationship to HuaJiBot.NET

This repository contains no bot code and has no build-time dependency on HuaJiBot.NET. The split is:

- **huaji-agent (this Worker)** owns the model routing, tools, image handling, conversation state, D1 archive, and summary generation.
- **HuaJiBot.NET** owns platform adapters and delivery. Its `FlueBridge` plugin signs and posts ingress events to this Worker and consumes reply jobs from a Cloudflare Queue.

The only shared artifact is the versioned protocol in `contracts/v1`. `scripts/sync-bridge-contracts.ts` copies those files into the bot's unit-test fixtures (`src/HuaJiBot.NET.UnitTest/TestData/AgentProtocol`) and can verify them with `--check`; set `HUAJIBOT_REPO_PATH` to a HuaJiBot.NET checkout to use it. Changing wire fields, the HMAC preimage, or job IDs requires updating both sides together.

## Local development

Requires Node.js 22.19 or newer.

```sh
npm ci
npm run check
npm test
npm run dev
```

Copy `.dev.vars.example` to `.dev.vars` and fill in your local test values. Never commit real credentials.

## Deployment

`wrangler.jsonc` is a generic template: supply your own Queue, D1, and Workflow settings. The destination allowlist is empty by default and scheduled summaries are disabled.

For production, copy the template to `wrangler.local.jsonc`, which Git ignores. When that file exists the build uses it automatically; `HUAJIBOT_WRANGLER_CONFIG` can point to a different configuration path.

```sh
npx wrangler secret put HUAJIBOT_BRIDGE_HMAC_SECRET
npx wrangler secret put HUAJIBOT_MCP_TOKEN
npx wrangler secret put AGNES_API_KEY
# Optional secondary key
npx wrangler secret put AGNES_API_KEY_SECONDARY
npm run deploy
```

The bot side uses the same HMAC secret and configures its own account-scoped Queue API token. The MCP endpoint requires Bearer authentication. Real accounts, group IDs, and production URLs belong in private configuration only.

## Verification and data

Remote acceptance scripts read the Worker URL, resource IDs, and test targets from environment variables; see `tests/remote-config.ts`. Run acceptance against isolated targets and avoid competing with the bot consumer for Queue messages.

Images are accepted only from supported HTTPS origins; private addresses and redirects are rejected. Weather data comes from Open-Meteo model estimates and forecasts rather than weather-station observations.

Forwarding and replies rely on persistent state and stable identifiers. If a crash occurs after the platform accepted a message but before the receipt was recorded, a duplicate send is still possible. When rolling back, keep archive and receipt data and do not rewrite the history of migrations that have already been applied.

The project passes unit tests, builds, and real-endpoint acceptance. Behavior of the production adapter still has to be verified by whoever deploys it.

## Protocol and development debugging

The protocol, JSON Schemas, cross-language examples, and signature vectors live in [contracts/README.md](contracts/README.md). `npm run check` verifies types and also fails when generated protocol artifacts drift.

`npm run test:runtime` exercises an isolated local D1, Durable Objects, and a fixture model to cover signed ingress, duplicate submission, the agent reply tool, and persistent reply capture. It never calls a model service and never sends group messages, so it does not validate real model answer quality or final QQ delivery.

For interactive debugging, set `HUAJIBOT_DEBUG_TOKEN` (at least 24 characters) and a separate `HUAJIBOT_BRIDGE_HMAC_SECRET` in `.dev.vars`, run `npm run dev:debug`, and open `http://127.0.0.1:5173/debug`. On the first run, execute:

```sh
npx wrangler d1 migrations apply HISTORY --local --config wrangler.development.jsonc
```

The debug page can submit events, inspect execution status and tool records, read captured replies per conversation, and clear the capture store. The token stays in the memory of the current page only, and replies render as plain text. Capture keeps at most 256 records within 24 hours and expires old entries on read and write.

The development configuration always uses the separate `wrangler.development.jsonc` and defaults to the fixture model. To test real models, clear `HUAJIBOT_DEBUG_MODEL` in your private `.dev.vars` and configure Agnes; add an AI binding to the development configuration if you also want the Workers AI fallback. Real models consume quota.

Production uses Queue delivery and keeps debug ingress disabled by default. `capture` transport requires an explicit development switch plus the capture binding, and the debug API requires its own Bearer token. Do not deploy the development configuration to a production instance.
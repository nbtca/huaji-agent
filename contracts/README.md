# Bridge wire contract

`v1/` documents **this project's existing deployed v1**. It is not interchangeable with wen-templari/huaji-agent's v1. No wire fields, HMAC preimage, identity encoding or job IDs were changed by this engineering update. A jointly agreed protocol must get its own explicit version and migration plan.

`src/contracts.ts` is the canonical runtime definition. `npm run contracts:generate` emits draft-07 JSON Schemas; `npm run check` fails on drift. Examples and fixed public HMAC vectors are checked by both TypeScript and C# tests. Never use the public test secrets in deployments.

## Authentication and identifiers

- POST `/channels/huajibot/events`, JSON, maximum configured serialized UTF-8 byte size (default 32768). A declared non-JSON media type gets 415; absent Content-Type remains accepted for legacy clients.
- Headers: `X-HuaJiBot-Timestamp` (Unix seconds), `X-HuaJiBot-Signature` (`v1=` + lowercase SHA256 HMAC).
- Signed bytes: UTF-8(`v1:${timestamp}:`) followed by the **unchanged raw body**. Freshness: five minutes either direction. Authenticate before JSON parsing; compare signatures without early byte exits.
- Identifiers are opaque strings. Encode each component with RFC3986 (including `!'()*`); do not parse platform IDs as numbers. Destination allowlist, conversation scope and deterministic event identity are checked independently.
- A dispatch idempotency key is derived from bridge, bot, group and incoming message IDs. The conversation scope additionally contains the thread root.
- Reply `jobId`: SHA256 of JSON `[conversationId, toolCallId]` in the current producer, stable on retry. The consumer contract also accepts other nonempty IDs up to 200 characters for legacy compatibility. UUID format is not required.

## Data and compatibility

The ingress Schema includes text, up to four image URLs, optional Unix-millisecond `observedAt`, nullable `replyTo`, and optional `kind` (`chat`, `archive`, `summary`; defaults to `chat`). `robotId` is required and non-null. JSON Schema cannot express every routing, image-download or total-byte rule; passing Schema validation alone is insufficient admission.

The reply Schema includes trusted destination, reply anchor, Markdown content, RFC3339 creation time and optional chat/summary kind. All reply paths validate it again immediately before publishing, including after a summary adds its kind field.

Schemas reject unknown properties. Freeze deployed v1: new fields or semantics need a new version, explicit reader/writer compatibility and coordinated rollout. Do not regenerate artifacts to disguise an incompatible change.

## Delivery and error semantics

Queue publishes UTF-8 JSON as `text`. `publish()` resolves after the transport accepts the job; it does not promise platform delivery. Queue is at-least-once. Retain stable job IDs, durable publication steps and the bot's receipt ledger. A crash between platform acceptance and receipt persistence can still duplicate a message.

| Status / condition | Caller action |
|---|---|
| 400, 403, 413, 415 | Fix request/configuration; no unchanged automatic retry |
| 401 | Check clock and credentials; regenerate timestamp/signature when retrying |
| 409 | Conflicting submission; investigate identity/payload, do not retry unchanged forever |
| 503 / network failure | Retry with the same event identity and fresh signature |
| Invalid, unsupported or unauthorized outbound job | Consumer treats as poison; log metadata, acknowledge |
| Transient platform/Queue failure | Retry; preserve job identity |

For cross-repository updates set `HUAJIBOT_REPO_PATH` and run `node scripts/sync-bridge-contracts.ts` (or `--check`). The bot keeps a pinned fixture copy so its CI does not depend on an adjacent checkout. Run the focused C# `FlueBridgeTest` after synchronization.

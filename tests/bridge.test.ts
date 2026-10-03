import assert from 'node:assert/strict';
import { test } from 'node:test';
import { component, conversationPrefix } from '../src/contracts.ts';
import type { Bindings, IngressEvent, InitialData } from '../src/contracts.ts';
import { IngressError, signature, verify } from '../src/channels/verification.ts';
import { createReplyJob } from '../src/tools/reply-job.ts';

const destination = { bridgeInstance: 'main', robotId: 'bot', groupId: '-100:42' };
const env = {
  HUAJIBOT_BRIDGE_HMAC_SECRET: 'test-secret',
  HUAJIBOT_ALLOWED_DESTINATIONS: JSON.stringify([destination]),
  HUAJIBOT_MAX_MESSAGE_BYTES: '32768', HUAJIBOT_MODEL: 'test',
} as Bindings;
const event: IngressEvent = {
  version: 1, eventId: 'main:bot:-100%3A42:root', conversationId: conversationPrefix(destination) + 'root',
  kind: 'chat', destination, message: { messageId: 'root', senderId: 'user', senderName: 'Alice', text: '中文 question', images: [] }, replyTo: null,
};
const timestamp = Math.floor(Date.now() / 1000).toString();
async function signed(payload = event, ts = timestamp, secret = env.HUAJIBOT_BRIDGE_HMAC_SECRET): Promise<Request> {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  return new Request('https://agent.example/channels/huajibot/events', { method: 'POST', body,
    headers: { 'X-HuaJiBot-Timestamp': ts, 'X-HuaJiBot-Signature': await signature(secret, ts, body) } });
}
function rejected(status: number) { return (error: unknown) => error instanceof IngressError && error.status === status; }

test('signed Unicode body validates and preserves Telegram topic destination', async () => {
  assert.deepEqual(await verify(await signed(), env), event);
  assert.equal(component("topic:!'()*"), 'topic%3A%21%27%28%29%2A');
});

test('signature matches the shared .NET cross-language golden vector', async () => {
  assert.equal(await signature('test-secret', '1790942400', new TextEncoder().encode('{"text":"中文"}')),
    'v1=5e856ed96ab263401de4b3ae79b66202e00fb2c7d759596d8aa78d625a538030');
});

test('wrong key, stale timestamp, and tampered bytes are rejected', async () => {
  await assert.rejects(verify(await signed(event, timestamp, 'wrong'), env), rejected(401));
  await assert.rejects(verify(await signed(event, '1'), env), rejected(401));
  const request = await signed();
  const tampered = new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify({ ...event, message: { ...event.message, text: 'tampered' } }) });
  await assert.rejects(verify(tampered, env), rejected(401));
});

test('schema, event identity, destination, and conversation scope are validated', async () => {
  await assert.rejects(verify(await signed({ ...event, version: 2 } as unknown as IngressEvent), env), rejected(400));
  await assert.rejects(verify(await signed({ ...event, eventId: 'wrong' }), env), rejected(400));
  await assert.rejects(verify(await signed({ ...event, destination: { ...destination, groupId: 'other' } }), env), rejected(403));
  await assert.rejects(verify(await signed({ ...event, conversationId: 'huajibot:other:bot:group:root' }), env), rejected(403));
});

test('request size is bounded before JSON parsing or dispatch', async () => {
  await assert.rejects(verify(await signed(), { ...env, HUAJIBOT_MAX_MESSAGE_BYTES: '10' }), rejected(413));
});

test('same ingress retry retains a stable dispatch idempotency key', async () => {
  const one = await verify(await signed(), env);
  const two = await verify(await signed(), env);
  assert.equal(one.eventId, two.eventId);
  assert.equal(one.conversationId, two.conversationId);
});

test('reply jobs bind destination in trusted data and deduplicate tool replay', async () => {
  const ref: InitialData = { destination, conversationId: event.conversationId, rootMessageId: 'root' };
  const one = await createReplyJob(ref, 'follow-up', '**answer**', 'tool-call-1', env);
  const replay = await createReplyJob(ref, 'follow-up', '**answer**', 'tool-call-1', env);
  const next = await createReplyJob(ref, 'follow-up', 'new answer', 'tool-call-2', env);
  assert.equal(one.jobId, replay.jobId);
  assert.notEqual(one.jobId, next.jobId);
  assert.deepEqual(one.destination, { ...destination, replyToMessageId: 'follow-up' });
  assert.equal(one.content.format, 'markdown');
  await assert.rejects(createReplyJob(ref, 'root', 'answer', 'call', { ...env, HUAJIBOT_ALLOWED_DESTINATIONS: '[]' }));
  await assert.rejects(createReplyJob(ref, 'root', 'x'.repeat(32768), 'call', env));
});

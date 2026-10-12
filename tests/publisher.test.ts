import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Bindings, ReplyJob } from '../src/contracts.ts';
import { createReplyPublisher } from '../src/replies/publisher.ts';
import { CaptureStore } from '../src/replies/capture-store.ts';
import { debugAccess } from '../src/debug/auth.ts';
import { fixtureModel } from '../src/debug/fixture-model.ts';

const destination = { bridgeInstance: 'development', robotId: 'test-bot', groupId: 'test-group' };
const job: ReplyJob = { version: 1, jobId: 'stable-job', conversationId: 'huajibot:development:test-bot:test-group:root',
  destination: { ...destination, replyToMessageId: 'root' }, content: { format: 'markdown', text: '中文回复' }, createdAt: '2026-10-12T00:00:00.000Z' };
const base = { HUAJIBOT_ALLOWED_DESTINATIONS: JSON.stringify([destination]), HUAJIBOT_MAX_MESSAGE_BYTES: '32768' } as Bindings;
function debugEnv(): Bindings {
  return { ...base, HUAJIBOT_REPLY_TRANSPORT: 'capture', HUAJIBOT_DEBUG_ENABLED: 'true', HUAJIBOT_DEBUG_TOKEN: 'public-development-test-token-only',
    HUAJIBOT_REPLY_CAPTURES: { getByName: () => ({ capture: async () => {}, list: async () => [], clear: async () => 0 }) } };
}
test('queue default preserves JSON text; failure propagates without changing replay identity', async () => {
  const sent: string[] = [];
  const publisher = createReplyPublisher({ ...base, HUAJIBOT_OUTBOUND: { send: async (body: string, options: unknown) => {
    assert.deepEqual(options, { contentType: 'text' }); sent.push(body); if (sent.length === 1) throw new Error('network');
  } } as unknown as Queue<string> });
  await assert.rejects(publisher.publish(job), /network/);
  await publisher.publish(job);
  assert.deepEqual(JSON.parse(sent[0]), JSON.parse(sent[1]));
});
test('capture never touches Queue; revoked, misrouted, malformed and oversized replies fail before transport', async () => {
  const captured: ReplyJob[] = [];
  const env = debugEnv();
  env.HUAJIBOT_OUTBOUND = { send: () => assert.fail('Queue touched') } as unknown as Queue<string>;
  env.HUAJIBOT_REPLY_CAPTURES!.getByName = () => ({ capture: async j => { captured.push(j); }, list: async () => captured, clear: async () => 0 });
  const publisher = createReplyPublisher(env);
  await publisher.publish({ ...job, kind: 'summary' });
  assert.equal(captured.length, 1);
  await assert.rejects(publisher.publish({ ...job, conversationId: 'huajibot:other:bot:group:root' }));
  await assert.rejects(publisher.publish({ ...job, destination: { ...job.destination, groupId: 'other' } }));
  await assert.rejects(publisher.publish({ ...job, content: { ...job.content, text: '中'.repeat(12000) } }));
  await assert.rejects(publisher.publish({ ...job, createdAt: 'invalid' }));
  assert.equal(captured.length, 1);
  assert.throws(() => createReplyPublisher({ ...env, HUAJIBOT_DEBUG_ENABLED: 'false' }));
  assert.throws(() => createReplyPublisher({ ...base, HUAJIBOT_REPLY_TRANSPORT: 'invalid' as 'queue' }));
});
test('debug endpoints and fixture model are gated off for production and require a separate token', () => {
  const request = (token?: string) => new Request('https://test.example/debug/api/replies', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  assert.equal(debugAccess(request(), base), 404);
  const env = debugEnv();
  assert.equal(debugAccess(request(), env), 401);
  assert.equal(debugAccess(request('wrong'), env), 401);
  assert.equal(debugAccess(request(env.HUAJIBOT_DEBUG_TOKEN), env), 200);
  assert.equal(debugAccess(request(), { ...env, HUAJIBOT_DEBUG_TOKEN: 'short' }), 404);
  assert.equal(fixtureModel({ ...base, HUAJIBOT_DEBUG_MODEL: 'fixture' }, {}), undefined);
  assert.equal(fixtureModel({ ...env, HUAJIBOT_DEBUG_MODEL: 'fixture' }, { tools: [{ function: { name: 'reply_to_huajibot' } }] })?.status, 200);
});
test('capture persists stable keys, isolates conversations, expires and bounds retained records', async () => {
  const records = new Map<string, unknown>(); let now = 0;
  const store = new CaptureStore({ put: async (key, value) => { records.set(key, value); },
    list: async <T>() => new Map([...records].map(([k, value]) => [k, value as T])),
    delete: async keys => { for (const key of keys) records.delete(key); } }, () => now);
  await store.capture(job); await store.capture(job);
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.list('another-thread')).length, 0);
  for (let i = 0; i < 260; i++) await store.capture({ ...job, jobId: 'job-' + i });
  assert.equal(records.size, 256);
  now = 86400001;
  assert.deepEqual(await store.list(), []);
  assert.equal(records.size, 0);
  await store.capture(job);
  assert.equal(await store.clear(), 1);
});

import * as v from 'valibot';
import { replyJobSchema } from '../src/contracts.ts';

const url = new URL(process.env.HUAJI_DEBUG_BASE_URL ?? 'http://127.0.0.1:5173');
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Development smoke test requires a loopback endpoint');
const token = process.env.HUAJIBOT_DEBUG_TOKEN;
if (!token || token.length < 24) throw new Error('Configure a development HUAJIBOT_DEBUG_TOKEN (at least 24 characters)');
const root = 'smoke-' + crypto.randomUUID();
const destination = { bridgeInstance: 'development', robotId: 'test-bot', groupId: 'test-group' };
const conversationId = `huajibot:development:test-bot:test-group:${root}`;
const event = { version: 1, eventId: `development:test-bot:test-group:${root}`, conversationId, destination,
  kind: 'chat', message: { messageId: root, senderId: 'test-user', senderName: '开发测试', text: '请简短确认链路测试成功。', images: [], observedAt: Date.now() }, replyTo: null };
async function request(path: string, body?: unknown) {
  const response = await fetch(new URL('/debug/api/' + path, url), { method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Debug endpoint HTTP ${response.status}`);
  return await response.json();
}
await request('events', event);
// Exercise the real admission retry path with the same idempotency key.
await request('events', event);
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  const result = await request('replies?conversationId=' + encodeURIComponent(conversationId)) as { replies: unknown[] };
  const replies = result.replies.map(job => v.parse(replyJobSchema, job));
  if (replies.length) {
    if (replies.length !== 1 || replies[0].destination.replyToMessageId !== root) throw new Error('Reply identity or duplicate admission mismatch');
    console.log('Signed admission, retry and captured reply passed. No group message was sent.');
    process.exit(0);
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
throw new Error('No captured reply within 120 seconds');

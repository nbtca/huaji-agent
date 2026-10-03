// Synthetic Worker/Queue check only. It never sends a message through a chat adapter.
import assert from 'node:assert/strict';
import { component, conversationPrefix } from '../src/contracts.ts';
import type { ReplyJob } from '../src/contracts.ts';
import { signature } from '../src/channels/verification.ts';
import {destination as testDestination,workerBase,queueBase as testQueueBase} from './remote-config.ts';

const secret = process.env.HUAJIBOT_BRIDGE_HMAC_SECRET;
const token = process.env.HUAJIBOT_QUEUE_API_TOKEN;
assert.ok(secret && token, 'Set bridge secrets in the test process environment');
const destination = testDestination();
const messageId = 'deployment-smoke-' + crypto.randomUUID();
const conversationId = conversationPrefix(destination) + component(messageId);
async function admit(id: string, text: string, replyTo: { messageId: string; senderId: string; content: string } | null) {
  const eventId = [destination.bridgeInstance, destination.robotId, destination.groupId, id].map(component).join(':');
  const body = new TextEncoder().encode(JSON.stringify({ version: 1, eventId, conversationId, destination,
    message: { messageId: id, senderId: 'deployment-check', senderName: 'Deployment check', text }, replyTo }));
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const admitted = await fetch(workerBase()+'/channels/huajibot/events', {
    method: 'POST', body, headers: { 'X-HuaJiBot-Timestamp': timestamp,
      'X-HuaJiBot-Signature': await signature(secret!, timestamp, body) },
  });
  console.log('Worker admission HTTP ' + admitted.status);
  assert.equal(admitted.status, 202, 'Worker admission failed');
}
const queueBase = testQueueBase();
async function call(action: string, payload: unknown) {
  const response = await fetch(queueBase + action, { method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(response.status, 200, 'Queue API failed');
  const result = await response.json() as { success: boolean; result: { messages?: { body: string; lease_id: string }[] } };
  assert.ok(result.success);
  return result.result;
}
async function receive(id: string): Promise<ReplyJob> {
for (let attempt = 0; attempt < 40; attempt++) {
  const result = await call('pull', { batch_size: 1, visibility_timeout: 120000 });
  for (const lease of result.messages ?? []) {
    let job: ReplyJob;
    try { job = JSON.parse(lease.body) as ReplyJob; }
    catch { await call('ack', { acks: [], retries: [{ lease_id: lease.lease_id, delay_seconds: 10 }] }); continue; }
    if (job.conversationId !== conversationId || job.destination.replyToMessageId !== id) {
      // Preserve unrelated work; never acknowledge someone else's job.
      await call('ack', { acks: [], retries: [{ lease_id: lease.lease_id, delay_seconds: 10 }] });
      continue;
    }
    assert.deepEqual(job.destination, { ...destination, replyToMessageId: id });
    assert.equal(job.version, 1);
    assert.ok(job.content.text.trim());
    await call('ack', { acks: [{ lease_id: lease.lease_id }], retries: [] });
    console.log('Synthetic model reply received with valid destination; test job acknowledged. No chat message sent.');
    return job;
  }
  await new Promise(resolve => setTimeout(resolve, 2000));
}
throw new Error('No synthetic Queue reply received within 80 seconds');
}

await admit(messageId, '这是部署自检，不是真实群聊。请记住暗号“青松”，使用回复工具答复收到。', null);
const first = await receive(messageId);
const followup = messageId + '-followup';
await admit(followup, '前一条消息的暗号是什么？请仅用回复工具回答暗号。',
  { messageId, senderId: 'deployment-check', content: first.content.text });
const second = await receive(followup);
assert.ok(second.content.text.includes('青松'), 'Follow-up failed to recall initial context');
console.log('Two-turn Worker/model/Queue recall passed. No chat message sent.');

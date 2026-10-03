import assert from 'node:assert/strict';
import { signature } from '../src/channels/verification.ts';
import { conversationPrefix } from '../src/contracts.ts';

// Run against `wrangler dev --local --port 8794 --var HUAJIBOT_BRIDGE_HMAC_SECRET:test-secret`.
// Default empty allowlist prevents dispatch/model execution during this smoke check.
const base = process.env.HUAJIBOT_TEST_URL ?? 'http://127.0.0.1:8794';
const secret = process.env.HUAJIBOT_BRIDGE_HMAC_SECRET ?? 'test-secret';
assert.equal((await fetch(base + '/health')).status, 200);
const unsigned = await fetch(base + '/channels/huajibot/events', { method: 'POST', body: '{}' });
assert.equal(unsigned.status, 401);
const destination = { bridgeInstance: 'main', robotId: 'bot', groupId: '-100:42' };
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = new TextEncoder().encode(JSON.stringify({
  version: 1, eventId: 'main:bot:-100%3A42:root', conversationId: conversationPrefix(destination) + 'root',
  destination, message: { messageId: 'root', senderId: 'user', senderName: 'test', text: 'synthetic smoke test' }, replyTo: null,
}));
const denied = await fetch(base + '/channels/huajibot/events', { method: 'POST', body, headers: {
  'X-HuaJiBot-Timestamp': timestamp, 'X-HuaJiBot-Signature': await signature(secret, timestamp, body),
} });
assert.equal(denied.status, 403);
assert.equal((await fetch(base + '/agents/huaji/anything')).status, 404);
console.log('Worker: health=200, unsigned=401, unauthorized=403, public agent route=404');

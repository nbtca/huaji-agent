import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quotaExhausted, routeModel } from '../src/model-router.ts';

const config = { AGNES_PRIMARY_ENABLED: 'true', AGNES_API_KEY: 'fixture-secret' };
const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const inputs = { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  tools: [{ type: 'function', function: { name: 'reply_to_huajibot' } }], stream: true, max_completion_tokens: 1024 };

test('Agnes succeeds without spending Cloudflare quota; streaming/tool history pass through', async () => {
  const expected = structuredClone(inputs);
  const stream = new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  let calls = 0;
  const result = await routeModel(config, model, inputs, undefined, async () => {
    assert.fail('Cloudflare must not be called');
  }, (async (url, init) => {
    calls++;
    assert.equal(url, 'https://apihub.agnes-ai.com/v1/chat/completions');
    assert.equal(init?.redirect, 'manual');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer fixture-secret');
    assert.equal((init?.headers as Record<string, string>)['User-Agent'], 'HuaJiBot-Agent/1.0');
    const body = JSON.parse(init?.body as string);
    assert.equal(body.model, 'agnes-3.0-flash');
    assert.equal(body.max_tokens, 1024);
    assert.ok(!('max_completion_tokens' in body));
    assert.deepEqual(body.messages, inputs.messages);
    assert.deepEqual(body.tools, inputs.tools);
    return stream;
  }) as typeof fetch);
  assert.equal(result, stream);
  assert.equal(calls, 1);
  assert.deepEqual(inputs, expected);
});

test('explicit exhausted quota uses Cloudflare once with normalized history and no Agnes key', async () => {
  let backupCalls = 0;
  const events: string[] = [];
  const reply = new Response('backup');
  const result = await routeModel(config, model, inputs, { signal: new AbortController().signal }, async (m, body, options) => {
    backupCalls++;
    assert.equal(m, model);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hello' }]);
    assert.ok(options?.signal);
    assert.ok(!JSON.stringify(body).includes('fixture-secret'));
    return reply;
  }, (async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 })) as typeof fetch,
  backend => events.push(backend));
  assert.equal(result, reply);
  assert.equal(backupCalls, 1);
  assert.deepEqual(events, ['cloudflare-limit-fallback']);
});

test('auth, server errors, redirects and unknown non-429 errors do not spend backup quota', async () => {
  for (const [status, body] of [[401, '{"error":{"code":"insufficient_quota"}}'], [500, '{"error":{"code":"quota_exceeded"}}'],
    [403, '{"error":"Forbidden"}'], [302, 'redirect'], [402, 'not-json']] as const) {
    const result = await routeModel(config, model, inputs, undefined, async () => assert.fail('Unexpected backup'),
      (async () => new Response(body, { status })) as typeof fetch);
    assert.ok(result instanceof Response);
    assert.equal(result.status, status);
    assert.equal(await result.text(), body);
  }
});

test('primary rate limit uses secondary Agnes and leaves Cloudflare untouched', async () => {
  const used: string[] = []; const events: string[] = [];
  const result = await routeModel({ ...config, AGNES_API_KEY_SECONDARY: 'secondary-secret' }, model, inputs, undefined,
    async () => assert.fail('Unexpected Cloudflare request'), (async (_, init) => {
      used.push((init?.headers as Record<string, string>).Authorization);
      return used.length === 1 ? new Response('error code: 1015', { status: 429 }) : new Response('secondary reply');
    }) as typeof fetch, backend => events.push(backend));
  assert.deepEqual(used, ['Bearer fixture-secret', 'Bearer secondary-secret']);
  assert.deepEqual(events, ['agnes-secondary']);
  assert.equal(await (result as Response).text(), 'secondary reply');
});

test('both limited keys reach Cloudflare once; explicit quotas also try secondary first', async () => {
  for (const status of [429, 402]) {
    let requests = 0, backupCalls = 0;
    await routeModel({ ...config, AGNES_API_KEY_SECONDARY: 'secondary-secret' }, model, inputs, undefined,
      async (_, body) => { backupCalls++; assert.ok(!JSON.stringify(body).includes('secret')); return new Response('backup'); },
      (async () => { requests++; return new Response(status === 429 ? 'error code: 1015' :
        JSON.stringify({ error: { code: 'insufficient_quota' } }), { status }); }) as typeof fetch);
    assert.equal(requests, 2); assert.equal(backupCalls, 1);
  }
});

test('duplicate keys do not retry; limited response without a secondary still reaches Cloudflare', async () => {
  for (const secondary of [undefined, 'fixture-secret']) {
    let requests = 0, backups = 0;
    await routeModel({ ...config, AGNES_API_KEY_SECONDARY: secondary }, model, inputs, undefined,
      async () => { backups++; return new Response('backup'); },
      (async () => { requests++; return new Response('x'.repeat(9000), { status: 429 }); }) as typeof fetch);
    assert.equal(requests, 1); assert.equal(backups, 1);
  }
});

test('secondary auth failure remains an error and does not silently spend Cloudflare quota', async () => {
  let requests = 0;
  const response = await routeModel({ ...config, AGNES_API_KEY_SECONDARY: 'secondary-secret' }, model, inputs, undefined,
    async () => assert.fail('Unexpected Cloudflare request'),
    (async () => new Response('failure', { status: ++requests === 1 ? 429 : 401 })) as typeof fetch);
  assert.equal(requests, 2); assert.equal((response as Response).status, 401);
});

test('network failure and missing key remain errors; disabled primary keeps Cloudflare working', async () => {
  await assert.rejects(routeModel(config, model, inputs, undefined, async () => assert.fail('Unexpected backup'),
    (async () => { throw new Error('network unavailable'); }) as typeof fetch), /network unavailable/);
  await assert.rejects(routeModel({ AGNES_PRIMARY_ENABLED: 'true' }, model, inputs, undefined,
    async () => assert.fail('Unexpected backup')), /API key/);
  const reply = new Response('backup');
  assert.equal(await routeModel({}, model, inputs, undefined, async () => reply,
    (async () => assert.fail('Unexpected primary request')) as typeof fetch), reply);
});

test('quota classifier distinguishes allowance exhaustion from RPM and context length', () => {
  assert.equal(quotaExhausted(402, { error: { message: '余额不足，请充值' } }), true);
  assert.equal(quotaExhausted(429, { error: { message: 'Daily request limit has been reached' } }), true);
  assert.equal(quotaExhausted(429, { error: { message: 'Maximum context length exceeded' } }), false);
  assert.equal(quotaExhausted(429, { error: { message: 'Rate limit reached for requests per minute' } }), false);
});

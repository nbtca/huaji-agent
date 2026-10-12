import { Hono } from 'hono';
import type { Bindings } from '../contracts.ts';
import { maxBytes } from '../contracts.ts';
import { debugAccess } from './auth.ts';
import { captureEnabled } from '../replies/publisher.ts';
import { boundedBody, IngressError, signature, validateEvent } from '../channels/verification.ts';
import { channel } from '../channels/huajibot.ts';
import { debugHtml, debugJs, debugCss } from './ui.ts';

export const debug = new Hono<{ Bindings: Bindings }>();
debug.get('/', c => {
  if (!captureEnabled(c.env) || !c.env.HUAJIBOT_DEBUG_TOKEN || c.env.HUAJIBOT_DEBUG_TOKEN.length < 24) return c.notFound();
  c.header('Cache-Control', 'no-store');
  c.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  return c.html(debugHtml);
});
debug.get('/ui.js', async c => {
  if (!captureEnabled(c.env)) return c.notFound();
  c.header('Content-Type', 'text/javascript');
  return c.body(debugJs);
});
debug.get('/ui.css', async c => {
  if (!captureEnabled(c.env)) return c.notFound();
  c.header('Content-Type', 'text/css');
  return c.body(debugCss);
});
debug.use('/api/*', async (c, next) => {
  const status = debugAccess(c.req.raw, c.env);
  c.header('Cache-Control', 'no-store');
  if (status !== 200) return c.json({ error: status === 404 ? 'Not found' : 'Unauthorized' }, status);
  await next();
});
debug.get('/api/replies', async c => c.json({ replies: await c.env.HUAJIBOT_REPLY_CAPTURES!.getByName('development').list(c.req.query('conversationId')) }));
debug.get('/api/config', c => c.json({ transport: 'capture', model: c.env.HUAJIBOT_DEBUG_MODEL === 'fixture' ? 'fixture (模拟模型，不验证回答质量)' : 'configured provider' }));
debug.delete('/api/replies', async c => c.json({ cleared: await c.env.HUAJIBOT_REPLY_CAPTURES!.getByName('development').clear() }));
for (const path of ['events', 'status'] as const) {
  debug.post('/api/' + path, async c => {
    try {
      const bytes = await boundedBody(c.req.raw, maxBytes(c.env));
      validateEvent(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), c.env);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const request = new Request(new URL('/' + path, c.req.url), {
        method: 'POST', body: Uint8Array.from(bytes).buffer,
        headers: { 'Content-Type': 'application/json', 'X-HuaJiBot-Timestamp': timestamp,
          'X-HuaJiBot-Signature': await signature(c.env.HUAJIBOT_BRIDGE_HMAC_SECRET, timestamp, bytes) },
      });
      return await channel.fetch(request, c.env);
    } catch (error) {
      return c.json({ error: 'Debug request rejected' }, error instanceof IngressError ? error.status : 400);
    }
  });
}

import { Hono } from 'hono';
import type { Bindings } from './contracts.ts';
import { channel } from './channels/huajibot.ts';
import { setProvider } from '@flue/runtime';
import { getCloudflareContext } from '@flue/runtime/cloudflare';
import { cloudflareBindingProvider } from '@flue/runtime/cloudflare/workers-ai';
import { routeModel } from './model-router.ts';
import { mcp } from './mcp.ts';

setProvider(cloudflareBindingProvider({ binding: {
  async run(model, inputs, options) {
    const env = getCloudflareContext().env;
    const ai = env.AI as unknown as import('@flue/runtime/cloudflare/workers-ai').CloudflareAIBinding;
    return routeModel(env, model, inputs, options, (m, body, opts) => ai.run(m, body, opts), fetch,
      backend => console.info('HuaJiBot model backend: ' + backend));
  },
} }));

const app = new Hono<{ Bindings: Bindings }>();
app.route('/channels/huajibot', channel);
app.route('/mcp', mcp);
app.get('/health', c => c.json({ ok: true }));
export default app;

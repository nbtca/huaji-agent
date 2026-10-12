import { createServer } from 'vite';
// Always select the public development template; never inherit the private production configuration.
process.env.HUAJIBOT_WRANGLER_CONFIG = 'wrangler.development.jsonc';
const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await server.listen();
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, async () => { await server.close(); process.exit(0); });

import { cloudflare } from '@cloudflare/vite-plugin';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';

const configPath = process.env.HUAJIBOT_WRANGLER_CONFIG ?? (existsSync('wrangler.local.jsonc') ? 'wrangler.local.jsonc' : 'wrangler.jsonc');
export default defineConfig({ plugins: [flue(), cloudflare({ configPath, config: flueWorkerConfig() })] });

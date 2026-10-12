import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { signature } from '../src/channels/verification.ts';

const vars = new URL('../.dev.vars', import.meta.url);
const previous = await readFile(vars).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
const token = 'fixture-only-' + crypto.randomUUID();
let server: Awaited<ReturnType<typeof createServer>> | undefined;
try {
  const migration = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'HISTORY', '--local', '--config', 'wrangler.development.jsonc'], { stdio: 'inherit' });
  assert.equal(await new Promise((resolve, reject) => { migration.on('error', reject); migration.on('exit', resolve); }), 0);
  await writeFile(vars, `HUAJIBOT_DEBUG_TOKEN=${token}\nHUAJIBOT_BRIDGE_HMAC_SECRET=public-runtime-fixture-secret\n`);
  process.env.HUAJIBOT_WRANGLER_CONFIG = 'wrangler.development.jsonc';
  server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
  await server.listen();
  const url = 'http://127.0.0.1:5173';
  const page = await fetch(url + '/debug');
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('HuaJi Agent'));
  assert.equal((await fetch(url + '/debug/api/replies')).status, 401);
  assert.equal((await fetch(url + '/debug/api/replies', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const example = JSON.parse(await readFile(new URL('../contracts/v1/examples/ingress.json', import.meta.url), 'utf8'));
  async function ingress(payload: unknown, mediaType = 'application/json', secret = 'public-runtime-fixture-secret') {
    const body = JSON.stringify(payload), timestamp = String(Math.floor(Date.now() / 1000));
    return fetch(url + '/channels/huajibot/events', { method: 'POST', body, headers: {
      'Content-Type': mediaType, 'X-HuaJiBot-Timestamp': timestamp,
      'X-HuaJiBot-Signature': await signature(secret, timestamp, new TextEncoder().encode(body)),
    } });
  }
  assert.equal((await ingress(example, 'application/json', 'wrong-secret')).status, 401);
  assert.equal((await ingress({ ...example, version: 2 })).status, 400);
  assert.equal((await ingress({ ...example, destination: { ...example.destination, groupId: 'other' } })).status, 403);
  assert.equal((await ingress(example, 'text/plain')).status, 415);
  assert.equal((await ingress({ ...example, message: { ...example.message, text: '中'.repeat(12000) } })).status, 413);
  const child = spawn(process.execPath, ['scripts/smoke-development.ts'], { stdio: 'inherit', env: { ...process.env, HUAJIBOT_DEBUG_TOKEN: token } });
  const timer = setTimeout(() => child.kill(), 150000);
  const code = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
  clearTimeout(timer);
  assert.equal(code, 0, 'Runtime smoke failed');
  const headers = { Authorization: 'Bearer ' + token };
  const before = await (await fetch(url + '/debug/api/replies', { headers })).json() as { replies: { jobId: string }[] };
  assert.ok(before.replies.length);
  const latestId = before.replies.at(-1)!.jobId;
  await server.close();
  server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
  await server.listen();
  const after = await (await fetch(url + '/debug/api/replies', { headers })).json() as { replies: { jobId: string }[] };
  assert.ok(after.replies.some(job => job.jobId === latestId), 'Capture did not survive a Worker restart');
  console.log('Development runtime / auth / signed admission / durable Agent / capture passed (fixture model).');
} finally {
  await server?.close();
  if (previous) await writeFile(vars, previous); else await unlink(vars).catch(() => {});
}

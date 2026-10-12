import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const repo = process.env.HUAJIBOT_REPO_PATH;
if (!repo) throw new Error('Set HUAJIBOT_REPO_PATH to the HuaJiBot.NET checkout');
const source = resolve('contracts/v1');
const target = join(resolve(repo), 'src/HuaJiBot.NET.UnitTest/TestData/AgentProtocol');
async function visit(path = ''): Promise<void> {
  for (const entry of await readdir(join(source, path), { withFileTypes: true })) {
    const name = join(path, entry.name);
    if (entry.isDirectory()) await visit(name);
    else {
      const contents = await readFile(join(source, name), 'utf8');
      if (process.argv.includes('--check')) {
        if (contents !== await readFile(join(target, name), 'utf8')) throw new Error(`Bridge contract drift: ${name}`);
      } else { await mkdir(resolve(target, path), { recursive: true }); await writeFile(join(target, name), contents); }
    }
  }
}
await visit();

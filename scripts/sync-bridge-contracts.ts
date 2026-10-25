import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const repo = process.env.HUAJIBOT_REPO_PATH;
if (!repo) throw new Error('Set HUAJIBOT_REPO_PATH to the HuaJiBot.NET checkout');
const targetRoot = join(resolve(repo), 'src/HuaJiBot.NET.UnitTest/TestData/AgentProtocol');

async function visit(sourceRoot: string, targetRoot: string, path = ''): Promise<void> {
  for (const entry of await readdir(join(sourceRoot, path), { withFileTypes: true })) {
    const name = join(path, entry.name);
    if (entry.isDirectory()) await visit(sourceRoot, targetRoot, name);
    else {
      const contents = await readFile(join(sourceRoot, name), 'utf8');
      if (process.argv.includes('--check')) {
        if (contents !== await readFile(join(targetRoot, name), 'utf8')) throw new Error(`Bridge contract drift: ${name}`);
      } else {
        await mkdir(join(targetRoot, path), { recursive: true });
        await writeFile(join(targetRoot, name), contents);
      }
    }
  }
}

await visit(resolve('contracts/v1'), targetRoot);
await visit(resolve('contracts/v2'), join(targetRoot, 'v2'));
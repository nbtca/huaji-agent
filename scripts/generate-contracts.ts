import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { contractArtifacts } from './contract-artifacts.ts';

const directory = new URL('../contracts/v1/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, content] of Object.entries(contractArtifacts())) {
  const target = new URL(name, directory);
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== content) throw new Error(`${name} drifted; run npm run contracts:generate`);
  } else await writeFile(target, content);
}

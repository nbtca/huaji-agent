import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { commandContractArtifacts, contractArtifacts } from './contract-artifacts.ts';

for (const [version, artifacts] of [['v1', contractArtifacts()], ['v2', commandContractArtifacts()]] as const) {
  const directory = new URL(`../contracts/${version}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  for (const [name, content] of Object.entries(artifacts)) {
    const target = new URL(name, directory);
    if (process.argv.includes('--check')) {
      if (await readFile(target, 'utf8') !== content) throw new Error(`${version}/${name} drifted; run npm run contracts:generate`);
    } else await writeFile(target, content);
  }
}

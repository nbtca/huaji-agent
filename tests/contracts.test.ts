import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import * as v from 'valibot';
import { commandJobSchema, ingressSchema, replyJobSchema, component } from '../src/contracts.ts';
import { signature } from '../src/channels/verification.ts';
import { commandContractArtifacts, contractArtifacts } from '../scripts/contract-artifacts.ts';

function assertSchemaArtifacts(root: URL, artifacts: Record<string, string>, schemas: Record<string, any>, invalidVersion: number) {
  const ajv = new Ajv({ strict: true }); addFormats(ajv);
  return Promise.all(Object.entries(artifacts).map(async ([name, generated]) => {
    assert.equal(await readFile(new URL(name, root), 'utf8'), generated);
    const validate = ajv.compile(JSON.parse(generated));
    const example = JSON.parse(await readFile(new URL('examples/' + name.replace('.schema', ''), root), 'utf8'));
    const schema = schemas[name];
    assert.ok(v.safeParse(schema, example).success);
    const invalidExamples = [{ ...example, version: invalidVersion }, { ...example, unexpected: true }, { ...example, destination: { ...example.destination, robotId: null } }];
    assert.ok(validate(example), JSON.stringify(validate.errors));
    for (const bad of invalidExamples) {
      assert.equal(v.safeParse(schema, bad).success, false);
      assert.equal(validate(bad), false);
    }
  }));
}

test('committed JSON Schemas match runtime definitions; examples agree in both validators', async () => {
  await assertSchemaArtifacts(
    new URL('../contracts/v1/', import.meta.url),
    contractArtifacts(),
    { 'ingress.schema.json': ingressSchema, 'reply-job.schema.json': replyJobSchema },
    2,
  );
  await assertSchemaArtifacts(
    new URL('../contracts/v2/', import.meta.url),
    commandContractArtifacts(),
    { 'command-job.schema.json': commandJobSchema },
    1,
  );
});
test('shared C# / TypeScript HMAC and identifier vectors use raw Unicode bytes', async () => {
  const vectors = JSON.parse(await readFile(new URL('../contracts/v1/test-vectors.json', import.meta.url), 'utf8'));
  for (const vector of vectors.hmac) assert.equal(await signature(vector.secret, vector.timestamp, new TextEncoder().encode(vector.body)), vector.signature);
  for (const vector of vectors.identifiers) assert.equal(component(vector.raw), vector.encoded);
});

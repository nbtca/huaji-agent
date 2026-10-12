import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Ajv } from 'ajv';
import addFormats from 'ajv-formats';
import * as v from 'valibot';
import { ingressSchema, replyJobSchema, component } from '../src/contracts.ts';
import { signature } from '../src/channels/verification.ts';
import { contractArtifacts } from '../scripts/contract-artifacts.ts';

const root = new URL('../contracts/v1/', import.meta.url);
test('committed JSON Schemas match runtime definitions; examples agree in both validators', async () => {
  const ajv = new Ajv({ strict: true }); addFormats(ajv);
  for (const [name, generated] of Object.entries(contractArtifacts())) {
    assert.equal(await readFile(new URL(name, root), 'utf8'), generated);
    const validate = ajv.compile(JSON.parse(generated));
    const example = JSON.parse(await readFile(new URL('examples/' + name.replace('.schema', ''), root), 'utf8'));
    const schema = name.startsWith('ingress') ? ingressSchema : replyJobSchema;
    assert.ok(v.safeParse(schema, example).success);
    const invalidExamples = [{ ...example, version: 2 }, { ...example, unexpected: true }, { ...example, destination: { ...example.destination, robotId: null } }];
    assert.ok(validate(example), JSON.stringify(validate.errors));
    for (const bad of invalidExamples) {
      assert.equal(v.safeParse(schema, bad).success, false);
      assert.equal(validate(bad), false);
    }
  }
});
test('shared C# / TypeScript HMAC and identifier vectors use raw Unicode bytes', async () => {
  const vectors = JSON.parse(await readFile(new URL('test-vectors.json', root), 'utf8'));
  for (const vector of vectors.hmac) assert.equal(await signature(vector.secret, vector.timestamp, new TextEncoder().encode(vector.body)), vector.signature);
  for (const vector of vectors.identifiers) assert.equal(component(vector.raw), vector.encoded);
});

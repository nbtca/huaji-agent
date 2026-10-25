import { toJsonSchema } from '@valibot/to-json-schema';
import { commandJobSchema, ingressSchema, replyJobSchema } from '../src/contracts.ts';

export function contractArtifacts(): Record<string, string> {
  return Object.fromEntries(Object.entries({ ingress: ingressSchema, 'reply-job': replyJobSchema }).map(([name, schema]) => [
    `${name}.schema.json`, JSON.stringify({ ...toJsonSchema(schema), title: `HuaJiBot local v1 ${name}` }, null, 2) + '\n',
  ]));
}

export function commandContractArtifacts(): Record<string, string> {
  return Object.fromEntries(Object.entries({ 'command-job': commandJobSchema }).map(([name, schema]) => [
    `${name}.schema.json`, JSON.stringify({ ...toJsonSchema(schema), title: `HuaJiBot local v2 ${name}` }, null, 2) + '\n',
  ]));
}

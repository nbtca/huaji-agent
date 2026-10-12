import { toJsonSchema } from '@valibot/to-json-schema';
import { ingressSchema, replyJobSchema } from '../src/contracts.ts';

export function contractArtifacts(): Record<string, string> {
  return Object.fromEntries(Object.entries({ ingress: ingressSchema, 'reply-job': replyJobSchema }).map(([name, schema]) => [
    `${name}.schema.json`, JSON.stringify({ ...toJsonSchema(schema), title: `HuaJiBot local v1 ${name}` }, null, 2) + '\n',
  ]));
}

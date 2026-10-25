import * as v from 'valibot';
import { allowed, commandJobSchema, conversationPrefix, maxBytes } from '../contracts.ts';
import type { Bindings, CommandJob } from '../contracts.ts';

export interface CommandPublisher {
  publish(job: CommandJob): Promise<void>;
}

export function createCommandPublisher(env: Bindings): CommandPublisher {
  const transport = env.HUAJIBOT_REPLY_TRANSPORT ?? 'queue';
  if (transport !== 'queue') {
    throw new Error('Command execution requires queue reply transport');
  }
  return {
    async publish(value) {
      const job = v.parse(commandJobSchema, value);
      if (!allowed(job.destination, env.HUAJIBOT_ALLOWED_DESTINATIONS)) throw new Error('Destination revoked');
      const prefix = conversationPrefix(job.destination);
      if (!job.conversationId.startsWith(prefix) || job.conversationId.length <= prefix.length) {
        throw new Error('Command scope mismatch');
      }
      const body = JSON.stringify(job);
      if (new TextEncoder().encode(body).length > maxBytes(env)) throw new Error('Command exceeds size limit');
      await env.HUAJIBOT_OUTBOUND.send(body, { contentType: 'text' });
    },
  };
}
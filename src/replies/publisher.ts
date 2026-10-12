import * as v from 'valibot';
import { allowed, conversationPrefix, maxBytes, replyJobSchema } from '../contracts.ts';
import type { Bindings, ReplyJob } from '../contracts.ts';

export interface ReplyPublisher { publish(job: ReplyJob): Promise<void> }

export function captureEnabled(env: Bindings): boolean {
  return env.HUAJIBOT_DEBUG_ENABLED === 'true' && env.HUAJIBOT_REPLY_TRANSPORT === 'capture' && !!env.HUAJIBOT_REPLY_CAPTURES;
}

export function createReplyPublisher(env: Bindings): ReplyPublisher {
  const transport = env.HUAJIBOT_REPLY_TRANSPORT ?? 'queue';
  if (transport !== 'queue' && transport !== 'capture') throw new Error('Invalid reply transport');
  if (transport === 'capture' && !captureEnabled(env)) throw new Error('Capture requires an isolated debug environment');
  return {
    async publish(value) {
      const job = v.parse(replyJobSchema, value);
      if (!allowed(job.destination, env.HUAJIBOT_ALLOWED_DESTINATIONS)) throw new Error('Destination revoked');
      const prefix = conversationPrefix(job.destination);
      if (!job.conversationId.startsWith(prefix) || job.conversationId.length <= prefix.length) throw new Error('Reply scope mismatch');
      const body = JSON.stringify(job);
      if (new TextEncoder().encode(body).length > maxBytes(env)) throw new Error('Reply exceeds size limit');
      if (transport === 'capture') await env.HUAJIBOT_REPLY_CAPTURES!.getByName('development').capture(job);
      else await env.HUAJIBOT_OUTBOUND.send(body, { contentType: 'text' });
    },
  };
}

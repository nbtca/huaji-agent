import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import type { Bindings, InitialData } from '../contracts.ts';
import { createReplyJob } from './reply-job.ts';

export function replyToHuajiBot(ref: InitialData, messageId: string, env: Bindings) {
  return defineTool({
    name: 'reply_to_huajibot', description: 'Send your final Markdown reply to this conversation. Call once when answering.',
    input: v.strictObject({ text: v.pipe(v.string(), v.minLength(1)) }),
    durable: true,
    async run({ data, toolCallId, step }) {
      return step.do('publish-reply', async () => {
        const job = await createReplyJob(ref, messageId, data.text, toolCallId, env);
        await env.HUAJIBOT_OUTBOUND.send(JSON.stringify(job), { contentType: 'text' });
        return { output: { jobId: job.jobId, queued: true }, terminate: true };
      });
    },
  });
}

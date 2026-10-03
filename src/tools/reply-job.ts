import { allowed, maxBytes } from '../contracts.ts';
import type { Bindings, InitialData, ReplyJob } from '../contracts.ts';

export async function createReplyJob(ref: InitialData, messageId: string, text: string, toolCallId: string, env: Bindings): Promise<ReplyJob> {
  if (!allowed(ref.destination, env.HUAJIBOT_ALLOWED_DESTINATIONS)) throw new Error('Destination revoked');
  if (!text.trim() || !messageId) throw new Error('Empty reply');
  // Stable across a replay of the same tool call; Queue itself still provides at-least-once delivery.
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([ref.conversationId, toolCallId])));
  const jobId = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  const job: ReplyJob = { version: 1, jobId, conversationId: ref.conversationId,
    destination: { ...ref.destination, replyToMessageId: messageId }, content: { format: 'markdown', text }, createdAt: new Date().toISOString() };
  if (new TextEncoder().encode(JSON.stringify(job)).length > maxBytes(env)) throw new Error('Reply exceeds size limit');
  return job;
}

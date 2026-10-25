import { allowed, commandArgumentsSchema, commandIdSchema, maxBytes } from '../contracts.ts';
import type { Bindings, CommandJob, InitialData } from '../contracts.ts';
import * as v from 'valibot';

type CommandId = v.InferOutput<typeof commandIdSchema>;
type CommandArguments = v.InferOutput<typeof commandArgumentsSchema>;

export async function createCommandJob(
  ref: InitialData,
  messageId: string,
  commandId: CommandId,
  argumentsValue: CommandArguments | undefined,
  senderId: string,
  senderName: string,
  toolCallId: string,
  env: Bindings,
): Promise<CommandJob> {
  if (!allowed(ref.destination, env.HUAJIBOT_ALLOWED_DESTINATIONS)) throw new Error('Destination revoked');
  if (!messageId) throw new Error('Missing command message id');
  if (!senderId) throw new Error('Missing command sender id');

  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([ref.conversationId, toolCallId, commandId])),
  );
  const jobId = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  const job: CommandJob = {
    version: 2,
    jobId,
    conversationId: ref.conversationId,
    destination: { ...ref.destination, replyToMessageId: messageId },
    kind: 'command',
    senderId,
    senderName,
    command: { id: commandId, arguments: argumentsValue ?? {} },
    createdAt: new Date().toISOString(),
  };
  if (new TextEncoder().encode(JSON.stringify(job)).length > maxBytes(env)) {
    throw new Error('Command exceeds size limit');
  }
  return job;
}
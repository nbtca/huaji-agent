import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { commandArgumentsSchema, commandIdSchema, commandIds } from '../contracts.ts';
import type { Bindings, InitialData } from '../contracts.ts';
import { createCommandJob } from './command-job.ts';
import { createCommandPublisher } from '../replies/command-publisher.ts';
import { createReplyJob } from './reply-job.ts';
import { createReplyPublisher } from '../replies/publisher.ts';
import { manualSummaryAllowed, startSummary } from '../summary.ts';
import { chinaDay } from '../history.ts';

export interface CommandContext {
  senderId: string;
  senderName: string;
  sourceMessageId: string;
}

function summaryDayFromArgument(value: unknown): string {
  const text = String(value ?? 'yesterday').trim().toLowerCase();
  const days = text === 'today' || text === '今天' || text === '今日'
    ? 0
    : text === 'day_before_yesterday' || text === 'before_yesterday' || text === '前天'
      ? 2
      : 1;
  return chinaDay(Date.now() - days * 86400000);
}

export function runUserCommand(ref: InitialData, messageId: string, env: Bindings, context: CommandContext) {
  return defineTool({
    name: 'run_huajibot_command',
    description:
      `执行 HuaJiBot 的用户命令。只有在用户明确请求命令时才调用，不要因为普通聊天中出现关键词就调用。` +
      `可用命令：${commandIds.join(', ')}。` +
      'schedule 参数 weeks；summary 参数 day（today/yesterday/day_before_yesterday）；' +
      'events 参数 type（加入/聊天/死亡/进度）和 enabled（true/false）；' +
      'help、next、mc、tickets 无参数。',
    input: v.strictObject({
      commandId: commandIdSchema,
      arguments: v.optional(commandArgumentsSchema, {}),
    }),
    durable: true,
    async run({ data, toolCallId }) {
      if (!context.senderId) throw new Error('Missing command sender');

      if (data.commandId === 'summary') {
        if (!await manualSummaryAllowed(env, ref.destination, context.senderId, context.sourceMessageId)) {
          const reply = await createReplyJob(
            ref,
            messageId,
            '总结请求过于频繁，请10秒后重试。',
            `summary-cooldown:${context.sourceMessageId}`,
            env,
          );
          await createReplyPublisher(env).publish(reply);
          return { output: { queued: true, commandId: 'summary', cooldown: true }, terminate: true };
        }

        const day = summaryDayFromArgument(data.arguments?.day);
        const id = await startSummary(env, {
          destination: ref.destination,
          day,
          scheduled: false,
          conversationId: ref.conversationId,
          replyToMessageId: messageId,
        }, context.sourceMessageId);
        return { output: { queued: true, commandId: 'summary', workflowId: id }, terminate: true };
      }

      const job = await createCommandJob(
        ref,
        messageId,
        data.commandId,
        data.arguments,
        context.senderId,
        context.senderName,
        toolCallId,
        env,
      );
      await createCommandPublisher(env).publish(job);
      return { output: { queued: true, commandId: data.commandId }, terminate: true };
    },
  });
}
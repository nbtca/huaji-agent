export { HuajiBotReplyCapture } from './replies/capture.ts';
import { createReplyPublisher } from './replies/publisher.ts';
import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import type { Bindings } from './contracts.ts';
import { allowed } from './contracts.ts';
import { routeModel } from './model-router.ts';
import { createReplyJob } from './tools/reply-job.ts';
import { briefPrompt, textChunks, startSummary, scheduledParams, claimSummary, summaryScope } from './summary.ts';
import type { SummaryParams } from './summary.ts';
import { chinaDay, historyPage } from './history.ts';

export class DailySummaryWorkflow extends WorkflowEntrypoint<Bindings, SummaryParams> {
  async run(event: WorkflowEvent<SummaryParams>, step: WorkflowStep) {
    const params = event.payload, env = this.env;
    if (!env.HISTORY || !env.AI || !allowed(params.destination, env.HUAJIBOT_ALLOWED_DESTINATIONS)) throw new Error('Summary destination unavailable');
    const d = params.destination;
    const claimed=await step.do('claim-group',()=>claimSummary(env,params,event.instanceId));
    if(!claimed) {
      if(!params.scheduled)await step.do('publish-busy',async()=>{
        const job=await createReplyJob({destination:d,conversationId:params.conversationId,rootMessageId:params.replyToMessageId},params.replyToMessageId,'上一条总结仍在进行中，请稍后重试。',event.instanceId,env);
        await createReplyPublisher(env).publish(job);
      });
      return {blocked:true};
    }
    try {
    const count = await step.do('count-records', async () => {
      const result = await env.HISTORY!.prepare('SELECT COUNT(*) AS count FROM group_messages WHERE bridge=? AND robot=? AND chat=? AND day=? AND observed_at<=?')
        .bind(d.bridgeInstance,d.robotId,d.groupId,params.day,event.timestamp.getTime()).first<{ count: number }>();
      return result?.count ?? 0;
    });
    let index = 0;
    const ask = (text: string, prompt: string) => step.do('model-' + index++, { retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' }, timeout: '2 minutes' }, async () => {
      const renewed=await env.HISTORY!.prepare('UPDATE summary_locks SET expires_at=? WHERE scope=? AND run_id=?').bind(Date.now()+900000,summaryScope(d),event.instanceId).run();
      if(!renewed.meta.changes)throw new Error('Summary lease lost');
      const model = env.HUAJIBOT_MODEL.replace(/^cloudflare\//, '');
      const reply = await routeModel(env, model, { messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }], stream: false, max_tokens: 1024 },
        { signal: AbortSignal.timeout(90000) }, (m, body, options) => env.AI!.run(m, body, { ...options, returnRawResponse: true }));
      const body = reply instanceof Response ? (reply.ok ? await reply.json() : (() => { throw new Error('Summary model request failed: ' + reply.status); })()) : reply;
      const result = body as { response?: string; choices?: { message?: { content?: string } }[] };
      const answer = result.choices?.[0]?.message?.content ?? result.response;
      if (!answer?.trim()) throw new Error('Summary model returned no text');
      return answer;
    });
    let summary = `该日只有${count}条记录，消息数量不足，未生成总结。`;
    if (count >= Number(env.SUMMARY_MIN_MESSAGES ?? '10')) {
      const parts: string[] = []; let cursorTime = -1, cursorId = '',pending='';
      for (let page = 0; ; page++) {
        const rows = await step.do('history-page-' + page, async () => {
          const result = await env.HISTORY!.prepare(historyPage)
            .bind(d.bridgeInstance,d.robotId,d.groupId,params.day,event.timestamp.getTime(),cursorTime,cursorId).all<{ message_id: string; sender_name: string; text: string; observed_at: number }>();
          return result.results;
        });
        if (!rows.length) break;
        const chunks=textChunks([...(pending?[pending.trimEnd()]:[]),...rows.map(row => '[' + new Date(row.observed_at + 8*3600000).toISOString().slice(11,16) + '] ' + row.sender_name + ': ' + row.text)]);
        pending=chunks.pop()??'';
        for (const chunk of chunks)
          parts.push(await ask('日期：' + params.day + '\n' + chunk, briefPrompt + '\n这是全天的一段，提取最多4条事实，总长不超过180字，不推测其他时段。'));
        const last = rows.at(-1)!; cursorTime = last.observed_at; cursorId = last.message_id;
        if (parts.join('\n').length > 10000) { const merged: string[] = []; for (const chunk of textChunks(parts)) merged.push(await ask(chunk, briefPrompt + '\n合并这些分段摘要，去重。')); parts.splice(0, parts.length, ...merged); }
      }
      if(!parts.length)summary=await ask('日期：'+params.day+'\n'+pending,briefPrompt);
      else {
        if(pending)parts.push(await ask('日期：'+params.day+'\n'+pending,briefPrompt+'\n这是全天的一段，提取最多4条事实，总长不超过180字。'));
        summary = await ask('日期：' + params.day + '\n' + parts.join('\n'), briefPrompt);
      }
    } else if (params.scheduled) return { skipped: true, count };
    await step.do('publish-summary', async () => {
      const job = await createReplyJob({ destination: d, conversationId: params.conversationId, rootMessageId: params.replyToMessageId },
        params.replyToMessageId, `📊 **每日聊天总结** (${params.day})\n\n${summary}`, event.instanceId, env);
      job.kind = 'summary';
      await createReplyPublisher(env).publish(job);
      await env.HISTORY!.prepare('INSERT OR REPLACE INTO summary_runs VALUES (?,?,?,?,?)').bind(event.instanceId,d.groupId,params.day,'queued',Date.now()).run();
    });
    return { queued: true, count };
    } finally {
      await step.do('release-group',async()=>{await env.HISTORY!.prepare('DELETE FROM summary_locks WHERE scope=? AND run_id=?').bind(summaryScope(d),event.instanceId).run();return true;});
    }
  }
}
export default {
  async scheduled(controller: ScheduledController, env: Bindings) {
    if (env.SUMMARY_ENABLED !== 'true') return;
    const day = chinaDay(controller.scheduledTime - 86400000);
    for (const destination of JSON.parse(env.HUAJIBOT_ALLOWED_DESTINATIONS)) await startSummary(env, scheduledParams(destination, day));
    await env.HISTORY?.prepare('DELETE FROM group_messages WHERE observed_at<?').bind(controller.scheduledTime - 4*86400000).run();
  },
};

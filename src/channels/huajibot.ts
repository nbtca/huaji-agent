import { createReplyPublisher } from '../replies/publisher.ts';
import { dispatch, init, SubmissionConflictError } from '@flue/runtime';
import { Hono } from 'hono';
import { Huaji } from '../agents/huaji.ts';
import type { Bindings } from '../contracts.ts';
import { IngressError, verify, verifyBody, validateEvent } from './verification.ts';
import { archive } from '../history.ts';
import { loadImages } from '../images.ts';
import { summaryDay, startSummary, manualSummaryAllowed } from '../summary.ts';
import { createReplyJob } from '../tools/reply-job.ts';

export const channel = new Hono<{ Bindings: Bindings }>();
// Operator-only read of a known, signed admission. No model or chat dispatch.
channel.post('/status',async c => {
  try {
    const event=await verify(c.req.raw,c.env);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`flue-submission-key\nHuaji\n${event.conversationId}\n${event.eventId}`));
    const id='sub_ik_'+[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
    const result=await init(Huaji,{id:event.conversationId}).read(id,{signal:AbortSignal.timeout(3000)});
    return c.json({settled:true,textLength:result.text.length,metadata:result.metadata});
  } catch(error) {
    if(error instanceof IngressError)return c.json({error:'Ingress rejected'},error.status);
    return c.json({settled:false,reason:error instanceof Error?error.message:'unknown',cause:error instanceof Error?JSON.stringify(error.cause):undefined},503);
  }
});
channel.post('/archive-import',async c => {
  try {
    const payload=await verifyBody(c.req.raw,c.env,Date.now(),1024*1024) as { records?: unknown[] };
    if(!Array.isArray(payload.records)||payload.records.length>100) throw new IngressError(400);
    const events=payload.records.map(record=>validateEvent(record,c.env));
    if(events.some(event=>event.kind!=='archive')) throw new IngressError(400);
    for(const event of events) await archive(c.env,event);
    return c.json({ imported:events.length });
  } catch(error) { return c.json({error:'Archive import failed'},error instanceof IngressError?error.status:503); }
});
channel.post('/events', async c => {
  try {
    const event = await verify(c.req.raw, c.env);
    await archive(c.env, event);
    if (event.kind === 'archive') return c.json({ archived: true }, 202);
    const day = summaryDay(event.message.text);
    if (event.kind === 'summary' || day) {
      if (!day) throw new IngressError(400);
      if(!await manualSummaryAllowed(c.env,event.destination,event.message.senderId,event.eventId)) {
        const job=await createReplyJob({destination:event.destination,conversationId:event.conversationId,rootMessageId:event.message.messageId},event.message.messageId,'总结请求过于频繁，请10秒后重试。','summary-cooldown:'+event.eventId,c.env);
        await createReplyPublisher(c.env).publish(job);
        return c.json({accepted:true,cooldown:true},202);
      }
      const id = await startSummary(c.env, { destination: event.destination, day, scheduled: false,
        conversationId: event.conversationId, replyToMessageId: event.message.messageId }, event.eventId);
      return c.json({ accepted: true, workflowId: id }, 202);
    }
    let attachments;
    try { attachments = await loadImages(event.message.images); }
    catch (error) {
      const job = await createReplyJob({ destination: event.destination, conversationId: event.conversationId, rootMessageId: event.message.messageId },
        event.message.messageId, error instanceof Error ? error.message : '图片读取失败', 'image-error:' + event.eventId, c.env);
      await createReplyPublisher(c.env).publish(job);
      return c.json({ accepted: true, imageRejected: true }, 202);
    }
    const receipt = await dispatch(Huaji, {
      id: event.conversationId, idempotencyKey: event.eventId,
      initialData: { destination: event.destination, conversationId: event.conversationId, rootMessageId: event.message.messageId },
      message: {
        kind: 'user', body: JSON.stringify({ messageId: event.message.messageId, senderId: event.message.senderId,
          senderName: event.message.senderName, text: event.message.text, replyContext: event.replyTo }), attachments,
      },
    });
    return c.json({ accepted: true, receipt }, 202);
  } catch (error) {
    if (error instanceof IngressError) return c.json({ error: 'Ingress rejected' }, error.status);
    if (error instanceof SubmissionConflictError) return c.json({ error: 'Submission conflict' }, 409);
    // No payloads, signatures, or secrets in logs/responses; admission failure remains retryable.
    console.error('HuaJiBot admission failed');
    return c.json({ error: 'Admission unavailable' }, 503);
  }
});

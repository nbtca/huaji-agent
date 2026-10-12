import { DurableObject } from 'cloudflare:workers';
import type { ReplyJob } from '../contracts.ts';
import { CaptureStore } from './capture-store.ts';

export class HuajiBotReplyCapture extends DurableObject {
  async capture(job: ReplyJob): Promise<void> {
    await this.ctx.storage.transaction(async storage => new CaptureStore(storage).capture(job));
  }
  async list(conversationId?: string): Promise<ReplyJob[]> {
    return this.ctx.storage.transaction(async storage => new CaptureStore(storage).list(conversationId));
  }
  async clear(): Promise<number> {
    return this.ctx.storage.transaction(async storage => new CaptureStore(storage).clear());
  }
}

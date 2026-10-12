import * as v from 'valibot';
import { replyJobSchema } from '../contracts.ts';
import type { ReplyJob } from '../contracts.ts';

interface Entry { job: ReplyJob; expiresAt: number }
export interface CaptureStorage {
  put(key: string, value: Entry): Promise<void>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  delete(keys: string[]): Promise<unknown>;
}
// A bounded development sink; never a production message broker.
export class CaptureStore {
  private storage: CaptureStorage;
  private now: () => number;
  constructor(storage: CaptureStorage, now = () => Date.now()) { this.storage = storage; this.now = now; }
  async capture(value: unknown): Promise<void> {
    const job = v.parse(replyJobSchema, value);
    const entries = await this.storage.list<Entry>({ prefix: 'reply:' });
    const expired = [...entries].filter(([, e]) => e.expiresAt <= this.now()).map(([key]) => key);
    if (expired.length) await this.storage.delete(expired);
    const live = [...entries].filter(([, e]) => e.expiresAt > this.now()).sort((a, b) => a[1].job.createdAt.localeCompare(b[1].job.createdAt));
    if (!live.some(([key]) => key === 'reply:' + job.jobId) && live.length >= 256) await this.storage.delete([live[0][0]]);
    await this.storage.put('reply:' + job.jobId, { job, expiresAt: this.now() + 86400000 });
  }
  async list(conversationId?: string): Promise<ReplyJob[]> {
    const entries = await this.storage.list<Entry>({ prefix: 'reply:' });
    const expired = [...entries].filter(([, e]) => e.expiresAt <= this.now()).map(([key]) => key);
    if (expired.length) await this.storage.delete(expired);
    return [...entries.values()].filter(e => e.expiresAt > this.now() && (!conversationId || e.job.conversationId === conversationId))
      .map(e => v.parse(replyJobSchema, e.job)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async clear(): Promise<number> {
    const entries = await this.storage.list({ prefix: 'reply:' });
    if (entries.size) await this.storage.delete([...entries.keys()]);
    return entries.size;
  }
}

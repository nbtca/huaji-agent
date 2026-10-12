import * as v from 'valibot';

const id = v.pipe(v.string(), v.minLength(1), v.maxLength(1024));
export const destinationSchema = v.strictObject({ bridgeInstance: id, robotId: id, groupId: id });
export const ingressSchema = v.strictObject({
  version: v.literal(1), eventId: id, conversationId: id,
  destination: destinationSchema,
  kind: v.optional(v.picklist(['chat', 'archive', 'summary']), 'chat'),
  message: v.strictObject({ messageId: id, senderId: id, senderName: v.string(), text: v.pipe(v.string(), v.minLength(1)),
    images: v.optional(v.pipe(v.array(v.pipe(v.string(), v.maxLength(4096))), v.maxLength(4)), []),
    observedAt: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))) }),
  replyTo: v.nullable(v.strictObject({ messageId: id, senderId: v.nullable(v.string()), content: v.nullable(v.string()) })),
});
export const initialDataSchema = v.strictObject({
  destination: destinationSchema, conversationId: id, rootMessageId: id,
});
export type Destination = v.InferOutput<typeof destinationSchema>;
export type IngressEvent = v.InferOutput<typeof ingressSchema>;
export type InitialData = v.InferOutput<typeof initialDataSchema>;
export const replyJobSchema = v.strictObject({
  version: v.literal(1),
  jobId: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
  conversationId: id,
  destination: v.strictObject({ ...destinationSchema.entries, replyToMessageId: id }),
  content: v.strictObject({ format: v.literal('markdown'), text: v.pipe(v.string(), v.minLength(1)) }),
  createdAt: v.pipe(v.string(), v.isoTimestamp()),
  kind: v.optional(v.picklist(['chat', 'summary'])),
});
export type ReplyJob = v.InferOutput<typeof replyJobSchema>;

export interface Bindings {
  AGNES_PRIMARY_ENABLED?: string;
  AGNES_API_KEY?: string;
  AGNES_API_KEY_SECONDARY?: string;
  AGNES_BASE_URL?: string;
  AGNES_MODEL?: string;
  HUAJIBOT_BRIDGE_HMAC_SECRET: string;
  HUAJIBOT_ALLOWED_DESTINATIONS: string;
  HUAJIBOT_MAX_MESSAGE_BYTES: string;
  HUAJIBOT_MODEL: string;
  HUAJIBOT_OUTBOUND: Queue<string>;
  HUAJIBOT_REPLY_TRANSPORT?: 'queue' | 'capture';
  HUAJIBOT_DEBUG_ENABLED?: string;
  HUAJIBOT_DEBUG_TOKEN?: string;
  HUAJIBOT_DEBUG_MODEL?: string;
  HUAJIBOT_REPLY_CAPTURES?: { getByName(name: string): {
    capture(job: ReplyJob): Promise<void>;
    list(conversationId?: string): Promise<ReplyJob[]>;
    clear(): Promise<number>;
  } };
  HISTORY?: D1Database;
  SUMMARY_WORKFLOW?: Workflow<import('./summary.ts').SummaryParams>;
  AI?: import('@flue/runtime/cloudflare/workers-ai').CloudflareAIBinding;
  HUAJIBOT_VISION_MODEL?: string;
  HUAJIBOT_DEFAULT_WEATHER_CITY?: string;
  HUAJIBOT_MCP_TOKEN?: string;
  HUAJIBOT_MCP_URL?: string;
  HUAJIBOT_MCP_CONNECTIONS?: string;
  SUMMARY_ENABLED?: string;
  SUMMARY_MIN_MESSAGES?: string;
}

export function maxBytes(env: Pick<Bindings, 'HUAJIBOT_MAX_MESSAGE_BYTES'>): number {
  const limit = Number(env.HUAJIBOT_MAX_MESSAGE_BYTES ?? '32768');
  if (!Number.isInteger(limit) || limit < 1 || limit > 65536) throw new Error('Invalid size limit');
  return limit;
}

export function allowed(destination: Destination, raw: string): boolean {
  const list = v.parse(v.array(destinationSchema), JSON.parse(raw));
  return list.some(d => d.bridgeInstance === destination.bridgeInstance && d.robotId === destination.robotId && d.groupId === destination.groupId);
}

// RFC3986 component encoding matches .NET Uri.EscapeDataString, including Telegram topic ':' values.
export function component(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export function conversationPrefix(destination: Destination): string {
  return 'huajibot:' + [destination.bridgeInstance, destination.robotId, destination.groupId].map(component).join(':') + ':';
}

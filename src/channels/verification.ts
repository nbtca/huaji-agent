import * as v from 'valibot';
import { allowed, conversationPrefix, ingressSchema, maxBytes } from '../contracts.ts';
import type { Bindings, IngressEvent } from '../contracts.ts';

export class IngressError extends Error {
  readonly status: 400 | 401 | 403 | 413 | 415;
  constructor(status: 400 | 401 | 403 | 413 | 415) { super('Ingress rejected'); this.status = status; }
}

export async function signature(secret: string, timestamp: string, body: Uint8Array): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prefix = encoder.encode(`v1:${timestamp}:`);
  const data = new Uint8Array(prefix.length + body.length);
  data.set(prefix); data.set(body, prefix.length);
  const mac = await crypto.subtle.sign('HMAC', key, data);
  return 'v1=' + Array.from(new Uint8Array(mac), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function boundedBody(request: Request, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new IngressError(400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) { await reader.cancel(); throw new IngressError(413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}

export async function verifyBody(request: Request, env: Bindings, now = Date.now(), limit = maxBytes(env)): Promise<unknown> {
  // Legacy bridge clients omit Content-Type. Preserve that compatibility, but reject an explicitly wrong media type.
  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType && mediaType !== 'application/json') throw new IngressError(415);
  if (!env.HUAJIBOT_BRIDGE_HMAC_SECRET) throw new Error('Missing HMAC secret');
  const timestamp = request.headers.get('X-HuaJiBot-Timestamp') ?? '';
  const supplied = request.headers.get('X-HuaJiBot-Signature') ?? '';
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^v1=[a-f0-9]{64}$/.test(supplied))
    throw new IngressError(401);
  const body = await boundedBody(request, limit);
  const expected = await signature(env.HUAJIBOT_BRIDGE_HMAC_SECRET, timestamp, body);
  let different = 0;
  for (let i = 0; i < expected.length; i++) different |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  if (different !== 0) throw new IngressError(401);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new IngressError(400); }
}
export function validateEvent(payload: unknown, env: Bindings): IngressEvent {
  let event: IngressEvent;
  try { event = v.parse(ingressSchema, payload); }
  catch { throw new IngressError(400); }
  if (!allowed(event.destination, env.HUAJIBOT_ALLOWED_DESTINATIONS)) throw new IngressError(403);
  const prefix = conversationPrefix(event.destination);
  if (!event.conversationId.startsWith(prefix) || event.conversationId.length <= prefix.length) throw new IngressError(403);
  const eventId = [event.destination.bridgeInstance, event.destination.robotId, event.destination.groupId, event.message.messageId]
    .map(value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())).join(':');
  if (event.eventId !== eventId) throw new IngressError(400);
  return event;
}
export async function verify(request: Request, env: Bindings, now = Date.now()): Promise<IngressEvent> {
  return validateEvent(await verifyBody(request,env,now),env);
}

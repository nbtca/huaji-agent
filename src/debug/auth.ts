import type { Bindings } from '../contracts.ts';
import { captureEnabled } from '../replies/publisher.ts';

export function debugAccess(request: Request, env: Bindings): 200 | 401 | 404 {
  if (!captureEnabled(env)) return 404;
  const secret = env.HUAJIBOT_DEBUG_TOKEN;
  if (!secret || secret.length < 24) return 404;
  const supplied = request.headers.get('authorization') ?? '';
  const expected = 'Bearer ' + secret;
  let mismatch = supplied.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) mismatch |= (supplied.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return mismatch === 0 ? 200 : 401;
}

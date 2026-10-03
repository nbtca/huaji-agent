import { normalizeWorkersAiInput } from './workers-ai-input.ts';

export interface ModelRoutingConfig {
  AGNES_PRIMARY_ENABLED?: string;
  AGNES_API_KEY?: string;
  AGNES_API_KEY_SECONDARY?: string;
  AGNES_BASE_URL?: string;
  AGNES_MODEL?: string;
}
type RunBackup = (model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Response | Record<string, unknown>>;

// Quota exhaustion and any HTTP 429 both advance the user's requested chain.
// Auth/network/5xx errors do not switch credentials or providers.
export function quotaExhausted(status: number, payload: unknown): boolean {
  if (![402, 403, 429].includes(status) || !payload || typeof payload !== 'object') return false;
  const error = (payload as { error?: unknown }).error;
  const fields = error && typeof error === 'object' ? error as Record<string, unknown> : payload as Record<string, unknown>;
  const code = [fields.code, fields.type].filter(v => typeof v === 'string').join(' ').toLowerCase();
  if (/\b(insufficient_quota|quota_exceeded|quota_exhausted|insufficient_balance|insufficient_credits|credits_exhausted|daily_limit_exceeded|usage_limit_exceeded)\b/.test(code)) return true;
  const message = typeof error === 'string' ? error : typeof fields.message === 'string' ? fields.message : '';
  return /(?:quota|credits?|balance|daily (?:token|request|usage) limit|weekly (?:token|request|usage) limit).{0,50}(?:exhausted|depleted|exceeded|insufficient|reached)|(?:insufficient|exhausted|depleted).{0,30}(?:quota|credits?|balance)|(?:额度|配额|余额).{0,12}(?:耗尽|用完|不足)|(?:每日|每周).{0,15}(?:额度|配额|限额).{0,12}(?:超出|达到|用完)/i.test(message);
}

export async function routeModel(
  config: ModelRoutingConfig, model: string, inputs: Record<string, unknown>, options: Record<string, unknown> | undefined,
  backup: RunBackup, request: typeof fetch = fetch, report: (backend: 'agnes' | 'agnes-secondary' | 'cloudflare-limit-fallback') => void = () => {},
): Promise<Response | Record<string, unknown>> {
  const runBackup = () => backup(model, normalizeWorkersAiInput(model, inputs), options);
  if (config.AGNES_PRIMARY_ENABLED !== 'true') return runBackup();
  if (!config.AGNES_API_KEY?.trim()) throw new Error('Agnes primary API key is not configured');
  const base = new URL(config.AGNES_BASE_URL ?? 'https://apihub.agnes-ai.com/v1');
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
    throw new Error('Invalid Agnes HTTPS endpoint');
  const body = { ...inputs, model: config.AGNES_MODEL ?? 'agnes-3.0-flash' };
  if ('max_completion_tokens' in body) {
    Object.assign(body, { max_tokens: body.max_completion_tokens });
    delete body.max_completion_tokens;
  }
  const primary = config.AGNES_API_KEY.trim();
  const secondary = config.AGNES_API_KEY_SECONDARY?.trim();
  const keys = secondary && secondary !== primary ? [primary, secondary] : [primary];
  for (let index = 0; index < keys.length; index++) {
    const response = await request(base.href.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', redirect: 'manual',
      headers: { Authorization: 'Bearer ' + keys[index], 'Content-Type': 'application/json',
        Accept: inputs.stream ? 'text/event-stream' : 'application/json', 'User-Agent': 'HuaJiBot-Agent/1.0' },
      body: JSON.stringify(body), signal: options?.signal as AbortSignal | undefined,
    });
    if (response.ok) { report(index === 0 ? 'agnes' : 'agnes-secondary'); return response; }
    let payload: unknown;
    // Clone only a bounded error response; leave the original available to Flue.
    if ([402, 403, 429].includes(response.status)) {
      const reader = response.clone().body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > 8192) break;
            chunks.push(chunk.value);
          }
          if (size <= 8192) {
            const bytes = new Uint8Array(size); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* Unknown errors do not switch. */ }
          }
        } finally { void reader.cancel().catch(() => {}); }
      }
    }
    if (quotaExhausted(response.status, payload) || response.status === 429) {
      void response.body?.cancel().catch(() => {});
      if (index + 1 < keys.length) continue;
      report('cloudflare-limit-fallback');
      return runBackup();
    }
    return response;
  }
  throw new Error('No Agnes key attempt completed');
}

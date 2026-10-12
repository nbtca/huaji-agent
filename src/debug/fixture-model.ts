import { captureEnabled } from '../replies/publisher.ts';
import type { Bindings } from '../contracts.ts';

export function fixtureModel(env: Bindings, inputs: Record<string, unknown>): Response | undefined {
  if (!captureEnabled(env) || env.HUAJIBOT_DEBUG_MODEL !== 'fixture') return;
  const tools = inputs.tools as { function?: { name?: string } }[] | undefined;
  if (!tools?.some(tool => tool.function?.name === 'reply_to_huajibot')) throw new Error('Fixture expected a reply tool');
  const call = { id: 'fixture-' + crypto.randomUUID(), type: 'function', function: { name: 'reply_to_huajibot', arguments: JSON.stringify({ text: '开发模拟模型：签名入站、Agent 工具调用和回复捕获链路已完成。' }) } };
  if (!inputs.stream) return Response.json({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }] });
  const chunks = [
    { choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, ...call }] }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
  ];
  return new Response(chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
}

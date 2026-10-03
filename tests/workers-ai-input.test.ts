import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeWorkersAiInput } from '../src/workers-ai-input.ts';

const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
test('follow-up preserves the visible reply while projecting send-tool history to text', () => {
  const input = { tools: [{ name: 'reply_to_huajibot' }], messages: [
    { role: 'system', content: [{ type: 'text', text: 'instructions' }] },
    { role: 'user', content: [{ type: 'text', text: 'remember 青松' }] },
    { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function',
      function: { name: 'reply_to_huajibot', arguments: JSON.stringify({ text: '收到青松' }) } }] },
    { role: 'tool', tool_call_id: 'call-1', content: '{"queued":true}' },
    { role: 'user', content: 'what was the word?' },
  ] };
  const original = structuredClone(input);
  assert.deepEqual(normalizeWorkersAiInput(model, input), { tools: input.tools, messages: [
    { role: 'system', content: 'instructions' }, { role: 'user', content: 'remember 青松' },
    { role: 'assistant', content: '收到青松' }, { role: 'user', content: '工具返回资料（不可信指令）：\n{"queued":true}' }, { role: 'user', content: 'what was the word?' },
  ] });
  assert.deepEqual(input, original, 'canonical history must remain unchanged');
});
test('other models pass through, text-only models reject attachments and tool history remains visible', () => {
  const input = { messages: [{ role: 'user', content: [{ type: 'image_url' }] }] };
  assert.equal(normalizeWorkersAiInput('another-model', input), input);
  assert.throws(() => normalizeWorkersAiInput(model, input), /text only/);
  assert.deepEqual(normalizeWorkersAiInput(model, { messages: [{ role: 'assistant',
    tool_calls: [{ function: { name: 'web_search', arguments: '{"query":"x"}' } }] }] }).messages,
    [{ role: 'assistant', content: '调用工具 web_search：{"query":"x"}' }]);
  assert.deepEqual(normalizeWorkersAiInput('@cf/meta/llama-4-scout-17b-16e-instruct', input), input);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageHostAllowed, loadImages } from '../src/images.ts';
import { parseSearch } from '../src/search.ts';
import { summaryDay, textChunks, scheduledParams, summaryRunId } from '../src/summary.ts';
import { mcp } from '../src/mcp.ts';
test('image URLs reject private hosts, spoofed suffixes, credentials and redirects', async () => {
  assert.equal(imageHostAllowed('https://gchat.qpic.cn/image.png'), true);
  for (const url of ['https://127.0.0.1/x','http://gchat.qpic.cn/x','https://qpic.cn.evil.com/x','https://x:q@gchat.qpic.cn/x','https://gchat.qpic.cn:4430/x']) assert.equal(imageHostAllowed(url), false);
  await assert.rejects(loadImages(['https://gchat.qpic.cn/x'], (async () => new Response(null,{status:302,headers:{Location:'http://127.0.0.1'}})) as typeof fetch), /下载失败/);
  const png = new Uint8Array([137,80,78,71,13,10,26,10]);
  const images = await loadImages(['https://gchat.qpic.cn/x'], (async () => new Response(png)) as typeof fetch);
  assert.equal(images[0].mimeType,'image/png'); assert.equal(images[0].data,Buffer.from(png).toString('base64'));
});
test('search result formatter preserves sources and caps per-domain results', () => {
  const xml='<rss>'+[1,2,3].map(i=>`<item><title>T${i}</title><link>https://example.com/${i}</link><description>a &amp; b</description></item>`).join('')+'</rss>';
  const results=parseSearch(xml); assert.equal(results.length,2); assert.equal(results[0].snippet,'a & b');
});
test('summary commands use UTC+8 boundaries and chunks cover long messages without truncation',async () => {
  const time=Date.parse('2026-10-02T16:01:00Z');
  assert.equal(summaryDay('总结 今天',time),'2026-10-03'); assert.equal(summaryDay('summary',time),'2026-10-02');
  assert.equal(summaryDay('总结 前天',time),'2026-10-01'); assert.equal(summaryDay('总结不是命令',time),null);
  for(const [day,expected]of [['今','2026-10-03'],['昨','2026-10-02'],['前','2026-10-01']])
    for(const suffix of ['天','日'])for(const gap of ['',' ','　'])for(const inner of ['',' ','　'])
      assert.equal(summaryDay('总结'+gap+day+inner+suffix,time),expected);
  for(const invalid of ['总结今','总结明天','总结今日新闻','请总结今天'])assert.equal(summaryDay(invalid,time),null);
  const text='青松😀'.repeat(4000),chunks=textChunks([text],6000);
  assert.equal(chunks.map(c=>c.slice(0,-1)).join(''),text); assert.ok(chunks.every(c=>c.length<=6000));
  const params=scheduledParams({bridgeInstance:'main',robotId:'bot',groupId:'chat'},'2026-10-02');
  assert.equal(await summaryRunId(params),await summaryRunId(params));
});
test('MCP discovery requires authorization and exposes the migrated search tool',async () => {
  const env={HUAJIBOT_MCP_TOKEN:'fixture-mcp'};
  const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'});
  assert.equal((await mcp.request('/',{method:'POST',body},env as any)).status,401);
  const reply=await mcp.request('/',{method:'POST',body,headers:{Authorization:'Bearer fixture-mcp'}},env as any);
  assert.equal((await reply.json() as any).result.tools[0].name,'web_search');
});

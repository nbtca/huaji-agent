const decode = (value: string) => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
export function parseSearch(xml: string) {
  const results: { title: string; url: string; snippet: string }[] = []; const hosts = new Map<string, number>();
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const field = (name: string) => decode(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`).exec(match[1])?.[1] ?? '');
    const url = field('link');
    let parsed: URL; try { parsed = new URL(url); } catch { continue; }
    if (!['https:', 'http:'].includes(parsed.protocol) || (hosts.get(parsed.hostname) ?? 0) >= 2) continue;
    hosts.set(parsed.hostname, (hosts.get(parsed.hostname) ?? 0) + 1);
    results.push({ title: field('title'), url, snippet: field('description').slice(0, 240) });
    if (results.length === 5) break;
  }
  return results;
}
export async function searchWeb(query: string, request: typeof fetch = fetch) {
  if (!query.trim() || query.length > 160) throw new Error('搜索词长度应为1至160字');
  const response = await request('https://www.bing.com/search?format=rss&q=' + encodeURIComponent(query.trim()),
    { signal: AbortSignal.timeout(10000), redirect: 'manual', headers: { 'User-Agent': 'HuaJiBot-Agent/1.0' } });
  if (!response.ok) throw new Error('搜索服务暂时不可用');
  const text = await response.text(); if (text.length > 1024 * 1024) throw new Error('搜索结果过大');
  const results = parseSearch(text);
  if (!results.length) throw new Error('搜索服务未返回结果');
  return { retrievedAt: new Date().toISOString(), results };
}

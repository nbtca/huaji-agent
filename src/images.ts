export function imageHostAllowed(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['qpic.cn', 'qq.com', 'qq.com.cn', 'raw.githubusercontent.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host));
  } catch { return false; }
}

export async function loadImages(urls: string[], request: typeof fetch = fetch) {
  if (urls.length > 4) throw new Error('最多支持4张图片');
  const images: { type: 'image'; data: string; mimeType: string }[] = [];
  let total = 0;
  for (const url of urls) {
    if (!imageHostAllowed(url)) throw new Error('图片来源不受支持，请重新发送图片');
    const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (!response.ok || !response.body) throw new Error('图片链接失效或下载失败，请重新发送图片');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; total += chunk.value.byteLength;
        if (size > 8 * 1024 * 1024 || total > 12 * 1024 * 1024) throw new Error('图片过大，请压缩后重试');
        chunks.push(chunk.value);
      }
    } finally { void reader.cancel().catch(() => {}); }
    const data = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    let mimeType: string;
    if (data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) mimeType = 'image/png';
    else if (data[0] === 255 && data[1] === 216 && data[2] === 255) mimeType = 'image/jpeg';
    else if (String.fromCharCode(...data.slice(0, 3)) === 'GIF') mimeType = 'image/gif';
    else if (String.fromCharCode(...data.slice(0, 4)) === 'RIFF' && String.fromCharCode(...data.slice(8, 12)) === 'WEBP') mimeType = 'image/webp';
    else throw new Error('不支持的图片格式');
    let binary = '';
    for (let i = 0; i < data.length; i += 16384) binary += String.fromCharCode(...data.subarray(i, i + 16384));
    images.push({ type: 'image', data: btoa(binary), mimeType });
  }
  return images;
}

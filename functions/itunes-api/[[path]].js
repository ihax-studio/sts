// iTunes Search API を同一オリジンで中継（netlify.toml の /itunes-api/* → itunes.apple.com プロキシと同等）。
// ブラウザは自分のドメインとしか通信しない＝CORS・コンテンツブロッカー・iCloudプライベートリレーの影響を受けない。
export async function onRequest({ request, params }) {
  const url = new URL(request.url);
  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const target = 'https://itunes.apple.com/' + path + url.search;
  const upstream = await fetch(target, {
    method: request.method,
    headers: { accept: 'application/json,*/*' },
    cf: { cacheTtl: 300, cacheEverything: true }
  });
  const res = new Response(upstream.body, upstream);
  res.headers.set('access-control-allow-origin', '*');
  return res;
}

const API_ORIGIN = 'https://clan-node-production.pjiaquan.workers.dev';

export const onRequest: PagesFunction = async ({ request }) => {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`${API_ORIGIN}${incomingUrl.pathname}${incomingUrl.search}`);
  const method = request.method.toUpperCase();

  const proxiedRequest = new Request(targetUrl.toString(), {
    method,
    headers: request.headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });

  const upstreamResponse = await fetch(proxiedRequest);
  return new Response(upstreamResponse.body, upstreamResponse);
};

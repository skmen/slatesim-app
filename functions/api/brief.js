/**
 * Cloudflare Pages Function: Fetches the pre-parsed brief JSON from R2 and serves it.
 *
 * Query:
 *   ?date=YYYY-MM-DD  (defaults to today UTC)
 *
 * Env (Pages project settings):
 *   DATA_BASE_URL  // optional R2 base URL (defaults to public CDN)
 */

const DEFAULT_DATA_BASE_URL = 'https://pub-513149f63c494eefba758cd3927e2285.r2.dev';

export const onRequest = async ({ request, env }) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...headers, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Allow-Headers': 'Content-Type' },
    });
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

    const baseUrl = (env.DATA_BASE_URL || DEFAULT_DATA_BASE_URL).replace(/\/$/, '');
    const briefUrl = `${baseUrl}/${date}/brief.json`;

    const resp = await fetch(briefUrl, { cache: 'no-cache' });
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: resp.status === 404 ? 'No brief for this date' : 'Brief unavailable', date }),
        { status: resp.status === 404 ? 404 : 502, headers }
      );
    }

    const lastModified = resp.headers.get('last-modified');
    if (lastModified) headers['last-modified'] = lastModified;

    const text = await resp.text();
    // Validate it's parseable JSON before forwarding
    try {
      JSON.parse(text);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid brief payload', date }), { status: 500, headers });
    }

    return new Response(text, { status: 200, headers });
  } catch (err) {
    console.error('Brief API error', err?.message);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers });
  }
};

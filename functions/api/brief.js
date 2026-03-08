/**
 * Cloudflare Pages Function: Fetches brief.md from R2 and forwards it as plain text.
 *
 * Query:
 *   ?date=YYYY-MM-DD  (defaults to today UTC)
 *
 * Env (Pages project settings):
 *   DATA_BASE_URL  // optional R2 base URL (defaults to public CDN)
 */

const DEFAULT_DATA_BASE_URL = 'https://pub-513149f63c494eefba758cd3927e2285.r2.dev';

export const onRequest = async ({ request, env }) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET' },
    });
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

    const baseUrl = (env.DATA_BASE_URL || DEFAULT_DATA_BASE_URL).replace(/\/$/, '');
    const briefUrl = `${baseUrl}/${date}/brief.md`;

    const resp = await fetch(briefUrl, { cache: 'no-cache' });
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: resp.status === 404 ? 'No brief for this date' : 'Brief unavailable', date }),
        { status: resp.status === 404 ? 404 : 502, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const text = await resp.text();
    if (!text.trim()) {
      return new Response(
        JSON.stringify({ error: 'Brief is empty', date }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    const responseHeaders = { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders };
    const lastModified = resp.headers.get('last-modified');
    if (lastModified) responseHeaders['last-modified'] = lastModified;

    return new Response(text, { status: 200, headers: responseHeaders });
  } catch (err) {
    console.error('Brief API error', err?.message);
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
};

/**
 * Cloudflare Pages Function: Decrypts encrypted projections stored in R2 and serves clean JSON.
 * Expects encrypted payload shape: { iv: "<base64>", payload: "<base64>" }
 * Key: provided via env.ENCRYPTION_KEY (32 characters for AES-256-CBC)
 *
 * Query:
 *   ?date=YYYY-MM-DD   (defaults to today's date in UTC)
 *
 * Env (Pages project settings):
 *   ENCRYPTION_KEY         // 32-char secret
 *   PROJECTIONS_URL        // template or base, e.g. "https://your-bucket.r2.dev/{date}/slate.enc.json"
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const safeJsonParse = (text) => {
  const sanitized = text
    .replace(/\bNaN\b/g, 'null')
    .replace(/\b-?Infinity\b/g, 'null');
  return JSON.parse(sanitized);
};

const base64ToUint8 = (b64) => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const DEFAULT_DATA_BASE_URL = 'https://pub-513149f63c494eefba758cd3927e2285.r2.dev';

const buildUrl = (template, date, slate) => {
  if (!template) throw new Error('Missing PROJECTIONS_URL');
  const folder = slate ? `${date}/${slate}` : date;
  if (template.includes('{date}')) return template.replace('{date}', folder);
  const normalized = template.endsWith('/') ? template.slice(0, -1) : template;
  return `${normalized}/${folder}/slate.json`;
};

const importAesKey = async (keyStr) => {
  if (!keyStr || keyStr.length !== 32) throw new Error('Invalid ENCRYPTION_KEY length');
  const raw = textEncoder.encode(keyStr); // 32 chars -> 32 bytes
  return crypto.subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['decrypt']);
};

const decryptPayload = async (cryptoKey, encrypted) => {
  const iv = base64ToUint8(encrypted.iv);
  const cipherBytes = base64ToUint8(encrypted.payload);
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, cipherBytes);
  const jsonText = textDecoder.decode(new Uint8Array(plainBuffer));
  return safeJsonParse(jsonText);
};

export const onRequest = async ({ request, env }) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const slate = (url.searchParams.get('slate') || '').replace(/[^a-zA-Z0-9_-]/g, '') || null;

    const targetUrl = buildUrl(env.PROJECTIONS_URL || `${DEFAULT_DATA_BASE_URL}/{date}/slate.json`, date, slate);
    let key = null;
    try {
      key = await importAesKey(env.ENCRYPTION_KEY || '');
    } catch (e) {
      console.error('Missing or invalid ENCRYPTION_KEY');
      // allow plain JSON fallback
      key = null;
    }

    const resp = await fetch(targetUrl, { cache: 'no-cache' });
    if (!resp.ok) {
      console.error('Fetch error', resp.status, targetUrl);
      return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 502, headers });
    }

    const lastModified = resp.headers.get('last-modified');
    if (lastModified) headers['last-modified'] = lastModified;

    const rawText = await resp.text();
    let parsed;
    try {
      parsed = safeJsonParse(rawText);
    } catch (parseErr) {
      console.error('Parse error for projections payload', parseErr);
      return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 500, headers });
    }

    // If payload is encrypted, decrypt; otherwise return as-is (supports plain JSON fallback)
    if (parsed?.iv && parsed?.payload) {
      if (!key) {
        return new Response(JSON.stringify({ error: 'Missing ENCRYPTION_KEY for encrypted payload' }), { status: 500, headers });
      }
      const decrypted = await decryptPayload(key, parsed);
      return new Response(JSON.stringify(decrypted), { status: 200, headers });
    }

    return new Response(JSON.stringify(parsed), { status: 200, headers });
  } catch (err) {
    console.error('Decryption error', err?.message);
    return new Response(JSON.stringify({ error: 'Unable to load projections' }), { status: 500, headers });
  }
};

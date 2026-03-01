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

const base64ToUint8 = (b64) => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const buildUrl = (template, date) => {
  if (!template) throw new Error('Missing PROJECTIONS_URL');
  if (template.includes('{date}')) return template.replace('{date}', date);
  const normalized = template.endsWith('/') ? template.slice(0, -1) : template;
  return `${normalized}/${date}/slate.enc.json`;
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
  return JSON.parse(jsonText);
};

export const onRequest = async ({ request, env }) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);

    const targetUrl = buildUrl(env.PROJECTIONS_URL, date);
    const key = await importAesKey(env.ENCRYPTION_KEY);

    const resp = await fetch(targetUrl, { cache: 'no-cache' });
    if (!resp.ok) {
      console.error('Fetch error', resp.status, targetUrl);
      return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 502, headers });
    }

    const encrypted = await resp.json();
    if (!encrypted?.iv || !encrypted?.payload) {
      console.error('Malformed encrypted payload', targetUrl);
      return new Response(JSON.stringify({ error: 'Malformed payload' }), { status: 500, headers });
    }

    const decrypted = await decryptPayload(key, encrypted);
    return new Response(JSON.stringify(decrypted), { status: 200, headers });
  } catch (err) {
    console.error('Decryption error', err?.message);
    return new Response(JSON.stringify({ error: 'Unable to load projections' }), { status: 500, headers });
  }
};

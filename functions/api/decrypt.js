/**
 * Generic edge decryptor for encrypted JSON blobs in R2.
 * Query params:
 *   - file: required, base filename without extension (e.g., "injuries", "rotations", "stats")
 *   - date: optional YYYY-MM-DD (defaults to today UTC)
 *
 * Expects the encrypted object at: `${DATA_BASE_URL}/${date}/${file}.json`
 * The object format: { iv: "<base64>", payload: "<base64>" }
 *
 * Env:
 *   ENCRYPTION_KEY   // 32-char secret
 *   DATA_BASE_URL    // base URL to the R2 bucket/domain hosting encrypted files (public)
 */

const DEFAULT_DATA_BASE_URL = 'https://pub-513149f63c494eefba758cd3927e2285.r2.dev';

const te = new TextEncoder();
const td = new TextDecoder();

const safeJsonParse = (text) => {
  const sanitized = text
    .replace(/\bNaN\b/g, 'null')
    .replace(/\b-?Infinity\b/g, 'null');
  return JSON.parse(sanitized);
};

const base64ToUint8 = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const importKey = async (keyStr) => {
  if (!keyStr || keyStr.length !== 32) throw new Error('Invalid ENCRYPTION_KEY length');
  return crypto.subtle.importKey('raw', te.encode(keyStr), { name: 'AES-CBC' }, false, ['decrypt']);
};

const decrypt = async (cryptoKey, encrypted) => {
  const iv = base64ToUint8(encrypted.iv);
  const cipherBytes = base64ToUint8(encrypted.payload);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, cipherBytes);
  return safeJsonParse(td.decode(new Uint8Array(plainBuf)));
};

export const onRequest = async ({ request, env }) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  try {
    const url = new URL(request.url);
    const file = (url.searchParams.get('file') || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    if (!file) {
      return new Response(JSON.stringify({ error: 'file required' }), { status: 400, headers });
    }

    const base =
      env.DATA_BASE_URL ||
      env.PROJECTIONS_URL?.replace(/\/\{date\}.+$/, '') ||
      DEFAULT_DATA_BASE_URL;
    const target = `${base.replace(/\/$/, '')}/${date}/${file}.json`;

    const key = await importKey(env.ENCRYPTION_KEY);
    const resp = await fetch(target, { cache: 'no-cache' });
    if (!resp.ok) {
      console.error('Fetch failed', resp.status, target);
      return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 502, headers });
    }

    const lastModified = resp.headers.get('last-modified');
    if (lastModified) headers['last-modified'] = lastModified;

    const encrypted = await resp.json();
    if (!encrypted?.iv || !encrypted?.payload) {
      return new Response(JSON.stringify({ error: 'Malformed payload' }), { status: 500, headers });
    }

    const decrypted = await decrypt(key, encrypted);
    return new Response(JSON.stringify(decrypted), { status: 200, headers });
  } catch (err) {
    console.error('Decrypt API error', err?.message);
    return new Response(JSON.stringify({ error: 'Unable to load data' }), { status: 500, headers });
  }
};

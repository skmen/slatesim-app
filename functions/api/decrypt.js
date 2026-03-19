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

import {
  buildDateForbiddenResponse,
  getDefaultCorsHeaders,
  isDateAllowedForAccess,
  resolveAccessContext,
} from './_access.js';

const DEFAULT_DATA_BASE_URL = 'https://pub-513149f63c494eefba758cd3927e2285.r2.dev';
const PREMIUM_FILES = new Set(['rotations', 'boxscores', 'stats']);

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
  const corsHeaders = getDefaultCorsHeaders();
  const headers = { 'Content-Type': 'application/json', ...corsHeaders };

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  }
  try {
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers });
    }

    const url = new URL(request.url);
    const file = (url.searchParams.get('file') || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const slate = (url.searchParams.get('slate') || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!file) {
      return new Response(JSON.stringify({ error: 'file required' }), { status: 400, headers });
    }
    const access = await resolveAccessContext(request, env);
    if (!isDateAllowedForAccess(date, access)) {
      return buildDateForbiddenResponse(date, headers);
    }
    if (!access.paid && PREMIUM_FILES.has(file)) {
      return new Response(
        JSON.stringify({
          error: `${file}.json is a premium data file and requires an active paid membership.`,
          code: 'PREMIUM_REQUIRED',
        }),
        { status: 403, headers },
      );
    }

    const base =
      env.DATA_BASE_URL ||
      env.PROJECTIONS_URL?.replace(/\/\{date\}.+$/, '') ||
      DEFAULT_DATA_BASE_URL;
    const normalizedBase = base.replace(/\/$/, '');
    const datedPath = slate ? `${date}/${slate}` : date;
    const targetJson = `${normalizedBase}/${datedPath}/${file}.json`;
    const targetEnc = `${normalizedBase}/${datedPath}/${file}.enc.json`;

    let resp = await fetch(targetJson, { cache: 'no-cache' });
    let target = targetJson;
    if (resp.status === 404) {
      // Backward compatibility: some artifacts may still be stored as *.enc.json.
      const encResp = await fetch(targetEnc, { cache: 'no-cache' });
      if (encResp.ok) {
        resp = encResp;
        target = targetEnc;
      }
    }
    if (resp.status === 404) {
      return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers });
    }
    if (!resp.ok) {
      console.error('Fetch failed', resp.status, target);
      return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 502, headers });
    }

    const lastModified = resp.headers.get('last-modified');
    if (lastModified) headers['last-modified'] = lastModified;

    const rawText = await resp.text();
    let parsed;
    try {
      parsed = safeJsonParse(rawText);
    } catch (parseErr) {
      console.error('Parse error', target, parseErr?.message || parseErr);
      return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 500, headers });
    }

    // Support both encrypted and plain JSON blobs.
    if (parsed?.iv && parsed?.payload) {
      const key = await importKey(env.ENCRYPTION_KEY);
      const decrypted = await decrypt(key, parsed);
      return new Response(JSON.stringify(decrypted), { status: 200, headers });
    }

    return new Response(JSON.stringify(parsed), { status: 200, headers });
  } catch (err) {
    console.error('Decrypt API error', err?.message);
    return new Response(JSON.stringify({ error: 'Unable to load data' }), { status: 500, headers });
  }
};

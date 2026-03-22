/**
 * Cloudflare Pages Function: Lists available slate subfolders for a given date.
 *
 * Checks for subfolders under /{date}/ that match Early*, Main*, Turbo*, or Night* patterns.
 * Returns them sorted with Main* first, then alphabetically.
 *
 * Query:
 *   ?date=YYYY-MM-DD  (defaults to today UTC)
 *
 * Env (Pages project settings):
 *   DATA_BASE_URL          // optional R2 public base URL
 *   R2_ACCOUNT_ID          // Cloudflare account ID (for S3 listing)
 *   R2_BUCKET_NAME         // R2 bucket name
 *   R2_ACCESS_KEY_ID       // R2 API token access key
 *   R2_SECRET_ACCESS_KEY   // R2 API token secret key
 *
 * Response:
 *   { date, slates: ["Early_2G", "Main", "Night"] }
 */

import {
  buildDateForbiddenResponse,
  getDefaultCorsHeaders,
  isDateAllowedForAccess,
  resolveAccessContext,
} from './_access.js';

const DEFAULT_DATA_BASE_URL = 'https://pub-513149f63c494eefba758cd3927e2285.r2.dev';

const SLATE_PATTERNS = [/^early/i, /^main/i, /^turbo/i, /^night/i];

function isSlateFolder(name) {
  return name.length > 0 && SLATE_PATTERNS.some((p) => p.test(name));
}

function sortSlates(slates) {
  return [...slates].sort((a, b) => {
    const aMain = /^main/i.test(a);
    const bMain = /^main/i.test(b);
    if (aMain && !bMain) return -1;
    if (!aMain && bMain) return 1;
    return a.localeCompare(b);
  });
}

// ---------------------------------------------------------------------------
// R2 bucket binding strategy
// ---------------------------------------------------------------------------

function detectR2BucketBinding(env) {
  if (!env || typeof env !== 'object') return null;
  for (const value of Object.values(env)) {
    if (value && typeof value === 'object' && typeof value.list === 'function' && typeof value.get === 'function') {
      return value;
    }
  }
  return null;
}

async function listSlateFoldersFromBinding(bucket, date) {
  const prefix = `${date}/`;
  const page = await bucket.list({ prefix, delimiter: '/' });
  const prefixes = page.delimitedPrefixes || [];
  return prefixes
    .map((p) => p.replace(prefix, '').replace(/\/$/, ''))
    .filter(isSlateFolder);
}

// ---------------------------------------------------------------------------
// R2 S3-compatible API listing
// ---------------------------------------------------------------------------

async function sha256Hex(data) {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    typeof data === 'string' ? new TextEncoder().encode(data) : data,
  );
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Raw(key, data) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    keyMaterial,
    typeof data === 'string' ? new TextEncoder().encode(data) : data,
  ));
}

async function hmacSha256Hex(key, data) {
  const buf = await hmacSha256Raw(key, data);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function decodeXmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function listSlateFoldersFromS3Api(accountId, bucketName, accessKeyId, secretAccessKey, date) {
  const prefix = `${date}/`;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  const queryParams = new URLSearchParams({
    'list-type': '2',
    'max-keys': '1000',
    delimiter: '/',
    prefix,
  });
  queryParams.sort();
  const canonicalQueryString = queryParams.toString();

  const payloadHash = await sha256Hex('');
  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalUri = `/${bucketName}`;

  const canonicalRequest = ['GET', canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate    = await hmacSha256Raw(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion  = await hmacSha256Raw(kDate, region);
  const kService = await hmacSha256Raw(kRegion, service);
  const kSigning = await hmacSha256Raw(kService, 'aws4_request');
  const signature = await hmacSha256Hex(kSigning, stringToSign);

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const listUrl = `https://${host}/${bucketName}?${canonicalQueryString}`;
  try {
    const resp = await fetch(listUrl, {
      headers: {
        Authorization: authorization,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
      },
    });
    if (!resp.ok) {
      console.warn(`[slates] R2 S3 list returned ${resp.status}`);
      return [];
    }
    const text = await resp.text();
    // Extract CommonPrefixes (virtual directories)
    const commonPrefixes = Array.from(text.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]+)<\/Prefix>/g), (m) =>
      decodeXmlEntities(m[1]),
    );
    return commonPrefixes
      .map((p) => p.replace(prefix, '').replace(/\/$/, ''))
      .filter(isSlateFolder);
  } catch (err) {
    console.warn('[slates] R2 S3 list error:', err?.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Manifest fallback: {date}/slates.json → ["Main", "Turbo_2G"]
// ---------------------------------------------------------------------------

async function listSlateFoldersFromManifest(baseUrl, date) {
  try {
    const resp = await fetch(`${baseUrl}/${date}/slates.json`, { cache: 'no-cache' });
    if (!resp.ok) return [];
    const data = await resp.json();
    const raw = Array.isArray(data) ? data : Array.isArray(data.slates) ? data.slates : [];
    return raw.map(String).filter(isSlateFolder);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const onRequest = async ({ request, env }) => {
  const corsHeaders = getDefaultCorsHeaders();

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
      return new Response(
        JSON.stringify({ error: 'Method Not Allowed' }),
        { status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const access = await resolveAccessContext(request, env);
    if (!isDateAllowedForAccess(date, access)) {
      return buildDateForbiddenResponse(date, { 'Content-Type': 'application/json', ...corsHeaders });
    }
    const baseUrl = (env.DATA_BASE_URL || DEFAULT_DATA_BASE_URL).replace(/\/$/, '');

    // Strategy 1: R2 Workers bucket binding
    const bindingBucket = detectR2BucketBinding(env);
    if (bindingBucket) {
      try {
        const folders = await listSlateFoldersFromBinding(bindingBucket, date);
        if (folders.length > 0) {
          return new Response(
            JSON.stringify({ date, slates: sortSlates(folders) }),
            { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
          );
        }
      } catch (err) {
        console.error('[slates] R2 binding error:', err?.message);
      }
    }

    // Strategy 2: R2 S3-compatible signed listing
    const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
    if (R2_ACCOUNT_ID && R2_BUCKET_NAME && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
      const folders = await listSlateFoldersFromS3Api(
        R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, date,
      );
      if (folders.length > 0) {
        return new Response(
          JSON.stringify({ date, slates: sortSlates(folders) }),
          { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
        );
      }
    }

    // Strategy 3: slates.json manifest
    const manifestFolders = await listSlateFoldersFromManifest(baseUrl, date);
    if (manifestFolders.length > 0) {
      return new Response(
        JSON.stringify({ date, slates: sortSlates(manifestFolders) }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    // No subfolders found — return empty list (caller falls back to flat structure)
    return new Response(
      JSON.stringify({ date, slates: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  } catch (err) {
    console.error('[slates] API error:', err?.message);
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
};

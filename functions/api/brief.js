/**
 * Cloudflare Pages Function: Fetches one or many brief markdown files from R2.
 *
 * Query:
 *   ?date=YYYY-MM-DD  (defaults to today UTC)
 *
 * Env (Pages project settings):
 *   DATA_BASE_URL          // optional R2 public base URL (defaults to pub CDN)
 *   BRIEF_INDEX_URL / BRIEFS_INDEX_URL // optional URL template returning brief file list
 *
 *   R2 S3-compatible listing (recommended — avoids needing briefs.json manifest):
 *   R2_ACCOUNT_ID          // Cloudflare account ID
 *   R2_BUCKET_NAME         // R2 bucket name (e.g. "slatesim-data")
 *   R2_ACCESS_KEY_ID       // R2 API token access key
 *   R2_SECRET_ACCESS_KEY   // R2 API token secret key
 */

import {
  buildDateForbiddenResponse,
  getDefaultCorsHeaders,
  isDateAllowedForAccess,
  resolveAccessContext,
} from './_access.js';

const DEFAULT_DATA_BASE_URL = 'https://pub-513149f63c494eefba758cd3927e2285.r2.dev';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function compactSlateDate(date) {
  return String(date || '').replace(/-/g, '');
}

function basename(path) {
  return String(path || '').split('/').pop() || '';
}

function isBriefFileForSlate(filename, date) {
  const compactDate = compactSlateDate(date);
  if (!/^\d{8}$/.test(compactDate)) return false;
  const re = new RegExp(`^brief_${compactDate}_\\d{6}_\\d+\\.md$`, 'i');
  return re.test(filename);
}

function toIsoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function toEpochUsOrNull(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return ms * 1000;
}

function decodeXmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function inferTimestampFromFilename(filename, date) {
  const stem = filename.replace(/\.md$/i, '');

  const explicit = stem.match(/^brief_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d{1,6})$/i);
  if (explicit) {
    const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr, microStr] = explicit;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    const second = Number(secondStr);
    const micro = String(microStr).padEnd(6, '0').slice(0, 6);
    const millisecond = Number(micro.slice(0, 3));
    const microRemainder = Number(micro.slice(3));

    const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
    const valid =
      dt.getUTCFullYear() === year &&
      dt.getUTCMonth() === month - 1 &&
      dt.getUTCDate() === day &&
      dt.getUTCHours() === hour &&
      dt.getUTCMinutes() === minute &&
      dt.getUTCSeconds() === second &&
      dt.getUTCMilliseconds() === millisecond;

    if (valid) {
      return { iso: dt.toISOString(), epochUs: dt.getTime() * 1000 + microRemainder };
    }
  }

  const compact = stem.match(/(20\d{2})(\d{2})(\d{2})[T_\-]?(\d{2})(\d{2})(\d{2})?/);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    const iso = `${year}-${month}-${day}T${hour}:${minute}:${second || '00'}.000Z`;
    return { iso, epochUs: toEpochUsOrNull(iso) };
  }

  const dateTime = stem.match(/(20\d{2}-\d{2}-\d{2})[T_\-](\d{2})[:\-]?(\d{2})(?:[:\-]?(\d{2}))?/);
  if (dateTime) {
    const [, day, hour, minute, second] = dateTime;
    const iso = `${day}T${hour}:${minute}:${second || '00'}.000Z`;
    return { iso, epochUs: toEpochUsOrNull(iso) };
  }

  const timeOnly = stem.match(/(?:^|[_-])(\d{2})[:\-]?(\d{2})(?:[:\-]?(\d{2}))?(?:[_-]|$)/);
  if (timeOnly) {
    const [, hour, minute, second] = timeOnly;
    const iso = `${date}T${hour}:${minute}:${second || '00'}.000Z`;
    return { iso, epochUs: toEpochUsOrNull(iso) };
  }

  return null;
}

function uniqueStrings(values) {
  return Array.from(new Set(values));
}

function normalizeManifestFiles(data, date) {
  if (!data) return [];
  const raw = Array.isArray(data)
    ? data
    : Array.isArray(data.files)
      ? data.files
      : Array.isArray(data.entries)
        ? data.entries
        : [];

  return uniqueStrings(
    raw
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return item.filename || item.file || item.path || item.key || '';
        }
        return '';
      })
      .map((name) => basename(String(name).trim()))
      .filter((name) => isBriefFileForSlate(name, date))
  );
}

function sortNewestFirst(entries) {
  return entries.sort((a, b) => {
    const ta = Number.isFinite(a.timestamp_epoch_us) ? a.timestamp_epoch_us : Number.NEGATIVE_INFINITY;
    const tb = Number.isFinite(b.timestamp_epoch_us) ? b.timestamp_epoch_us : Number.NEGATIVE_INFINITY;
    if (ta !== tb) return tb - ta;
    return b.filename.localeCompare(a.filename);
  });
}

// ---------------------------------------------------------------------------
// R2 bucket binding (Workers binding — if configured in Pages settings)
// ---------------------------------------------------------------------------

function detectR2BucketBinding(env) {
  if (!env || typeof env !== 'object') return null;
  for (const value of Object.values(env)) {
    if (
      value &&
      typeof value === 'object' &&
      typeof value.list === 'function' &&
      typeof value.get === 'function'
    ) {
      return value;
    }
  }
  return null;
}

async function listBriefObjectsFromBinding(bucket, date) {
  const compactDate = compactSlateDate(date);
  const prefix = `${date}/brief_${compactDate}_`;
  const out = [];
  let cursor;

  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const obj of page?.objects || []) {
      const filename = basename(obj.key || '');
      if (!isBriefFileForSlate(filename, date)) continue;
      out.push({ key: obj.key, filename, uploaded: obj.uploaded ? new Date(obj.uploaded).toISOString() : null });
    }
    cursor = page?.truncated ? page?.cursor : undefined;
  } while (cursor);

  return out;
}

async function fetchBriefEntryFromBinding(bucket, date, listedObject) {
  const object = await bucket.get(listedObject.key);
  if (!object) return null;
  const content = (await object.text()).trim();
  if (!content) return null;

  const filenameTimestamp = inferTimestampFromFilename(listedObject.filename, date);
  const uploadedIso = toIsoOrNull(listedObject.uploaded);
  const uploadedEpochUs = toEpochUsOrNull(listedObject.uploaded);
  const timestamp = filenameTimestamp?.iso || uploadedIso || null;
  const timestampEpochUs = filenameTimestamp?.epochUs ?? uploadedEpochUs ?? null;

  return { id: `${date}/${listedObject.filename}`, filename: listedObject.filename, timestamp, timestamp_epoch_us: timestampEpochUs, content };
}

// ---------------------------------------------------------------------------
// R2 S3-compatible API listing (signed request — works without bucket binding)
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

async function listBriefFilesFromR2S3Api(accountId, bucketName, accessKeyId, secretAccessKey, date) {
  const compactDate = compactSlateDate(date);
  const prefix = `${date}/brief_${compactDate}_`;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');       // YYYYMMDD
  const amzDate = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'; // YYYYMMDDTHHMMSSz

  // Sorted canonical query string
  const queryParams = new URLSearchParams({
    'list-type': '2',
    'max-keys': '1000',
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

  const canonicalRequest = [
    'GET', canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256Hex(canonicalRequest),
  ].join('\n');

  // Derive signing key
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
      console.warn(`[brief] R2 S3 list returned ${resp.status}`);
      return [];
    }
    const text = await resp.text();
    const keys = Array.from(text.matchAll(/<Key>([^<]+)<\/Key>/g), (m) => decodeXmlEntities(m[1]));
    return uniqueStrings(
      keys
        .filter((k) => k.startsWith(`${date}/`))
        .map((k) => basename(k))
        .filter((name) => isBriefFileForSlate(name, date)),
    );
  } catch (err) {
    console.warn('[brief] R2 S3 list error:', err?.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Manifest / index-URL discovery (public-URL-based, requires briefs.json)
// ---------------------------------------------------------------------------

async function listBriefMarkdownFilesFromManifest(baseUrl, date) {
  const manifestUrls = [
    `${baseUrl}/${date}/briefs.json`,
    `${baseUrl}/${date}/brief-manifest.json`,
    `${baseUrl}/${date}/index.json`,
  ];
  for (const manifestUrl of manifestUrls) {
    try {
      const resp = await fetch(manifestUrl, { cache: 'no-cache' });
      if (!resp.ok) continue;
      const json = await resp.json();
      const files = normalizeManifestFiles(json, date);
      if (files.length > 0) return files;
    } catch {
      // fall through
    }
  }
  return [];
}

function buildIndexUrlCandidates(indexUrlTemplate, date) {
  if (!indexUrlTemplate || typeof indexUrlTemplate !== 'string') return [];
  const trimmed = indexUrlTemplate.trim();
  if (!trimmed) return [];
  if (trimmed.includes('{date}')) return [trimmed.replace('{date}', date)];
  const sep = trimmed.includes('?') ? '&' : '?';
  return [`${trimmed}${sep}date=${encodeURIComponent(date)}`];
}

async function listBriefMarkdownFilesFromIndexUrl(indexUrlTemplate, date) {
  const urls = buildIndexUrlCandidates(indexUrlTemplate, date);
  for (const u of urls) {
    try {
      const resp = await fetch(u, { cache: 'no-cache' });
      if (!resp.ok) continue;
      const text = await resp.text();
      if (!text.trim()) continue;
      try {
        const json = JSON.parse(text);
        const files = normalizeManifestFiles(json, date);
        if (files.length > 0) return files;
      } catch {
        const files = uniqueStrings(
          text
            .split(/\r?\n|,|\s+/)
            .map((v) => basename(v.trim()))
            .filter((name) => isBriefFileForSlate(name, date)),
        );
        if (files.length > 0) return files;
      }
    } catch {
      // fall through
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Public-URL fetch (individual files)
// ---------------------------------------------------------------------------

async function fetchBriefEntry(baseUrl, date, filename) {
  const fileUrl = `${baseUrl}/${date}/${filename}`;
  const resp = await fetch(fileUrl, { cache: 'no-cache' });
  if (!resp.ok) return null;

  const content = (await resp.text()).trim();
  if (!content) return null;

  const headerTimestamp = toIsoOrNull(resp.headers.get('last-modified'));
  const headerEpochUs = toEpochUsOrNull(resp.headers.get('last-modified'));
  const filenameTimestamp = inferTimestampFromFilename(filename, date);
  const timestamp = filenameTimestamp?.iso || headerTimestamp || null;
  const timestampEpochUs = filenameTimestamp?.epochUs ?? headerEpochUs ?? null;

  return { id: `${date}/${filename}`, filename, timestamp, timestamp_epoch_us: timestampEpochUs, content };
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

    // Strategy 1: R2 Workers binding (fastest, zero-latency listing)
    const bindingBucket = detectR2BucketBinding(env);
    if (bindingBucket) {
      try {
        const boundObjects = await listBriefObjectsFromBinding(bindingBucket, date);
        const boundEntries = sortNewestFirst(
          (await Promise.all(boundObjects.map((obj) => fetchBriefEntryFromBinding(bindingBucket, date, obj)))).filter(Boolean),
        );
        if (boundEntries.length > 0) {
          return new Response(
            JSON.stringify({ date, count: boundEntries.length, entries: boundEntries }),
            { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
          );
        }
      } catch (err) {
        console.error('[brief] R2 binding error:', err?.message);
      }
    }

    // Strategy 2: R2 S3-compatible signed listing
    const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
    let discoveredFiles = [];

    if (R2_ACCOUNT_ID && R2_BUCKET_NAME && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
      discoveredFiles = await listBriefFilesFromR2S3Api(
        R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, date,
      );
    }

    // Strategy 3: Custom index URL env var
    if (discoveredFiles.length === 0) {
      discoveredFiles = await listBriefMarkdownFilesFromIndexUrl(
        env.BRIEF_INDEX_URL || env.BRIEFS_INDEX_URL, date,
      );
    }

    // Strategy 4: briefs.json / brief-manifest.json / index.json in R2
    if (discoveredFiles.length === 0) {
      discoveredFiles = await listBriefMarkdownFilesFromManifest(baseUrl, date);
    }

    // Fetch content for all discovered files
    const fetched = await Promise.all(
      discoveredFiles.map((filename) => fetchBriefEntry(baseUrl, date, filename)),
    );
    let entries = sortNewestFirst(fetched.filter(Boolean));

    // Strategy 5: legacy single brief.md fallback
    if (entries.length === 0) {
      const fallback = await fetchBriefEntry(baseUrl, date, 'brief.md');
      if (fallback) entries = [fallback];
    }

    if (entries.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No discoverable brief files for this date', date }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
      );
    }

    return new Response(
      JSON.stringify({ date, count: entries.length, entries }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  } catch (err) {
    console.error('[brief] API error:', err?.message);
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
    );
  }
};

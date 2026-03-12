/**
 * Cloudflare Pages Function: Fetches one or many brief markdown files from R2.
 *
 * Query:
 *   ?date=YYYY-MM-DD  (defaults to today UTC)
 *
 * Env (Pages project settings):
 *   DATA_BASE_URL  // optional R2 base URL (defaults to public CDN)
 */

const DEFAULT_DATA_BASE_URL = 'https://pub-513149f63c494eefba758cd3927e2285.r2.dev';

function compactSlateDate(date) {
  return String(date || '').replace(/-/g, '');
}

function basename(path) {
  return String(path || '').split('/').pop() || '';
}

function isBriefFileForSlate(filename, date) {
  const compactDate = compactSlateDate(date);
  if (!/^\d{8}$/.test(compactDate)) return false;
  // brief_20260312_104918_744007.md
  const re = new RegExp(`^brief_${compactDate}_\\d{6}_\\d+\\.md$`, 'i');
  return re.test(filename);
}

function toIsoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
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

  const explicit = stem.match(/^brief_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})_(\d+)$/i);
  if (explicit) {
    const [, year, month, day, hour, minute, second, frac] = explicit;
    const millis = String(frac).slice(0, 3).padEnd(3, '0');
    return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}Z`;
  }

  const compact = stem.match(/(20\d{2})(\d{2})(\d{2})[T_\-]?(\d{2})(\d{2})(\d{2})?/);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    return `${year}-${month}-${day}T${hour}:${minute}:${second || '00'}.000Z`;
  }

  const dateTime = stem.match(/(20\d{2}-\d{2}-\d{2})[T_\-](\d{2})[:\-]?(\d{2})(?:[:\-]?(\d{2}))?/);
  if (dateTime) {
    const [, day, hour, minute, second] = dateTime;
    return `${day}T${hour}:${minute}:${second || '00'}.000Z`;
  }

  const timeOnly = stem.match(/(?:^|[_-])(\d{2})[:\-]?(\d{2})(?:[:\-]?(\d{2}))?(?:[_-]|$)/);
  if (timeOnly) {
    const [, hour, minute, second] = timeOnly;
    return `${date}T${hour}:${minute}:${second || '00'}.000Z`;
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
    const ta = a.timestamp ? Date.parse(a.timestamp) : Number.NEGATIVE_INFINITY;
    const tb = b.timestamp ? Date.parse(b.timestamp) : Number.NEGATIVE_INFINITY;
    if (ta !== tb) return tb - ta;
    return b.filename.localeCompare(a.filename);
  });
}

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
      // Best effort only; fallback path handled by caller.
    }
  }
  return [];
}

async function listBriefMarkdownFiles(baseUrl, date) {
  const prefix = `${date}/`;
  const listingUrls = [
    `${baseUrl}/?list-type=2&prefix=${encodeURIComponent(prefix)}`,
    `${baseUrl}/?prefix=${encodeURIComponent(prefix)}`,
  ];

  for (const listingUrl of listingUrls) {
    try {
      const resp = await fetch(listingUrl, { cache: 'no-cache' });
      if (!resp.ok) continue;

      const text = await resp.text();
      const keys = Array.from(text.matchAll(/<Key>([^<]+)<\/Key>/g), (m) => decodeXmlEntities(m[1]));
      if (keys.length === 0) continue;

      const files = keys
        .filter((key) => key.startsWith(prefix))
        .map((key) => basename(key.slice(prefix.length)))
        .filter((key) => isBriefFileForSlate(key, date));

      if (files.length > 0) return uniqueStrings(files);
    } catch {
      // Best effort only; fallback path handled by caller.
    }
  }

  return [];
}

async function fetchBriefEntry(baseUrl, date, filename) {
  const fileUrl = `${baseUrl}/${date}/${filename}`;
  const resp = await fetch(fileUrl, { cache: 'no-cache' });
  if (!resp.ok) return null;

  const content = (await resp.text()).trim();
  if (!content) return null;

  const timestamp = toIsoOrNull(resp.headers.get('last-modified')) || inferTimestampFromFilename(filename, date);

  return {
    id: `${date}/${filename}`,
    filename,
    timestamp,
    content,
  };
}

export const onRequest = async ({ request, env }) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders, 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
    });
  }

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const baseUrl = (env.DATA_BASE_URL || DEFAULT_DATA_BASE_URL).replace(/\/$/, '');

    const manifestFiles = await listBriefMarkdownFilesFromManifest(baseUrl, date);
    const discoveredFiles = manifestFiles.length > 0 ? manifestFiles : await listBriefMarkdownFiles(baseUrl, date);
    const filesToFetch = discoveredFiles;
    const fetched = await Promise.all(filesToFetch.map((filename) => fetchBriefEntry(baseUrl, date, filename)));
    const entries = sortNewestFirst(fetched.filter(Boolean));

    if (entries.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No brief_YYYYMMDD_HHMMSS_stamp.md files for this date', date }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }

    return new Response(
      JSON.stringify({
        date,
        count: entries.length,
        entries,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  } catch (err) {
    console.error('Brief API error', err?.message);
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    );
  }
};

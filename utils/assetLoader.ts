import { getPreviousDateStr } from './dateMath';

export interface SlateEcosystemResult {
  ok: boolean;
  data: {
    slate: any | null;
    injuries?: any | null;
    depthCharts?: any | null;
    startingLineups?: any | null;
    history: {
      rotations: any | null;
      boxscores: any | null;
      stats: any | null;
      asOf: string;
    };
  };
  loadedFrom: {
    slate: string;
    injuries: string;
    depthCharts: string;
    startingLineups: string;
    rotations: string;
    boxscores: string;
    stats: string;
  };
  lastModified?: {
    slate?: string;
    injuries?: string;
    rotations?: string;
    boxscores?: string;
    stats?: string;
    latest?: string;
  };
  errors?: {
    slate?: string;
    injuries?: string;
    depthCharts?: string;
    startingLineups?: string;
    rotations?: string;
    boxscores?: string;
    stats?: string;
  };
}

interface LoadSlateEcosystemOptions {
  targetDate: string;
  slateFolder?: string;
  includeHistory?: boolean;
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

interface OptionalFallbackResult {
  data: any | null;
  asOf: string;
  url: string;
  lastModified?: string;
  error?: string;
}

const STARTING_LINEUP_FILENAMES = [
  'nba_starting_lineups.json',
  'lineup.json',
  'lineups.json',
  'starting_lineups.json',
];

const safeJsonParse = (text: string): any => {
  const sanitized = text
    .replace(/\bNaN\b/g, 'null')
    .replace(/\b-?Infinity\b/g, 'null');
  return JSON.parse(sanitized);
};

const INTERNAL_PROJECTIONS_URL = (import.meta as any)?.env?.VITE_PROJECTIONS_ENDPOINT || '/api/projections';
const INTERNAL_DECRYPT_URL = '/api/decrypt';

const fetchOptionalJson = async (
  url: string,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): Promise<{ data: any | null; lastModified?: string; error?: string; status?: number }> => {
  try {
    const res = await fetcher(url, { cache: 'no-cache' });
    if (res.status === 404) return { data: null };
    if (!res.ok) return { data: null, error: `HTTP ${res.status}`, status: res.status };
    const text = await res.text();
    try {
      return { data: safeJsonParse(text), lastModified: res.headers.get('last-modified') || undefined };
    } catch (parseErr: any) {
      return { data: null, error: `Parse error: ${parseErr?.message || 'invalid JSON'}` };
    }
  } catch (e: any) {
    return { data: null, error: e?.message || 'Network error' };
  }
};

const fetchRequiredJson = async (
  url: string,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): Promise<{ ok: boolean; data: any | null; lastModified?: string; error?: string }> => {
  try {
    const res = await fetcher(url, { cache: 'no-cache' });
    if (!res.ok) return { ok: false, data: null, error: `HTTP ${res.status}` };
    const text = await res.text();
    try {
      return { ok: true, data: safeJsonParse(text), lastModified: res.headers.get('last-modified') || undefined };
    } catch (parseErr: any) {
      return { ok: false, data: null, error: `Parse error: ${parseErr?.message || 'invalid JSON'}` };
    }
  } catch (e: any) {
    return { ok: false, data: null, error: e?.message || 'Network error' };
  }
};

const fetchOptionalWithFallback = async (
  targetDate: string,
  filename: string,
  maxLookbackDays = 30,
  options?: {
    slateFolder?: string;
    fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  }
): Promise<OptionalFallbackResult> => {
  // Strip any .json suffix; decrypt endpoint appends internally
  const fileBase = filename.replace(/\.json$/i, '');
  const slateFolder = String(options?.slateFolder || '').trim();
  const firstCheckDate = targetDate;
  let currentDate = firstCheckDate;
  let lastError: string | undefined;
  const fetcher = options?.fetcher || fetch;

  for (let dayOffset = 0; dayOffset < maxLookbackDays; dayOffset += 1) {
    const candidateUrls = slateFolder
      ? [
          `${INTERNAL_DECRYPT_URL}?file=${fileBase}&date=${currentDate}&slate=${encodeURIComponent(slateFolder)}`,
          `${INTERNAL_DECRYPT_URL}?file=${fileBase}&date=${currentDate}`,
        ]
      : [`${INTERNAL_DECRYPT_URL}?file=${fileBase}&date=${currentDate}`];

    for (const url of candidateUrls) {
      const result = await fetchOptionalJson(url, fetcher);

      if (result.data) {
        return {
          data: result.data,
          asOf: currentDate,
          url,
          lastModified: result.lastModified,
        };
      }

      if (result.error) {
        lastError = result.error;
        if (result.status === 403) {
          return {
            data: null,
            asOf: currentDate,
            url,
            error: result.error,
          };
        }
      }
    }

    currentDate = getPreviousDateStr(currentDate, 1);
  }

  const defaultUrl = slateFolder
    ? `${INTERNAL_DECRYPT_URL}?file=${fileBase}&date=${firstCheckDate}&slate=${encodeURIComponent(slateFolder)}`
    : `${INTERNAL_DECRYPT_URL}?file=${fileBase}&date=${firstCheckDate}`;
  return {
    data: null,
    asOf: firstCheckDate,
    url: defaultUrl,
    error: lastError || `No ${filename} found in last ${maxLookbackDays} days`,
  };
};

const fetchOptionalByFilenameCandidates = async (
  targetDate: string,
  filenames: string[],
  maxLookbackDays: number,
  options?: {
    slateFolder?: string;
    fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  }
): Promise<OptionalFallbackResult> => {
  let firstMiss: OptionalFallbackResult | null = null;
  const errors: string[] = [];

  for (const filename of filenames) {
    const result = await fetchOptionalWithFallback(targetDate, filename, maxLookbackDays, options);
    if (result.data) return result;
    if (!firstMiss) firstMiss = result;
    if (result.error) errors.push(`${filename}: ${result.error}`);
  }

  if (firstMiss) {
    return {
      ...firstMiss,
      error: errors.length > 0 ? errors.join(' | ') : firstMiss.error,
    };
  }

  return {
    data: null,
    asOf: targetDate,
    url: '',
    error: 'No candidate filenames provided',
  };
};

const selectLatestModified = (dates: Array<string | undefined>): string | undefined => {
  let latest: { value: string; time: number } | undefined;
  dates.forEach((dateStr) => {
    if (!dateStr) return;
    const time = Date.parse(dateStr);
    if (!Number.isFinite(time)) return;
    if (!latest || time > latest.time) {
      latest = { value: dateStr, time };
    }
  });
  return latest?.value;
};

export const loadSlateEcosystem = async (
  options: LoadSlateEcosystemOptions
): Promise<SlateEcosystemResult> => {
  const targetDate = options.targetDate;
  const slateFolder = options.slateFolder;
  const includeHistory = options.includeHistory !== false;
  const fetcher = options.fetcher || fetch;

  const slateUrl = slateFolder
    ? `${INTERNAL_PROJECTIONS_URL}?date=${targetDate}&slate=${encodeURIComponent(slateFolder)}`
    : `${INTERNAL_PROJECTIONS_URL}?date=${targetDate}`;
  const defaultInjuriesUrl = `${INTERNAL_DECRYPT_URL}?file=injuries&date=${targetDate}`;
  const defaultDepthChartsUrl = `${INTERNAL_DECRYPT_URL}?file=nba_depth_charts&date=${targetDate}`;
  const defaultStartingLineupsUrl = slateFolder
    ? `${INTERNAL_DECRYPT_URL}?file=nba_starting_lineups&date=${targetDate}&slate=${encodeURIComponent(slateFolder)}`
    : `${INTERNAL_DECRYPT_URL}?file=nba_starting_lineups&date=${targetDate}`;
  const defaultRotationsUrl = `${INTERNAL_DECRYPT_URL}?file=rotations&date=${targetDate}`;
  const defaultBoxscoresUrl = `${INTERNAL_DECRYPT_URL}?file=boxscores&date=${targetDate}`;
  const defaultStatsUrl = `${INTERNAL_DECRYPT_URL}?file=stats&date=${targetDate}`;

  const settled = await Promise.allSettled([
    fetchRequiredJson(slateUrl, fetcher),
    fetchOptionalWithFallback(targetDate, 'injuries.json', 30, { fetcher }),
    fetchOptionalWithFallback(targetDate, 'nba_depth_charts.json', 30, { fetcher }),
    fetchOptionalByFilenameCandidates(targetDate, STARTING_LINEUP_FILENAMES, 1, { slateFolder, fetcher }),
    includeHistory ? fetchOptionalWithFallback(targetDate, 'rotations.json', 30, { slateFolder, fetcher }) : Promise.resolve({ data: null, asOf: targetDate, url: defaultRotationsUrl }),
    includeHistory ? fetchOptionalWithFallback(targetDate, 'boxscores.json', 30, { slateFolder, fetcher }) : Promise.resolve({ data: null, asOf: targetDate, url: defaultBoxscoresUrl }),
    fetchOptionalWithFallback(targetDate, 'stats.json', 30, { slateFolder, fetcher }),
  ]);
  const [slateResult, injuriesResult, depthChartsResult, startingLineupsResult, rotationsResult, boxscoresResult, statsResult] = settled;

  const errors: SlateEcosystemResult['errors'] = {};

  const slate = slateResult.status === 'fulfilled' ? slateResult.value : { ok: false, data: null, error: 'Fetch failed' };
  if (!slate.ok) {
    errors.slate = slate.error || 'Failed to load slate.json';
    const failedInjuriesUrl = injuriesResult.status === 'fulfilled'
      ? injuriesResult.value.url
      : defaultInjuriesUrl;
    const failedDepthChartsUrl = depthChartsResult.status === 'fulfilled'
      ? depthChartsResult.value.url
      : defaultDepthChartsUrl;
    const failedStartingLineupsUrl = startingLineupsResult.status === 'fulfilled'
      ? startingLineupsResult.value.url
      : defaultStartingLineupsUrl;
    const failedRotationsUrl = rotationsResult.status === 'fulfilled'
      ? rotationsResult.value.url
      : defaultRotationsUrl;
    const failedBoxscoresUrl = boxscoresResult.status === 'fulfilled'
      ? boxscoresResult.value.url
      : defaultBoxscoresUrl;
    const failedStatsUrl = statsResult.status === 'fulfilled'
      ? statsResult.value.url
      : defaultStatsUrl;
    return {
      ok: false,
      data: {
        slate: null,
        injuries: null,
        depthCharts: null,
        startingLineups: null,
        history: {
          rotations: null,
          boxscores: null,
          stats: null,
          asOf: targetDate,
        },
      },
      loadedFrom: {
        slate: slateUrl,
        injuries: failedInjuriesUrl,
        depthCharts: failedDepthChartsUrl,
        startingLineups: failedStartingLineupsUrl,
        rotations: failedRotationsUrl,
        boxscores: failedBoxscoresUrl,
        stats: failedStatsUrl,
      },
      lastModified: {
        slate: slate.lastModified,
        injuries: injuriesResult.status === 'fulfilled' ? injuriesResult.value.lastModified : undefined,
        depthCharts: depthChartsResult.status === 'fulfilled' ? depthChartsResult.value.lastModified : undefined,
        startingLineups: startingLineupsResult.status === 'fulfilled' ? startingLineupsResult.value.lastModified : undefined,
        rotations: rotationsResult.status === 'fulfilled' ? rotationsResult.value.lastModified : undefined,
        boxscores: boxscoresResult.status === 'fulfilled' ? boxscoresResult.value.lastModified : undefined,
        stats: statsResult.status === 'fulfilled' ? statsResult.value.lastModified : undefined,
        latest: selectLatestModified([
          slate.lastModified,
          injuriesResult.status === 'fulfilled' ? injuriesResult.value.lastModified : undefined,
          depthChartsResult.status === 'fulfilled' ? depthChartsResult.value.lastModified : undefined,
          startingLineupsResult.status === 'fulfilled' ? startingLineupsResult.value.lastModified : undefined,
          rotationsResult.status === 'fulfilled' ? rotationsResult.value.lastModified : undefined,
          boxscoresResult.status === 'fulfilled' ? boxscoresResult.value.lastModified : undefined,
          statsResult.status === 'fulfilled' ? statsResult.value.lastModified : undefined,
        ]),
      },
      errors,
    };
  }

  const injuries = injuriesResult.status === 'fulfilled'
    ? injuriesResult.value
    : {
        data: null,
        asOf: targetDate,
        url: defaultInjuriesUrl,
        error: 'Fetch failed',
      };
  const depthCharts = depthChartsResult.status === 'fulfilled'
    ? depthChartsResult.value
    : {
        data: null,
        asOf: targetDate,
        url: defaultDepthChartsUrl,
        error: 'Fetch failed',
      };
  const startingLineups = startingLineupsResult.status === 'fulfilled'
    ? startingLineupsResult.value
    : {
        data: null,
        asOf: targetDate,
        url: defaultStartingLineupsUrl,
        error: 'Fetch failed',
      };
  const rotations = rotationsResult.status === 'fulfilled'
    ? rotationsResult.value
    : {
        data: null,
        asOf: targetDate,
        url: defaultRotationsUrl,
        error: 'Fetch failed',
      };
  const boxscores = boxscoresResult.status === 'fulfilled'
    ? boxscoresResult.value
    : {
        data: null,
        asOf: targetDate,
        url: defaultBoxscoresUrl,
        error: 'Fetch failed',
      };
  const stats = statsResult.status === 'fulfilled'
    ? statsResult.value
    : {
        data: null,
        asOf: targetDate,
        url: defaultStatsUrl,
        error: 'Fetch failed',
      };

  if (injuries.error) errors.injuries = injuries.error;
  if (depthCharts.error) errors.depthCharts = depthCharts.error;
  if (startingLineups.error) errors.startingLineups = startingLineups.error;
  if (rotations.error) errors.rotations = rotations.error;
  if (boxscores.error) errors.boxscores = boxscores.error;
  if (stats.error) errors.stats = stats.error;

  return {
    ok: true,
    data: {
      slate: slate.data,
      injuries: injuries.data ?? null,
      depthCharts: depthCharts.data ?? null,
      startingLineups: startingLineups.data ?? null,
      history: {
        rotations: rotations.data ?? null,
        boxscores: boxscores.data ?? null,
        stats: stats.data ?? null,
        asOf: rotations.asOf || boxscores.asOf || stats.asOf || targetDate,
      },
    },
    loadedFrom: {
      slate: slateUrl,
      injuries: injuries.url,
      depthCharts: depthCharts.url,
      startingLineups: startingLineups.url,
      rotations: rotations.url,
      boxscores: boxscores.url,
      stats: stats.url,
    },
    lastModified: {
      slate: slate.lastModified,
      injuries: injuries.lastModified,
      depthCharts: depthCharts.lastModified,
      startingLineups: startingLineups.lastModified,
      rotations: rotations.lastModified,
      boxscores: boxscores.lastModified,
      stats: stats.lastModified,
      latest: selectLatestModified([
        slate.lastModified,
        injuries.lastModified,
        depthCharts.lastModified,
        startingLineups.lastModified,
        rotations.lastModified,
        boxscores.lastModified,
        stats.lastModified,
      ]),
    },
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  };
};

// Backward-compatible alias for existing callers.
export const autoLoadReferencePack = async (
  options: LoadSlateEcosystemOptions
): Promise<SlateEcosystemResult> => {
  return loadSlateEcosystem(options);
};

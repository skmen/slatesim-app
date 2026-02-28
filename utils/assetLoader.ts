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
  includeHistory?: boolean;
}

interface OptionalFallbackResult {
  data: any | null;
  asOf: string;
  url: string;
  lastModified?: string;
  error?: string;
}

const safeJsonParse = (text: string): any => {
  const sanitized = text
    .replace(/\bNaN\b/g, 'null')
    .replace(/\b-?Infinity\b/g, 'null');
  return JSON.parse(sanitized);
};

const R2_BASE_URL = 'https://pub-513149f63c494eefba758cd3927e2285.r2.dev';

const fetchOptionalJson = async (url: string): Promise<{ data: any | null; lastModified?: string; error?: string }> => {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.status === 404) return { data: null };
    if (!res.ok) return { data: null, error: `HTTP ${res.status}` };
    const text = await res.text();
    return { data: safeJsonParse(text), lastModified: res.headers.get('last-modified') || undefined };
  } catch (e: any) {
    return { data: null, error: e?.message || 'Network error' };
  }
};

const fetchRequiredJson = async (url: string): Promise<{ ok: boolean; data: any | null; lastModified?: string; error?: string }> => {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return { ok: false, data: null, error: `HTTP ${res.status}` };
    const text = await res.text();
    return { ok: true, data: safeJsonParse(text), lastModified: res.headers.get('last-modified') || undefined };
  } catch (e: any) {
    return { ok: false, data: null, error: e?.message || 'Network error' };
  }
};

const fetchOptionalWithFallback = async (
  targetDate: string,
  filename: string,
  maxLookbackDays = 30
): Promise<OptionalFallbackResult> => {
  const firstCheckDate = targetDate;
  let currentDate = firstCheckDate;
  let lastError: string | undefined;

  for (let dayOffset = 0; dayOffset < maxLookbackDays; dayOffset += 1) {
    const url = `${R2_BASE_URL}/${currentDate}/${filename}`;
    const result = await fetchOptionalJson(url);

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
    }

    currentDate = getPreviousDateStr(currentDate, 1);
  }

  return {
    data: null,
    asOf: firstCheckDate,
    url: `${R2_BASE_URL}/${firstCheckDate}/${filename}`,
    error: lastError || `No ${filename} found in last ${maxLookbackDays} days`,
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
  const includeHistory = options.includeHistory !== false;

  const slateUrl = `${R2_BASE_URL}/${targetDate}/slate.json`;
  const defaultInjuriesUrl = `${R2_BASE_URL}/${targetDate}/injuries.json`;
  const defaultDepthChartsUrl = `${R2_BASE_URL}/${targetDate}/nba_depth_charts.json`;
  const defaultStartingLineupsUrl = `${R2_BASE_URL}/${targetDate}/nba_starting_lineups.json`;
  const defaultRotationsUrl = `${R2_BASE_URL}/${targetDate}/rotations.json`;
  const defaultBoxscoresUrl = `${R2_BASE_URL}/${targetDate}/boxscores.json`;
  const defaultStatsUrl = `${R2_BASE_URL}/${targetDate}/stats.json`;

  const settled = await Promise.allSettled([
    fetchRequiredJson(slateUrl),
    fetchOptionalWithFallback(targetDate, 'injuries.json'),
    fetchOptionalWithFallback(targetDate, 'nba_depth_charts.json'),
    fetchOptionalWithFallback(targetDate, 'nba_starting_lineups.json'),
    includeHistory ? fetchOptionalWithFallback(targetDate, 'rotations.json') : Promise.resolve({ data: null, asOf: targetDate, url: defaultRotationsUrl }),
    includeHistory ? fetchOptionalWithFallback(targetDate, 'boxscores.json') : Promise.resolve({ data: null, asOf: targetDate, url: defaultBoxscoresUrl }),
    fetchOptionalWithFallback(targetDate, 'stats.json'),
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

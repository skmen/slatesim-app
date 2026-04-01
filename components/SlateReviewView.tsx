import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Player } from '../types';
import { buildInjuryLookup, getPlayerInjuryInfo, isDoubtfulInjuryStatus, isOutInjuryStatus } from '../utils/injuries';

type ReviewTab = 'overview' | 'injuries' | 'tier_breakdown';

interface Props {
  selectedDate: string;
  selectedSlate: string | null;
  players: Player[];
}

interface ExposureRow {
  index: number;
  sourceKey?: string;
  playerId?: string;
  playerName?: string;
  team?: string;
  minExposure?: number;
  maxExposure?: number;
  matchedPlayer?: Player;
}

interface InjuryTeamRow {
  team: string;
  totalInjuries: number;
  players: Array<{
    playerId: string;
    playerName: string;
    status: string;
    reason?: string;
  }>;
}

interface TierExposureRow extends ExposureRow {
  tier: string;
}

interface OverviewData {
  slateDate: string;
  gameType?: string;
  projectionSources: string[];
  sourceFiles: string[];
  summary?: string;
}

const getOptimizerSettingsStorageKey = (slateDate?: string): string =>
  `optimizerAdvancedSettings:${slateDate || 'unspecified'}`;

const norm = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const clampPct = (value: number): number => Math.max(0, Math.min(100, value));

const toNumberMaybe = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const normalized = typeof value === 'string' ? value.replace('%', '').trim() : value;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return undefined;
  return clampPct(numeric);
};

const readFirstString = (obj: Record<string, any>, keys: string[]): string | undefined => {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '') {
      return String(obj[key]).trim();
    }
  }
  return undefined;
};

const readFirstNumber = (obj: Record<string, any>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const val = toNumberMaybe(obj[key]);
    if (val !== undefined) return val;
  }
  return undefined;
};

const collectExposureSources = (payload: any): Array<{ sourceKey?: string; value: any }> => {
  if (!payload) return [];

  if (Array.isArray(payload)) {
    return payload.map((value, index) => ({ sourceKey: String(index), value }));
  }

  if (typeof payload !== 'object') return [];

  const arrayKeys = ['exposures', 'exposure', 'players', 'rows', 'items', 'entries', 'data'];
  for (const key of arrayKeys) {
    if (Array.isArray((payload as any)[key])) {
      return (payload as any)[key].map((value: any, index: number) => ({ sourceKey: `${key}[${index}]`, value }));
    }
  }

  return Object.entries(payload).map(([sourceKey, value]) => ({ sourceKey, value }));
};

const parseExposureRows = (
  payload: any,
  players: Player[],
): { rows: ExposureRow[]; unmatchedCount: number } => {
  const byId = new Map(players.map((player) => [String(player.id), player]));
  const byName = new Map<string, Player[]>();
  players.forEach((player) => {
    const key = norm(player.name);
    if (!key) return;
    const current = byName.get(key) ?? [];
    current.push(player);
    byName.set(key, current);
  });

  const rows: ExposureRow[] = [];

  collectExposureSources(payload).forEach(({ sourceKey, value }, index) => {
    if (!value || typeof value !== 'object') return;

    const record = value as Record<string, any>;
    const fallbackName =
      sourceKey && !/^\d+$/.test(sourceKey) && !sourceKey.includes('[')
        ? sourceKey
        : undefined;

    const playerId = readFirstString(record, ['playerId', 'player_id', 'id', 'dkId', 'dk_id']);
    const playerName = readFirstString(record, ['playerName', 'player_name', 'player', 'name', 'full_name']) || fallbackName;
    const team = readFirstString(record, ['team', 'teamAbbrev', 'team_abbrev', 'abbr']);
    const explicitMin = readFirstNumber(record, ['minExposure', 'min_exposure', 'minExp', 'min', 'minPct', 'min_pct']);
    const explicitMax = readFirstNumber(record, ['maxExposure', 'max_exposure', 'maxExp', 'max', 'maxPct', 'max_pct']);
    const target = readFirstNumber(record, ['targetExposure', 'target_exposure', 'exposure', 'target']);
    const minExposure = explicitMin !== undefined ? explicitMin : target;
    const maxExposure = explicitMax !== undefined ? explicitMax : target;

    if (!playerId && !playerName) return;
    if (minExposure === undefined && maxExposure === undefined) return;

    let matchedPlayer: Player | undefined;

    if (playerId && byId.has(String(playerId))) {
      matchedPlayer = byId.get(String(playerId));
    }

    if (!matchedPlayer && playerName) {
      const candidates = byName.get(norm(playerName)) ?? [];
      if (candidates.length === 1) {
        matchedPlayer = candidates[0];
      } else if (candidates.length > 1 && team) {
        matchedPlayer = candidates.find((candidate) => norm(candidate.team) === norm(team));
      } else if (candidates.length > 0) {
        matchedPlayer = candidates[0];
      }
    }

    rows.push({
      index,
      sourceKey,
      playerId,
      playerName,
      team,
      minExposure,
      maxExposure,
      matchedPlayer,
    });
  });

  const unmatchedCount = rows.filter((row) => !row.matchedPlayer).length;
  return { rows, unmatchedCount };
};

const formatLabel = (key: string): string =>
  key
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());

const renderReportValue = (value: any): React.ReactNode => {
  if (value === null || value === undefined) return <span className="text-ink/40">-</span>;

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-ink/80">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink/40">[]</span>;
    const allPrimitive = value.every((item) => item === null || ['string', 'number', 'boolean'].includes(typeof item));
    if (allPrimitive) {
      return (
        <div className="flex flex-wrap gap-1">
          {value.map((item, index) => (
            <span key={index} className="px-1.5 py-0.5 rounded-sm bg-ink/5 border border-ink/10 text-[10px] font-mono text-ink/70">
              {String(item)}
            </span>
          ))}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="rounded-sm border border-ink/10 bg-white/60 p-2">
            {renderReportValue(item)}
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="text-ink/40">{'{}'}</span>;
    return (
      <div className="space-y-1.5">
        {entries.map(([key, nested]) => (
          <div key={key} className="grid grid-cols-[140px_minmax(0,1fr)] gap-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-ink/45">{formatLabel(key)}</div>
            <div className="text-[11px] text-ink/80">{renderReportValue(nested)}</div>
          </div>
        ))}
      </div>
    );
  }

  return <span className="text-ink/50">{String(value)}</span>;
};

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const collectValuesByKeyPredicate = (
  value: unknown,
  predicate: (normalizedKey: string) => boolean,
  maxDepth = 8,
): any[] => {
  const out: any[] = [];
  let visited = 0;

  const walk = (node: unknown, depth: number) => {
    if (node === null || node === undefined) return;
    if (depth > maxDepth) return;
    if (visited > 5000) return;
    visited += 1;

    if (Array.isArray(node)) {
      node.forEach((entry) => walk(entry, depth + 1));
      return;
    }
    if (!isRecord(node)) return;

    Object.entries(node).forEach(([key, child]) => {
      const normalized = norm(key);
      if (predicate(normalized)) out.push(child);
      walk(child, depth + 1);
    });
  };

  walk(value, 0);
  return out;
};

const flattenStrings = (value: unknown, maxDepth = 4): string[] => {
  const out: string[] = [];

  const walk = (node: unknown, depth: number) => {
    if (node === null || node === undefined) return;
    if (depth > maxDepth) return;
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      const text = String(node).trim();
      if (text) out.push(text);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((entry) => walk(entry, depth + 1));
      return;
    }
    if (isRecord(node)) {
      Object.values(node).forEach((entry) => walk(entry, depth + 1));
    }
  };

  walk(value, 0);
  return out;
};

const dedupeStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(value.trim());
  });
  return out;
};

const toTitleCase = (value: string): string =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const normalizeTierName = (value: string): string => {
  const normalized = norm(value);
  if (normalized === 'corechalk') return 'Core Chalk';
  return toTitleCase(value);
};

const inferTierFromKey = (key: string): string | undefined => {
  const cleaned = key.replace(/\[\d+\]/g, '').trim();
  const normalized = norm(cleaned);
  if (!normalized) return undefined;

  const ignored = new Set([
    'exposure',
    'exposures',
    'players',
    'rows',
    'items',
    'entries',
    'data',
    'player',
    'playerid',
    'playername',
    'name',
    'team',
    'minexposure',
    'maxexposure',
    'targetexposure',
    'min',
    'max',
  ]);
  if (ignored.has(normalized)) return undefined;

  if (normalized.includes('corechalk')) return 'Core Chalk';
  if (normalized.includes('chalk')) return 'Chalk';
  if (normalized.includes('contrarian')) return 'Contrarian';
  if (normalized.includes('value')) return 'Value';
  if (normalized.includes('punt')) return 'Punt';
  if (normalized.includes('midrange')) return 'Mid Range';
  if (normalized.includes('stud')) return 'Studs';
  if (normalized.includes('fade')) return 'Fade';
  if (normalized.includes('leverage')) return 'Leverage';
  if (normalized.includes('secondary')) return 'Secondary';
  if (normalized.includes('cash')) return 'Cash';
  if (normalized.includes('gpp')) return 'Gpp';
  if (normalized === 'core') return 'Core';
  if (normalized.includes('tier')) {
    const label = normalizeTierName(cleaned.replace(/tier/gi, '').trim());
    return label || undefined;
  }
  return undefined;
};

const buildOverviewData = (analysisData: any, selectedDate: string, selectedSlate: string | null): OverviewData => {
  const gameTypeCandidates = flattenStrings(
    collectValuesByKeyPredicate(analysisData, (key) =>
      key === 'gametype' ||
      key === 'slatetype' ||
      key === 'contesttype' ||
      (key.includes('game') && key.includes('type')) ||
      (key.includes('slate') && key.includes('type')),
    ),
  ).filter((value) => value.length <= 120);

  const projectionSources = dedupeStrings(
    flattenStrings(
      collectValuesByKeyPredicate(analysisData, (key) =>
        key.includes('projection') && key.includes('source'),
      ),
    ).filter((value) => value.length <= 200),
  );

  const sourceFiles = dedupeStrings(
    flattenStrings(
      collectValuesByKeyPredicate(analysisData, (key) =>
        key.includes('sourcefile') ||
        (key.includes('projection') && key.includes('file')) ||
        key === 'files' ||
        key === 'sourcefiles',
      ),
    ).filter((value) => value.length <= 240),
  );

  const summaryCandidates = dedupeStrings(
    flattenStrings(
      collectValuesByKeyPredicate(analysisData, (key) =>
        key === 'summary' ||
        key === 'slatesummary' ||
        key === 'analysissummary' ||
        key === 'overview' ||
        key === 'notes',
      ),
    ).filter((value) => value.length >= 20),
  );

  const summary = summaryCandidates.length > 0
    ? summaryCandidates.sort((a, b) => b.length - a.length)[0]
    : undefined;

  return {
    slateDate: selectedDate,
    gameType: gameTypeCandidates[0] || selectedSlate || undefined,
    projectionSources,
    sourceFiles,
    summary,
  };
};

const parseTierBreakdownRows = (
  payload: any,
  players: Player[],
): { rows: TierExposureRow[]; tiers: string[]; unmatchedCount: number } => {
  const base = parseExposureRows(payload, players);
  const byId = new Map(players.map((player) => [String(player.id), player]));
  const byName = new Map<string, Player[]>();
  players.forEach((player) => {
    const key = norm(player.name);
    if (!key) return;
    const current = byName.get(key) ?? [];
    current.push(player);
    byName.set(key, current);
  });

  const rows: TierExposureRow[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown, currentTier: string | undefined, path: string, depth: number) => {
    if (node === null || node === undefined) return;
    if (depth > 8) return;

    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, currentTier, `${path}[${index}]`, depth + 1));
      return;
    }
    if (!isRecord(node)) return;

    const record = node as Record<string, any>;
    const explicitTier = readFirstString(record, ['tier', 'tierName', 'tier_name', 'bucket', 'group']);
    const resolvedTier = explicitTier ? normalizeTierName(explicitTier) : currentTier;

    const fallbackName =
      path && !path.endsWith(']') ? path.split('.').pop()?.replace(/\[\d+\]/g, '') : undefined;
    const playerId = readFirstString(record, ['playerId', 'player_id', 'id', 'dkId', 'dk_id']);
    const playerName = readFirstString(record, ['playerName', 'player_name', 'player', 'name', 'full_name']) || fallbackName;
    const team = readFirstString(record, ['team', 'teamAbbrev', 'team_abbrev', 'abbr']);
    const explicitMin = readFirstNumber(record, ['minExposure', 'min_exposure', 'minExp', 'min', 'minPct', 'min_pct']);
    const explicitMax = readFirstNumber(record, ['maxExposure', 'max_exposure', 'maxExp', 'max', 'maxPct', 'max_pct']);
    const target = readFirstNumber(record, ['targetExposure', 'target_exposure', 'exposure', 'target']);
    const minExposure = explicitMin !== undefined ? explicitMin : target;
    const maxExposure = explicitMax !== undefined ? explicitMax : target;

    if ((playerId || playerName) && (minExposure !== undefined || maxExposure !== undefined) && resolvedTier) {
      let matchedPlayer: Player | undefined;
      if (playerId && byId.has(String(playerId))) {
        matchedPlayer = byId.get(String(playerId));
      }
      if (!matchedPlayer && playerName) {
        const candidates = byName.get(norm(playerName)) ?? [];
        if (candidates.length === 1) {
          matchedPlayer = candidates[0];
        } else if (candidates.length > 1 && team) {
          matchedPlayer = candidates.find((candidate) => norm(candidate.team) === norm(team));
        } else if (candidates.length > 0) {
          matchedPlayer = candidates[0];
        }
      }

      const dedupeKey = `${resolvedTier}::${playerId || ''}::${playerName || ''}::${path}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        rows.push({
          index: rows.length,
          sourceKey: path,
          playerId,
          playerName,
          team,
          minExposure,
          maxExposure,
          matchedPlayer,
          tier: resolvedTier,
        });
      }
    }

    Object.entries(record).forEach(([key, child]) => {
      const inferredTier = inferTierFromKey(key);
      visit(child, inferredTier || resolvedTier, path ? `${path}.${key}` : key, depth + 1);
    });
  };

  visit(payload, undefined, '', 0);

  const normalizedRows = rows.length > 0
    ? rows
    : base.rows.map((row, index) => ({
        ...row,
        index,
        tier: 'Uncategorized',
      }));

  const tiers = dedupeStrings(normalizedRows.map((row) => row.tier));
  const unmatchedCount = normalizedRows.filter((row) => !row.matchedPlayer).length;
  return { rows: normalizedRows, tiers, unmatchedCount };
};

export const SlateReviewView: React.FC<Props> = ({ selectedDate, selectedSlate, players }) => {
  const [activeTab, setActiveTab] = useState<ReviewTab>('overview');
  const [analysisData, setAnalysisData] = useState<any | null>(null);
  const [exposureData, setExposureData] = useState<any | null>(null);
  const [injuriesData, setInjuriesData] = useState<any | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [exposureError, setExposureError] = useState<string | null>(null);
  const [injuriesError, setInjuriesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<string>('');
  const [expandedInjuryTeams, setExpandedInjuryTeams] = useState<Set<string>>(new Set());

  const baseUrl = useMemo(() => {
    const env = (import.meta as any).env || {};
    const base = String(
      env.VITE_DATA_BASE_URL ||
      env.VITE_R2_BASE_URL ||
      env.DATA_BASE_URL ||
      '',
    ).trim();
    return base.replace(/\/+$/, '');
  }, []);

  const analysisUrl = useMemo(() => {
    if (!baseUrl || !selectedDate || !selectedSlate) return null;
    return `${baseUrl}/${selectedDate}/${encodeURIComponent(selectedSlate)}/analysis.json`;
  }, [baseUrl, selectedDate, selectedSlate]);

  const exposureUrlCandidates = useMemo(() => {
    if (!baseUrl || !selectedDate || !selectedSlate) return [] as string[];
    const safeSlate = encodeURIComponent(selectedSlate);
    const rawKey = `${selectedDate}/${selectedSlate}/exposure_tiers.json`;
    const encodedKey = encodeURIComponent(rawKey);
    const doubleEncodedKey = encodeURIComponent(encodedKey);
    return [
      `${baseUrl}/${selectedDate}/${safeSlate}/exposure.json`,
      `${baseUrl}/${selectedDate}/${safeSlate}/exposures.json`,
      `${baseUrl}/${selectedDate}/${safeSlate}/exposure_tiers.json`,
      `${baseUrl}/${selectedDate}/${safeSlate}/player_exposure.json`,
      `${baseUrl}/${selectedDate}/${safeSlate}/player_exposures.json`,
      `${baseUrl}/${selectedDate}/exposure.json`,
      `${baseUrl}/${selectedDate}/exposures.json`,
      `${baseUrl}/${selectedDate}/exposure_tiers.json`,
      `${baseUrl}/${encodedKey}`,
      `${baseUrl}/${doubleEncodedKey}`,
    ];
  }, [baseUrl, selectedDate, selectedSlate]);

  const injuriesUrlCandidates = useMemo(() => {
    if (!baseUrl || !selectedDate || !selectedSlate) return [] as string[];
    const safeSlate = encodeURIComponent(selectedSlate);
    return [
      `${baseUrl}/${selectedDate}/${safeSlate}/injuries.json`,
      `${baseUrl}/${selectedDate}/${safeSlate}/injury.json`,
      `${baseUrl}/${selectedDate}/injuries.json`,
      `${baseUrl}/${selectedDate}/injury.json`,
    ];
  }, [baseUrl, selectedDate, selectedSlate]);

  useEffect(() => {
    setApplyMessage(null);
    setExpandedInjuryTeams(new Set());
  }, [selectedDate, selectedSlate]);

  useEffect(() => {
    if (!analysisUrl || exposureUrlCandidates.length === 0 || injuriesUrlCandidates.length === 0) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setAnalysisError(null);
      setExposureError(null);
      setInjuriesError(null);

      const fetchJson = async (url: string): Promise<{ ok: boolean; data?: any; error?: string }> => {
        try {
          const resp = await fetch(url, { cache: 'no-cache' });
          if (!resp.ok) {
            return { ok: false, error: `HTTP ${resp.status}` };
          }
          const text = await resp.text();
          try {
            return { ok: true, data: text ? JSON.parse(text) : null };
          } catch (error: any) {
            return { ok: false, error: `Parse error: ${error?.message || 'invalid JSON'}` };
          }
        } catch (error: any) {
          return { ok: false, error: error?.message || 'Network error' };
        }
      };

      const fetchFirstJson = async (
        urls: string[],
      ): Promise<{ ok: boolean; data?: any; error?: string; url?: string }> => {
        const errors: string[] = [];
        for (const url of urls) {
          const result = await fetchJson(url);
          if (result.ok) return { ok: true, data: result.data, url };
          errors.push(`${url} -> ${result.error || 'error'}`);
          if (!String(result.error || '').startsWith('HTTP 404')) break;
        }
        return {
          ok: false,
          error: errors.length > 0 ? errors.join(' | ') : 'Unable to load JSON',
        };
      };

      const [analysisResult, exposureResult, injuriesResult] = await Promise.all([
        fetchJson(analysisUrl),
        fetchFirstJson(exposureUrlCandidates),
        fetchFirstJson(injuriesUrlCandidates),
      ]);
      if (cancelled) return;

      if (analysisResult.ok) {
        setAnalysisData(analysisResult.data ?? {});
      } else {
        setAnalysisData(null);
        setAnalysisError(analysisResult.error || 'Unable to load analysis.');
      }

      if (exposureResult.ok) {
        setExposureData(exposureResult.data ?? {});
      } else {
        setExposureData(null);
        setExposureError(exposureResult.error || 'Unable to load exposure.');
      }

      if (injuriesResult.ok) {
        setInjuriesData(injuriesResult.data ?? {});
      } else {
        setInjuriesData(null);
        setInjuriesError(injuriesResult.error || 'Unable to load injuries.');
      }

      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [analysisUrl, exposureUrlCandidates, injuriesUrlCandidates]);

  const overviewData = useMemo(
    () => buildOverviewData(analysisData, selectedDate, selectedSlate),
    [analysisData, selectedDate, selectedSlate],
  );

  const tierBreakdown = useMemo(
    () => parseTierBreakdownRows(exposureData, players),
    [exposureData, players],
  );

  const tierOptions = tierBreakdown.tiers;
  const tierRows = useMemo(() => {
    if (!selectedTier) return tierBreakdown.rows;
    return tierBreakdown.rows.filter((row) => row.tier === selectedTier);
  }, [tierBreakdown.rows, selectedTier]);

  useEffect(() => {
    if (tierOptions.length === 0) {
      setSelectedTier('');
      return;
    }
    const preferred = tierOptions.find((tier) => norm(tier) === 'corechalk');
    setSelectedTier((prev) => {
      if (prev && tierOptions.includes(prev)) return prev;
      return preferred || tierOptions[0];
    });
  }, [tierOptions]);

  const injuryTeamRows = useMemo((): InjuryTeamRow[] => {
    if (!injuriesData) return [];
    const lookup = buildInjuryLookup(injuriesData);
    if (!lookup || lookup.size === 0) return [];

    const byTeam = new Map<string, InjuryTeamRow>();
    players.forEach((player) => {
      const info = getPlayerInjuryInfo(player, lookup);
      if (!info) return;

      const team = String(info.team || (player as any).team || 'UNK').toUpperCase();
      const status = String(info.status || 'Questionable').trim() || 'Questionable';
      const reason = info.reason ? String(info.reason).trim() : undefined;

      const current = byTeam.get(team) || { team, totalInjuries: 0, players: [] };
      if (!current.players.some((row) => row.playerId === String(player.id))) {
        current.players.push({
          playerId: String(player.id),
          playerName: String(player.name || player.id),
          status,
          reason,
        });
      }
      current.totalInjuries = current.players.length;
      byTeam.set(team, current);
    });

    const severityRank = (status: string): number => {
      if (isOutInjuryStatus(status)) return 3;
      if (isDoubtfulInjuryStatus(status)) return 2;
      return 1;
    };

    return Array.from(byTeam.values())
      .map((teamRow) => ({
        ...teamRow,
        players: [...teamRow.players].sort((a, b) => {
          const severityDiff = severityRank(b.status) - severityRank(a.status);
          if (severityDiff !== 0) return severityDiff;
          return a.playerName.localeCompare(b.playerName);
        }),
      }))
      .sort((a, b) => {
        if (b.totalInjuries !== a.totalInjuries) return b.totalInjuries - a.totalInjuries;
        return a.team.localeCompare(b.team);
      });
  }, [injuriesData, players]);

  const applyExposures = useCallback(() => {
    if (!selectedDate) {
      setApplyMessage('Missing slate date.');
      return;
    }

    const applicableRows = tierBreakdown.rows.filter((row) =>
      row.matchedPlayer && (row.minExposure !== undefined || row.maxExposure !== undefined),
    );
    if (applicableRows.length === 0) {
      setApplyMessage('No exposure rows could be matched to current slate players.');
      return;
    }

    const storageKey = getOptimizerSettingsStorageKey(selectedDate);
    let parsed: any = {};
    try {
      const raw = localStorage.getItem(storageKey);
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = {};
    }

    const nextOverrides: Record<string, any> = { ...(parsed.playerOverrides || {}) };
    let updatedCount = 0;

    applicableRows.forEach((row) => {
      const player = row.matchedPlayer;
      if (!player) return;
      const current = { ...(nextOverrides[player.id] || {}) };
      const minExposure = row.minExposure !== undefined ? clampPct(row.minExposure) : undefined;
      const maxExposure = row.maxExposure !== undefined ? clampPct(row.maxExposure) : undefined;
      if (minExposure === undefined && maxExposure === undefined) return;

      if (minExposure !== undefined) current.minExposure = minExposure;
      if (maxExposure !== undefined) current.maxExposure = maxExposure;
      if (
        current.minExposure !== undefined &&
        current.maxExposure !== undefined &&
        current.minExposure > current.maxExposure
      ) {
        current.maxExposure = current.minExposure;
      }

      nextOverrides[player.id] = current;
      updatedCount += 1;
    });

    localStorage.setItem(storageKey, JSON.stringify({ ...parsed, playerOverrides: nextOverrides }));
    const unmatchedSuffix = tierBreakdown.unmatchedCount > 0 ? ` (${tierBreakdown.unmatchedCount} unmatched)` : '';
    setApplyMessage(`Applied exposures for ${updatedCount} player(s) to optimizer settings${unmatchedSuffix}.`);
  }, [tierBreakdown.rows, tierBreakdown.unmatchedCount, selectedDate]);

  if (!selectedSlate) {
    return (
      <div className="max-w-5xl mx-auto rounded-sm border border-ink/10 bg-white/55 p-6 text-sm text-ink/70">
        Select a slate to open Slate Review.
      </div>
    );
  }

  if (!baseUrl) {
    return (
      <div className="max-w-5xl mx-auto rounded-sm border border-ink/10 bg-white/55 p-6 text-sm text-ink/70">
        Set <span className="font-mono">VITE_DATA_BASE_URL</span> to enable Slate Review fetches.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-ink/10 bg-white/60 p-4">
        <div className="text-[10px] font-black uppercase tracking-widest text-ink/50">Slate Review</div>
        <div className="mt-1 text-sm text-ink/75">
          {selectedDate} / {selectedSlate}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 rounded-sm text-[10px] font-black uppercase tracking-widest border ${
              activeTab === 'overview'
                ? 'bg-drafting-orange text-white border-drafting-orange'
                : 'bg-white border-ink/20 text-ink/65 hover:border-drafting-orange/40 hover:text-drafting-orange'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('injuries')}
            className={`px-3 py-1.5 rounded-sm text-[10px] font-black uppercase tracking-widest border ${
              activeTab === 'injuries'
                ? 'bg-drafting-orange text-white border-drafting-orange'
                : 'bg-white border-ink/20 text-ink/65 hover:border-drafting-orange/40 hover:text-drafting-orange'
            }`}
          >
            Injuries
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tier_breakdown')}
            className={`px-3 py-1.5 rounded-sm text-[10px] font-black uppercase tracking-widest border ${
              activeTab === 'tier_breakdown'
                ? 'bg-drafting-orange text-white border-drafting-orange'
                : 'bg-white border-ink/20 text-ink/65 hover:border-drafting-orange/40 hover:text-drafting-orange'
            }`}
          >
            Tier Breakdown
          </button>
          {loading && <span className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Loading...</span>}
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="rounded-sm border border-ink/10 bg-white/60 p-4">
          {analysisError ? (
            <div className="text-sm text-red-600 font-semibold">analysis.json error: {analysisError}</div>
          ) : !analysisData ? (
            <div className="text-sm text-ink/50">No analysis data.</div>
          ) : (
            <div className="space-y-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-ink/45">Overview</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-sm border border-ink/10 bg-white/70 p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-ink/45 mb-1">Slate Date</div>
                  <div className="text-sm font-semibold text-ink/85">{overviewData.slateDate}</div>
                </div>
                <div className="rounded-sm border border-ink/10 bg-white/70 p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-ink/45 mb-1">Game Type</div>
                  <div className="text-sm font-semibold text-ink/85">{overviewData.gameType || '-'}</div>
                </div>
                <div className="rounded-sm border border-ink/10 bg-white/70 p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-ink/45 mb-1">Projection Sources</div>
                  {overviewData.projectionSources.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {overviewData.projectionSources.map((source) => (
                        <span key={source} className="px-1.5 py-0.5 rounded-sm bg-ink/5 border border-ink/10 text-[10px] font-mono text-ink/70">
                          {source}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-ink/50">No projection sources found.</div>
                  )}
                </div>
                <div className="rounded-sm border border-ink/10 bg-white/70 p-3">
                  <div className="text-[10px] font-black uppercase tracking-widest text-ink/45 mb-1">Source Files</div>
                  {overviewData.sourceFiles.length > 0 ? (
                    <div className="space-y-1">
                      {overviewData.sourceFiles.map((file) => (
                        <div key={file} className="text-[11px] text-ink/80 font-mono break-all">{file}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-ink/50">No source files found.</div>
                  )}
                </div>
              </div>
              <div className="rounded-sm border border-ink/10 bg-white/70 p-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-ink/45 mb-1">Summary</div>
                {overviewData.summary ? (
                  <div className="text-[12px] text-ink/85 leading-5">{overviewData.summary}</div>
                ) : (
                  <div className="text-[11px] text-ink/50">No summary field found in analysis payload.</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'injuries' && (
        <div className="rounded-sm border border-ink/10 bg-white/60 p-4">
          <div className="text-[10px] font-black uppercase tracking-widest text-ink/45 mb-3">Injuries By Team</div>
          {injuriesError ? (
            <div className="text-sm text-red-600 font-semibold">injuries.json error: {injuriesError}</div>
          ) : injuryTeamRows.length === 0 ? (
            <div className="text-sm text-ink/50">No injuries mapped to current slate players.</div>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-ink/10 bg-white/70">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-ink/5 text-ink/55 uppercase tracking-widest text-[9px] font-black">
                    <th className="text-left px-2 py-1.5">Team</th>
                    <th className="text-right px-2 py-1.5">Total Injuries</th>
                    <th className="text-right px-2 py-1.5">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {injuryTeamRows.map((teamRow) => {
                    const expanded = expandedInjuryTeams.has(teamRow.team);
                    return (
                      <React.Fragment key={teamRow.team}>
                        <tr className="border-t border-ink/10">
                          <td className="px-2 py-1.5 text-ink/85 font-semibold">{teamRow.team}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-ink/80">{teamRow.totalInjuries}</td>
                          <td className="px-2 py-1.5 text-right">
                            <button
                              type="button"
                              className="text-[10px] font-black uppercase tracking-widest text-drafting-orange hover:brightness-110"
                              onClick={() => {
                                setExpandedInjuryTeams((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(teamRow.team)) next.delete(teamRow.team);
                                  else next.add(teamRow.team);
                                  return next;
                                });
                              }}
                            >
                              {expanded ? 'Hide' : 'Expand'}
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-t border-ink/10 bg-ink/5">
                            <td colSpan={3} className="px-2 py-2">
                              <div className="overflow-x-auto rounded-sm border border-ink/10 bg-white">
                                <table className="w-full border-collapse text-[11px]">
                                  <thead>
                                    <tr className="bg-ink/5 text-ink/55 uppercase tracking-widest text-[9px] font-black">
                                      <th className="text-left px-2 py-1.5">Player</th>
                                      <th className="text-left px-2 py-1.5">Status</th>
                                      <th className="text-left px-2 py-1.5">Reason</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {teamRow.players.map((injury) => (
                                      <tr key={`${teamRow.team}_${injury.playerId}`} className="border-t border-ink/10">
                                        <td className="px-2 py-1.5 text-ink/85">{injury.playerName}</td>
                                        <td className="px-2 py-1.5 text-ink/75 font-semibold">{injury.status}</td>
                                        <td className="px-2 py-1.5 text-ink/65">{injury.reason || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'tier_breakdown' && (
        <div className="rounded-sm border border-ink/10 bg-white/60 p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-ink/45">Tier Breakdown</div>
              <select
                value={selectedTier}
                onChange={(e) => setSelectedTier(e.target.value)}
                className="h-8 bg-white border border-ink/20 rounded-sm px-2 text-[11px] font-bold text-ink/80 focus:border-drafting-orange outline-none"
              >
                {tierOptions.map((tier) => (
                  <option key={tier} value={tier}>
                    {tier}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={applyExposures}
              className="px-3 py-1.5 rounded-sm border border-drafting-orange bg-drafting-orange text-white text-[10px] font-black uppercase tracking-widest hover:brightness-110"
            >
              APPLY EXPOSURES
            </button>
          </div>

          {applyMessage && (
            <div className="mb-3 rounded-sm border border-ink/15 bg-white px-2 py-1.5 text-[11px] text-ink/70">
              {applyMessage}
            </div>
          )}

          {exposureError ? (
            <div className="text-sm text-red-600 font-semibold">exposure_tiers error: {exposureError}</div>
          ) : tierRows.length === 0 ? (
            <div className="text-sm text-ink/50">No tier rows available for this slate.</div>
          ) : (
            <div className="overflow-x-auto rounded-sm border border-ink/10 bg-white/70">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-ink/5 text-ink/55 uppercase tracking-widest text-[9px] font-black">
                    <th className="text-left px-2 py-1.5">Player</th>
                    <th className="text-left px-2 py-1.5">Team</th>
                    <th className="text-right px-2 py-1.5">Min %</th>
                    <th className="text-right px-2 py-1.5">Max %</th>
                    <th className="text-left px-2 py-1.5">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {tierRows.map((row) => (
                    <tr key={`${row.tier}_${row.index}_${row.sourceKey || row.playerId || row.playerName}`} className="border-t border-ink/10">
                      <td className="px-2 py-1.5 text-ink/85">
                        {row.playerName || row.playerId || row.sourceKey || `row_${row.index + 1}`}
                      </td>
                      <td className="px-2 py-1.5 text-ink/60">{row.team || '-'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-ink/75">
                        {row.minExposure !== undefined ? row.minExposure.toFixed(1) : '-'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-ink/75">
                        {row.maxExposure !== undefined ? row.maxExposure.toFixed(1) : '-'}
                      </td>
                      <td className="px-2 py-1.5">
                        {row.matchedPlayer ? (
                          <span className="text-green-700 font-semibold">{row.matchedPlayer.name}</span>
                        ) : (
                          <span className="text-red-600 font-semibold">No match</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

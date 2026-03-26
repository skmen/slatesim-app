import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Player } from '../types';

type ReviewTab = 'analysis' | 'exposure';

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

export const SlateReviewView: React.FC<Props> = ({ selectedDate, selectedSlate, players }) => {
  const [activeTab, setActiveTab] = useState<ReviewTab>('analysis');
  const [analysisData, setAnalysisData] = useState<any | null>(null);
  const [exposureData, setExposureData] = useState<any | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [exposureError, setExposureError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);

  const baseUrl = useMemo(() => {
    const env = (import.meta as any).env || {};
    const base = String(
      env.VITE_DATA_BASE_URL ||
      env.VITE_R2_BASE_URL ||
      env.DATA_BASE_URL ||
      ''
    ).trim();
    return base.replace(/\/+$/, '');
  }, []);

  const analysisUrl = useMemo(() => {
    if (!baseUrl || !selectedDate || !selectedSlate) return null;
    return `${baseUrl}/${selectedDate}/${encodeURIComponent(selectedSlate)}/analysis.json`;
  }, [baseUrl, selectedDate, selectedSlate]);

  const exposureUrl = useMemo(() => {
    if (!baseUrl || !selectedDate || !selectedSlate) return null;
    return `${baseUrl}/${selectedDate}/${encodeURIComponent(selectedSlate)}/exposure.json`;
  }, [baseUrl, selectedDate, selectedSlate]);

  useEffect(() => {
    setApplyMessage(null);
  }, [selectedDate, selectedSlate]);

  useEffect(() => {
    if (!analysisUrl || !exposureUrl) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setAnalysisError(null);
      setExposureError(null);

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

      const [analysisResult, exposureResult] = await Promise.all([fetchJson(analysisUrl), fetchJson(exposureUrl)]);
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

      setLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [analysisUrl, exposureUrl]);

  const { rows: exposureRows, unmatchedCount } = useMemo(
    () => parseExposureRows(exposureData, players),
    [exposureData, players]
  );

  const applyExposures = useCallback(() => {
    if (!selectedDate) {
      setApplyMessage('Missing slate date.');
      return;
    }

    const applicableRows = exposureRows.filter((row) => row.matchedPlayer && (row.minExposure !== undefined || row.maxExposure !== undefined));
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

      if (current.minExposure !== undefined && current.maxExposure !== undefined && current.minExposure > current.maxExposure) {
        current.maxExposure = current.minExposure;
      }

      nextOverrides[player.id] = current;
      updatedCount += 1;
    });

    const nextPayload = {
      ...parsed,
      playerOverrides: nextOverrides,
    };
    localStorage.setItem(storageKey, JSON.stringify(nextPayload));

    const unmatchedSuffix = unmatchedCount > 0 ? ` (${unmatchedCount} unmatched)` : '';
    setApplyMessage(`Applied exposures for ${updatedCount} player(s) to optimizer settings${unmatchedSuffix}.`);
  }, [exposureRows, selectedDate, unmatchedCount]);

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
            onClick={() => setActiveTab('analysis')}
            className={`px-3 py-1.5 rounded-sm text-[10px] font-black uppercase tracking-widest border ${
              activeTab === 'analysis'
                ? 'bg-drafting-orange text-white border-drafting-orange'
                : 'bg-white border-ink/20 text-ink/65 hover:border-drafting-orange/40 hover:text-drafting-orange'
            }`}
          >
            Analysis
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('exposure')}
            className={`px-3 py-1.5 rounded-sm text-[10px] font-black uppercase tracking-widest border ${
              activeTab === 'exposure'
                ? 'bg-drafting-orange text-white border-drafting-orange'
                : 'bg-white border-ink/20 text-ink/65 hover:border-drafting-orange/40 hover:text-drafting-orange'
            }`}
          >
            Exposure
          </button>
          {loading && <span className="text-[10px] font-bold uppercase tracking-widest text-ink/40">Loading...</span>}
        </div>
      </div>

      {activeTab === 'analysis' && (
        <div className="rounded-sm border border-ink/10 bg-white/60 p-4">
          {analysisError ? (
            <div className="text-sm text-red-600 font-semibold">analysis.json error: {analysisError}</div>
          ) : !analysisData ? (
            <div className="text-sm text-ink/50">No analysis data.</div>
          ) : (
            <div className="space-y-3">
              <div className="text-[10px] font-black uppercase tracking-widest text-ink/45">Report</div>
              <div className="rounded-sm border border-ink/10 bg-white/70 p-3">
                {renderReportValue(analysisData)}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'exposure' && (
        <div className="rounded-sm border border-ink/10 bg-white/60 p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-ink/45">Exposure Targets</div>
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
            <div className="text-sm text-red-600 font-semibold">exposure.json error: {exposureError}</div>
          ) : exposureRows.length === 0 ? (
            <div className="text-sm text-ink/50">No exposure rows found in exposure.json.</div>
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
                  {exposureRows.map((row) => (
                    <tr key={`${row.index}_${row.sourceKey || row.playerId || row.playerName}`} className="border-t border-ink/10">
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

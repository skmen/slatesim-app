import React, { useEffect, useMemo, useState } from 'react';
import { Player, GameInfo } from '../types';
import { BarChart2, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import highsLoader from 'highs';
import highsWasmUrl from 'highs/runtime?url';
import { PlayerDeepDive } from './PlayerDeepDive';

interface Props {
  players: Player[];
  games: GameInfo[];
  slateDate?: string;
}

interface MatchupDescriptor {
  matchupKey: string;
  teamA: string;
  teamB: string;
  spread: number | null;
  total: number | null;
}

interface PlayerRow {
  id: string;
  name: string;
  position: string;
  player: Player;
  projected: number;
  actual: number | null;
  delta: number | null;
}

interface AccuracySummary {
  sampleSize: number;
  meanErrorRaw: number;
  rmse: number;
  mae: number;
  r2: number;
  topKHitRate: number;
  topPercentilePrecision: number;
  topPercentileRecall: number;
  percentileRankMae: number;
}

interface BestActualLineupEntry {
  slot: string;
  player: Player;
  actual: number;
}

interface BestActualLineupResult {
  entries: BestActualLineupEntry[];
  totalActual: number;
  totalProjected: number;
  totalSalary: number;
}

const SCRIPT_TOP_K = 20;
const SCRIPT_TOP_PERCENTILE = 0.10;
const DK_SLOTS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] as const;
const DK_SALARY_CAP = 50000;
const SLOT_ORDER = new Map<string, number>(DK_SLOTS.map((slot, idx) => [slot, idx]));
let highsModulePromise: Promise<any> | null = null;

const SCRIPT_PASS_WINDOWS = {
  RMSE: { min: 7.0, max: 12.0 },
  MAE: { min: 6.0, max: 10.0 },
  R2: { min: 0.3, max: 0.5 },
  TOP_K_HIT_RATE: { min: 0.20, max: 1.0 },
  TOP_PERCENTILE_PRECISION: { min: 0.18, max: 1.0 },
  TOP_PERCENTILE_RECALL: { min: 0.18, max: 1.0 },
  PERCENTILE_RANK_MAE: { min: 0.0, max: 0.20 },
} as const;

const toNum = (value: any): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

const normKey = (value: string): string => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const readByKeys = (obj: any, keys: string[]): any => {
  if (!obj || typeof obj !== 'object') return undefined;
  const map = new Map<string, string>();
  Object.keys(obj).forEach((k) => map.set(normKey(k), k));
  for (const key of keys) {
    const matched = map.get(normKey(key));
    if (matched) return obj[matched];
  }
  return undefined;
};

const readNumericPlayerValue = (player: Player, keys: string[]): number | undefined => {
  const slateData = (player as any)?.slateData ?? {};
  const slateAdvanced = slateData?.advancedMetrics ?? slateData?.advancedmetrics ?? slateData?.advanced_metrics ?? {};
  const playerAdvanced = (player as any)?.advancedMetrics ?? (player as any)?.advancedmetrics ?? (player as any)?.advanced_metrics ?? {};
  const fromAdvanced = readByKeys(playerAdvanced, keys);
  const fromSlateAdvanced = readByKeys(slateAdvanced, keys);
  const fromSlate = readByKeys(slateData, keys);
  const fromProfile = readByKeys((player as any)?.statsProfile, keys);
  const fromPlayer = readByKeys(player as any, keys);
  const raw = fromAdvanced !== undefined
    ? fromAdvanced
    : (fromSlateAdvanced !== undefined
      ? fromSlateAdvanced
      : (fromSlate !== undefined ? fromSlate : (fromProfile !== undefined ? fromProfile : fromPlayer)));
  if (raw && typeof raw === 'object') {
    const nested = readByKeys(raw, ['value', 'val', 'mean', 'score', 'pct', 'percent', 'prob', 'probability']);
    const nestedNum = Number(typeof nested === 'string' ? nested.replace(/[%,]/g, '') : nested);
    if (Number.isFinite(nestedNum)) return nestedNum;
  }
  const num = Number(typeof raw === 'string' ? raw.replace(/[%,]/g, '') : raw);
  return Number.isFinite(num) ? num : undefined;
};

const normalizePctMaybe = (value: number | undefined): number | undefined => {
  if (!Number.isFinite(Number(value))) return undefined;
  const n = Number(value);
  return n <= 1 ? n * 100 : n;
};

const formatSalaryK = (salary: number): string => {
  if (!Number.isFinite(salary)) return '--';
  return `$${(salary / 1000).toFixed(1)}K`;
};

const parsePositions = (position: string): string[] => {
  return String(position || '')
    .split(/[\/,\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
};

const canFitDK = (player: Player, slot: string): boolean => {
  const pos = parsePositions(player.position);
  switch (slot) {
    case 'PG': return pos.includes('PG');
    case 'SG': return pos.includes('SG');
    case 'SF': return pos.includes('SF');
    case 'PF': return pos.includes('PF');
    case 'C': return pos.includes('C');
    case 'G': return pos.includes('PG') || pos.includes('SG');
    case 'F': return pos.includes('SF') || pos.includes('PF');
    case 'UTIL': return pos.length > 0;
    default: return false;
  }
};

const getHighsModule = async (): Promise<any> => {
  if (!highsModulePromise) {
    highsModulePromise = Promise.resolve(
      highsLoader({
        locateFile: (file: string) => (file.endsWith('.wasm') ? highsWasmUrl : file),
      }),
    );
  }
  return highsModulePromise;
};

const formatCoeff = (value: number): string => {
  const rounded = Math.abs(value) < 1e-10 ? 0 : value;
  const txt = rounded.toFixed(8);
  return txt.replace(/\.?0+$/, '');
};

const formatExpression = (terms: Array<{ varName: string; coeff: number }>): string => {
  const compact = terms.filter((term) => Math.abs(term.coeff) > 1e-10);
  if (compact.length === 0) return '0';

  return compact
    .map((term, idx) => {
      const sign = term.coeff >= 0 ? (idx === 0 ? '' : ' + ') : (idx === 0 ? '- ' : ' - ');
      const absCoeff = Math.abs(term.coeff);
      const coeffText = Math.abs(absCoeff - 1) < 1e-10 ? '' : `${formatCoeff(absCoeff)} `;
      return `${sign}${coeffText}${term.varName}`;
    })
    .join('');
};

const solveBestActualLineup = async (players: Player[]): Promise<BestActualLineupResult | null> => {
  const candidateRows = players
    .map((player) => {
      const actual = getActual(player);
      const salary = Number(player.salary);
      return {
        player,
        actual: actual ?? null,
        salary: Number.isFinite(salary) ? salary : 0,
      };
    })
    .filter((row) => row.actual !== null && row.salary > 0)
    .filter((row) => DK_SLOTS.some((slot) => canFitDK(row.player, slot)));

  if (candidateRows.length < DK_SLOTS.length) return null;

  const assignmentVars: Array<{ name: string; playerIndex: number; slot: string }> = [];
  const varsByPlayer = new Map<number, string[]>();
  const varsBySlot = new Map<string, string[]>();
  DK_SLOTS.forEach((slot) => varsBySlot.set(slot, []));

  candidateRows.forEach((row, playerIndex) => {
    DK_SLOTS.forEach((slot) => {
      if (!canFitDK(row.player, slot)) return;
      const varName = `x_p${playerIndex}_${slot}`;
      assignmentVars.push({ name: varName, playerIndex, slot });
      if (!varsByPlayer.has(playerIndex)) varsByPlayer.set(playerIndex, []);
      varsByPlayer.get(playerIndex)!.push(varName);
      varsBySlot.get(slot)!.push(varName);
    });
  });

  for (const slot of DK_SLOTS) {
    const vars = varsBySlot.get(slot) || [];
    if (vars.length === 0) return null;
  }

  const constraints: string[] = [];
  DK_SLOTS.forEach((slot) => {
    const vars = varsBySlot.get(slot) || [];
    const terms = vars.map((varName) => ({ varName, coeff: 1 }));
    constraints.push(` slot_${slot}: ${formatExpression(terms)} = 1`);
  });

  candidateRows.forEach((_, playerIndex) => {
    const vars = varsByPlayer.get(playerIndex) || [];
    if (vars.length === 0) return;
    const terms = vars.map((varName) => ({ varName, coeff: 1 }));
    constraints.push(` player_${playerIndex}: ${formatExpression(terms)} <= 1`);
  });

  const salaryTerms = assignmentVars.map((variable) => ({
    varName: variable.name,
    coeff: candidateRows[variable.playerIndex].salary,
  }));
  constraints.push(` salary_cap: ${formatExpression(salaryTerms)} <= ${formatCoeff(DK_SALARY_CAP)}`);

  const objectiveTerms = assignmentVars.map((variable) => ({
    varName: variable.name,
    coeff: Number(candidateRows[variable.playerIndex].actual),
  }));

  const lpLines: string[] = [];
  lpLines.push('Maximize');
  lpLines.push(` obj: ${formatExpression(objectiveTerms)}`);
  lpLines.push('Subject To');
  constraints.forEach((line) => lpLines.push(line));
  lpLines.push('Binary');
  assignmentVars.forEach((variable) => lpLines.push(` ${variable.name}`));
  lpLines.push('End');
  const lpText = lpLines.join('\n');

  const highs = await getHighsModule();
  const solution = await highs.solve(lpText);
  const status = String(solution?.Status ?? '').toLowerCase();
  if (status.includes('infeasible') || status.includes('error') || status.includes('unbounded') || status.includes('empty')) {
    return null;
  }

  const columns = solution?.Columns ?? {};
  const selected = assignmentVars
    .map((variable) => ({
      variable,
      value: Number(columns?.[variable.name]?.Primal ?? 0),
    }))
    .filter((entry) => entry.value > 0.5);

  if (selected.length !== DK_SLOTS.length) return null;

  const slotToEntry = new Map<string, BestActualLineupEntry>();
  selected.forEach(({ variable }) => {
    const row = candidateRows[variable.playerIndex];
    slotToEntry.set(variable.slot, {
      slot: variable.slot,
      player: row.player,
      actual: Number(row.actual),
    });
  });

  if (slotToEntry.size !== DK_SLOTS.length) return null;

  const entries = DK_SLOTS
    .map((slot) => slotToEntry.get(slot))
    .filter((entry): entry is BestActualLineupEntry => Boolean(entry))
    .sort((a, b) => (SLOT_ORDER.get(a.slot) ?? 999) - (SLOT_ORDER.get(b.slot) ?? 999));

  const totalSalary = entries.reduce((sum, entry) => sum + (Number(entry.player.salary) || 0), 0);
  const totalProjected = entries.reduce((sum, entry) => sum + getProjected(entry.player), 0);
  const totalActual = entries.reduce((sum, entry) => sum + entry.actual, 0);

  return {
    entries,
    totalSalary,
    totalProjected: Number(totalProjected.toFixed(2)),
    totalActual: Number(totalActual.toFixed(2)),
  };
};

const normalizeTeam = (value: any): string => String(value || '').toUpperCase().trim();

const parseLocalDate = (dateStr?: string): Date | null => {
  const parts = String(dateStr || '').split('-');
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const parsed = new Date(year, month - 1, day);
  if (!Number.isFinite(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const isDateBeforeToday = (dateStr?: string): boolean => {
  const parsed = parseLocalDate(dateStr);
  if (!parsed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed < today;
};

const formatSlateDate = (dateStr?: string): string => {
  const parsed = parseLocalDate(dateStr);
  if (!parsed) return String(dateStr || 'selected date');
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
};

const getProjected = (player: Player): number => {
  const projected = toNum(player.projection) ??
    toNum((player as any).proj) ??
    toNum((player as any).projectedFantasyPoints) ??
    toNum((player as any).projectionFpts);
  return projected ?? 0;
};

const getActual = (player: Player): number | undefined => {
  return toNum(player.actual) ??
    toNum((player as any).actualFpts) ??
    toNum((player as any).actual_fpts) ??
    toNum((player as any).fpts) ??
    toNum((player as any).fantasyPoints);
};

const getOwnershipPct = (player: Player): number | undefined => {
  const direct = toNum(player.ownership);
  if (direct !== undefined) return direct;
  return normalizePctMaybe(readNumericPlayerValue(player, [
    'ownership',
    'OWNERSHIP',
    'ownershipPct',
    'ownership_pct',
    'projectedOwnership',
    'projected_ownership',
    'projOwn',
    'proj_own',
    'own',
  ]));
};

const getUsagePct = (player: Player): number | undefined => {
  const direct = toNum(player.usageRate);
  if (direct !== undefined) return direct;
  return normalizePctMaybe(readNumericPlayerValue(player, [
    'USG_pct',
    'USG%',
    'usageRate',
    'usage_rate',
    'usage',
    'USAGE_PCT',
    'USAGE%',
  ]));
};

const getMinutesProj = (player: Player): number | undefined => {
  const direct = toNum(player.minutesProjection);
  if (direct !== undefined) return direct;
  return readNumericPlayerValue(player, [
    'minutesProjection',
    'minutes_projection',
    'MINUTES_PROJ',
    'minutesProj',
    'minutes_proj',
    'minutes',
    'min',
  ]);
};

const getCeiling = (player: Player): number | undefined => {
  const direct = toNum(player.ceiling);
  if (direct !== undefined) return direct;
  return readNumericPlayerValue(player, [
    'ceiling',
    'CEILING',
    'projectedCeiling',
    'projectionCeiling',
  ]);
};

const getFloor = (player: Player): number | undefined => {
  const direct = toNum(player.floor);
  if (direct !== undefined) return direct;
  return readNumericPlayerValue(player, [
    'floor',
    'FLOOR',
    'projectedFloor',
    'projectionFloor',
  ]);
};

const getLeverageScore = (player: Player): number | undefined => {
  return readNumericPlayerValue(player, [
    'LEVERAGE_SCORE',
    'leverageScore',
    'leverage_score',
    'signalLeverageScore',
    'signal_leverage_score',
  ]);
};

const getBoomPct = (player: Player): number | undefined => {
  return normalizePctMaybe(readNumericPlayerValue(player, [
    'BOOM%',
    'BOOM_PCT',
    'BOOMRATE',
    'BOOM_RATE',
    'boomPct',
    'boom_pct',
    'boomRate',
    'boom_rate',
    'BOOM',
    'boom',
    'boomScore',
    'boom_score',
    'boomProbability',
    'boom_probability',
    'BOOM_PROBABILITY',
    'BOOM_PROB',
    'boomProb',
    'boom_prob',
  ]));
};

const getBustPct = (player: Player): number | undefined => {
  return normalizePctMaybe(readNumericPlayerValue(player, [
    'BUST%',
    'BUST_PCT',
    'BUSTRATE',
    'BUST_RATE',
    'bustPct',
    'bust_pct',
    'bustRate',
    'bust_rate',
    'BUST',
    'bust',
    'bustScore',
    'bust_score',
    'bustProbability',
    'bust_probability',
    'BUST_PROBABILITY',
    'BUST_PROB',
    'bustProb',
    'bust_prob',
  ]));
};

const getValue = (player: Player): number | undefined => {
  const direct = toNum(player.value);
  if (direct !== undefined) return direct;
  const projection = getProjected(player);
  const salary = Number(player.salary);
  if (!Number.isFinite(salary) || salary <= 0) return undefined;
  return projection / (salary / 1000);
};

const getTeamAbbrevMap = (games: GameInfo[]): Map<string, string> => {
  const map = new Map<string, string>();
  games.forEach((game) => {
    const teamAId = String(game?.teamA?.teamId || '').toUpperCase();
    const teamAAbbrev = String(game?.teamA?.abbreviation || '').toUpperCase();
    const teamBId = String(game?.teamB?.teamId || '').toUpperCase();
    const teamBAbbrev = String(game?.teamB?.abbreviation || '').toUpperCase();
    if (teamAId && teamAAbbrev) {
      map.set(teamAId, teamAAbbrev);
      map.set(teamAAbbrev, teamAAbbrev);
    }
    if (teamBId && teamBAbbrev) {
      map.set(teamBId, teamBAbbrev);
      map.set(teamBAbbrev, teamBAbbrev);
    }
  });
  return map;
};

const isFiniteNumber = (value: number): boolean => Number.isFinite(value);

const safePercentileRank = (values: number[]): number[] => {
  if (values.length === 0) return [];
  const indexed = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);

  const ranks = new Array(values.length).fill(0);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) {
      j += 1;
    }
    const avgRank = ((i + 1) + (j + 1)) / 2;
    const pct = avgRank / indexed.length;
    for (let k = i; k <= j; k += 1) {
      ranks[indexed[k].index] = pct;
    }
    i = j + 1;
  }
  return ranks;
};

const topKHitRate = (actual: number[], prediction: number[], k: number): number => {
  const n = Math.min(actual.length, prediction.length);
  if (n <= 0) return Number.NaN;
  const kUse = Math.max(1, Math.min(Math.trunc(k), n));
  const predIdx = Array.from({ length: n }, (_, index) => index)
    .sort((a, b) => prediction[b] - prediction[a])
    .slice(0, kUse);
  const actualIdx = Array.from({ length: n }, (_, index) => index)
    .sort((a, b) => actual[b] - actual[a])
    .slice(0, kUse);
  const actualSet = new Set(actualIdx);
  const overlap = predIdx.filter((idx) => actualSet.has(idx)).length;
  return overlap / kUse;
};

const isMetricPass = (metric: keyof typeof SCRIPT_PASS_WINDOWS, value: number): boolean => {
  if (!isFiniteNumber(value)) return false;
  const { min, max } = SCRIPT_PASS_WINDOWS[metric];
  return value >= min && value <= max;
};

const buildAccuracySummary = (players: Player[]): AccuracySummary | null => {
  const evaluable = players
    .map((player) => {
      const projected = getProjected(player);
      const actual = getActual(player);
      if (actual === undefined) return null;
      return { projected, actual };
    })
    .filter((row): row is { projected: number; actual: number } => row !== null);

  if (evaluable.length === 0) return null;

  const prediction = evaluable.map((row) => row.projected);
  const actual = evaluable.map((row) => row.actual);
  const errors = evaluable.map((row) => row.projected - row.actual);
  const n = evaluable.length;

  const meanErrorRaw = errors.reduce((sum, err) => sum + err, 0) / n;
  const mse = errors.reduce((sum, err) => sum + (err * err), 0) / n;
  const rmse = Math.sqrt(mse);
  const mae = errors.reduce((sum, err) => sum + Math.abs(err), 0) / n;

  const sse = errors.reduce((sum, err) => sum + (err * err), 0);
  const meanActual = actual.reduce((sum, val) => sum + val, 0) / n;
  const sst = actual.reduce((sum, val) => sum + ((val - meanActual) * (val - meanActual)), 0);
  const r2 = sst > 0 ? 1 - (sse / sst) : Number.NaN;

  const topKUse = Math.max(1, Math.min(SCRIPT_TOP_K, n));
  const topPct = Math.max(0.01, Math.min(SCRIPT_TOP_PERCENTILE, 0.5));
  const topKHitRateValue = topKHitRate(actual, prediction, topKUse);

  const predictedPercentileRanks = safePercentileRank(prediction);
  const actualPercentileRanks = safePercentileRank(actual);
  const topMaskThreshold = 1.0 - topPct;
  const predTopMask = predictedPercentileRanks.map((rank) => rank >= topMaskThreshold);
  const actTopMask = actualPercentileRanks.map((rank) => rank >= topMaskThreshold);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (let i = 0; i < n; i += 1) {
    if (predTopMask[i] && actTopMask[i]) tp += 1;
    if (predTopMask[i] && !actTopMask[i]) fp += 1;
    if (!predTopMask[i] && actTopMask[i]) fn += 1;
  }
  const topPercentilePrecision = tp / Math.max(tp + fp, 1);
  const topPercentileRecall = tp / Math.max(tp + fn, 1);

  const percentileRankMae = predictedPercentileRanks
    .map((rank, idx) => Math.abs(rank - actualPercentileRanks[idx]))
    .reduce((sum, diff) => sum + diff, 0) / n;

  return {
    sampleSize: n,
    meanErrorRaw,
    rmse,
    mae,
    r2,
    topKHitRate: topKHitRateValue,
    topPercentilePrecision,
    topPercentileRecall,
    percentileRankMae,
  };
};

const buildMatchups = (games: GameInfo[], players: Player[]): MatchupDescriptor[] => {
  const fromGames = (Array.isArray(games) ? games : [])
    .map((game) => {
      const teamA = normalizeTeam(game?.teamA?.abbreviation || game?.teamA?.teamId);
      const teamB = normalizeTeam(game?.teamB?.abbreviation || game?.teamB?.teamId);
      if (!teamA || !teamB || teamA === teamB) return null;
      return {
        matchupKey: game?.matchupKey || `${teamA}_vs_${teamB}`,
        teamA,
        teamB,
        spread: toNum(game?.spread) ?? null,
        total: toNum(game?.overUnder) ?? null,
      };
    })
    .filter((item): item is MatchupDescriptor => item !== null);

  if (fromGames.length > 0) return fromGames;

  const fallback = new Map<string, MatchupDescriptor>();
  players.forEach((player) => {
    const team = normalizeTeam(player.team);
    const opponent = normalizeTeam(player.opponent);
    if (!team || !opponent || team === opponent) return;
    const [teamA, teamB] = [team, opponent].sort((a, b) => a.localeCompare(b));
    const key = `${teamA}_vs_${teamB}`;
    if (!fallback.has(key)) {
      fallback.set(key, {
        matchupKey: key,
        teamA,
        teamB,
        spread: null,
        total: null,
      });
    }
  });

  return Array.from(fallback.values()).sort((a, b) => a.matchupKey.localeCompare(b.matchupKey));
};

const buildTeamPlayers = (players: Player[]): Map<string, PlayerRow[]> => {
  const teamMap = new Map<string, PlayerRow[]>();

  players.forEach((player, index) => {
    const team = normalizeTeam(player.team);
    if (!team) return;

    const projected = getProjected(player);
    const actualVal = getActual(player);

    if (!teamMap.has(team)) teamMap.set(team, []);
    teamMap.get(team)!.push({
      id: String(player.id || `${team}-${index}`),
      name: String(player.name || 'Unknown'),
      position: String(player.position || '--'),
      player,
      projected,
      actual: actualVal ?? null,
      delta: actualVal !== undefined ? actualVal - projected : null,
    });
  });

  teamMap.forEach((rows) => {
    rows.sort((a, b) => b.projected - a.projected);
  });

  return teamMap;
};

const TeamPlayerTable: React.FC<{ team: string; rows: PlayerRow[]; onPlayerClick: (player: Player) => void }> = ({ team, rows, onPlayerClick }) => {
  return (
    <div className="rounded-lg border border-ink/10 p-3">
      <p className="text-[10px] uppercase tracking-widest text-ink/50 mb-2">{team}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-ink/60">No players loaded for this team.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink/60 border-b border-ink/10">
                <th className="text-left py-1 pr-2">Player</th>
                <th className="text-left py-1 pr-2">Pos</th>
                <th className="text-right py-1 pr-2">Proj</th>
                <th className="text-right py-1 pr-2">Actual</th>
                <th className="text-right py-1">Delta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink/5 last:border-0">
                  <td className="py-1 pr-2 font-semibold text-ink">
                    <button
                      type="button"
                      onClick={() => onPlayerClick(row.player)}
                      className="text-left text-ink hover:text-drafting-orange transition-colors"
                    >
                      {row.name}
                    </button>
                  </td>
                  <td className="py-1 pr-2 text-ink/70">{row.position}</td>
                  <td className="py-1 pr-2 text-right text-ink">{row.projected.toFixed(1)}</td>
                  <td className="py-1 pr-2 text-right text-ink">{row.actual !== null ? row.actual.toFixed(1) : '--'}</td>
                  <td className={`py-1 text-right font-bold ${row.delta === null ? 'text-ink/50' : row.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {row.delta === null ? '--' : `${row.delta >= 0 ? '+' : ''}${row.delta.toFixed(1)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const MetricLabel: React.FC<{ label: string; tooltip: string }> = ({ label, tooltip }) => {
  return (
    <div className="flex items-center gap-1">
      <span>{label}</span>
      <span className="relative inline-flex group">
        <HelpCircle className="w-3.5 h-3.5 text-ink/40" />
        <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-md bg-ink px-2 py-1.5 text-[11px] leading-snug text-vellum opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          {tooltip}
        </span>
      </span>
    </div>
  );
};

const ReportView: React.FC<Props> = ({ players, games, slateDate }) => {
  if (!Array.isArray(players) || !Array.isArray(games)) {
    return (
      <div className="min-h-screen bg-vellum text-ink p-4">
        <p className="text-sm text-ink/70">Report unavailable: no slate data loaded.</p>
      </div>
    );
  }

  const matchups = useMemo(() => buildMatchups(games, players), [games, players]);
  const teamPlayers = useMemo(() => buildTeamPlayers(players), [players]);
  const teamAbbrevMap = useMemo(() => getTeamAbbrevMap(games), [games]);
  const isHistoricalSlate = useMemo(() => isDateBeforeToday(slateDate), [slateDate]);
  const accuracy = useMemo(
    () => (isHistoricalSlate ? buildAccuracySummary(players) : null),
    [players, isHistoricalSlate]
  );
  const [bestActualLineup, setBestActualLineup] = useState<BestActualLineupResult | null>(null);
  const [bestLineupLoading, setBestLineupLoading] = useState(false);
  const [bestLineupError, setBestLineupError] = useState<string | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  const hasAnyActual = useMemo(() => {
    return players.some((player) => getActual(player) !== undefined);
  }, [players]);

  useEffect(() => {
    let cancelled = false;

    if (!isHistoricalSlate || players.length === 0 || !hasAnyActual) {
      setBestActualLineup(null);
      setBestLineupLoading(false);
      setBestLineupError(null);
      return;
    }

    setBestLineupLoading(true);
    setBestLineupError(null);
    setBestActualLineup(null);

    solveBestActualLineup(players)
      .then((result) => {
        if (cancelled) return;
        setBestActualLineup(result);
        if (!result) {
          setBestLineupError('Unable to build a valid best-actual lineup from this slate.');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setBestActualLineup(null);
        setBestLineupError('Failed to run best-lineup optimization on this slate.');
      })
      .finally(() => {
        if (cancelled) return;
        setBestLineupLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [players, isHistoricalSlate, hasAnyActual]);

  const metricRows = useMemo(() => {
    if (!accuracy) return [];
    return [
      {
        key: 'RMSE',
        value: accuracy.rmse,
        formatted: accuracy.rmse.toFixed(4),
        pass: isMetricPass('RMSE', accuracy.rmse),
        tooltip: `Root Mean Squared Error from compute_metrics. Lower is better mathematically. Script PASS window: ${SCRIPT_PASS_WINDOWS.RMSE.min.toFixed(1)}-${SCRIPT_PASS_WINDOWS.RMSE.max.toFixed(1)} (inclusive).`,
      },
      {
        key: 'MAE',
        value: accuracy.mae,
        formatted: accuracy.mae.toFixed(4),
        pass: isMetricPass('MAE', accuracy.mae),
        tooltip: `Mean Absolute Error from compute_metrics; average absolute fantasy-point miss. Lower is better mathematically. Script PASS window: ${SCRIPT_PASS_WINDOWS.MAE.min.toFixed(1)}-${SCRIPT_PASS_WINDOWS.MAE.max.toFixed(1)} (inclusive).`,
      },
      {
        key: 'R2',
        value: accuracy.r2,
        formatted: isFiniteNumber(accuracy.r2) ? accuracy.r2.toFixed(4) : 'NaN',
        pass: isMetricPass('R2', accuracy.r2),
        tooltip: `Coefficient of determination (variance explained). Higher is generally better. Script PASS window: ${SCRIPT_PASS_WINDOWS.R2.min.toFixed(2)}-${SCRIPT_PASS_WINDOWS.R2.max.toFixed(2)} (inclusive).`,
      },
      {
        key: 'TOP_K_HIT_RATE',
        value: accuracy.topKHitRate,
        formatted: accuracy.topKHitRate.toFixed(4),
        pass: isMetricPass('TOP_K_HIT_RATE', accuracy.topKHitRate),
        tooltip: `Overlap between top projected and top actual scorers, using script default top_k=${SCRIPT_TOP_K} (clipped to sample size). Script PASS window: ${SCRIPT_PASS_WINDOWS.TOP_K_HIT_RATE.min.toFixed(2)}-${SCRIPT_PASS_WINDOWS.TOP_K_HIT_RATE.max.toFixed(2)}.`,
      },
      {
        key: 'TOP_PERCENTILE_PRECISION',
        value: accuracy.topPercentilePrecision,
        formatted: accuracy.topPercentilePrecision.toFixed(4),
        pass: isMetricPass('TOP_PERCENTILE_PRECISION', accuracy.topPercentilePrecision),
        tooltip: `Among projected top-${Math.round(SCRIPT_TOP_PERCENTILE * 100)}% players, share who actually finish top-${Math.round(SCRIPT_TOP_PERCENTILE * 100)}%. Script PASS window: ${SCRIPT_PASS_WINDOWS.TOP_PERCENTILE_PRECISION.min.toFixed(2)}-${SCRIPT_PASS_WINDOWS.TOP_PERCENTILE_PRECISION.max.toFixed(2)}.`,
      },
      {
        key: 'TOP_PERCENTILE_RECALL',
        value: accuracy.topPercentileRecall,
        formatted: accuracy.topPercentileRecall.toFixed(4),
        pass: isMetricPass('TOP_PERCENTILE_RECALL', accuracy.topPercentileRecall),
        tooltip: `Among actual top-${Math.round(SCRIPT_TOP_PERCENTILE * 100)}% finishers, share projected in top-${Math.round(SCRIPT_TOP_PERCENTILE * 100)}%. Script PASS window: ${SCRIPT_PASS_WINDOWS.TOP_PERCENTILE_RECALL.min.toFixed(2)}-${SCRIPT_PASS_WINDOWS.TOP_PERCENTILE_RECALL.max.toFixed(2)}.`,
      },
      {
        key: 'PERCENTILE_RANK_MAE',
        value: accuracy.percentileRankMae,
        formatted: accuracy.percentileRankMae.toFixed(4),
        pass: isMetricPass('PERCENTILE_RANK_MAE', accuracy.percentileRankMae),
        tooltip: `Mean absolute difference between projection percentile rank and actual percentile rank, using pandas-style percentile rank with average tie handling. Script PASS window: ${SCRIPT_PASS_WINDOWS.PERCENTILE_RANK_MAE.min.toFixed(2)}-${SCRIPT_PASS_WINDOWS.PERCENTILE_RANK_MAE.max.toFixed(2)}.`,
      },
    ];
  }, [accuracy]);

  const allPass = metricRows.length > 0 && metricRows.every((metric) => metric.pass);
  const displayedDate = slateDate || new Date().toISOString().split('T')[0];
  const displayedDateLabel = useMemo(() => formatSlateDate(slateDate || displayedDate), [slateDate, displayedDate]);

  const matchupRows = useMemo(() => {
    return matchups
      .map((matchup) => ({
        ...matchup,
        teamAPlayers: teamPlayers.get(matchup.teamA) || [],
        teamBPlayers: teamPlayers.get(matchup.teamB) || [],
      }))
      .filter((row) => row.teamAPlayers.length > 0 || row.teamBPlayers.length > 0);
  }, [matchups, teamPlayers]);

  const standaloneTeams = useMemo(() => {
    if (matchupRows.length > 0) return [] as Array<{ team: string; rows: PlayerRow[] }>;
    return Array.from(teamPlayers.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([team, rows]) => ({ team, rows }));
  }, [matchupRows.length, teamPlayers]);

  return (
    <div className="min-h-screen bg-vellum text-ink p-4 space-y-6">
      <div className="flex items-center gap-3">
        <BarChart2 className="w-5 h-5 text-drafting-orange" />
        <h1 className="text-xl font-black uppercase tracking-widest">Projection vs Actual Report</h1>
      </div>
      <p className="text-sm text-ink/70 max-w-3xl">
        Player-level projection vs actual by team. Team-total metrics have been removed.
      </p>

      {!isHistoricalSlate && (
        <div className="bg-white rounded-xl border border-ink/10 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <p className="text-sm font-bold text-ink">Report Unavailable</p>
          </div>
          <p className="text-sm text-ink/70">
            Report data is unavailable for {displayedDateLabel}. Projections accuracy and player-level actual results are shown only after the slate date has passed.
          </p>
        </div>
      )}

      {isHistoricalSlate && (
        <>
      <div className="bg-white rounded-xl border border-ink/10 shadow-sm p-4 space-y-3">
        <div className="flex items-center gap-2">
          {allPass ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          )}
          <p className="text-sm font-bold text-ink">Projections Accuracy Summary</p>
        </div>
        {accuracy ? (
          <>
            <div className="text-sm text-ink">
              <span className="font-semibold">{displayedDate}</span>
              <span className="text-ink/70"> - </span>
              <span className="inline-flex items-center">
                <MetricLabel
                  label="Mean Error (Raw)"
                  tooltip="Average signed error (projection - actual), matching compute_metrics MEAN_ERROR. Positive means over-projection bias; negative means under-projection bias. The script prints this value but does not apply a PASS/FAIL threshold."
                />
              </span>
              <span className="text-ink/70">: </span>
              <span className="font-black">{accuracy.meanErrorRaw.toFixed(4)}</span>
              <span className="text-ink/60 ml-2">(n={accuracy.sampleSize})</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
              {metricRows.map((metric) => (
                <div key={metric.key} className="rounded-lg border border-ink/10 px-3 py-2 text-xs">
                  <div className="text-ink/60 uppercase tracking-wider mb-1">
                    <MetricLabel label={metric.key} tooltip={metric.tooltip} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black text-ink">{metric.formatted}</span>
                    <span className={metric.pass ? 'font-bold text-emerald-600' : 'font-bold text-red-600'}>
                      [{metric.pass ? 'PASS' : 'FAIL'}]
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-ink/70">
            Accuracy metrics will appear once enough players have both projection and actual fantasy points.
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-ink/10 shadow-sm p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-ink">Best Possible Lineup (Actuals)</p>
          {bestActualLineup && (
            <p className="text-[11px] text-ink/60">
              Salary {formatSalaryK(bestActualLineup.totalSalary)} | Proj {bestActualLineup.totalProjected.toFixed(2)} | Actual {bestActualLineup.totalActual.toFixed(2)}
            </p>
          )}
        </div>

        {!hasAnyActual && (
          <p className="text-sm text-ink/70">
            Actual fantasy points are required to compute the best possible lineup.
          </p>
        )}

        {hasAnyActual && bestLineupLoading && (
          <p className="text-sm text-ink/70">Computing best possible lineup...</p>
        )}

        {hasAnyActual && !bestLineupLoading && bestLineupError && (
          <p className="text-sm text-red-600">{bestLineupError}</p>
        )}

        {hasAnyActual && !bestLineupLoading && bestActualLineup && (
          <div className="overflow-x-auto border border-ink/10 rounded-sm">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-[9px] font-black text-ink/40 uppercase tracking-widest border-b border-ink/10 bg-white/40">
                  <th className="px-3 py-2 text-left">Player</th>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-3 py-2 text-left">OPP</th>
                  <th className="px-3 py-2 text-left">Pos</th>
                  <th className="px-3 py-2 text-right">Salary</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-right">Own</th>
                  <th className="px-3 py-2 text-right">Usage</th>
                  <th className="px-3 py-2 text-right">Min</th>
                  <th className="px-3 py-2 text-right">Proj</th>
                  <th className="px-3 py-2 text-right">Actual</th>
                  <th className="px-3 py-2 text-right">Ceiling</th>
                  <th className="px-3 py-2 text-right">Floor</th>
                  <th className="px-3 py-2 text-right">Lev Score</th>
                  <th className="px-3 py-2 text-right">Boom</th>
                  <th className="px-3 py-2 text-right">Bust</th>
                </tr>
              </thead>
              <tbody className="text-[13px] font-mono">
                {bestActualLineup.entries.map((entry) => {
                  const player = entry.player;
                  const team = String(player.team || '').toUpperCase();
                  const opponentRaw = String(player.opponent || '').toUpperCase();
                  const opponent = (teamAbbrevMap.get(opponentRaw) || opponentRaw || '--').toUpperCase();
                  const value = getValue(player);
                  const ownership = getOwnershipPct(player);
                  const usage = getUsagePct(player);
                  const minutes = getMinutesProj(player);
                  const ceiling = getCeiling(player);
                  const floor = getFloor(player);
                  const leverageScore = getLeverageScore(player);
                  const boomPct = getBoomPct(player);
                  const bustPct = getBustPct(player);
                  const projected = getProjected(player);

                  return (
                    <tr key={`${entry.slot}-${player.id}`} className="border-b border-ink/5 last:border-0">
                      <td className="px-3 py-2 font-black uppercase tracking-tight text-ink">
                        <span className="text-[10px] text-ink/40 mr-1">{entry.slot}</span>
                        <button
                          type="button"
                          onClick={() => setSelectedPlayer(player)}
                          className="text-left hover:text-drafting-orange transition-colors"
                        >
                          {player.name}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-ink/60">{team || '--'}</td>
                      <td className="px-3 py-2 text-ink/60">{opponent}</td>
                      <td className="px-3 py-2 text-ink/60">{player.position || '--'}</td>
                      <td className="px-3 py-2 text-right text-ink/60">{formatSalaryK(Number(player.salary))}</td>
                      <td className="px-3 py-2 text-right text-ink/60">{value !== undefined ? value.toFixed(2) : '--'}</td>
                      <td className="px-3 py-2 text-right text-ink/60">{ownership !== undefined ? `${ownership.toFixed(1)}%` : '--'}</td>
                      <td className="px-3 py-2 text-right text-ink/60">{usage !== undefined ? `${usage.toFixed(1)}%` : '--'}</td>
                      <td className="px-3 py-2 text-right text-ink/60">{minutes !== undefined ? minutes.toFixed(1) : '--'}</td>
                      <td className="px-3 py-2 text-right font-black text-drafting-orange">{projected.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-black text-emerald-600">{entry.actual.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-ink/60">{ceiling !== undefined ? ceiling.toFixed(2) : '--'}</td>
                      <td className="px-3 py-2 text-right text-ink/60">{floor !== undefined ? floor.toFixed(2) : '--'}</td>
                      <td className="px-3 py-2 text-right text-ink/60">{leverageScore !== undefined ? leverageScore.toFixed(2) : '--'}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">{boomPct !== undefined ? `${boomPct.toFixed(1)}%` : '--'}</td>
                      <td className="px-3 py-2 text-right text-red-600">{bustPct !== undefined ? `${bustPct.toFixed(1)}%` : '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!hasAnyActual && players.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Actual fantasy points are not available yet for this slate date.
        </div>
      )}

      {matchupRows.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {matchupRows.map((row) => (
            <div key={row.matchupKey} className="bg-white rounded-xl border border-ink/10 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-ink">{row.teamA} @ {row.teamB}</p>
                {(row.spread !== null || row.total !== null) && (
                  <p className="text-[11px] text-ink/60">
                    Vegas: {row.spread !== null ? `Spread ${row.spread.toFixed(1)}` : '--'} {row.total !== null ? `| O/U ${row.total.toFixed(1)}` : ''}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                <TeamPlayerTable team={row.teamA} rows={row.teamAPlayers} onPlayerClick={setSelectedPlayer} />
                <TeamPlayerTable team={row.teamB} rows={row.teamBPlayers} onPlayerClick={setSelectedPlayer} />
              </div>
            </div>
          ))}
        </div>
      )}

      {matchupRows.length === 0 && standaloneTeams.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {standaloneTeams.map((teamCard) => (
            <div key={teamCard.team} className="bg-white rounded-xl border border-ink/10 shadow-sm p-4">
              <TeamPlayerTable team={teamCard.team} rows={teamCard.rows} onPlayerClick={setSelectedPlayer} />
            </div>
          ))}
        </div>
      )}

      {players.length === 0 && (
        <div className="p-4 bg-white border border-ink/10 rounded-xl text-ink/70">
          No players loaded for this slate. Load projections to view the report.
        </div>
      )}
        </>
      )}

      {selectedPlayer && (
        <PlayerDeepDive
          player={selectedPlayer}
          players={players}
          games={games}
          onClose={() => setSelectedPlayer(null)}
          isHistorical={isHistoricalSlate}
          showActuals={isHistoricalSlate}
        />
      )}
    </div>
  );
};

export default ReportView;

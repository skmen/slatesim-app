import React, { useEffect, useMemo, useState } from 'react';
import { Player, GameInfo } from '../types';
import { BarChart2, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import highsLoader from 'highs';
import highsWasmUrl from 'highs/runtime?url';
import { PlayerDeepDive } from './PlayerDeepDive';
import { calculateValueScore } from '../utils/valueScore';
import {
  Cell, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LabelList,
} from 'recharts';

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

interface TeamFptsDistributionPoint {
  id: string;
  name: string;
  fpts: number;
}

interface TeamFptsTotalRow {
  team: string;
  total: number;
  average: number;
  median: number;
  min: number;
  max: number;
  playerCount: number;
  distribution: TeamFptsDistributionPoint[];
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

const CHART_COLORS = [
  '#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b',
  '#ec4899', '#06b6d4', '#84cc16', '#ef4444', '#a78bfa',
  '#fb923c', '#34d399', '#60a5fa', '#f472b6', '#fbbf24',
];

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

const getMedian = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 !== 0) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
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

const TEAM_TABLE_COLS = 11;

const NBA_TEAM_FULL_NAMES: Record<string, string> = {
  ATL: 'Atlanta Hawks', BOS: 'Boston Celtics', BKN: 'Brooklyn Nets',
  CHA: 'Charlotte Hornets', CHI: 'Chicago Bulls', CLE: 'Cleveland Cavaliers',
  DAL: 'Dallas Mavericks', DEN: 'Denver Nuggets', DET: 'Detroit Pistons',
  GSW: 'Golden State Warriors', HOU: 'Houston Rockets', IND: 'Indiana Pacers',
  LAC: 'LA Clippers', LAL: 'LA Lakers', MEM: 'Memphis Grizzlies',
  MIA: 'Miami Heat', MIL: 'Milwaukee Bucks', MIN: 'Minnesota Timberwolves',
  NOP: 'New Orleans Pelicans', NYK: 'New York Knicks', OKC: 'Oklahoma City Thunder',
  ORL: 'Orlando Magic', PHI: 'Philadelphia 76ers', PHX: 'Phoenix Suns',
  POR: 'Portland Trail Blazers', SAC: 'Sacramento Kings', SAS: 'San Antonio Spurs',
  TOR: 'Toronto Raptors', UTA: 'Utah Jazz', WAS: 'Washington Wizards',
};

type TeamTableSortKey = 'name' | 'position' | 'salary' | 'minutes' | 'usage' | 'projected' | 'actual' | 'eff' | 'delta' | 'boom' | 'bust';
interface TeamTableSortConfig { key: TeamTableSortKey; dir: 'asc' | 'desc' }

const getTeamRowSortValue = (row: PlayerRow, key: TeamTableSortKey): number | string => {
  switch (key) {
    case 'name': return row.name;
    case 'position': return row.position;
    case 'salary': return Number(row.player.salary) || -Infinity;
    case 'minutes': return getMinutesProj(row.player) ?? -Infinity;
    case 'usage': return getUsagePct(row.player) ?? -Infinity;
    case 'projected': return row.projected;
    case 'actual': return row.actual ?? -Infinity;
    case 'eff': {
      const s = Number(row.player.salary);
      return (row.actual !== null && Number.isFinite(s) && s > 0) ? row.actual / (s / 1000) : -Infinity;
    }
    case 'delta': return row.delta ?? -Infinity;
    case 'boom': return getBoomPct(row.player) ?? -Infinity;
    case 'bust': return getBustPct(row.player) ?? -Infinity;
    default: return row.projected;
  }
};

const sortTeamRows = (rows: PlayerRow[], sort: TeamTableSortConfig): PlayerRow[] =>
  [...rows].sort((a, b) => {
    const av = getTeamRowSortValue(a, sort.key);
    const bv = getTeamRowSortValue(b, sort.key);
    const cmp = typeof av === 'string' && typeof bv === 'string'
      ? av.localeCompare(bv)
      : Number(av) - Number(bv);
    return sort.dir === 'asc' ? cmp : -cmp;
  });

const TeamTableHeader: React.FC<{ sort: TeamTableSortConfig; onSort: (key: TeamTableSortKey) => void }> = ({ sort, onSort }) => {
  const th = (key: TeamTableSortKey, label: string, align: 'left' | 'right' = 'right') => {
    const active = sort.key === key;
    return (
      <th
        key={key}
        onClick={() => onSort(key)}
        className={`px-3 py-2 text-${align} cursor-pointer select-none whitespace-nowrap transition-colors ${active ? 'text-drafting-orange' : 'text-ink/40 hover:text-ink/70'}`}
      >
        {label}{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
      </th>
    );
  };
  return (
    <tr className="text-[10px] font-black uppercase tracking-widest border-b border-ink/10">
      {th('name', 'Player', 'left')}
      {th('position', 'Pos', 'left')}
      {th('salary', 'Salary')}
      {th('minutes', 'Min')}
      {th('usage', 'Usage')}
      {th('projected', 'Proj')}
      {th('actual', 'Actual')}
      {th('eff', 'EFF')}
      {th('delta', 'Delta')}
      {th('boom', 'Boom')}
      {th('bust', 'Bust')}
    </tr>
  );
};

const TeamTableRows: React.FC<{ team: string; rows: PlayerRow[]; onPlayerClick: (player: Player) => void }> = ({ team, rows, onPlayerClick }) => (
  <>
    <tr className="bg-ink">
      <td colSpan={TEAM_TABLE_COLS} className="px-3 py-2 text-[11px] font-black uppercase tracking-widest text-white">
        {NBA_TEAM_FULL_NAMES[team] || team}
      </td>
    </tr>
    {rows.length === 0 ? (
      <tr>
        <td colSpan={TEAM_TABLE_COLS} className="px-3 py-2 text-xs text-ink/60 italic">No players loaded for {team}.</td>
      </tr>
    ) : rows.map((row) => {
      const salary = Number(row.player.salary);
      const usage = getUsagePct(row.player);
      const minutes = getMinutesProj(row.player);
      const boomPct = getBoomPct(row.player);
      const bustPct = getBustPct(row.player);
      const eff = (row.actual !== null && Number.isFinite(salary) && salary > 0)
        ? row.actual / (salary / 1000)
        : null;
      return (
        <tr key={row.id} className="border-b border-ink/5 last:border-0 hover:bg-ink/[0.02]">
          <td className="px-3 py-1.5 font-semibold text-ink max-w-[130px] truncate">
            <button type="button" onClick={() => onPlayerClick(row.player)} className="text-left hover:text-drafting-orange transition-colors truncate">{row.name}</button>
          </td>
          <td className="px-3 py-1.5 text-ink/60">{row.position}</td>
          <td className="px-3 py-1.5 text-right text-ink/60">{Number.isFinite(salary) && salary > 0 ? formatSalaryK(salary) : '--'}</td>
          <td className="px-3 py-1.5 text-right text-ink/60">{minutes !== undefined ? minutes.toFixed(1) : '--'}</td>
          <td className="px-3 py-1.5 text-right text-ink/60">{usage !== undefined ? `${usage.toFixed(1)}%` : '--'}</td>
          <td className="px-3 py-1.5 text-right text-ink">{row.projected.toFixed(1)}</td>
          <td className="px-3 py-1.5 text-right text-ink">{row.actual !== null ? row.actual.toFixed(1) : '--'}</td>
          <td className={`px-3 py-1.5 text-right font-bold ${eff !== null ? (eff >= 4 ? 'text-emerald-600' : eff >= 2.5 ? 'text-ink' : 'text-red-500') : 'text-ink/40'}`}>
            {eff !== null ? `${eff.toFixed(1)}x` : '--'}
          </td>
          <td className={`px-3 py-1.5 text-right font-bold ${row.delta === null ? 'text-ink/40' : row.delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {row.delta === null ? '--' : `${row.delta >= 0 ? '+' : ''}${row.delta.toFixed(1)}`}
          </td>
          <td className="px-3 py-1.5 text-right text-emerald-600">{boomPct !== undefined ? `${boomPct.toFixed(0)}%` : '--'}</td>
          <td className="px-3 py-1.5 text-right text-red-500">{bustPct !== undefined ? `${bustPct.toFixed(0)}%` : '--'}</td>
        </tr>
      );
    })}
  </>
);

const MatchupTable: React.FC<{ teamA: string; teamB: string; teamARows: PlayerRow[]; teamBRows: PlayerRow[]; onPlayerClick: (player: Player) => void; sort: TeamTableSortConfig; onSort: (key: TeamTableSortKey) => void }> = ({ teamA, teamB, teamARows, teamBRows, onPlayerClick, sort, onSort }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-xs border-collapse">
      <thead><TeamTableHeader sort={sort} onSort={onSort} /></thead>
      <tbody className="font-mono">
        <TeamTableRows team={teamA} rows={sortTeamRows(teamARows, sort)} onPlayerClick={onPlayerClick} />
        <TeamTableRows team={teamB} rows={sortTeamRows(teamBRows, sort)} onPlayerClick={onPlayerClick} />
      </tbody>
    </table>
  </div>
);

const TeamFptsTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as TeamFptsTotalRow | undefined;
  if (!row) return null;

  return (
    <div className="rounded-md border border-ink/15 bg-white/95 px-4 py-3 shadow-md text-[11px] min-w-[320px] max-w-[420px] max-h-[65vh]">
      <p className="font-black text-ink uppercase tracking-wide">{row.team}</p>
      <div className="mt-1 text-ink/70 space-y-0.5">
        <p>Total: <span className="font-bold text-ink">{row.total.toFixed(1)} FPTS</span></p>
        <p>Players: <span className="font-bold text-ink">{row.playerCount}</span></p>
        <p>Avg / Median: <span className="font-bold text-ink">{row.average.toFixed(1)} / {row.median.toFixed(1)}</span></p>
        <p>Range: <span className="font-bold text-ink">{row.min.toFixed(1)} to {row.max.toFixed(1)}</span></p>
      </div>
      <div className="mt-2 border-t border-ink/10 pt-1">
        <p className="text-[10px] uppercase tracking-wider text-ink/50 mb-1">FPTS Distribution</p>
        <div className="max-h-[42vh] overflow-y-auto pr-1 space-y-0.5">
          {row.distribution.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-3">
              <span className="truncate text-ink/70">{entry.name}</span>
              <span className="font-mono font-bold text-ink">{entry.fpts.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>
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
  const [activeMatchupTab, setActiveMatchupTab] = useState(0);
  const [teamTableSort, setTeamTableSort] = useState<TeamTableSortConfig>({ key: 'projected', dir: 'desc' });
  const handleTeamTableSort = (key: TeamTableSortKey) => {
    setTeamTableSort((prev) => ({ key, dir: prev.key === key ? (prev.dir === 'asc' ? 'desc' : 'asc') : 'desc' }));
  };

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
        tooltip: `How far off our projections were on average, but big misses count more than small ones. Think of it as a "penalty-weighted" average miss in fantasy points. Lower is better. Sweet spot: ${SCRIPT_PASS_WINDOWS.RMSE.min.toFixed(1)}–${SCRIPT_PASS_WINDOWS.RMSE.max.toFixed(1)} pts.`,
      },
      {
        key: 'MAE',
        value: accuracy.mae,
        formatted: accuracy.mae.toFixed(4),
        pass: isMetricPass('MAE', accuracy.mae),
        tooltip: `The plain average of how many fantasy points we missed by — if MAE is 8, we were off by 8 FPTS on average across all players. Lower is better. Sweet spot: ${SCRIPT_PASS_WINDOWS.MAE.min.toFixed(1)}–${SCRIPT_PASS_WINDOWS.MAE.max.toFixed(1)} pts.`,
      },
      {
        key: 'R2',
        value: accuracy.r2,
        formatted: isFiniteNumber(accuracy.r2) ? accuracy.r2.toFixed(4) : 'NaN',
        pass: isMetricPass('R2', accuracy.r2),
        tooltip: `How well projections move in the same direction as actual scores. An R² of 0.4 means we explain 40% of the variation in results. Closer to 1 is better; 0 means no better than guessing the average. Sweet spot: ${SCRIPT_PASS_WINDOWS.R2.min.toFixed(2)}–${SCRIPT_PASS_WINDOWS.R2.max.toFixed(2)}.`,
      },
      {
        key: 'TOP_K_HIT_RATE',
        value: accuracy.topKHitRate,
        formatted: accuracy.topKHitRate.toFixed(4),
        pass: isMetricPass('TOP_K_HIT_RATE', accuracy.topKHitRate),
        tooltip: `How many of the top ${SCRIPT_TOP_K} players we projected actually finished as top ${SCRIPT_TOP_K} scorers. Higher means we're correctly identifying the best plays. Target: above ${Math.round(SCRIPT_PASS_WINDOWS.TOP_K_HIT_RATE.min * 100)}%.`,
      },
      {
        key: 'TOP_PERCENTILE_PRECISION',
        value: accuracy.topPercentilePrecision,
        formatted: accuracy.topPercentilePrecision.toFixed(4),
        pass: isMetricPass('TOP_PERCENTILE_PRECISION', accuracy.topPercentilePrecision),
        tooltip: `When we flagged a player as a top-${Math.round(SCRIPT_TOP_PERCENTILE * 100)}% play, how often did they actually finish in the top ${Math.round(SCRIPT_TOP_PERCENTILE * 100)}%? Measures our hit rate on high-upside calls. Target: above ${Math.round(SCRIPT_PASS_WINDOWS.TOP_PERCENTILE_PRECISION.min * 100)}%.`,
      },
      {
        key: 'TOP_PERCENTILE_RECALL',
        value: accuracy.topPercentileRecall,
        formatted: accuracy.topPercentileRecall.toFixed(4),
        pass: isMetricPass('TOP_PERCENTILE_RECALL', accuracy.topPercentileRecall),
        tooltip: `Of the players who actually scored in the top ${Math.round(SCRIPT_TOP_PERCENTILE * 100)}%, how many did we have projected there? Measures how few studs we missed. Target: above ${Math.round(SCRIPT_PASS_WINDOWS.TOP_PERCENTILE_RECALL.min * 100)}%.`,
      },
      {
        key: 'PERCENTILE_RANK_MAE',
        value: accuracy.percentileRankMae,
        formatted: accuracy.percentileRankMae.toFixed(4),
        pass: isMetricPass('PERCENTILE_RANK_MAE', accuracy.percentileRankMae),
        tooltip: `How accurately we rank players relative to each other. A score of 0.15 means we're off by about 15 percentile spots on average — e.g., projecting someone as a top-30% play when they're actually top-45%. Lower is better. Target: below ${SCRIPT_PASS_WINDOWS.PERCENTILE_RANK_MAE.max.toFixed(2)}.`,
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

  const teamFptsTotals = useMemo<TeamFptsTotalRow[]>(() => {
    const totals: TeamFptsTotalRow[] = [];
    teamPlayers.forEach((rows, team) => {
      const distribution = rows
        .map((row) => {
          const actual = Number(row.actual);
          if (!Number.isFinite(actual)) return null;
          return {
            id: row.id,
            name: row.name,
            fpts: actual,
          };
        })
        .filter((entry): entry is TeamFptsDistributionPoint => entry !== null)
        .sort((a, b) => b.fpts - a.fpts);
      if (distribution.length === 0) return;

      const values = distribution.map((entry) => entry.fpts);
      const total = values.reduce((sum, value) => sum + value, 0);
      if (total <= 0) return;

      totals.push({
        team,
        total: Number(total.toFixed(1)),
        average: Number((total / values.length).toFixed(1)),
        median: Number(getMedian(values).toFixed(1)),
        min: Number(Math.min(...values).toFixed(1)),
        max: Number(Math.max(...values).toFixed(1)),
        playerCount: values.length,
        distribution,
      });
    });
    return totals.sort((a, b) => b.total - a.total);
  }, [teamPlayers]);

  return (
    <div className="min-h-screen bg-vellum text-ink p-4 space-y-6">
      <div className="flex items-center gap-3">
        <BarChart2 className="w-5 h-5 text-drafting-orange" />
        <h1 className="text-xl font-black uppercase tracking-widest">Projection vs Actual Report</h1>
      </div>
      <p className="text-sm text-ink/70 max-w-3xl">
        Player-level projection vs actual by team. Hover the team FPTS bars to inspect each team&apos;s player FPTS distribution.
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
                  tooltip="The average amount we over- or under-projected players. Positive means we projected too high on average; negative means too low. This is informational — there's no pass/fail target."
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
                  const valueScore = calculateValueScore(player, games);
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
                      <td className="px-3 py-2 text-right text-ink/60">{valueScore.composite.toFixed(1)}</td>
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

      {hasAnyActual && teamFptsTotals.length > 0 && (
        <div className="bg-white rounded-xl border border-ink/10 shadow-sm p-4 space-y-3">
          <p className="text-sm font-bold text-ink">Total FPTS by Team</p>
          <ResponsiveContainer width="100%" height={Math.max(120, teamFptsTotals.length * 36)}>
            <BarChart data={teamFptsTotals} layout="vertical" margin={{ top: 0, right: 64, left: 8, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="team" tick={{ fontSize: 11, fontWeight: 700 }} width={44} axisLine={false} tickLine={false} />
              <RechartsTooltip
                cursor={{ fill: 'rgba(15, 23, 42, 0.05)' }}
                wrapperStyle={{ pointerEvents: 'auto', zIndex: 50 }}
                content={<TeamFptsTooltip />}
              />
              <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                {teamFptsTotals.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
                <LabelList dataKey="total" position="right" style={{ fontSize: 10, fontWeight: 700 }} formatter={(val: number) => val.toFixed(1)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!hasAnyActual && players.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Actual fantasy points are not available yet for this slate date.
        </div>
      )}

      {matchupRows.length > 0 && (
        <div className="bg-white rounded-xl border border-ink/10 shadow-sm overflow-hidden">
          <div className="flex border-b border-ink/10 overflow-x-auto no-scrollbar">
            {matchupRows.map((row, idx) => (
              <button
                key={row.matchupKey}
                onClick={() => setActiveMatchupTab(idx)}
                className={`px-4 py-3 text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-colors border-b-2 ${activeMatchupTab === idx ? 'text-drafting-orange border-drafting-orange' : 'text-ink/50 border-transparent hover:text-ink'}`}
              >
                {row.teamA} @ {row.teamB}
                {row.total !== null && (
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-ink/40">O/U {row.total.toFixed(1)}</span>
                )}
              </button>
            ))}
          </div>
          {matchupRows[activeMatchupTab] && (
            <div className="p-4">
              <MatchupTable
                teamA={matchupRows[activeMatchupTab].teamA}
                teamB={matchupRows[activeMatchupTab].teamB}
                teamARows={matchupRows[activeMatchupTab].teamAPlayers}
                teamBRows={matchupRows[activeMatchupTab].teamBPlayers}
                onPlayerClick={setSelectedPlayer}
                sort={teamTableSort}
                onSort={handleTeamTableSort}
              />
            </div>
          )}
        </div>
      )}

      {matchupRows.length === 0 && standaloneTeams.length > 0 && (
        <div className="bg-white rounded-xl border border-ink/10 shadow-sm overflow-hidden">
          <div className="flex border-b border-ink/10 overflow-x-auto no-scrollbar">
            {standaloneTeams.map((teamCard, idx) => (
              <button
                key={teamCard.team}
                onClick={() => setActiveMatchupTab(idx)}
                className={`px-4 py-3 text-[11px] font-black uppercase tracking-widest whitespace-nowrap transition-colors border-b-2 ${activeMatchupTab === idx ? 'text-drafting-orange border-drafting-orange' : 'text-ink/50 border-transparent hover:text-ink'}`}
              >
                {teamCard.team}
              </button>
            ))}
          </div>
          {standaloneTeams[activeMatchupTab] && (
            <div className="p-4 overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead><TeamTableHeader sort={teamTableSort} onSort={handleTeamTableSort} /></thead>
                <tbody className="font-mono">
                  <TeamTableRows team={standaloneTeams[activeMatchupTab].team} rows={sortTeamRows(standaloneTeams[activeMatchupTab].rows, teamTableSort)} onPlayerClick={setSelectedPlayer} />
                </tbody>
              </table>
            </div>
          )}
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

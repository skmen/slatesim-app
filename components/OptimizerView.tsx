
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Zap, 
  Settings, 
  Play, 
  Square, 
  Download, 
  Users, 
  Activity,
  AlertCircle,
  Filter,
  X,
  Trash2,
  PlusCircle
} from 'lucide-react';
import { Player, Lineup, GameInfo } from '../types';
import { getPlayerInjuryInfo, InjuryLookup } from '../utils/injuries';
import { getPlayerStartingLineupInfo, StartingLineupLookup } from '../utils/startingLineups';
import { PlayerDeepDive } from './PlayerDeepDive';
import OptimizerWorker from '../src/workers/optimizer.worker.ts?worker';

interface Props {
  players: Player[];
  games: GameInfo[];
  slateDate?: string;
  showActuals?: boolean;
  injuryLookup?: InjuryLookup | null;
  startingLineupLookup?: StartingLineupLookup | null;
}

type SortDir = 'asc' | 'desc';

interface SortConfig {
  key: string;
  dir: SortDir;
}

interface PoolFilterRule {
  id: string;
  column: string;
  operator: PoolFilterOperator;
  value: string;
  logic: 'AND' | 'OR';
}

type PoolFilterOperator = 'equals' | 'contains' | 'gt' | 'lt' | 'in';

const compareValues = (a: any, b: any): number => {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const nA = Number(a);
  const nB = Number(b);
  if (Number.isFinite(nA) && Number.isFinite(nB)) return nA - nB;
  return String(a).localeCompare(String(b));
};

const nextSort = (current: SortConfig, key: string, defaultDir: SortDir = 'desc'): SortConfig => {
  if (current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: defaultDir };
};

const AST_KEYS = ['AST', 'assists', 'assist', 'A', 'ASTS', 'APG'];

const POOL_FILTER_COLUMNS = [
  { key: 'name', label: 'Player' },
  { key: 'team', label: 'Team' },
  { key: 'opponent', label: 'Opp' },
  { key: 'salary', label: 'Salary' },
  { key: 'value', label: 'Value' },
  { key: 'minutes', label: 'Min' },
  { key: 'projection', label: 'FPTS' },
  { key: 'signal', label: 'Signal' },
  { key: 'leverageTier', label: 'Lev Tier' },
  { key: 'minExposure', label: 'Min Exp' },
  { key: 'maxExposure', label: 'Max Exp' },
  { key: 'locked', label: 'Locked' },
  { key: 'excluded', label: 'Excluded' },
] as const;

const parsePositions = (position: string): string[] => {
  return String(position || '')
    .split(/[\/,\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter((p) => ['PG', 'SG', 'SF', 'PF', 'C'].includes(p));
};

const parseMatchup = (text: any): { away: string; home: string } | null => {
  const match = String(text || '').match(/([A-Z]{2,5})@([A-Z]{2,5})/i);
  if (!match) return null;
  return {
    away: match[1].toUpperCase(),
    home: match[2].toUpperCase(),
  };
};

const DK_SLOTS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] as const;

const canFitDK = (player: Player, slot: string): boolean => {
  const pos = player.position;
  switch (slot) {
    case 'PG': return pos.includes('PG');
    case 'SG': return pos.includes('SG');
    case 'SF': return pos.includes('SF');
    case 'PF': return pos.includes('PF');
    case 'C': return pos.includes('C');
    case 'G': return pos.includes('PG') || pos.includes('SG');
    case 'F': return pos.includes('SF') || pos.includes('PF');
    case 'UTIL': return true;
    default: return false;
  }
};

const normalizeKeyToken = (key: string): string => String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const readByKeys = (obj: any, keys: string[]): any => {
  if (!obj || typeof obj !== 'object') return undefined;
  const normalizedMap = new Map<string, string>();
  Object.keys(obj).forEach((k) => normalizedMap.set(normalizeKeyToken(k), k));
  for (const key of keys) {
    const match = normalizedMap.get(normalizeKeyToken(key));
    if (match) return obj[match];
  }
  return undefined;
};

const readStatNumber = (player: Player, keys: string[]): number | undefined => {
  const fromAdvanced = readByKeys((player as any).advancedMetrics, keys);
  const fromSlate = readByKeys((player as any).slateData, keys);
  const fromProfile = readByKeys((player as any).statsProfile, keys);
  const fromPlayer = readByKeys(player as any, keys);
  const raw = fromAdvanced !== undefined
    ? fromAdvanced
    : (fromSlate !== undefined ? fromSlate : (fromProfile !== undefined ? fromProfile : fromPlayer));
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
};

const readPercentLike = (player: Player, keys: string[]): number | undefined => {
  const fromAdvanced = readByKeys((player as any).advancedMetrics, keys);
  const fromSlate = readByKeys((player as any).slateData, keys);
  const fromProfile = readByKeys((player as any).statsProfile, keys);
  const fromPlayer = readByKeys(player as any, keys);
  const raw = fromAdvanced !== undefined
    ? fromAdvanced
    : (fromSlate !== undefined ? fromSlate : (fromProfile !== undefined ? fromProfile : fromPlayer));
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number') return raw;
  const cleaned = String(raw).trim().replace('%', '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : undefined;
};

const readStatString = (player: Player, keys: string[]): string | undefined => {
  const fromAdvanced = readByKeys((player as any).advancedMetrics, keys);
  const fromSlate = readByKeys((player as any).slateData, keys);
  const fromProfile = readByKeys((player as any).statsProfile, keys);
  const fromPlayer = readByKeys(player as any, keys);
  const raw = fromAdvanced !== undefined
    ? fromAdvanced
    : (fromSlate !== undefined ? fromSlate : (fromProfile !== undefined ? fromProfile : fromPlayer));
  if (raw === undefined || raw === null) return undefined;
  return String(raw);
};

const getBlendConfidencePct = (player: Player): number | null => {
  const raw = readPercentLike(player, [
    'DEF_SIGNAL_ONOFF_BLEND_CONF',
    'def_signal_onoff_blend_conf',
    'onOffBlendConfidence',
  ]);
  if (Number.isFinite(Number(raw))) {
    const val = Number(raw);
    return val <= 1 ? val * 100 : val;
  }
  return null;
};

const getImpactFp = (player: Player): number | null => {
  const impact = readStatNumber(player, [
    'DEF_SIGNAL_ONOFF_IMPACT_FP',
    'def_signal_onoff_impact_fp',
    'onOffImpactFp',
  ]);
  if (Number.isFinite(Number(impact))) return Number(impact);
  return null;
};

const getImpactTier = (player: Player): string | null => {
  const raw = readByKeys((player as any).advancedMetrics, [
    'DEF_SIGNAL_ONOFF_IMPACT_TIER',
    'def_signal_onoff_impact_tier',
    'onOffImpactTier',
  ]) ?? readByKeys((player as any).slateData, [
    'DEF_SIGNAL_ONOFF_IMPACT_TIER',
    'def_signal_onoff_impact_tier',
    'onOffImpactTier',
  ]) ?? readByKeys((player as any).statsProfile, [
    'DEF_SIGNAL_ONOFF_IMPACT_TIER',
    'def_signal_onoff_impact_tier',
    'onOffImpactTier',
  ]) ?? readByKeys(player as any, [
    'DEF_SIGNAL_ONOFF_IMPACT_TIER',
    'def_signal_onoff_impact_tier',
    'onOffImpactTier',
  ]);
  if (raw === undefined || raw === null) return null;
  return String(raw).trim().toLowerCase();
};

const getLeverageTier = (player: Player): string | null => {
  const raw = readStatString(player, [
    'signalLeverageTier',
    'signal_leverage_tier',
    'LEVERAGE_TIER',
    'leverageTier',
    'leverage_tier',
    'leverageTierLabel',
    'leverageTierName',
  ]);
  if (!raw) return null;
  return raw.trim().toLowerCase();
};

const isNegativeOrWorseLeverageTier = (player: Player): boolean => {
  const tier = getLeverageTier(player);
  if (!tier) return false;
  if (tier.includes('strong fade')) return true;
  if (tier === 'fade') return true;
  if (tier.includes('negative')) return true;
  return false;
};

const isNeutralOrBetterLeverageTier = (player: Player): boolean => {
  const tier = getLeverageTier(player);
  if (!tier) return false;
  if (tier.includes('strong boost')) return true;
  if (tier === 'boost') return true;
  if (tier === 'neutral') return true;
  if (tier.includes('strong fade')) return false;
  if (tier === 'fade') return false;
  return false;
};

const isNeutralOrBetterSignal = (player: Player): boolean => {
  const tier = getImpactTier(player);
  if (tier) {
    if (tier.includes('strong boost')) return true;
    if (tier === 'boost') return true;
    if (tier === 'neutral') return true;
    if (tier.includes('strong fade')) return false;
    if (tier === 'fade') return false;
  }
  const impact = getImpactFp(player);
  return impact !== null ? impact >= -0.5 : false;
};

const isNeutralSignal = (player: Player): boolean => {
  const tier = getImpactTier(player);
  if (tier) return tier === 'neutral';
  const impact = getImpactFp(player);
  return impact !== null ? impact >= -0.5 && impact <= 0.5 : false;
};

const getSignalLabel = (player: Player): string => {
  const tier = getImpactTier(player);
  if (!tier) return '--';
  if (tier.includes('strong boost')) return 'Strong Boost';
  if (tier === 'boost') return 'Boost';
  if (tier.includes('strong fade')) return 'Strong Fade';
  if (tier === 'fade') return 'Fade';
  if (tier === 'neutral') return 'Neutral';
  return tier.replace(/\b\w/g, (c) => c.toUpperCase());
};

const getAverageMinutes = (player: Player): number | null => {
  const avg = readStatNumber(player, [
    'avgMinutes',
    'averageMinutes',
    'minutesAvg',
    'minutes_avg',
    'min_avg',
    'avg_min',
    'AVG_MIN',
    'MIN_AVG',
    'AVG_MINUTES',
    'MINUTES_AVG',
    'MINUTES_AVERAGE',
    'AVG_MINUTE',
    'avgMin',
    'avg_minutes',
    'minutesAverage',
    'avgMinutesPerGame',
    'minutesPerGame',
    'min_per_game',
    'MIN_PER_GAME',
  ]);
  return Number.isFinite(Number(avg)) ? Number(avg) : null;
};

const isMatchupBoostSignal = (player: Player): boolean => {
  const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));
  const usageRate = readStatNumber(player, ['usageRate', 'usage_rate', 'USG%']) ?? 0;
  const minutesProjection = readStatNumber(player, ['minutesProjection', 'minutes', 'min']) ?? 0;
  const oppOnOffFpDiff = readStatNumber(player, [
    'oppDefOnOffFpAllowedDiff',
    'opp_def_on_off_fp_allowed_diff',
    'oppDefOnOffFpDiff',
    'opp_def_on_off_fp_diff',
  ]) ?? 0;
  const defOnSample = readStatNumber(player, ['defOnSamplePossessions', 'def_on_sample_possessions']) ?? 0;
  const defOffSample = readStatNumber(player, ['defOffSamplePossessions', 'def_off_sample_possessions']) ?? 0;

  const usageFrac = usageRate / 100;
  const minuteShare = clamp(minutesProjection / 48, 0, 1);
  const involvementScore = clamp((0.5 * usageFrac) + (0.5 * minuteShare), 0.15, 0.65);
  const sampleConfidence = clamp((defOnSample + defOffSample) / 2000, 0, 1);
  const teamEnvFp = oppOnOffFpDiff * 0.98;
  const estimatedImpact = teamEnvFp * involvementScore;

  return sampleConfidence >= 0.6 && estimatedImpact >= 0.15;
};

const sortHistoryByDateDesc = (gamesList: any[]): any[] => {
  return [...gamesList].sort((a, b) => {
    const da = Date.parse(a.date);
    const db = Date.parse(b.date);
    if (Number.isFinite(da) && Number.isFinite(db)) return db - da;
    return String(b.date).localeCompare(String(a.date));
  });
};

const computeFppm = (player: Player): number | null => {
  let games: { minutes: number; fpts: number; date?: string }[] = [];

  if (player.history && player.history.length > 0) {
    const sorted = sortHistoryByDateDesc(player.history).slice(0, 10);
    games = sorted.map((g) => ({
      minutes: Number(g.minutes) || 0,
      fpts: Number(g.fpts) || 0,
      date: g.date,
    }));
  } else if (Array.isArray(player.last5PlayByPlay) && player.last5PlayByPlay.length > 0) {
    const derived = player.last5PlayByPlay
      .map((game: any) => {
        const chunks = Array.isArray(game?.chunks) ? game.chunks : [];
        const minutes = chunks.reduce((sum: number, c: any) => sum + (Number(c?.minutesPlayed) || 0), 0);
        const fpts = chunks.reduce((sum: number, c: any) => sum + (Number(c?.fantasyPoints) || 0), 0);
        const date = String(game?.date || '');
        return { minutes, fpts, date };
      })
      .filter((g: any) => !!g.date)
      .sort((a: any, b: any) => {
        const da = Date.parse(a.date);
        const db = Date.parse(b.date);
        if (Number.isFinite(da) && Number.isFinite(db)) return db - da;
        return String(b.date).localeCompare(String(a.date));
      })
      .slice(0, 10);

    games = derived.map((g: any) => ({
      minutes: Number(g.minutes) || 0,
      fpts: Number(g.fpts) || 0,
      date: g.date,
    }));
  }

  if (games.length === 0) return null;
  const totalFpts = games.reduce((sum, g) => sum + g.fpts, 0);
  const totalMinutes = games.reduce((sum, g) => sum + g.minutes, 0);
  if (totalMinutes <= 0) return null;
  const avgFpts = totalFpts / games.length;
  const avgMin = totalMinutes / games.length;
  if (avgMin <= 0) return null;
  return avgFpts / avgMin;
};

const getOpponentTeamForPlayer = (player: Player, games: GameInfo[]) => {
  const teamId = String(player.team || '').toUpperCase();
  if (!teamId) return undefined;
  let opponentId = String(player.opponent || '').toUpperCase();

  if (!opponentId) {
    const parsed = parseMatchup((player as any)['Game Info'] ?? (player as any).gameInfo);
    if (parsed) {
      opponentId = teamId === parsed.away ? parsed.home : teamId === parsed.home ? parsed.away : '';
    }
  }

  if (!opponentId) return undefined;

  const game = games.find((g) =>
    (g.teamA.teamId === teamId && g.teamB.teamId === opponentId) ||
    (g.teamB.teamId === teamId && g.teamA.teamId === opponentId)
  );
  if (!game) return undefined;
  return game.teamA.teamId === opponentId ? game.teamA : game.teamB;
};

const getGameForPlayer = (player: Player, games: GameInfo[]) => {
  const teamId = String(player.team || '').toUpperCase();
  if (!teamId) return undefined;
  let opponentId = String(player.opponent || '').toUpperCase();

  if (!opponentId) {
    const parsed = parseMatchup((player as any)['Game Info'] ?? (player as any).gameInfo);
    if (parsed) {
      opponentId = teamId === parsed.away ? parsed.home : teamId === parsed.home ? parsed.away : '';
    }
  }

  if (!opponentId) return undefined;
  return games.find((g) =>
    (g.teamA.teamId === teamId && g.teamB.teamId === opponentId) ||
    (g.teamB.teamId === teamId && g.teamA.teamId === opponentId)
  );
};

const getDvpValue = (row: any, keys: string[]): number | null => {
  const val = readByKeys(row, keys);
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
};

const getOpp3pmAllowed = (player: Player): number | null => {
  const slateData = (player as any)?.slateData ?? {};
  const advancedSlate = slateData.advancedMetrics ?? slateData.advancedmetrics ?? slateData.advanced_metrics ?? {};
  const advancedPlayer = (player as any)?.advancedMetrics ?? (player as any)?.advancedmetrics ?? (player as any)?.advanced_metrics ?? {};
  const raw = readByKeys(advancedSlate, ['opp3pmAllowed', 'opp_3pm_allowed', 'opp3pmallowed', 'OPP3PMALLOWED'])
    ?? readByKeys(advancedPlayer, ['opp3pmAllowed', 'opp_3pm_allowed', 'opp3pmallowed', 'OPP3PMALLOWED'])
    ?? readByKeys(slateData, ['opp3pmAllowed', 'opp_3pm_allowed', 'opp3pmallowed', 'OPP3PMALLOWED'])
    ?? readByKeys(player as any, ['opp3pmAllowed', 'opp_3pm_allowed', 'opp3pmallowed', 'OPP3PMALLOWED']);
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
};

type DvpTier = 'green' | 'black' | 'red';
type DvpTextTier = 'twoGreen' | 'oneGreen' | 'allBlack' | 'mixed';

const dvpTextTierPriority: Record<DvpTextTier, number> = {
  mixed: 0,
  allBlack: 1,
  oneGreen: 2,
  twoGreen: 3,
};

const getDvpStatTier = (position: string, stat: 'pts' | 'reb' | 'ast' | 'blk' | '3pm', value: number | null): DvpTier => {
  if (!Number.isFinite(Number(value))) return 'black';
  const val = Number(value);
  const pos = String(position || '').toUpperCase();
  const between = (min: number, max: number) => val >= min && val <= max;

  if (pos === 'PG') {
    if (stat === 'pts') return val < 21.0 ? 'red' : between(21.0, 24.9) ? 'black' : 'green';
    if (stat === 'ast') return val < 7.5 ? 'red' : between(7.5, 9.4) ? 'black' : 'green';
    if (stat === 'reb') return val < 5.5 ? 'red' : between(5.5, 6.4) ? 'black' : 'green';
  } else if (pos === 'SG') {
    if (stat === 'pts') return val < 21.0 ? 'red' : between(21.0, 23.9) ? 'black' : 'green';
    if (stat === '3pm') return val < 2.5 ? 'red' : between(2.5, 3.4) ? 'black' : 'green';
    if (stat === 'reb') return val < 5.0 ? 'red' : between(5.0, 6.4) ? 'black' : 'green';
  } else if (pos === 'SF') {
    if (stat === 'pts') return val < 19.0 ? 'red' : between(19.0, 21.9) ? 'black' : 'green';
    if (stat === 'reb') return val < 6.5 ? 'red' : between(6.5, 7.9) ? 'black' : 'green';
    if (stat === 'ast') return val < 3.5 ? 'red' : between(3.5, 4.9) ? 'black' : 'green';
  } else if (pos === 'PF') {
    if (stat === 'pts') return val < 20.0 ? 'red' : between(20.0, 22.9) ? 'black' : 'green';
    if (stat === 'reb') return val < 9.0 ? 'red' : between(9.0, 10.9) ? 'black' : 'green';
    if (stat === 'ast') return val < 3.5 ? 'red' : between(3.5, 4.9) ? 'black' : 'green';
  } else if (pos === 'C') {
    if (stat === 'pts') return val < 20.0 ? 'red' : between(20.0, 23.9) ? 'black' : 'green';
    if (stat === 'reb') return val < 12.0 ? 'red' : between(12.0, 14.9) ? 'black' : 'green';
    if (stat === 'blk') return val < 1.5 ? 'red' : between(1.5, 2.4) ? 'black' : 'green';
  }

  return 'black';
};

const getDvpTextTier = (position: string, row: any, player?: Player): DvpTextTier => {
  if (!row) return 'allBlack';
  const pos = String(position || '').toUpperCase();
  const pts = getDvpValue(row, ['PTS', 'points']);
  const reb = getDvpValue(row, ['REB', 'rebounds']);
  const ast = getDvpValue(row, AST_KEYS);
  const blk = getDvpValue(row, ['BLK', 'blocks']);
  const opp3pmAllowed = player ? getOpp3pmAllowed(player) : null;
  const threePm = Number.isFinite(Number(opp3pmAllowed))
    ? Number(opp3pmAllowed)
    : getDvpValue(row, ['3PM', '3pm', '3P', '3ptm', '3PTM']);

  const tiers: DvpTier[] = [];
  if (pos === 'PG') {
    tiers.push(getDvpStatTier(pos, 'pts', pts));
    tiers.push(getDvpStatTier(pos, 'ast', ast));
    tiers.push(getDvpStatTier(pos, 'reb', reb));
  } else if (pos === 'SG') {
    tiers.push(getDvpStatTier(pos, 'pts', pts));
    tiers.push(getDvpStatTier(pos, '3pm', threePm));
    tiers.push(getDvpStatTier(pos, 'reb', reb));
  } else if (pos === 'SF') {
    tiers.push(getDvpStatTier(pos, 'pts', pts));
    tiers.push(getDvpStatTier(pos, 'reb', reb));
    tiers.push(getDvpStatTier(pos, 'ast', ast));
  } else if (pos === 'PF') {
    tiers.push(getDvpStatTier(pos, 'pts', pts));
    tiers.push(getDvpStatTier(pos, 'reb', reb));
    tiers.push(getDvpStatTier(pos, 'ast', ast));
  } else if (pos === 'C') {
    tiers.push(getDvpStatTier(pos, 'pts', pts));
    tiers.push(getDvpStatTier(pos, 'reb', reb));
    tiers.push(getDvpStatTier(pos, 'blk', blk));
  }

  const greenCount = tiers.filter((tier) => tier === 'green').length;
  const redCount = tiers.filter((tier) => tier === 'red').length;
  if (redCount > 0) return 'mixed';
  if (greenCount >= 2) return 'twoGreen';
  if (greenCount === 1) return 'oneGreen';
  return 'allBlack';
};

const getBestDvpTextTier = (positions: string[], dvp: any, player?: Player): DvpTextTier => {
  return positions.reduce<DvpTextTier>((best, pos) => {
    const row = (dvp as any)?.[pos] || {};
    const tier = getDvpTextTier(pos, row, player);
    return dvpTextTierPriority[tier] > dvpTextTierPriority[best] ? tier : best;
  }, 'mixed');
};

const countDvpNet = (positions: string[], dvp: any, player?: Player): number => {
  let green = 0;
  let red = 0;
  positions.forEach((pos) => {
    const row = (dvp as any)?.[pos] || {};
    const pts = getDvpValue(row, ['PTS', 'points']);
    const reb = getDvpValue(row, ['REB', 'rebounds']);
    const ast = getDvpValue(row, AST_KEYS);
    const blk = getDvpValue(row, ['BLK', 'blocks']);
    const opp3pmAllowed = player ? getOpp3pmAllowed(player) : null;
    const threePm = Number.isFinite(Number(opp3pmAllowed))
      ? Number(opp3pmAllowed)
      : getDvpValue(row, ['3PM', '3pm', '3P', '3ptm', '3PTM']);

    const tiers: DvpTier[] = [];
    if (pos === 'PG') {
      tiers.push(getDvpStatTier(pos, 'pts', pts));
      tiers.push(getDvpStatTier(pos, 'ast', ast));
      tiers.push(getDvpStatTier(pos, 'reb', reb));
    } else if (pos === 'SG') {
      tiers.push(getDvpStatTier(pos, 'pts', pts));
      tiers.push(getDvpStatTier(pos, '3pm', threePm));
      tiers.push(getDvpStatTier(pos, 'reb', reb));
    } else if (pos === 'SF') {
      tiers.push(getDvpStatTier(pos, 'pts', pts));
      tiers.push(getDvpStatTier(pos, 'reb', reb));
      tiers.push(getDvpStatTier(pos, 'ast', ast));
    } else if (pos === 'PF') {
      tiers.push(getDvpStatTier(pos, 'pts', pts));
      tiers.push(getDvpStatTier(pos, 'reb', reb));
      tiers.push(getDvpStatTier(pos, 'ast', ast));
    } else if (pos === 'C') {
      tiers.push(getDvpStatTier(pos, 'pts', pts));
      tiers.push(getDvpStatTier(pos, 'reb', reb));
      tiers.push(getDvpStatTier(pos, 'blk', blk));
    }

    tiers.forEach((tier) => {
      if (tier === 'green') green += 1;
      if (tier === 'red') red += 1;
    });
  });
  return green - red;
};

const HIGH_PACE = 100;
const HIGH_TOTAL = 225;

const isHighTotalPaceGame = (player: Player, games: GameInfo[]): boolean => {
  const game = getGameForPlayer(player, games);
  if (!game) return false;
  const pace =
    ((game.teamA?.seasonStats?.pace || 100) + (game.teamB?.seasonStats?.pace || 100)) / 2;
  const total = Number(game.overUnder) || 0;
  return pace >= HIGH_PACE && total >= HIGH_TOTAL;
};

const isFavorableDvp = (player: Player, games: GameInfo[]): boolean => {
  const opponentTeam = getOpponentTeamForPlayer(player, games);
  const dvp = opponentTeam?.positionalDvP || {};
  const positions = parsePositions(player.position);
  if (positions.length === 0) return false;
  const bestTier = getBestDvpTextTier(positions, dvp, player);
  return bestTier === 'twoGreen' || bestTier === 'oneGreen';
};

const computeOptimizerPriority = (player: Player, games: GameInfo[]): number => {
  const positions = parsePositions(player.position);
  const opponentTeam = getOpponentTeamForPlayer(player, games);
  const dvp = opponentTeam?.positionalDvP || {};
  const dvpNet = countDvpNet(positions, dvp, player);
  const overallPositiveDvp = dvpNet > 0;
  const dvpTextTier = getBestDvpTextTier(positions, dvp, player);

  const blendConfPct = getBlendConfidencePct(player) ?? 0;
  const reliabilityOk = blendConfPct >= 95;
  const neutralOrBetter = isNeutralOrBetterSignal(player);
  const isNeutralSignal = getImpactTier(player) === 'neutral';
  const usageRate = readPercentLike(player, ['usageRate', 'usage_rate', 'USG%', 'USAGE_PCT']) ?? 0;
  const minutesProj = readStatNumber(player, ['minutesProjection', 'minutes', 'min', 'MINUTES_PROJ']) ?? 0;

  const overrideAll = overallPositiveDvp &&
    blendConfPct >= 80 &&
    usageRate > 27 &&
    minutesProj >= 34.9;

  const highlighted = ((reliabilityOk && neutralOrBetter) && !isNeutralSignal) || overrideAll;
  const highlightedText = highlighted && dvpTextTier !== 'mixed';
  const leverageNeutralOrBetter = isNeutralOrBetterLeverageTier(player);

  const fppm =
    computeFppm(player) ??
    (Number.isFinite(Number(player.averageFppm)) ? Number(player.averageFppm) : null) ??
    (player.minutesProjection && player.minutesProjection > 0
      ? player.projection / player.minutesProjection
      : null) ??
    0;

  const value = player.salary > 0 ? player.projection / (player.salary / 1000) : 0;

  if (highlighted && highlightedText && leverageNeutralOrBetter) return 5;
  if (highlighted) return 4;
  if (overallPositiveDvp && isHighTotalPaceGame(player, games)) return 3;
  if (isFavorableDvp(player, games) && fppm > 1.0) return 2;
  if (fppm > 0.9 && value > 5.0) return 1;
  return 0;
};

export const OptimizerView: React.FC<Props> = ({ players, games, slateDate, showActuals: showActualsProp, injuryLookup, startingLineupLookup }) => {
  const isDateBeforeToday = (dateStr: string): boolean => {
    if (!dateStr) return false;
    const input = new Date(dateStr);
    if (isNaN(input.getTime())) return false;
    input.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return input < today;
  };

  const [config, setConfig] = useState({
    numLineups: 20,
    salaryCap: 50000,
    minExposure: 0,
    maxExposure: 50,
    site: 'DraftKings'
  });

  const [generatedLineups, setGeneratedLineups] = useState<Lineup[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lineupSort, setLineupSort] = useState<SortConfig>({ key: 'projection', dir: 'desc' });
  const [exposureSort, setExposureSort] = useState<SortConfig>({ key: 'exposure', dir: 'desc' });

  const isHistorical = useMemo(() => {
    if (!slateDate) return false;
    return isDateBeforeToday(slateDate);
  }, [slateDate]);

  const showActuals = useMemo(() => {
    const base = typeof showActualsProp === 'boolean' ? showActualsProp : true;
    if (!slateDate) return base;
    return base && isDateBeforeToday(slateDate);
  }, [slateDate, showActualsProp]);
  const [expandedLineupId, setExpandedLineupId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [lockedIds, setLockedIds] = useState<string[]>([]);
  const [selectedMatchups, setSelectedMatchups] = useState<string[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [playerOverrides, setPlayerOverrides] = useState<Record<string, { minutes?: number; projection?: number; minExposure?: number; maxExposure?: number; exclude?: boolean }>>({});
  const [poolSearch, setPoolSearch] = useState('');
  const [showPoolFilterBuilder, setShowPoolFilterBuilder] = useState(false);
  const [poolFilters, setPoolFilters] = useState<PoolFilterRule[]>([]);
  const workerRef = useRef<Worker | null>(null);

  // Clean up worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setGeneratedLineups([]);
    setProgress(0);
    setIsOptimizing(false);
    setError(null);
    setExpandedLineupId(null);
  }, [slateDate, players]);

  useEffect(() => {
    const raw = localStorage.getItem('optimizerAdvancedSettings');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.lockedIds)) setLockedIds(parsed.lockedIds);
      if (Array.isArray(parsed.selectedMatchups)) setSelectedMatchups(parsed.selectedMatchups);
      if (Array.isArray(parsed.selectedTeams)) setSelectedTeams(parsed.selectedTeams);
      if (parsed.playerOverrides && typeof parsed.playerOverrides === 'object') {
        setPlayerOverrides(parsed.playerOverrides);
      }
    } catch {
      // Ignore malformed stored settings
    }
  }, []);

  const startOptimization = () => {
    if (isOptimizing) return;
    
    setError(null);
    setProgress(0);
    setGeneratedLineups([]);

    try {
      const matchupTeamMap = new Map<string, Set<string>>();
      games.forEach((game) => {
        const teams = new Set([game.teamA.teamId, game.teamB.teamId]);
        matchupTeamMap.set(game.matchupKey, teams);
      });

      // Prepare player pool (only active players with salary and projection)
      const pool = players
        .filter(p => p.salary > 0 && p.projection > 0)
        .filter(p => !isNegativeOrWorseLeverageTier(p))
        .filter((player) => !(playerOverrides[player.id]?.exclude))
        .map((player) => {
          const overrides = playerOverrides[player.id] || {};
          const minExposureVal = Number(overrides.minExposure);
          const maxExposureVal = Number(overrides.maxExposure);
          const merged: Player = {
            ...player,
            projection: Number.isFinite(Number(overrides.projection)) ? Number(overrides.projection) : player.projection,
            minutesProjection: Number.isFinite(Number(overrides.minutes)) ? Number(overrides.minutes) : player.minutesProjection,
          };

          let optimizerBonus = 0;
          if (lockedIds.includes(player.id)) optimizerBonus += 3;
          if (selectedTeams.includes(player.team)) optimizerBonus += 1;
          for (const key of selectedMatchups) {
            const teams = matchupTeamMap.get(key);
            if (teams && teams.has(player.team)) {
              optimizerBonus += 1;
              break;
            }
          }

          const locked = lockedIds.includes(player.id);
          return {
            ...merged,
            optimizerPriority: computeOptimizerPriority(merged, games),
            optimizerBonus,
            optimizerLocked: locked,
            optimizerMinExposure: locked ? 100 : (Number.isFinite(minExposureVal) && minExposureVal > 0 ? minExposureVal : undefined),
            optimizerMaxExposure: locked ? 100 : (Number.isFinite(maxExposureVal) && maxExposureVal > 0 ? maxExposureVal : undefined),
          };
        });

      if (pool.length < DK_SLOTS.length) {
        setError(`Optimizer pool too small (${pool.length} players) after filters. Relax DvP/Leverage/usage-minute rules.`);
        setIsOptimizing(false);
        return;
      }

      const missingSlot = DK_SLOTS.find((slot) => !pool.some((player) => canFitDK(player, slot)));
      if (missingSlot) {
        setError(`No eligible players for ${missingSlot} after filters. Relax DvP/Leverage/usage-minute rules.`);
        setIsOptimizing(false);
        return;
      }

      setIsOptimizing(true);

      // Initialize Worker
      const worker = new OptimizerWorker();
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        switch (msg.type) {
          case 'progress':
            setProgress(msg.progress);
            if (msg.currentBest) {
              setGeneratedLineups(prev => [msg.currentBest!, ...prev].slice(0, 150));
            }
            break;
          case 'result':
            setGeneratedLineups(msg.lineups);
            setIsOptimizing(false);
            setProgress(100);
            if (!msg.lineups || msg.lineups.length === 0) {
              setError('No valid lineups could be generated with the current filters.');
            }
            worker.terminate();
            break;
          case 'error':
            setError(msg.message);
            setIsOptimizing(false);
            worker.terminate();
            break;
        }
      };

      worker.onerror = (err) => {
        setError("Worker Error: Optimization failed to start.");
        setIsOptimizing(false);
        worker.terminate();
      };
      
      const request = {
        players: pool,
        config
      };

      worker.postMessage(request);

    } catch (err) {
      setError("Initialization Error: Failed to create optimizer worker.");
      setIsOptimizing(false);
    }
  };

  const stopOptimization = () => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setIsOptimizing(false);
  };

  const exportToCSV = () => {
    if (generatedLineups.length === 0) return;

    // DraftKings CSV Format: PG,SG,SF,PF,C,G,F,UTIL
    const headers = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'];
    const rows = generatedLineups.map(lineup => {
      const lineupPlayers = getLineupPlayers(lineup);
      return headers.map(slot => lineupPlayers.find(p => p.position.includes(slot))?.id || '').join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `slatesavvy_lineups_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exposureStats = useMemo(() => {
    const counts: Record<string, number> = {};
    generatedLineups.forEach(l => {
      l.playerIds.forEach(id => {
        counts[id] = (counts[id] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .map(([id, count]) => ({
        id,
        name: players.find(p => p.id === id)?.name || 'Unknown',
        exposure: (count / generatedLineups.length) * 100
      }))
      .sort((a, b) => b.exposure - a.exposure);
  }, [generatedLineups, players]);

  const playerById = useMemo(() => {
    return new Map(players.map((p) => [p.id, p]));
  }, [players]);

  const getLineupPlayers = (lineup: Lineup): Player[] => {
    if (lineup.players && lineup.players.length > 0) return lineup.players;
    return lineup.playerIds
      .map((id) => playerById.get(id))
      .filter((p): p is Player => Boolean(p));
  };

  const getPlayerActual = (player: Player): number | null => {
    const raw = player.actual ?? player.actualFpts ?? player.actual_fpts ?? player.history?.[player.history.length - 1]?.fpts;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  };

  const getLineupActualTotal = (lineup: Lineup): number | null => {
    const lineupPlayers = getLineupPlayers(lineup);
    let total = 0;
    let hasActual = false;
    lineupPlayers.forEach((p) => {
      const val = getPlayerActual(p);
      if (val !== null) {
        total += val;
        hasActual = true;
      }
    });
    return hasActual ? Number(total.toFixed(2)) : null;
  };

  const sortedLineups = useMemo(() => {
    const indexMap = new Map<string, number>();
    const actualMap = new Map<string, number | null>();
    generatedLineups.forEach((lineup, idx) => {
      indexMap.set(lineup.id, idx);
      actualMap.set(lineup.id, getLineupActualTotal(lineup));
    });
    const rows = [...generatedLineups];
    rows.sort((a, b) => {
      const valueFor = (lineup: Lineup) => {
        switch (lineupSort.key) {
          case 'index': return indexMap.get(lineup.id) ?? 0;
          case 'projection': return lineup.totalProjection;
          case 'actual': return actualMap.get(lineup.id) ?? -Infinity;
          case 'salary': return config.salaryCap - lineup.totalSalary;
          default: return lineup.totalProjection;
        }
      };
      const cmp = compareValues(valueFor(a), valueFor(b));
      return lineupSort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [generatedLineups, lineupSort, config.salaryCap]);

  const sortedExposureStats = useMemo(() => {
    const rows = [...exposureStats];
    rows.sort((a, b) => {
      const valueFor = (row: typeof exposureStats[number]) => {
        switch (exposureSort.key) {
          case 'name': return row.name;
          case 'exposure': return row.exposure;
          default: return row.exposure;
        }
      };
      const cmp = compareValues(valueFor(a), valueFor(b));
      return exposureSort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [exposureStats, exposureSort]);

  const addPoolFilter = () => {
    const newFilter: PoolFilterRule = {
      id: Math.random().toString(36).substr(2, 9),
      column: POOL_FILTER_COLUMNS[0]?.key ?? 'name',
      operator: 'contains',
      value: '',
      logic: 'AND',
    };
    setPoolFilters((prev) => [...prev, newFilter]);
  };

  const removePoolFilter = (id: string) => setPoolFilters((prev) => prev.filter((f) => f.id !== id));
  const updatePoolFilter = (id: string, updates: Partial<PoolFilterRule>) => {
    setPoolFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  const filteredPoolPlayers = useMemo(() => {
    const term = poolSearch.trim().toLowerCase();
    let pool = players.filter((p) => (!term ? true : p.name.toLowerCase().includes(term)));

    const getFilterValue = (player: Player, key: string): any => {
      const overrides = playerOverrides[player.id] || {};
      const displayMinutes = Number.isFinite(Number(overrides.minutes))
        ? Number(overrides.minutes)
        : (Number.isFinite(Number(player.minutesProjection)) ? Number(player.minutesProjection) : undefined);
      const displayProjection = Number.isFinite(Number(overrides.projection))
        ? Number(overrides.projection)
        : (Number.isFinite(Number(player.projection)) ? Number(player.projection) : undefined);
      const displayValue = player.salary > 0 && displayProjection !== undefined
        ? displayProjection / (player.salary / 1000)
        : undefined;
      switch (key) {
        case 'name': return player.name;
        case 'team': return player.team;
        case 'opponent': return player.opponent;
        case 'salary': return player.salary;
        case 'value': return displayValue;
        case 'minutes': return displayMinutes;
        case 'projection': return displayProjection;
        case 'signal': return getSignalLabel(player);
        case 'leverageTier': return getLeverageTier(player) ?? '';
        case 'minExposure': return overrides.minExposure ?? '';
        case 'maxExposure': return overrides.maxExposure ?? '';
        case 'locked': return lockedIds.includes(player.id);
        case 'excluded': return Boolean(overrides.exclude);
        default: return (player as any)[key];
      }
    };

    if (poolFilters.length > 0) {
      pool = pool.filter((player) => {
        let match = true;
        poolFilters.forEach((f, idx) => {
          const rawVal = getFilterValue(player, f.column);
          const playerVal = String(rawVal ?? '').toLowerCase();
          const filterVal = String(f.value ?? '').toLowerCase();
          let currentMatch = false;
          const nPlayerVal = parseFloat(playerVal);
          const nFilterVal = parseFloat(filterVal);
          switch (f.operator) {
            case 'equals': currentMatch = playerVal === filterVal; break;
            case 'contains': currentMatch = playerVal.indexOf(filterVal) !== -1; break;
            case 'gt': currentMatch = !isNaN(nPlayerVal) && !isNaN(nFilterVal) && nPlayerVal > nFilterVal; break;
            case 'lt': currentMatch = !isNaN(nPlayerVal) && !isNaN(nFilterVal) && nPlayerVal < nFilterVal; break;
            case 'in': currentMatch = filterVal.split(',').map(s => s.trim().toLowerCase()).includes(playerVal); break;
          }
          if (idx === 0) match = currentMatch;
          else {
            if (f.logic === 'AND') match = match && currentMatch;
            else match = match || currentMatch;
          }
        });
        return match;
      });
    }

    return pool;
  }, [players, poolSearch, poolFilters, playerOverrides, lockedIds]);

  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    games.forEach((g) => {
      set.add(g.teamA.teamId);
      set.add(g.teamB.teamId);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [games]);

  const saveAdvancedSettings = () => {
    const payload = {
      lockedIds,
      selectedMatchups,
      selectedTeams,
      playerOverrides,
    };
    localStorage.setItem('optimizerAdvancedSettings', JSON.stringify(payload));
    setShowAdvanced(false);
  };

  const clearAdvancedSettings = () => {
    localStorage.removeItem('optimizerAdvancedSettings');
    setLockedIds([]);
    setSelectedMatchups([]);
    setSelectedTeams([]);
    setPlayerOverrides({});
  };

  const visiblePoolIds = filteredPoolPlayers.map((p) => p.id);
  const visibleLockableIds = filteredPoolPlayers
    .filter((p) => !playerOverrides[p.id]?.exclude)
    .map((p) => p.id);
  const allVisibleLocked = visibleLockableIds.length > 0 && visibleLockableIds.every((id) => lockedIds.includes(id));
  const allVisibleExcluded = filteredPoolPlayers.length > 0 && filteredPoolPlayers.every((p) => Boolean(playerOverrides[p.id]?.exclude));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {selectedPlayer && (
        <PlayerDeepDive
          player={selectedPlayer}
          players={players}
          games={games}
          onClose={() => setSelectedPlayer(null)}
          isHistorical={isHistorical}
          showActuals={showActuals}
          depthCharts={undefined}
          injuryLookup={injuryLookup}
          startingLineupLookup={startingLineupLookup}
        />
      )}
      <div className="bg-white/40 backdrop-blur-sm rounded-sm border border-ink/10 p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Settings className="w-4 h-4 text-drafting-orange" />
          <h3 className="text-[11px] font-black uppercase tracking-widest text-ink/60">Optimizer Settings</h3>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[9px] font-black text-ink/40 uppercase tracking-widest block">Lineups</label>
              <select
                value={config.numLineups}
                onChange={(e) => setConfig({ ...config, numLineups: parseInt(e.target.value, 10) })}
                className="w-full bg-white/60 border border-ink/20 rounded-sm px-2.5 py-1.5 text-[11px] font-bold font-mono focus:border-drafting-orange outline-none transition-all text-ink"
              >
                {[1, 10, 20, 50, 100, 150, 250, 500, 1000].map((val) => (
                  <option key={val} value={val}>{val}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[9px] font-black text-ink/40 uppercase tracking-widest block">Salary Cap</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-drafting-orange font-mono font-bold text-[10px]">$</span>
                <input 
                  type="number" 
                  value={config.salaryCap}
                  onChange={(e) => setConfig({...config, salaryCap: parseInt(e.target.value)})}
                  className="w-full bg-white/60 border border-ink/20 rounded-sm pl-7 pr-2.5 py-1.5 text-[11px] font-bold font-mono focus:border-drafting-orange outline-none transition-all text-ink"
                />
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-ink/10 grid grid-cols-1 md:grid-cols-[1fr,1.4fr] gap-2.5">
            <button
              type="button"
              onClick={() => setShowAdvanced(true)}
              className="w-full border border-ink/20 text-ink/70 font-black py-2 rounded-sm text-[9px] uppercase tracking-widest hover:border-drafting-orange/40 hover:text-ink transition-all"
            >
              Advanced
            </button>
            {!isOptimizing ? (
              <button 
                onClick={startOptimization}
                className="w-full bg-drafting-orange hover:opacity-90 text-white font-black py-2.5 rounded-sm shadow-lg shadow-drafting-orange/20 transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-[11px]"
              >
                <Play className="w-3.5 h-3.5 fill-current" /> Run Optimizer
              </button>
            ) : (
              <button 
                onClick={stopOptimization}
                className="w-full bg-red-600 hover:opacity-90 text-white font-black py-2.5 rounded-sm shadow-lg shadow-red-600/20 transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-[11px]"
              >
                <Square className="w-3.5 h-3.5 fill-current" /> Stop Process
              </button>
            )}
          </div>

          {error && (
            <div className="p-3 bg-red-600/10 border border-red-600/20 rounded-sm flex items-start gap-2 animate-in slide-in-from-top-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-[9px] font-bold text-red-600 uppercase leading-tight">{error}</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white/40 backdrop-blur-sm rounded-sm border border-ink/10 overflow-hidden flex flex-col h-[600px] md:col-span-3">
          <div className="p-4 border-b border-ink/10 bg-white/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-drafting-orange" />
              <h3 className="text-[12px] font-black uppercase tracking-widest text-ink/60">Generated Lineups</h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[12px] font-mono font-bold text-ink/40">{generatedLineups.length} Found</span>
              {generatedLineups.length > 0 && !isOptimizing && (
                <button 
                  onClick={exportToCSV}
                  className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 text-white rounded-sm text-[11px] font-black uppercase hover:opacity-90 transition-all shadow-lg shadow-emerald-600/20"
                >
                  <Download className="w-3 h-3" /> Export
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white/80 z-10 border-b border-ink/10">
                <tr className="text-[11px] font-black text-ink/40 uppercase tracking-widest">
                  <th
                    onClick={() => setLineupSort(nextSort(lineupSort, 'index', 'asc'))}
                    className="px-4 py-3 cursor-pointer select-none"
                  >
                    #{lineupSort.key === 'index' ? (lineupSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                  <th className="px-4 py-3 text-left">Players</th>
                  <th
                    onClick={() => setLineupSort(nextSort(lineupSort, 'projection', 'desc'))}
                    className="px-4 py-3 text-right cursor-pointer select-none"
                  >
                    Proj{lineupSort.key === 'projection' ? (lineupSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                  <th
                    onClick={() => setLineupSort(nextSort(lineupSort, 'actual', 'desc'))}
                    className="px-4 py-3 text-right cursor-pointer select-none"
                  >
                    Actual{lineupSort.key === 'actual' ? (lineupSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                  <th
                    onClick={() => setLineupSort(nextSort(lineupSort, 'salary', 'desc'))}
                    className="px-4 py-3 text-right cursor-pointer select-none"
                  >
                    Rem. Salary{lineupSort.key === 'salary' ? (lineupSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                </tr>
              </thead>
              <tbody className="text-[12px] font-mono">
                {sortedLineups.map((lineup, i) => {
                  const lineupPlayers = getLineupPlayers(lineup);
                  const names = lineupPlayers.map((p) => p.name).join(', ');
                  const actualTotal = getLineupActualTotal(lineup);
                  const remainingSalary = config.salaryCap - lineup.totalSalary;
                  const isExpanded = expandedLineupId === lineup.id;
                  return (
                    <React.Fragment key={lineup.id}>
                      <tr
                        onClick={() => setExpandedLineupId(isExpanded ? null : lineup.id)}
                        className="border-b border-ink/5 hover:bg-white/40 transition-colors group cursor-pointer"
                      >
                        <td className="px-4 py-3 text-ink/40">{i + 1}</td>
                        <td className="px-4 py-3 text-ink/70 max-w-[320px] truncate">{names || '—'}</td>
                        <td className="px-4 py-3 text-right font-black text-emerald-600">{lineup.totalProjection.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-bold text-ink/60">
                          {actualTotal !== null ? actualTotal.toFixed(2) : '--'}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-ink/60">
                          ${Math.max(0, remainingSalary).toLocaleString()}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-b border-ink/10 bg-ink/5">
                          <td colSpan={5} className="px-4 py-3">
                            <div className="grid grid-cols-1 gap-2">
                            <div className={`grid ${showActuals ? 'grid-cols-8' : 'grid-cols-7'} text-[11px] font-black uppercase tracking-widest text-ink/40`}>
                              <span className="col-span-2">Player</span>
                              <span className="text-right">Team</span>
                              <span className="text-right">Pos</span>
                              <span className="text-right">Salary</span>
                              <span className="text-right">Lev Tier</span>
                              <span className="text-right">Proj</span>
                              {showActuals && <span className="text-right">Actual</span>}
                            </div>
                            {lineupPlayers.map((player) => {
                              const actual = getPlayerActual(player);
                              const levTier = getLeverageTier(player);
                              const injuryInfo = getPlayerInjuryInfo(player, injuryLookup);
                              const startingInfo = getPlayerStartingLineupInfo(player, startingLineupLookup);
                              const showQuestionable = injuryInfo?.isQuestionable;
                              const reasonText = injuryInfo?.reason || 'Questionable';
                              const startStatus = startingInfo?.status;
                              const showStarter = startStatus === 'confirmed' || startStatus === 'expected';
                              return (
                                  <div key={player.id} className={`grid ${showActuals ? 'grid-cols-8' : 'grid-cols-7'} text-[13px] font-mono text-ink/70`}>
                                    <span className="col-span-2 font-bold text-ink">
                                      <button
                                        type="button"
                                        onClick={() => setSelectedPlayer(player)}
                                        className="flex items-center gap-2 text-left hover:underline"
                                      >
                                        <span>{player.name}</span>
                                        {showStarter && (
                                          <span
                                            className={`inline-flex items-center justify-center w-4 h-4 rounded-sm text-[9px] font-black text-white ${
                                              startStatus === 'confirmed' ? 'bg-emerald-600' : 'bg-yellow-500'
                                            }`}
                                            title={startStatus === 'confirmed' ? 'Starting (Confirmed)' : 'Starting (Expected)'}
                                          >
                                            S
                                          </span>
                                        )}
                                        {showQuestionable && (
                                          <span className="relative group">
                                            <span
                                              className="inline-flex items-center justify-center w-4 h-4 rounded-sm bg-drafting-orange text-white text-[9px] font-black"
                                              title={reasonText}
                                            >
                                              Q
                                            </span>
                                            <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-ink/20 bg-white px-2 py-1 text-[9px] font-bold text-ink shadow-lg group-hover:block">
                                              {reasonText}
                                            </span>
                                          </span>
                                        )}
                                      </button>
                                    </span>
                                    <span className="text-right">{(player.team || '--').toUpperCase()}</span>
                                    <span className="text-right">{player.position}</span>
                                    <span className="text-right">${player.salary.toLocaleString()}</span>
                                    <span className="text-right">{levTier ? levTier.toUpperCase() : '--'}</span>
                                    <span className="text-right">
                                      {Number.isFinite(Number(player.projection)) ? Number(player.projection).toFixed(2) : '--'}
                                    </span>
                                    {showActuals && (
                                      <span className="text-right">{actual !== null ? actual.toFixed(2) : '--'}</span>
                                    )}
                                  </div>
                              );
                            })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {generatedLineups.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-ink/40 font-black uppercase tracking-widest italic opacity-50">
                      No lineups generated yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white/40 backdrop-blur-sm rounded-sm border border-ink/10 overflow-hidden flex flex-col h-[600px] md:col-span-1">
          <div className="p-4 border-b border-ink/10 bg-white/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-drafting-orange" />
              <h3 className="text-[12px] font-black uppercase tracking-widest text-ink/60">Exposure Analysis</h3>
            </div>
            <span className="text-[12px] font-mono font-bold text-ink/40">{exposureStats.length} Players</span>
          </div>
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white/80 z-10 border-b border-ink/10">
                <tr className="text-[11px] font-black text-ink/40 uppercase tracking-widest">
                  <th
                    onClick={() => setExposureSort(nextSort(exposureSort, 'name', 'asc'))}
                    className="px-4 py-3 cursor-pointer select-none"
                  >
                    Player{exposureSort.key === 'name' ? (exposureSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                  <th
                    onClick={() => setExposureSort(nextSort(exposureSort, 'exposure', 'desc'))}
                    className="px-4 py-3 text-right cursor-pointer select-none"
                  >
                    Exposure{exposureSort.key === 'exposure' ? (exposureSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                </tr>
              </thead>
              <tbody className="text-[12px] font-mono">
                {sortedExposureStats.map((stat) => (
                  <tr key={stat.id} className="border-b border-ink/5 hover:bg-white/40 transition-colors">
                    <td className="px-4 py-3 text-ink font-bold uppercase truncate max-w-[120px]">{stat.name}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <div className="w-16 h-1.5 bg-ink/10 rounded-full overflow-hidden">
                          <div 
                            className={`h-full ${stat.exposure > config.maxExposure ? 'bg-red-600' : 'bg-drafting-orange'}`}
                            style={{ width: `${stat.exposure}%` }}
                          />
                        </div>
                        <span className={`font-black min-w-[40px] ${stat.exposure > config.maxExposure ? 'text-red-600' : 'text-ink/60'}`}>
                          {stat.exposure.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
                {exposureStats.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-4 py-12 text-center text-ink/40 font-black uppercase tracking-widest italic opacity-50">
                      Awaiting data...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAdvanced && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 backdrop-blur-sm">
          {showPoolFilterBuilder && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-vellum/60 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-2xl rounded-sm border border-ink/10 shadow-2xl flex flex-col max-h-[80vh]">
                <div className="p-6 border-b border-ink/10 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Filter className="w-5 h-5 text-drafting-orange" />
                    <h3 className="text-xl font-bold uppercase tracking-tight text-ink">Pool Filters</h3>
                  </div>
                  <button onClick={() => setShowPoolFilterBuilder(false)} className="p-2 hover:bg-ink/5 rounded-full transition-colors">
                    <X className="w-5 h-5 text-ink/40" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar bg-vellum/30">
                  {poolFilters.length === 0 ? (
                    <div className="text-center py-10 text-ink/40 font-medium uppercase tracking-widest text-sm">No filters active</div>
                  ) : (
                    poolFilters.map((f, i) => (
                      <div key={f.id} className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-sm border border-ink/10">
                        {i > 0 && (
                          <select
                            value={f.logic}
                            onChange={(e) => updatePoolFilter(f.id, { logic: e.target.value as 'AND' | 'OR' })}
                            className="bg-vellum border border-ink/20 rounded px-2 py-1 text-[10px] font-bold text-drafting-orange uppercase"
                          >
                            <option value="AND">AND</option>
                            <option value="OR">OR</option>
                          </select>
                        )}
                        <select
                          value={f.column}
                          onChange={(e) => updatePoolFilter(f.id, { column: e.target.value })}
                          className="bg-vellum border border-ink/20 rounded px-2 py-1 text-[10px] font-bold text-ink uppercase"
                        >
                          {POOL_FILTER_COLUMNS.map((c) => (
                            <option key={c.key} value={c.key}>{c.label}</option>
                          ))}
                        </select>
                        <select
                          value={f.operator}
                          onChange={(e) => updatePoolFilter(f.id, { operator: e.target.value as PoolFilterOperator })}
                          className="bg-vellum border border-ink/20 rounded px-2 py-1 text-[10px] font-bold text-ink uppercase"
                        >
                          <option value="contains">Contains</option>
                          <option value="equals">Equals</option>
                          <option value="gt">Greater Than</option>
                          <option value="lt">Less Than</option>
                          <option value="in">In (comma separated)</option>
                        </select>
                        <input
                          type="text"
                          value={f.value}
                          onChange={(e) => updatePoolFilter(f.id, { value: e.target.value })}
                          placeholder="Value..."
                          className="flex-1 min-w-[140px] bg-vellum border border-ink/20 rounded px-2 py-1 text-[10px] font-bold text-ink uppercase tracking-wide"
                        />
                        <button
                          onClick={() => removePoolFilter(f.id)}
                          className="ml-auto p-2 rounded-full hover:bg-red-100 text-red-600 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className="p-6 border-t border-ink/10 flex items-center justify-between">
                  <button
                    onClick={addPoolFilter}
                    className="flex items-center gap-2 px-4 py-2 border border-ink/20 rounded-sm text-[10px] font-bold uppercase tracking-widest text-ink hover:border-drafting-orange/40 hover:text-drafting-orange transition-all"
                  >
                    <PlusCircle className="w-4 h-4" /> Add Rule
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPoolFilters([])}
                      className="flex items-center gap-2 px-3 py-2 border border-ink/20 rounded-sm text-[10px] font-bold uppercase tracking-widest text-ink/60 hover:border-red-400 hover:text-red-600 transition-all"
                    >
                      <Trash2 className="w-4 h-4" /> Clear
                    </button>
                    <button
                      onClick={() => setShowPoolFilterBuilder(false)}
                      className="px-6 py-2 bg-drafting-orange text-white font-bold rounded-sm uppercase tracking-widest text-[10px] hover:opacity-90 transition-all"
                    >
                      Apply Filters
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="w-full max-w-6xl bg-white/95 border border-ink/10 rounded-sm shadow-xl p-6 h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-drafting-orange" />
                <h3 className="text-[11px] font-black uppercase tracking-widest text-ink/60">Advanced Settings</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdvanced(false)}
                className="text-[10px] font-black uppercase tracking-widest text-ink/50 hover:text-ink"
              >
                Close
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
              <div className="border border-ink/10 rounded-sm p-3 bg-white/60 overflow-hidden flex flex-col flex-1 min-h-0">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[12px] font-black uppercase tracking-widest text-ink/50">Player Pool</h4>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={poolSearch}
                      onChange={(e) => setPoolSearch(e.target.value)}
                      placeholder="Search players..."
                      className="bg-white/70 border border-ink/20 rounded-sm px-2 py-1 text-[12px] font-bold font-mono focus:border-drafting-orange outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPoolFilterBuilder(true)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase transition-all border ${
                        poolFilters.length > 0
                          ? 'bg-drafting-orange text-white border-drafting-orange shadow-lg'
                          : 'bg-white border-ink/20 text-ink/60 hover:bg-ink/5'
                      }`}
                    >
                      <Filter className="w-3.5 h-3.5" /> Filter {poolFilters.length > 0 && `(${poolFilters.length})`}
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-white/80 z-10 border-b border-ink/10">
                      <tr className="text-[11px] font-black text-ink/40 uppercase tracking-widest">
                        <th className="px-2 py-2">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="accent-drafting-orange"
                              checked={allVisibleLocked}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                if (visibleLockableIds.length === 0) return;
                                if (checked) {
                                  setLockedIds((prev) => {
                                    const next = new Set(prev);
                                    visibleLockableIds.forEach((id) => next.add(id));
                                    return Array.from(next);
                                  });
                                  setPlayerOverrides((prev) => {
                                    const next = { ...prev };
                                    visibleLockableIds.forEach((id) => {
                                      next[id] = {
                                        ...next[id],
                                        minExposure: 100,
                                        maxExposure: 100,
                                      };
                                    });
                                    return next;
                                  });
                                } else {
                                  setLockedIds((prev) => prev.filter((id) => !visibleLockableIds.includes(id)));
                                  setPlayerOverrides((prev) => {
                                    const next = { ...prev };
                                    visibleLockableIds.forEach((id) => {
                                      if (next[id]) {
                                        next[id] = {
                                          ...next[id],
                                          minExposure: undefined,
                                          maxExposure: undefined,
                                        };
                                      }
                                    });
                                    return next;
                                  });
                                }
                              }}
                            />
                            Lock
                          </label>
                        </th>
                        <th className="px-2 py-2">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="accent-drafting-orange"
                              checked={allVisibleExcluded}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                if (visiblePoolIds.length === 0) return;
                                setPlayerOverrides((prev) => {
                                  const next = { ...prev };
                                  visiblePoolIds.forEach((id) => {
                                    next[id] = {
                                      ...next[id],
                                      exclude: checked,
                                      minExposure: checked ? undefined : next[id]?.minExposure,
                                      maxExposure: checked ? undefined : next[id]?.maxExposure,
                                    };
                                  });
                                  return next;
                                });
                                if (checked) {
                                  setLockedIds((prev) => prev.filter((id) => !visiblePoolIds.includes(id)));
                                }
                              }}
                            />
                            Exclude
                          </label>
                        </th>
                        <th className="px-2 py-2">Player</th>
                        <th className="px-2 py-2">Team</th>
                        <th className="px-2 py-2">Opp</th>
                        <th className="px-2 py-2 text-right">Salary</th>
                        <th className="px-2 py-2 text-right">Value</th>
                        <th className="px-2 py-2 text-right">Signal</th>
                        <th className="px-2 py-2 text-right">Lev Tier</th>
                        <th className="px-2 py-2 text-right">Min</th>
                        <th className="px-2 py-2 text-right">FPTS</th>
                        <th className="px-2 py-2 text-right">Min Exp</th>
                        <th className="px-2 py-2 text-right">Max Exp</th>
                      </tr>
                    </thead>
                    <tbody className="text-[12px] font-mono">
                      {filteredPoolPlayers.map((player) => {
                        const overrides = playerOverrides[player.id] || {};
                        const displayMinutes = Number.isFinite(Number(overrides.minutes))
                          ? Number(overrides.minutes)
                          : (Number.isFinite(Number(player.minutesProjection)) ? Number(player.minutesProjection) : undefined);
                        const displayProjection = Number.isFinite(Number(overrides.projection))
                          ? Number(overrides.projection)
                          : (Number.isFinite(Number(player.projection)) ? Number(player.projection) : undefined);
                        const displayValue = player.salary > 0 && displayProjection !== undefined
                          ? displayProjection / (player.salary / 1000)
                          : undefined;
                        const isLocked = lockedIds.includes(player.id);
                        return (
                          <tr key={player.id} className="border-b border-ink/5">
                            <td className="px-2 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={isLocked}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  if (overrides.exclude) return;
                                  setLockedIds((prev) => checked
                                    ? [...prev, player.id]
                                    : prev.filter((id) => id !== player.id)
                                  );
                                  setPlayerOverrides((prev) => ({
                                    ...prev,
                                    [player.id]: {
                                      ...prev[player.id],
                                      minExposure: checked ? 100 : undefined,
                                      maxExposure: checked ? 100 : undefined,
                                    },
                                  }));
                                }}
                                disabled={Boolean(overrides.exclude)}
                                className="accent-drafting-orange disabled:opacity-50"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={Boolean(overrides.exclude)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  if (checked) {
                                    setLockedIds((prev) => prev.filter((id) => id !== player.id));
                                  }
                                  setPlayerOverrides((prev) => ({
                                    ...prev,
                                    [player.id]: {
                                      ...prev[player.id],
                                      exclude: checked,
                                      minExposure: checked ? undefined : prev[player.id]?.minExposure,
                                      maxExposure: checked ? undefined : prev[player.id]?.maxExposure,
                                    },
                                  }));
                                }}
                                className="accent-drafting-orange"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-ink/70 truncate max-w-[160px]">{player.name}</td>
                            <td className="px-2 py-1.5 text-ink/50">{player.team || '--'}</td>
                            <td className="px-2 py-1.5 text-ink/50">{player.opponent || '--'}</td>
                            <td className="px-2 py-1.5 text-right text-ink/60">
                              ${Number(player.salary || 0).toLocaleString()}
                            </td>
                            <td className="px-2 py-1.5 text-right text-ink/60">
                              {displayValue !== undefined ? displayValue.toFixed(2) : '--'}
                            </td>
                            <td className="px-2 py-1.5 text-right text-ink/70">
                              {getSignalLabel(player)}
                            </td>
                            <td className="px-2 py-1.5 text-right text-ink/70 uppercase">
                              {getLeverageTier(player) ?? '--'}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <input
                                type="number"
                                value={displayMinutes !== undefined ? displayMinutes.toFixed(2) : ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPlayerOverrides((prev) => ({
                                    ...prev,
                                    [player.id]: { ...prev[player.id], minutes: val === '' ? undefined : Number(val) },
                                  }));
                                }}
                                className="w-16 bg-white/70 border border-ink/20 rounded-sm px-1 py-0.5 text-[12px] font-bold font-mono text-right"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <input
                                type="number"
                                value={displayProjection !== undefined ? displayProjection.toFixed(2) : ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setPlayerOverrides((prev) => ({
                                    ...prev,
                                    [player.id]: { ...prev[player.id], projection: val === '' ? undefined : Number(val) },
                                  }));
                                }}
                                className="w-20 bg-white/70 border border-ink/20 rounded-sm px-1 py-0.5 text-[12px] font-bold font-mono text-right"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <input
                                type="number"
                                value={isLocked ? 100 : (overrides.minExposure ?? '')}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (isLocked) return;
                                  setPlayerOverrides((prev) => ({
                                    ...prev,
                                    [player.id]: { ...prev[player.id], minExposure: val === '' ? undefined : Number(val) },
                                  }));
                                }}
                                disabled={isLocked}
                                className="w-16 bg-white/70 border border-ink/20 rounded-sm px-1 py-0.5 text-[12px] font-bold font-mono text-right disabled:opacity-60"
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <input
                                type="number"
                                value={isLocked ? 100 : (overrides.maxExposure ?? '')}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (isLocked) return;
                                  setPlayerOverrides((prev) => ({
                                    ...prev,
                                    [player.id]: { ...prev[player.id], maxExposure: val === '' ? undefined : Number(val) },
                                  }));
                                }}
                                disabled={isLocked}
                                className="w-16 bg-white/70 border border-ink/20 rounded-sm px-1 py-0.5 text-[12px] font-bold font-mono text-right disabled:opacity-60"
                              />
                            </td>
                          </tr>
                        );
                      })}
                      {filteredPoolPlayers.length === 0 && (
                        <tr>
                          <td colSpan={13} className="px-2 py-6 text-center text-[12px] text-ink/40 font-black uppercase tracking-widest">
                            No players found
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 overflow-hidden">
                <div className="border border-ink/10 rounded-sm p-3 bg-white/60">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-ink/50 mb-2">Team Stack Priority</h4>
                  <div className="space-y-3">
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-widest text-ink/40 mb-1">Matchups</div>
                      <div className="flex overflow-x-auto gap-2 pb-1 scrollbar-hide">
                        {games.map((game) => {
                          const isSelected = selectedMatchups.includes(game.matchupKey);
                          return (
                            <div
                              key={game.matchupKey}
                              onClick={() => {
                                setSelectedMatchups((prev) => isSelected
                                  ? prev.filter((k) => k !== game.matchupKey)
                                  : [...prev, game.matchupKey]
                                );
                              }}
                              className={`flex-shrink-0 w-32 bg-white/70 rounded-sm p-2 border transition-colors cursor-pointer ${
                                isSelected ? 'border-drafting-orange bg-drafting-orange/10' : 'border-ink/10 hover:border-drafting-orange/40'
                              }`}
                            >
                              <div className="flex items-center justify-center gap-1 text-[11px] font-black italic text-ink">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const teamId = game.teamA.teamId;
                                    setSelectedTeams((prev) => prev.includes(teamId)
                                      ? prev.filter((t) => t !== teamId)
                                      : [...prev, teamId]
                                    );
                                  }}
                                  className={`transition-colors px-1.5 py-0.5 rounded-sm ${
                                    selectedTeams.includes(game.teamA.teamId)
                                      ? 'text-white bg-drafting-orange'
                                      : 'text-ink hover:text-drafting-orange'
                                  }`}
                                >
                                  {game.teamA.abbreviation}
                                </button>
                                <span className="text-[9px] text-ink/40 font-mono">@</span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const teamId = game.teamB.teamId;
                                    setSelectedTeams((prev) => prev.includes(teamId)
                                      ? prev.filter((t) => t !== teamId)
                                      : [...prev, teamId]
                                    );
                                  }}
                                  className={`transition-colors px-1.5 py-0.5 rounded-sm ${
                                    selectedTeams.includes(game.teamB.teamId)
                                      ? 'text-white bg-drafting-orange'
                                      : 'text-ink hover:text-drafting-orange'
                                  }`}
                                >
                                  {game.teamB.abbreviation}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] font-black uppercase tracking-widest text-ink/40 mb-1">Teams</div>
                      <div className="flex flex-wrap gap-2">
                        {teamOptions.map((team) => {
                          const selected = selectedTeams.includes(team);
                          return (
                            <button
                              key={team}
                              type="button"
                              onClick={() => {
                                setSelectedTeams((prev) => selected ? prev.filter((t) => t !== team) : [...prev, team]);
                              }}
                              className={`px-2 py-1 rounded-sm text-[10px] font-black uppercase tracking-widest border ${
                                selected ? 'bg-drafting-orange text-white border-drafting-orange' : 'border-ink/20 text-ink/60 hover:border-drafting-orange/40 hover:text-ink'
                              }`}
                            >
                              {team}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border border-ink/10 rounded-sm p-3 bg-white/60">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-ink/50 mb-2">Locked Players</h4>
                  <div className="flex flex-wrap gap-2">
                    {lockedIds.map((id) => {
                      const player = players.find((p) => p.id === id);
                      return (
                        <span key={id} className="inline-flex items-center gap-2 bg-ink/5 border border-ink/15 rounded-sm px-2 py-1 text-[10px] font-bold text-ink/70">
                          {player?.name || id}
                          <button
                            type="button"
                            onClick={() => {
                              setLockedIds((prev) => prev.filter((pid) => pid !== id));
                              setPlayerOverrides((prev) => ({
                                ...prev,
                                [id]: { ...prev[id], minExposure: undefined, maxExposure: undefined },
                              }));
                            }}
                            className="text-ink/40 hover:text-ink"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                    {lockedIds.length === 0 && (
                      <span className="text-[10px] font-mono text-ink/40">No locked players</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-ink/10 mt-4 flex items-center justify-between">
              <div className="text-[9px] font-mono text-ink/40">
                Saved settings apply to optimizer runs.
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearAdvancedSettings}
                  className="px-4 py-2 border border-ink/20 rounded-sm text-[10px] font-black uppercase tracking-widest text-ink/60 hover:border-red-600/40 hover:text-red-600"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={saveAdvancedSettings}
                  className="px-4 py-2 bg-drafting-orange text-white rounded-sm text-[10px] font-black uppercase tracking-widest hover:opacity-90"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isOptimizing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-white/90 border border-ink/10 rounded-sm shadow-xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-sm bg-drafting-orange/20 animate-pulse">
                <Zap className="w-5 h-5 text-drafting-orange" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-tight text-ink">Optimization in Progress</h3>
                <p className="text-[10px] text-ink/60 font-bold uppercase tracking-widest mt-1 font-mono">
                  Generating {config.numLineups} lineups...
                </p>
              </div>
            </div>
            <div className="relative h-2 bg-ink/10 rounded-full overflow-hidden">
              <div 
                className="absolute top-0 left-0 h-full bg-drafting-orange transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-[9px] font-black text-ink/40 uppercase tracking-widest font-mono">
              <span>Progress</span>
              <span className="text-drafting-orange">{progress}%</span>
            </div>
            <div className="mt-5 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-ink/50">
                {generatedLineups.length} lineups found
              </span>
              <button
                type="button"
                onClick={stopOptimization}
                className="px-4 py-2 bg-red-600 text-white rounded-sm text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-all"
              >
                Stop
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

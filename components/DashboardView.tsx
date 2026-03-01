import React, { useMemo, useState, useEffect } from 'react';
import { Player, GameInfo } from '../types';
import { getPlayerInjuryInfo, InjuryLookup } from '../utils/injuries';
import { getPlayerStartingLineupInfo, StartingLineupLookup } from '../utils/startingLineups';
import { MatchupEngine } from './MatchupEngine';
import { PlayerDeepDive } from './PlayerDeepDive';
import { Search, Activity, BarChart3, Database, Filter, X, Trash2, PlusCircle } from 'lucide-react';

interface Props {
  players: Player[];
  games: GameInfo[];
  isHistorical: boolean;
  showActuals: boolean;
  injuryLookup?: InjuryLookup | null;
  depthCharts?: any | null;
  startingLineupLookup?: StartingLineupLookup | null;
}

interface FilterRule {
  id: string;
  column: string;
  operator: Operator;
  value: string;
  logic: 'AND' | 'OR';
}

type Operator = 'equals' | 'contains' | 'gt' | 'lt' | 'in';

const ALL_MATCHUPS_KEY = 'ALL_MATCHUPS';

const formatSalaryK = (salary: number): string => {
  if (!Number.isFinite(salary)) return '--';
  return `$${(salary / 1000).toFixed(1)}K`;
};

const FILTER_COLUMNS = [
  { key: 'name', label: 'Player' },
  { key: 'team', label: 'Team' },
  { key: 'opponent', label: 'Opp' },
  { key: 'position', label: 'Pos' },
  { key: 'salary', label: 'Salary' },
  { key: 'value', label: 'Value' },
  { key: 'leverageTier', label: 'Lev Tier' },
  { key: 'ownership', label: 'Own%' },
  { key: 'usageRate', label: 'Usage' },
  { key: 'minutesProjection', label: 'Min' },
  { key: 'signal', label: 'Signal' },
  { key: 'projection', label: 'Proj' },
  { key: 'ceiling', label: 'Ceiling' },
  { key: 'floor', label: 'Floor' },
  { key: 'actual', label: 'Actual' },
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

const AST_KEYS = ['AST', 'assists', 'assist', 'A', 'ASTS', 'APG'];

const readStatNumber = (player: Player, keys: string[]): number | undefined => {
  const fromAdvanced = readByKeys(player.advancedMetrics as any, keys);
  const fromSlate = readByKeys(player.slateData as any, keys);
  const fromProfile = readByKeys(player.statsProfile as any, keys);
  const fromPlayer = readByKeys(player as any, keys);
  const raw = fromAdvanced !== undefined
    ? fromAdvanced
    : (fromSlate !== undefined ? fromSlate : (fromProfile !== undefined ? fromProfile : fromPlayer));
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
};

const readStatString = (player: Player, keys: string[]): string | undefined => {
  const fromAdvanced = readByKeys(player.advancedMetrics as any, keys);
  const fromSlate = readByKeys(player.slateData as any, keys);
  const fromProfile = readByKeys(player.statsProfile as any, keys);
  const fromPlayer = readByKeys(player as any, keys);
  const raw = fromAdvanced !== undefined
    ? fromAdvanced
    : (fromSlate !== undefined ? fromSlate : (fromProfile !== undefined ? fromProfile : fromPlayer));
  if (raw === undefined || raw === null) return undefined;
  return String(raw);
};

const readPercentLike = (player: Player, keys: string[]): number | undefined => {
  const fromAdvanced = readByKeys(player.advancedMetrics as any, keys);
  const fromSlate = readByKeys(player.slateData as any, keys);
  const fromProfile = readByKeys(player.statsProfile as any, keys);
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

const getLeverageTier = (player: Player): string | undefined => {
  const tier = readStatString(player, [
    'leverageTier',
    'leverage_tier',
    'LEVERAGE_TIER',
    'LEV_TIER',
    'leverageTierLabel',
    'leverageTierName',
    'leverage_tier_label',
    'leverage_tier_name',
  ]);
  return tier ? tier.trim() : undefined;
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
  const defOn = readStatNumber(player, ['defOnSamplePossessions', 'def_on_sample_possessions']) ?? 0;
  const defOff = readStatNumber(player, ['defOffSamplePossessions', 'def_off_sample_possessions']) ?? 0;
  const conf = Math.min(1, (defOn + defOff) / 2000);
  return conf * 100;
};

const getImpactFp = (player: Player): number | null => {
  const impact = readStatNumber(player, [
    'DEF_SIGNAL_ONOFF_IMPACT_FP',
    'def_signal_onoff_impact_fp',
    'onOffImpactFp',
  ]);
  if (Number.isFinite(Number(impact))) return Number(impact);

  const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));
  const usageRate = readStatNumber(player, ['usageRate', 'usage_rate', 'USG%', 'USAGE_PCT']) ?? 0;
  const minutesProjection = readStatNumber(player, ['minutesProjection', 'minutes', 'min', 'MINUTES_PROJ']) ?? 0;
  const oppOnOffFpDiff = readStatNumber(player, [
    'oppDefOnOffFpAllowedDiff',
    'opp_def_on_off_fp_allowed_diff',
    'oppDefOnOffFpDiff',
    'opp_def_on_off_fp_diff',
  ]) ?? 0;
  const usageFrac = usageRate / 100;
  const minuteShare = clamp(minutesProjection / 48, 0, 1);
  const involvementScore = clamp((0.5 * usageFrac) + (0.5 * minuteShare), 0.15, 0.65);
  const teamEnvFp = oppOnOffFpDiff * 0.98;
  return teamEnvFp * involvementScore;
};

const getImpactTier = (player: Player): string | null => {
  const tier = readStatString(player, [
    'DEF_SIGNAL_ONOFF_IMPACT_TIER',
    'def_signal_onoff_impact_tier',
    'onOffImpactTier',
  ]);
  if (!tier) return null;
  return tier.trim().toLowerCase();
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

const getSignalRank = (player: Player): number => {
  const tier = getImpactTier(player);
  if (!tier) return -Infinity;
  if (tier.includes('strong boost')) return 5;
  if (tier === 'boost') return 4;
  if (tier === 'neutral') return 3;
  if (tier === 'fade') return 2;
  if (tier.includes('strong fade')) return 1;
  return 0;
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

const getDvpTextClass = (tier: DvpTextTier): string => {
  if (tier === 'twoGreen') return 'text-emerald-600';
  if (tier === 'oneGreen') return 'text-emerald-500';
  if (tier === 'allBlack') return 'text-ink/70';
  return 'text-ink';
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

export const DashboardView: React.FC<Props> = ({ players, games, isHistorical, showActuals, injuryLookup, depthCharts, startingLineupLookup }) => {
  const [search, setSearch] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedMatchupKey, setSelectedMatchupKey] = useState<string>(ALL_MATCHUPS_KEY);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState<string>('projection');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [salaryTab, setSalaryTab] = useState<'ALL' | 'ELITE' | 'MID' | 'VALUE' | 'PUNT'>('ALL');

  const addFilter = () => {
    const newFilter: FilterRule = {
      id: Math.random().toString(36).substr(2, 9),
      column: FILTER_COLUMNS[0]?.key ?? 'name',
      operator: 'contains',
      value: '',
      logic: 'AND',
    };
    setFilters((prev) => [...prev, newFilter]);
  };

  const removeFilter = (id: string) => setFilters((prev) => prev.filter((f) => f.id !== id));
  const updateFilter = (id: string, updates: Partial<FilterRule>) => {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  const effectiveGames = useMemo<GameInfo[]>(() => {
    if (games.length > 0) return games;

    const inferred = new Map<string, GameInfo>();
    const toTeam = (teamId: string) => ({
      teamId,
      abbreviation: teamId,
      name: teamId,
      seasonStats: { pace: 100, offensiveEfficiency: 112, defensiveEfficiency: 112 },
      positionalDvP: {},
    });

    players.forEach((player) => {
      const team = String(player.team || '').toUpperCase();
      let opp = String(player.opponent || '').toUpperCase();

      if (!team) return;
      if (!opp) {
        const parsed = parseMatchup((player as any)['Game Info'] ?? (player as any).gameInfo);
        if (parsed) {
          opp = team === parsed.away ? parsed.home : team === parsed.home ? parsed.away : '';
        }
      }
      if (!opp || opp === team) return;

      const sorted = [team, opp].sort((a, b) => a.localeCompare(b));
      const matchupKey = `${sorted[0]}_vs_${sorted[1]}`;
      if (!inferred.has(matchupKey)) {
        inferred.set(matchupKey, {
          matchupKey,
          teamA: toTeam(sorted[0]),
          teamB: toTeam(sorted[1]),
          gameTime: 'TBD',
          spread: 0,
          overUnder: 0,
        });
      }
    });

    return Array.from(inferred.values());
  }, [games, players]);

  const matchupMap = useMemo(
    () => new Map(effectiveGames.map((game) => [game.matchupKey, game])),
    [effectiveGames]
  );

  const teamAbbrevMap = useMemo(() => {
    const map = new Map<string, string>();
    effectiveGames.forEach((game) => {
      if (game.teamA?.teamId && game.teamA?.abbreviation) {
        map.set(game.teamA.teamId, game.teamA.abbreviation);
      }
      if (game.teamB?.teamId && game.teamB?.abbreviation) {
        map.set(game.teamB.teamId, game.teamB.abbreviation);
      }
    });
    return map;
  }, [effectiveGames]);

  useEffect(() => {
    if (selectedMatchupKey !== ALL_MATCHUPS_KEY && !matchupMap.has(selectedMatchupKey)) {
      setSelectedMatchupKey(ALL_MATCHUPS_KEY);
    }

    const activeTeamIds = new Set<string>();
    effectiveGames.forEach((game) => {
      activeTeamIds.add(game.teamA.teamId);
      activeTeamIds.add(game.teamB.teamId);
    });
    setSelectedTeams((prev) => prev.filter((team) => activeTeamIds.has(team)));
  }, [effectiveGames, matchupMap, selectedMatchupKey]);

  const filteredPlayers = useMemo(() => {
    let pool = players;

    if (selectedTeams.length > 0) {
      const teamSet = new Set(selectedTeams);
      pool = pool.filter((player) => teamSet.has(player.team));
    } else if (selectedMatchupKey !== ALL_MATCHUPS_KEY) {
      const matchup = matchupMap.get(selectedMatchupKey);
      if (matchup) {
        const matchupTeams = new Set([matchup.teamA.teamId, matchup.teamB.teamId]);
        pool = pool.filter((player) => matchupTeams.has(player.team));
      }
    }

    if (salaryTab !== 'ALL') {
      pool = pool.filter((player) => {
        const salary = Number(player.salary) || 0;
        if (salaryTab === 'ELITE') return salary >= 8900;
        if (salaryTab === 'MID') return salary >= 6500 && salary <= 8800;
        if (salaryTab === 'VALUE') return salary >= 4500 && salary <= 6400;
        if (salaryTab === 'PUNT') return salary < 4400;
        return true;
      });
    }

    if (search.trim()) {
      const term = search.toLowerCase();
      pool = pool.filter((player) => player.name.toLowerCase().includes(term));
    }

    const getActual = (player: Player): number => {
      const actualVal = Number(
        player.actual ??
        player.actualFpts ??
        player.actual_fpts ??
        player.history?.[player.history.length - 1]?.fpts
      );
      return Number.isFinite(actualVal) ? actualVal : -Infinity;
    };

    const getSortValue = (player: Player, key: string): any => {
      switch (key) {
        case 'name': return player.name;
        case 'team': return player.team;
        case 'position': return player.position;
        case 'opponent': return teamAbbrevMap.get(player.opponent) || player.opponent || '';
        case 'salary': return player.salary;
        case 'value': return player.salary > 0 ? (player.projection / (player.salary / 1000)) : 0;
        case 'leverageTier': return getLeverageTier(player) ?? '';
        case 'ownership': return player.ownership ?? -Infinity;
        case 'usageRate': return player.usageRate ?? -Infinity;
        case 'minutesProjection': return player.minutesProjection ?? -Infinity;
        case 'signal': return getSignalRank(player);
        case 'projection': return player.projection;
        case 'ceiling': return player.ceiling ?? -Infinity;
        case 'floor': return player.floor ?? -Infinity;
        case 'actual': return getActual(player);
        default: return (player as any)[key];
      }
    };

    const getFilterValue = (player: Player, key: string): any => {
      switch (key) {
        case 'name': return player.name;
        case 'team': return player.team;
        case 'position': return player.position;
        case 'opponent': return teamAbbrevMap.get(player.opponent) || player.opponent || '';
        case 'salary': return player.salary;
        case 'value': return player.salary > 0 ? (player.projection / (player.salary / 1000)) : 0;
        case 'leverageTier': return getLeverageTier(player) ?? '';
        case 'ownership': return player.ownership;
        case 'usageRate': return player.usageRate;
        case 'minutesProjection': return player.minutesProjection;
        case 'signal': return getSignalLabel(player);
        case 'projection': return player.projection;
        case 'ceiling': return player.ceiling;
        case 'floor': return player.floor;
        case 'actual': return getActual(player);
        default: return (player as any)[key];
      }
    };

    if (filters.length > 0) {
      pool = pool.filter((player) => {
        let match = true;
        filters.forEach((f, idx) => {
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

    const compareValues = (a: any, b: any): number => {
      const aEmpty = a === null || a === undefined || a === '' || a === -Infinity;
      const bEmpty = b === null || b === undefined || b === '' || b === -Infinity;
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const nA = Number(a);
      const nB = Number(b);
      if (Number.isFinite(nA) && Number.isFinite(nB)) return nA - nB;
      return String(a).localeCompare(String(b));
    };

    return [...pool]
      .sort((a, b) => {
        const cmp = compareValues(getSortValue(a, sortKey), getSortValue(b, sortKey));
        return sortDir === 'asc' ? cmp : -cmp;
      })
      .slice(0, 30);
  }, [players, search, selectedMatchupKey, selectedTeams, matchupMap, sortKey, sortDir, teamAbbrevMap, filters, salaryTab]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const sortIndicator = (key: string) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const toggleMatchup = (matchupKey: string) => {
    setSelectedTeams([]);
    setSelectedMatchupKey((prev) => (prev === matchupKey ? ALL_MATCHUPS_KEY : matchupKey));
  };

  const toggleTeam = (teamId: string) => {
    setSelectedMatchupKey(ALL_MATCHUPS_KEY);
    setSelectedTeams((prev) => (
      prev.includes(teamId)
        ? prev.filter((team) => team !== teamId)
        : [...prev, teamId]
    ));
  };

  const clearMatchupFilters = () => {
    setSelectedMatchupKey(ALL_MATCHUPS_KEY);
    setSelectedTeams([]);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {showFilterBuilder && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-vellum/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-2xl rounded-sm border border-ink/10 shadow-2xl flex flex-col max-h-[80vh]">
            <div className="p-6 border-b border-ink/10 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-drafting-orange" />
                <h3 className="text-xl font-bold uppercase tracking-tight text-ink">Active Filters</h3>
              </div>
              <button onClick={() => setShowFilterBuilder(false)} className="p-2 hover:bg-ink/5 rounded-full transition-colors">
                <X className="w-5 h-5 text-ink/40" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4 no-scrollbar bg-vellum/30">
              {filters.length === 0 ? (
                <div className="text-center py-10 text-ink/40 font-medium uppercase tracking-widest text-sm">No filters active</div>
              ) : (
                filters.map((f, i) => (
                  <div key={f.id} className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-sm border border-ink/10">
                    {i > 0 && (
                      <select
                        value={f.logic}
                        onChange={(e) => updateFilter(f.id, { logic: e.target.value as 'AND' | 'OR' })}
                        className="bg-vellum border border-ink/20 rounded px-2 py-1 text-[10px] font-bold text-drafting-orange uppercase"
                      >
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                      </select>
                    )}
                    <select
                      value={f.column}
                      onChange={(e) => updateFilter(f.id, { column: e.target.value })}
                      className="flex-1 min-w-[120px] bg-vellum border border-ink/20 rounded px-3 py-2 text-xs font-bold text-ink outline-none focus:border-drafting-orange"
                    >
                      {FILTER_COLUMNS.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                    <select
                      value={f.operator}
                      onChange={(e) => updateFilter(f.id, { operator: e.target.value as Operator })}
                      className="bg-vellum border border-ink/20 rounded px-3 py-2 text-xs font-bold text-ink outline-none focus:border-drafting-orange"
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
                      onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                      placeholder="Value..."
                      className="flex-1 min-w-[120px] bg-vellum border border-ink/20 rounded px-3 py-2 text-xs font-bold text-ink outline-none focus:border-drafting-orange placeholder:text-ink/30"
                    />
                    <button onClick={() => removeFilter(f.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
              <button
                onClick={addFilter}
                className="w-full py-4 border-2 border-dashed border-ink/20 rounded-sm flex items-center justify-center gap-2 text-ink/40 hover:text-drafting-orange hover:border-drafting-orange/50 transition-all font-bold uppercase text-xs"
              >
                <PlusCircle className="w-4 h-4" /> Add Rule
              </button>
            </div>
            <div className="p-6 border-t border-ink/10 flex justify-end">
              <button onClick={() => setShowFilterBuilder(false)} className="px-8 py-3 bg-drafting-orange text-white font-bold rounded-sm uppercase tracking-widest text-xs hover:opacity-90 transition-all">
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white/40 border border-ink/10 rounded-sm p-4 flex items-center gap-4 shadow-sm">
          <div className="bg-emerald-600/10 p-3 rounded-sm">
            <Activity className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <div className="text-[10px] font-black text-ink/60 uppercase tracking-widest">SLATE</div>
            <div className="text-xl font-black italic uppercase tracking-tighter text-emerald-600">
              {effectiveGames.length} GAMES
            </div>
          </div>
        </div>
        <div className="bg-white/40 border border-ink/10 rounded-sm p-4 flex items-center gap-4 shadow-sm">
          <div className="bg-ink/5 p-3 rounded-sm">
            <Database className="w-6 h-6 text-ink/60" />
          </div>
          <div>
            <div className="text-[10px] font-black text-ink/60 uppercase tracking-widest">Player Pool</div>
            <div className="text-xl font-black italic uppercase tracking-tighter text-ink/60">
              {players.length} PLAYERS
            </div>
          </div>
        </div>
      </div>

      <MatchupEngine
        players={players}
        games={effectiveGames}
        selectedMatchupKey={selectedMatchupKey}
        selectedTeams={selectedTeams}
        onSelectAllMatchups={clearMatchupFilters}
        onToggleMatchup={toggleMatchup}
        onToggleTeam={toggleTeam}
      />

      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white/40 backdrop-blur-sm rounded-sm border border-ink/10 p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-drafting-orange" />
              <h3 className="text-xs font-black uppercase tracking-widest text-ink/60">Player Projections</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowFilterBuilder(true)}
              className={`flex items-center gap-2 px-3 py-2 rounded-sm text-[10px] font-bold uppercase transition-all border ${
                filters.length > 0
                  ? 'bg-drafting-orange text-white border-drafting-orange shadow-lg'
                  : 'bg-white border-ink/20 text-ink/60 hover:bg-ink/5'
              }`}
            >
              <Filter className="w-3.5 h-3.5" /> Filter {filters.length > 0 && `(${filters.length})`}
            </button>
          </div>

          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" />
            <input
              type="text"
              placeholder="SEARCH PLAYER FOR ANALYTICS..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/60 border border-ink/20 rounded-sm pl-10 pr-4 py-2.5 text-xs font-bold text-ink focus:border-drafting-orange outline-none transition-all placeholder:text-ink/30 uppercase tracking-widest"
            />
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {([
              { key: 'ALL', label: 'ALL' },
              { key: 'ELITE', label: 'ELITE' },
              { key: 'MID', label: 'MID-RANGE' },
              { key: 'VALUE', label: 'VALUE' },
              { key: 'PUNT', label: 'PUNT' },
            ] as const).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSalaryTab(tab.key)}
                className={`px-3 py-1.5 rounded-sm text-[10px] font-black uppercase tracking-widest border transition-all ${
                  salaryTab === tab.key
                    ? 'bg-drafting-orange text-white border-drafting-orange shadow-sm'
                    : 'bg-white/60 border-ink/20 text-ink/60 hover:border-drafting-orange/40 hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto border border-ink/10 rounded-sm bg-white/30">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-[9px] font-black text-ink/40 uppercase tracking-widest border-b border-ink/10 bg-white/40">
                    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleSort('name')}>
                      Player{sortIndicator('name')}
                    </th>
                    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleSort('team')}>
                      Team{sortIndicator('team')}
                    </th>
                    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleSort('opponent')}>
                      OPP{sortIndicator('opponent')}
                    </th>
                    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleSort('position')}>
                      Pos{sortIndicator('position')}
                    </th>
                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort('salary')}>
                      Salary{sortIndicator('salary')}
                    </th>
                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort('value')}>
                      Value{sortIndicator('value')}
                    </th>
                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort('leverageTier')}>
                      Lev Tier{sortIndicator('leverageTier')}
                    </th>
                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort('ownership')}>
                      Own{sortIndicator('ownership')}
                    </th>
                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort('usageRate')}>
                      Usage{sortIndicator('usageRate')}
                    </th>
                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort('minutesProjection')}>
                      Min{sortIndicator('minutesProjection')}
                    </th>
                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort('signal')}>
                      Signal{sortIndicator('signal')}
                    </th>
                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort('projection')}>
                      Proj{sortIndicator('projection')}
                    </th>
                    {showActuals && (
                      <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort('actual')}>
                        Actual{sortIndicator('actual')}
                      </th>
                    )}
                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort('ceiling')}>
                      Ceiling{sortIndicator('ceiling')}
                    </th>
                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleSort('floor')}>
                      Floor{sortIndicator('floor')}
                    </th>
                  </tr>
                </thead>
              <tbody className="text-[13px] font-mono">
                {filteredPlayers.length > 0 ? (
                  filteredPlayers.map((player) => {
                    const injuryInfo = getPlayerInjuryInfo(player, injuryLookup);
                    const startingInfo = getPlayerStartingLineupInfo(player, startingLineupLookup);
                    const showQuestionable = injuryInfo?.isQuestionable;
                    const reasonText = injuryInfo?.reason || 'Questionable';
                    const startStatus = startingInfo?.status;
                    const showStarter = startStatus === 'confirmed' || startStatus === 'expected';
                    const opponentTeam = getOpponentTeamForPlayer(player, effectiveGames);
                    const positions = parsePositions(player.position);
                    const dvp = opponentTeam?.positionalDvP || {};
                    const blendConfPct = getBlendConfidencePct(player);
                    const reliabilityOk = (blendConfPct ?? 0) >= 95;
                    const neutralOrBetter = isNeutralOrBetterSignal(player);
                    const impactTier = getImpactTier(player) ?? '';
                    const isNeutralSignal = impactTier === 'neutral';

                    const dvpNet = countDvpNet(positions, dvp, player);
                    const overallPositiveDvp = dvpNet > 0;
                    const usageRate = readPercentLike(player, ['usageRate', 'usage_rate', 'USG%', 'USAGE_PCT']) ?? 0;
                    const minutesProj = readStatNumber(player, ['minutesProjection', 'minutes', 'min', 'MINUTES_PROJ']) ?? 0;
                    const leverageTier = getLeverageTier(player);
                    const blendDiff = readStatNumber(player, [
                      'DEF_SIGNAL_ONOFF_BLEND_DIFF',
                      'def_signal_onoff_blend_diff',
                      'onOffBlendDiff',
                    ]) ?? 0;
                    const strongBoostEnv = impactTier.includes('strong boost') && blendDiff > 3.0;

                    const overrideAll = overallPositiveDvp &&
                      (blendConfPct ?? 0) >= 80 &&
                      usageRate > 27 &&
                      minutesProj >= 34.9;

                    const isHighlighted = ((reliabilityOk && neutralOrBetter) && !isNeutralSignal) || overrideAll || strongBoostEnv;
                    const dvpTextTier = isHighlighted ? getBestDvpTextTier(positions, dvp, player) : 'mixed';
                    const nameTextClass = isHighlighted ? getDvpTextClass(dvpTextTier) : 'text-ink';
                    return (
                    <tr
                      key={player.id}
                      onClick={() => setSelectedPlayer(player)}
                      className={`border-b border-ink/5 hover:bg-white/70 cursor-pointer transition-colors ${
                        isHighlighted ? 'bg-emerald-500/10' : ''
                      }`}
                    >
                      <td className={`px-3 py-2 font-black uppercase tracking-tight ${nameTextClass}`}>
                        <div className="flex items-center gap-2">
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
                        </div>
                      </td>
                      <td className="px-3 py-2 text-ink/60">{player.team}</td>
                      <td className="px-3 py-2 text-ink/60">
                        {(teamAbbrevMap.get(player.opponent) || player.opponent || '--').toString().toUpperCase()}
                      </td>
                      <td className="px-3 py-2 text-ink/60">{player.position}</td>
                      <td className="px-3 py-2 text-right text-ink/60">{formatSalaryK(player.salary)}</td>
                      <td className="px-3 py-2 text-right text-ink/60">
                        {player.salary > 0 ? (player.projection / (player.salary / 1000)).toFixed(2) : '--'}
                      </td>
                      <td className="px-3 py-2 text-right text-ink/60 uppercase">
                        {leverageTier ?? '--'}
                      </td>
                      <td className="px-3 py-2 text-right text-ink/60">
                        {player.ownership !== undefined ? `${Number(player.ownership).toFixed(1)}%` : '--'}
                      </td>
                      <td className="px-3 py-2 text-right text-ink/60">
                        {player.usageRate !== undefined ? `${player.usageRate.toFixed(1)}%` : '--'}
                      </td>
                      <td className="px-3 py-2 text-right text-ink/60">
                        {player.minutesProjection !== undefined ? player.minutesProjection.toFixed(1) : '--'}
                      </td>
                      <td className="px-3 py-2 text-right text-ink/60">
                        {getSignalLabel(player)}
                      </td>
                      <td className="px-3 py-2 text-right font-black text-drafting-orange">
                        {player.projection.toFixed(2)}
                      </td>
                      {showActuals && (
                        <td className="px-3 py-2 text-right font-black text-emerald-600">
                          {(() => {
                            const actualVal = Number(
                              player.actual ??
                              player.actualFpts ??
                              player.actual_fpts ??
                              player.history?.[player.history.length - 1]?.fpts
                            );
                            return Number.isFinite(actualVal) ? actualVal.toFixed(2) : '--';
                          })()}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right text-ink/60">
                        {player.ceiling !== undefined ? Number(player.ceiling).toFixed(2) : '--'}
                      </td>
                      <td className="px-3 py-2 text-right text-ink/60">
                        {player.floor !== undefined ? Number(player.floor).toFixed(2) : '--'}
                      </td>
                    </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td
                      colSpan={showActuals ? 15 : 14}
                      className="py-8 text-center text-[10px] font-black text-ink/40 uppercase tracking-widest"
                    >
                      No players matched the active search/filter criteria
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedPlayer && (
        <PlayerDeepDive
          player={selectedPlayer}
          players={players}
          games={effectiveGames}
          onClose={() => setSelectedPlayer(null)}
          isHistorical={isHistorical}
          showActuals={true}
          injuryLookup={injuryLookup}
          depthCharts={depthCharts}
          startingLineupLookup={startingLineupLookup}
        />
      )}
    </div>
  );
};

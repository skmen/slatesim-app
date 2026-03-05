import React, { useEffect, useMemo, useState } from 'react';
import { Player, HistoricalGame, GameInfo, Slot } from '../types';
import { X, TrendingUp, Activity, BarChart3, Zap, TrendingDown, Plus, Minus, Lock } from 'lucide-react';
import { Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart, Cell } from 'recharts';
import { RotationVisualizer } from './RotationVisualizer';
import { useLineup } from '../context/LineupContext';
import { getTeamDepthChartRows, DepthChartRow } from '../utils/depthChart';
import { getInjuryInfoByName, InjuryLookup } from '../utils/injuries';
import { getPlayerStartingLineupInfo, StartingLineupLookup } from '../utils/startingLineups';

interface Props {
  player: Player;
  players: Player[];
  games: GameInfo[];
  onClose: () => void;
  isHistorical: boolean;
  showActuals: boolean;
  previewMode?: boolean;
  depthCharts?: any | null;
  injuryLookup?: InjuryLookup | null;
  startingLineupLookup?: StartingLineupLookup | null;
  optimizerSettingsKey?: string;
  onOptimizerExposureChange?: (playerId: string, minExposure?: number, maxExposure?: number) => void;
  onOptimizerLockChange?: (playerId: string, locked: boolean) => void;
  onOptimizerExcludeChange?: (playerId: string, excluded: boolean) => void;
}

type TabKey = 'dfs' | 'stats' | 'matchup' | 'synergy' | 'depth';
type SortDir = 'asc' | 'desc';

interface SortConfig {
  key: string;
  dir: SortDir;
}

interface OptimizerPlayerOverride {
  minutes?: number;
  projection?: number;
  minExposure?: number;
  maxExposure?: number;
  exclude?: boolean;
}

interface OptimizerAdvancedSettings {
  lockedIds?: string[];
  selectedMatchups?: string[];
  selectedTeams?: string[];
  playerOverrides?: Record<string, OptimizerPlayerOverride>;
}

const OPTIMIZER_SETTINGS_KEY = 'optimizerAdvancedSettings';
const HISTORY_WINDOW_GAMES = 20;

const sanitizeOptimizerSettings = (raw: any): OptimizerAdvancedSettings => {
  if (!raw || typeof raw !== 'object') return {};
  const settings = raw as OptimizerAdvancedSettings;
  return {
    lockedIds: Array.isArray(settings.lockedIds) ? settings.lockedIds : [],
    selectedMatchups: Array.isArray(settings.selectedMatchups) ? settings.selectedMatchups : [],
    selectedTeams: Array.isArray(settings.selectedTeams) ? settings.selectedTeams : [],
    playerOverrides: settings.playerOverrides && typeof settings.playerOverrides === 'object'
      ? settings.playerOverrides
      : {},
  };
};

const parsePositions = (position: string): string[] => {
  return String(position || '')
    .split(/[\/,\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter((p) => ['PG', 'SG', 'SF', 'PF', 'C'].includes(p));
};

const normalizeKeyToken = (key: string): string => String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const isFiniteNumeric = (value: any): value is number =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const isPercentKey = (key: string): boolean => /%|PCT|PERCENT/i.test(String(key || ''));

const findKeyMatch = (obj: Record<string, any>, key: string): string | undefined => {
  const target = String(key || '');
  const exact = Object.keys(obj).find((k) => k.toLowerCase() === target.toLowerCase());
  if (exact) return exact;

  const targetNorm = normalizeKeyToken(target);
  const candidates = Object.keys(obj).filter((k) => normalizeKeyToken(k) === targetNorm);
  if (candidates.length === 0) return undefined;

  const targetIsPct = isPercentKey(target);
  const pctFiltered = candidates.filter((k) => isPercentKey(k) === targetIsPct);
  return pctFiltered[0] ?? candidates[0];
};

const readByKeys = (obj: any, keys: string[]): any => {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    const match = findKeyMatch(obj as Record<string, any>, key);
    if (match) return obj[match];
  }
  return undefined;
};

const AST_KEYS = ['AST', 'assists', 'assist', 'A', 'ASTS', 'APG'];

const SEASON_STAT_THRESHOLDS: Record<'PG' | 'SG' | 'SF' | 'PF' | 'C', Partial<Record<string, number>>> = {
  PG: {
    AST: 8,
    FGA: 15,
    FTA: 5,
    'AST%': 35,
    'USG%': 28,
  },
  SG: {
    FGA: 16,
    '3PA': 8,
    FTA: 6,
    'USG%': 28,
  },
  SF: {
    FGA: 16,
    REB: 7,
    'USG%': 28,
  },
  PF: {
    REB: 9,
    FTA: 6,
    'USG%': 27,
  },
  C: {
    REB: 11,
    BLK: 2,
    'USG%': 27,
    'OREB%': 10,
    'REB%': 22,
  },
};

const toSeasonLabel = (dateStr: string): string => {
  const parsed = new Date(dateStr);
  const year = Number.isFinite(parsed.getTime()) ? parsed.getFullYear() : new Date().getFullYear();
  const month = Number.isFinite(parsed.getTime()) ? parsed.getMonth() + 1 : 1;
  const startYear = month >= 7 ? year : year - 1;
  const endYear = (startYear + 1) % 100;
  return `${startYear}-${String(endYear).padStart(2, '0')}`;
};

const formatStatValue = (val: any): string => {
  if (val === null || val === undefined || val === '') return '--';
  const n = Number(val);
  if (Number.isFinite(n)) return n % 1 === 0 ? String(n) : n.toFixed(2);
  return String(val);
};

const formatMetric = (val: number | undefined | null, decimals = 2): string => {
  if (!Number.isFinite(Number(val))) return '--';
  return Number(val).toFixed(decimals);
};

const PIE_KEYS = [
  'pie',
  'PIE',
  'PIE%',
  'PIE_PCT',
  'PIEPCT',
  'piePct',
  'pie_pct',
  'piePercent',
  'pie_percent',
  'playerImpactEstimate',
  'player_impact_estimate',
  'playerimpactestimate',
  'playerImpactEstimatePct',
  'playerImpactEstimatePercent',
  'player_impact_estimate_pct',
  'player_impact_estimate_percent',
  'PLAYER_IMPACT_ESTIMATE',
  'PLAYERIMPACTESTIMATE',
  'PLAYER_IMPACT_ESTIMATE_PCT',
  'PLAYER_IMPACT_ESTIMATE_PERCENT',
];

const normalizePieNumber = (raw: any): number | undefined => {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const normalizedRaw =
    typeof raw === 'string'
      ? raw.trim().replace('%', '')
      : raw;
  const value = Number(normalizedRaw);
  if (!Number.isFinite(value)) return undefined;
  // PIE is often serialized as 0..1 in raw feeds; present as 0..100 like other percent columns.
  return value <= 1 ? value * 100 : value;
};

const readPieFromBoxscoreGame = (game: any): any => {
  const sources = [
    game,
    game?._stats,
    game?.stats,
    game?.advanced,
    game?.advancedStats,
    game?.advanced_stats,
    game?.boxscore,
    game?.boxScore,
    game?.boxScore?.advanced,
    game?.boxscore?.advanced,
    game?.boxscoreStats,
    game?.boxscore_stats,
    game?.boxScoreAdvanced,
    game?.box_score_advanced,
    game?.gameStats,
    game?.game_stats,
    game?.stats?.advanced,
    game?.stats?.advancedStats,
  ];

  for (const source of sources) {
    const value = readByKeys(source, PIE_KEYS);
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value === 'object') {
        const nested = readByKeys(value, ['value', 'pct', 'percent', ...PIE_KEYS]);
        const nestedNumeric = normalizePieNumber(nested);
        if (nestedNumeric !== undefined) return nestedNumeric;
      }
      const numeric = normalizePieNumber(value);
      if (numeric !== undefined) return numeric;
      return value;
    }
  }
  return undefined;
};

const compareValues = (a: any, b: any): number => {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const nA = Number(a);
  const nB = Number(b);
  if (Number.isFinite(nA) && Number.isFinite(nB)) return nA - nB;
  const sA = String(a ?? '');
  const sB = String(b ?? '');
  return sA.localeCompare(sB);
};

const getPrimaryPosition = (position: string): 'PG' | 'SG' | 'SF' | 'PF' | 'C' => {
  const parsed = parsePositions(position);
  const primary = parsed[0];
  if (primary === 'PG' || primary === 'SG' || primary === 'SF' || primary === 'PF' || primary === 'C') return primary;
  return 'PG';
};

const normalizeStatForThreshold = (column: string, raw: any): number | null => {
  if (!isFiniteNumeric(raw)) return null;
  const num = Number(raw);
  if (column.includes('%') && num <= 1) return num * 100;
  return num;
};

const getSeasonStatThreshold = (position: string, column: string): number | null => {
  const primary = getPrimaryPosition(position);
  const threshold = SEASON_STAT_THRESHOLDS[primary][column];
  return isFiniteNumeric(threshold) ? Number(threshold) : null;
};

const isSeasonStatAtThreshold = (position: string, column: string, raw: any): boolean => {
  const threshold = getSeasonStatThreshold(position, column);
  if (!isFiniteNumeric(threshold)) return false;
  const value = normalizeStatForThreshold(column, raw);
  if (!isFiniteNumeric(value)) return false;
  return Number(value) >= Number(threshold);
};

const dvpStatClass = (position: string, stat: 'pts' | 'reb' | 'ast' | 'blk' | '3pm', value: number | null): string => {
  if (!Number.isFinite(Number(value))) return 'text-ink';
  const val = Number(value);
  const pos = String(position || '').toUpperCase();

  const between = (min: number, max: number) => val >= min && val <= max;

  if (pos === 'PG') {
    if (stat === 'pts') return val < 21.0 ? 'text-red-600' : between(21.0, 24.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'ast') return val < 7.5 ? 'text-red-600' : between(7.5, 9.4) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'reb') return val < 5.5 ? 'text-red-600' : between(5.5, 6.4) ? 'text-ink' : 'text-emerald-600';
  }

  if (pos === 'SG') {
    if (stat === 'pts') return val < 21.0 ? 'text-red-600' : between(21.0, 23.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === '3pm') return val < 2.5 ? 'text-red-600' : between(2.5, 3.4) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'reb') return val < 5.0 ? 'text-red-600' : between(5.0, 6.4) ? 'text-ink' : 'text-emerald-600';
  }

  if (pos === 'SF') {
    if (stat === 'pts') return val < 19.0 ? 'text-red-600' : between(19.0, 21.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'reb') return val < 6.5 ? 'text-red-600' : between(6.5, 7.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'ast') return val < 3.5 ? 'text-red-600' : between(3.5, 4.9) ? 'text-ink' : 'text-emerald-600';
  }

  if (pos === 'PF') {
    if (stat === 'pts') return val < 20.0 ? 'text-red-600' : between(20.0, 22.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'reb') return val < 9.0 ? 'text-red-600' : between(9.0, 10.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'ast') return val < 3.5 ? 'text-red-600' : between(3.5, 4.9) ? 'text-ink' : 'text-emerald-600';
  }

  if (pos === 'C') {
    if (stat === 'pts') return val < 20.0 ? 'text-red-600' : between(20.0, 23.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'reb') return val < 12.0 ? 'text-red-600' : between(12.0, 14.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'blk') return val < 1.5 ? 'text-red-600' : between(1.5, 2.4) ? 'text-ink' : 'text-emerald-600';
  }

  return 'text-ink';
};

const nextSort = (current: SortConfig | null, key: string, defaultDir: SortDir = 'desc'): SortConfig => {
  if (current && current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: defaultDir };
};

const readOptimizerAdvancedSettings = (settingsKey?: string): OptimizerAdvancedSettings => {
  if (typeof window === 'undefined') return {};
  const key = settingsKey || OPTIMIZER_SETTINGS_KEY;

  const parseForKey = (targetKey: string): OptimizerAdvancedSettings | null => {
    try {
      const raw = window.localStorage.getItem(targetKey);
      if (!raw) return null;
      return sanitizeOptimizerSettings(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  const preferred = parseForKey(key);
  if (preferred) return preferred;
  if (key !== OPTIMIZER_SETTINGS_KEY) {
    const legacy = parseForKey(OPTIMIZER_SETTINGS_KEY);
    if (legacy) return legacy;
  }
  return {};
};

const writeOptimizerAdvancedSettings = (settings: OptimizerAdvancedSettings, settingsKey?: string): void => {
  if (typeof window === 'undefined') return;
  const key = settingsKey || OPTIMIZER_SETTINGS_KEY;
  window.localStorage.setItem(key, JSON.stringify(settings));
};

const saveOptimizerExposureForPlayer = (
  playerId: string,
  minExposure?: number,
  maxExposure?: number,
  settingsKey?: string,
): void => {
  if (typeof window === 'undefined') return;
  const settings = readOptimizerAdvancedSettings(settingsKey);
  const playerOverrides = settings.playerOverrides && typeof settings.playerOverrides === 'object'
    ? { ...settings.playerOverrides }
    : {};

  const current = playerOverrides[playerId] && typeof playerOverrides[playerId] === 'object'
    ? { ...playerOverrides[playerId] }
    : {};

  if (minExposure === undefined) {
    delete current.minExposure;
  } else {
    current.minExposure = minExposure;
  }

  if (maxExposure === undefined) {
    delete current.maxExposure;
  } else {
    current.maxExposure = maxExposure;
  }

  if (Object.keys(current).length === 0) {
    delete playerOverrides[playerId];
  } else {
    playerOverrides[playerId] = current;
  }

  writeOptimizerAdvancedSettings(
    {
      ...settings,
      playerOverrides,
    },
    settingsKey,
  );
};

const saveOptimizerPlayerPoolState = (
  playerId: string,
  nextState: { locked?: boolean; excluded?: boolean },
  settingsKey?: string,
): void => {
  if (typeof window === 'undefined') return;
  const settings = readOptimizerAdvancedSettings(settingsKey);
  const lockedSet = new Set(Array.isArray(settings.lockedIds) ? settings.lockedIds : []);
  const playerOverrides = settings.playerOverrides && typeof settings.playerOverrides === 'object'
    ? { ...settings.playerOverrides }
    : {};
  const current = playerOverrides[playerId] && typeof playerOverrides[playerId] === 'object'
    ? { ...playerOverrides[playerId] }
    : {};

  if (nextState.excluded === true) {
    lockedSet.delete(playerId);
    current.exclude = true;
    delete current.minExposure;
    delete current.maxExposure;
  } else if (nextState.excluded === false) {
    delete current.exclude;
  }

  if (nextState.locked === true) {
    lockedSet.add(playerId);
    delete current.exclude;
    current.minExposure = 100;
    current.maxExposure = 100;
  } else if (nextState.locked === false) {
    lockedSet.delete(playerId);
    delete current.minExposure;
    delete current.maxExposure;
  }

  if (Object.keys(current).length === 0) {
    delete playerOverrides[playerId];
  } else {
    playerOverrides[playerId] = current;
  }

  writeOptimizerAdvancedSettings(
    {
      ...settings,
      lockedIds: Array.from(lockedSet),
      playerOverrides,
    },
    settingsKey,
  );
};

const parseExposureInput = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.min(100, numeric));
};

export const PlayerDeepDive: React.FC<Props> = ({
  player,
  players,
  games,
  onClose,
  isHistorical,
  showActuals,
  previewMode = false,
  depthCharts,
  injuryLookup,
  startingLineupLookup,
  optimizerSettingsKey,
  onOptimizerExposureChange,
  onOptimizerLockChange,
  onOptimizerExcludeChange,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('dfs');
  const [traditionalHover, setTraditionalHover] = useState<{ row: number; col: number } | null>(null);
  const [advancedHover, setAdvancedHover] = useState<{ row: number; col: number } | null>(null);
  const [dvpSort, setDvpSort] = useState<SortConfig>({ key: 'position', dir: 'asc' });
  const [gameLogSort, setGameLogSort] = useState<SortConfig>({ key: 'date', dir: 'desc' });
  const [traditionalSort, setTraditionalSort] = useState<SortConfig | null>(null);
  const [advancedSort, setAdvancedSort] = useState<SortConfig | null>(null);
  const [synergySort, setSynergySort] = useState<SortConfig>({ key: 'combinedProj', dir: 'desc' });
  const [minExposureInput, setMinExposureInput] = useState('');
  const [maxExposureInput, setMaxExposureInput] = useState('');
  const [exposureStatus, setExposureStatus] = useState<string | null>(null);
  const [isOptimizerLocked, setIsOptimizerLocked] = useState(false);
  const [isOptimizerExcluded, setIsOptimizerExcluded] = useState(false);
  const { slots, addPlayer, removePlayer, isPlayerInLineup } = useLineup();
  const startingInfo = useMemo(
    () => getPlayerStartingLineupInfo(player, startingLineupLookup),
    [player, startingLineupLookup]
  );

  const depthChartRows = useMemo<DepthChartRow[]>(
    () => getTeamDepthChartRows(depthCharts, player.team),
    [depthCharts, player.team]
  );

  const matchupSignal = useMemo(() => {
    const readStatNumber = (keys: string[]) => {
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

    const clamp = (val: number, min: number, max: number) => Math.min(max, Math.max(min, val));
    const formatTierLabel = (tier?: string | null): string | undefined => {
      if (!tier) return undefined;
      const normalized = tier.trim().toLowerCase();
      if (normalized.includes('strong boost')) return 'Strong Boost';
      if (normalized === 'boost') return 'Boost';
      if (normalized.includes('strong fade')) return 'Strong Fade';
      if (normalized === 'fade') return 'Fade';
      if (normalized === 'neutral') return 'Neutral';
      return tier.trim().replace(/\b\w/g, (char) => char.toUpperCase());
    };

    const readStatString = (keys: string[]) => {
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

    const usageRate = readStatNumber(['USAGE_PCT', 'USG%', 'usageRate', 'usage_rate']) ?? 0;
    const minutesProjection = readStatNumber(['MINUTES_PROJ', 'minutesProjection', 'minutes', 'min']) ?? 0;
    const projection = readStatNumber(['projection', 'proj', 'DK_FPTS_PROJ']) ?? player.projection;
    const salary = readStatNumber(['salary', 'SALARY']) ?? player.salary;

    const blendDiff = readStatNumber([
      'DEF_SIGNAL_ONOFF_BLEND_DIFF',
      'def_signal_onoff_blend_diff',
      'onOffBlendDiff',
    ]) ?? 0;
    const blendConfRaw = readStatNumber([
      'DEF_SIGNAL_ONOFF_BLEND_CONF',
      'def_signal_onoff_blend_conf',
      'onOffBlendConfidence',
    ]) ?? 0.25;
    const wPosRaw = readStatNumber([
      'DEF_SIGNAL_ONOFF_BLEND_W_POS',
      'def_signal_onoff_blend_w_pos',
      'onOffBlendWeightPos',
    ]);
    const wTeamRaw = readStatNumber([
      'DEF_SIGNAL_ONOFF_BLEND_W_TEAM',
      'def_signal_onoff_blend_w_team',
      'onOffBlendWeightTeam',
    ]);
    const impactFp = readStatNumber([
      'DEF_SIGNAL_ONOFF_IMPACT_FP',
      'def_signal_onoff_impact_fp',
      'onOffImpactFp',
    ]) ?? 0;
    const tierRaw = readStatString([
      'DEF_SIGNAL_ONOFF_IMPACT_TIER',
      'def_signal_onoff_impact_tier',
      'onOffImpactTier',
    ]) ?? 'Neutral';
    const baseImpactFp = readStatNumber([
      'onOffImpactFpBase',
      'on_off_impact_fp_base',
      'ONOFF_IMPACT_FP_BASE',
    ]);
    const baseTierRaw = readStatString([
      'onOffImpactTierBase',
      'on_off_impact_tier_base',
      'ONOFF_IMPACT_TIER_BASE',
    ]);
    const leverageScore = readStatNumber([
      'signalLeverageScore',
      'signal_leverage_score',
      'LEVERAGE_SCORE',
      'leverageScore',
    ]);
    const leverageTierRaw = readStatString([
      'signalLeverageTier',
      'signal_leverage_tier',
      'LEVERAGE_TIER',
      'leverageTier',
      'leverageTierLabel',
      'leverageTierName',
    ]);

    const wPos = clamp(Number.isFinite(Number(wPosRaw)) ? Number(wPosRaw) : 0.5, 0, 1);
    const wTeam = clamp(Number.isFinite(Number(wTeamRaw)) ? Number(wTeamRaw) : (1 - wPos), 0, 1);
    const combinedDiff = blendDiff;
    const combinedConf = clamp(blendConfRaw, 0.25, 1.0);
    const baseTierLabel = formatTierLabel(baseTierRaw);
    const leverageTierLabel = formatTierLabel(leverageTierRaw);

    let verdictLabel = 'Neutral';
    let tone: 'strong_positive' | 'positive' | 'neutral' | 'negative' | 'strong_negative' = 'neutral';

    const normalizedTier = tierRaw.trim().toLowerCase();
    if (normalizedTier.includes('strong boost')) {
      verdictLabel = 'Strong Boost';
      tone = 'strong_positive';
    } else if (normalizedTier === 'boost') {
      verdictLabel = 'Boost';
      tone = 'positive';
    } else if (normalizedTier.includes('strong fade')) {
      verdictLabel = 'Strong Fade';
      tone = 'strong_negative';
    } else if (normalizedTier === 'fade') {
      verdictLabel = 'Fade';
      tone = 'negative';
    } else {
      verdictLabel = 'Neutral';
      tone = 'neutral';
    }

    const confidenceLabel = combinedConf >= 0.75 ? 'High' : combinedConf >= 0.5 ? 'Medium' : 'Low';
    const hasLeverageBreakdown = baseImpactFp !== undefined || baseTierRaw !== undefined;

    const toneStyles = {
      strong_positive: { bg: '#052e16', fg: '#22c55e', border: '#15803d' },
      positive: { bg: '#0b3b22', fg: '#34d399', border: '#10b981' },
      neutral: { bg: '#1f2937', fg: '#cbd5e1', border: '#475569' },
      negative: { bg: '#3f1d1d', fg: '#fca5a5', border: '#ef4444' },
      strong_negative: { bg: '#450a0a', fg: '#f87171', border: '#dc2626' },
    } as const;

    return {
      projection,
      minutesProjection,
      salary,
      usageRate,
      blendDiff,
      wPos,
      wTeam,
      combinedDiff,
      combinedConf,
      impactFp,
      baseImpactFp,
      baseTierLabel,
      leverageScore,
      leverageTierLabel,
      hasLeverageBreakdown,
      confidenceLabel,
      verdictLabel,
      tone,
      toneStyle: toneStyles[tone],
    };
  }, [player]);

  const depthChartColumnCount = useMemo(() => {
    const maxDepth = depthChartRows.reduce((max, row) => Math.max(max, row.players.length), 0);
    return Math.max(3, maxDepth);
  }, [depthChartRows]);

  const matchupProjection = useMemo(() => {
    const raw = readByKeys(player.slateData as any, ['projection', 'proj', 'DK_FPTS_PROJ']) ?? player.projection;
    const num = Number(raw);
    return Number.isFinite(num) ? num : player.projection;
  }, [player]);

  const matchupMinutes = useMemo(() => {
    const raw = readByKeys(player.slateData as any, ['minutesProjection', 'minutes', 'min']) ?? player.minutesProjection;
    const num = Number(raw);
    return Number.isFinite(num) ? num : player.minutesProjection;
  }, [player]);

  const matchupUsage = useMemo(() => {
    const raw = readByKeys(player.advancedMetrics as any, ['usageRate', 'usage_rate', 'USG%']) ?? player.usageRate;
    const num = Number(raw);
    return Number.isFinite(num) ? num : player.usageRate;
  }, [player]);

  const depthChartColumns = useMemo(() => {
    const ordinal = (n: number) => {
      if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
      switch (n % 10) {
        case 1: return `${n}st`;
        case 2: return `${n}nd`;
        case 3: return `${n}rd`;
        default: return `${n}th`;
      }
    };
    return Array.from({ length: depthChartColumnCount }, (_, idx) => ordinal(idx + 1));
  }, [depthChartColumnCount]);

  const getInjuryTag = (name: string): string | null => {
    const info = getInjuryInfoByName(name, injuryLookup);
    if (!info) return null;
    const status = String(info.status || '').toLowerCase();
    if (status.includes('out') || status === 'o') return 'OUT';
    if (status.includes('doubtful') || status === 'd') return 'DD';
    if (status.includes('questionable') || info.isQuestionable || status === 'q') return 'Q';
    return null;
  };

  const slotForPlayer = useMemo(() => {
    const entry = Object.entries(slots).find(([, p]) => p?.id === player.id);
    return entry ? (entry[0] as Slot) : null;
  }, [slots, player.id]);

  const isInLineup = useMemo(() => isPlayerInLineup(player.id), [isPlayerInLineup, player.id]);

  const canAddToLineup = useMemo(() => {
    if (isInLineup) return false;
    const positions = String(player.position || '')
      .split(/[\/,\s]+/)
      .map((p) => p.trim().toUpperCase())
      .filter(Boolean);
    if (positions.includes('PG') && !slots.PG) return true;
    if (positions.includes('SG') && !slots.SG) return true;
    if (positions.includes('SF') && !slots.SF) return true;
    if (positions.includes('PF') && !slots.PF) return true;
    if (positions.includes('C') && !slots.C) return true;
    if ((positions.includes('PG') || positions.includes('SG')) && !slots.G) return true;
    if ((positions.includes('SF') || positions.includes('PF')) && !slots.F) return true;
    if (!slots.UTIL) return true;
    return false;
  }, [isInLineup, player.position, slots]);

  const sortByDateDesc = (gamesList: HistoricalGame[]): HistoricalGame[] => {
    return [...gamesList].sort((a, b) => {
      const da = Date.parse(a.date);
      const db = Date.parse(b.date);
      if (Number.isFinite(da) && Number.isFinite(db)) return db - da;
      return String(b.date).localeCompare(String(a.date));
    });
  };

  const modalActualFpts = useMemo(() => {
    const val = Number(
      player.actual ??
      player.actualFpts ??
      player.actual_fpts ??
      player.history?.[player.history.length - 1]?.fpts
    );
    return Number.isFinite(val) ? val : null;
  }, [player]);

  const history: HistoricalGame[] = useMemo(() => {
    if (player.history && player.history.length > 0) {
      const enriched = player.history.map((game) => ({
        ...game,
        projection: (() => {
          const fallbackProjection =
            ((player.averageFppm && game.minutes)
              ? player.averageFppm * game.minutes
              : ((player.minutesProjection && game.minutes)
                ? player.projection * (game.minutes / player.minutesProjection)
                : player.projection));
          const projectionNum = Number(game.projection);
          const actualNum = Number(game.fpts);
          const projectionMatchesActual =
            Number.isFinite(projectionNum) &&
            Number.isFinite(actualNum) &&
            Math.abs(projectionNum - actualNum) < 0.001;
          if (Number.isFinite(projectionNum) && !projectionMatchesActual) return projectionNum;
          return fallbackProjection;
        })(),
      }));
      return sortByDateDesc(enriched).slice(0, HISTORY_WINDOW_GAMES);
    }

    const fromPlayByPlay = Array.isArray(player.last5PlayByPlay) ? player.last5PlayByPlay : [];
    if (fromPlayByPlay.length > 0) {
      const derived = fromPlayByPlay
        .map((game: any) => {
          const chunks = Array.isArray(game?.chunks) ? game.chunks : [];
          const minutes = chunks.reduce((sum: number, c: any) => sum + (Number(c?.minutesPlayed) || 0), 0);
          const fpts = chunks.reduce((sum: number, c: any) => sum + (Number(c?.fantasyPoints) || 0), 0);
          const projectionCandidate = Number(game?.projection ?? game?.projectedFantasyPoints);
          const projectionMatchesActual =
            Number.isFinite(projectionCandidate) &&
            Number.isFinite(fpts) &&
            Math.abs(projectionCandidate - fpts) < 0.001;
          const projection =
            Number.isFinite(projectionCandidate) && !projectionMatchesActual
              ? projectionCandidate
              : player.projection;
          return {
            date: String(game?.date || ''),
            opponent: String(game?.opponentTeamId || '--'),
            minutes,
            fpts,
            projection,
          } as HistoricalGame;
        })
        .filter((g) => !!g.date);
      return sortByDateDesc(derived).slice(0, HISTORY_WINDOW_GAMES);
    }

    return [];
  }, [player]);

  const sortedHistory = useMemo(() => {
    const rows = [...history];
    rows.sort((a, b) => {
      const getValue = (game: HistoricalGame) => {
        switch (gameLogSort.key) {
          case 'date': {
            const parsed = Date.parse(game.date);
            return Number.isFinite(parsed) ? parsed : game.date;
          }
          case 'opponent':
            return game.opponent;
          case 'minutes':
            return game.minutes;
          case 'projection':
            return game.projection ?? player.projection;
          case 'actual':
            return game.fpts;
          default:
            return (game as any)[gameLogSort.key];
        }
      };
      const cmp = compareValues(getValue(a), getValue(b));
      return gameLogSort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [history, gameLogSort, player.projection]);

  const stats = useMemo(() => {
    if (history.length === 0) {
      return {
        avg: '0.0',
        avgFppm: 'N/A',
        median: 0,
        hitRate: '0',
        missRate: '0',
        boomRate: '0',
        bustRate: '0',
      };
    }

    const fpts = history.map((g) => g.fpts);
    const mins = history.map((g) => g.minutes);
    const projections = history.map((g) => g.projection ?? player.projection);
    const avg = fpts.reduce((a, b) => a + b, 0) / fpts.length;
    const avgMin = mins.reduce((a, b) => a + b, 0) / mins.length;
    const avgFppm = avgMin > 0 ? avg / avgMin : 0;

    const sortedFpts = [...fpts].sort((a, b) => a - b);
    const mid = Math.floor(sortedFpts.length / 2);
    const median = sortedFpts.length % 2 !== 0 ? sortedFpts[mid] : (sortedFpts[mid - 1] + sortedFpts[mid]) / 2;

    const diffs = history.map((game, idx) => Math.abs(game.fpts - (projections[idx] ?? player.projection)));
    const hitCount = diffs.filter((diff) => diff <= 5).length;
    const missCount = diffs.filter((diff) => diff > 5).length;

    const salary = Number(player.salary) || 0;
    const salaryK = salary > 0 ? salary / 1000 : 0;
    let boomThreshold = 0;
    let bustThreshold = 0;
    if (salary >= 9000) {
      boomThreshold = 6;
      bustThreshold = 4.5;
    } else if (salary >= 6500) {
      boomThreshold = 6.5;
      bustThreshold = 4.5;
    } else if (salary >= 4500) {
      boomThreshold = 7;
      bustThreshold = 5;
    } else if (salary >= 3000) {
      boomThreshold = 8;
      bustThreshold = 5;
    } else {
      boomThreshold = 8;
      bustThreshold = 5;
    }

    const valueRates = history.map((game) => (salaryK > 0 ? game.fpts / salaryK : 0));
    const boomCount = valueRates.filter((val) => val >= boomThreshold).length;
    const bustCount = valueRates.filter((val) => val < bustThreshold).length;

    return {
      avg: avg.toFixed(1),
      avgFppm: avgFppm > 0 ? avgFppm.toFixed(2) : 'N/A',
      median,
      hitRate: ((hitCount / history.length) * 100).toFixed(0),
      missRate: ((missCount / history.length) * 100).toFixed(0),
      boomRate: ((boomCount / history.length) * 100).toFixed(0),
      bustRate: ((bustCount / history.length) * 100).toFixed(0),
    };
  }, [history, player.projection]);

  const gameLogActualClass = (actual: number, projection: number): string => {
    const diff = actual - projection;
    if (!Number.isFinite(diff)) return 'text-ink';
    if (diff >= 5) return 'text-emerald-600';
    if (diff <= -5) return 'text-red-600';
    return 'text-ink';
  };

  const chartData = useMemo(() => {
    const withMedian = history.map((g) => ({ ...g, median: stats.median }));
    return [...withMedian].sort((a, b) => {
      const da = Date.parse(a.date);
      const db = Date.parse(b.date);
      if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
      return String(a.date).localeCompare(String(b.date));
    });
  }, [history, stats.median]);

  const opponentTeam = useMemo(() => {
    const direct = String(player.opponent || '').toUpperCase();
    if (direct) {
      return games.find((g) => g.teamA.teamId === direct || g.teamB.teamId === direct)?.teamA.teamId === direct
        ? games.find((g) => g.teamA.teamId === direct || g.teamB.teamId === direct)?.teamA
        : games.find((g) => g.teamA.teamId === direct || g.teamB.teamId === direct)?.teamB;
    }

    const game = games.find((g) => g.teamA.teamId === player.team || g.teamB.teamId === player.team);
    if (!game) return undefined;
    return game.teamA.teamId === player.team ? game.teamB : game.teamA;
  }, [games, player.opponent, player.team]);

  const dvpRows = useMemo(() => {
    const positions = parsePositions(player.position);
    const dvp = opponentTeam?.positionalDvP || {};
    const slateData = (player.slateData as any) ?? {};
    const slateAdvanced = slateData.advancedMetrics ?? slateData.advancedmetrics ?? slateData.advanced_metrics ?? {};
    const playerAdvanced = (player as any)?.advancedMetrics ?? (player as any)?.advancedmetrics ?? (player as any)?.advanced_metrics ?? {};
    const opp3pmAllowedRaw = readByKeys(slateAdvanced, ['opp3pmAllowed', 'opp_3pm_allowed', 'opp3pmallowed', 'OPP3PMALLOWED'])
      ?? readByKeys(playerAdvanced, ['opp3pmAllowed', 'opp_3pm_allowed', 'opp3pmallowed', 'OPP3PMALLOWED'])
      ?? readByKeys(slateData, ['opp3pmAllowed', 'opp_3pm_allowed', 'opp3pmallowed', 'OPP3PMALLOWED'])
      ?? readByKeys(player as any, ['opp3pmAllowed', 'opp_3pm_allowed', 'opp3pmallowed', 'OPP3PMALLOWED']);
    const opp3pmAllowed = Number.isFinite(Number(opp3pmAllowedRaw)) ? Number(opp3pmAllowedRaw) : null;
    return positions.map((pos) => {
      const row = (dvp as any)[pos] || {};
      const astValue = readByKeys(row, AST_KEYS);
      const threePmValue = readByKeys(row, ['3PM', '3pm', '3P', '3ptm', '3PTM']);
      return {
        position: pos,
        rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : null,
        pts: Number.isFinite(Number(row.PTS)) ? Number(row.PTS) : null,
        reb: Number.isFinite(Number(row.REB)) ? Number(row.REB) : null,
        ast: Number.isFinite(Number(astValue)) ? Number(astValue) : null,
        threePm: opp3pmAllowed !== null ? opp3pmAllowed : (Number.isFinite(Number(threePmValue)) ? Number(threePmValue) : null),
        blk: Number.isFinite(Number(row.BLK)) ? Number(row.BLK) : null,
        stl: Number.isFinite(Number(row.STL)) ? Number(row.STL) : null,
      };
    });
  }, [player.position, opponentTeam, player.slateData]);

  const sortedDvpRows = useMemo(() => {
    const rows = [...dvpRows];
    rows.sort((a: any, b: any) => {
      const cmp = compareValues(a[dvpSort.key], b[dvpSort.key]);
      return dvpSort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [dvpRows, dvpSort]);

  const showGameLogActual = true;

  const latestRawLogs = useMemo(() => {
    const rawSource = Array.isArray(player.historicalGameLogsRaw)
      ? player.historicalGameLogsRaw
      : (player.historicalGameLogsRaw && typeof player.historicalGameLogsRaw === 'object'
          ? Object.values(player.historicalGameLogsRaw).filter((v) => v && typeof v === 'object')
          : []);

    const normalized = [...rawSource]
      .map((g: any) => {
        const stats = (g?.stats && typeof g.stats === 'object') ? g.stats : {};
        const date = String(
          g?.date ??
          g?.gameDate ??
          g?.game?.date ??
          readByKeys(g, ['date', 'gamedate']) ??
          ''
        );
        const opponent = String(
          g?.opponentTeamId ??
          g?.opponent ??
          g?.opp ??
          g?.opponentTeam?.teamId ??
          g?.game?.opponentTeamId ??
          '--'
        );

        return {
          ...g,
          _date: date,
          _opp: opponent,
          _stats: stats,
        };
      })
      .filter((g: any) => !!g._date)
      .sort((a: any, b: any) => {
        const da = Date.parse(String(a?._date || ''));
        const db = Date.parse(String(b?._date || ''));
        if (Number.isFinite(da) && Number.isFinite(db)) return db - da;
        return String(b?._date || '').localeCompare(String(a?._date || ''));
      })
      .slice(0, 5);

    if (normalized.length > 0) return normalized;

    return history.slice(0, 5).map((g) => ({
      _date: g.date,
      _opp: g.opponent,
      _stats: {
        MIN: g.minutes,
        FP: g.fpts,
      },
      minutes: g.minutes,
      fantasyPoints: g.fpts,
      projection: g.projection,
    }));
  }, [player.historicalGameLogsRaw, history]);

  const traditionalColumns = useMemo(
    () => ['DATE', 'OPP', 'MIN', 'PTS', 'FGM', 'FGA', 'FG%', '3PM', '3PA', '3P%', 'FTM', 'FTA', 'FT%', 'OREB', 'DREB', 'REB', 'AST', 'TOV', 'STL', 'BLK', 'PF', 'FP', 'DD2', 'TD3', '+/-'],
    []
  );

  const advancedColumns = useMemo(
    () => ['DATE', 'OPP', 'MIN', 'OffRtg', 'DefRtg', 'NetRtg', 'AST%', 'AST/TO', 'AST Ratio', 'OREB%', 'DREB%', 'REB%', 'TO Ratio', 'eFG%', 'TS%', 'USG%', 'PACE', 'PIE'],
    []
  );

  const traditionalRows = useMemo(() => {
    const avg = player.statsProfile || {};
    const avgRow: Record<string, any> = {
      __isSeasonAvg: true,
      DATE: toSeasonLabel(history[0]?.date || String((player as any).slateDate || new Date().toISOString())),
      OPP: '--',
      MIN: readByKeys(avg, ['MIN']),
      PTS: readByKeys(avg, ['PTS']),
      FGM: readByKeys(avg, ['FGM']),
      FGA: readByKeys(avg, ['FGA']),
      'FG%': readByKeys(avg, ['FG%','FGPCT']),
      '3PM': readByKeys(avg, ['3PM']),
      '3PA': readByKeys(avg, ['3PA']),
      '3P%': readByKeys(avg, ['3P%','3PPCT']),
      FTM: readByKeys(avg, ['FTM']),
      FTA: readByKeys(avg, ['FTA']),
      'FT%': readByKeys(avg, ['FT%','FTPCT']),
      OREB: readByKeys(avg, ['OREB']),
      DREB: readByKeys(avg, ['DREB']),
      REB: readByKeys(avg, ['REB']),
      AST: readByKeys(avg, AST_KEYS),
      TOV: readByKeys(avg, ['TOV','TO']),
      STL: readByKeys(avg, ['STL']),
      BLK: readByKeys(avg, ['BLK']),
      PF: readByKeys(avg, ['PF']),
      FP: readByKeys(avg, ['FP','FPTS','FANTASYPOINTS']),
      DD2: readByKeys(avg, ['DD2','DOUBLEDOUBLE']),
      TD3: readByKeys(avg, ['TD3','TRIPLEDOUBLE']),
      '+/-': readByKeys(avg, ['+/-','PLUSMINUS']),
    };

    const gameRows = latestRawLogs.map((g) => ({
      __isSeasonAvg: false,
      DATE: String(g?._date ?? g?.date ?? g?.gameDate ?? '--'),
      OPP: String(g?._opp ?? g?.opponentTeamId ?? g?.opponent ?? g?.opp ?? '--'),
      MIN: readByKeys(g, ['minutes','MIN']) ?? readByKeys(g?._stats, ['minutes','MIN']),
      PTS: readByKeys(g, ['points','PTS']) ?? readByKeys(g?._stats, ['points','PTS']),
      FGM: readByKeys(g, ['fgm','FGM']) ?? readByKeys(g?._stats, ['fgm','FGM']),
      FGA: readByKeys(g, ['fga','FGA']) ?? readByKeys(g?._stats, ['fga','FGA']),
      'FG%': readByKeys(g, ['fg%','FG%','fgPct']) ?? readByKeys(g?._stats, ['fg%','FG%','fgPct']),
      '3PM': readByKeys(g, ['3pm','3PM']) ?? readByKeys(g?._stats, ['3pm','3PM']),
      '3PA': readByKeys(g, ['3pa','3PA']) ?? readByKeys(g?._stats, ['3pa','3PA']),
      '3P%': readByKeys(g, ['3p%','3P%','3pPct']) ?? readByKeys(g?._stats, ['3p%','3P%','3pPct']),
      FTM: readByKeys(g, ['ftm','FTM']) ?? readByKeys(g?._stats, ['ftm','FTM']),
      FTA: readByKeys(g, ['fta','FTA']) ?? readByKeys(g?._stats, ['fta','FTA']),
      'FT%': readByKeys(g, ['ft%','FT%','ftPct']) ?? readByKeys(g?._stats, ['ft%','FT%','ftPct']),
      OREB: readByKeys(g, ['oreb','OREB']) ?? readByKeys(g?._stats, ['oreb','OREB']),
      DREB: readByKeys(g, ['dreb','DREB']) ?? readByKeys(g?._stats, ['dreb','DREB']),
      REB: readByKeys(g, ['rebounds','REB']) ?? readByKeys(g?._stats, ['rebounds','REB']),
      AST: readByKeys(g, AST_KEYS) ?? readByKeys(g?._stats, AST_KEYS),
      TOV: readByKeys(g, ['turnovers','TOV','TO']) ?? readByKeys(g?._stats, ['turnovers','TOV','TO']),
      STL: readByKeys(g, ['steals','STL']) ?? readByKeys(g?._stats, ['steals','STL']),
      BLK: readByKeys(g, ['blocks','BLK']) ?? readByKeys(g?._stats, ['blocks','BLK']),
      PF: readByKeys(g, ['personalFouls','PF']) ?? readByKeys(g?._stats, ['personalFouls','PF']),
      FP: readByKeys(g, ['fantasyPoints','fpts','FP']) ?? readByKeys(g?._stats, ['fantasyPoints','fpts','FP']),
      DD2: readByKeys(g, ['doubleDouble','DD2']) ?? readByKeys(g?._stats, ['doubleDouble','DD2']),
      TD3: readByKeys(g, ['tripleDouble','TD3']) ?? readByKeys(g?._stats, ['tripleDouble','TD3']),
      '+/-': readByKeys(g, ['plusMinus','+/-']) ?? readByKeys(g?._stats, ['plusMinus','+/-']),
    }));

    return [avgRow, ...gameRows];
  }, [player.statsProfile, latestRawLogs, history]);

  const sortedTraditionalRows = useMemo(() => {
    if (!traditionalSort) return traditionalRows;
    const rows = [...traditionalRows];
    rows.sort((a: any, b: any) => {
      const cmp = compareValues(a[traditionalSort.key], b[traditionalSort.key]);
      return traditionalSort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [traditionalRows, traditionalSort]);

  const advancedRows = useMemo(() => {
    const avg = player.statsProfile || {};
    const avgRow: Record<string, any> = {
      __isSeasonAvg: true,
      DATE: toSeasonLabel(history[0]?.date || String((player as any).slateDate || new Date().toISOString())),
      OPP: '--',
      MIN: readByKeys(avg, ['MIN']),
      OffRtg: readByKeys(avg, ['OffRtg','OFFRTG']),
      DefRtg: readByKeys(avg, ['DefRtg','DEFRTG']),
      NetRtg: readByKeys(avg, ['NetRtg','NETRTG']),
      'AST%': readByKeys(avg, ['AST%','ASTPCT']),
      'AST/TO': readByKeys(avg, ['AST/TO','ASTTORATIO']),
      'AST Ratio': readByKeys(avg, ['AST Ratio','ASTRATIO']),
      'OREB%': readByKeys(avg, ['OREB%','OREBPCT']),
      'DREB%': readByKeys(avg, ['DREB%','DREBPCT']),
      'REB%': readByKeys(avg, ['REB%','REBPCT']),
      'TO Ratio': readByKeys(avg, ['TO Ratio','TORATIO']),
      'eFG%': readByKeys(avg, ['eFG%','EFGPCT']),
      'TS%': readByKeys(avg, ['TS%','TSPCT']),
      'USG%': readByKeys(avg, ['USG%','USGPCT']),
      PACE: readByKeys(avg, ['PACE']),
      PIE: readPieFromBoxscoreGame(avg),
    };

    const gameRows = latestRawLogs.map((g) => ({
      __isSeasonAvg: false,
      DATE: String(g?._date ?? g?.date ?? g?.gameDate ?? '--'),
      OPP: String(g?._opp ?? g?.opponentTeamId ?? g?.opponent ?? g?.opp ?? '--'),
      MIN: readByKeys(g, ['minutes','MIN']) ?? readByKeys(g?._stats, ['minutes','MIN']),
      OffRtg: readByKeys(g, ['offRtg','OffRtg','OFFRTG']) ?? readByKeys(g?._stats, ['offRtg','OffRtg','OFFRTG']),
      DefRtg: readByKeys(g, ['defRtg','DefRtg','DEFRTG']) ?? readByKeys(g?._stats, ['defRtg','DefRtg','DEFRTG']),
      NetRtg: readByKeys(g, ['netRtg','NetRtg','NETRTG']) ?? readByKeys(g?._stats, ['netRtg','NetRtg','NETRTG']),
      'AST%': readByKeys(g, ['ast%','AST%','ASTPCT']) ?? readByKeys(g?._stats, ['ast%','AST%','ASTPCT']),
      'AST/TO': readByKeys(g, ['ast/to','AST/TO','ASTTORATIO']) ?? readByKeys(g?._stats, ['ast/to','AST/TO','ASTTORATIO']),
      'AST Ratio': readByKeys(g, ['astRatio','AST Ratio','ASTRATIO']) ?? readByKeys(g?._stats, ['astRatio','AST Ratio','ASTRATIO']),
      'OREB%': readByKeys(g, ['oreb%','OREB%','OREBPCT']) ?? readByKeys(g?._stats, ['oreb%','OREB%','OREBPCT']),
      'DREB%': readByKeys(g, ['dreb%','DREB%','DREBPCT']) ?? readByKeys(g?._stats, ['dreb%','DREB%','DREBPCT']),
      'REB%': readByKeys(g, ['reb%','REB%','REBPCT']) ?? readByKeys(g?._stats, ['reb%','REB%','REBPCT']),
      'TO Ratio': readByKeys(g, ['toRatio','TO Ratio','TORATIO']) ?? readByKeys(g?._stats, ['toRatio','TO Ratio','TORATIO']),
      'eFG%': readByKeys(g, ['efg%','eFG%','EFGPCT']) ?? readByKeys(g?._stats, ['efg%','eFG%','EFGPCT']),
      'TS%': readByKeys(g, ['ts%','TS%','TSPCT']) ?? readByKeys(g?._stats, ['ts%','TS%','TSPCT']),
      'USG%': readByKeys(g, ['usg%','USG%','USGPCT']) ?? readByKeys(g?._stats, ['usg%','USG%','USGPCT']),
      PACE: readByKeys(g, ['pace','PACE']) ?? readByKeys(g?._stats, ['pace','PACE']),
      PIE: readPieFromBoxscoreGame(g),
    }));

    return [avgRow, ...gameRows];
  }, [player.statsProfile, latestRawLogs, history]);

  const sortedAdvancedRows = useMemo(() => {
    if (!advancedSort) return advancedRows;
    const rows = [...advancedRows];
    rows.sort((a: any, b: any) => {
      const cmp = compareValues(a[advancedSort.key], b[advancedSort.key]);
      return advancedSort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [advancedRows, advancedSort]);

  const synergyRows = useMemo(() => {
    const teammateCorrelation = (a: Player, b: Player): number => {
      const aPos = parsePositions(a.position);
      const bPos = parsePositions(b.position);
      const sameTeam = a.team === b.team;
      const opponents = a.team === b.opponent || a.opponent === b.team;
      let corr = 0;
      if (sameTeam) corr += 0.18;
      if (opponents) corr += 0.05;
      if (aPos.some((p) => bPos.includes(p))) corr -= 0.07;
      if ((aPos.includes('PG') && bPos.includes('C')) || (aPos.includes('C') && bPos.includes('PG'))) corr += 0.06;
      if ((aPos.includes('PG') && bPos.includes('SG')) || (aPos.includes('SG') && bPos.includes('PG'))) corr += 0.03;
      return Math.max(-0.35, Math.min(0.45, corr));
    };

    return players
      .filter((p) => p.id !== player.id && p.team === player.team)
      .map((p) => {
        const corr = teammateCorrelation(player, p);
        return {
          id: p.id,
          name: p.name,
          team: p.team,
          pos: p.position,
          correlation: corr,
          combinedProj: player.projection + p.projection,
        };
      })
      .sort((a, b) => b.combinedProj - a.combinedProj)
      .slice(0, 30);
  }, [player, players]);

  const sortedSynergyRows = useMemo(() => {
    const rows = [...synergyRows];
    rows.sort((a: any, b: any) => {
      const cmp = compareValues(a[synergySort.key], b[synergySort.key]);
      return synergySort.dir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [synergyRows, synergySort]);

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'dfs', label: 'DFS' },
    { key: 'stats', label: 'Stats' },
    ...(!previewMode ? [{ key: 'matchup' as TabKey, label: 'Matchup' }] : []),
    ...(!previewMode ? [{ key: 'synergy' as TabKey, label: 'Synergy' }] : []),
    { key: 'depth', label: 'Depth Chart' },
  ];

  useEffect(() => {
    if (previewMode && (activeTab === 'matchup' || activeTab === 'synergy')) {
      setActiveTab('dfs');
    }
  }, [activeTab, previewMode]);

  useEffect(() => {
    const settings = readOptimizerAdvancedSettings(optimizerSettingsKey);
    const override = settings.playerOverrides?.[player.id];
    const min = override?.minExposure;
    const max = override?.maxExposure;
    const locked = Array.isArray(settings.lockedIds) && settings.lockedIds.includes(player.id);
    const excluded = Boolean(override?.exclude);
    setMinExposureInput(Number.isFinite(Number(min)) ? String(min) : '');
    setMaxExposureInput(Number.isFinite(Number(max)) ? String(max) : '');
    setIsOptimizerLocked(Boolean(locked));
    setIsOptimizerExcluded(excluded);
    setExposureStatus(null);
  }, [player.id, optimizerSettingsKey]);

  const applyExposureSettings = () => {
    const minExposure = parseExposureInput(minExposureInput);
    const maxExposure = parseExposureInput(maxExposureInput);

    const minProvided = minExposureInput.trim() !== '';
    const maxProvided = maxExposureInput.trim() !== '';
    if (minProvided && minExposure === undefined) {
      setExposureStatus('Min exposure must be a valid number (0-100).');
      return;
    }
    if (maxProvided && maxExposure === undefined) {
      setExposureStatus('Max exposure must be a valid number (0-100).');
      return;
    }
    if (minExposure !== undefined && maxExposure !== undefined && minExposure > maxExposure) {
      setExposureStatus('Min exposure cannot be greater than max exposure.');
      return;
    }

    saveOptimizerExposureForPlayer(player.id, minExposure, maxExposure, optimizerSettingsKey);
    onOptimizerExposureChange?.(player.id, minExposure, maxExposure);
    setExposureStatus('Exposure saved to optimizer advanced settings.');
    setMinExposureInput(minExposure === undefined ? '' : String(minExposure));
    setMaxExposureInput(maxExposure === undefined ? '' : String(maxExposure));
  };

  const clearExposureSettings = () => {
    saveOptimizerExposureForPlayer(player.id, undefined, undefined, optimizerSettingsKey);
    onOptimizerExposureChange?.(player.id, undefined, undefined);
    setMinExposureInput('');
    setMaxExposureInput('');
    setExposureStatus('Exposure cleared from optimizer advanced settings.');
  };

  const toggleOptimizerLock = () => {
    const nextLocked = !isOptimizerLocked;
    saveOptimizerPlayerPoolState(
      player.id,
      { locked: nextLocked, excluded: nextLocked ? false : undefined },
      optimizerSettingsKey,
    );
    onOptimizerLockChange?.(player.id, nextLocked);
    if (nextLocked) {
      onOptimizerExcludeChange?.(player.id, false);
      onOptimizerExposureChange?.(player.id, 100, 100);
      setMinExposureInput('100');
      setMaxExposureInput('100');
      setIsOptimizerExcluded(false);
      setExposureStatus('Player locked in optimizer pool.');
    } else {
      onOptimizerExposureChange?.(player.id, undefined, undefined);
      setMinExposureInput('');
      setMaxExposureInput('');
      setExposureStatus('Player unlocked in optimizer pool.');
    }
    setIsOptimizerLocked(nextLocked);
  };

  const toggleOptimizerExclude = () => {
    const nextExcluded = !isOptimizerExcluded;
    saveOptimizerPlayerPoolState(
      player.id,
      { excluded: nextExcluded, locked: nextExcluded ? false : undefined },
      optimizerSettingsKey,
    );
    onOptimizerExcludeChange?.(player.id, nextExcluded);
    if (nextExcluded) {
      onOptimizerLockChange?.(player.id, false);
      onOptimizerExposureChange?.(player.id, undefined, undefined);
      setIsOptimizerLocked(false);
      setMinExposureInput('');
      setMaxExposureInput('');
      setExposureStatus('Player removed from optimizer pool.');
    } else {
      setExposureStatus('Player restored to optimizer pool.');
    }
    setIsOptimizerExcluded(nextExcluded);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-vellum/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-vellum border border-ink/10 rounded-sm w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-ink/10 flex justify-between items-start bg-white/40">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-drafting-orange/10 rounded-sm flex items-center justify-center border border-drafting-orange/20">
              <span className="text-2xl font-black text-drafting-orange italic">{player.team.slice(0, 3)}</span>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-black bg-drafting-orange/20 text-drafting-orange px-2 py-0.5 rounded uppercase tracking-widest">{player.position}</span>
                <span className="text-[10px] font-black bg-ink/10 text-ink/60 px-2 py-0.5 rounded uppercase tracking-widest">{player.team}</span>
              </div>
              <div className="flex items-center gap-2">
                <h2 className="text-2xl font-black italic uppercase tracking-tighter text-ink">{player.name}</h2>
                {startingInfo && (
                  <span
                    className={`inline-flex items-center justify-center w-5 h-5 rounded-sm text-[10px] font-black text-white ${
                      startingInfo.isConfirmed ? 'bg-emerald-600' : 'bg-yellow-500'
                    }`}
                    title={startingInfo.isConfirmed ? 'Starting (Confirmed)' : 'Starting (Expected)'}
                  >
                    S
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1">
                <span className="text-xs font-mono font-bold text-ink/60">SALARY: <span className="text-ink">${player.salary.toLocaleString()}</span></span>
                <span className="text-xs font-mono font-bold text-ink/60">PROJ: <span className="text-drafting-orange">{player.projection.toFixed(2)}</span></span>
                {showActuals && (
                  <span className="text-xs font-mono font-bold text-ink/60">
                    ACTUAL FPTS: <span className="text-emerald-600">{modalActualFpts !== null ? modalActualFpts.toFixed(2) : '--'}</span>
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-ink/50">Optimizer Exposure</span>
                <button
                  type="button"
                  onClick={toggleOptimizerLock}
                  title={isOptimizerLocked ? 'Unlock player' : 'Lock player'}
                  className={`inline-flex items-center justify-center w-6 h-6 rounded-sm border transition-colors ${
                    isOptimizerLocked
                      ? 'bg-drafting-orange text-white border-drafting-orange'
                      : 'text-ink/60 border-ink/20 hover:border-drafting-orange/40 hover:text-drafting-orange'
                  }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={toggleOptimizerExclude}
                  title={isOptimizerExcluded ? 'Include player in pool' : 'Remove player from pool'}
                  className={`inline-flex items-center justify-center w-6 h-6 rounded-sm border transition-colors ${
                    isOptimizerExcluded
                      ? 'bg-red-600 text-white border-red-600'
                      : 'text-ink/60 border-ink/20 hover:border-red-600/40 hover:text-red-600'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <span className="text-[9px] font-black uppercase tracking-widest text-ink/40">Min</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={minExposureInput}
                  onChange={(e) => setMinExposureInput(e.target.value)}
                  disabled={isOptimizerExcluded}
                  className="w-16 bg-white/70 border border-ink/20 rounded-sm px-2 py-1 text-[10px] font-bold font-mono text-ink outline-none focus:border-drafting-orange"
                  placeholder="0"
                />
                <span className="text-[9px] font-black uppercase tracking-widest text-ink/40">Max</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={maxExposureInput}
                  onChange={(e) => setMaxExposureInput(e.target.value)}
                  disabled={isOptimizerExcluded}
                  className="w-16 bg-white/70 border border-ink/20 rounded-sm px-2 py-1 text-[10px] font-bold font-mono text-ink outline-none focus:border-drafting-orange"
                  placeholder="100"
                />
                <button
                  type="button"
                  onClick={applyExposureSettings}
                  className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-sm border border-drafting-orange/30 text-drafting-orange hover:bg-drafting-orange/10 transition-colors"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={clearExposureSettings}
                  className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-sm border border-ink/20 text-ink/70 hover:bg-ink/5 transition-colors"
                >
                  Clear
                </button>
                {exposureStatus && (
                  <span className="text-[9px] font-bold text-ink/60">{exposureStatus}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <button
              onClick={() => {
                if (isInLineup && slotForPlayer) {
                  removePlayer(slotForPlayer);
                  return;
                }
                if (canAddToLineup) addPlayer(player);
              }}
              disabled={!isInLineup && !canAddToLineup}
              title={
                isInLineup
                  ? 'Remove from lineup'
                  : (canAddToLineup ? 'Add to lineup' : 'No eligible slot available')
              }
              className={`w-8 h-8 rounded-full flex items-center justify-center text-white shadow transition-colors ${
                isInLineup ? 'bg-red-600 hover:bg-red-500' : 'bg-emerald-600 hover:bg-emerald-500'
              } ${!isInLineup && !canAddToLineup ? 'opacity-40 cursor-not-allowed hover:bg-emerald-600' : ''}`}
            >
              {isInLineup ? <Minus className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </button>
            <button onClick={onClose} className="p-2 hover:bg-ink/5 rounded-full transition-colors text-ink/40 hover:text-ink">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="px-6 pt-4 border-b border-ink/10 bg-white/30">
          <div className="flex gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-t-sm border ${activeTab === tab.key ? 'bg-drafting-orange text-white border-drafting-orange' : 'bg-white/60 text-ink/50 border-ink/10 hover:text-ink/70'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar">
          {activeTab === 'dfs' && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                {[
                  { label: 'Avg FPTS', value: stats.avg, icon: Activity, color: 'text-drafting-orange' },
                  { label: 'AVG FPPM (L20)', value: stats.avgFppm, icon: TrendingUp, color: 'text-blue-600' },
                  {
                    label: 'Hit Rate (L20)',
                    value: `${stats.hitRate}%`,
                    icon: Zap,
                    color: 'text-emerald-600',
                    hint: 'Hit rate = % of games within 5 FPTS of projection.',
                  },
                  {
                    label: 'Miss Rate (L20)',
                    value: `${stats.missRate}%`,
                    icon: TrendingDown,
                    color: 'text-red-600',
                    hint: 'Miss rate = % of games off by more than 5 FPTS from projection.',
                  },
                  { label: 'Boom % (L20)', value: `${stats.boomRate}%`, icon: TrendingUp, color: 'text-emerald-600' },
                  { label: 'Bust % (L20)', value: `${stats.bustRate}%`, icon: TrendingDown, color: 'text-red-600' },
                ].map((stat, i) => (
                  <div key={i} className="group bg-white/40 border border-ink/10 p-3 rounded-sm relative">
                    <div className="flex items-center gap-2 mb-1.5">
                      <stat.icon className={`w-3 h-3 ${stat.color}`} />
                      <span className="text-[10px] font-black text-ink/60 uppercase tracking-widest">{stat.label}</span>
                    </div>
                    <div className="text-[1.2rem] font-black font-mono text-ink">{stat.value}</div>
                    {stat.hint && (
                      <div className="absolute top-2 right-2 hidden group-hover:block z-50 p-2 bg-white border border-ink/20 rounded-md shadow-lg text-xs whitespace-nowrap">
                        <div className="font-bold text-center mb-1">Stat Detail</div>
                        <div className="text-[10px] font-mono text-ink/70">{stat.hint}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="bg-white/40 border border-ink/10 rounded-sm p-6">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="w-4 h-4 text-drafting-orange" />
                  <h3 className="text-xs font-black uppercase tracking-widest text-ink/60">Production History (Last 20)</h3>
                </div>
                <div className="h-44 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke="#1a1c1e"
                        fontSize={10}
                        tickFormatter={(val) => String(val).split('-').slice(1).join('/')}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis stroke="#1a1c1e" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#f4f1ea', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '2px', color: '#1a1c1e' }}
                        itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                      />
                      <Bar dataKey="fpts" radius={[4, 4, 0, 0]} barSize={20}>
                        {chartData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fpts >= stats.median ? '#059669' : '#dc2626'} />
                        ))}
                      </Bar>
                      <Line type="monotone" dataKey="median" stroke="#1a1c1e" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white/40 border border-ink/10 rounded-sm overflow-hidden">
                <div className="p-4 border-b border-ink/10 bg-white/40">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-ink/60">
                    Positional DvP vs {opponentTeam?.abbreviation || player.opponent || '--'}
                  </h3>
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-[12px] font-black text-ink/40 uppercase tracking-widest border-b border-ink/10">
                      <th
                        onClick={() => setDvpSort(nextSort(dvpSort, 'position', 'asc'))}
                        className="px-4 py-2 cursor-pointer select-none"
                      >
                        Pos{dvpSort.key === 'position' ? (dvpSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                      <th
                        onClick={() => setDvpSort(nextSort(dvpSort, 'rank', 'asc'))}
                        className="px-4 py-2 text-right cursor-pointer select-none"
                      >
                        Rank{dvpSort.key === 'rank' ? (dvpSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                      <th
                        onClick={() => setDvpSort(nextSort(dvpSort, 'pts', 'desc'))}
                        className="px-4 py-2 text-right cursor-pointer select-none"
                      >
                        PTS{dvpSort.key === 'pts' ? (dvpSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                      <th
                        onClick={() => setDvpSort(nextSort(dvpSort, 'reb', 'desc'))}
                        className="px-4 py-2 text-right cursor-pointer select-none"
                      >
                        REB{dvpSort.key === 'reb' ? (dvpSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                      <th
                        onClick={() => setDvpSort(nextSort(dvpSort, 'ast', 'desc'))}
                        className="px-4 py-2 text-right cursor-pointer select-none"
                      >
                        AST{dvpSort.key === 'ast' ? (dvpSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                      <th
                        onClick={() => setDvpSort(nextSort(dvpSort, 'threePm', 'desc'))}
                        className="px-4 py-2 text-right cursor-pointer select-none"
                      >
                        3PM{dvpSort.key === 'threePm' ? (dvpSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                      <th
                        onClick={() => setDvpSort(nextSort(dvpSort, 'stl', 'desc'))}
                        className="px-4 py-2 text-right cursor-pointer select-none"
                      >
                        STL{dvpSort.key === 'stl' ? (dvpSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                      <th
                        onClick={() => setDvpSort(nextSort(dvpSort, 'blk', 'desc'))}
                        className="px-4 py-2 text-right cursor-pointer select-none"
                      >
                        BLK{dvpSort.key === 'blk' ? (dvpSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-[13px] font-mono">
                    {sortedDvpRows.length > 0 ? sortedDvpRows.map((row) => (
                      <tr key={row.position} className="border-b border-ink/5">
                        <td className="px-4 py-2 font-bold text-ink">{row.position}</td>
                        <td className="px-4 py-2 text-right">{row.rank ?? '--'}</td>
                        <td className={`px-4 py-2 text-right ${dvpStatClass(row.position, 'pts', row.pts)}`}>{row.pts?.toFixed(2) ?? '--'}</td>
                        <td className={`px-4 py-2 text-right ${dvpStatClass(row.position, 'reb', row.reb)}`}>{row.reb?.toFixed(2) ?? '--'}</td>
                        <td className={`px-4 py-2 text-right ${dvpStatClass(row.position, 'ast', row.ast)}`}>{row.ast?.toFixed(2) ?? '--'}</td>
                        <td className={`px-4 py-2 text-right ${dvpStatClass(row.position, '3pm', row.threePm)}`}>{row.threePm?.toFixed(2) ?? '--'}</td>
                        <td className="px-4 py-2 text-right">{row.stl?.toFixed(2) ?? '--'}</td>
                        <td className={`px-4 py-2 text-right ${dvpStatClass(row.position, 'blk', row.blk)}`}>{row.blk?.toFixed(2) ?? '--'}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={8} className="px-4 py-4 text-center text-ink/40">No positional DvP data available</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white/40 border border-ink/10 rounded-sm overflow-hidden">
                  <div className="p-4 border-b border-ink/10 bg-white/40 flex items-center gap-2">
                    <TrendingUp className="w-3 h-3 text-drafting-orange" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-ink/60">Game Log (Last 20)</h3>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="text-[12px] font-black text-ink/40 uppercase tracking-widest border-b border-ink/10">
                        <th
                          onClick={() => setGameLogSort(nextSort(gameLogSort, 'date', 'desc'))}
                          className="px-4 py-2 cursor-pointer select-none"
                        >
                          Date{gameLogSort.key === 'date' ? (gameLogSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                        <th
                          onClick={() => setGameLogSort(nextSort(gameLogSort, 'opponent', 'asc'))}
                          className="px-4 py-2 cursor-pointer select-none"
                        >
                          Opp{gameLogSort.key === 'opponent' ? (gameLogSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                        <th
                          onClick={() => setGameLogSort(nextSort(gameLogSort, 'minutes', 'desc'))}
                          className="px-4 py-2 text-right cursor-pointer select-none"
                        >
                          Min{gameLogSort.key === 'minutes' ? (gameLogSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                        <th
                          onClick={() => setGameLogSort(nextSort(gameLogSort, 'projection', 'desc'))}
                          className="px-4 py-2 text-right cursor-pointer select-none"
                        >
                          Proj{gameLogSort.key === 'projection' ? (gameLogSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </th>
                        {showGameLogActual && (
                          <th
                            onClick={() => setGameLogSort(nextSort(gameLogSort, 'actual', 'desc'))}
                            className="px-4 py-2 text-right cursor-pointer select-none"
                          >
                            Actual{gameLogSort.key === 'actual' ? (gameLogSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="text-[13px] font-mono">
                      {sortedHistory.length > 0 ? sortedHistory.map((game, i) => (
                        <tr key={`${game.date}-${i}`} className="border-b border-ink/5 hover:bg-white/40 transition-colors">
                          <td className="px-4 py-2 text-ink/40">{game.date}</td>
                          <td className="px-4 py-2 font-bold text-ink">{game.opponent}</td>
                          <td className="px-4 py-2 text-right text-ink/60">{game.minutes.toFixed(1)}</td>
                          <td className="px-4 py-2 text-right text-ink/40">{game.projection?.toFixed(1) || '--'}</td>
                          {showGameLogActual && (
                            <td className={`px-4 py-2 text-right font-black ${gameLogActualClass(game.fpts, game.projection ?? player.projection)}`}>
                              {game.fpts.toFixed(1)}
                            </td>
                          )}
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={showGameLogActual ? 5 : 4} className="px-4 py-4 text-center text-ink/40">
                            No boxscore history available
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <RotationVisualizer player={player} isHistorical={isHistorical} />
              </div>
            </>
          )}

          {activeTab === 'stats' && (
            <div className="space-y-4">
              <div className="bg-white/40 border border-ink/10 rounded-sm overflow-hidden">
                <div className="p-3 border-b border-ink/10 bg-white/40">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-ink/60">Traditional Splits</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse min-w-max">
                    <thead>
                      <tr className="text-[12px] font-black text-ink/40 uppercase tracking-widest border-b border-ink/10">
                        {traditionalColumns.map((col, colIndex) => {
                          const isActiveCol = traditionalHover?.col === colIndex;
                          return (
                            <th
                              key={`trad-head-${col}`}
                              onClick={() => setTraditionalSort(nextSort(traditionalSort, col, 'desc'))}
                              className={`px-3 py-2 text-right cursor-pointer select-none ${isActiveCol ? 'text-ink ring-1 ring-ink/25 ring-inset' : ''}`}
                            >
                              {col}{traditionalSort?.key === col ? (traditionalSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="text-[13px] font-mono" onMouseLeave={() => setTraditionalHover(null)}>
                      {sortedTraditionalRows.map((row, idx) => (
                        <tr key={`trad-row-${idx}`} className="border-b border-ink/5">
                          {traditionalColumns.map((col, colIndex) => {
                            const isHoveredCell = traditionalHover?.row === idx && traditionalHover?.col === colIndex;
                            const highlightClass = isHoveredCell ? 'ring-1 ring-ink/25 ring-inset' : '';
                            const isSeasonAvgRow = Boolean((row as any).__isSeasonAvg);
                            const meetsSeasonThreshold = isSeasonAvgRow && isSeasonStatAtThreshold(player.position, col, row[col]);
                            const textClass = meetsSeasonThreshold
                              ? 'bg-emerald-100 text-emerald-700 font-black'
                              : (isHoveredCell ? 'text-ink' : 'text-ink/70');
                            const threshold = meetsSeasonThreshold ? getSeasonStatThreshold(player.position, col) : null;
                            return (
                              <td
                                key={`trad-cell-${idx}-${col}`}
                                onMouseEnter={() => setTraditionalHover({ row: idx, col: colIndex })}
                                title={meetsSeasonThreshold && isFiniteNumeric(threshold) ? `Threshold ${threshold}` : undefined}
                                className={`px-3 py-2 text-right ${textClass} ${highlightClass}`}
                              >
                                {formatStatValue(row[col])}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white/40 border border-ink/10 rounded-sm overflow-hidden">
                <div className="p-3 border-b border-ink/10 bg-white/40">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-ink/60">Advanced Splits</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse min-w-max">
                    <thead>
                      <tr className="text-[12px] font-black text-ink/40 uppercase tracking-widest border-b border-ink/10">
                        {advancedColumns.map((col, colIndex) => {
                          const isActiveCol = advancedHover?.col === colIndex;
                          return (
                            <th
                              key={`adv-head-${col}`}
                              onClick={() => setAdvancedSort(nextSort(advancedSort, col, 'desc'))}
                              className={`px-3 py-2 text-right cursor-pointer select-none ${isActiveCol ? 'text-ink ring-1 ring-ink/25 ring-inset' : ''}`}
                            >
                              {col}{advancedSort?.key === col ? (advancedSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="text-[13px] font-mono" onMouseLeave={() => setAdvancedHover(null)}>
                      {sortedAdvancedRows.map((row, idx) => (
                        <tr key={`adv-row-${idx}`} className="border-b border-ink/5">
                          {advancedColumns.map((col, colIndex) => {
                            const isHoveredCell = advancedHover?.row === idx && advancedHover?.col === colIndex;
                            const highlightClass = isHoveredCell ? 'ring-1 ring-ink/25 ring-inset' : '';
                            const isSeasonAvgRow = Boolean((row as any).__isSeasonAvg);
                            const meetsSeasonThreshold = isSeasonAvgRow && isSeasonStatAtThreshold(player.position, col, row[col]);
                            const textClass = meetsSeasonThreshold
                              ? 'bg-emerald-100 text-emerald-700 font-black'
                              : (isHoveredCell ? 'text-ink' : 'text-ink/70');
                            const threshold = meetsSeasonThreshold ? getSeasonStatThreshold(player.position, col) : null;
                            return (
                              <td
                                key={`adv-cell-${idx}-${col}`}
                                onMouseEnter={() => setAdvancedHover({ row: idx, col: colIndex })}
                                title={meetsSeasonThreshold && isFiniteNumeric(threshold) ? `Threshold ${threshold}` : undefined}
                                className={`px-3 py-2 text-right ${textClass} ${highlightClass}`}
                              >
                                {formatStatValue(row[col])}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'matchup' && (
            <div className="space-y-4">
              <div className="bg-white/40 border border-ink/10 rounded-sm p-4 space-y-4">
                <div
                  className="sticky top-0 z-10 rounded-sm border px-3 py-2"
                  style={{ backgroundColor: matchupSignal.toneStyle.bg, borderColor: matchupSignal.toneStyle.border }}
                >
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center px-2 py-1 rounded-sm text-[10px] font-black uppercase"
                        style={{ color: matchupSignal.toneStyle.fg, border: `1px solid ${matchupSignal.toneStyle.border}` }}
                      >
                        {matchupSignal.verdictLabel}
                      </span>
                      <span className="text-[10px] font-mono text-white/90">
                        Estimated matchup impact: {matchupSignal.impactFp >= 0 ? '+' : ''}{matchupSignal.impactFp.toFixed(2)} FP
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-white/90">
                      Confidence: {(matchupSignal.combinedConf * 100).toFixed(0)}% {matchupSignal.confidenceLabel}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-ink/60">On/Off Matchup Signal</div>
                    <div className="text-[9px] font-mono text-ink/50 uppercase tracking-widest mt-1">
                      Proj {matchupProjection.toFixed(2)} · Min {matchupMinutes?.toFixed(1) ?? '--'} · Usage {matchupUsage?.toFixed(1) ?? '--'}%
                    </div>
                  </div>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-sm text-[9px] font-black uppercase text-white"
                    style={{ backgroundColor: matchupSignal.toneStyle.border }}
                  >
                    {matchupSignal.verdictLabel}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="border border-ink/10 bg-white/60 rounded-sm p-3">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-ink/50">
                      Opponent Environment
                      <span
                        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-ink/20 text-[9px] font-black text-ink/40"
                        title="Leverage shifts the matchup signal based on upside vs ownership."
                      >
                        i
                      </span>
                    </div>
                    <div className="text-lg font-black text-ink">
                      {matchupSignal.combinedDiff >= 0 ? '+' : ''}{matchupSignal.combinedDiff.toFixed(2)} FP/100
                    </div>
                    <div className="text-[10px] font-mono text-ink/60">
                      Weighted positional + team signal
                    </div>
                  </div>
                  <div className="border border-ink/10 bg-white/60 rounded-sm p-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-ink/50">Player Involvement</div>
                    <div className="text-lg font-black text-ink">
                      {matchupSignal.usageRate.toFixed(1)}% usage • {matchupSignal.minutesProjection.toFixed(1)} min
                    </div>
                    <div className="text-[10px] font-mono text-ink/60">
                      Impact scale x{((matchupSignal.minutesProjection / 36) * (matchupSignal.usageRate / 24)).toFixed(2)}
                    </div>
                  </div>
                  <div className="border border-ink/10 bg-white/60 rounded-sm p-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-ink/50">Reliability</div>
                    <div className="text-lg font-black text-ink">
                      {(matchupSignal.combinedConf * 100).toFixed(0)}% {matchupSignal.confidenceLabel}
                    </div>
                    <div className="text-[10px] font-mono text-ink/60">
                      Sample-weighted blend confidence
                    </div>
                  </div>
                </div>

                <div className="border border-ink/10 bg-white/60 rounded-sm p-3 text-[10px] font-mono text-ink/70">
                  <div>Positional weight: {Math.round(matchupSignal.wPos * 100)}%</div>
                  <div>Team weight: {Math.round(matchupSignal.wTeam * 100)}%</div>
                  <div>Blended diff: {matchupSignal.combinedDiff >= 0 ? '+' : ''}{matchupSignal.combinedDiff.toFixed(2)} FP/100</div>
                  {matchupSignal.hasLeverageBreakdown && (
                    <div className="mt-2 pt-2 border-t border-ink/10">
                      <div className="text-[9px] font-black uppercase tracking-widest text-ink/50">Leverage Impact</div>
                      <div className="text-[9px] text-ink/40">
                        Base: {matchupSignal.baseTierLabel ?? '--'} · {matchupSignal.baseImpactFp !== undefined
                          ? `${matchupSignal.baseImpactFp >= 0 ? '+' : ''}${matchupSignal.baseImpactFp.toFixed(2)} FP`
                          : '--'}
                      </div>
                      <div className="text-[9px] text-ink/70">
                        Leverage: {matchupSignal.leverageTierLabel ?? '--'} · {matchupSignal.leverageScore !== undefined
                          ? `${matchupSignal.leverageScore.toFixed(2)} score`
                          : '--'}
                      </div>
                      <div className="text-[9px] font-black text-ink/80">
                        Adjusted: {matchupSignal.verdictLabel} · {matchupSignal.impactFp >= 0 ? '+' : ''}{matchupSignal.impactFp.toFixed(2)} FP
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-[10px] font-mono text-ink/70 border border-ink/10 bg-ink/5 rounded-sm p-3">
                  Combined signal blends positional and team on/off context, then scales by player minutes and usage.
                </div>

                <details className="rounded-sm border border-ink/10 bg-white/60 p-3 text-[10px] font-mono text-ink/70">
                  <summary className="cursor-pointer font-black uppercase tracking-widest text-ink/60">
                    Positional vs Team Breakdown
                  </summary>
                  <div className="mt-3 space-y-1">
                    <div>Blended diff: {matchupSignal.combinedDiff >= 0 ? '+' : ''}{matchupSignal.combinedDiff.toFixed(2)} FP/100</div>
                    <div>Weights: {Math.round(matchupSignal.wPos * 100)}% positional / {Math.round(matchupSignal.wTeam * 100)}% team</div>
                    <div>Impact: {matchupSignal.impactFp >= 0 ? '+' : ''}{matchupSignal.impactFp.toFixed(2)} FP</div>
                    <div>Confidence: {(matchupSignal.combinedConf * 100).toFixed(0)}% {matchupSignal.confidenceLabel}</div>
                    <div>Minutes proj: {matchupSignal.minutesProjection.toFixed(1)} · Usage: {matchupSignal.usageRate.toFixed(1)}%</div>
                  </div>
                </details>
              </div>
            </div>
          )}

          {activeTab === 'synergy' && (
            <div className="bg-white/40 border border-ink/10 rounded-sm overflow-hidden">
              <div className="p-4 border-b border-ink/10 bg-white/40">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-ink/60">Synergies With {player.name}</h3>
              </div>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[12px] font-black text-ink/40 uppercase tracking-widest border-b border-ink/10">
                    <th
                      onClick={() => setSynergySort(nextSort(synergySort, 'name', 'asc'))}
                      className="px-4 py-2 cursor-pointer select-none"
                    >
                      Player{synergySort.key === 'name' ? (synergySort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th
                      onClick={() => setSynergySort(nextSort(synergySort, 'team', 'asc'))}
                      className="px-4 py-2 cursor-pointer select-none"
                    >
                      Team{synergySort.key === 'team' ? (synergySort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th
                      onClick={() => setSynergySort(nextSort(synergySort, 'pos', 'asc'))}
                      className="px-4 py-2 cursor-pointer select-none"
                    >
                      Pos{synergySort.key === 'pos' ? (synergySort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th
                      onClick={() => setSynergySort(nextSort(synergySort, 'correlation', 'desc'))}
                      className="px-4 py-2 text-right cursor-pointer select-none"
                    >
                      Correlation{synergySort.key === 'correlation' ? (synergySort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                    <th
                      onClick={() => setSynergySort(nextSort(synergySort, 'combinedProj', 'desc'))}
                      className="px-4 py-2 text-right cursor-pointer select-none"
                    >
                      Combined Proj{synergySort.key === 'combinedProj' ? (synergySort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[13px] font-mono">
                  {sortedSynergyRows.length > 0 ? sortedSynergyRows.map((row) => (
                    <tr key={row.id} className="border-b border-ink/5">
                      <td className="px-4 py-2 font-bold text-ink">{row.name}</td>
                      <td className="px-4 py-2 text-ink/60">{row.team}</td>
                      <td className="px-4 py-2 text-ink/60">{row.pos}</td>
                      <td className={`px-4 py-2 text-right font-bold ${row.correlation >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {row.correlation > 0 ? '+' : ''}{row.correlation.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right text-drafting-orange font-bold">{row.combinedProj.toFixed(2)}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 text-center text-ink/40">
                        No same-team synergy candidates found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === 'depth' && (
            <div className="bg-white/40 border border-ink/10 rounded-sm overflow-hidden">
              <div className="p-4 border-b border-ink/10 bg-white/40">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-ink/60">
                  {player.team} Depth Chart
                </h3>
              </div>
              {depthChartRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse min-w-max">
                    <thead>
                      <tr className="text-[11px] font-black text-ink/40 uppercase tracking-widest border-b border-ink/10">
                        <th className="px-4 py-2 text-left">Pos</th>
                        {depthChartColumns.map((col) => (
                          <th key={`depth-head-${col}`} className="px-4 py-2 text-left">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-[13px] font-mono">
                      {depthChartRows.map((row) => (
                        <tr key={`depth-${row.position}`} className="border-b border-ink/5">
                          <td className="px-4 py-2 font-bold text-ink">{row.position}</td>
                          {depthChartColumns.map((_, idx) => {
                            const name = row.players[idx];
                            if (!name) {
                              return (
                                <td key={`depth-${row.position}-${idx}`} className="px-4 py-2 text-ink/40">
                                  --
                                </td>
                              );
                            }
                            const tag = getInjuryTag(name);
                            return (
                              <td key={`depth-${row.position}-${idx}`} className="px-4 py-2 text-ink">
                                <span className="font-bold">{name}</span>
                                {tag && (
                                  <span className="ml-2 text-[10px] font-black text-red-600 uppercase">{tag}</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-4 py-8 text-center text-ink/40 text-[10px] font-black uppercase tracking-widest">
                  No depth chart data available for {player.team}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

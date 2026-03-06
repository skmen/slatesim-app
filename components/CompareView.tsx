import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Player, GameInfo } from '../types';
import { GitCompare, Table2, Filter, X, Trash2, PlusCircle } from 'lucide-react';
import { MatchupEngine } from './MatchupEngine';
import { calculateValueScores } from '../utils/valueScore';

interface Props {
  players: Player[];
  games: GameInfo[];
  showActuals: boolean;
}

type CompareTable = 'dvp' | 'stats';
type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
type SortDir = 'asc' | 'desc';
type Operator = 'equals' | 'contains' | 'gt' | 'lt' | 'in';

interface SortConfig {
  key: string;
  dir: SortDir;
}

interface FilterRule {
  id: string;
  column: string;
  operator: Operator;
  value: string;
  logic: 'AND' | 'OR';
}

interface DvpRow {
  player: Player;
  opp: string;
  position: Position;
  projection: number;
  actual: number | null;
  dvpRank: any;
  ptsAllowed: any;
  rebAllowed: any;
  astAllowed: any;
  threePmAllowed: any;
  blkAllowed: any;
  stlAllowed: any;
}

interface StatsRow {
  player: Player;
  opp: string;
  position: Position;
  value: number | null;
  ownership: any;
  minutes: any;
  usage: any;
  fp: any;
  pts: any;
  reb: any;
  ast: any;
  stl: any;
  blk: any;
  tov: any;
  fga: any;
  fta: any;
  fgPct: any;
  threePm: any;
  threePa: any;
  threePct: any;
  tsPct: any;
  pie: any;
  projection: number;
  actual: number | null;
}

const ALL_MATCHUPS_KEY = 'ALL_MATCHUPS';

const POSITIONS: Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

const FILTER_COLUMNS = [
  { key: 'name', label: 'Player' },
  { key: 'team', label: 'Team' },
  { key: 'opp', label: 'Opp' },
  { key: 'position', label: 'Pos' },
  { key: 'salary', label: 'Salary' },
  { key: 'value', label: 'Value' },
  { key: 'projection', label: 'Proj' },
  { key: 'actual', label: 'Actual' },
  { key: 'ownership', label: 'Own%' },
  { key: 'minutes', label: 'Min' },
  { key: 'usage', label: 'Usage' },
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'tov', label: 'TOV' },
  { key: 'dvpRank', label: 'DvP Rank' },
  { key: 'ptsAllowed', label: 'PTS Allowed' },
  { key: 'rebAllowed', label: 'REB Allowed' },
  { key: 'astAllowed', label: 'AST Allowed' },
  { key: 'threePmAllowed', label: '3PM Allowed' },
  { key: 'blkAllowed', label: 'BLK Allowed' },
  { key: 'stlAllowed', label: 'STL Allowed' },
] as const;

const SEASON_STAT_THRESHOLDS: Record<Position, Partial<Record<string, number>>> = {
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

const parsePositions = (position: string): Position[] =>
  String(position || '')
    .split(/[\/,\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter((p): p is Position => POSITIONS.includes(p as Position));

const parseMatchup = (text: any): { away: string; home: string } | null => {
  const match = String(text || '').match(/([A-Z]{2,5})\s*@\s*([A-Z]{2,5})/i);
  if (!match) return null;
  return { away: match[1].toUpperCase(), home: match[2].toUpperCase() };
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

const formatNum = (value: any, digits = 2): string => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(digits) : '--';
};

const formatPct = (value: any, digits = 1): string => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '--';
  return `${num.toFixed(digits)}%`;
};

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

const isFiniteNumeric = (value: any): boolean =>
  value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

const nextSort = (current: SortConfig, key: string, defaultDir: SortDir = 'desc'): SortConfig => {
  if (current.key === key) {
    return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: defaultDir };
};

const normalizeStatForThreshold = (column: string, raw: any): number | null => {
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  if (column.includes('%') && num <= 1) return num * 100;
  return num;
};

const getSeasonStatThreshold = (position: Position, column: string): number | null => {
  const threshold = SEASON_STAT_THRESHOLDS[position]?.[column];
  return isFiniteNumeric(threshold) ? Number(threshold) : null;
};

const isSeasonStatAtThreshold = (position: Position, column: string, raw: any): boolean => {
  const threshold = getSeasonStatThreshold(position, column);
  if (threshold === null) return false;
  const value = normalizeStatForThreshold(column, raw);
  if (value === null) return false;
  return value >= threshold;
};

const dvpStatClass = (position: Position, stat: 'pts' | 'reb' | 'ast' | 'blk' | '3pm', value: number | null): string => {
  if (!Number.isFinite(Number(value))) return 'text-ink';
  const val = Number(value);
  const between = (min: number, max: number) => val >= min && val <= max;

  if (position === 'PG') {
    if (stat === 'pts') return val < 21.0 ? 'text-red-600' : between(21.0, 24.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'ast') return val < 7.5 ? 'text-red-600' : between(7.5, 9.4) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'reb') return val < 5.5 ? 'text-red-600' : between(5.5, 6.4) ? 'text-ink' : 'text-emerald-600';
  }
  if (position === 'SG') {
    if (stat === 'pts') return val < 21.0 ? 'text-red-600' : between(21.0, 23.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === '3pm') return val < 2.5 ? 'text-red-600' : between(2.5, 3.4) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'reb') return val < 5.0 ? 'text-red-600' : between(5.0, 6.4) ? 'text-ink' : 'text-emerald-600';
  }
  if (position === 'SF') {
    if (stat === 'pts') return val < 19.0 ? 'text-red-600' : between(19.0, 21.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'reb') return val < 6.5 ? 'text-red-600' : between(6.5, 7.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'ast') return val < 3.5 ? 'text-red-600' : between(3.5, 4.9) ? 'text-ink' : 'text-emerald-600';
  }
  if (position === 'PF') {
    if (stat === 'pts') return val < 20.0 ? 'text-red-600' : between(20.0, 22.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'reb') return val < 9.0 ? 'text-red-600' : between(9.0, 10.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'ast') return val < 3.5 ? 'text-red-600' : between(3.5, 4.9) ? 'text-ink' : 'text-emerald-600';
  }
  if (position === 'C') {
    if (stat === 'pts') return val < 20.0 ? 'text-red-600' : between(20.0, 23.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'reb') return val < 12.0 ? 'text-red-600' : between(12.0, 14.9) ? 'text-ink' : 'text-emerald-600';
    if (stat === 'blk') return val < 1.5 ? 'text-red-600' : between(1.5, 2.4) ? 'text-ink' : 'text-emerald-600';
  }
  return 'text-ink';
};

const getStatsThresholdColumn = (key: string): string | null => {
  if (key === 'usage') return 'USG%';
  if (key === 'reb') return 'REB';
  if (key === 'ast') return 'AST';
  if (key === 'blk') return 'BLK';
  if (key === 'fga') return 'FGA';
  if (key === 'fta') return 'FTA';
  if (key === 'threePa') return '3PA';
  return null;
};

const getSeasonHighlightClass = (position: Position, key: string, value: any): string => {
  const thresholdColumn = getStatsThresholdColumn(key);
  if (!thresholdColumn) return 'text-ink/70';
  if (!isSeasonStatAtThreshold(position, thresholdColumn, value)) return 'text-ink/70';
  return 'bg-emerald-100 text-emerald-700 font-black';
};

const getSeasonThresholdTitle = (position: Position, key: string, value: any): string | undefined => {
  const thresholdColumn = getStatsThresholdColumn(key);
  if (!thresholdColumn) return undefined;
  if (!isSeasonStatAtThreshold(position, thresholdColumn, value)) return undefined;
  const threshold = getSeasonStatThreshold(position, thresholdColumn);
  return threshold === null ? undefined : `Threshold ${threshold}`;
};

const getPlayerStat = (player: Player, keys: string[]): any => {
  const fromAdvanced = readByKeys((player as any).advancedMetrics, keys);
  const fromSlate = readByKeys((player as any).slateData, keys);
  const fromProfile = readByKeys((player as any).statsProfile, keys);
  const fromPlayer = readByKeys(player as any, keys);
  if (fromAdvanced !== undefined) return fromAdvanced;
  if (fromSlate !== undefined) return fromSlate;
  if (fromProfile !== undefined) return fromProfile;
  return fromPlayer;
};

const getActualFptsValue = (player: Player): number | null => {
  const actualVal = Number(
    player.actual ??
    (player as any).actualFpts ??
    (player as any).actual_fpts ??
    player.history?.[player.history.length - 1]?.fpts
  );
  return Number.isFinite(actualVal) ? actualVal : null;
};

const normalizeTeamToken = (value: any): string =>
  String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const buildTeamLookup = (games: GameInfo[]) => {
  const map = new Map<string, GameInfo['teamA'] | GameInfo['teamB']>();
  const add = (team: GameInfo['teamA'] | GameInfo['teamB']) => {
    const tokens = [
      normalizeTeamToken(team?.teamId),
      normalizeTeamToken(team?.abbreviation),
      normalizeTeamToken(team?.name),
    ].filter(Boolean);
    tokens.forEach((token) => {
      if (!map.has(token)) map.set(token, team);
    });
  };
  games.forEach((game) => {
    add(game.teamA);
    add(game.teamB);
  });
  return map;
};

const getOpponentTeamForPlayer = (
  player: Player,
  games: GameInfo[],
  teamLookup: Map<string, GameInfo['teamA'] | GameInfo['teamB']>,
): GameInfo['teamA'] | GameInfo['teamB'] | undefined => {
  const teamId = normalizeTeamToken(player.team);
  if (!teamId) return undefined;

  const parsed = parseMatchup((player as any)['Game Info'] ?? (player as any).gameInfo);
  if (parsed) {
    const away = normalizeTeamToken(parsed.away);
    const home = normalizeTeamToken(parsed.home);
    if (teamId === away) {
      return teamLookup.get(home);
    }
    if (teamId === home) {
      return teamLookup.get(away);
    }
  }

  const directOpponent = normalizeTeamToken(player.opponent);
  if (directOpponent) {
    const game = games.find((g) => {
      const a = normalizeTeamToken(g.teamA.teamId);
      const b = normalizeTeamToken(g.teamB.teamId);
      return (a === teamId && b === directOpponent) || (b === teamId && a === directOpponent);
    });
    if (game) {
      return normalizeTeamToken(game.teamA.teamId) === directOpponent ? game.teamA : game.teamB;
    }
    return teamLookup.get(directOpponent);
  }

  const fallbackGame = games.find((g) => {
    const a = normalizeTeamToken(g.teamA.teamId);
    const b = normalizeTeamToken(g.teamB.teamId);
    return a === teamId || b === teamId;
  });
  if (!fallbackGame) return undefined;
  return normalizeTeamToken(fallbackGame.teamA.teamId) === teamId ? fallbackGame.teamB : fallbackGame.teamA;
};

export const CompareView: React.FC<Props> = ({ players, games, showActuals }) => {
  const [selectedPosition, setSelectedPosition] = useState<Position>('PG');
  const [selectedTable, setSelectedTable] = useState<CompareTable>('dvp');
  const [selectedMatchupKey, setSelectedMatchupKey] = useState<string>(ALL_MATCHUPS_KEY);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [showFilterBuilder, setShowFilterBuilder] = useState(false);
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [dvpSort, setDvpSort] = useState<SortConfig>({ key: 'dvpRank', dir: 'asc' });
  const [statsSort, setStatsSort] = useState<SortConfig>({ key: 'projection', dir: 'desc' });
  const topScrollbarRef = useRef<HTMLDivElement | null>(null);
  const tableScrollbarRef = useRef<HTMLDivElement | null>(null);
  const scrollSyncLockRef = useRef(false);

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

  const matchupMap = useMemo(() => new Map(effectiveGames.map((g) => [g.matchupKey, g])), [effectiveGames]);

  const teamAbbrevMap = useMemo(() => {
    const map = new Map<string, string>();
    effectiveGames.forEach((game) => {
      map.set(game.teamA.teamId, game.teamA.abbreviation || game.teamA.teamId);
      map.set(game.teamB.teamId, game.teamB.abbreviation || game.teamB.teamId);
    });
    return map;
  }, [effectiveGames]);

  const teamLookup = useMemo(() => buildTeamLookup(effectiveGames), [effectiveGames]);
  const valueScoreMap = useMemo(() => calculateValueScores(players, effectiveGames), [players, effectiveGames]);

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
    let pool = players.filter((player) => parsePositions(player.position).includes(selectedPosition));

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

    return [...pool].sort((a, b) => (Number(b.projection) || 0) - (Number(a.projection) || 0));
  }, [players, selectedPosition, selectedMatchupKey, selectedTeams, matchupMap]);

  const addFilter = () => {
    const newFilter: FilterRule = {
      id: Math.random().toString(36).slice(2, 11),
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

  const sortIndicator = (activeSort: SortConfig, key: string) =>
    activeSort.key === key ? (activeSort.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const dvpRows = useMemo<DvpRow[]>(() => {
    return filteredPlayers.map((player) => {
      const actual = getActualFptsValue(player);
      const opponentTeam = getOpponentTeamForPlayer(player, effectiveGames, teamLookup);
      const dvpRow = opponentTeam?.positionalDvP?.[selectedPosition] || {};
      return {
        player,
        opp: String(
          opponentTeam?.abbreviation
          || teamAbbrevMap.get(player.opponent)
          || player.opponent
          || '--'
        ).toUpperCase(),
        position: selectedPosition,
        projection: Number(player.projection) || 0,
        actual,
        dvpRank: readByKeys(dvpRow, ['rank']),
        ptsAllowed: readByKeys(dvpRow, ['PTS', 'points', 'fantasyPointsAllowedPerGame']),
        rebAllowed: readByKeys(dvpRow, ['REB', 'rebounds']),
        astAllowed: readByKeys(dvpRow, ['AST', 'assists', 'A', 'APG']),
        threePmAllowed: readByKeys(dvpRow, ['3PM', '3pm', '3P', '3ptm', '3PTM']),
        blkAllowed: readByKeys(dvpRow, ['BLK', 'blocks']),
        stlAllowed: readByKeys(dvpRow, ['STL', 'steals']),
      };
    });
  }, [effectiveGames, filteredPlayers, selectedPosition, teamAbbrevMap, teamLookup]);

  const statsRows = useMemo<StatsRow[]>(() => {
    return filteredPlayers.map((player) => {
      const actual = getActualFptsValue(player);

      return {
        player,
        opp: (teamAbbrevMap.get(player.opponent) || player.opponent || '--').toUpperCase(),
        position: selectedPosition,
        value: valueScoreMap.get(player.id)?.composite ?? null,
        ownership: getPlayerStat(player, ['ownership', 'OWNERSHIP_PCT']),
        minutes: getPlayerStat(player, ['minutesProjection', 'minutes', 'min', 'MINUTES_PROJ']),
        usage: getPlayerStat(player, ['usageRate', 'usage_rate', 'USG%', 'USAGE_PCT']),
        fp: getPlayerStat(player, ['FP', 'FPTS', 'fantasyPoints']),
        pts: getPlayerStat(player, ['PTS', 'points']),
        reb: getPlayerStat(player, ['REB', 'rebounds']),
        ast: getPlayerStat(player, ['AST', 'assists', 'A']),
        stl: getPlayerStat(player, ['STL', 'steals']),
        blk: getPlayerStat(player, ['BLK', 'blocks']),
        tov: getPlayerStat(player, ['TOV', 'TO', 'turnovers']),
        fga: getPlayerStat(player, ['FGA']),
        fta: getPlayerStat(player, ['FTA']),
        fgPct: getPlayerStat(player, ['FG%', 'FGPCT', 'fgPct']),
        threePm: getPlayerStat(player, ['3PM', '3pm']),
        threePa: getPlayerStat(player, ['3PA', '3pa']),
        threePct: getPlayerStat(player, ['3P%', '3PPCT', '3pPct']),
        tsPct: getPlayerStat(player, ['TS%', 'TSPCT', 'tsPct']),
        pie: getPlayerStat(player, ['PIE', 'PIE%', 'PIEPCT', 'playerImpactEstimate']),
        projection: player.projection,
        actual,
      };
    });
  }, [filteredPlayers, selectedPosition, teamAbbrevMap, valueScoreMap]);

  const getDvpValue = (row: DvpRow, key: string): any => {
    switch (key) {
      case 'name': return row.player.name;
      case 'team': return row.player.team;
      case 'opp': return row.opp;
      case 'position': return row.position;
      case 'dvpRank': return row.dvpRank;
      case 'ptsAllowed': return row.ptsAllowed;
      case 'rebAllowed': return row.rebAllowed;
      case 'astAllowed': return row.astAllowed;
      case 'threePmAllowed': return row.threePmAllowed;
      case 'blkAllowed': return row.blkAllowed;
      case 'stlAllowed': return row.stlAllowed;
      case 'salary': return row.player.salary;
      case 'projection': return row.projection;
      case 'actual': return row.actual;
      default: return (row as any)[key];
    }
  };

  const getStatsValue = (row: StatsRow, key: string): any => {
    switch (key) {
      case 'name': return row.player.name;
      case 'team': return row.player.team;
      case 'opp': return row.opp;
      case 'position': return row.position;
      case 'salary': return row.player.salary;
      case 'value': return row.value;
      case 'projection': return row.projection;
      case 'actual': return row.actual;
      case 'ownership': return row.ownership;
      case 'minutes': return row.minutes;
      case 'usage': return row.usage;
      case 'fp': return row.fp;
      case 'pts': return row.pts;
      case 'reb': return row.reb;
      case 'ast': return row.ast;
      case 'stl': return row.stl;
      case 'blk': return row.blk;
      case 'tov': return row.tov;
      case 'fga': return row.fga;
      case 'fta': return row.fta;
      case 'fgPct': return row.fgPct;
      case 'threePm': return row.threePm;
      case 'threePa': return row.threePa;
      case 'threePct': return row.threePct;
      case 'tsPct': return row.tsPct;
      case 'pie': return row.pie;
      default: return (row as any)[key];
    }
  };

  const applyFilters = <T,>(rows: T[], getValue: (row: T, key: string) => any): T[] => {
    if (filters.length === 0) return rows;
    return rows.filter((row) => {
      let match = true;
      filters.forEach((filter, index) => {
        const rawVal = getValue(row, filter.column);
        const rowVal = String(rawVal ?? '').toLowerCase();
        const filterVal = String(filter.value ?? '').toLowerCase();
        const nRow = parseFloat(rowVal);
        const nFilter = parseFloat(filterVal);
        let currentMatch = false;
        switch (filter.operator) {
          case 'equals':
            currentMatch = rowVal === filterVal;
            break;
          case 'contains':
            currentMatch = rowVal.includes(filterVal);
            break;
          case 'gt':
            currentMatch = !Number.isNaN(nRow) && !Number.isNaN(nFilter) && nRow > nFilter;
            break;
          case 'lt':
            currentMatch = !Number.isNaN(nRow) && !Number.isNaN(nFilter) && nRow < nFilter;
            break;
          case 'in':
            currentMatch = filterVal.split(',').map((v) => v.trim()).includes(rowVal);
            break;
        }
        if (index === 0) {
          match = currentMatch;
        } else if (filter.logic === 'AND') {
          match = match && currentMatch;
        } else {
          match = match || currentMatch;
        }
      });
      return match;
    });
  };

  const displayedDvpRows = useMemo(() => {
    const filtered = applyFilters(dvpRows, getDvpValue);
    return [...filtered].sort((a, b) => {
      const cmp = compareValues(getDvpValue(a, dvpSort.key), getDvpValue(b, dvpSort.key));
      return dvpSort.dir === 'asc' ? cmp : -cmp;
    });
  }, [dvpRows, filters, dvpSort]);

  const displayedStatsRows = useMemo(() => {
    const filtered = applyFilters(statsRows, getStatsValue);
    return [...filtered].sort((a, b) => {
      const cmp = compareValues(getStatsValue(a, statsSort.key), getStatsValue(b, statsSort.key));
      return statsSort.dir === 'asc' ? cmp : -cmp;
    });
  }, [statsRows, filters, statsSort]);

  const visibleRowCount = selectedTable === 'dvp' ? displayedDvpRows.length : displayedStatsRows.length;
  const tableMinWidth = selectedTable === 'dvp' ? 1180 : 1700;

  const handleTopScrollbarScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (scrollSyncLockRef.current) return;
    scrollSyncLockRef.current = true;
    if (tableScrollbarRef.current) {
      tableScrollbarRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
    window.requestAnimationFrame(() => {
      scrollSyncLockRef.current = false;
    });
  };

  const handleTableScrollbarScroll = (event: React.UIEvent<HTMLDivElement>) => {
    if (scrollSyncLockRef.current) return;
    scrollSyncLockRef.current = true;
    if (topScrollbarRef.current) {
      topScrollbarRef.current.scrollLeft = event.currentTarget.scrollLeft;
    }
    window.requestAnimationFrame(() => {
      scrollSyncLockRef.current = false;
    });
  };

  const toggleMatchup = (matchupKey: string) => {
    setSelectedTeams([]);
    setSelectedMatchupKey((prev) => (prev === matchupKey ? ALL_MATCHUPS_KEY : matchupKey));
  };

  const toggleTeam = (teamId: string) => {
    setSelectedMatchupKey(ALL_MATCHUPS_KEY);
    setSelectedTeams((prev) => (prev.includes(teamId) ? prev.filter((team) => team !== teamId) : [...prev, teamId]));
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
                filters.map((filter, idx) => (
                  <div key={filter.id} className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-sm border border-ink/10">
                    {idx > 0 && (
                      <select
                        value={filter.logic}
                        onChange={(e) => updateFilter(filter.id, { logic: e.target.value as 'AND' | 'OR' })}
                        className="bg-vellum border border-ink/20 rounded px-2 py-1 text-[10px] font-bold text-drafting-orange uppercase"
                      >
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                      </select>
                    )}
                    <select
                      value={filter.column}
                      onChange={(e) => updateFilter(filter.id, { column: e.target.value })}
                      className="flex-1 min-w-[120px] bg-vellum border border-ink/20 rounded px-3 py-2 text-xs font-bold text-ink outline-none focus:border-drafting-orange"
                    >
                      {FILTER_COLUMNS.map((column) => (
                        <option key={column.key} value={column.key}>{column.label}</option>
                      ))}
                    </select>
                    <select
                      value={filter.operator}
                      onChange={(e) => updateFilter(filter.id, { operator: e.target.value as Operator })}
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
                      value={filter.value}
                      onChange={(e) => updateFilter(filter.id, { value: e.target.value })}
                      placeholder="Value..."
                      className="flex-1 min-w-[120px] bg-vellum border border-ink/20 rounded px-3 py-2 text-xs font-bold text-ink outline-none focus:border-drafting-orange placeholder:text-ink/30"
                    />
                    <button onClick={() => removeFilter(filter.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
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

      <div className="flex items-center gap-2">
        <GitCompare className="w-5 h-5 text-drafting-orange" />
        <h2 className="text-lg font-black uppercase tracking-widest text-ink">Compare Players</h2>
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

      <div className="bg-white/40 border border-ink/10 rounded-sm p-4 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-end gap-4">
          <div className="min-w-[180px]">
            <label className="block text-[10px] font-black text-ink/60 uppercase tracking-widest mb-1">
              Position
            </label>
            <select
              value={selectedPosition}
              onChange={(e) => setSelectedPosition(e.target.value as Position)}
              className="w-full bg-white/70 border border-ink/20 rounded-sm px-3 py-2 text-xs font-bold text-ink outline-none focus:border-drafting-orange"
            >
              {POSITIONS.map((position) => (
                <option key={position} value={position}>{position}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[260px]">
            <label className="block text-[10px] font-black text-ink/60 uppercase tracking-widest mb-1">
              Comparison Table
            </label>
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value as CompareTable)}
              className="w-full bg-white/70 border border-ink/20 rounded-sm px-3 py-2 text-xs font-bold text-ink outline-none focus:border-drafting-orange"
            >
              <option value="dvp">DvP Rank + Stats Allowed</option>
              <option value="stats">Stats</option>
            </select>
          </div>
          <div className="md:ml-auto text-[10px] font-black uppercase tracking-widest text-ink/50">
            {visibleRowCount} {selectedPosition} Players
          </div>
        </div>
      </div>

      <div className="bg-white/40 border border-ink/10 rounded-sm p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Table2 className="w-4 h-4 text-drafting-orange" />
            <h3 className="text-xs font-black uppercase tracking-widest text-ink/60">
              {selectedTable === 'dvp' ? `DvP Comparison (${selectedPosition})` : `Stats Comparison (${selectedPosition})`}
            </h3>
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

        <div
          ref={topScrollbarRef}
          onScroll={handleTopScrollbarScroll}
          className="overflow-x-auto overflow-y-hidden border border-ink/10 rounded-sm bg-white/20 mb-2 h-3.5"
        >
          <div style={{ width: tableMinWidth, height: 1 }} />
        </div>

        <div
          ref={tableScrollbarRef}
          onScroll={handleTableScrollbarScroll}
          className="overflow-x-auto border border-ink/10 rounded-sm bg-white/30"
        >
          {selectedTable === 'dvp' ? (
            <table className="w-full border-collapse min-w-[1180px]">
              <thead>
                <tr className="text-[9px] font-black text-ink/40 uppercase tracking-widest border-b border-ink/10 bg-white/40">
                  <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'name', 'asc'))}>Player{sortIndicator(dvpSort, 'name')}</th>
                  <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'team', 'asc'))}>Team{sortIndicator(dvpSort, 'team')}</th>
                  <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'opp', 'asc'))}>Opp{sortIndicator(dvpSort, 'opp')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'projection', 'desc'))}>Proj FPTS{sortIndicator(dvpSort, 'projection')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'actual', 'desc'))}>Actual FPTS{sortIndicator(dvpSort, 'actual')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'dvpRank', 'asc'))}>DvP Rank{sortIndicator(dvpSort, 'dvpRank')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'ptsAllowed', 'desc'))}>PTS Allowed{sortIndicator(dvpSort, 'ptsAllowed')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'rebAllowed', 'desc'))}>REB Allowed{sortIndicator(dvpSort, 'rebAllowed')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'astAllowed', 'desc'))}>AST Allowed{sortIndicator(dvpSort, 'astAllowed')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'threePmAllowed', 'desc'))}>3PM Allowed{sortIndicator(dvpSort, 'threePmAllowed')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'blkAllowed', 'desc'))}>BLK Allowed{sortIndicator(dvpSort, 'blkAllowed')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setDvpSort((prev) => nextSort(prev, 'stlAllowed', 'desc'))}>STL Allowed{sortIndicator(dvpSort, 'stlAllowed')}</th>
                </tr>
              </thead>
              <tbody className="text-[12px] font-mono">
                {displayedDvpRows.length > 0 ? displayedDvpRows.map((row) => {
                  const exceededProjection = row.actual !== null && Number.isFinite(row.actual) && row.actual > row.projection;
                  return (
                    <tr
                      key={`dvp-${row.player.id}`}
                      className={`border-b border-ink/5 ${exceededProjection ? 'bg-emerald-200/80 hover:bg-emerald-300/80' : ''}`}
                    >
                      <td className="px-3 py-2 font-black text-ink">{row.player.name}</td>
                      <td className="px-3 py-2 text-ink/70">{row.player.team}</td>
                      <td className="px-3 py-2 text-ink/70">{row.opp}</td>
                      <td className="px-3 py-2 text-right font-black text-drafting-orange">{formatNum(row.projection, 2)}</td>
                      <td className="px-3 py-2 text-right font-black text-emerald-600">{showActuals && row.actual !== null ? row.actual.toFixed(2) : '--'}</td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.dvpRank, 1)}</td>
                      <td className={`px-3 py-2 text-right ${dvpStatClass(row.position, 'pts', Number.isFinite(Number(row.ptsAllowed)) ? Number(row.ptsAllowed) : null)}`}>{formatNum(row.ptsAllowed, 2)}</td>
                      <td className={`px-3 py-2 text-right ${dvpStatClass(row.position, 'reb', Number.isFinite(Number(row.rebAllowed)) ? Number(row.rebAllowed) : null)}`}>{formatNum(row.rebAllowed, 2)}</td>
                      <td className={`px-3 py-2 text-right ${dvpStatClass(row.position, 'ast', Number.isFinite(Number(row.astAllowed)) ? Number(row.astAllowed) : null)}`}>{formatNum(row.astAllowed, 2)}</td>
                      <td className={`px-3 py-2 text-right ${dvpStatClass(row.position, '3pm', Number.isFinite(Number(row.threePmAllowed)) ? Number(row.threePmAllowed) : null)}`}>{formatNum(row.threePmAllowed, 2)}</td>
                      <td className={`px-3 py-2 text-right ${dvpStatClass(row.position, 'blk', Number.isFinite(Number(row.blkAllowed)) ? Number(row.blkAllowed) : null)}`}>{formatNum(row.blkAllowed, 2)}</td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.stlAllowed, 2)}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={12} className="py-8 text-center text-[10px] font-black text-ink/40 uppercase tracking-widest">
                      No players matched the selected filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full border-collapse min-w-[1700px]">
              <thead>
                <tr className="text-[9px] font-black text-ink/40 uppercase tracking-widest border-b border-ink/10 bg-white/40">
                  <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'name', 'asc'))}>Player{sortIndicator(statsSort, 'name')}</th>
                  <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'team', 'asc'))}>Team{sortIndicator(statsSort, 'team')}</th>
                  <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'opp', 'asc'))}>Opp{sortIndicator(statsSort, 'opp')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'salary', 'desc'))}>Salary{sortIndicator(statsSort, 'salary')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'value', 'desc'))}>Value{sortIndicator(statsSort, 'value')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'projection', 'desc'))}>Proj{sortIndicator(statsSort, 'projection')}</th>
                  {showActuals && <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'actual', 'desc'))}>Actual{sortIndicator(statsSort, 'actual')}</th>}
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'ownership', 'desc'))}>Own%{sortIndicator(statsSort, 'ownership')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'minutes', 'desc'))}>Min{sortIndicator(statsSort, 'minutes')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'usage', 'desc'))}>USG%{sortIndicator(statsSort, 'usage')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'fp', 'desc'))}>FP{sortIndicator(statsSort, 'fp')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'pts', 'desc'))}>PTS{sortIndicator(statsSort, 'pts')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'reb', 'desc'))}>REB{sortIndicator(statsSort, 'reb')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'ast', 'desc'))}>AST{sortIndicator(statsSort, 'ast')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'stl', 'desc'))}>STL{sortIndicator(statsSort, 'stl')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'blk', 'desc'))}>BLK{sortIndicator(statsSort, 'blk')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'tov', 'desc'))}>TOV{sortIndicator(statsSort, 'tov')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'fga', 'desc'))}>FGA{sortIndicator(statsSort, 'fga')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'fta', 'desc'))}>FTA{sortIndicator(statsSort, 'fta')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'fgPct', 'desc'))}>FG%{sortIndicator(statsSort, 'fgPct')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'threePm', 'desc'))}>3PM{sortIndicator(statsSort, 'threePm')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'threePa', 'desc'))}>3PA{sortIndicator(statsSort, 'threePa')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'threePct', 'desc'))}>3P%{sortIndicator(statsSort, 'threePct')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'tsPct', 'desc'))}>TS%{sortIndicator(statsSort, 'tsPct')}</th>
                  <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => setStatsSort((prev) => nextSort(prev, 'pie', 'desc'))}>PIE{sortIndicator(statsSort, 'pie')}</th>
                </tr>
              </thead>
              <tbody className="text-[12px] font-mono">
                {displayedStatsRows.length > 0 ? displayedStatsRows.map((row) => {
                  const exceededProjection = row.actual !== null && Number.isFinite(row.actual) && row.actual > row.projection;
                  return (
                    <tr
                      key={`stats-${row.player.id}`}
                      className={`border-b border-ink/5 ${exceededProjection ? 'bg-emerald-200/80 hover:bg-emerald-300/80' : ''}`}
                    >
                      <td className="px-3 py-2 font-black text-ink">{row.player.name}</td>
                      <td className="px-3 py-2 text-ink/70">{row.player.team}</td>
                      <td className="px-3 py-2 text-ink/70">{row.opp}</td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.player.salary, 0)}</td>
                      <td className="px-3 py-2 text-right text-ink/70">{row.value !== null ? row.value.toFixed(2) : '--'}</td>
                      <td className="px-3 py-2 text-right font-black text-drafting-orange">{formatNum(row.projection, 2)}</td>
                      {showActuals && <td className="px-3 py-2 text-right font-black text-emerald-600">{row.actual !== null ? row.actual.toFixed(2) : '--'}</td>}
                      <td className="px-3 py-2 text-right text-ink/70">{formatPct(row.ownership, 1)}</td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.minutes, 1)}</td>
                      <td
                        title={getSeasonThresholdTitle(row.position, 'usage', row.usage)}
                        className={`px-3 py-2 text-right ${getSeasonHighlightClass(row.position, 'usage', row.usage)}`}
                      >
                        {formatPct(row.usage, 1)}
                      </td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.fp, 2)}</td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.pts, 2)}</td>
                      <td
                        title={getSeasonThresholdTitle(row.position, 'reb', row.reb)}
                        className={`px-3 py-2 text-right ${getSeasonHighlightClass(row.position, 'reb', row.reb)}`}
                      >
                        {formatNum(row.reb, 2)}
                      </td>
                      <td
                        title={getSeasonThresholdTitle(row.position, 'ast', row.ast)}
                        className={`px-3 py-2 text-right ${getSeasonHighlightClass(row.position, 'ast', row.ast)}`}
                      >
                        {formatNum(row.ast, 2)}
                      </td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.stl, 2)}</td>
                      <td
                        title={getSeasonThresholdTitle(row.position, 'blk', row.blk)}
                        className={`px-3 py-2 text-right ${getSeasonHighlightClass(row.position, 'blk', row.blk)}`}
                      >
                        {formatNum(row.blk, 2)}
                      </td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.tov, 2)}</td>
                      <td
                        title={getSeasonThresholdTitle(row.position, 'fga', row.fga)}
                        className={`px-3 py-2 text-right ${getSeasonHighlightClass(row.position, 'fga', row.fga)}`}
                      >
                        {formatNum(row.fga, 2)}
                      </td>
                      <td
                        title={getSeasonThresholdTitle(row.position, 'fta', row.fta)}
                        className={`px-3 py-2 text-right ${getSeasonHighlightClass(row.position, 'fta', row.fta)}`}
                      >
                        {formatNum(row.fta, 2)}
                      </td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.fgPct, 2)}</td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.threePm, 2)}</td>
                      <td
                        title={getSeasonThresholdTitle(row.position, 'threePa', row.threePa)}
                        className={`px-3 py-2 text-right ${getSeasonHighlightClass(row.position, 'threePa', row.threePa)}`}
                      >
                        {formatNum(row.threePa, 2)}
                      </td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.threePct, 2)}</td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.tsPct, 2)}</td>
                      <td className="px-3 py-2 text-right text-ink/70">{formatNum(row.pie, 2)}</td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={showActuals ? 25 : 24} className="py-8 text-center text-[10px] font-black text-ink/40 uppercase tracking-widest">
                      No players matched the selected filters
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

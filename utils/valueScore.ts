/**
 * calculateValueScore — composite DFS value scoring utility
 *
 * Combines salary efficiency, matchup quality (DVP), Vegas environment,
 * recent form, ceiling upside, and ownership leverage into a single 0–100
 * composite score. Each component degrades gracefully when data is absent
 * (defaults to 50, i.e. neutral, rather than skewing the composite).
 *
 * Field mapping (confirmed against actual Player objects in this codebase):
 *   player.projection        — projected FPTS (normalized from DK_FPTS_PROJ / proj / fpts)
 *   player.salary            — raw number, e.g. 8400
 *   player.value             — pre-computed projection / (salary/1000)
 *   player.ceiling           — ceiling FPTS (optional)
 *   player.floor             — floor FPTS (optional)
 *   player.ownership         — 0–100 projected ownership (optional)
 *   player.dvpRank           — direct DVP rank override (optional, 1–30)
 *   player.usageRate         — usage rate % (optional)
 *   player.minutesProjection — projected minutes (optional)
 *   player.history           — HistoricalGame[] with { fpts, minutes, date, opponent }
 *   player.team              — normalized uppercase abbreviation (e.g. "BOS")
 *   player.opponent          — opponent's normalized abbreviation (e.g. "NYK")
 *   player.position          — position string, may be multi-eligible e.g. "PG/SF"
 *
 * DVP lives on GameInfo → teamA/B.positionalDvP[position].rank
 *   rank 1  = allows MOST FPTS to this position (hottest matchup for DFS)
 *   rank 30 = lockdown defense (coldest matchup)
 *
 * Vegas implied total is derived from game.overUnder + game.spread where
 *   spread is from teamA's perspective (negative = teamA is favored).
 *   teamA implied = (O/U - spread) / 2
 *   teamB implied = (O/U + spread) / 2
 */

import { Player, GameInfo } from '../types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ValueScoreComponents {
  // Raw inputs (for display / debugging)
  projection: number;
  salary: number;
  valuePerK: number;           // projection / (salary / 1000)
  dvpRank: number | null;      // 1–30; 1 = best matchup for offense
  impliedTotal: number | null; // player's team implied total (Vegas)
  recentFormAvg: number | null; // avg actual FPTS over last N games
  recentFormGames: number;     // how many history games were used
  ceiling: number | null;
  floor: number | null;
  ownership: number | null;    // 0–100

  // Normalized sub-scores (each 0–100)
  subscores: {
    value: number;      // salary efficiency
    dvp: number;        // matchup quality
    vegas: number;      // game environment (implied total)
    form: number;       // recent scoring vs projection
    ceiling: number;    // ceiling upside ratio
    ownership: number;  // GPP leverage (lower own = higher score)
  };

  // Final weighted composite (0–100)
  composite: number;

  // Tier-scaled outcome representation (elite/mid/value/punt)
  outcomeProfile: ValueOutcomeProfile;
}

export interface ValueScoreWeights {
  value?: number;     // default 0.30
  dvp?: number;       // default 0.20
  vegas?: number;     // default 0.15
  form?: number;      // default 0.20
  ceiling?: number;   // default 0.10
  ownership?: number; // default 0.05
}

export type PlayerArchetype = 'elite' | 'mid_range' | 'value' | 'punt';

export interface ArchetypeThresholds {
  eliteMinSalary?: number; // default 9000+
  midMinSalary?: number;   // default 6500+
  valueMinSalary?: number; // default 4500+
}

export interface ValueOutcomeProfile {
  archetype: PlayerArchetype;
  targetMultiplier: number;
  targetPoints: number;
  projectedFloor: number;
  projectedMedian: number;
  projectedCeiling: number;
  hitTargetPct: number;
  smashPct: number;
  bustPct: number;
  volatility: number;
  tierAdjustedComposite: number;
  potentialComposite: number;
}

export interface ValueScoreOptions {
  weights?: ValueScoreWeights;
  /** Number of recent history games to average for form score. Default: 5 */
  recentFormGames?: number;
  /** Salary cutoffs for archetype bucketing. */
  archetypeThresholds?: ArchetypeThresholds;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const clamp = (val: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, val));

/** Maps val linearly from [min, max] → [0, 100], clamped. */
const linearScale = (val: number, min: number, max: number): number =>
  clamp(((val - min) / (max - min)) * 100, 0, 100);

/** Returns the primary (first) position token from a multi-eligible string like "PG/SF". */
const parsePrimaryPosition = (position: string): string =>
  String(position || '')
    .split(/[\/,\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean)[0] || 'UTIL';

/**
 * Looks up DVP rank for a player's position against their opponent.
 * Checks player.dvpRank first (direct override), then searches GameInfo objects.
 * Returns rank 1–30 where 1 = allows most FPTS (hottest matchup).
 */
const resolveDvp = (
  player: Player,
  games: GameInfo[],
): { rank: number | null; fptsAllowed: number | null } => {
  // Direct override on the player object (e.g. set by pipeline)
  const directRank = Number(player.dvpRank);
  if (Number.isFinite(directRank) && directRank >= 1 && directRank <= 30) {
    return { rank: directRank, fptsAllowed: null };
  }

  const primaryPos = parsePrimaryPosition(player.position);
  const opponentId = String(player.opponent || '').toUpperCase().trim();
  if (!opponentId || opponentId === 'UNK') return { rank: null, fptsAllowed: null };

  for (const game of games) {
    const teamAId = String(game.teamA?.teamId || '').toUpperCase();
    const teamBId = String(game.teamB?.teamId || '').toUpperCase();
    const dvpTeam = teamAId === opponentId
      ? game.teamA
      : teamBId === opponentId
        ? game.teamB
        : null;
    if (!dvpTeam) continue;

    const dvp = dvpTeam.positionalDvP;
    if (!dvp) continue;

    // Try exact match, then case-insensitive scan
    const posKey =
      (dvp[primaryPos] ? primaryPos : null) ||
      Object.keys(dvp).find((k) => k.toUpperCase() === primaryPos) ||
      null;

    if (posKey) {
      const entry = dvp[posKey];
      const rank = Number(entry?.rank);
      if (Number.isFinite(rank) && rank >= 1) {
        return {
          rank,
          fptsAllowed:
            typeof entry?.fantasyPointsAllowedPerGame === 'number'
              ? entry.fantasyPointsAllowedPerGame
              : null,
        };
      }
    }
  }

  return { rank: null, fptsAllowed: null };
};

/**
 * Computes the player's team implied total from Vegas lines.
 * spread is from teamA's perspective (negative = teamA is favored).
 *   teamA implied = (O/U - spread) / 2
 *   teamB implied = (O/U + spread) / 2
 */
const resolveImpliedTotal = (player: Player, games: GameInfo[]): number | null => {
  const teamId = String(player.team || '').toUpperCase().trim();
  if (!teamId || teamId === 'UNK') return null;

  for (const game of games) {
    const teamAId = String(game.teamA?.teamId || '').toUpperCase();
    const teamBId = String(game.teamB?.teamId || '').toUpperCase();
    const ou = Number(game.overUnder);
    const spread = Number(game.spread);
    if (!Number.isFinite(ou) || ou <= 0) continue;

    if (teamAId === teamId) {
      return Number.isFinite(spread) ? (ou - spread) / 2 : ou / 2;
    }
    if (teamBId === teamId) {
      return Number.isFinite(spread) ? (ou + spread) / 2 : ou / 2;
    }
  }

  return null;
};

/**
 * Averages actual FPTS from the last N entries of player.history.
 * history is ordered oldest → newest by convention from the pipeline.
 */
const resolveRecentForm = (
  player: Player,
  n: number,
): { avg: number | null; games: number } => {
  const history = Array.isArray(player.history) ? player.history : [];
  if (history.length === 0) return { avg: null, games: 0 };

  const values = history
    .slice(-n)
    .map((g) => Number(g.fpts))
    .filter((v) => Number.isFinite(v) && v >= 0);

  if (values.length === 0) return { avg: null, games: 0 };

  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  return { avg, games: values.length };
};

/**
 * Checks common injury status field names on the player object.
 * Returns true only for hard OUT / IR / SUSP statuses (not GTD/Q).
 */
export const isInjuredOut = (player: Player): boolean => {
  const OUT_STATUSES = new Set(['OUT', 'IR', 'SUSP', 'SUSPENDED', 'DNP', 'O']);
  const STATUS_KEY_NORMS = [
    'injurystatus', 'status', 'injury', 'injurydesignation', 'injuryflag',
  ];

  for (const [key, val] of Object.entries(player as Record<string, any>)) {
    const norm = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (STATUS_KEY_NORMS.includes(norm)) {
      if (OUT_STATUSES.has(String(val ?? '').toUpperCase().trim())) return true;
    }
  }
  return false;
};

// ---------------------------------------------------------------------------
// Core scoring function
// ---------------------------------------------------------------------------

const DEFAULT_WEIGHTS: Required<ValueScoreWeights> = {
  value: 0.30,
  dvp: 0.20,
  vegas: 0.15,
  form: 0.20,
  ceiling: 0.10,
  ownership: 0.05,
};

const DEFAULT_ARCHETYPE_THRESHOLDS: Required<ArchetypeThresholds> = {
  eliteMinSalary: 9000,
  midMinSalary: 6500,
  valueMinSalary: 4500,
};

interface ArchetypeModel {
  targetMultiplier: number;
  fallbackFloorPct: number;
  fallbackCeilingPct: number;
  volatilityBoost: number;
  weights: Required<ValueScoreWeights>;
}

const ARCHETYPE_MODELS: Record<PlayerArchetype, ArchetypeModel> = {
  elite: {
    targetMultiplier: 5.2,
    fallbackFloorPct: 0.76,
    fallbackCeilingPct: 1.42,
    volatilityBoost: 0.95,
    // Prioritize ceiling + game context more than pure salary value.
    weights: { value: 0.12, dvp: 0.18, vegas: 0.20, form: 0.15, ceiling: 0.28, ownership: 0.07 },
  },
  mid_range: {
    targetMultiplier: 5.5,
    fallbackFloorPct: 0.72,
    fallbackCeilingPct: 1.50,
    volatilityBoost: 1.0,
    weights: { value: 0.20, dvp: 0.18, vegas: 0.15, form: 0.18, ceiling: 0.18, ownership: 0.11 },
  },
  value: {
    targetMultiplier: 5.8,
    fallbackFloorPct: 0.67,
    fallbackCeilingPct: 1.58,
    volatilityBoost: 1.08,
    weights: { value: 0.28, dvp: 0.14, vegas: 0.10, form: 0.20, ceiling: 0.14, ownership: 0.14 },
  },
  punt: {
    targetMultiplier: 6.2,
    fallbackFloorPct: 0.58,
    fallbackCeilingPct: 1.82,
    volatilityBoost: 1.20,
    // Punt plays are mostly about asymmetric upside and leverage.
    weights: { value: 0.24, dvp: 0.10, vegas: 0.08, form: 0.11, ceiling: 0.27, ownership: 0.20 },
  },
};

const logisticPct = (x: number): number => clamp(100 / (1 + Math.exp(-x)), 0, 100);

export const getPlayerArchetype = (
  salary: number,
  thresholds: ArchetypeThresholds = {},
): PlayerArchetype => {
  const merged = { ...DEFAULT_ARCHETYPE_THRESHOLDS, ...thresholds };
  if (salary >= merged.eliteMinSalary) return 'elite';
  if (salary >= merged.midMinSalary) return 'mid_range';
  if (salary >= merged.valueMinSalary) return 'value';
  return 'punt';
};

const weightedSubscore = (
  subscores: ValueScoreComponents['subscores'],
  weights: Required<ValueScoreWeights>,
): number => {
  const totalWeight =
    weights.value +
    weights.dvp +
    weights.vegas +
    weights.form +
    weights.ceiling +
    weights.ownership;
  if (totalWeight <= 0) return 50;
  return (
    (subscores.value * weights.value +
      subscores.dvp * weights.dvp +
      subscores.vegas * weights.vegas +
      subscores.form * weights.form +
      subscores.ceiling * weights.ceiling +
      subscores.ownership * weights.ownership) /
    totalWeight
  );
};

/**
 * Computes a composite DFS value score (0–100) for a single player.
 *
 * Sub-score normalization baselines (tuned for NBA DFS):
 *   value    — proj/salary*1000 range 3.0–7.5 (typical DK range)
 *   dvp      — rank 1 → 100, rank 30 → 0 (linear)
 *   vegas    — team implied total 100–125 NBA points
 *   form     — recent avg vs projection delta: -10 → 0, +10 → 100
 *   ceiling  — ceiling/projection ratio 1.0–2.0
 *   ownership— lower own = higher score; 0% → 100, ≥50% → 0
 *
 * Components with missing data fall back to 50 (neutral / mean imputation).
 */
export const calculateValueScore = (
  player: Player,
  games: GameInfo[],
  options: ValueScoreOptions = {},
): ValueScoreComponents => {
  const weights: Required<ValueScoreWeights> = { ...DEFAULT_WEIGHTS, ...options.weights };
  const formWindow = options.recentFormGames ?? 5;

  // --- Raw inputs ---
  const projection = Number(player.projection) || 0;
  const salary = Number(player.salary) || 0;
  const valuePerK = salary > 0 ? projection / (salary / 1000) : 0;

  const ceiling =
    typeof player.ceiling === 'number' && Number.isFinite(player.ceiling)
      ? player.ceiling
      : null;
  const floor =
    typeof player.floor === 'number' && Number.isFinite(player.floor)
      ? player.floor
      : null;
  const ownership =
    typeof player.ownership === 'number' && Number.isFinite(player.ownership)
      ? player.ownership
      : null;

  const { rank: dvpRank } = resolveDvp(player, games);
  const impliedTotal = resolveImpliedTotal(player, games);
  const { avg: recentFormAvg, games: recentFormGamesUsed } = resolveRecentForm(player, formWindow);

  // --- Sub-scores (each 0–100; 50 = neutral/missing) ---

  // 1. Salary efficiency: proj / (salary/1000). NBA DFS typical range 3.0–7.5
  const valueScore = linearScale(valuePerK, 3.0, 7.5);

  // 2. DVP matchup: rank 1 (allows most FPTS) → 100, rank 30 → 0
  const dvpScore =
    dvpRank !== null
      ? clamp(((30 - dvpRank) / 29) * 100, 0, 100)
      : 50;

  // 3. Vegas environment: team implied total 100–125 NBA pts
  const vegasScore = impliedTotal !== null ? linearScale(impliedTotal, 100, 125) : 50;

  // 4. Recent form: how much recent avg differs from projection
  //    delta < -10 → 0 (cold), delta > +10 → 100 (hot), 0 → 50 (on-projection)
  const formScore =
    recentFormAvg !== null && projection > 0
      ? linearScale(recentFormAvg - projection, -10, 10)
      : 50;

  // 5. Ceiling upside: ratio of ceiling to projection (1.0 = no upside, 2.0 = double)
  const ceilingRatio = ceiling !== null && projection > 0 ? ceiling / projection : null;
  const ceilingScore = ceilingRatio !== null ? linearScale(ceilingRatio, 1.0, 2.0) : 50;

  // 6. Ownership leverage (GPP): lower ownership = higher score
  //    0% → 100, ≥50% → 0
  const ownershipScore =
    ownership !== null ? clamp(((50 - ownership) / 50) * 100, 0, 100) : 50;

  // --- Weighted composite ---
  const totalWeight =
    weights.value +
    weights.dvp +
    weights.vegas +
    weights.form +
    weights.ceiling +
    weights.ownership;

  const composite = clamp(
    (valueScore * weights.value +
      dvpScore * weights.dvp +
      vegasScore * weights.vegas +
      formScore * weights.form +
      ceilingScore * weights.ceiling +
      ownershipScore * weights.ownership) /
      totalWeight,
    0,
    100,
  );

  const subscores: ValueScoreComponents['subscores'] = {
    value: Number(valueScore.toFixed(1)),
    dvp: Number(dvpScore.toFixed(1)),
    vegas: Number(vegasScore.toFixed(1)),
    form: Number(formScore.toFixed(1)),
    ceiling: Number(ceilingScore.toFixed(1)),
    ownership: Number(ownershipScore.toFixed(1)),
  };

  const archetype = getPlayerArchetype(salary, options.archetypeThresholds);
  const archetypeModel = ARCHETYPE_MODELS[archetype];
  const tierAdjustedComposite = clamp(
    weightedSubscore(subscores, archetypeModel.weights),
    0,
    100,
  );

  const projectedFloor =
    floor !== null ? floor : Number((projection * archetypeModel.fallbackFloorPct).toFixed(2));
  const projectedCeiling =
    ceiling !== null ? ceiling : Number((projection * archetypeModel.fallbackCeilingPct).toFixed(2));

  const rawMedian =
    projection *
    (0.92 + (subscores.form - 50) / 300 + (subscores.vegas - 50) / 500);
  const projectedMedian = clamp(
    Number(rawMedian.toFixed(2)),
    Math.min(projectedFloor, projectedCeiling),
    Math.max(projectedFloor, projectedCeiling),
  );

  const targetPoints = salary > 0
    ? Number(((salary / 1000) * archetypeModel.targetMultiplier).toFixed(2))
    : Number(projection.toFixed(2));
  const smashPoints = salary > 0
    ? Number(((salary / 1000) * (archetypeModel.targetMultiplier + 0.9)).toFixed(2))
    : Number((projection * 1.30).toFixed(2));
  const bustPoints = salary > 0
    ? Number(((salary / 1000) * Math.max(3.5, archetypeModel.targetMultiplier - 1.4)).toFixed(2))
    : Number((projection * 0.75).toFixed(2));

  const spread = Math.max(
    3,
    ((Math.max(projectedCeiling, projectedFloor) - Math.min(projectedCeiling, projectedFloor)) / 2) *
      archetypeModel.volatilityBoost,
  );
  const hitTargetPct = logisticPct((projectedMedian - targetPoints) / spread);
  const smashPct = logisticPct((projectedCeiling - smashPoints) / (spread * 1.15));
  const bustPct = logisticPct((bustPoints - projectedMedian) / (spread * 0.90));
  const volatility = linearScale(
    (Math.max(projectedCeiling, projectedFloor) - Math.min(projectedCeiling, projectedFloor)) /
      Math.max(projection, 1),
    0.35,
    1.40,
  );
  const potentialComposite = clamp(
    tierAdjustedComposite * 0.60 + hitTargetPct * 0.25 + smashPct * 0.20 - bustPct * 0.15,
    0,
    100,
  );

  const outcomeProfile: ValueOutcomeProfile = {
    archetype,
    targetMultiplier: archetypeModel.targetMultiplier,
    targetPoints,
    projectedFloor: Number(projectedFloor.toFixed(2)),
    projectedMedian: Number(projectedMedian.toFixed(2)),
    projectedCeiling: Number(projectedCeiling.toFixed(2)),
    hitTargetPct: Number(hitTargetPct.toFixed(1)),
    smashPct: Number(smashPct.toFixed(1)),
    bustPct: Number(bustPct.toFixed(1)),
    volatility: Number(volatility.toFixed(1)),
    tierAdjustedComposite: Number(tierAdjustedComposite.toFixed(1)),
    potentialComposite: Number(potentialComposite.toFixed(1)),
  };

  return {
    projection,
    salary,
    valuePerK: Number(valuePerK.toFixed(3)),
    dvpRank,
    impliedTotal: impliedTotal !== null ? Number(impliedTotal.toFixed(1)) : null,
    recentFormAvg: recentFormAvg !== null ? Number(recentFormAvg.toFixed(2)) : null,
    recentFormGames: recentFormGamesUsed,
    ceiling,
    floor,
    ownership,
    subscores,
    composite: Number(composite.toFixed(1)),
    outcomeProfile,
  };
};

/**
 * Batch version — computes value scores for all players and returns a Map keyed by player.id.
 */
export const calculateValueScores = (
  players: Player[],
  games: GameInfo[],
  options: ValueScoreOptions = {},
): Map<string, ValueScoreComponents> => {
  const result = new Map<string, ValueScoreComponents>();
  for (const player of players) {
    result.set(player.id, calculateValueScore(player, games, options));
  }
  return result;
};

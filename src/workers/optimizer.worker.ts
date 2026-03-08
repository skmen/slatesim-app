
import { Lineup, Player } from '../../types';
import highsLoader from 'highs';
import highsWasmUrl from 'highs/runtime?url';

const DK_SLOTS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] as const;
const workerScope = self as any;

type Slot = (typeof DK_SLOTS)[number];
type StatConstraintMode = 'cash' | 'gpp';

interface OptimizerConfig {
  numLineups?: number;
  salaryCap?: number;
  salaryFloor?: number;
  salary_floor?: number;
  enableDiagnostics?: boolean;
  enable_diagnostics?: boolean;
  forceFallback?: boolean;
  force_fallback?: boolean;
  maxExposure?: number;
  enableStatConstraints?: boolean;
  enable_stat_constraints?: boolean;
  statConstraintMode?: StatConstraintMode;
  mode?: StatConstraintMode | string;
  deltaFromBestProjection?: number;
  delta_from_best_projection?: number;
  minMinutesCore?: number;
  min_minutes_core?: number;
  minCountMinutesCore?: number;
  min_count_minutes_core?: number;
  maxCountLowMinutes?: number;
  max_count_low_minutes?: number;
  lowMinutesCutoff?: number;
  low_minutes_cutoff?: number;
  enableRuleBoosts?: boolean;
  enable_rule_boosts?: boolean;
  topQuantile?: number;
  top_quantile?: number;
  midQuantile?: number;
  mid_quantile?: number;
  bonusR4?: number;
  bonus_r4?: number;
  bonusR1?: number;
  bonus_r1?: number;
  bonusR5?: number;
  bonus_r5?: number;
  ceilingWeight?: number;
  ceiling_weight?: number;
  ownershipPenalty?: number;
  ownership_penalty?: number;
  minUniquePlayers?: number;
  min_unique_players?: number;
  stackMinPlayers?: number;
  stack_min_players?: number;
  stackMinGameTotal?: number;
  stack_min_game_total?: number;
  // Cash-specific config
  cashMinGameTotal?: number;          // min game O/U to include player (default 220)
  cashMaxExposurePct?: number;        // max exposure % per player across lineups (default 65)
  cashPositionFloors?: Record<string, number>; // per-position minimum adjusted projection
  // Team stacking priority weights (team abbreviation -> 1-5 weight)
  teamStackWeights?: Record<string, number>;
  // Portfolio diversity controls
  portfolioMaxPairwiseOverlap?: number; // alias for minUniquePlayers: sets minUniquePlayers = 8 - value
  // Bring-back game stack
  bringBackEnable?: boolean;            // default true — require >=1 opponent player when stack fires
  bringBackRate?: number;               // default 0.65 — fraction of lineups that get bring-back
  // Game stack rotation
  maxStackGames?: number;               // default 3 — number of top games to rotate across
}

type ResolvedOptimizerConfig = Required<Pick<OptimizerConfig, 'numLineups' | 'salaryCap' | 'salaryFloor' | 'maxExposure'>> & OptimizerConfig;

interface RequestPayload {
  players: Player[];
  config?: OptimizerConfig;
}

interface AssignmentVar {
  name: string;
  playerIndex: number;
  slot: Slot;
}

interface LinearTerm {
  varName: string;
  coeff: number;
}

interface LinearConstraint {
  name: string;
  terms: LinearTerm[];
  sense: '<=' | '>=' | '=';
  rhs: number;
}

interface ModelBlueprint {
  objective: Map<string, number>;
  constraints: LinearConstraint[];
  binaries: string[];
  assignmentVars: AssignmentVar[];
  assignmentVarsByPlayer: Map<number, string[]>;
}

interface SolveResult {
  values: Map<string, number>;
  status: string;
  objectiveValue: number;
}

interface BuildContext {
  players: Player[];
  config: ResolvedOptimizerConfig;
  lineupIndex: number;
  previousLineups: number[][];
  statSettings: StatConstraintSettings;
  forcedExposureInclude: Set<number>;
  forcedExposureExclude: Set<number>;
}

interface StatConstraintSettings {
  enable: boolean;
  mode: StatConstraintMode;
  deltaFromBestProjection: number;
  minMinutesCore: number;
  minCountMinutesCore: number;
  maxCountLowMinutes: number;
  lowMinutesCutoff: number;
}

interface StatConstraintRule {
  name: string;
  sense: '<=' | '>=';
  rhs: number;
  playerIndexes: number[];
}

interface RelaxedStatRule {
  rule: StatConstraintRule;
  required: number;
  available: number;
}

type RuleFlags = {
  r1_leverage_top10: boolean;
  r2_volatility_top10: boolean;
  r4_leverage_or_vol_top10: boolean;
  r5_leverage_and_minutes_top20: boolean;
};

interface ConstraintSnapshot {
  name: string;
  sense: '<=' | '>=' | '=';
  rhs: number;
}

interface ExposureConstraintsSummary {
  forcedIncludeCount: number;
  forcedExcludeCount: number;
  playersAtMaxCount: number;
  playersWithMinCount: number;
  remainingIncludingCurrent: number;
}

interface LineupDiagnosticsPayload {
  lineupIndex: number;
  phase1Status: string;
  phase2Status: string;
  usedFallback: boolean;
  objectiveValuePhase1: number | null;
  objectiveValuePhase2: number | null;
  phase1ProjectionSum: number | null;
  projectionSum: number;
  salarySum: number;
  uniquePlayersOk: boolean;
  exposureConstraintsSummary: ExposureConstraintsSummary;
  duplicateConstraintActive: boolean;
  deltaFromBestProjection: number;
  phase1Constraints: ConstraintSnapshot[];
  phase2Constraints: ConstraintSnapshot[];
  bindingConstraints: string[];
  infeasibilityInfo?: string;
}

interface RunDiagnosticsPayload {
  nRequested: number;
  nSolvedILP: number;
  nSolvedFallback: number;
  phase2InfeasibleCount: number;
  avgProjectionSum: number;
  maxProjectionSum: number;
  avgSalarySum: number;
  phase1SuccessRate: number;
  phase2InfeasibleRate: number;
  fallbackUsageRate: number;
}

interface SolveLineupDiagnostics {
  phase1Status: string;
  phase2Status: string;
  objectiveValuePhase1: number | null;
  objectiveValuePhase2: number | null;
  phase1ProjectionSum: number | null;
  phase1Constraints: ConstraintSnapshot[];
  phase2Constraints: ConstraintSnapshot[];
  bindingConstraints: string[];
  infeasibilityInfo?: string;
}

interface SolveLineupResult {
  solved: { lineup: Lineup; selectedIndexes: number[] } | null;
  diagnostics: SolveLineupDiagnostics;
}

let highsModulePromise: Promise<any> | null = null;
const RULE_FLAGS_KEY = '__ruleFlags';

const safeNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const quantile = (values: number[], q: number): number | null => {
  const clean = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const qq = clamp(safeNumber(q, 0), 0, 1);
  const pos = (clean.length - 1) * qq;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = clean[base];
  const b = clean[Math.min(base + 1, clean.length - 1)];
  return a + rest * (b - a);
};

const normKey = (value: string): string => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const readByKeys = (obj: Record<string, any> | undefined, keys: string[]): any => {
  if (!obj || typeof obj !== 'object') return undefined;
  const keyMap = new Map<string, string>();
  Object.keys(obj).forEach((k) => keyMap.set(normKey(k), k));
  for (const key of keys) {
    const actualKey = keyMap.get(normKey(key));
    if (actualKey) return obj[actualKey];
  }
  return undefined;
};

const readFromPlayer = (player: Player, keys: string[]): any => {
  const sources = [
    player as Record<string, any>,
    (player as any).slateData,
    (player as any).advancedMetrics,
    (player as any).statsProfile,
  ];
  for (const source of sources) {
    const value = readByKeys(source, keys);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const readNumericMaybe = (player: Player, keys: string[]): number | undefined => {
  const raw = readFromPlayer(player, keys);
  if (raw === undefined || raw === null || raw === '') return undefined;
  const numeric = Number(typeof raw === 'string' ? raw.replace('%', '') : raw);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const readString = (player: Player, keys: string[]): string => {
  const raw = readFromPlayer(player, keys);
  if (raw === undefined || raw === null) return '';
  return String(raw).trim();
};

const parsePositions = (position: string): string[] => {
  return String(position || '')
    .split(/[\/,\s]+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
};

const canFitDK = (player: Player, slot: Slot): boolean => {
  const pos = parsePositions(player.position);
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

const normalizeOwnership = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return clamp(value * 100, 0, 100);
  return clamp(value, 0, 100);
};

const normalizePercentMaybe = (value: number | undefined): number | undefined => {
  if (!Number.isFinite(Number(value))) return undefined;
  const n = Number(value);
  return n <= 1 ? n * 100 : n;
};

const leverageTierToScoreMaybe = (player: Player): number | undefined => {
  const numericTier = readNumericMaybe(player, ['leverageScore', 'leverage_tier_score', 'leverageTierNumeric']);
  if (Number.isFinite(Number(numericTier))) return Number(numericTier);

  const tierRaw = readString(player, [
    'leverageTier',
    'signalLeverageTier',
    'signal_leverage_tier',
    'leverage_tier',
    'LEVERAGE_TIER',
  ]).toLowerCase();

  if (!tierRaw) return undefined;
  if (tierRaw.includes('strong') && tierRaw.includes('positive')) return 3;
  if (tierRaw.includes('strong') && tierRaw.includes('negative')) return -3;
  if (tierRaw.includes('positive')) return 2;
  if (tierRaw.includes('negative')) return -2;
  if (tierRaw.includes('neutral')) return 1;
  if (tierRaw.includes('fade')) return -2;
  if (tierRaw.includes('core')) return 2;
  return undefined;
};

const leverageTierToScore = (player: Player): number => leverageTierToScoreMaybe(player) ?? 0;


const formatCoeff = (value: number): string => {
  const rounded = Math.abs(value) < 1e-10 ? 0 : value;
  const txt = rounded.toFixed(8);
  return txt.replace(/\.?0+$/, '');
};

const formatExpression = (terms: LinearTerm[]): string => {
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

const buildLp = (model: ModelBlueprint): string => {
  const objectiveTerms = Array.from(model.objective.entries()).map(([varName, coeff]) => ({ varName, coeff }));
  const lines: string[] = [];

  lines.push('Maximize');
  lines.push(` obj: ${formatExpression(objectiveTerms)}`);
  lines.push('Subject To');
  model.constraints.forEach((constraint) => {
    lines.push(` ${constraint.name}: ${formatExpression(constraint.terms)} ${constraint.sense} ${formatCoeff(constraint.rhs)}`);
  });

  lines.push('Binary');
  model.binaries.forEach((binaryName) => lines.push(` ${binaryName}`));
  lines.push('End');

  return lines.join('\n');
};

const withDefaultConfig = (config?: OptimizerConfig): ResolvedOptimizerConfig => {
  const statModeRaw = String((config as any)?.statConstraintMode ?? (config as any)?.mode ?? 'gpp').toLowerCase();
  const statMode: StatConstraintMode = statModeRaw === 'cash' ? 'cash' : 'gpp';
  const enableStatRaw = (config as any)?.enableStatConstraints ?? (config as any)?.enable_stat_constraints;
  const enableStatConstraints = enableStatRaw === undefined ? true : Boolean(enableStatRaw);
  const deltaRaw = (config as any)?.deltaFromBestProjection ?? (config as any)?.delta_from_best_projection ?? (config as any)?.upsideDelta ?? 8;
  const minCoreRaw = (config as any)?.minMinutesCore ?? (config as any)?.min_minutes_core;
  const minCountCoreRaw = (config as any)?.minCountMinutesCore ?? (config as any)?.min_count_minutes_core;
  const maxLowRaw = (config as any)?.maxCountLowMinutes ?? (config as any)?.max_count_low_minutes;
  const lowCutoffRaw = (config as any)?.lowMinutesCutoff ?? (config as any)?.low_minutes_cutoff;
  const enableRuleRaw = (config as any)?.enableRuleBoosts ?? (config as any)?.enable_rule_boosts;
  const enableRuleBoosts = enableRuleRaw === undefined ? true : Boolean(enableRuleRaw);
  const enableDiagnosticsRaw = (config as any)?.enableDiagnostics ?? (config as any)?.enable_diagnostics;
  const enableDiagnostics = enableDiagnosticsRaw === undefined ? false : Boolean(enableDiagnosticsRaw);
  const forceFallbackRaw = (config as any)?.forceFallback ?? (config as any)?.force_fallback;
  const forceFallback = forceFallbackRaw === undefined ? false : Boolean(forceFallbackRaw);
  const topQuantile = clamp(safeNumber((config as any)?.topQuantile ?? (config as any)?.top_quantile, 0.10), 0.01, 0.40);
  const midQuantile = clamp(safeNumber((config as any)?.midQuantile ?? (config as any)?.mid_quantile, 0.20), 0.01, 0.50);
  const bonusR4 = safeNumber((config as any)?.bonusR4 ?? (config as any)?.bonus_r4, 350000);
  const bonusR1 = safeNumber((config as any)?.bonusR1 ?? (config as any)?.bonus_r1, 650000);
  const bonusR5 = safeNumber((config as any)?.bonusR5 ?? (config as any)?.bonus_r5, 900000);
  const ceilingWeight = clamp(
    safeNumber((config as any)?.ceilingWeight ?? (config as any)?.ceiling_weight, statMode === 'cash' ? 0.0 : 0.25),
    0,
    0.5,
  );
  const ownershipPenalty = Math.max(
    0,
    safeNumber((config as any)?.ownershipPenalty ?? (config as any)?.ownership_penalty, statMode === 'cash' ? 0.0 : 0.10),
  );
  const portfolioMaxPairwiseOverlap = (config as any)?.portfolioMaxPairwiseOverlap;
  const minUniquePlayers = Math.max(
    1,
    portfolioMaxPairwiseOverlap !== undefined
      ? Math.max(1, DK_SLOTS.length - Math.floor(safeNumber(portfolioMaxPairwiseOverlap, 5)))
      : Math.floor(safeNumber((config as any)?.minUniquePlayers ?? (config as any)?.min_unique_players, 3)),
  );
  const bringBackEnable = (config as any)?.bringBackEnable ?? true;
  const bringBackRate = clamp(safeNumber((config as any)?.bringBackRate, 0.65), 0, 1);
  const maxStackGames = Math.max(1, Math.floor(safeNumber((config as any)?.maxStackGames, 3)));
  const stackMinPlayers = Math.max(
    0,
    Math.floor(safeNumber((config as any)?.stackMinPlayers ?? (config as any)?.stack_min_players, 0)),
  );
  const stackMinGameTotal = Math.max(
    0,
    safeNumber((config as any)?.stackMinGameTotal ?? (config as any)?.stack_min_game_total, 215),
  );
  const salaryCap = Math.max(1, Math.floor(safeNumber(config?.salaryCap, 50000)));
  const defaultSalaryFloor = statMode === 'cash' ? 49200 : 49000;
  const salaryFloor = clamp(
    Math.floor(safeNumber((config as any)?.salaryFloor ?? (config as any)?.salary_floor, defaultSalaryFloor)),
    0,
    salaryCap,
  );

  return {
    numLineups: Math.max(1, Math.floor(safeNumber(config?.numLineups, 20))),
    salaryCap,
    salaryFloor,
    salary_floor: salaryFloor,
    maxExposure: clamp(safeNumber(config?.maxExposure, 100), 0, 100),
    enableDiagnostics,
    enable_diagnostics: enableDiagnostics,
    forceFallback,
    force_fallback: forceFallback,
    enableStatConstraints,
    enable_stat_constraints: enableStatConstraints,
    statConstraintMode: statMode,
    mode: statMode,
    deltaFromBestProjection: Math.max(0, safeNumber(deltaRaw, 8)),
    delta_from_best_projection: Math.max(0, safeNumber(deltaRaw, 8)),
    minMinutesCore: Math.max(0, safeNumber(minCoreRaw, 28)),
    min_minutes_core: Math.max(0, safeNumber(minCoreRaw, 28)),
    minCountMinutesCore: Math.max(0, Math.floor(safeNumber(minCountCoreRaw, statMode === 'cash' ? 7 : 6))),
    min_count_minutes_core: Math.max(0, Math.floor(safeNumber(minCountCoreRaw, statMode === 'cash' ? 7 : 6))),
    maxCountLowMinutes: Math.max(0, Math.floor(safeNumber(maxLowRaw, statMode === 'cash' ? 0 : 1))),
    max_count_low_minutes: Math.max(0, Math.floor(safeNumber(maxLowRaw, statMode === 'cash' ? 0 : 1))),
    lowMinutesCutoff: Math.max(0, safeNumber(lowCutoffRaw, 20)),
    low_minutes_cutoff: Math.max(0, safeNumber(lowCutoffRaw, 20)),
    enableRuleBoosts,
    enable_rule_boosts: enableRuleBoosts,
    topQuantile,
    top_quantile: topQuantile,
    midQuantile,
    mid_quantile: midQuantile,
    bonusR4,
    bonus_r4: bonusR4,
    bonusR1,
    bonus_r1: bonusR1,
    bonusR5,
    bonus_r5: bonusR5,
    ceilingWeight,
    ceiling_weight: ceilingWeight,
    ownershipPenalty,
    ownership_penalty: ownershipPenalty,
    minUniquePlayers,
    min_unique_players: minUniquePlayers,
    stackMinPlayers,
    stack_min_players: stackMinPlayers,
    stackMinGameTotal,
    stack_min_game_total: stackMinGameTotal,
    cashMinGameTotal: safeNumber((config as any)?.cashMinGameTotal, 220),
    cashMaxExposurePct: clamp(safeNumber((config as any)?.cashMaxExposurePct, 65), 0, 100),
    cashPositionFloors: (config as any)?.cashPositionFloors ?? null,
    teamStackWeights: (config as any)?.teamStackWeights ?? undefined,
    bringBackEnable,
    bringBackRate,
    maxStackGames,
  };
};

const getStatConstraintSettings = (config: ResolvedOptimizerConfig): StatConstraintSettings => {
  const modeRaw = String(config.statConstraintMode ?? config.mode ?? 'gpp').toLowerCase();
  const mode: StatConstraintMode = modeRaw === 'cash' ? 'cash' : 'gpp';
  return {
    enable: config.enableStatConstraints !== false,
    mode,
    deltaFromBestProjection: Math.max(0, safeNumber(config.deltaFromBestProjection ?? config.delta_from_best_projection, 8)),
    minMinutesCore: Math.max(0, safeNumber(config.minMinutesCore ?? config.min_minutes_core, 28)),
    minCountMinutesCore: Math.max(
      0,
      Math.floor(safeNumber(config.minCountMinutesCore ?? config.min_count_minutes_core, mode === 'cash' ? 7 : 6)),
    ),
    maxCountLowMinutes: Math.max(
      0,
      Math.floor(safeNumber(config.maxCountLowMinutes ?? config.max_count_low_minutes, mode === 'cash' ? 0 : 1)),
    ),
    lowMinutesCutoff: Math.max(0, safeNumber(config.lowMinutesCutoff ?? config.low_minutes_cutoff, 20)),
  };
};

const toExposurePercent = (raw: unknown, fallback: number): number => {
  if (raw === '' || raw === null || raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, 0, 100);
};

const buildExposureLimits = (
  players: Player[],
  totalLineups: number,
  globalMaxExposurePct?: number,  // cash: cap every non-locked player (e.g. 65)
): { minRequiredByPlayer: number[]; maxAllowedByPlayer: number[] } => {
  const minRequiredByPlayer = new Array<number>(players.length).fill(0);
  const maxAllowedByPlayer = new Array<number>(players.length).fill(totalLineups);

  const globalMaxCount =
    globalMaxExposurePct !== undefined && globalMaxExposurePct < 100
      ? Math.floor((globalMaxExposurePct / 100) * totalLineups)
      : undefined;

  players.forEach((player, idx) => {
    const isLocked = Boolean((player as any).optimizerLocked);
    const isExcluded = Boolean((player as any).optimizerExcluded || (player as any).excluded);

    if (isExcluded) {
      minRequiredByPlayer[idx] = 0;
      maxAllowedByPlayer[idx] = 0;
      return;
    }

    if (isLocked) {
      minRequiredByPlayer[idx] = totalLineups;
      maxAllowedByPlayer[idx] = totalLineups;
      return;
    }

    const minPct = toExposurePercent((player as any).optimizerMinExposure, 0);
    const maxPct = toExposurePercent((player as any).optimizerMaxExposure, 100);
    if (minPct > maxPct) {
      throw new Error(`Exposure settings invalid for ${player.name}: min exposure exceeds max exposure.`);
    }

    const minReq = Math.ceil((minPct / 100) * totalLineups);
    let maxAllowed = Math.floor((maxPct / 100) * totalLineups);

    // When the percentage rounds down to 0 (e.g. 50% × 1 lineup = 0.5 → 0),
    // treat the player as still eligible — they should be allowed in at least 1 lineup.
    // A genuine exclusion is expressed via 0% max exposure or the exclude toggle.
    if (maxPct > 0 && maxAllowed < 1) {
      maxAllowed = 1;
    }

    // Apply global cash exposure cap (e.g. 65%) — takes precedence over per-player max,
    // but never reduces below 1 for eligible players.
    if (globalMaxCount !== undefined) {
      maxAllowed = Math.min(maxAllowed, Math.max(1, globalMaxCount));
    }

    if (minReq > maxAllowed) {
      throw new Error(`Exposure settings infeasible for ${player.name}.`);
    }

    minRequiredByPlayer[idx] = minReq;
    maxAllowedByPlayer[idx] = maxAllowed;
  });

  return { minRequiredByPlayer, maxAllowedByPlayer };
};

const getExposureStepForLineup = (
  players: Player[],
  exposureCounts: number[],
  minRequiredByPlayer: number[],
  maxAllowedByPlayer: number[],
  lineupIndex: number,
  totalLineups: number,
): { forceInclude: Set<number>; forceExclude: Set<number> } => {
  const remainingIncludingCurrent = totalLineups - lineupIndex;
  const forceInclude = new Set<number>();
  const forceExclude = new Set<number>();

  players.forEach((player, idx) => {
    const count = exposureCounts[idx] || 0;
    const minReq = minRequiredByPlayer[idx] || 0;
    const maxAllowed = maxAllowedByPlayer[idx] ?? totalLineups;

    if (count > maxAllowed) {
      throw new Error(`Exposure limit exceeded for ${player.name}.`);
    }
    if (count + remainingIncludingCurrent < minReq) {
      throw new Error(`Min exposure infeasible for ${player.name}.`);
    }

    if (count >= maxAllowed) {
      forceExclude.add(idx);
    }

    if (count + (remainingIncludingCurrent - 1) < minReq) {
      forceInclude.add(idx);
    }
  });

  forceInclude.forEach((idx) => {
    if (forceExclude.has(idx)) {
      const playerName = players[idx]?.name || `Player ${idx}`;
      throw new Error(`Exposure infeasible for ${playerName}.`);
    }
  });

  return { forceInclude, forceExclude };
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

const runHighsSolve = async (lpText: string): Promise<any> => {
  const highs = await getHighsModule();
  if (!highs || typeof highs.solve !== 'function') {
    throw new Error('Failed to initialize HiGHS solver.');
  }
  return highs.solve(lpText);
};

const solveLp = async (model: ModelBlueprint): Promise<SolveResult> => {
  const lpText = buildLp(model);
  let solution: any;
  try {
    solution = await runHighsSolve(lpText);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const isRuntimeCrash = details.toLowerCase().includes('indirect call to null');
    if (isRuntimeCrash) {
      // Recover from occasional wasm/runtime corruption by forcing a fresh module instance.
      highsModulePromise = null;
      try {
        solution = await runHighsSolve(lpText);
      } catch (retryError) {
        const retryDetails = retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(`HiGHS solve failed after retry: ${retryDetails}`);
      }
    } else {
      throw new Error(`HiGHS solve failed: ${details}`);
    }
  }

  const status = String(solution?.Status ?? 'Unknown');
  const statusLc = status.toLowerCase();
  if (statusLc.includes('infeasible') || statusLc.includes('unbounded') || statusLc.includes('error') || statusLc.includes('empty')) {
    return {
      values: new Map<string, number>(),
      status,
      objectiveValue: Number.NaN,
    };
  }
  const columns = solution?.Columns ?? {};
  const values = new Map<string, number>();
  model.binaries.forEach((name) => {
    values.set(name, safeNumber(columns?.[name]?.Primal, 0));
  });
  let objectiveValue = safeNumber(solution?.ObjectiveValue, Number.NaN);
  if (!Number.isFinite(objectiveValue)) objectiveValue = 0;

  return { values, status, objectiveValue };
};

const addConstraint = (constraints: LinearConstraint[], name: string, terms: LinearTerm[], sense: LinearConstraint['sense'], rhs: number) => {
  constraints.push({ name, terms, sense, rhs });
};

const buildLineupSignature = (playerIndexes: number[]): string => {
  return [...new Set(playerIndexes)].sort((a, b) => a - b).join('_');
};

const buildBaseModel = (context: BuildContext): ModelBlueprint => {
  const { players, config } = context;
  const constraints: LinearConstraint[] = [];
  const assignmentVars: AssignmentVar[] = [];
  const assignmentVarsByPlayer = new Map<number, string[]>();
  const assignmentVarsBySlot = new Map<Slot, string[]>();
  DK_SLOTS.forEach((slot) => assignmentVarsBySlot.set(slot, []));

  players.forEach((player, playerIndex) => {
    DK_SLOTS.forEach((slot) => {
      if (!canFitDK(player, slot)) return;
      const varName = `x_p${playerIndex}_${slot}`;
      assignmentVars.push({ name: varName, playerIndex, slot });
      if (!assignmentVarsByPlayer.has(playerIndex)) assignmentVarsByPlayer.set(playerIndex, []);
      assignmentVarsByPlayer.get(playerIndex)!.push(varName);
      assignmentVarsBySlot.get(slot)!.push(varName);
    });
  });

  DK_SLOTS.forEach((slot) => {
    const vars = assignmentVarsBySlot.get(slot) || [];
    if (vars.length === 0) {
      throw new Error(`No eligible players for ${slot}.`);
    }
    addConstraint(
      constraints,
      `slot_${slot}`,
      vars.map((v) => ({ varName: v, coeff: 1 })),
      '=',
      1,
    );
  });

  const forceInclude = new Set<number>();
  const forceExclude = new Set<number>();

  players.forEach((player, idx) => {
    const varNames = assignmentVarsByPlayer.get(idx) || [];
    if (varNames.length === 0) return;

    const isLocked = Boolean((player as any).optimizerLocked);
    const isExcluded = Boolean((player as any).optimizerExcluded || (player as any).excluded);
    if (isExcluded) forceExclude.add(idx);
    if (isLocked) forceInclude.add(idx);

    if (forceInclude.has(idx) && forceExclude.has(idx)) {
      throw new Error(`Exposure/lock conflict for ${player.name}.`);
    }
  });

  // Merge dynamic exposure requirements for this lineup iteration.
  context.forcedExposureInclude.forEach((idx) => forceInclude.add(idx));
  context.forcedExposureExclude.forEach((idx) => forceExclude.add(idx));

  forceExclude.forEach((idx) => {
    if (forceInclude.has(idx)) {
      const playerName = players[idx]?.name || `Player ${idx}`;
      throw new Error(`Exposure/lock conflict for ${playerName}.`);
    }
  });

  if (forceInclude.size > DK_SLOTS.length) {
    throw new Error(`Locked players exceed ${DK_SLOTS.length} roster slots.`);
  }

  players.forEach((player, idx) => {
    const varNames = assignmentVarsByPlayer.get(idx) || [];
    if (varNames.length === 0) return;

    const terms = varNames.map((varName) => ({ varName, coeff: 1 }));
    if (forceInclude.has(idx) && !forceExclude.has(idx)) {
      addConstraint(constraints, `player_${idx}_force_in`, terms, '=', 1);
      return;
    }
    if (forceExclude.has(idx)) {
      addConstraint(constraints, `player_${idx}_force_out`, terms, '=', 0);
      return;
    }
    addConstraint(constraints, `player_${idx}_unique`, terms, '<=', 1);
  });

  addConstraint(
    constraints,
    'salary_cap',
    assignmentVars.map((variable) => ({
      varName: variable.name,
      coeff: Math.max(0, safeNumber(players[variable.playerIndex].salary, 0)),
    })),
    '<=',
    config.salaryCap,
  );
  if (config.salaryFloor > 0) {
    addConstraint(
      constraints,
      'salary_floor',
      assignmentVars.map((variable) => ({
        varName: variable.name,
        coeff: Math.max(0, safeNumber(players[variable.playerIndex].salary, 0)),
      })),
      '>=',
      config.salaryFloor,
    );
  }

  const minUniquePlayers = Math.max(
    1,
    Math.floor(safeNumber(config.minUniquePlayers ?? (config as any).min_unique_players, 3)),
  );
  const maxSharedPlayers = DK_SLOTS.length - minUniquePlayers;

  context.previousLineups.forEach((prevLineup, lineupIdx) => {
    const terms: LinearTerm[] = [];
    [...new Set(prevLineup)].forEach((playerIdx) => {
      (assignmentVarsByPlayer.get(playerIdx) || []).forEach((varName) => {
        terms.push({ varName, coeff: 1 });
      });
    });
    if (terms.length > 0) {
      addConstraint(constraints, `nodup_${lineupIdx}`, terms, '<=', maxSharedPlayers);
    }
  });

  const binaries = [...assignmentVars.map((v) => v.name)];

  return {
    objective: new Map<string, number>(),
    constraints,
    binaries,
    assignmentVars,
    assignmentVarsByPlayer,
  };
};

const readPercentMaybe = (player: Player, keys: string[]): number | undefined => {
  return normalizePercentMaybe(readNumericMaybe(player, keys));
};

const getUSGPctMaybe = (player: Player): number | undefined => {
  return readPercentMaybe(player, ['USG_pct', 'USG%', 'usg_pct', 'usageRate', 'usage_rate', 'usage', 'USG']);
};

const getASTPctMaybe = (player: Player): number | undefined => {
  return readPercentMaybe(player, ['AST_pct', 'AST%', 'ast_pct', 'assist_rate', 'assistRate']);
};

const getREBPctMaybe = (player: Player): number | undefined => {
  return readPercentMaybe(player, ['REB_pct', 'REB%', 'reb_pct', 'rebound_rate', 'reboundRate']);
};

const getOwnershipPctMaybe = (player: Player): number | undefined => {
  const own = readNumericMaybe(player, ['ownership', 'projectedOwnership', 'projOwnership', 'own', 'OWN']);
  if (!Number.isFinite(Number(own))) return undefined;
  return normalizeOwnership(Number(own));
};

const getASTMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['AST', 'ast', 'assists', 'assist', 'ASTS']);
};

const getREBMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['REB', 'reb', 'rebounds', 'rebound']);
};

const getBLKMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['BLK', 'blk', 'blocks', 'block']);
};

const getSTLMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['STL', 'stl', 'steals', 'steal']);
};

const getFTAMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['FTA', 'fta', 'freeThrowsAttempted', 'ft_attempts']);
};

const getMinutesMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, ['minutes', 'minutesProjection', 'projMinutes', 'projectedMinutes', 'min']);
};

const getLeverageScoreMaybe = (player: Player): number | null => {
  const v = readNumericMaybe(player, ['LEVERAGE_SCORE', 'leverageScore', 'leverage_score', 'signalLeverageScore', 'signal_leverage_score']);
  return Number.isFinite(Number(v)) ? Number(v) : null;
};

const getVolatilityMaybe = (player: Player): number | null => {
  const v = readNumericMaybe(player, ['VOLATILITY', 'volatility', 'vol']);
  return Number.isFinite(Number(v)) ? Number(v) : null;
};

const getMinutesProjMaybe = (player: Player): number | null => {
  const v = readNumericMaybe(player, ['MINUTES_PROJ', 'minutesProj', 'minutes_proj', 'minutesProjection', 'minutes']);
  return Number.isFinite(Number(v)) ? Number(v) : null;
};

const getTeamMaybe = (player: Player): string => {
  return readString(player, ['team', 'teamAbbr', 'team_abbr', 'teamId', 'team_id', 'TEAM']);
};

const getOpponentMaybe = (player: Player): string => {
  return readString(player, ['opponent', 'opp', 'OPP', 'opposingTeam', 'opposing_team', 'opp_team']);
};

const getGameTotalMaybe = (player: Player): number | undefined => {
  return readNumericMaybe(player, [
    'gameTotal', 'game_total', 'overUnder', 'over_under',
    'total', 'TOTAL', 'gameOu', 'game_ou', 'slateTotal',
  ]);
};

const getGameSlug = (team: string, opponent: string): string => {
  const parts = [team.toLowerCase().trim(), opponent.toLowerCase().trim()].sort();
  return parts.join('_vs_');
};

const buildStatConstraintRules = (context: BuildContext): StatConstraintRule[] => {
  const { players, statSettings } = context;
  if (!statSettings.enable) return [];

  const qualifying = (predicate: (player: Player) => boolean): number[] => {
    return players.map((player, idx) => ({ player, idx })).filter((entry) => predicate(entry.player)).map((entry) => entry.idx);
  };

  const rules: StatConstraintRule[] = [];

  rules.push({
    name: 'core_minutes_count',
    sense: '>=',
    rhs: statSettings.minCountMinutesCore,
    playerIndexes: qualifying((player) => {
      const min = getMinutesMaybe(player);
      return Number.isFinite(Number(min)) && Number(min) >= statSettings.minMinutesCore;
    }),
  });

  rules.push({
    name: 'low_minutes_limit',
    sense: '<=',
    rhs: statSettings.maxCountLowMinutes,
    playerIndexes: qualifying((player) => {
      const min = getMinutesMaybe(player);
      return Number.isFinite(Number(min)) && Number(min) < statSettings.lowMinutesCutoff;
    }),
  });

  rules.push({
    name: 'at_least_one_primary_playmaker',
    sense: '>=',
    rhs: 1,
    playerIndexes: qualifying((player) => {
      if (!canFitDK(player, 'PG')) return false;
      const astPct = getASTPctMaybe(player);
      const ast = getASTMaybe(player);
      return (Number.isFinite(Number(astPct)) && Number(astPct) >= 35)
        || (Number.isFinite(Number(ast)) && Number(ast) >= 10);
    }),
  });

  rules.push({
    name: 'center_rebound_or_block_anchor',
    sense: '>=',
    rhs: 1,
    playerIndexes: qualifying((player) => {
      if (!canFitDK(player, 'C')) return false;
      const reb = getREBMaybe(player);
      const rebPct = getREBPctMaybe(player);
      const blk = getBLKMaybe(player);
      return (Number.isFinite(Number(reb)) && Number(reb) >= 11)
        || (Number.isFinite(Number(rebPct)) && Number(rebPct) >= 22)
        || (Number.isFinite(Number(blk)) && Number(blk) >= 2);
    }),
  });

  if (statSettings.mode === 'gpp') {
    // Scale down rhs for "require N of M" constraints when the qualifying pool is small.
    // If fewer than 2*required players qualify, forcing N of them into every lineup
    // exhausts unique combinations rapidly on small slates.
    const scaledRhs2 = (indexes: number[]): number => (indexes.length >= 4 ? 2 : 1);

    const highUsageIndexes = qualifying((player) => {
      const usg = getUSGPctMaybe(player);
      return Number.isFinite(Number(usg)) && Number(usg) >= 28;
    });
    if (highUsageIndexes.length >= 1) {
      rules.push({
        name: 'two_high_usage_players',
        sense: '>=',
        rhs: scaledRhs2(highUsageIndexes),
        playerIndexes: highUsageIndexes,
      });
    }

    const modUsageIndexes = qualifying((player) => {
      const usg = getUSGPctMaybe(player);
      return Number.isFinite(Number(usg)) && Number(usg) >= 20;
    });
    if (modUsageIndexes.length >= 2) {
      // Scale rhs=5 down when the pool is too small for meaningful diversity.
      // C(N,5) < 10 when N < 7, so require fewer when the pool is tight.
      const scaledRhs5 = modUsageIndexes.length >= 8
        ? 5
        : modUsageIndexes.length >= 6
          ? 4
          : modUsageIndexes.length >= 4
            ? 3
            : 2;
      rules.push({
        name: 'five_moderate_usage_players',
        sense: '>=',
        rhs: scaledRhs5,
        playerIndexes: modUsageIndexes,
      });
    }

    const stockIndexes = qualifying((player) => {
      const stl = getSTLMaybe(player);
      const blk = getBLKMaybe(player);
      if (!Number.isFinite(Number(stl)) || !Number.isFinite(Number(blk))) return false;
      return Number(stl) + Number(blk) >= 2;
    });
    if (stockIndexes.length >= 1) {
      rules.push({
        name: 'two_stock_guys',
        sense: '>=',
        rhs: scaledRhs2(stockIndexes),
        playerIndexes: stockIndexes,
      });
    }

    const ftaIndexes = qualifying((player) => {
      const fta = getFTAMaybe(player);
      return Number.isFinite(Number(fta)) && Number(fta) >= 6;
    });
    if (ftaIndexes.length >= 1) {
      rules.push({
        name: 'two_fta_ceiling_players',
        sense: '>=',
        rhs: scaledRhs2(ftaIndexes),
        playerIndexes: ftaIndexes,
      });
    }

    rules.push({
      name: 'limit_high_owned',
      sense: '<=',
      rhs: statSettings.mode === 'cash' ? 8 : 4,
      playerIndexes: qualifying((player) => {
        const own = getOwnershipPctMaybe(player);
        return Number.isFinite(Number(own)) && Number(own) >= 25;
      }),
    });

    const lowOwnedIndexes = qualifying((player) => {
      const own = getOwnershipPctMaybe(player);
      return Number.isFinite(Number(own)) && Number(own) <= 10;
    });
    if (lowOwnedIndexes.length >= 1) {
      rules.push({
        name: 'require_some_low_owned',
        sense: '>=',
        rhs: scaledRhs2(lowOwnedIndexes),
        playerIndexes: lowOwnedIndexes,
      });
    }

    const highLevIndexes = qualifying((player) => {
      const lev = leverageTierToScoreMaybe(player);
      return Number.isFinite(Number(lev)) && Number(lev) >= 2;
    });
    if (highLevIndexes.length >= 1) {
      rules.push({
        name: 'require_two_high_leverage',
        sense: '>=',
        rhs: scaledRhs2(highLevIndexes),
        playerIndexes: highLevIndexes,
      });
    }
  }

  return rules;
};

const relaxStatRules = (
  rules: StatConstraintRule[],
  forceExclude: Set<number>,
): { rules: StatConstraintRule[]; relaxed: RelaxedStatRule[] } => {
  const relaxed: RelaxedStatRule[] = [];
  const nextRules: StatConstraintRule[] = [];

  for (const rule of rules) {
    const activeIndexes = rule.playerIndexes.filter((idx) => !forceExclude.has(idx));
    if (activeIndexes.length === 0) {
      continue;
    }

    if (rule.sense === '>=') {
      const effectiveRhs = Math.min(rule.rhs, activeIndexes.length);
      if (effectiveRhs <= 0) continue;
      if (effectiveRhs < rule.rhs) {
        relaxed.push({
          rule,
          required: rule.rhs,
          available: activeIndexes.length,
        });
      }
      nextRules.push({
        ...rule,
        rhs: effectiveRhs,
        playerIndexes: activeIndexes,
      });
      continue;
    }

    nextRules.push({
      ...rule,
      playerIndexes: activeIndexes,
    });
  }

  return { rules: nextRules, relaxed };
};

const applyStatConstraintRules = (
  model: ModelBlueprint,
  rules: StatConstraintRule[],
  forceExclude: Set<number>,
): { relaxed: Array<{ name: string; required: number; available: number; applied: number }>; names: string[] } => {
  const normalized = relaxStatRules(rules, forceExclude);
  const relaxed: Array<{ name: string; required: number; available: number; applied: number }> = [];
  const names: string[] = [];

  for (const entry of normalized.relaxed) {
    relaxed.push({
      name: entry.rule.name,
      required: entry.required,
      available: entry.available,
      applied: Math.min(entry.required, entry.available),
    });
  }

  for (const rule of normalized.rules) {
    const terms: LinearTerm[] = [];
    rule.playerIndexes.forEach((idx) => {
      (model.assignmentVarsByPlayer.get(idx) || []).forEach((varName) => {
        terms.push({ varName, coeff: 1 });
      });
    });

    if (terms.length === 0) {
      continue;
    }

    names.push(rule.name);
    addConstraint(model.constraints, `stat_${rule.name}`, terms, rule.sense, rule.rhs);
  }

  return { relaxed, names };
};

const evaluateStatConstraintRules = (
  selectedIndexes: number[],
  rules: StatConstraintRule[],
): { ok: boolean; failing: string[] } => {
  const selectedSet = new Set<number>(selectedIndexes);
  const failing: string[] = [];

  for (const rule of rules) {
    const count = rule.playerIndexes.reduce((sum, idx) => sum + (selectedSet.has(idx) ? 1 : 0), 0);
    if (rule.sense === '>=' && count < rule.rhs) failing.push(rule.name);
    if (rule.sense === '<=' && count > rule.rhs) failing.push(rule.name);
  }

  return { ok: failing.length === 0, failing };
};

const finiteOrNull = (value: number): number | null => (Number.isFinite(value) ? value : null);

const snapshotConstraints = (model: ModelBlueprint, limit = 120): ConstraintSnapshot[] => {
  return model.constraints.slice(0, limit).map((constraint) => ({
    name: constraint.name,
    sense: constraint.sense,
    rhs: constraint.rhs,
  }));
};

const isInfeasibleStatus = (status: string): boolean => {
  const s = String(status || '').toLowerCase();
  return s.includes('infeasible') || s.includes('unbounded') || s.includes('error') || s.includes('empty');
};

const getBindingConstraints = (
  model: ModelBlueprint,
  solution: SolveResult,
  tolerance = 1e-6,
  limit = 30,
): string[] => {
  if (!solution.values || solution.values.size === 0) return [];
  const binding: string[] = [];

  for (const constraint of model.constraints) {
    let lhs = 0;
    constraint.terms.forEach((term) => {
      lhs += term.coeff * safeNumber(solution.values.get(term.varName), 0);
    });

    let isBinding = false;
    if (constraint.sense === '=') isBinding = Math.abs(lhs - constraint.rhs) <= tolerance;
    if (constraint.sense === '<=') isBinding = Math.abs(constraint.rhs - lhs) <= tolerance;
    if (constraint.sense === '>=') isBinding = Math.abs(lhs - constraint.rhs) <= tolerance;

    if (isBinding) {
      binding.push(constraint.name);
      if (binding.length >= limit) break;
    }
  }

  return binding;
};

const getLeverageTierPriority = (player: Player): number => {
  const tier = readString(player, [
    'signalLeverageTier',
    'signal_leverage_tier',
    'LEVERAGE_TIER',
    'leverageTier',
    'leverage_tier',
    'leverageTierLabel',
    'leverageTierName',
  ]).toLowerCase();

  if (!tier) return 2;
  if (tier.includes('elite')) return 5;
  if (tier.includes('strong boost') || (tier.includes('strong') && tier.includes('positive'))) return 4;
  if (tier === 'boost' || tier.includes('positive') || tier.includes('core')) return 3;
  if (tier.includes('strong fade') || (tier.includes('strong') && tier.includes('negative'))) return 0;
  if (tier === 'fade' || tier.includes('negative')) return 1;
  if (tier.includes('neutral')) return 2;
  return 2;
};

const getSignalTierPriority = (player: Player): number => {
  const tier = readString(player, [
    'DEF_SIGNAL_ONOFF_IMPACT_TIER',
    'def_signal_onoff_impact_tier',
    'onOffImpactTier',
    'signalTier',
    'signal_tier',
    'signal',
  ]).toLowerCase();

  if (tier) {
    if (tier.includes('strong boost')) return 3;
    if (tier === 'boost' || tier.includes('boost')) return 2;
    if (tier.includes('strong fade')) return 0;
    if (tier === 'fade' || tier.includes('fade')) return 1;
    if (tier.includes('neutral')) return 2;
  }

  const impactFp = readNumericMaybe(player, [
    'DEF_SIGNAL_ONOFF_IMPACT_FP',
    'def_signal_onoff_impact_fp',
    'onOffImpactFp',
    'signalImpactFp',
  ]);
  if (!Number.isFinite(Number(impactFp))) return 2;
  const impact = Number(impactFp);
  if (impact >= 1.0) return 3;
  if (impact >= 0.15) return 2;
  if (impact <= -1.0) return 0;
  if (impact < -0.15) return 1;
  return 2;
};

const getCeilingTieBreaker = (player: Player): number => {
  return Math.max(0, safeNumber(readNumericMaybe(player, [
    'ceiling',
    'ceilingProjection',
    'ceilingProj',
    'projectedCeiling',
    'fptsCeiling',
    'dkCeiling',
  ]), 0));
};

const getFloorValue = (player: Player): number => {
  return Math.max(0, safeNumber(readNumericMaybe(player, [
    'floor',
    'floorProjection',
    'floorProj',
    'projectedFloor',
    'fptsFloor',
    'dkFloor',
    'bust',
    'bustProjection',
  ]), 0));
};

// ---------------------------------------------------------------------------
// Cash-mode helpers
// ---------------------------------------------------------------------------

/** Default positional projection floors for cash game mode.
 * Intentionally conservative — only filters out true scrubs.
 * The ILP objective already maximises cash-adjusted projection,
 * so there is no need to aggressively gate with high floors here. */
const CASH_POSITION_FLOORS_DEFAULT: Record<string, number> = {
  PG: 18, SG: 16, SF: 16, PF: 16, C: 14, G: 14, F: 14, UTIL: 14,
};

/** Read the raw player status string from any common field name. */
const getPlayerStatusRaw = (player: Player): string =>
  readString(player, [
    'status', 'injuryStatus', 'injury_status', 'playerStatus',
    'designation', 'gameStatus', 'game_status', 'injuryDesignation',
    'availability', 'reportStatus',
  ]).toLowerCase();

/**
 * Returns true if the player status indicates they should be excluded in
 * cash mode: Doubtful (D) or Out (O).
 *
 * GTD and Questionable (Q) players are intentionally NOT excluded here —
 * they are active on a high percentage of NBA slates and excluding them
 * risks making the pool too small to build a valid lineup (especially on
 * lighter late-season slates with heavy injury-report activity).
 */
const isCashUnavailableStatus = (status: string): boolean => {
  if (!status) return false;
  const s = status.toLowerCase().replace(/[^a-z]/g, '');
  return s === 'out' || s === 'o' || s === 'doubtful' || s === 'd';
};

/** Column names that are NOT additional projection sources. */
const SKIP_PROJ_NORM_KEYS = new Set([
  'projection', 'proj', 'fpts', 'ceiling', 'ceil', 'floor',
  'actual', 'actualfpts', 'fptsactual', 'dkactual',
  'minutesprojection', 'projminutes', 'projectedminutes', 'minutesprojeciton',
  'value', 'val', 'salary', 'sal', 'ownership', 'own',
]);

/**
 * Detects whether a column key looks like an additional projection source
 * (e.g. numberfire_proj, sabersim_fpts, tda_proj).
 */
const looksLikeProjectionCol = (key: string): boolean => {
  const norm = normKey(key);
  if (SKIP_PROJ_NORM_KEYS.has(norm)) return false;
  // Must contain 'proj' (but not minutesproj or value) OR end with 'fpts'
  const hasProj = norm.includes('proj') && !norm.includes('minute') && !norm.includes('min') && norm !== 'proj';
  const hasFpts = norm.endsWith('fpts') && norm !== 'fpts' && !norm.startsWith('actual');
  return hasProj || hasFpts;
};

/**
 * If the player object carries multiple projection source columns (e.g.
 * numberfire_proj, sabersim_proj), returns their average; otherwise returns
 * player.projection.  Values outside [5, 120] are ignored as non-projection.
 */
const getConsensusProjection = (player: Player): number => {
  const primary = Math.max(0, safeNumber(player.projection, 0));
  const extras: number[] = [];
  const raw = player as Record<string, any>;
  for (const key of Object.keys(raw)) {
    if (!looksLikeProjectionCol(key)) continue;
    const val = Number(raw[key]);
    if (Number.isFinite(val) && val > 5 && val < 120) extras.push(val);
  }
  if (extras.length === 0) return primary;
  const all = primary > 0 ? [primary, ...extras] : extras;
  return all.reduce((a, b) => a + b, 0) / all.length;
};

/**
 * Computes the cash-adjusted projection: consensus × 0.6 + floor × 0.4.
 * If no floor is available, falls back to consensus × 0.7 as an estimate.
 */
const getCashAdjustedProjection = (player: Player): number => {
  const consensus = getConsensusProjection(player);
  const rawFloor = getFloorValue(player);
  const effectiveFloor = rawFloor > 0 ? rawFloor : consensus * 0.7;
  return consensus * 0.6 + effectiveFloor * 0.4;
};

// ---------------------------------------------------------------------------

const getValueTieBreaker = (player: Player): number => {
  const explicit = readNumericMaybe(player, [
    'value',
    'val',
    'projectionPerK',
    'projPerK',
    'fptsPerK',
  ]);
  if (Number.isFinite(Number(explicit))) return Math.max(0, Number(explicit));
  const salary = Math.max(0, safeNumber(player.salary, 0));
  if (salary <= 0) return 0;
  return (Math.max(0, safeNumber(player.projection, 0)) / salary) * 1000;
};

const computeRuleFlags = (
  players: Player[],
  cfg: ResolvedOptimizerConfig,
) => {
  const topQuantile = clamp(safeNumber(cfg.topQuantile ?? cfg.top_quantile, 0.10), 0.01, 0.40);
  const midQuantile = clamp(safeNumber(cfg.midQuantile ?? cfg.mid_quantile, 0.20), 0.01, 0.50);

  const topQ = 1 - topQuantile;
  const midQ = 1 - midQuantile;

  const leverageVals = players.map(getLeverageScoreMaybe).filter((x): x is number => x !== null);
  const volVals = players.map(getVolatilityMaybe).filter((x): x is number => x !== null);
  const minutesVals = players.map(getMinutesProjMaybe).filter((x): x is number => x !== null);

  const levTop = quantile(leverageVals, topQ);
  const volTop = quantile(volVals, topQ);
  const levMid = quantile(leverageVals, midQ);
  const minMid = quantile(minutesVals, midQ);

  players.forEach((player) => {
    const lev = getLeverageScoreMaybe(player);
    const vol = getVolatilityMaybe(player);
    const min = getMinutesProjMaybe(player);

    const r1 = levTop !== null && lev !== null && lev >= levTop;
    const r2 = volTop !== null && vol !== null && vol >= volTop;
    const r4 = r1 || r2;
    const r5 = levMid !== null && minMid !== null && lev !== null && min !== null && lev >= levMid && min >= minMid;

    (player as any)[RULE_FLAGS_KEY] = {
      r1_leverage_top10: r1,
      r2_volatility_top10: r2,
      r4_leverage_or_vol_top10: r4,
      r5_leverage_and_minutes_top20: r5,
    } satisfies RuleFlags;
  });
};

const getRuleFlags = (player: Player): RuleFlags | null => {
  const f = (player as any)[RULE_FLAGS_KEY];
  return f && typeof f === 'object' ? (f as RuleFlags) : null;
};

const FALLBACK_SCORE_MIN = 0;
const FALLBACK_SCORE_MAX = 200;

const normalizeFallbackRuleBonus = (raw: unknown, fallback: number): number => {
  const n = safeNumber(raw, fallback);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Legacy config values are on a huge scale; map them to sane fallback defaults.
  if (n > 50) return fallback;
  return clamp(n, 0, 10);
};

const getPriorityScore = (
  player: Player,
  cfg?: ResolvedOptimizerConfig,
): number => {
  const leveragePriority = getLeverageTierPriority(player);
  const signalPriority = getSignalTierPriority(player);
  const comboPriority = leveragePriority * 10 + signalPriority;
  const ceiling = getCeilingTieBreaker(player);
  const value = getValueTieBreaker(player);
  const usage = Math.max(0, safeNumber(getUSGPctMaybe(player), 0));
  const minutes = Math.max(0, safeNumber(getMinutesMaybe(player), 0));
  const projection = Math.max(0, safeNumber(player.projection, 0));
  const comboBonus = (comboPriority / 53) * 2.0;
  const ceilingBonus = Math.min(80, ceiling) * 0.03;
  const valueBonus = Math.min(10, value) * 0.25;
  const usageBonus = Math.min(45, usage) * 0.04;
  const minutesBonus = Math.min(40, minutes) * 0.03;
  let ruleBonus = 0;
  if (cfg?.enableRuleBoosts) {
    const flags = getRuleFlags(player);
    if (flags) {
      // Keep fallback rule boosts in a projection-like scale (single term <= 10 points).
      const bonusR4 = normalizeFallbackRuleBonus(cfg.bonusR4 ?? cfg.bonus_r4, 2.5);
      const bonusR1 = normalizeFallbackRuleBonus(cfg.bonusR1 ?? cfg.bonus_r1, 4.0);
      const bonusR5 = normalizeFallbackRuleBonus(cfg.bonusR5 ?? cfg.bonus_r5, 6.0);
      if (flags.r4_leverage_or_vol_top10) ruleBonus += bonusR4;
      if (flags.r1_leverage_top10) ruleBonus += bonusR1;
      if (flags.r5_leverage_and_minutes_top20) ruleBonus += bonusR5;
    }
  }

  const teamWeights = (cfg as any)?.teamStackWeights;
  let teamBoost = 0;
  if (teamWeights && typeof teamWeights === 'object') {
    const team = getTeamMaybe(player);
    const w = team ? (teamWeights[team] ?? 0) : 0;
    if (w > 0) teamBoost = w * 0.6;
  }

  const fallbackScoreRaw = projection
    + comboBonus
    + ceilingBonus
    + valueBonus
    + usageBonus
    + minutesBonus
    + ruleBonus
    + teamBoost;

  return clamp(fallbackScoreRaw, FALLBACK_SCORE_MIN, FALLBACK_SCORE_MAX);
};

const setObjectiveByPriority = (
  model: ModelBlueprint,
  players: Player[],
  cfg: ResolvedOptimizerConfig,
) => {
  model.objective.clear();

  const ceilingWeight = clamp(safeNumber(cfg.ceilingWeight ?? (cfg as any).ceiling_weight, 0), 0, 0.5);
  const ownershipPenalty = Math.max(0, safeNumber(cfg.ownershipPenalty ?? (cfg as any).ownership_penalty, 0));

  const statMode = String(cfg.statConstraintMode ?? (cfg as any).mode ?? 'gpp').toLowerCase();
  const isCash = statMode === 'cash';

  model.assignmentVars.forEach((variable) => {
    const player = players[variable.playerIndex];

    if (isCash) {
      // Cash mode: pure median EV, no ownership penalties, no leverage/rule bonuses,
      // no stacking bonuses.  Use pre-annotated cashAdjustedProj when available so
      // phase 1 and phase 2 use the same score.
      const preComputed = (player as any).cashAdjustedProj;
      const cashScore = Number.isFinite(Number(preComputed))
        ? Number(preComputed)
        : getCashAdjustedProjection(player);
      model.objective.set(variable.name, Math.max(0, cashScore));
      return;
    }

    // GPP path — unchanged
    const projection = Math.max(0, safeNumber(player.projection, 0));
    let baseScore: number;
    if (ceilingWeight > 0) {
      const rawCeiling = getCeilingTieBreaker(player);
      const effectiveCeiling = rawCeiling > 0 ? rawCeiling : projection;
      baseScore = projection * (1 - ceilingWeight) + effectiveCeiling * ceilingWeight;
    } else {
      baseScore = projection;
    }

    const ownershipPct = Math.max(0, safeNumber(getOwnershipPctMaybe(player), 0));
    const penaltyAmount = ownershipPenalty * ownershipPct;

    const leveragePriority = getLeverageTierPriority(player);
    const signalPriority = getSignalTierPriority(player);
    const leverageBonus = ((leveragePriority * 10 + signalPriority) / 53) * 2.0;

    let ruleBonus = 0;
    if (cfg.enableRuleBoosts) {
      const flags = getRuleFlags(player);
      if (flags) {
        if (flags.r5_leverage_and_minutes_top20) ruleBonus += 0.5;
        if (flags.r1_leverage_top10) ruleBonus += 0.3;
        if (flags.r4_leverage_or_vol_top10) ruleBonus += 0.2;
      }
    }

    const teamWeights = (cfg as any).teamStackWeights;
    let teamBoost = 0;
    if (teamWeights && typeof teamWeights === 'object') {
      const team = getTeamMaybe(player);
      const w = team ? (teamWeights[team] ?? 0) : 0;
      if (w > 0) teamBoost = w * 0.6;
    }

    const finalScore = Math.max(0, baseScore - penaltyAmount + leverageBonus + ruleBonus + teamBoost);
    model.objective.set(variable.name, finalScore);
  });
};

const setObjectiveProjectionFirst = (
  model: ModelBlueprint,
  players: Player[],
  cfg: ResolvedOptimizerConfig,
) => {
  model.objective.clear();
  model.assignmentVars.forEach((variable) => {
    const player = players[variable.playerIndex];
    const projection = Math.max(0, safeNumber(player.projection, 0));

    // Tiny tie-breakers only: keep projection as the dominant optimization signal.
    const leveragePriority = getLeverageTierPriority(player);
    const signalPriority = getSignalTierPriority(player);
    const comboNormalized = (leveragePriority * 10 + signalPriority) / 53;
    let tieBreaker = comboNormalized * 0.0005;

    if (cfg.enableRuleBoosts) {
      const flags = getRuleFlags(player);
      if (flags) {
        if (flags.r5_leverage_and_minutes_top20) tieBreaker += 0.0003;
        if (flags.r1_leverage_top10) tieBreaker += 0.0002;
        if (flags.r4_leverage_or_vol_top10) tieBreaker += 0.0001;
      }
    }

    const phaseStat = String(cfg.statConstraintMode ?? (cfg as any).mode ?? 'gpp').toLowerCase();
    let phaseScore: number;
    if (phaseStat === 'cash') {
      // Use pre-annotated value from cash pre-filter block so phase 1 and phase 2 use the same score.
      const preComputed = (player as any).cashAdjustedProj;
      phaseScore = Number.isFinite(Number(preComputed))
        ? Number(preComputed)
        : getCashAdjustedProjection(player);
    } else {
      phaseScore = projection + tieBreaker;
    }

    model.objective.set(variable.name, phaseScore);
  });
};

const addProjectionFloorConstraint = (model: ModelBlueprint, players: Player[], projectionFloor: number) => {
  addConstraint(
    model.constraints,
    'projection_floor',
    model.assignmentVars.map((variable) => ({
      varName: variable.name,
      coeff: Math.max(0, safeNumber(players[variable.playerIndex].projection, 0)),
    })),
    '>=',
    projectionFloor,
  );
};

const addGameStackConstraint = (
  model: ModelBlueprint,
  players: Player[],
  stackMinPlayers: number,
  stackMinGameTotal: number,
  lineupIndex: number,
  numLineups: number,
  bringBackEnable: boolean,
  bringBackRate: number,
  maxStackGames: number,
): void => {
  if (stackMinPlayers < 2) return;

  const gamePlayerMap = new Map<string, number[]>();
  const gameTotalMap = new Map<string, number>();

  players.forEach((player, idx) => {
    const team = getTeamMaybe(player);
    if (!team) return;
    const opp = getOpponentMaybe(player);
    const slug = getGameSlug(team, opp || 'unknown');

    if (!gamePlayerMap.has(slug)) gamePlayerMap.set(slug, []);
    gamePlayerMap.get(slug)!.push(idx);

    if (!gameTotalMap.has(slug)) {
      const total = getGameTotalMaybe(player);
      if (total !== undefined) gameTotalMap.set(slug, total);
    }
  });

  if (gamePlayerMap.size === 0) return;

  interface GameCandidate {
    slug: string;
    indexes: number[];
    avgProjection: number;
  }
  const candidates: GameCandidate[] = [];

  gamePlayerMap.forEach((indexes, slug) => {
    const availableIndexes = indexes.filter(
      (idx) => (model.assignmentVarsByPlayer.get(idx) || []).length > 0,
    );
    if (availableIndexes.length < stackMinPlayers) return;

    const gameTotal = gameTotalMap.get(slug);
    if (gameTotal !== undefined && stackMinGameTotal > 0 && gameTotal < stackMinGameTotal) return;

    const avgProjection =
      availableIndexes.reduce(
        (sum, idx) => sum + Math.max(0, safeNumber(players[idx]?.projection, 0)),
        0,
      ) / availableIndexes.length;

    candidates.push({ slug, indexes: availableIndexes, avgProjection });
  });

  if (candidates.length === 0) return;

  // Fix 3: Rotate across top-maxStackGames games weighted by avgProjection
  candidates.sort((a, b) => b.avgProjection - a.avgProjection);
  const topGames = candidates.slice(0, Math.min(maxStackGames, candidates.length));

  let targetGame: GameCandidate;
  if (topGames.length === 1) {
    targetGame = topGames[0];
  } else {
    const totalProj = topGames.reduce((s, g) => s + g.avgProjection, 0);
    const buckets: number[] = [];
    let cumulative = 0;
    topGames.forEach((g) => {
      cumulative += g.avgProjection / (totalProj || 1);
      buckets.push(cumulative);
    });
    buckets[buckets.length - 1] = 1.0;
    const position = lineupIndex / Math.max(1, numLineups);
    const gameIdx = buckets.findIndex((b) => position <= b);
    targetGame = topGames[Math.max(0, gameIdx)];
  }

  const terms: LinearTerm[] = [];
  targetGame.indexes.forEach((idx) => {
    (model.assignmentVarsByPlayer.get(idx) || []).forEach((varName) => {
      terms.push({ varName, coeff: 1 });
    });
  });

  if (terms.length >= stackMinPlayers) {
    addConstraint(model.constraints, 'game_stack_min', terms, '>=', stackMinPlayers);
  }

  // Fix 2: Bring-back — require >=1 player from each side of the targeted game
  if (bringBackEnable && stackMinPlayers >= 2) {
    const applyBringBack = lineupIndex / Math.max(1, numLineups) < bringBackRate;
    if (applyBringBack) {
      const teamPlayerMap = new Map<string, number[]>();
      targetGame.indexes.forEach((idx) => {
        const team = getTeamMaybe(players[idx]);
        if (!team) return;
        if (!teamPlayerMap.has(team)) teamPlayerMap.set(team, []);
        teamPlayerMap.get(team)!.push(idx);
      });

      if (teamPlayerMap.size >= 2) {
        const teamsRanked = Array.from(teamPlayerMap.entries())
          .map(([team, indexes]) => ({
            team,
            indexes,
            avgProj: indexes.reduce(
              (s, idx) => s + Math.max(0, safeNumber(players[idx]?.projection, 0)), 0,
            ) / indexes.length,
          }))
          .sort((a, b) => b.avgProj - a.avgProj);

        const primaryTeam  = teamsRanked[0];
        const opponentTeam = teamsRanked[1];

        // Require >=2 from primary (stack anchor)
        const primaryTerms: LinearTerm[] = [];
        primaryTeam.indexes.forEach((idx) => {
          (model.assignmentVarsByPlayer.get(idx) || []).forEach((varName) => {
            primaryTerms.push({ varName, coeff: 1 });
          });
        });
        if (primaryTerms.length >= 2) {
          addConstraint(model.constraints, 'team_stack_primary_min', primaryTerms, '>=', 2);
        }

        // Require >=1 from opponent (bring-back)
        const oppTerms: LinearTerm[] = [];
        opponentTeam.indexes.forEach((idx) => {
          (model.assignmentVarsByPlayer.get(idx) || []).forEach((varName) => {
            oppTerms.push({ varName, coeff: 1 });
          });
        });
        if (oppTerms.length >= 1) {
          addConstraint(model.constraints, 'bringback_opponent_min', oppTerms, '>=', 1);
        }
      }
    }
  }
};

const decodeLineup = (
  solution: SolveResult,
  model: ModelBlueprint,
  players: Player[],
  lineupIndex: number,
): { lineup: Lineup; selectedIndexes: number[] } | null => {
  if (!solution.values || solution.values.size === 0) return null;

  const slotToPlayerIndex = new Map<Slot, number>();
  model.assignmentVars.forEach((variable) => {
    const value = safeNumber(solution.values.get(variable.name), 0);
    if (value > 0.5) {
      slotToPlayerIndex.set(variable.slot, variable.playerIndex);
    }
  });

  if (slotToPlayerIndex.size !== DK_SLOTS.length) return null;

  const orderedIndexes = DK_SLOTS.map((slot) => slotToPlayerIndex.get(slot)).filter((idx): idx is number => idx !== undefined);
  const uniqueIndexes = Array.from(new Set(orderedIndexes));
  if (uniqueIndexes.length !== DK_SLOTS.length) return null;

  const lineupPlayers = uniqueIndexes.map((idx) => players[idx]);
  const totalSalary = lineupPlayers.reduce((sum, player) => sum + Math.max(0, safeNumber(player.salary, 0)), 0);
  const totalProjection = lineupPlayers.reduce((sum, player) => sum + Math.max(0, safeNumber(player.projection, 0)), 0);

  return {
    lineup: {
      id: `opt_${lineupIndex}_${uniqueIndexes.join('_')}`,
      playerIds: lineupPlayers.map((player) => player.id),
      players: [],
      totalSalary,
      totalProjection: Number(totalProjection.toFixed(2)),
      lineupSource: 'optimizer',
    },
    selectedIndexes: uniqueIndexes,
  };
};

const getForcedSets = (context: BuildContext): { forceInclude: Set<number>; forceExclude: Set<number> } => {
  const { players } = context;
  const forceInclude = new Set<number>();
  const forceExclude = new Set<number>();

  players.forEach((player, idx) => {
    if (!DK_SLOTS.some((slot) => canFitDK(player, slot))) return;

    const isLocked = Boolean((player as any).optimizerLocked);
    const isExcluded = Boolean((player as any).optimizerExcluded || (player as any).excluded);
    if (isExcluded) forceExclude.add(idx);
    if (isLocked) forceInclude.add(idx);

    if (forceInclude.has(idx) && forceExclude.has(idx)) {
      throw new Error(`Exposure/lock conflict for ${player.name}.`);
    }
  });

  context.forcedExposureInclude.forEach((idx) => {
    forceInclude.add(idx);
  });
  context.forcedExposureExclude.forEach((idx) => {
    forceExclude.add(idx);
  });

  forceExclude.forEach((idx) => {
    if (forceInclude.has(idx)) {
      const playerName = players[idx]?.name || `Player ${idx}`;
      throw new Error(`Exposure/lock conflict for ${playerName}.`);
    }
  });

  if (forceInclude.size > DK_SLOTS.length) {
    throw new Error(`Too many forced players (${forceInclude.size}) for ${DK_SLOTS.length} roster slots.`);
  }

  return { forceInclude, forceExclude };
};

const buildLineupFromIndexes = (players: Player[], selectedIndexes: number[], lineupIndex: number): Lineup => {
  const lineupPlayers = selectedIndexes.map((idx) => players[idx]);
  const totalSalary = lineupPlayers.reduce((sum, player) => sum + Math.max(0, safeNumber(player.salary, 0)), 0);
  const totalProjection = lineupPlayers.reduce((sum, player) => sum + Math.max(0, safeNumber(player.projection, 0)), 0);

  return {
    id: `opt_fb_${lineupIndex}_${selectedIndexes.join('_')}`,
    playerIds: lineupPlayers.map((player) => player.id),
    players: [],
    totalSalary,
    totalProjection: Number(totalProjection.toFixed(2)),
    lineupSource: 'optimizer',
  };
};

const searchFallbackLineup = (
  context: BuildContext,
  scoreByPlayer: number[],
  projectionFloor: number,
  statRules: StatConstraintRule[] = [],
): { lineup: Lineup; selectedIndexes: number[] } | null => {
  const { players, config, lineupIndex } = context;
  const { forceInclude, forceExclude } = getForcedSets(context);
  const previousSignatures = new Set(context.previousLineups.map((lineup) => buildLineupSignature(lineup)));

  if (forceInclude.size > DK_SLOTS.length) return null;

  const validIndexes = players
    .map((_, idx) => idx)
    .filter((idx) => !forceExclude.has(idx))
    .filter((idx) => DK_SLOTS.some((slot) => canFitDK(players[idx], slot)));

  if (validIndexes.length < DK_SLOTS.length) return null;

  const immediateInfeasible = statRules
    .filter((rule) => rule.sense === '>=')
    .find((rule) => rule.playerIndexes.length < rule.rhs);
  if (immediateInfeasible) return null;

  const ordered = [...validIndexes].sort((a, b) => {
    const scoreDiff = safeNumber(scoreByPlayer[b], 0) - safeNumber(scoreByPlayer[a], 0);
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
    const projDiff = safeNumber(players[b].projection, 0) - safeNumber(players[a].projection, 0);
    if (Math.abs(projDiff) > 1e-9) return projDiff;
    const salaryDiff = safeNumber(players[b].salary, 0) - safeNumber(players[a].salary, 0);
    if (Math.abs(salaryDiff) > 1e-9) return salaryDiff;
    return a - b;
  });

  const offset = ordered.length > 0 ? lineupIndex % ordered.length : 0;
  const rotated = offset > 0 ? [...ordered.slice(offset), ...ordered.slice(0, offset)] : ordered;

  const slotToPlayer = new Map<Slot, number>();
  const usedPlayers = new Set<number>();
  let totalSalary = 0;
  let totalProjection = 0;
  let chosen = false;
  let nodeVisits = 0;
  const maxNodeVisits = 200000;

  const applySelection = (slot: Slot, playerIndex: number, add: boolean) => {
    const salary = Math.max(0, safeNumber(players[playerIndex].salary, 0));
    const projection = Math.max(0, safeNumber(players[playerIndex].projection, 0));
    if (add) {
      slotToPlayer.set(slot, playerIndex);
      usedPlayers.add(playerIndex);
      totalSalary += salary;
      totalProjection += projection;
    } else {
      slotToPlayer.delete(slot);
      usedPlayers.delete(playerIndex);
      totalSalary -= salary;
      totalProjection -= projection;
    }
  };

  const forcedIndexes = Array.from(forceInclude).filter((idx) => !forceExclude.has(idx));
  forcedIndexes.sort((a, b) => {
    const aSlots = DK_SLOTS.filter((slot) => canFitDK(players[a], slot)).length;
    const bSlots = DK_SLOTS.filter((slot) => canFitDK(players[b], slot)).length;
    return aSlots - bSlots;
  });

  const fillOpenSlots = (slotIdx: number): boolean => {
    nodeVisits += 1;
    if (nodeVisits > maxNodeVisits) return false;

    if (slotIdx >= DK_SLOTS.length) {
      const selectedIndexes = DK_SLOTS.map((slot) => slotToPlayer.get(slot)).filter((idx): idx is number => idx !== undefined);
      if (selectedIndexes.length !== DK_SLOTS.length) return false;
      if (totalSalary > config.salaryCap) return false;
      if (totalSalary < config.salaryFloor) return false;
      if (totalProjection < projectionFloor) return false;
      if (previousSignatures.has(buildLineupSignature(selectedIndexes))) return false;
      if (statRules.length > 0) {
        const statCheck = evaluateStatConstraintRules(selectedIndexes, statRules);
        if (!statCheck.ok) return false;
      }
      chosen = true;
      return true;
    }

    const slot = DK_SLOTS[slotIdx];
    if (slotToPlayer.has(slot)) return fillOpenSlots(slotIdx + 1);

    for (const playerIndex of rotated) {
      if (usedPlayers.has(playerIndex)) continue;
      if (!canFitDK(players[playerIndex], slot)) continue;
      const nextSalary = totalSalary + Math.max(0, safeNumber(players[playerIndex].salary, 0));
      if (nextSalary > config.salaryCap) continue;

      applySelection(slot, playerIndex, true);
      if (fillOpenSlots(slotIdx + 1)) return true;
      applySelection(slot, playerIndex, false);
    }

    return false;
  };

  const placeForcedPlayers = (idx: number): boolean => {
    if (idx >= forcedIndexes.length) return fillOpenSlots(0);
    const playerIndex = forcedIndexes[idx];
    const eligibleSlots = DK_SLOTS.filter((slot) => !slotToPlayer.has(slot) && canFitDK(players[playerIndex], slot));

    for (const slot of eligibleSlots) {
      const nextSalary = totalSalary + Math.max(0, safeNumber(players[playerIndex].salary, 0));
      if (nextSalary > config.salaryCap) continue;
      applySelection(slot, playerIndex, true);
      if (placeForcedPlayers(idx + 1)) return true;
      applySelection(slot, playerIndex, false);
    }

    return false;
  };

  const ok = placeForcedPlayers(0);
  if (!ok || !chosen) return null;

  const selectedIndexes = DK_SLOTS.map((slot) => slotToPlayer.get(slot)).filter((idx): idx is number => idx !== undefined);
  if (selectedIndexes.length !== DK_SLOTS.length) return null;
  return {
    lineup: buildLineupFromIndexes(players, selectedIndexes, lineupIndex),
    selectedIndexes,
  };
};

const solveLineupFallback = (context: BuildContext): { lineup: Lineup; selectedIndexes: number[] } | null => {
  const { players, config } = context;
  const priorityScore = players.map((player) => Math.max(0, getPriorityScore(player, config)));
  return searchFallbackLineup(context, priorityScore, 0);
};

const solveLineup = async (context: BuildContext): Promise<SolveLineupResult> => {
  const { players, config } = context;
  const floorModel = buildBaseModel(context);
  setObjectiveProjectionFirst(floorModel, players, config);
  const phase1Result = await solveLp(floorModel);
  let bestProjectionSum: number | null = null;
  if (phase1Result.values.size > 0) {
    const selectedPlayerIndexes = new Set<number>();
    floorModel.assignmentVars.forEach((variable) => {
      const value = safeNumber(phase1Result.values.get(variable.name), 0);
      if (value > 0.5) selectedPlayerIndexes.add(variable.playerIndex);
    });
    if (selectedPlayerIndexes.size > 0) {
      bestProjectionSum = Array.from(selectedPlayerIndexes).reduce(
        (sum, idx) => sum + Math.max(0, safeNumber(players[idx]?.projection, 0)),
        0,
      );
    }
  }

  const baseModel = buildBaseModel(context);
  setObjectiveByPriority(baseModel, players, config);
  const stackMinPlayers = Math.max(
    0,
    Math.floor(safeNumber(config.stackMinPlayers ?? (config as any).stack_min_players, 0)),
  );
  if (stackMinPlayers >= 2) {
    const stackMinGameTotal = Math.max(
      0,
      safeNumber(config.stackMinGameTotal ?? (config as any).stack_min_game_total, 215),
    );
    addGameStackConstraint(
      baseModel,
      players,
      stackMinPlayers,
      stackMinGameTotal,
      context.lineupIndex,
      config.numLineups,
      (config as any).bringBackEnable ?? true,
      clamp(safeNumber((config as any).bringBackRate, 0.65), 0, 1),
      Math.max(1, Math.floor(safeNumber((config as any).maxStackGames, 3))),
    );
  }
  if (
    bestProjectionSum !== null
    && Number.isFinite(bestProjectionSum)
    && bestProjectionSum > 0
  ) {
    const delta = Math.max(
      0,
      safeNumber(config.deltaFromBestProjection ?? config.delta_from_best_projection, 8),
    );
    if (delta > 0) {
      const projectionFloor = Math.max(0, bestProjectionSum - delta);
      addProjectionFloorConstraint(baseModel, players, projectionFloor);
    }
  }

  const phase2Result = await solveLp(baseModel);
  const solved = decodeLineup(phase2Result, baseModel, players, context.lineupIndex);
  const phase1Status = String(phase1Result.status || 'Unknown');
  const phase2Status = String(phase2Result.status || 'Unknown');
  const infeasibilityInfo = isInfeasibleStatus(phase2Status)
    ? 'Phase 2 infeasible; active constraints snapshot attached.'
    : undefined;

  return {
    solved,
    diagnostics: {
      phase1Status,
      phase2Status,
      objectiveValuePhase1: finiteOrNull(phase1Result.objectiveValue),
      objectiveValuePhase2: finiteOrNull(phase2Result.objectiveValue),
      phase1ProjectionSum: finiteOrNull(bestProjectionSum ?? Number.NaN),
      phase1Constraints: snapshotConstraints(floorModel),
      phase2Constraints: snapshotConstraints(baseModel),
      bindingConstraints: getBindingConstraints(baseModel, phase2Result),
      ...(infeasibilityInfo ? { infeasibilityInfo } : {}),
    },
  };
};

const buildLineups = async (payload: RequestPayload): Promise<Lineup[]> => {
  const players = Array.isArray(payload.players) ? payload.players : [];
  const config = withDefaultConfig(payload.config);
  const statSettings = getStatConstraintSettings(config);
  const enableDiagnostics = config.enableDiagnostics === true;
  const forceFallback = config.forceFallback === true || config.force_fallback === true;
  const deltaFromBestProjection = Math.max(
    0,
    safeNumber(config.deltaFromBestProjection ?? config.delta_from_best_projection, 8),
  );
  const diagnosticsState = {
    nSolvedILP: 0,
    nSolvedFallback: 0,
    phase2InfeasibleCount: 0,
    projectionTotal: 0,
    salaryTotal: 0,
    maxProjectionSum: 0,
    nIlpAttempts: 0,
  };
  let runSummaryEmitted = false;

  const emitRunSummary = (lineupsBuilt: number) => {
    if (!enableDiagnostics || runSummaryEmitted) return;
    runSummaryEmitted = true;
    const denom = Math.max(1, lineupsBuilt);
    const ilpDenom = Math.max(1, diagnosticsState.nIlpAttempts);
    const summary: RunDiagnosticsPayload = {
      nRequested: config.numLineups,
      nSolvedILP: diagnosticsState.nSolvedILP,
      nSolvedFallback: diagnosticsState.nSolvedFallback,
      phase2InfeasibleCount: diagnosticsState.phase2InfeasibleCount,
      avgProjectionSum: Number((diagnosticsState.projectionTotal / denom).toFixed(4)),
      maxProjectionSum: Number(diagnosticsState.maxProjectionSum.toFixed(4)),
      avgSalarySum: Number((diagnosticsState.salaryTotal / denom).toFixed(4)),
      phase1SuccessRate: Number((diagnosticsState.nSolvedILP / ilpDenom).toFixed(4)),
      phase2InfeasibleRate: Number((diagnosticsState.phase2InfeasibleCount / ilpDenom).toFixed(4)),
      fallbackUsageRate: Number((diagnosticsState.nSolvedFallback / denom).toFixed(4)),
    };
    workerScope.postMessage({ type: 'diagnostics_summary', diagnostics: summary });
  };

  if (players.length < DK_SLOTS.length) {
    emitRunSummary(0);
    throw new Error('Optimizer pool too small after filters.');
  }

  for (const slot of DK_SLOTS) {
    if (!players.some((player) => canFitDK(player, slot))) {
      emitRunSummary(0);
      throw new Error(`No eligible players for ${slot}.`);
    }
  }

  if (config.enableRuleBoosts) {
    computeRuleFlags(players, config);
  }

  const statMode = String(config.statConstraintMode ?? config.mode ?? 'gpp').toLowerCase();
  const isCash = statMode === 'cash';

  // Cash pre-filter: annotate cashAdjustedProj and mark unavailable players as excluded.
  if (isCash) {
    const posFloors: Record<string, number> = (config as any).cashPositionFloors ?? CASH_POSITION_FLOORS_DEFAULT;
    const cashMinGameTotal = safeNumber((config as any).cashMinGameTotal, 220);

    players.forEach((player) => {
      // Always annotate locked players so objectives use consistent score.
      if ((player as any).optimizerLocked) {
        (player as any).cashAdjustedProj = getCashAdjustedProjection(player);
        return;
      }
      // Skip players already excluded by the frontend.
      if ((player as any).optimizerExcluded || (player as any).excluded) return;

      // Status filter: exclude GTD / Q / D / Out.
      const status = getPlayerStatusRaw(player);
      if (isCashUnavailableStatus(status)) {
        (player as any).optimizerExcluded = true;
        return;
      }

      // Game total filter: exclude players from low-total games.
      const gameTotal = getGameTotalMaybe(player);
      if (gameTotal !== undefined && gameTotal < cashMinGameTotal) {
        (player as any).optimizerExcluded = true;
        return;
      }

      // Annotate cash-adjusted projection.
      (player as any).cashAdjustedProj = getCashAdjustedProjection(player);

      // Positional floor filter: compare raw consensus projection against the per-position
      // minimum threshold (e.g. PG:28).  Using cashAdjustedProj here would exclude too many
      // players when no floor data is available (adjProj ≈ proj × 0.88 < threshold).
      const consensusProj = getConsensusProjection(player);
      const positions = parsePositions(player.position);
      const slots: string[] = positions.length > 0 ? positions : ['UTIL'];
      const minFloor = slots.reduce((min, pos) => {
        const floor = posFloors[pos] ?? posFloors['UTIL'] ?? 24;
        return Math.min(min, floor);
      }, Infinity);
      if (consensusProj < minFloor) {
        (player as any).optimizerExcluded = true;
      }
    });

    // Safety check: if the cash pre-filter eliminated all eligible players for any
    // required DK slot, re-enable the highest-projecting excluded player(s) for that
    // slot so the optimizer can still build a valid lineup.
    for (const slot of DK_SLOTS) {
      const hasEligible = players.some(
        (p) => !Boolean((p as any).optimizerExcluded || (p as any).excluded) && canFitDK(p, slot),
      );
      if (!hasEligible) {
        // Find the best excluded (non-locked, non-frontend-excluded) candidate for this slot.
        const candidates = players
          .filter(
            (p) =>
              Boolean((p as any).optimizerExcluded) &&
              !Boolean((p as any).excluded) &&
              !Boolean((p as any).optimizerLocked) &&
              canFitDK(p, slot),
          )
          .sort((a, b) => Math.max(0, safeNumber(b.projection, 0)) - Math.max(0, safeNumber(a.projection, 0)));
        // Re-enable the top candidate so the slot can be filled.
        if (candidates.length > 0) {
          delete (candidates[0] as any).optimizerExcluded;
          (candidates[0] as any).cashAdjustedProj = getCashAdjustedProjection(candidates[0]);
        }
      }
    }
  }

  const lineups: Lineup[] = [];
  const previousLineups: number[][] = [];
  const exposureCounts = new Array<number>(players.length).fill(0);
  const { minRequiredByPlayer, maxAllowedByPlayer } = buildExposureLimits(
    players,
    config.numLineups,
    isCash ? safeNumber((config as any).cashMaxExposurePct, 65) : undefined,
  );
  let attempts = 0;
  const maxAttempts = Math.max(config.numLineups * 8, 80);
  let lastSolveError = '';
  let noSolutionStreak = 0;
  const maxNoSolutionStreak = 4;
  const defaultSolveDiagnostics: SolveLineupDiagnostics = {
    phase1Status: 'not_run',
    phase2Status: 'not_run',
    objectiveValuePhase1: null,
    objectiveValuePhase2: null,
    phase1ProjectionSum: null,
    phase1Constraints: [],
    phase2Constraints: [],
    bindingConstraints: [],
  };

  while (lineups.length < config.numLineups && attempts < maxAttempts) {
    attempts += 1;
    const lineupIndex = lineups.length;
    const exposureStep = getExposureStepForLineup(
      players,
      exposureCounts,
      minRequiredByPlayer,
      maxAllowedByPlayer,
      lineupIndex,
      config.numLineups,
    );
    const context: BuildContext = {
      players,
      config,
      lineupIndex,
      previousLineups,
      statSettings,
      forcedExposureInclude: exposureStep.forceInclude,
      forcedExposureExclude: exposureStep.forceExclude,
    };
    const remainingIncludingCurrent = config.numLineups - lineupIndex;
    const exposureConstraintsSummary: ExposureConstraintsSummary = {
      forcedIncludeCount: exposureStep.forceInclude.size,
      forcedExcludeCount: exposureStep.forceExclude.size,
      playersAtMaxCount: players.reduce((sum, _player, idx) => {
        const maxAllowed = maxAllowedByPlayer[idx] ?? config.numLineups;
        return sum + ((exposureCounts[idx] || 0) >= maxAllowed ? 1 : 0);
      }, 0),
      playersWithMinCount: minRequiredByPlayer.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0),
      remainingIncludingCurrent,
    };

    let solved: { lineup: Lineup; selectedIndexes: number[] } | null = null;
    let solveDiagnostics = defaultSolveDiagnostics;
    let usedFallback = forceFallback;
    if (!forceFallback) {
      try {
        diagnosticsState.nIlpAttempts += 1;
        const solveResult = await solveLineup(context);
        solveDiagnostics = solveResult.diagnostics;
        solved = solveResult.solved;
        if (isInfeasibleStatus(solveDiagnostics.phase2Status)) {
          diagnosticsState.phase2InfeasibleCount += 1;
        }
      } catch (error) {
        lastSolveError = error instanceof Error ? error.message : String(error);
        solveDiagnostics = {
          ...defaultSolveDiagnostics,
          phase1Status: 'error',
          phase2Status: 'error',
          infeasibilityInfo: lastSolveError,
        };
        solved = null;
      }
    } else {
      solveDiagnostics = {
        ...defaultSolveDiagnostics,
        phase1Status: 'skipped_force_fallback',
        phase2Status: 'skipped_force_fallback',
      };
    }
    if (!solved) {
      solved = solveLineupFallback(context);
      if (solved) usedFallback = true;
    }
    if (!solved) {
      noSolutionStreak += 1;
      if (!lastSolveError) {
        lastSolveError = 'No additional feasible unique lineups found under current pool/exposure constraints.';
      }
      if (noSolutionStreak >= maxNoSolutionStreak) {
        break;
      }
      continue;
    }
    noSolutionStreak = 0;
    if (usedFallback) diagnosticsState.nSolvedFallback += 1;
    else diagnosticsState.nSolvedILP += 1;
    const duplicateConstraintActive = previousLineups.length > 0;

    lineups.push(solved.lineup);
    previousLineups.push([...solved.selectedIndexes]);
    solved.selectedIndexes.forEach((idx) => {
      exposureCounts[idx] = (exposureCounts[idx] || 0) + 1;
    });
    const projectionSumRaw = solved.selectedIndexes.reduce(
      (sum, idx) => sum + Math.max(0, safeNumber(players[idx]?.projection, 0)),
      0,
    );
    const salarySumRaw = solved.selectedIndexes.reduce(
      (sum, idx) => sum + Math.max(0, safeNumber(players[idx]?.salary, 0)),
      0,
    );
    const projectionSum = Number(projectionSumRaw.toFixed(4));
    const salarySum = Number(salarySumRaw.toFixed(4));
    diagnosticsState.projectionTotal += projectionSum;
    diagnosticsState.salaryTotal += salarySum;
    diagnosticsState.maxProjectionSum = Math.max(diagnosticsState.maxProjectionSum, projectionSum);

    if (enableDiagnostics) {
      const uniquePlayersOk =
        solved.selectedIndexes.length === DK_SLOTS.length
        && new Set(solved.selectedIndexes).size === DK_SLOTS.length;
      const diagnosticsPayload: LineupDiagnosticsPayload = {
        lineupIndex,
        phase1Status: solveDiagnostics.phase1Status,
        phase2Status: solveDiagnostics.phase2Status,
        usedFallback,
        objectiveValuePhase1: solveDiagnostics.objectiveValuePhase1,
        objectiveValuePhase2: solveDiagnostics.objectiveValuePhase2,
        phase1ProjectionSum: solveDiagnostics.phase1ProjectionSum,
        projectionSum,
        salarySum,
        uniquePlayersOk,
        exposureConstraintsSummary,
        duplicateConstraintActive,
        deltaFromBestProjection,
        phase1Constraints: solveDiagnostics.phase1Constraints,
        phase2Constraints: solveDiagnostics.phase2Constraints,
        bindingConstraints: solveDiagnostics.bindingConstraints,
        ...(solveDiagnostics.infeasibilityInfo ? { infeasibilityInfo: solveDiagnostics.infeasibilityInfo } : {}),
      };
      workerScope.postMessage({ type: 'diagnostics_lineup', diagnostics: diagnosticsPayload });
    }

    workerScope.postMessage({
      type: 'progress',
      progress: Math.round(((lineupIndex + 1) / config.numLineups) * 100),
      currentBest: solved.lineup,
      lineupsFound: lineups.length,
    });
  }

  if (lineups.length === 0 && lastSolveError) {
    emitRunSummary(lineups.length);
    throw new Error(lastSolveError);
  }

  if (lineups.length < config.numLineups) {
    const unmetMinExposure = players
      .map((player, idx) => ({
        name: player.name,
        got: exposureCounts[idx] || 0,
        required: minRequiredByPlayer[idx] || 0,
      }))
      .filter((item) => item.required > 0 && item.got < item.required)
      .slice(0, 5);

    if (unmetMinExposure.length > 0) {
      emitRunSummary(lineups.length);
      throw new Error(
        `Unable to satisfy min exposures with current constraints (${lineups.length}/${config.numLineups} lineups). ` +
          unmetMinExposure.map((item) => `${item.name} ${item.got}/${item.required}`).join('; '),
      );
    }
  }

  emitRunSummary(lineups.length);
  return lineups;
};

workerScope.onmessage = async (event: MessageEvent<RequestPayload>) => {
  try {
    const lineups = await buildLineups(event.data || { players: [] });
    workerScope.postMessage({ type: 'result', lineups });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown optimization error',
    });
  }
};

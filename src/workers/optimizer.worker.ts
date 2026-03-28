import { Lineup, Player } from '../../types';

const DK_SLOTS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] as const;
type DkSlot = (typeof DK_SLOTS)[number];

const workerScope = self as any;

// ---- Type Definitions ----

interface PlayerWithMetrics extends Player {
  dvp_rank?: number;
  value_score?: number;
  ceiling_final?: number;
  ceiling_gap_adjusted?: number;
  minutes_multiplier?: number;
  promoted_starter?: boolean;
  game_id?: string;
  tier?: 'elite' | 'mid_range' | 'value' | 'punt';
  own_mean?: number;
  minutes_proj?: number;
}

interface GeneratorConfig {
  n_lineups: number;
  global_max_exposure_pct: number;
  min_hamming_distance: number;
  qiea_generations: number;
  qiea_population: number;
  chalk_threshold_own: number;
  chalk_threshold_proj: number;
  leverage_ceiling_gap_min: number;
  leverage_value_score_min: number;
  filler_value_score_min: number;
  max_anchor_appearances: number;
  max_leverage_appearances: number;
  max_filler_appearances: number;
  salary_cap: number;
  salary_floor: number;
  required_positions: Record<DkSlot, number>;
  // ILP-specific
  contest_type: 'cash' | 'gpp';
  randomization_base_pct: number;
  randomization_ramp: boolean;
  ceiling_weight: number;
  ownership_penalty_weight: number;
  enforce_game_stack: boolean;
  min_game_stack_size: number;
}

interface ExposureBound {
  min: number;
  max: number;
}

interface ConfirmedLineupInfo {
  status?: string;
  minutes_projected?: number;
  depth_rank?: number;
}

interface RequestPayload {
  players: Player[];
  config?: Record<string, unknown>;
  exposures?:
    | Map<string, { min?: number; max?: number }>
    | Array<[string, { min?: number; max?: number }]>
    | Record<string, { min?: number; max?: number }>;
  locks?: Set<string> | string[];
  excludes?: Set<string> | string[];
  confirmedLineups?:
    | Map<string, ConfirmedLineupInfo>
    | Array<[string, ConfirmedLineupInfo]>
    | Record<string, ConfirmedLineupInfo>;
}

// ---- Default Config ----

const DEFAULT_CONFIG: GeneratorConfig = {
  n_lineups: 20,
  global_max_exposure_pct: 100,
  min_hamming_distance: 2,
  qiea_generations: 80,
  qiea_population: 80,
  chalk_threshold_own: 15,
  chalk_threshold_proj: 45,
  leverage_ceiling_gap_min: 10,
  leverage_value_score_min: 45,
  filler_value_score_min: 30,
  max_anchor_appearances: 10,
  max_leverage_appearances: 5,
  max_filler_appearances: 3,
  salary_cap: 50000,
  salary_floor: 0,
  required_positions: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 1 },
  // ILP defaults
  contest_type: 'gpp',
  randomization_base_pct: 0.08,
  randomization_ramp: true,
  ceiling_weight: 0.4,
  ownership_penalty_weight: 0.15,
  enforce_game_stack: false,
  min_game_stack_size: 2,
};

// ---- Utility Functions ----

const clamp = (val: number, min: number, max: number): number => Math.min(max, Math.max(min, val));

const safeNumber = (val: unknown, fallback = 0): number => {
  const num = Number(val);
  return Number.isFinite(num) ? num : fallback;
};

const linearScale = (val: number, minVal: number, maxVal: number): number => {
  if (!Number.isFinite(val) || maxVal <= minVal) return 0;
  return clamp(((val - minVal) / (maxVal - minVal)) * 100, 0, 100);
};

const normalizeOwnership = (val: number): number => {
  if (!Number.isFinite(val)) return 0;
  if (val <= 1) return clamp(val * 100, 0, 100);
  return clamp(val, 0, 100);
};

const getNumeric = (player: Player, keys: string[], fallback = 0): number => {
  for (const key of keys) {
    const raw = (player as any)?.[key];
    if (raw === undefined || raw === null || raw === '') continue;
    const parsed = Number(typeof raw === 'string' ? raw.replace('%', '') : raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const getStatus = (player: Player): string => String((player as any)?.status || '').toLowerCase();

const getOwnership = (player: Player): number => {
  const raw = getNumeric(player, ['OWN_MEAN', 'ownership', 'projectedOwnership', 'projOwnership', 'own'], 0);
  return normalizeOwnership(raw);
};

const getMinutesProjection = (player: Player): number => {
  return getNumeric(player, ['minutesProjection', 'MINUTES_PROJ', 'minutes_proj', 'proj_minutes'], 0);
};

const getCeiling = (player: Player): number => {
  const projected = safeNumber(player.projection, 0);
  return getNumeric(
    player,
    ['ceiling', 'ceilingProjection', 'ceilingProj', 'projectedCeiling', 'fptsCeiling', 'dkCeiling'],
    projected,
  );
};

const parsePositions = (position: string): string[] => {
  const raw = String(position || '').toUpperCase();
  const tokens = raw
    .split(/[^A-Z]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const normalized = new Set<string>();

  tokens.forEach((tok) => {
    if (['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'].includes(tok)) {
      normalized.add(tok);
    }
  });

  // Fallback for malformed combined strings (e.g. "PGSG", "PFG")
  if (normalized.size === 0) {
    if (raw.includes('PG')) normalized.add('PG');
    if (raw.includes('SG')) normalized.add('SG');
    if (raw.includes('SF')) normalized.add('SF');
    if (raw.includes('PF')) normalized.add('PF');
    if (raw.includes('C')) normalized.add('C');
    if (raw === 'G') normalized.add('G');
    if (raw === 'F') normalized.add('F');
  }

  return Array.from(normalized);
};

const getEligibleSlots = (position: string): DkSlot[] => {
  const pos = parsePositions(position);
  const slots = new Set<DkSlot>();
  if (pos.includes('PG')) {
    slots.add('PG');
    slots.add('G');
    slots.add('UTIL');
  }
  if (pos.includes('SG')) {
    slots.add('SG');
    slots.add('G');
    slots.add('UTIL');
  }
  if (pos.includes('SF')) {
    slots.add('SF');
    slots.add('F');
    slots.add('UTIL');
  }
  if (pos.includes('PF')) {
    slots.add('PF');
    slots.add('F');
    slots.add('UTIL');
  }
  if (pos.includes('C')) {
    slots.add('C');
    slots.add('UTIL');
  }
  if (pos.includes('G')) {
    slots.add('G');
    slots.add('UTIL');
  }
  if (pos.includes('F')) {
    slots.add('F');
    slots.add('UTIL');
  }
  if (slots.size === 0) slots.add('UTIL');
  return Array.from(slots);
};

const canAssignDraftKingsSlots = (lineup: PlayerWithMetrics[]): boolean => {
  if (lineup.length !== DK_SLOTS.length) return false;

  const slotOrder = [...DK_SLOTS].sort((a, b) => {
    const aCount = lineup.filter((p) => getEligibleSlots(p.position).includes(a)).length;
    const bCount = lineup.filter((p) => getEligibleSlots(p.position).includes(b)).length;
    return aCount - bCount;
  });

  const used = new Set<number>();

  const dfs = (slotIndex: number): boolean => {
    if (slotIndex >= slotOrder.length) return true;
    const slot = slotOrder[slotIndex];

    for (let i = 0; i < lineup.length; i++) {
      if (used.has(i)) continue;
      if (!getEligibleSlots(lineup[i].position).includes(slot)) continue;
      used.add(i);
      if (dfs(slotIndex + 1)) return true;
      used.delete(i);
    }

    return false;
  };

  return dfs(0);
};

const getSalaryTier = (salary: number): PlayerWithMetrics['tier'] => {
  if (salary >= 9000) return 'elite';
  if (salary >= 5000) return 'mid_range';
  if (salary >= 3500) return 'value';
  return 'punt';
};

const normalizeDvpDiffToRank = (dvpDiff: number): number => {
  const clamped = clamp(dvpDiff, -5, 5);
  const rank = 15 - clamped * 3;
  return Math.round(clamp(rank, 1, 30));
};

const calculateMinuteMultiplier = (projMin: number, confirmedMin: number, isPromoted: boolean): number => {
  if (projMin <= 0 || confirmedMin <= 0) return 1;

  const rawMultiplier = confirmedMin / projMin;

  if (isPromoted && rawMultiplier >= 1.8) {
    return Math.min(1.8, rawMultiplier * 0.95);
  }
  if (isPromoted && rawMultiplier >= 1.3) {
    return Math.min(1.6, rawMultiplier * 0.9);
  }
  if (rawMultiplier > 1.1) {
    return Math.min(1.2, rawMultiplier * 0.85);
  }
  return 1;
};

const extractGameId = (player: Player): string => {
  const team = String(player.team || 'UNK').toUpperCase().trim();
  const opp = String(player.opponent || 'UNK').toUpperCase().trim();
  return [team, opp].sort().join('_vs_');
};

const calculateValueScore = (player: PlayerWithMetrics, dvpRank: number): number => {
  const salary = Math.max(1, safeNumber(player.salary, 0));
  const projection = Math.max(0, safeNumber(player.projection, 0));
  const ceiling = Math.max(projection, safeNumber(player.ceiling, projection));
  const ownership = getOwnership(player);

  const tierWeights: Record<NonNullable<PlayerWithMetrics['tier']>, Record<string, number>> = {
    elite: { value: 0.15, dvp: 0.15, form: 0.25, ceiling: 0.25, ownership: 0.1, vegas: 0.1 },
    mid_range: { value: 0.25, dvp: 0.25, form: 0.25, ceiling: 0.1, ownership: 0.05, vegas: 0.1 },
    value: { value: 0.35, dvp: 0.2, form: 0.2, ceiling: 0.1, ownership: 0.05, vegas: 0.1 },
    punt: { value: 0.4, dvp: 0.15, form: 0.2, ceiling: 0.1, ownership: 0.1, vegas: 0.05 },
  };

  const tier = getSalaryTier(salary);
  const weights = tierWeights[tier];

  const valueSub = linearScale(projection / (salary / 1000), 3, 7.5);
  const dvpSub = clamp(((30 - dvpRank) / 29) * 100, 0, 100);
  const formSub = 50;
  const ceilingSub = projection > 0 ? linearScale(ceiling / projection, 1, 2) : 50;
  const ownershipSub = clamp(((50 - ownership) / 50) * 100, 0, 100);
  const vegasSub = 50;

  const weighted =
    valueSub * weights.value +
    dvpSub * weights.dvp +
    formSub * weights.form +
    ceilingSub * weights.ceiling +
    ownershipSub * weights.ownership +
    vegasSub * weights.vegas;

  const totalWeight = Object.values(weights).reduce((sum, n) => sum + n, 0);
  return clamp(weighted / totalWeight, 0, 100);
};

// ---- Parsing Helpers ----

const toStringSet = (input: unknown): Set<string> => {
  if (!input) return new Set<string>();
  if (input instanceof Set) return new Set(Array.from(input).map((x) => String(x)));
  if (Array.isArray(input)) return new Set(input.map((x) => String(x)));
  return new Set<string>();
};

const parseOptionalNumber = (val: unknown): number | undefined => {
  if (val === undefined || val === null || val === '') return undefined;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toExposureMap = (
  input: RequestPayload['exposures'],
): Map<string, { min?: number; max?: number }> => {
  if (!input) return new Map();
  if (input instanceof Map) return new Map(input);
  if (Array.isArray(input)) return new Map(input);
  if (typeof input === 'object') {
    return new Map(
      Object.entries(input).map(([k, v]) => [
        String(k),
        {
          min: parseOptionalNumber((v as any)?.min),
          max: parseOptionalNumber((v as any)?.max),
        },
      ]),
    );
  }
  return new Map();
};

const toConfirmedLineups = (input: RequestPayload['confirmedLineups']): Map<string, ConfirmedLineupInfo> => {
  if (!input) return new Map();
  if (input instanceof Map) return new Map(input);
  if (Array.isArray(input)) return new Map(input);
  if (typeof input === 'object') {
    return new Map(Object.entries(input).map(([k, v]) => [String(k), (v || {}) as ConfirmedLineupInfo]));
  }
  return new Map();
};

const percentageToCount = (value: number, total: number, roundMode: 'min' | 'max'): number => {
  if (!Number.isFinite(value)) return roundMode === 'min' ? 0 : total;

  let pct = value;
  if (pct > 0 && pct <= 1) {
    pct = pct * 100;
  }
  pct = clamp(pct, 0, 100);

  const raw = (pct / 100) * total;
  return roundMode === 'min' ? Math.ceil(raw - 1e-9) : Math.floor(raw + 1e-9);
};

// ---- Config Resolution ----

const resolveGeneratorConfig = (raw?: Record<string, unknown>): GeneratorConfig => {
  const nLineups = Math.max(
    1,
    Math.floor(
      safeNumber(
        raw?.n_lineups ?? raw?.numLineups ?? raw?.nLineups,
        DEFAULT_CONFIG.n_lineups,
      ),
    ),
  );

  const minHamming = Math.max(
    1,
    Math.floor(
      safeNumber(
        raw?.min_hamming_distance ?? raw?.minHamming ?? raw?.min_hamming,
        DEFAULT_CONFIG.min_hamming_distance,
      ),
    ),
  );
  const qieaGenerations = Math.max(
    10,
    Math.floor(
      safeNumber(
        raw?.qiea_generations ?? raw?.qieaGenerations ?? raw?.generations,
        DEFAULT_CONFIG.qiea_generations,
      ),
    ),
  );
  const qieaPopulation = Math.max(
    10,
    Math.floor(
      safeNumber(
        raw?.qiea_population ?? raw?.qieaPopulation ?? raw?.population,
        DEFAULT_CONFIG.qiea_population,
      ),
    ),
  );

  const salaryCap = Math.max(
    1000,
    Math.floor(safeNumber(raw?.salary_cap ?? raw?.salaryCap, DEFAULT_CONFIG.salary_cap)),
  );

  const salaryFloorRaw = safeNumber(raw?.salary_floor ?? raw?.salaryFloor, DEFAULT_CONFIG.salary_floor);
  const salaryFloor = Math.max(0, Math.min(salaryCap, Math.floor(salaryFloorRaw)));

  const maxAnchor = Math.max(
    1,
    Math.floor(
      safeNumber(raw?.max_anchor_appearances, Math.max(DEFAULT_CONFIG.max_anchor_appearances, Math.ceil(nLineups * 0.5))),
    ),
  );
  const maxLeverage = Math.max(
    1,
    Math.floor(
      safeNumber(raw?.max_leverage_appearances, Math.max(DEFAULT_CONFIG.max_leverage_appearances, Math.ceil(nLineups * 0.25))),
    ),
  );
  const maxFiller = Math.max(
    1,
    Math.floor(
      safeNumber(raw?.max_filler_appearances, Math.max(DEFAULT_CONFIG.max_filler_appearances, Math.ceil(nLineups * 0.15))),
    ),
  );

  const contestType =
    String(raw?.contest_type ?? 'gpp').toLowerCase() === 'cash' ? 'cash' : 'gpp';

  return {
    ...DEFAULT_CONFIG,
    n_lineups: nLineups,
    global_max_exposure_pct: clamp(
      safeNumber(raw?.global_max_exposure_pct, DEFAULT_CONFIG.global_max_exposure_pct),
      0,
      100,
    ),
    min_hamming_distance: minHamming,
    qiea_generations: qieaGenerations,
    qiea_population: qieaPopulation,
    salary_cap: salaryCap,
    salary_floor: salaryFloor,
    chalk_threshold_own: safeNumber(raw?.chalk_threshold_own, DEFAULT_CONFIG.chalk_threshold_own),
    chalk_threshold_proj: safeNumber(raw?.chalk_threshold_proj, DEFAULT_CONFIG.chalk_threshold_proj),
    leverage_ceiling_gap_min: safeNumber(raw?.leverage_ceiling_gap_min, DEFAULT_CONFIG.leverage_ceiling_gap_min),
    leverage_value_score_min: safeNumber(raw?.leverage_value_score_min, DEFAULT_CONFIG.leverage_value_score_min),
    filler_value_score_min: safeNumber(raw?.filler_value_score_min, DEFAULT_CONFIG.filler_value_score_min),
    max_anchor_appearances: maxAnchor,
    max_leverage_appearances: maxLeverage,
    max_filler_appearances: maxFiller,
    contest_type: contestType,
    randomization_base_pct: clamp(
      safeNumber(raw?.randomization_base_pct, DEFAULT_CONFIG.randomization_base_pct),
      0,
      1,
    ),
    randomization_ramp: raw?.randomization_ramp !== false,
    ceiling_weight: clamp(safeNumber(raw?.ceiling_weight, DEFAULT_CONFIG.ceiling_weight), 0, 1),
    ownership_penalty_weight: clamp(
      safeNumber(raw?.ownership_penalty_weight, DEFAULT_CONFIG.ownership_penalty_weight),
      0,
      1,
    ),
    enforce_game_stack: Boolean(raw?.enforce_game_stack),
    min_game_stack_size: Math.max(
      2,
      Math.floor(safeNumber(raw?.min_game_stack_size, DEFAULT_CONFIG.min_game_stack_size)),
    ),
  };
};

// ---- Exposure Bounds ----

const resolveExposureBounds = (
  players: PlayerWithMetrics[],
  targetLineups: number,
  globalMaxPct: number,
  explicitExposureMap: Map<string, { min?: number; max?: number }>,
  locks: Set<string>,
): Map<string, ExposureBound> => {
  const out = new Map<string, ExposureBound>();

  for (const player of players) {
    const explicit = explicitExposureMap.get(player.id);

    const playerMin = safeNumber((player as any)?.optimizerMinExposure, NaN);
    const playerMax = safeNumber((player as any)?.optimizerMaxExposure, NaN);

    const minPct = Number.isFinite(explicit?.min as number)
      ? (explicit?.min as number)
      : Number.isFinite(playerMin)
        ? playerMin
        : 0;

    const maxPct = Number.isFinite(explicit?.max as number)
      ? (explicit?.max as number)
      : Number.isFinite(playerMax)
        ? playerMax
        : globalMaxPct;

    if (locks.has(player.id)) {
      out.set(player.id, { min: targetLineups, max: targetLineups });
      continue;
    }

    const minCount = percentageToCount(minPct, targetLineups, 'min');
    const maxCount = Math.max(minCount, percentageToCount(maxPct, targetLineups, 'max'));

    out.set(player.id, {
      min: clamp(minCount, 0, targetLineups),
      max: clamp(maxCount, 0, targetLineups),
    });
  }

  return out;
};

// ---- Player Enrichment ----

const enrichPlayersWithMetrics = (
  players: Player[],
  confirmedLineups: Map<string, ConfirmedLineupInfo>,
): PlayerWithMetrics[] => {
  return players.map((player) => {
    const enriched: PlayerWithMetrics = { ...player };

    const dvpDiff = getNumeric(player, ['OPP_DEF_ONOFF_FP_ALLOWED_DIFF_POS', 'dvp_diff', 'dvpDiff'], 0);
    enriched.dvp_rank = normalizeDvpDiffToRank(dvpDiff);

    const ownMean = getOwnership(player);
    enriched.own_mean = ownMean;

    const minutesProjection = getMinutesProjection(player);
    enriched.minutes_proj = minutesProjection;

    enriched.tier = getSalaryTier(safeNumber(player.salary, 0));
    enriched.value_score = calculateValueScore(enriched, enriched.dvp_rank);

    const confirmed = confirmedLineups.get(player.id);
    if (confirmed) {
      const confirmedMinutes = safeNumber(confirmed.minutes_projected, minutesProjection || 20);
      const projectedMinutes = Math.max(1, minutesProjection || 20);
      const isPromoted = safeNumber(confirmed.depth_rank, 99) === 1 && ownMean > 5;

      enriched.minutes_multiplier = calculateMinuteMultiplier(projectedMinutes, confirmedMinutes, isPromoted);
      enriched.promoted_starter = isPromoted;
      enriched.ceiling_final = getCeiling(player) * enriched.minutes_multiplier;
    } else {
      enriched.minutes_multiplier = 1;
      enriched.promoted_starter = false;
      enriched.ceiling_final = getCeiling(player);
    }

    enriched.ceiling_gap_adjusted = safeNumber(enriched.ceiling_final, 0) - safeNumber(player.projection, 0);
    enriched.game_id = extractGameId(player);

    return enriched;
  });
};

// ---- Lineup Serialization ----

const toSerializableLineup = (lineup: PlayerWithMetrics[], id: string): Lineup => {
  const totalSalary = lineup.reduce((sum, p) => sum + safeNumber(p.salary, 0), 0);
  const totalProjection = lineup.reduce((sum, p) => sum + safeNumber(p.projection, 0), 0);
  const totalCeiling = lineup.reduce((sum, p) => sum + safeNumber(p.ceiling_final, p.ceiling), 0);
  const totalOwnership = lineup.reduce((sum, p) => sum + safeNumber(p.own_mean, 0), 0);

  return {
    id,
    playerIds: lineup.map((p) => p.id),
    totalSalary,
    totalProjection,
    totalCeiling,
    totalOwnership,
    lineupSource: 'optimizer',
  };
};

const finalizeLineups = (lineups: PlayerWithMetrics[][]): Lineup[] => {
  return lineups.map((lineup, idx) =>
    toSerializableLineup(lineup, `gpp_${Date.now()}_${idx + 1}_${Math.random().toString(36).slice(2, 7)}`),
  );
};

// ---- ILP Solver Functions ----

/** Box-Muller transform: standard normal sample, safe for web workers (no crypto). */
function boxMullerGaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Returns the randomization fraction for iteration `iter`.
 * Lineup 0 is always the true deterministic optimal (0%).
 * Subsequent lineups ramp up for portfolio diversity.
 */
function getRandomizationPct(iter: number, config: GeneratorConfig): number {
  if (iter === 0) return 0;
  if (!config.randomization_ramp) return config.randomization_base_pct;
  // Ramp: 2-5 at ~63%, 6-10 at 100%, 11+ at 150% of base_pct
  if (iter <= 4) return config.randomization_base_pct * 0.625;
  if (iter <= 9) return config.randomization_base_pct;
  return config.randomization_base_pct * 1.5;
}

/**
 * Computes objective coefficients for each player, applying GPP blending,
 * ownership penalty, and Gaussian noise for portfolio diversity.
 */
function computeEffectiveProjections(
  players: PlayerWithMetrics[],
  config: GeneratorConfig,
  randomizationPct: number,
): number[] {
  return players.map((p) => {
    const proj = safeNumber(p.projection, 0);
    const ceiling = safeNumber(p.ceiling_final, proj);
    const ownership = safeNumber(p.own_mean, 0);

    let base: number;
    if (config.contest_type === 'cash') {
      base = proj;
    } else {
      // GPP blend: weight projection + ceiling, penalize ownership
      const ownershipPenalty = (ownership / 100) * config.ownership_penalty_weight * proj;
      base = (1 - config.ceiling_weight) * proj + config.ceiling_weight * ceiling - ownershipPenalty;
    }

    if (randomizationPct > 0) {
      base = base * (1 + boxMullerGaussian() * randomizationPct);
    }

    return Math.max(0, base);
  });
}

/**
 * Groups player indices by position eligibility for ILP constraints.
 * G = PG ∪ SG (guard-eligible), F = SF ∪ PF (forward-eligible).
 */
function computePositionGroups(players: PlayerWithMetrics[]): Record<string, number[]> {
  const groups: Record<string, number[]> = { PG: [], SG: [], SF: [], PF: [], C: [], G: [], F: [] };
  players.forEach((p, i) => {
    const pos = parsePositions(p.position);
    if (pos.includes('PG')) { groups.PG.push(i); groups.G.push(i); }
    if (pos.includes('SG')) { groups.SG.push(i); groups.G.push(i); }
    if (pos.includes('SF')) { groups.SF.push(i); groups.F.push(i); }
    if (pos.includes('PF')) { groups.PF.push(i); groups.F.push(i); }
    if (pos.includes('C')) { groups.C.push(i); }
    groups.G = [...new Set(groups.G)];
    groups.F = [...new Set(groups.F)];
  });
  return groups;
}

/**
 * Formats a list of (coefficient, variable) pairs into an LP expression string.
 * Handles sign formatting so terms join cleanly (e.g. "3.5 x0 + 2.1 x1 - 0.5 x2").
 */
function formatLPTermTokens(coeffs: number[], varNames: string[]): string[] {
  const parts: string[] = [];
  for (let i = 0; i < coeffs.length; i++) {
    const c = coeffs[i];
    if (!Number.isFinite(c) || c === 0) continue;
    if (parts.length === 0) {
      parts.push(`${c.toFixed(6)} ${varNames[i]}`);
    } else if (c < 0) {
      parts.push(`- ${(-c).toFixed(6)} ${varNames[i]}`);
    } else {
      parts.push(`+ ${c.toFixed(6)} ${varNames[i]}`);
    }
  }
  return parts;
}

function formatUnitTermTokens(varNames: string[]): string[] {
  const parts: string[] = [];
  for (let i = 0; i < varNames.length; i++) {
    if (i === 0) parts.push(varNames[i]);
    else parts.push(`+ ${varNames[i]}`);
  }
  return parts;
}

function wrapTokens(tokens: string[], maxTokensPerLine = 20): string[] {
  if (tokens.length === 0) return ['0'];
  // Keep each expression on a single line to avoid parser edge-cases on very large slates.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void maxTokensPerLine;
  return [tokens.join(' ')];
}

function appendConstraint(
  lines: string[],
  label: string,
  tokens: string[],
  operator: '<=' | '>=' | '=',
  rhs: number,
): void {
  const wrapped = wrapTokens(tokens);
  wrapped.forEach((chunk, idx) => {
    const prefix = idx === 0 ? ` ${label}: ` : '  ';
    const suffix = idx === wrapped.length - 1 ? ` ${operator} ${rhs}` : '';
    lines.push(`${prefix}${chunk}${suffix}`);
  });
}

/**
 * Returns an LP constraint string that blocks a previously accepted lineup
 * (or any bipartite-infeasible combination) from being re-selected.
 *
 * With hammingDistance = H, forces at least H players to differ from this lineup.
 */
function buildExclusionConstraint(
  lineup: PlayerWithMetrics[],
  playerIndex: Map<string, number>,
  hammingDistance = 1,
): string {
  const terms = lineup
    .map((p) => `x${playerIndex.get(p.id)}`)
    .join(' + ');
  return `${terms} <= ${DK_SLOTS.length - hammingDistance}`;
}

/**
 * Builds the full HiGHS LP format string for a single solve iteration.
 *
 * Objective: minimize negative effective projections (= maximize projections).
 * Constraints: roster size, salary cap/floor, position group minimums,
 *              lock/exclude bounds, and all accumulated exclusion constraints.
 */
function buildLPModel(
  players: PlayerWithMetrics[],
  effectiveProjections: number[],
  config: GeneratorConfig,
  locks: Set<string>,
  excludes: Set<string>,
  exclusionConstraints: string[],
): string {
  const n = players.length;
  const varNames = players.map((_, i) => `x${i}`);
  const lines: string[] = [];

  // Objective: maximize effective projections
  lines.push('Maximize');
  const objectiveWrapped = wrapTokens(formatLPTermTokens(effectiveProjections, varNames));
  lines.push(` obj: ${objectiveWrapped[0]}`);
  objectiveWrapped.slice(1).forEach((chunk) => lines.push(`  ${chunk}`));

  lines.push('Subject To');

  // Roster size = 8
  appendConstraint(lines, 'roster', formatUnitTermTokens(varNames), '=', DK_SLOTS.length);

  // Salary cap
  const salaryCoeffs = players.map((p) => safeNumber(p.salary, 0));
  appendConstraint(lines, 'sal_max', formatLPTermTokens(salaryCoeffs, varNames), '<=', config.salary_cap);
  if (config.salary_floor > 0) {
    appendConstraint(lines, 'sal_min', formatLPTermTokens(salaryCoeffs, varNames), '>=', config.salary_floor);
  }

  // Position group constraints
  const posGroups = computePositionGroups(players);
  const posGroupMinimums: Record<string, number> = {
    PG: 1, SG: 1, SF: 1, PF: 1, C: 1,
    G: 2,  // PG slot + G slot both need guard-eligible
    F: 2,  // SF slot + F slot both need forward-eligible
  };
  for (const [groupName, minCount] of Object.entries(posGroupMinimums)) {
    const indices = posGroups[groupName];
    if (!indices || indices.length === 0) continue;
    const terms = formatUnitTermTokens(indices.map((i) => varNames[i]));
    appendConstraint(lines, `pos_${groupName}`, terms, '>=', minCount);
  }

  // Game-stack constraints (optional)
  if (config.enforce_game_stack) {
    const gameMap = new Map<string, number[]>();
    players.forEach((p, i) => {
      if (excludes.has(p.id)) return;
      const gid = (p.game_id || extractGameId(p)).replace(/[^a-zA-Z0-9]/g, '_');
      if (!gameMap.has(gid)) gameMap.set(gid, []);
      gameMap.get(gid)!.push(i);
    });

    const games = Array.from(gameMap.entries()).filter(([, idxs]) => idxs.length >= config.min_game_stack_size);
    if (games.length > 0) {
      const yNames = games.map(([gid]) => `yg_${gid}`);
      // At least one game must be stacked
      appendConstraint(lines, 'game_stack_any', formatUnitTermTokens(yNames), '>=', 1);
      // For each game: sum(x_i) >= min_stack_size * y_g
      //   Rewritten as: sum(x_i) - min_stack_size * y_g >= 0
      games.forEach(([gid, idxs], gi) => {
        const xTerms = idxs.map((i) => varNames[i]).join(' + ');
        lines.push(` gstack_${gid}: ${xTerms} - ${config.min_game_stack_size}.000000 ${yNames[gi]} >= 0`);
      });
    }
  }

  // Exclusion constraints from previous accepted lineups (and lazy cuts)
  exclusionConstraints.forEach((c, i) => {
    lines.push(` excl_${i}: ${c}`);
  });

  // Bounds: only needed for locked (fix to 1) or excluded (fix to 0) players
  const fixedBounds: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = players[i].id;
    if (excludes.has(id)) {
      fixedBounds.push(` 0 <= x${i} <= 0`);
    } else if (locks.has(id)) {
      fixedBounds.push(` 1 <= x${i} <= 1`);
    }
  }
  if (fixedBounds.length > 0) {
    lines.push('Bounds');
    fixedBounds.forEach((b) => lines.push(b));
  }

  // Binary variable declarations (all player vars are binary 0/1)
  lines.push('Binary');
  for (let i = 0; i < varNames.length; i += 40) {
    lines.push(` ${varNames.slice(i, i + 40).join(' ')}`);
  }

  // Game stack auxiliary variables are also binary
  if (config.enforce_game_stack) {
    const gameMap = new Map<string, number[]>();
    players.forEach((p, i) => {
      if (excludes.has(p.id)) return;
      const gid = (p.game_id || extractGameId(p)).replace(/[^a-zA-Z0-9]/g, '_');
      if (!gameMap.has(gid)) gameMap.set(gid, []);
      gameMap.get(gid)!.push(i);
    });
    const auxVars = Array.from(gameMap.entries())
      .filter(([, idxs]) => idxs.length >= config.min_game_stack_size)
      .map(([gid]) => `yg_${gid}`);
    if (auxVars.length > 0) {
      for (let i = 0; i < auxVars.length; i += 40) {
        lines.push(` ${auxVars.slice(i, i + 40).join(' ')}`);
      }
    }
  }

  lines.push('End');
  return lines.join('\n');
}

const sumSalary = (players: PlayerWithMetrics[]): number =>
  players.reduce((sum, p) => sum + safeNumber(p.salary, 0), 0);

const sumProjection = (players: PlayerWithMetrics[]): number =>
  players.reduce((sum, p) => sum + safeNumber(p.projection, 0), 0);

const weightedPick = <T,>(items: Array<{ item: T; weight: number }>): T => {
  const total = items.reduce((sum, row) => sum + Math.max(0, row.weight), 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)].item;
  let r = Math.random() * total;
  for (const row of items) {
    r -= Math.max(0, row.weight);
    if (r <= 0) return row.item;
  }
  return items[items.length - 1].item;
};

const overlapCount = (a: PlayerWithMetrics[], b: PlayerWithMetrics[]): number => {
  const bIds = new Set(b.map((p) => p.id));
  return a.reduce((count, p) => count + (bIds.has(p.id) ? 1 : 0), 0);
};

const findSlotAssignment = (lineup: PlayerWithMetrics[]): DkSlot[] | null => {
  const assignment: DkSlot[] = new Array(lineup.length);
  const usedSlots = new Set<DkSlot>();
  const order = lineup
    .map((p, idx) => ({ idx, eligible: getEligibleSlots(p.position) }))
    .sort((a, b) => a.eligible.length - b.eligible.length);

  const dfs = (k: number): boolean => {
    if (k >= order.length) return true;
    const row = order[k];
    for (const slot of row.eligible) {
      if (usedSlots.has(slot)) continue;
      usedSlots.add(slot);
      assignment[row.idx] = slot;
      if (dfs(k + 1)) return true;
      usedSlots.delete(slot);
    }
    return false;
  };

  return dfs(0) ? assignment : null;
};

const buildHeuristicLineup = (
  activePool: PlayerWithMetrics[],
  config: GeneratorConfig,
  lockIds: Set<string>,
  dynamicExcludes: Set<string>,
  exposureBounds: Map<string, ExposureBound>,
  appearances: Map<string, number>,
  underExposureBonus: Map<string, number>,
  accepted: PlayerWithMetrics[][],
  randPct: number,
  preferenceWeights?: Map<string, number>,
  maxAttemptsOverride?: number,
): PlayerWithMetrics[] | null => {
  const lockedPlayers = activePool.filter((p) => lockIds.has(p.id));
  if (lockedPlayers.length > DK_SLOTS.length) return null;
  const lockAssignment = findSlotAssignment(lockedPlayers);
  if (lockedPlayers.length > 0 && !lockAssignment) return null;
  const occupiedSlots = new Set<DkSlot>((lockAssignment || []).filter(Boolean));

  let best: PlayerWithMetrics[] | null = null;
  let bestScore = -Infinity;
  const attempts = Number.isFinite(maxAttemptsOverride as number)
    ? Math.max(1, Math.floor(maxAttemptsOverride as number))
    : Math.max(600, Math.min(2000, activePool.length * 6));

  const isCandidateAvailable = (p: PlayerWithMetrics, selectedIds: Set<string>): boolean => {
    if (selectedIds.has(p.id)) return false;
    if (dynamicExcludes.has(p.id) && !lockIds.has(p.id)) return false;
    const bound = exposureBounds.get(p.id);
    if (bound && (appearances.get(p.id) || 0) >= bound.max) return false;
    return true;
  };

  for (let attempt = 0; attempt < attempts; attempt++) {
    const selected: PlayerWithMetrics[] = [...lockedPlayers];
    const selectedIds = new Set(selected.map((p) => p.id));
    const remainingSlots = DK_SLOTS.filter((slot) => !occupiedSlots.has(slot));

    while (selected.length < DK_SLOTS.length && remainingSlots.length > 0) {
      const currentSalary = sumSalary(selected);
      const nextSlot = remainingSlots
        .map((slot) => {
          const count = activePool.reduce((acc, p) => {
            if (!isCandidateAvailable(p, selectedIds)) return acc;
            return acc + (getEligibleSlots(p.position).includes(slot) ? 1 : 0);
          }, 0);
          return { slot, count };
        })
        .sort((a, b) => a.count - b.count)[0]?.slot;

      if (!nextSlot) break;
      const slotsLeftAfterPick = remainingSlots.length - 1;
      const candidates = activePool.filter((p) => {
        if (!isCandidateAvailable(p, selectedIds)) return false;
        if (!getEligibleSlots(p.position).includes(nextSlot)) return false;

        const nextSalary = currentSalary + safeNumber(p.salary, 0);
        if (nextSalary > config.salary_cap) return false;

        if (slotsLeftAfterPick <= 0) {
          return nextSalary >= config.salary_floor;
        }

        const remainingSalaries = activePool
          .filter((q) => q.id !== p.id && isCandidateAvailable(q, selectedIds))
          .map((q) => safeNumber(q.salary, 0))
          .filter((s) => s > 0)
          .sort((a, b) => a - b);

        if (remainingSalaries.length < slotsLeftAfterPick) return false;
        const minRemain = remainingSalaries.slice(0, slotsLeftAfterPick).reduce((sum, s) => sum + s, 0);
        const maxRemain = remainingSalaries.slice(-slotsLeftAfterPick).reduce((sum, s) => sum + s, 0);

        if (nextSalary + minRemain > config.salary_cap) return false;
        if (nextSalary + maxRemain < config.salary_floor) return false;
        return true;
      });

      if (candidates.length === 0) break;

      const scored = candidates
        .map((p) => {
          const preference = Math.max(0.05, preferenceWeights?.get(p.id) ?? 1);
          const base = (safeNumber(p.projection, 0) + (underExposureBonus.get(p.id) || 0)) * preference;
          const jitter = randPct > 0 ? base * boxMullerGaussian() * randPct : 0;
          return {
            item: p,
            score: Math.max(0.001, base + jitter),
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map((row) => ({ item: row.item, weight: row.score }));

      const picked = weightedPick(scored);
      selected.push(picked);
      selectedIds.add(picked.id);
      const slotIndex = remainingSlots.indexOf(nextSlot);
      if (slotIndex >= 0) remainingSlots.splice(slotIndex, 1);
    }

    if (selected.length !== DK_SLOTS.length) continue;
    const totalSalary = sumSalary(selected);
    if (totalSalary < config.salary_floor || totalSalary > config.salary_cap) continue;
    if (!canAssignDraftKingsSlots(selected)) continue;

    const tooSimilar = accepted.some((prev) =>
      overlapCount(selected, prev) > DK_SLOTS.length - config.min_hamming_distance,
    );
    if (tooSimilar) continue;

    const score = sumProjection(selected);
    if (score > bestScore) {
      best = selected;
      bestScore = score;
    }
  }

  return best;
};

const lineupKey = (lineup: PlayerWithMetrics[]): string =>
  lineup
    .map((p) => p.id)
    .sort()
    .join('|');

const qieaGenerateLineup = (
  activePool: PlayerWithMetrics[],
  config: GeneratorConfig,
  lockIds: Set<string>,
  dynamicExcludes: Set<string>,
  exposureBounds: Map<string, ExposureBound>,
  appearances: Map<string, number>,
  underExposureBonus: Map<string, number>,
  accepted: PlayerWithMetrics[][],
  randPct: number,
): PlayerWithMetrics[] | null => {
  if (activePool.length < DK_SLOTS.length) return null;

  const baseScores = computeEffectiveProjections(activePool, config, 0).map((score, i) => {
    return Math.max(0.001, score + (underExposureBonus.get(activePool[i].id) || 0));
  });
  const sumBase = baseScores.reduce((sum, x) => sum + x, 0) || 1;
  const probs = activePool.map((p, i) => {
    if (lockIds.has(p.id)) return 0.99;
    if (dynamicExcludes.has(p.id)) return 0.001;
    return clamp((baseScores[i] / sumBase) * DK_SLOTS.length, 0.01, 0.95);
  });

  const scoreById = new Map(activePool.map((p, i) => [p.id, baseScores[i]]));
  const patience = 1000;
  let stagnant = 0;
  let globalBest: PlayerWithMetrics[] | null = null;
  let globalBestScore = -Infinity;

  const generations = Math.max(10, Math.floor(config.qiea_generations));
  const population = Math.max(10, Math.floor(config.qiea_population));

  for (let gen = 0; gen < generations; gen++) {
    let generationBest: PlayerWithMetrics[] | null = null;
    let generationBestScore = -Infinity;
    const seen = new Set<string>();

    for (let i = 0; i < population; i++) {
      const preferenceWeights = new Map<string, number>();
      for (let j = 0; j < activePool.length; j++) {
        const noise = 1 + boxMullerGaussian() * Math.min(0.2, randPct + 0.05);
        preferenceWeights.set(activePool[j].id, Math.max(0.05, probs[j] * Math.max(0.2, noise)));
      }

      const lineup = buildHeuristicLineup(
        activePool,
        config,
        lockIds,
        dynamicExcludes,
        exposureBounds,
        appearances,
        underExposureBonus,
        accepted,
        randPct,
        preferenceWeights,
        4,
      );

      if (!lineup) continue;
      const key = lineupKey(lineup);
      if (seen.has(key)) continue;
      seen.add(key);

      const score = lineup.reduce((sum, p) => sum + (scoreById.get(p.id) || 0), 0);
      if (score > generationBestScore) {
        generationBest = lineup;
        generationBestScore = score;
      }
    }

    if (!generationBest) {
      stagnant++;
      if (stagnant >= patience) break;
      continue;
    }

    if (generationBestScore > globalBestScore + 1e-6) {
      globalBest = generationBest;
      globalBestScore = generationBestScore;
      stagnant = 0;
    } else {
      stagnant++;
    }

    const eliteIds = new Set(generationBest.map((p) => p.id));
    const phase = gen / Math.max(1, generations - 1);
    const learningRate = 0.18 - phase * 0.10;

    for (let j = 0; j < activePool.length; j++) {
      const playerId = activePool[j].id;
      if (lockIds.has(playerId)) {
        probs[j] = 0.99;
        continue;
      }
      if (dynamicExcludes.has(playerId)) {
        probs[j] = 0.001;
        continue;
      }
      const target = eliteIds.has(playerId) ? 1 : 0;
      probs[j] = clamp(probs[j] + learningRate * (target - probs[j]), 0.01, 0.99);
    }

    const unlockedIdx = activePool
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => !lockIds.has(p.id) && !dynamicExcludes.has(p.id))
      .map(({ idx }) => idx);
    if (unlockedIdx.length > 0) {
      const unlockedSum = unlockedIdx.reduce((sum, idx) => sum + probs[idx], 0) || 1;
      const lockedCount = activePool.reduce((sum, p) => sum + (lockIds.has(p.id) ? 1 : 0), 0);
      const targetUnlockedMass = Math.max(0.2, DK_SLOTS.length - lockedCount);
      const scale = targetUnlockedMass / unlockedSum;
      unlockedIdx.forEach((idx) => {
        probs[idx] = clamp(probs[idx] * scale, 0.01, 0.99);
      });
    }

    if (stagnant >= patience) break;
  }

  return globalBest;
};

// ---- Core Lineup Generator (QIEA-based) ----

const generateLineups = async (
  rawPlayers: Player[],
  config: GeneratorConfig,
  explicitExposures: Map<string, { min?: number; max?: number }>,
  lockIds: Set<string>,
  excludeIds: Set<string>,
  confirmedLineups: Map<string, ConfirmedLineupInfo>,
  onProgress: (progress: number, currentBest: Lineup | null, count: number) => void,
): Promise<{ lineups: Lineup[]; warnings: string[]; exposureRelaxed: boolean }> => {
  const warnings: string[] = [];

  if (lockIds.size > DK_SLOTS.length) {
    throw new Error(`Too many locked players (${lockIds.size}). Max is ${DK_SLOTS.length}.`);
  }

  for (const id of lockIds) {
    if (excludeIds.has(id)) {
      throw new Error(`Player ${id} is both locked and excluded.`);
    }
  }
  warnings.push(
    `Using QIEA optimizer (generations=${config.qiea_generations}, population=${config.qiea_population}, patience=1000).`,
  );

  const enrichedAll = enrichPlayersWithMetrics(rawPlayers, confirmedLineups);
  const byId = new Map(enrichedAll.map((p) => [p.id, p]));

  for (const id of lockIds) {
    if (!byId.has(id)) {
      throw new Error(`Locked player ${id} is not in the current player pool.`);
    }
  }

  const globalMaxPct = config.global_max_exposure_pct;
  const exposureBounds = resolveExposureBounds(
    enrichedAll,
    config.n_lineups,
    globalMaxPct,
    explicitExposures,
    lockIds,
  );

  const activePool = enrichedAll.filter((p) => {
    if (excludeIds.has(p.id) && !lockIds.has(p.id)) return false;
    if (getStatus(p) === 'out' && !lockIds.has(p.id)) return false;
    return safeNumber(p.salary, 0) > 0 && safeNumber(p.projection, 0) > 0;
  });

  if (activePool.length < DK_SLOTS.length) {
    throw new Error(`Optimizer pool too small (${activePool.length}) after exclusions.`);
  }

  const accepted: PlayerWithMetrics[][] = [];
  const appearances = new Map<string, number>();

  const missingSlot = DK_SLOTS.find((slot) => !activePool.some((p) => getEligibleSlots(p.position).includes(slot)));
  if (missingSlot) {
    throw new Error(`No eligible players for ${missingSlot} in active pool after parsing positions.`);
  }

  for (let iter = 0; iter < config.n_lineups; iter++) {
    const randPct = getRandomizationPct(iter, config);

    const dynamicExcludes = new Set<string>(excludeIds);
    for (const [id, bound] of exposureBounds) {
      if ((appearances.get(id) || 0) >= bound.max) {
        dynamicExcludes.add(id);
      }
    }

    const underExposureBonus = new Map<string, number>();
    const remainingIters = config.n_lineups - iter;
    for (const [id, bound] of exposureBounds) {
      const got = appearances.get(id) || 0;
      const needed = bound.min - got;
      if (needed > 0 && remainingIters > 0) {
        underExposureBonus.set(id, Math.min((needed / remainingIters) * 5, 10));
      }
    }

    let lineup = qieaGenerateLineup(
      activePool,
      config,
      lockIds,
      dynamicExcludes,
      exposureBounds,
      appearances,
      underExposureBonus,
      accepted,
      randPct,
    );

    if (!lineup) {
      lineup = buildHeuristicLineup(
        activePool,
        config,
        lockIds,
        dynamicExcludes,
        exposureBounds,
        appearances,
        underExposureBonus,
        accepted,
        randPct,
      );
      if (lineup) {
        warnings.push(`QIEA fallback used greedy repair at lineup ${iter + 1}.`);
      }
    }

    if (!lineup) {
      warnings.push(`QIEA exhausted at lineup ${iter + 1}; stopping at ${accepted.length} lineups.`);
      break;
    }

    accepted.push(lineup);
    for (const p of lineup) {
      appearances.set(p.id, (appearances.get(p.id) || 0) + 1);
    }

    const progress = Math.min(99, Math.round((accepted.length / config.n_lineups) * 100));
    onProgress(
      progress,
      toSerializableLineup(
        accepted[accepted.length - 1],
        `qiea_progress_${accepted.length}_${Math.random().toString(36).slice(2, 7)}`,
      ),
      accepted.length,
    );
  }

  // Warn on unmet minimum exposure targets
  const unmetMin = Array.from(exposureBounds.entries())
    .map(([id, bound]) => ({ id, min: bound.min, got: appearances.get(id) || 0 }))
    .filter((row) => row.min > row.got)
    .sort((a, b) => b.min - b.got - (a.min - a.got));

  if (unmetMin.length > 0) {
    const sample = unmetMin
      .slice(0, 6)
      .map((row) => {
        const name = byId.get(row.id)?.name || row.id;
        return `${name} (${row.got}/${row.min})`;
      })
      .join(', ');
    warnings.push(`Minimum exposure targets not fully met for ${unmetMin.length} player(s): ${sample}.`);
  }

  if (accepted.length < config.n_lineups) {
    warnings.push(
      `Generated ${accepted.length}/${config.n_lineups} unique lineups before exhausting feasible combinations.`,
    );
  }

  const lineupModels = finalizeLineups(accepted);
  onProgress(100, lineupModels[0] || null, lineupModels.length);

  return {
    lineups: lineupModels,
    warnings,
    exposureRelaxed: false,
  };
};

// ---- Worker Message Handler ----

workerScope.onmessage = async (event: MessageEvent<RequestPayload>) => {
  try {
    const payload = event.data || { players: [] };
    const players = Array.isArray(payload.players) ? payload.players : [];

    if (players.length === 0) {
      throw new Error('No players provided. Load the slate before running the optimizer.');
    }

    const config = resolveGeneratorConfig(payload.config);

    const requestLocks = toStringSet(payload.locks);
    const requestExcludes = toStringSet(payload.excludes);

    const playerLocks = new Set(
      players
        .filter((p) => Boolean((p as any)?.optimizerLocked))
        .map((p) => String(p.id)),
    );
    const playerExcludes = new Set(
      players
        .filter((p) => Boolean((p as any)?.optimizerExcluded))
        .map((p) => String(p.id)),
    );

    const locks = new Set<string>([...requestLocks, ...playerLocks]);
    const excludes = new Set<string>([...requestExcludes, ...playerExcludes]);

    const explicitExposureMap = toExposureMap(payload.exposures);
    const confirmedLineups = toConfirmedLineups(payload.confirmedLineups);

    const result = await generateLineups(
      players,
      config,
      explicitExposureMap,
      locks,
      excludes,
      confirmedLineups,
      (progress, currentBest, count) => {
        workerScope.postMessage({
          type: 'progress',
          progress,
          currentBest,
          lineupsFound: count,
        });
      },
    );

    workerScope.postMessage({
      type: 'result',
      lineups: result.lineups,
      warnings: result.warnings,
      exposureRelaxed: result.exposureRelaxed,
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown optimization error',
    });
  }
};

import { Lineup, Player } from '../../types';

const DK_SLOTS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] as const;
type DkSlot = (typeof DK_SLOTS)[number];

const workerScope = self as any;

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

interface AnchorCombo {
  players: PlayerWithMetrics[];
  ceiling_sum: number;
  projection_sum: number;
  avg_ownership: number;
  score: number;
  repetitions: number;
}

interface GeneratorConfig {
  n_lineups: number;
  global_max_exposure_pct: number;
  min_hamming_distance: number;
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

const DEFAULT_CONFIG: GeneratorConfig = {
  n_lineups: 20,
  global_max_exposure_pct: 100,
  min_hamming_distance: 2,
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
};

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
  return String(position || '')
    .toUpperCase()
    .split(/[\s,\/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
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

  return {
    ...DEFAULT_CONFIG,
    n_lineups: nLineups,
    global_max_exposure_pct: clamp(
      safeNumber(raw?.global_max_exposure_pct ?? raw?.maxExposure ?? raw?.max_exposure, DEFAULT_CONFIG.global_max_exposure_pct),
      0,
      100,
    ),
    min_hamming_distance: minHamming,
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
  };
};

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

const identifyChalk = (players: PlayerWithMetrics[], config: GeneratorConfig): PlayerWithMetrics[] => {
  return players.filter(
    (p) =>
      p.own_mean !== undefined &&
      p.own_mean >= config.chalk_threshold_own &&
      safeNumber(p.projection, 0) >= config.chalk_threshold_proj &&
      getStatus(p) !== 'out',
  );
};

const combinations = <T,>(arr: T[], size: number): T[][] => {
  if (size <= 0 || arr.length < size) return [];
  const result: T[][] = [];

  const recurse = (start: number, current: T[]) => {
    if (current.length === size) {
      result.push([...current]);
      return;
    }

    for (let i = start; i < arr.length; i++) {
      current.push(arr[i]);
      recurse(i + 1, current);
      current.pop();
    }
  };

  recurse(0, []);
  return result;
};

const generateAnchorCombos = (
  chalkPlayers: PlayerWithMetrics[],
  fallbackPlayers: PlayerWithMetrics[],
): AnchorCombo[] => {
  const source = (chalkPlayers.length >= 2 ? chalkPlayers : fallbackPlayers)
    .slice()
    .sort((a, b) => safeNumber(b.ceiling_final, 0) - safeNumber(a.ceiling_final, 0));

  const top = source.slice(0, 8);
  if (top.length === 0) return [];

  const combos2 = combinations(top, Math.min(2, top.length)).filter((c) => c.length === 2);
  const combos3 = top.length >= 3 ? combinations(top, 3) : [];
  const base = [...combos2, ...combos3];

  if (base.length === 0) {
    return [
      {
        players: [top[0]],
        ceiling_sum: safeNumber(top[0].ceiling_final, top[0].projection),
        projection_sum: safeNumber(top[0].projection, 0),
        avg_ownership: safeNumber(top[0].own_mean, 0),
        score: safeNumber(top[0].ceiling_final, top[0].projection),
        repetitions: 0,
      },
    ];
  }

  return base
    .map((combo) => {
      const ceilingSum = combo.reduce((sum, p) => sum + safeNumber(p.ceiling_final, p.projection), 0);
      const projectionSum = combo.reduce((sum, p) => sum + safeNumber(p.projection, 0), 0);
      const avgOwnership = combo.reduce((sum, p) => sum + safeNumber(p.own_mean, 0), 0) / combo.length;
      return {
        players: combo,
        ceiling_sum: ceilingSum,
        projection_sum: projectionSum,
        avg_ownership: avgOwnership,
        score: ceilingSum * (1 - avgOwnership / 100),
        repetitions: 0,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
};

const layerKey = (playerId: string, layer: 'anchor' | 'leverage' | 'filler'): string => `${layer}:${playerId}`;

const canAddPlayer = (
  player: PlayerWithMetrics,
  usedIds: Set<string>,
  globalAppearances: Map<string, number>,
  layerAppearances: Map<string, number>,
  exposures: Map<string, ExposureBound>,
  config: GeneratorConfig,
  layer: 'anchor' | 'leverage' | 'filler',
  maxExposureBuffer: number,
  isLocked: boolean,
): boolean => {
  if (usedIds.has(player.id)) return false;

  if (!isLocked) {
    const current = globalAppearances.get(player.id) || 0;
    const bound = exposures.get(player.id);
    const maxAllowed = (bound?.max ?? config.n_lineups) + maxExposureBuffer;
    if (current + 1 > maxAllowed) return false;

    const layerCurrent = layerAppearances.get(layerKey(player.id, layer)) || 0;
    const layerCap =
      layer === 'anchor'
        ? config.max_anchor_appearances
        : layer === 'leverage'
          ? config.max_leverage_appearances
          : config.max_filler_appearances;

    if (layerCurrent + 1 > layerCap + maxExposureBuffer) return false;
  }

  return true;
};

const salaryFeasibleAfterAdd = (
  currentLineup: PlayerWithMetrics[],
  candidate: PlayerWithMetrics,
  allPlayers: PlayerWithMetrics[],
  usedIds: Set<string>,
  config: GeneratorConfig,
): boolean => {
  const nextLineup = [...currentLineup, candidate];
  const nextSalary = nextLineup.reduce((sum, p) => sum + safeNumber(p.salary, 0), 0);

  if (nextSalary > config.salary_cap) return false;

  const needed = DK_SLOTS.length - nextLineup.length;
  if (needed <= 0) {
    return nextSalary >= config.salary_floor;
  }

  const remainingSalaries = allPlayers
    .filter((p) => !usedIds.has(p.id) && p.id !== candidate.id)
    .map((p) => safeNumber(p.salary, 0))
    .sort((a, b) => a - b);

  if (remainingSalaries.length < needed) return false;

  const cheapest = remainingSalaries.slice(0, needed).reduce((sum, n) => sum + n, 0);
  const priciest = remainingSalaries.slice(-needed).reduce((sum, n) => sum + n, 0);

  if (nextSalary + cheapest > config.salary_cap) return false;
  if (nextSalary + priciest < config.salary_floor) return false;

  return true;
};

const computeHammingDistance = (a: PlayerWithMetrics[], b: PlayerWithMetrics[]): number => {
  const aIds = new Set(a.map((p) => p.id));
  const overlap = b.reduce((count, p) => count + (aIds.has(p.id) ? 1 : 0), 0);
  return DK_SLOTS.length - overlap;
};

const respectsHamming = (
  candidate: PlayerWithMetrics[],
  accepted: PlayerWithMetrics[][],
  minDistance: number,
): boolean => {
  return accepted.every((lineup) => computeHammingDistance(candidate, lineup) >= minDistance);
};

const isValidLineup = (
  lineup: PlayerWithMetrics[],
  config: GeneratorConfig,
  locks: Set<string>,
): boolean => {
  if (lineup.length !== DK_SLOTS.length) return false;

  const totalSalary = lineup.reduce((sum, p) => sum + safeNumber(p.salary, 0), 0);
  if (totalSalary > config.salary_cap || totalSalary < config.salary_floor) return false;

  for (const lockId of locks) {
    if (!lineup.some((p) => p.id === lockId)) return false;
  }

  if (!canAssignDraftKingsSlots(lineup)) return false;
  return true;
};

const chooseAnchorCombo = (
  combos: AnchorCombo[],
  comboAppearances: Map<string, number>,
  exposures: Map<string, ExposureBound>,
  appearances: Map<string, number>,
  config: GeneratorConfig,
): AnchorCombo | null => {
  if (combos.length === 0) return null;

  const scored = combos
    .map((combo) => {
      const comboKey = combo.players.map((p) => p.id).sort().join('|');
      const reps = comboAppearances.get(comboKey) || 0;
      const maxReps = Math.max(2, Math.floor(config.n_lineups / Math.max(1, combos.length / 2)));
      if (reps >= maxReps) return null;

      const underExposureBoost = combo.players.reduce((sum, player) => {
        const cur = appearances.get(player.id) || 0;
        const min = exposures.get(player.id)?.min || 0;
        return sum + Math.max(0, min - cur) * 25;
      }, 0);

      return {
        combo,
        score: combo.score + underExposureBoost - reps * 10,
      };
    })
    .filter((row): row is { combo: AnchorCombo; score: number } => Boolean(row))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const topK = scored.slice(0, Math.min(5, scored.length));
  return topK[Math.floor(Math.random() * topK.length)].combo;
};

const pickBestCandidate = (
  candidates: PlayerWithMetrics[],
  anchorTeams: Set<string>,
  appearances: Map<string, number>,
  exposures: Map<string, ExposureBound>,
  scoreFn: (player: PlayerWithMetrics) => number,
): PlayerWithMetrics | null => {
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((player) => {
      const bound = exposures.get(player.id);
      const current = appearances.get(player.id) || 0;
      const underMinBoost = bound && current < bound.min ? (bound.min - current) * 1000 : 0;
      const stackBoost = anchorTeams.has(player.team) || anchorTeams.has(player.opponent || '') ? 1.15 : 1;
      const jitter = 0.9 + Math.random() * 0.2;

      return {
        player,
        score: (scoreFn(player) + underMinBoost) * stackBoost * jitter,
      };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.player || null;
};

const fillLineup = (
  anchors: PlayerWithMetrics[],
  pool: PlayerWithMetrics[],
  exposures: Map<string, ExposureBound>,
  locks: Set<string>,
  excludes: Set<string>,
  globalAppearances: Map<string, number>,
  layerAppearances: Map<string, number>,
  config: GeneratorConfig,
  maxExposureBuffer: number,
): PlayerWithMetrics[] | null => {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const lockPlayers = Array.from(locks)
    .map((id) => byId.get(id))
    .filter((p): p is PlayerWithMetrics => Boolean(p));

  if (lockPlayers.length !== locks.size) {
    return null;
  }

  const fixedById = new Map<string, PlayerWithMetrics>();
  for (const player of [...anchors, ...lockPlayers]) {
    if (excludes.has(player.id) && !locks.has(player.id)) return null;
    fixedById.set(player.id, player);
  }

  const fixed = Array.from(fixedById.values());
  if (fixed.length > DK_SLOTS.length) return null;

  const fixedSalary = fixed.reduce((sum, p) => sum + safeNumber(p.salary, 0), 0);
  if (fixedSalary > config.salary_cap) return null;

  const anchorTeams = new Set<string>();
  for (const anchor of anchors) {
    if (anchor.team) anchorTeams.add(anchor.team);
    if (anchor.opponent) anchorTeams.add(anchor.opponent);
  }

  for (let attempt = 0; attempt < 80; attempt++) {
    const lineup: PlayerWithMetrics[] = [...fixed];
    const usedIds = new Set<string>(lineup.map((p) => p.id));

    const addPlayer = (player: PlayerWithMetrics, layer: 'anchor' | 'leverage' | 'filler'): boolean => {
      if (usedIds.has(player.id)) return false;
      if (excludes.has(player.id) && !locks.has(player.id)) return false;
      if (getStatus(player) === 'out' && !locks.has(player.id)) return false;

      if (
        !canAddPlayer(
          player,
          usedIds,
          globalAppearances,
          layerAppearances,
          exposures,
          config,
          layer,
          maxExposureBuffer,
          locks.has(player.id),
        )
      ) {
        return false;
      }

      if (!salaryFeasibleAfterAdd(lineup, player, pool, usedIds, config)) return false;

      lineup.push(player);
      usedIds.add(player.id);
      return true;
    };

    if (lineup.length < DK_SLOTS.length) {
      const leverageNeeded = Math.min(3, DK_SLOTS.length - lineup.length);
      for (let i = 0; i < leverageNeeded; i++) {
        const leverageCandidates = pool.filter((p) => {
          if (usedIds.has(p.id)) return false;
          if (excludes.has(p.id) || getStatus(p) === 'out') return false;
          if (safeNumber(p.minutes_proj, 0) < 15) return false;
          if (safeNumber(p.ceiling_gap_adjusted, 0) < config.leverage_ceiling_gap_min) return false;
          if (safeNumber(p.salary, 0) < 5000 || safeNumber(p.salary, 0) > 8500) return false;
          if (safeNumber(p.value_score, 50) < config.leverage_value_score_min) return false;
          if (safeNumber(p.own_mean, 0) >= 25) return false;
          return true;
        });

        const chosen = pickBestCandidate(
          leverageCandidates,
          anchorTeams,
          globalAppearances,
          exposures,
          (p) => {
            const gameBonus = anchorTeams.has(p.team) || anchorTeams.has(p.opponent || '') ? 2.5 : 1;
            return (
              (safeNumber(p.value_score, 50) / 100) *
              Math.max(0, safeNumber(p.ceiling_gap_adjusted, 0)) *
              (1 - safeNumber(p.own_mean, 0) / 100) *
              gameBonus
            );
          },
        );

        if (!chosen) break;
        addPlayer(chosen, 'leverage');
      }
    }

    while (lineup.length < DK_SLOTS.length) {
      const remainingCandidates = pool.filter((p) => {
        if (usedIds.has(p.id)) return false;
        if (excludes.has(p.id) || getStatus(p) === 'out') return false;
        if (safeNumber(p.minutes_proj, 0) < 8) return false;
        if (safeNumber(p.value_score, 50) < config.filler_value_score_min) return false;
        return true;
      });

      const candidate = pickBestCandidate(
        remainingCandidates,
        anchorTeams,
        globalAppearances,
        exposures,
        (p) => {
          const value = safeNumber(p.value_score, 50) / 100;
          const ceilingGap = Math.max(0, safeNumber(p.ceiling_gap_adjusted, 0));
          const ownershipEdge = 1 - safeNumber(p.own_mean, 0) / 100;
          const salary = safeNumber(p.salary, 0);
          const salaryFactor = salary < 5000 ? 1.1 : 0.95;
          return value * (1 + ceilingGap / 20) * ownershipEdge * salaryFactor;
        },
      );

      if (!candidate) break;

      const layer: 'leverage' | 'filler' =
        safeNumber(candidate.salary, 0) >= 5000 ? 'leverage' : 'filler';

      if (!addPlayer(candidate, layer)) {
        // Remove and retry with a temporary ban for this attempt.
        usedIds.add(candidate.id);
      }
    }

    if (!isValidLineup(lineup, config, locks)) continue;
    return lineup;
  }

  return null;
};

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

const recordLineupAppearances = (
  lineup: PlayerWithMetrics[],
  appearances: Map<string, number>,
  layerAppearances: Map<string, number>,
  anchors: Set<string>,
): void => {
  for (const player of lineup) {
    appearances.set(player.id, (appearances.get(player.id) || 0) + 1);

    const layer: 'anchor' | 'leverage' | 'filler' = anchors.has(player.id)
      ? 'anchor'
      : safeNumber(player.salary, 0) >= 5000
        ? 'leverage'
        : 'filler';

    const key = layerKey(player.id, layer);
    layerAppearances.set(key, (layerAppearances.get(key) || 0) + 1);
  }
};

const generateLineups = (
  rawPlayers: Player[],
  config: GeneratorConfig,
  explicitExposures: Map<string, { min?: number; max?: number }>,
  lockIds: Set<string>,
  excludeIds: Set<string>,
  confirmedLineups: Map<string, ConfirmedLineupInfo>,
  onProgress: (progress: number, currentBest: Lineup | null, count: number) => void,
): { lineups: Lineup[]; warnings: string[]; exposureRelaxed: boolean } => {
  const warnings: string[] = [];

  if (lockIds.size > DK_SLOTS.length) {
    throw new Error(`Too many locked players (${lockIds.size}). Max is ${DK_SLOTS.length}.`);
  }

  for (const id of lockIds) {
    if (excludeIds.has(id)) {
      throw new Error(`Player ${id} is both locked and excluded.`);
    }
  }

  const enrichedAll = enrichPlayersWithMetrics(rawPlayers, confirmedLineups);

  const byId = new Map(enrichedAll.map((p) => [p.id, p]));
  for (const id of lockIds) {
    if (!byId.has(id)) {
      throw new Error(`Locked player ${id} is not in the current player pool.`);
    }
  }

  const globalMaxPct = config.global_max_exposure_pct;
  const exposureBounds = resolveExposureBounds(enrichedAll, config.n_lineups, globalMaxPct, explicitExposures, lockIds);

  const activePool = enrichedAll.filter((p) => {
    if (excludeIds.has(p.id) && !lockIds.has(p.id)) return false;
    if (getStatus(p) === 'out' && !lockIds.has(p.id)) return false;
    return safeNumber(p.salary, 0) > 0 && safeNumber(p.projection, 0) > 0;
  });

  if (activePool.length < DK_SLOTS.length) {
    throw new Error(`Optimizer pool too small (${activePool.length}) after exclusions.`);
  }

  const chalk = identifyChalk(activePool, config);
  const sortedFallback = activePool
    .slice()
    .sort((a, b) => safeNumber(b.projection, 0) - safeNumber(a.projection, 0));
  const anchorCombos = generateAnchorCombos(chalk, sortedFallback);

  if (anchorCombos.length === 0) {
    throw new Error('Unable to form anchor combos from the current player pool.');
  }

  const accepted: PlayerWithMetrics[][] = [];
  const seenKeys = new Set<string>();
  const appearances = new Map<string, number>();
  const layerAppearances = new Map<string, number>();
  const comboAppearances = new Map<string, number>();
  let bestProjection = -Infinity;
  let exposureRelaxed = false;

  const attemptBuild = (maxExposureBuffer: number, maxAttempts: number): void => {
    let attempts = 0;

    while (accepted.length < config.n_lineups && attempts < maxAttempts) {
      attempts += 1;

      const combo = chooseAnchorCombo(anchorCombos, comboAppearances, exposureBounds, appearances, config);
      if (!combo) continue;

      const lineup = fillLineup(
        combo.players,
        activePool,
        exposureBounds,
        lockIds,
        excludeIds,
        appearances,
        layerAppearances,
        config,
        maxExposureBuffer,
      );

      if (!lineup) continue;
      if (!respectsHamming(lineup, accepted, config.min_hamming_distance)) continue;

      const key = lineup
        .map((p) => p.id)
        .sort()
        .join('|');
      if (seenKeys.has(key)) continue;

      const overMax = lineup.some((p) => {
        const current = appearances.get(p.id) || 0;
        const maxAllowed = (exposureBounds.get(p.id)?.max ?? config.n_lineups) + maxExposureBuffer;
        return current + 1 > maxAllowed;
      });
      if (overMax) continue;

      accepted.push(lineup);
      seenKeys.add(key);

      const comboKey = combo.players.map((p) => p.id).sort().join('|');
      comboAppearances.set(comboKey, (comboAppearances.get(comboKey) || 0) + 1);
      recordLineupAppearances(lineup, appearances, layerAppearances, new Set(combo.players.map((p) => p.id)));

      const lineupProjection = lineup.reduce((sum, p) => sum + safeNumber(p.projection, 0), 0);
      if (lineupProjection > bestProjection) {
        bestProjection = lineupProjection;
      }

      const progress = Math.min(99, Math.round((accepted.length / config.n_lineups) * 100));
      onProgress(
        progress,
        toSerializableLineup(lineup, `gpp_progress_${accepted.length}_${Math.random().toString(36).slice(2, 7)}`),
        accepted.length,
      );
    }
  };

  attemptBuild(0, config.n_lineups * 350);

  if (accepted.length < config.n_lineups) {
    exposureRelaxed = true;
    for (const buffer of [1, 2, 3, 5, 8, 12]) {
      if (accepted.length >= config.n_lineups) break;
      attemptBuild(buffer, config.n_lineups * 220);
    }
  }

  if (accepted.length < config.n_lineups) {
    warnings.push(
      `Generated ${accepted.length}/${config.n_lineups} unique lineups before exhausting feasible combinations.`,
    );
  }

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

  if (exposureRelaxed) {
    warnings.push('Exposure constraints were relaxed to maximize feasible lineup generation.');
  }

  const lineupModels = finalizeLineups(accepted);
  onProgress(100, lineupModels[0] || null, lineupModels.length);

  return {
    lineups: lineupModels,
    warnings,
    exposureRelaxed,
  };
};

workerScope.onmessage = (event: MessageEvent<RequestPayload>) => {
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

    const result = generateLineups(
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

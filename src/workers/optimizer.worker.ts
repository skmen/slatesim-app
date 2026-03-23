
import { Lineup, Player } from '../../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DK_SLOTS = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL'] as const;
type Slot = (typeof DK_SLOTS)[number];
const workerScope = self as any;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface OptimizerConfig {
  numLineups?: number;
  salaryCap?: number;
  salaryFloor?: number;
  salary_floor?: number;
  maxExposure?: number;
  ceilingWeight?: number;
  ceiling_weight?: number;
  ownershipPenalty?: number;
  ownership_penalty?: number;
  popSize?: number;
  pop_size?: number;
  generations?: number;
  patience?: number;
  minHamming?: number;
  min_hamming?: number;
  primaryStackSize?: number;
  primary_stack_size?: number;
  primaryStackBonus?: number;
  primary_stack_bonus?: number;
  gameStackSize?: number;
  game_stack_size?: number;
  gameStackBonus?: number;
  game_stack_bonus?: number;
  enableThetaBias?: boolean;
  enable_theta_bias?: boolean;
  thetaBiasStrength?: number;
  theta_bias_strength?: number;
  enableStackScoring?: boolean;
  enable_stack_scoring?: boolean;
  teamStackWeights?: Record<string, number>;
  team_stack_weights?: Record<string, number>;
  stackMinGameTotal?: number;
  stack_min_game_total?: number;
  deltaTheta?: number;
  delta_theta?: number;
}

interface RequestPayload {
  players: Player[];
  config?: OptimizerConfig;
}

interface QIEAConfig {
  popSize:            number;   // default 128
  generations:        number;   // default 500
  patience:           number;   // default 150
  minHamming:         number;   // default 3
  deltaTheta:         number;   // default 0.01 * PI

  enableThetaBias:    boolean;  // default true
  thetaBiasStrength:  number;   // default 0.5

  enableStackScoring: boolean;  // default true
  primaryStackSize:   number;   // default 3
  primaryStackBonus:  number;   // default 5.0
  gameStackSize:      number;   // default 2
  gameStackBonus:     number;   // default 3.0

  ceilingWeight:      number;   // default 0.25
  ownershipPenalty:   number;   // default 0.10
  teamStackWeights:   Record<string, number>;
  stackMinGameTotal:  number;   // default 215
  maxExposure:        number;   // global max exposure % for all non-locked players, default 100
}

interface QIEAPlayer {
  index:      number;   // index into the original Player[] from slate.json
  salary:     number;
  projection: number;   // GPP-adjusted (ceiling blended)
  ownership:  number;   // 0-100
  team:       string;
  opponent:   string;
  gameSlug:   string;
  gameTotal:  number;
  positions:      string[];
  locked:         boolean;
  excluded:       boolean;
  minExposurePct: number;   // 0-100, from optimizerMinExposure
  maxExposurePct: number;   // 0-100, from optimizerMaxExposure or global cap
}

interface ArchiveEntry {
  lineup:  Uint8Array;  // binary vector, length n_players
  score:   number;
  players: number[];    // sorted selected QIEAPlayer indexes, length 8
}

interface RepairResult {
  lineup:     Uint8Array;
  playerIdxs: number[];  // exactly 8 QIEAPlayer indexes, in slot order
  salary:     number;
  valid:      boolean;
}

// ---------------------------------------------------------------------------
// Utility functions (preserved from original)
// ---------------------------------------------------------------------------

const safeNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const normKey = (value: string): string =>
  String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
    case 'PG':   return pos.includes('PG');
    case 'SG':   return pos.includes('SG');
    case 'SF':   return pos.includes('SF');
    case 'PF':   return pos.includes('PF');
    case 'C':    return pos.includes('C');
    case 'G':    return pos.includes('PG') || pos.includes('SG');
    case 'F':    return pos.includes('SF') || pos.includes('PF');
    case 'UTIL': return true;
    default:     return false;
  }
};

const normalizeOwnership = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return clamp(value * 100, 0, 100);
  return clamp(value, 0, 100);
};

// ---------------------------------------------------------------------------
// Player field readers (preserved from original)
// ---------------------------------------------------------------------------

const getOwnershipPctMaybe = (player: Player): number | undefined => {
  const own = readNumericMaybe(player, ['ownership', 'projectedOwnership', 'projOwnership', 'own', 'OWN']);
  if (!Number.isFinite(Number(own))) return undefined;
  return normalizeOwnership(Number(own));
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

// ---------------------------------------------------------------------------
// Slot index helper
// ---------------------------------------------------------------------------

const slotIndex = (slot: Slot): number => DK_SLOTS.indexOf(slot);

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

const resolveQIEAConfig = (config?: OptimizerConfig): QIEAConfig => {
  const popSize = Math.max(
    8,
    Math.floor(safeNumber((config as any)?.popSize ?? (config as any)?.pop_size, 128))
  );
  const generations = Math.max(
    1,
    Math.floor(safeNumber((config as any)?.generations, 500))
  );
  const patience = Math.max(
    1,
    Math.floor(safeNumber((config as any)?.patience, 150))
  );
  const minHamming = Math.max(
    1,
    Math.floor(safeNumber((config as any)?.minHamming ?? (config as any)?.min_hamming, 3))
  );
  const deltaTheta = clamp(
    safeNumber((config as any)?.deltaTheta ?? (config as any)?.delta_theta, 0.01 * Math.PI),
    0.001 * Math.PI,
    0.1 * Math.PI
  );
  const enableThetaBias =
    (config as any)?.enableThetaBias ?? (config as any)?.enable_theta_bias ?? true;
  const thetaBiasStrength = clamp(
    safeNumber((config as any)?.thetaBiasStrength ?? (config as any)?.theta_bias_strength, 0.5),
    0.0,
    1.0
  );
  const enableStackScoring =
    (config as any)?.enableStackScoring ?? (config as any)?.enable_stack_scoring ?? true;
  const primaryStackSize = Math.max(
    1,
    Math.floor(safeNumber((config as any)?.primaryStackSize ?? (config as any)?.primary_stack_size, 3))
  );
  const primaryStackBonus = safeNumber(
    (config as any)?.primaryStackBonus ?? (config as any)?.primary_stack_bonus,
    5.0
  );
  const gameStackSize = Math.max(
    1,
    Math.floor(safeNumber((config as any)?.gameStackSize ?? (config as any)?.game_stack_size, 2))
  );
  const gameStackBonus = safeNumber(
    (config as any)?.gameStackBonus ?? (config as any)?.game_stack_bonus,
    3.0
  );
  const ceilingWeight = clamp(
    safeNumber((config as any)?.ceilingWeight ?? (config as any)?.ceiling_weight, 0.25),
    0,
    0.5
  );
  const ownershipPenalty = Math.max(
    0,
    safeNumber((config as any)?.ownershipPenalty ?? (config as any)?.ownership_penalty, 0.10)
  );
  const teamStackWeights: Record<string, number> =
    (config as any)?.teamStackWeights ?? (config as any)?.team_stack_weights ?? {};
  const stackMinGameTotal = Math.max(
    0,
    safeNumber((config as any)?.stackMinGameTotal ?? (config as any)?.stack_min_game_total, 215)
  );

  return {
    popSize,
    generations,
    patience,
    minHamming,
    deltaTheta,
    enableThetaBias: Boolean(enableThetaBias),
    thetaBiasStrength,
    enableStackScoring: Boolean(enableStackScoring),
    primaryStackSize,
    primaryStackBonus,
    gameStackSize,
    gameStackBonus,
    ceilingWeight,
    ownershipPenalty,
    teamStackWeights,
    stackMinGameTotal,
    maxExposure: clamp(safeNumber((config as any)?.maxExposure, 100), 0, 100),
  };
};

const resolveRunConfig = (
  config?: OptimizerConfig
): { salaryCap: number; salaryFloor: number; numLineups: number } => {
  const numLineups = Math.max(1, Math.floor(safeNumber(config?.numLineups, 20)));
  const salaryCap = Math.max(1, Math.floor(safeNumber(config?.salaryCap, 50000)));
  const salaryFloor = clamp(
    Math.floor(safeNumber(
      (config as any)?.salaryFloor ?? (config as any)?.salary_floor,
      49000
    )),
    0,
    salaryCap
  );
  return { numLineups, salaryCap, salaryFloor };
};

// ---------------------------------------------------------------------------
// Player preprocessing
// ---------------------------------------------------------------------------

const preprocessPlayers = (
  players: Player[],
  config: QIEAConfig,
  _salaryCap: number,
): QIEAPlayer[] => {
  const result: QIEAPlayer[] = [];

  for (let i = 0; i < players.length; i++) {
    const player = players[i];

    const isExcluded = Boolean(
      (player as any).optimizerExcluded || (player as any).excluded
    );
    if (isExcluded) continue;

    // Must be eligible for at least one DK slot
    const hasSlot = DK_SLOTS.some((slot) => canFitDK(player, slot));
    if (!hasSlot) continue;

    const positions = parsePositions(player.position);

    // GPP-adjusted projection
    const rawProjection = Math.max(0, safeNumber(player.projection, 0));
    const rawCeil = getCeilingTieBreaker(player);
    const effectiveCeil = rawCeil > 0 ? rawCeil : rawProjection;
    const adjustedProjection =
      rawProjection * (1 - config.ceilingWeight) +
      effectiveCeil * config.ceilingWeight;

    const ownRaw = getOwnershipPctMaybe(player);
    const ownership = ownRaw !== undefined ? ownRaw : 0;

    const team = getTeamMaybe(player);
    const opponent = getOpponentMaybe(player);
    const gameSlug = getGameSlug(team, opponent);

    const gameTotalRaw = getGameTotalMaybe(player);
    const gameTotal = gameTotalRaw !== undefined ? gameTotalRaw : 220;

    // Low-total game filter
    if (
      gameTotalRaw !== undefined &&
      gameTotalRaw > 0 &&
      gameTotalRaw < config.stackMinGameTotal
    ) {
      continue;
    }

    const locked = Boolean((player as any).optimizerLocked);

    // Per-player exposure bounds (component stamps these on each player before sending)
    const rawMinExp = safeNumber((player as any).optimizerMinExposure, 0);
    const rawMaxExp = (player as any).optimizerMaxExposure !== undefined
      ? safeNumber((player as any).optimizerMaxExposure, config.maxExposure)
      : config.maxExposure;
    const minExposurePct = locked ? 100 : clamp(rawMinExp, 0, 100);
    const maxExposurePct = locked ? 100 : clamp(rawMaxExp, minExposurePct, 100);

    result.push({
      index: i,
      salary: Math.max(0, safeNumber(player.salary, 0)),
      projection: adjustedProjection,
      ownership,
      team,
      opponent,
      gameSlug,
      gameTotal,
      positions,
      locked,
      excluded: false,
      minExposurePct,
      maxExposurePct,
    });
  }

  return result;
};

// ---------------------------------------------------------------------------
// Eligibility matrix — 8 x n_players boolean matrix
// ---------------------------------------------------------------------------

const canFitDKFromPositions = (positions: string[], slot: Slot): boolean => {
  switch (slot) {
    case 'PG':   return positions.includes('PG');
    case 'SG':   return positions.includes('SG');
    case 'SF':   return positions.includes('SF');
    case 'PF':   return positions.includes('PF');
    case 'C':    return positions.includes('C');
    case 'G':    return positions.includes('PG') || positions.includes('SG');
    case 'F':    return positions.includes('SF') || positions.includes('PF');
    case 'UTIL': return true;
    default:     return false;
  }
};

const buildEligibilityMatrix = (players: QIEAPlayer[]): boolean[][] => {
  const n = players.length;
  const matrix: boolean[][] = DK_SLOTS.map(() => new Array<boolean>(n).fill(false));
  for (let j = 0; j < n; j++) {
    for (let s = 0; s < DK_SLOTS.length; s++) {
      matrix[s][j] = canFitDKFromPositions(players[j].positions, DK_SLOTS[s]);
    }
  }
  return matrix;
};

// ---------------------------------------------------------------------------
// Layer 1: Theta initialization with game-total bias
// ---------------------------------------------------------------------------

const initThetas = (
  players: QIEAPlayer[],
  popSize: number,
  config: QIEAConfig,
): Float32Array[] => {
  const n = players.length;
  const BASE = Math.PI / 4;
  const thetas: Float32Array[] = Array.from({ length: popSize }, () =>
    new Float32Array(n).fill(BASE)
  );

  if (config.enableThetaBias) {
    let maxTotal = 0;
    for (const p of players) {
      if (p.gameTotal > maxTotal) maxTotal = p.gameTotal;
    }
    if (maxTotal > 0) {
      for (let i = 0; i < popSize; i++) {
        for (let j = 0; j < n; j++) {
          const boost =
            (players[j].gameTotal / maxTotal) *
            config.thetaBiasStrength *
            (Math.PI / 8);
          thetas[i][j] = clamp(BASE + boost, 0.001, Math.PI / 2 - 0.001);
        }
      }
    }
  }

  // Min-exposure bias: scale theta upward proportional to required exposure %
  // A player at 50% min exposure gets a proportional push toward PI/2
  for (let j = 0; j < n; j++) {
    const minPct = players[j].minExposurePct;
    if (minPct > 0 && !players[j].locked) {
      const boost = (minPct / 100) * (Math.PI / 4);
      for (let i = 0; i < popSize; i++) {
        thetas[i][j] = clamp(thetas[i][j] + boost, 0.001, Math.PI / 2 - 0.001);
      }
    }
  }

  // Locked player override — near-certain selection across the whole population
  for (let j = 0; j < n; j++) {
    if (players[j].locked) {
      for (let i = 0; i < popSize; i++) {
        thetas[i][j] = Math.PI / 2 - 0.001;
      }
    }
  }

  return thetas;
};

// ---------------------------------------------------------------------------
// Observation (wave-function collapse)
// ---------------------------------------------------------------------------

const observePopulation = (thetas: Float32Array[], n: number): Uint8Array[] => {
  const popSize = thetas.length;
  const collapsed: Uint8Array[] = [];
  for (let i = 0; i < popSize; i++) {
    const ind = new Uint8Array(n);
    for (let j = 0; j < n; j++) {
      const p = Math.sin(thetas[i][j]) ** 2;
      ind[j] = Math.random() < p ? 1 : 0;
    }
    collapsed.push(ind);
  }
  return collapsed;
};

// ---------------------------------------------------------------------------
// Repair — structural validity only (Layer 3 stack enforcement excluded)
// repairLineup must never throw — returns valid:false on unresolvable inputs
// ---------------------------------------------------------------------------

const repairLineup = (
  collapsed: Uint8Array,
  players: QIEAPlayer[],
  eligibility: boolean[][],
  salaryCap: number,
  salaryFloor: number,
  lockedIndexes: number[],
): RepairResult => {
  const n = players.length;
  const invalidResult: RepairResult = {
    lineup: new Uint8Array(n),
    playerIdxs: [],
    salary: 0,
    valid: false,
  };

  try {
    const bits = new Uint8Array(collapsed);
    const lockedSet = new Set(lockedIndexes);

    // STEP 1: Force locked players in
    for (const li of lockedIndexes) {
      if (li >= 0 && li < n) bits[li] = 1;
    }

    // STEP 2: Adjust to exactly 8 active players
    let active: number[] = [];
    for (let j = 0; j < n; j++) {
      if (bits[j] === 1) active.push(j);
    }

    if (active.length > 8) {
      const sortable = active
        .filter((j) => !lockedSet.has(j))
        .sort(
          (a, b) =>
            players[a].projection / Math.max(1, players[a].salary) -
            players[b].projection / Math.max(1, players[b].salary)
        );
      let excess = active.length - 8;
      for (let i = 0; i < sortable.length && excess > 0; i++) {
        bits[sortable[i]] = 0;
        excess--;
      }
      active = [];
      for (let j = 0; j < n; j++) {
        if (bits[j] === 1) active.push(j);
      }
    }

    if (active.length < 8) {
      const needed = 8 - active.length;
      const currentSal = active.reduce((sum, j) => sum + players[j].salary, 0);
      const avgBudget = (salaryCap - currentSal) / needed;
      const activeSet = new Set(active);
      let inactive: number[] = [];
      for (let j = 0; j < n; j++) {
        if (!activeSet.has(j) && !players[j].excluded) inactive.push(j);
      }
      let viable = inactive.filter((j) => players[j].salary <= avgBudget + 1500);
      if (viable.length < needed) viable = inactive;
      viable.sort((a, b) => players[b].projection - players[a].projection);
      const toAdd = viable.slice(0, needed);
      for (const j of toAdd) {
        bits[j] = 1;
        active.push(j);
      }
    }

    // STEP 3: Greedy positional slot assignment
    let activeSet = new Set(active);
    const assigned = new Map<Slot, number>();
    const usedPlayers = new Set<number>();

    for (let s = 0; s < DK_SLOTS.length; s++) {
      const slot = DK_SLOTS[s];
      const candidates = active.filter(
        (j) => !usedPlayers.has(j) && eligibility[s][j]
      );

      if (candidates.length > 0) {
        const best = candidates.reduce((a, b) =>
          players[a].projection >= players[b].projection ? a : b
        );
        assigned.set(slot, best);
        usedPlayers.add(best);
      } else {
        // No eligible active player — bring in a free agent
        const allInactive: number[] = [];
        for (let j = 0; j < n; j++) {
          if (!activeSet.has(j) && !usedPlayers.has(j) && !players[j].excluded) {
            allInactive.push(j);
          }
        }
        const eligibleFAs = allInactive.filter((j) => eligibility[s][j]);
        if (eligibleFAs.length === 0) return invalidResult;

        const faIdx = eligibleFAs.reduce((a, b) =>
          players[a].projection >= players[b].projection ? a : b
        );

        // Drop lowest proj/salary active player not yet assigned (never a locked player)
        const unassignedActive = active.filter((j) => !usedPlayers.has(j) && !lockedSet.has(j));
        if (unassignedActive.length === 0) return invalidResult;

        const victim = unassignedActive.reduce((a, b) =>
          players[a].projection / Math.max(1, players[a].salary) <=
          players[b].projection / Math.max(1, players[b].salary)
            ? a
            : b
        );

        active = active.filter((j) => j !== victim);
        bits[victim] = 0;
        activeSet.delete(victim);
        active.push(faIdx);
        bits[faIdx] = 1;
        activeSet.add(faIdx);

        assigned.set(slot, faIdx);
        usedPlayers.add(faIdx);
      }
    }

    // UTIL fallback: assign any remaining active player not yet placed
    const remaining = active.filter((j) => !usedPlayers.has(j));
    if (remaining.length > 0 && !assigned.has('UTIL')) {
      assigned.set('UTIL', remaining[0]);
      usedPlayers.add(remaining[0]);
    }

    // STEP 4: Salary cap repair (swap-based, position-safe)
    const slotOf = new Map<number, Slot>();
    assigned.forEach((playerIdx, slot) => slotOf.set(playerIdx, slot));

    let currentSalary = 0;
    usedPlayers.forEach((j) => { currentSalary += players[j].salary; });

    const seenSwaps = new Set<string>();
    let maxIters = n * 2;

    while (currentSalary > salaryCap && maxIters > 0) {
      maxIters--;
      const inactiveAll: number[] = [];
      for (let j = 0; j < n; j++) {
        if (!usedPlayers.has(j) && !players[j].excluded) inactiveAll.push(j);
      }

      let bestSavings = -1;
      let toDrop = -1;

      usedPlayers.forEach((pIdx) => {
        if (lockedSet.has(pIdx)) return;  // never evict locked players
        const slot = slotOf.get(pIdx);
        if (!slot) return;
        const si = slotIndex(slot);
        const eligibleFAs = inactiveAll.filter((j) => eligibility[si][j]);
        if (eligibleFAs.length === 0) return;
        const cheapestSalary = eligibleFAs.reduce(
          (minSal, j) => Math.min(minSal, players[j].salary),
          Infinity
        );
        const savings = players[pIdx].salary - cheapestSalary;
        if (savings > bestSavings) {
          bestSavings = savings;
          toDrop = pIdx;
        }
      });

      if (toDrop === -1) {
        return { lineup: new Uint8Array(n), playerIdxs: [], salary: currentSalary, valid: false };
      }

      const dropSlot = slotOf.get(toDrop)!;
      const dropSi = slotIndex(dropSlot);
      const eligibleFAs = inactiveAll.filter((j) => eligibility[dropSi][j]);
      const overage = currentSalary - salaryCap;
      const affordable = eligibleFAs.filter(
        (j) => players[j].salary <= players[toDrop].salary - overage
      );
      const toAdd =
        affordable.length > 0
          ? affordable.reduce((a, b) =>
              players[a].projection >= players[b].projection ? a : b
            )
          : eligibleFAs.reduce((a, b) =>
              players[a].salary <= players[b].salary ? a : b
            );

      const swapKey = `${toDrop}_${toAdd}`;
      if (seenSwaps.has(swapKey)) {
        return { lineup: new Uint8Array(n), playerIdxs: [], salary: currentSalary, valid: false };
      }
      seenSwaps.add(swapKey);

      usedPlayers.delete(toDrop);
      usedPlayers.add(toAdd);
      assigned.set(dropSlot, toAdd);
      slotOf.delete(toDrop);
      slotOf.set(toAdd, dropSlot);
      currentSalary = currentSalary - players[toDrop].salary + players[toAdd].salary;
    }

    // STEP 4b: Salary floor enforcement
    while (currentSalary < salaryFloor) {
      let lowestSalaryPlayer = -1;
      let lowestSalary = Infinity;
      usedPlayers.forEach((j) => {
        if (lockedSet.has(j)) return;  // never replace locked players
        if (players[j].salary < lowestSalary) {
          lowestSalary = players[j].salary;
          lowestSalaryPlayer = j;
        }
      });
      if (lowestSalaryPlayer === -1) break;

      const upgradeSlot = slotOf.get(lowestSalaryPlayer)!;
      const upgradeSi = slotIndex(upgradeSlot);
      const inactiveForUpgrade: number[] = [];
      for (let j = 0; j < n; j++) {
        if (!usedPlayers.has(j) && !players[j].excluded) inactiveForUpgrade.push(j);
      }
      const upgrades = inactiveForUpgrade.filter(
        (j) =>
          eligibility[upgradeSi][j] &&
          players[j].salary > players[lowestSalaryPlayer].salary &&
          currentSalary - players[lowestSalaryPlayer].salary + players[j].salary <= salaryCap
      );
      if (upgrades.length === 0) break;

      const toAdd = upgrades.reduce((a, b) =>
        players[a].projection >= players[b].projection ? a : b
      );

      usedPlayers.delete(lowestSalaryPlayer);
      usedPlayers.add(toAdd);
      assigned.set(upgradeSlot, toAdd);
      slotOf.delete(lowestSalaryPlayer);
      slotOf.set(toAdd, upgradeSlot);
      currentSalary = currentSalary - players[lowestSalaryPlayer].salary + players[toAdd].salary;
    }

    // STEP 5: Build output
    const playerIdxs = DK_SLOTS.map((slot) => assigned.get(slot) ?? -1);
    const valid =
      playerIdxs.every((idx) => idx >= 0) &&
      new Set(playerIdxs).size === 8 &&
      currentSalary <= salaryCap;

    const lineup = new Uint8Array(n);
    playerIdxs.filter((i) => i >= 0).forEach((i) => { lineup[i] = 1; });

    return { lineup, playerIdxs, salary: currentSalary, valid };
  } catch {
    return invalidResult;
  }
};

// ---------------------------------------------------------------------------
// Layer 2: Stack-aware fitness scoring
// ---------------------------------------------------------------------------

const scoreLineup = (
  playerIdxs: number[],
  players: QIEAPlayer[],
  config: QIEAConfig,
): number => {
  let score = 0;

  for (const idx of playerIdxs) {
    score +=
      players[idx].projection -
      config.ownershipPenalty * players[idx].ownership;
  }

  if (config.enableStackScoring) {
    const teamCounts = new Map<string, number[]>();
    for (const idx of playerIdxs) {
      const team = players[idx].team;
      if (!teamCounts.has(team)) teamCounts.set(team, []);
      teamCounts.get(team)!.push(idx);
    }

    // Primary stack bonus
    let primaryTeam = '';
    let primaryCount = 0;
    teamCounts.forEach((idxs, team) => {
      if (idxs.length > primaryCount) {
        primaryCount = idxs.length;
        primaryTeam = team;
      }
    });

    if (primaryCount >= config.primaryStackSize) {
      score += config.primaryStackBonus * primaryCount;
    }

    // Game stack bonus (bring-back)
    if (primaryTeam) {
      const primaryIdxs = teamCounts.get(primaryTeam)!;
      const primaryGameSlug = players[primaryIdxs[0]].gameSlug;

      teamCounts.forEach((otherIdxs, otherTeam) => {
        if (otherTeam === primaryTeam) return;
        if (players[otherIdxs[0]].gameSlug === primaryGameSlug) {
          if (otherIdxs.length >= config.gameStackSize) {
            score += config.gameStackBonus * otherIdxs.length;
          }
        }
      });
    }

    // teamStackWeights boost
    for (const idx of playerIdxs) {
      const w = config.teamStackWeights?.[players[idx].team] ?? 0;
      if (w > 0) score += w * 0.6;
    }
  }

  return score;
};

// ---------------------------------------------------------------------------
// Rotation gate
// ---------------------------------------------------------------------------

const applyRotation = (
  thetas: Float32Array[],
  repaired: Uint8Array[],
  targets: Uint8Array[],
  scores: number[],
  targetScores: number[],
  validMask: boolean[],
  config: QIEAConfig,
): void => {
  const popSize = thetas.length;
  const n = thetas[0].length;

  for (let i = 0; i < popSize; i++) {
    if (!validMask[i]) continue;
    const f_xi = scores[i];
    const f_b = targetScores[i];

    for (let j = 0; j < n; j++) {
      const x_ij = repaired[i][j];
      const b_j = targets[i][j];
      let rot_sign = 0;

      if (f_xi < f_b) {
        if (x_ij === 0 && b_j === 1) rot_sign = 1;
        else if (x_ij === 1 && b_j === 0) rot_sign = -1;
      } else if (f_xi > f_b) {
        if (x_ij === 0 && b_j === 1) rot_sign = -1;
        else if (x_ij === 1 && b_j === 0) rot_sign = 1;
      }

      const newTheta = thetas[i][j] + rot_sign * config.deltaTheta;
      thetas[i][j] = clamp(newTheta, 0.001, Math.PI / 2 - 0.001);
    }
  }
};

// ---------------------------------------------------------------------------
// Archive management
// ---------------------------------------------------------------------------

const hammingDistance = (a: Uint8Array, b: Uint8Array): number => {
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++;
  }
  return dist;
};

const attemptArchiveAdmission = (
  archive: ArchiveEntry[],
  score: number,
  lineup: Uint8Array,
  playerIdxs: number[],
  minHamming: number,
  maxSize: number,
  exposureCounts: number[],
  maxAllowedByPlayer: number[],
): boolean => {
  // Hard max-exposure gate: reject if any player in this lineup is already at their cap
  for (const idx of playerIdxs) {
    if (exposureCounts[idx] >= maxAllowedByPlayer[idx]) return false;
  }

  if (archive.length === 0) {
    archive.push({
      lineup: lineup.slice(),
      score,
      players: [...playerIdxs].sort((a, b) => a - b),
    });
    for (const idx of playerIdxs) exposureCounts[idx]++;
    return true;
  }

  let minDist = Infinity;
  for (const entry of archive) {
    const d = hammingDistance(lineup, entry.lineup);
    if (d < minDist) minDist = d;
  }

  if (minDist < minHamming) return false;

  const worstScore = archive.reduce((min, e) => Math.min(min, e.score), Infinity);
  if (score > worstScore || archive.length < maxSize) {
    archive.push({
      lineup: lineup.slice(),
      score,
      players: [...playerIdxs].sort((a, b) => a - b),
    });
    for (const idx of playerIdxs) exposureCounts[idx]++;
    if (archive.length > maxSize) {
      // Evict lowest-scoring entry and decrement its exposure counts
      let minIdx = 0;
      for (let i = 1; i < archive.length; i++) {
        if (archive[i].score < archive[minIdx].score) minIdx = i;
      }
      for (const idx of archive[minIdx].players) exposureCounts[idx]--;
      archive.splice(minIdx, 1);
    }
    return true;
  }

  return false;
};

const selectTargets = (
  repaired: Uint8Array[],
  archive: ArchiveEntry[],
  validMask: boolean[],
): { targets: Uint8Array[]; targetScores: number[] } => {
  const popSize = repaired.length;
  const targets: Uint8Array[] = [];
  const targetScores: number[] = [];
  const fallback = archive.length > 0 ? archive[0] : null;

  for (let i = 0; i < popSize; i++) {
    if (!validMask[i] || archive.length === 0) {
      targets.push(fallback ? fallback.lineup : repaired[i]);
      targetScores.push(fallback ? fallback.score : 0);
      continue;
    }

    // Target = archive entry with max Hamming distance
    let bestEntry = archive[0];
    let maxDist = -1;
    for (const entry of archive) {
      const d = hammingDistance(repaired[i], entry.lineup);
      if (d > maxDist) {
        maxDist = d;
        bestEntry = entry;
      }
    }
    targets.push(bestEntry.lineup);
    targetScores.push(bestEntry.score);
  }

  return { targets, targetScores };
};

const bootstrapRotation = (
  thetas: Float32Array[],
  repaired: Uint8Array[],
  scores: number[],
  validMask: boolean[],
  config: QIEAConfig,
): void => {
  let bestScore = -Infinity;
  let bestIdx = -1;
  for (let i = 0; i < scores.length; i++) {
    if (validMask[i] && scores[i] > bestScore) {
      bestScore = scores[i];
      bestIdx = i;
    }
  }
  if (bestIdx === -1) return;

  const bestTarget = repaired[bestIdx];
  const uniformTargets = repaired.map(() => bestTarget);
  const uniformTargetScores = scores.map(() => bestScore);

  applyRotation(
    thetas, repaired, uniformTargets, scores, uniformTargetScores, validMask, config
  );
};

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

const archiveEntryToLineup = (
  entry: ArchiveEntry,
  qieaPlayers: QIEAPlayer[],
  originalPlayers: Player[],
  index: number,
): Lineup => {
  const playerIds = entry.players.map((i) => originalPlayers[qieaPlayers[i].index].id);
  const totalSalary = entry.players.reduce((sum, i) => sum + qieaPlayers[i].salary, 0);
  // totalProjection uses raw player.projection from originalPlayers (not GPP-adjusted)
  const totalProjection =
    Math.round(
      entry.players.reduce(
        (sum, i) => sum + safeNumber(originalPlayers[qieaPlayers[i].index].projection, 0),
        0
      ) * 100
    ) / 100;

  return {
    id: `qiea_${index}_${entry.players.join('_')}`,
    playerIds,
    totalSalary,
    totalProjection,
    players: [],
    lineupSource: 'optimizer',
  };
};

const formatPortfolio = (
  archive: ArchiveEntry[],
  qieaPlayers: QIEAPlayer[],
  originalPlayers: Player[],
): Lineup[] => {
  const sorted = [...archive].sort((a, b) => b.score - a.score);
  return sorted.map((entry, idx) =>
    archiveEntryToLineup(entry, qieaPlayers, originalPlayers, idx)
  );
};

// ---------------------------------------------------------------------------
// Main QIEA loop
// ---------------------------------------------------------------------------

const runQIEA = async (
  players: QIEAPlayer[],
  eligibility: boolean[][],
  config: QIEAConfig,
  resolvedConfig: { salaryCap: number; salaryFloor: number; numLineups: number },
  rawPlayers: Player[],
  onProgress: (pct: number, best: Lineup | null, found: number) => void,
): Promise<ArchiveEntry[]> => {
  const thetas = initThetas(players, config.popSize, config);
  const archive: ArchiveEntry[] = [];
  const lockedIndexes = players
    .map((p, i) => (p.locked ? i : -1))
    .filter((i) => i !== -1);

  // Per-player max lineup count derived from maxExposurePct and total requested lineups
  const maxAllowedByPlayer = players.map((p) =>
    Math.max(1, Math.floor((p.maxExposurePct / 100) * resolvedConfig.numLineups))
  );
  // Live count of how many archive entries each player currently appears in
  const exposureCounts = new Array<number>(players.length).fill(0);

  let patienceCounter = 0;
  let lastArchiveSize = 0;
  let lastBestScore = -Infinity;

  for (let gen = 0; gen < config.generations; gen++) {
    const collapsed = observePopulation(thetas, players.length);

    const repaired: Uint8Array[] = [];
    const scores: number[] = [];
    const validMask: boolean[] = [];
    const lineupIdxs: number[][] = [];

    for (let i = 0; i < config.popSize; i++) {
      const result = repairLineup(
        collapsed[i],
        players,
        eligibility,
        resolvedConfig.salaryCap,
        resolvedConfig.salaryFloor,
        lockedIndexes,
      );
      repaired.push(result.lineup);
      validMask.push(result.valid);

      if (result.valid) {
        scores.push(scoreLineup(result.playerIdxs, players, config));
        lineupIdxs.push(result.playerIdxs);
      } else {
        scores.push(0);
        lineupIdxs.push([]);
      }
    }

    let archiveChanged = false;
    for (let i = 0; i < config.popSize; i++) {
      if (!validMask[i]) continue;
      if (
        attemptArchiveAdmission(
          archive,
          scores[i],
          repaired[i],
          lineupIdxs[i],
          config.minHamming,
          resolvedConfig.numLineups,
          exposureCounts,
          maxAllowedByPlayer,
        )
      ) {
        archiveChanged = true;
      }
    }

    const currentBest =
      archive.length > 0
        ? archive.reduce((max, e) => Math.max(max, e.score), -Infinity)
        : -Infinity;

    if (archive.length === lastArchiveSize && currentBest <= lastBestScore) {
      patienceCounter++;
    } else {
      patienceCounter = 0;
      lastArchiveSize = archive.length;
      lastBestScore = currentBest;
    }

    if (patienceCounter >= config.patience) break;

    if (archive.length === 0) {
      bootstrapRotation(thetas, repaired, scores, validMask, config);
    } else {
      const { targets, targetScores } = selectTargets(repaired, archive, validMask);
      applyRotation(thetas, repaired, targets, scores, targetScores, validMask, config);
    }

    if (gen % 10 === 0 || archiveChanged) {
      const pct = Math.round(((gen + 1) / config.generations) * 100);
      const bestEntry =
        archive.length > 0
          ? archive.reduce((a, b) => (a.score > b.score ? a : b))
          : null;
      onProgress(
        pct,
        bestEntry
          ? archiveEntryToLineup(bestEntry, players, rawPlayers, gen)
          : null,
        archive.length,
      );
    }

    // Yield to the event loop every 50 generations
    if (gen % 50 === 49) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return archive;
};

// ---------------------------------------------------------------------------
// Worker entrypoint
// ---------------------------------------------------------------------------

workerScope.onmessage = async (event: MessageEvent<RequestPayload>) => {
  try {
    const { players: rawPlayers, config: rawConfig } = event.data || { players: [] };

    if (!Array.isArray(rawPlayers) || rawPlayers.length === 0) {
      throw new Error('No players provided. Load the slate before running the optimizer.');
    }

    // 1. Resolve config
    const qieaConfig = resolveQIEAConfig(rawConfig);
    const resolvedConfig = resolveRunConfig(rawConfig);

    // 2. Preprocess players and build eligibility matrix
    const players = preprocessPlayers(rawPlayers, qieaConfig, resolvedConfig.salaryCap);
    const eligibility = buildEligibilityMatrix(players);

    if (players.length < 8) {
      throw new Error('Not enough eligible players to build a lineup.');
    }
    for (let s = 0; s < DK_SLOTS.length; s++) {
      const ok = players.some((_p, j) => eligibility[s][j]);
      if (!ok) throw new Error(`No eligible players for slot ${DK_SLOTS[s]}.`);
    }

    // 4. Run QIEA optimizer
    const archive = await runQIEA(
      players,
      eligibility,
      qieaConfig,
      resolvedConfig,
      rawPlayers,
      (pct, best, found) => {
        workerScope.postMessage({
          type: 'progress',
          progress: pct,
          currentBest: best,
          lineupsFound: found,
        });
      },
    );

    if (archive.length === 0) {
      throw new Error(
        'No valid lineups found. Check salary cap, positions, and slate data.'
      );
    }

    const lineups = formatPortfolio(archive, players, rawPlayers);
    workerScope.postMessage({ type: 'result', lineups });
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown optimization error',
    });
  }
};

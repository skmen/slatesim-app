import highsLoader from 'highs';
import highsWasmUrl from 'highs/runtime?url';
import { greedyInit } from './greedy-init';
import { runSA } from './sa-core';
import { LineupSlot, OptimizerConfig, Player, PlayerPool, SLOT_CONFIG } from './types';

interface ExposureBound {
  min: number;
  max: number;
}

interface AssignmentVar {
  name: string;
  playerIndex: number;
}

interface TeamStackVar {
  name: string;
  teamId: string;
  playerIndices: number[];
}

let highsModulePromise: Promise<any> | null = null;

function getHighsModule(): Promise<any> {
  if (!highsModulePromise) {
    highsModulePromise = Promise.resolve(
      highsLoader({
        locateFile: (file: string) => (file.endsWith('.wasm') ? highsWasmUrl : file),
      }),
    );
  }
  return highsModulePromise;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pctToCount(pct: number, total: number, mode: 'min' | 'max'): number {
  const ratio = clamp(pct, 0, 100) / 100;
  const raw = ratio * total;
  return mode === 'min' ? Math.ceil(raw) : Math.floor(raw);
}

function normalizeExposurePct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const numeric = Number(value);
  // Support fractional exposure encoding (0.15 => 15%).
  return numeric > 0 && numeric < 1 ? numeric * 100 : numeric;
}

function overlapCount(a: string[], b: string[]): number {
  let overlap = 0;
  for (let i = 0; i < a.length; i++) {
    const id = a[i];
    for (let j = 0; j < b.length; j++) {
      if (id === b[j]) {
        overlap++;
        break;
      }
    }
  }
  return overlap;
}

function lineupIds(lineup: LineupSlot[]): string[] {
  const ids: string[] = new Array(SLOT_CONFIG.length);
  for (let i = 0; i < SLOT_CONFIG.length; i++) {
    ids[i] = lineup[i].player.id;
  }
  return ids;
}

function hasDuplicates(ids: string[]): boolean {
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i++) {
    if (seen.has(ids[i])) return true;
    seen.add(ids[i]);
  }
  return false;
}

function meetsMinUnique(
  ids: string[],
  priorLineupIds: string[][],
  minUniquePlayers: number,
): boolean {
  const minUnique = clamp(Math.floor(minUniquePlayers), 1, SLOT_CONFIG.length);
  const maxOverlap = SLOT_CONFIG.length - minUnique;
  for (let i = 0; i < priorLineupIds.length; i++) {
    const ov = overlapCount(ids, priorLineupIds[i]);
    if (ov > maxOverlap) return false;
  }
  return true;
}

function canFitSlot(player: Player, slotIndex: number): boolean {
  const eligible = SLOT_CONFIG[slotIndex].eligible;
  for (let i = 0; i < player.positions.length; i++) {
    const pos = player.positions[i];
    for (let j = 0; j < eligible.length; j++) {
      if (pos === eligible[j]) return true;
    }
  }
  return false;
}

function findSlotAssignment(players: Player[]): number[] | null {
  if (players.length !== SLOT_CONFIG.length) return null;
  const assignment = new Array<number>(players.length).fill(-1);
  const usedSlots = new Array<boolean>(SLOT_CONFIG.length).fill(false);
  const order = players
    .map((player, playerIndex) => {
      const eligibleSlots: number[] = [];
      for (let slotIndex = 0; slotIndex < SLOT_CONFIG.length; slotIndex++) {
        if (canFitSlot(player, slotIndex)) eligibleSlots.push(slotIndex);
      }
      return { playerIndex, eligibleSlots };
    })
    .sort((a, b) => a.eligibleSlots.length - b.eligibleSlots.length);

  const dfs = (k: number): boolean => {
    if (k >= order.length) return true;
    const row = order[k];
    for (let i = 0; i < row.eligibleSlots.length; i++) {
      const slotIndex = row.eligibleSlots[i];
      if (usedSlots[slotIndex]) continue;
      usedSlots[slotIndex] = true;
      assignment[row.playerIndex] = slotIndex;
      if (dfs(k + 1)) return true;
      assignment[row.playerIndex] = -1;
      usedSlots[slotIndex] = false;
    }
    return false;
  };

  return dfs(0) ? assignment : null;
}

function formatCoeff(value: number): string {
  const rounded = Math.abs(value) < 1e-10 ? 0 : value;
  const txt = rounded.toFixed(8);
  return txt.replace(/\.?0+$/, '');
}

function formatExpression(terms: Array<{ varName: string; coeff: number }>): string {
  const compact = terms.filter((term) => Math.abs(term.coeff) > 1e-10);
  if (compact.length === 0) return '0';

  return compact
    .map((term, idx) => {
      const sign = term.coeff >= 0 ? (idx === 0 ? '' : ' + ') : (idx === 0 ? '-' : ' - ');
      const absCoeff = Math.abs(term.coeff);
      const coeffText = Math.abs(absCoeff - 1) < 1e-10 ? '' : `${formatCoeff(absCoeff)} `;
      return `${sign}${coeffText}${term.varName}`;
    })
    .join('');
}

async function solveLpWithRecovery(lpText: string): Promise<any> {
  const recoverableRuntimePattern = /(indirect call to null|index out of bounds|indirect call signature mismatch)/i;
  const solveWithCachedModule = async (): Promise<any> => {
    const highs = await getHighsModule();
    return await highs.solve(lpText);
  };

  try {
    return await solveWithCachedModule();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || '');
    if (!recoverableRuntimePattern.test(message)) {
      throw err;
    }

    // Recover from sporadic HiGHS wasm runtime corruption by reloading module and retrying.
    highsModulePromise = null;
    try {
      return await solveWithCachedModule();
    } catch (retryErr) {
      const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr || '');
      if (!recoverableRuntimePattern.test(retryMessage)) {
        throw retryErr;
      }

      // Last resort: bypass cache entirely and force a one-off fresh wasm instance.
      const freshHighs = await Promise.resolve(
        highsLoader({
          locateFile: (file: string) => (file.endsWith('.wasm') ? highsWasmUrl : file),
        }),
      );
      return await freshHighs.solve(lpText);
    }
  }
}

function isRecoverableHighsRuntimeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /(indirect call to null|index out of bounds|indirect call signature mismatch|unable to read lp model|runtimeerror:\s*aborted\(\))/i.test(message);
}

function buildLineupLp(
  pool: PlayerPool,
  config: OptimizerConfig,
  effectiveScoreById: Map<string, number>,
  forcedIds: Set<string>,
  blockedIds: Set<string>,
  priorLineupIds: string[][],
  invalidSelectionCuts: number[][],
): { lpText: string; assignmentVars: AssignmentVar[] } {
  const assignmentVars: AssignmentVar[] = new Array(pool.all.length);
  const varNameByPlayerIndex: string[] = new Array(pool.all.length);
  const idToPlayerIndices = new Map<string, number[]>();

  for (let playerIndex = 0; playerIndex < pool.all.length; playerIndex++) {
    const player = pool.all[playerIndex];
    const varName = `x${playerIndex}`;
    assignmentVars[playerIndex] = { name: varName, playerIndex };
    varNameByPlayerIndex[playerIndex] = varName;
    if (!idToPlayerIndices.has(player.id)) idToPlayerIndices.set(player.id, []);
    idToPlayerIndices.get(player.id)!.push(playerIndex);
  }

  const groupTerms: Record<'PG' | 'SG' | 'SF' | 'PF' | 'C' | 'G' | 'F', Array<{ varName: string; coeff: number }>> = {
    PG: [],
    SG: [],
    SF: [],
    PF: [],
    C: [],
    G: [],
    F: [],
  };

  for (let playerIndex = 0; playerIndex < pool.all.length; playerIndex++) {
    const player = pool.all[playerIndex];
    const varName = varNameByPlayerIndex[playerIndex];
    const hasPG = player.positions.includes('PG');
    const hasSG = player.positions.includes('SG');
    const hasSF = player.positions.includes('SF');
    const hasPF = player.positions.includes('PF');
    const hasC = player.positions.includes('C');
    if (hasPG) groupTerms.PG.push({ varName, coeff: 1 });
    if (hasSG) groupTerms.SG.push({ varName, coeff: 1 });
    if (hasSF) groupTerms.SF.push({ varName, coeff: 1 });
    if (hasPF) groupTerms.PF.push({ varName, coeff: 1 });
    if (hasC) groupTerms.C.push({ varName, coeff: 1 });
    if (hasPG || hasSG) groupTerms.G.push({ varName, coeff: 1 });
    if (hasSF || hasPF) groupTerms.F.push({ varName, coeff: 1 });
  }

  if (
    groupTerms.PG.length === 0 ||
    groupTerms.SG.length === 0 ||
    groupTerms.SF.length === 0 ||
    groupTerms.PF.length === 0 ||
    groupTerms.C.length === 0 ||
    groupTerms.G.length < 2 ||
    groupTerms.F.length < 2
  ) {
    throw new Error('No valid positional coverage for DraftKings roster requirements.');
  }

  const lines: string[] = [];
  let constraintCounter = 0;
  const pushConstraint = (body: string): void => {
    constraintCounter += 1;
    lines.push(` c${constraintCounter}: ${body}`);
  };
  lines.push('Maximize');
  lines.push(
    ` obj: ${formatExpression(
      assignmentVars.map((row) => ({
        varName: row.name,
        coeff: Number.isFinite(effectiveScoreById.get(pool.all[row.playerIndex].id))
          ? Number(effectiveScoreById.get(pool.all[row.playerIndex].id))
          : Number(pool.all[row.playerIndex].ev || 0),
      })),
    )}`,
  );

  lines.push('Subject To');
  pushConstraint(`${formatExpression(assignmentVars.map((row) => ({ varName: row.name, coeff: 1 })))} = ${SLOT_CONFIG.length}`);
  const salaryTerms = assignmentVars.map((row) => ({
    varName: row.name,
    coeff: Number(pool.all[row.playerIndex].salary || 0),
  }));
  pushConstraint(`${formatExpression(salaryTerms)} <= ${formatCoeff(config.salaryCap)}`);
  pushConstraint(`${formatExpression(salaryTerms)} >= ${formatCoeff(config.salaryFloor)}`);
  pushConstraint(`${formatExpression(groupTerms.PG)} >= 1`);
  pushConstraint(`${formatExpression(groupTerms.SG)} >= 1`);
  pushConstraint(`${formatExpression(groupTerms.SF)} >= 1`);
  pushConstraint(`${formatExpression(groupTerms.PF)} >= 1`);
  pushConstraint(`${formatExpression(groupTerms.C)} >= 1`);
  pushConstraint(`${formatExpression(groupTerms.G)} >= 2`);
  pushConstraint(`${formatExpression(groupTerms.F)} >= 2`);

  idToPlayerIndices.forEach((indices) => {
    if (indices.length <= 1) return;
    pushConstraint(`${formatExpression(indices.map((idx) => ({ varName: varNameByPlayerIndex[idx], coeff: 1 })))} <= 1`);
  });

  blockedIds.forEach((id) => {
    const indices = idToPlayerIndices.get(id) || [];
    if (indices.length === 0) return;
    pushConstraint(`${formatExpression(indices.map((idx) => ({ varName: varNameByPlayerIndex[idx], coeff: 1 })))} = 0`);
  });

  forcedIds.forEach((id) => {
    const indices = idToPlayerIndices.get(id) || [];
    if (indices.length === 0) return;
    pushConstraint(`${formatExpression(indices.map((idx) => ({ varName: varNameByPlayerIndex[idx], coeff: 1 })))} = 1`);
  });

  // Enforce minimum uniqueness relative to each accepted lineup.
  const minUnique = clamp(Math.floor(config.minUniquePlayers), 1, SLOT_CONFIG.length);
  const maxOverlap = SLOT_CONFIG.length - minUnique;
  for (let i = 0; i < priorLineupIds.length; i++) {
    const priorIds = priorLineupIds[i];
    const terms: Array<{ varName: string; coeff: number }> = [];

    for (let k = 0; k < priorIds.length; k++) {
      const indices = idToPlayerIndices.get(priorIds[k]) || [];
      for (let v = 0; v < indices.length; v++) {
        terms.push({ varName: varNameByPlayerIndex[indices[v]], coeff: 1 });
      }
    }

    if (terms.length > 0) {
      pushConstraint(`${formatExpression(terms)} <= ${formatCoeff(maxOverlap)}`);
    }
  }

  // Exclude known invalid selections (e.g., sets that fail DK slot assignment).
  for (let i = 0; i < invalidSelectionCuts.length; i++) {
    const playerIndices = invalidSelectionCuts[i];
    if (!Array.isArray(playerIndices) || playerIndices.length === 0) continue;
    const terms = playerIndices.map((idx) => ({
      varName: varNameByPlayerIndex[idx],
      coeff: 1,
    }));
    pushConstraint(`${formatExpression(terms)} <= ${formatCoeff(SLOT_CONFIG.length - 1)}`);
  }

  const teamStackVars: TeamStackVar[] = [];
  if (config.enforceTeamStack) {
    const minTeamStackSize = clamp(Math.floor(config.minTeamStackSize ?? 2), 2, SLOT_CONFIG.length);
    const teamToPlayers = new Map<string, number[]>();
    for (let playerIndex = 0; playerIndex < pool.all.length; playerIndex++) {
      const player = pool.all[playerIndex];
      if (blockedIds.has(player.id)) continue;
      const teamId = String(player.teamId || '').trim().toUpperCase() || 'UNK';
      if (!teamToPlayers.has(teamId)) teamToPlayers.set(teamId, []);
      teamToPlayers.get(teamId)!.push(playerIndex);
    }

    const eligibleTeams = Array.from(teamToPlayers.entries()).filter(([, playerIndices]) => {
      const unique = new Set(playerIndices);
      return unique.size >= minTeamStackSize;
    });

    if (eligibleTeams.length === 0) {
      throw new Error(
        `Team stacking enabled, but no eligible team has at least ${minTeamStackSize} available players.`,
      );
    }

    for (let i = 0; i < eligibleTeams.length; i++) {
      const [teamId, playerIndices] = eligibleTeams[i];
      const safeTeam = teamId.replace(/[^A-Z0-9]/gi, '_') || 'TEAM';
      teamStackVars.push({
        name: `y_team_${safeTeam}_${i}`,
        teamId,
        playerIndices: Array.from(new Set(playerIndices)),
      });
    }

    pushConstraint(
      `${formatExpression(
        teamStackVars.map((row) => ({ varName: row.name, coeff: 1 })),
      )} >= 1`,
    );

    for (let i = 0; i < teamStackVars.length; i++) {
      const row = teamStackVars[i];
      const terms: Array<{ varName: string; coeff: number }> = [];
      for (let k = 0; k < row.playerIndices.length; k++) {
        const playerIndex = row.playerIndices[k];
        terms.push({ varName: varNameByPlayerIndex[playerIndex], coeff: 1 });
      }
      terms.push({ varName: row.name, coeff: -minTeamStackSize });
      pushConstraint(`${formatExpression(terms)} >= 0`);
    }
  }

  lines.push('Binary');
  for (let i = 0; i < assignmentVars.length; i += 40) {
    lines.push(` ${assignmentVars.slice(i, i + 40).map((row) => row.name).join(' ')}`);
  }
  if (teamStackVars.length > 0) {
    for (let i = 0; i < teamStackVars.length; i += 40) {
      lines.push(` ${teamStackVars.slice(i, i + 40).map((row) => row.name).join(' ')}`);
    }
  }
  lines.push('End');

  return {
    lpText: lines.join('\n'),
    assignmentVars,
  };
}

async function solveLineup(
  pool: PlayerPool,
  config: OptimizerConfig,
  effectiveScoreById: Map<string, number>,
  forcedIds: Set<string>,
  blockedIds: Set<string>,
  priorLineupIds: string[][],
): Promise<LineupSlot[] | null> {
  const invalidSelectionCuts: number[][] = [];

  for (let retry = 0; retry < 40; retry++) {
    const { lpText, assignmentVars } = buildLineupLp(
      pool,
      config,
      effectiveScoreById,
      forcedIds,
      blockedIds,
      priorLineupIds,
      invalidSelectionCuts,
    );

    const solution = await solveLpWithRecovery(lpText);
    const status = String(solution?.Status ?? '').toLowerCase();
    if (
      status.includes('infeasible') ||
      status.includes('error') ||
      status.includes('unbounded') ||
      status.includes('empty')
    ) {
      return null;
    }

    const columns = solution?.Columns ?? {};
    const selectedPlayerIndices = assignmentVars
      .map((row) => ({
        playerIndex: row.playerIndex,
        value: Number(columns?.[row.name]?.Primal ?? 0),
      }))
      .filter((entry) => entry.value > 0.5)
      .map((entry) => entry.playerIndex);

    if (selectedPlayerIndices.length !== SLOT_CONFIG.length) return null;

    const selectedPlayers = selectedPlayerIndices.map((idx) => pool.all[idx]);
    const slotAssignment = findSlotAssignment(selectedPlayers);
    if (!slotAssignment) {
      invalidSelectionCuts.push([...selectedPlayerIndices].sort((a, b) => a - b));
      continue;
    }

    const slotToPlayer = new Map<number, Player>();
    for (let i = 0; i < selectedPlayers.length; i++) {
      slotToPlayer.set(slotAssignment[i], selectedPlayers[i]);
    }
    if (slotToPlayer.size !== SLOT_CONFIG.length) {
      invalidSelectionCuts.push([...selectedPlayerIndices].sort((a, b) => a - b));
      continue;
    }

    const lineup: LineupSlot[] = SLOT_CONFIG.map((slotDef, slotIndex) => {
      const player = slotToPlayer.get(slotIndex);
      if (!player) throw new Error('Internal lineup assignment failure.');
      return {
        slot: slotDef.slot,
        player,
      };
    });

    return lineup;
  }

  return null;
}

function meetsTeamStack(lineup: LineupSlot[], minTeamStackSize: number): boolean {
  const minSize = clamp(Math.floor(minTeamStackSize), 2, SLOT_CONFIG.length);
  const counts = new Map<string, number>();
  for (let i = 0; i < lineup.length; i++) {
    const team = String(lineup[i].player.teamId || 'UNK').toUpperCase();
    counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  let maxTeam = 0;
  counts.forEach((count) => {
    if (count > maxTeam) maxTeam = count;
  });
  return maxTeam >= minSize;
}

function solveLineupFallback(
  pool: PlayerPool,
  config: OptimizerConfig,
  effectiveScoreById: Map<string, number>,
  forcedIds: Set<string>,
  blockedIds: Set<string>,
  attempt: number,
): LineupSlot[] | null {
  try {
    const jitterScale = Math.max(0.03, clamp(config.randomnessPct, 0, 100) / 100);
    const noisyScores = new Map<string, number>();
    for (let i = 0; i < pool.all.length; i++) {
      const player = pool.all[i];
      const base = Number.isFinite(Number(effectiveScoreById.get(player.id)))
        ? Number(effectiveScoreById.get(player.id))
        : Number(player.ev || 0);
      const jitter = (Math.random() * 2 - 1) * jitterScale * Math.max(1, Math.abs(base));
      noisyScores.set(player.id, base + jitter);
    }

    const initial = greedyInit(pool, config, noisyScores, forcedIds, blockedIds);
    const fallbackConfig: OptimizerConfig = {
      ...config,
      saTempStart: 3 + Math.min(2, attempt * 0.1),
      saTempEnd: 0.01,
      saIterations: 1600,
    };
    const optimized = runSA(initial, pool, fallbackConfig, noisyScores, forcedIds, blockedIds);
    const lineup: LineupSlot[] = new Array(SLOT_CONFIG.length);
    for (let i = 0; i < SLOT_CONFIG.length; i++) {
      lineup[i] = {
        slot: SLOT_CONFIG[i].slot,
        player: optimized.slots[i],
      };
    }

    if (config.enforceTeamStack && !meetsTeamStack(lineup, config.minTeamStackSize ?? 2)) {
      return null;
    }

    return lineup;
  } catch {
    return null;
  }
}

function totalSalary(lineup: LineupSlot[]): number {
  let salary = 0;
  for (let i = 0; i < lineup.length; i++) {
    salary += Number(lineup[i].player.salary || 0);
  }
  return salary;
}

function lineupScore(lineup: LineupSlot[], effectiveScoreById: Map<string, number>): number {
  let sum = 0;
  for (let i = 0; i < lineup.length; i++) {
    const player = lineup[i].player;
    const score = effectiveScoreById.get(player.id);
    sum += Number.isFinite(Number(score)) ? Number(score) : Number(player.ev || 0);
  }
  return sum;
}

function effectiveObjectiveMap(
  players: Player[],
  config: OptimizerConfig,
  randomnessPct: number,
): Map<string, number> {
  const scale = clamp(Number(randomnessPct), 0, 100) / 100;
  const wEv = Number.isFinite(Number(config.weightEv)) ? Number(config.weightEv) : 1;
  const wProjection = Number.isFinite(Number(config.weightProjection)) ? Number(config.weightProjection) : 0;
  const wCeiling = Number.isFinite(Number(config.weightCeiling)) ? Number(config.weightCeiling) : 0;
  const wLeverage = Number.isFinite(Number(config.weightLeverage)) ? Number(config.weightLeverage) : 0;
  const out = new Map<string, number>();

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const ev = Number.isFinite(Number(player.ev)) ? Number(player.ev) : Number(player.projection || 0);
    const projection = Number(player.projection || 0);
    const ceiling = Number.isFinite(Number(player.ceiling)) ? Number(player.ceiling) : projection;
    const ownership = Number.isFinite(Number(player.ownership)) ? Number(player.ownership) : 0;
    const leverage = 100 - clamp(ownership, 0, 100);
    const base = wEv * ev + wProjection * projection + wCeiling * ceiling + wLeverage * leverage;
    const jitter = scale > 0 ? (Math.random() * 2 - 1) * scale * Math.max(1, Math.abs(base)) : 0;
    out.set(player.id, base + jitter);
  }

  return out;
}

function diversityGreedyReorder(lineups: LineupSlot[][]): LineupSlot[][] {
  const n = lineups.length;
  if (n <= 1) return lineups;

  const idsByLineup: string[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const ids: string[] = new Array(SLOT_CONFIG.length);
    for (let j = 0; j < SLOT_CONFIG.length; j++) {
      ids[j] = lineups[i][j].player.id;
    }
    idsByLineup[i] = ids;
  }

  const selected: number[] = [];
  const used = new Array<boolean>(n).fill(false);

  selected.push(0);
  used[0] = true;

  while (selected.length < n) {
    let bestIdx = -1;
    let bestMaxOverlap = Number.POSITIVE_INFINITY;
    let bestSumOverlap = Number.POSITIVE_INFINITY;

    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      let maxOverlap = 0;
      let sumOverlap = 0;
      for (let s = 0; s < selected.length; s++) {
        const chosen = selected[s];
        const ov = overlapCount(idsByLineup[i], idsByLineup[chosen]);
        if (ov > maxOverlap) maxOverlap = ov;
        sumOverlap += ov;
      }

      if (maxOverlap < bestMaxOverlap) {
        bestMaxOverlap = maxOverlap;
        bestSumOverlap = sumOverlap;
        bestIdx = i;
        continue;
      }

      if (maxOverlap === bestMaxOverlap && sumOverlap < bestSumOverlap) {
        bestSumOverlap = sumOverlap;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;
    used[bestIdx] = true;
    selected.push(bestIdx);
  }

  const out: LineupSlot[][] = new Array(selected.length);
  for (let i = 0; i < selected.length; i++) {
    out[i] = lineups[selected[i]];
  }
  return out;
}

export async function generatePortfolio(
  pool: PlayerPool,
  config: OptimizerConfig,
  onProgress: (current: number, lineup: LineupSlot[]) => void,
): Promise<LineupSlot[][]> {
  // Start each run with a fresh module to prevent wasm state bleed across runs.
  highsModulePromise = null;
  const target = Math.max(0, Math.floor(config.targetLineups));
  const results: LineupSlot[][] = [];
  const resultIds: string[][] = [];
  const exposureCounts = new Map<string, number>();
  const exposureBounds = new Map<string, ExposureBound>();

  for (let p = 0; p < pool.all.length; p++) {
    const player = pool.all[p];
    if (player.locked && player.excluded) {
      throw new Error(`Player ${player.name} (${player.id}) cannot be both locked and excluded.`);
    }

    const minPct = player.locked
      ? 100
      : Number.isFinite(player.minExposure)
        ? normalizeExposurePct(Number(player.minExposure))
        : 0;
    const maxPct = player.locked
      ? 100
      : Number.isFinite(player.maxExposure)
        ? normalizeExposurePct(Number(player.maxExposure))
        : 100;

    const minCount = pctToCount(minPct, target, 'min');
    const maxCount = pctToCount(maxPct, target, 'max');

    if (maxCount < minCount) {
      if (minPct <= maxPct) {
        throw new Error(
          `Exposure bounds infeasible for ${player.name} (${player.id}) at ${target} lineups: min ${minPct}% requires at least ${minCount} lineup(s), but max ${maxPct}% allows at most ${maxCount}.`,
        );
      }
      throw new Error(
        `Exposure bounds invalid for ${player.name} (${player.id}): min ${minPct}% exceeds max ${maxPct}%.`,
      );
    }

    exposureBounds.set(player.id, {
      min: clamp(minCount, 0, target),
      max: clamp(maxCount, 0, target),
    });
  }
  const hasMandatoryExposureMinimums = Array.from(exposureBounds.values()).some((bounds) => bounds.min > 0);

  const randomScale = clamp(config.randomnessPct, 0, 100) / 100;

  for (let i = 0; i < target; i++) {
    const remainingIncludingCurrent = target - i;
    const maxAttempts = randomScale > 0
      ? Math.max(12, Math.min(60, 12 + Math.floor(pool.all.length / 15)))
      : Math.max(8, Math.min(30, 8 + Math.floor(pool.all.length / 25)));

    let acceptedLineup: LineupSlot[] | null = null;
    let acceptedIds: string[] | null = null;
    let acceptedScore = Number.NEGATIVE_INFINITY;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const forcedIds = new Set<string>();
      const blockedIds = new Set<string>();

      for (let p = 0; p < pool.all.length; p++) {
        const player = pool.all[p];
        const bounds = exposureBounds.get(player.id);
        if (!bounds) continue;
        const seen = exposureCounts.get(player.id) ?? 0;

        if (player.excluded) {
          blockedIds.add(player.id);
          continue;
        }
        if (player.locked) {
          forcedIds.add(player.id);
        }
        if (seen >= bounds.max && !player.locked) {
          blockedIds.add(player.id);
        }
      }

      for (let p = 0; p < pool.all.length; p++) {
        const player = pool.all[p];
        if (player.excluded) continue;
        const bounds = exposureBounds.get(player.id);
        if (!bounds) continue;
        const seen = exposureCounts.get(player.id) ?? 0;
        if (seen + remainingIncludingCurrent <= bounds.min) {
          if (blockedIds.has(player.id)) {
            throw new Error(
              `Exposure constraints infeasible at lineup ${i + 1}: ${player.name} (${player.id}) is required for min exposure but already at max.`,
            );
          }
          forcedIds.add(player.id);
        }
      }

      if (forcedIds.size > SLOT_CONFIG.length) {
        throw new Error(
          `Exposure constraints infeasible at lineup ${i + 1}: ${forcedIds.size} players are forced for one lineup.`,
        );
      }

      const attemptRandomnessPct = config.randomnessPct > 0
        ? config.randomnessPct
        : (attempt === 0 ? 0 : 2);
      const effectiveScoreById = effectiveObjectiveMap(pool.all, config, attemptRandomnessPct);
      let lineup: LineupSlot[] | null = null;
      try {
        lineup = await solveLineup(
          pool,
          config,
          effectiveScoreById,
          forcedIds,
          blockedIds,
          resultIds,
        );
      } catch (solveErr) {
        if (!isRecoverableHighsRuntimeError(solveErr)) {
          throw solveErr;
        }
        highsModulePromise = null;
        // eslint-disable-next-line no-console
        console.warn('[optimizer] HiGHS runtime error encountered; retrying via SA fallback for this attempt.');
      }
      if (!lineup) {
        lineup = solveLineupFallback(
          pool,
          config,
          effectiveScoreById,
          forcedIds,
          blockedIds,
          attempt,
        );
      }
      if (!lineup) continue;

      const ids = lineupIds(lineup);
      if (hasDuplicates(ids)) continue;

      const salary = totalSalary(lineup);
      if (salary > config.salaryCap || salary < config.salaryFloor) continue;

      let forcedMissing = false;
      forcedIds.forEach((id) => {
        let found = false;
        for (let idx = 0; idx < ids.length; idx++) {
          if (ids[idx] === id) {
            found = true;
            break;
          }
        }
        if (!found) forcedMissing = true;
      });
      if (forcedMissing) continue;

      let blockedPresent = false;
      for (let idx = 0; idx < ids.length; idx++) {
        if (blockedIds.has(ids[idx])) {
          blockedPresent = true;
          break;
        }
      }
      if (blockedPresent) continue;

      if (!meetsMinUnique(ids, resultIds, config.minUniquePlayers)) continue;

      const lineupsRemainingAfterThis = target - (i + 1);
      let futureExposureInfeasible = false;
      for (let p = 0; p < pool.all.length; p++) {
        const player = pool.all[p];
        const bounds = exposureBounds.get(player.id);
        if (!bounds) continue;
        let nextSeen = exposureCounts.get(player.id) ?? 0;
        for (let s = 0; s < ids.length; s++) {
          if (ids[s] === player.id) {
            nextSeen += 1;
            break;
          }
        }
        if (nextSeen > bounds.max) {
          futureExposureInfeasible = true;
          break;
        }
        if (nextSeen + lineupsRemainingAfterThis < bounds.min) {
          futureExposureInfeasible = true;
          break;
        }
      }
      if (futureExposureInfeasible) continue;

      const nextScore = lineupScore(lineup, effectiveScoreById);
      if (!acceptedLineup || nextScore > acceptedScore) {
        acceptedLineup = lineup;
        acceptedIds = ids;
        acceptedScore = nextScore;
      }

      if (randomScale <= 0) break;
    }

    if (!acceptedLineup || !acceptedIds) {
      if (i > 0 && !hasMandatoryExposureMinimums) {
        break;
      }
      throw new Error(`Unable to generate lineup ${i + 1}/${target} with current constraints.`);
    }

    for (let s = 0; s < acceptedLineup.length; s++) {
      const id = acceptedLineup[s].player.id;
      exposureCounts.set(id, (exposureCounts.get(id) ?? 0) + 1);
    }

    results.push(acceptedLineup);
    resultIds.push(acceptedIds);
    onProgress(i + 1, acceptedLineup);
  }

  return diversityGreedyReorder(results);
}

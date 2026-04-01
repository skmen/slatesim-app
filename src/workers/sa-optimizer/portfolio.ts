import highsLoader from 'highs';
import highsWasmUrl from 'highs/runtime?url';
import { LineupSlot, OptimizerConfig, Player, PlayerPool, SLOT_CONFIG } from './types';

interface ExposureBound {
  min: number;
  max: number;
}

interface AssignmentVar {
  name: string;
  playerIndex: number;
  slotIndex: number;
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
  try {
    const highs = await getHighsModule();
    return await highs.solve(lpText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || '');
    if (!/indirect call to null/i.test(message)) {
      throw err;
    }

    // Recover from sporadic HiGHS wasm table corruption by reloading module and retrying once.
    highsModulePromise = null;
    const highs = await getHighsModule();
    return await highs.solve(lpText);
  }
}

function buildLineupLp(
  pool: PlayerPool,
  config: OptimizerConfig,
  effectiveScoreById: Map<string, number>,
  forcedIds: Set<string>,
  blockedIds: Set<string>,
  priorLineupIds: string[][],
): { lpText: string; assignmentVars: AssignmentVar[] } {
  const assignmentVars: AssignmentVar[] = [];
  const varsByPlayer = new Map<string, AssignmentVar[]>();
  const varsByPlayerIndex = new Map<number, AssignmentVar[]>();
  const varsBySlot = new Map<number, AssignmentVar[]>();

  for (let slotIndex = 0; slotIndex < SLOT_CONFIG.length; slotIndex++) {
    varsBySlot.set(slotIndex, []);
  }

  for (let playerIndex = 0; playerIndex < pool.all.length; playerIndex++) {
    const player = pool.all[playerIndex];
    const perPlayer: AssignmentVar[] = [];

    for (let slotIndex = 0; slotIndex < SLOT_CONFIG.length; slotIndex++) {
      if (!canFitSlot(player, slotIndex)) continue;
      const row: AssignmentVar = {
        name: `x_p${playerIndex}_s${slotIndex}`,
        playerIndex,
        slotIndex,
      };
      assignmentVars.push(row);
      perPlayer.push(row);
      varsBySlot.get(slotIndex)!.push(row);
      if (!varsByPlayerIndex.has(playerIndex)) varsByPlayerIndex.set(playerIndex, []);
      varsByPlayerIndex.get(playerIndex)!.push(row);
    }

    varsByPlayer.set(player.id, perPlayer);
  }

  for (let slotIndex = 0; slotIndex < SLOT_CONFIG.length; slotIndex++) {
    if ((varsBySlot.get(slotIndex) || []).length === 0) {
      throw new Error(`No eligible candidates for slot ${SLOT_CONFIG[slotIndex].slot}.`);
    }
  }

  const lines: string[] = [];
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

  // Exactly one player in each DK slot.
  for (let slotIndex = 0; slotIndex < SLOT_CONFIG.length; slotIndex++) {
    const vars = varsBySlot.get(slotIndex) || [];
    lines.push(` slot_${slotIndex}: ${formatExpression(vars.map((row) => ({ varName: row.name, coeff: 1 })))} = 1`);
  }

  // A player can occupy at most one slot.
  for (let playerIndex = 0; playerIndex < pool.all.length; playerIndex++) {
    const player = pool.all[playerIndex];
    const vars = varsByPlayer.get(player.id) || [];
    if (vars.length === 0) continue;
    lines.push(` player_${playerIndex}: ${formatExpression(vars.map((row) => ({ varName: row.name, coeff: 1 })))} <= 1`);
  }

  const salaryTerms = assignmentVars.map((row) => ({
    varName: row.name,
    coeff: Number(pool.all[row.playerIndex].salary || 0),
  }));
  lines.push(` salary_cap: ${formatExpression(salaryTerms)} <= ${formatCoeff(config.salaryCap)}`);
  lines.push(` salary_floor: ${formatExpression(salaryTerms)} >= ${formatCoeff(config.salaryFloor)}`);

  for (let playerIndex = 0; playerIndex < pool.all.length; playerIndex++) {
    const player = pool.all[playerIndex];
    const vars = varsByPlayer.get(player.id) || [];
    if (vars.length === 0) continue;

    if (blockedIds.has(player.id)) {
      lines.push(` blocked_${playerIndex}: ${formatExpression(vars.map((row) => ({ varName: row.name, coeff: 1 })))} = 0`);
      continue;
    }

    if (forcedIds.has(player.id)) {
      lines.push(` forced_${playerIndex}: ${formatExpression(vars.map((row) => ({ varName: row.name, coeff: 1 })))} = 1`);
    }
  }

  // Enforce minimum uniqueness relative to each accepted lineup.
  const minUnique = clamp(Math.floor(config.minUniquePlayers), 1, SLOT_CONFIG.length);
  const maxOverlap = SLOT_CONFIG.length - minUnique;
  for (let i = 0; i < priorLineupIds.length; i++) {
    const priorIds = priorLineupIds[i];
    const terms: Array<{ varName: string; coeff: number }> = [];

    for (let k = 0; k < priorIds.length; k++) {
      const vars = varsByPlayer.get(priorIds[k]) || [];
      for (let v = 0; v < vars.length; v++) {
        terms.push({ varName: vars[v].name, coeff: 1 });
      }
    }

    if (terms.length > 0) {
      lines.push(` unique_${i}: ${formatExpression(terms)} <= ${formatCoeff(maxOverlap)}`);
    }
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

    lines.push(
      ` team_stack_any: ${formatExpression(
        teamStackVars.map((row) => ({ varName: row.name, coeff: 1 })),
      )} >= 1`,
    );

    for (let i = 0; i < teamStackVars.length; i++) {
      const row = teamStackVars[i];
      const terms: Array<{ varName: string; coeff: number }> = [];
      for (let k = 0; k < row.playerIndices.length; k++) {
        const playerIndex = row.playerIndices[k];
        const assignmentRows = varsByPlayerIndex.get(playerIndex) || [];
        for (let j = 0; j < assignmentRows.length; j++) {
          terms.push({ varName: assignmentRows[j].name, coeff: 1 });
        }
      }
      terms.push({ varName: row.name, coeff: -minTeamStackSize });
      lines.push(` team_stack_${i}: ${formatExpression(terms)} >= 0`);
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
  const { lpText, assignmentVars } = buildLineupLp(
    pool,
    config,
    effectiveScoreById,
    forcedIds,
    blockedIds,
    priorLineupIds,
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
  const selected = assignmentVars
    .map((row) => ({
      row,
      value: Number(columns?.[row.name]?.Primal ?? 0),
    }))
    .filter((entry) => entry.value > 0.5);

  if (selected.length !== SLOT_CONFIG.length) return null;

  const slotToPlayer = new Map<number, Player>();
  for (let i = 0; i < selected.length; i++) {
    const selectedRow = selected[i].row;
    slotToPlayer.set(selectedRow.slotIndex, pool.all[selectedRow.playerIndex]);
  }

  if (slotToPlayer.size !== SLOT_CONFIG.length) return null;

  const lineup: LineupSlot[] = [];
  for (let slotIndex = 0; slotIndex < SLOT_CONFIG.length; slotIndex++) {
    const player = slotToPlayer.get(slotIndex);
    if (!player) return null;
    lineup.push({
      slot: SLOT_CONFIG[slotIndex].slot,
      player,
    });
  }

  return lineup;
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

    const minPct = player.locked ? 100 : Number.isFinite(player.minExposure) ? Number(player.minExposure) : 0;
    const maxPct = player.locked ? 100 : Number.isFinite(player.maxExposure) ? Number(player.maxExposure) : 100;

    const minCount = pctToCount(minPct, target, 'min');
    const maxCount = pctToCount(maxPct, target, 'max');

    if (maxCount < minCount) {
      throw new Error(
        `Exposure bounds invalid for ${player.name} (${player.id}): min ${minPct}% exceeds max ${maxPct}%.`,
      );
    }

    exposureBounds.set(player.id, {
      min: clamp(minCount, 0, target),
      max: clamp(maxCount, 0, target),
    });
  }

  const randomScale = clamp(config.randomnessPct, 0, 100) / 100;

  for (let i = 0; i < target; i++) {
    const remainingIncludingCurrent = target - i;
    const maxAttempts = randomScale > 0
      ? Math.max(8, Math.min(40, 8 + Math.floor(pool.all.length / 20)))
      : 1;

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

      const effectiveScoreById = effectiveObjectiveMap(pool.all, config, config.randomnessPct);
      const lineup = await solveLineup(
        pool,
        config,
        effectiveScoreById,
        forcedIds,
        blockedIds,
        resultIds,
      );
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

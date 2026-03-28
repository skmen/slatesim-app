import { greedyInit } from './greedy-init';
import { runSA } from './sa-core';
import { LineupSlot, LineupState, OptimizerConfig, Player, PlayerPool, SLOT_CONFIG } from './types';

function toLineupSlots(state: LineupState): LineupSlot[] {
  const out: LineupSlot[] = new Array(SLOT_CONFIG.length);
  for (let i = 0; i < SLOT_CONFIG.length; i++) {
    out[i] = {
      slot: SLOT_CONFIG[i].slot,
      player: state.slots[i],
    };
  }
  return out;
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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pctToCount(pct: number, total: number, mode: 'min' | 'max'): number {
  const ratio = clamp(pct, 0, 100) / 100;
  const raw = ratio * total;
  return mode === 'min' ? Math.ceil(raw) : Math.floor(raw);
}

function lineupIds(lineup: LineupState): string[] {
  const ids: string[] = new Array(SLOT_CONFIG.length);
  for (let i = 0; i < SLOT_CONFIG.length; i++) {
    ids[i] = lineup.slots[i].id;
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

export function generatePortfolio(
  pool: PlayerPool,
  config: OptimizerConfig,
  onProgress: (current: number, lineup: LineupSlot[]) => void,
): LineupSlot[][] {
  const target = Math.max(0, Math.floor(config.targetLineups));
  const results: LineupSlot[][] = [];
  const resultIds: string[][] = [];
  const exposureCounts = new Map<string, number>();
  const exposureBounds = new Map<string, { min: number; max: number }>();
  const randomScale = clamp(config.randomnessPct, 0, 100) / 100;

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

  for (let i = 0; i < target; i++) {
    const remainingIncludingCurrent = target - i;
    const maxAttempts = Math.max(30, Math.min(400, pool.all.length * 2));

    let acceptedLineup: LineupState | null = null;
    let acceptedIds: string[] | null = null;

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

      const effectiveProjections = new Map<string, number>();
      for (let p = 0; p < pool.all.length; p++) {
        const player: Player = pool.all[p];
        const priorExposure = exposureCounts.get(player.id) ?? 0;
        const base =
          config.weightProjection * player.projection +
          config.weightCeiling * player.ceiling +
          config.weightLeverage * (100 - player.ownership);
        const jitter = randomScale > 0 ? base * (Math.random() * 2 - 1) * randomScale : 0;
        const effective = base + jitter - config.exposurePenaltyLambda * priorExposure;
        effectiveProjections.set(player.id, effective);
      }

      const initial = greedyInit(pool, config, effectiveProjections, forcedIds, blockedIds);
      const optimized = runSA(initial, pool, config, effectiveProjections, forcedIds, blockedIds);
      const ids = lineupIds(optimized);

      if (hasDuplicates(ids)) continue;
      if (optimized.salaryUsed > config.salaryCap || optimized.salaryUsed < config.salaryFloor) continue;

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

      acceptedLineup = optimized;
      acceptedIds = ids;
      break;
    }

    if (!acceptedLineup || !acceptedIds) {
      throw new Error(`Unable to generate lineup ${i + 1}/${target} with current constraints.`);
    }

    for (let s = 0; s < acceptedLineup.slots.length; s++) {
      const id = acceptedLineup.slots[s].id;
      exposureCounts.set(id, (exposureCounts.get(id) ?? 0) + 1);
    }

    const lineup = toLineupSlots(acceptedLineup);
    results.push(lineup);
    resultIds.push(acceptedIds);
    onProgress(i + 1, lineup);
  }

  return diversityGreedyReorder(results);
}

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
  const exposureCounts = new Map<string, number>();

  for (let i = 0; i < target; i++) {
    const effectiveProjections = new Map<string, number>();
    for (let p = 0; p < pool.all.length; p++) {
      const player: Player = pool.all[p];
      const priorExposure = exposureCounts.get(player.id) ?? 0;
      const base =
        config.weightProjection * player.projection +
        config.weightCeiling * player.ceiling +
        config.weightLeverage * (100 - player.ownership);
      const effective = base - config.exposurePenaltyLambda * priorExposure;
      effectiveProjections.set(player.id, effective);
    }

    const initial = greedyInit(pool, config, effectiveProjections);
    const optimized = runSA(initial, pool, config, effectiveProjections);

    for (let s = 0; s < optimized.slots.length; s++) {
      const id = optimized.slots[s].id;
      exposureCounts.set(id, (exposureCounts.get(id) ?? 0) + 1);
    }

    const lineup = toLineupSlots(optimized);
    results.push(lineup);
    onProgress(i + 1, lineup);
  }

  return diversityGreedyReorder(results);
}


import { LineupState, OptimizerConfig, Player, PlayerPool, SLOT_CONFIG } from './types';

const SCARCITY_TIEBREAKER: Record<string, number> = {
  C: 0,
  PF: 1,
  SF: 2,
  PG: 3,
  SG: 4,
  G: 5,
  F: 6,
  UTIL: 7,
};

function effectiveValue(player: Player, effectiveProjections: Map<string, number>): number {
  const val = effectiveProjections.get(player.id);
  return Number.isFinite(val) ? (val as number) : player.projection;
}

function countEligibleForSlot(pool: PlayerPool, slotIdx: number): number {
  const slotDef = SLOT_CONFIG[slotIdx];
  const seen = new Set<string>();
  for (let i = 0; i < slotDef.eligible.length; i++) {
    const pos = slotDef.eligible[i];
    const bucket = pool.byPosition.get(pos);
    if (!bucket) continue;
    for (let j = 0; j < bucket.length; j++) {
      seen.add(bucket[j].id);
    }
  }
  return seen.size;
}

export function greedyInit(
  pool: PlayerPool,
  config: OptimizerConfig,
  effectiveProjections: Map<string, number>,
): LineupState {
  const slotIndices = Array.from({ length: SLOT_CONFIG.length }, (_, i) => i);
  const scarcityCount = new Array<number>(SLOT_CONFIG.length);
  for (let i = 0; i < SLOT_CONFIG.length; i++) {
    scarcityCount[i] = countEligibleForSlot(pool, i);
  }

  slotIndices.sort((a, b) => {
    const scarcityA = scarcityCount[a];
    const scarcityB = scarcityCount[b];
    if (scarcityA !== scarcityB) return scarcityA - scarcityB;
    return SCARCITY_TIEBREAKER[SLOT_CONFIG[a].slot] - SCARCITY_TIEBREAKER[SLOT_CONFIG[b].slot];
  });

  const chosenBySlot: Player[] = new Array(SLOT_CONFIG.length);
  const chosenIds = new Set<string>();
  let salaryUsed = 0;

  for (let s = 0; s < slotIndices.length; s++) {
    const slotIdx = slotIndices[s];
    const slotDef = SLOT_CONFIG[slotIdx];
    const remainingSlots = SLOT_CONFIG.length - chosenIds.size - 1;
    const remainingSalary = config.salaryCap - salaryUsed;
    const maxCandidateSalary = remainingSalary - config.minSalary * remainingSlots;

    const dedup = new Map<string, Player>();
    for (let e = 0; e < slotDef.eligible.length; e++) {
      const pos = slotDef.eligible[e];
      const bucket = pool.byPosition.get(pos);
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const p = bucket[i];
        if (chosenIds.has(p.id)) continue;
        if (p.salary > maxCandidateSalary) continue;
        if (!dedup.has(p.id)) dedup.set(p.id, p);
      }
    }

    if (dedup.size === 0) {
      throw new Error(
        `greedyInit failed at slot ${slotDef.slot}: no valid candidate. remainingSalary=${remainingSalary}, remainingSlots=${remainingSlots}, maxCandidateSalary=${maxCandidateSalary}`,
      );
    }

    const candidates = Array.from(dedup.values());
    candidates.sort((a, b) => {
      const ea = effectiveValue(a, effectiveProjections);
      const eb = effectiveValue(b, effectiveProjections);
      if (ea !== eb) return eb - ea;
      if (a.projection !== b.projection) return b.projection - a.projection;
      return a.salary - b.salary;
    });

    const selected = candidates[0];
    chosenBySlot[slotIdx] = selected;
    chosenIds.add(selected.id);
    salaryUsed += selected.salary;
  }

  if (salaryUsed > config.salaryCap) {
    throw new Error(`greedyInit produced invalid salary ${salaryUsed} > cap ${config.salaryCap}`);
  }

  let score = 0;
  for (let i = 0; i < chosenBySlot.length; i++) {
    const p = chosenBySlot[i];
    if (!p) {
      throw new Error(`greedyInit failed: slot ${SLOT_CONFIG[i].slot} remained unfilled`);
    }
    score += effectiveValue(p, effectiveProjections);
  }

  return {
    slots: chosenBySlot,
    salaryUsed,
    score,
  };
}


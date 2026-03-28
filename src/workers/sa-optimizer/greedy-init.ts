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

function canFitSlot(player: Player, slotIdx: number): boolean {
  const eligible = SLOT_CONFIG[slotIdx].eligible;
  for (let i = 0; i < player.positions.length; i++) {
    const pos = player.positions[i];
    for (let j = 0; j < eligible.length; j++) {
      if (pos === eligible[j]) return true;
    }
  }
  return false;
}

function buildForcedAssignment(pool: PlayerPool, forcedIds: Set<string>): (Player | undefined)[] {
  const chosenBySlot: (Player | undefined)[] = new Array(SLOT_CONFIG.length);
  if (forcedIds.size === 0) return chosenBySlot;

  const forcedPlayers: Array<{ player: Player; slots: number[] }> = [];
  forcedIds.forEach((id) => {
    const player = pool.byId.get(id);
    if (!player) {
      throw new Error(`greedyInit failed: forced player ${id} not found in pool`);
    }
    const slots: number[] = [];
    for (let i = 0; i < SLOT_CONFIG.length; i++) {
      if (canFitSlot(player, i)) slots.push(i);
    }
    if (slots.length === 0) {
      throw new Error(`greedyInit failed: forced player ${player.name} (${player.id}) cannot fit any DK slot`);
    }
    forcedPlayers.push({ player, slots });
  });

  forcedPlayers.sort((a, b) => a.slots.length - b.slots.length);

  const used = new Array<boolean>(SLOT_CONFIG.length).fill(false);
  const dfs = (idx: number): boolean => {
    if (idx >= forcedPlayers.length) return true;
    const row = forcedPlayers[idx];
    for (let i = 0; i < row.slots.length; i++) {
      const slotIdx = row.slots[i];
      if (used[slotIdx]) continue;
      used[slotIdx] = true;
      chosenBySlot[slotIdx] = row.player;
      if (dfs(idx + 1)) return true;
      chosenBySlot[slotIdx] = undefined;
      used[slotIdx] = false;
    }
    return false;
  };

  if (!dfs(0)) {
    throw new Error(
      `greedyInit failed: unable to assign ${forcedPlayers.length} forced players to unique DK slots`,
    );
  }

  return chosenBySlot;
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
  forcedIds: Set<string>,
  blockedIds: Set<string>,
): LineupState {
  if (forcedIds.size > SLOT_CONFIG.length) {
    throw new Error(`greedyInit failed: ${forcedIds.size} forced players exceed lineup size ${SLOT_CONFIG.length}`);
  }

  forcedIds.forEach((id) => {
    if (blockedIds.has(id)) {
      throw new Error(`greedyInit failed: player ${id} is both forced and blocked`);
    }
  });

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

  const chosenBySlot = buildForcedAssignment(pool, forcedIds);
  const chosenIds = new Set<string>();
  for (let i = 0; i < chosenBySlot.length; i++) {
    const p = chosenBySlot[i];
    if (p) chosenIds.add(p.id);
  }
  let salaryUsed = 0;
  chosenIds.forEach((id) => {
    const p = pool.byId.get(id);
    if (p) salaryUsed += p.salary;
  });

  if (salaryUsed > config.salaryCap) {
    throw new Error(
      `greedyInit failed: forced players salary ${salaryUsed} exceeds cap ${config.salaryCap}`,
    );
  }

  let lastFailure = '';
  const fillSlots = (slotOrderIdx: number): boolean => {
    if (slotOrderIdx >= slotIndices.length) return true;

    const slotIdx = slotIndices[slotOrderIdx];
    if (chosenBySlot[slotIdx]) return fillSlots(slotOrderIdx + 1);

    const slotDef = SLOT_CONFIG[slotIdx];
    let unfilledSlots = 0;
    for (let i = 0; i < SLOT_CONFIG.length; i++) {
      if (!chosenBySlot[i]) unfilledSlots++;
    }
    const remainingSlots = unfilledSlots - 1;
    const remainingSalary = config.salaryCap - salaryUsed;
    const maxCandidateSalary = remainingSalary - config.minSalary * remainingSlots;

    const dedup = new Map<string, Player>();
    for (let e = 0; e < slotDef.eligible.length; e++) {
      const pos = slotDef.eligible[e];
      const bucket = pool.byPosition.get(pos);
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i++) {
        const p = bucket[i];
        if (blockedIds.has(p.id)) continue;
        if (chosenIds.has(p.id)) continue;
        if (p.salary > maxCandidateSalary) continue;
        if (!dedup.has(p.id)) dedup.set(p.id, p);
      }
    }

    if (dedup.size === 0) {
      lastFailure = `slot ${slotDef.slot}: no valid candidate (remainingSalary=${remainingSalary}, remainingSlots=${remainingSlots})`;
      return false;
    }

    const candidates = Array.from(dedup.values()).filter((candidate) => {
      const nextSalary = salaryUsed + candidate.salary;
      if (nextSalary > config.salaryCap) return false;

      if (remainingSlots <= 0) {
        return nextSalary >= config.salaryFloor;
      }

      const remainingSalaries: number[] = [];
      for (let i = 0; i < pool.all.length; i++) {
        const p = pool.all[i];
        if (p.id === candidate.id) continue;
        if (blockedIds.has(p.id)) continue;
        if (chosenIds.has(p.id)) continue;
        remainingSalaries.push(p.salary);
      }
      if (remainingSalaries.length < remainingSlots) return false;
      remainingSalaries.sort((a, b) => a - b);
      let minFutureSalary = 0;
      let maxFutureSalary = 0;
      for (let i = 0; i < remainingSlots; i++) {
        minFutureSalary += remainingSalaries[i];
        maxFutureSalary += remainingSalaries[remainingSalaries.length - 1 - i];
      }
      if (nextSalary + minFutureSalary > config.salaryCap) return false;
      if (nextSalary + maxFutureSalary < config.salaryFloor) return false;
      return true;
    });

    if (candidates.length === 0) {
      lastFailure = `slot ${slotDef.slot}: no feasible candidate after salary floor/cap reservation`;
      return false;
    }

    candidates.sort((a, b) => {
      const ea = effectiveValue(a, effectiveProjections);
      const eb = effectiveValue(b, effectiveProjections);
      if (ea !== eb) return eb - ea;
      if (a.projection !== b.projection) return b.projection - a.projection;
      return a.salary - b.salary;
    });

    const tryLimit = Math.min(candidates.length, 80);
    for (let i = 0; i < tryLimit; i++) {
      const selected = candidates[i];
      chosenBySlot[slotIdx] = selected;
      chosenIds.add(selected.id);
      salaryUsed += selected.salary;

      if (fillSlots(slotOrderIdx + 1)) return true;

      salaryUsed -= selected.salary;
      chosenIds.delete(selected.id);
      chosenBySlot[slotIdx] = undefined;
    }

    lastFailure = `slot ${slotDef.slot}: candidate backtracking exhausted (${tryLimit} tried)`;
    return false;
  };

  if (!fillSlots(0)) {
    throw new Error(`greedyInit failed: ${lastFailure || 'unable to fill all slots with current constraints'}`);
  }

  if (salaryUsed > config.salaryCap || salaryUsed < config.salaryFloor) {
    throw new Error(
      `greedyInit produced invalid salary ${salaryUsed} outside [${config.salaryFloor}, ${config.salaryCap}]`,
    );
  }

  let score = 0;
  const filledSlots: Player[] = new Array(SLOT_CONFIG.length);
  for (let i = 0; i < chosenBySlot.length; i++) {
    const p = chosenBySlot[i];
    if (!p) {
      throw new Error(`greedyInit failed: slot ${SLOT_CONFIG[i].slot} remained unfilled`);
    }
    filledSlots[i] = p;
    score += effectiveValue(p, effectiveProjections);
  }

  return {
    slots: filledSlots,
    salaryUsed,
    score,
  };
}

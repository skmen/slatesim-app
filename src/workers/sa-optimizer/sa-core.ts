import { LineupState, OptimizerConfig, PlayerPool, SLOT_CONFIG } from './types';

function effectiveOf(playerId: string, effectiveProjections: Map<string, number>): number {
  const val = effectiveProjections.get(playerId);
  return Number.isFinite(val) ? (val as number) : 0;
}

export function runSA(
  initial: LineupState,
  pool: PlayerPool,
  config: OptimizerConfig,
  effectiveProjections: Map<string, number>,
  forcedIds: Set<string>,
  blockedIds: Set<string>,
): LineupState {
  const state = initial;
  const slotCount = SLOT_CONFIG.length;
  const totalIterations = Math.max(1, Math.floor(config.saIterations));
  const tempStart = Math.max(1e-9, config.saTempStart);
  const tempEnd = Math.max(1e-9, config.saTempEnd);
  const tempRatio = tempEnd / tempStart;
  const tempDecay = Math.pow(tempRatio, 1 / totalIterations);
  let currentTemp = tempStart;
  const frozenSlot = new Array<boolean>(slotCount);
  for (let i = 0; i < slotCount; i++) {
    frozenSlot[i] = forcedIds.has(state.slots[i].id);
  }

  for (let iter = 0; iter < totalIterations; iter++) {
    const slotIdx = (Math.random() * slotCount) | 0;
    if (frozenSlot[slotIdx]) {
      currentTemp *= tempDecay;
      continue;
    }

    const eligiblePositions = SLOT_CONFIG[slotIdx].eligible;
    const posIdx = (Math.random() * eligiblePositions.length) | 0;
    const chosenPos = eligiblePositions[posIdx];
    const bucket = pool.byPosition.get(chosenPos);
    if (!bucket || bucket.length === 0) {
      currentTemp *= tempDecay;
      continue;
    }

    const candidate = bucket[(Math.random() * bucket.length) | 0];
    if (blockedIds.has(candidate.id)) {
      currentTemp *= tempDecay;
      continue;
    }

    let duplicate = false;
    for (let i = 0; i < slotCount; i++) {
      if (state.slots[i].id === candidate.id) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) {
      currentTemp *= tempDecay;
      continue;
    }

    const current = state.slots[slotIdx];
    const newSalary = state.salaryUsed - current.salary + candidate.salary;
    if (newSalary > config.salaryCap || newSalary < config.salaryFloor) {
      currentTemp *= tempDecay;
      continue;
    }

    const candidateScore = effectiveOf(candidate.id, effectiveProjections);
    const currentScore = effectiveOf(current.id, effectiveProjections);
    const delta = candidateScore - currentScore;

    const temp = currentTemp > 1e-9 ? currentTemp : 1e-9;
    const accept = delta > 0 || Math.random() < Math.exp(delta / temp);
    if (!accept) {
      currentTemp *= tempDecay;
      continue;
    }

    state.slots[slotIdx] = candidate;
    state.salaryUsed = newSalary;
    state.score += delta;
    frozenSlot[slotIdx] = forcedIds.has(candidate.id);
    currentTemp *= tempDecay;
  }

  return state;
}

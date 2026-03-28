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
): LineupState {
  const state = initial;
  const slotCount = SLOT_CONFIG.length;
  const totalIterations = Math.max(1, Math.floor(config.saIterations));
  const tempStart = Math.max(1e-9, config.saTempStart);
  const tempEnd = Math.max(1e-9, config.saTempEnd);
  const tempRatio = tempEnd / tempStart;

  for (let iter = 0; iter < totalIterations; iter++) {
    const slotIdx = (Math.random() * slotCount) | 0;
    const eligiblePositions = SLOT_CONFIG[slotIdx].eligible;
    const posIdx = (Math.random() * eligiblePositions.length) | 0;
    const chosenPos = eligiblePositions[posIdx];
    const bucket = pool.byPosition.get(chosenPos);
    if (!bucket || bucket.length === 0) continue;

    const candidate = bucket[(Math.random() * bucket.length) | 0];

    let duplicate = false;
    for (let i = 0; i < slotCount; i++) {
      if (state.slots[i].id === candidate.id) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;

    const current = state.slots[slotIdx];
    const newSalary = state.salaryUsed - current.salary + candidate.salary;
    if (newSalary > config.salaryCap) continue;

    const candidateScore = effectiveOf(candidate.id, effectiveProjections);
    const currentScore = effectiveOf(current.id, effectiveProjections);
    const delta = candidateScore - currentScore;

    const t = tempStart * Math.pow(tempRatio, iter / totalIterations);
    const temp = t > 1e-9 ? t : 1e-9;
    const accept = delta > 0 || Math.random() < Math.exp(delta / temp);
    if (!accept) continue;

    state.slots[slotIdx] = candidate;
    state.salaryUsed = newSalary;
    state.score += delta;
  }

  return state;
}


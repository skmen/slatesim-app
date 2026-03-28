import { buildPlayerPool } from './pool';
import { generatePortfolio } from './portfolio';
import { OptimizerConfig, WorkerInMessage, WorkerOutMessage } from './types';

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerInMessage>) => void) | null;
  postMessage: (message: WorkerOutMessage) => void;
};

function normalizeConfig(input: OptimizerConfig): OptimizerConfig {
  const salaryCap = Math.floor(Number.isFinite(Number(input.salaryCap)) ? Number(input.salaryCap) : 50000);
  const salaryFloorRaw = Math.floor(Number.isFinite(Number(input.salaryFloor)) ? Number(input.salaryFloor) : 0);
  const salaryFloor = Math.max(0, Math.min(salaryFloorRaw, salaryCap));

  return {
    targetLineups: Math.max(0, Math.floor(input.targetLineups ?? 0)),
    weightProjection: Number(input.weightProjection ?? 0),
    weightCeiling: Number(input.weightCeiling ?? 0),
    weightLeverage: Number(input.weightLeverage ?? 0),
    exposurePenaltyLambda: Number(input.exposurePenaltyLambda ?? 0),
    saTempStart: Number.isFinite(Number(input.saTempStart)) ? Number(input.saTempStart) : 5.0,
    saTempEnd: Number.isFinite(Number(input.saTempEnd)) ? Number(input.saTempEnd) : 0.01,
    saIterations: Math.max(1, Math.floor(input.saIterations ?? 2000)),
    salaryCap,
    salaryFloor,
    minSalary: Math.max(0, Math.floor(Number.isFinite(Number(input.minSalary)) ? Number(input.minSalary) : 3000)),
    minUniquePlayers: Math.max(1, Math.min(8, Math.floor(Number.isFinite(Number(input.minUniquePlayers)) ? Number(input.minUniquePlayers) : 1))),
    randomnessPct: Math.max(0, Math.min(100, Number.isFinite(Number(input.randomnessPct)) ? Number(input.randomnessPct) : 0)),
  };
}

workerScope.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  try {
    const payload = event.data;
    if (!payload || !Array.isArray(payload.players)) {
      throw new Error('Invalid input: expected { players, config }.');
    }
    if (!payload.config) {
      throw new Error('Invalid input: missing config.');
    }

    const players = payload.players;
    const config = normalizeConfig(payload.config);
    const pool = buildPlayerPool(players);

    const timerLabel = `sa-optimizer-${Date.now()}`;
    console.time(timerLabel);

    const lineups = generatePortfolio(pool, config, (current, lineup) => {
      const message: WorkerOutMessage = {
        type: 'progress',
        payload: {
          current,
          total: config.targetLineups,
          lineup,
        },
      };
      workerScope.postMessage(message);
    });

    console.timeEnd(timerLabel);

    const result: WorkerOutMessage = {
      type: 'result',
      payload: { lineups },
    };
    workerScope.postMessage(result);
  } catch (error) {
    const message: WorkerOutMessage = {
      type: 'error',
      payload: {
        message: error instanceof Error ? error.message : 'Unknown optimizer worker error',
      },
    };
    workerScope.postMessage(message);
  }
};

export {};

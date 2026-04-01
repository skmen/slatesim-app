export interface SlotConfig {
  slot: string;
  eligible: string[];
}

export const SLOT_CONFIG: SlotConfig[] = [
  { slot: 'PG', eligible: ['PG'] },
  { slot: 'SG', eligible: ['SG'] },
  { slot: 'SF', eligible: ['SF'] },
  { slot: 'PF', eligible: ['PF'] },
  { slot: 'C', eligible: ['C'] },
  { slot: 'G', eligible: ['PG', 'SG'] },
  { slot: 'F', eligible: ['SF', 'PF'] },
  { slot: 'UTIL', eligible: ['PG', 'SG', 'SF', 'PF', 'C'] },
];

export interface Player {
  id: string;
  name: string;
  positions: string[];
  salary: number;
  projection: number;
  ev: number;
  ceiling: number;
  ownership: number;
  teamId: string;
  gameId: string;
  locked?: boolean;
  excluded?: boolean;
  minExposure?: number;
  maxExposure?: number;
}

export interface LineupState {
  slots: Player[];
  salaryUsed: number;
  score: number;
}

export interface PlayerPool {
  all: Player[];
  byPosition: Map<string, Player[]>;
  byId: Map<string, Player>;
}

export interface OptimizerConfig {
  targetLineups: number;
  salaryCap: number;
  salaryFloor: number;
  minSalary: number;
  minUniquePlayers: number;
  randomnessPct: number;
  // Legacy SA fields kept optional so older modules still type-check.
  weightProjection?: number;
  weightCeiling?: number;
  weightLeverage?: number;
  exposurePenaltyLambda?: number;
  saTempStart?: number;
  saTempEnd?: number;
  saIterations?: number;
}

export interface WorkerInMessage {
  players: Player[];
  config: OptimizerConfig;
}

export interface LineupSlot {
  slot: string;
  player: Player;
}

export type WorkerOutMessage =
  | {
      type: 'progress';
      payload: { current: number; total: number; lineup: LineupSlot[] };
    }
  | {
      type: 'result';
      payload: { lineups: LineupSlot[][] };
    }
  | {
      type: 'error';
      payload: { message: string };
    };

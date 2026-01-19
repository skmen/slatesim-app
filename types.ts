
export type Role = 'admin' | 'beta-user' | 'user';

export type Entitlement = 
  | 'run_sim'
  | 'view_diagnostics'
  | 'export_data'
  | 'admin_panel'
  | 'view_projections';

export interface User {
  username: string;
  role: Role;
  entitlements: Entitlement[];
}

export interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  opponent?: string;
  salary: number;
  projection: number;
  ceiling?: number;
  floor?: number;
  ownership?: number; // 0-100
  value?: number; // Proj / Salary * 1000
  // Index signature for dynamic CSV columns (e.g. VOLATILITY, DVP_SCORE, etc.)
  [key: string]: string | number | undefined;
}

export interface GameInfo {
  matchupKey: string;     // canonical id like "BOS_vs_NYK"
  teamA: string;
  teamB: string;
}

export interface Lineup {
  id: string;
  playerIds: string[];
  totalSalary: number;
  totalProjection: number;
  totalCeiling: number;
  totalOwnership: number;
  players?: Player[]; // Hydrated players
  set?: 'Core' | 'Set A' | 'Set B' | 'Unknown';
  simMeanScore?: number;
  simTop1Pct?: number;
  simExpectedRoiPct?: number;
  // Optimizer Metrics
  simEV?: number;
  simROI?: number;
  winProbPct?: number;
  top10Pct?: number;
  cashPct?: number;
  tailEV?: number;
  finalRankScore?: number;
  setName?: string;
  lineupIdRaw?: string;
  lineupSource?: 'optimizer_csv' | 'user_upload' | 'reference' | 'player_row_csv';
  // Advanced Tracking
  rawPlayerRefs?: string[]; // The raw strings from P1..P8
  missingRefs?: string[];   // Raw strings that failed to match
  missingCount?: number;
  slotMap?: Record<string, string>; // DK slot -> playerId (string)
  isUnordered?: boolean;
}

export interface SlateStats {
  totalPlayers: number;
  totalLineups: number;
  missingSalaryCount: number;
  dateDetected?: string;
  warnings: string[];
}

export interface ContestConfig {
  name: string;
  entryFee: number;
  rake: number;
  fieldSize: number;
}

export interface ContestInput {
  contestName: string;
  site: "DraftKings" | "FanDuel" | "Other";
  fieldSize: number;
  entryFee: number;
  maxEntries: number;
  rakePct: number;
  paidPctGuess: number;
  prizePoolOverride?: number;
}

export interface ContestDerived {
  totalEntryFees: number;
  prizePool: number;
  rakePct: number;
  expectedFieldLossPct: number;
  expectedFieldLossLabel: string;
  portfolioCoveragePct: number;
  estimatedPaidPlaces: number;
  estimatedMinCash: number;
  notes: string[];
}

export interface ContestState {
  input: ContestInput;
  derived: ContestDerived;
}

export interface AppState {
  players: Player[]; // Active pool (Beliefs > Reference)
  lineups: Lineup[];
  slateStats: SlateStats;
  contest?: ContestConfig; 
  contestState?: ContestState;
  lastUpdated: number;
  // Beta Pipeline Extensions
  referencePlayers?: Player[];
  beliefPlayers?: Player[];
  referenceMeta?: any;
  referenceDiagnostics?: any;
  activeBeliefProfileName?: string;
  referenceLineups?: Lineup[];
  games?: GameInfo[];
  hasAutoLoadedReferencePack?: boolean;
  referencePackPath?: string;
}

export enum ViewState {
  LOAD = 'LOAD',
  PROJECTIONS = 'PROJECTIONS',
  LINEUPS = 'LINEUPS',
  DIAGNOSTICS = 'DIAGNOSTICS'
}

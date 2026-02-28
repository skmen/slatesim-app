// types.ts

// --- CORE DATA MODELS ---

export interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  opponent: string;
  salary: number;
  projection: number;
  actual?: number;
  minutesProjection?: number;
  ceiling?: number;
  floor?: number;
  ownership?: number; // 0-100
  value?: number; // Proj / Salary * 1000
  
  // Detailed Player Analytics
  dvpRank?: number;
  pace?: number;
  defensiveEfficiency?: number;
  offensiveEfficiency?: number;
  reboundRate?: number;
  assistRate?: number;
  turnoverRate?: number;
  usageRate?: number;
  averageFppm?: number;
  statsProfile?: Record<string, number | string>;

  // Historical Data
  history?: HistoricalGame[];
  historicalGameLogsRaw?: any[];
  rotations?: RotationStint[];
  last5PlayByPlay?: Last5PlayByPlayGame[];

  // Index signature for dynamic CSV columns
  [key: string]: any;
}

export interface Team {
  teamId: string;
  abbreviation: string;
  name: string;
  seasonStats: {
    pace: number;
    offensiveEfficiency: number;
    defensiveEfficiency: number;
  };
  positionalDvP: {
    [position: string]: {
      rank: number;
      fantasyPointsAllowedPerGame?: number;
      PTS?: number;
      REB?: number;
      AST?: number;
      '3PM'?: number;
      BLK?: number;
      STL?: number;
    };
  };
}

export interface GameInfo {
  matchupKey: string; // canonical id like "BOS_vs_NYK"
  teamA: Team;
  teamB: Team;
  gameTime: string; // e.g., "7:00 PM EST"
  spread: number; // e.g., -7.5 for teamA
  overUnder: number;
}

export interface Lineup {
  id: string;
  playerIds: string[];
  totalSalary: number;
  totalProjection: number;
  totalCeiling?: number;
  totalOwnership?: number;
  players?: Player[]; // Hydrated players
  
  // Optimizer & Simulation Metrics
  simMeanScore?: number;
  simTop1Pct?: number;
  simExpectedRoiPct?: number;
  simEV?: number;
  simROI?: number;
  winProbPct?: number;
  top10Pct?: number;
  cashPct?: number;
  
  // Metadata
  setName?: string;
  lineupSource?: 'optimizer_csv' | 'user_upload' | 'reference' | 'optimizer';
}

// --- CONTEST & SLATE ---

export interface Slate {
  date: string; // YYYY-MM-DD
  games: GameInfo[];
  players: Player[];
  lineups?: Lineup[];
}

export interface ContestInput {
  contestName: string;
  site: "DraftKings" | "FanDuel";
  fieldSize: number;
  entryFee: number;
  maxEntries: number;
  rakePct: number;
}

export interface ContestDerived {
  prizePool: number;
  estimatedPaidPlaces: number;
  estimatedMinCash: number;
}

export interface ContestState {
  input: ContestInput;
  derived: ContestDerived;
}

// --- AUTH & USER ---

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

// --- UI STATE ---

export enum ViewState {
  LOAD = 'LOAD',
  PROJECTIONS = 'PROJECTIONS',
  RESEARCH = 'RESEARCH',
  OPTIMIZER = 'OPTIMIZER'
}

export interface AppState {
  slate: Slate;
  contestState: ContestState;
  historicalRotations?: any | null;
  historicalBoxscores?: any | null;
  historicalStats?: any | null;
  user: User;
  view: ViewState;
  loading: boolean;
  lastUpdated: number;
}

// --- UTILITY TYPES ---

export interface HistoricalGame {
  date: string;
  opponent: string;
  fpts: number;
  projection?: number;
  minutes: number;
}

export interface Last5PlayByPlayChunk {
  quarter: number;
  startMinute: number;
  endMinute: number;
  minutesPlayed: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fantasyPoints: number;
}

export interface Last5PlayByPlayGame {
  gameId: string;
  date: string;
  opponentTeamId: string;
  timelineMinutes: number;
  chunks: Last5PlayByPlayChunk[];
}

export interface RotationStint {
  period: number;
  startSec: number;
  endSec: number;
  stats?: {
    minutes: number;
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    to: number;
    fpts: number;
  };
}

export type Slot = 'PG' | 'SG' | 'SF' | 'PF' | 'C' | 'G' | 'F' | 'UTIL';
